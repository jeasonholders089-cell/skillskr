import { WaffoPancake, WaffoPancakeError } from "@waffo/pancake-ts";
import { config } from "../config.ts";
import { HttpError, badRequest, formatError, unavailable } from "../lib/errors.ts";
import { outboundFetch } from "../lib/outbound.ts";
import { GROUP_NAME, PLAN_CATALOG, type PlanDefinition } from "./plans.ts";

let client: WaffoPancake | null = null;

/**
 * Drop the cached client so the next call rebuilds it from the current config.
 * Used by tests, and after rotating the key without restarting.
 */
export function resetPancakeClient(): void {
  client = null;
}

/**
 * Lazily build the SDK client.
 *
 * The constructor validates the RSA key and throws on a malformed one, so it is
 * only constructed when a billing call actually needs it -- the rest of the app
 * keeps working with an empty `WAFFO_PRIVATE_KEY`.
 */
export function pancake(): WaffoPancake {
  if (client) return client;
  if (!config.pancake.merchantId || !config.pancake.privateKey) {
    throw unavailable(
      "Waffo Pancake is not configured. Set WAFFO_MERCHANT_ID and WAFFO_PRIVATE_KEY in .env " +
        "(see .env.example -- the PEM can be inlined, base64-encoded, or referenced by path)."
    );
  }
  try {
    client = new WaffoPancake({
      merchantId: config.pancake.merchantId,
      privateKey: config.pancake.privateKey,
      baseUrl: config.pancake.baseUrl,
      environment: config.pancake.environment,
      // Waffo Pancake accepts a custom fetch implementation, so the same egress
      // proxy (if any) covers billing calls too.
      fetch: outboundFetch as unknown as typeof fetch,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw unavailable(`The Waffo Pancake private key was rejected: ${message}`);
  }
  return client;
}

export function pancakeConfigured(): boolean {
  return config.pancake.configured;
}

/** Translate an SDK failure into an HTTP error that keeps the upstream detail. */
export function toHttpError(err: unknown, fallbackMessage: string): HttpError {
  // Never re-wrap our own HTTP errors (e.g. the 503 raised by an unconfigured
  // client): that would turn "not configured" into a generic upstream failure.
  if (err instanceof HttpError) return err;

  if (err instanceof WaffoPancakeError) {
    const details = err.errors?.map((notice) => ({ message: notice.message, layer: notice.layer }));
    const rootCause = details?.[0]?.message ?? err.message;
    const status = err.status >= 400 && err.status < 600 ? err.status : 502;
    return new HttpError(status, `pancake_${err.status}`, rootCause, details);
  }
  return new HttpError(502, "pancake_error", `${fallbackMessage}: ${formatError(err)}`);
}

/* ------------------------------------------------------------------ stores  */

export interface StoreSummary {
  id: string;
  name: string;
  status?: string;
}

export async function listStores(): Promise<StoreSummary[]> {
  const result = await pancake().graphql.query<{ stores: StoreSummary[] }>({
    query: "query { stores { id name status } }",
  });
  if (result.errors?.length) {
    throw toHttpError(
      { status: 502, message: result.errors[0]?.message },
      "Could not list Waffo Pancake stores"
    );
  }
  return result.data?.stores ?? [];
}

/**
 * Store selection rule from the integration guide:
 *   no store -> create one; exactly one -> use it; several -> never guess.
 */
export async function resolveStore(explicitStoreId?: string): Promise<StoreSummary> {
  const wanted = explicitStoreId ?? config.pancake.storeId;
  if (wanted) {
    return { id: wanted, name: "(configured)" };
  }

  const stores = await listStores();
  if (stores.length === 1) return stores[0]!;
  if (stores.length === 0) {
    const { store } = await pancake().stores.create({ name: "Skillry" });
    return { id: store.id, name: store.name };
  }
  throw badRequest(
    `This merchant has ${stores.length} stores. Set WAFFO_STORE_ID in .env to pick the target store ` +
      `(${stores.map((s) => `${s.name}=${s.id}`).join(", ")}).`
  );
}

/* ---------------------------------------------------------------- products  */

export interface ExistingProduct {
  id: string;
  name: string;
}

export interface CatalogSnapshot {
  subscriptionProducts: ExistingProduct[];
  onetimeProducts: ExistingProduct[];
}

/** Read the store's current catalog, so setup can reuse instead of duplicating. */
export async function readCatalog(storeId: string): Promise<CatalogSnapshot> {
  const result = await pancake().graphql.query<{
    store: {
      subscriptionProducts: ExistingProduct[];
      onetimeProducts: ExistingProduct[];
    } | null;
  }>({
    query: `query ($id: String!) {
      store(id: $id) {
        subscriptionProducts { id name }
        onetimeProducts { id name }
      }
    }`,
    variables: { id: storeId },
  });
  if (result.errors?.length) {
    throw new HttpError(502, "pancake_graphql", result.errors[0]?.message ?? "GraphQL query failed");
  }
  return {
    subscriptionProducts: result.data?.store?.subscriptionProducts ?? [],
    onetimeProducts: result.data?.store?.onetimeProducts ?? [],
  };
}

async function upsertProduct(plan: PlanDefinition, storeId: string): Promise<string> {
  const prices = { [plan.currency]: { amount: plan.amount, taxCategory: plan.taxCategory } };
  const metadata = {
    planCode: plan.code,
    trialDays: plan.trialDays > 0 ? plan.trialDays : undefined,
  };

  try {
    if (plan.productType === "subscription") {
      const { product } = await pancake().subscriptionProducts.create({
        storeId,
        name: plan.name,
        description: plan.description,
        billingPeriod: (plan.billingPeriod ?? "monthly") as "weekly" | "monthly" | "quarterly" | "yearly",
        prices,
        metadata,
      });
      return product.id;
    }
    const { product } = await pancake().onetimeProducts.create({
      storeId,
      name: plan.name,
      description: plan.description,
      prices,
      metadata,
    });
    return product.id;
  } catch (err) {
    throw toHttpError(err, `Could not create the "${plan.code}" product`);
  }
}

export interface SetupResult {
  storeId: string;
  products: Array<{ code: string; productId: string; created: boolean }>;
  reusedFromStore: Array<{ code: string; productId: string; name: string }>;
  webhookSkipped?: string;
  groupId: string | null;
  webhookConfigured: boolean;
}

/**
 * Idempotent catalog setup: create the products that do not exist yet, wire them
 * into a subscription group (for trials + plan switching), and optionally
 * register the webhook endpoint.
 */
export async function setupCatalog(options: {
  existingProductIds?: Record<string, string>;
  webhookUrl?: string;
  testMode?: boolean;
  createGroup?: boolean;
}): Promise<SetupResult> {
  const store = await resolveStore();
  const existing = options.existingProductIds ?? {};
  const products: SetupResult["products"] = [];
  const reusedFromStore: SetupResult["reusedFromStore"] = [];

  // Look at what the store already has, so re-running never duplicates a product
  // that was created from the dashboard under the same name.
  const snapshot = await readCatalog(store.id);
  const byName = new Map<string, string>();
  for (const product of [...snapshot.subscriptionProducts, ...snapshot.onetimeProducts]) {
    byName.set(product.name.trim().toLowerCase(), product.id);
  }

  for (const plan of PLAN_CATALOG) {
    if (!plan.billable) continue;
    const already = existing[plan.code];
    if (already) {
      products.push({ code: plan.code, productId: already, created: false });
      continue;
    }
    const match = byName.get(plan.name.trim().toLowerCase());
    if (match) {
      products.push({ code: plan.code, productId: match, created: false });
      reusedFromStore.push({ code: plan.code, productId: match, name: plan.name });
      continue;
    }
    const productId = await upsertProduct(plan, store.id);
    products.push({ code: plan.code, productId, created: true });
  }

  let groupId: string | null = null;
  if (options.createGroup !== false) {
    const subscriptionProductIds = products
      .filter((entry) => PLAN_CATALOG.find((plan) => plan.code === entry.code)?.productType === "subscription")
      .map((entry) => entry.productId);

    if (subscriptionProductIds.length > 1) {
      try {
        const { group } = await pancake().subscriptionProductGroups.create({
          storeId: store.id,
          name: GROUP_NAME,
          rules: { sharedTrial: true, selfServicePlanChange: true },
          productIds: subscriptionProductIds,
        });
        groupId = group.id;
      } catch (err) {
        // A duplicate group name is not fatal for setup.
        console.warn("[pancake] group creation skipped:", err instanceof Error ? err.message : err);
      }
    }
  }

  let webhookConfigured = false;
  if (options.webhookUrl) {
    try {
      await pancake().webhooks.add({
        storeId: store.id,
        channel: "http",
        url: options.webhookUrl,
        events: [
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
        ],
        testMode: options.testMode ?? config.pancake.environment === "test",
      });
      webhookConfigured = true;
    } catch (err) {
      console.warn("[pancake] webhook registration skipped:", err instanceof Error ? err.message : err);
    }
  }

  return { storeId: store.id, products, reusedFromStore, groupId, webhookConfigured };
}

/* ---------------------------------------------------------------- checkout  */

export interface CheckoutRequest {
  productId: string;
  currency: string;
  tenantId: string;
  planCode: string;
  buyerEmail?: string | null;
  successUrl?: string;
  trialDays?: number;
}

export interface CheckoutOutcome {
  sessionId: string;
  checkoutUrl: string;
  expiresAt: string;
}

export async function createCheckoutSession(input: CheckoutRequest): Promise<CheckoutOutcome> {
  try {
    const session = await pancake().checkout.createSession({
      productId: input.productId,
      currency: input.currency,
      buyerEmail: input.buyerEmail ?? undefined,
      successUrl: input.successUrl ?? config.billing.successUrl,
      withTrial: input.trialDays && input.trialDays > 0 ? true : undefined,
      // `orderMerchantExternalId` is inherited by orders/payments/refunds, which
      // makes reconciliation in the dashboard trivial.
      orderMerchantExternalId: `${input.tenantId}:${input.planCode}`,
      metadata: {
        tenantId: input.tenantId,
        planCode: input.planCode,
      },
    });
    return {
      sessionId: session.sessionId,
      checkoutUrl: session.checkoutUrl,
      expiresAt: session.expiresAt,
    };
  } catch (err) {
    throw toHttpError(err, "Could not open a checkout session");
  }
}

export async function cancelSubscription(orderId: string): Promise<{ orderId: string; status: string }> {
  try {
    const result = await pancake().orders.cancelSubscription({ orderId });
    return { orderId: result.orderId, status: result.status };
  } catch (err) {
    throw toHttpError(err, "Could not cancel the subscription");
  }
}

export async function customerPortalUrl(buyerIdentity: string): Promise<string> {
  const storeId = config.pancake.storeId;
  if (!storeId) {
    throw unavailable("WAFFO_STORE_ID is not set, so the customer portal cannot be issued.");
  }
  try {
    const link = await pancake().auth.createCustomerPortalLink({ storeId, buyerIdentity });
    return link.portalUrl;
  } catch (err) {
    throw toHttpError(err, "Could not open the customer portal");
  }
}
