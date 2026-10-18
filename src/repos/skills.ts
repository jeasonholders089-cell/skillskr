import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { all, get, run } from "../db.ts";
import { nowIso } from "../lib/http.ts";

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
  placeholder: string | null;
  tools: Array<{ name: string; src: string }>;
  shelves: string[];
  requiresSubscription: boolean;
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
    preview: row.preview_url,
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
  preview: string | null;
  placeholder: string | null;
  tools: Array<{ name: string; src: string }>;
  shelves: string[];
}

/** Seed the catalog once. Re-running is a no-op unless the table is empty. */
export function seedSkillsIfEmpty(): void {
  const existing = get<{ n: number }>("SELECT COUNT(*) AS n FROM skills")?.n ?? 0;
  if (existing > 0) return;

  let seed: SeedSkill[];
  try {
    seed = JSON.parse(readFileSync(SEED_PATH, "utf-8")) as SeedSkill[];
  } catch (err) {
    console.warn("[skills] seed file missing, catalog stays empty:", err);
    return;
  }

  const ts = nowIso();
  for (const skill of seed) {
    run(
      `INSERT INTO skills (slug, title, summary, output, is_free, is_new, installs, bookmarks,
                           preview_url, placeholder, tools_json, shelves_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (slug) DO NOTHING`,
      skill.slug,
      skill.title,
      null,
      skill.output,
      skill.free ? 1 : 0,
      skill.new ? 1 : 0,
      skill.installs,
      skill.bookmarks,
      skill.preview,
      skill.placeholder,
      JSON.stringify(skill.tools ?? []),
      JSON.stringify(skill.shelves ?? []),
      ts,
      ts
    );
  }
  console.log(`[skills] seeded ${seed.length} skills`);
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
  const limit = Math.min(Math.max(query.limit ?? 60, 1), 200);
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
