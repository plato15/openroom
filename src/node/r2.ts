import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { AwsClient } from "aws4fetch";
import { randomId } from "../util";

/**
 * The parts of Cloudflare R2 that Openroom uses (get, put, delete), as a folder on disk or any
 * S3-compatible bucket. Objects come back with body, size, arrayBuffer() and text(), like R2.
 */

type PutValue = string | ArrayBuffer | ArrayBufferView | ReadableStream | Blob | null;
type PutOptions = { httpMetadata?: { contentType?: string } };
/** The same shapes R2 takes: from `offset` for `length` bytes (to the end if no length), or the last `suffix` bytes. */
export type ByteRange = { offset?: number; length?: number; suffix?: number };
type GetOptions = { range?: ByteRange };

export type StoredObject = {
  key: string;
  size: number;
  body: ReadableStream;
  /** Set when only part of the object was asked for: where it starts and how many bytes follow. */
  range?: { offset: number; length: number };
  httpMetadata: { contentType?: string };
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
};

export interface Bucket {
  get(key: string, options?: GetOptions): Promise<StoredObject | null>;
  put(key: string, value: PutValue, options?: PutOptions): Promise<{ key: string; size: number }>;
  delete(keys: string | string[]): Promise<void>;
}

async function toBytes(value: PutValue): Promise<Uint8Array> {
  if (value === null) return new Uint8Array();
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  return new Uint8Array(await new Response(value).arrayBuffer());
}

/** Keys are made by the app (files/<id>, previews/<id>.<version>.html, brand/header). Anything else is refused. */
/** Turns a requested range into exact start and length for an object of `size` bytes. */
export function resolveRange(range: ByteRange, size: number): { offset: number; length: number } {
  if (range.suffix !== undefined) {
    const length = Math.min(Math.max(range.suffix, 0), size);
    return { offset: size - length, length };
  }
  const offset = Math.max(range.offset ?? 0, 0);
  if (offset >= size) return { offset: size, length: 0 };
  const length = Math.min(range.length ?? size - offset, size - offset);
  return { offset, length };
}

function checkKey(key: string) {
  if (!/^[A-Za-z0-9_-][A-Za-z0-9._/-]{0,511}$/.test(key) || key.split("/").some((p) => p === "" || p === "." || p === "..")) {
    throw new Error(`invalid object key: ${key}`);
  }
}

export class DiskBucket implements Bucket {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string) {
    checkKey(key);
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error(`invalid object key: ${key}`);
    return p;
  }

  async get(key: string, options?: GetOptions): Promise<StoredObject | null> {
    const p = this.path(key);
    let size: number;
    try {
      const s = await stat(p);
      if (!s.isFile()) return null;
      size = s.size;
    } catch {
      return null;
    }
    let body: ReadableStream | null = null;
    const range = options?.range ? resolveRange(options.range, size) : undefined;
    return {
      key,
      size,
      range,
      httpMetadata: {},
      get body() {
        body ??= range
          ? range.length === 0
            ? new Blob([]).stream()
            : (Readable.toWeb(createReadStream(p, { start: range.offset, end: range.offset + range.length - 1 })) as unknown as ReadableStream)
          : (Readable.toWeb(createReadStream(p)) as unknown as ReadableStream);
        return body;
      },
      arrayBuffer: async () => {
        const buf = await readFile(p);
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      },
      text: () => readFile(p, "utf8"),
    };
  }

  async put(key: string, value: PutValue) {
    const p = this.path(key);
    const bytes = await toBytes(value);
    await mkdir(dirname(p), { recursive: true });
    // Write then rename, so a reader never sees half a file.
    const tmp = `${p}.${randomId(6)}.tmp`;
    await writeFile(tmp, bytes);
    await rename(tmp, p);
    return { key, size: bytes.byteLength };
  }

  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) await rm(this.path(key), { force: true });
  }
}

/** Any S3-compatible store: AWS S3, Cloudflare R2's S3 API, Backblaze B2, MinIO, Wasabi... */
export class S3Bucket implements Bucket {
  private readonly aws: AwsClient;
  private readonly base: string;

  constructor(opts: { endpoint: string; bucket: string; region?: string; accessKeyId: string; secretAccessKey: string }) {
    this.aws = new AwsClient({
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
      service: "s3",
      region: opts.region || "auto",
    });
    // Path-style addressing works on every S3-compatible service.
    this.base = `${opts.endpoint.replace(/\/+$/, "")}/${encodeURIComponent(opts.bucket)}`;
  }

  private url(key: string) {
    checkKey(key);
    return `${this.base}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }

  async get(key: string, options?: GetOptions): Promise<StoredObject | null> {
    const r = options?.range;
    const header = r ? (r.suffix !== undefined ? `bytes=-${r.suffix}` : `bytes=${r.offset ?? 0}-${r.length !== undefined ? (r.offset ?? 0) + r.length - 1 : ""}`) : undefined;
    const res = await this.aws.fetch(this.url(key), header ? { headers: { range: header } } : undefined);
    if (res.status === 404) return null;
    const total = Number(/\/(\d+)$/.exec(res.headers.get("content-range") ?? "")?.[1]);
    if (res.status === 416 && Number.isFinite(total)) {
      return { key, size: total, range: { offset: total, length: 0 }, httpMetadata: {}, body: new Blob([]).stream(), arrayBuffer: async () => new ArrayBuffer(0), text: async () => "" };
    }
    if (!res.ok || !res.body) throw new Error(`S3 get ${res.status}`);
    const partial = res.status === 206 && Number.isFinite(total);
    const length = Number(res.headers.get("content-length") ?? 0);
    return {
      key,
      size: partial ? total : length,
      range: partial ? { offset: Number(/bytes (\d+)-/.exec(res.headers.get("content-range") ?? "")?.[1] ?? 0), length } : undefined,
      httpMetadata: { contentType: res.headers.get("content-type") ?? undefined },
      body: res.body,
      arrayBuffer: () => res.arrayBuffer(),
      text: () => res.text(),
    };
  }

  async put(key: string, value: PutValue, options?: PutOptions) {
    const bytes = await toBytes(value);
    const res = await this.aws.fetch(this.url(key), {
      method: "PUT",
      body: bytes,
      headers: { "content-type": options?.httpMetadata?.contentType ?? "application/octet-stream" },
    });
    if (!res.ok) throw new Error(`S3 put ${res.status} ${(await res.text()).slice(0, 200)}`);
    return { key, size: bytes.byteLength };
  }

  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      const res = await this.aws.fetch(this.url(key), { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`S3 delete ${res.status}`);
    }
  }
}
