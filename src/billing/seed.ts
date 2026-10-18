import { PLAN_CATALOG } from "./plans.ts";
import { upsertPlan } from "../repos/billing.ts";

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
