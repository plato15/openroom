import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/**
 * The parts of Cloudflare D1 that Openroom uses, on a SQLite file through Node's built-in
 * node:sqlite. Same SQL, same migrations, same results shape, so src/ runs unchanged.
 */

type Row = Record<string, unknown>;

function toSql(value: unknown): SQLInputValue {
  if (value === undefined) throw new TypeError("D1_TYPE_ERROR: undefined cannot be bound");
  if (value === null || typeof value === "number" || typeof value === "string" || typeof value === "bigint") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError(`D1_TYPE_ERROR: type ${typeof value} cannot be bound`);
}

const plain = (row: unknown): Row => ({ ...(row as Row) });

export class SqliteStatement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    readonly params: SQLInputValue[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new SqliteStatement(this.db, this.sql, values.map(toSql));
  }

  async first<T = Row>(column?: string): Promise<T | null> {
    return this.firstSync<T>(column);
  }

  firstSync<T = Row>(column?: string): T | null {
    const row = this.db.prepare(this.sql).get(...this.params);
    if (row === undefined) return null;
    return (column ? (row as Row)[column] : plain(row)) as T;
  }

  async all<T = Row>() {
    return this.allSync<T>();
  }

  allSync<T = Row>() {
    const results = this.db.prepare(this.sql).all(...this.params).map(plain) as T[];
    return { success: true as const, results, meta: { changes: 0, last_row_id: 0, rows_read: results.length } };
  }

  async run() {
    return this.runSync();
  }

  runSync() {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { success: true as const, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }

  async raw<T = unknown[]>() {
    const stmt = this.db.prepare(this.sql);
    stmt.setReturnArrays(true);
    return stmt.all(...this.params) as T[];
  }
}

export class SqliteD1 {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  }

  prepare(sql: string) {
    return new SqliteStatement(this.db, sql);
  }

  /** Like D1: every statement in one transaction, all or nothing. */
  async batch(statements: SqliteStatement[]) {
    this.db.exec("BEGIN");
    try {
      const out = statements.map((s) => (/^\s*(select|with)\b/i.test(s.sql) ? s.allSync() : s.runSync()));
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async exec(sql: string) {
    this.db.exec(sql);
    return { count: 1, duration: 0 };
  }

  close() {
    this.db.close();
  }
}

/**
 * Applies migrations/*.sql in order, recording them in the same d1_migrations table Wrangler uses,
 * so a database moved between the two builds knows what has already run.
 */
export function applyMigrations(d1: SqliteD1, dir: string): string[] {
  const db = d1.db;
  db.exec(`CREATE TABLE IF NOT EXISTS d1_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const done = new Set(db.prepare("SELECT name FROM d1_migrations").all().map((r) => String((r as Row).name)));
  const applied: string[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(name)) continue;
    db.exec("BEGIN");
    try {
      db.exec(readFileSync(join(dir, name), "utf8"));
      db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(name);
      db.exec("COMMIT");
      applied.push(name);
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${name} failed: ${(err as Error).message}`);
    }
  }
  return applied;
}
