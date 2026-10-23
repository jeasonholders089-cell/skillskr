/* Landing v3: restrained editorial layout with deterministic module ordering. */
(function () {
  "use strict";

  document.body.classList.add("sk-landing-v3");
  document.documentElement.setAttribute("data-landing-version", "v3");

  function hash(value) {
    let h = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  var title = document.querySelector(".hero__title");
  if (title) {
    title.innerHTML = "Skills with<br><em>a point of view.</em>";
    title.insertAdjacentHTML(
      "beforebegin",
      '<p class="sk-v3-kicker">skillskr / independent skill studio</p>'
    );
    title.insertAdjacentHTML(
      "afterend",
      '<p class="sk-v3-lede">A sharper catalog for web, decks, imagery and motion. Curated to give the agent you already use a clear visual instinct—not another generic AI look.</p>' +
        '<div class="sk-v3-metrics">' +
        '<div><strong>402</strong><span>Skills</span></div>' +
        '<div><strong>43</strong><span>free</span></div>' +
        '<div><strong>261</strong><span>motion previews</span></div>' +
        '<div><strong>9</strong><span>agents</span></div>' +
        "</div>"
    );
  }

  var ctas = document.querySelector(".hero__ctas");
  if (ctas) {
    ctas.innerHTML =
      '<a class="btn btn--dark" href="/skills">Browse the catalog <span aria-hidden="true">↗</span></a>' +
      '<a class="btn btn--outline" href="/ai-videos">See AI videos</a>';
  }

  var stage = document.querySelector(".hero__stage");
  if (stage && !stage.querySelector(".sk-v3-stack")) {
    stage.insertAdjacentHTML(
      "beforeend",
      '<div class="sk-v3-stack">' +
        '<figure class="sk-v3-shot sk-v3-shot--top"><img src="/assets/skills/bs-notion-style-localize-video/media/preview-1.webp" alt="" loading="eager"><figcaption>Localization systems</figcaption></figure>' +
        '<figure class="sk-v3-shot sk-v3-shot--main"><img src="/assets/skills/bs-cadence-marketing-landing/media/preview-1.webp" alt="" loading="eager"><figcaption>Web / product systems</figcaption></figure>' +
        '<figure class="sk-v3-shot sk-v3-shot--bottom"><img src="/assets/skills/bs-dot-avatar-maker/media/preview-1.webp" alt="" loading="eager"><figcaption>Playful image tools</figcaption></figure>' +
        '<span class="sk-v3-stamp"><strong>402</strong><span>Skills<br>one studio</span></span>' +
        "</div>"
    );
  }

  var shelves = document.querySelector(".shelves");
  if (shelves && !document.querySelector(".sk-v3-index")) {
    shelves.insertAdjacentHTML(
      "beforebegin",
      '<nav class="sk-v3-index" aria-label="Browse by output">' +
        '<span class="sk-v3-index__label">Index</span>' +
        '<a href="/skills?output=Web"><strong>Web systems</strong><small>114 skills</small></a>' +
        '<a href="/skills?output=Slides"><strong>Story decks</strong><small>60 skills</small></a>' +
        '<a href="/skills?output=Video"><strong>Motion work</strong><small>146 skills</small></a>' +
        '<a href="/skills?output=Image"><strong>Visual systems</strong><small>82 skills</small></a>' +
        "</nav>"
    );
  }

  document.querySelectorAll(".shelves > .shelf").forEach(function (shelf, index) {
    var heading = shelf.querySelector(":scope > .shelf__header .shelf__title");
    if (heading) heading.innerHTML = heading.innerHTML.replace(/[🔥🏆]\s*/g, "");
    var header = shelf.querySelector(":scope > .shelf__header");
    if (header && !header.querySelector(".sk-v3-module-label")) {
      var labels = ["01 / CURATED", "02 / TRENDING", "03 / OPEN ACCESS", "04 / TOP RATED"];
      header.insertAdjacentHTML(
        "afterbegin",
        '<span class="sk-v3-module-label">' + labels[index] + "</span>"
      );
    }
  });

  document.querySelectorAll(".shelf__groups").forEach(function (groups) {
    var shelfTitle = groups.closest(".shelf")?.querySelector(".shelf__title")?.textContent || "";
    var order = shelfTitle.indexOf("Top-rated") >= 0
      ? ["Image", "Web", "Video", "Slide"]
      : ["Video", "Image", "Web", "Slide"];
    Array.prototype.forEach.call(groups.children, function (group) {
      var text = group.querySelector(".shelf__group-title")?.textContent || "";
      var rank = order.findIndex(function (part) {
        return text.indexOf(part) >= 0;
      });
      group.style.order = String(rank < 0 ? 99 : rank);
    });
  });

  document.querySelectorAll(".rail").forEach(function (rail, moduleIndex) {
    var items = Array.prototype.slice.call(rail.querySelectorAll(":scope > .rail__item"));
    var label =
      rail.closest(".shelf__group")?.querySelector(".shelf__group-title")?.textContent ||
      rail.closest(".shelf")?.querySelector(".shelf__title")?.textContent ||
      "skillskr";
    items
      .map(function (item) {
        var href = item.querySelector("a")?.getAttribute("href") || "";
        return {
          item: item,
          score: hash(label.trim() + "::" + href + "::v3::" + moduleIndex),
        };
      })
      .sort(function (a, b) {
        return a.score - b.score;
      })
      .forEach(function (entry) {
        rail.appendChild(entry.item);
      });
  });
})();
