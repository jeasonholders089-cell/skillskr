import { all, get, run } from "../db.ts";
import { newInviteId, newMembershipId, newTenantId, slugify } from "../lib/ids.ts";
import { generateToken, hashToken } from "../lib/secrets.ts";
import { nowIso } from "../lib/http.ts";

export type Role = "owner" | "admin" | "member";

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  is_personal: number;
  billing_email: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface MembershipRow {
  id: string;
  tenant_id: string;
  user_id: string;
  role: Role;
  created_at: string;
  updated_at: string;
}

export interface PublicTenant {
  id: string;
  slug: string;
  name: string;
  isPersonal: boolean;
  role: Role;
  createdAt: string;
}

export interface TenantMember {
  userId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: Role;
  joinedAt: string;
}

export function createTenant(input: {
  name: string;
  createdBy: string;
  isPersonal?: boolean;
  billingEmail?: string | null;
}): TenantRow {
  const id = newTenantId();
  const ts = nowIso();
  run(
    `INSERT INTO tenants (id, slug, name, is_personal, billing_email, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    slugify(input.name),
    input.name,
    input.isPersonal ? 1 : 0,
    input.billingEmail ?? null,
    input.createdBy,
    ts,
    ts
  );
  return findTenant(id)!;
}

/**
 * Create a workspace and make `userId` its owner, in one transaction.
 *
 * Both signup paths need this (password registration and first Google sign-in).
 * Keeping it in one place is deliberate: creating a tenant without the matching
 * membership row leaves the user with no active workspace, which is exactly the
 * bug this helper exists to prevent.
 */
export function createWorkspaceForOwner(input: {
  name: string;
  userId: string;
  email?: string | null;
  isPersonal?: boolean;
}): TenantRow {
  const tenant = createTenant({
    name: input.name,
    createdBy: input.userId,
    isPersonal: input.isPersonal ?? false,
    billingEmail: input.email ?? null,
  });
  addMembership(tenant.id, input.userId, "owner");
  return tenant;
}

/** Default workspace name for a brand-new account. */
export function defaultWorkspaceName(name: string | null | undefined, email: string): string {
  if (name && name.trim()) return `${name.trim()}'s workspace`;
  return `${email.split("@")[0]}'s workspace`;
}

export function findTenant(id: string): TenantRow | undefined {
  return get<TenantRow>("SELECT * FROM tenants WHERE id = ? AND deleted_at IS NULL", id);
}

export function updateTenant(
  id: string,
  patch: { name?: string; billingEmail?: string | null }
): TenantRow | undefined {
  const current = findTenant(id);
  if (!current) return undefined;
  run(
    "UPDATE tenants SET name = ?, billing_email = ?, updated_at = ? WHERE id = ?",
    patch.name ?? current.name,
    patch.billingEmail === undefined ? current.billing_email : patch.billingEmail,
    nowIso(),
    id
  );
  return findTenant(id);
}

export function softDeleteTenant(id: string): void {
  const ts = nowIso();
  run("UPDATE tenants SET deleted_at = ?, updated_at = ? WHERE id = ?", ts, ts, id);
}

/* -------------------------------------------------------------- membership */

export function addMembership(tenantId: string, userId: string, role: Role): MembershipRow {
  const id = newMembershipId();
  const ts = nowIso();
  run(
    `INSERT INTO memberships (id, tenant_id, user_id, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at`,
    id,
    tenantId,
    userId,
    role,
    ts,
    ts
  );
  return get<MembershipRow>(
    "SELECT * FROM memberships WHERE tenant_id = ? AND user_id = ?",
    tenantId,
    userId
  )!;
}

export function findMembership(tenantId: string, userId: string): MembershipRow | undefined {
  return get<MembershipRow>(
    "SELECT * FROM memberships WHERE tenant_id = ? AND user_id = ?",
    tenantId,
    userId
  );
}

export function membershipsForUser(userId: string): Array<MembershipRow & TenantRow> {
  return all<MembershipRow & TenantRow>(
    `SELECT m.id AS membership_id, m.role AS role, t.*
       FROM memberships m
       JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = ? AND t.deleted_at IS NULL
      ORDER BY t.created_at ASC`,
    userId
  );
}

export function membersOfTenant(tenantId: string): TenantMember[] {
  const rows = all<{
    user_id: string;
    email: string;
    name: string | null;
    avatar_url: string | null;
    role: Role;
    created_at: string;
  }>(
    `SELECT m.user_id, u.email, u.name, u.avatar_url, m.role, m.created_at
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = ?
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.created_at ASC`,
    tenantId
  );
  return rows.map((row) => ({
    userId: row.user_id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    role: row.role,
    joinedAt: row.created_at,
  }));
}

export function memberCount(tenantId: string): number {
  return get<{ n: number }>("SELECT COUNT(*) AS n FROM memberships WHERE tenant_id = ?", tenantId)?.n ?? 0;
}

export function countOwners(tenantId: string): number {
  return (
    get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM memberships WHERE tenant_id = ? AND role = 'owner'",
      tenantId
    )?.n ?? 0
  );
}

export function removeMembership(tenantId: string, userId: string): void {
  run("DELETE FROM memberships WHERE tenant_id = ? AND user_id = ?", tenantId, userId);
}

/* ------------------------------------------------------------------ invites */

export interface InviteRow {
  id: string;
  tenant_id: string;
  email: string;
  role: Role;
  token_hash: string;
  invited_by: string | null;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  created_at: string;
}

/** Returns the plaintext invite token, embedded in the invite link. */
export function createInvite(input: {
  tenantId: string;
  email: string;
  role: "admin" | "member";
  invitedBy: string;
  ttlDays?: number;
}): { invite: InviteRow; token: string } {
  const token = generateToken(32);
  const id = newInviteId();
  const ts = nowIso();
  const expiresAt = new Date(Date.now() + (input.ttlDays ?? 7) * 86_400_000).toISOString();
  run(
    `INSERT INTO invites (id, tenant_id, email, role, token_hash, invited_by, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.tenantId,
    input.email.toLowerCase(),
    input.role,
    hashToken(token),
    input.invitedBy,
    expiresAt,
    ts
  );
  return { invite: get<InviteRow>("SELECT * FROM invites WHERE id = ?", id)!, token };
}

export function findInviteByToken(token: string): InviteRow | undefined {
  return get<InviteRow>("SELECT * FROM invites WHERE token_hash = ?", hashToken(token));
}

export function acceptInvite(inviteId: string, userId: string): void {
  run(
    "UPDATE invites SET accepted_at = ?, accepted_by = ? WHERE id = ?",
    nowIso(),
    userId,
    inviteId
  );
}

export function listPendingInvites(tenantId: string): Array<Omit<InviteRow, "token_hash">> {
  return all<InviteRow>(
    `SELECT * FROM invites
      WHERE tenant_id = ? AND accepted_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC`,
    tenantId,
    nowIso()
  ).map(({ token_hash: _ignored, ...rest }) => rest);
}

export function expiresInDays(value: string): number {
  return Math.max(0, Math.round((Date.parse(value) - Date.now()) / 86_400_000));
}
