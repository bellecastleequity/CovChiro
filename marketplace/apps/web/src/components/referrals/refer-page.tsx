import QRCode from "qrcode";
import { brand } from "@cm/config";
import { dollars } from "@cm/core";
import { referrals } from "@cm/services";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, PageHeader, Stat } from "@/components/ui/misc";
import { dateLabel } from "@/lib/format";
import { ReferralBanner } from "./referral-banner";
import { SharePanel } from "./share-panel";

const STATUS: Record<string, { label: string; tone: "gray" | "amber" | "green" | "red" }> = {
  PENDING: { label: "Joined: waiting for first shift", tone: "gray" },
  FLAGGED: { label: "Being reviewed", tone: "amber" },
  REWARDED: { label: "Earned", tone: "green" },
  REJECTED: { label: "Not eligible", tone: "red" },
  EXPIRED: { label: "Expired", tone: "gray" },
};

/** Refer & earn: personal link, share buttons, QR code, progress. Same page for providers and clinics. */
export async function ReferPage({ userId, kind }: { userId: string; kind: "provider" | "clinic" }) {
  const b = brand();
  const r = await referrals.myReferrals(userId);
  const you = dollars(r.referrerRewardCents);
  const friend = dollars(r.friendRewardCents);
  const qr = await QRCode.toDataURL(r.link, { margin: 1, width: 240 });
  const youGet = kind === "clinic" ? `${you} off your next shift` : `${you} with your next pay`;
  const message = `I'm on ${b.name}, where licensed providers and clinics connect for coverage shifts. Create your free profile with my link so you're ready when the need arises. After your first shift you get a ${friend} bonus.`;
  return (
    <>
      <PageHeader title="Refer & earn" description={`Invite colleagues and clinics you know. When they complete their first shift, you get ${youGet} and they get a ${friend} bonus. There's no limit.`} />
      {!r.enabled ? <Alert tone="warning" className="mb-6">The referral program is paused right now. Rewards you've already earned are still paid.</Alert> : null}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Your link" description={`Code ${r.code}. Share it any way you like; whoever signs up through it is linked to you.`} />
          <CardBody>
            <SharePanel link={r.link} subject={`Join me on ${b.name}`} message={message} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="In person" description="Let them scan it with their phone camera." />
          <CardBody className="grid place-items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt={`QR code for ${r.link}`} className="size-48" />
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="Joined with your link" value={r.joined} />
        <Stat label="Waiting for a first shift" value={r.waiting} />
        <Stat label="You've earned" value={dollars(r.earnedCents)} tone="green" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="How it works" />
          <CardBody>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
              <li>Share your link with providers, students and clinics you know.</li>
              <li>They create a free profile (licensed providers, students and new grads, or clinics).</li>
              <li>When they complete their first shift (for a clinic, its first posted shift is worked and paid), you both earn: <b>{you}</b> for you and a <b>{friend}</b> bonus for them.</li>
              <li>Providers get it with their pay through Stripe. Clinics get it as a credit that comes off their next shift automatically.</li>
            </ol>
            <p className="mt-3 text-xs text-slate-500">Rewards go out a few days after the shift. Self-referrals and duplicate accounts don&apos;t qualify. <a href="/referral-terms" className="underline">Program terms</a>.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Your referrals" />
          {r.rows.length ? (
            <ul className="divide-y divide-slate-100">
              {r.rows.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <span>{x.name} <span className="text-xs text-slate-500">· {x.kind} · joined {dateLabel(x.createdAt)}</span></span>
                  <Badge tone={STATUS[x.status]?.tone ?? "gray"}>{x.status === "REWARDED" ? `Earned ${dollars(x.rewardCents)}` : (STATUS[x.status]?.label ?? x.status)}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <CardBody className="text-sm text-slate-500">No one yet. Your first {you} is one share away.</CardBody>
          )}
        </Card>
      </div>
    </>
  );
}

/** Dashboard referral banner (one line; opens to the ground-floor note, the reward and the person's link). */
export async function GroundFloor({ userId, kind, justJoined }: { userId: string; kind: "provider" | "clinic"; justJoined: boolean }) {
  const b = brand();
  const r = await referrals.myReferrals(userId);
  const friend = dollars(r.friendRewardCents);
  return (
    <ReferralBanner
      kind={kind}
      you={dollars(r.referrerRewardCents)}
      friend={friend}
      link={r.link}
      brandName={b.name}
      message={`I'm on ${b.name}, where licensed providers and clinics connect for coverage shifts. Create your free profile with my link so you're ready when the need arises. After your first shift you get a ${friend} bonus.`}
      justJoined={justJoined}
      joined={r.joined}
      earned={r.earnedCents ? dollars(r.earnedCents) : null}
      referHref={kind === "clinic" ? "/clinic/refer" : "/provider/refer"}
    />
  );
}
