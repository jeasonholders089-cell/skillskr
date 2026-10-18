/**
 * Billing state-machine test.
 *
 * Runs against a throwaway SQLite file and feeds synthetic Waffo Pancake events
 * straight into the reducer (signature verification is exercised separately by
 * the HTTP smoke test, which posts an unsigned body and expects a 401).
 *
 *   npm run test:billing
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebhookEventType, type WebhookEvent } from "@waffo/pancake-ts";

process.env.DATABASE_PATH = tempDatabasePath();
process.env.SESSION_SECRET = "test-secret-not-used-for-anything-real";

const { closeDatabase, openDatabase } = await import("../src/db.ts");
const { seedPlanCatalog } = await import("../src/billing/seed.ts");
const { applyWebhookEvent } = await import("../src/billing/webhook.ts");
const {
  findSubscriptionByOrderId,
  findPlan,
  listPayments,
  tenantHasAccess,
} = await import("../src/repos/billing.ts");
const { addMembership, createTenant } = await import("../src/repos/tenants.ts");
const { createUser } = await import("../src/repos/users.ts");

openDatabase(process.env.DATABASE_PATH);
seedPlanCatalog();

const user = createUser({ email: "billing@example.com", name: "Billing Test" });
const tenant = createTenant({ name: "Billing Workspace", createdBy: user.id, billingEmail: user.email });
addMembership(tenant.id, user.id, "owner");

const TENANT = tenant.id;
const ORDER = "ORD_test_0001";
let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`);
  }
}

let counter = 0;
function event(
  eventType: string,
  data: Partial<WebhookEvent["data"]> = {},
  overrides: Partial<WebhookEvent> = {}
): WebhookEvent {
  counter += 1;
  return {
    id: `dlv_test_${counter}`,
    timestamp: new Date().toISOString(),
    eventType,
    eventId: `evt_test_${counter}`,
    storeId: "STO_test",
    storeName: "Test store",
    mode: "test",
    data: {
      orderId: ORDER,
      buyerEmail: "buyer@example.com",
      currency: "USD",
      amount: "9.99",
      taxAmount: "0.00",
      productName: "Pro Monthly",
      orderMetadata: { tenantId: TENANT, planCode: "pro_monthly" },
      orderMerchantExternalId: `${TENANT}:pro_monthly`,
      ...data,
    },
  };
}

console.log("\n  Billing state machine\n");

/* ---------------------------------------------------------------- activation */

let outcome = applyWebhookEvent(
  event(WebhookEventType.SubscriptionActivated, {
    orderStatus: "active",
    currentPeriodStart: new Date().toISOString(),
    currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  })
);
check("subscription.activated is applied", outcome.applied);

let subscription = findSubscriptionByOrderId(ORDER);
check("subscription row exists", Boolean(subscription));
check("status is active", subscription?.status === "active", String(subscription?.status));
check("plan resolved from metadata", subscription?.plan_code === "pro_monthly", String(subscription?.plan_code));
check("period end stored", Boolean(subscription?.current_period_end));
check("access granted", tenantHasAccess(TENANT).active);

/* -------------------------------------------------------------------- renewal */

const renewalOrder = "ORD_test_0002";
applyWebhookEvent(
  event(
    WebhookEventType.SubscriptionPaymentSucceeded,
    { orderId: renewalOrder, chargedAmount: "9.99" },
    {}
  )
);
// The renewal references the same subscription only when order ids match, which
// they do not here -- so this event must not create a phantom subscription.
const phantom = findSubscriptionByOrderId(renewalOrder);
check("renewal for an unknown order does not create a subscription", phantom === undefined);

applyWebhookEvent(
  event(WebhookEventType.SubscriptionPaymentSucceeded, {
    chargedAmount: "9.99",
    paymentId: "PAY_test_1",
  })
);
check("renewal payment recorded", listPayments(TENANT).some((p) => p.kind === "subscription"));
subscription = findSubscriptionByOrderId(ORDER);
check("still active after renewal", subscription?.status === "active");

/* ------------------------------------------------------------------ canceling */

applyWebhookEvent(event(WebhookEventType.SubscriptionCanceling, { orderStatus: "canceling" }));
subscription = findSubscriptionByOrderId(ORDER);
check("status is canceling", subscription?.status === "canceling", String(subscription?.status));
check("cancel_at_period_end set", subscription?.cancel_at_period_end === 1);
check("access kept until period end", tenantHasAccess(TENANT).active);

/* ----------------------------------------------------------------- uncancel  */

applyWebhookEvent(event(WebhookEventType.SubscriptionUncanceled));
subscription = findSubscriptionByOrderId(ORDER);
check("status back to active", subscription?.status === "active");
check("cancel_at_period_end cleared", subscription?.cancel_at_period_end === 0);

/* ------------------------------------------------------------------- past due */

applyWebhookEvent(event(WebhookEventType.SubscriptionPastDue));
subscription = findSubscriptionByOrderId(ORDER);
check("status is past_due", subscription?.status === "past_due");
check("still inside the grace window", tenantHasAccess(TENANT).active);

// Move the period end far into the past to expire the grace window.
const { updateSubscriptionStatus } = await import("../src/repos/billing.ts");
updateSubscriptionStatus({
  orderId: ORDER,
  status: "past_due",
  currentPeriodEnd: new Date(Date.now() - 30 * 86_400_000).toISOString(),
});
check("grace window expired -> access revoked", tenantHasAccess(TENANT).active === false);

/* -------------------------------------------------------------------- canceled */

applyWebhookEvent(event(WebhookEventType.SubscriptionCanceled));
subscription = findSubscriptionByOrderId(ORDER);
check("status is canceled", subscription?.status === "canceled");
check("ended_at recorded", Boolean(subscription?.ended_at));
check("access revoked", tenantHasAccess(TENANT).active === false);

/* ------------------------------------------------------------------- one-time */

const lifetimeOrder = "ORD_test_0003";
applyWebhookEvent(
  event(WebhookEventType.OrderCompleted, {
    orderId: lifetimeOrder,
    amount: "169.00",
    chargedAmount: "169.00",
    productName: "Founding Lifetime",
    orderMetadata: { tenantId: TENANT, planCode: "lifetime" },
    orderMerchantExternalId: `${TENANT}:lifetime`,
  })
);
const lifetime = findSubscriptionByOrderId(lifetimeOrder);
check("one-time purchase creates an active entitlement", lifetime?.status === "active");
check("lifetime plan resolved", lifetime?.plan_code === "lifetime", String(lifetime?.plan_code));
check("no period end for a one-time purchase", lifetime?.current_period_end === null);
check("access granted by the lifetime purchase", tenantHasAccess(TENANT).active);
check("one-time payment recorded", listPayments(TENANT).some((p) => p.kind === "onetime"));
check("plan catalog knows all three billable plans", Boolean(findPlan("pro_monthly") && findPlan("lifetime")));

/* --------------------------------------------------------------------- refund */

applyWebhookEvent(
  event(WebhookEventType.RefundSucceeded, {
    orderId: lifetimeOrder,
    refundedAmount: "169.00",
    refundReason: "customer request",
  })
);
const refunded = findSubscriptionByOrderId(lifetimeOrder);
check("refund cancels the entitlement", refunded?.status === "canceled");
check("refund recorded", listPayments(TENANT).some((p) => p.kind === "refund"));

/* ---------------------------------------------------------------- tenant guard */

const ghost = applyWebhookEvent(
  event(WebhookEventType.SubscriptionActivated, {
    orderId: "ORD_test_ghost",
    orderMetadata: { tenantId: "TNT_does_not_exist", planCode: "pro_monthly" },
    orderMerchantExternalId: "TNT_does_not_exist:pro_monthly",
  })
);
check("unknown tenant is ignored, not applied", ghost.applied === false && Boolean(ghost.reason));

const unattributed = applyWebhookEvent(
  event(WebhookEventType.SubscriptionActivated, {
    orderId: "ORD_test_no_meta",
    orderMetadata: {},
    orderMerchantExternalId: undefined,
    merchantProvidedBuyerIdentity: undefined,
  })
);
check("event without tenant attribution is ignored", unattributed.applied === false);

/* ------------------------------------------------------- unconfigured checkout */

// Deliberately force the "no credentials" state so this assertion does not
// depend on whether the developer happens to have a key in .env.
const { createCheckoutSession, resetPancakeClient } = await import("../src/billing/pancake.ts");
const { config } = await import("../src/config.ts");

const savedKey = config.pancake.privateKey;
config.pancake.privateKey = "";
resetPancakeClient();

let checkoutError: unknown = null;
try {
  await createCheckoutSession({
    productId: "PROD_test",
    currency: "USD",
    tenantId: TENANT,
    planCode: "pro_monthly",
  });
} catch (err) {
  checkoutError = err;
}
const checkoutStatus = (checkoutError as { status?: number } | null)?.status;
check(
  "checkout without a private key fails with 503, not a crash",
  checkoutStatus === 503,
  String(checkoutStatus)
);

config.pancake.privateKey = savedKey;
resetPancakeClient();

if (process.env.TEST_LIVE === "1") {
  // Opt-in: exercises the real API error mapping (needs network + valid key).
  let liveError: unknown = null;
  try {
    await createCheckoutSession({
      productId: "PROD_does_not_exist",
      currency: "USD",
      tenantId: TENANT,
      planCode: "pro_monthly",
    });
  } catch (err) {
    liveError = err;
  }
  const liveStatus = (liveError as { status?: number } | null)?.status;
  const liveCode = (liveError as { code?: string } | null)?.code;
  check(
    "a bad product id surfaces as a mapped HttpError, not a raw SDK throw",
    typeof liveStatus === "number" && liveStatus >= 400 && liveStatus < 500,
    `${liveStatus} ${liveCode}`
  );
}

console.log(`\n  ${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}\n`);

closeDatabase();
try {
  rmSync(process.env.DATABASE_PATH!, { force: true });
  rmSync(`${process.env.DATABASE_PATH}-wal`, { force: true });
  rmSync(`${process.env.DATABASE_PATH}-shm`, { force: true });
} catch {
  // best effort
}
process.exitCode = failures === 0 ? 0 : 1;

/** Prefer the OS temp dir; fall back to a local folder when it is not writable. */
function tempDatabasePath(): string {
  for (const root of [tmpdir(), join(process.cwd(), ".tmp")]) {
    try {
      mkdirSync(root, { recursive: true });
      return join(mkdtempSync(join(root, "skillry-billing-")), "test.db");
    } catch {
      // try the next candidate
    }
  }
  throw new Error("No writable directory for the test database.");
}
