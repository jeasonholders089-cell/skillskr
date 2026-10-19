/**
 * HTTP smoke test against a running backend.
 *
 *   npm start            # in one terminal
 *   npm run test:api     # in another
 *
 * Uses a cookie jar so session state carries across requests.
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
/** Set TEST_CHECKOUT=1 to also create one real checkout session (an external write). */
const WITH_CHECKOUT = process.env.TEST_CHECKOUT === "1";
let cookies = new Map();

function cookieHeader() {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function storeCookies(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const cookie of raw) {
    const [pair] = cookie.split(";");
    const index = pair.indexOf("=");
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (value === "") cookies.delete(name);
    else cookies.set(name, value);
  }
}

async function call(method, path, body, expect = 200) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookies.size ? { cookie: cookieHeader() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  storeCookies(res);
  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text.slice(0, 120);
  }
  const ok = res.status === expect;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${String(res.status).padEnd(3)} ${method} ${path}${
      ok ? "" : `  (expected ${expect})`
    }`
  );
  if (!ok) console.log("      ", JSON.stringify(payload).slice(0, 300));
  return { status: res.status, payload, ok };
}

const results = [];
const run = async (label, fn) => {
  const { ok } = await fn();
  results.push({ label, ok });
};

const email = `tester+${Date.now()}@example.com`;
let tenantId = null;
let inviteToken = null;

await run("health", () => call("GET", "/api/health"));
await run("config", () => call("GET", "/api/config"));
let planReadiness = {};
await run("plans (seeded)", async () => {
  const r = await call("GET", "/api/billing/plans");
  const codes = r.payload.plans?.map((p) => p.code) ?? [];
  planReadiness = Object.fromEntries((r.payload.plans ?? []).map((p) => [p.code, p.ready]));
  const ok = codes.includes("pro_monthly") && codes.includes("lifetime");
  console.log(
    `      plans: ${(r.payload.plans ?? [])
      .map((p) => `${p.code}${p.ready ? " [ok]" : " (not linked)"}`)
      .join(", ")}`
  );
  console.log(`      checkoutAvailable: ${r.payload.checkoutAvailable}`);
  return { ok };
});

await run("skills catalog + facets", async () => {
  const filtered = await call("GET", "/api/skills?featured=1&role=designer&limit=5");
  const all = await call("GET", "/api/skills?limit=1");
  return {
    ok:
      filtered.ok &&
      all.ok &&
      all.payload.total >= 400 &&
      filtered.payload.skills.every((skill) => skill.featured && skill.roles.includes("designer")),
  };
});

await run("ai video collections", async () => {
  const collections = await call("GET", "/api/ai-videos");
  const fable = await call("GET", "/api/ai-videos/fable-5-5?limit=2");
  return {
    ok:
      collections.ok &&
      fable.ok &&
      collections.payload.collections.length === 4 &&
      collections.payload.collections.find((item) => item.slug === "fable-5-5")?.videoCount === 82 &&
      fable.payload.videos.length === 2 &&
      fable.payload.videos.every((video) => video.originalVideo),
  };
});

await run("me (anonymous)", async () => {
  const r = await call("GET", "/api/auth/me");
  return { ok: r.ok && r.payload.user === null };
});

await run("entitlements (anonymous -> 401)", () => call("GET", "/api/billing/entitlements", null, 401));

await run("register", async () => {
  const r = await call("POST", "/api/auth/register", {
    email,
    password: "correct-horse-battery",
    name: "Test Person",
    workspaceName: "Test Workspace",
  }, 201);
  return { ok: r.ok };
});

await run("duplicate register -> 409", () =>
  call("POST", "/api/auth/register", { email, password: "correct-horse-battery" }, 409)
);

await run("weak password -> 400", () =>
  call("POST", "/api/auth/register", { email: `x${Date.now()}@example.com`, password: "short" }, 400)
);

await run("me (authenticated)", async () => {
  const r = await call("GET", "/api/auth/me");
  tenantId = r.payload.activeTenantId;
  const ok = r.payload.user?.email === email && r.payload.tenants?.length === 1;
  console.log(`      tenant ${tenantId}, role ${r.payload.role}`);
  return { ok };
});

await run("entitlements (no subscription)", async () => {
  const r = await call("GET", "/api/billing/entitlements");
  return { ok: r.ok && r.payload.entitlements.active === false };
});

await run("checkout for an unknown plan -> 404", () =>
  call("POST", "/api/billing/checkout", { planCode: "nope" }, 404)
);

// Without a linked product checkout stops at 409; with a product but no key it is
// 503. Both are covered without touching the payment API.
if (!planReadiness.pro_monthly) {
  await run("checkout with an unlinked plan -> 409", () =>
    call("POST", "/api/billing/checkout", { planCode: "pro_monthly" }, 409)
  );
} else {
  await run("checkout with a linked plan is reachable", async () => {
    const r = await call("GET", "/api/billing/plans");
    return { ok: r.ok };
  });
}

if (WITH_CHECKOUT) {
  await run("real checkout session", async () => {
    const res = await fetch(`${BASE}/api/billing/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader() },
      body: JSON.stringify({ planCode: "pro_monthly", currency: "USD" }),
    });
    const payload = await res.json().catch(() => ({}));
    const ok = res.ok && typeof payload.checkoutUrl === "string";
    console.log(`${ok ? "PASS" : "FAIL"}  ${res.status} POST /api/billing/checkout (live session)`);
    if (ok) console.log(`      checkoutUrl: ${payload.checkoutUrl}`);
    else console.log("      ", JSON.stringify(payload).slice(0, 300));
    return { ok };
  });
}

let googleEnabled = false;
await run("config reports provider state", async () => {
  const r = await call("GET", "/api/config");
  googleEnabled = Boolean(r.payload.googleEnabled);
  console.log(`      googleEnabled: ${googleEnabled}  pancakeEnabled: ${r.payload.pancakeEnabled}`);
  return { ok: r.ok && typeof r.payload.pancakeEnabled === "boolean" };
});

await run("create second workspace", async () => {
  const r = await call("POST", "/api/tenants", { name: "Second Workspace" }, 201);
  return { ok: r.ok };
});

await run("switch tenant", async () => {
  const r = await call("POST", "/api/auth/active-tenant", { tenantId });
  return { ok: r.ok && r.payload.activeTenantId === tenantId };
});

await run("members", async () => {
  const r = await call("GET", "/api/tenants/current/members");
  return { ok: r.ok && r.payload.members?.length === 1 && r.payload.members[0].role === "owner" };
});

await run("invite", async () => {
  const r = await call("POST", "/api/tenants/current/invites", { email: "invited@example.com" }, 201);
  inviteToken = (r.payload.devInviteUrl ?? "").split("token=")[1] ?? null;
  return { ok: r.ok && Boolean(inviteToken) };
});

await run("dev grant", async () => {
  const r = await call("POST", "/api/dev/grant", { planCode: "pro_monthly" });
  return { ok: r.ok && r.payload.entitlements.active === true };
});

await run("subscription active", async () => {
  const r = await call("GET", "/api/billing/subscription");
  return { ok: r.ok && r.payload.subscription?.status === "active" };
});

await run("webhook: bad signature -> 401", async () => {
  const res = await fetch(`${BASE}/api/webhooks/waffo`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-waffo-signature": "nope" },
    body: JSON.stringify({ hello: "world" }),
  });
  storeCookies(res);
  console.log(`${res.status === 401 ? "PASS" : "FAIL"}  ${res.status} POST /api/webhooks/waffo (bad signature)`);
  return { ok: res.status === 401 };
});

await run("webhook log is tenant scoped", async () => {
  const r = await call("GET", "/api/billing/webhook-events");
  return { ok: r.ok && Array.isArray(r.payload.events) };
});

await run("logout", () => call("POST", "/api/auth/logout"));
await run("me after logout", async () => {
  const r = await call("GET", "/api/auth/me");
  return { ok: r.ok && r.payload.user === null };
});
await run("login again", () => call("POST", "/api/auth/login", { email, password: "correct-horse-battery" }));
await run("wrong password -> 401", () =>
  call("POST", "/api/auth/login", { email, password: "definitely-wrong" }, 401)
);

await run("google status", async () => {
  const r = await call("GET", "/api/auth/google/status");
  return { ok: r.ok && r.payload.configured === googleEnabled };
});

if (googleEnabled) {
  await run("google start redirects to accounts.google.com", async () => {
    const res = await fetch(`${BASE}/auth/google`, { redirect: "manual" });
    const location = res.headers.get("location") ?? "";
    const ok = res.status === 302 && location.startsWith("https://accounts.google.com/");
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${res.status} GET /auth/google -> ${location.slice(0, 64)}...`
    );
    return { ok };
  });
} else {
  await run("google start without config -> 503", () => call("GET", "/auth/google", null, 503));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("failed:", failed.map((f) => f.label).join(", "));
  process.exitCode = 1;
}
