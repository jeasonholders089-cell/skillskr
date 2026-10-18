import express, { type Request, type Response } from "express";
import { audit } from "../lib/audit.ts";
import { badRequest, conflict, forbidden, handler, notFound } from "../lib/errors.ts";
import { clientIp } from "../lib/http.ts";
import { inviteMail } from "../lib/mailer.ts";
import { optionalString, requireBody, requireEmail, requireEnum, requireString } from "../lib/validate.ts";
import {
  addMembership,
  countOwners,
  createInvite,
  createTenant,
  findMembership,
  findTenant,
  listPendingInvites,
  memberCount,
  membersOfTenant,
  removeMembership,
  softDeleteTenant,
  updateTenant,
  type Role,
} from "../repos/tenants.ts";
import { findUserByEmail } from "../repos/users.ts";
import { requireAuth, requireRole, requireTenant, tenantId, withAuth } from "../auth/middleware.ts";
import { authPayload, switchTenant } from "../auth/sessions.ts";

export const tenantRouter = express.Router();
tenantRouter.use(withAuth);

/* ------------------------------------------------------------------ tenants */

tenantRouter.get(
  "/tenants",
  requireAuth,
  handler((req: Request, res: Response) => {
    res.json(authPayload(req.auth!));
  })
);

tenantRouter.post(
  "/tenants",
  requireAuth,
  handler((req: Request, res: Response) => {
    const body = requireBody(req.body);
    const name = requireString(body.name, "name", { min: 2, max: 120 });
    const billingEmail = body.billingEmail ? requireEmail(body.billingEmail) : req.auth!.user.email;

    const tenant = createTenant({
      name,
      createdBy: req.auth!.user.id,
      billingEmail,
      isPersonal: false,
    });
    addMembership(tenant.id, req.auth!.user.id, "owner");
    switchTenant(req.auth!.session.id, tenant.id);

    audit({
      tenantId: tenant.id,
      actorUserId: req.auth!.user.id,
      action: "tenant.created",
      targetType: "tenant",
      targetId: tenant.id,
      ip: clientIp(req),
    });

    res.status(201).json({ tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, role: "owner" } });
  })
);

tenantRouter.get(
  "/tenants/current",
  requireAuth,
  requireTenant,
  handler((req: Request, res: Response) => {
    const id = tenantId(req);
    const tenant = findTenant(id);
    if (!tenant) throw notFound("Workspace not found.");
    res.json({
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        isPersonal: Boolean(tenant.is_personal),
        billingEmail: tenant.billing_email,
        role: req.auth!.role,
        memberCount: memberCount(id),
        createdAt: tenant.created_at,
      },
    });
  })
);

tenantRouter.patch(
  "/tenants/current",
  requireAuth,
  requireTenant,
  requireRole("owner", "admin"),
  handler((req: Request, res: Response) => {
    const body = requireBody(req.body);
    const name = optionalString(body.name, "name", 120);
    const billingEmail = body.billingEmail ? requireEmail(body.billingEmail) : undefined;
    const id = tenantId(req);

    const updated = updateTenant(id, { name, billingEmail });
    if (!updated) throw notFound("Workspace not found.");

    audit({
      tenantId: id,
      actorUserId: req.auth!.user.id,
      action: "tenant.updated",
      targetType: "tenant",
      targetId: id,
      metadata: { name, billingEmail },
      ip: clientIp(req),
    });
    res.json({ tenant: { id: updated.id, name: updated.name, billingEmail: updated.billing_email } });
  })
);

tenantRouter.delete(
  "/tenants/current",
  requireAuth,
  requireTenant,
  requireRole("owner"),
  handler((req: Request, res: Response) => {
    const id = tenantId(req);
    const tenant = findTenant(id);
    if (!tenant) throw notFound("Workspace not found.");
    if (tenant.is_personal) {
      throw badRequest("The personal workspace cannot be deleted.");
    }

    softDeleteTenant(id);
    audit({
      tenantId: id,
      actorUserId: req.auth!.user.id,
      action: "tenant.deleted",
      targetType: "tenant",
      targetId: id,
      ip: clientIp(req),
    });

    // Move the caller to another workspace if they have one.
    const remaining = authPayload(req.auth!).tenants.filter((t) => t.id !== id);
    switchTenant(req.auth!.session.id, remaining[0]?.id ?? null);
    res.json({ ok: true, activeTenantId: remaining[0]?.id ?? null });
  })
);

/* ------------------------------------------------------------------ members */

tenantRouter.get(
  "/tenants/current/members",
  requireAuth,
  requireTenant,
  handler((req: Request, res: Response) => {
    const id = tenantId(req);
    res.json({ members: membersOfTenant(id), invites: listPendingInvites(id) });
  })
);

tenantRouter.post(
  "/tenants/current/invites",
  requireAuth,
  requireTenant,
  requireRole("owner", "admin"),
  handler((req: Request, res: Response) => {
    const body = requireBody(req.body);
    const email = requireEmail(body.email);
    const role = requireEnum<"admin" | "member">(body.role ?? "member", "role", ["admin", "member"]);
    const id = tenantId(req);
    const tenant = findTenant(id);
    if (!tenant) throw notFound("Workspace not found.");

    // Only owners may mint another owner-tier admin.
    if (role === "admin" && req.auth!.role !== "owner") {
      throw forbidden("Only the workspace owner can invite admins.");
    }

    const existingUser = findUserByEmail(email);
    if (existingUser && findMembership(id, existingUser.id)) {
      throw conflict("That person is already a member of this workspace.");
    }

    const { invite, token } = createInvite({
      tenantId: id,
      email,
      role,
      invitedBy: req.auth!.user.id,
    });
    const mail = inviteMail({
      to: email,
      token,
      tenantName: tenant.name,
      invitedByEmail: req.auth!.user.email,
      role,
    });

    audit({
      tenantId: id,
      actorUserId: req.auth!.user.id,
      action: "tenant.invite_created",
      targetType: "invite",
      targetId: invite.id,
      metadata: { email, role },
      ip: clientIp(req),
    });

    res.status(201).json({
      invite: { id: invite.id, email, role, expiresAt: invite.expires_at },
      devInviteUrl: mail.actionUrl,
    });
  })
);

tenantRouter.patch(
  "/tenants/current/members/:userId",
  requireAuth,
  requireTenant,
  requireRole("owner"),
  handler((req: Request, res: Response) => {
    const body = requireBody(req.body);
    const role = requireEnum<Role>(body.role, "role", ["owner", "admin", "member"]);
    const id = tenantId(req);
    const targetUserId = req.params.userId;

    const membership = findMembership(id, targetUserId);
    if (!membership) throw notFound("That user is not a member of this workspace.");

    // Never let the last owner demote themselves and orphan the workspace.
    if (membership.role === "owner" && role !== "owner" && countOwners(id) <= 1) {
      throw conflict("The workspace must keep at least one owner.");
    }

    addMembership(id, targetUserId, role);
    audit({
      tenantId: id,
      actorUserId: req.auth!.user.id,
      action: "tenant.member_role_changed",
      targetType: "user",
      targetId: targetUserId,
      metadata: { from: membership.role, to: role },
      ip: clientIp(req),
    });
    res.json({ ok: true, role });
  })
);

tenantRouter.delete(
  "/tenants/current/members/:userId",
  requireAuth,
  requireTenant,
  requireRole("owner", "admin"),
  handler((req: Request, res: Response) => {
    const id = tenantId(req);
    const targetUserId = req.params.userId;
    const membership = findMembership(id, targetUserId);
    if (!membership) throw notFound("That user is not a member of this workspace.");

    if (membership.role === "owner") throw forbidden("An owner cannot be removed.");
    if (req.auth!.role === "admin" && membership.role === "admin") {
      throw forbidden("Only an owner can remove an admin.");
    }

    removeMembership(id, targetUserId);
    audit({
      tenantId: id,
      actorUserId: req.auth!.user.id,
      action: "tenant.member_removed",
      targetType: "user",
      targetId: targetUserId,
      ip: clientIp(req),
    });
    res.json({ ok: true });
  })
);
