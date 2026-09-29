import { env } from "@cm/config";

/**
 * E-signature (SPEC §13). Dropbox Sign sends the versioned template to the
 * signer by email; its webhook (verified by event hash) marks it signed.
 * In development a local click-through page stands in for the vendor. No
 * custom e-signature in production.
 */

export type AgreementKind = "CLINIC" | "PROVIDER";

export interface SignatureRequest {
  envelopeId: string;
  /** Where to send the signer now (vendor email notice page or dev signing page). */
  signUrl: string;
}

export interface ESignProvider {
  name: "dropbox-sign" | "dev";
  send(i: { kind: AgreementKind; signerEmail: string; signerName: string; partyId: string; version: number }): Promise<SignatureRequest>;
  /** Returns envelopeId when the callback is a verified "signed" event, else null. */
  parseCallback(body: Record<string, unknown>): Promise<string | null>;
}

class DropboxSign implements ESignProvider {
  name = "dropbox-sign" as const;
  constructor(private key: string, private templates: Record<AgreementKind, string | undefined>, private baseUrl: string) {}
  private auth() {
    return "Basic " + Buffer.from(`${this.key}:`).toString("base64");
  }
  async send(i: { kind: AgreementKind; signerEmail: string; signerName: string; partyId: string; version: number }) {
    const template = this.templates[i.kind];
    if (!template) throw new Error(`No e-sign template configured for ${i.kind}`);
    const form = new URLSearchParams();
    form.set("template_ids[0]", template);
    form.set("signers[0][role]", i.kind === "CLINIC" ? "Clinic" : "Provider");
    form.set("signers[0][name]", i.signerName);
    form.set("signers[0][email_address]", i.signerEmail);
    form.set("metadata[partyId]", i.partyId);
    form.set("metadata[version]", String(i.version));
    form.set("test_mode", env().NODE_ENV === "production" ? "0" : "1");
    const r = await fetch("https://api.hellosign.com/v3/signature_request/send_with_template", {
      method: "POST",
      headers: { Authorization: this.auth(), "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    const j = (await r.json()) as any;
    if (!r.ok) throw new Error(j?.error?.error_msg ?? "E-sign request failed");
    return { envelopeId: j.signature_request.signature_request_id, signUrl: `${this.baseUrl}/agreements/sent` };
  }
  async parseCallback(body: Record<string, unknown>) {
    const raw = typeof body.json === "string" ? JSON.parse(body.json) : body;
    const ev = raw?.event;
    if (!ev) return null;
    const { createHmac } = await import("node:crypto");
    const expected = createHmac("sha256", this.key).update(`${ev.event_time}${ev.event_type}`).digest("hex");
    if (expected !== ev.event_hash) throw new Error("Invalid e-sign callback hash");
    if (ev.event_type !== "signature_request_all_signed") return null;
    return raw.signature_request?.signature_request_id ?? null;
  }
}

class DevESign implements ESignProvider {
  name = "dev" as const;
  constructor(private baseUrl: string) {}
  async send(i: { partyId: string; kind: AgreementKind; version: number }) {
    const envelopeId = `dev_${i.kind}_${i.partyId}_${i.version}_${Date.now().toString(36)}`;
    return { envelopeId, signUrl: `${this.baseUrl}/agreements/dev-sign?envelope=${encodeURIComponent(envelopeId)}` };
  }
  async parseCallback() {
    if (env().NODE_ENV === "production") throw new Error("Dev e-sign is disabled in production");
    return null;
  }
}

let esign: ESignProvider | null = null;
export function esignProvider(): ESignProvider {
  if (!esign) {
    const e = env();
    esign = e.ESIGN_API_KEY
      ? new DropboxSign(e.ESIGN_API_KEY, { CLINIC: e.ESIGN_CLINIC_TEMPLATE_ID, PROVIDER: e.ESIGN_DOCTOR_TEMPLATE_ID }, e.APP_BASE_URL)
      : new DevESign(e.APP_BASE_URL);
  }
  return esign;
}
