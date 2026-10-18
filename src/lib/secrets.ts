import {
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { config } from "../config.ts";

/* --------------------------------------------------------------- passwords */

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * Hash a password with scrypt. Format:
 *   scrypt$N$r$p$salt$hash     (salt and hash are base64url)
 * Parameters live in the string so the cost can be raised later without
 * invalidating existing hashes.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const derived = scryptSync(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 128 * SCRYPT_N * SCRYPT_R * 2,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, "base64url");
  const expected = Buffer.from(hashB64, "base64url");

  let derived: Buffer;
  try {
    derived = scryptSync(password.normalize("NFKC"), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 256 * Number(n) * Number(r),
    });
  } catch {
    return false;
  }
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/* ------------------------------------------------------------------ tokens */

/** Opaque, URL-safe token. The plaintext is only ever sent to the client. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** What we persist for a token: sha256 hex. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/* --------------------------------------------------------------- signing  */

/** Keyed digest used for OAuth `state` values. */
export function sign(value: string): string {
  return createHmac("sha256", config.session.secret).update(value).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** PKCE code verifier / challenge pair (S256). */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
