import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "..", "migrations");
const webEnvPath = path.join(__dirname, "..", "..", "..", "apps", "web", ".env");

loadEnv({ path: webEnvPath });

const { Pool } = pg;

async function migrate() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL ontbreekt in de omgeving");
  }

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    await client.query(
      `create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )`,
    );

    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const applied = await client.query<{ name: string }>(
      "select name from schema_migrations",
    );
    const appliedSet = new Set(applied.rows.map((r) => r.name));

    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`skip   ${file} (al toegepast)`);
        continue;
      }

      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      console.log(`apply  ${file}`);
      try {
        await client.query("begin");
        await client.query(sql);
        await client.query("insert into schema_migrations (name) values ($1)", [file]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw new Error(`Migratie ${file} mislukt: ${(err as Error).message}`);
      }
    }

    console.log("migraties klaar");
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
