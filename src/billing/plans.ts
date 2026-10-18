import type { ProductType } from "../repos/billing.ts";

export interface PlanDefinition {
  code: string;
  name: string;
  description: string;
  productType: ProductType;
  billingPeriod: "weekly" | "monthly" | "quarterly" | "yearly" | null;
  amount: string;
  currency: string;
  taxCategory: "saas" | "digital_goods" | "software" | "ebook" | "online_course" | "consulting" | "professional_service";
  trialDays: number;
  features: string[];
  sortOrder: number;
  /** The free tier has no Pancake product and never goes through checkout. */
  billable: boolean;
}

/**
 * Catalog of record.
 *
 * `npm run pancake:setup` upserts these into the `plans` table and creates the
 * matching products in Waffo Pancake, writing the returned `PROD_...` IDs back.
 * `free` is intentionally local-only.
 */
export const PLAN_CATALOG: PlanDefinition[] = [
  {
    code: "free",
    name: "Free",
    description: "Browse the catalog and install the free Skills.",
    productType: "onetime",
    billingPeriod: null,
    amount: "0.00",
    currency: "USD",
    taxCategory: "digital_goods",
    trialDays: 0,
    features: ["Free Skills included", "Community support"],
    sortOrder: 0,
    billable: false,
  },
  {
    code: "pro_monthly",
    name: "Pro Monthly",
    description: "Full Premium access, billed monthly.",
    productType: "subscription",
    billingPeriod: "monthly",
    amount: "9.99",
    currency: "USD",
    taxCategory: "saas",
    trialDays: 0,
    features: [
      "Access all Premium Skills",
      "Install from the web or CLI",
      "Secure browser-authorized CLI access",
      "Ongoing Skill updates",
      "New Premium Skills included",
      "Cancel whenever you need",
    ],
    sortOrder: 10,
    billable: true,
  },
  {
    code: "pro_yearly",
    name: "Pro Yearly",
    description: "Full Premium access for a lower annual price.",
    productType: "subscription",
    billingPeriod: "yearly",
    amount: "79.00",
    currency: "USD",
    taxCategory: "saas",
    trialDays: 0,
    features: [
      "Access all Premium Skills",
      "Install from the web or CLI",
      "Secure browser-authorized CLI access",
      "Ongoing Skill updates",
      "New Premium Skills included",
      "Cancel whenever you need",
    ],
    sortOrder: 20,
    billable: true,
  },
  {
    code: "lifetime",
    name: "Founding Lifetime",
    description: "Pay once -- founding price, increases as the library grows.",
    productType: "onetime",
    billingPeriod: null,
    amount: "169.00",
    currency: "USD",
    taxCategory: "saas",
    trialDays: 0,
    features: [
      "Access all Premium Skills",
      "Install from the web or CLI",
      "Secure browser-authorized CLI access",
      "Ongoing Skill updates",
      "New Premium Skills included",
      "No subscription or renewal bill",
    ],
    sortOrder: 30,
    billable: true,
  },
];

export const SUBSCRIPTION_PLAN_CODES = PLAN_CATALOG.filter(
  (plan) => plan.billable && plan.productType === "subscription"
).map((plan) => plan.code);

export const GROUP_NAME = "Pro plans";

export function findPlanDefinition(code: string): PlanDefinition | undefined {
  return PLAN_CATALOG.find((plan) => plan.code === code);
}
