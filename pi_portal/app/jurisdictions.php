<?php
// State rules: what changes about a PI case depending on the state whose
// law applies — PIP / no-fault benefits, deadlines, the lawsuit threshold,
// balance billing and provider liens. Everything else (the care guide,
// re-exams, gaps in care, outreach, the huddle) is the same in every state.
//
// Source: reports/PIP rules by state.md (October 2026). The figures there
// came from search extracts and secondary sources because the official
// statute sites could not be opened; each state below carries a
// 'verified' flag and must be checked against the current statute by a
// licensed attorney in that state before it's relied on. NOT legal advice.
//
// Each state: name, regime, support, verified, and 'rules' that override
// JURISDICTION_BASE. 'versions' hold later changes: ['from' => date,
// 'basis' => accident | policy | service, 'rules' => [...]] — applied when
// the case's date on that basis is on or after 'from'.
//
// Regimes: no_fault (PIP pays first and a threshold limits lawsuits),
// choice (the insured picks a tort option), add_on (PIP, no lawsuit
// limit), tort (MedPay / health insurance / liens).
// Support: full — tuned and tested; standard — benefits, deadlines and
// thresholds configured; limited — configured, but the state's fee caps
// and review rules work differently from this app's balance/LOP model.

const JURISDICTION_BASE = [
    'pip_label' => 'PIP',
    'pip_required' => 'none',          // mandatory | rejectable | optional | none
    'pip_medical' => null,             // default medical limit
    'pip_shared' => false,             // medical limit shared with wage loss etc.
    'emc_rule' => false,               // Florida EMC determination
    'emc_cap' => null,                 // PIP cap without a positive EMC
    'initial_care_days' => null,       // must be first seen within N days of the accident
    'pip_pays_pct' => null,            // share of the fee schedule PIP pays (FL 80%)
    'bill_days' => null,               // provider must submit bills within N days of service
    'notice_days' => null,             // claim notice / application within N days of the accident
    'pay_days' => 30,                  // insurer pays within N days of proof (typical)
    'interest' => null,
    'fee_basis' => 'Reasonable charges',
    'balance_billing' => 'allowed',    // allowed | barred | capped
    'balance_note' => null,
    'tort' => ['kind' => 'none', 'text' => 'No no-fault limit on lawsuits — a claim against the at-fault driver can include pain and suffering.'],
    'tort_options' => null,            // choice states: [option => label]
    'demand_letter' => null,           // pre-suit demand letter before suing the PIP insurer
    'treatment_plan' => null,          // ['visits' => N, 'days' => D]: plan required after that
    'review' => null,                  // utilization review / IME / precertification summary
    'arbitration' => null,
    'lien' => null,                    // statutory provider lien covering chiropractors
    'lop_disclosure' => false,         // Florida §768.0427 letter-of-protection disclosures
    'wc_rules' => false,               // Florida workers' comp chiropractic limits and DWC-25
    'sol_years' => null,               // personal-injury statute of limitations (general negligence)
    'notes' => [],
];

const JURISDICTIONS = [
    'FL' => ['name' => 'Florida', 'regime' => 'no_fault', 'support' => 'full', 'verified' => true, 'rules' => [
        'pip_required' => 'mandatory', 'pip_medical' => 10000.00, 'emc_rule' => true, 'emc_cap' => 2500.00, 'initial_care_days' => 14,
        'pip_pays_pct' => 0.80, 'bill_days' => 35, 'fee_basis' => '80% of 200% of Medicare Part B (the schedule in effect March 1 of the service year; 2007 schedule as a floor)',
        'tort' => ['kind' => 'permanent', 'text' => 'Pain and suffering generally requires a permanent injury within reasonable medical probability, significant scarring or disfigurement, or death (§627.737). A permanency opinion at MMI matters.'],
        'demand_letter' => ['cure_days' => 30, 'cite' => '§627.736(10), Fla. Stat.'],
        'review' => 'Insurer records requests under §627.736(6)(b); EMC must be determined by an MD, DO, dentist, PA or APRN — never a chiropractor.',
        'lop_disclosure' => true, 'wc_rules' => true, 'sol_years' => 4,
        'notes' => ['Bills must reach the PIP insurer within 35 days of service.', 'Before suing the PIP insurer, send a pre-suit demand letter for overdue bills; the insurer then has 30 days to pay.',
            'Letters of protection must be disclosed with itemized coded bills, any sale to a factoring company and its price, whether the patient had health coverage, and any attorney referral (§768.0427, 2023).',
            'More than 50% at fault bars recovery (§768.81(6), 2023).'],
    ], 'versions' => [
        ['from' => '2023-03-24', 'basis' => 'accident', 'rules' => ['sol_years' => 2]],
    ]],

    // ---- standard: no-fault states close to Florida's structure ----
    'KS' => ['name' => 'Kansas', 'regime' => 'no_fault', 'support' => 'standard', 'verified' => false, 'rules' => [
        'pip_required' => 'mandatory', 'pip_medical' => 4500.00, 'interest' => '18% after 30 days (K.S.A. 40-3110)', 'fee_basis' => 'Usual and customary (no PIP fee schedule)',
        'tort' => ['kind' => 'medical', 'dollars' => 2000, 'text' => 'Pain and suffering needs medical treatment with a reasonable value of $2,000 or more, or a listed injury such as permanent disfigurement or a fracture of a weight-bearing bone (K.S.A. 40-3117). Billed charges are not conclusive.'],
        'sol_years' => 2, 'notes' => ['A separate $4,500 rehabilitation benefit sits beside the $4,500 medical benefit.', 'The hospital lien (K.S.A. 65-406) is disputed for chiropractors — use a letter of protection.'],
    ]],
    'UT' => ['name' => 'Utah', 'regime' => 'no_fault', 'support' => 'standard', 'verified' => false, 'rules' => [
        'pip_required' => 'mandatory', 'pip_medical' => 3000.00, 'interest' => '1.5% a month after 30 days, plus attorney fees (§31A-22-309)', 'fee_basis' => 'Reasonable charges (relative value study referenced; no PIP fee schedule found)',
        'tort' => ['kind' => 'medical', 'dollars' => 3000, 'text' => 'Pain and suffering needs medical expenses over $3,000, or death, dismemberment, permanent impairment, permanent disfigurement or a bone fracture (§31A-22-309).'],
        'sol_years' => 4, 'notes' => ['§31A-22-309 was amended in 2026 — confirm the current text.'],
    ]],
    'MN' => ['name' => 'Minnesota', 'regime' => 'no_fault', 'support' => 'standard', 'verified' => false, 'rules' => [
        'pip_label' => 'Basic economic loss', 'pip_required' => 'mandatory', 'pip_medical' => 20000.00, 'interest' => '15% simple after 30 days (§65B.54)', 'fee_basis' => 'Reasonable expenses',
        'balance_billing' => 'barred', 'balance_note' => 'When the insurer follows the e-billing standards (§62J.536), the unpaid amount can\'t be billed to the patient (§65B.54).',
        'tort' => ['kind' => 'medical', 'dollars' => 4000, 'disability_days' => 60, 'text' => 'Pain and suffering needs over $4,000 of medical expenses (not counting diagnostic X-rays or rehabilitation), or permanent injury or disfigurement, death, or 60+ days of disability (§65B.51).'],
        'arbitration' => 'Binding arbitration is mandatory for claims of $10,000 or less (§65B.525).',
        'review' => 'Insurers often cite the workers\' comp 12-week limit on adjustments (Minn. R. 5221.6200) in disputes; it is not a no-fault visit cap.',
        'sol_years' => 6, 'notes' => ['$20,000 medical plus $20,000 non-medical (§65B.44).'],
    ]],
    'ND' => ['name' => 'North Dakota', 'regime' => 'no_fault', 'support' => 'standard', 'verified' => false, 'rules' => [
        'pip_required' => 'mandatory', 'pip_medical' => 30000.00, 'pip_shared' => true,
        'tort' => ['kind' => 'medical', 'dollars' => 2500, 'disability_days' => 60, 'text' => 'Pain and suffering needs over $2,500 of medical expenses, or death, dismemberment, serious permanent disfigurement or disability beyond 60 days (N.D.C.C. 26.1-41-01).'],
        'sol_years' => 6, 'notes' => ['The $30,000 is one pool for all economic loss, so wage-loss payments reduce what is left for medical bills.'],
    ]],

    // ---- standard: add-on PIP (no lawsuit limit) ----
    'DE' => ['name' => 'Delaware', 'regime' => 'add_on', 'support' => 'standard', 'verified' => false, 'rules' => [
        'pip_required' => 'mandatory', 'pip_medical' => 15000.00, 'sol_years' => 2,
        'notes' => ['Expenses must be incurred within 2 years of the accident.', 'The PIP carrier is repaid by the at-fault carrier, usually not from the patient\'s settlement.'],
    ]],
    'MD' => ['name' => 'Maryland', 'regime' => 'add_on', 'support' => 'standard', 'verified' => false, 'rules' => [
        'pip_required' => 'rejectable', 'pip_medical' => 2500.00, 'notice_days' => 365, 'interest' => '1.5% a month after 30 days (§19-508)', 'sol_years' => 3,
        'notes' => ['PIP must be offered and can be waived in writing — ask whether the patient waived it.', 'The PIP application is due within 12 months of the accident.'],
    ]],
    'OR' => ['name' => 'Oregon', 'regime' => 'add_on', 'support' => 'standard', 'verified' => false, 'rules' => [
        'pip_required' => 'mandatory', 'pip_medical' => 15000.00, 'sol_years' => 2,
        'review' => 'Bills are presumed reasonable unless the insurer denies them within 60 days (ORS 742.524).',
        'notes' => ['Expenses must be incurred within 2 years of the accident.', 'The PIP insurer may take a lien on the settlement (ORS 742.536) — the made-whole rule applies.'],
    ]],
    'WA' => ['name' => 'Washington', 'regime' => 'add_on', 'support' => 'standard', 'verified' => false, 'rules' => [
        'pip_required' => 'rejectable', 'pip_medical' => 10000.00, 'sol_years' => 3,
        'lien' => ['cite' => 'RCW 60.44', 'covers' => 'Physicians; chiropractors not named — confirm', 'file_days' => 20, 'cap' => '25% of the recovery',
            'steps' => 'File the lien notice with the county auditor within 20 days after treatment ends; liens are capped at 25% of the recovery.'],
        'notes' => ['PIP is included unless rejected in writing. Expenses within 3 years.', 'The PIP insurer is reimbursed from the settlement but pays its share of attorney fees (Mahler v. Szucs).'],
    ]],
    'TX' => ['name' => 'Texas', 'regime' => 'add_on', 'support' => 'standard', 'verified' => false, 'rules' => [
        'pip_required' => 'rejectable', 'pip_medical' => 2500.00, 'sol_years' => 2,
        'notes' => ['PIP is included unless rejected in writing.', 'The PIP insurer has no right to repayment from the settlement (§1952.155).', 'Defendants can subpoena LOP providers\' billing rates (In re K&L Auto Crushers, 2021); §18.001 affidavits are used for medical bills.'],
    ]],
    'AR' => ['name' => 'Arkansas', 'regime' => 'add_on', 'support' => 'standard', 'verified' => false, 'rules' => [
        'pip_required' => 'rejectable', 'pip_medical' => 5000.00, 'sol_years' => 3,
        'notes' => ['PIP is offered and can be rejected in writing. Expenses within 24 months.', 'The PIP insurer has a lien on the settlement (§23-89-207).'],
    ]],
    'DC' => ['name' => 'District of Columbia', 'regime' => 'choice', 'support' => 'standard', 'verified' => false, 'rules' => [
        'pip_required' => 'optional', 'notice_days' => 60, 'sol_years' => 3,
        'tort' => ['kind' => 'election', 'text' => 'The patient chooses PIP or a tort claim within 60 days of the accident; electing PIP brings a lawsuit threshold.'],
        'notes' => ['Make sure the patient makes the PIP-or-tort election within 60 days, or they are treated as choosing tort.'],
    ]],

    // ---- standard: tort states with a provider lien covering chiropractors ----
    'GA' => ['name' => 'Georgia', 'regime' => 'tort', 'support' => 'standard', 'verified' => false, 'rules' => [
        'sol_years' => 2,
        'lien' => ['cite' => 'O.C.G.A. 44-14-470', 'covers' => 'Chiropractors and other providers', 'file_days' => 90, 'notice_before_days' => 15,
            'steps' => 'Send written notice at least 15 days before filing, then file with the superior court clerk in your county and the patient\'s county within 90 days of first treatment. Bill health insurance first; the lien ranks below hospital liens.'],
        'notes' => ['Letters of protection are discoverable (O.C.G.A. 51-12-1.1, 2025).'],
    ]],
    'AZ' => ['name' => 'Arizona', 'regime' => 'tort', 'support' => 'standard', 'verified' => false, 'rules' => [
        'sol_years' => 2,
        'lien' => ['cite' => 'A.R.S. 33-931', 'covers' => 'Health care providers', 'file_days' => 30,
            'steps' => 'Record the lien within 30 days after first service and mail a copy within 5 days of recording. It is invalid if your in-network contract with the patient\'s health plan doesn\'t expressly allow liens. Liens can\'t attach to the patient\'s own MedPay.'],
    ]],
    'CO' => ['name' => 'Colorado', 'regime' => 'tort', 'support' => 'standard', 'verified' => false, 'rules' => [
        'sol_years' => 3,
        'lien' => ['cite' => 'C.R.S. 38-27.5', 'covers' => 'Health care providers',
            'steps' => 'Limited to usual and customary charges. Tell the patient about insurance payment options in writing. The attorney\'s lien comes first.'],
    ]],
    'LA' => ['name' => 'Louisiana', 'regime' => 'tort', 'support' => 'standard', 'verified' => false, 'rules' => [
        'sol_years' => 1,
        'lien' => ['cite' => 'La. R.S. 9:4752', 'covers' => 'Health care providers',
            'steps' => 'Send written notice by certified mail (return receipt) or fax to the patient\'s attorney and the insurer before any settlement is paid. An in-network provider who liens instead of billing the health plan can be sued (Anderson v. Ochsner, 2014).'],
    ], 'versions' => [
        ['from' => '2024-07-01', 'basis' => 'accident', 'rules' => ['sol_years' => 2]],
    ]],
    'MT' => ['name' => 'Montana', 'regime' => 'tort', 'support' => 'standard', 'verified' => false, 'rules' => [
        'sol_years' => 3,
        'lien' => ['cite' => 'MCA 71-3-1111', 'covers' => 'Chiropractors (named)', 'steps' => 'The lien arises when written notice is served on the patient\'s attorney and the insurer.'],
    ]],
    'OK' => ['name' => 'Oklahoma', 'regime' => 'tort', 'support' => 'standard', 'verified' => false, 'rules' => [
        'sol_years' => 2,
        'lien' => ['cite' => '42 O.S. §46', 'covers' => 'Physicians and chiropractors',
            'steps' => 'File the lien notice with the county clerk and send it by certified mail before the settlement is paid; suit to enforce within 1 year.'],
    ]],
    'IL' => ['name' => 'Illinois', 'regime' => 'tort', 'support' => 'standard', 'verified' => false, 'rules' => [
        'sol_years' => 2,
        'lien' => ['cite' => '770 ILCS 23', 'covers' => 'Licensed providers (chiropractors probably — confirm)', 'cap' => '40% of the recovery in total, 20% per provider class',
            'steps' => 'Serve written notice of the lien on the injured person and the party liable by registered or certified mail. All provider liens together are capped at 40% of the recovery.'],
    ]],
    'NC' => ['name' => 'North Carolina', 'regime' => 'tort', 'support' => 'standard', 'verified' => false, 'rules' => [
        'sol_years' => 3,
        'lien' => ['cite' => 'G.S. 44-49', 'covers' => 'Medical providers (chiropractors not settled)', 'cap' => '50% of the recovery after attorney fees, shared pro rata',
            'steps' => 'Give the attorney written notice and provide itemized records free of charge on request.'],
    ]],
    'VA' => ['name' => 'Virginia', 'regime' => 'tort', 'support' => 'standard', 'verified' => false, 'rules' => [
        'sol_years' => 2,
        'lien' => ['cite' => 'Va. Code 8.01-66.2', 'covers' => 'Physicians (chiropractors appear to count)', 'cap' => '$750 per physician',
            'steps' => 'Written notice to the patient\'s attorney. The lien is lost if you don\'t bill the patient\'s health insurance (8.01-27.5).'],
        'notes' => ['MedPay must be offered ($2,000 minimum); MedPay insurers can\'t be repaid from the settlement.'],
    ]],

    // ---- standard: other no-fault / choice states ----
    'MA' => ['name' => 'Massachusetts', 'regime' => 'no_fault', 'support' => 'standard', 'verified' => false, 'rules' => [
        'pip_required' => 'mandatory', 'pip_medical' => 8000.00, 'pip_shared' => true,
        'tort' => ['kind' => 'medical', 'dollars' => 2000, 'text' => 'Pain and suffering needs over $2,000 of reasonable medical expenses (billed amounts count), or a listed injury such as a fracture, loss of sight or hearing, or permanent serious disfigurement (M.G.L. c.231 §6D).'],
        'review' => 'IMEs "as often as reasonably required"; benefits unpaid 30 days after bills and records let the provider sue with attorney fees (c.90 §34M).',
        'sol_years' => 3, 'notes' => ['With private health insurance, PIP pays only the first $2,000 of medical; the health plan is then primary and PIP covers its gaps up to $8,000.', 'Expenses must be incurred within 2 years of the accident.', 'The c.111 §70A lien is for hospitals and HMOs, not chiropractors.'],
    ]],
    'KY' => ['name' => 'Kentucky', 'regime' => 'choice', 'support' => 'standard', 'verified' => false, 'rules' => [
        'pip_label' => 'Basic reparation benefits', 'pip_required' => 'mandatory', 'pip_medical' => 10000.00, 'pip_shared' => true,
        'interest' => '12% after 30 days (18% without reasonable foundation) (KRS 304.39-210)',
        'tort' => ['kind' => 'medical', 'dollars' => 1000, 'text' => 'Unless the patient rejected the tort limitation in writing, pain and suffering needs over $1,000 of medical expenses or a listed injury (KRS 304.39-060).'],
        'tort_options' => ['limited' => 'Accepted the tort limitation (default)', 'full' => 'Rejected the tort limitation in writing'],
        'sol_years' => 2, 'notes' => ['The patient can direct in writing how benefits are allocated among providers (KRS 304.39-241).', 'The motor-vehicle limitation period runs 2 years from the injury or the last PIP payment.'],
    ], 'versions' => [
        // HB 627 (Acts 2026 ch. 149), for policies issued or renewed on or after about 7/15/2026.
        ['from' => '2026-07-15', 'basis' => 'policy', 'rules' => [
            'bill_days' => 180, 'balance_billing' => 'barred', 'fee_basis' => 'Kentucky workers\' comp fee schedule (KRS 342.035) — sources conflict on cap vs. floor',
            'balance_note' => 'HB 627 (2026) bars billing PIP patients for amounts above what PIP allows on policies issued or renewed after about July 15, 2026.',
        ]],
    ]],
    'PA' => ['name' => 'Pennsylvania', 'regime' => 'choice', 'support' => 'standard', 'verified' => false, 'rules' => [
        'pip_label' => 'First-party medical', 'pip_required' => 'mandatory', 'pip_medical' => 5000.00, 'interest' => '12% a year after 30 days (§1716)',
        'fee_basis' => '110% of Medicare (Act 6) — also applies to bodily-injury and UM/UIM claims', 'balance_billing' => 'barred',
        'balance_note' => 'Providers can\'t bill the patient above the Act 6 amount, including during peer review (75 Pa.C.S. §1797).',
        'tort' => ['kind' => 'choice', 'text' => 'Full tort: any injury. Limited tort: pain and suffering only with a "serious injury" (death, serious impairment of body function, permanent serious disfigurement), with exceptions such as a drunk-driving defendant.'],
        'tort_options' => ['limited' => 'Limited tort', 'full' => 'Full tort'],
        'review' => 'Peer Review Organization: the insurer refers within 90 days of documentation; decision within 30 days (+20); reconsideration within 30 days (31 Pa. Code §69.52).',
        'sol_years' => 2,
    ]],
    'HI' => ['name' => 'Hawaii', 'regime' => 'no_fault', 'support' => 'standard', 'verified' => false, 'rules' => [
        'pip_required' => 'mandatory', 'pip_medical' => 10000.00, 'interest' => '1.5% a month after 30 days (HRS 431:10C-304)',
        'fee_basis' => 'Hawaii workers\' comp schedule (Exhibit A, else 110% of Hawaii Medicare RBRVS); emergency care within 72 hours exempt', 'balance_billing' => 'capped',
        'tort' => ['kind' => 'paid', 'dollars' => 5000, 'text' => 'Pain and suffering needs $5,000 of PIP medical-rehab benefits paid, or a listed injury (HRS 431:10C-306).'],
        'treatment_plan' => ['visits' => 15, 'days' => 60],
        'review' => 'The first 15 treatments within 60 days need no authorization; after that a treatment plan is required (HAR ch. 23).',
        'sol_years' => 2,
    ]],

    // ---- limited: fee caps and reviews outside this app's balance/LOP model ----
    'NY' => ['name' => 'New York', 'regime' => 'no_fault', 'support' => 'limited', 'verified' => false, 'rules' => [
        'pip_label' => 'No-fault (basic economic loss)', 'pip_required' => 'mandatory', 'pip_medical' => 50000.00, 'pip_shared' => true, 'pip_pays_pct' => 1.0,
        'notice_days' => 30, 'bill_days' => 45, 'interest' => '2% a month (stops if no arbitration or suit within 30 days of a denial)',
        'fee_basis' => 'NY workers\' comp chiropractic fee schedule; 12 RVUs a day across all providers (15 on re-evaluation days, 18 on initial evaluations)',
        'balance_billing' => 'barred', 'balance_note' => 'No billing above the fee schedule, even after the $50,000 is used up (Ins. Law §5108(c)). A full-charge letter of protection doesn\'t work for covered services.',
        'tort' => ['kind' => 'serious', 'text' => '"Serious injury" (Ins. Law §5102(d)), shown with objective evidence; sprains and subjective pain usually don\'t qualify.'],
        'review' => 'No precertification; insurers review afterwards with IMEs, examinations under oath and peer reviews. Verification requests within 15 business days; 120 days to respond.',
        'arbitration' => 'Denied claims go to AAA no-fault arbitration or court.', 'sol_years' => 3,
        'notes' => ['NF-2 application within 30 days of the accident; NF-3 bills within 45 days of service; NF-AOB for assignment.'],
    ]],
    'NJ' => ['name' => 'New Jersey', 'regime' => 'choice', 'support' => 'limited', 'verified' => false, 'rules' => [
        'pip_required' => 'mandatory', 'pip_medical' => 250000.00, 'fee_basis' => 'N.J.A.C. 11:3-29 PIP fee schedule (2013) with a daily physical-medicine cap',
        'balance_billing' => 'barred', 'balance_note' => 'No one may demand payment above the PIP fee schedule (N.J.A.C. 11:3-29.6); the deductible and copays are collectible.',
        'tort' => ['kind' => 'choice', 'text' => 'Limitation on Lawsuit: six injury categories; permanency needs a physician\'s certification based on objective tests. No Limitation: any injury.'],
        'tort_options' => ['limited' => 'Limitation on Lawsuit (verbal threshold)', 'full' => 'No Limitation on Lawsuit'],
        'review' => 'Neck and back care follows DOBI Care Paths with Decision Point Review; other care needs precertification on the Attending Provider Treatment Plan form. Skipping a required review adds a copay of up to 50%.',
        'arbitration' => 'PIP arbitration through Forthright (N.J.A.C. 11:3-5).', 'sol_years' => 2,
        'notes' => ['Policy options run from $15,000 to the $250,000 default; health insurance can be made primary.', 'Deductible ($250 minimum) plus 20% of the band up to $5,000.'],
    ]],
    'MI' => ['name' => 'Michigan', 'regime' => 'no_fault', 'support' => 'limited', 'verified' => false, 'rules' => [
        'pip_required' => 'mandatory', 'pip_medical' => null, 'pip_pays_pct' => 1.0, 'notice_days' => 365, 'interest' => '12% after 30 days',
        'fee_basis' => '190% of Medicare since 7/2/2023 (MCL 500.3157); 52.5% of the 1/1/2019 charge where Medicare has no rate', 'balance_billing' => 'capped',
        'balance_note' => 'Payment is capped at the fee schedule, and the schedule also limits third-party claims for medical costs (Canty v. Mason, 2024).',
        'tort' => ['kind' => 'serious', 'text' => 'Serious impairment of body function, permanent serious disfigurement, or death (MCL 500.3135).'],
        'review' => 'Utilization review: respond within 30 days; appeal a determination to DIFS within 90 days (form FIS 2356). Providers can sue insurers directly.',
        'sol_years' => 3, 'notes' => ['PIP tiers since 7/1/2020: unlimited, $500k, $250k, $250k with exclusions, $50k (Medicaid), opt-out — enter the patient\'s tier as the benefit limit.', 'Injuries before 6/11/2019 aren\'t subject to the fee schedule (Andary v USAA).'],
    ]],
];

// Two-letter codes and names for every state, for pickers.
const US_STATES = ['AL' => 'Alabama', 'AK' => 'Alaska', 'AZ' => 'Arizona', 'AR' => 'Arkansas', 'CA' => 'California', 'CO' => 'Colorado', 'CT' => 'Connecticut', 'DE' => 'Delaware',
    'DC' => 'District of Columbia', 'FL' => 'Florida', 'GA' => 'Georgia', 'HI' => 'Hawaii', 'ID' => 'Idaho', 'IL' => 'Illinois', 'IN' => 'Indiana', 'IA' => 'Iowa', 'KS' => 'Kansas',
    'KY' => 'Kentucky', 'LA' => 'Louisiana', 'ME' => 'Maine', 'MD' => 'Maryland', 'MA' => 'Massachusetts', 'MI' => 'Michigan', 'MN' => 'Minnesota', 'MS' => 'Mississippi',
    'MO' => 'Missouri', 'MT' => 'Montana', 'NE' => 'Nebraska', 'NV' => 'Nevada', 'NH' => 'New Hampshire', 'NJ' => 'New Jersey', 'NM' => 'New Mexico', 'NY' => 'New York',
    'NC' => 'North Carolina', 'ND' => 'North Dakota', 'OH' => 'Ohio', 'OK' => 'Oklahoma', 'OR' => 'Oregon', 'PA' => 'Pennsylvania', 'RI' => 'Rhode Island', 'SC' => 'South Carolina',
    'SD' => 'South Dakota', 'TN' => 'Tennessee', 'TX' => 'Texas', 'UT' => 'Utah', 'VT' => 'Vermont', 'VA' => 'Virginia', 'WA' => 'Washington', 'WV' => 'West Virginia',
    'WI' => 'Wisconsin', 'WY' => 'Wyoming'];

const SUPPORT_LABELS = ['full' => 'Fully supported', 'standard' => 'Supported', 'limited' => 'Limited support', 'basic' => 'General rules only'];
const REGIME_LABELS = ['no_fault' => 'No-fault PIP', 'choice' => 'No-fault with a tort choice', 'add_on' => 'Add-on PIP (no lawsuit limit)', 'tort' => 'At-fault (tort) state'];

function jurisdiction_code(?string $code): string {
    $code = strtoupper((string)$code);
    return isset(US_STATES[$code]) ? $code : 'FL';
}

// The rules for a state as of the case's dates. $dates: accident, policy
// (PIP policy issued/renewed) and service dates; a version applies when
// its date on that basis is on or after 'from' (a missing policy date
// falls back to the accident date).
function jurisdiction_rules(?string $code, array $dates = []): array {
    $code = jurisdiction_code($code);
    $j = JURISDICTIONS[$code] ?? null;
    $r = JURISDICTION_BASE;
    $meta = $j ? ['code' => $code, 'name' => $j['name'], 'regime' => $j['regime'], 'support' => $j['support'], 'verified' => $j['verified']]
               : ['code' => $code, 'name' => US_STATES[$code], 'regime' => 'tort', 'support' => 'basic', 'verified' => false];
    if ($j) {
        $r = array_replace($r, $j['rules']);
        foreach ($j['versions'] ?? [] as $v) {
            $d = $dates[$v['basis']] ?? null;
            if (!$d && $v['basis'] === 'policy') $d = $dates['accident'] ?? null;
            if ($d && $d >= $v['from']) $r = array_replace($r, $v['rules']);
        }
    }
    return $meta + $r;
}

// What the screens need to describe a state (summary rows for the
// playbook and the case header).
function jurisdiction_summary(array $r): array {
    $money = fn($n) => '$' . number_format((float)$n);
    $pip = match ($r['pip_required']) {
        'mandatory' => $r['pip_medical'] ? $r['pip_label'] . ' ' . $money($r['pip_medical']) . ' medical' . ($r['pip_shared'] ? ' (shared with wage loss and other benefits)' : '') . ', required' : $r['pip_label'] . ' required — limit depends on the policy',
        'rejectable' => $r['pip_label'] . ($r['pip_medical'] ? ' ' . $money($r['pip_medical']) : '') . ' included unless the patient rejected it in writing',
        'optional' => $r['pip_label'] . ' is optional',
        default => 'No PIP requirement — MedPay (optional), health insurance and the at-fault driver\'s liability claim pay the bills',
    };
    $rows = [['Benefits', $pip]];
    if ($r['emc_rule']) $rows[] = ['EMC determination', 'Without an Emergency Medical Condition finding by an MD, DO, dentist, PA or APRN, PIP pays at most ' . $money($r['emc_cap']) . '.'];
    if ($r['initial_care_days']) $rows[] = ['First visit deadline', 'The patient must be seen within ' . $r['initial_care_days'] . ' days of the accident or PIP medical benefits are lost.'];
    if ($r['notice_days']) $rows[] = ['Claim notice', 'Application / notice of claim within ' . ($r['notice_days'] >= 365 ? round($r['notice_days'] / 365) . ' year' : $r['notice_days'] . ' days') . ' of the accident.'];
    if ($r['bill_days']) $rows[] = ['Billing deadline', 'Bills must be submitted within ' . $r['bill_days'] . ' days of each date of service.'];
    if ($r['pip_medical'] !== null || $r['pip_required'] !== 'none') $rows[] = ['Fees', $r['fee_basis'] . ($r['interest'] ? '. Overdue benefits: ' . $r['interest'] . '.' : '.')];
    if ($r['balance_billing'] !== 'allowed') $rows[] = ['Billing the patient', $r['balance_note'] ?: 'Billing above the fee schedule is limited.'];
    $rows[] = ['Lawsuit threshold', $r['tort']['text']];
    if ($r['demand_letter']) $rows[] = ['Pre-suit demand', 'Before suing the PIP insurer, send a demand letter for overdue bills (' . $r['demand_letter']['cite'] . '); the insurer has ' . $r['demand_letter']['cure_days'] . ' days to pay.'];
    if ($r['treatment_plan']) $rows[] = ['Treatment plan', 'Required after ' . $r['treatment_plan']['visits'] . ' treatments or ' . $r['treatment_plan']['days'] . ' days.'];
    if ($r['review']) $rows[] = ['Insurer review', $r['review']];
    if ($r['arbitration']) $rows[] = ['Disputes', $r['arbitration']];
    if ($r['lien']) $rows[] = ['Provider lien', $r['lien']['cite'] . ' — ' . $r['lien']['covers'] . '. ' . $r['lien']['steps'] . (!empty($r['lien']['cap']) ? ' Cap: ' . $r['lien']['cap'] . '.' : '')];
    elseif ($r['regime'] === 'tort') $rows[] = ['Getting paid', 'No provider lien law covering chiropractors was found — treat on a signed letter of protection acknowledged by the attorney, and check health-plan network rules before choosing not to bill insurance.'];
    if ($r['sol_years']) $rows[] = ['Statute of limitations', 'Generally ' . $r['sol_years'] . ' year' . ($r['sol_years'] == 1 ? '' : 's') . ' from the injury for a personal-injury claim (confirm for the specific claim).'];
    foreach ($r['notes'] as $n) $rows[] = ['Note', $n];
    return $rows;
}

// Picker list: every state with its support level.
function jurisdiction_list(): array {
    $out = [];
    foreach (US_STATES as $code => $name) {
        $j = JURISDICTIONS[$code] ?? null;
        $out[] = ['code' => $code, 'name' => $name, 'support' => $j['support'] ?? 'basic', 'regime' => $j['regime'] ?? 'tort'];
    }
    return $out;
}
