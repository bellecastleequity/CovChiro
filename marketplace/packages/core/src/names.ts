/**
 * How we greet a provider: "Dr. Michael" when they practice a doctoral profession (chiropractors,
 * physicians, podiatrists, optometrists, dentists), otherwise their first name.
 */
export const DOCTOR_PROFESSIONS = ["DC", "MD", "DO", "DPM", "OD", "DDS", "DMD"] as const;

export function firstNameOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const rest = parts.filter((p) => !/^(dr|mr|mrs|ms|mx|prof)\.?$/i.test(p));
  return rest[0] ?? parts[0] ?? "";
}

export function greetingName(name: string, professionCodes: string[]): string {
  const first = firstNameOf(name);
  if (!first) return "";
  return professionCodes.some((c) => (DOCTOR_PROFESSIONS as readonly string[]).includes(c)) ? `Dr. ${first}` : first;
}
