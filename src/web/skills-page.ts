import { escapeHtml, renderPage } from "./layout.ts";
import { skillCard } from "./pages.ts";
import type { PublicSkill, SkillFacets } from "../repos/skills.ts";

export function skillsPage(input: {
  skills: PublicSkill[];
  total: number;
  query: {
    q?: string;
    output?: string;
    free?: boolean;
    featured?: boolean;
    role?: string;
    useCase?: string;
    sort?: string;
  };
  facets: SkillFacets;
}): string {
  const { skills, total, query, facets } = input;
  const queryState = {
    q: query.q,
    output: query.output,
    free: query.free,
    featured: query.featured,
    role: query.role,
    useCase: query.useCase,
    sort: query.sort,
  };
  const hrefFor = (overrides: Partial<typeof queryState>) => {
    const next = { ...queryState, ...overrides };
    const params = new URLSearchParams();
    if (next.q) params.set("q", next.q);
    if (next.output) params.set("output", next.output);
    if (next.free) params.set("free", "1");
    if (next.featured) params.set("featured", "1");
    if (next.role) params.set("role", next.role);
    if (next.useCase) params.set("use_case", next.useCase);
    if (next.sort && next.sort !== "popular") params.set("sort", next.sort);
    const value = params.toString();
    return value ? `/skills?${value}` : "/skills";
  };
  const checkbox = (
    label: string,
    count: number,
    active: boolean,
    overrides: Partial<typeof queryState>
  ) =>
    `<a class="market-check${active ? " is-active" : ""}" href="${escapeHtml(
      hrefFor(overrides)
    )}"><span class="market-check__box" aria-hidden="true"></span><span>${escapeHtml(
      label
    )}</span><span class="market-check__count">${count}</span></a>`;

  const hidden = [
    query.q ? `<input type="hidden" name="q" value="${escapeHtml(query.q)}">` : "",
    query.output
      ? `<input type="hidden" name="output" value="${escapeHtml(query.output)}">`
      : "",
    query.free ? '<input type="hidden" name="free" value="1">' : "",
    query.featured ? '<input type="hidden" name="featured" value="1">' : "",
    query.role ? `<input type="hidden" name="role" value="${escapeHtml(query.role)}">` : "",
    query.useCase
      ? `<input type="hidden" name="use_case" value="${escapeHtml(query.useCase)}">`
      : "",
  ].join("");

  const body = `<div class="page-shell"><section class="marketplace">
  <aside class="market-filters">
    <div class="market-filters__head"><span>Filters</span><span aria-hidden="true">☷</span></div>
    <div class="market-filter-group">
      <p>Recommendations</p>
      ${checkbox("Free", facets.free, Boolean(query.free), { free: !query.free })}
      ${checkbox("Featured", facets.featured, Boolean(query.featured), {
        featured: !query.featured,
      })}
    </div>
    <div class="market-filter-group">
      <p>By output</p>
      ${facets.outputs
        .map((item) =>
          checkbox(item.label, item.count, query.output === item.value, {
            output: query.output === item.value ? undefined : item.value,
          })
        )
        .join("")}
    </div>
    <div class="market-filter-group">
      <p>By role</p>
      ${facets.roles
        .map((item) =>
          checkbox(item.label, item.count, query.role === item.value, {
            role: query.role === item.value ? undefined : item.value,
          })
        )
        .join("")}
    </div>
    <div class="market-filter-group">
      <p>By use case</p>
      ${facets.useCases
        .map((item) =>
          checkbox(item.label, item.count, query.useCase === item.value, {
            useCase: query.useCase === item.value ? undefined : item.value,
          })
        )
        .join("")}
    </div>
  </aside>
  <div class="marketplace__main">
    <header class="marketplace__head">
      <h1>Agent Skills Marketplace</h1>
      <p>Works in Claude Code, Codex, Cursor, Antigravity and any agent that reads SKILL.md.</p>
    </header>
    <div class="market-toolbar">
      <span class="market-toolbar__count">${total} Skills</span>
      <form class="market-search" method="get" action="/skills">
        ${hidden}
        <input type="search" name="q" value="${escapeHtml(
          query.q ?? ""
        )}" placeholder="Search Skills…" aria-label="Search Skills">
        <button type="submit" class="btn btn--outline btn--slim">Search</button>
      </form>
      <form class="market-sort" method="get" action="/skills">
        ${hidden}
        <select name="sort" aria-label="Sort Skills" onchange="this.form.submit()">
          <option value="popular"${
            query.sort !== "new" && query.sort !== "title" ? " selected" : ""
          }>Popular</option>
          <option value="new"${query.sort === "new" ? " selected" : ""}>Newest</option>
          <option value="title"${query.sort === "title" ? " selected" : ""}>Title</option>
        </select>
      </form>
    </div>
    ${
      skills.length === 0
        ? `<p class="skills-empty">No Skills match that search. <a href="/skills">Clear filters</a>.</p>`
        : `<div class="skills-grid skills-grid--market">${skills
            .map((skill, index) => skillCard(skill, index < 8))
            .join("")}</div>`
    }
  </div>
</section></div>`;

  return renderPage({
    title: "Agent Skills Marketplace",
    description:
      "Browse every skillskr Agent Skill for Claude Code, Codex, Cursor and other SKILL.md agents.",
    body,
    scripts: ["/assets/site.js"],
  });
}
