/**
 * Register the HTTP webhook for a deployed domain.
 *
 *   npm run pancake:webhook -- --url=https://example.com/api/webhooks/waffo
 *   npm run pancake:webhook -- --url=... --prod
 *
 * Idempotent: if the URL is already registered it reports that instead of
 * creating a duplicate.
 */
import { config } from "../src/config.ts";
import { closeDatabase, openDatabase } from "../src/db.ts";
import { formatError } from "../src/lib/errors.ts";
import { pancake } from "../src/billing/pancake.ts";

const EVENTS = [
  "order.completed",
  "subscription.activated",
  "subscription.payment_succeeded",
  "subscription.renewed",
  "subscription.recovered",
  "subscription.canceling",
  "subscription.uncanceled",
  "subscription.canceled",
  "subscription.past_due",
  "refund.succeeded",
  "refund.failed",
];

function arg(name: string): string | undefined {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main(): Promise<void> {
  openDatabase();
  const url = arg("url");
  if (!url) {
    console.error("Usage: npm run pancake:webhook -- --url=https://host/api/webhooks/waffo [--prod]");
    process.exitCode = 1;
    return;
  }
  const testMode = process.argv.includes("--prod") ? false : true;
  const storeId = config.pancake.storeId;
  if (!storeId) {
    console.error("WAFFO_STORE_ID is not set.");
    process.exitCode = 1;
    return;
  }
  if (/localhost|127\.0\.0\.1/.test(url)) {
    console.error("Waffo cannot reach localhost — deploy first, then point this at the public URL.");
    process.exitCode = 1;
    return;
  }

  const existing = await pancake().graphql.query<{
    store: { storeWebhooks: Array<{ id: string; url: string; testMode: boolean }> } | null;
  }>({
    query: `query ($id: String!) { store(id: $id) { storeWebhooks { id url testMode } } }`,
    variables: { id: storeId },
  });
  const hooks = existing.data?.store?.storeWebhooks ?? [];
  const duplicate = hooks.find((hook) => hook.url === url && hook.testMode === testMode);
  if (duplicate) {
    console.log(`Already registered: ${url} (${testMode ? "test" : "prod"}) id=${duplicate.id}`);
    closeDatabase();
    return;
  }

  const { webhook } = await pancake().webhooks.add({
    storeId,
    channel: "http",
    url,
    events: EVENTS as never,
    testMode,
  });
  console.log(`Registered ${testMode ? "test" : "prod"} webhook ${webhook.id} -> ${url}`);
  console.log(`Events (${EVENTS.length}): ${EVENTS.join(", ")}`);
  closeDatabase();
}

main().catch((err: unknown) => {
  console.error("Webhook registration failed:", formatError(err));
  process.exitCode = 1;
  closeDatabase();
});
