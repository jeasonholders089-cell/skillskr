/* Landing v4: product-led storefront with a consistent category bento. */
(function () {
  "use strict";

  document.body.classList.add("sk-landing-v4");
  document.documentElement.setAttribute("data-landing-version", "v4");

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
    title.innerHTML = "Skills for work<br>that looks <em>considered.</em>";
    title.insertAdjacentHTML(
      "beforebegin",
      '<p class="sk-v4-kicker">skillskr / a curated agent skill studio</p>'
    );
    title.insertAdjacentHTML(
      "afterend",
      '<p class="sk-v4-lede">402 practical skills for web, decks, imagery and motion. Built to give the agent you already use a sharper visual instinct.</p>' +
        '<div class="sk-v4-metrics">' +
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
  if (stage && !stage.querySelector(".sk-v4-bento")) {
    stage.insertAdjacentHTML(
      "beforeend",
      '<div class="sk-v4-bento">' +
        '<a class="sk-v4-tile" href="/skills?output=Web"><img src="/assets/skills/bs-cadence-marketing-landing/media/preview-1.webp" alt="" loading="eager"><span class="sk-v4-tile__copy"><strong>Web systems</strong><small>114 skills</small></span></a>' +
        '<a class="sk-v4-tile" href="/skills?output=Slides"><img src="/assets/skills/bs-brand-story-deck/media/preview-1.webp" alt="" loading="eager"><span class="sk-v4-tile__copy"><strong>Story decks</strong><small>60 skills</small></span></a>' +
        '<a class="sk-v4-tile" href="/skills?output=Video"><img src="/assets/skills/bs-linear-agent-style-launch-video/media/preview-1.webp" alt="" loading="eager"><span class="sk-v4-tile__copy"><strong>Motion work</strong><small>146 skills</small></span></a>' +
        '<a class="sk-v4-tile" href="/skills?output=Image"><img src="/assets/skills/bs-dot-avatar-maker/media/preview-1.webp" alt="" loading="eager"><span class="sk-v4-tile__copy"><strong>Visual systems</strong><small>82 skills</small></span></a>' +
        "</div>"
    );
  }

  document.querySelectorAll(".shelves > .shelf").forEach(function (shelf) {
    var heading = shelf.querySelector(":scope > .shelf__header .shelf__title");
    if (heading) heading.innerHTML = heading.innerHTML.replace(/[🔥🏆]\s*/g, "");
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
          score: hash(label.trim() + "::" + href + "::v4::" + moduleIndex),
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
