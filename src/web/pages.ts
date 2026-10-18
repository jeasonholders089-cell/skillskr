import { escapeHtml, renderPage } from "./layout.ts";
import type { PublicSkill } from "../repos/skills.ts";
import { OUTPUTS } from "../repos/skills.ts";
import type { PlanRow } from "../repos/billing.ts";

function badge(skill: PublicSkill): string {
  if (skill.isNew) {
    return '<span class="card__badge card__badge--new"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z"></path></svg>New</span>';
  }
  if (skill.free) return '<span class="card__badge card__badge--free">Free</span>';
  return '<span class="card__badge card__badge--pro">Pro</span>';
}

const ICON_DOWNLOAD =
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"></path><path d="M7 11l5 5l5 -5"></path><path d="M12 4l0 12"></path></svg>';
const ICON_BOOKMARK =
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 7v14l-6 -4l-6 4v-14a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4"></path></svg>';

function skillCard(skill: PublicSkill, eager = false): string {
  const tools = skill.tools
    .slice(0, 3)
    .map(
      (tool) =>
        `<span class="card__tool" title="${escapeHtml(tool.name ?? "")}"><img src="${escapeHtml(
          tool.src
        )}" alt="" width="10" height="10" loading="lazy"></span>`
    )
    .join("");

  return `<div class="card-wrap">
  <article class="card">
    <a class="card__link" href="/skills/${escapeHtml(skill.slug)}">
      <div class="card__media">
        <div class="card__frame" style="background-color:${escapeHtml(skill.placeholder ?? "#f7f7f5")}">
          ${
            skill.preview
              ? `<img class="card__img" src="${escapeHtml(skill.preview)}" alt="${escapeHtml(
                  skill.title
                )} preview" width="1280" height="720" loading="${eager ? "eager" : "lazy"}" decoding="async">`
              : ""
          }
          <span class="card__scrim" aria-hidden="true"></span>
        </div>
        ${badge(skill)}
        <span class="card__output" title="${escapeHtml(skill.output)}">${escapeHtml(skill.output)}</span>
        <span class="card__fade" aria-hidden="true"></span>
        <span class="card__stats">
          <span class="card__stat">${ICON_DOWNLOAD}${skill.installs}</span>
          <span class="card__stat">${ICON_BOOKMARK}${skill.bookmarks}</span>
        </span>
      </div>
      <div class="card__caption">
        <p class="card__title" title="${escapeHtml(skill.title)}">${escapeHtml(skill.title)}</p>
        <span class="card__tools">${tools}</span>
      </div>
    </a>
  </article>
</div>`;
}

export function skillsPage(input: {
  skills: PublicSkill[];
  total: number;
  query: { q?: string; output?: string; free?: boolean };
}): string {
  const { skills, total, query } = input;
  const chips = [
    { key: "", label: "All", active: !query.output && !query.free },
    ...OUTPUTS.map((output) => ({
      key: `output=${encodeURIComponent(output)}`,
      label: output,
      active: query.output === output,
    })),
    { key: "free=1", label: "Free", active: Boolean(query.free) },
  ]
    .map((chip) => {
      const href = chip.key ? `/skills?${chip.key}${query.q ? `&q=${encodeURIComponent(query.q)}` : ""}` : "/skills";
      return `<a class="filter-chip${chip.active ? " is-active" : ""}" href="${href}">${chip.label}</a>`;
    })
    .join("");

  const body = `<div class="page-shell"><section class="skills-page">
  <header class="skills-head">
    <span class="eyebrow">Agent Skills</span>
    <h1 class="skills-title">Every Skill, one catalog</h1>
    <p class="skills-sub">
      ${total} Skills designed, written and tested in-house. Free Skills install with any account;
      Pro Skills need an active subscription.
    </p>
    <form class="skills-search" method="get" action="/skills">
      <input type="search" name="q" value="${escapeHtml(query.q ?? "")}" placeholder="Search Skills…" aria-label="Search Skills">
      ${query.output ? `<input type="hidden" name="output" value="${escapeHtml(query.output)}">` : ""}
      ${query.free ? '<input type="hidden" name="free" value="1">' : ""}
      <button type="submit" class="btn btn--dark btn--slim">Search</button>
    </form>
    <div class="filter-row">${chips}</div>
  </header>
  ${
    skills.length === 0
      ? `<p class="skills-empty">No Skills match that search. <a href="/skills">Clear filters</a>.</p>`
      : `<div class="skills-grid">${skills.map((skill, index) => skillCard(skill, index < 8)).join("")}</div>`
  }
</section></div>`;

  return renderPage({
    title: "Agent Skills catalog",
    description: "Browse every Skillry Agent Skill: web, slides, video and image workflows.",
    body,
    scripts: ["/assets/site.js"],
  });
}

export function skillDetailPage(input: {
  skill: PublicSkill;
  related: PublicSkill[];
  entitlements: { active: boolean; planCode: string | null };
  signedIn: boolean;
}): string {
  const { skill, related, entitlements, signedIn } = input;
  const locked = skill.requiresSubscription && !entitlements.active;

  const cta = locked
    ? `<button type="button" class="btn btn--dark btn--block" data-subscribe-plan="pro_monthly">Subscribe to install</button>
       <p class="detail-hint">Pro Skills need an active subscription. You can cancel any time.</p>`
    : !signedIn
      ? `<button type="button" class="btn btn--dark btn--block" data-auth-open>Sign in to install</button>
         <p class="detail-hint">A free account is enough for Free Skills.</p>`
      : `<button type="button" class="btn btn--dark btn--block" data-download-skill="${escapeHtml(
          skill.slug
        )}">Download pack (.zip)</button>
         <p class="detail-hint">Includes SKILL.md, manifest.json and a README. The download link is signed and expires in 15 minutes.</p>`;

  const body = `<div class="page-shell"><section class="skill-detail">
  <nav class="detail-crumbs"><a href="/skills">Skills</a><span>/</span><span>${escapeHtml(skill.output)}</span></nav>
  <div class="detail-grid">
    <div class="detail-main">
      <div class="detail-preview" style="background-color:${escapeHtml(skill.placeholder ?? "#f7f7f5")}">
        ${skill.preview ? `<img src="${escapeHtml(skill.preview)}" alt="${escapeHtml(skill.title)} preview" width="1280" height="720">` : ""}
        ${badge(skill)}
      </div>
      <h1 class="detail-title">${escapeHtml(skill.title)}</h1>
      <p class="detail-summary">
        A ${escapeHtml(skill.output.toLowerCase())} Skill from the Skillry studio. Install it once and your
        agent can reproduce this result on your own material.
      </p>
      <div class="detail-stats">
        <span>${skill.installs} installs</span>
        <span>${skill.bookmarks} saves</span>
        <span>${escapeHtml(skill.output)}</span>
      </div>
    </div>
    <aside class="detail-side">
      <div class="detail-card">
        <p class="detail-price">${skill.free ? "Free" : "Pro"}</p>
        ${cta}
        <ul class="detail-list">
          <li>Works with Claude Code, Codex and Cursor</li>
          <li>Reusable SKILL.md workflow</li>
          <li>Updates included while subscribed</li>
        </ul>
        <div class="detail-tools">
          ${skill.tools
            .map(
              (tool) =>
                `<span class="detail-tool" title="${escapeHtml(tool.name ?? "")}"><img src="${escapeHtml(
                  tool.src
                )}" alt="" width="16" height="16">${escapeHtml(tool.name ?? "")}</span>`
            )
            .join("")}
        </div>
      </div>
    </aside>
  </div>
  ${
    related.length
      ? `<div class="detail-related">
    <h2 class="detail-related-title">More ${escapeHtml(skill.output)} Skills</h2>
    <div class="skills-grid">${related.map((item) => skillCard(item)).join("")}</div>
  </div>`
      : ""
  }
</section></div>`;

  return renderPage({
    title: skill.title,
    description: `${skill.title} — an Agent Skill for ${skill.output.toLowerCase()} work.`,
    body,
    scripts: ["/assets/site.js"],
  });
}

export function plansJson(plans: PlanRow[]) {
  return plans.map((plan) => ({
    code: plan.code,
    name: plan.name,
    description: plan.description,
    amount: plan.amount,
    currency: plan.currency,
    productType: plan.product_type,
    billingPeriod: plan.billing_period,
    features: JSON.parse(plan.features_json) as string[],
    ready: Boolean(plan.pancake_product_id),
  }));
}
