import fs from "fs";
import path from "path";
import { MIGRATIONS } from "./ddl";

/**
 * Regenerates the tail of schema.sql from ddl.ts.
 *
 * schema.sql is what a fresh install runs; ddl.ts is what an existing database
 * runs. Keeping the second copy hand-written is how the two drift apart, so
 * everything below the marker is generated:  pnpm sync-schema
 */
const MARKER = "-- ─── GENERATED FROM src/db/ddl.ts — DO NOT EDIT BELOW THIS LINE ──────────────";

const schemaPath = path.join(__dirname, "schema.sql");
const existing = fs.readFileSync(schemaPath, "utf8");

const head = existing.includes(MARKER) ? existing.slice(0, existing.indexOf(MARKER)) : `${existing}\n`;

const generated = MIGRATIONS.map((m) => {
  // Strip the uniform indentation the template literals carry in ddl.ts.
  const body = m.sql
    .split("\n")
    .map((line) => (line.startsWith("      ") ? line.slice(6) : line))
    .join("\n")
    .trim();
  return `-- ${m.name}\n${body}\n`;
}).join("\n");

fs.writeFileSync(
  schemaPath,
  `${head.trimEnd()}\n\n${MARKER}\n-- Run \`pnpm sync-schema\` after changing ddl.ts.\n\n${generated}`,
  "utf8"
);

console.log(`schema.sql regenerated from ${MIGRATIONS.length} migration(s).`);
