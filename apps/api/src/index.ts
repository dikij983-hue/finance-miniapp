import { serve } from "@hono/node-server";
import { loadEnv } from "./env";
import { createDb } from "./db/client";
import { createApp } from "./app";

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const app = createApp(db, env);

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`API http://localhost:${info.port}`);
});
