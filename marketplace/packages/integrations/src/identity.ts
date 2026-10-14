import Stripe from "stripe";
import { env } from "@cm/config";

/**
 * Photo ID checks through Stripe Identity (owner decision Oct 2026). The provider uploads a
 * driver's license/ID and a selfie in Stripe's own hosted page; Stripe keeps the images. We
 * read back only the status, the failure reason and the name on the ID (to compare with the
 * account's legal name). Fake under test or without STRIPE_SECRET_KEY.
 */
export interface IdentitySession {
  id: string;
  status: "requires_input" | "processing" | "verified" | "canceled";
  /** Hosted page to (re)open while the session needs input. */
  url: string | null;
  errorCode: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface IdentityProvider {
  name: "stripe" | "fake";
  createSession(i: { providerId: string; email: string; returnUrl: string; legalName: string }): Promise<{ id: string; url: string }>;
  getSession(id: string): Promise<IdentitySession>;
}

class StripeIdentity implements IdentityProvider {
  name = "stripe" as const;
  private s: Stripe;
  constructor(key: string) {
    this.s = new Stripe(key);
  }
  async createSession(i: { providerId: string; email: string; returnUrl: string }) {
    const v = await this.s.identity.verificationSessions.create({
      type: "document",
      options: { document: { require_matching_selfie: true, require_live_capture: true, allowed_types: ["driving_license", "id_card", "passport"] } },
      provided_details: { email: i.email },
      client_reference_id: i.providerId,
      metadata: { providerId: i.providerId },
      return_url: i.returnUrl,
    });
    return { id: v.id, url: v.url! };
  }
  async getSession(id: string): Promise<IdentitySession> {
    const v = await this.s.identity.verificationSessions.retrieve(id, { expand: ["verified_outputs"] });
    const out = v.verified_outputs as { first_name?: string | null; last_name?: string | null } | null;
    return { id: v.id, status: v.status as IdentitySession["status"], url: v.url ?? null, errorCode: v.last_error?.code ?? null, firstName: out?.first_name ?? null, lastName: out?.last_name ?? null };
  }
}

/**
 * Local/test stand-in. The "hosted page" is our own return URL, so the flow completes at once.
 * Outcome: verified with the legal name, unless a test sets `nextOutcome`.
 */
export class FakeIdentity implements IdentityProvider {
  name = "fake" as const;
  sessions = new Map<string, IdentitySession>();
  nextOutcome: Partial<IdentitySession> | null = null;
  private n = 0;
  async createSession(i: { providerId: string; returnUrl: string; legalName: string }) {
    const id = `vs_fake_${i.providerId}_${++this.n}`;
    const parts = i.legalName.replace(/^dr\.?\s+/i, "").trim().split(/\s+/);
    this.sessions.set(id, { id, status: "verified", url: null, errorCode: null, firstName: parts[0] ?? null, lastName: parts[parts.length - 1] ?? null, ...(this.nextOutcome ?? {}) });
    this.nextOutcome = null;
    const sep = i.returnUrl.includes("?") ? "&" : "?";
    return { id, url: `${i.returnUrl}${sep}session=${id}` };
  }
  async getSession(id: string) {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`No such verification session: ${id}`);
    return s;
  }
}

let identity: IdentityProvider | null = null;
export function identityProvider(): IdentityProvider {
  if (!identity) {
    const e = env();
    identity = e.STRIPE_SECRET_KEY ? new StripeIdentity(e.STRIPE_SECRET_KEY) : new FakeIdentity();
  }
  return identity;
}
export function setIdentityProvider(p: IdentityProvider | null) {
  identity = p;
}
