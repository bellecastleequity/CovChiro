// Site-wide FAQ. Used on /faq/, the Auto Accident Injuries page, and llms.txt.
// Answers containing a [PLACEHOLDER] still show on the page (highlighted) but are left out
// of FAQPage structured data and llms.txt until filled in.

import { branches, branchName, isOpen } from './site';

const listJoin = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')}, and ${xs.at(-1)}` : xs.join(''));
const openNames = branches.filter(isOpen).map(branchName);
const soonCities = branches.filter((b) => !isOpen(b)).map((b) => b.city);

export type Faq = { q: string; a: string; group: 'accident' | 'visit' | 'practice' };

export const faqs: Faq[] = [
  {
    group: 'accident',
    q: 'What is Florida’s 14-day PIP rule?',
    a: 'Florida’s no-fault law generally requires that you receive initial care within 14 days of a motor vehicle accident for your Personal Injury Protection (PIP) benefits to apply (Florida Statutes §627.736). Your policy and insurer determine your coverage.',
  },
  {
    group: 'accident',
    q: 'Will my visit be billed to my auto insurance?',
    a: 'For auto accident injuries, our team can bill your PIP carrier directly. [CONFIRM BILLING PROCESS] Your insurer decides what is covered under your policy.',
  },
  {
    group: 'accident',
    q: 'The accident wasn’t my fault. Does that change anything?',
    a: 'Florida PIP generally pays regardless of who caused the crash. Questions about claims against another driver are best directed to your insurer or an attorney.',
  },
  {
    group: 'accident',
    q: 'What if it has been more than 14 days since my accident?',
    a: 'You can still request a chiropractic visit, but PIP benefits may not apply. Call us and we can talk through your options. [CONFIRM — self-pay / health insurance options]',
  },
  {
    group: 'accident',
    q: 'I feel fine. Should I still get checked after a car accident?',
    a: 'Some people notice stiffness, soreness, or headaches hours or days after a collision. A check-up gives you a baseline and keeps you inside the 14-day window if you need care later.',
  },
  {
    group: 'visit',
    q: 'Do I need a referral to see a chiropractic physician?',
    a: 'In most cases you can request a chiropractic visit directly. [CONFIRM — any insurer-specific referral requirements]',
  },
  {
    group: 'visit',
    q: 'What should I bring to my first visit after an accident?',
    a: 'Photo ID, your auto insurance company’s name and policy card, your claim number if you have one, the police or crash report or report number if available, and a list of current medications.',
  },
  {
    group: 'visit',
    q: 'What happens at the first visit?',
    a: 'Intake paperwork, a conversation about the accident and your symptoms, a chiropractic examination, and a plain-language explanation of what we found and the next steps.',
  },
  {
    group: 'visit',
    q: 'How long does the first visit take?',
    a: 'First visits usually take about [FIRST VISIT LENGTH — e.g., 45–60 minutes].',
  },
  {
    group: 'practice',
    q: 'Do you provide medical care?',
    a: 'Therapy & Injury provides chiropractic care. When a patient needs a medical evaluation, imaging, or care outside chiropractic scope, we refer them to an independent medical provider.',
  },
  {
    group: 'practice',
    q: 'Who provides care at Therapy & Injury?',
    a: 'Care is provided by Florida-licensed chiropractic physicians (D.C.). Each location lists its treating doctor on its location page.',
  },
  {
    group: 'practice',
    q: 'Do you take health insurance?',
    a: '[CONFIRM — health insurance plans accepted, or self-pay options]',
  },
  {
    group: 'practice',
    q: 'Where are your locations?',
    a: `${listJoin(openNames)} ${openNames.length > 1 ? 'are' : 'is'} open now.${soonCities.length ? ` ${listJoin(soonCities)} ${soonCities.length > 1 ? 'are' : 'is'} coming soon.` : ''} See the Locations page for addresses and hours.`,
  },
];

export const faqGroups: { key: Faq['group']; title: string }[] = [
  { key: 'accident', title: 'Car accidents & Florida PIP' },
  { key: 'visit', title: 'Your visit' },
  { key: 'practice', title: 'About our practice' },
];

export const hasPlaceholder = (s: string) => /\[[^\]]+\]/.test(s);
