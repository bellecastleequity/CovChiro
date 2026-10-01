import { resolveMx } from "node:dns/promises";
import { env } from "@cm/config";

/**
 * Email contact verification for recruitment: the domain must publish mail servers (MX).
 * No mailbox probing (SMTP RCPT checks are unreliable and look like abuse); bounces after
 * a send are handled by suppression. Under test the fake treats *.invalid / "nomx" domains as dead.
 */
export interface EmailVerifier {
  name: string;
  verify(email: string): Promise<{ ok: boolean; check: "mx" | "no_mx" | "dns_error" | "invalid" }>;
}

const dns: EmailVerifier = {
  name: "dns-mx",
  async verify(email) {
    const domain = email.trim().toLowerCase().split("@")[1];
    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return { ok: false, check: "invalid" };
    try {
      const mx = await resolveMx(domain);
      return mx.some((r) => r.exchange && r.exchange !== ".") ? { ok: true, check: "mx" } : { ok: false, check: "no_mx" };
    } catch (e) {
      const code = (e as { code?: string }).code;
      return code === "ENOTFOUND" || code === "ENODATA" ? { ok: false, check: "no_mx" } : { ok: false, check: "dns_error" };
    }
  },
};

const fake: EmailVerifier = {
  name: "fake",
  async verify(email) {
    const domain = email.trim().toLowerCase().split("@")[1] ?? "";
    if (!domain.includes(".")) return { ok: false, check: "invalid" };
    return /\.invalid$|nomx/.test(domain) ? { ok: false, check: "no_mx" } : { ok: true, check: "mx" };
  },
};

let override: EmailVerifier | null = null;
/** Tests: install a verifier (null restores the default). */
export function setEmailVerifier(v: EmailVerifier | null) {
  override = v;
}

export function emailVerifier(): EmailVerifier {
  if (override) return override;
  return env().NODE_ENV === "test" ? fake : dns;
}
