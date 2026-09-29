import { NextResponse, type NextRequest } from "next/server";
import { env } from "@cm/config";
import { prisma } from "@cm/db";
import { paymentsProvider } from "@cm/integrations";
import { activateClinicIfReady, refreshProviderStripe } from "@cm/services";
import { getSession } from "@/lib/session";

/**
 * Development stand-in for Stripe's hosted pages (Checkout setup and Connect
 * onboarding) when no Stripe key is configured. Disabled in production.
 */
export async function GET(req: NextRequest) {
  if (env().NODE_ENV === "production" || paymentsProvider().name !== "fake") return new NextResponse("Not found", { status: 404 });
  const s = await getSession();
  const kind = req.nextUrl.searchParams.get("kind");
  const back = req.nextUrl.searchParams.get("return") ?? "/";
  if (kind === "setup") {
    const org = req.nextUrl.searchParams.get("org")!;
    if (s?.actor.clinicOrgId !== org) return new NextResponse("Forbidden", { status: 403 });
    await prisma.clinicOrg.update({ where: { id: org }, data: { hasPaymentMethod: true, paymentMethodLabel: "Test card •••• 4242" } });
    await activateClinicIfReady(org);
  } else if (kind === "connect") {
    const provider = req.nextUrl.searchParams.get("provider")!;
    if (s?.actor.providerId !== provider) return new NextResponse("Forbidden", { status: 403 });
    await prisma.provider.update({ where: { id: provider }, data: { stripePayoutsEnabled: true } });
    await refreshProviderStripe(provider);
  }
  const url = new URL(back, req.url);
  url.searchParams.set("stripe", "return");
  return NextResponse.redirect(url);
}
