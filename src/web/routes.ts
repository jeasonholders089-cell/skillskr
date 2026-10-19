import express, { type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handler, notFound } from "../lib/errors.ts";
import { listSkills, findSkill, skillFacets, OUTPUTS } from "../repos/skills.ts";
import { tenantHasAccess } from "../repos/billing.ts";
import {
  categoryCounts,
  findAiVideo,
  findCollection,
  listAiVideos,
  listCollections,
} from "../repos/ai-videos.ts";
import { withAuth } from "../auth/middleware.ts";
import { skillDetailPage } from "./pages.ts";
import { skillsPage } from "./skills-page.ts";
import {
  aiVideoCollectionPage,
  aiVideoDetailPage,
  aiVideoIndexPage,
} from "./ai-video-pages.ts";

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
    const featured = req.query.featured === "1" || req.query.featured === "true";
    const role = typeof req.query.role === "string" ? req.query.role : undefined;
    const useCase =
      typeof req.query.use_case === "string" ? req.query.use_case : undefined;
    const sort =
      req.query.sort === "new" || req.query.sort === "title"
        ? req.query.sort
        : "popular";
    const validOutput = OUTPUTS.includes(output as never) ? output : undefined;

    const { skills, total } = listSkills({
      q: q || undefined,
      output: validOutput,
      free,
      featured,
      role,
      useCase,
      sort,
      limit: 500,
    });

    res.type("html").send(
      skillsPage({
        skills,
        total,
        query: {
          q: q || undefined,
          output: validOutput,
          free,
          featured,
          role,
          useCase,
          sort,
        },
        facets: skillFacets(),
      })
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

/* ------------------------------------------------------------- ai videos -- */

webRouter.get(
  "/ai-videos",
  handler((_req: Request, res: Response) => {
    const collections = listCollections();
    const posters: Record<string, string | null> = {};
    for (const collection of collections) {
      posters[collection.slug] =
        listAiVideos(collection.slug, { limit: 1 }).videos[0]?.originalPoster ?? null;
    }
    res.type("html").send(aiVideoIndexPage({ collections, posters }));
  })
);

webRouter.get(
  "/ai-videos/:collection/:item",
  handler((req: Request, res: Response) => {
    const collection = findCollection(req.params.collection);
    if (!collection) throw notFound("That AI video collection does not exist.");
    const video = findAiVideo(collection.slug, req.params.item);
    if (!video) throw notFound("That AI video does not exist.");
    const related = listAiVideos(collection.slug, { limit: 8 }).videos.filter(
      (item) => item.id !== video.id
    ).slice(0, 4);
    res.type("html").send(aiVideoDetailPage({ collection, video, related }));
  })
);

webRouter.get(
  "/ai-videos/:collection",
  handler((req: Request, res: Response) => {
    const collection = findCollection(req.params.collection);
    if (!collection) throw notFound("That AI video collection does not exist.");
    const category =
      typeof req.query.category === "string" ? req.query.category : undefined;
    const { videos } = listAiVideos(collection.slug, { category, limit: 500 });
    const videoSkills = listSkills({ output: "Video", limit: 8 }).skills;
    res.type("html").send(
      aiVideoCollectionPage({
        collection,
        videos,
        categories: categoryCounts(collection.slug),
        activeCategory: category,
        videoSkills,
      })
    );
  })
);

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
    const featured = req.query.featured === "1" || req.query.featured === "true";
    const role = typeof req.query.role === "string" ? req.query.role : undefined;
    const useCase =
      typeof req.query.use_case === "string" ? req.query.use_case : undefined;
    const sort = typeof req.query.sort === "string" ? req.query.sort : undefined;

    const result = listSkills({
      q: q || undefined,
      output: OUTPUTS.includes(output as never) ? output : undefined,
      free,
      featured,
      role,
      useCase,
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

webRouter.get(
  "/api/ai-videos",
  handler((_req: Request, res: Response) => {
    res.json({ collections: listCollections() });
  })
);

webRouter.get(
  "/api/ai-videos/:collection/:item",
  handler((req: Request, res: Response) => {
    const collection = findCollection(req.params.collection);
    if (!collection) throw notFound("That AI video collection does not exist.");
    const video = findAiVideo(collection.slug, req.params.item);
    if (!video) throw notFound("That AI video does not exist.");
    res.json({ collection, video });
  })
);

webRouter.get(
  "/api/ai-videos/:collection",
  handler((req: Request, res: Response) => {
    const collection = findCollection(req.params.collection);
    if (!collection) throw notFound("That AI video collection does not exist.");
    const category =
      typeof req.query.category === "string" ? req.query.category : undefined;
    const limit = Number(req.query.limit) || 60;
    const offset = Number(req.query.offset) || 0;
    res.json({
      collection,
      categories: categoryCounts(collection.slug),
      ...listAiVideos(collection.slug, { category, limit, offset }),
    });
  })
);
