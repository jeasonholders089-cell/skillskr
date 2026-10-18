/**
 * Re-read the store's products and webhooks from Waffo Pancake and print them,
 * so you can confirm the local mapping without opening the dashboard.
 *
 *   npm run pancake:refresh
 */
import { config } from "../src/config.ts";
import { formatError } from "../src/lib/errors.ts";
import { closeDatabase, openDatabase } from "../src/db.ts";
import { listPlans } from "../src/repos/billing.ts";
import { listStores, pancake } from "../src/billing/pancake.ts";

interface StoreDetail {
  id: string;
  name: string;
  storeWebhooks?: Array<{ id: string; url: string; events: string[]; testMode: boolean }>;
  subscriptionProducts?: Array<{ id: string; name: string; billingPeriod: string }>;
  onetimeProducts?: Array<{ id: string; name: string }>;
}

async function main(): Promise<void> {
  openDatabase();

  if (!config.pancake.configured) {
    console.error("  Waffo Pancake is not configured (WAFFO_MERCHANT_ID / WAFFO_PRIVATE_KEY).");
    process.exitCode = 1;
    return;
  }

  const stores = await listStores();
  console.log(`\n  Stores (${stores.length})`);
  for (const store of stores) console.log(`    - ${store.name}  ${store.id}`);

  const storeId = config.pancake.storeId || stores[0]?.id;
  if (!storeId) {
    console.log("\n  No stores yet -- run `npm run pancake:setup`.\n");
    closeDatabase();
    return;
  }

  const result = await pancake().graphql.query<{ store: StoreDetail | null }>({
    query: `query ($id: String!) {
      store(id: $id) {
        id
        name
        storeWebhooks { id url events testMode }
        subscriptionProducts { id name billingPeriod }
        onetimeProducts { id name }
      }
    }`,
    variables: { id: storeId },
  });

  if (result.errors?.length) {
    console.log("\n  GraphQL errors:");
    for (const error of result.errors) console.log(`    - ${error.message}`);
  }

  const store = result.data?.store;
  if (store) {
    console.log(`\n  Store ${store.name} (${store.id})`);
    console.log(`    subscription products: ${store.subscriptionProducts?.length ?? 0}`);
    for (const product of store.subscriptionProducts ?? []) {
      console.log(`      - ${product.name.padEnd(18)} ${product.billingPeriod.padEnd(9)} ${product.id}`);
    }
    console.log(`    one-time products: ${store.onetimeProducts?.length ?? 0}`);
    for (const product of store.onetimeProducts ?? []) {
      console.log(`      - ${product.name.padEnd(18)} ${product.id}`);
    }
    console.log(`    webhooks: ${store.storeWebhooks?.length ?? 0}`);
    for (const hook of store.storeWebhooks ?? []) {
      console.log(`      - ${hook.testMode ? "test" : "prod"}  ${hook.url}  (${hook.events.length} events)`);
    }
  }

  console.log("\n  Local plan mapping");
  for (const plan of listPlans(false)) {
    console.log(
      `    - ${plan.code.padEnd(12)} ${plan.product_type.padEnd(13)} ${plan.pancake_product_id ?? "(not linked)"}`
    );
  }
  console.log("");
  closeDatabase();
}

main().catch((err: unknown) => {
  console.error(`\n  Refresh failed: ${formatError(err)}\n`);
  process.exitCode = 1;
  closeDatabase();
});
