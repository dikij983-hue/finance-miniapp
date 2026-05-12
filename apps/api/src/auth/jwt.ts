import { SignJWT, jwtVerify } from "jose";

const alg = "HS256";

function key(secret: string) {
  return new TextEncoder().encode(secret);
}

export async function signUserToken(
  userId: string,
  jwtSecret: string,
  expiresIn = "30d",
) {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key(jwtSecret));
}

export async function verifyUserToken(
  token: string,
  jwtSecret: string,
): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, key(jwtSecret), {
      algorithms: [alg],
    });
    const sub = payload.sub;
    if (typeof sub !== "string") return null;
    return { userId: sub };
  } catch {
    return null;
  }
}
