import express, { type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handler, notFound } from "../lib/errors.ts";
import { listSkills, findSkill, OUTPUTS } from "../repos/skills.ts";
import { tenantHasAccess } from "../repos/billing.ts";
import { withAuth } from "../auth/middleware.ts";
import { skillsPage, skillDetailPage } from "./pages.ts";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "..", "..", "public");

export const webRouter = express.Router();
webRouter.use(withAuth);

/* ------------------------------------------------------------------ pages -- */

webRouter.get(
  "/skills",
  handler((req: Request, res: Response) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : undefined;
    const output = typeof req.query.output === "string" ? req.query.output : undefined;
    const free = req.query.free === "1" || req.query.free === "true";
    const validOutput = OUTPUTS.includes(output as never) ? output : undefined;

    const { skills, total } = listSkills({
      q: q || undefined,
      output: validOutput,
      free,
      limit: 120,
    });

    res.type("html").send(
      skillsPage({ skills, total, query: { q: q || undefined, output: validOutput, free } })
    );
  })
);

webRouter.get(
  "/skills/:slug",
  handler((req: Request, res: Response) => {
    const skill = findSkill(req.params.slug);
    if (!skill) throw notFound("That Skill does not exist.");

    const entitlements = req.auth?.activeTenantId
      ? tenantHasAccess(req.auth.activeTenantId)
      : { active: false, planCode: null, status: null, reason: "signed_out", expiresAt: null };

    const related = listSkills({ output: skill.output, limit: 8 }).skills.filter(
      (item) => item.slug !== skill.slug
    ).slice(0, 4);

    res.type("html").send(
      skillDetailPage({
        skill,
        related,
        entitlements: { active: entitlements.active, planCode: entitlements.planCode ?? null },
        signedIn: Boolean(req.auth),
      })
    );
  })
);

webRouter.get("/pricing", (_req: Request, res: Response) => {
  res.redirect(302, "/#pricing");
});

webRouter.get("/dev", (_req: Request, res: Response) => {
  const file = join(publicDir, "dev.html");
  if (!existsSync(file)) {
    res.status(404).send("Dev console not found");
    return;
  }
  res.sendFile(file);
});

/* -------------------------------------------------------------------- api -- */

webRouter.get(
  "/api/skills",
  handler((req: Request, res: Response) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : undefined;
    const output = typeof req.query.output === "string" ? req.query.output : undefined;
    const free = req.query.free === "1" || req.query.free === "true";
    const sort = typeof req.query.sort === "string" ? req.query.sort : undefined;

    const result = listSkills({
      q: q || undefined,
      output: OUTPUTS.includes(output as never) ? output : undefined,
      free,
      sort: sort === "new" || sort === "title" ? sort : "popular",
      limit: Number(req.query.limit) || 60,
      offset: Number(req.query.offset) || 0,
    });
    res.json(result);
  })
);

webRouter.get(
  "/api/skills/:slug",
  handler((req: Request, res: Response) => {
    const skill = findSkill(req.params.slug);
    if (!skill) throw notFound("That Skill does not exist.");
    res.json({ skill });
  })
);
