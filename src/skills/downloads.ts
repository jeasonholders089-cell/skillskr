import { createHmac, timingSafeEqual } from "node:crypto";
import express, { type Request, type Response } from "express";
import { config } from "../config.ts";
import { audit } from "../lib/audit.ts";
import { forbidden, handler, notFound, unauthorized } from "../lib/errors.ts";
import { clientIp, nowIso } from "../lib/http.ts";
import { id } from "../lib/ids.ts";
import { run } from "../db.ts";
import { requireAuth, requireTenant, tenantId, withAuth } from "../auth/middleware.ts";
import { findSkill } from "../repos/skills.ts";
import { tenantHasAccess } from "../repos/billing.ts";
import { PACK_VERSION, buildPack, packFileName } from "./packs.ts";

const TOKEN_TTL_SECONDS = 15 * 60;

interface DownloadClaims {
  s: string; // skill slug
  t: string; // tenant id
  u: string; // user id
  v: string; // pack version
  e: number; // expiry, epoch seconds
}

function sign(payload: string): string {
  return createHmac("sha256", `${config.session.secret}:download`).update(payload).digest("base64url");
}

function issueToken(claims: DownloadClaims): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf-8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token: string): DownloadClaims | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as DownloadClaims;
    if (typeof claims.e !== "number" || claims.e < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

function packGate(skill: ReturnType<typeof findSkill>, tenant: string) {
  if (!skill) throw notFound("That Skill does not exist.");
  if (skill.free) return;
  const access = tenantHasAccess(tenant);
  if (!access.active) {
    throw forbidden(
      "This is a Pro Skill. Activate a subscription on this workspace to download it."
    );
  }
}

export const downloadRouter = express.Router();
downloadRouter.use(withAuth);

/** Issue a short-lived, signed download URL after checking entitlement. */
downloadRouter.post(
  "/api/skills/:slug/download",
  requireAuth,
  requireTenant,
  handler((req: Request, res: Response) => {
    const tenant = tenantId(req);
    const skill = findSkill(req.params.slug);
    packGate(skill, tenant);

    const expiresAt = Date.now() + TOKEN_TTL_SECONDS * 1000;
    const token = issueToken({
      s: skill!.slug,
      t: tenant,
      u: req.auth!.user.id,
      v: PACK_VERSION,
      e: Math.floor(expiresAt / 1000),
    });

    audit({
      tenantId: tenant,
      actorUserId: req.auth!.user.id,
      action: "skill.download_ticket",
      targetType: "skill",
      targetId: skill!.slug,
      ip: clientIp(req),
    });

    res.status(201).json({
      url: `/api/downloads/${token}`,
      filename: packFileName(skill!),
      version: PACK_VERSION,
      expiresAt: new Date(expiresAt).toISOString(),
    });
  })
);

/** Stream the pack. The signature is the authority; entitlement is re-checked. */
downloadRouter.get(
  "/api/downloads/:token",
  handler((req: Request, res: Response) => {
    const claims = verifyToken(req.params.token);
    if (!claims) throw unauthorized("This download link is invalid or has expired.");

    const skill = findSkill(claims.s);
    packGate(skill, claims.t);

    const { buffer, authored } = buildPack(skill!);
    const ts = nowIso();

    run(
      `INSERT INTO skill_downloads (id, tenant_id, user_id, skill_slug, version, authored, ip, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id("DLD"),
      claims.t,
      claims.u,
      claims.s,
      claims.v,
      authored ? 1 : 0,
      clientIp(req),
      req.headers["user-agent"] ?? null,
      ts
    );
    run("UPDATE skills SET installs = installs + 1, updated_at = ? WHERE slug = ?", ts, claims.s);

    audit({
      tenantId: claims.t,
      actorUserId: claims.u,
      action: "skill.downloaded",
      targetType: "skill",
      targetId: claims.s,
      metadata: { version: claims.v, authored, bytes: buffer.length },
      ip: clientIp(req),
    });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${packFileName(skill!)}"`);
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Cache-Control", "no-store");
    res.send(buffer);
  })
);
