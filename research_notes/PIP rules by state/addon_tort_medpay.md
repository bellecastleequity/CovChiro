# Add-on / Optional PIP States, MedPay in Tort States, Pure-Tort Workflow, PI Statutes of Limitations, and Florida HB 837 — Configuration Fact Sheet for a Chiropractic PI Case-Management App

Research date: 2026-10-22. Method note: direct fetches of state legislature sites (app.leg.wa.gov, statutes.capitol.texas.gov, oregon.public.law, iii.org) were blocked by this session's network proxy, so findings rest on web-search extracts of statute text (Justia, FindLaw, docs.legis.wisconsin.gov, lawfilesext.leg.wa.gov), CMS/MAC pages, and practitioner sources. Items marked **[UNVERIFIED]** come from background knowledge or one secondary source and must be checked against the current statute before they are coded as rules. Every dollar figure and deadline should be stored as a dated, editable config value, not hard-coded.

## Q1. Add-on / optional PIP states: limits, mandatory vs optional, tort effect, deadlines, fee standard, payment, IME, reimbursement/subrogation

### Takeaway
No add-on state restricts the right to sue. The app should treat PIP or MedPay there as a first-party payer that pays first, then run a normal tort/BI claim alongside it. States differ on four things the app has to configure per state: (1) whether coverage is mandatory, offered-and-rejectable, or optional; (2) the medical limit and the time window for expenses; (3) the payment deadline and interest; (4) whether the carrier gets reimbursed from the BI settlement (lien/subrogation) or not (Texas, and probably Maryland, do not). None of these states uses a Florida-style PIP fee schedule. Charges are judged by a "reasonable and necessary" standard.

### Cited Findings

**Delaware (mandatory PIP, add-on).** 21 Del. C. §2118
- Minimum PIP is $15,000 per person and $30,000 per accident, plus $5,000 for funeral expenses. One source says the funeral benefit sits inside the cap, not on top of it. — [Knepper & Stratton](https://knepperstratton.com/delaware-no-fault-pip-car-insurance/delaware-pip-law/); [Hazentech DE](https://hazentech.com/blogs/pip-law-in-delaware/)
- Covers reasonable and necessary expenses incurred within **2 years of the accident**. There is an exception for surgical or dental procedures that a qualified practitioner verifies in writing, within the 2 years, as necessary but not practical to perform within that window. Insurers must tell claimants about the 2-year limit. — [Knepper & Stratton](https://knepperstratton.com/delaware-no-fault-pip-car-insurance/delaware-pip-law/); [DE state-vehicle PIP FAQ](https://dhr.delaware.gov/inscov/documents/pip-faq.pdf)
- **No PIP fee schedule.** Charges are judged as "reasonable and necessary" under §2118(a)(2)a. The workers' comp RBRVS fee schedule (30-day pay rule, 1%/month interest) applies to workers' comp, not PIP. — [Marshall Dennehey (E.S. Thompson)](https://www.marshalldennehey.com/eric-scott-thompson/thought-leadership/evaluating-reasonable-and-necessary-pip-charges-under-delaware-law); [F&P DE WC overview](https://fandpnet.com/wp-content/uploads/2015/12/DE-Workers-Comp-Overview.pdf)
- §2118B covers penalty interest on PIP claims left unpaid past a statutory period. The search snippet cut off before the number of days. The commonly cited rule is pay or deny within 30 days, with interest at 1.5%/month **[UNVERIFIED]**. — [Del. Supreme Court opinion](https://courts.delaware.gov/opinions/download.aspx?ID=196950)
- Disputed benefits can go to optional arbitration administered by the Insurance Commissioner under §2118(j). — [Inkell Firm](https://inkellfirm.com/practice-area/delaware-pip-claims/)
- **Subrogation applies.** The PIP carrier can subrogate up to the tortfeasor's liability limits but ranks behind the injured person. If the injury claim exhausts the limits, the subrogation claim is extinguished. This is usually handled through intercompany arbitration, so the patient's BI settlement normally does not carry a PIP lien. — [F&P DE PIP FAQ](https://www.fandpnet.com/wp-content/uploads/2015/01/DE-PIP-and-UM-UIM-FAQs.pdf); [MWL on DE PIP v. WC](https://www.mwl-law.com/the-confusing-state-of-delaware-pip-vs-workers-compensation-subrogation-amguard-insurance-company-a-s-o-richard-e-cleveland-2023-wl-3789445-del-super-2023/)
- Under §2118(g)(1) the PIP insurer can seek indemnification from a workers' comp insurer. — [MWL](https://www.mwl-law.com/the-confusing-state-of-delaware-pip-vs-workers-compensation-subrogation-amguard-insurance-company-a-s-o-richard-e-cleveland-2023-wl-3789445-del-super-2023/)

**Maryland (PIP must be offered; $2,500 minimum; can be waived).** Md. Code, Ins. §§19-505 to 19-508
- Minimum PIP is $2,500. Full PIP falls under §19-505 and a written waiver under §19-506 (per the MIA/MAIF form). — [MIA MAIF PIP form](https://insurance.maryland.gov/Consumer/Documents/publicnew/MAIF-PIP-Form.pdf); [Chasen Boscolo](https://www.chasenboscolo.com/blog/personal-injury-protection-pip/)
- **Claim deadline:** the PIP application is due within 12 months of the accident (§19-508(a)(2)(i)). — [Miller & Zois](https://www.millerandzois.com/car-accidents/maryland-car-accident-laws-explained/how-pip-insurance-works-pip-claims-in-maryland-overview-of-maryland-pip/maryland-pip-statute-of-limitations-19-508-2022/)
- **Payment:** due within 30 days after the insurer receives satisfactory proof of claim (§19-508(a)(1)). Overdue amounts accrue interest at 1.5% per month (§19-508(c)). The text found is the 2015 version, so check the current version. — [Justia §19-508 (2015)](https://law.justia.com/codes/maryland/2015/article-gin/title-19/subtitle-5/section-19-508); [Miller & Zois](https://www.millerandzois.com/car-accidents/maryland-car-accident-laws-explained/how-pip-insurance-works-pip-claims-in-maryland-overview-of-maryland-pip/maryland-pip-statute-of-limitations-19-508-2022/)
- PIP is payable without regard to fault or other sources (§19-507). The only source for "no subrogation for the insurer" is a secondary blog **[UNVERIFIED]**. — [Hazentech MD](https://hazentech.com/blogs/pip-law-in-maryland/)
- PIP and UM practitioner FAQs — [F&P MD PIP FAQ](https://www.fandpnet.com/wp-content/uploads/2015/01/MD-PIP-and-UM-UIM-FAQs.pdf)

**Oregon (mandatory PIP, add-on).** ORS 742.520–742.544
- PIP medical covers expenses incurred **within 2 years** after the injury, up to **$15,000** in aggregate. Older guides say 1 year, which is outdated. Wage loss is capped at $3,000/month for up to 52 weeks. The 2025 ORS text is on Justia. — [Justia ORS 742.524 (2025)](https://law.justia.com/codes/oregon/volume-18/chapter-742/section-742-524/); [Johnson Law](https://johnsonlaw.com/pip-in-oregon-what-it-pays-what-it-doesn-t-and-when-it-runs-out)
- **Provider-protective presumption:** medical bills are presumed reasonable and necessary unless the insurer sends the provider a denial within **60 calendar days** after receiving notice of the claim. ORS 742.528 requires written denial within 60 days. — [Justia ORS 742.524](https://law.justia.com/codes/oregon/volume-18/chapter-742/section-742-524/); [Johnson Law](https://johnsonlaw.com/pip-in-oregon-what-it-pays-what-it-doesn-t-and-when-it-runs-out)
- An insured must attend an examination under oath (EUO) as a condition of coverage, even though the statute requires prompt payment. — [Williams Kastner](https://www.williamskastner.com/news-insights/article/northwest-insurance-law/oregon-court-holds-that-insured-must-attend-euo-as-condition-precedent-to-coverage-despite-oregon-statute-requiring-prompt-payment-of-pip-benefits/)
- **Reimbursement options:** a PIP lien on the claimant's recovery under ORS 742.536 (the insurer must elect it in writing within 30 days of notice), subrogation under ORS 742.538, or inter-insurer reimbursement/arbitration. Oregon has moved from a "make half" rule to a **made-whole** rule for PIP subrogation. — [MWL Oregon made-whole](https://www.mwl-law.com/oregon-replaces-make-half-rule-with-made-whole-rule-in-pip-subrogation/); [OSB PLF "PIP Basics" (2006)](https://assets.osbplf.org/in_briefs_issues/PIP%20Basics%20May06.pdf)

**Washington (PIP must be offered; rejection must be in writing).** RCW 48.22.085–.100
- Minimum PIP benefits are $10,000 medical and hospital, $2,000 funeral, $10,000 income continuation (capped at $200/week), and $5,000 loss of services (capped at $200/week). — [RCW 48.22.095 PDF](https://lawfilesext.leg.wa.gov/Law/RCWPDF/RCW%20%2048%20%20TITLE/RCW%20%2048%20.%2022%20%20CHAPTER/RCW%20%2048%20.%2022%20.095.pdf)
- Medical expenses must be incurred within **3 years** of the accident. PIP is included automatically unless the named insured (or spouse on a joint policy) rejects it in writing. Higher limits of $35,000 medical are available under RCW 48.22.100. — [Freeman Law Firm](https://freemanlawfirm.org/personal-injury-protection-in-washington-state/); [Adler Giersch](https://www.adlergiersch.com/provider-blog/personal-injury-protection-potential-hidden-benefits-for-your-patients/)
- **Reimbursement from the BI settlement applies, but with fee sharing.** Under *Mahler v. Szucs*, 135 Wn.2d 398 (1998), a PIP insurer seeking reimbursement must pay its pro-rata share of the attorney fees and costs that produced the recovery. *Matsyuk v. State Farm* (2012) extended this to a PIP insurer that also paid the tort settlement. — [Justia Mahler](https://law.justia.com/cases/washington/supreme-court/1998/64344-0-1.html); [NatLawReview](https://natlawreview.com/article/equitable-sharing-rule-requires-pip-insurer-to-pay-pro-rata-fees-even-when-it-also-i); [Davis Rothwell](https://www.davisrothwell.com/2017/04/12/best-practices-in-pip-reimbursement-and-uninsuredunderinsured-motorist-subrogation-claims-washington/)
- No statutory fee schedule was found. Medical review and IME-based denials are governed by WAC 284-30-395 **[UNVERIFIED]**.

**Texas (PIP must be offered; rejection must be in writing).** Tex. Ins. Code ch. 1952, subch. D (§§1952.151–.161)
- Minimum PIP is $2,500. It is included unless the named insured rejects it in writing. A verbal request, an agent's note, or an unchecked box is not a valid rejection. — [Ryan Orsatti Law](https://ryanorsattilaw.com/pip/); [The Texas Attorney](https://www.thetexasattorney.com/blog/personal-injury-protection-insurance-pip/)
- **Payment within 30 days** after the insurer receives proof of claim (§1952.156). Sources disagree on whether the standard is "satisfactory" or "reasonable" proof. The insurer may set a proof-of-loss deadline, but not shorter than 6 months after the accident (per one source). — [Alfred Firm](https://www.alfredfirm.com/blog/who-gets-the-pip-check-in-texas/); [Personal Injury Lawyers Austin](https://personalinjurylawyersaustintx.com/blog/pip-in-texas-everything-you-need-to-know/)
- **No subrogation** (§1952.155): the PIP carrier generally cannot recover against the at-fault driver or that driver's insurer. The statutory exception's exact wording was not confirmed. — [The Texas Attorney](https://www.thetexasattorney.com/blog/personal-injury-protection-insurance-pip/); [Doug Goyen](https://www.douggoyen.com/personal-injury-protection-in-texas-auto-policies-dallas-acciden.html)
- App implication: a Texas PIP payment creates **no lien** on the BI settlement. Payees and who gets the check vary; the PIP check often goes to the insured unless benefits were assigned. — [Alfred Firm](https://www.alfredfirm.com/blog/who-gets-the-pip-check-in-texas/)

**Arkansas (PIP must be offered; can be rejected in writing).** Ark. Code §§23-89-202, -203, -207
- Medical and hospital benefits cover expenses incurred within **24 months** of the accident, up to **$5,000 per person**. The statute also provides an accidental death benefit (the 2010 text shows $5,000). — [Justia §23-89-202 (2010)](https://law.justia.com/codes/arkansas/2010/title-23/subtitle-3/chapter-89/subchapter-2/23-89-202); [FindLaw current §23-89-202](https://codes.findlaw.com/ar/title-23-public-utilities-and-regulated-industries/ar-code-sect-23-89-202.html)
- The named insured may reject coverage in writing (§23-89-203). — [Taylor King Law](https://taylorkinglaw.com/is-arkansas-a-pip-state/)
- **Reimbursement applies.** §23-89-207 gives the paying insurer a right of reimbursement and credit from the tort recovery, less the costs of collection, plus a lien on that recovery. *Ryder v. State Farm* (2007) treated this as a subrogation right, and a 2013 decision said PIP/MedPay subrogation may be pursued even when §23-89-207's criteria are not met. The made-whole doctrine may apply. — [Justia §23-89-207](https://law.justia.com/codes/arkansas/title-23/subtitle-3/chapter-89/subchapter-2/section-23-89-207/); [MWL AR Supreme Court](https://www.mwl-law.com/arkansas-supreme-court-confirms-pipmed-pay-subrogation-rights/); [MWL MedPay/PIP subro chart (1/13/22)](https://www.mwl-law.com/wp-content/uploads/2018/02/MED-PAY-PIP-SUBRO-CHART.pdf)

**District of Columbia (choice no-fault: an election made after the accident).** D.C. Code §31-2401 et seq.
- An insured who carries PIP has **60 days after the accident** to elect no-fault benefits; the insurer must be notified (§31-2405(a)). If no election is made, the insured is deemed to have chosen a claim against the at-fault driver's liability coverage. The window can be extended by mutual written agreement (§31-2405(e)). — [Nolo DC](https://www.nolo.com/legal-encyclopedia/washington-d-c-personal-injury-laws-and-liability-rules.html); [Marks & Harrison](https://www.marksandharrison.com/points-of-law/understanding-personal-injury-protection-insurance-under-d-c-s-compulsory-no-fault-motor-vehicle-insurance-law/)
- Reported minimums are $50,000 medical/rehab, $12,000 work loss, and $4,000 funeral, with a $100,000 option that must be offered. These came from one secondary source and need DISB verification. — [Marks & Harrison](https://www.marksandharrison.com/points-of-law/understanding-personal-injury-protection-insurance-under-d-c-s-compulsory-no-fault-motor-vehicle-insurance-law/)
- After electing PIP, the person can sue only if medical bills exceed PIP limits or the injury involves substantial permanent scarring/disfigurement or a qualifying impairment. — [Nolo DC](https://www.nolo.com/legal-encyclopedia/washington-d-c-personal-injury-laws-and-liability-rules.html)
- PIP and MedPay subrogation in the DC area — [Bilton Law](https://www.biltonlaw.com/pip-and-medpay-subrogation-in-the-washington-dc-area/)

**Virginia (pure tort; MedPay, called "medical expense benefits," must be offered).** Va. Code §38.2-2201
- MedPay is optional, but insurers must notify policyholders of it in writing. The minimum is $2,000 if requested, and higher limits are available. Coverage can stack across up to 4 vehicles. — [Hale & Shaw / hsinjurylaw](https://www.hsinjurylaw.com/library/medical-payments-through-car-insurance-policies-in-virginia.cfm); [C. Pollard Law](https://cpollardlaw.com/car-accident-lawyer-in-virginia/what-is-medical-payments-coverage-medpay-in-virginia-car-insurance-policies/)
- Va. Code §38.2-2209 is read to **bar MedPay subrogation** against the third-party liability insurer. Virginia appears on anti-subrogation lists. — [Bilton Law](https://www.biltonlaw.com/pip-and-medpay-subrogation-in-the-washington-dc-area/); [Weltman](https://www.weltman.com/publication-know-your-subrogation-rights-with-medpay-and-pip)

**Wisconsin (tort; MedPay required but can be rejected).** Wis. Stat. §632.32(4)
- Policies must include MedPay of at least **$1,000 per person**. The named insured may reject it, and after a rejection renewals need not include it unless requested in writing. MedPay may be written as excess over other sources of reimbursement. — [Wis. Stat. 632.32](https://docs.legis.wisconsin.gov/document/statutes/632.32?view=section); [632.32(4)](https://docs.legis.wisconsin.gov/statutes/statutes/632/iv/32/4)

**New Hampshire (tort; insurance not compulsory).** Sources say policies that are bought must carry $1,000 MedPay. One source conflicts because NH does not require auto insurance at all. — [Experian](https://www.experian.com/blogs/ask-experian/what-is-medical-payments-coverage-car-insurance/); [Turn & Turn](https://www.turnandturn.com/medical-payments-coverage-claim/); conflicting framing in [Yahoo Finance](https://finance.yahoo.com/personal-finance/insurance/article/medical-payments-181121115.html)

**South Dakota.** Search returned no usable source. See Gaps.

### Inferences
- Suggested app data model per state: `pip_status` (mandatory | offer_reject_in_writing | optional | election_post_accident | medpay_only), `med_limit_min`, `expense_window` (DE 2y, OR 2y, WA 3y, AR 24 mo), `claim_notice_deadline` (MD 12 mo, DC 60-day election, TX proof-of-loss ≥ 6 mo), `pay_deadline_days` (MD 30, TX 30, OR 60-day denial presumption, DE §2118B), `late_interest`, `fee_standard` = "reasonable & necessary" (no fee schedule in any of these states), `reimbursement_mode` (none: TX, likely MD, VA MedPay; lien/subrogation: AR, OR, WA with Mahler pro-rata fee reduction; intercompany only: DE), `tort_restriction` = none, except DC after a PIP election.
- Do not reuse Florida PIP logic that assumes a 14-day initial-treatment rule, EMC determination, $10k cap, or a fee schedule at 200% of Medicare. None of these add-on states has those features.
- For the clinic, Oregon's 60-day presumption is the most important provider deadline. Set a task to flag any Oregon PIP bill with no written denial by day 60.

### Gaps
- Exact current text of Del. §2118B (days and interest rate), Tex. Ins. Code §1952.155 exception wording and any liability-offset provision, Md. §19-507/19-513 subrogation and offset rules, ORS 742.524 interest and IME provisions, and WAC 284-30-395. Primary sites were blocked by the session proxy.
- South Dakota MedPay rules (believed to be optional MedPay with no PIP mandate), Kentucky (choice no-fault, $10k PIP, written tort rejection under KRS 304.39-060), Pennsylvania and New Jersey (choice/verbal threshold), and Minnesota/Utah/Hawaii were not covered here because they are true no-fault or choice states. They may belong to another researcher's scope.
- Whether DC's $50k/$12k/$4k figures are current was not confirmed with DISB.

## Q2. MedPay in tort states: limits, billing (direct vs patient), subrogation

### Takeaway
MedPay is first-party, no-fault medical coverage, usually sold in $1k–$10k increments, and pays regardless of fault. Whether the carrier can recover it from the BI settlement depends on the state: a large group of states bars or limits subrogation, while others allow it subject to made-whole rules or policy language. The app needs a per-state flag for MedPay subrogation and should record whether the patient signed an assignment of benefits, which lets the clinic be paid directly.

### Cited Findings
- States generally **not allowing** MedPay/PIP subrogation (with exceptions): AZ, CT, GA, KS, MO, NY, NJ, NC, VA. Other states reach a similar result through other doctrines. — [Weltman](https://www.weltman.com/publication-know-your-subrogation-rights-with-medpay-and-pip)
- Some states, such as LA and ND for certain coverages, limit or bar MedPay subrogation by statute. Some MedPay policies waive subrogation outright. — [LienScripts](https://lienscripts.com/blog/medpay-medications-car-accident)
- The made-whole doctrine varies by state (AK and FL apply it in some form; OH's version affects MedPay), and clear policy language can often override it. — [Weltman](https://www.weltman.com/publication-know-your-subrogation-rights-with-medpay-and-pip); [The Art of Adjusting](https://www.theartofadjusting.com/med-pay-made-whole)
- California is described as one of the least insurer-friendly states for MedPay subrogation when there is no BI claim. — [Rathbone Group](https://www.rathbonegroup.com/medpay-pip-subrogation-rights-without-a-bodily-injury-claim/)
- A full 50-state MedPay/PIP subrogation chart (last updated 1/13/22) is a useful source for seeding config. — [MWL chart](https://www.mwl-law.com/wp-content/uploads/2018/02/MED-PAY-PIP-SUBRO-CHART.pdf)
- Arkansas MedPay/PIP: a statutory lien under §23-89-207. — [Justia](https://law.justia.com/codes/arkansas/title-23/subtitle-3/chapter-89/subchapter-2/section-23-89-207/)
- Arizona's lien law states that provider liens **do not attach** to the patient's own auto MedPay. — [Phoenix AZ Injury Law](https://www.phoenixazinjurylaw.com/arizonas-new-lien-law-for-personal-injury-cases)
- Wisconsin MedPay is a $1,000 minimum that can be rejected and may be written as excess. — [Wis. Stat. 632.32](https://docs.legis.wisconsin.gov/document/statutes/632.32?view=section)
- Virginia MedPay is a $2,000 minimum offer and is anti-subrogation under §38.2-2209 (per one firm). — [hsinjurylaw](https://www.hsinjurylaw.com/library/medical-payments-through-car-insurance-policies-in-virginia.cfm); [Bilton Law](https://www.biltonlaw.com/pip-and-medpay-subrogation-in-the-washington-dc-area/)

### Inferences
- Billing: MedPay carriers generally pay either the insured or the provider. The provider is paid directly when the patient signs an assignment of benefits or direction-to-pay and the carrier honors it. The app should capture the AOB, MedPay claim number, adjuster, limit, and remaining balance, and should post MedPay payments against the PI ledger. (No source found that states a uniform rule; this is general industry practice.)
- Typical limits of $1k, $2k, $5k, and $10k match the figures in the WI and VA statutes and in the cited consumer guides. Treat the limit as data the user enters for each claim.
- If MedPay is subrogable in the state, the app should add a "MedPay reimbursement claim" line to the settlement disbursement worksheet. If not, it should suppress that line.

### Gaps
- No authoritative, current 50-state MedPay subrogation table was fetched in full. The MWL chart (2022) should be pulled and verified.
- No source states whether any state requires MedPay carriers to pay providers directly.

## Q3. Pure-tort workflow: LOP/lien, health insurance and balance billing, Medicare/Medicaid MSP, BI timeline

### Takeaway
In tort states the clinic either (a) bills the patient's health plan (and is then bound by network contracts and usually cannot balance-bill or pursue the settlement for more than the contracted rate), (b) treats on a letter of protection or lien and is paid from the BI settlement, or (c) bills MedPay. With Medicare patients the clinic must choose: bill Medicare, or pursue the liability insurer or a lien. Medicare does not allow both. If the clinic bills the liability claim and nothing is paid within 120 days, it may then withdraw the claim or lien and bill Medicare conditionally.

### Cited Findings
- **Medicare no-fault/MedPay:** Medicare may make a conditional payment if the no-fault insurer has not paid within **120 days** of receiving the claim. — [CGS MSP Ch. 11](https://www.cgsmedicare.com/jc/pubs/pdf/chpt11.pdf); [FCSO](https://medicare.fcso.com/billing/requesting-medicare-secondary-payer-conditional-payments)
- **Medicare liability:** a provider may bill Medicare if liability has not paid within 120 days after the earlier of (a) the date a liability claim or lien was filed or (b) the date of service. Before billing Medicare conditionally, the provider must **withdraw all claims and liens** against the liability insurer and the beneficiary's settlement. A provider that keeps pursuing the liability insurer may not bill Medicare. — [Palmetto GBA](https://files.palmettogba.com/palmetto/jja.nsf/DIDC/Y7I6RKN7HP~Medicare%20Secondary%20Payer%20(MSP)); [Noridian Q&A](https://med.noridianmedicare.com/web/jeb/topics/msp/educational-series-qa); [CMS transmittal R87MSP](https://www.cms.gov/Regulations-and-Guidance/Guidance/Transmittals/Downloads/R87MSP.pdf)
- Conditional payments must be repaid when a settlement, judgment, or award is obtained. The CMS attorney-services portal explains how conditional payment letters work. — [CMS Conditional Payment Information](https://www.cms.gov/medicare/coordination-benefits-recovery/attorney-services/conditional-payment-information); [Novitas](https://www.novitas-solutions.com/webcenter/portal/MedicareJL/pagebyid?contentId=00144708); [CRS RL33587](https://www.congress.gov/crs-product/RL33587)
- **Balance billing:** about 21 states regulate balance billing. CA, CT, FL, IL, MD, and NY are described as banning it altogether, and others offer partial protection. Network contracts generally prohibit providers from balance-billing members. — [BBG](https://www.bbgbroker.com/in-what-states-is-balance-billing-illegal/); [FSU Law Review note on provider liens](https://www.fsulawreview.com/wp-content/uploads/2022/08/HEALTHCARE-PROVIDER-LIENS.pdf)
- Texas bans balance billing for emergency care and for in-network facility care when the patient had no choice of provider. — [TDI](https://www.tdi.texas.gov/medical-billing/providers.html). Virginia bans out-of-network emergency balance billing. — [Va. Code §38.2-3445.01](https://law.lis.virginia.gov/vacode/title38.2/chapter34/section38.2-3445.01/). The federal No Surprises Act covers emergency care and some non-emergency care at in-network facilities. — [CMS NSA training](https://www.cms.gov/files/document/a274577-1a-training-1-balancing-billingfinal508.pdf)
- Under Arizona's lien law, a lien can reach a balance only where the managed-care contract specifically authorizes balance billing, and one-third of any third-party recovery is exempt from liens in those cases. — [Phoenix AZ Injury Law](https://www.phoenixazinjurylaw.com/arizonas-new-lien-law-for-personal-injury-cases)
- Collateral source rule and treatment of insurance write-offs, by state — [MWL chart (2/14/22)](https://www.mwl-law.com/wp-content/uploads/2018/02/MEDICAL-EXPENSES-INSURANCE-WRITE-OFFS-COLLATERAL-SOURCE-RULE.pdf)

### Inferences
- Suggested case "funding path" field: `health_plan` | `LOP/lien` | `MedPay` | `PIP` | `Medicare` | `Medicaid` | `self-pay`. Validation rules:
  - If `Medicare` and `LOP/lien` are both active, warn the user (MSP "choose one" rule) and start a 120-day timer from the earlier of claim/lien filing or the date of service.
  - If the patient is in network and the plan was billed, block any LOP balance above the contracted amount unless the state and the contract allow it. Store a state flag for "provider may pursue settlement for full charges after billing health plan."
  - For Medicaid patients, providers that accept Medicaid generally must accept it as payment in full. The state Medicaid agency has its own lien/recovery right. **[UNVERIFIED in this session]**
- Typical BI timeline to model: notice of claim to the at-fault carrier → liability decision (often 30–45 days, varies by state's unfair-claims rules) → treatment complete / MMI → demand package with bills and records → negotiation → settlement or suit before the SOL → disbursement (attorney fees, liens, MedPay/PIP reimbursement where allowed, Medicare final demand). These stages are general practice; no single statute governs them.

### Gaps
- No source fetched on state-specific Medicaid lien statutes or the federal "anti-lien" limits (Ahlborn/Gallardo) for this note.
- No 50-state table of whether providers may bypass health insurance and pursue the liability carrier (e.g., hospital lien statutes). This is highly state-specific.

## Q4. Personal-injury statute of limitations, all 50 states + DC

### Takeaway
Most states use 2 years. Others use 3, a few use 4–6, and Kentucky and Tennessee use 1. Louisiana changed from 1 to 2 years for injuries on or after July 1, 2024. Florida changed from 4 to 2 years for negligence causes of action accruing after March 24, 2023. The app must store the SOL with an effective-date rule (based on accident date) and show each value as "verify."

### Cited Findings
- Louisiana: Act 423 (HB 315, 2024) set a 2-year period (new Civ. Code art. 3493.1) for delictual actions arising on or after 7/1/2024. Earlier injuries keep the 1-year period. Some 2026 charts still wrongly show 1 year. — [Gordon McKernan](https://www.getgordon.com/blog/louisianas-new-statute-of-limitations/); [LimitationCalc 2026](https://limitationcalc.com/blog/personal-injury-statute-of-limitations-by-state)
- Florida negligence SOL: 2 years under §95.11(5)(a), renumbered from (4)(a) in 2024, for causes of action accruing after 3/24/2023. — [SinglePoint](https://singlepointlaw.com/florida-hb-837-tort-reform/); [Florida Court Rules](https://floridacourtrules.com/florida-car-accident/)
- Two years is the most common period, and KY and TN remain at 1 year. — [Miller & Zois 50-state](https://www.millerandzois.com/maryland-injury-victim-help-center/statute-limitations-personal-injury/); [Perkins](https://www.800perkins.com/insights/statute-of-limitations-by-state/); [1-800-LionLaw (2025)](https://1800lionlaw.com/personal-injury-statute-of-limitations-by-state/)

**Table: general negligence/PI SOL (adult claimant, against a private defendant).** Seeded from the aggregator charts above ([Miller & Zois](https://www.millerandzois.com/maryland-injury-victim-help-center/statute-limitations-personal-injury/), [LimitationCalc](https://limitationcalc.com/blog/personal-injury-statute-of-limitations-by-state), [Perkins](https://www.800perkins.com/insights/statute-of-limitations-by-state/)) and background knowledge. Individual entries were **not** checked against each state's code in this session. Mark all as "verify before go-live." Claims against government defendants often have notice deadlines of 30–180 days, which the app should model separately.

| State | Yrs | Note |
|---|---|---|
| AL | 2 | |
| AK | 2 | |
| AZ | 2 | |
| AR | 3 | |
| CA | 2 | |
| CO | 2 | 3 yrs for motor-vehicle negligence (C.R.S. 13-80-101(1)(n)) [UNVERIFIED] |
| CT | 2 | |
| DE | 2 | |
| DC | 3 | |
| FL | 2 | 4 yrs if accrued on or before 3/24/2023 |
| GA | 2 | |
| HI | 2 | |
| ID | 2 | |
| IL | 2 | |
| IN | 2 | |
| IA | 2 | |
| KS | 2 | |
| KY | 1 | MVA: 2 yrs from injury or last PIP payment under KRS 304.39-230(6) [UNVERIFIED] |
| LA | 2 | 1 yr for injuries before 7/1/2024 |
| ME | 6 | |
| MD | 3 | |
| MA | 3 | |
| MI | 3 | no-fault PIP benefits have separate 1-yr notice/1-yr-back rules |
| MN | 6 | general negligence [UNVERIFIED] |
| MS | 3 | |
| MO | 5 | |
| MT | 3 | |
| NE | 4 | |
| NV | 2 | |
| NH | 3 | |
| NJ | 2 | |
| NM | 3 | |
| NY | 3 | |
| NC | 3 | |
| ND | 6 | |
| OH | 2 | |
| OK | 2 | |
| OR | 2 | |
| PA | 2 | |
| RI | 3 | |
| SC | 3 | |
| SD | 3 | |
| TN | 1 | 2 yrs if the driver was cited/charged for certain offenses (T.C.A. 28-3-104(a)(2)) [UNVERIFIED] |
| TX | 2 | |
| UT | 4 | |
| VT | 3 | |
| VA | 2 | |
| WA | 3 | |
| WV | 2 | |
| WI | 3 | |
| WY | 4 | |

### Inferences
- Store the SOL as `{state, years, effective_from, effective_to, basis: accrual_date}` so that FL (3/24/2023) and LA (7/1/2024) resolve correctly by accident date.
- Add separate config for minors' tolling, government-claim notice periods, and PIP/MedPay contract limitation periods (e.g., MD's 12-month PIP application).

### Gaps
- The per-state entries other than FL, LA, KY, and TN were not verified against primary code text in this session. The aggregator charts disagree in places, notably on LA.

## Q5. Florida HB 837 (2023): medical-damages changes relevant to a Florida PI/chiro app

### Takeaway
HB 837 (ch. 2023-15, Laws of Fla., effective 3/24/2023) changed four things a Florida PI app needs to handle. It shortened the negligence SOL to 2 years. It adopted modified comparative fault, which bars recovery for a plaintiff more than 50% at fault (medical malpractice excluded). It created §768.0427, which limits medical-damages evidence to amounts actually paid, or to what insurance, Medicare, or Medicaid would pay for unpaid bills. And it requires broad disclosure of letters of protection. The app should capture LOP documents, CPT/ICD-coded itemized bills, factoring sales, health-coverage status, and attorney-referral facts for every Florida LOP case.

### Cited Findings
- Modified comparative negligence under §768.81(6): a party more than 50% at fault for their own harm recovers nothing. Chapter 766 medical-negligence claims keep pure comparative fault. — [J. Gorman Law](https://www.jgormanlaw.com/statutes/florida-comparative-negligence-statute); [Greenberg Traurig](https://www.gtlaw.com/en/insights/2023/4/tort-reform-overhauls-floridas-litigation-landscape)
- Negligence SOL went from 4 to 2 years (§95.11, now (5)(a)). One source applies it to causes of action accruing after 3/24/2023. Another says the comparative-fault change applies to cases *filed* after 3/24/2023. — [SinglePoint](https://singlepointlaw.com/florida-hb-837-tort-reform/); [LegalClarity](https://legalclarity.org/floridas-hb-837-tort-reform-key-changes-to-know/)
- §768.0427: evidence of past paid medical bills is limited to the amount actually paid, regardless of source. The billed amount is not admissible for paid bills. — [Chalik & Chalik](https://www.chaliklaw.com/blog/can-a-miami-injury-victim-still-use-a-letter-of-protection-after-tort-reform/); [Florida House staff analysis CS/CS/HB 837](https://flsenate.gov/Session/Bill/2023/837/Analyses/h0837c.JDC.PDF)
- §768.0427(1)(d) defines an LOP as any arrangement in which a provider treats in exchange for a promise of payment from a judgment or settlement. LOPs must be disclosed, and the LOP arrangement can be examined at trial. — [Chalik & Chalik](https://www.chaliklaw.com/blog/can-a-miami-injury-victim-still-use-a-letter-of-protection-after-tort-reform/); [Schrier Law Group](https://www.schrierlawgroup.com/florida-2023-tort-reform-hb837-premises-liability/)
- Details of the unpaid-bill and disclosure rules come from background knowledge, are consistent with the [House staff analysis](https://flsenate.gov/Session/Bill/2023/837/Analyses/h0837c.JDC.PDF), and are **[UNVERIFIED in this session; confirm against §768.0427 text]**:
  - Unpaid bills, patient has private health coverage: the evidence is the amount that coverage is obligated to pay. This also applies when the patient has coverage but treated under an LOP or did not submit the bills to the plan.
  - Unpaid bills, patient has no coverage or has Medicare/Medicaid: the evidence is 120% of the Medicare rate, or 170% of the Medicaid rate if there is no Medicare rate.
  - Bills sold to a factoring company: the amount the factor paid is admissible.
  - LOP disclosures required as a condition of asserting medical damages: a copy of the LOP; all itemized, CPT/ICD-coded bills; if the receivable was sold, the factoring company's name and the price paid; whether the claimant had health coverage at the time of treatment and its identity; and whether an attorney referred the claimant to the provider, with the referral relationship disclosed if so.
  - Future medical damages follow similar coverage-based evidence rules.
- HB 837 also changed bad-faith law (insurer safe harbor) and attorney fee rules (repealed one-way fees under §627.428). — [Greenberg Traurig](https://www.gtlaw.com/en/insights/2023/4/tort-reform-overhauls-floridas-litigation-landscape)

### Inferences
- For Florida LOP cases the app should capture: health-coverage status at each date of service, the payer the patient *could* have used, whether bills were submitted to that payer, factoring sale price, a referral-source attestation, and CPT/ICD-coded itemization exportable as a disclosure packet.
- The app could add a "projected admissible value" calculator (paid, plan-allowed, 120% Medicare, or 170% Medicaid) to estimate what the lien will be worth under §768.0427. Clinics in other states may still be able to blackboard full billed charges, depending on the collateral-source rule (see the MWL write-off chart above).
- These Florida-specific evidence rules should be scoped to `state = FL` and not applied to add-on or tort states.

### Gaps
- The full §768.0427 statutory text was not fetched in this session. The bullets marked [UNVERIFIED] should be verified against Fla. Stat. §768.0427 (2025) on leg.state.fl.us before they drive app logic.
- Florida legislative activity after 2023 on LOPs or §768.0427 (e.g., 2025–2026 bills) was not checked.
