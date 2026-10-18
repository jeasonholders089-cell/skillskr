import express, { type Request, type Response } from "express";
import { config } from "../config.ts";
import { transaction } from "../db.ts";
import { audit } from "../lib/audit.ts";
import { badRequest, conflict, handler, unauthorized } from "../lib/errors.ts";
import { clientIp } from "../lib/http.ts";
import { invitationAccepted, passwordResetMail, verificationMail } from "../lib/mailer.ts";
import {
  optionalString,
  requireBody,
  requireEmail,
  requirePassword,
  requireString,
} from "../lib/validate.ts";
import {
  acceptInvite,
  addMembership,
  createTenant,
  createWorkspaceForOwner,
  defaultWorkspaceName,
  findTenant,
  findInviteByToken,
  findMembership,
  membershipsForUser,
} from "../repos/tenants.ts";
import {
  checkPassword,
  consumeEmailToken,
  createUser,
  findUserByEmail,
  findUserById,
  issueEmailToken,
  markEmailVerified,
  setPassword,
  toPublicUser,
} from "../repos/users.ts";
import { requireAuth, withAuth } from "./middleware.ts";
import { authPayload, createSession, destroyAllSessionsForUser, destroySession, switchTenant } from "./sessions.ts";

export const authRouter = express.Router();
authRouter.use(withAuth);

/* ------------------------------------------------------------------ signup */

authRouter.post(
  "/auth/register",
  handler((req: Request, res: Response) => {
    const body = requireBody(req.body);
    const email = requireEmail(body.email);
    const password = requirePassword(body.password);
    const name = optionalString(body.name, "name", 120) ?? null;
    const workspaceName = optionalString(body.workspaceName, "workspaceName", 120);
    const inviteToken = optionalString(body.inviteToken, "inviteToken", 200);

    if (findUserByEmail(email)) {
      throw conflict("An account with that email already exists.");
    }

    const { user, verificationToken } = transaction(() => {
      const created = createUser({ email, password, name, emailVerified: false });
      let token: string | null = null;

      const invite = inviteToken ? findInviteByToken(inviteToken) : undefined;
      if (invite && !invite.accepted_at && Date.parse(invite.expires_at) > Date.now()) {
        addMembership(invite.tenant_id, created.id, invite.role);
        acceptInvite(invite.id, created.id);
      } else {
        createWorkspaceForOwner({
          name: workspaceName ?? defaultWorkspaceName(name, email),
          userId: created.id,
          email,
          isPersonal: !workspaceName,
        });
      }
      token = issueEmailToken(created.id, "verify_email", 60);
      return { user: created, verificationToken: token };
    });

    const mail = verificationMail(email, verificationToken, name);
    createSession(res, req, user.id, membershipsForUser(user.id)[0]?.id ?? null);
    audit({
      actorUserId: user.id,
      action: "auth.register",
      targetType: "user",
      targetId: user.id,
      ip: clientIp(req),
      metadata: { invited: Boolean(inviteToken) },
    });

    res.status(201).json({
      user: toPublicUser(user),
      verificationSent: true,
      // In development the link is returned so the flow is testable without SMTP.
      devVerificationUrl: config.isProduction ? undefined : mail.actionUrl,
    });
  })
);

/* ------------------------------------------------------------------- login */

authRouter.post(
  "/auth/login",
  handler((req: Request, res: Response) => {
    const body = requireBody(req.body);
    const email = requireEmail(body.email);
    const password = requireString(body.password, "password", { max: 200 });

    const user = findUserByEmail(email);
    // Same message for unknown email and wrong password: no account enumeration.
    if (!user || !checkPassword(user, password)) {
      audit({
        action: "auth.login.failed",
        targetType: "email",
        targetId: email,
        ip: clientIp(req),
      });
      throw unauthorized("Email or password is incorrect.");
    }
    if (user.is_disabled) throw unauthorized("This account is disabled.");

    createSession(res, req, user.id, membershipsForUser(user.id)[0]?.id ?? null);
    audit({
      actorUserId: user.id,
      action: "auth.login.password",
      ip: clientIp(req),
    });
    res.json({ user: toPublicUser(user) });
  })
);

/* ------------------------------------------------------------------ logout */

authRouter.post(
  "/auth/logout",
  handler((req: Request, res: Response) => {
    if (req.auth) {
      audit({ actorUserId: req.auth.user.id, action: "auth.logout", ip: clientIp(req) });
      destroySession(res, req.auth.session.id);
    }
    res.json({ ok: true });
  })
);

authRouter.post(
  "/auth/logout-all",
  requireAuth,
  handler((req: Request, res: Response) => {
    destroyAllSessionsForUser(req.auth!.user.id, req.auth!.session.id);
    audit({ actorUserId: req.auth!.user.id, action: "auth.logout_all", ip: clientIp(req) });
    res.json({ ok: true });
  })
);

/* --------------------------------------------------------------------- me  */

authRouter.get(
  "/auth/me",
  handler((req: Request, res: Response) => {
    if (!req.auth) {
      res.json({ user: null, tenants: [], activeTenantId: null, role: null });
      return;
    }
    res.json(authPayload(req.auth));
  })
);

/* ---------------------------------------------------------- active tenant  */

authRouter.post(
  "/auth/active-tenant",
  requireAuth,
  handler((req: Request, res: Response) => {
    const body = requireBody(req.body);
    const target = requireString(body.tenantId, "tenantId", { max: 64 });
    const membership = findMembership(target, req.auth!.user.id);
    if (!membership) throw badRequest("You are not a member of that workspace.");
    switchTenant(req.auth!.session.id, target);
    req.auth = { ...req.auth!, activeTenantId: target, role: membership.role };
    res.json(authPayload(req.auth));
  })
);

/* --------------------------------------------------------- email verification */

authRouter.post(
  "/auth/verify-email",
  handler((req: Request, res: Response) => {
    const body = requireBody(req.body);
    const token = requireString(body.token, "token", { max: 200 });
    const userId = consumeEmailToken(token, "verify_email");
    if (!userId) throw badRequest("This verification link is invalid or has expired.");
    markEmailVerified(userId);
    audit({ actorUserId: userId, action: "auth.email_verified", ip: clientIp(req) });
    res.json({ ok: true });
  })
);

authRouter.post(
  "/auth/resend-verification",
  handler((req: Request, res: Response) => {
    const body = requireBody(req.body);
    const email = requireEmail(body.email);
    const user = findUserByEmail(email);
    // Always answer 200 so the endpoint cannot be used to probe for accounts.
    if (user && !user.email_verified_at) {
      const token = issueEmailToken(user.id, "verify_email", 60);
      const mail = verificationMail(user.email, token, user.name);
      res.json({ ok: true, devVerificationUrl: config.isProduction ? undefined : mail.actionUrl });
      return;
    }
    res.json({ ok: true });
  })
);

/* ------------------------------------------------------------- password reset */

authRouter.post(
  "/auth/forgot-password",
  handler((req: Request, res: Response) => {
    const body = requireBody(req.body);
    const email = requireEmail(body.email);
    const user = findUserByEmail(email);
    if (!user) {
      res.json({ ok: true });
      return;
    }
    const token = issueEmailToken(user.id, "reset_password", 60);
    const mail = passwordResetMail(email, token);
    audit({ actorUserId: user.id, action: "auth.password_reset_requested", ip: clientIp(req) });
    res.json({ ok: true, devResetUrl: config.isProduction ? undefined : mail.actionUrl });
  })
);

authRouter.post(
  "/auth/reset-password",
  handler((req: Request, res: Response) => {
    const body = requireBody(req.body);
    const token = requireString(body.token, "token", { max: 200 });
    const password = requirePassword(body.password);
    const userId = consumeEmailToken(token, "reset_password");
    if (!userId) throw badRequest("This reset link is invalid or has expired.");
    setPassword(userId, password);
    // Any stolen session stops working once the password rotates.
    destroyAllSessionsForUser(userId);
    audit({ actorUserId: userId, action: "auth.password_reset", ip: clientIp(req) });
    res.json({ ok: true });
  })
);

/* ----------------------------------------------------------------- invites --- */

authRouter.post(
  "/auth/accept-invite",
  requireAuth,
  handler((req: Request, res: Response) => {
    const body = requireBody(req.body);
    const token = requireString(body.token, "token", { max: 200 });
    const invite = findInviteByToken(token);
    if (!invite) throw badRequest("This invitation is invalid.");
    if (invite.accepted_at) throw conflict("This invitation has already been used.");
    if (Date.parse(invite.expires_at) < Date.now()) throw badRequest("This invitation has expired.");

    const user = req.auth!.user;
    if (invite.email !== user.email) {
      throw badRequest(`This invitation was issued to ${invite.email}.`);
    }
    if (findMembership(invite.tenant_id, user.id)) {
      throw conflict("You are already a member of this workspace.");
    }

    addMembership(invite.tenant_id, user.id, invite.role);
    acceptInvite(invite.id, user.id);
    switchTenant(req.auth!.session.id, invite.tenant_id);
    const tenantName = findTenant(invite.tenant_id)?.name ?? "the workspace";

    audit({
      tenantId: invite.tenant_id,
      actorUserId: user.id,
      action: "tenant.invite_accepted",
      targetType: "tenant",
      targetId: invite.tenant_id,
      ip: clientIp(req),
    });
    invitationAccepted(invite.invited_by, user.email, tenantName);

    res.json({ ok: true, tenantId: invite.tenant_id });
  })
);
