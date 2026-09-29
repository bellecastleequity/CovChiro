import { NextResponse, type NextRequest } from "next/server";
import { esignProvider } from "@cm/integrations";
import { markAgreementSigned } from "@cm/services";

/** Dropbox Sign callback. The event hash is verified before marking anything signed. */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData().catch(() => null);
    const body = form ? Object.fromEntries(form.entries()) : await req.json();
    const envelopeId = await esignProvider().parseCallback(body as Record<string, unknown>);
    if (envelopeId) await markAgreementSigned(envelopeId);
    // Dropbox Sign expects this exact body.
    return new NextResponse("Hello API Event Received", { status: 200 });
  } catch (e) {
    console.error("esign callback rejected", e);
    return new NextResponse("invalid", { status: 400 });
  }
}
