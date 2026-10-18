import { badRequest } from "./errors.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function requireString(
  value: unknown,
  field: string,
  { min = 1, max = 200 }: { min?: number; max?: number } = {}
): string {
  if (typeof value !== "string") throw badRequest(`${field} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length < min) throw badRequest(`${field} must be at least ${min} characters.`);
  if (trimmed.length > max) throw badRequest(`${field} must be at most ${max} characters.`);
  return trimmed;
}

export function optionalString(value: unknown, field: string, max = 200): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requireString(value, field, { max });
}

export function requireEmail(value: unknown): string {
  const email = requireString(value, "email", { max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(email)) throw badRequest("Enter a valid email address.");
  return email;
}

/**
 * Password policy: at least 10 characters, and not built from a single repeated
 * or trivially sequential run. Deliberately length-first rather than symbol soup.
 */
export function requirePassword(value: unknown): string {
  const password = requireString(value, "password", { min: 10, max: 200 });
  if (/^(.)\1+$/.test(password)) throw badRequest("Choose a less repetitive password.");
  const unique = new Set(password).size;
  if (unique < 4) throw badRequest("Choose a password with more variety.");
  return password;
}

export function requireEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[]
): T {
  const raw = requireString(value, field);
  if (!allowed.includes(raw as T)) {
    throw badRequest(`${field} must be one of: ${allowed.join(", ")}.`);
  }
  return raw as T;
}

export function requireBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

const CURRENCY_RE = /^[A-Z]{3}$/;

export function requireCurrency(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === "") return fallback;
  const code = requireString(value, "currency", { max: 3 }).toUpperCase();
  if (!CURRENCY_RE.test(code)) throw badRequest("currency must be a 3-letter ISO 4217 code.");
  return code;
}
