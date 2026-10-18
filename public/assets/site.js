/* App layer: auth state, sign-in dialog, subscription banner and checkout.
   Loaded after app.js (which owns the storefront chrome). */
(function () {
  "use strict";

  var state = { me: null, entitlements: null, subscription: null, config: null };
  var planNames = {};

  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }
  function qsa(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function api(path, options) {
    var opts = options || {};
    return fetch(path, {
      method: opts.method || "GET",
      headers: opts.body ? { "content-type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch (_) {
          data = text;
        }
        if (!res.ok) {
          var err = new Error((data && data.error && data.error.message) || "Request failed");
          err.status = res.status;
          err.payload = data;
          throw err;
        }
        return data;
      });
    });
  }

  /* ------------------------------------------------------------- bootstrap */

  Promise.all([
    api("/api/auth/me"),
    api("/api/config").catch(function () {
      return { googleEnabled: false };
    }),
    api("/api/billing/entitlements").catch(function () {
      return { entitlements: null };
    }),
    api("/api/billing/subscription").catch(function () {
      return { subscription: null };
    }),
    api("/api/billing/plans").catch(function () {
      return { plans: [] };
    }),
  ])
    .then(function (results) {
      state.me = results[0];
      state.config = results[1];
      state.entitlements = results[2].entitlements;
      state.subscription = results[3].subscription;
      (results[4].plans || []).forEach(function (item) {
        planNames[item.code] = item.name;
      });
      ensureAuthModal();
      renderAuthSlot();
      renderSubBanner();
      renderAuthError();
      bindDelegates();
    })
    .catch(function (err) {
      console.error("[site] bootstrap failed", err);
      ensureAuthModal();
      renderAuthSlot();
      bindDelegates();
    });

  /* ---------------------------------------------------------- auth dialog  */

  function ensureAuthModal() {
    var existing = qs("[data-auth-modal]");
    if (existing) {
      dialog = existing;
      return existing;
    }
    var googleEnabled = Boolean(state.config && state.config.googleEnabled);
    var overlay = document.createElement("div");
    overlay.className = "auth-overlay";
    overlay.setAttribute("data-auth-modal", "");
    overlay.setAttribute("data-open", "false");
    overlay.setAttribute("role", "presentation");
    overlay.innerHTML =
      '<div class="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-title">' +
      '<button type="button" class="auth-close" data-auth-close aria-label="Close">&times;</button>' +
      '<h2 class="auth-title" id="auth-title">Welcome to Skillry</h2>' +
      '<p class="auth-sub">Sign in to install Skills and manage your workspace.</p>' +
      '<div class="auth-tabs" role="tablist">' +
      '<button type="button" class="auth-tab is-active" data-auth-tab="login" role="tab">Sign in</button>' +
      '<button type="button" class="auth-tab" data-auth-tab="register" role="tab">Create account</button>' +
      "</div>" +
      '<form class="auth-form" data-auth-form>' +
      '<label class="auth-field"><span>Email</span>' +
      '<input type="email" name="email" autocomplete="email" required placeholder="you@example.com"></label>' +
      '<label class="auth-field" data-auth-name-field hidden><span>Your name</span>' +
      '<input type="text" name="name" autocomplete="name" placeholder="Ada Lovelace"></label>' +
      '<label class="auth-field" data-auth-workspace-field hidden><span>Workspace name <em>(optional)</em></span>' +
      '<input type="text" name="workspaceName" placeholder="My studio"></label>' +
      '<label class="auth-field"><span>Password</span>' +
      '<input type="password" name="password" autocomplete="current-password" minlength="10" required placeholder="At least 10 characters"></label>' +
      '<p class="auth-error" data-auth-error hidden></p>' +
      '<button type="submit" class="btn btn--dark btn--block" data-auth-submit>Sign in</button>' +
      "</form>" +
      (googleEnabled
        ? '<div class="auth-divider"><span>or</span></div>' +
          '<a class="btn btn--outline btn--block" href="/auth/google">Continue with Google</a>'
        : "") +
      '<p class="auth-fine">By continuing you agree to the terms of service.</p>' +
      "</div>";
    document.body.appendChild(overlay);
    dialog = overlay;
    var form = qs("[data-auth-form]", overlay);
    if (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        submitAuth();
      });
    }
    return overlay;
  }

  /* ------------------------------------------------------------ auth slot  */

  function initials(user) {
    var source = (user && (user.name || user.email)) || "?";
    return source.trim().charAt(0).toUpperCase();
  }

  function renderAuthSlot() {
    var slot = qs("[data-auth-slot]");
    if (!slot) return;
    var me = state.me;
    var user = me && me.user;

    if (!user) {
      slot.innerHTML = '<button type="button" class="btn-signin" data-auth-open>Sign In</button>';
      return;
    }

    var plan = state.entitlements && state.entitlements.active
      ? planLabel(state.entitlements.planCode)
      : "No subscription";

    var tenants = (me.tenants || [])
      .map(function (tenant) {
        var current = tenant.id === me.activeTenantId;
        return (
          '<button type="button" class="user-pop__tenant" data-switch-tenant="' +
          tenant.id +
          '" aria-current="' +
          current +
          '">' +
          (current ? "✓ " : "") +
          escapeHtml(tenant.name) +
          " <span class='user-pop__role'>" +
          tenant.role +
          "</span></button>"
        );
      })
      .join("");

    slot.innerHTML =
      '<div class="nav__dropdown" data-user-menu data-open="false" style="position:relative">' +
      '<button type="button" class="user-chip" data-user-trigger aria-expanded="false">' +
      '<span class="user-chip__avatar">' +
      initials(user) +
      "</span>" +
      '<span class="user-chip__name">' +
      escapeHtml(user.name || user.email) +
      "</span>" +
      "</button>" +
      '<div class="user-pop" data-user-pop hidden>' +
      '<div class="user-pop__head">' +
      '<p class="user-pop__email">' +
      escapeHtml(user.email) +
      "</p>" +
      '<p class="user-pop__plan">' +
      (state.entitlements && state.entitlements.active
        ? escapeHtml(plan) + (state.entitlements.expiresAt ? " · renews " + formatDate(state.entitlements.expiresAt) : "")
        : "Free plan") +
      "</p></div>" +
      '<p class="user-pop__label">Workspace</p>' +
      tenants +
      '<p class="user-pop__label">Billing</p>' +
      '<button type="button" class="user-pop__item" data-open-portal>Manage subscription</button>' +
      '<button type="button" class="user-pop__item user-pop__item--danger" data-sign-out>Sign out</button>' +
      "</div></div>";

    var trigger = qs("[data-user-trigger]", slot);
    var pop = qs("[data-user-pop]", slot);
    if (trigger && pop) {
      trigger.addEventListener("click", function (event) {
        event.stopPropagation();
        var open = pop.hidden;
        pop.hidden = !open;
        trigger.setAttribute("aria-expanded", String(open));
      });
    }
  }

  /* ------------------------------------------------------- subscription bar */

  function renderSubBanner() {
    var host = qs("[data-sub-banner]");
    if (!host) return;
    var ent = state.entitlements;
    var sub = state.subscription;
    if (!ent || !ent.active) {
      host.innerHTML = "";
      return;
    }
    var detail = sub && sub.currentPeriodEnd
      ? "Renews " + formatDate(sub.currentPeriodEnd)
      : "No renewal";
    if (sub && sub.cancelAtPeriodEnd) detail = "Ends " + formatDate(sub.currentPeriodEnd);

    host.innerHTML =
      '<div class="sub-banner"><div class="sub-banner__inner">' +
      '<span class="sub-banner__dot"></span>' +
      '<span class="sub-banner__text"><strong>' +
      escapeHtml(planLabel(ent.planCode || "Pro")) +
      "</strong> is active on this workspace · " +
      escapeHtml(detail) +
      "</span>" +
      '<span class="sub-banner__actions">' +
      '<button type="button" class="sub-banner__btn" data-open-portal>Manage</button>' +
      "</span></div></div>";
  }

  /* ------------------------------------------------------------ auth error  */

  var AUTH_HINTS = {
    access_denied:
      "Google sign-in was cancelled, or that account is not on the OAuth test-user list.",
    redirect_uri_mismatch: "The OAuth redirect URI does not match the one registered with Google.",
    invalid_client: "GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is incorrect.",
    invalid_grant: "That sign-in link expired. Try again.",
    google_unreachable: "The server cannot reach Google. Configure OUTBOUND_PROXY_URL or host it where Google is reachable.",
    unavailable: "Google sign-in is not configured on this server.",
  };

  function renderAuthError() {
    var params = new URLSearchParams(location.search);
    var code = params.get("auth_error");
    if (!code) return;
    var message = AUTH_HINTS[code] || code;
    var detail = params.get("auth_message");

    var bar = document.createElement("div");
    bar.className = "auth-banner";
    bar.innerHTML =
      '<span><strong>Sign-in failed.</strong> ' +
      escapeHtml(message) +
      (detail ? ' <span class="auth-banner__detail">' + escapeHtml(detail.slice(0, 240)) + "</span>" : "") +
      "</span>" +
      '<button type="button" class="auth-banner__close" aria-label="Dismiss">×</button>';
    bar.addEventListener("click", function (event) {
      if (event.target.closest(".auth-banner__close")) bar.remove();
    });
    document.body.insertBefore(bar, document.body.firstChild);
    history.replaceState(null, "", location.pathname + location.hash);
  }

  /* ---------------------------------------------------------- auth dialog  */

  var dialog = null;
  var mode = "login";

  function openAuth(nextTab) {
    dialog = dialog || qs("[data-auth-modal]");
    if (!dialog) return;
    dialog.setAttribute("data-open", "true");
    setMode(nextTab || mode);
    var email = qs('input[name="email"]', dialog);
    if (email) setTimeout(function () { email.focus(); }, 40);
  }

  function closeAuth() {
    if (dialog) dialog.setAttribute("data-open", "false");
  }

  function setMode(next) {
    mode = next;
    if (!dialog) return;
    qsa("[data-auth-tab]", dialog).forEach(function (tab) {
      tab.classList.toggle("is-active", tab.getAttribute("data-auth-tab") === mode);
    });
    var nameField = qs("[data-auth-name-field]", dialog);
    var workspaceField = qs("[data-auth-workspace-field]", dialog);
    var submit = qs("[data-auth-submit]", dialog);
    if (nameField) nameField.hidden = mode !== "register";
    if (workspaceField) workspaceField.hidden = mode !== "register";
    if (submit) submit.textContent = mode === "register" ? "Create account" : "Sign in";
    showError("");
  }

  function showError(message) {
    if (!dialog) return;
    var box = qs("[data-auth-error]", dialog);
    if (!box) return;
    box.textContent = message || "";
    box.hidden = !message;
  }

  function submitAuth() {
    if (!dialog) return;
    var form = qs("[data-auth-form]", dialog);
    if (!form) return;
    var data = new FormData(form);
    var payload = {
      email: String(data.get("email") || "").trim(),
      password: String(data.get("password") || ""),
    };
    if (mode === "register") {
      payload.name = String(data.get("name") || "").trim() || undefined;
      payload.workspaceName = String(data.get("workspaceName") || "").trim() || undefined;
    }

    var submit = qs("[data-auth-submit]", dialog);
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Please wait…";
    }
    api(mode === "register" ? "/api/auth/register" : "/api/auth/login", {
      method: "POST",
      body: payload,
    })
      .then(function () {
        location.reload();
      })
      .catch(function (err) {
        showError(err.message || "Something went wrong.");
        if (submit) {
          submit.disabled = false;
          submit.textContent = mode === "register" ? "Create account" : "Sign in";
        }
      });
  }

  /* ------------------------------------------------------------- checkout  */

  function startCheckout(planCode) {
    var button = qs('[data-plan-code="' + planCode + '"]') || qs("[data-subscribe-plan]");
    var label = button ? button.textContent : "";
    if (button) {
      button.disabled = true;
      button.textContent = "Opening checkout…";
    }

    api("/api/billing/checkout", { method: "POST", body: { planCode: planCode } })
      .then(function (session) {
        window.open(session.checkoutUrl, "_blank", "noopener,noreferrer");
        if (button) {
          button.textContent = "Checkout opened in a new tab";
          setTimeout(function () {
            button.disabled = false;
            button.textContent = label;
          }, 4000);
        }
      })
      .catch(function (err) {
        if (button) {
          button.disabled = false;
          button.textContent = label;
        }
        if (err.status === 401) {
          openAuth("login");
          return;
        }
        showToast(err.message || "Could not start checkout.");
      });
  }

  function openPortal() {
    api("/api/billing/portal", { method: "POST" })
      .then(function (data) {
        window.open(data.portalUrl, "_blank", "noopener,noreferrer");
      })
      .catch(function (err) {
        if (err.status === 401) return openAuth("login");
        showToast(err.message || "Could not open the customer portal.");
      });
  }

  function startDownload(slug, button) {
    var label = button ? button.textContent : "";
    if (button) {
      button.disabled = true;
      button.textContent = "Preparing...";
    }
    api("/api/skills/" + encodeURIComponent(slug) + "/download", { method: "POST" })
      .then(function (ticket) {
        var link = document.createElement("a");
        link.href = ticket.url;
        link.download = ticket.filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        showToast("Download started - " + ticket.filename);
        if (button) {
          button.textContent = label;
          button.disabled = false;
        }
      })
      .catch(function (err) {
        if (button) {
          button.textContent = label;
          button.disabled = false;
        }
        if (err.status === 401) {
          openAuth("login");
          return;
        }
        showToast(err.message || "Could not prepare the download.");
      });
  }

  function showToast(message) {
    var toast = document.createElement("div");
    toast.className = "app-toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function () {
      toast.classList.add("is-leaving");
      setTimeout(function () { toast.remove(); }, 300);
    }, 5200);
  }

  /* ------------------------------------------------------------- delegates  */

  function bindDelegates() {
    document.addEventListener("click", function (event) {
      var target = event.target;

      if (target.closest("[data-auth-open]")) {
        event.preventDefault();
        openAuth("login");
        return;
      }
      if (target.closest("[data-auth-close]")) {
        closeAuth();
        return;
      }
      if (target.closest("[data-auth-tab]")) {
        setMode(target.closest("[data-auth-tab]").getAttribute("data-auth-tab"));
        return;
      }
      var planButton = target.closest("[data-plan-code], [data-subscribe-plan]");
      if (planButton) {
        event.preventDefault();
        startCheckout(planButton.getAttribute("data-plan-code") || planButton.getAttribute("data-subscribe-plan"));
        return;
      }
      if (target.closest("[data-open-portal]")) {
        event.preventDefault();
        openPortal();
        return;
      }
      var downloadButton = target.closest("[data-download-skill]");
      if (downloadButton) {
        event.preventDefault();
        startDownload(downloadButton.getAttribute("data-download-skill"), downloadButton);
        return;
      }
      if (target.closest("[data-switch-tenant]")) {
        var tenantId = target.closest("[data-switch-tenant]").getAttribute("data-switch-tenant");
        api("/api/auth/active-tenant", { method: "POST", body: { tenantId: tenantId } }).then(function () {
          location.reload();
        });
        return;
      }
      if (target.closest("[data-sign-out]")) {
        api("/api/auth/logout", { method: "POST" }).then(function () {
          location.reload();
        });
        return;
      }
      // click outside the user menu closes it
      if (!target.closest("[data-user-menu]")) {
        var pop = qs("[data-user-pop]");
        if (pop && !pop.hidden) pop.hidden = true;
      }
      if (dialog && event.target === dialog) closeAuth();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeAuth();
    });

  }

  /* ---------------------------------------------------------------- utils  */

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function planLabel(code) {
    if (!code) return "Pro";
    return planNames[code] || code;
  }

  function formatDate(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch (_) {
      return iso;
    }
  }
})();
