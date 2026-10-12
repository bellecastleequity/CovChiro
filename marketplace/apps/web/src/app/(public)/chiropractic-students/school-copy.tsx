import Link from "next/link";
import { BadgeCheck, CalendarCheck, GraduationCap, ShieldCheck, Stethoscope, Wallet } from "lucide-react";

/** Shared wording for the chiropractic student / alumni pages (owner request Oct 2026). */
export const studentSignup = (slug?: string) => `/signup?role=provider&student=1${slug ? `&school=${slug}` : ""}&utm_source=site&utm_campaign=${slug ? `school-${slug}` : "students"}`;
export const alumniSignup = (slug?: string) => `/signup?role=provider&utm_source=site&utm_campaign=${slug ? `alumni-${slug}` : "alumni"}`;

export const STUDENT_STEPS = [
  { icon: GraduationCap, title: "Sign up before you graduate", text: "Add your school, graduation date and the state(s) where you plan to practice. No license or malpractice policy needed yet." },
  { icon: CalendarCheck, title: "We keep you on track", text: "Short, timely reminders about what's next as your license and malpractice come through. Nothing you've already sent is asked for twice." },
  { icon: ShieldCheck, title: "Shifts unlock once you're verified", text: "As soon as your state license and malpractice coverage are verified, you can apply for coverage shifts in that state." },
];

export const ALUMNI_POINTS = [
  { icon: Stethoscope, text: "Cover a clinic for a half day, a day or a week, on the days you choose" },
  { icon: Wallet, text: "See the pay before you apply, set your own minimum, and get paid through Stripe" },
  { icon: BadgeCheck, text: "Build a verified profile with ratings and badges clinics can trust" },
];

export function studentFaqs(school?: string) {
  return [
    { q: "Can I sign up while I'm still in school?", a: `Yes. Choose "Student / not yet licensed" when you sign up${school ? ` and pick ${school}` : ""}. You can finish your profile now and add your license and malpractice later.` },
    { q: "When can I start taking shifts?", a: "Once your chiropractic license for that state and your malpractice coverage are verified. Shifts are only offered where you're licensed." },
    { q: "Do I need my own malpractice insurance?", a: "Yes. Covering providers carry their own malpractice policy that covers the state where they work. We verify it before your first shift." },
    { q: "I already graduated. Is this for me?", a: "Yes. Licensed chiropractors use coverage shifts between associate roles, while building their own practice, or for extra income on their days off." },
    { q: "What does it cost?", a: "Nothing. Providers never pay to join or to take a shift." },
  ];
}

export function NotAffiliated({ school, brand }: { school?: string; brand: string }) {
  return (
    <p className="mt-10 text-xs text-slate-500">
      {brand} is independent and is not affiliated with, endorsed by or sponsored by {school ?? "any chiropractic college"}. School names are used only to describe who this page is for. See <Link href="/terms" className="underline">Terms</Link>.
    </p>
  );
}
