import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderPage } from "./layout.ts";
import { SITE } from "./seo.ts";

const here = dirname(fileURLToPath(import.meta.url));

export type ContentPage = {
  title: string;
  description: string;
  h1: string;
  keyword: string;
  body: string;
  kind: string;
};

let cache: Record<string, ContentPage> | null = null;

function pages(): Record<string, ContentPage> {
  if (cache) return cache;
  try {
    cache = JSON.parse(
      readFileSync(join(here, "..", "data", "pages.json"), "utf-8")
    ) as Record<string, ContentPage>;
  } catch {
    cache = {};
  }
  return cache;
}

export function hasPage(path: string): boolean {
  return Boolean(pages()[path]);
}

export function pagePaths(): string[] {
  return Object.keys(pages());
}

export function contentPage(path: string): string | null {
  const page = pages()[path];
  if (!page) return null;

  const segments = path.split("/").filter(Boolean);
  const crumbs = [{ name: "Skills", href: "/skills" }];
  if (segments[0] === "skills" && segments.length === 3) {
    const label =
      segments[1] === "agent"
        ? "By agent"
        : segments[1] === "task"
          ? "By task"
          : "By use case";
    crumbs.push({ name: label, href: "/skills" });
  }
  crumbs.push({ name: page.h1, href: path });

  const breadcrumbHtml = `<nav class="detail-crumbs">${crumbs
    .map((c, i) =>
      i === crumbs.length - 1
        ? `<span>${escapeText(c.name)}</span>`
        : `<a href="${c.href}">${escapeText(c.name)}</a><span>/</span>`
    )
    .join("")}</nav>`;

  const body = `<div class="page-shell"><article class="prose">
${breadcrumbHtml}
<h1>${escapeText(page.h1)}</h1>
${page.body}
</article></div>`;

  return renderPage({
    title: page.title,
    description: page.description,
    body,
    path,
    appendBrand: false,
    schema: [
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: crumbs.map((c, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: c.name,
          item: `${SITE.url}${c.href}`,
        })),
      },
    ],
  });
}

/** /learn used to be a four-step static page; make it a real hub for the guides. */
export function learnIndexPage(): string {
  const all = pages();
  const groups: Array<{ heading: string; prefix: string; blurb: string }> = [
    {
      heading: "Start here",
      prefix: "/learn/",
      blurb: "What Agent Skills are, how they load, and how they differ from prompts and MCP.",
    },
    {
      heading: "Install per agent",
      prefix: "/skills/agent/",
      blurb: "The exact skills folder for each agent, and the Skills worth installing first.",
    },
    {
      heading: "By task",
      prefix: "/skills/task/",
      blurb: "Workflows with prompts you can paste: OG images, landing pages, decks, launch films.",
    },
    {
      heading: "By use case",
      prefix: "/skills/use-case/",
      blurb: "Pick a job to be done and follow the asset checklist.",
    },
  ];

  const sections = groups
    .map((group) => {
      const items = Object.entries(all)
        .filter(([path]) => path.startsWith(group.prefix))
        .map(
          ([path, page]) =>
            `<li><a href="${path}">${escapeText(page.h1)}</a><span>${escapeText(
              page.description
            )}</span></li>`
        )
        .join("");
      if (!items) return "";
      return `<section class="learn-group"><h2>${group.heading}</h2><p class="learn-blurb">${group.blurb}</p><ul class="learn-list">${items}</ul></section>`;
    })
    .join("");

  const body = `<div class="page-shell"><article class="prose">
<span class="eyebrow">Learn</span>
<h1>Agent Skills, explained and installed</h1>
<p>Short, practical guides: what Skills are, where each agent looks for them, and which ones are worth installing for a given job.</p>
${sections}
</article></div>`;

  return renderPage({
    title: "Agent Skills Guides: Install, Compare, Troubleshoot",
    description:
      "How Agent Skills work in Claude Code, Codex, Cursor and other agents: install paths, SKILL.md format, troubleshooting, and comparisons with MCP and plugins.",
    body,
    path: "/learn",
  });
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
