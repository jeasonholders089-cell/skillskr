import { randomBytes, randomInt } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Cryptographically random base62 string of `length` characters. */
export function base62(length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return out;
}

/**
 * Prefixed identifier, matching the shape Waffo Pancake uses
 * (`USR_x`, `TNT_x`, ...) so IDs are self-describing in logs and support tickets.
 */
export function id(prefix: string, length = 20): string {
  return `${prefix}_${base62(length)}`;
}

export const newUserId = () => id("USR");
export const newTenantId = () => id("TNT");
export const newMembershipId = () => id("MEM");
export const newSessionId = () => id("SES");
export const newInviteId = () => id("INV");
export const newEmailTokenId = () => id("ETK");
export const newSubscriptionId = () => id("SUB");
export const newPaymentId = () => id("PAY");
export const newAuditId = () => id("AUD");
export const newOauthAccountId = () => id("OAC");

/** URL-safe slug derived from a display name, with a random suffix for uniqueness. */
export function slugify(value: string, suffixLength = 6): string {
  const base = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const tail = base62(suffixLength).toLowerCase();
  return base ? `${base}-${tail}` : `workspace-${tail}`;
}

/** Random hex string, for opaque non-secret values. */
export function hex(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}
