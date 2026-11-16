import postgres from "postgres";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
export const sql = postgres(process.env.DATABASE_URL, {
  max: 5, idle_timeout: 10, connect_timeout: 10, prepare: false
});
