import { prisma } from "@cm/db";
import { feedback } from "@cm/services";
import { AppShell } from "@/components/shell/app-shell";
import type { NavItem } from "@/components/shell/nav-link";
import { requireActor } from "@/lib/session";

export default async function ProviderLayout({ children }: { children: React.ReactNode }) {
  const { actor, user } = await requireActor("provider");
  const [offers, unreadMsgs, newFeedback] = await Promise.all([
    prisma.offer.count({ where: { providerId: actor.providerId!, status: { in: ["PENDING", "ACCEPTED_PENDING"] }, expiresAt: { gt: new Date() } } }),
    prisma.message.count({ where: { readAt: null, senderType: "CLINIC", thread: { providerId: actor.providerId! } } }),
    feedback.unreadFeedbackCount(actor.providerId!).catch(() => 0),
  ]);
  const items: NavItem[] = [
    { href: "/provider", label: "Home", icon: "dashboard", mobile: true },
    { href: "/provider/shifts", label: "Find shifts", icon: "board", mobile: true },
    { href: "/provider/offers", label: "Offers", icon: "offers", badge: offers, mobile: true },
    { href: "/provider/assignments", label: "My shifts", icon: "shifts", mobile: true },
    { href: "/provider/messages", label: "Messages", icon: "messages", badge: unreadMsgs, mobile: true },
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
      {children}
    </AppShell>
  );
}
