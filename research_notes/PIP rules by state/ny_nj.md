# New York and New Jersey No-Fault / PIP Rules for a Chiropractic Clinic (as of Oct 2026)

> Method note (researcher, 2026-10-22): WebSearch worked, but direct page fetches (WebFetch/curl) were blocked by DNS/proxy errors in this session. Findings below rest on search-result extracts of primary sources (DFS, WCB, NJ DOBI, NJ courts, NY courts) plus law-firm secondary sources. Items marked **[UNVERIFIED – training knowledge]** are well-established rules I could not re-confirm against live text this session. The app team should check them against the cited primary text before hard-coding them. Primary texts to keep on file:
> - NY Regulation 68 full text (11 NYCRR Part 65), DFS PDF dated 2024-08: https://www.dfs.ny.gov/system/files/documents/2024/08/reg68_11_nycrr_65_full_txt.pdf
> - NY complete NF forms set (DFS, posted 2026-09): https://www.dfs.ny.gov/system/files/documents/2026/09/complete_nf_forms_2026.pdf
> - NJ N.J.A.C. 11:3-4 (DPR/precert) DOBI copy (effective 2013-01-04): https://www.nj.gov/dobi/pipinfo/njac11_3_4_effect130104.pdf
> - NJ DOBI "Everything Auto Insurance" 2026 consumer guide: https://www.nj.gov/dobi/division_consumers/pdf/everythingauto2026.pdf

---

## 1. Benefit limits, optional tiers, health-insurance-primary, deductibles and copays

### Takeaway
NY: $50,000 per person "basic economic loss" (BEL), covering medical, lost wages and other expenses combined, with no copay and no 80% rule. Providers are paid 100% of the NY fee schedule. NJ: standard-policy PIP medical defaults to $250,000, and lower elected tiers are $150k/$75k/$50k/$15k. The insured can make health insurance primary. A deductible (minimum $250) applies, plus a 20% copay on the band from the deductible to $5,000. The Basic Policy carries $15,000 PIP, which rises to $250,000 for certain catastrophic injuries.

### Cited Findings
**New York**
- Basic no-fault benefits are $50,000 per person (BEL). They can be increased with optional basic economic loss (OBEL) coverage. Assignments end when the available benefits ("$50,000 or more if the assignor has additional OBEL coverage") are exhausted. — [DFS OGC Opinion 08-07-28](https://www.dfs.ny.gov/insurance/ogco2008/rg080728.htm)
- BEL is one shared pool for medical, lost earnings (80%, up to $2,000/month), other reasonable expenses (up to $25/day) and a $2,000 death benefit. Medical bills compete with wage claims for the same $50k. **[UNVERIFIED – training knowledge; see Ins. Law §5102(a) and the Mandatory PIP Endorsement, 11 NYCRR 65-1.1]** — [Reg 68 full text](https://www.dfs.ny.gov/system/files/documents/2024/08/reg68_11_nycrr_65_full_txt.pdf)
- NY has no statutory 20% copay. The insurer pays the fee-schedule amount, and providers cannot balance-bill above it (see section 8). — [DFS Reg 83 / fee schedule FAQ](https://www.dfs.ny.gov/apps_and_licensing/property_insurers/faqs_reg83_nofault_schedule)
- Health insurance cannot be elected primary in NY. No-fault is primary for auto injuries. **[UNVERIFIED – training knowledge]**

**New Jersey**
- Statute: if no medical-expense option is chosen in writing, the policy provides $250,000. The alternative options are $150,000, $75,000, $50,000 or $15,000 per person per accident. Before the $15,000 option takes effect, the insurer must state the exact premium reduction in writing and the insured must acknowledge it in writing. — [N.J.S.A. 39:6A-4.3 text quoted in NJ S3142 (2026 session)](https://pub.njleg.state.nj.us/Bills/2026/S3500/3142_T1.PDF)
- Health-insurance-primary option: the auto insurer is liable only for "reasonable medical expenses not covered by the health insurance coverage or benefits up to the limit of the medical expense benefits coverage." — [NJ S3142 (2026)](https://pub.njleg.state.nj.us/Bills/2026/S3500/3142_T1.PDF) (statutory text reproduced in a pending 2026 bill, so the language may change); order of benefits between PIP and health plans is governed by N.J.A.C. 11:3-37 — [DOBI N.J.A.C. 11:3-37](https://www.nj.gov/dobi/pipinfo/njac11327.pdf)
- With lower limits, a severe brain or spinal injury can raise PIP to $250,000. — [Reinartz Law PIP FAQ](https://reinartzlaw.com/new-jersey-personal-injury-protection-pip-faqs/) (secondary)
- Deductible and copay: the insurer pays medical bills above the chosen deductible. The insured owes 20% of expenses between the deductible and $5,000 (the insurer pays 80%), and the insurer pays 100% above $5,000. $250 is the lowest deductible. — [GEICO NJ Buyer's Guide M-592 (12-22)](https://www.geico.com/public/pdf/statepages/NJBuyersGuide-m592.pdf); [NJM NJ Buyer's Guide A-705](https://www.njm.com/-/media/pdf/new-jersey-auto-insurance-buyers-guide-a-705.pdf)
- Courts have applied it this way: on $15k PIP policies with 20% copay, insurers reduced recoverable expenses by the $250 (or $2,500) deductible and the copay, then declared the limits exhausted. — [NJ App. Div. a3896-15 (2017)](https://www.njcourts.gov/system/files/court-opinions/2017/a3896-15.pdf)
- In one context the regulation sets a per-accident deductible of "$750.00 plus the PIP deductible selected." Likely this is the health-primary / order-of-benefit coordination context, which needs verification. — [search extract of DOBI/NJ regs via buyer's-guide search](https://www.nj.gov/dobi/pipinfo/njac11327.pdf)

### Inferences
- The app cannot reuse Florida's flat "80% of fee schedule" logic for either state. NY pays 100% of the WC fee schedule. NJ has a patient-responsibility layer (deductible plus 20% of the band from the deductible to $5,000), and the clinic must collect or track that from the patient.
- NJ needs per-case configuration fields: PIP medical limit tier, deductible ($250/$500/$1,000/$2,000/$2,500 are typical, verify), health-primary flag (if set, bill the health plan first and PIP second), and Basic vs Standard policy.
- NY needs a "BEL remaining" tracker that also counts lost-wage and other payments, not just medical.

### Gaps
- NJ full deductible menu and the exact Basic Policy rules (which injuries trigger $250k) were not confirmed against current DOBI text.
- The status of NJ S3142 (2026) and whether it changes the health-primary language is unknown.
- NY OBEL tiers (commonly +$25k to +$100k) and the optional $200 deductible were not verified.

---

## 2. Deadlines: notice, bill submission, treatment start, verification, payment, interest

### Takeaway
NY's clock is strict and well codified. There is written notice of the accident within 30 days, provider bills within 45 days of service, a 15-business-day window for insurer verification requests, pay-or-deny within 30 days of complete proof, and 2%/month interest on overdue claims. NJ's deadlines run through the insurer's DPR plan and N.J.S.A. 39:6A-5: provider notice within 21 days of starting treatment, 60-day insurer payment, and an award payable within 45 days.

### Cited Findings
**New York**
- Mandatory PIP endorsement (11 NYCRR 65-1.1): written notice of the accident is due within 30 days. Proof of claim for health services (NF-3 or HCFA/CMS-1500) is due within 45 days after services are rendered. Late filings are excused only with "written proof providing clear and reasonable justification." **[UNVERIFIED – training knowledge; text at]** [Reg 68 full text (DFS 2024)](https://www.dfs.ny.gov/system/files/documents/2024/08/reg68_11_nycrr_65_full_txt.pdf)
- The NF-2 application notice in an older revision states that if the original notice was not in writing, the application must be sent "within 90 days of the accident date." — [Coverage Counsel blog summarizing NF forms (2009)](http://nycoveragecounsel.blogspot.com/2009/11/new-yorks-prescribed-no-fault-claim.html?m=1) (older revision, so check against the 2026 form set)
- Verification (11 NYCRR 65-3.5(b)): after receiving the prescribed verification forms, the insurer must request any additional verification within 15 **business** days. — [Cornell LII 11 NYCRR 65-3.5](https://www.law.cornell.edu/regulations/new-york/11-NYCRR-65-3.5); [NY courts reporter 2013](https://www.nycourts.gov/reporter/3dseries/2013/2013_23332.htm)
- Pay or deny: the insurer must pay or deny within 30 days of receiving proof of claim (11 NYCRR 65-3.8). A timely verification request extends the 30 days until the verification is received. Under 65-3.8(l), a late verification request shortens the pay-or-deny window by the number of days it was late. — [Neptune Med. Care v Ameriprise (2015)](https://www.nycourts.gov/Reporter/3dseries/2015/2015_51220.htm)
- Follow-up: if verification is not received within 30 days of the original request, the insurer must send a follow-up request within 10 calendar days (65-3.6(b)). — [NY courts reporter 2015](https://nycourts.gov/reporter/3dseries/2015/2015_51220.htm)
- 120-day rule (65-3.5(o)): the applicant must submit the requested verification, or a reasonable justification for not doing so, within 120 calendar days of the initial request. The insurer may then deny. — [search extract of 11 NYCRR 65-3.5](https://www.law.cornell.edu/regulations/new-york/11-NYCRR-65-3.5)
- Interest (11 NYCRR 65-3.9(a); Ins. Law §5106(a)): overdue benefits bear interest at 2% per month, "calculated on a pro-rata basis using a 30-day month" (simple interest). Benefits are overdue if not paid within 30 days after proof is supplied. Interest over $5 must be paid without demand. — [Cornell LII 11 NYCRR 65-3.9](https://www.law.cornell.edu/regulations/new-york/11-NYCRR-65-3.9); [DFS OGC Op. 10-09-05](https://www.dfs.ny.gov/insurance/ogco2010/rg100905.htm)
- Interest tolling (65-3.9(c)): if the claimant does not request arbitration or sue within 30 days of receiving a denial, interest stops from receipt of the denial until the filing. — [DFS OGC Op. 10-09-05](https://www.dfs.ny.gov/insurance/ogco2010/rg100905.htm)
- Attorney fees: a claimant on a valid overdue claim recovers reasonable attorney fees subject to DFS limits. The sixth amendment to Reg 68-D (effective 2015-02-04) set a maximum fee of $1,360 for certain resolved disputes. — [Ins. Law §5106 via DFS OGC](https://www.dfs.ny.gov/insurance/ogco2006/rg060603.htm); [Sixth Amendment to Reg 68-D](https://www.dfs.ny.gov/system/files/documents/2021/01/rf68da6t.pdf)
- If the insurer does not respond within 30 days of a submission, or issues an NF-10 denial, the claimant may sue, complain to DFS, or file AAA arbitration. — [DFS No-Fault Resources](https://www.dfs.ny.gov/apps_and_licensing/property_insurers/nofault)

**New Jersey**
- After a DRP award requiring payment, the insurer must pay with accrued interest under N.J.S.A. 39:6A-5 within 45 days of receiving the determination (N.J.A.C. 11:3-5.6). — [Cornell LII N.J.A.C. 11:3-5.6](https://www.law.cornell.edu/regulations/new-jersey/N-J-A-C-11-3-5-6)
- Late clinical information: one carrier's DPR plan adds a penalty copay capped at 25% if information arrives 30 or more days after the accident and 50% if 60 or more days after. — [Insurer DPR plans compiled by search: Enlyte/MIC plan](https://www.enlyte.com/media/50791) (carrier-specific)
- Provider notice: providers must notify the PIP insurer within 21 days of beginning treatment. The insurer must pay within 60 days of receiving written notice of the loss, or 45 additional days if it requests verification. Overdue amounts bear interest. **[UNVERIFIED – training knowledge; N.J.S.A. 39:6A-5(b),(g),(h)]**
- No minimum "begin treatment within X days" rule like Florida's 14-day rule was found for NY or NJ. In NJ, timing instead feeds into DPR penalties.

### Inferences
- NY task timers: 30 days from DOA (patient NF-2), 45 days from DOS (bill), 15 business days (insurer verification window, used to argue a late request), 30 days (pay/deny), 120 days (respond to verification), 30 days from denial (file arbitration/suit to keep interest running).
- NJ task timers: 21 days from first treatment (notice and APTP to the carrier), DPR request before each decision point, 60 days for payment, 45 days to pay after an award.

### Gaps
- Exact current text of 11 NYCRR 65-1.1 (30/45-day language) and of N.J.S.A. 39:6A-5 (21/60-day, interest rate) could not be fetched.
- The NJ interest rate on overdue PIP (39:6A-5(h) ties it to the court-rule judgment rate, not verified) was not confirmed.

---

## 3. Required forms

### Takeaway
NY uses DFS-prescribed NF forms (current full set posted 2026-09, NF-10 Rev 6/2026). The clinic's core forms are the NF-AOB (assignment), the NF-3 or CMS-1500 (bill), and patient NF-2 tracking. NJ uses the insurer's DPR plan forms, centered on the state-mandated Attending Provider Treatment Plan (APTP) form, plus the carrier's PIP application and an AOB.

### Cited Findings
**New York**
- DFS posts the complete prescribed set (NF-1A through NF-10, NF-AOB). The file is dated 2026-09. — [DFS complete NF forms 2026](https://www.dfs.ny.gov/system/files/documents/2026/09/complete_nf_forms_2026.pdf); [DFS No-Fault Resources](https://www.dfs.ny.gov/apps_and_licensing/property_insurers/nofault)
- NF-10 Denial of Claim was revised 6/2026. Items 23–32 are completed when health-service benefits are denied. — [DFS NF-10 (Rev 6/2026)](https://www.dfs.ny.gov/system/files/documents/2026/09/nf-10_202606.pdf)
- Insurers must accept the NF-3 (Verification of Treatment by Attending Physician or Other Provider of Health Service) for accidents on or after 2002-03-01. — [DFS Reg 68 FAQ](https://www.dfs.ny.gov/apps_and_licensing/property_insurers/nofault_faqs_reg68)
- Form roles **[UNVERIFIED – training knowledge]**: NF-2 = Application for Motor Vehicle No-Fault Benefits (patient). NF-3 = provider verification/bill (CMS-1500 accepted). NF-4 = verification of hospital treatment. NF-5 = hospital facility form. NF-6 = employer wage verification. NF-7 = employer wage verification for occupational injury. NF-8 = proof-of-claim for other expenses. NF-AOB = Assignment of Benefits. NF-10 = denial of claim. NF-1A/1B = insurer letters to applicant. — [DFS complete NF forms 2026](https://www.dfs.ny.gov/system/files/documents/2026/09/complete_nf_forms_2026.pdf)

**New Jersey**
- Under N.J.A.C. 11:3-4.7(d), providers must submit DPR and precertification requests on the Attending Provider Treatment Plan (APTP) form. "No other form will be accepted." — [GEICO NJ DPR & Precert Requirements M-595](https://www.geico.com/public/pdf/statepages/nj/m595(01-17).pdf); [Progressive DPR Plan Z182 NJ](https://www.progressive.com/Content/pdf/suppliers/Progressive-Decision-Point-Review-Plan.pdf)
- Each insurer files its own DPR plan with DOBI (examples: Plymouth Rock PRA NJ 203 04/22, Esurance, National General, AmTrust). The plans list the vendor (often Enlyte/Coventry or Medlogix), the fax/portal, and the AOB and internal-appeal requirements. — [Plymouth Rock DPR Plan 04/22](https://www.plymouthrock.com/public/Plymouthrock/StaticFiles/PDF/Decision-Point-Review-Plan-edition-PRA-NJ-203-04-22.pdf); [AmTrust DPR Plan](https://www.enlyte.com/amtrust-north-america-dpr-plan)

### Inferences
- NY form templates can be shared across carriers because DFS prescribes them. NJ needs a per-carrier configuration (DPR vendor, fax/portal, the carrier's AOB form, internal-appeal form), with the APTP as the common request form.

### Gaps
- Current NJ DOBI standardized forms beyond the APTP (for example, a uniform internal-appeal form or a uniform PIP AOB) were not confirmed.
- The DFS NF form-set PDF contents could not be opened, so NF numbering is from training knowledge.

---

## 4. Fee schedules for chiropractic

### Takeaway
NY no-fault pays chiropractors under the NY Workers' Compensation Chiropractic Fee Schedule (adopted under Ins. Law §5108 / 11 NYCRR 68), currently the 2018–2020 edition with updates effective 2020-01-01. A daily cap of 12 RVUs (15 or 18 on evaluation days) on physical-medicine/chiro/acupuncture modalities applies across all providers. The WCB is mid-rulemaking on a new edition: proposed 2026-01-14, revised notice 2026-09-02, effective date to be determined. NJ's PIP medical fee schedule (N.J.A.C. 11:3-29) was last substantively updated in 2013. DOBI has issued advance notices (Sept 2025 and Oct 2026) of amendments, including replacing the daily PM&R cap with a weekly cap.

### Cited Findings
**New York**
- WCB proposed amendments to 12 NYCRR 329-1.3, 329-4.2, 333.2, 343.2 and 348.2 to update the Medical, Chiropractic, Podiatry, Psychology and other schedules. They were first published in the State Register on 2026-01-14. A revised proposal is dated 2026-08-21, with a Notice of Revised Rule Making in the 2026-09-02 State Register and a 45-day comment period. — [WCB revised proposal page (Aug 21, 2026)](https://www.wcb.ny.gov/content/main/regulations/revised/revised-med-fee-2026-08/); [WCB proposed page (Jan 5, 2026)](https://www.wcb.ny.gov/content/main/regulations/proposed/med-fee-sched-2026-01)
- The revised draft chiropractic schedule is marked "DRAFT" with effective date "TBD" (the January draft said "Effective xx/xx/2026"). It uses AMA CPT 2024 terminology. — [WCB 20260623 RefMed NYFS Chiropractic (draft)](https://www.wcb.ny.gov/content/main/regulations/revised/revised-med-fee-2026-08/20260623-RefMed-NYFS-Chiropractic.pdf); [WCB FS Comparison Chiropractic](https://www.wcb.ny.gov/content/main/regulations/revised/revised-med-fee-2026-08/FS-Comparison-Chiropractic.pdf)
- Current in-force edition: Official NYS WC Chiropractic Fee Schedule, updated pages effective 2020-01-01. — [Optum copy of updated pages eff. 1/1/2020](https://www.optumcoding.com/upload/docs/Official_New_York_State_Workers_Compensation_Chiropractic_Fee_Schedule_Updated_Pages_Effective_January_1_2020.pdf)
- The comparison table shows a chiropractic E/M conversion factor of $6.37 for Regions I–II. This matches the 2020 schedule, and it was unclear whether the figure is current or proposed. — [WCB FS Comparison Chiropractic](https://apps.wcb.ny.gov/content/main/regulations/proposed/med-fee-sched-2026-01/FS-Comparison-Chiropractic.pdf) (figure needs verification)
- Daily cap: for dates of service on or after 2020-10-01, a patient may not receive more than 12.0 RVUs per day per accident from all providers combined for physical medicine, acupuncture and chiropractic modalities. Physical Medicine Ground Rule 1A allows 12, 15 (with re-evaluation) or 18 (with initial evaluation). The cap rose from 8 to 12 RVUs, and a chiropractor's 6 RVUs plus a PT's 6 RVUs on the same day exhaust it. — [TonaLaw 2024 WCB Fee Schedule](https://tonalaw.com/wcb-2024-fee-schedule/); [R. Friedman Law 2019/2020](https://www.rfriedmanlaw.com/news-events/2020/february/implementation-of-new-fee-schedules-for-acupunct/); [Morris Law, same-day reductions](https://www.morrislaw.com/fee-schedule-reductions-for-treatment-rendered-elsewhere-on-the-same-day/) (secondary)
- Inclusion of a code does not guarantee payment. Codes must meet medical necessity and the Medical Treatment Guidelines and ground rules. — [WCB FS Comparison Chiropractic](https://www.wcb.ny.gov/content/main/regulations/revised/revised-med-fee-2026-08/FS-Comparison-Chiropractic.pdf)
- Providers cannot request more than the fee schedule (Ins. Law §5108(c)). — [DFS OGC Op. 02-09-24](https://www.dfs.ny.gov/insurance/ogco2002/rg020924.htm)

**New Jersey**
- N.J.A.C. 11:3-29 implements N.J.S.A. 39:6A-4.6. The Commissioner sets PIP medical fee schedules, and the insurer's limit of liability is the fee schedule amount. — [DOBI rulemaking history](https://www.nj.gov/dobi/ad042401.htm); [NJ OAL decision 2021](https://www.nj.gov/banking/aaa/data/18z600905103.pdf)
- History: the 2001 rules imposed a $90 daily fee cap (11:3-29.4(m)) and E/M limits, upheld on appeal. The 2008–09 amendments were upheld except the Ingenix UCR database provision (11:3-29.4(e)(1)), which was enjoined. — [DOBI App. Div. decision 2009](https://www.nj.gov/dobi/pipinfo/fsdecision0809.pdf); [DOBI ad042401x](https://www.nj.gov/dobi/ad042401x.pdf)
- DOBI's ~Sept 2025 advance notice said the PIP schedules were "last updated in 2013" and no longer reflect current coding. — [Brach Eichler Healthcare Law Update, Sept 2025](https://www.bracheichler.com/healthcare-law-update-september-2025/)
- DOBI's 2026-10-01 advance notice proposes replacing the daily PM&R cap (11:3-29.4(m)) with a weekly cap, adding a "week" definition in 11:3-29.2. The weekly figure would be about 38% above the current daily rate, and NCCI edits still apply. This is not yet a formal NJ Register proposal. — [Brach Eichler, "DOBI Proposes Weekly Cap"](https://www.bracheichler.com/insights/dobi-proposes-weekly-cap-on-new-jersey-pip-rehab-fees/)
- Chiropractors bill under the physician fee schedule exhibit (Exhibit 1). Chiropractic manipulative treatment and PM&R codes are subject to the daily cap. **[UNVERIFIED – training knowledge]** — [DOBI fee schedule page](https://www.nj.gov/dobi/pipinfo/medfeerpt.htm)

### Inferences
- NY rate tables need versioning by date of service: the 2020 edition now, and the new WCB edition once adopted (likely late 2026 or 2027). The 12/15/18-RVU daily cap must be checked across providers, which the clinic cannot fully see, so the app should flag same-day outside therapy.
- NJ rate tables are stable (2013) but should carry an effective-date field for the pending weekly-cap rule.

### Gaps
- Current NY chiropractic conversion factors by region (the 2020 values vs the proposed 2026 values) were not confirmed.
- The NJ current daily PM&R cap dollar amount and the chiropractic code values were not retrieved.

---

## 5. Utilization controls

### Takeaway
NJ is the most process-heavy. Soft-tissue neck/back injuries follow DOBI Care Paths with Decision Point Reviews. Other treatment and listed tests need precertification. Requests go on the APTP, and non-compliance costs an extra copay of up to 50%. NY has no precertification. Insurers control utilization after the fact through IMEs, EUOs (both conditions precedent to coverage), peer reviews, fee-schedule defenses and NF-10 denials.

### Cited Findings
**New Jersey**
- Care Paths cover "Identified Injuries" (soft-tissue injuries of the neck and back). They are standard courses of treatment published by DOBI, with decision points at which the provider must give the insurer notice and clinical support (DPR). Other injuries go through precertification. — [Insurer DPR plans (MIC/Enlyte)](https://www.enlyte.com/media/50791); [GEICO M-595](https://www.geico.com/public/pdf/statepages/nj/m595(01-17).pdf)
- Penalty: failing to request DPR or precert when required brings an additional copay "not to exceed 50 percent of the eligible charge for services provided before proper notice," even if the services were medically necessary. This is in addition to the policy copay. — [N.J.A.C. 11:3-4 DOBI copy (eff. 2013-01-04)](https://www.nj.gov/dobi/pipinfo/njac11_3_4_effect130104.pdf); [Progressive DPR plan](https://www.progressive.com/Content/pdf/suppliers/Progressive-Decision-Point-Review-Plan.pdf)
- Denials of treatment or testing must rest on a physician's or dentist's determination of medical necessity (N.J.A.C. 11:3-4.7(c)4). — [Insurer DPR plan (search extract)](https://www.enlyte.com/media/21581)
- The insurer must decide a DPR or precert request within 3 business days or the treatment is deemed approved. Insurers may require an IME, with results within a set number of days. A provider holding an AOB must use the insurer's internal appeal process (N.J.A.C. 11:3-4.7B) before arbitration. **[UNVERIFIED – training knowledge; see each carrier's DPR plan]**

**New York**
- No precertification exists. The verification process (section 2) plus IMEs and EUOs are the insurer's tools. Under the mandatory endorsement, the eligible injured person must submit to IMEs and EUOs as reasonably required. Failure to appear at two scheduled IMEs/EUOs is a coverage defense that voids the whole claim, applied retroactively. **[UNVERIFIED – training knowledge; 11 NYCRR 65-1.1; case law e.g. Unitrin Advantage Ins. Co. v Bayshore Physical Therapy (1st Dept 2011)]** — [Reg 68 full text](https://www.dfs.ny.gov/system/files/documents/2024/08/reg68_11_nycrr_65_full_txt.pdf)
- Medical-necessity denials must be timely (within the 30-day window) and supported by a peer review or IME with a factual basis. A lack-of-necessity defense based on a peer review is precluded if the denial is late. **[UNVERIFIED – training knowledge]**
- Insurance Circular Letter No. 3 (2019) concerns no-fault billing practices. — [DFS CL 2019-03](https://www.dfs.ny.gov/industry_guidance/circular_letters/cl2019_03) (contents not reviewed)
- No statutory visit cap was found in either state. In NY the 12-RVU daily cap and the WCB Medical Treatment Guidelines (neck/back MTGs) act as de facto frequency controls, and some insurers cite them. — [WCB FS Comparison Chiropractic](https://www.wcb.ny.gov/content/main/regulations/revised/revised-med-fee-2026-08/FS-Comparison-Chiropractic.pdf)

### Inferences
- NJ app needs: Care Path / decision-point schedule per case, APTP generation, DPR request/response log with a 3-business-day "deemed approved" timer, and a penalty-copay calculator (0/25/50%).
- NY app needs: an IME/EUO appointment tracker with a two-no-show alert, peer-review receipt logging, and a denial-reason taxonomy (fee schedule, medical necessity, IME cut-off, EUO no-show, late notice, policy exhausted).

### Gaps
- The current DOBI Care Path exhibit and the decision-point visit counts were not retrieved.
- Whether NY no-fault insurers are formally bound by the WCB Medical Treatment Guidelines was not confirmed. I believe they are not formally bound, but they cite them.

---

## 6. Dispute resolution

### Takeaway
NY: AAA-administered no-fault arbitration (DFS program), with master-arbitration appeal, or a civil-court suit. Interest tolls if the claimant waits more than 30 days after a denial. NJ: Forthright administers PIP dispute resolution under N.J.A.C. 11:3-5, after the internal appeal. Awards are paid within 45 days with interest.

### Cited Findings
**New York**
- Arbitration requests go to the American Arbitration Association, not DFS (DFS returns them). All supporting documents must be submitted with the filing, and afterwards only new bills for ongoing benefits may be added. — [DFS file no-fault arbitration](https://www.dfs.ny.gov/complaints/file_no_fault_arbitration); [DFS No-Fault Resources](https://www.dfs.ny.gov/apps_and_licensing/property_insurers/nofault)
- Pending reform: the DFS 2026 Regulatory Agenda lists an amendment to 11 NYCRR 65-4 (Reg 68-D) to remove outdated provisions, change master-arbitrator pay, and change how the arbitration program is administered and its costs assessed to insurers. No adoption was found. — [DFS 2026 Regulatory Agenda](https://www.dfs.ny.gov/system/files/documents/2026/01/2026-DFS-Regulatory-Agenda.pdf)
- Attorney fee cap of $1,360 for certain resolved disputes (6th Amendment to 68-D, eff. 2015-02-04). — [DFS](https://www.dfs.ny.gov/system/files/documents/2021/01/rf68da6t.pdf)

**New Jersey**
- N.J.A.C. 11:3-5.6: the DRP's decision is binding but may be clarified, modified, appealed under DRP rules, or reviewed by the Superior Court. A payment award must be paid with interest within 45 days. Attorney fees use the lodestar method. — [Cornell LII N.J.A.C. 11:3-5.6](https://www.law.cornell.edu/regulations/new-jersey/N-J-A-C-11-3-5-6)
- Forthright rules (amended 2022-08-01): a single DRP hears the case by default. A three-DRP panel may be requested if the aggregate claim exceeds $50,000, within 45 days of the Initiating Letter. — [NJ No-Fault PIP Arbitration Rules 2022](https://www.nj-no-fault.com/process)
- Respondents have a 45-day conciliation period from case initiation to settle without paying the respondent administration fee. — [DOBI Forthright Q1 2026 report](https://www.nj.gov/dobi/pipinfo/forthright2026q1.pdf)
- Filing fee is reportedly about $225 for in-person hearings (demand over $1,000) and about $200 on the papers. This is an unofficial figure. — [Bhatt Law Group / practice site](https://www.bhattlawgroup.com/injury/pip-arbitration-lawyer/)

### Inferences
- Both states need an arbitration module: filing date, forum case number, document bundle, award date, payment due (NJ +45 days), and interest accrual.

### Gaps
- NY arbitration filing fee and the limitations period (generally 6 years for contract claims against insurers, but 3 years against self-insurers under Contact Chiropractic v NYCTA, 2018) are **[UNVERIFIED – training knowledge]**.
- The current Forthright fee schedule was not confirmed.

---

## 7. Tort threshold and case value

### Takeaway
NY: an injured person can sue for pain and suffering only with a "serious injury" under Ins. Law §5102(d) (9 categories), proven by objective medical evidence. Subjective pain and simple sprains/strains are insufficient. NJ: "Limitation on Lawsuit" (verbal threshold) allows non-economic recovery only for 6 categories, and the permanent-injury category requires a physician's certification of permanency based on objective clinical evidence, served within 60 days of the answer. "No Limitation" policyholders can sue for any injury.

### Cited Findings
**New York**
- Serious injury categories include permanent consequential limitation of use, significant limitation of use, and the 90/180-day category (medically determined injury preventing substantially all usual activities for 90 of the first 180 days). Each is a separate claim that can be dismissed independently. — [Pastuszynski v Lofaso (2016)](https://www.nycourts.gov/REPORTER/3dseries/2016/2016_04619.htm); [Lyndor v Cezario (2d Dept 2026)](https://www.nycourts.gov/reporter/3dseries/2026/2026_01503.shtml)
- "Subjective pain cannot form the basis of a serious injury," and sprains/strains generally do not qualify. — [4th Dept 2025 decision](https://www.nycourts.gov/courts/ad4/Clerk/Decisions/2025/0131T1500/pdf/0783.pdf)
- Full §5102(d) list: death; dismemberment; significant disfigurement; fracture; loss of a fetus; permanent loss of use of a body organ, member, function or system; permanent consequential limitation of use of a body organ or member; significant limitation of use of a body function or system; 90/180-day. Suit for economic loss above BEL is also allowed (Ins. Law §5104). **[UNVERIFIED wording – training knowledge]**

**New Jersey**
- N.J.S.A. 39:6A-8(a) categories: death; dismemberment; significant disfigurement or scarring; displaced fractures; loss of a fetus; permanent injury. A permanent injury is one that "has not healed to function normally and will not heal to function normally with further medical treatment." A displaced fracture needs no separate proof of permanency. — [NJ App. Div. a0393-23 (2025)](https://njcourts.gov/system/files/court-opinions/2025/a0393-23.pdf); [a2369-22 (2024)](https://njcourts.gov/system/files/court-opinions/2024/a2369-22.pdf)
- Certification: within 60 days after the defendant's answer, the plaintiff must serve a certification from the licensed treating physician, or a board-certified physician the treater referred the plaintiff to, based on objective clinical evidence that is "derived from accepted diagnostic tests and cannot be 'dependent entirely upon subjective patient response.'" A late certification is not automatically fatal. — [App. Div. opinions via search](https://www.njcourts.gov/system/files/court-opinions/2024/a3319-22.pdf); [Beltran v DeLima (2005)](https://law.justia.com/cases/new-jersey/appellate-division-published/2005/a6056-03-opn.html)
- Limitation on Lawsuit is the default if the insured makes no selection on a standard policy, and the Basic Policy always carries the limitation. **[UNVERIFIED – training knowledge]**
- NJ Supreme Court: evidence of future medical expenses within PIP limits is inadmissible at trial. — [Mondaq/NatLawReview summary](https://natlawreview.com/article/nj-supreme-court-future-medical-expenses-within-pip-limits-are-inadmissible?amp)

### Inferences
- Florida's "permanent injury" flag maps to NJ fairly directly. The app should add a "Certificate of Permanency" document, record whether the certifying doctor is the treating physician or a board-certified referral, store the objective test basis (MRI, EMG/NCV), and track the 60-days-after-answer deadline. Chiropractors may be "treating physicians" for certification; verify per case law.
- For NY, store a §5102(d) category checklist plus objective-findings evidence (ROM with goniometer and quantified percentages, MRI). Case value depends heavily on this.
- Case-value flag: an NJ "No Limitation" policy (or an NY qualifying serious injury) means higher potential PI recovery.

### Gaps
- Whether chiropractors can sign NJ permanency certifications was not verified (the statute says "licensed treating physician"; NJ case law has accepted chiropractors in some contexts).

---

## 8. Balance billing, liens, letters of protection

### Takeaway
NY: providers may not demand or request more than the no-fault fee schedule, even after the $50k is exhausted. After exhaustion, with no other coverage, they may bill the patient directly, but only at fee-schedule rates. NJ: no provider may demand payment from anyone above the PIP fee schedule. Deductible and copay can be collected from the patient. No NY or NJ chiropractor lien statute was found.

### Cited Findings
- NY: Ins. Law §5108(c) "prohibits a provider from demanding or even requesting fees that are in excess of the No-Fault fee schedule." — [DFS OGC Op. 02-09-24](https://www.dfs.ny.gov/insurance/ogco2002/rg020924.htm)
- NY: services after exhaustion are still subject to §5108 fee-schedule limits. Where no other coverage exists, there is "no impediment to the health care provider's ability to bill the patient directly." — [DFS OGC Op. 08-07-28](https://www.dfs.ny.gov/insurance/ogco2008/rg080728.htm)
- NY: a provider may not bill the patient or the patient's health insurer at standard rates after a denial for exhaustion. Billing is limited to no-fault rates. — [DFS OGC Op. 09-05-01](https://www.dfs.ny.gov/insurance/ogco2009/rg090501.htm)
- NY: "a provider can not balance bill a patient for fees in excess of those contained in the fee schedule." — [DFS Reg 83 FAQ](https://www.dfs.ny.gov/apps_and_licensing/property_insurers/faqs_reg83_nofault_schedule); billing above the schedule violates §5108(a) and (c) — [DFS OGC Op. 05-05-29](https://www.dfs.ny.gov/insurance/ogco2005/rg050529.htm)
- NJ: "No health care provider may demand or request any payment from any person in excess of those permitted by the medical fee schedules" (N.J.A.C. 11:3-29.6). — [Justia N.J.A.C. 11:3-29.6 (current through Mar 2024)](https://regulations.justia.com/states/new-jersey/title-11/chapter-3/subchapter-29/section-11-3-29-6/)
- NJ: after exhaustion, health insurance may cover further accident care, and the at-fault party may be liable for uncompensated economic losses. — [Brandon J. Broderick blog 2021](https://www.brandonjbroderick.com/Our-Blog/2021/March/Medical-Bills-Higher-Than-PIP-Coverage) (secondary)

### Inferences
- Florida-style letters of protection at full charges are largely incompatible with NY: any LOP or lien-type arrangement must be at the fee schedule for covered no-fault services. In NJ, charges within PIP-covered care are capped at the fee schedule. Post-exhaustion billing above the schedule is unclear (see Gaps), so the conservative setting is fee-schedule rates.
- Patient statements: NY should show $0 patient responsibility for covered services. NJ should show the deductible, the 20% copay band and any DPR penalty copay.

### Gaps
- No NY or NJ statute granting chiropractors a lien on PI recoveries was found. NJ has a hospital lien act (N.J.S.A. 2A:44-35 et seq.) and NY has a hospital lien law (Lien Law §189), but neither was verified as covering chiropractic offices.
- Whether NJ 11:3-29.6 still restricts billing the patient once PIP limits are exhausted is unresolved in the sources found.

---

## 9. Recent reforms (2019–2026) and pending changes

### Takeaway
The live items are the NY WCB fee schedule overhaul (pending, effective date TBD, which flows through to no-fault), the NY DFS Reg 68-D arbitration amendment on the 2026 agenda, a new NF-10 (Rev 6/2026), NJ DOBI's PIP fee-schedule advance notices (2025 overhaul and Oct 2026 weekly PM&R cap), and NJ bill S3142 (2026) touching 39:6A-4.3.

### Cited Findings
- NY WCB medical/chiro fee schedule update: proposed 2026-01-14, revised notice 2026-09-02, effective TBD. — [WCB revised page](https://www.wcb.ny.gov/content/main/regulations/revised/revised-med-fee-2026-08/)
- NY 12-RVU daily cap for physical medicine/chiro/acupuncture effective for DOS on or after 2020-10-01; 2020 acupuncture/chiro schedule updates. — [TonaLaw](https://tonalaw.com/wcb-2024-fee-schedule/); [R. Friedman Law 2020](https://www.rfriedmanlaw.com/news-events/2020/february/implementation-of-new-fee-schedules-for-acupunct/)
- NY DFS full Reg 68 text republished 2024-08. The 2026 agenda proposes 65-4 arbitration changes. — [DFS Reg 68 2024](https://www.dfs.ny.gov/system/files/documents/2024/08/reg68_11_nycrr_65_full_txt.pdf); [DFS 2026 Agenda](https://www.dfs.ny.gov/system/files/documents/2026/01/2026-DFS-Regulatory-Agenda.pdf)
- NY NF-10 revised 6/2026, with the full NF set republished 2026-09. — [DFS NF-10](https://www.dfs.ny.gov/system/files/documents/2026/09/nf-10_202606.pdf)
- NJ DOBI advance notices: Sept 2025 (overhaul of the schedules "last updated in 2013") and 2026-10-01 (weekly PM&R cap). — [Brach Eichler 2025](https://www.bracheichler.com/healthcare-law-update-september-2025/); [Brach Eichler 2026](https://www.bracheichler.com/insights/dobi-proposes-weekly-cap-on-new-jersey-pip-rehab-fees/)
- NJ Forthright arbitration rules amended 2022-08-01. — [nj-no-fault.com](https://www.nj-no-fault.com/process)
- NJ S3142 (2026 session) reproduces and would amend N.J.S.A. 39:6A-4.3 (PIP options / health-primary). Status unknown. — [NJ Legislature S3142](https://pub.njleg.state.nj.us/Bills/2026/S3500/3142_T1.PDF)
- NJ minimum liability limits rose in 2023 and 2026 (P.L. 2022, c.87). **[UNVERIFIED – training knowledge]**. This affects the BI recovery pool, not PIP.

### Inferences
- Build fee schedules as date-of-service-versioned tables in both states. Expect a new NY chiropractic schedule within roughly 6–12 months and a possible NJ PM&R weekly cap.

### Gaps
- What S3142 actually changes, the final WCB conversion factors, and whether NJ's 2025 overhaul has been formally proposed in the NJ Register.
