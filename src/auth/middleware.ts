import type { NextFunction, Request, Response } from "express";
import { forbidden, unauthorized } from "../lib/errors.ts";
import { findMembership, type Role } from "../repos/tenants.ts";
import { loadAuth, type AuthContext } from "./sessions.ts";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/** Attaches `req.auth` when a valid session cookie is present. Never rejects. */
export function withAuth(req: Request, _res: Response, next: NextFunction): void {
  const ctx = loadAuth(req);
  if (ctx) req.auth = ctx;
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) {
    next(unauthorized());
    return;
  }
  next();
}

/**
 * Requires a signed-in user **and** an active workspace. Multi-tenant safety
 * rule: every tenant-scoped query filters by `req.tenantId`, which is derived
 * from a membership row rather than from anything the client sends.
 */
export function requireTenant(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) {
    next(unauthorized());
    return;
  }
  if (!req.auth.activeTenantId) {
    next(forbidden("You do not belong to a workspace yet."));
    return;
  }

  const headerTenant = req.header("x-tenant-id");
  if (headerTenant && headerTenant !== req.auth.activeTenantId) {
    const membership = findMembership(headerTenant, req.auth.user.id);
    if (!membership) {
      next(forbidden("You are not a member of that workspace."));
      return;
    }
    req.auth = { ...req.auth, activeTenantId: headerTenant, role: membership.role };
  }

  next();
}

export function tenantId(req: Request): string {
  const id = req.auth?.activeTenantId;
  if (!id) throw forbidden("No active workspace.");
  return id;
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const role = req.auth?.role;
    if (!role) {
      next(forbidden("No role on this workspace."));
      return;
    }
    if (!roles.includes(role)) {
      next(forbidden(`This action requires one of: ${roles.join(", ")}.`));
      return;
    }
    next();
  };
}
