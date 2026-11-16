import { readFile } from "node:fs/promises";
import { sql } from "./db.mjs";

try {
  const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  await sql.unsafe(schema);
  console.log("Guard schema applied (additive).");
} finally {
  await sql.end();
}
