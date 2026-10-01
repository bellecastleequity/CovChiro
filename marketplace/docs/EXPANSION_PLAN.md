# Future Specialty Expansion & Rollout Architecture

> Owner's plan, saved verbatim for future work. **Do not activate any of this yet.**
> The live marketplace is **Chiropractic — Florida**. Use this document to keep new
> architecture future-compatible (configuration over hard-coding) without
> over-engineering the Florida chiropractic MVP. See "How today's code maps to this
> plan" at the end.

## Purpose

This document defines the planned future expansion of the healthcare coverage marketplace beyond chiropractic.

**IMPORTANT**

Do not activate all specialties now.

The initial production marketplace remains:

Chiropractic — Florida

However, all new platform architecture should be designed so additional professions, specialties, states, credentials, facility types, pricing structures, and matching rules can later be added primarily through configuration rather than rebuilding the core marketplace.

---

## 1. Expansion Strategy

Use two forms of expansion:

**Horizontal Expansion** — same profession → additional states.

Florida Chiropractic → Georgia Chiropractic → Texas Chiropractic → North Carolina Chiropractic → additional states → National Chiropractic

**Vertical Expansion** — same marketplace technology → additional healthcare professions.

Chiropractic → Massage → Physical Therapy → Occupational Therapy → Imaging → Dental → Nursing → Advanced Practice → Physician Locums

Initial priority should generally be: expand chiropractic geographically before aggressively expanding into many unrelated professions.

Florida should remain the primary testing environment for new specialty verticals.

---

## 2. Core Expansion Principle

Do NOT hard-code the marketplace around:

- Chiropractor
- Florida Chiropractic License
- Chiropractic Clinic

Instead use:

PROFESSION → SPECIALTY → SUBSPECIALTY → STATE / JURISDICTION → CREDENTIAL REQUIREMENTS → FACILITY REQUIREMENTS → PROVIDER CREDENTIALS → SHIFT REQUIREMENTS → MATCHING RULES

Initial configuration: Healthcare → Chiropractic → Chiropractor → Florida

Future configurations should plug into the same architecture.

---

## 3. Proposed Specialty Rollout Order

This order represents approximate ease of marketplace rollout, not market size or ultimate revenue potential.

### Tier 1 — Initial Marketplace

**1. Chiropractic**

Providers: Chiropractor / DC. Initial market: Florida. Future: additional states; nationwide chiropractic coverage.

Use chiropractic to prove: provider acquisition, pre-license recruiting, credential verification, clinic acquisition, shift posting, matching, payments, cancellations, ratings, fill rate, repeat usage, AI marketing, AI onboarding, geographic marketplace liquidity.

### Tier 2 — Closest Marketplace Extensions

**2. Massage Therapy**

Providers may include: Licensed Massage Therapist; other jurisdiction-specific massage credentials.

Potential facilities: chiropractic clinics, massage practices, wellness clinics, medical practices, spas where appropriate, rehabilitation facilities.

Important: credential/facility rules vary by state. Do not assume Florida requirements apply nationally.

**3. Physical Therapy**

Providers: Physical Therapist — PT; Physical Therapist Assistant — PTA.

Potential facilities: outpatient PT clinics, chiropractic/multidisciplinary clinics, rehabilitation facilities, skilled nursing, home health where appropriate, hospitals, sports medicine, orthopedic practices.

PT and PTA must remain distinct provider types. Supervision and facility requirements must be configurable.

**4. Occupational Therapy**

Providers: Occupational Therapist — OT; Occupational Therapy Assistant — OTA.

Potential facilities: outpatient rehabilitation, skilled nursing, hospitals, pediatrics, home health, rehabilitation centers, specialty clinics.

OT and OTA must remain separate credential/provider types.

### Tier 3 — Diagnostic / Technical Healthcare Staffing

**5. Diagnostic Imaging**

Build imaging as a specialty family rather than a single provider type.

Potential provider types: Diagnostic Medical Sonographer, General Ultrasound Technologist, Echocardiography Technologist, Vascular Sonographer, Radiologic Technologist / X-Ray Tech, CT Technologist, MRI Technologist, Mammography Technologist, Nuclear Medicine Technologist, Radiation Therapy Technologist, other imaging specialties.

Credentials may include: state license/certification, ARDMS, ARRT, NMTCB, other national credentials, facility-specific requirements.

IMPORTANT: not every imaging profession is state licensed. Credential requirements must therefore use Profession + Specialty + State + Facility rather than assuming every provider has a state professional license.

### Tier 4 — Dental Marketplace

**6. Dental**

Initial priority: Dental Hygienist.

Additional provider types: Dental Assistant; Expanded-function Dental Assistant where applicable; Dentist; dental specialists eventually.

Potential dental specialists later: General Dentist, Orthodontist, Endodontist, Periodontist, Prosthodontist, Pediatric Dentist, Oral/Maxillofacial Surgeon.

Dental hygiene may be particularly compatible with short-term coverage because an absent hygienist can result in cancellation of an already-booked patient schedule.

### Tier 5 — Additional Therapy / Office-Based Professions

**7. Speech-Language Pathology**

Providers: Speech-Language Pathologist — SLP; Speech-Language Pathology Assistant where legally recognized.

Potential settings: outpatient, pediatric, rehabilitation, skilled nursing, home health, schools where marketplace structure permits, telehealth where permitted.

**8. Podiatry**

Providers: Podiatrist / DPM. Potential use: vacation coverage, clinic coverage, temporary vacancies, multi-location practice coverage.

**9. Optometry**

Providers: Optometrist / OD. Potential settings: independent optometry offices, optical/retail practices, multi-location groups, temporary office coverage.

### Tier 6 — Behavioral Health

**10. Behavioral / Mental Health**

Potential provider types: Psychologist, Licensed Mental Health Counselor, Licensed Clinical Social Worker, Marriage and Family Therapist, other state-recognized behavioral-health professionals.

Marketplace design may need to support: in-person coverage, telehealth, caseload continuity, state-specific telehealth rules, different scheduling models from physical healthcare clinics.

Do not assume the shift model used for chiropractic will perfectly fit behavioral health.

### Tier 7 — Nursing

**11. Nursing / Facility Staffing**

Potential providers: Registered Nurse — RN; Licensed Practical/Vocational Nurse — LPN/LVN; Certified Nursing Assistant — CNA; Home Health Aide where applicable; other nursing-support roles.

Potential facilities/settings: medical offices, outpatient clinics, ambulatory surgery centers, skilled nursing facilities, assisted living, hospitals, home health, private duty.

IMPORTANT: nursing should undergo a separate legal/business-model review before activation. Potential issues include: healthcare staffing-agency requirements, nurse registry requirements, worker classification, facility contracts, background screening, employee vs contractor structure, workers' compensation, payroll, insurance, facility credentialing, supervision, state-specific staffing laws.

Do NOT activate nursing simply by adding "RN" as another provider type.

### Tier 8 — Advanced Practice Providers

**12. Nurse Practitioners / APRNs**

Potential providers: Nurse Practitioner, APRN, CRNA, Certified Nurse Midwife, Clinical Nurse Specialist, other jurisdiction-recognized APRN roles.

Potential credential objects: RN license, APRN license/status, national certification, specialty, prescriptive authority, DEA where applicable, controlled-substance authority where applicable, malpractice, practice agreement/protocol where applicable, autonomous-practice status where applicable, facility credentialing.

**13. Physician Assistants / Physician Associates**

Providers: PA.

Potential requirements: state license, national certification where applicable, malpractice, DEA/prescriptive credentials where applicable, supervisory/collaborative/practice requirements, facility credentialing, specialty experience.

### Tier 9 — Pharmacy

**14. Pharmacy**

Potential providers: Pharmacist, Pharmacy Technician, specialty pharmacist roles.

Potential settings: retail pharmacy, independent pharmacy, hospital pharmacy, specialty pharmacy, long-term care pharmacy.

Pharmacy should receive a separate compliance/workflow build before activation.

### Tier 10 — Veterinary

**15. Veterinary Coverage**

Potential providers: Veterinarian / DVM/VMD, Veterinary Technician, other credentialed veterinary professionals.

Potential settings: veterinary hospitals, independent practices, emergency veterinary hospitals, specialty practices.

Veterinary coverage could eventually become a separate marketplace vertical using the same underlying scheduling/matching infrastructure.

### Tier 11 — Physician Locum Tenens

**16. Primary Care / General Physician Coverage**

Potential specialties: Family Medicine, Internal Medicine, Pediatrics, General Practice, Urgent Care, Occupational Medicine.

This represents the transition into traditional physician locum-tenens territory. Require substantially stronger credentialing and facility workflows.

**17. Physician Specialty Locums**

Potential specialties include, but are not limited to:

- **Hospital-Based:** Hospital Medicine / Hospitalist, Emergency Medicine, Critical Care, Anesthesiology, Radiology, Pathology
- **Medical Specialties:** Cardiology, Gastroenterology, Neurology, Nephrology, Pulmonology, Endocrinology, Rheumatology, Hematology, Oncology, Infectious Disease, Allergy/Immunology, Geriatrics
- **Surgical Specialties:** General Surgery, Orthopedic Surgery, Neurosurgery, Vascular Surgery, Cardiothoracic Surgery, Plastic Surgery, Trauma Surgery, other surgical subspecialties
- **Office / Procedural Specialties:** Dermatology, Ophthalmology, ENT / Otolaryngology, Urology, PM&R / Physiatry, Pain Medicine
- **Women's Health:** Obstetrics & Gynecology, Maternal-Fetal Medicine, other OB/GYN subspecialties
- **Psychiatry:** General Psychiatry, Child/Adolescent Psychiatry, other psychiatric subspecialties

Additional specialties should be addable without database redesign.

**18. Additional Locum / Per-Diem Categories to Preserve**

Architecture should also allow future addition of: Respiratory Therapist, Surgical Technologist, Medical Assistant, Phlebotomist, Laboratory Technologist, Medical Laboratory Scientist, Medical Laboratory Technician, Dialysis Technician, EEG/Neurodiagnostic Technologist, Cardiovascular Technologist, Perfusionist, respiratory-care specialists, Athletic Trainer, Dietitian/Nutrition professional where credentialed, Audiologist, Hearing-aid specialist, Prosthetist/Orthotist, other licensed or credentialed allied-health professionals.

These are not necessarily recommended early-launch verticals. The purpose is to ensure the data architecture can accommodate them later.

---

## 19. Universal Provider Credential Model

Do not create fixed database columns such as `chiropractic_license_number` as the primary long-term credential architecture.

Instead support multiple credential records per provider:

Provider → Credential { Type, Profession, Specialty, Issuing Authority, State/Jurisdiction, Credential Number, Issue Date, Expiration Date, Status, Verification Status, Verification Date, Document }

Potential credential types: professional license, certification, national board credential, malpractice insurance, DEA registration, CPR/BLS, ACLS, PALS, background screening, facility credential, specialty certification, controlled-substance authority, other.

## 20. Credential Rules Engine

Build configurable requirements.

Example: IF Profession = Chiropractic AND State = Florida THEN REQUIRE Active Florida Chiropractic License + Required Malpractice Insurance.

Different example: IF Profession = Imaging AND Specialty = Diagnostic Medical Sonography AND State = [State] THEN load credential rules configured for that profession/state/facility combination.

Do not allow AI to determine whether legally required credentials can be ignored.

## 21. Universal Facility Model

Avoid limiting customer accounts to "Chiropractic Clinic". Support facility types such as: chiropractic clinic, PT clinic, OT clinic, multidisciplinary clinic, dental practice, imaging center, physician office, urgent care, hospital, ambulatory surgery center, skilled nursing facility, assisted living, home health agency, pharmacy, veterinary practice, behavioral-health practice, other approved facility types.

## 22. Universal Shift Model

A shift should support: Facility, Profession Required, Specialty, Subspecialty, Date, Start Time, End Time, Break, Compensation, Location, Required Credentials, Preferred Credentials, Experience Requirement, Technique/Skill Requirements, Patient Volume, Recurring vs One-Time, Urgency, Additional Facility Requirements.

This allows the same shift engine to support a chiropractor today and potentially a physician locum later.

## 23. Matching Architecture

Matching should eventually evaluate: Profession + Specialty + Credential Eligibility + State/Jurisdiction + Geographic Distance + Travel Radius + Availability + Shift Time + Facility Requirements + Provider Preferences + Required Skills + Experience.

AI may assist with compatibility ranking. **AI must never override mandatory credential requirements.**

## 24. Market Object

Define a market as: Profession × Specialty × State × Metro/Geography (e.g. Chiropractic / Florida / Orlando, or Physical Therapy / Florida / Tampa). Each market should have measurable supply/demand.

## 25. Market Readiness States

Potential internal statuses: PLANNED, BUILDING SUPPLY, READY FOR DEMAND, ACTIVE, LIQUID, PAUSED.

Statuses should eventually be driven by configurable marketplace metrics rather than AI opinion.

## 26. Geographic Expansion Strategy

For chiropractic:

- Phase 1: Florida
- Phase 2: begin building provider/clinic databases in additional high-opportunity states
- Phase 3: activate clinic demand only when sufficient provider coverage exists
- Phase 4: progress toward national chiropractic coverage

AI agents may recruit providers in future states before those states are fully commercially activated.

## 27. Specialty Expansion Strategy

New specialties should generally begin in the market where the platform has the greatest operational knowledge. Initially: Florida.

Florida Chiropractic → prove marketplace → National Chiropractic supply expansion + Florida Specialty #2 pilot → prove specialty → expand specialty geographically.

Avoid simultaneously learning new profession + new jurisdiction + new operational model whenever possible.

## 28. Recommended Overall Sequence

- Stage 1: Florida Chiropractic
- Stage 2: Additional-State Chiropractic Recruitment, while Florida transactions grow
- Stage 3: Additional-State Chiropractic Marketplace Launches, based on provider density
- Stage 4: Pilot easiest adjacent specialties in Florida: Massage; PT/PTA; OT/OTA
- Stage 5: Add Diagnostic Imaging; Dental Hygiene/Dental; SLP
- Stage 6: Evaluate office-based professional coverage: Optometry; Podiatry; Behavioral Health
- Stage 7: After separate regulatory/business review: Nursing
- Stage 8: Advanced practice: NP/APRN; PA
- Stage 9: Additional specialized verticals: Pharmacy; Veterinary
- Stage 10: True physician locum tenens: Primary Care, followed by physician specialties

## 29. Important Strategic Rule

Large market size does NOT automatically mean earlier rollout.

Example: nursing may eventually represent a substantially larger marketplace than chiropractic. However, nursing may introduce substantially greater regulatory complexity, worker-classification complexity, facility requirements, insurance requirements, staffing-agency requirements, payroll requirements and compliance obligations.

Therefore rollout priority should consider: MARKET DEMAND + PROVIDER SUPPLY + TRANSACTION VALUE + REPEAT FREQUENCY + REGULATORY COMPLEXITY + TECHNICAL COMPLEXITY + CUSTOMER ACQUISITION COST + ABILITY TO FILL SHIFTS.

## 30. AI Agent Integration

Every future specialty should be compatible with the existing AI growth system. Agents should load profession-specific configuration rather than contain hard-coded chiropractic assumptions.

- Provider Recruitment Agent → Load Profession → Load State → Load Credential Requirements → Load Approved Marketing → Recruit
- Facility Outreach Agent → Load Facility Type → Load Profession → Load Market → Load Approved Value Proposition → Conduct Outreach

## 31. Specialty-Specific Knowledge Bases

Each profession should eventually receive an approved knowledge base containing: provider requirements, facility requirements, credential requirements, marketplace policies, pricing, FAQs, scope limitations, onboarding information, state-specific information, approved marketing claims.

AI should retrieve from these sources rather than assuming chiropractic rules apply.

## 32. Specialty Feature Flags

Every profession/specialty should have activation controls. Example:

- Chiropractic: Florida = LIVE; Georgia = SUPPLY BUILDING
- Physical Therapy: Florida = INTERNAL PILOT
- Nursing: Florida = DISABLED

A disabled specialty must not accidentally become bookable merely because provider/facility records exist.

## 33. Future Pricing Architecture

Do not hard-code chiropractic pricing globally. Pricing should eventually support: Profession, Specialty, State, Metro, Shift Length, Urgency, Weekday/Weekend, Holiday, Experience, Facility Type, Recurring Assignment.

Pricing rules can evolve without changing the core shift schema.

## 34. Marketplace Financial Architecture

Each completed shift should support: Gross Booking Value, Provider Compensation, Platform Fee, Payment Processing, Additional Fees, Refunds, Credits, Adjustments, Net Platform Revenue.

This is necessary because future professions may have very different shift economics.

## 35. Expansion Decision Metrics

Do not launch a specialty simply because providers have registered. Evaluate: coverage-ready provider count, geographic provider density, facility prospect count, demonstrated demand, expected booking frequency, expected booking value, credentialing complexity, fill probability, customer acquisition cost, contribution margin, repeat-booking potential, legal/regulatory readiness.

## 36. Long-Term Platform Vision

The system should evolve from **Chiropractic Coverage Marketplace** into **On-Demand Licensed & Credentialed Healthcare Professional Coverage Marketplace** without abandoning chiropractic as the original market or rebuilding the underlying platform.

The long-term flywheel: Profession Added → Providers Recruited → Credentials Verified → Geographic Supply Established → Facilities Educated → Shifts Requested → Shifts Filled → Transactions Completed → Repeat Usage → Marketplace Liquidity → Geographic Expansion.

## 37. Immediate Development Instruction

DO NOT build all specialty-specific workflows now. Instead:

1. Build Florida chiropractic correctly.
2. Make core database objects profession-agnostic where reasonably practical.
3. Use configurable credential types.
4. Use configurable state/jurisdiction rules.
5. Use configurable facility types.
6. Use configurable provider types.
7. Use configurable shift requirements.
8. Use specialty feature flags.
9. Avoid hard-coded chiropractic assumptions in core marketplace infrastructure.
10. Do not add complexity that materially delays the Florida chiropractic MVP merely to accommodate hypothetical future scenarios.

The objective is: **future-compatible, not overengineered.**

## 38. Saved Rollout Priority

Current intended order:

1. Chiropractic
2. Massage Therapy
3. Physical Therapy — PT/PTA
4. Occupational Therapy — OT/OTA
5. Diagnostic Imaging — Sonography/X-Ray/CT/MRI/Mammo/Nuclear Medicine/etc.
6. Dental — Hygiene first, then additional dental professionals
7. Speech-Language Pathology
8. Podiatry / Optometry
9. Behavioral Health
10. Nursing — RN/LPN/CNA/etc., only after dedicated regulatory review
11. Advanced Practice — NP/APRN/PA/CRNA/etc.
12. Pharmacy
13. Veterinary
14. Primary-Care Physician Locums
15. Physician Specialty Locum Tenens

Additional allied-health professions should remain supported by the architecture and evaluated based on actual marketplace opportunity.

---

## Final Build Principle

**Build chiropractic first. Architect for healthcare. Expand based on data.**

The platform should not become unnecessarily complex today because of future specialties, but nothing fundamental should assume that every future provider is a chiropractor, every customer is a chiropractic clinic, every credential is a chiropractic license, or every shift costs the same amount.

Florida chiropractic is the proving ground. The architecture should make the successful model reproducible.

---

## How today's code maps to this plan (as of the update-010 release)

Already configuration-driven (Addendum 01 built most of the foundation):

- **Profession** table with per-profession pricing model, supervision defaults, NPI requirement and an `active` flag; shifts belong to exactly one profession.
- **ProfessionStateConfig** = per profession × state activation (`enabled`), malpractice minimums, supervision rules, and whether the state licenses the profession or accepts a national credential (A5: ARDMS/CCI/ARRT, `License.state = "US"`). Together with **StateConfig** this is the "specialty feature flag" of §32: nothing is bookable unless both are enabled.
- **License** records are many per provider (profession + state or national, number, title, expiry, status, document); INV-1 eligibility reads only VERIFIED records. **MalpracticePolicy** covers a list of professions.
- **Skills** (with certification requirements and per-state scope rules) model techniques and specialty-like requirements; shifts mark them required or preferred.
- **Pricing**: rate cards per region and profession, premiums, per-profession overrides — no global chiropractic price.
- **Matching**: core eligibility filters (licence, malpractice, supervision, status, agreement, skills, availability, distance, budget, experience) are pure rules in `packages/core`; AI never decides eligibility.
- **Growth**: markets (GrowthMarket), launch profession/state settings, knowledge base, campaigns.
- **Payments**: per-shift clinic price, provider pay, deposit, balance, refunds, adjustments, conversion/placement fees, promo discounts from margin.

Gaps to close when a new vertical actually needs them (not before):

- Credential *types* beyond licence + malpractice (DEA, BLS/ACLS, background screening, board certification) → generalise License into a typed Credential + a requirements table (profession × specialty × state × facility type).
- **Specialty / subspecialty** as first-class objects (today: profession + skills).
- **Facility type** on ClinicOrg/ClinicLocation (today: every customer is a "clinic").
- **Market readiness status** per profession × state × metro (§25), driven by metrics.
- Shift fields: break, recurring flag beyond standing bookings, facility requirements.
- Financial reporting of platform fee / processing cost / net revenue per shift (§34).
- Non-shift scheduling models (behavioral health caseloads, telehealth) and staffing-agency/W-2 models (nursing) need their own legal + product review first.
