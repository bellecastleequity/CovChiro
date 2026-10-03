import Stripe from "stripe";
import { brand, env, isSandbox } from "@cm/config";

/**
 * Payments go only through Stripe Connect (INV-5). Providers get Express
 * connected accounts (Stripe collects bank details, W-9, 1099s); clinics are
 * Customers with a saved card/ACH from a hosted Checkout "setup" session.
 * Every mutating call takes an idempotency key. Database payment state
 * changes only from these server-side responses or verified webhooks.
 */

/** A provider's Stripe Express account: prefilled so onboarding asks only for identity, tax and bank details. */
export interface ConnectedAccountInput {
  email: string;
  providerId: string;
  firstName?: string;
  lastName?: string;
  /** The platform's site (providers have no website of their own). */
  siteUrl: string;
  /** Merchant category, e.g. 8041 chiropractors, 8099 other health services. */
  mcc: string;
  productDescription: string;
}

export interface ChargeResult {
  id: string;
  status: "succeeded" | "processing" | "requires_action" | "failed";
  failureReason?: string;
}

export interface PaymentsProvider {
  name: "stripe" | "fake" | "sandbox";
  createCustomer(input: { name: string; email: string; clinicOrgId: string }): Promise<string>;
  /** Hosted page where the clinic saves a card or bank account. */
  paymentMethodSetupUrl(input: { customerId: string; clinicOrgId: string; returnUrl: string }): Promise<string>;
  createConnectedAccount(input: ConnectedAccountInput): Promise<string>;
  connectOnboardingUrl(input: { accountId: string; providerId: string; returnUrl: string; refreshUrl: string }): Promise<string>;
  connectDashboardUrl(accountId: string): Promise<string | null>;
  accountStatus(accountId: string): Promise<{ payoutsEnabled: boolean; detailsSubmitted: boolean }>;
  chargeOffSession(input: { customerId: string; amountCents: number; idempotencyKey: string; description: string; metadata: Record<string, string> }): Promise<ChargeResult>;
  refund(input: { paymentIntentId: string; amountCents: number; idempotencyKey: string }): Promise<{ id: string }>;
  /**
   * Connect transfer to a provider. With sourcePaymentIntentId the transfer is linked to that clinic
   * charge (Stripe source_transaction): the funds are reserved for the provider (never paid out to
   * the platform) and the transfer can run before the charge's funds become available.
   */
  transfer(input: { accountId: string; amountCents: number; idempotencyKey: string; description: string; metadata: Record<string, string>; sourcePaymentIntentId?: string | null }): Promise<{ id: string }>;
  /** Throws if the signature is invalid. */
  parseWebhook(rawBody: string, signature: string | null): Stripe.Event;
}

/**
 * Idempotency key for "create once" calls. Stripe replays a key's first
 * response for 24h — errors included — so a fixed key would keep returning a
 * setup error even after the owner fixes the Stripe setting. A 5-minute
 * window still absorbs double clicks and retries.
 */
function onceKey(prefix: string, id: string) {
  return `${prefix}-${id}-${Math.floor(Date.now() / 300_000)}`;
}

class StripePayments implements PaymentsProvider {
  name = "stripe" as const;
  private s: Stripe;
  constructor(key: string, private webhookSecret: string | undefined) {
    this.s = new Stripe(key);
  }

  async createCustomer(i: { name: string; email: string; clinicOrgId: string }) {
    const c = await this.s.customers.create({ name: i.name, email: i.email, metadata: { clinicOrgId: i.clinicOrgId } }, { idempotencyKey: onceKey("cust", i.clinicOrgId) });
    return c.id;
  }
  async paymentMethodSetupUrl(i: { customerId: string; clinicOrgId: string; returnUrl: string }) {
    const session = await this.s.checkout.sessions.create({
      mode: "setup",
      customer: i.customerId,
      currency: "usd",
      payment_method_types: ["card", "us_bank_account"],
      success_url: `${i.returnUrl}?setup=done`,
      cancel_url: `${i.returnUrl}?setup=cancelled`,
      // The page's header name and logo come from the Stripe account's Public details and Branding settings.
      custom_text: { submit: { message: `${brand().name} saves this payment method securely with Stripe to bill the coverage shifts your clinic books.` } },
      metadata: { clinicOrgId: i.clinicOrgId },
    });
    return session.url!;
  }
  async createConnectedAccount(i: ConnectedAccountInput) {
    const a = await this.s.accounts.create(
      {
        type: "express", country: "US", email: i.email, capabilities: { transfers: { requested: true } }, business_type: "individual", metadata: { providerId: i.providerId },
        // Prefilled so providers aren't asked for a website or what they sell (they can still edit it).
        business_profile: { url: i.siteUrl, mcc: i.mcc, product_description: i.productDescription },
        individual: { email: i.email, ...(i.firstName ? { first_name: i.firstName } : {}), ...(i.lastName ? { last_name: i.lastName } : {}) },
      },
      { idempotencyKey: onceKey("acct", i.providerId) },
    );
    return a.id;
  }
  async connectOnboardingUrl(i: { accountId: string; returnUrl: string; refreshUrl: string }) {
    const link = await this.s.accountLinks.create({ account: i.accountId, type: "account_onboarding", return_url: i.returnUrl, refresh_url: i.refreshUrl });
    return link.url;
  }
  async connectDashboardUrl(accountId: string) {
    try {
      return (await this.s.accounts.createLoginLink(accountId)).url;
    } catch {
      return null;
    }
  }
  async accountStatus(accountId: string) {
    const a = await this.s.accounts.retrieve(accountId);
    return { payoutsEnabled: !!a.payouts_enabled, detailsSubmitted: !!a.details_submitted };
  }
  async chargeOffSession(i: { customerId: string; amountCents: number; idempotencyKey: string; description: string; metadata: Record<string, string> }): Promise<ChargeResult> {
    const customer = (await this.s.customers.retrieve(i.customerId)) as Stripe.Customer;
    let pm = customer.invoice_settings?.default_payment_method as string | null;
    if (!pm) {
      const list = await this.s.paymentMethods.list({ customer: i.customerId, limit: 1 });
      pm = list.data[0]?.id ?? null;
    }
    if (!pm) return { id: "", status: "failed", failureReason: "No saved payment method" };
    try {
      const pi = await this.s.paymentIntents.create(
        {
          amount: i.amountCents,
          currency: "usd",
          customer: i.customerId,
          payment_method: pm,
          off_session: true,
          confirm: true,
          description: i.description,
          metadata: i.metadata,
          transfer_group: i.metadata.assignmentId,
        },
        { idempotencyKey: i.idempotencyKey },
      );
      const status = pi.status === "succeeded" ? "succeeded" : pi.status === "processing" ? "processing" : pi.status === "requires_action" ? "requires_action" : "failed";
      return { id: pi.id, status };
    } catch (e) {
      const err = e as Stripe.errors.StripeError;
      return { id: (err.payment_intent as Stripe.PaymentIntent | undefined)?.id ?? "", status: "failed", failureReason: err.message };
    }
  }
  async refund(i: { paymentIntentId: string; amountCents: number; idempotencyKey: string }) {
    const r = await this.s.refunds.create({ payment_intent: i.paymentIntentId, amount: i.amountCents }, { idempotencyKey: i.idempotencyKey });
    return { id: r.id };
  }
  async transfer(i: { accountId: string; amountCents: number; idempotencyKey: string; description: string; metadata: Record<string, string>; sourcePaymentIntentId?: string | null }) {
    let source: string | undefined;
    if (i.sourcePaymentIntentId) {
      const pi = await this.s.paymentIntents.retrieve(i.sourcePaymentIntentId);
      source = typeof pi.latest_charge === "string" ? pi.latest_charge : (pi.latest_charge?.id ?? undefined);
      if (!source) throw new Error(`No charge found for ${i.sourcePaymentIntentId}`);
    }
    const t = await this.s.transfers.create(
      { amount: i.amountCents, currency: "usd", destination: i.accountId, description: i.description, metadata: i.metadata, ...(source ? { source_transaction: source } : {}) },
      { idempotencyKey: i.idempotencyKey },
    );
    return { id: t.id };
  }
  /**
   * STRIPE_WEBHOOK_SECRET may hold several comma-separated signing secrets:
   * Stripe gives the "Your account" destination (payments, checkout,
   * transfers) and the "Connected accounts" destination (providers'
   * account.updated) separate secrets, both pointed at the same URL.
   */
  parseWebhook(rawBody: string, signature: string | null) {
    const secrets = (this.webhookSecret ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!secrets.length || !signature) throw new Error("Webhook signature missing");
    let lastError: unknown;
    for (const secret of secrets) {
      try {
        return this.s.webhooks.constructEvent(rawBody, signature, secret);
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  }
}

/**
 * Local fake: no network, deterministic ids, always succeeds unless the
 * amount ends in 13 cents (lets tests exercise the failure path).
 */
export class FakePayments implements PaymentsProvider {
  name = "fake" as const;
  private seq = 0;
  constructor(private baseUrl: string) {}
  private id(prefix: string, key?: string) {
    return `${prefix}_fake_${key ? key.replace(/[^a-zA-Z0-9]/g, "").slice(-24) : Date.now().toString(36) + (this.seq++).toString(36)}`;
  }
  async createCustomer(i: { clinicOrgId: string }) {
    return this.id("cus", i.clinicOrgId);
  }
  async paymentMethodSetupUrl(i: { clinicOrgId: string; returnUrl: string }) {
    return `${this.baseUrl}/api/dev/fake-stripe?kind=setup&org=${encodeURIComponent(i.clinicOrgId)}&return=${encodeURIComponent(i.returnUrl)}`;
  }
  async createConnectedAccount(i: Pick<ConnectedAccountInput, "providerId">) {
    return this.id("acct", i.providerId);
  }
  async connectOnboardingUrl(i: { providerId: string; returnUrl: string }) {
    return `${this.baseUrl}/api/dev/fake-stripe?kind=connect&provider=${encodeURIComponent(i.providerId)}&return=${encodeURIComponent(i.returnUrl)}`;
  }
  async connectDashboardUrl() {
    return null;
  }
  async accountStatus() {
    return { payoutsEnabled: true, detailsSubmitted: true };
  }
  async chargeOffSession(i: { amountCents: number; idempotencyKey: string }): Promise<ChargeResult> {
    if (i.amountCents % 100 === 13) return { id: this.id("pi", i.idempotencyKey), status: "failed", failureReason: "Card declined (test)" };
    return { id: this.id("pi", i.idempotencyKey), status: "succeeded" };
  }
  async refund(i: { idempotencyKey: string }) {
    return { id: this.id("re", i.idempotencyKey) };
  }
  /** Transfers made (tests read this to check linking). */
  transfers: { amountCents: number; sourcePaymentIntentId: string | null; idempotencyKey: string }[] = [];
  /** Every transfer call that went through, in order (tests check nothing is sent twice). */
  transferCalls: string[] = [];
  /** Tests: make the next N transfer calls fail. */
  failNextTransfers = 0;
  /** Tests: fail any transfer this matches. */
  failTransferIf: ((i: { amountCents: number; sourcePaymentIntentId: string | null }) => boolean) | null = null;
  async transfer(i: { amountCents: number; idempotencyKey: string; sourcePaymentIntentId?: string | null }) {
    if (this.failNextTransfers > 0 || this.failTransferIf?.({ amountCents: i.amountCents, sourcePaymentIntentId: i.sourcePaymentIntentId ?? null })) {
      if (this.failNextTransfers > 0) this.failNextTransfers--;
      throw new Error("Transfer failed (test)");
    }
    this.transferCalls.push(i.idempotencyKey);
    if (!this.transfers.some((t) => t.idempotencyKey === i.idempotencyKey)) this.transfers.push({ amountCents: i.amountCents, sourcePaymentIntentId: i.sourcePaymentIntentId ?? null, idempotencyKey: i.idempotencyKey });
    return { id: this.id("tr", i.idempotencyKey) };
  }
  parseWebhook(rawBody: string): Stripe.Event {
    if (env().NODE_ENV === "production" && !isSandbox()) throw new Error("Fake payments cannot accept webhooks in production");
    return JSON.parse(rawBody);
  }
}

/**
 * Test site with a Stripe TEST key: the demo clinics and providers hold fake ids
 * (cus_fake_…, acct_fake_…, pi_fake_…) and are charged/paid by the fake, while
 * accounts you create yourself get real Stripe test-mode customers and Express
 * accounts (card 4242 4242 4242 4242), so both work side by side.
 */
export class SandboxPayments implements PaymentsProvider {
  name = "sandbox" as const;
  constructor(private real: PaymentsProvider, private fake: FakePayments) {}
  private by(id: string | null | undefined) {
    return id && id.includes("_fake_") ? this.fake : this.real;
  }
  createCustomer(i: { name: string; email: string; clinicOrgId: string }) {
    return this.real.createCustomer(i);
  }
  paymentMethodSetupUrl(i: { customerId: string; clinicOrgId: string; returnUrl: string }) {
    return this.by(i.customerId).paymentMethodSetupUrl(i);
  }
  createConnectedAccount(i: ConnectedAccountInput) {
    return this.real.createConnectedAccount(i);
  }
  connectOnboardingUrl(i: { accountId: string; providerId: string; returnUrl: string; refreshUrl: string }) {
    return this.by(i.accountId).connectOnboardingUrl(i);
  }
  connectDashboardUrl(accountId: string) {
    return this.by(accountId).connectDashboardUrl(accountId);
  }
  accountStatus(accountId: string) {
    return this.by(accountId).accountStatus(accountId);
  }
  chargeOffSession(i: { customerId: string; amountCents: number; idempotencyKey: string; description: string; metadata: Record<string, string> }) {
    return this.by(i.customerId).chargeOffSession(i);
  }
  refund(i: { paymentIntentId: string; amountCents: number; idempotencyKey: string }) {
    return this.by(i.paymentIntentId).refund(i);
  }
  transfer(i: { accountId: string; amountCents: number; idempotencyKey: string; description: string; metadata: Record<string, string>; sourcePaymentIntentId?: string | null }) {
    // A fake account is paid by the fake; a real test account from a fake charge goes unlinked.
    if (this.by(i.accountId) === this.fake) return this.fake.transfer(i);
    return this.real.transfer({ ...i, sourcePaymentIntentId: i.sourcePaymentIntentId?.includes("_fake_") ? null : i.sourcePaymentIntentId });
  }
  parseWebhook(rawBody: string, signature: string | null) {
    return this.real.parseWebhook(rawBody, signature);
  }
}

let payments: PaymentsProvider | null = null;
export function paymentsProvider(): PaymentsProvider {
  if (!payments) {
    const e = env();
    const real = e.STRIPE_SECRET_KEY ? new StripePayments(e.STRIPE_SECRET_KEY, e.STRIPE_WEBHOOK_SECRET) : null;
    if (isSandbox(e)) {
      // Live keys are refused at boot (assertSandboxEnv); checked again here in case boot checks were skipped.
      if (e.STRIPE_SECRET_KEY && !/^(sk|rk)_test_/.test(e.STRIPE_SECRET_KEY)) throw new Error("Test site: Stripe live keys are not allowed.");
      payments = real ? new SandboxPayments(real, new FakePayments(e.APP_BASE_URL)) : new FakePayments(e.APP_BASE_URL);
    } else {
      payments = real ?? new FakePayments(e.APP_BASE_URL);
    }
  }
  return payments;
}
export function setPaymentsProvider(p: PaymentsProvider | null) {
  payments = p;
}
