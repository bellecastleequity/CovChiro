# Workers' comp rules by state: chiropractic, PT and injury clinics

*Prepared October 2026 for the PI portal (`pi_portal/app/pi_rules.php`, `jurisdictions.php`). This is **not legal advice**. Official statute and agency sites (flsenate.gov, myfloridacfo.com, law.cornell.edu, daisyBill KB) could not be opened through the proxy. Every figure below comes from search-engine extracts of those pages, from reputable secondary sources, or from background knowledge. Each value is tagged:*

- **[V]**: confirmed this session from a search extract of an official page or a statute/rule reproduction
- **[S]**: confirmed only from a secondary source (vendor, law firm, insurer)
- **[M]**: from background knowledge, **not verified this session**. Treat it as a placeholder until someone checks it.

*WC rules change often: fee schedules every year, and guideline editions and forms every few years. Before relying on any value, a licensed attorney or billing specialist in that state should check it against the current statute or rule.*

---

## 1. Headline findings

1. **The app's Florida chiropractic cap looks wrong. It is probably 24 treatments / 12 weeks, not 18 / 8.** A reproduction of the 2025 §440.13(2)(a) text reads: *"Medically necessary treatment, care, and attendance does not include chiropractic services in excess of 24 treatments or rendered 12 weeks beyond the date of the initial chiropractic treatment, whichever comes first, unless the carrier authorizes additional treatment or the employee is catastrophically injured"* ([syfert.com §440.13](https://www.syfert.com/florida/statutes/0440.13.html); same wording quoted by [daisyBill](https://kb.daisybill.com/articles/authorization-4c652b3e-ea69-4ada-b4fd-cb892924d2b9)) **[S]**. The 18-treatment / 8-week wording appears only in 1999–2000 bill texts ([SB 1420 (1999)](https://flsenate.gov/Session/Bill/1999/1420/BillText/Filed/HTML), [SB 108 (2000)](https://flsenate.gov/Session/Bill/2000/108/BillText/Filed/HTML)), so it is pre-2003 law. Check the live statute before changing the constants. If it holds, `WC_CHIRO_MAX_VISITS` should be 24 and `WC_CHIRO_MAX_DAYS` should be 84.
2. **The cap also needs a catastrophic-injury exemption, and its clock should start at the first *chiropractic* treatment, not at the case's `first_visit`.** Right now the code checks the cap only when `authorized_visits` is null, and it never exempts catastrophic injuries.
3. **The rule "DWC-25 within 3 days of every visit" is stricter than Florida requires.** The DWC-25 is due within **3 business days of the initial date of service** (DFS instructions), then **on each "actionable event"** (a change in the treatment plan, therapies, prescriptions or restrictions) and **after MMI** ([DFS DWC-25 page](https://www.myfloridacfo.com/division/wc/provider/dwc-25.htm); [DWC-25-A instructions](https://www.myfloridacfo.com/docs-sf/workers-compensation-libraries/workers-comp-documents/forms/69l-7/form-dfs-f5-dwc-25-a-instructions-rev-01-01-15-(09-29-15).pdf)) **[V]**. Sending one with each bill is a common conservative habit. The deadline should be counted in **business days**, though, and the per-visit alert should be renamed "best practice".
4. **Nearly every state shares the same core pattern:** an initial provider report, periodic work-status reports, treatment guidelines or caps, preauthorization outside those guidelines, a fee schedule, a billing deadline, and a ban on balance billing. What differs is the values, which makes this a natural fit for the app's existing effective-dated jurisdiction table.
5. **Billing deadlines are short and harsh in some states:** TX **95 days** (the bill is forfeited) [V], NY **120 days** [S], CO **120 days** [M], NC **75 days** [M], CA **12 months** [V]. A billing-deadline clock is the WC feature most worth building.

---

## 2. Florida (verify first: home state)

| Topic | Finding | Tag / source |
|---|---|---|
| Chiro cap | 24 treatments or 12 weeks from the first chiropractic treatment, whichever comes first, unless the carrier authorizes more or the employee is **catastrophically injured** (§440.02 definition). No surgery exception found. | [S] [syfert](https://www.syfert.com/florida/statutes/0440.13.html), [daisyBill](https://kb.daisybill.com/articles/authorization-4c652b3e-ea69-4ada-b4fd-cb892924d2b9) |
| DWC-25: initial | To the carrier (and the employer on request) "immediately but no later than three (3) business days after the date of service". The claim is valid only if this is met (§440.13(4)(a)). | [V] [DWC-25-A instructions](https://www.myfloridacfo.com/docs-sf/workers-compensation-libraries/workers-comp-documents/forms/69l-7/form-dfs-f5-dwc-25-a-instructions-rev-01-01-15-(09-29-15).pdf) |
| DWC-25: later | On each actionable event (change in treatment plan, therapies, prescriptions, restrictions) and after MMI. One vendor gives "next business day after evaluation or within 30 days of the previous submission" for follow-up evaluations. | [V] DFS page; [S] [daisyBill guide](https://kb.daisybill.com/articles/billing-guides-609d1327-4de5-4f88-b17f-5a0cc036f2fb) |
| DWC-25: MMI | Records the MMI date and the impairment rating. **No separate day count for MMI was found.** The app's "3 days after MMI" is a reasonable house rule, not a confirmed rule. | [V] DFS page |
| Statutory reports | §440.13(4)(a) (from memory): preliminary notice by the 3rd business day, a complete report within 15 days, then progress reports on request no more often than every 3 weeks. | [M] |
| Authorization | All non-emergency care needs carrier authorization. The carrier must respond by the close of the **3rd business day** (§440.13(3)(d)), or within **10 business days** for services over **$1,000** (§440.13(3)(i)). The worker gets a one-time change of physician; the carrier acts within 5 days. | [V] [DFS carrier cheat sheet](https://www.myfloridacfo.com/docs-sf/workers-compensation-libraries/workers-comp-documents/carriers/audit-carrier-cheat-sheet.pdf); [S] [CopperPoint](https://www.copperpoint.com/claims-kit/florida) |
| Bill form | DFS-F5-DWC-9 (CMS-1500) for professionals. **DWC-90 is the UB-04 facility form**, not a deadline. | [V] [Rule 69L-7.720](https://www.law.cornell.edu/regulations/florida/Fla-Admin-Code-Ann-R-69L-7-720) |
| Provider billing deadline | **Unresolved.** daisyBill says Florida has no statutory timely-filing limit for providers. The **carrier** must pay, adjust or deny within **45 days** of receiving the bill (§440.20(2)(b); Rule 69L-24.006). Amendments to Rules 69L-7.730/.740 were proposed, with a hearing on July 15, 2026. Re-check the outcome. | [V] [DFS FAQ](https://myfloridacfo.com/division/wc/provider/faq/lists/WorkersCompensationDataProvider/panels-health-care-providers-medical-services-faq/956fdb32-d686-4060-b93e-84e133317bba); [S] [daisyBill](https://kb.daisybill.com/articles/florida-billing-guide) |
| Fee schedule | Florida WC Health Care Provider Reimbursement Manual, **2024 Edition, effective 1/1/2025** (Rule 69L-7.020). It is Medicare-based, around 110% of Medicare for non-surgical services, which needs checking in the manual. | [V] [2024 HCP RM PDF](https://myfloridacfo.com/docs-sf/workers-compensation-libraries/workers-comp-documents/manuals/health-care-provider/2024-hcp-rm-rule-69l-7-020-final-eff-01-01-25.pdf); 110% [M] |
| MMI / impairment | Only a "physician" may set MMI or assign a permanent impairment (PI) rating (§440.15(3)), using the **Florida Uniform Permanent Impairment Rating Guide** (Rule 69L-7.604), as a whole-body percentage. Historic §440.13/§440.15 text lists *"a chiropractic physician licensed under chapter 460"* among those who may rate. That suggests **DCs can rate**, but the current text is unverified. | [V] DFS page, [69L-7.604](https://www.law.cornell.edu/regulations/florida/Fla-Admin-Code-Ann-R-69L-7-604); DC rating [S] [SB 1410 (1999)](https://flsenate.gov/Session/Bill/1999/1410/BillText/Filed/HTML) |
| Provider choice | Carrier-directed care: the carrier selects and authorizes providers. | [M] |
| Balance billing | Barred. A provider may not collect from the injured employee (§440.13(13)(a)). | [M] |
| Employer first report | DWC-1 is the employer's or carrier's filing, not the clinic's. Keeping a copy on file is an office task. | [S] |

---

## 3. State comparison

Abbreviations: **Guideline**: MTUS (CA, ACOEM-based), ODG, ACOEM, state-written MTG. **Bill**: provider's deadline to submit the bill after the date of service. **PTP**: primary treating physician. **BB**: balance billing.

| State | Chiro visit cap / guideline | Preauth | Initial provider report | Status report cadence | Bill deadline | Fee basis | Provider choice | DC can be treating? | BB |
|---|---|---|---|---|---|---|---|---|---|
| **FL** | 24 tx / 12 wk unless authorized or catastrophic [S] | All non-emergency care; 3 business-day response [V] | DWC-25 ≤3 business days [V] | DWC-25 on change and at MMI [V] | None statutory? (carrier pays in 45 days) [S] | 2024 HCP Manual, Medicare-based [V] | Carrier directs [M] | Yes, if authorized [M] | Barred [M] |
| **CA** | **24 chiro visits per injury** (LC 4604.5, DOI ≥ 1/1/2004); written authorization and post-surgical care excepted. MTUS [V] | Request for Authorization (RFA, DWC Form RFA) through utilization review for care not otherwise authorized [M] | DFR **Form 5021 within 5 days** [V] | PR-2 at least every **45 days** and on change [V] | **12 months** (DOS ≥ 2017); 30 days for UR-exempt services [V] | OMFS (RBRVS-based) [M] | Medical provider network (MPN) if the employer has one [M] | Yes, but **not after 24 visits** (8 CCR 9783.1) [V] | Barred (LC 3751(b)) [M] |
| **TX** | No numeric cap. **ODG** (28 TAC 137.100) [V] | Required for care outside or not addressed by ODG (28 TAC 134.600) [V] | DWC-73 after the initial exam [V] | **DWC-73** on substantial change in work status or restrictions (Rule 129.5) [V] | **95 days**; late bills forfeited (28 TAC 133.20; LC 408.027) [V] | Medicare-based medical fee guideline (MFG) with conversion factor (28 TAC 134.203) [M] | Certified health care network (HCN), or the worker picks a treating doctor [M] | Yes. MMI/IR needs DWC certification; DWC-69 [V] | Barred (LC 413.042) [M] |
| **NY** | **NY Medical Treatment Guidelines (MTG)**. Chiro reassessment at about 3 weeks for functional gain [S] | None if the MTG is applied correctly; otherwise an **MG-2 variance** [V] | **C-4 within 48 h** [S] | C-4.2 at 15 days, then periodic (sources say 45 or 90 days) [S] | **120 days** (12 NYCRR 325-1.25; when the clock starts is disputed); e-billing required from 8/1/2025 [S] | WCB chiropractic fee schedule (2026 update proposed) [V] | Any WCB-**authorized** provider [S] | Yes [S] | Barred [M] |
| **PA** | No cap. Utilization review only [M] | No routine preauth [M] | LIBC-9 within 10 days [M] | **LIBC-9 monthly** [M] | No statutory limit found; payer pays in 30 days [S] | **113% of Medicare** (34 Pa. Code 127.105, CPI/SAWW-adjusted) [V] | **Employer panel for 90 days** [V] | Yes, can be on the panel [V] | Barred (127.211) [S] |
| **IL** | No cap. UR uses evidence-based guidelines such as ACOEM/ODG (§8.7) [M] | UR, not a mandated preauth [M] | None mandated [M] | None mandated [M] | None found; payer pays in 30 days with interest (§8.2(d)) [M] | IL fee schedule (geozip, CPI-adjusted); lesser of charge or fee [V] | **Two choices of physician** plus their referral chain [S] | Yes [S] | Barred while the claim is pending or compensable (*Tiburzi v. Kline*) [V] |
| **OH** | No numeric cap [M] | **C-9** to the managed care organization (MCO); 3 business-day decision [V] | FROI (can be filed by the provider) [M] | **MEDCO-14** for disability or restrictions [V] | **1 year** [M] | BWC fee schedule (RBRVS-based) [M] | Any BWC-certified provider; MCO manages the claim [M] | Yes, as **physician of record** [V] | Barred [M] |
| **GA** | No chiro cap found. Max 4 physical-medicine charges per visit or day [V] | For certain services; WC-205 request [M] | WC-20 (provider medical report) [M] | On change [M] | 1 year? [M] | SBWC fee schedule (annual) [M] | **Posted panel** (≥6; conformed panel ≥10 incl. a chiropractor); one change allowed [V] | Yes, if on the panel [V] | Barred [M] |
| **NC** | **20 visits** without further authorization; then payer approval [V] | After 20 visits [V] | None mandated [M] | On request (Form 25R etc.) [M] | **75 days** (G.S. 97-26(i)) [M] | Medicare-based (since 2015) [M] | **Employer directs** (97-25); a chiropractor of the worker's choice may need Industrial Commission approval [V] | Yes [V] | Barred (97-90(e)) [M] |
| **MI** | No cap found [M] | Some services [M] | None mandated [M] | On request [M] | 1 year? [M] | Health Care Services Rules (RBRVS conversion factor) [M] | **Employer picks for the first 28 days** [V] | Yes, after 28 days [V] | Barred (MCL 418.315) [M] |
| **NJ** | No cap or guideline [M] | Employer authorizes everything [V] | None [M] | On request [M] | No statutory limit (disputes go to the Division) [M] | **No professional fee schedule**: "reasonable and customary" [V] | **Employer controls** (34:15-15) [V] | Only if authorized [V] | Barred (P.L.2012 c.67) [V] |
| **WA** | Prior auth for **>20 visits or >60 days** after first treatment; one visit per day [V] | As at left [V] | Report of Accident (F242-130) [M] | **APF** on change (≤6 in first 60 days, then ≤4 per 60 days) [V] | **1 year** (WAC 296-20-125) [M] | L&I fee schedule (RBRVS, July 1) [V] | Worker chooses within L&I's network [M] | **Yes**, as attending provider for musculoskeletal conditions [V] | Barred (WAC 296-20-020) [M] |
| **AZ** | **ODG** (adopted by the Industrial Commission (ICA)) [S] | Per ODG / carrier [M] | Physician's Initial Report to ICA and carrier [V] | On change [M] | 1 year? [M] | ICA Physicians' Fee Schedule (RVU × conversion factor; "physician" includes DCs) [V] | Worker chooses, unless employer managed care (§23-1070) [M] | Yes [V] | Barred [M] |
| **CO** | **CO MTG (Rule 17)**. Initial time-to-produce-effect: **6 sessions** [S] | Rule 16 prior auth for care outside the guidelines [M] | **WC164** after the initial visit [S] | WC164 at MMI or change; with the bill within 14 days [S] | **120 days** [M] | Rule 18 (RBRVS) [M] | **Employer designates the authorized treating physician (ATP)**; worker choice from 2028 (HB 25-1300) [S] | As ATP with Level I accreditation [S]; impairment rating needs Level II [M] | Barred (CRS 8-42-101(4)) [M] |
| **MN** | **Passive care ≤12 weeks** from the start; +12 visits over 12 months possible; departures under 5221.6050 [V] | Prior **notice** of departure (5221.6050 subp. 9) [V] | None mandated [M] | Report of Work Ability after each change [M] | 6 months? [M] | MN RBRVS fee schedule [M] | Worker chooses, unless a certified managed care plan [M] | Yes; can rate permanency [M] | Barred (176.135) [M] |

Key sources: CA [LC 4604.5](https://california.public.law/codes/labor_code_section_4604.5), [8 CCR 9783.1](https://dir.ca.gov/t8/9783_1.html), [RAND on DFR/PR-2](https://www.rand.org/pubs/periodicals/health-quarterly/issues/v7/n4/05.html), [DWC billing FAQ](https://dir.ca.gov/dwc/EBilling/StandardizePaperBilling_FAQs.html). TX [preauth bootcamp](https://www.tdi.texas.gov/WC/hcprovider/documents/bootcamp252-preauth.pdf), [95-day decision](https://www.tdi.texas.gov/medcases/medfee24/m4242113.pdf), [DWC-73 decision](https://www.tdi.texas.gov/medcases/medfee25/m4250839.pdf), [MMI certifying doctor](https://tdi.texas.gov/appeals/2024cases/240521r.pdf). NY [WCB fee schedule comparison](https://apps.wcb.ny.gov/content/main/regulations/proposed/med-fee-sched-2026-01/FS-Comparison-Chiropractic.pdf), [daisyBill NY deadline](https://blog.daisybill.com/ny-workers-comp-medical-billing-deadline), [BlueHive NY forms](https://bluehive.com/resources/forms/state/ny/). PA [34 Pa. Code 127.105](https://regulations.justia.com/states/pennsylvania/title-34/part-viii/chapter-127/subchapter-b/calculations/section-127-105), [PA panel](https://www.pa.gov/agencies/dli/programs-services/workers-compensation/state-workers--insurance-fund-home/swif-claims-and-indemnity). IL [Tiburzi](https://www.isba.org/node/28214), [ICS balance billing](https://ilchiro.org/?p=24400), [two-doctor rule](https://www.horwitzlaw.com/faq/what-doctors-can-i-go-to-under-the-workers-compensation-act-in-illinois). OH [BWC forms](https://bwc.ohio.gov/bwccommon/forms/BWCForms/nlbwc/ProviderDescriptions.asp), [prior auth](https://dam.assets.ohio.gov/image/upload/info.bwc.ohio.gov/Providers/Prior-Authorization-of-Medical-Treatment-or-Vocational-Service-Requests-TF.pdf), [BRM ch. 2](https://dam.assets.ohio.gov/image/upload/info.bwc.ohio.gov/Providers/BRMChapter2with_redactions_final_090124_1.pdf). GA [SBWC panel](https://sbwc.georgia.gov/sites/sbwc.georgia.gov/files/imported/SBWC/Files/wc_p2.pdf), [2009 FCE/physical medicine amendment](https://sbwc.georgia.gov/document/publication/fce-code-amendment-may-2009/download). NC [IC chiropractic guidance](https://www.ic.nc.gov/ncic/pages/NEWCHIRO.HTM). MI [Michigan DCS FAQ](https://www.michigan.gov/mdcs/disability-gateway/dmo-home/wc). NJ [LexisNexis on P.L.2012 c.67](https://www.lexisnexis.com/community/insights/legal/workers-compensation/b/recent-cases-news-trends-developments/posts/new-jersey-bans-medical-providers-from-charging-claimants-for-work-related-medical-expenses). WA [L&I chiropractic](https://lni.wa.gov/patient-care/treating-patients/by-specialty/chiropractic-services), [MARFS ch. 7](https://Lni.wa.gov/patient-care/billing-payments/marfsdocs/2023/2023MARFSChapter7.pdf), [APF](https://lni.wa.gov/patient-care/_docs/2021_06_02_BP2-APF.pdf), [fee card 2025](https://lni.wa.gov/forms-publications/F245-414-000_2025.pdf). AZ [ICA fee schedule FAQ](https://www.azica.gov/sites/default/files/migrated_pdf/2015_FS_FAQs_Rev0.pdf), [ODG comment](https://www.azica.gov/sites/default/files/media/PublicComment_00_05102017.pdf). CO [Pinnacol therapy/chiro UR](https://www.Pinnacol.com/provider-news/therapy-and-chiro-utilization-review-program), [CMS on HB 25-1300](https://www.cms.org/a-new-era-for-colorado-physicians-what-the-2028-changes-mean-for-your-practice/), [WC164](https://www.pinnacol.com/knowledge-center/tips-billing-success-signature-requirement-colorado-dowc). MN [WCCA on 5221.6200](https://mn.gov/workcomp-stat/2007/Adamich-12-11-07.html), [departure notice](https://mn.gov/workcomp-stat/2001/May%20-%2006-04-01%20-%20REDACTED.pdf).

**Gaps not closed this session:** the GA chiropractic visit limit (one may exist in Board rules); billing deadlines in FL, PA, IL, OH, GA, MI, AZ and MN; the NY progress-report cadence (15 then 45 days, or 90 days); whether CA chiropractors may issue impairment ratings; the MI chiropractic rules (R 418.10203).

---

## 4. Gap analysis against the app

### 4.1 Current features: universal or Florida-only?

| Current feature | Scope | Comment |
|---|---|---|
| Case type and coverage `workers_comp`; no lien; no balance billing | **Universal** | Correct everywhere researched. Balance billing is barred in all 15 states, but IL lets the provider bill the worker once the claim is finally found non-compensable. Add a "claim denied → convert to health/self-pay" path. |
| `authorized_visits` / `authorized_through` alerts | **Universal** | Useful in every state, especially carrier-directed ones (FL, NJ, NC, GA, CO). Visits should count against a specific authorization record, not the whole case. |
| "Employer's first report on file" (48 h) | **Universal as an office task** | No state requires the *provider* to file it. What states require is the provider's own **initial report**: CA DFR 5021 (5 days), NY C-4 (48 h), TX DWC-73, CO WC164, FL DWC-25 (3 business days), PA LIBC-9 (10 days). That item is missing. |
| "Carrier authorization received" (same day) | Mostly universal | Not needed in states where the worker chooses and no preauth applies (NY within the MTG, IL, PA). |
| Final DWC-25 at MMI (3 days) | **Florida-only** | Generalize to a "final status/MMI report" in the state's form: CA PR-4 (P&S), TX DWC-69, CO WC164 (closing), NY C-4.3 (permanency). |
| DWC-25 per visit (3 days) | **Florida-only and too strict** | Change to: initial ≤3 *business* days, then on change of status or plan, then at MMI. Keep "with each bill" as an optional office policy. |
| 18 visits / 8 weeks chiropractic cap | **Florida-only and probably out of date** | Likely 24 / 12 weeks, with a catastrophic exemption, counted from the first chiropractic DOS. Other states have *different* caps (CA 24 visits with no time limit; NC 20; WA 20 visits or 60 days; MN 12 weeks of passive care; CO 6-session time-to-produce-effect checkpoints). |

### 4.2 Missing for WC

1. **Billing-deadline clock** per date of service (TX 95-day forfeiture, NY 120, CA 12 months). The app already has `bill_days` and `BILL_WARN_DAYS` for PIP, so most of the plumbing exists.
2. **Work status / return-to-work reports** with restrictions (full duty, modified with restrictions, off work), an "until" date, and the state form (DWC-73, MEDCO-14, APF, PR-2, C-4.2, DWC-25, WC164). Include a cadence alert ("PR-2 overdue: last sent 46 days ago").
3. **Preauthorization tracking** as its own record, one per request: service, units, date requested, date of carrier response, deadline (FL 3/10 business days, OH 3 business days), status, and approved visits and dates. A case can have several in sequence; today there is a single pair of fields.
4. **Guideline/cap visit counters** that are state-aware: a count *and* a window from the first chiropractic or passive-care DOS, with exemptions (catastrophic, post-surgical, written authorization).
5. **MMI / impairment rating**: MMI date, rating %, rating guide (FL Uniform Guide, AMA 5th/6th, MN schedule), who rated, and whether a DC may rate in that state (TX needs certification; CO needs Level II).
6. **Contacts:** employer (supervisor, HR, modified-duty availability), carrier adjuster, **nurse case manager**, TPA/MCO (OH), network (TX HCN, CA MPN), and the defense attorney if the claim is litigated.
7. **IME / designated doctor / RME tracking**: exam date, examiner, result, and whether it is binding (TX designated doctor carries presumptive weight).
8. **Claim identifiers:** WC claim number, date of injury, employer, state of jurisdiction (which may differ from the clinic's state), network/MPN ID, and claim status (accepted, denied, pending).
9. **Fee schedule reference** per state and year, for expected-reimbursement estimates and A/R. A WC-paid balance should be written off, never moved to the patient.
10. **Denied-claim workflow:** move to health insurance or a PI lien where the law allows, keeping the date of service and billing-deadline history.

---

## 5. Recommended data model

Add a `wc` block to each entry in `jurisdictions.php`. It should use the same effective-dated `versions` mechanism, with the basis set to **date of injury** for treatment caps and **date of service** for fee schedules and forms. Resolve WC jurisdiction from a `wc_state` on the coverage, not from the auto/PIP case state.

```php
const WC_BASE = [
    'visit_cap'      => null,   // ['visits'=>24,'days'=>84,'from'=>'first_chiro'|'first_passive'|'first_visit','exempt'=>['catastrophic','post_surgical','written_auth']]
    'preauth'        => 'none', // none | all_nonemergency | outside_guidelines | over_cap
    'preauth_reply_bdays' => null,
    'guidelines'     => null,   // MTUS | ODG | NY_MTG | CO_MTG | MN_PARAMS | ACOEM | none
    'initial_report' => null,   // ['form'=>'DFR 5021','days'=>5,'business'=>false]
    'status_report'  => null,   // ['form'=>'PR-2','every_days'=>45,'on_change'=>true]
    'final_report'   => null,   // ['form'=>'DWC-25','days'=>3]
    'bill_days'      => null,   // provider submission deadline from DOS
    'bill_forfeit'   => false,  // late bill = lost (TX)
    'payer_days'     => null,   // carrier must pay/deny within
    'fee_basis'      => null,   // label + edition/effective date
    'provider_choice'=> null,   // carrier_directs | employer_panel | network | worker_choice | employer_first_N_days
    'choice_days'    => null,   // PA 90, MI 28
    'dc_treating'    => true,   // can a DC be treating/attending/PTP
    'dc_rates_ir'    => null,   // true | false | 'certified'
    'balance_billing'=> 'barred',
    'verified'       => false,
];
```

Starting values (only [V]/[S] items should leave `verified=false` → "partially verified"):

| State | visit_cap | preauth | guidelines | initial_report | status_report | bill_days | provider_choice |
|---|---|---|---|---|---|---|---|
| FL | 24 / 84 d, first_chiro, exempt catastrophic & auth | all_nonemergency (3 bd; 10 bd >$1k) | none (statutory) | DWC-25, 3 bd | DWC-25 on change; final at MMI | null (unresolved) | carrier_directs |
| CA | 24 / –, per injury, exempt post-surgical & written auth | outside_guidelines (RFA) | MTUS | DFR 5021, 5 d | PR-2, 45 d + change | 365 | network (MPN) |
| TX | – | outside_guidelines | ODG | DWC-73, initial | DWC-73 on change | 95 (forfeit) | network (HCN) / worker_choice |
| NY | – (MTG ~3-wk reassessment) | outside_guidelines (MG-2) | NY_MTG | C-4, 2 d | C-4.2 at 15 d, then 45 d (verify) | 120 | worker_choice (authorized) |
| PA | – | none | none (UR) | LIBC-9, 10 d [M] | LIBC-9, 30 d [M] | null | employer_panel, 90 d |
| IL | – | none (UR) | ACOEM/ODG via UR | – | – | null | worker_choice (2) |
| OH | – | all (C-9, 3 bd) | none | FROI | MEDCO-14 on change | 365 [M] | worker_choice + MCO |
| GA | – (4 charges/day) | some | none | WC-20 [M] | on change | null | employer_panel |
| NC | 20 / – | over_cap | none | – | on request | 75 [M] | carrier_directs |
| MI | – | some | none | – | – | null | employer_first_N_days, 28 |
| NJ | – | all_nonemergency | none | – | – | null | carrier_directs |
| WA | 20 / 60 d, first_visit | over_cap | none (L&I policy) | ROA | APF on change | 365 [M] | worker_choice (network) |
| AZ | – | outside_guidelines | ODG | Physician's Initial Report | on change | null | worker_choice |
| CO | 6-session TPE checkpoints | outside_guidelines | CO_MTG | WC164, initial | WC164 on change/MMI | 120 [M] | employer designates (worker choice 2028) |
| MN | 12 wk passive, first_passive (+12 visits / 12 mo by departure) | departure notice | MN_PARAMS | – | Work Ability on change | null | worker_choice / certified MCO |

New tables (the WC equivalent of the PIP ledger):

- `wc_authorizations` (case_id, service, visits_approved, from, through, requested_on, responded_on, status, ref_no)
- `wc_reports` (case_id, form, kind = initial | status | final | mmi, dos, sent_on, restrictions_json, work_status, next_due)
- `wc_contacts` (case_id, role = employer | adjuster | ncm | tpa | network | defense_atty, name, phone, email)
- `wc_exams` (case_id, kind = IME | DD | RME | QME, date, examiner, outcome)
- columns on the case or coverage: wc_state, claim_no, employer_id, claim_status, mmi_date, ir_pct, ir_guide, rated_by

---

## 6. Prioritized recommendations

1. **Fix Florida now (small, high-risk):** confirm §440.13(2)(a). If it reads 24 / 12 weeks, update the two constants, start the clock at the first chiropractic DOS, add a `catastrophic` flag that suppresses the alert, and apply the cap *alongside* `authorized_visits` instead of only when it is null. Count the DWC-25 deadline in business days and split it into initial / on-change / MMI. Fix the code comment, which already says "Verify against the current statute."
2. **Billing-deadline clock for WC** using `bill_days` and `bill_forfeit`. The PIP version already exists. Start with TX (95, forfeit), NY (120), CA (365) and FL (null, with the carrier's 45-day payment clock shown for A/R follow-up).
3. **Work-status report tracker** (`wc_reports`) with the state form name and cadence, plus restrictions and work status. This is required in nearly every state and is what adjusters chase.
4. **Authorization records** (`wc_authorizations`) replacing the single pair of fields, with carrier-response deadline alerts.
5. **WC jurisdiction block** in `jurisdictions.php` using the schema above, with `wc_state` resolved separately from the PIP state. Ship FL as "full" and CA/TX/NY as "standard". Mark the rest as "limited" until their [M] values are checked.
6. **Contacts and claim identifiers:** employer, adjuster, nurse case manager, network, and the claim number.
7. **MMI / impairment and IME tracking**, including whether the treating DC may rate in that state.
8. **Fee-schedule references** for expected reimbursement, and a denied-claim conversion workflow.

*Again, this is not legal advice. Any value tagged [M] must be checked against the current statute, rule or fee schedule before it drives an alert.*
