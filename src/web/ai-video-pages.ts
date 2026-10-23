import { escapeHtml, renderPage } from "./layout.ts";
import type {
  PublicAiVideo,
  PublicCollection,
} from "../repos/ai-videos.ts";
import type { PublicSkill } from "../repos/skills.ts";

function durationLabel(value: string | null): string {
  if (!value) return "";
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (!match) return value;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0) + hours * 60;
  const seconds = Number(match[3] || 0);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function videoCard(video: PublicAiVideo, collectionSlug: string, eager = false): string {
  const poster = video.originalPoster ?? "";
  const remakePoster = video.remakePoster;
  const summary = video.authorName ? `@${video.authorName}` : "";
  return `<article class="ai-card">
  <a class="ai-card__link" href="/ai-videos/${escapeHtml(collectionSlug)}/${escapeHtml(video.itemSlug)}">
    <div class="ai-card__media${remakePoster ? " ai-card__media--pair" : ""}">
      <div class="ai-card__panel">
        ${
          video.originalVideo
            ? `<video class="ai-card__video" src="${escapeHtml(video.originalVideo)}" poster="${escapeHtml(
                poster
              )}" muted loop playsinline preload="${eager ? "metadata" : "none"}" aria-label="${escapeHtml(
                video.title
              )} original video"></video>`
            : `<img class="ai-card__video" src="${escapeHtml(poster)}" alt="">`
        }
        ${remakePoster ? '<span class="ai-card__label">Original</span>' : ""}
      </div>
      ${
        remakePoster
          ? `<div class="ai-card__panel">
        ${
          video.remakeVideo
            ? `<video class="ai-card__video" src="${escapeHtml(
                video.remakeVideo
              )}" poster="${escapeHtml(remakePoster)}" muted loop playsinline preload="none" aria-label="${escapeHtml(
                video.title
              )} remake video"></video>`
            : `<img class="ai-card__video" src="${escapeHtml(remakePoster)}" alt="">`
        }
        <span class="ai-card__label ai-card__label--remake">Opus 5.5 remake</span>
      </div>`
          : ""
      }
      ${video.duration ? `<span class="ai-card__duration">${escapeHtml(durationLabel(video.duration))}</span>` : ""}
    </div>
    <h3 class="ai-card__title">${escapeHtml(video.title)}</h3>
    <p class="ai-card__author">${escapeHtml(summary)}</p>
  </a>
</article>`;
}

function collectionCard(collection: PublicCollection, poster: string | null): string {
  return `<a class="ai-collection-card" href="/ai-videos/${escapeHtml(collection.slug)}">
  <div class="ai-collection-card__media">
    ${poster ? `<img src="${escapeHtml(poster)}" alt="" loading="lazy">` : ""}
    <span class="ai-collection-card__count">${collection.videoCount} videos</span>
  </div>
  <p class="ai-collection-card__eyebrow">${escapeHtml(collection.eyebrow ?? "AI videos")}</p>
  <h2>${escapeHtml(collection.title)}</h2>
  <p>${escapeHtml(collection.description ?? "")}</p>
</a>`;
}

export function aiVideoIndexPage(input: {
  collections: PublicCollection[];
  posters: Record<string, string | null>;
}): string {
  const body = `<div class="page-shell"><section class="ai-index">
  <span class="eyebrow">AI Videos</span>
  <h1 class="ai-hero__title">What people are making with AI.</h1>
  <p class="ai-hero__sub">Browse creator-made films, motion graphics and experiments, with every video credited to its author.</p>
  <div class="ai-collection-grid">${input.collections
    .map((collection) => collectionCard(collection, input.posters[collection.slug] ?? null))
    .join("")}</div>
</section></div>`;
  return renderPage({
    title: "AI videos",
    description: "Creator-made AI videos, motion graphics and launch films.",
    body,
    scripts: ["/assets/site.js"],
    path: "/ai-videos",
  });
}

export function aiVideoCollectionPage(input: {
  collection: PublicCollection;
  videos: PublicAiVideo[];
  categories: Array<{ name: string; count: number }>;
  activeCategory?: string;
  videoSkills: PublicSkill[];
}): string {
  const { collection, videos, categories, activeCategory, videoSkills } = input;
  const isLanding = collection.kind === "landing";
  const landing = collection.landing;
  const landingSection =
    isLanding && landing
      ? `<section class="ai-landing-showcase">
    ${
      landing.heroVideo
        ? `<figure class="ai-landing-hero">
      <video src="${escapeHtml(landing.heroVideo)}" poster="${escapeHtml(
        landing.heroPoster ?? ""
      )}" controls playsinline preload="metadata"></video>
    </figure>`
        : ""
    }
    ${
      landing.pairs?.length
        ? `<div class="ai-pair-grid">${landing.pairs
            .map(
              (pair) => `<article class="ai-pair">
        <h3>${escapeHtml(pair.name)}</h3>
        <div class="ai-pair__videos">
          <figure><video src="${escapeHtml(pair.film ?? "")}" poster="${escapeHtml(
            pair.filmPoster ?? ""
          )}" controls muted loop playsinline preload="none"></video><figcaption>Launch film</figcaption></figure>
          <figure><video src="${escapeHtml(pair.compare ?? "")}" poster="${escapeHtml(
            pair.comparePoster ?? ""
          )}" controls muted loop playsinline preload="none"></video><figcaption>Comparison</figcaption></figure>
        </div>
      </article>`
            )
            .join("")}</div>`
        : ""
    }
    ${
      landing.gallery?.length
        ? `<div class="ai-motion-grid">${landing.gallery
            .filter((item) => item.src)
            .slice(0, 24)
            .map(
              (item) => `<figure><img src="${escapeHtml(
                item.src ?? ""
              )}" alt="${escapeHtml(item.label)}" loading="lazy"><figcaption>${escapeHtml(
                item.label
              )}</figcaption></figure>`
            )
            .join("")}</div>`
        : ""
    }
  </section>`
      : "";
  const categoryLinks = [
    `<a class="ai-filter${activeCategory ? "" : " is-active"}" href="/ai-videos/${escapeHtml(
      collection.slug
    )}">All ${collection.videoCount}</a>`,
    ...categories
      .filter((item) => item.name)
      .map(
        (item) =>
          `<a class="ai-filter${
            item.name === activeCategory ? " is-active" : ""
          }" href="/ai-videos/${escapeHtml(collection.slug)}?category=${encodeURIComponent(
            item.name
          )}">${escapeHtml(item.name)} ${item.count}</a>`
      ),
  ].join("");

  const body = `<div class="page-shell"><section class="ai-collection">
  <header class="ai-hero ai-hero--collection">
    <span class="eyebrow">${escapeHtml(collection.eyebrow ?? "AI videos")}</span>
    <h1 class="ai-hero__title">${escapeHtml(collection.title)}</h1>
    <p class="ai-hero__sub">${escapeHtml(collection.description ?? "")}</p>
    <div class="ai-hero__actions">
      <a class="btn btn--dark" href="${isLanding ? "#video-skills" : "#ai-video-grid"}">${
        isLanding ? "Explore video Skills" : "Browse the videos"
      }</a>
      <a class="btn btn--outline" href="${isLanding ? "/ai-videos" : "/skills?output=Video"}">${
        isLanding ? "All AI videos" : "Explore video Skills"
      }</a>
    </div>
    <p class="ai-hero__proof">${isLanding ? "Built for Claude Code, Codex, Cursor and other SKILL.md agents" : `${collection.videoCount} creator videos · credited to their authors · linked to the original posts`}</p>
  </header>
  ${landingSection}
  ${isLanding ? "" : `<section id="ai-video-grid" class="ai-browser">
    <div class="ai-browser__head">
      <div>
        <span class="eyebrow">The collection</span>
        <h2>Browse ${escapeHtml(collection.name)} videos</h2>
      </div>
      <span class="ai-browser__total">${videos.length} ${activeCategory ? `in ${escapeHtml(activeCategory)}` : "shown"}</span>
    </div>
    <div class="ai-filter-row">${categoryLinks}</div>
    ${
      videos.length
        ? `<div class="ai-video-grid">${videos
            .map((video, index) => videoCard(video, collection.slug, index < 4))
            .join("")}</div>`
        : `<p class="skills-empty">No videos in this filter yet. <a href="/ai-videos/${escapeHtml(
            collection.slug
          )}">View all</a>.</p>`
    }
  </section>`}
  ${
    videoSkills.length
      ? `<section id="video-skills" class="ai-related">
    <div class="ai-browser__head">
      <div><span class="eyebrow">Make your own</span><h2>Video Skills</h2></div>
      <a class="btn btn--outline btn--slim" href="/skills?output=Video">All video Skills</a>
    </div>
    <div class="skills-grid">${videoSkills
      .slice(0, isLanding ? 8 : 4)
      .map((skill) => `<a class="ai-skill-link" href="/skills/${escapeHtml(skill.slug)}">
        ${skill.preview ? `<img src="${escapeHtml(skill.preview)}" alt="" loading="lazy">` : ""}
        <span>${escapeHtml(skill.title)}</span>
      </a>`)
      .join("")}</div>
  </section>`
      : ""
  }
</section></div>`;
  return renderPage({
    title: `${collection.name} AI videos`,
    description: collection.description ?? collection.title,
    body,
    scripts: ["/assets/site.js"],
    path: `/ai-videos/${collection.slug}`,
  });
}

export function aiVideoDetailPage(input: {
  collection: PublicCollection;
  video: PublicAiVideo;
  related: PublicAiVideo[];
}): string {
  const { collection, video, related } = input;
  const players = [
    video.originalVideo
      ? `<figure class="ai-player">
          <video src="${escapeHtml(video.originalVideo)}" poster="${escapeHtml(
            video.originalPoster ?? ""
          )}" controls autoplay muted loop playsinline preload="metadata"></video>
          <figcaption>Original${video.authorName ? ` by @${escapeHtml(video.authorName)}` : ""}</figcaption>
        </figure>`
      : "",
    video.remakeVideo
      ? `<figure class="ai-player">
          <video src="${escapeHtml(video.remakeVideo)}" poster="${escapeHtml(
            video.remakePoster ?? ""
          )}" controls autoplay muted loop playsinline preload="metadata"></video>
          <figcaption>${escapeHtml(collection.name)} remake</figcaption>
        </figure>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const body = `<div class="page-shell"><article class="ai-detail">
  <a class="back-link" href="/ai-videos/${escapeHtml(collection.slug)}">← All ${escapeHtml(
    collection.name
  )} videos</a>
  <header class="ai-detail__head">
    <div>
      <h1>${escapeHtml(video.title)}</h1>
      <p class="ai-detail__meta">
        ${video.authorName ? `<span>@${escapeHtml(video.authorName)}</span>` : ""}
        ${video.postedAt ? `<span>· ${escapeHtml(formatDate(video.postedAt))}</span>` : ""}
        ${video.category ? `<span class="ai-detail__tag">${escapeHtml(video.category)}</span>` : ""}
      </p>
    </div>
    ${
      video.sourceUrl
        ? `<a class="btn btn--outline btn--slim" href="${escapeHtml(
            video.sourceUrl
          )}" target="_blank" rel="noopener noreferrer">View original post</a>`
        : ""
    }
  </header>
  <div class="ai-player-grid${video.remakeVideo ? " ai-player-grid--pair" : ""}">${players}</div>
  ${
    video.postText
      ? `<section class="ai-post-text">
    <span class="eyebrow">From the post</span>
    <blockquote>${escapeHtml(video.postText)}</blockquote>
  </section>`
      : ""
  }
  ${
    related.length
      ? `<section class="ai-related">
    <div class="ai-browser__head"><div><span class="eyebrow">Keep watching</span><h2>More ${escapeHtml(
      collection.name
    )} videos</h2></div></div>
    <div class="ai-video-grid">${related
      .map((item) => videoCard(item, collection.slug))
      .join("")}</div>
  </section>`
      : ""
  }
</article></div>`;
  return renderPage({
    title: video.title,
    description: video.description ?? video.title,
    body,
    scripts: ["/assets/site.js"],
    path: `/ai-videos/${collection.slug}/${video.itemSlug}`,
    image: video.remakePoster ?? video.originalPoster,
    type: "article",
  });
}
