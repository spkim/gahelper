import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function applied() {
  const { rows } = await pool.query("SELECT name FROM _migrations");
  return new Set(rows.map((r) => r.name));
}

async function main() {
  await ensureTable();
  const done = await applied();
  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const name of files) {
    if (done.has(name)) {
      console.log(`skip ${name}`);
      continue;
    }
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, name), "utf8");
    console.log(`apply ${name}`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _migrations(name) VALUES ($1)", [name]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  await pool.end();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
