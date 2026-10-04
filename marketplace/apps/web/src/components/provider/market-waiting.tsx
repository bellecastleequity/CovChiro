import { Flag } from "lucide-react";
import { enrollment } from "@cm/services";
import { Card, CardBody } from "@/components/ui/card";

/**
 * Enrolled ahead of their state opening (nationwide enrollment): no shifts there yet. Says so
 * plainly, and shows their Trailblazer place or how many places are left.
 */
export async function MarketWaiting({ providerId }: { providerId: string }) {
  const m = await enrollment.enrollmentStatus(providerId);
  if (m.inOpenMarket || !m.waiting.length) return null;
  const names = m.waiting.map((w) => w.stateName);
  const where = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return (
    <Card className="mb-6 border-amber-300 ring-2 ring-amber-100">
      <CardBody className="flex gap-4">
        <Flag className="mt-0.5 size-6 shrink-0 text-amber-600" />
        <div className="space-y-2 text-sm text-slate-700">
          <div className="text-base font-semibold text-slate-900">You&apos;re early: {where} {names.length === 1 ? "isn't" : "aren't"} open yet</div>
          <p>
            We open state by state, and there are no coverage shifts in {where} yet. You&apos;re in pole position: finish every setup step now, and when we open
            you&apos;ll be among the first providers we notify and invite. We&apos;ll email and text you the day it happens.
          </p>
          {m.waiting.map((w) => (
            <p key={`${w.professionCode}${w.state}`} className="font-medium text-amber-800">
              {w.trailblazer
                ? `${w.stateName}: you're Trailblazer #${w.place} of ${w.spots}. ${w.licenseVerified ? "Your badge is on your profile." : "Your badge appears on your profile once your license is verified."}`
                : w.place
                  ? `${w.stateName}: all ${w.spots} Trailblazer badges are taken (you're #${w.place} in line, and move up if a place opens).`
                  : w.spotsLeft > 0
                    ? `${w.stateName}: ${w.spotsLeft} of ${w.spots} Trailblazer badges left. Add your ${w.stateName} license to claim one.`
                    : `${w.stateName}: all ${w.spots} Trailblazer badges are taken.`}
            </p>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
