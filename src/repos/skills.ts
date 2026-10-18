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
                             preview_url, video_url, version, placeholder, tools_json, shelves_json,
                             created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

export const OUTPUTS = ["Web", "Slides", "Video", "Image"] as const;
