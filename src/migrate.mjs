import { readFile } from "node:fs/promises";
import { sql } from "./db.mjs";

try {
  const source = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  // postgres.js requires sql.begin for transactional DDL; do not send
  // BEGIN/COMMIT as an unsafe multi-statement query on a connection pool.
  const script = source.split("\n").filter(line => !["BEGIN;", "COMMIT;"].includes(line.trim())).join("\n");
  const commands = script.split(";").map(statement => statement.trim()).filter(Boolean);
  await sql.begin(async tx => {
    for (const command of commands) await tx.unsafe(command);
  });
  console.log("Guard schema applied (additive, transactional).");
} finally {
  await sql.end();
}
