import { prisma } from "@cm/db";

/**
 * Starter content, inserted only when missing (never overwrites an admin's
 * edits): approved prompt v1s, Florida launch markets, school campaign links
 * and marketplace knowledge-base articles. Runs from the growth sweep and the
 * admin control center, so fresh installs and upgraded databases both get it.
 */

type Seed = { key: string; agent: string; purpose: string; subject: string | null; body: string; instructions: string | null; vars: string[]; channel?: string; /** Installed as a draft for an admin to approve (nothing uses it until then). */ draft?: boolean };

/** Starter prompts that aren't about one profession; the rest are chiropractic wording. */
export const GENERIC_PROMPT_KEYS = ["CLINIC_ONBOARDING_NEXT_STEP", "ABANDONED_COVERAGE_REQUEST"];

export const DEFAULT_PROMPTS: Seed[] = [
  {
    key: "CLINIC_FIRST_CONTACT", agent: "clinicOutreach", purpose: "First educational email to a chiropractic office.",
    subject: "Keeping {{clinic_name}} open when you're away",
    body: "Hi {{greeting_name}},\n\nWhen the doctor is out for a vacation, a CE weekend or a sick day, many offices simply close and reschedule. It doesn't have to work that way.\n\n{{brand}} books licensed, insured, verified chiropractors to see your scheduled patients while you're away, so visits stay on the books and your team keeps working.\n\nIf it's useful, this short calculator compares what a typical day normally brings in with what coverage would cost: {{calculator_url}}\n\nThanks for reading,\nThe {{brand}} team",
    instructions: "Personalize lightly using only the facts given (clinic type, city). Keep the core message: the office doesn't have to close when the doctor is away. No revenue figures, ROI or guarantees. Don't imply you've looked at their website or schedule. 120-170 words.",
    vars: ["greeting_name", "clinic_name", "city", "segment", "calculator_url", "brand"],
  },
  {
    key: "CLINIC_VACATION_EDUCATION", agent: "clinicOutreach", purpose: "Second touch: planned absences (vacation, CE, family, parental leave).",
    subject: "Planning time off this year?",
    body: "Hi {{greeting_name}},\n\nA quick follow-up. Owners usually book coverage for planned time away: vacations, CE seminars and conferences, family events, maternity or paternity leave, or a recurring day off each week.\n\nPosting a few weeks ahead gives the most choice of providers, and you can set techniques, dress code and day-of contacts so the day runs your way.\n\nSee how it works: {{site_url}}\n\nThe {{brand}} team",
    instructions: "Personalize the opening line to the clinic type if known. Educational, no pressure, no financial promises. 90-140 words.",
    vars: ["greeting_name", "clinic_name", "city", "segment", "site_url", "brand"],
  },
  {
    key: "CLINIC_PI_FIRST_CONTACT", agent: "clinicOutreach", purpose: "First email to a personal injury (auto accident) practice: replaces CLINIC_FIRST_CONTACT for PI prospects once approved.", draft: true,
    subject: "Keeping {{clinic_name}} open when a doctor is out",
    body: "Hi {{greeting_name}},\n\nPersonal injury practices run on availability. When a new accident patient calls, they usually need to be seen soon. In Florida, PIP generally requires treatment to start within 14 days of the accident. If the doctor is out sick, on vacation or at a CE weekend, that patient often goes to the next office that can see them.\n\n{{brand}} books licensed, insured, verified chiropractors to cover your schedule:\n\n- Sick days, vacations and seminar weekends\n- The days you can't be at a second location\n- The weeks between an associate leaving and a new hire starting\n\nYou see whether each covering doctor has personal injury experience before you choose. Enrolling is free, so the day you need someone, it's a two-minute post instead of a scramble.\n\nWe put together a page for PI clinics, with calculators you can run on your own numbers: {{pi_url}}\n\nThanks for reading,\nThe {{brand}} team",
    instructions: "Personalize lightly using only the facts given (clinic type, city). Keep the core message: a PI office doesn't have to turn patients away when a doctor is out. No revenue figures, ROI or guarantees. Don't imply you've looked at their website, schedule or patients. Never mention attorneys, paid referrals or patient solicitation. 140-190 words.",
    vars: ["greeting_name", "clinic_name", "city", "segment", "pi_url", "brand"],
  },
  {
    key: "CLINIC_PI_GROWTH", agent: "clinicOutreach", purpose: "Second email to a personal injury practice (second location, keeping doctors): replaces CLINIC_VACATION_EDUCATION for PI prospects once approved.", draft: true,
    subject: "Thinking about a second location?",
    body: "Hi {{greeting_name}},\n\nA quick follow-up with two situations we hear about a lot from personal injury clinics.\n\nOpening a second location. You can't be in two offices at once, and hiring a full-time doctor before the patients are there is a big bet. Many owners cover the days they can't be at the new office and book the same doctor every week until it's ready for a full-time hire. If that doctor turns out to be the right fit, you can hire them through us.\n\nKeeping your doctors. Burned-out doctors leave. When time off doesn't mean a closed office or a colleague carrying a double schedule, people take it, and they stay.\n\nThe page below has a planner for both, using our current rates and your own numbers: {{pi_url}}\n\nThe {{brand}} team",
    instructions: "Personalize the opening line to the clinic type if known. Educational, no pressure, no financial promises, no attorneys or patient solicitation. 120-170 words.",
    vars: ["greeting_name", "clinic_name", "city", "segment", "pi_url", "brand"],
  },
  {
    key: "CLINIC_SICK_DAY_EDUCATION", agent: "clinicOutreach", purpose: "Third touch: unplanned absences and associate gaps.",
    subject: "When the unexpected takes a doctor out",
    body: "Hi {{greeting_name}},\n\nLast note from us for now. Coverage isn't only for vacations: it's also there for an unexpected illness, a family emergency, or the gap between an associate leaving and a new one starting.\n\nCreating a free clinic account takes a minute and there's nothing to pay until you book: {{signup_url}}\n\nThe {{brand}} team",
    instructions: "Brief and helpful. No urgency tactics. 70-120 words.",
    vars: ["greeting_name", "clinic_name", "segment", "signup_url", "brand"],
  },
  {
    key: "CLINIC_OBJECTION_COST", agent: "clinicConversation", purpose: "Reply drafted for a person to approve when a clinic raises cost.",
    subject: "Re: coverage cost",
    body: "Hi {{greeting_name}},\n\nThat's a fair question. Coverage is priced by region and shift length at consistent published rates, and the calculator here lets you compare it with what a normal day at your office brings in: {{calculator_url}}\n\nEvery office is different and past collections don't guarantee future ones, so it's worth running your own numbers.\n\nThe {{brand}} team",
    instructions: "Acknowledge the specific concern in reply_summary. Never quote a price or promise savings.",
    vars: ["greeting_name", "calculator_url", "reply_summary", "brand"],
  },
  {
    key: "CLINIC_ONBOARDING_NEXT_STEP", agent: "clinicOnboarding", purpose: "Nudge a new clinic account toward its next incomplete step.",
    subject: "Your next step: {{next_step}}",
    body: "Hi {{greeting_name}},\n\nThanks for setting up your {{brand}} account. Here's where things stand:\n\n{{checklist}}\n\nNext up: {{next_step}}. {{next_step_url}}\n\nReply if anything's unclear and a person will help.\n\nThe {{brand}} team",
    instructions: null,
    vars: ["greeting_name", "checklist", "next_step", "next_step_url", "brand"],
  },
  {
    key: "ABANDONED_COVERAGE_REQUEST", agent: "signupRecovery", purpose: "A clinic started a coverage request (draft shift) but didn't post it.",
    subject: "Your coverage request for {{dates}}",
    body: "Hi {{greeting_name}},\n\nYou started a coverage request for {{dates}} but didn't finish posting it. If you had a question about availability, pricing or setup, just reply and we'll help.\n\nPick up where you left off: {{resume_url}}\n\nThe {{brand}} team",
    instructions: "Short, helpful, low-pressure. Never claim the dates are held or about to be taken.",
    vars: ["greeting_name", "dates", "resume_url", "brand"],
  },
  {
    key: "PROVIDER_WELCOME", agent: "providerRecruitment", purpose: "Welcome a newly registered provider (student or licensed).",
    subject: "You're registered, {{first_name}}",
    body: "Hi {{first_name}},\n\nThanks for registering with {{brand}}. Coverage work lets you choose days around your schedule without committing to another permanent position.\n\n{{status_line}}\n\nYour profile: {{profile_url}}\n\nThe {{brand}} team",
    instructions: null,
    vars: ["first_name", "status_line", "profile_url", "brand"],
  },
  {
    key: "PROVIDER_LICENSE_REMINDER", agent: "providerCredentialing", purpose: "Ask a registered graduate whether their license has arrived.",
    subject: "Have you received your chiropractic license?",
    body: "Hi {{first_name}},\n\nChecking in: have you received your {{state_name}} license yet? Once it's added to your profile and verified, you're one step closer to picking up coverage shifts.\n\nAdd your license: {{credentials_url}}\n\nThe {{brand}} team",
    instructions: "Friendly check-in. Never imply any shift is guaranteed.",
    vars: ["first_name", "state_name", "credentials_url", "school", "brand"],
  },
  {
    key: "PROVIDER_MALPRACTICE_REMINDER", agent: "providerCredentialing", purpose: "License verified; ask for malpractice documentation.",
    subject: "One step left: malpractice coverage",
    body: "Hi {{first_name}},\n\nYour license is verified. The last item before you're coverage-ready is proof of malpractice insurance. Upload your certificate here: {{credentials_url}}\n\nThe {{brand}} team",
    instructions: null,
    vars: ["first_name", "credentials_url", "brand"],
  },
  {
    key: "PROVIDER_COVERAGE_READY", agent: "providerActivation", purpose: "Provider just became coverage-ready; encourage availability setup.",
    subject: "You're coverage-ready",
    body: "Hi {{first_name}},\n\nYour credentials are verified and you're coverage-ready. {{travel_line}}\n\nSet the days you're available so we can match you with the right offices: {{availability_url}}\n\nThe {{brand}} team",
    instructions: "Encourage availability setup. Never promise a number of shifts or earnings.",
    vars: ["first_name", "travel_line", "availability_url", "market_name", "brand"],
  },
  {
    key: "PROVIDER_REACTIVATION", agent: "providerActivation", purpose: "Coverage-ready provider with no current availability or no recent activity.",
    subject: "Still interested in coverage days?",
    body: "Hi {{first_name}},\n\nYou're verified and coverage-ready, but we don't have current availability for you. If you'd still like to be considered for coverage days, take a minute to update your available days and travel time: {{availability_url}}\n\nThe {{brand}} team",
    instructions: null,
    vars: ["first_name", "availability_url", "brand"],
  },
  {
    key: "PROVIDER_RECRUIT_FIRST_CONTACT", agent: "providerOutreach", purpose: "First recruitment email to a licensed chiropractor found in the public NPI registry.",
    subject: "Coverage days for chiropractors in {{state_name}}",
    body: "Hi {{greeting_name}},\n\nI'm reaching out because you're a licensed chiropractor in {{state_name}}. {{brand}} connects chiropractors with offices that need a doctor for a day or a few days, when the regular doctor is on vacation, at a seminar or out sick.\n\nYou choose the days you're available and how far you'll travel; offices book through the platform, and you're paid through it. There's no fee to join. To be matched, your license and malpractice insurance are verified first.\n\nIf that sounds useful, you can register here: {{signup_url}}\n\nThanks,\nThe {{brand}} team",
    instructions: "Personalize lightly using only the facts given (city, market). Keep it short and respectful: they didn't ask to hear from us. No earnings figures, no number of shifts, no guarantees, no urgency tricks. 110-160 words.",
    vars: ["greeting_name", "city", "state_name", "market_name", "profession", "signup_url", "site_url", "brand"],
  },
  {
    key: "PROVIDER_RECRUIT_FOLLOW_UP", agent: "providerOutreach", purpose: "One follow-up to a licensed chiropractor who hasn't registered.",
    subject: "Picking up coverage days",
    body: "Hi {{greeting_name}},\n\nA quick follow-up to my last note. Chiropractors use {{brand}} to pick up coverage days around their own schedule, near home or wherever they're willing to travel.\n\nHow it works: {{site_url}}\nRegister: {{signup_url}}\n\nIf it's not for you, no problem; you won't hear from us again about it.\n\nThe {{brand}} team",
    instructions: null,
    vars: ["greeting_name", "city", "state_name", "market_name", "signup_url", "site_url", "brand"],
  },
  {
    key: "PROVIDER_RECRUIT_UNMATCHED_FIRST_CONTACT", agent: "providerOutreach", draft: true,
    purpose: "First recruitment email to a provider found outside the NPI registry (e.g. Apollo.io) and not matched to it: makes no claim about their license.",
    subject: "Coverage days in {{state_name}}",
    body: "Hi {{greeting_name}},\n\nYour professional profile lists you as a chiropractor in {{state_name}}, so I wanted to share {{brand}}: offices book a chiropractor for a day or a few days when their regular doctor is on vacation, at a seminar or out sick.\n\nYou choose the days you're available and how far you'll travel, and you're paid through the platform. There's no fee to join. Before you can be matched, we verify your license and malpractice insurance.\n\nIf it sounds useful, you can register here: {{signup_url}}\n\nThanks,\nThe {{brand}} team",
    instructions: "Personalize lightly using only the facts given. Never say or imply they are licensed or verified. No earnings figures, no number of shifts, no guarantees. 110-160 words.",
    vars: ["greeting_name", "city", "state_name", "market_name", "profession", "signup_url", "site_url", "brand"],
  },
  {
    key: "PROVIDER_RECRUIT_CANADA_WAITLIST", agent: "providerOutreach", draft: true,
    purpose: "One email to a Canadian provider: {{brand}} isn't open in Canada yet, invite them to the waitlist. Sent only with Canada outreach on and a CASL consent basis recorded on the prospect.",
    subject: "{{brand}} is coming to Canada",
    body: "Hi {{greeting_name}},\n\nI found your practice listed publicly in {{state_name}} and wanted to share some news: {{brand}} connects clinics that need short-term coverage with practitioners who want flexible days. We're preparing to open in Canada but don't take bookings there yet.\n\nIf you'd like to hear when we open in your province, you can join the waitlist here: {{waitlist_url}}\n\nThanks,\nThe {{brand}} team",
    instructions: "Keep it short. Never say coverage or shifts are available in Canada now, and never claim they are licensed. Include no dollar figures. 80-130 words.",
    vars: ["greeting_name", "city", "state_name", "profession", "waitlist_url", "site_url", "brand"],
  },
];

const MARKETS = [
  { key: "orlando", name: "Orlando / Central Florida", centerLat: 28.538336, centerLng: -81.379234, radiusMiles: 60, targetProviders: 5, priority: 10 },
  { key: "tampa", name: "Tampa Bay", centerLat: 27.950575, centerLng: -82.457178, radiusMiles: 50, targetProviders: 5, priority: 20 },
  { key: "jacksonville", name: "Jacksonville / Northeast Florida", centerLat: 30.332184, centerLng: -81.655651, radiusMiles: 60, targetProviders: 4, priority: 30 },
  { key: "south", name: "South Florida", centerLat: 26.122439, centerLng: -80.137317, radiusMiles: 55, targetProviders: 6, priority: 40 },
  { key: "southwest", name: "Southwest Florida", centerLat: 26.640628, centerLng: -81.872308, radiusMiles: 55, targetProviders: 3, priority: 50 },
  { key: "north", name: "North Florida / Panhandle", centerLat: 30.438256, centerLng: -84.280733, radiusMiles: 90, targetProviders: 3, priority: 60 },
];

const CAMPAIGNS = [
  { code: "palmer", name: "Palmer College (Florida campus)", schoolName: "Palmer College of Chiropractic", headline: "Palmer grads: pick up coverage days around your schedule" },
  { code: "keiser", name: "Keiser University", schoolName: "Keiser University College of Chiropractic Medicine", headline: "Keiser grads: flexible coverage work in Florida" },
  { code: "life", name: "Life University", schoolName: "Life University", headline: "Heading to Florida after Life? Start here" },
];

const KB = [
  { topic: "provider", audience: "PROVIDER", question: "Can I register before I'm licensed?", answer: "Yes. Students and recent graduates can register before licensure. You can't accept coverage shifts until your license and malpractice insurance are both verified.", keywords: ["student", "graduate", "before license", "register"] },
  { topic: "credentialing", audience: "ALL", question: "What credentials does a covering provider need?", answer: "An active, verified license for the profession in the clinic's state, valid through the end of the shift, plus current verified malpractice insurance.", keywords: ["license", "malpractice", "insurance", "credentials", "verified"] },
  { topic: "provider", audience: "PROVIDER", question: "Do I choose my own days and travel?", answer: "Yes. Providers set their own availability and maximum drive time and can change them at any time.", keywords: ["availability", "days", "travel", "drive", "radius", "schedule"] },
  { topic: "clinic", audience: "CLINIC", question: "Can I request recurring coverage?", answer: "Yes. A standing booking keeps the same provider on a weekly pattern through the platform, at normal prices.", keywords: ["recurring", "standing", "weekly", "regular"] },
  { topic: "clinic", audience: "CLINIC", question: "Can I request coverage for more than one day?", answer: "Yes. Multi-day requests post each day as its own shift so they can be filled together or day by day.", keywords: ["multiple days", "week", "vacation", "multi-day"] },
  { topic: "clinic", audience: "CLINIC", question: "Can I specify techniques or requirements?", answer: "Yes. When you post a shift you can list required skills and techniques and add arrival notes, dress code and an on-site contact.", keywords: ["technique", "skills", "dress code", "requirements"] },
  { topic: "marketing", audience: "CLINIC", question: "Is the cost-of-closing calculator a guarantee?", answer: "No. It's an educational comparison between what a typical day has brought in and what coverage would cost. Past or typical collections don't guarantee future collections.", keywords: ["calculator", "roi", "revenue", "collections", "guarantee"] },
];

export async function ensureGrowthDefaults() {
  const existing = new Set((await prisma.promptTemplate.findMany({ select: { key: true }, distinct: ["key"] })).map((r) => r.key));
  for (const p of DEFAULT_PROMPTS) {
    if (existing.has(p.key)) continue;
    await prisma.promptTemplate.create({
      data: { key: p.key, professionCode: GENERIC_PROMPT_KEYS.includes(p.key) ? null : "DC", version: 1, agent: p.agent, channel: p.channel ?? "EMAIL", purpose: p.purpose, subjectTemplate: p.subject, body: p.body, instructions: p.instructions, allowedVars: p.vars, ...(p.draft ? { status: "DRAFT", active: false, notes: "Starter version: review and approve to use it" } : { status: "APPROVED", active: true, approvedAt: new Date(), notes: "Starter version" }) },
    }).catch(() => undefined);
  }
  if ((await prisma.growthMarket.count()) === 0) {
    for (const m of MARKETS) await prisma.growthMarket.create({ data: { ...m, state: "FL", professionCode: "DC" } }).catch(() => undefined);
  }
  // School links live in one place: skip any code the student path already uses (Admin → Recruitment).
  const recruitSlugs = new Set((await prisma.recruitCampaign.findMany({ select: { slug: true } })).map((r) => r.slug));
  for (const c of CAMPAIGNS) {
    if (recruitSlugs.has(c.code)) continue;
    await prisma.growthCampaign.upsert({
      where: { code: c.code },
      create: { ...c, audience: "PROVIDER", kind: "school", body: "Register now, even before you're licensed. We'll let you know as soon as you're eligible for coverage shifts." },
      update: {},
    });
  }
  if ((await prisma.kbArticle.count()) === 0) {
    for (const k of KB) await prisma.kbArticle.create({ data: { ...k, approved: true } });
  }
}
