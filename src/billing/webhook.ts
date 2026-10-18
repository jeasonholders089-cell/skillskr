import type { Request, Response } from "express";
import { verifyWebhook, WebhookEventType, type WebhookEvent } from "@waffo/pancake-ts";
import { config } from "../config.ts";
import { audit } from "../lib/audit.ts";
import {
  attachOrderId,
  createPendingSubscription,
  findPlan,
  findSubscriptionByOrderId,
  inTransaction,
  markWebhook,
  recordPayment,
  recordWebhook,
  updateSubscriptionStatus,
  webhookAlreadyProcessed,
  type SubscriptionStatus,
} from "../repos/billing.ts";
import { findTenant } from "../repos/tenants.ts";

/**
 * Waffo Pancake webhook receiver.
 *
 * Mounted with `express.raw()` because the RSA-SHA256 signature covers the raw
 * bytes: re-serialising parsed JSON changes them and verification fails.
 *
 * Delivery is at-least-once, so `event.id` (the delivery ID) is used as the
 * idempotency key. A duplicate returns 200 without touching state again.
 */
export function pancakeWebhook(req: Request, res: Response): void {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf-8") : String(req.body ?? "");
  const signature = req.header("x-waffo-signature") ?? undefined;

  let event: WebhookEvent;
  try {
    event = verifyWebhook(rawBody, signature, { environment: config.pancake.environment });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[webhook] signature verification failed:", message);
    res.status(401).json({ error: { code: "invalid_signature", message } });
    return;
  }

  if (webhookAlreadyProcessed(event.id)) {
    res.status(200).json({ ok: true, duplicate: true });
    return;
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = { raw: rawBody };
  }

  recordWebhook({
    deliveryId: event.id,
    eventType: event.eventType,
    eventId: event.eventId,
    tenantId: resolveTenantId(event),
    mode: event.mode,
    storeId: event.storeId,
    payload,
  });

  try {
    const outcome = applyEvent(event);
    markWebhook(event.id, outcome.applied ? "processed" : "ignored", outcome.reason ?? null);
    res.status(200).json({ ok: true, ...outcome });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[webhook] handling failed", event.eventType, message);
    markWebhook(event.id, "failed", message);
    // 500 makes Pancake retry with the same delivery id, which is what we want.
    res.status(500).json({ error: { code: "handler_failed", message } });
  }
}

interface ApplyOutcome {
  applied: boolean;
  reason?: string;
  tenantId?: string;
  planCode?: string;
}

function applyEvent(event: WebhookEvent): ApplyOutcome {
  const data = event.data;
  const tenantId = resolveTenantId(event);
  const planCode = resolvePlanCode(event);

  if (!tenantId) {
    return { applied: false, reason: "no matching tenant in metadata" };
  }
  if (!findTenant(tenantId)) {
    return { applied: false, reason: `tenant ${tenantId} not found`, tenantId };
  }

  const type = event.eventType;

  switch (type) {
    case WebhookEventType.OrderCompleted:
      return handleOrderCompleted({ event, tenantId, planCode: planCode ?? null });

    case WebhookEventType.SubscriptionActivated:
      return handleStatusChange(event, tenantId, planCode, "active");

    case WebhookEventType.SubscriptionPaymentSucceeded:
      return handleRenewal(event, tenantId, planCode);

    case WebhookEventType.SubscriptionRenewed:
    case WebhookEventType.SubscriptionRecovered:
      return handleStatusChange(event, tenantId, planCode, "active");

    case WebhookEventType.SubscriptionCanceling:
      return handleStatusChange(event, tenantId, planCode, "canceling", { cancelAtPeriodEnd: true });

    case WebhookEventType.SubscriptionUncanceled:
      return handleStatusChange(event, tenantId, planCode, "active", { cancelAtPeriodEnd: false });

    case WebhookEventType.SubscriptionCanceled:
      return handleStatusChange(event, tenantId, planCode, "canceled", { cancelAtPeriodEnd: false });

    case WebhookEventType.SubscriptionPastDue:
      return handleStatusChange(event, tenantId, planCode, "past_due");

    case WebhookEventType.SubscriptionPlanChanged:
    case WebhookEventType.SubscriptionPlanChangeScheduled:
      return handleStatusChange(event, tenantId, planCode, "active");

    case WebhookEventType.RefundSucceeded:
      return handleRefund(event, tenantId, true);

    case WebhookEventType.RefundFailed:
      return handleRefund(event, tenantId, false);

    default:
      return { applied: false, reason: `unhandled event type ${type}`, tenantId };
  }
}

/**
 * Event reducer, exported for tests.
 *
 * `pancakeWebhook` calls this after signature verification; the billing test
 * script calls it directly with synthetic events so the state machine can be
 * exercised without a real RSA signature from Waffo.
 */
export function applyWebhookEvent(event: WebhookEvent): ApplyOutcome {
  return applyEvent(event);
}

/* ------------------------------------------------------------------ handlers */

function handleOrderCompleted(input: {
  event: WebhookEvent;
  tenantId: string;
  planCode: string | null;
}): ApplyOutcome {
  const { event, tenantId } = input;
  const data = event.data;
  const plan = input.planCode ? findPlan(input.planCode) : undefined;

  return inTransaction(() => {
    const subscription = upsertSubscriptionForOrder({
      tenantId,
      orderId: data.orderId,
      planCode: plan?.code ?? null,
      status: "active",
      metadata: { source: "order.completed", oneTime: plan?.product_type === "onetime" },
    });

    recordPayment({
      tenantId,
      subscriptionId: subscription?.id ?? null,
      planCode: plan?.code ?? null,
      providerOrderId: data.orderId,
      providerPaymentId: data.paymentId ?? null,
      kind: plan?.product_type === "onetime" ? "onetime" : "subscription",
      status: "succeeded",
      amount: data.chargedAmount ?? data.amount,
      taxAmount: data.taxAmount,
      currency: data.currency,
      productName: data.productName,
      buyerEmail: data.buyerEmail,
      mode: event.mode,
      raw: data,
    });

    audit({
      tenantId,
      action: "billing.order_completed",
      targetType: "order",
      targetId: data.orderId,
      metadata: { planCode: plan?.code, amount: data.amount, currency: data.currency },
    });

    return { applied: true, tenantId, planCode: plan?.code };
  });
}

function handleRenewal(
  event: WebhookEvent,
  tenantId: string,
  planCode: string | null
): ApplyOutcome {
  const data = event.data;
  return inTransaction(() => {
    const subscription = findSubscriptionByOrderId(data.orderId);
    if (subscription) {
      updateSubscriptionStatus({
        orderId: data.orderId,
        status: "active",
        currentPeriodStart: data.currentPeriodStart ?? null,
        currentPeriodEnd: data.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: false,
      });
    }

    recordPayment({
      tenantId,
      subscriptionId: subscription?.id ?? null,
      planCode: planCode ?? subscription?.plan_code ?? null,
      providerOrderId: data.orderId,
      providerPaymentId: data.paymentId ?? null,
      kind: "subscription",
      status: "succeeded",
      amount: data.chargedAmount ?? data.amount,
      taxAmount: data.taxAmount,
      currency: data.currency,
      productName: data.productName,
      buyerEmail: data.buyerEmail,
      mode: event.mode,
      raw: data,
    });

    audit({
      tenantId,
      action: "billing.subscription_renewed",
      targetType: "order",
      targetId: data.orderId,
      metadata: { periodEnd: data.currentPeriodEnd, amount: data.amount },
    });

    return { applied: true, tenantId, planCode: planCode ?? subscription?.plan_code ?? undefined };
  });
}

function handleStatusChange(
  event: WebhookEvent,
  tenantId: string,
  planCode: string | null,
  status: SubscriptionStatus,
  extra: { cancelAtPeriodEnd?: boolean } = {}
): ApplyOutcome {
  const data = event.data;
  return inTransaction(() => {
    const subscription =
      findSubscriptionByOrderId(data.orderId) ??
      upsertSubscriptionForOrder({
        tenantId,
        orderId: data.orderId,
        planCode,
        status,
        metadata: { source: event.eventType },
      });

    updateSubscriptionStatus({
      orderId: data.orderId,
      status,
      orderStatus: data.orderStatus ?? null,
      currentPeriodStart: data.currentPeriodStart ?? null,
      currentPeriodEnd: data.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: extra.cancelAtPeriodEnd ?? null,
      metadata: { lastEvent: event.eventType, lastEventAt: event.timestamp },
    });

    audit({
      tenantId,
      action: `billing.${status}`,
      targetType: "order",
      targetId: data.orderId,
      metadata: { eventType: event.eventType, subscriptionId: subscription?.id },
    });

    return { applied: true, tenantId, planCode: planCode ?? subscription?.plan_code ?? undefined };
  });
}

function handleRefund(event: WebhookEvent, tenantId: string, succeeded: boolean): ApplyOutcome {
  const data = event.data;
  return inTransaction(() => {
    const subscription = findSubscriptionByOrderId(data.orderId);
    recordPayment({
      tenantId,
      subscriptionId: subscription?.id ?? null,
      planCode: subscription?.plan_code ?? null,
      providerOrderId: data.orderId,
      providerPaymentId: data.paymentId ?? null,
      kind: "refund",
      status: succeeded ? "refunded" : "failed",
      amount: data.refundedAmount ?? data.amount,
      currency: data.currency,
      productName: data.productName,
      buyerEmail: data.buyerEmail,
      mode: event.mode,
      raw: data,
    });

    // A refunded subscription loses access; a refunded one-time purchase too.
    if (succeeded && subscription) {
      updateSubscriptionStatus({
        orderId: data.orderId,
        status: "canceled",
        cancelAtPeriodEnd: false,
      });
    }

    audit({
      tenantId,
      action: succeeded ? "billing.refund_succeeded" : "billing.refund_failed",
      targetType: "order",
      targetId: data.orderId,
      metadata: { amount: data.refundedAmount ?? data.amount, reason: data.refundReason },
    });

    return { applied: true, tenantId };
  });
}

/* ------------------------------------------------------------------ helpers */

function upsertSubscriptionForOrder(input: {
  tenantId: string;
  orderId: string;
  planCode: string | null;
  status: SubscriptionStatus;
  metadata?: Record<string, unknown>;
}) {
  const existing = findSubscriptionByOrderId(input.orderId);
  if (existing) return existing;

  const planCode = input.planCode ?? "pro_monthly";
  const created = createPendingSubscription({
    tenantId: input.tenantId,
    planCode,
    providerCustomer: input.tenantId,
    metadata: input.metadata,
  });
  attachOrderId(created.id, input.orderId);
  updateSubscriptionStatus({
    orderId: input.orderId,
    status: input.status,
    metadata: input.metadata ?? null,
  });
  return findSubscriptionByOrderId(input.orderId);
}

/** Tenant identity travels in metadata, with the merchant external id as backup. */
function resolveTenantId(event: WebhookEvent): string | null {
  const data = event.data;
  const fromMetadata = data.orderMetadata?.tenantId;
  if (fromMetadata) return fromMetadata;

  const external = data.orderMerchantExternalId;
  if (external && external.includes(":")) return external.split(":")[0]!;

  const identity = data.merchantProvidedBuyerIdentity;
  if (identity && identity.startsWith("TNT_")) return identity;

  return null;
}

function resolvePlanCode(event: WebhookEvent): string | null {
  const data = event.data;
  const fromOrder = data.orderMetadata?.planCode;
  if (fromOrder) return fromOrder;
  const fromProduct = data.productMetadata?.planCode;
  if (fromProduct) return fromProduct;

  const external = data.orderMerchantExternalId;
  if (external && external.includes(":")) return external.split(":")[1] ?? null;
  return null;
}
