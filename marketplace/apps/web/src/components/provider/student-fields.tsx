import { EXPECTED_LICENSURE, US_STATES } from "@cm/core";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";

/**
 * Extra sign-up fields shown ONLY on the opt-in student / not-yet-licensed
 * path (signup?student=1 and /join). Collected for nurture and reporting —
 * none of it affects which shifts anyone can take.
 */
export interface StudentDefaults {
  school?: string | null;
  graduationDate?: string | null;
  intendedStates?: string[];
  licensureApplied?: string | null;
  expectedLicensure?: string | null;
  homeZip?: string | null;
  maxDriveMinutes?: number;
  preferredArea?: string | null;
  smsConsent?: boolean;
}

export function StudentFields({ defaultSchool, defaultStates = ["FL"], defaults = {}, withPhone = true }: { defaultSchool?: string; defaultStates?: string[]; defaults?: StudentDefaults; withPhone?: boolean }) {
  const states = defaults.intendedStates?.length ? defaults.intendedStates : defaultStates;
  return (
    <div className="space-y-4 rounded-xl border border-accent-200 bg-accent-50/40 p-4">
      <p className="text-sm text-slate-600">No license number or malpractice policy needed yet. You'll add them once you have them — coverage shifts unlock after both are verified.</p>
      {withPhone ? (
        <Field label="Mobile number" htmlFor="phone">
          <Input id="phone" name="phone" type="tel" autoComplete="tel" required />
        </Field>
      ) : null}
      <Field label="Chiropractic school" htmlFor="school">
        <Input id="school" name="school" defaultValue={defaults.school ?? defaultSchool} required />
      </Field>
      <Field label="Graduation date (or expected graduation date)" htmlFor="graduationDate">
        <Input id="graduationDate" name="graduationDate" type="date" defaultValue={defaults.graduationDate ?? undefined} required />
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-slate-700">State(s) where you plan to be licensed</legend>
        <div className="grid max-h-36 grid-cols-4 gap-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 sm:grid-cols-6">
          {Object.keys(US_STATES).map((s) => (
            <label key={s} className="flex items-center gap-1.5 font-mono text-xs">
              <input type="checkbox" name="intendedStates" value={s} defaultChecked={states.includes(s)} /> {s}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Applied for your license yet?" htmlFor="licensureApplied">
          <Select id="licensureApplied" name="licensureApplied" defaultValue={defaults.licensureApplied ?? "no"}>
            <option value="no">Not yet</option>
            <option value="yes">Yes — application submitted</option>
          </Select>
        </Field>
        <Field label="When do you expect to be licensed?" htmlFor="expectedLicensure">
          <Select id="expectedLicensure" name="expectedLicensure" defaultValue={defaults.expectedLicensure ?? "1-3"}>
            {Object.entries(EXPECTED_LICENSURE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Home ZIP code" htmlFor="homeZip">
          <Input id="homeZip" name="homeZip" inputMode="numeric" pattern="\d{5}" maxLength={5} autoComplete="postal-code" defaultValue={defaults.homeZip ?? undefined} required />
        </Field>
        <Field label="How far will you drive (one way)?" htmlFor="maxDriveMinutes">
          <Select id="maxDriveMinutes" name="maxDriveMinutes" defaultValue={String(defaults.maxDriveMinutes ?? 60)}>
            <option value="30">Up to 30 minutes</option>
            <option value="60">Up to 1 hour</option>
            <option value="90">Up to 1.5 hours</option>
            <option value="120">Up to 2 hours</option>
            <option value="180">Up to 3 hours</option>
          </Select>
        </Field>
      </div>
      <Field label="Preferred work area (optional)" htmlFor="preferredArea">
        <Input id="preferredArea" name="preferredArea" placeholder="e.g. Orlando & Space Coast, Tampa Bay" defaultValue={defaults.preferredArea ?? undefined} />
      </Field>
      <Checkbox
        name="smsConsent"
        defaultChecked={defaults.smsConsent}
        label={<span className="text-xs text-slate-600">Text me about my credential status and coverage opportunities. Message frequency varies; message &amp; data rates may apply. Reply STOP to opt out. Not required to join.</span>}
      />
    </div>
  );
}

/** How-did-you-hear select (hidden when a recruitment link or UTM already says). */
export const SOURCE_OPTIONS: [string, string][] = [
  ["", "Choose one…"],
  ["school", "My chiropractic school"],
  ["event", "A graduation or school event"],
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["google", "Google"],
  ["organic", "Searching online"],
  ["provider_referral", "Another provider on the platform"],
  ["clinic_referral", "A clinic owner"],
  ["referral", "A friend or classmate"],
  ["other", "Other"],
];
