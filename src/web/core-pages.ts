import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { escapeHtml, renderPage } from "./layout.ts";
import { SITE } from "./seo.ts";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "..", "..", "public");

/** The plan cards already exist on the home page — reuse them so prices live in one place. */
function planCards(): string {
  const html = readFileSync(join(publicDir, "index.html"), "utf-8");
  const sectionStart = html.indexOf('<section class="pricing"');
  const sectionEnd = html.indexOf("</section>", sectionStart);
  if (sectionStart === -1 || sectionEnd === -1) return "";
  const section = html.slice(sectionStart, sectionEnd);
  const plansStart = section.indexOf('<div class="plans">');
  const noteStart = section.indexOf('<p class="pricing__note">');
  if (plansStart === -1 || noteStart === -1) return "";
  return section.slice(plansStart, noteStart).trim();
}

const PRICING_FAQ = [
  {
    q: "Is this a subscription or a one-time license?",
    a: "A subscription, billed monthly or yearly. Cancel any time and keep access until the end of the period.",
  },
  {
    q: "Can I use the output commercially?",
    a: "Yes, including client work. You cannot resell or redistribute the skill files themselves.",
  },
  {
    q: "Do I need an API key?",
    a: "No. Skills run inside your own agent, using whatever model access you already have.",
  },
  {
    q: "What happens to my skills if I cancel?",
    a: "Files you downloaded keep working. You stop receiving updates and new releases.",
  },
  {
    q: "What is the refund policy?",
    a: "14 days from purchase, for any reason. Email support and we process it within three business days.",
  },
];

export function pricingPage(): string {
  const faq = PRICING_FAQ.map(
    (item) =>
      `<details class="faq__item"><summary>${escapeHtml(item.q)}</summary><p>${escapeHtml(
        item.a
      )}</p></details>`
  ).join("");

  const body = `<div class="page-shell"><section class="pricing pricing--page">
  <div class="pricing__head">
    <span class="eyebrow">Pricing</span>
    <h1 class="pricing__title">Every Skill, one plan</h1>
    <p class="pricing__sub">One subscription unlocks the whole catalog, including every Skill we ship while you are subscribed.</p>
  </div>
  ${planCards()}
  <p class="pricing__note">Cancel anytime. 14-day refunds — see <a href="/refund">Refund Policy</a>.</p>
  <div class="prose prose--faq">
    <h2>Pricing questions</h2>
    ${faq}
  </div>
</section></div>`;

  return renderPage({
    title: "Pricing: every Agent Skill, one plan",
    description:
      "One subscription unlocks all 402 Agent Skills, with new releases included. USD 9.99 per month or 79 per year, 14-day refunds, cancel any time.",
    body,
    path: "/pricing",
    schema: [
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: PRICING_FAQ.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      },
    ],
  });
}

export function aboutPage(): string {
  const body = `<div class="page-shell"><article class="prose">
  <span class="eyebrow">About</span>
  <h1>About skillskr</h1>
  <p>skillskr is a studio, not a marketplace. Every Skill in the catalog is designed, written and tested in-house. We started because too many Skills looked convincing in a demo and failed on a real project.</p>

  <h2>How a Skill gets published</h2>
  <ol>
    <li><strong>Write it.</strong> A <code>SKILL.md</code> with a narrow job, explicit inputs and a defined output format.</li>
    <li><strong>Run it.</strong> Same prompt, same input, three times. We record what breaks.</li>
    <li><strong>Document the edges.</strong> What it will not do, which agent versions it needs, where it costs tokens.</li>
    <li><strong>Ship previews.</strong> If we cannot show the output, we do not sell it.</li>
  </ol>

  <h2>What we do not do</h2>
  <ul>
    <li>We do not resell other people's Skills.</li>
    <li>We do not buy reviews or install counts.</li>
    <li>We do not claim a Skill works in an agent we have not tested.</li>
  </ul>

  <h2>Maintenance</h2>
  <p>Every Skill carries a version number. When an agent changes its Skills format, affected Skills are re-tested and bumped. If a Skill stops working and cannot be fixed, it is unpublished rather than left up.</p>

  <h2>Contact</h2>
  <p>Support: <a href="mailto:support@groclawa.com">support@groclawa.com</a><br>
  Business: <a href="mailto:hello@groclawa.com">hello@groclawa.com</a></p>
</article></div>`;

  return renderPage({
    title: "About skillskr",
    description:
      "A small studio building and testing Agent Skills for Claude Code, Codex and Cursor. How each Skill is written, run and maintained.",
    body,
    path: "/about",
  });
}

export function refundPage(): string {
  const body = `<div class="page-shell"><article class="prose">
  <span class="eyebrow">Refunds</span>
  <h1>Refund Policy</h1>
  <p>If a Skill does not do what its page says, you should not pay for it. You have <strong>14 days</strong> from purchase to request a refund, for any reason.</p>

  <h2>How to request one</h2>
  <ol>
    <li>Email <a href="mailto:support@groclawa.com">support@groclawa.com</a>.</li>
    <li>Include the email used at checkout and the Skill name, or "all".</li>
    <li>One line about what went wrong is optional, but it helps us fix the page.</li>
  </ol>
  <p>We reply within one business day and process the refund within three.</p>

  <h2>What is covered</h2>
  <ul>
    <li>Monthly and yearly subscriptions, within 14 days of the charge</li>
    <li>The founding lifetime purchase, within 14 days</li>
    <li>Duplicate charges, always</li>
  </ul>

  <h2>What is not</h2>
  <ul>
    <li>Requests made more than 14 days after a charge</li>
    <li>Chargebacks filed without contacting us first</li>
  </ul>

  <h2>After a refund</h2>
  <p>Access ends immediately. Files already downloaded keep working; updates stop. We do not delete anything from your machine.</p>

  <h2>If a Skill breaks later</h2>
  <p>That is a support case, not a refund case. Email us and we will fix or replace it. If we cannot, we refund the current period.</p>
</article></div>`;

  return renderPage({
    title: "Refund Policy — 14 days, no questions",
    description:
      "Request a refund within 14 days of purchase for any reason. How to ask, what is covered, and how long it takes.",
    body,
    path: "/refund",
  });
}

export function contactPage(): string {
  const body = `<div class="page-shell"><article class="prose">
  <span class="eyebrow">Contact</span>
  <h1>Contact</h1>

  <h2>Support</h2>
  <p><a href="mailto:support@groclawa.com">support@groclawa.com</a> — install problems, access issues, refunds.</p>
  <p>Include your agent and version (for example, "Claude Code 2.x on macOS"), the Skill name and the exact error. That is usually enough for a one-reply fix.</p>

  <h2>Custom Skills and partnerships</h2>
  <p><a href="mailto:hello@groclawa.com">hello@groclawa.com</a> — team licenses, custom Skill development, partnerships.</p>
  <p>Tell us the output you need, the agent you use and the deadline. We answer within two business days.</p>

  <h2>Response times</h2>
  <table>
    <thead><tr><th>Type</th><th>Typical</th></tr></thead>
    <tbody>
      <tr><td>Install problem</td><td>Same day</td></tr>
      <tr><td>Refund</td><td>One business day</td></tr>
      <tr><td>Custom work</td><td>Two business days</td></tr>
    </tbody>
  </table>

  <h2>Before you email</h2>
  <ul>
    <li>Check <a href="/learn/claude-skill-not-loading">Skill not loading</a> — it covers most install issues.</li>
    <li>Read the Skill page's "What you need" section.</li>
    <li>Confirm <code>SKILL.md</code> sits directly inside the Skill folder.</li>
  </ul>
</article></div>`;

  return renderPage({
    title: "Contact",
    description:
      "Email support for install problems, refunds, licensing and custom Skill requests. One business day response.",
    body,
    path: "/contact",
  });
}

export function sitemapXml(skillSlugs: { slug: string }[], extraPaths: string[] = []): string {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: "/", priority: "1.0", freq: "daily" },
    { loc: "/skills", priority: "0.9", freq: "daily" },
    { loc: "/pricing", priority: "0.8", freq: "weekly" },
    { loc: "/learn", priority: "0.7", freq: "weekly" },
    { loc: "/ai-videos", priority: "0.7", freq: "weekly" },
    { loc: "/about", priority: "0.5", freq: "monthly" },
    { loc: "/refund", priority: "0.3", freq: "yearly" },
    { loc: "/contact", priority: "0.3", freq: "yearly" },
    { loc: "/terms", priority: "0.2", freq: "yearly" },
    { loc: "/privacy", priority: "0.2", freq: "yearly" },
    ...skillSlugs.map((skill) => ({
      loc: `/skills/${skill.slug}`,
      priority: "0.7",
      freq: "monthly",
    })),
    ...extraPaths.map((loc) => ({
      loc,
      priority: loc.startsWith("/learn/") ? "0.6" : "0.7",
      freq: "monthly",
    })),
  ];
  const body = urls
    .map(
      (u) =>
        `  <url><loc>${SITE.url}${u.loc}</loc><lastmod>${today}</lastmod><changefreq>${u.freq}</changefreq><priority>${u.priority}</priority></url>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

export function robotsTxt(): string {
  return `# ${SITE.url}
User-agent: *
Allow: /

Disallow: /auth
Disallow: /dashboard
Disallow: /settings
Disallow: /api
Disallow: /admin
Disallow: /device
Disallow: /checkout
Disallow: /dev

# Search result pages and parameterised duplicates
Disallow: /*?q=
Disallow: /*?sort=
Disallow: /*?page=

Sitemap: ${SITE.url}/sitemap.xml
`;
}

export function llmsTxt(
  skills: { slug: string; title: string; summary?: string | null; output: string; free: boolean }[]
): string {
  const lines = [
    "# skillskr",
    "",
    "> skillskr is a studio catalog of Agent Skills for Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot and Windsurf. Each Skill is a folder with a SKILL.md, versioned and shipped with previews. Skills cover web pages, slides, images and video.",
    "",
    `Key facts: ${skills.length} skills (${skills.filter((s) => s.free).length} free), USD 9.99/month or USD 79/year. Full catalog: ${SITE.url}/skills`,
    "",
    "## Core pages",
    "",
    `- [Catalog](${SITE.url}/skills)`,
    `- [Pricing](${SITE.url}/pricing)`,
    `- [About](${SITE.url}/about)`,
    `- [Refund policy](${SITE.url}/refund)`,
    `- [Guides](${SITE.url}/learn)`,
    "",
    "## Skills",
    "",
  ];
  for (const skill of skills) {
    const summary = (skill.summary ?? "").replace(/\s+/g, " ").trim();
    const short = summary.length > 140 ? `${summary.slice(0, 140).replace(/\s\S*$/, "")}…` : summary;
    lines.push(
      `- [${skill.title}](${SITE.url}/skills/${skill.slug}): ${short} (${skill.output}, ${
        skill.free ? "free" : "Pro"
      })`
    );
  }
  lines.push("");
  return lines.join("\n");
}
