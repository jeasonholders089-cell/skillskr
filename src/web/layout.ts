import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.ts";

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
  chromeCache = {
    header: html.slice(headerStart, headerEnd),
    footer: html.slice(footerStart, footerEnd),
  };
  return chromeCache;
}

export function renderPage(input: {
  title: string;
  description?: string;
  body: string;
  scripts?: string[];
}): string {
  const { header, footer } = chrome();
  const title = input.title.includes("skillskr") ? input.title : `${input.title} · skillskr`;
  const description =
    input.description ??
    "skillskr designs original Agent Skills for Claude Code, Codex and Cursor.";
  const scripts = (input.scripts ?? ["/assets/app.js", "/assets/site.js"])
    .map((src) => `<script src="${src}"></script>`)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en" data-theme="light" style="--promo-banner-height:0px">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="theme-color" content="#0b0b0b">
<link rel="icon" href="/assets/favicon-32x32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="stylesheet" href="/assets/styles.css">
<link rel="stylesheet" href="/assets/app-extras.css">
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
