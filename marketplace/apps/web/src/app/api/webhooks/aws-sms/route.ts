import { NextResponse, type NextRequest } from "next/server";
import { env } from "@cm/config";
import { isSnsUrl, parseAwsSmsEvent, smsProvider, verifySnsMessage, type SnsMessage } from "@cm/integrations";
import { prisma } from "@cm/db";
import { admin, dispatch, recordChannel } from "@cm/services";

/**
 * AWS End User Messaging SMS → Amazon SNS → here. Two kinds of notification:
 * - a reply from a phone (YES 4821 / NO 4821 / STOP / HELP): answered with a text back;
 * - a delivery result for a text we sent (from the configuration set's event destination).
 * Every message is checked: AWS's signature AND one of our own topics (AWS_SMS_SNS_TOPIC_ARNS).
 * A new subscription is confirmed automatically once it passes the same checks.
 */
export async function POST(req: NextRequest) {
  const e = env();
  const topics = (e.AWS_SMS_SNS_TOPIC_ARNS ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  if (!topics.length) return new NextResponse("not configured", { status: 503 });
  let m: SnsMessage;
  try {
    m = JSON.parse(await req.text()) as SnsMessage;
  } catch {
    return new NextResponse("bad request", { status: 400 });
  }
  const check = await verifySnsMessage(m, topics);
  if (!check.ok) {
    console.error(`[aws-sms] rejected: ${check.reason}`);
    return new NextResponse("forbidden", { status: 403 });
  }

  if (m.Type === "SubscriptionConfirmation") {
    if (!m.SubscribeURL || !isSnsUrl(m.SubscribeURL, "subscribe")) return new NextResponse("bad subscribe url", { status: 400 });
    const r = await fetch(m.SubscribeURL, { signal: AbortSignal.timeout(10000) }).catch(() => null);
    return new NextResponse(r?.ok ? "subscribed" : "confirm failed", { status: r?.ok ? 200 : 502 });
  }
  if (m.Type !== "Notification") return new NextResponse("ok");

  // SNS retries until it gets a 200: handle each message once.
  try {
    await prisma.digestSend.create({ data: { key: `sns:${m.MessageId}`, userId: "system" } });
  } catch {
    return new NextResponse("duplicate");
  }

  const ev = parseAwsSmsEvent(m.Message);
  if (ev.kind === "inbound") {
    const reply = await dispatch.handleInboundSms(ev.from, ev.body);
    // AWS answers STOP / HELP / START itself (and keeps the opt-out list), so don't double-reply to those.
    const word = ev.body.trim().toUpperCase().replace(/[.!]+$/, "");
    const awsAnswers = /^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT|OPTOUT|OPT-OUT|HELP|INFO|START|UNSTOP)$/.test(word);
    if (reply && !awsAnswers) await smsProvider().send(ev.from, reply);
  } else if (ev.kind === "status") {
    await admin.recordSmsEvent({ messageId: ev.messageId, eventType: ev.eventType, delivered: ev.delivered, failed: ev.failed, description: ev.description });
    if (ev.failed) await recordChannel("sms", false, `AWS: ${ev.eventType}${ev.description ? ` (${ev.description})` : ""}`).catch(() => undefined);
  }
  return new NextResponse("ok");
}
