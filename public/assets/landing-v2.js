/* Landing v2: editorial hero, curated paths and stable module-level reordering. */
(function () {
  "use strict";

  document.body.classList.add("sk-landing");
  document.documentElement.setAttribute("data-landing-version", "v2");

  function hash(value) {
    let h = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  var titleWrap = document.querySelector(".hero__title-wrap");
  var title = titleWrap && titleWrap.querySelector(".hero__title");
  if (title) {
    title.innerHTML = "Independent<br>skills.<br><em>Serious output.</em>";
    title.insertAdjacentHTML(
      "beforebegin",
      '<p class="sk-kicker">Independent agent skills studio</p>'
    );
    title.insertAdjacentHTML(
      "afterend",
      '<p class="sk-hero__lede">A sharper skill layer for web, slides, imagery and motion. Curated for the agent you already trust—not another generic AI template.</p>' +
        '<div class="sk-hero__metrics">' +
        '<div class="sk-hero__metric"><strong>402</strong><span>field-tested Skills</span></div>' +
        '<div class="sk-hero__metric"><strong>43</strong><span>free to start</span></div>' +
        '<div class="sk-hero__metric"><strong>261</strong><span>motion previews</span></div>' +
        '<div class="sk-hero__metric"><strong>9</strong><span>agent surfaces</span></div>' +
        "</div>"
    );
  }

  var ctas = document.querySelector(".hero__ctas");
  if (ctas) {
    ctas.innerHTML =
      '<a class="btn btn--dark" href="/skills">Explore the marketplace <span aria-hidden="true">↗</span></a>' +
      '<a class="btn btn--outline" href="/ai-videos">Watch AI videos</a>';
  }

  var stage = document.querySelector(".hero__stage");
  if (stage && !stage.querySelector(".sk-stage-stamp")) {
    stage.insertAdjacentHTML(
      "beforeend",
      '<div class="sk-stage-stamp"><strong>402</strong><span>Skills · 4 formats<br>one visual language</span></div>'
    );
  }

  var shelves = document.querySelector(".shelves");
  if (shelves && !document.querySelector(".sk-paths")) {
    shelves.insertAdjacentHTML(
      "beforebegin",
      '<section class="sk-paths" aria-label="Explore Skills by output">' +
        '<a class="sk-path" href="/skills?output=Web" style="--path-accent:#d9ff69"><span class="sk-path__num">01 / WEB</span><strong>Web systems</strong><span>Landing pages, dashboards and product surfaces.</span></a>' +
        '<a class="sk-path" href="/skills?output=Slides" style="--path-accent:#cbbdff"><span class="sk-path__num">02 / SLIDES</span><strong>Story decks</strong><span>Narrative decks with a point of view.</span></a>' +
        '<a class="sk-path" href="/skills?output=Video" style="--path-accent:#ffb48e"><span class="sk-path__num">03 / VIDEO</span><strong>Motion work</strong><span>Launch films, reels and kinetic type.</span></a>' +
        '<a class="sk-path" href="/skills?output=Image" style="--path-accent:#8fe2d3"><span class="sk-path__num">04 / IMAGE</span><strong>Visual systems</strong><span>OG images, posters and illustration sets.</span></a>' +
        "</section>"
    );
  }

  document.querySelectorAll(".shelves > .shelf").forEach(function (shelf, index) {
    var heading = shelf.querySelector(":scope > .shelf__header .shelf__title");
    if (heading) heading.innerHTML = heading.innerHTML.replace(/[🔥🏆]\s*/g, "");
    shelf.setAttribute("data-module-order", String(index + 1));
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
        return { item: item, score: hash(label.trim() + "::" + href + "::" + moduleIndex) };
      })
      .sort(function (a, b) {
        return a.score - b.score;
      })
      .forEach(function (entry) {
        rail.appendChild(entry.item);
      });
  });
})();
