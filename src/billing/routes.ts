import express, { type Request, type Response } from "express";
import { config } from "../config.ts";
import { audit } from "../lib/audit.ts";
import { conflict, handler, notFound } from "../lib/errors.ts";
import { clientIp } from "../lib/http.ts";
import { requireCurrency, requireBody, requireString, optionalString } from "../lib/validate.ts";
import {
  createPendingSubscription,
  findPlan,
  findSubscriptionForTenant,
  listPayments,
  listPlans,
  recentWebhookEvents,
  tenantHasAccess,
} from "../repos/billing.ts";
import { requireAuth, requireRole, requireTenant, tenantId, withAuth } from "../auth/middleware.ts";
import {
  cancelSubscription,
  createCheckoutSession,
  customerPortalUrl,
  pancakeConfigured,
} from "./pancake.ts";

export const billingRouter = express.Router();
billingRouter.use(withAuth);

/* ------------------------------------------------------------------- plans */

billingRouter.get(
  "/billing/plans",
  handler((_req: Request, res: Response) => {
    const plans = listPlans();
    res.json({
      currency: config.billing.currency,
      checkoutAvailable: pancakeConfigured(),
      plans: plans
        .filter((plan) => plan.code !== "free")
        .map((plan) => ({
          code: plan.code,
          name: plan.name,
          description: plan.description,
          productType: plan.product_type,
          billingPeriod: plan.billing_period,
          amount: plan.amount,
          currency: plan.currency,
          trialDays: plan.trial_days,
          features: JSON.parse(plan.features_json) as string[],
          ready: Boolean(plan.pancake_product_id),
        })),
    });
  })
);

/* -------------------------------------------------------------- entitlements */

billingRouter.get(
  "/billing/entitlements",
  requireAuth,
  requireTenant,
  handler((req: Request, res: Response) => {
    res.json({ entitlements: tenantHasAccess(tenantId(req)) });
  })
);

billingRouter.get(
  "/billing/subscription",
  requireAuth,
  requireTenant,
  handler((req: Request, res: Response) => {
    const id = tenantId(req);
    const subscription = findSubscriptionForTenant(id);
    res.json({
      subscription: subscription
        ? {
            id: subscription.id,
            planCode: subscription.plan_code,
            status: subscription.status,
            currentPeriodStart: subscription.current_period_start,
            currentPeriodEnd: subscription.current_period_end,
            cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
            trialEndsAt: subscription.trial_ends_at,
            startedAt: subscription.started_at,
            endedAt: subscription.ended_at,
            orderId: subscription.provider_order_id,
          }
        : null,
      entitlements: tenantHasAccess(id),
    });
  })
);

/* ----------------------------------------------------------------- checkout */

billingRouter.post(
  "/billing/checkout",
  requireAuth,
  requireTenant,
  requireRole("owner", "admin"),
  handler(async (req: Request, res: Response) => {
    const body = requireBody(req.body);
    const planCode = requireString(body.planCode, "planCode", { max: 40 });
    const currency = requireCurrency(body.currency, config.billing.currency);
    const successUrl = optionalString(body.successUrl, "successUrl", 500);

    const plan = findPlan(planCode);
    if (!plan || !plan.is_active) throw notFound(`Unknown plan "${planCode}".`);
    if (!plan.pancake_product_id) {
      throw conflict(
        `The plan "${planCode}" has no Waffo Pancake product yet. Run \`npm run pancake:setup\`.`
      );
    }

    const id = tenantId(req);

    // Guard against a double click creating two subscriptions for one workspace.
    const current = findSubscriptionForTenant(id);
    if (
      current &&
      plan.product_type === "subscription" &&
      ["active", "canceling", "past_due"].includes(current.status)
    ) {
      throw conflict(
        `This workspace already has an active subscription (${current.plan_code}, ${current.status}). ` +
          "Cancel it before starting a new one."
      );
    }

    const session = await createCheckoutSession({
      productId: plan.pancake_product_id,
      currency,
      tenantId: id,
      planCode: plan.code,
      buyerEmail: req.auth!.user.email,
      successUrl,
      trialDays: plan.trial_days,
    });

    const pending = createPendingSubscription({
      tenantId: id,
      planCode: plan.code,
      providerCustomer: id,
      metadata: { sessionId: session.sessionId, startedBy: req.auth!.user.id },
    });

    audit({
      tenantId: id,
      actorUserId: req.auth!.user.id,
      action: "billing.checkout_started",
      targetType: "subscription",
      targetId: pending.id,
      metadata: { planCode: plan.code, sessionId: session.sessionId, currency },
      ip: clientIp(req),
    });

    res.status(201).json({
      subscriptionId: pending.id,
      sessionId: session.sessionId,
      checkoutUrl: session.checkoutUrl,
      expiresAt: session.expiresAt,
      // The front end must open this in a new tab, never via location.href.
      openInNewTab: true,
    });
  })
);

/* -------------------------------------------------------------- cancel / portal */

billingRouter.post(
  "/billing/cancel",
  requireAuth,
  requireTenant,
  requireRole("owner", "admin"),
  handler(async (req: Request, res: Response) => {
    const id = tenantId(req);
    const subscription = findSubscriptionForTenant(id);
    if (!subscription || !subscription.provider_order_id) {
      throw notFound("This workspace has no cancellable subscription.");
    }
    if (!["active", "canceling", "past_due"].includes(subscription.status)) {
      throw conflict(`A subscription in status "${subscription.status}" cannot be canceled.`);
    }

    const result = await cancelSubscription(subscription.provider_order_id);

    audit({
      tenantId: id,
      actorUserId: req.auth!.user.id,
      action: "billing.cancel_requested",
      targetType: "order",
      targetId: subscription.provider_order_id,
      metadata: { resultingStatus: result.status },
      ip: clientIp(req),
    });

    res.json({
      ok: true,
      providerStatus: result.status,
      // The authoritative state arrives with the subscription.canceling /
      // subscription.canceled webhook.
      note: "Access continues until the end of the current period.",
    });
  })
);

billingRouter.post(
  "/billing/portal",
  requireAuth,
  requireTenant,
  handler(async (req: Request, res: Response) => {
    const id = tenantId(req);
    const url = await customerPortalUrl(id);
    audit({
      tenantId: id,
      actorUserId: req.auth!.user.id,
      action: "billing.portal_opened",
      ip: clientIp(req),
    });
    res.json({ portalUrl: url, openInNewTab: true });
  })
);

/* ----------------------------------------------------------------- payments  */

billingRouter.get(
  "/billing/payments",
  requireAuth,
  requireTenant,
  handler((req: Request, res: Response) => {
    res.json({ payments: listPayments(tenantId(req)) });
  })
);

/* ------------------------------------------------------------------- ops     */

billingRouter.get(
  "/billing/webhook-events",
  requireAuth,
  requireTenant,
  handler((req: Request, res: Response) => {
    // Scoped to the caller's workspace: delivery metadata is cross-tenant data.
    res.json({ events: recentWebhookEvents(tenantId(req)) });
  })
);
