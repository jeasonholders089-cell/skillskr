/**
 * Create one subscription plan in Waffo Pancake and link it locally.
 *
 *   npm run pancake:plan -- --code=pro_quarterly --name="Pro Quarterly" \
 *        --period=quarterly --amount=24.99
 *
 *   ... --dry-run     validate and show what would be created, change nothing
 *
 * Idempotent: if the plan code already has a Pancake product id it reports that
 * instead of creating a second product.
 */
import { config } from "../src/config.ts";
import { closeDatabase, openDatabase } from "../src/db.ts";
import { formatError } from "../src/lib/errors.ts";
import { findPlan, upsertPlan } from "../src/repos/billing.ts";
import { pancake } from "../src/billing/pancake.ts";

const PERIODS = ["weekly", "monthly", "quarterly", "yearly"] as const;
type Period = (typeof PERIODS)[number];

function arg(name: string): string | undefined {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const code = arg("code");
  const name = arg("name");
  const period = (arg("period") ?? "monthly") as Period;
  const amount = arg("amount");
  const currency = (arg("currency") ?? config.billing.currency).toUpperCase();
  const trialDays = Number(arg("trial") ?? 0);

  if (!code || !name || !amount) {
    console.error(
      'Usage: npm run pancake:plan -- --code=pro_quarterly --name="Pro Quarterly" --period=quarterly --amount=24.99 [--currency=USD] [--trial=0] [--dry-run]'
    );
    process.exitCode = 1;
    return;
  }
  if (!PERIODS.includes(period)) {
    console.error(`--period must be one of: ${PERIODS.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
    console.error("--amount must be a display amount like 24.99 (no currency symbol).");
    process.exitCode = 1;
    return;
  }

  openDatabase();
  const existing = findPlan(code);
  if (existing?.pancake_product_id) {
    console.log(
      `Plan "${code}" is already linked to ${existing.pancake_product_id}. ` +
        "Use a different --code, or clear the id first."
    );
    closeDatabase();
    return;
  }

  const summary = {
    code,
    name,
    period,
    amount,
    currency,
    trialDays,
    storeId: config.pancake.storeId || "(resolved at runtime)",
    environment: config.pancake.environment,
  };

  if (dryRun) {
    console.log("DRY RUN — nothing will be created:");
    for (const [key, value] of Object.entries(summary)) console.log(`  ${key.padEnd(12)} ${value}`);
    closeDatabase();
    return;
  }

  const storeId = config.pancake.storeId;
  if (!storeId) {
    console.error("WAFFO_STORE_ID is required (run pancake:setup first).");
    process.exitCode = 1;
    return;
  }

  const { product } = await pancake().subscriptionProducts.create({
    storeId,
    name,
    description: `${name} — full Premium access, billed ${period}.`,
    billingPeriod: period,
    prices: { [currency]: { amount, taxCategory: "saas" as never } },
    metadata: { planCode: code, trialDays: trialDays || undefined },
  });

  upsertPlan({
    code,
    name,
    description: `${name} — full Premium access, billed ${period}.`,
    productType: "subscription",
    billingPeriod: period,
    amount,
    currency,
    taxCategory: "saas",
    trialDays,
    features: [
      "Access all Premium Skills",
      "Install from the web or CLI",
      "Secure browser-authorized CLI access",
      "Ongoing Skill updates",
      "New Premium Skills included",
    ],
    sortOrder: 15,
    pancakeProductId: product.id,
  });

  console.log(`Created ${currency} ${amount}/${period} → ${product.id}`);
  console.log(`Linked to local plan "${code}". Redeploy or restart to show it on the site.`);
  closeDatabase();
}

main().catch((err: unknown) => {
  console.error("Plan creation failed:", formatError(err));
  process.exitCode = 1;
  closeDatabase();
});
