import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./db/schema.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "../drizzle") });
  await client.end();
  console.log("Migrations applied.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
