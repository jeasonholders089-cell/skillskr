/* Landing v5: original-style playful hero, rearranged editorial catalog. */
(function () {
  "use strict";

  document.body.classList.add("sk-landing-v4", "sk-landing-v5");
  document.documentElement.setAttribute("data-landing-version", "v5");

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
    title.innerHTML = "Give your agent<br><em>better taste.</em>";
    title.insertAdjacentHTML(
      "beforebegin",
      '<p class="sk-v5-kicker">skillskr / curated agent skills</p>'
    );
    title.insertAdjacentHTML(
      "afterend",
      '<p class="sk-v5-lede">A hand-picked library of skills for web, decks, imagery and motion—built to make AI output feel intentional, not generic.</p>' +
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
      '<a class="btn btn--dark" href="/skills">Browse 402 skills <span aria-hidden="true">↓</span></a>' +
      '<a class="btn btn--outline" href="/ai-videos">See AI videos</a>';
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
          score: hash(label.trim() + "::" + href + "::v5::" + moduleIndex),
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
