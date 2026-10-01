import { PRIVATE_META } from "@/lib/seo";
import { prisma } from "@cm/db";
import { AGREEMENT_VERSION, feedback } from "@cm/services";
import Link from "next/link";
import { Alert } from "@/components/ui/misc";
import { AppShell } from "@/components/shell/app-shell";
import type { NavItem } from "@/components/shell/nav-link";
import { requireActor } from "@/lib/session";

export default async function ProviderLayout({ children }: { children: React.ReactNode }) {
  const { actor, user } = await requireActor("provider");
  const [offers, unreadMsgs, newFeedback, me, standingAsks] = await Promise.all([
    prisma.offer.count({ where: { providerId: actor.providerId!, status: { in: ["PENDING", "ACCEPTED_PENDING"] }, expiresAt: { gt: new Date() } } }),
    prisma.message.count({ where: { readAt: null, senderType: "CLINIC", thread: { providerId: actor.providerId! } } }),
    feedback.unreadFeedbackCount(actor.providerId!).catch(() => 0),
    prisma.provider.findUnique({ where: { id: actor.providerId! }, select: { agreementSignedAt: true, agreementVersion: true } }),
    prisma.standingBooking.count({ where: { providerId: actor.providerId!, status: "PROPOSED" } }).catch(() => 0),
  ]);
  const agreementUpdate = !!me?.agreementSignedAt && (me.agreementVersion ?? 0) < AGREEMENT_VERSION.PROVIDER;
  const items: NavItem[] = [
    { href: "/provider", label: "Home", icon: "dashboard", mobile: true },
    { href: "/provider/shifts", label: "Find shifts", icon: "board", mobile: true },
    { href: "/provider/offers", label: "Offers", icon: "offers", badge: offers, mobile: true },
    { href: "/provider/assignments", label: "My shifts", icon: "shifts", mobile: true },
    { href: "/provider/messages", label: "Messages", icon: "messages", badge: unreadMsgs, mobile: true },
    { href: "/provider/standing", label: "Standing bookings", icon: "standing", badge: standingAsks },
    { href: "/provider/oncall", label: "On Call", icon: "notifications" },
    { href: "/provider/earnings", label: "Earnings", icon: "earnings" },
    { href: "/provider/feedback", label: "Feedback", icon: "list", badge: newFeedback },
    { href: "/provider/credentials", label: "Credentials", icon: "credentials" },
    { href: "/provider/availability", label: "Availability", icon: "availability" },
    { href: "/provider/payouts", label: "Payout setup", icon: "payments" },
    { href: "/provider/profile", label: "Profile", icon: "profile" },
  ];
  return (
    <AppShell items={items} root="/provider" userId={user.id} userName={user.name} subtitle="Provider">
      {agreementUpdate ? (
        <Alert tone="info" className="mb-6" title="Please review the updated Provider Agreement">
          It now includes our standing-booking and non-circumvention terms. <Link href="/provider/profile#agreement" className="font-medium underline">Review &amp; sign →</Link>
        </Alert>
      ) : null}
      {children}
    </AppShell>
  );
}

/** Never indexed. */
export const metadata = PRIVATE_META;
