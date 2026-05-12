import type { Db } from "./db/client.js";
import type { Env } from "./env.js";

export type HonoEnv = {
  Variables: {
    db: Db;
    env: Env;
    userId?: string;
  };
};
