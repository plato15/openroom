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
