import { createHash, createHmac, createVerify } from "node:crypto";

/**
 * AWS End User Messaging SMS (the "sms-voice" v2 API) by raw fetch: no AWS SDK, so the app stays small
 * and inside shared-hosting thread limits. Requests are signed with Signature Version 4.
 * Replies and delivery events come back through Amazon SNS (see verifySnsMessage).
 */

const sha256hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const hmac = (key: Buffer | string, s: string) => createHmac("sha256", key).update(s, "utf8").digest();

/** SigV4 headers for a JSON POST to "/" (all AWS JSON-protocol APIs look like this). */
export function signAwsJsonPost(o: { accessKeyId: string; secretAccessKey: string; region: string; service: string; host: string; target: string; body: string; now?: Date }) {
  const now = o.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20261016T083400Z
  const day = amzDate.slice(0, 8);
  const contentType = "application/x-amz-json-1.0";
  const canonicalHeaders = `content-type:${contentType}\nhost:${o.host}\nx-amz-date:${amzDate}\nx-amz-target:${o.target}\n`;
  const signedHeaders = "content-type;host;x-amz-date;x-amz-target";
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, sha256hex(o.body)].join("\n");
  const scope = `${day}/${o.region}/${o.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${o.secretAccessKey}`, day), o.region), o.service), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  return {
    "Content-Type": contentType,
    "X-Amz-Date": amzDate,
    "X-Amz-Target": o.target,
    Authorization: `AWS4-HMAC-SHA256 Credential=${o.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export interface AwsSmsConfig {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  /** Phone number (+1…), phone number ID/ARN, sender ID or pool ID to send from. */
  origination: string;
  /** Configuration set whose event destination (SNS) reports delivery results. */
  configurationSet?: string;
}

/** Sends texts through AWS. lastErrorKey is AWS's error type or reason, looked up in AWS_SMS_ERROR_HELP. */
export class AwsTexter {
  name = "aws";
  lastError: string | null = null;
  lastErrorCode: number | null = null;
  lastErrorKey: string | null = null;
  lastId: string | null = null;
  constructor(private c: AwsSmsConfig, private fetcher: typeof fetch = fetch) {}

  async send(to: string, body: string) {
    this.lastError = null;
    this.lastErrorCode = null;
    this.lastErrorKey = null;
    this.lastId = null;
    const host = `sms-voice.${this.c.region}.amazonaws.com`;
    const payload = JSON.stringify({
      DestinationPhoneNumber: to,
      OriginationIdentity: this.c.origination,
      MessageBody: body,
      MessageType: "TRANSACTIONAL",
      ...(this.c.configurationSet ? { ConfigurationSetName: this.c.configurationSet } : {}),
    });
    try {
      const headers = signAwsJsonPost({ accessKeyId: this.c.accessKeyId, secretAccessKey: this.c.secretAccessKey, region: this.c.region, service: "sms-voice", host, target: "PinpointSMSVoiceV2.SendTextMessage", body: payload });
      const r = await this.fetcher(`https://${host}/`, { method: "POST", headers, body: payload, signal: AbortSignal.timeout(15000) });
      const j = (await r.json().catch(() => ({}))) as { MessageId?: string; __type?: string; message?: string; Message?: string; Reason?: string };
      if (r.status >= 200 && r.status < 300 && j.MessageId) {
        this.lastId = j.MessageId;
        return true;
      }
      const type = (j.__type ?? "").split("#").pop() || `HTTP ${r.status}`;
      this.lastErrorKey = j.Reason || type;
      this.lastError = `AWS ${r.status} ${type}${j.Reason ? ` (${j.Reason})` : ""}: ${j.message ?? j.Message ?? "request rejected"}`;
    } catch (e) {
      this.lastError = `Couldn't reach AWS: ${(e as Error).message}`;
    }
    console.error(`[sms] to=${to.slice(0, -4)}**** ${this.lastError}`);
    return false;
  }
}

/** AWS SMS errors people actually hit, in plain words with the fix (keyed by error type or Reason). */
export const AWS_SMS_ERROR_HELP: Record<string, string> = {
  UnrecognizedClientException: "AWS doesn't recognise the access key. Copy AWS_SMS_ACCESS_KEY_ID again from the IAM user's access keys.",
  InvalidSignatureException: "AWS rejected the secret key. Copy AWS_SMS_SECRET_ACCESS_KEY again (it's only shown once when the key is created; make a new key if you don't have it).",
  AccessDeniedException: "The AWS keys aren't allowed to send texts. Give the IAM user the sms-voice:SendTextMessage permission (the policy in the setup steps).",
  ResourceNotFoundException: "AWS can't find the sending number or configuration set. Check AWS_SMS_ORIGINATION (your number like +18885550123, or its phone number ID) and AWS_SMS_CONFIGURATION_SET, and that AWS_SMS_REGION is the region where the number lives.",
  DESTINATION_PHONE_NUMBER_NOT_VERIFIED: "Your AWS account is still in the SMS sandbox: it can only text numbers verified in AWS. Request production access (AWS End User Messaging SMS → Account settings), or add this number under Destination phone numbers.",
  DESTINATION_PHONE_NUMBER_OPTED_OUT: "This number replied STOP. They need to text START to your number to receive texts again.",
  MONTHLY_SPEND_LIMIT_REACHED: "The AWS monthly SMS spending limit is reached (new accounts start at $1). Raise it with a quota increase request in the AWS console.",
  ServiceQuotaExceededException: "An AWS SMS limit was hit (monthly spend limit or sending rate). Request a quota increase in the AWS console.",
  ThrottlingException: "AWS is limiting how fast we send. It retries on its own; if it keeps happening, request a higher sending rate.",
  ValidationException: "AWS rejected the request. Usually the destination isn't a valid mobile number, or the sending number isn't registered for this kind of message yet.",
  ConflictException: "AWS refused because of the number's state (often opted out, or the sending number isn't active yet).",
  TEXT_BLOCKED: "The carrier blocked the text. Usually the sending number's registration (toll-free verification or 10DLC) isn't approved yet.",
  TEXT_CARRIER_BLOCKED: "The carrier blocked the text. Usually the sending number's registration (toll-free verification or 10DLC) isn't approved yet.",
  TEXT_SPAM: "The carrier filtered the text as spam. Check the number's registration is approved and the wording matches what was registered.",
  TEXT_INVALID: "That number can't receive texts (landline or invalid).",
  TEXT_UNREACHABLE: "The phone is off or unreachable right now.",
  TEXT_CARRIER_UNREACHABLE: "The carrier couldn't be reached. Try again later.",
  TEXT_TTL_EXPIRED: "The phone didn't come back online in time to receive the text.",
};

/** The SNS fields that are signed, in the order AWS documents. */
const SIGNED_FIELDS: Record<string, string[]> = {
  Notification: ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"],
  SubscriptionConfirmation: ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"],
  UnsubscribeConfirmation: ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"],
};

export interface SnsMessage {
  Type: string;
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  Signature: string;
  SignatureVersion: string;
  SigningCertURL: string;
  Subject?: string;
  SubscribeURL?: string;
  Token?: string;
}

/** Only AWS's own SNS hosts may serve certificates or confirmation links. */
export function isSnsUrl(u: string, kind: "cert" | "subscribe"): boolean {
  try {
    const url = new URL(u);
    if (url.protocol !== "https:" || !/^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(url.hostname)) return false;
    return kind === "cert" ? url.pathname.endsWith(".pem") : true;
  } catch {
    return false;
  }
}

const certCache = new Map<string, string>();
async function fetchCert(u: string): Promise<string> {
  const hit = certCache.get(u);
  if (hit) return hit;
  const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`certificate ${r.status}`);
  const pem = await r.text();
  certCache.set(u, pem);
  return pem;
}

/**
 * Checks an SNS message really came from AWS AND from one of our topics. The signature alone only proves
 * "some SNS topic sent this": anyone can create a topic and point it at us, so the topic must be on our list.
 */
export async function verifySnsMessage(m: SnsMessage, allowedTopics: string[], getCert: (url: string) => Promise<string> = fetchCert): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!m || typeof m !== "object") return { ok: false, reason: "not a JSON object" };
  const fields = SIGNED_FIELDS[m.Type];
  if (!fields) return { ok: false, reason: `unknown type ${m.Type}` };
  if (!allowedTopics.includes(m.TopicArn)) return { ok: false, reason: "topic not allowed" };
  if (!isSnsUrl(m.SigningCertURL, "cert")) return { ok: false, reason: "certificate URL isn't AWS SNS" };
  const algo = m.SignatureVersion === "2" ? "RSA-SHA256" : m.SignatureVersion === "1" ? "RSA-SHA1" : null;
  if (!algo) return { ok: false, reason: `signature version ${m.SignatureVersion}` };
  const text = fields
    .filter((f) => (m as unknown as Record<string, string | undefined>)[f] !== undefined)
    .map((f) => `${f}\n${(m as unknown as Record<string, string>)[f]}\n`)
    .join("");
  let pem: string;
  try {
    pem = await getCert(m.SigningCertURL);
  } catch (e) {
    return { ok: false, reason: `couldn't fetch certificate: ${(e as Error).message}` };
  }
  const ok = createVerify(algo).update(text, "utf8").verify(pem, m.Signature, "base64");
  return ok ? { ok: true } : { ok: false, reason: "bad signature" };
}

/** What an SNS notification from AWS SMS carries: a reply from a phone, or a delivery result. */
export type AwsSmsEvent =
  | { kind: "inbound"; from: string; to: string; body: string; id: string; keyword: string | null }
  | { kind: "status"; messageId: string; eventType: string; delivered: boolean; failed: boolean; description: string | null; to: string | null }
  | { kind: "other" };

export function parseAwsSmsEvent(message: string): AwsSmsEvent {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(message) as Record<string, unknown>;
  } catch {
    return { kind: "other" };
  }
  if (typeof j.originationNumber === "string" && typeof j.messageBody === "string") {
    return { kind: "inbound", from: j.originationNumber, to: String(j.destinationNumber ?? ""), body: j.messageBody, id: String(j.inboundMessageId ?? ""), keyword: typeof j.messageKeyword === "string" ? j.messageKeyword : null };
  }
  const eventType = typeof j.eventType === "string" ? j.eventType : typeof j.messageStatus === "string" ? j.messageStatus : null;
  if (eventType && typeof j.messageId === "string") {
    const delivered = eventType === "TEXT_DELIVERED" || eventType === "DELIVERED";
    const pending = ["TEXT_SUCCESSFUL", "TEXT_QUEUED", "TEXT_PENDING", "SUCCESSFUL", "PENDING", "QUEUED"].includes(eventType);
    return {
      kind: "status",
      messageId: j.messageId,
      eventType,
      delivered,
      failed: !delivered && !pending,
      description: typeof j.messageStatusDescription === "string" ? j.messageStatusDescription : null,
      to: typeof j.destinationPhoneNumber === "string" ? j.destinationPhoneNumber : null,
    };
  }
  return { kind: "other" };
}
