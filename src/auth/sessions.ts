import type { Request, Response } from "express";
import { get, run } from "../db.ts";
import { config } from "../config.ts";
import { newSessionId } from "../lib/ids.ts";
import { generateToken, hashToken } from "../lib/secrets.ts";
import { clearCookie, clientIp, cookie, nowIso, setCookie } from "../lib/http.ts";
import { findMembership, findTenant, membershipsForUser, type Role } from "../repos/tenants.ts";
import { findUserById, touchLastLogin, toPublicUser, type PublicUser, type UserRow } from "../repos/users.ts";

export interface SessionRow {
  id: string;
  user_id: string;
  active_tenant_id: string | null;
  token_hash: string;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface AuthContext {
  session: SessionRow;
  user: UserRow;
  activeTenantId: string | null;
  role: Role | null;
}

export function createSession(
  res: Response,
  req: Request,
  userId: string,
  activeTenantId: string | null
): SessionRow {
  const token = generateToken(32);
  const id = newSessionId();
  const ts = nowIso();
  const expiresAt = new Date(Date.now() + config.session.ttlDays * 86_400_000).toISOString();

  run(
    `INSERT INTO sessions (id, user_id, active_tenant_id, token_hash, user_agent, ip,
                           created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    userId,
    activeTenantId,
    hashToken(token),
    req.headers["user-agent"] ?? null,
    clientIp(req),
    ts,
    ts,
    expiresAt
  );

  setCookie(res, config.session.cookieName, token, config.session.ttlDays * 86_400);
  touchLastLogin(userId);
  return get<SessionRow>("SELECT * FROM sessions WHERE id = ?", id)!;
}

export function destroySession(res: Response, sessionId?: string): void {
  if (sessionId) {
    run("UPDATE sessions SET revoked_at = ? WHERE id = ?", nowIso(), sessionId);
  }
  clearCookie(res, config.session.cookieName);
}

export function destroyAllSessionsForUser(userId: string, exceptSessionId?: string): void {
  if (exceptSessionId) {
    run(
      "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL",
      nowIso(),
      userId,
      exceptSessionId
    );
    return;
  }
  run("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", nowIso(), userId);
}

/** Resolve the session cookie into an auth context, or null when not signed in. */
export function loadAuth(req: Request): AuthContext | null {
  const token = cookie(req, config.session.cookieName);
  if (!token) return null;

  const session = get<SessionRow>(
    "SELECT * FROM sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?",
    hashToken(token),
    nowIso()
  );
  if (!session) return null;

  const user = findUserById(session.user_id);
  if (!user || user.is_disabled) return null;

  // The active tenant must still exist and still have a live membership;
  // otherwise fall back to the user's first workspace.
  let activeTenantId = session.active_tenant_id;
  let role: Role | null = null;

  if (activeTenantId) {
    const tenant = findTenant(activeTenantId);
    const membership = tenant ? findMembership(activeTenantId, user.id) : undefined;
    if (tenant && membership) {
      role = membership.role;
    } else {
      activeTenantId = null;
    }
  }

  if (!activeTenantId) {
    const first = membershipsForUser(user.id)[0];
    if (first) {
      activeTenantId = first.id;
      role = first.role as Role;
      switchTenant(session.id, activeTenantId);
    }
  }

  run("UPDATE sessions SET last_seen_at = ? WHERE id = ?", nowIso(), session.id);

  return { session: { ...session, active_tenant_id: activeTenantId }, user, activeTenantId, role };
}

export function switchTenant(sessionId: string, tenantId: string | null): void {
  run("UPDATE sessions SET active_tenant_id = ? WHERE id = ?", tenantId, sessionId);
}

export function authPayload(ctx: AuthContext) {
  const memberships = membershipsForUser(ctx.user.id);
  return {
    user: toPublicUser(ctx.user) satisfies PublicUser,
    activeTenantId: ctx.activeTenantId,
    role: ctx.role,
    tenants: memberships.map((m) => ({
      id: m.id,
      slug: m.slug,
      name: m.name,
      isPersonal: Boolean(m.is_personal),
      role: m.role as Role,
      createdAt: m.created_at,
    })),
  };
}
