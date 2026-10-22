# Referral-partner outreach (Ocala / Marion County)

Introducing the practice to local personal-injury attorneys, urgent care, imaging centers and primary care.
This is ordinary business-to-business contact using their **public business** phone, email and address.
It is not contact with accident victims; those people are reached only through public advertising.

- **`contacts.csv`** holds 27 starting contacts with public sources. Open it in Excel or Google Sheets. Update the `status`, `contact_person`, `last_contact` and `next_step` columns as you go.
- The listings came from firm websites and directories (FindLaw, Justia, Solv, MDsave, AdventHealth). Some are years old. **Confirm each phone number and address on the first call.**
- To grow the list, use Google Maps ("personal injury attorney Ocala", "urgent care Ocala", "MRI Ocala"), the [Florida Bar directory](https://www.floridabar.org/directories/find-mbr/) and the Ocala/Marion Chamber member directory.

## Sending from the website (Outreach tab)
The emails below are also built into the website: `/_admin` → **Outreach** imports `contacts.csv`, sends the
sequences through SendGrid on a schedule, and tracks opens, clicks, replies, unsubscribes, and which offices
send patients. Setup steps: `deploy/DEPLOY.md` → "Referral-partner outreach". Keep using this file for
calls and visits, or move to the Outreach contact notes.

## Rules (read first)

1. **Never give anything of value for a referral.** That includes cash, gifts, gift cards, meals tied to referrals, free or discounted care for their clients, "marketing fees", or splitting fees. It is a crime under Florida's Patient Brokering Act (§817.505). It is also grounds for discipline under §456.054 (kickbacks), and it can void PIP claims. A modest lunch-and-learn where you present, with nothing tied to referral volume, is customary. Ask your health-care attorney about anything beyond that.
2. **Referrals must be the patient's choice.** Partners may tell people about you. Nobody may steer, pressure, or contact crash victims for you.
3. **Never discuss a patient** with a partner unless you have that patient's signed authorization. The only exception is another treating provider's treatment needs, which HIPAA allows. Attorneys get records only with the patient's signed authorization (see the Notice of Privacy Practices).
4. **Email (CAN-SPAM).** Send one-to-one emails from a real person. Include the practice's physical address and a line like "Reply 'no thanks' and I won't email again." Honor opt-outs immediately. Never buy email lists.
5. **Don't use the lead system for partners.** Leads are patients (PHI). Partner contacts live in Outreach → Contacts (or `contacts.csv`). When a patient says an office sent them, the front desk picks the matching **How did you hear about us?** answer (Attorney, Doctor / clinic, Urgent care, Hospital / ER, or Imaging center referral) in /_admin → Leads, and picks the office under **Referred by**.

## What to say (the value to a partner)

- **Seen fast.** We see new patients same day or next day, so they meet Florida's 14-day PIP deadline.
- **Documentation.** We provide clear exam findings, a treatment plan and progress notes, and we send them promptly when the patient authorizes it.
- **PIP billing handled.** We bill the auto insurer directly and coordinate with the attorney.
- **Spanish and Haitian Creole.** We have pages and materials in both languages (therapyandinjury.com/es/ and /ht/).
- **We refer out when appropriate.** Imaging, orthopedics, pain management and primary care. This is the honest two-way part for medical partners: we send patients to imaging centers and medical doctors when care calls for it.

## Intro email: attorneys

**Subject:** Car-accident patients in Ocala: seen within 24 hours, records on request

Hi [Name],

I'm [Your name] with Therapy & Injury, a chiropractic and rehab practice at 2649 W Silver Springs Blvd in Ocala that focuses on auto-accident injuries.

Here is what that means for your clients:
- New patients are seen the same or next day, well inside the 14-day PIP window.
- We bill PIP directly and send exam findings, treatment plans and progress notes once the client signs a release.
- We have staff and materials in Spanish and Haitian Creole.
- When the injury needs more than we provide, we order imaging and refer to orthopedics or pain management promptly.

Could I drop off a short packet, or take 10 minutes to walk your intake team through how we work? If it's easier, your team can send clients straight to 844-84-TREAT or therapyandinjury.com.

Thank you,
[Your name], [Title]
Therapy & Injury · 2649 W Silver Springs Blvd, Ocala, FL 34475 · [OCALA PHONE] · therapyandinjury.com

*Reply "no thanks" and I won't email again.*

## Intro email: urgent care / primary care

**Subject:** A same-day option for your patients after a car accident

Hi [Name / Practice manager],

I'm [Your name] with Therapy & Injury in Ocala (2649 W Silver Springs Blvd). We treat auto-accident neck and back injuries with chiropractic care and rehab.

Many patients first come to you after a crash and then need follow-up care within 14 days to keep their PIP benefits. If that's helpful, we:
- see them the same or next day and bill their auto insurance directly
- send you our findings and plan with the patient's consent, so their chart with you stays complete
- refer back to you for anything medical, and order imaging when it's indicated

Could I bring by a few patient handouts (English, Spanish and Haitian Creole) and our referral pad?

Thank you,
[Your name], [Title]
Therapy & Injury · 2649 W Silver Springs Blvd, Ocala, FL 34475 · [OCALA PHONE] · therapyandinjury.com

*Reply "no thanks" and I won't email again.*

## Intro email: imaging centers

**Subject:** New referring office in Ocala: auto-injury chiropractic

Hi [Name],

I'm [Your name] with Therapy & Injury, a new chiropractic and rehab practice at 2649 W Silver Springs Blvd in Ocala focused on auto-accident injuries. We expect to order X-ray and MRI studies regularly and would like to set up as a referring office.

Could you tell me:
1. what you need from us to get set up (order forms, portal access, contacts),
2. your typical turnaround for scheduling and reads, and
3. whether you accept PIP and letters of protection?

We'd also be glad to give you patient handouts for anyone who asks about follow-up care.

Thank you,
[Your name], [Title]
Therapy & Injury · 2649 W Silver Springs Blvd, Ocala, FL 34475 · [OCALA PHONE] · therapyandinjury.com

## Phone script (front desk or owner)

> Hi, this is [Name] from Therapy & Injury, a chiropractic and rehab practice on West Silver Springs
> Boulevard here in Ocala. Who handles new provider relationships or intake for your office?
>
> *(Once you have the right person)* We focus on car-accident injuries. We see new patients the same or next day and bill PIP directly, and with the patient's release we send records quickly. We also see patients in Spanish and Haitian Creole. I'd like to drop off a short info packet. Is there a good day this week, and who should I ask for?
>
> *(If they ask "what do you offer us?")* Fast appointments for your clients and patients, and good records. Florida law doesn't allow us to give anything for referrals, and we don't. We just want you to know we're here.
>
> *(Wrap up)* Thank you. What's the best email for you? I'll send our details today.

After each call, update `contacts.csv` with the status, the person you spoke to, the date and the next step.

## Follow-up cadence

| When | What |
|---|---|
| Day 0 | Call. Get the right person's name and email. |
| Same day | Send the intro email for that type of partner. |
| Within 1 week | Drop off the packet: one-pager, brochures (EN/ES/HT), referral pad and business cards. |
| Week 3 | Short check-in: "Any questions? Anything you need from us?" |
| Quarterly | Short update: new hours, new locations, new staff. No gifts. |

Mark `status` as one of: `to contact` → `called` → `emailed` → `visited` → `active partner` / `not interested`.
For anyone who replies "no thanks", set the status to `do not contact` and stop contacting them.
