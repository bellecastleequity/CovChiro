import { DateTime } from "luxon";
import { prisma } from "@cm/db";
import { breaks } from "@cm/services";
import { PageHeader } from "@/components/ui/misc";
import { requireActor } from "@/lib/session";
import { BreakWizard } from "./break-wizard";
import { ResumeWizard } from "./resume-wizard";

export const metadata = { title: "Taking a break" };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hm = (m: number) => DateTime.fromObject({ hour: Math.floor(m / 60), minute: m % 60 }).toFormat("h:mm a");

export default async function BreakPage() {
  const { actor } = await requireActor("provider");
  const st = await breaks.breakStatus(actor.providerId!);
  const today = DateTime.now().setZone(st.timeZone).toISODate()!;
  const onBreak = st.onBreak || st.scheduled;
  const p = onBreak
    ? await prisma.provider.findUniqueOrThrow({ where: { id: actor.providerId! }, select: { availability: { orderBy: [{ weekday: "asc" }, { startMin: "asc" }] }, openDates: { where: { endsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" }, take: 10 } } })
    : null;
  const since = st.from ? DateTime.fromJSDate(st.from, { zone: st.timeZone }).toFormat("cccc, LLLL d") : "";
  return (
    <>
      <PageHeader back={{ href: "/provider/profile", label: "Profile" }} title={onBreak ? "Resume coverage" : "Taking a break"} description={onBreak ? (st.scheduled ? `Your break is set to start ${since}. Resume now to cancel it, or pick when you're back.` : `You're on a break since ${since}.`) : "Pause new bookings while you're away. Your profile and history stay as they are."} />
      <div className="max-w-2xl">
        {onBreak ? (
          <ResumeWizard
            today={today}
            since={since}
            hours={p!.availability.map((r) => `${DAYS[r.weekday]} ${hm(r.startMin)} – ${hm(r.endMin)}`)}
            openDates={p!.openDates.map((o) => DateTime.fromJSDate(o.startsAt, { zone: st.timeZone }).toFormat("ccc, LLL d, h:mm a"))}
          />
        ) : (
          <BreakWizard today={today} />
        )}
      </div>
    </>
  );
}
