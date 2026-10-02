import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, type JsonWebKey } from "node:crypto";

/**
 * Web Push without a library. Pushes carry no payload (so no message encryption is needed):
 * the service worker wakes up and fetches the user's latest notification itself. Only the VAPID
 * header is required: an ES256-signed JWT for the push service's origin + our public key.
 */
export interface VapidKeys {
  /** Uncompressed P-256 public key, base64url (what browsers call applicationServerKey). */
  publicKey: string;
  privateJwk: JsonWebKey;
}

const b64url = (b: Buffer) => b.toString("base64url");

export function generateVapidKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]);
  return { publicKey: b64url(raw), privateJwk: privateKey.export({ format: "jwk" }) as JsonWebKey };
}

export function vapidAuthHeader(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()): string {
  const aud = new URL(endpoint).origin;
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(Buffer.from(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key = createPrivateKey({ key: keys.privateJwk, format: "jwk" });
  const sig = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${keys.publicKey}`;
}

/** Checks a key pair is usable (public key matches the private one). */
export function vapidKeysValid(keys: VapidKeys): boolean {
  try {
    const pub = createPublicKey({ key: keys.privateJwk, format: "jwk" }).export({ format: "jwk" }) as JsonWebKey;
    const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x!, "base64url"), Buffer.from(pub.y!, "base64url")]);
    return b64url(raw) === keys.publicKey;
  } catch {
    return false;
  }
}

export interface PushSender {
  name: "webpush" | "fake";
  /** "gone" = the subscription no longer exists (delete it). */
  send(endpoint: string, keys: VapidKeys, subject: string): Promise<"ok" | "gone" | "error">;
}

const http: PushSender = {
  name: "webpush",
  async send(endpoint, keys, subject) {
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: vapidAuthHeader(endpoint, keys, subject), TTL: "86400", Urgency: "high", "Content-Length": "0" },
        signal: AbortSignal.timeout(10_000),
      });
      if (r.status === 404 || r.status === 410) return "gone";
      if (!r.ok) console.error(`[push] ${new URL(endpoint).host} answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return r.ok ? "ok" : "error";
    } catch (e) {
      console.error("[push] send failed", e);
      return "error";
    }
  },
};

export class FakePush implements PushSender {
  name = "fake" as const;
  sent: string[] = [];
  gone = new Set<string>();
  async send(endpoint: string) {
    if (this.gone.has(endpoint)) return "gone" as const;
    this.sent.push(endpoint);
    return "ok" as const;
  }
}

let override: PushSender | null = null;
export function setPushSender(p: PushSender | null) {
  override = p;
}
export function pushSender(): PushSender {
  if (override) return override;
  return process.env.NODE_ENV === "test" ? (override = new FakePush()) : http;
}
