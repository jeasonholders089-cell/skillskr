import { PLAN_CATALOG } from "./plans.ts";
import { findPlan, setPlanProductId, upsertPlan } from "../repos/billing.ts";

/**
 * Make sure the local `plans` table mirrors the code catalog.
 *
 * Runs on every boot and is idempotent. `pancake_product_id` is preserved by the
 * upsert, so re-running never unlinks a product that `pancake:setup` created.
 */
export function seedPlanCatalog(): void {
  for (const plan of PLAN_CATALOG) {
    upsertPlan({
      code: plan.code,
      name: plan.name,
      description: plan.description,
      productType: plan.productType,
      billingPeriod: plan.billingPeriod,
      amount: plan.amount,
      currency: plan.currency,
      taxCategory: plan.taxCategory,
      trialDays: plan.trialDays,
      features: plan.features,
      sortOrder: plan.sortOrder,
    });
  }
}

/**
 * Product IDs for this Pancake store. They are safe to keep in source (unlike
 * the merchant key), and having defaults means a fresh production volume can
 * bind its plans on boot without a one-off shell command.
 *
 * Override with WAFFO_PRODUCT_<PLAN> when pointing at another store.
 */
const PANCAKE_PRODUCT_DEFAULTS: Record<string, string> = {
  pro_monthly:
    process.env.WAFFO_PRODUCT_PRO_MONTHLY || "PROD_0vlrBUJ5FZbaEB3l5PGFze",
  pro_yearly:
    process.env.WAFFO_PRODUCT_PRO_YEARLY || "PROD_2siOmTOiQrA24CszlDHKEB",
  lifetime:
    process.env.WAFFO_PRODUCT_LIFETIME || "PROD_1haaRz2rSubBwXprV6vGVs",
};

/**
 * Fill in missing Pancake product links after the plan catalog is seeded.
 * Idempotent: an existing link is never overwritten, so publishing a new
 * product version or changing the store mapping still requires an explicit
 * update rather than being silently replaced on every boot.
 */
export function linkPancakeProducts(): void {
  for (const [code, productId] of Object.entries(PANCAKE_PRODUCT_DEFAULTS)) {
    if (!productId) continue;
    const plan = findPlan(code);
    if (!plan || plan.pancake_product_id) continue;
    setPlanProductId(code, productId);
    console.log(`[billing] linked ${code} -> ${productId}`);
  }
}
