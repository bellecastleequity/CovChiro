import { NextResponse, type NextRequest } from "next/server";
import { handleStripeEvent } from "@cm/services";

/** Stripe webhooks — signature verified before anything changes (SPEC §9.6). */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  try {
    const r = await handleStripeEvent(raw, req.headers.get("stripe-signature"));
    return NextResponse.json(r);
  } catch (e) {
    console.error("stripe webhook rejected", e);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
