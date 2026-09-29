import { NextResponse, type NextRequest } from "next/server";
import { DomainError } from "@cm/core";
import { auth, leads } from "@cm/services";
import { errorMessage } from "@/lib/action";

/** Public lead capture: welcome pop-up, campaign landing pages, waitlist, contact form. */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  try {
    await auth.checkRateLimit(`lead:${ip}`, 10, 3600);
    const body = await req.json();
    const r = await leads.captureLead({ ...body, visitorId: req.cookies.get("cm_vid")?.value ?? null });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e) }, { status: e instanceof DomainError ? e.status : 400 });
  }
}
