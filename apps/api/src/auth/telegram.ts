import { createHmac, timingSafeEqual } from "node:crypto";

export type TelegramUser = {
  id: number;
  first_name?: string;
  username?: string;
};

export function validateTelegramInitData(
  initData: string,
  botToken: string,
): { ok: true; user: TelegramUser } | { ok: false; reason: string } {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return { ok: false, reason: "missing_hash" };

    const pairs: [string, string][] = [];
    for (const [k, v] of params.entries()) {
      if (k === "hash") continue;
      pairs.push([k, v]);
    }
    pairs.sort(([a], [b]) => a.localeCompare(b));
    const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");

    const secretKey = createHmac("sha256", "WebAppData")
      .update(botToken)
      .digest();
    const calculated = createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    const a = Buffer.from(calculated, "hex");
    const b = Buffer.from(hash, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: "bad_hash" };
    }

    const authDate = params.get("auth_date");
    if (authDate) {
      const ts = Number(authDate) * 1000;
      const maxAgeMs = 24 * 60 * 60 * 1000;
      if (Date.now() - ts > maxAgeMs) return { ok: false, reason: "expired" };
    }

    const userJson = params.get("user");
    if (!userJson) return { ok: false, reason: "missing_user" };
    const user = JSON.parse(userJson) as TelegramUser;
    if (typeof user.id !== "number") return { ok: false, reason: "bad_user" };

    return { ok: true, user };
  } catch {
    return { ok: false, reason: "parse_error" };
  }
}
