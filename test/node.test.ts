import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteD1 } from "../src/node/d1";
import { DiskBucket } from "../src/node/r2";
import { createEnv, createHandler, openDatabase } from "../src/node/app";
import { outbox } from "../src/email";

/** The Node adapters behave like D1 and R2 where Openroom relies on it. */
describe("node adapters", () => {
  it("binds numbered parameters, returns D1-shaped results, and rolls a failed batch back", async () => {
    const db = new SqliteD1(":memory:");
    await db.exec("CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER)");
    await db.prepare("INSERT INTO t VALUES (?1, ?2)").bind("a", 1).run();
    expect(await db.prepare("SELECT * FROM t WHERE id = ?1 OR id = ?1").bind("a").first()).toEqual({ id: "a", n: 1 });
    expect(await db.prepare("SELECT n FROM t").first("n")).toBe(1);
    expect(await db.prepare("SELECT * FROM t WHERE id = ?").bind("zz").first()).toBeNull();
    expect((await db.prepare("SELECT * FROM t").all()).results).toHaveLength(1);
    await expect(db.batch([db.prepare("INSERT INTO t VALUES ('b', 2)"), db.prepare("INSERT INTO t VALUES ('a', 3)")])).rejects.toThrow();
    expect((await db.prepare("SELECT COUNT(*) AS c FROM t").first<{ c: number }>())!.c).toBe(1);
    expect(() => db.prepare("SELECT ?").bind(undefined)).toThrow();
  });

  it("keeps file keys inside the data folder", async () => {
    const bucket = new DiskBucket(mkdtempSync(join(tmpdir(), "openroom-r2-")));
    await bucket.put("files/abc", "hello");
    const obj = await bucket.get("files/abc");
    expect(await obj!.text()).toBe("hello");
    expect(obj!.size).toBe(5);
    expect(await bucket.get("files/missing")).toBeNull();
    for (const bad of ["../etc/passwd", "files/../../x", "/etc/passwd", "files//x", "files/./x"]) {
      await expect(bucket.put(bad, "x")).rejects.toThrow("invalid object key");
      await expect(bucket.get(bad)).rejects.toThrow("invalid object key");
    }
    await bucket.delete(["files/abc", "files/never-there"]);
    expect(await bucket.get("files/abc")).toBeNull();
  });

  it("never lets a client set its own address", async () => {
    const { db } = openDatabase(":memory:", join(import.meta.dirname, "..", "migrations"));
    const env = createEnv({ db, bucket: new DiskBucket(mkdtempSync(join(tmpdir(), "openroom-ip-"))), settings: { ENVIRONMENT: "test", APP_ORIGIN: "https://dataroom.test", ADMIN_EMAILS: "a@b.test" } });
    await db.prepare("INSERT INTO investors (id, email, created_at) VALUES ('i1', 'ip@fund.test', 0)").run();
    const post = (path: string, form: Record<string, string>, headers: Record<string, string>) =>
      new Request(`https://dataroom.test${path}`, { method: "POST", headers: { origin: "https://dataroom.test", ...headers }, body: new URLSearchParams(form) });

    /** Signs in through the handler with these headers and returns the address that was logged. */
    async function signInFrom(handle: ReturnType<typeof createHandler>, headers: Record<string, string>) {
      await handle(post("/login", { email: "ip@fund.test" }, headers), "10.0.0.1");
      const link = outbox.filter((m) => m.to === "ip@fund.test").pop()!.link!;
      await handle(post("/auth", { t: new URL(link).searchParams.get("t")! }, headers), "10.0.0.1");
      return (await db.prepare("SELECT ip FROM events WHERE email = 'ip@fund.test' AND action = 'sign_in' ORDER BY id DESC").first<{ ip: string }>())!.ip;
    }

    const spoof = { "cf-connecting-ip": "6.6.6.6", "x-forwarded-for": "8.8.8.8, 10.0.0.2" };
    expect(await signInFrom(createHandler(env), spoof)).toBe("10.0.0.1");
    expect(await signInFrom(createHandler(env, { trustProxy: true }), spoof)).toBe("8.8.8.8");
  });
});

describe("logo type check", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  it("accepts SVGs as design tools write them, and nothing that is not one", async () => {
    const { sniffImage } = await import("../src/brand");
    const illustrator = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generator: Adobe Illustrator 27.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [
	<!ENTITY ns_extend "http://ns.adobe.com/Extensibility/1.0/">
	<!ENTITY ns_ai "http://ns.adobe.com/AdobeIllustrator/10.0/">
	<!ENTITY ns_graphs "http://ns.adobe.com/Graphs/1.0/">
]>
<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 40"><rect width="10" height="10"/></svg>`;
    const inkscape = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<!-- Created with Inkscape (http://www.inkscape.org/) -->\n\n<svg\n   width="210mm"\n   xmlns="http://www.w3.org/2000/svg"></svg>`;
    const figma = `<svg width="120" height="24" viewBox="0 0 120 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10H0z"/></svg>`;
    const bom = `﻿<svg xmlns="http://www.w3.org/2000/svg"/>`;
    for (const svg of [illustrator, inkscape, figma, bom]) expect(sniffImage(enc(svg))).toBe("image/svg+xml");
    for (const bad of ["<html><svg></svg></html>", "<!-- <svg> -->", "hello", '<?xml version="1.0"?><note/>']) expect(sniffImage(enc(bad))).toBeNull();
  });
});

describe("Resend errors", () => {
  it("turns Resend's replies into reasons a person can act on", async () => {
    const { resendFailure } = await import("../src/email");
    expect(
      resendFailure(
        403,
        JSON.stringify({
          message:
            "You can only send testing emails to your own email address (owner@example.com). To send emails to other recipients, please verify a domain at resend.com/domains, and change the `from` address to an email using this domain.",
          name: "validation_error",
          statusCode: 403,
        }),
      ),
    ).toEqual({ reason: "own_address_only", account: "owner@example.com" });
    expect(resendFailure(401, JSON.stringify({ message: "Missing API key in the authorization header.", name: "missing_api_key" }))).toEqual({ reason: "bad_key" });
    expect(resendFailure(403, JSON.stringify({ message: "API key is invalid", name: "validation_error" }))).toEqual({ reason: "bad_key" });
    expect(resendFailure(403, JSON.stringify({ message: "The acme.com domain is not verified. Please, add and verify your domain on https://resend.com/domains", name: "validation_error" }))).toEqual({ reason: "sender_domain" });
    expect(resendFailure(500, "upstream exploded")).toEqual({ reason: "other", message: "upstream exploded" });
  });
});

describe("version compare", () => {
  it("knows which release is newer", async () => {
    const { newerThan } = await import("../src/updates");
    expect(newerThan("0.4.0", "0.3.0")).toBe(true);
    expect(newerThan("0.10.0", "0.9.9")).toBe(true);
    expect(newerThan("v1.0.0", "0.99.0")).toBe(true);
    expect(newerThan("0.3.0", "0.3.0")).toBe(false);
    expect(newerThan("0.2.9", "0.3.0")).toBe(false);
  });

  it("keeps a room's own names and ids when its config is updated", async () => {
    // @ts-expect-error plain .mjs script without types
    const { keepRoomConfig, parseJsonc } = await import("../scripts/keep-room-config.mjs");
    const old = parseJsonc(`{ // mine
      "name": "acme-room", "routes": [{ "pattern": "dataroom.acme.com", "custom_domain": true }],
      "d1_databases": [{ "binding": "DB", "database_name": "acme-db", "database_id": "abc", }],
      "r2_buckets": [{ "binding": "FILES", "bucket_name": "acme-files" }], }`);
    const next = parseJsonc(`{ "name": "openroom", "workers_dev": true, "keep_vars": true, /* new */
      "d1_databases": [{ "binding": "DB", "database_name": "openroom", "migrations_dir": "migrations" }],
      "r2_buckets": [{ "binding": "FILES", "bucket_name": "openroom-files" }] }`);
    const merged = keepRoomConfig(old, next);
    expect(merged.name).toBe("acme-room");
    expect(merged.routes[0].pattern).toBe("dataroom.acme.com");
    expect(merged.d1_databases[0]).toEqual({ binding: "DB", database_name: "acme-db", database_id: "abc", migrations_dir: "migrations" });
    expect(merged.r2_buckets[0].bucket_name).toBe("acme-files");
    expect(merged.keep_vars).toBe(true);
  });
});
