import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { all, get, run, transaction } from "../db.ts";
import { nowIso } from "../lib/http.ts";
import { config } from "../config.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = resolve(here, "..", "data", "ai-videos.json");

export interface CollectionRow {
  slug: string;
  name: string;
  eyebrow: string | null;
  title: string;
  description: string | null;
  kind: string;
  landing_json: string;
  sort_order: number;
  video_count?: number;
}

export interface VideoRow {
  id: string;
  collection_slug: string;
  item_slug: string;
  title: string;
  description: string | null;
  post_text: string | null;
  author_name: string | null;
  source_url: string | null;
  category: string | null;
  posted_at: string | null;
  duration: string | null;
  original_video_url: string | null;
  remake_video_url: string | null;
  original_poster_url: string | null;
  remake_poster_url: string | null;
}

export interface PublicAiVideo {
  id: string;
  collectionSlug: string;
  itemSlug: string;
  title: string;
  description: string | null;
  postText: string | null;
  authorName: string | null;
  sourceUrl: string | null;
  category: string | null;
  postedAt: string | null;
  duration: string | null;
  originalVideo: string | null;
  remakeVideo: string | null;
  originalPoster: string | null;
  remakePoster: string | null;
}

export interface PublicCollection {
  slug: string;
  name: string;
  eyebrow: string | null;
  title: string;
  description: string | null;
  kind: string;
  landing: LandingData | null;
  videoCount: number;
}

export interface LandingPair {
  name: string;
  film: string | null;
  compare: string | null;
  filmPoster: string | null;
  comparePoster: string | null;
}

export interface LandingData {
  heroVideo?: string | null;
  heroPoster?: string | null;
  pairs?: LandingPair[];
  gallery?: Array<{ src: string | null; label: string }>;
}

function assetUrl(value: string | null): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value) || value.startsWith("/assets/")) return value;
  return `${config.mediaBaseUrl}${value.startsWith("/") ? "" : "/"}${value}`;
}

function publicLanding(value: string): LandingData | null {
  let landing: LandingData;
  try {
    landing = JSON.parse(value || "{}") as LandingData;
  } catch {
    return null;
  }
  if (!landing || Object.keys(landing).length === 0) return null;
  return {
    heroVideo: assetUrl(landing.heroVideo ?? null),
    heroPoster: assetUrl(landing.heroPoster ?? null),
    pairs: (landing.pairs ?? []).map((pair) => ({
      name: pair.name,
      film: assetUrl(pair.film ?? null),
      compare: assetUrl(pair.compare ?? null),
      filmPoster: assetUrl(pair.filmPoster ?? null),
      comparePoster: assetUrl(pair.comparePoster ?? null),
    })),
    gallery: (landing.gallery ?? []).map((item) => ({
      src: assetUrl(item.src ?? null),
      label: item.label,
    })),
  };
}

export function toPublicVideo(row: VideoRow): PublicAiVideo {
  return {
    id: row.id,
    collectionSlug: row.collection_slug,
    itemSlug: row.item_slug,
    title: row.title,
    description: row.description,
    postText: row.post_text,
    authorName: row.author_name,
    sourceUrl: row.source_url,
    category: row.category,
    postedAt: row.posted_at,
    duration: row.duration,
    originalVideo: assetUrl(row.original_video_url),
    remakeVideo: assetUrl(row.remake_video_url),
    originalPoster: assetUrl(row.original_poster_url),
    remakePoster: assetUrl(row.remake_poster_url),
  };
}

export function listCollections(): PublicCollection[] {
  const rows = all<CollectionRow>(
    `SELECT c.*, COUNT(v.id) AS video_count
       FROM ai_video_collections c
       LEFT JOIN ai_videos v ON v.collection_slug = c.slug
      GROUP BY c.slug
      ORDER BY c.sort_order ASC, c.name ASC`
  );
  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    eyebrow: row.eyebrow,
    title: row.title,
    description: row.description,
    kind: row.kind,
    landing: publicLanding(row.landing_json),
    videoCount: row.video_count ?? 0,
  }));
}

export function findCollection(slug: string): PublicCollection | null {
  const row = get<CollectionRow>(
    `SELECT c.*, COUNT(v.id) AS video_count
       FROM ai_video_collections c
       LEFT JOIN ai_videos v ON v.collection_slug = c.slug
      WHERE c.slug = ?
      GROUP BY c.slug`,
    slug
  );
  if (!row) return null;
  return {
    slug: row.slug,
    name: row.name,
    eyebrow: row.eyebrow,
    title: row.title,
    description: row.description,
    kind: row.kind,
    landing: publicLanding(row.landing_json),
    videoCount: row.video_count ?? 0,
  };
}

export function listAiVideos(
  collection: string,
  options: { category?: string; limit?: number; offset?: number } = {}
): { videos: PublicAiVideo[]; total: number } {
  const where = ["collection_slug = ?"];
  const params: unknown[] = [collection];
  if (options.category) {
    where.push("category = ?");
    params.push(options.category);
  }
  const clause = where.join(" AND ");
  const limit = Math.min(Math.max(options.limit ?? 60, 1), 600);
  const offset = Math.max(options.offset ?? 0, 0);
  const rows = all<VideoRow>(
    `SELECT * FROM ai_videos WHERE ${clause} ORDER BY posted_at DESC, id ASC LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset
  );
  const total =
    get<{ n: number }>(`SELECT COUNT(*) AS n FROM ai_videos WHERE ${clause}`, ...params)?.n ?? 0;
  return { videos: rows.map(toPublicVideo), total };
}

export function categoryCounts(collection: string): Array<{ name: string; count: number }> {
  return all<{ name: string; count: number }>(
    `SELECT category AS name, COUNT(*) AS count
       FROM ai_videos
      WHERE collection_slug = ? AND category IS NOT NULL AND category != ''
      GROUP BY name
      ORDER BY count DESC`,
    collection
  );
}

export function findAiVideo(collection: string, item: string): PublicAiVideo | null {
  const row = get<VideoRow>(
    "SELECT * FROM ai_videos WHERE collection_slug = ? AND item_slug = ?",
    collection,
    item
  );
  return row ? toPublicVideo(row) : null;
}

interface SeedFile {
  collections: Array<{
    slug: string;
    name: string;
    eyebrow?: string | null;
    title: string;
    description?: string | null;
    kind: string;
    landing?: LandingData | null;
    sortOrder: number;
  }>;
  videos: Array<{
    id: string;
    collectionSlug: string;
    itemSlug: string;
    title: string;
    description?: string | null;
    postText?: string | null;
    authorName?: string | null;
    sourceUrl?: string | null;
    category?: string | null;
    postedAt?: string | null;
    duration?: string | null;
    originalVideo?: string | null;
    remakeVideo?: string | null;
    originalPoster?: string | null;
    remakePoster?: string | null;
  }>;
}

export function seedAiVideos(): void {
  let seed: SeedFile;
  try {
    seed = JSON.parse(readFileSync(SEED_PATH, "utf-8")) as SeedFile;
  } catch (err) {
    console.warn("[ai-videos] seed file missing:", err);
    return;
  }
  const ts = nowIso();
  transaction(() => {
    for (const collection of seed.collections) {
      run(
        `INSERT INTO ai_video_collections
           (slug, name, eyebrow, title, description, kind, landing_json, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (slug) DO UPDATE SET
           name = excluded.name, eyebrow = excluded.eyebrow, title = excluded.title,
           description = excluded.description, kind = excluded.kind,
           landing_json = excluded.landing_json,
           sort_order = excluded.sort_order`,
        collection.slug,
        collection.name,
        collection.eyebrow ?? null,
        collection.title,
        collection.description ?? null,
        collection.kind,
        JSON.stringify(collection.landing ?? {}),
        collection.sortOrder
      );
    }
    for (const video of seed.videos) {
      run(
        `INSERT INTO ai_videos
           (id, collection_slug, item_slug, title, description, post_text, author_name,
            source_url, category, posted_at, duration, original_video_url, remake_video_url,
            original_poster_url, remake_poster_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           collection_slug = excluded.collection_slug, item_slug = excluded.item_slug,
           title = excluded.title, description = excluded.description,
           post_text = excluded.post_text, author_name = excluded.author_name,
           source_url = excluded.source_url, category = excluded.category,
           posted_at = excluded.posted_at, duration = excluded.duration,
           original_video_url = excluded.original_video_url,
           remake_video_url = excluded.remake_video_url,
           original_poster_url = excluded.original_poster_url,
           remake_poster_url = excluded.remake_poster_url,
           updated_at = excluded.updated_at`,
        video.id,
        video.collectionSlug,
        video.itemSlug,
        video.title,
        video.description ?? null,
        video.postText ?? null,
        video.authorName ?? null,
        video.sourceUrl ?? null,
        video.category ?? null,
        video.postedAt ?? null,
        video.duration ?? null,
        video.originalVideo ?? null,
        video.remakeVideo ?? null,
        video.originalPoster ?? null,
        video.remakePoster ?? null,
        ts,
        ts
      );
    }
  });
  console.log(
    `[ai-videos] upserted ${seed.collections.length} collections, ${seed.videos.length} videos`
  );
}
