/**
 * Phone numbers on file (owner decision Oct 2026): providers need one number and clinics two
 * different numbers before they can post or accept shifts. The numbers are for the platform's own
 * team only; they are never shown to the other side (providers, clinics or clinic staff).
 * With live shifts a number can be changed but not removed, so a booking never loses its contact.
 */

export const REQUIRED_PHONES = { PROVIDER: 1, CLINIC: 2 } as const;

/** +1XXXXXXXXXX for a U.S. (incl. PR/VI) number in any format, else null. */
export function normalizeUsPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10) return null;
  // Area codes and exchanges never start with 0 or 1.
  if (/^[01]/.test(d) || /^[01]/.test(d.slice(3))) return null;
  return `+1${d}`;
}

export function formatUsPhone(phone: string | null | undefined): string {
  const n = normalizeUsPhone(phone);
  if (!n) return phone ?? "";
  return `(${n.slice(2, 5)}) ${n.slice(5, 8)}-${n.slice(8)}`;
}

/** Last four digits only (clinic staff see that the clinic's numbers are on file). */
export function maskPhone(phone: string | null | undefined): string {
  const n = normalizeUsPhone(phone);
  return n ? `(•••) •••-${n.slice(8)}` : "";
}

/** Enough different valid numbers on file for this kind of account. */
export function phonesOnFile(kind: keyof typeof REQUIRED_PHONES, phones: (string | null | undefined)[]): boolean {
  const valid = new Set(phones.map(normalizeUsPhone).filter((p): p is string => !!p));
  return valid.size >= REQUIRED_PHONES[kind];
}

export const PHONE_PRIVACY_NOTE = "Only our team uses these numbers. We never share them with providers, clinics or clinic staff.";

type Problem = { problem: string };

/** A provider saving (or clearing) their number. liveBookings = confirmed or in-progress shifts. */
export function providerPhoneChange(raw: string | null | undefined, liveBookings: boolean): { phone: string | null } | Problem {
  if (!raw?.trim()) {
    if (liveBookings) return { problem: "You have upcoming shifts, so a phone number must stay on file. Enter your new number to change it." };
    return { phone: null };
  }
  const phone = normalizeUsPhone(raw);
  if (!phone) return { problem: "Enter a 10-digit U.S. phone number." };
  return { phone };
}

/** A clinic saving its two numbers. liveShifts = posted or booked shifts that aren't over. */
export function clinicPhonesChange(mainRaw: string | null | undefined, backupRaw: string | null | undefined, liveShifts: boolean): { phone: string | null; backupPhone: string | null } | Problem {
  const out: (string | null)[] = [];
  for (const [raw, label] of [[mainRaw, "main"], [backupRaw, "second"]] as const) {
    if (!raw?.trim()) {
      if (liveShifts) return { problem: "You have shifts posted or booked, so both phone numbers must stay on file. Enter the new number to change one." };
      out.push(null);
      continue;
    }
    const n = normalizeUsPhone(raw);
    if (!n) return { problem: `Enter a 10-digit U.S. number for the ${label} phone.` };
    out.push(n);
  }
  if (out[0] && out[0] === out[1]) return { problem: "The two phone numbers must be different, so we can still reach you if one doesn't answer." };
  return { phone: out[0], backupPhone: out[1] };
}
