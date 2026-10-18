/**
 * One-shot catalog setup against Waffo Pancake.
 *
 *   npm run pancake:setup
 *
 * What it does, all idempotent:
 *   1. picks the target store (WAFFO_STORE_ID, or the single store, or creates one)
 *   2. creates the subscription / one-time products for each billable plan
 *   3. optionally groups the subscription products (shared trial, plan switching)
 *   4. registers the HTTP webhook for this app, unless --no-webhook
 *   5. writes the plans + returned PROD_... IDs into the local database
 *
 * Flags:
 *   --publish         promote each product's test version to production
 *   --no-webhook      skip webhook registration
 *   --webhook-url=...   override the webhook URL (default: APP_URL/api/webhooks/waffo)
 *   --store=STO_...     target a specific store for this run
 */
import { config } from "../src/config.ts";
import { formatError } from "../src/lib/errors.ts";
import { openDatabase, closeDatabase } from "../src/db.ts";
import { PLAN_CATALOG } from "../src/billing/plans.ts";
import { listStores, resolveStore, setupCatalog } from "../src/billing/pancake.ts";
import { listPlans, setPlanProductId } from "../src/repos/billing.ts";
import { seedPlanCatalog } from "../src/billing/seed.ts";
import { pancake } from "../src/billing/pancake.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

async function main(): Promise<void> {
  openDatabase();

  if (!config.pancake.configured) {
    console.error(
      "\n  Waffo Pancake is not configured.\n" +
        "  Set WAFFO_MERCHANT_ID and WAFFO_PRIVATE_KEY in .env first (see .env.example).\n"
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\n  Environment: ${config.pancake.environment}`);
  console.log(`  Merchant:    ${config.pancake.merchantId}\n`);

  const stores = await listStores().catch((err: unknown) => {
    console.error(`  Could not list stores: ${formatError(err)}\n`);
    throw err;
  });
  console.log(`  Stores on this merchant: ${stores.length}`);
  for (const store of stores) {
    console.log(`    - ${store.name}  ${store.id}${store.status ? `  [${store.status}]` : ""}`);
  }
  console.log("");

  const target = await resolveStore(value("store") ?? flagsStore());
  console.log(`  Target store: ${target.id}\n`);

  // Seed / refresh the local plan rows first, so `plans` is always coherent.
  seedPlanCatalog();

  const existing: Record<string, string> = {};
  for (const plan of listPlans(false)) {
    if (plan.pancake_product_id && plan.code !== "free") {
      existing[plan.code] = plan.pancake_product_id;
    }
  }
  if (Object.keys(existing).length > 0) {
    console.log("  Reusing product IDs already stored locally:");
    for (const [code, productId] of Object.entries(existing)) {
      console.log(`    - ${code} -> ${productId}`);
    }
    console.log("");
  }

  const requestedWebhookUrl = value("webhook-url");
  const isLocal = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(url);

  // Waffo cannot reach localhost, so registering one by default would just leave
  // a dead entry in the dashboard. Ask for a tunnel explicitly instead.
  let webhookUrl: string | undefined;
  if (flag("no-webhook")) {
    webhookUrl = undefined;
  } else if (requestedWebhookUrl) {
    webhookUrl = requestedWebhookUrl;
  } else if (isLocal(config.appUrl) && !flag("force-webhook")) {
    webhookUrl = undefined;
    console.log("  Webhook: skipped -- APP_URL points at localhost and Pancake cannot reach it.");
    console.log("           Start a tunnel, then re-run with an explicit URL:");
    console.log("             ngrok http " + config.port);
    console.log(
      "             npm run pancake:setup -- --webhook-url=https://<id>.ngrok-free.app/api/webhooks/waffo\n"
    );
  } else {
    webhookUrl = `${config.appUrl}/api/webhooks/waffo`;
  }

  const result = await setupCatalog({
    existingProductIds: existing,
    webhookUrl,
    testMode: config.pancake.environment === "test",
  });

  console.log("  Products");
  for (const product of result.products) {
    setPlanProductId(product.code, product.productId);
    const verb = product.created ? "created" : "reused ";
    console.log(`    - ${verb}  ${product.code.padEnd(12)} ${product.productId}`);
  }
  if (result.reusedFromStore.length > 0) {
    console.log("\n  Reused from the store (matched by name, no duplicates created):");
    for (const item of result.reusedFromStore) {
      console.log(`    - ${item.code.padEnd(12)} ${item.productId}  "${item.name}"`);
    }
    console.log("    If a name match picked up the wrong product, rename it in the dashboard");
    console.log("    or clear plans.pancake_product_id and re-run with the right name.");
  }
  if (result.groupId) console.log(`\n  Subscription group: ${result.groupId}`);
  if (webhookUrl) {
    console.log(
      `  Webhook: ${result.webhookConfigured ? "registered" : "NOT registered"} -> ${webhookUrl}`
    );

    if (result.webhookConfigured && webhookUrl.includes("localhost")) {
      console.log(
        "\n  ! Waffo cannot reach localhost. Expose this app with ngrok and re-run:\n" +
          "      ngrok http " +
          config.port +
          "\n" +
          `      npm run pancake:setup -- --webhook-url=https://<your-id>.ngrok-free.app/api/webhooks/waffo\n` +
          "    (ngrok preserves the X-Waffo-Signature header; localtunnel strips it.)"
      );
    }
  }

  if (flag("publish")) {
    console.log("\n  Publishing test versions to production");
    for (const product of result.products) {
      const plan = PLAN_CATALOG.find((entry) => entry.code === product.code);
      if (!plan) continue;
      try {
        if (plan.productType === "subscription") {
          await pancake().subscriptionProducts.publish({ id: product.productId });
        } else {
          await pancake().onetimeProducts.publish({ id: product.productId });
        }
        console.log(`    - published ${product.code}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`    - ${product.code}: publish failed -- ${message}`);
      }
    }
  }

  console.log(
    "\n  Done. Add to .env:\n" +
      `    WAFFO_STORE_ID=${result.storeId}\n` +
      "\n  Test cards (test mode): 4576 7500 0000 0110 succeeds, 4576 7500 0000 0220 declines.\n"
  );
  closeDatabase();
}

function flagsStore(): string | undefined {
  const explicit = config.pancake.storeId;
  return explicit || undefined;
}

main().catch((err: unknown) => {
  console.error(`\n  Setup failed: ${formatError(err)}\n`);
  process.exitCode = 1;
  closeDatabase();
});
