import { env } from "@cm/config";

/**
 * Cloudflare Turnstile ("verify you're human") for public forms.
 * Without TURNSTILE_SECRET_KEY the check is off. If Cloudflare can't be reached the
 * form is let through (logged): the spam rules still run, and an outage never blocks signups.
 */
export interface HumanVerifier {
  name: string;
  /** "off" = no key configured; "unreachable" = Cloudflare didn't answer (treated as a pass). */
  verify(token: string | null | undefined, ip?: string | null): Promise<{ ok: boolean; result: "pass" | "fail" | "missing" | "off" | "unreachable"; codes?: string[] }>;
}

const cloudflare = (secret: string): HumanVerifier => ({
  name: "turnstile",
  async verify(token, ip) {
    if (!token) return { ok: false, result: "missing" };
    try {
      const body = new URLSearchParams({ secret, response: token, ...(ip && ip !== "unknown" ? { remoteip: ip } : {}) });
      const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(8000) });
      const j = (await r.json()) as { success?: boolean; "error-codes"?: string[] };
      if (j.success) return { ok: true, result: "pass" };
      const codes = j["error-codes"] ?? [];
      // Our own key problem: don't lock real people out; the spam rules still apply.
      if (codes.some((c) => c.startsWith("invalid-input-secret") || c === "missing-input-secret" || c === "internal-error")) {
        console.error("[turnstile] verification unavailable:", codes.join(","));
        return { ok: true, result: "unreachable", codes };
      }
      return { ok: false, result: "fail", codes };
    } catch (e) {
      console.error("[turnstile] siteverify unreachable", e);
      return { ok: true, result: "unreachable" };
    }
  },
});

const off: HumanVerifier = { name: "off", async verify() { return { ok: true, result: "off" }; } };

let override: HumanVerifier | null = null;
/** Tests: install a verifier (null restores the default). */
export function setHumanVerifier(v: HumanVerifier | null) {
  override = v;
}

export function humanVerifier(): HumanVerifier {
  if (override) return override;
  const secret = env().TURNSTILE_SECRET_KEY;
  return secret ? cloudflare(secret) : off;
}
