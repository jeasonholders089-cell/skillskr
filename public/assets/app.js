/* Skillry replica — small, dependency-free interaction layer. */
(function () {
  "use strict";

  var root = document.documentElement;
  var storage = {
    get: function (k) {
      try {
        return localStorage.getItem(k);
      } catch (e) {
        return null;
      }
    },
    set: function (k, v) {
      try {
        localStorage.setItem(k, v);
      } catch (e) {
        /* ignore */
      }
    },
  };

  /* --- promo banner ------------------------------------------------------- */
  var banner = document.querySelector("[data-promo-banner]");
  var dismissed = storage.get("skillry:banner") === "dismissed";

  function syncBanner() {
    var h = banner && !banner.hidden ? banner.offsetHeight : 0;
    root.style.setProperty("--promo-banner-height", h + "px");
    var header = document.querySelector(".site-header");
    if (header) {
      root.style.setProperty("--header-bottom", h + header.offsetHeight + "px");
    }
  }

  if (banner) {
    if (dismissed) {
      banner.hidden = true;
    }
    var dismiss = banner.querySelector("[data-banner-dismiss]");
    if (dismiss) {
      dismiss.addEventListener("click", function () {
        banner.hidden = true;
        storage.set("skillry:banner", "dismissed");
        syncBanner();
      });
    }
  }

  syncBanner();
  window.addEventListener("resize", syncBanner);
  window.addEventListener("load", syncBanner);

  /* --- theme -------------------------------------------------------------- */
  function applyTheme(mode) {
    var resolved = mode;
    if (mode === "system" || !mode) {
      resolved = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    root.setAttribute("data-theme", resolved);
    document.querySelectorAll("[data-theme-option]").forEach(function (el) {
      el.setAttribute("aria-checked", String(el.getAttribute("data-theme-option") === (mode || "system")));
    });
  }

  var savedTheme = storage.get("skillry:theme");
  applyTheme(savedTheme || "system");

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
    if ((storage.get("skillry:theme") || "system") === "system") {
      applyTheme("system");
    }
  });

  document.querySelectorAll("[data-theme-set]").forEach(function (el) {
    el.addEventListener("click", function () {
      var mode = el.getAttribute("data-theme-set");
      storage.set("skillry:theme", mode);
      applyTheme(mode);
      closeMenus();
    });
  });

  document.querySelectorAll("[data-theme-toggle]").forEach(function (el) {
    el.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      storage.set("skillry:theme", next);
      applyTheme(next);
    });
  });

  /* --- dropdown menus ----------------------------------------------------- */
  var dropdowns = Array.prototype.slice.call(document.querySelectorAll(".nav__dropdown"));
  var scrim = document.querySelector("[data-menu-scrim]");

  function syncScrim() {
    if (!scrim) return;
    var anyOpen = dropdowns.some(function (d) {
      return d.getAttribute("data-open") === "true";
    });
    scrim.hidden = !anyOpen;
  }

  function closeMenus(except) {
    dropdowns.forEach(function (d) {
      if (d !== except) {
        d.setAttribute("data-open", "false");
        var t = d.querySelector(".nav__trigger");
        if (t) t.setAttribute("aria-expanded", "false");
      }
    });
    syncScrim();
  }

  dropdowns.forEach(function (d) {
    var trigger = d.querySelector(".nav__trigger");
    if (!trigger) return;
    var hideTimer;

    function open() {
      window.clearTimeout(hideTimer);
      closeMenus(d);
      d.setAttribute("data-open", "true");
      trigger.setAttribute("aria-expanded", "true");
      syncScrim();
    }

    function close() {
      d.setAttribute("data-open", "false");
      trigger.setAttribute("aria-expanded", "false");
      syncScrim();
    }

    trigger.addEventListener("click", function () {
      if (d.getAttribute("data-open") === "true") {
        close();
      } else {
        open();
      }
    });

    d.addEventListener("mouseenter", function () {
      if (window.matchMedia("(hover: hover)").matches) open();
    });
    d.addEventListener("mouseleave", function () {
      if (!window.matchMedia("(hover: hover)").matches) return;
      hideTimer = window.setTimeout(close, 140);
    });
    d.addEventListener("focusout", function (event) {
      if (!d.contains(event.relatedTarget)) close();
    });
  });

  /* categories menu tabs */
  document.querySelectorAll("[data-cat-tabs]").forEach(function (tabs) {
    var buttons = Array.prototype.slice.call(tabs.querySelectorAll("[role='tab']"));
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        buttons.forEach(function (b) {
          var panel = document.getElementById(b.getAttribute("aria-controls"));
          var active = b === btn;
          b.setAttribute("aria-selected", String(active));
          if (panel) panel.setAttribute("data-active", String(active));
        });
      });
    });
  });

  /* --- search dialog ------------------------------------------------------ */
  var dialog = document.querySelector("[data-search-dialog]");

  function openDialog() {
    if (!dialog) return;
    dialog.setAttribute("data-open", "true");
    var input = dialog.querySelector("input");
    if (input) {
      input.value = "";
      filterItems("");
      window.setTimeout(function () {
        input.focus();
      }, 30);
    }
    selectItem(0);
  }

  function closeDialog() {
    if (dialog) dialog.setAttribute("data-open", "false");
  }

  function filterItems(query) {
    if (!dialog) return;
    var q = query.trim().toLowerCase();
    dialog.querySelectorAll("[data-search-item]").forEach(function (item) {
      var hit = !q || item.textContent.toLowerCase().indexOf(q) !== -1;
      item.hidden = !hit;
    });
    dialog.querySelectorAll(".dialog__group").forEach(function (group) {
      var visible = group.querySelector("[data-search-item]:not([hidden])");
      group.hidden = !visible;
    });
    dialog.querySelectorAll(".search-group").forEach(function (group) {
      var visible = group.querySelector("[data-search-item]:not([hidden])");
      group.hidden = !visible;
    });
    selectItem(0);
  }

  function visibleItems() {
    if (!dialog) return [];
    return Array.prototype.slice.call(dialog.querySelectorAll("[data-search-item]")).filter(function (el) {
      return !el.hidden && !(el.closest(".search-group") || {}).hidden;
    });
  }

  function selectItem(index) {
    var items = visibleItems();
    items.forEach(function (el, i) {
      el.classList.toggle("is-selected", i === index);
    });
    dialog.__index = index;
    var el = items[index];
    if (!el) return;
    var box = dialog.querySelector(".search-dialog__list, .dialog__body");
    if (!box) return;
    var above = el.offsetTop < box.scrollTop;
    var below = el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight;
    if (above || below) {
      box.scrollTop =
        el.offsetTop - Math.round(box.clientHeight / 2) + Math.round(el.offsetHeight / 2);
    }
  }

  document.querySelectorAll("[data-search-open]").forEach(function (el) {
    el.addEventListener("click", openDialog);
  });

  document.querySelectorAll("[data-search-close]").forEach(function (el) {
    el.addEventListener("click", closeDialog);
  });

  if (dialog) {
    var input = dialog.querySelector("input");
    if (input) {
      input.addEventListener("input", function () {
        filterItems(input.value);
      });
    }
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) closeDialog();
    });
    dialog.addEventListener("mousemove", function (event) {
      var item = event.target.closest("[data-search-item]");
      if (!item) return;
      var items = visibleItems();
      var index = items.indexOf(item);
      if (index !== -1 && index !== dialog.__index) selectItem(index);
    });
    dialog.addEventListener("keydown", function (event) {
      var items = visibleItems();
      if (!items.length) return;
      if (event.key === "ArrowDown") {
        selectItem(Math.min(items.length - 1, (dialog.__index || 0) + 1));
        event.preventDefault();
      } else if (event.key === "ArrowUp") {
        selectItem(Math.max(0, (dialog.__index || 0) - 1));
        event.preventDefault();
      } else if (event.key === "Enter") {
        var current = items[dialog.__index || 0];
        if (current) current.click();
      }
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeMenus();
      closeDialog();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openDialog();
    }
  });

  document.addEventListener("click", function (event) {
    if (!event.target.closest(".nav__dropdown")) closeMenus();
  });

  /* --- mobile sheet ------------------------------------------------------- */
  var sheet = document.querySelector("[data-mobile-sheet]");
  var sheetTrigger = document.querySelector("[data-mobile-trigger]");
  if (sheet && sheetTrigger) {
    sheetTrigger.addEventListener("click", function () {
      var open = sheet.getAttribute("data-open") === "true";
      sheet.setAttribute("data-open", String(!open));
      sheetTrigger.setAttribute("aria-expanded", String(!open));
    });
    sheet.addEventListener("click", function (event) {
      if (event.target === sheet) {
        sheet.setAttribute("data-open", "false");
        sheetTrigger.setAttribute("aria-expanded", "false");
      }
    });
  }

  /* --- collect buttons ---------------------------------------------------- */
  document.querySelectorAll("[data-collect]").forEach(function (btn) {
    btn.addEventListener("click", function (event) {
      event.preventDefault();
      var on = btn.getAttribute("data-active") === "true";
      btn.setAttribute("data-active", String(!on));
      btn.setAttribute("aria-pressed", String(!on));
    });
  });

  /* --- rails: next button + keyboard scrolling ----------------------------- */
  function syncRailButton(rail) {
    var wrap = rail.parentElement;
    var btn = wrap && wrap.querySelector("[data-rail-next]");
    if (!btn) return;
    var atEnd = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 2;
    btn.hidden = atEnd;
  }

  document.querySelectorAll(".rail").forEach(function (rail) {
    rail.setAttribute("tabindex", "0");
    var btn = rail.parentElement && rail.parentElement.querySelector("[data-rail-next]");
    if (btn) {
      btn.addEventListener("click", function () {
        var item = rail.firstElementChild;
        var gap = parseFloat(getComputedStyle(rail).columnGap) || 20;
        var step = item ? item.getBoundingClientRect().width + gap : 308;
        rail.scrollBy({ left: step, behavior: "smooth" });
      });
    }
    rail.addEventListener("scroll", function () {
      syncRailButton(rail);
    });
    syncRailButton(rail);
    rail.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      var step = rail.firstElementChild ? rail.firstElementChild.offsetWidth + 20 : 320;
      rail.scrollBy({ left: event.key === "ArrowRight" ? step : -step, behavior: "smooth" });
      event.preventDefault();
    });
  });

})();
