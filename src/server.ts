import express from "express";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config, describeConfig } from "./config.ts";
import { closeDatabase, openDatabase } from "./db.ts";
import { errorMiddleware } from "./lib/errors.ts";
import { describeOutbound } from "./lib/outbound.ts";
import { purgeExpiredTokens } from "./repos/users.ts";
import { clearOutbox, outboxMessages } from "./lib/mailer.ts";
import { authRouter } from "./auth/routes.ts";
import { googleCallback, googleStatus, startGoogleLogin } from "./auth/google.ts";
import { tenantRouter } from "./tenants/routes.ts";
import { billingRouter } from "./billing/routes.ts";
import { pancakeWebhook } from "./billing/webhook.ts";
import { linkPancakeProducts, seedPlanCatalog } from "./billing/seed.ts";
import { seedSkillsIfEmpty } from "./repos/skills.ts";
import { webRouter } from "./web/routes.ts";
import { downloadRouter } from "./skills/downloads.ts";
import {
  attachOrderId,
  createPendingSubscription,
  listPlans,
  tenantHasAccess,
  updateSubscriptionStatus,
} from "./repos/billing.ts";
import { withAuth } from "./auth/middleware.ts";

const here = resolve(fileURLToPath(import.meta.url), "..");
const publicDir = join(here, "..", "public");

openDatabase();
seedPlanCatalog();
linkPancakeProducts();
seedSkillsIfEmpty();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

/* ---------------------------------------------------------------- webhooks --
 * Registered BEFORE express.json(): the RSA signature covers the raw bytes, so
 * this route must receive a Buffer, never a parsed object.
 */
app.post("/api/webhooks/waffo", express.raw({ type: "*/*", limit: "1mb" }), pancakeWebhook);

/* ------------------------------------------------------------------- body ---- */
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false }));

/* ------------------------------------------------------------------- health -- */
app.get("/api/health", (_req, res) => {
  const billablePlans = listPlans(false).filter((plan) => plan.code !== "free");
  res.json({
    ok: true,
    env: config.env,
    database: config.databasePath,
    google: config.google.configured,
    pancake: {
      configured: config.pancake.configured,
      storeId: config.pancake.storeId || null,
      environment: config.pancake.environment,
    },
    plans: {
      total: billablePlans.length,
      ready: billablePlans.filter((plan) => plan.pancake_product_id).length,
    },
    time: new Date().toISOString(),
  });
});

/* -------------------------------------------------------------------- config -- */
app.get("/api/config", withAuth, (_req, res) => {
  res.json({
    appUrl: config.appUrl,
    currency: config.billing.currency,
    googleEnabled: config.google.configured,
    pancakeEnabled: config.pancake.configured,
    pancakeEnvironment: config.pancake.environment,
    plans: listPlans().map((plan) => ({
      code: plan.code,
      name: plan.name,
      amount: plan.amount,
      currency: plan.currency,
      productType: plan.product_type,
      billingPeriod: plan.billing_period,
      features: JSON.parse(plan.features_json),
      ready: Boolean(plan.pancake_product_id),
    })),
  });
});

/* --------------------------------------------------------------------- auth -- */
app.get("/auth/google", startGoogleLogin);
app.get("/auth/google/callback", googleCallback);
app.get("/api/auth/google/status", googleStatus);

app.use("/api", authRouter);
app.use("/api", tenantRouter);
app.use("/api", billingRouter);
app.use(downloadRouter);

/* ----------------------------------------------------------------------- web --
 * Storefront pages + the catalog API. Mounted before the static handler so
 * /skills/:slug and /dev win over any file lookup.
 */
// Revalidate on every load: a stale cached site.js is a nasty way to lose an hour.
app.use(
  "/assets",
  express.static(join(publicDir, "assets"), {
    maxAge: 0,
    etag: true,
    setHeaders: (res) => res.setHeader("Cache-Control", "no-cache"),
  })
);
app.use(webRouter);

/* -------------------------------------------------------- dev-only utilities */
if (!config.isProduction) {
  app.get("/api/dev/outbox", (_req, res) => {
    res.json({ messages: outboxMessages() });
  });
  app.delete("/api/dev/outbox", (_req, res) => {
    clearOutbox();
    res.json({ ok: true });
  });

  // Lets the console exercise tenant-scoped billing without a full checkout.
  app.post("/api/dev/grant", withAuth, (req, res) => {
    const auth = req.auth;
    if (!auth?.activeTenantId) {
      res.status(401).json({ error: { code: "unauthorized", message: "Sign in first." } });
      return;
    }
    const planCode = String(req.body?.planCode ?? "pro_monthly");

    const sub = createPendingSubscription({
      tenantId: auth.activeTenantId,
      planCode,
      providerCustomer: auth.activeTenantId,
      metadata: { granted: "dev" },
    });
    const orderId = `ORD_dev_${Date.now().toString(36)}`;
    attachOrderId(sub.id, orderId);
    updateSubscriptionStatus({
      orderId,
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    res.json({ ok: true, orderId, entitlements: tenantHasAccess(auth.activeTenantId) });
  });
}

/* ------------------------------------------------------------------- static -- */
if (existsSync(publicDir)) {
  app.use(express.static(publicDir, { index: "index.html" }));
}

/* --------------------------------------------------------------------- 404 -- */
app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({ error: { code: "not_found", message: `No route for ${req.method} ${req.path}` } });
    return;
  }
  res.status(404).send("Not found");
});

app.use(errorMiddleware);

/* ------------------------------------------------------------------- listen -- */
const server = app.listen(config.port, () => {
  const lines = describeConfig();
  console.log("");
  console.log("  Skillry backend");
  console.log("  ─────────────────────────────────────────────");
  for (const line of lines) console.log(`  ${line}`);
  console.log(`  outbound http       ${describeOutbound()}`);
  console.log("  ─────────────────────────────────────────────");
  if (!config.pancake.configured) {
    console.log("  ! Billing endpoints return 503 until WAFFO_PRIVATE_KEY is set.");
  }
  console.log(`  webhook             ${config.appUrl}/api/webhooks/waffo`);
  console.log("");
});

const cleanup = setInterval(() => {
  try {
    purgeExpiredTokens();
  } catch (err) {
    console.error("[cleanup] failed", err);
  }
}, 60 * 60_000);
cleanup.unref();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`\n[server] ${signal} received, shutting down`);
    server.close(() => {
      closeDatabase();
      process.exit(0);
    });
  });
}
