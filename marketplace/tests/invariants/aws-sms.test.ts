import { createHmac, createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AwsTexter, isSnsUrl, parseAwsSmsEvent, signAwsJsonPost, smsErrorHelp, verifySnsMessage, type SnsMessage } from "@cm/integrations";

const hmac = (k: Buffer | string, s: string) => createHmac("sha256", k).update(s, "utf8").digest();

describe("AWS texting (End User Messaging SMS)", () => {
  it("signs requests with Signature Version 4", () => {
    // AWS's documented example key: the derived signing key for this secret, day, region and service.
    const kSigning = hmac(hmac(hmac(hmac("AWS4wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", "20150830"), "us-east-1"), "iam"), "aws4_request");
    expect(kSigning.toString("hex")).toBe("c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9");
    const h = signAwsJsonPost({ accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret", region: "us-east-1", service: "sms-voice", host: "sms-voice.us-east-1.amazonaws.com", target: "PinpointSMSVoiceV2.SendTextMessage", body: "{}", now: new Date("2026-10-16T08:34:00Z") });
    expect(h["X-Amz-Date"]).toBe("20261016T083400Z");
    expect(h.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261016\/us-east-1\/sms-voice\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=[0-9a-f]{64}$/);
    // Same input, same signature; a different body changes it.
    const again = signAwsJsonPost({ accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret", region: "us-east-1", service: "sms-voice", host: "sms-voice.us-east-1.amazonaws.com", target: "PinpointSMSVoiceV2.SendTextMessage", body: "{}", now: new Date("2026-10-16T08:34:00Z") });
    const other = signAwsJsonPost({ accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret", region: "us-east-1", service: "sms-voice", host: "sms-voice.us-east-1.amazonaws.com", target: "PinpointSMSVoiceV2.SendTextMessage", body: "{\"a\":1}", now: new Date("2026-10-16T08:34:00Z") });
    expect(again.Authorization).toBe(h.Authorization);
    expect(other.Authorization).not.toBe(h.Authorization);
  });

  const cfg = { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret", region: "us-east-1", origination: "+18885550123", configurationSet: "coverage" };

  it("sends a text and keeps AWS's message id", async () => {
    let seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ MessageId: "msg-123" }), { status: 200 });
    }) as unknown as typeof fetch;
    const t = new AwsTexter(cfg, fake);
    expect(await t.send("+14075550100", "Hello")).toBe(true);
    expect(t.lastId).toBe("msg-123");
    expect(seen!.url).toBe("https://sms-voice.us-east-1.amazonaws.com/");
    expect(seen!.headers["X-Amz-Target"]).toBe("PinpointSMSVoiceV2.SendTextMessage");
    expect(seen!.body).toMatchObject({ DestinationPhoneNumber: "+14075550100", OriginationIdentity: "+18885550123", MessageBody: "Hello", MessageType: "TRANSACTIONAL", ConfigurationSetName: "coverage" });
  });

  it("explains a refusal in plain words (sandbox account, bad keys)", async () => {
    const reply = (status: number, j: unknown) => (async () => new Response(JSON.stringify(j), { status })) as unknown as typeof fetch;
    const sandbox = new AwsTexter(cfg, reply(400, { __type: "com.amazonaws#ValidationException", message: "Destination is not verified", Reason: "DESTINATION_PHONE_NUMBER_NOT_VERIFIED" }));
    expect(await sandbox.send("+14075550100", "x")).toBe(false);
    expect(sandbox.lastErrorKey).toBe("DESTINATION_PHONE_NUMBER_NOT_VERIFIED");
    expect(smsErrorHelp(sandbox)).toMatch(/sandbox/);
    const badKey = new AwsTexter(cfg, reply(400, { __type: "UnrecognizedClientException", message: "The security token included in the request is invalid." }));
    expect(await badKey.send("+14075550100", "x")).toBe(false);
    expect(smsErrorHelp(badKey)).toMatch(/AWS_SMS_ACCESS_KEY_ID/);
  });

  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const topic = "arn:aws:sns:us-east-1:123456789012:coverage-sms";
  function signed(m: Omit<SnsMessage, "Signature" | "SignatureVersion" | "SigningCertURL">): SnsMessage {
    const fields = m.Type === "Notification" ? ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"] : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];
    const rec = m as unknown as Record<string, string | undefined>;
    const text = fields.filter((f) => rec[f] !== undefined).map((f) => `${f}\n${rec[f]}\n`).join("");
    const Signature = createSign("RSA-SHA256").update(text).sign(privateKey, "base64");
    return { ...m, Signature, SignatureVersion: "2", SigningCertURL: "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem" };
  }
  const getCert = async () => pem;

  it("accepts only signed SNS messages from our own topic", async () => {
    const m = signed({ Type: "Notification", MessageId: "1", TopicArn: topic, Message: JSON.stringify({ originationNumber: "+14075550100", destinationNumber: "+18885550123", messageBody: "YES 4821", inboundMessageId: "in-1" }), Timestamp: "2026-10-16T08:34:00.000Z" });
    expect(await verifySnsMessage(m, [topic], getCert)).toEqual({ ok: true });
    expect(await verifySnsMessage(m, ["arn:aws:sns:us-east-1:999999999999:someone-else"], getCert)).toMatchObject({ ok: false, reason: "topic not allowed" });
    expect(await verifySnsMessage({ ...m, Message: m.Message.replace("YES", "NO ") }, [topic], getCert)).toMatchObject({ ok: false, reason: "bad signature" });
    expect(await verifySnsMessage({ ...m, SigningCertURL: "https://evil.example.com/cert.pem" }, [topic], getCert)).toMatchObject({ ok: false });
    expect(isSnsUrl("https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription", "subscribe")).toBe(true);
    expect(isSnsUrl("https://sns.us-east-1.amazonaws.com.evil.com/x.pem", "cert")).toBe(false);
  });

  it("reads replies and delivery results", () => {
    expect(parseAwsSmsEvent(JSON.stringify({ originationNumber: "+14075550100", destinationNumber: "+18885550123", messageBody: "YES 4821", inboundMessageId: "in-1" }))).toMatchObject({ kind: "inbound", from: "+14075550100", body: "YES 4821" });
    expect(parseAwsSmsEvent(JSON.stringify({ eventType: "TEXT_DELIVERED", messageId: "msg-123" }))).toMatchObject({ kind: "status", delivered: true, failed: false });
    expect(parseAwsSmsEvent(JSON.stringify({ eventType: "TEXT_SUCCESSFUL", messageId: "msg-123" }))).toMatchObject({ kind: "status", delivered: false, failed: false });
    expect(parseAwsSmsEvent(JSON.stringify({ eventType: "TEXT_CARRIER_BLOCKED", messageId: "msg-123" }))).toMatchObject({ kind: "status", failed: true });
    expect(parseAwsSmsEvent("not json")).toEqual({ kind: "other" });
  });
});
