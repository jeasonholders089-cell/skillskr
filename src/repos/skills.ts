import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { all, get, run, transaction } from "../db.ts";
import { nowIso } from "../lib/http.ts";
import { config } from "../config.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = resolve(here, "..", "data", "skills.json");

export interface SkillRow {
  slug: string;
  title: string;
  summary: string | null;
  output: string;
  is_free: number;
  is_new: number;
  installs: number;
  bookmarks: number;
  preview_url: string | null;
  video_url: string | null;
  gallery_json: string;
  roles_json: string;
  use_cases_json: string;
  agents_json: string;
  is_featured: number;
  version: string | null;
  placeholder: string | null;
  tools_json: string;
  shelves_json: string;
  created_at: string;
  updated_at: string;
}

export interface PublicSkill {
  slug: string;
  title: string;
  summary: string | null;
  output: string;
  free: boolean;
  isNew: boolean;
  installs: number;
  bookmarks: number;
  preview: string | null;
  video: string | null;
  gallery: string[];
  roles: string[];
  useCases: string[];
  agents: string[];
  featured: boolean;
  version: string | null;
  placeholder: string | null;
  tools: Array<{ name: string; src: string }>;
  shelves: string[];
  requiresSubscription: boolean;
}

function assetUrl(value: string | null): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value) || value.startsWith("/assets/")) return value;
  return `${config.mediaBaseUrl}${value.startsWith("/") ? "" : "/"}${value}`;
}

export function toPublicSkill(row: SkillRow): PublicSkill {
  const gallery = (JSON.parse(row.gallery_json ?? "[]") as string[])
    .map((value) => assetUrl(value))
    .filter((value): value is string => Boolean(value));
  return {
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    output: row.output,
    free: Boolean(row.is_free),
    isNew: Boolean(row.is_new),
    installs: row.installs,
    bookmarks: row.bookmarks,
    preview: assetUrl(row.preview_url),
    video: assetUrl(row.video_url),
    gallery,
    roles: JSON.parse(row.roles_json ?? "[]") as string[],
    useCases: JSON.parse(row.use_cases_json ?? "[]") as string[],
    agents: JSON.parse(row.agents_json ?? "[]") as string[],
    featured: Boolean(row.is_featured),
    version: row.version,
    placeholder: row.placeholder,
    tools: JSON.parse(row.tools_json) as Array<{ name: string; src: string }>,
    shelves: JSON.parse(row.shelves_json) as string[],
    requiresSubscription: !row.is_free,
  };
}

interface SeedSkill {
  slug: string;
  title: string;
  output: string;
  free: boolean;
  new: boolean;
  installs: number;
  bookmarks: number;
  summary?: string | null;
  preview: string | null;
  video?: string | null;
  gallery?: string[];
  roles?: string[];
  useCases?: string[];
  agents?: string[];
  featured?: boolean;
  version?: string | null;
  placeholder: string | null;
  tools: Array<{ name: string; src: string }>;
  shelves: string[];
}

/** Upsert the catalog at boot so deploys can add and refresh Skills. */
export function seedSkills(): void {
  let seed: SeedSkill[];
  try {
    seed = JSON.parse(readFileSync(SEED_PATH, "utf-8")) as SeedSkill[];
  } catch (err) {
    console.warn("[skills] seed file missing, catalog stays empty:", err);
    return;
  }

  const ts = nowIso();
  transaction(() => {
    for (const skill of seed) {
      run(
        `INSERT INTO skills (slug, title, summary, output, is_free, is_new, installs, bookmarks,
                             preview_url, video_url, gallery_json, roles_json, use_cases_json,
                             agents_json, is_featured, version, placeholder, tools_json, shelves_json,
                             created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (slug) DO UPDATE SET
           title = excluded.title,
           summary = excluded.summary,
           output = excluded.output,
           is_free = excluded.is_free,
           is_new = excluded.is_new,
           installs = excluded.installs,
           bookmarks = excluded.bookmarks,
           preview_url = excluded.preview_url,
           video_url = excluded.video_url,
           gallery_json = excluded.gallery_json,
           roles_json = excluded.roles_json,
           use_cases_json = excluded.use_cases_json,
           agents_json = excluded.agents_json,
           is_featured = excluded.is_featured,
           version = excluded.version,
           placeholder = excluded.placeholder,
           tools_json = excluded.tools_json,
           shelves_json = excluded.shelves_json,
           updated_at = excluded.updated_at`,
        skill.slug,
        skill.title,
        skill.summary ?? null,
        skill.output,
        skill.free ? 1 : 0,
        skill.new ? 1 : 0,
        skill.installs,
        skill.bookmarks,
        skill.preview,
        skill.video ?? null,
        JSON.stringify(skill.gallery ?? []),
        JSON.stringify(skill.roles ?? []),
        JSON.stringify(skill.useCases ?? []),
        JSON.stringify(skill.agents ?? []),
        skill.featured ? 1 : 0,
        skill.version ?? null,
        skill.placeholder,
        JSON.stringify(skill.tools ?? []),
        JSON.stringify(skill.shelves ?? []),
        ts,
        ts
      );
    }
  });
  console.log(`[skills] upserted ${seed.length} skills`);
}

export interface SkillQuery {
  q?: string;
  output?: string;
  free?: boolean;
  featured?: boolean;
  role?: string;
  useCase?: string;
  shelf?: string;
  sort?: "popular" | "new" | "title";
  limit?: number;
  offset?: number;
}

const SORT_SQL: Record<string, string> = {
  popular: "installs DESC, title ASC",
  new: "is_new DESC, installs DESC",
  title: "title ASC",
};

export function listSkills(query: SkillQuery = {}): { skills: PublicSkill[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.q) {
    where.push("(title LIKE ? OR slug LIKE ?)");
    const like = `%${query.q}%`;
    params.push(like, like);
  }
  if (query.output) {
    where.push("output = ?");
    params.push(query.output);
  }
  if (query.free) {
    where.push("is_free = 1");
  }
  if (query.featured) {
    where.push("is_featured = 1");
  }
  if (query.role) {
    where.push("roles_json LIKE ?");
    params.push(`%"${query.role}"%`);
  }
  if (query.useCase) {
    where.push("use_cases_json LIKE ?");
    params.push(`%"${query.useCase}"%`);
  }
  if (query.shelf) {
    where.push("shelves_json LIKE ?");
    params.push(`%"${query.shelf}"%`);
  }

  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const order = SORT_SQL[query.sort ?? "popular"] ?? SORT_SQL.popular;
  const limit = Math.min(Math.max(query.limit ?? 60, 1), 500);
  const offset = Math.max(query.offset ?? 0, 0);

  const rows = all<SkillRow>(
    `SELECT * FROM skills ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset
  );
  const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM skills ${clause}`, ...params)?.n ?? 0;
  return { skills: rows.map(toPublicSkill), total };
}

export function findSkill(slug: string): PublicSkill | null {
  const row = get<SkillRow>("SELECT * FROM skills WHERE slug = ?", slug);
  return row ? toPublicSkill(row) : null;
}

export function skillCount(): number {
  return get<{ n: number }>("SELECT COUNT(*) AS n FROM skills")?.n ?? 0;
}

export const ROLE_LABELS: Record<string, string> = {
  "content-creator": "Content creator",
  founder: "Founder",
  "ecommerce-seller": "Ecommerce seller",
  designer: "Designer",
  consultant: "Consultant",
  educator: "Teacher",
  marketer: "Marketer",
  researcher: "Researcher",
  "personal-user": "Personal",
};

export const USE_CASE_LABELS: Record<string, string> = {
  "content-publishing": "Content publishing",
  "education-explainers": "Education explainers",
  "brand-identity": "Brand identity",
  "social-media": "Social media",
  "product-launch": "Product launch",
  "ecommerce-conversion": "Ecommerce conversion",
  "client-reporting": "Client reporting",
  "sales-fundraising": "Sales fundraising",
  "research-communication": "Research communication",
  "creative-previsualization": "Creative previsualization",
  "web-design": "Web design",
};

export interface SkillFacets {
  total: number;
  free: number;
  featured: number;
  outputs: Array<{ value: string; label: string; count: number }>;
  roles: Array<{ value: string; label: string; count: number }>;
  useCases: Array<{ value: string; label: string; count: number }>;
}

export function skillFacets(): SkillFacets {
  const rows = all<{
    output: string;
    is_free: number;
    is_featured: number;
    roles_json: string;
    use_cases_json: string;
  }>("SELECT output, is_free, is_featured, roles_json, use_cases_json FROM skills");
  const outputs = new Map<string, number>();
  const roles = new Map<string, number>();
  const useCases = new Map<string, number>();
  let free = 0;
  let featured = 0;
  for (const row of rows) {
    outputs.set(row.output, (outputs.get(row.output) ?? 0) + 1);
    if (row.is_free) free += 1;
    if (row.is_featured) featured += 1;
    for (const role of JSON.parse(row.roles_json) as string[]) {
      roles.set(role, (roles.get(role) ?? 0) + 1);
    }
    for (const useCase of JSON.parse(row.use_cases_json) as string[]) {
      useCases.set(useCase, (useCases.get(useCase) ?? 0) + 1);
    }
  }
  const toList = (values: Map<string, number>, labels: Record<string, string>) =>
    [...values.entries()]
      .map(([value, count]) => ({ value, label: labels[value] ?? value, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    total: rows.length,
    free,
    featured,
    outputs: OUTPUTS.map((output) => ({
      value: output,
      label: output,
      count: outputs.get(output) ?? 0,
    })),
    roles: toList(roles, ROLE_LABELS),
    useCases: toList(useCases, USE_CASE_LABELS),
  };
}

export const OUTPUTS = ["Web", "Slides", "Video", "Image"] as const;
