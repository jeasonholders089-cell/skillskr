import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { absolute, SITE } from "./seo.ts";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "..", "..", "public");

interface Chrome {
  header: string;
  footer: string;
}

let chromeCache: Chrome | null = null;

/**
 * Reuse the exact header/footer from the home page so every page shares one
 * navigation bar (and one place to change it).
 */
function chrome(): Chrome {
  if (chromeCache) return chromeCache;
  const html = readFileSync(join(publicDir, "index.html"), "utf-8");
  const headerStart = html.indexOf('<header class="site-header"');
  const footerStart = html.indexOf('<footer class="site-footer"');
  if (headerStart === -1 || footerStart === -1) {
    throw new Error("Could not locate the site header/footer in public/index.html");
  }
  const headerEnd = html.indexOf("</header>", headerStart) + "</header>".length;
  const footerEnd = html.indexOf("</footer>", footerStart) + "</footer>".length;
  let footer = html.slice(footerStart, footerEnd);

  // The static footer predates the agent hub pages; point its agent links at
  // the real hubs so the site stops sending every agent query to one catalog page.
  const agentLinks: Record<string, string> = {
    "Claude Code Skills": "/skills/agent/claude-code",
    "Codex Skills": "/skills/agent/codex",
    "Cursor Skills": "/skills/agent/cursor",
    "GitHub Copilot Skills": "/skills/agent/github-copilot",
    "Gemini CLI Skills": "/skills/agent/gemini-cli",
  };
  for (const [label, href] of Object.entries(agentLinks)) {
    footer = footer.replace(
      `<a href="/skills">${label}</a>`,
      `<a href="${href}">${label}</a>`
    );
  }

  chromeCache = {
    header: html.slice(headerStart, headerEnd),
    footer,
  };
  return chromeCache;
}

export function renderPage(input: {
  title: string;
  description?: string;
  body: string;
  scripts?: string[];
  path?: string;
  image?: string | null;
  type?: "website" | "article";
  noindex?: boolean;
  schema?: unknown[];
  appendBrand?: boolean;
}): string {
  const { header, footer } = chrome();
  const title =
    input.appendBrand === false || input.title.includes(SITE.name)
      ? input.title
      : `${input.title} | ${SITE.name}`;
  const description =
    input.description ??
    "skillskr designs original Agent Skills for Claude Code, Codex and Cursor.";
  const scripts = [...new Set(["/assets/app.js", ...(input.scripts ?? []), "/assets/site.js"])]
    .map((src) => `<script src="${src}"></script>`)
    .join("\n");

  const canonical = input.path ? `${SITE.url}${input.path}` : undefined;
  const image = absolute(input.image ?? SITE.defaultImage);
  const schema = (input.schema ?? [])
    .map(
      (item) =>
        `<script type="application/ld+json">${JSON.stringify(item).replace(
          /</g,
          "\\u003c"
        )}</script>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en" data-theme="light" style="--promo-banner-height:0px">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
${canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}">` : ""}
${input.noindex ? '<meta name="robots" content="noindex, follow">' : '<meta name="robots" content="index, follow, max-image-preview:large">'}
<meta property="og:type" content="${input.type ?? "website"}">
<meta property="og:site_name" content="${SITE.name}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
${canonical ? `<meta property="og:url" content="${escapeHtml(canonical)}">` : ""}
${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ""}
${image ? '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' : ""}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
${image ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : ""}
<meta name="theme-color" content="#0b0b0b">
<link rel="icon" href="/assets/logo-mark.svg" type="image/svg+xml">
<link rel="icon" href="/assets/favicon-32x32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="stylesheet" href="/assets/styles.css">
<link rel="stylesheet" href="/assets/app-extras.css">
${schema}
</head>
<body>
<div class="app">
${header}
<div data-sub-banner></div>
<main class="app__main" id="main-content">
  <div class="shell">
${input.body}
  </div>
</main>
${footer}
</div>
${scripts}
</body>
</html>
`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
