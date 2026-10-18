import { all, get, run, transaction } from "../db.ts";
import { newPaymentId, newSubscriptionId } from "../lib/ids.ts";
import { nowIso } from "../lib/http.ts";
import { config } from "../config.ts";

export type ProductType = "subscription" | "onetime";
export type SubscriptionStatus =
  | "pending"
  | "active"
  | "canceling"
  | "past_due"
  | "canceled"
  | "expired"
  | "closed";

export interface PlanRow {
  code: string;
  name: string;
  description: string | null;
  product_type: ProductType;
  billing_period: string | null;
  amount: string;
  currency: string;
  tax_category: string;
  trial_days: number;
  features_json: string;
  pancake_product_id: string | null;
  is_active: number;
  sort_order: number;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionRow {
  id: string;
  tenant_id: string;
  plan_code: string;
  provider: string;
  provider_order_id: string | null;
  provider_customer: string | null;
  status: SubscriptionStatus;
  quantity: number;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: number;
  trial_ends_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  canceled_at: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

/* -------------------------------------------------------------------- plans */

export function listPlans(onlyActive = true): PlanRow[] {
  return all<PlanRow>(
    `SELECT * FROM plans ${onlyActive ? "WHERE is_active = 1" : ""} ORDER BY sort_order ASC, amount ASC`
  );
}

export function findPlan(code: string): PlanRow | undefined {
  return get<PlanRow>("SELECT * FROM plans WHERE code = ?", code);
}

export function upsertPlan(input: {
  code: string;
  name: string;
  description?: string | null;
  productType: ProductType;
  billingPeriod?: string | null;
  amount: string;
  currency: string;
  taxCategory: string;
  trialDays?: number;
  features?: string[];
  sortOrder?: number;
  pancakeProductId?: string | null;
}): PlanRow {
  const ts = nowIso();
  run(
    `INSERT INTO plans (code, name, description, product_type, billing_period, amount, currency,
                        tax_category, trial_days, features_json, pancake_product_id, sort_order,
                        is_active, synced_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT (code) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       product_type = excluded.product_type,
       billing_period = excluded.billing_period,
       amount = excluded.amount,
       currency = excluded.currency,
       tax_category = excluded.tax_category,
       trial_days = excluded.trial_days,
       features_json = excluded.features_json,
       pancake_product_id = COALESCE(excluded.pancake_product_id, plans.pancake_product_id),
       sort_order = excluded.sort_order,
       synced_at = excluded.synced_at,
       updated_at = excluded.updated_at`,
    input.code,
    input.name,
    input.description ?? null,
    input.productType,
    input.billingPeriod ?? null,
    input.amount,
    input.currency.toUpperCase(),
    input.taxCategory,
    input.trialDays ?? 0,
    JSON.stringify(input.features ?? []),
    input.pancakeProductId ?? null,
    input.sortOrder ?? 0,
    ts,
    ts,
    ts
  );
  return findPlan(input.code)!;
}

export function setPlanProductId(code: string, productId: string): void {
  run(
    "UPDATE plans SET pancake_product_id = ?, synced_at = ?, updated_at = ? WHERE code = ?",
    productId,
    nowIso(),
    nowIso(),
    code
  );
}

export function planByProductId(productId: string): PlanRow | undefined {
  return get<PlanRow>("SELECT * FROM plans WHERE pancake_product_id = ?", productId);
}

/* ------------------------------------------------------------ subscriptions */

export function findSubscriptionForTenant(tenantId: string): SubscriptionRow | undefined {
  return get<SubscriptionRow>(
    `SELECT * FROM subscriptions
      WHERE tenant_id = ?
      ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'canceling' THEN 1 WHEN 'past_due' THEN 2
                           WHEN 'pending' THEN 3 ELSE 4 END,
               COALESCE(current_period_end, '9999') DESC,
               created_at DESC
      LIMIT 1`,
    tenantId
  );
}

export function listSubscriptions(tenantId: string): SubscriptionRow[] {
  return all<SubscriptionRow>(
    "SELECT * FROM subscriptions WHERE tenant_id = ? ORDER BY created_at DESC",
    tenantId
  );
}

export function findSubscriptionByOrderId(orderId: string): SubscriptionRow | undefined {
  return get<SubscriptionRow>(
    "SELECT * FROM subscriptions WHERE provider = 'waffo_pancake' AND provider_order_id = ?",
    orderId
  );
}

export function createPendingSubscription(input: {
  tenantId: string;
  planCode: string;
  providerCustomer: string;
  metadata?: Record<string, unknown>;
}): SubscriptionRow {
  const id = newSubscriptionId();
  const ts = nowIso();
  run(
    `INSERT INTO subscriptions (id, tenant_id, plan_code, provider, provider_customer, status,
                                metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, 'waffo_pancake', ?, 'pending', ?, ?, ?)`,
    id,
    input.tenantId,
    input.planCode,
    input.providerCustomer,
    JSON.stringify(input.metadata ?? {}),
    ts,
    ts
  );
  return get<SubscriptionRow>("SELECT * FROM subscriptions WHERE id = ?", id)!;
}

export function attachOrderId(subscriptionId: string, orderId: string): void {
  run(
    "UPDATE subscriptions SET provider_order_id = ?, updated_at = ? WHERE id = ?",
    orderId,
    nowIso(),
    subscriptionId
  );
}

export function updateSubscriptionStatus(input: {
  orderId: string;
  status: SubscriptionStatus;
  orderStatus?: string | null;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean | null;
  metadata?: Record<string, unknown> | null;
}): SubscriptionRow | undefined {
  const existing = findSubscriptionByOrderId(input.orderId);
  if (!existing) return undefined;

  const status = input.status;
  const startedAt =
    existing.started_at ?? (status === "active" || status === "canceling" ? nowIso() : null);
  const endedAt = ["canceled", "expired", "closed"].includes(status) ? nowIso() : existing.ended_at;
  const canceledAt = status === "canceled" ? nowIso() : existing.canceled_at;

  run(
    `UPDATE subscriptions
        SET status = ?,
            current_period_start = COALESCE(?, current_period_start),
            current_period_end = COALESCE(?, current_period_end),
            cancel_at_period_end = COALESCE(?, cancel_at_period_end),
            started_at = ?,
            ended_at = ?,
            canceled_at = ?,
            metadata_json = COALESCE(?, metadata_json),
            updated_at = ?
      WHERE id = ?`,
    status,
    input.currentPeriodStart ?? null,
    input.currentPeriodEnd ?? null,
    input.cancelAtPeriodEnd === undefined || input.cancelAtPeriodEnd === null
      ? null
      : input.cancelAtPeriodEnd
        ? 1
        : 0,
    startedAt,
    endedAt,
    canceledAt,
    input.metadata ? JSON.stringify(input.metadata) : null,
    nowIso(),
    existing.id
  );
  return get<SubscriptionRow>("SELECT * FROM subscriptions WHERE id = ?", existing.id);
}

/**
 * Entitlement check.
 *
 * Access is granted for `active` and `canceling` (the buyer keeps the period they
 * paid for), plus `past_due` inside the configured grace window so a failed
 * renewal retry does not immediately lock a paying workspace out.
 */
export function tenantHasAccess(tenantId: string): {
  active: boolean;
  planCode: string | null;
  status: SubscriptionStatus | null;
  reason: string;
  expiresAt: string | null;
} {
  const subscription = findSubscriptionForTenant(tenantId);
  if (!subscription) {
    return { active: false, planCode: null, status: null, reason: "no_subscription", expiresAt: null };
  }

  const periodEnd = subscription.current_period_end ? Date.parse(subscription.current_period_end) : null;
  const periodEnded = periodEnd !== null && periodEnd < Date.now();

  if (subscription.status === "active" || subscription.status === "canceling") {
    if (periodEnded && subscription.status === "canceling") {
      return {
        active: false,
        planCode: subscription.plan_code,
        status: subscription.status,
        reason: "period_ended",
        expiresAt: subscription.current_period_end,
      };
    }
    return {
      active: true,
      planCode: subscription.plan_code,
      status: subscription.status,
      reason: "subscribed",
      expiresAt: subscription.current_period_end,
    };
  }

  if (subscription.status === "past_due") {
    const graceMs = config.billing.pastDueGraceDays * 86_400_000;
    const reference = subscription.current_period_end
      ? Date.parse(subscription.current_period_end)
      : Date.parse(subscription.updated_at);
    const withinGrace = Date.now() - reference < graceMs;
    return {
      active: withinGrace,
      planCode: subscription.plan_code,
      status: subscription.status,
      reason: withinGrace ? "past_due_grace" : "past_due_expired",
      expiresAt: subscription.current_period_end,
    };
  }

  return {
    active: false,
    planCode: subscription.plan_code,
    status: subscription.status,
    reason: `status_${subscription.status}`,
    expiresAt: subscription.current_period_end,
  };
}

/* ----------------------------------------------------------------- payments */

export function recordPayment(input: {
  tenantId: string;
  subscriptionId?: string | null;
  planCode?: string | null;
  providerOrderId?: string | null;
  providerPaymentId?: string | null;
  kind: "subscription" | "onetime" | "refund";
  status: "pending" | "succeeded" | "failed" | "canceled" | "refunded";
  amount: string;
  currency: string;
  taxAmount?: string | null;
  productName?: string | null;
  buyerEmail?: string | null;
  mode?: string | null;
  raw?: unknown;
}): void {
  const ts = nowIso();
  run(
    `INSERT INTO payments (id, tenant_id, subscription_id, plan_code, provider, provider_order_id,
                           provider_payment_id, kind, status, amount, amount_minor, tax_amount,
                           currency, product_name, buyer_email, mode, raw_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'waffo_pancake', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newPaymentId(),
    input.tenantId,
    input.subscriptionId ?? null,
    input.planCode ?? null,
    input.providerOrderId ?? null,
    input.providerPaymentId ?? null,
    input.kind,
    input.status,
    input.amount,
    toMinorUnits(input.amount),
    input.taxAmount ?? null,
    input.currency.toUpperCase(),
    input.productName ?? null,
    input.buyerEmail ?? null,
    input.mode ?? null,
    input.raw ? JSON.stringify(input.raw) : null,
    ts,
    ts
  );
}

export function listPayments(tenantId: string, limit = 50): Array<Record<string, unknown>> {
  return all(
    `SELECT id, kind, status, amount, currency, product_name, provider_order_id, created_at
       FROM payments WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`,
    tenantId,
    limit
  );
}

/** "9.99" -> 999, "1000" (JPY) -> 1000. Two-decimal currencies only. */
export function toMinorUnits(amount: string): number {
  const value = Number.parseFloat(amount);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

/* ---------------------------------------------------------- webhook ledger */

export function webhookAlreadyProcessed(deliveryId: string): boolean {
  return Boolean(get("SELECT 1 FROM webhook_events WHERE delivery_id = ?", deliveryId));
}

export function recordWebhook(input: {
  deliveryId: string;
  eventType: string;
  eventId?: string | null;
  tenantId?: string | null;
  mode?: string | null;
  storeId?: string | null;
  payload: unknown;
  status?: "received" | "processed" | "ignored" | "failed";
  error?: string | null;
}): void {
  run(
    `INSERT INTO webhook_events (delivery_id, provider, event_type, event_id, tenant_id, mode, store_id,
                                 payload_json, received_at, processed_at, status, error)
     VALUES (?, 'waffo_pancake', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (delivery_id) DO NOTHING`,
    input.deliveryId,
    input.eventType,
    input.eventId ?? null,
    input.tenantId ?? null,
    input.mode ?? null,
    input.storeId ?? null,
    JSON.stringify(input.payload),
    nowIso(),
    input.status && input.status !== "received" ? nowIso() : null,
    input.status ?? "received",
    input.error ?? null
  );
}

export function markWebhook(
  deliveryId: string,
  status: "processed" | "ignored" | "failed",
  error?: string | null
): void {
  run(
    "UPDATE webhook_events SET status = ?, processed_at = ?, error = ? WHERE delivery_id = ?",
    status,
    nowIso(),
    error ?? null,
    deliveryId
  );
}

/**
 * Tenant-scoped webhook log. Pass `tenantId = null` only for the ops/dev view --
 * never for a customer-facing endpoint, or one tenant sees another tenant's
 * delivery metadata.
 */
export function recentWebhookEvents(
  tenantId: string | null,
  limit = 25
): Array<Record<string, unknown>> {
  if (tenantId) {
    return all(
      `SELECT delivery_id, event_type, mode, status, received_at, processed_at, error
         FROM webhook_events WHERE tenant_id = ? ORDER BY received_at DESC LIMIT ?`,
      tenantId,
      limit
    );
  }
  return all(
    `SELECT delivery_id, event_type, mode, status, received_at, processed_at, error
       FROM webhook_events ORDER BY received_at DESC LIMIT ?`,
    limit
  );
}

/** Wrap a multi-table billing mutation so a failure cannot leave half a state. */
export const inTransaction = transaction;
