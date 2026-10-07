import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Lock } from "lucide-react";
import { brand } from "@cm/config";
import { prisma } from "@cm/db";
import { getSettings, prelicensure, schools } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { FormGuard } from "@/components/site/form-guard";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { SOURCE_OPTIONS, StudentFields } from "@/components/provider/student-fields";
import { signupAction } from "../../(auth)/actions";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const BENEFITS = [
  "No subscription to join",
  "No long-term employment commitment",
  "Choose the assignments you want",
  "Set your geographic preferences",
  "See compensation before accepting",
  "Experience different practice settings",
  "Build relationships with clinic owners",
  "Earn while you plan your career",
];

/**
 * Recruitment landing page for chiropractic students and new graduates.
 * /join (general) and /join/<slug> (a school, event or campaign — attributed
 * automatically). It is the student sign-up form with the toggle already on.
 */
export async function JoinPage({ slug, search }: { slug?: string; search: Search }) {
  if (!(await getSettings())["features.preLicensureEnabled"]) notFound();
  const schoolGroups = await schools.schoolOptions();
  const campaign = slug ? await prelicensure.campaignForSlug(slug) : null;
  const dc = await prisma.profession.findUnique({ where: { code: "DC" } });
  const utm = Object.fromEntries((["source", "medium", "campaign", "term", "content"] as const).map((k) => [k, one(search[`utm_${k}`])]));
  const landingPath = `/join${campaign ? `/${campaign.slug}` : ""}`;
  const knownSource = !!campaign || !!utm.source;
  return (
    <div className="bg-gradient-to-b from-brand-50/60 to-white">
      <div className="container-page grid gap-10 py-12 lg:grid-cols-[1.05fr_0.95fr] lg:py-16">
        <div>
          <div className="text-sm font-semibold uppercase tracking-wider text-accent-700">Graduating soon?</div>
          {campaign ? (
            <div className="mt-3 inline-block rounded-full bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white">
              {campaign.kind === "SCHOOL" ? `For ${campaign.name} students & graduates` : campaign.name}
            </div>
          ) : null}
          <h1 className="mt-3 text-4xl font-semibold leading-tight">{campaign?.headline || "Join the Chiropractic Coverage Network"}</h1>
          <p className="mt-4 max-w-xl text-lg text-slate-600">
            Create your provider profile before graduation. Once you're licensed and insured, complete verification and start accepting paid chiropractic coverage opportunities around your schedule.
          </p>
          <ul className="mt-6 grid gap-2.5 sm:grid-cols-2">
            {BENEFITS.map((b) => (
              <li key={b} className="flex gap-2 text-sm text-slate-700">
                <Check className="mt-0.5 size-4 shrink-0 text-accent-600" /> {b}
              </li>
            ))}
          </ul>
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold">How it works</h2>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-600">
              <li>Create your profile now — about two minutes</li>
              <li>Add your chiropractic license once it's issued</li>
              <li>Add your malpractice insurance</li>
              <li>We verify both credentials</li>
              <li>Accept paid coverage shifts near you</li>
            </ol>
            <p className="mt-3 flex gap-2 text-xs text-slate-500">
              <Lock className="size-4 shrink-0" /> Coverage shifts unlock only after your chiropractic license and malpractice insurance have both been verified. You can build your profile at any time before then.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Create your provider profile</h2>
          <p className="mt-1 text-sm text-slate-500">
            Already licensed?{" "}
            <Link href="/signup?role=provider" className="font-medium text-brand-700">
              Use the standard sign-up
            </Link>
            .
          </p>
          <ActionForm action={signupAction} className="mt-5 space-y-4" successMessage={false}>
            <input type="hidden" name="role" value="provider" />
            <input type="hidden" name="student" value="1" />
            <input type="hidden" name="professions" value={dc?.code ?? "DC"} />
            <input type="hidden" name="campaign" value={campaign?.slug ?? ""} />
            <input type="hidden" name="landingPath" value={landingPath} />
            <input type="hidden" name="ref" value={one(search.ref)} />
            {Object.entries(utm).map(([k, v]) => (v ? <input key={k} type="hidden" name={`utm_${k}`} value={v} /> : null))}
            <Field label="Full name" htmlFor="name">
              <Input id="name" name="name" autoComplete="name" required />
            </Field>
            <Field label="Email" htmlFor="email">
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </Field>
            <StudentFields schools={schoolGroups} defaultSchool={campaign?.kind === "SCHOOL" ? campaign.name : undefined} />
            {knownSource ? null : (
              <Field label="How did you hear about us?" htmlFor="source">
                <Select id="source" name="source" defaultValue={one(search.ref) ? "referral" : ""}>
                  {SOURCE_OPTIONS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Create a password" htmlFor="password" hint="At least 10 characters.">
              <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
            </Field>
            <Checkbox name="terms" required label={<>I agree to the <Link href="/terms" target="_blank" className="underline">terms of service</Link> and <Link href="/privacy" target="_blank" className="underline">privacy policy</Link>.</>} />
            <FormGuard />
            <SubmitButton className="w-full" size="lg" pendingText="Creating your profile…">
              Create my provider profile
            </SubmitButton>
            <p className="text-xs text-slate-500">Creating a profile doesn't make you eligible to accept coverage. Shifts unlock only after your license and malpractice insurance are verified by {brand().name}.</p>
          </ActionForm>
          <p className="mt-4 text-center text-sm text-slate-500">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-brand-700">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
