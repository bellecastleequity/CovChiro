/**
 * Destinations for the backend search bar (components/shell/global-search.tsx), per area.
 * Menu items are added automatically; these add pages that aren't in the menu (sub-pages,
 * tabs, tools) and extra words people might type for each page.
 */
export interface SearchPage {
  label: string;
  href: string;
  section: string;
  keywords?: string;
}

const ADMIN: SearchPage[] = [
  { label: "Dashboard", href: "/admin", section: "Admin", keywords: "home overview today" },
  { label: "Support inbox", href: "/admin/support", section: "Admin", keywords: "help requests tickets questions reply customers" },
  { label: "Verification queue", href: "/admin/verification", section: "Admin", keywords: "licenses credentials malpractice review approve documents" },
  { label: "Shifts", href: "/admin/shifts", section: "Admin", keywords: "bookings coverage assignments schedule" },
  { label: "Provider pay", href: "/admin/payouts", section: "Money", keywords: "payouts stripe transfers holds adjustments bonus pay providers issue payment" },
  { label: "Payments & disputes", href: "/admin/payments", section: "Money", keywords: "charges refunds stripe manual charge clinic billing disputes" },
  { label: "Card disputes (chargebacks)", href: "/admin/payments/chargebacks", section: "Money", keywords: "chargeback dispute bank card stripe evidence" },
  { label: "1099 report", href: "/admin/payments/1099", section: "Money", keywords: "1099 w9 w-9 tax taxes irs contractor nec year end" },
  { label: "Promo codes", href: "/admin/promo", section: "Money", keywords: "discount coupon welcome offer campaign landing" },
  { label: "Referrals", href: "/admin/referrals", section: "Money", keywords: "refer earn invite bonus credit friend" },
  { label: "Timesheets", href: "/admin/timesheets", section: "Admin", keywords: "time clock punches punch in out lunch sign off approval hours" },
  { label: "Rates", href: "/admin/rates", section: "Pricing", keywords: "prices rate cards regions pay half day full day hourly" },
  { label: "States & professions", href: "/admin/states", section: "Pricing", keywords: "markets enable launch florida profession state config" },
  { label: "Providers", href: "/admin/providers", section: "People", keywords: "doctors chiropractors list" },
  { label: "Clinics", href: "/admin/clinics", section: "People", keywords: "practices customers list" },
  { label: "Users & logins", href: "/admin/users", section: "People", keywords: "suspend unsuspend delete ban login staff admins accounts" },
  { label: "Leads", href: "/admin/leads", section: "People", keywords: "inquiries contact waitlist popup spam" },
  { label: "Leads: spam", href: "/admin/leads?spam=1", section: "People", keywords: "junk filtered" },
  { label: "Direct hire requests", href: "/admin/hire", section: "People", keywords: "placement fee conversion hire" },
  { label: "Messages", href: "/admin/messages", section: "Trust & safety", keywords: "blocked messages contact info circumvention" },
  { label: "Emergencies", href: "/admin/emergencies", section: "Trust & safety", keywords: "no show cancel cover rescue" },
  { label: "Tasks", href: "/admin/tasks", section: "Admin", keywords: "todo follow up" },
  { label: "Backups & restore", href: "/admin/backups", section: "Admin", keywords: "backup restore rollback undo neon database export version release" },
  { label: "Audit log", href: "/admin/audit", section: "Admin", keywords: "history changes who did" },
  { label: "Notifications", href: "/admin/notifications", section: "Admin", keywords: "alerts inbox" },
  { label: "Settings", href: "/admin/settings", section: "Admin", keywords: "configuration owner decisions email check google check text check twilio sendgrid" },
  { label: "Analytics", href: "/admin/analytics", section: "Reports", keywords: "traffic visitors conversions revenue" },
  { label: "Provider funnel", href: "/admin/funnel", section: "Reports", keywords: "registered coverage ready" },
  { label: "Supply", href: "/admin/supply", section: "Reports", keywords: "providers by region" },
  { label: "Recruitment (students)", href: "/admin/recruitment", section: "Growth", keywords: "students schools campaigns pre-licensure graduates" },
  { label: "Schools", href: "/admin/schools", section: "Growth", keywords: "colleges student dropdown" },
  { label: "Blog", href: "/admin/blog", section: "Growth", keywords: "posts articles seo drafts" },
  { label: "Growth command center", href: "/admin/growth", section: "Growth", keywords: "overview agents pause outbound" },
  { label: "Growth: providers", href: "/admin/growth/providers", section: "Growth", keywords: "provider funnel recruitment" },
  { label: "Growth: clinics", href: "/admin/growth/clinics", section: "Growth", keywords: "clinic funnel" },
  { label: "Prospecting: clinics", href: "/admin/growth/prospects", section: "Growth", keywords: "npi registry research prospects" },
  { label: "Prospecting: providers", href: "/admin/growth/prospects/providers", section: "Growth", keywords: "provider prospects contact discovery" },
  { label: "Campaigns", href: "/admin/growth/campaigns", section: "Growth", keywords: "join links schools qr" },
  { label: "AI agents", href: "/admin/growth/agents", section: "Growth", keywords: "bots ai switches" },
  { label: "Supply & demand", href: "/admin/growth/markets", section: "Growth", keywords: "markets supply gap critical" },
  { label: "Content", href: "/admin/growth/content", section: "Growth", keywords: "emails templates" },
  { label: "Leads / conversations", href: "/admin/growth/escalations", section: "Growth", keywords: "escalations questions needs answer" },
  { label: "Spam folder", href: "/admin/growth/escalations?view=spam", section: "Growth", keywords: "spam junk sales pitch blocked senders" },
  { label: "Growth analytics", href: "/admin/growth/analytics", section: "Growth", keywords: "attribution economics ai costs" },
  { label: "Growth settings", href: "/admin/growth/settings", section: "Growth", keywords: "ai models budgets caps" },
  { label: "Approvals", href: "/admin/growth/approvals", section: "Growth", keywords: "drafts review outreach" },
  { label: "Sales queue", href: "/admin/growth/sales", section: "Growth", keywords: "high intent leads calls" },
  { label: "Growth activity", href: "/admin/growth/activity", section: "Growth", keywords: "log feed errors" },
  { label: "Expansion", href: "/admin/growth/expansion", section: "Growth", keywords: "states prelaunch live targets markets professions" },
  { label: "Prompts", href: "/admin/growth/prompts", section: "Growth", keywords: "templates wording ai" },
  { label: "Knowledge base", href: "/admin/growth/knowledge", section: "Growth", keywords: "faq answers kb" },
  { label: "Suppression list", href: "/admin/growth/suppression", section: "Growth", keywords: "unsubscribe do not contact" },
];

const CLINIC: SearchPage[] = [
  { label: "Home", href: "/clinic", section: "Clinic", keywords: "dashboard overview" },
  { label: "Post a shift", href: "/clinic/shifts/new", section: "Clinic", keywords: "new coverage request book" },
  { label: "Shifts", href: "/clinic/shifts", section: "Clinic", keywords: "bookings applicants upcoming past" },
  { label: "Billing", href: "/clinic/billing", section: "Clinic", keywords: "card bank payment method invoices receipts charges" },
  { label: "Monthly statements", href: "/clinic/billing/statement", section: "Clinic", keywords: "statement invoice receipts bookkeeping accountant pdf month" },
  { label: "Timesheets", href: "/clinic/timesheets", section: "Clinic", keywords: "time clock punches sign off approve hours" },
  { label: "My providers", href: "/clinic/providers", section: "Clinic", keywords: "favorites blocked doctors" },
  { label: "Refer & earn", href: "/clinic/refer", section: "Clinic", keywords: "referral invite link credit" },
  { label: "Standing bookings", href: "/clinic/standing", section: "Clinic", keywords: "recurring weekly" },
  { label: "Locations", href: "/clinic/locations", section: "Clinic", keywords: "address offices photos arrival" },
  { label: "Team", href: "/clinic/team", section: "Clinic", keywords: "staff users invite" },
  { label: "Settings", href: "/clinic/settings", section: "Clinic", keywords: "agreement experience preferences" },
  { label: "Training", href: "/clinic/academy", section: "Clinic", keywords: "academy how to lessons" },
  { label: "Contact support", href: "/clinic/help/contact", section: "Clinic", keywords: "help support question problem ticket contact us email team" },
  { label: "Messages", href: "/clinic/messages", section: "Clinic", keywords: "chat inbox" },
  { label: "Notifications", href: "/clinic/notifications", section: "Clinic", keywords: "alerts" },
];

const PROVIDER: SearchPage[] = [
  { label: "Home", href: "/provider", section: "Provider", keywords: "dashboard overview" },
  { label: "Find shifts", href: "/provider/shifts", section: "Provider", keywords: "open coverage apply board" },
  { label: "Offers", href: "/provider/offers", section: "Provider", keywords: "invitations accept" },
  { label: "My shifts", href: "/provider/assignments", section: "Provider", keywords: "bookings upcoming schedule confirmed time clock punch in out lunch timesheet" },
  { label: "Earnings", href: "/provider/earnings", section: "Provider", keywords: "pay money paid bonus" },
  { label: "Year-end earnings summary", href: "/provider/earnings/statement", section: "Provider", keywords: "taxes 1099 annual statement pdf year" },
  { label: "Payout setup", href: "/provider/payouts", section: "Provider", keywords: "stripe bank direct deposit" },
  { label: "Credentials", href: "/provider/credentials", section: "Provider", keywords: "license malpractice upload documents" },
  { label: "Availability", href: "/provider/availability", section: "Provider", keywords: "calendar days free" },
  { label: "On Call", href: "/provider/oncall", section: "Provider", keywords: "standby alerts" },
  { label: "Refer & earn", href: "/provider/refer", section: "Provider", keywords: "referral invite link bonus" },
  { label: "Profile", href: "/provider/profile", section: "Provider", keywords: "bio photo agreement travel distance" },
  { label: "Public profile", href: "/provider/profile/public", section: "Provider", keywords: "badges preview" },
  { label: "Standing bookings", href: "/provider/standing", section: "Provider", keywords: "recurring weekly" },
  { label: "Training", href: "/provider/academy", section: "Provider", keywords: "academy how to lessons before after shift reconfirm time clock patient count pay" },
  { label: "Contact support", href: "/provider/help/contact", section: "Provider", keywords: "help support question problem ticket contact us email team" },
  { label: "Feedback", href: "/provider/feedback", section: "Provider", keywords: "ratings reviews" },
  { label: "Messages", href: "/provider/messages", section: "Provider", keywords: "chat inbox" },
  { label: "Notifications", href: "/provider/notifications", section: "Provider", keywords: "alerts" },
];

export function searchPagesFor(root: string): SearchPage[] {
  return root === "/admin" ? ADMIN : root === "/clinic" ? CLINIC : root === "/provider" ? PROVIDER : [];
}
