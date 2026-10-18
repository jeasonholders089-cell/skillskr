import { get, run } from "../db.ts";
import { newEmailTokenId, newOauthAccountId, newUserId } from "../lib/ids.ts";
import { generateToken, hashPassword, hashToken, verifyPassword } from "../lib/secrets.ts";
import { nowIso } from "../lib/http.ts";

export interface UserRow {
  id: string;
  email: string;
  email_verified_at: string | null;
  password_hash: string | null;
  name: string | null;
  avatar_url: string | null;
  locale: string | null;
  is_disabled: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
  hasPassword: boolean;
  createdAt: string;
}

export function toPublicUser(user: UserRow): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatar_url,
    emailVerified: Boolean(user.email_verified_at),
    hasPassword: Boolean(user.password_hash),
    createdAt: user.created_at,
  };
}

export function findUserByEmail(email: string): UserRow | undefined {
  return get<UserRow>("SELECT * FROM users WHERE email = ?", email.toLowerCase());
}

export function findUserById(id: string): UserRow | undefined {
  return get<UserRow>("SELECT * FROM users WHERE id = ?", id);
}

export function createUser(input: {
  email: string;
  password?: string;
  name?: string | null;
  avatarUrl?: string | null;
  emailVerified?: boolean;
  locale?: string | null;
}): UserRow {
  const id = newUserId();
  const ts = nowIso();
  run(
    `INSERT INTO users (id, email, email_verified_at, password_hash, name, avatar_url, locale, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.email.toLowerCase(),
    input.emailVerified ? ts : null,
    input.password ? hashPassword(input.password) : null,
    input.name ?? null,
    input.avatarUrl ?? null,
    input.locale ?? null,
    ts,
    ts
  );
  return findUserById(id)!;
}

export function touchLastLogin(userId: string): void {
  run("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), userId);
}

export function markEmailVerified(userId: string): void {
  const ts = nowIso();
  run("UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?", ts, ts, userId);
}

export function setPassword(userId: string, password: string): void {
  run(
    "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
    hashPassword(password),
    nowIso(),
    userId
  );
}

export function checkPassword(user: UserRow, password: string): boolean {
  return verifyPassword(password, user.password_hash);
}

/* ------------------------------------------------------------ oauth links */

export interface OauthAccountRow {
  id: string;
  user_id: string;
  provider: string;
  provider_account_id: string;
  email: string | null;
  profile_json: string | null;
  created_at: string;
}

export function findOauthAccount(
  provider: string,
  providerAccountId: string
): OauthAccountRow | undefined {
  return get<OauthAccountRow>(
    "SELECT * FROM oauth_accounts WHERE provider = ? AND provider_account_id = ?",
    provider,
    providerAccountId
  );
}

export function linkOauthAccount(input: {
  userId: string;
  provider: string;
  providerAccountId: string;
  email?: string | null;
  profile?: unknown;
}): void {
  run(
    `INSERT INTO oauth_accounts (id, user_id, provider, provider_account_id, email, profile_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (provider, provider_account_id) DO UPDATE SET
       email = excluded.email,
       profile_json = excluded.profile_json`,
    newOauthAccountId(),
    input.userId,
    input.provider,
    input.providerAccountId,
    input.email ?? null,
    input.profile ? JSON.stringify(input.profile) : null,
    nowIso()
  );
}

/* ------------------------------------------------------------ email tokens */

export type EmailTokenKind = "verify_email" | "reset_password";

/** Returns the plaintext token; only its hash is stored. */
export function issueEmailToken(
  userId: string,
  kind: EmailTokenKind,
  ttlMinutes = 60
): string {
  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  run(
    "INSERT INTO email_tokens (id, user_id, kind, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    newEmailTokenId(),
    userId,
    kind,
    hashToken(token),
    expiresAt,
    nowIso()
  );
  return token;
}

export function consumeEmailToken(token: string, kind: EmailTokenKind): string | null {
  const row = get<{ id: string; user_id: string; expires_at: string; consumed_at: string | null }>(
    "SELECT * FROM email_tokens WHERE token_hash = ? AND kind = ?",
    hashToken(token),
    kind
  );
  if (!row || row.consumed_at) return null;
  if (Date.parse(row.expires_at) < Date.now()) return null;
  run("UPDATE email_tokens SET consumed_at = ? WHERE id = ?", nowIso(), row.id);
  return row.user_id;
}

/** Housekeeping: drop tokens and oauth states that can no longer be used. */
export function purgeExpiredTokens(): void {
  const ts = nowIso();
  run("DELETE FROM email_tokens WHERE expires_at < ?", ts);
  run("DELETE FROM oauth_states WHERE expires_at < ?", ts);
  run("DELETE FROM sessions WHERE expires_at < ?", ts);
}

export function countUsers(): number {
  const row = get<{ n: number }>("SELECT COUNT(*) AS n FROM users");
  return row?.n ?? 0;
}
