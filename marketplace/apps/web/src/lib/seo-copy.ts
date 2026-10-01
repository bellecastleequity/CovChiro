import { brand, type SettingsMap } from "@cm/config";
import { cityLabel } from "@cm/core";
import { siteFaq } from "@cm/services";

/**
 * Landing-page FAQ text. Built only from published facts (siteFaq + Settings),
 * localized with the city/state, so every page says the same true things.
 */

const pick = (s: SettingsMap, ...starts: string[]) => siteFaq(s).filter(([q]) => starts.some((x) => q.startsWith(x)));

export function clinicFaq(s: SettingsMap, o: { profession: string; stateName: string; city?: string }): [string, string][] {
  const b = brand();
  const where = o.city ? `${cityLabel(o.city)}, ${o.stateName}` : o.stateName;
  const prof = o.profession.toLowerCase();
  return [
    [`How do I find a fill-in ${prof} in ${where}?`, `Post the days you need covered on ${b.name}. Only ${prof}s with a verified ${o.stateName} license that's valid through the shift can see and apply to it, and you choose who to confirm (or let us choose).`],
    [`Is a locum ${prof} licensed to work at my ${o.stateName} clinic?`, `They must be. A provider needs a verified license for your profession in ${o.stateName}; a license from another state never qualifies, wherever the provider lives.`],
    ...pick(s, "How do you verify providers?", "Who sets the price?", "What if I need to cancel?", "What if the provider cancels?", "Do you handle patient records?"),
  ];
}

export function providerFaq(s: SettingsMap, o: { profession: string; stateName: string; city?: string }): [string, string][] {
  const b = brand();
  const where = o.city ? `around ${cityLabel(o.city)}` : `in ${o.stateName}`;
  const prof = o.profession.toLowerCase();
  return [
    [`How do I get per diem ${prof} shifts ${where}?`, `Create a free ${b.name} profile, add your ${o.stateName} license and malpractice insurance, and set your availability and how far you'll drive. Once verified you'll see matching shifts with the pay and mileage up front, and can apply in a tap.`],
    [`Do I need a ${o.stateName} license?`, `Yes. Shifts in ${o.stateName} are only shown to ${prof}s with a verified ${o.stateName} license valid through the shift. Students and new graduates can register early and finish verification when their license arrives.`],
    ["Do I pay anything to join?", `No. Creating a profile and applying to shifts on ${b.name} is free for providers.`],
    ...pick(s, "How do providers get paid?", "How do you verify providers?"),
  ];
}
