import type { Db } from "./db/client";
import type { Env } from "./env";

export type HonoEnv = {
  Variables: {
    db: Db;
    env: Env;
    userId?: string;
  };
};
