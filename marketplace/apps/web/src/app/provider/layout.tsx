import { prisma } from "@cm/db";
import { agreementCurrent, feedback, support } from "@cm/services";
import Link from "next/link";
import { Alert } from "@/components/ui/misc";
import { AppShell } from "@/components/shell/app-shell";
import type { NavItem } from "@/components/shell/nav-link";
import { getSession, requireActor } from "@/lib/session";
import { shortCached } from "@/lib/short-cache";
import { providerSetupStatus } from "@/lib/setup";

export default async function ProviderLayout({ children }: { children: React.ReactNode }) {
  const { actor, user } = await requireActor("provider");
  const [[offers, unreadMsgs, newFeedback, me, standingAsks], setup] = await shortCached(`provider-layout:${actor.providerId}`, () => Promise.all([
    Promise.all([
    prisma.offer.count({ where: { providerId: actor.providerId!, status: { in: ["PENDING", "ACCEPTED_PENDING"] }, expiresAt: { gt: new Date() } } }),
    prisma.message.count({ where: { readAt: null, senderType: "CLINIC", thread: { providerId: actor.providerId! } } }),
    feedback.unreadFeedbackCount(actor.providerId!).catch(() => 0),
    prisma.provider.findUnique({ where: { id: actor.providerId! }, select: { agreementSignedAt: true, agreementVersion: true, photoUrl: true } }),
    prisma.standingBooking.count({ where: { providerId: actor.providerId!, status: "PROPOSED" } }).catch(() => 0),
    ]),
    providerSetupStatus(actor.providerId!, user.email).catch(() => null),
  ]));
  const sides = (await getSession())?.workspaces;
  const needsAgreement = !agreementCurrent("PROVIDER", me?.agreementSignedAt ?? null, me?.agreementVersion ?? null);
  const items: NavItem[] = [
    { href: "/provider", label: "Home", icon: "dashboard", mobile: true },
    { href: "/provider/shifts", label: "Find shifts", icon: "board", mobile: true },
    { href: "/provider/offers", label: "Offers", icon: "offers", badge: offers, mobile: true },
    { href: "/provider/assignments", label: "My shifts", icon: "shifts", mobile: true },
    { href: "/provider/messages", label: "Messages", icon: "messages", badge: unreadMsgs, mobile: true },
    { href: "/provider/standing", label: "Standing bookings", icon: "standing", badge: standingAsks },
    { href: "/provider/oncall", label: "On Call", icon: "notifications" },
    { href: "/provider/earnings", label: "Earnings", icon: "earnings" },
    { href: "/provider/refer", label: "Refer & earn", icon: "refer" },
    { href: "/provider/rewards", label: "Rewards", icon: "rewards" },
    { href: "/provider/feedback", label: "Feedback", icon: "list", badge: newFeedback },
    { href: "/provider/credentials", label: "Credentials", icon: "credentials" },
    { href: "/provider/availability", label: "Availability", icon: "availability" },
    { href: "/provider/payouts", label: "Payout setup", icon: "payments" },
    { href: "/provider/profile", label: "Profile", icon: "profile" },
    { href: "/provider/academy", label: "Training", icon: "academy" },
    { href: "/provider/help", label: "Help", icon: "help", badge: await support.answeredCount(user.id).catch(() => 0) },
  ];
  return (
    <AppShell items={items} root="/provider" userId={user.id} userName={user.name} userPhoto={me?.photoUrl ?? null} subtitle="Provider" setup={setup} otherSide={sides?.clinic ? { to: "CLINIC", label: "Switch to my clinic" } : null} addSide={sides && !sides.clinic ? { href: "/provider/add-clinic", label: "Add my clinic" } : null}>
      {needsAgreement ? (
        <Alert tone="warning" className="mb-6" title={me?.agreementSignedAt ? "Sign the updated Provider Agreement to keep getting shifts" : "Sign the Provider Agreement to start getting shifts"}>
          Until you do, you won&apos;t be matched, offered or able to apply for shifts. Shifts you&apos;re already booked on stay booked. <Link href="/provider/profile#agreement" className="font-medium underline">Review &amp; sign →</Link>
        </Alert>
      ) : null}
      {children}
    </AppShell>
  );
}
