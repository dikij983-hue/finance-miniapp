import { serve } from "@hono/node-server";
import { loadEnv } from "./env.js";
import { createDb } from "./db/client.js";
import { createApp } from "./app.js";

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const app = createApp(db, env);

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`API http://localhost:${info.port}`);
});
