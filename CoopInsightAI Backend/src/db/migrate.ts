import { query } from "../config/db";
import dotenv from "dotenv";
import { MIGRATIONS } from "./ddl";

dotenv.config();

/**
 * Applies every statement in `ddl.ts` against the configured database.
 *
 * Each one is IF NOT EXISTS or guarded by a DO block, so this is safe to run
 * against an existing database as many times as you like:  pnpm migrate
 *
 * schema.sql remains the entry point for a fresh install and carries the same
 * statements at the end of the file; `pnpm sync-schema` regenerates that tail
 * from ddl.ts so the two cannot drift apart.
 */
async function migrate() {
  console.log("Running migrations…\n");
  for (const m of MIGRATIONS) {
    await query(m.sql);
    console.log(`✓ ${m.name}`);
  }
  console.log(`\nMigrations complete — ${MIGRATIONS.length} applied.`);
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
