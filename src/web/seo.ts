import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const SITE = {
  name: "skillskr",
  url: (process.env.SITE_URL || "https://groclawa.com").replace(/\/+$/, ""),
  defaultImage: "/assets/og-default.png",
};

type SeoEntry = {
  title: string;
  description: string;
  keyword?: string;
};

let cache: Record<string, SeoEntry> | null = null;

function table(): Record<string, SeoEntry> {
  if (cache) return cache;
  try {
    cache = JSON.parse(
      readFileSync(join(here, "..", "data", "skill-seo.json"), "utf-8")
    ) as Record<string, SeoEntry>;
  } catch {
    cache = {};
  }
  return cache;
}

/** Per-skill title/description generated from the page's own summary. */
export function skillSeo(
  slug: string,
  fallbackTitle: string,
  fallbackDescription: string
): SeoEntry {
  return (
    table()[slug] ?? {
      title: fallbackTitle,
      description: fallbackDescription,
    }
  );
}

/** Turn a site-relative path into an absolute URL for canonical/OG tags. */
export function absolute(pathOrUrl: string | null | undefined): string | undefined {
  if (!pathOrUrl) return undefined;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${SITE.url}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}
