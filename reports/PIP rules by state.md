# Keep the workflow, move the rules into data

InjuryCase's clinical workflow will work in any state, but its money and deadline logic will not. Referrals, re-exams, gap-in-care outreach, the huddle, audits, outcome assessments, attorney status letters and the policy-limits warning describe how a chiropractic PI case runs anywhere. Nearly every number in `pi_portal/app/pi_rules.php` is Florida law. That includes the $10,000 PIP limit, the $2,500 non-EMC cap, the 14-day initial-care rule, the 80% insurer share with the 20% moved to the patient, and the permanency-based tort threshold. Outside Florida the rules vary widely. Medical PIP runs from **$3,000 in Utah** to a **$250,000 default in New Jersey** and an unlimited tier in Michigan. Fee bases range from "reasonable charges" (Kansas, Utah, Minnesota, Massachusetts and every add-on state found) to **110% of Medicare in Pennsylvania**, **190% in Michigan** and workers'-comp schedules in New York, Hawaii and post-2026 Kentucky. At least five states (NY, NJ, PA, post-reform KY, and MN under e-billing) bar billing the patient above what PIP allows. That breaks Florida-style patient-balance forwarding and full-charge letters of protection. The fix is an **effective-dated rule table** keyed by state and by the date that controls each rule (accident, service, or policy issue/renewal), with a source and a verification status on every row. Roll out first to the states closest to Florida's structure (Kansas, Utah, Minnesota, North Dakota and the add-on/MedPay states). Then do the middle tier (Massachusetts, Kentucky, Pennsylvania, Hawaii, and the tort states with chiropractor lien statutes). Leave New York, New Jersey and Michigan for last. The research also found Florida gaps in the current app: no 35-day billing clock, no pre-suit demand-letter clock, and no capture of the 2023 letter-of-protection disclosure facts.

*Not legal advice. The researchers could not open official statute sites (the network proxy blocked them). Every figure below comes from search-engine extracts of statutes and from secondary sources such as law firms and billing vendors. Treat every number and deadline as a **draft configuration value**. A licensed attorney in the state should check it against the current official text before it drives app logic. Figures marked **†** are unconfirmed or conflicting. Figures marked **‡** are date-sensitive: recently changed, pending, or updated each year.*

## Florida's model is one of four regimes, and Florida itself needs fixes

US auto-injury systems fall into four groups, and the app has to recognize which one a case is in before applying any rule.

**True no-fault states** pay medical bills through the patient's own PIP and limit pain-and-suffering suits by a threshold. The states researched are FL, NY, MI, MN, ND, MA, HI, KS and UT. **"Choice" states** let the insured pick the tort limitation: NJ (Limitation on Lawsuit), PA (limited vs full tort) and KY (written rejection of the tort limitation). **Add-on states** require or offer PIP but leave the right to sue untouched: DE, OR, MD, WA, TX and AR. DC lets the insured elect PIP after the accident. Finally, **tort states** offer only optional MedPay ($1,000–$10,000 is typical) and fund care through health insurance, statutory provider liens, or contractual letters of protection ([Weltman](https://www.weltman.com/publication-know-your-subrogation-rights-with-medpay-and-pip); [Wis. Stat. 632.32](https://docs.legis.wisconsin.gov/document/statutes/632.32?view=section)).

The Florida baseline holds up, with corrections. **No-fault was not repealed.** 2026's SB 522 and HB 769 died in committee on 13 March 2026, and the "repealed July 1, 2026" rumor traces to the withdrawn 2025 HB 1181. Repeal bills will likely return in the 2027 session ‡ ([Claims Journal, May 2026](https://www.claimsjournal.com/news/national/2026/05/06/337365.htm); [hov.law](https://www.hov.law/learn/did-florida-repeal-pip-2026)). The research flags several gaps against the current code:

- **No billing clock.** Providers must submit bills within **35 days of service**, and the app has no such clock. Its nearest constant is a 45-day insurance follow-up ([Transcure](https://transcure.net/medical-billing/florida-laws-pip/)).
- **No demand-letter workflow.** A §627.736(10) demand letter is a condition precedent to suit. It may only be sent once a claim is overdue and starts a **30-day cure period** ([flsenate.gov 627.736](https://www.flsenate.gov/laws/statutes/2024/627.736)).
- **The fee schedule has wrinkles the code does not model.** Florida's schedule is 80% of 200% of Medicare Part B, using the schedule in effect on **March 1 of the year of service**. The amount can never fall below the **2007** schedule, which a 2021 Third DCA ruling read as the non-facility limiting charge. The insurer may apply the limit only if the policy gave notice of it ([flsenate.gov 627.736](https://www.flsenate.gov/Laws/statutes/2024/627.736); [Conroy Simberg](https://www.conroysimberg.com/blog/april-28-2021-third-district-court-of-appeal-issues-important-ruling-on-determining-the-proper-medicare-fee-schedule-for-purpose-of-pip-reimbursement/)).
- **The EMC determiner is not validated.** Only an MD, DO, dentist, PA or APRN may make an EMC determination, never a chiropractor. One appellate ruling treats "no determination yet" as a $2,500 cap, which matches the app's `pending` handling ([Furmanski Law Group](https://furmanskilawgroup.com/what-is-an-emergency-medical-condition-under-floridas-pip-law/); [Dolman Law](https://www.dolmanlaw.com/blog/new-personal-injury-protection-pip-ruling-emergency-medical-condition-effects-medical-practice/)).
- **Letter-of-protection cases are missing the facts HB 837 requires.** Since 2023, §768.0427 requires disclosure of the LOP itself, CPT/ICD-coded itemized bills, any sale of the receivable to a factoring company and its price, the patient's health coverage, and whether an attorney referred the patient. Paid bills are admissible only at the amount actually paid ([flsenate.gov 768.0427](https://www.flsenate.gov/Laws/Statutes/2023/768.0427)).
- **The negligence limitations period changed.** It is now **2 years** for claims accruing after 24 March 2023, down from 4 ([SinglePoint](https://singlepointlaw.com/florida-hb-837-tort-reform/)).

Two Florida assumptions are still unconfirmed and should be checked before anything is generalized: the insurer's 30-day pay rule, and whether moving the 20% copay to the patient complies with the balance-billing limits of §627.736(5) †.

## State-by-state comparison: twelve no-fault and choice states

The first table covers benefits, clocks, fee basis and insurer controls. The second covers the tort threshold, balance billing and liens. "Pay/interest" means when benefits become overdue and the interest that then accrues.

### Benefits, deadlines, fee basis, utilization controls

| State | PIP / medical limit; mandatory? | Treatment, notice and billing deadlines; pay/interest | Fee schedule basis | Utilization review / IME / precert |
|---|---|---|---|---|
| **FL** | $10,000; $2,500 without a positive EMC; mandatory ([Graham & Syfert](https://www.grahamsyfert.com/florida-statutes/section-627-736.html)) | Initial care within 14 days; bills within 35 days of service; demand letter, then 30-day cure ([Transcure](https://transcure.net/medical-billing/florida-laws-pip/); [flsenate](https://www.flsenate.gov/laws/statutes/2024/627.736)); pay/interest text not retrieved † | 80% × 200% Medicare Part B (March-1 schedule, 2007 floor) ‡ annually | Insurer records requests under §627.736(6)(b) ([LegalGiant](https://legalgiant.co/what-is-a-627-7366b-request-in-florida/)); IME rules not retrieved † |
| **NY** | $50,000 basic economic loss, one pool shared with lost wages and other expenses; optional add-on coverage; mandatory; no copay ([DFS OGC 08-07-28](https://www.dfs.ny.gov/insurance/ogco2008/rg080728.htm)) | Accident notice 30 days; bills **45 days** from service † ([Reg 68](https://www.dfs.ny.gov/system/files/documents/2024/08/reg68_11_nycrr_65_full_txt.pdf)); insurer must request verification within 15 business days; claimant has 120 days to respond; pay/deny in 30 days; **2%/month** interest, which stops if no arbitration or suit is filed within 30 days of a denial ([LII 65-3.5](https://www.law.cornell.edu/regulations/new-york/11-NYCRR-65-3.5); [LII 65-3.9](https://www.law.cornell.edu/regulations/new-york/11-NYCRR-65-3.9)) | 100% of NY workers' comp chiropractic schedule (2020 pages); **12 RVU/day cap across all providers** (15/18 on evaluation days) ([TonaLaw](https://tonalaw.com/wcb-2024-fee-schedule/)); new edition proposed, effective date TBD ‡ ([WCB](https://www.wcb.ny.gov/content/main/regulations/revised/revised-med-fee-2026-08/)) | No precert. IMEs, EUOs and peer review; NF-10 denial form (Rev. 6/2026) ‡ ([DFS NF-10](https://www.dfs.ny.gov/system/files/documents/2026/09/nf-10_202606.pdf)); AAA arbitration ([DFS](https://www.dfs.ny.gov/complaints/file_no_fault_arbitration)) |
| **NJ** | Standard policy defaults to $250,000; insured may elect $150k/$75k/$50k/$15k; Basic policy $15k; health insurance may be made primary ([S3142 quoting 39:6A-4.3](https://pub.njleg.state.nj.us/Bills/2026/S3500/3142_T1.PDF)); deductible ≥ $250 plus a 20% copay from the deductible to $5,000 ([GEICO NJ guide](https://www.geico.com/public/pdf/statepages/NJBuyersGuide-m592.pdf)) | Clocks come from each carrier's Decision Point Review (DPR) plan; carrier late-information penalties of 25%/50% ([Enlyte plan](https://www.enlyte.com/media/50791)); arbitration awards paid within 45 days ([LII 11:3-5.6](https://www.law.cornell.edu/regulations/new-jersey/N-J-A-C-11-3-5-6)); statutory notice and pay days not confirmed † | N.J.A.C. 11:3-29 PIP schedule (last updated 2013) with a daily physical-medicine cap; DOBI's Oct 2026 advance notice proposes a weekly cap ‡ ([Brach Eichler](https://www.bracheichler.com/insights/dobi-proposes-weekly-cap-on-new-jersey-pip-rehab-fees/)) | **Care Paths plus DPR** for neck/back soft-tissue injuries; precert for other care; mandatory APTP form; **up to 50% penalty copay** for skipping DPR or precert ([N.J.A.C. 11:3-4](https://www.nj.gov/dobi/pipinfo/njac11_3_4_effect130104.pdf)); internal appeal, then Forthright arbitration ([rules](https://www.nj-no-fault.com/process)) |
| **PA** | $5,000 minimum first-party medical; optional tiers (commonly $10k–$100k †); mandatory ([Leeson Law](https://www.leeson-law.com/limited-tort-vs-full-tort-pennsylvania/)) | Pay within 30 days of reasonable proof; **12%/yr** interest (§1716) ([Margolis Edelstein](https://www.margolisedelstein.com/wp-content/uploads/2022/06/PA-MVFRL-2024.pdf)) | **110% of Medicare** (Act 6). The cap also applies to bodily-injury (BI) and uninsured/underinsured motorist (UM/UIM) claims ([31 Pa. Code ch. 69](https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/031/chapter69/subchapAtoc.html&d=reduce)) | Peer Review Organization (PRO): insurer refers within 90 days of documentation; PRO decides within 30 days (+20-day toll); reconsideration within 30 days ([LII 69.52](https://www.law.cornell.edu/regulations/pennsylvania/31-Pa-Code-SS-69-52)) |
| **MI** | Tiers for policies issued or renewed after 7/1/2020: unlimited, $500k, $250k, $250k with exclusions, $50k (Medicaid), opt-out; assigned-claims cases capped at $250k ([Michigan Auto Law](https://www.michiganautolaw.com/no-fault/no-fault-act/pip-medical-benefits-coverage/)) | 1-year notice and 1-year-back rule, tolled from claim to formal denial for post-6/11/2019 claims ([Garan Lucow](https://www.garanlucow.com/publication/no-fault-reform-series-3145/)); 30 days, then 12% † (law-firm summary only) | **190% of Medicare** since 7/2/2023; services with no Medicare price paid at 52.5% of the 1/1/2019 chargemaster, adjusted annually for CPI ‡ ([MCL 500.3157](https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-500-3157); [acbilling](https://acbilling.com/chiropractic-billing-michigan/)); no fee schedule for pre-6/11/2019 injuries ([Andary](https://law.justia.com/cases/michigan/supreme-court/2023/164772.html)) | DIFS utilization-review rules: provider explains within 30 days; insurer determines within 30 days; appeal to DIFS within 90 days on form FIS 2356 ([R 500.65](https://www.law.cornell.edu/regulations/michigan/Mich-Admin-Code-R-500-65); [FIS 2356](https://www.michigan.gov/-/media/Project/Websites/difs/Form/Insurance/UR/FIS_2356.pdf?rev=af1e18a49493443da13be4e20fda75e2)) |
| **MN** | $40,000 basic economic loss: $20,000 medical plus $20,000 non-medical; mandatory ([Nicolet Law](https://nicoletlaw.com/blog/minnesotas-no-fault-insurance-affects-your-car-accident-claim/)) | 30 days after reasonable proof; **15%** simple interest ([65B.54](https://www.revisor.mn.gov/statutes/cite/65b.54)) | "Reasonable expenses"; no schedule found; workers' comp limit of 12 weeks of adjustments comes up in disputes ([Minn. R. 5221.6200](https://www.revisor.mn.gov/rules/5221.6200/)) | **Mandatory binding arbitration for claims of $10,000 or less** ([65B.525](https://codes.findlaw.com/mn/insurance-ch-59a-79a/mn-st-sect-65b-525/)); IME rules not retrieved † |
| **ND** | $30,000 total for all economic loss (one pool); work loss $150/week ([N.D.C.C. 26.1-41](https://ndlegis.gov/cencode/t26-1c41.pdf)) | Not found † | Reasonable charges † | Not found † |
| **MA** | $8,000 combined (medical, 75% of wages, replacement services). With private health insurance, PIP pays only the first $2,000 of medical; the health plan is then primary and PIP covers its gaps up to the remaining $6,000 ([mass.gov COB](https://www.mass.gov/info-details/coordination-of-benefits); [MFC Law](https://mfclaw.com/blogs/do-i-need-pip-if-i-have-health-insurance-massachusetts/)) | Expenses must be incurred within 2 years of the accident; benefits unpaid 30 days after bills and records arrive let the provider sue with fee shifting ([mass.gov §34M](https://www.mass.gov/info-details/mass-general-laws-c90-ss-34m)); billing deadline sources conflict † | No statutory PIP schedule; reasonable and necessary | IME "as often as reasonably required" ([§34M](https://www.mass.gov/info-details/mass-general-laws-c90-ss-34m)) |
| **HI** | $10,000; mandatory; liability minimums rose 1/1/2026 but PIP did not ‡ ([Island Insurance](https://www.islandinsurance.com/article/hawaiis-personal-injury-protection-pip-benefits-explained)) | 30 days after proof and demand; **1.5%/month** interest; written denial with reasons within 30 days ([HRS 431:10C-304](https://law.justia.com/codes/hawaii/title-24/chapter-431/section-431-10c-304/)) | Both **charges and treatment frequency** capped at the HI workers' comp schedule (Exhibit A, otherwise 110% of HI Medicare RBRVS); emergency care within 72 hours exempt ([HRS 431:10C-308.5](https://law.justia.com/codes/hawaii/title-24/chapter-431/section-431-10c-308-5/); [HAR 16-23-115](https://www.law.cornell.edu/regulations/hawaii/Haw-Code-R-SS-16-23-115)) | **First 15 treatments in 60 days need no authorization; after that a treatment plan is required** ([HAR ch. 23](https://files.hawaii.gov/dcca/ins/har/har_23-c.pdf)) |
| **KS** | $4,500 medical plus a separate $4,500 rehabilitation benefit; mandatory ([K.S.A. 40-3103](https://ksrevisor.gov/statutes/chapters/ch40/040_031_0003.html)) | 30 days after written notice; **18%** interest ([40-3110](https://ksrevisor.gov/statutes/chapters/ch40/040_031_0010.html)); no billing deadline found † | No PIP schedule; usual and customary ([AC Billing](https://acbilling.com/chiropractic-billing-kansas/)) | Not found † |
| **KY** | $10,000; mandatory. HB 627 (2026) raised the wage cap to $500/week and funeral to $5,000 for policies issued or renewed after about 7/15/2026 ‡ ([HB 627 record](https://apps.legislature.ky.gov/record/26rs/hb627.html); [Garmer & Prather](https://www.garmerprather.com/blog/kentuckys-new-pip-law/)) | Bills within **180 days**; 30 days, then **12%** (18% if the delay had no reasonable foundation) ([KRS 304.39-210](https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=57856)); insured may direct in writing how benefits are allocated | Post-HB 627 tied to the KY workers' comp schedule (KRS 342.035). Sources conflict on whether it is a cap or a "greater of" floor ‡† ([HB 416 text](https://apps.legislature.ky.gov/recorddocuments/bill/25RS/hb416/bill.pdf); [Aguiar](https://aguiarinjurylawyers.com/kentucky-pip-reform-2026/)) | Not confirmed † |
| **UT** | $3,000 medical minimum ([FindLaw 31A-22-307](https://codes.findlaw.com/ut/title-31a-insurance-code/ut-code-sect-31a-22-307)) | 30 days after proof; **1.5%/month** interest plus attorney fees; §309 amended in 2026 ‡ ([le.utah.gov 31A-22-309](https://le.utah.gov/xcode/Title31A/Chapter22/C31A-22-S309_2020051220210101.pdf)) | No PIP schedule (secondary source); statute references a relative value study ([AC Billing](https://acbilling.com/chiropractic-billing-utah/)) | Not found † |

### Tort threshold, balance billing, liens and letters of protection

| State | Tort threshold for pain and suffering | Balance billing above PIP | Provider lien / LOP |
|---|---|---|---|
| **FL** | Permanent injury, significant scarring or disfigurement, or death (§627.737(2)); current text not retrieved † | Limits not verified † | No private-provider lien; LOPs subject to §768.0427 disclosure ([flsenate](https://www.flsenate.gov/Laws/Statutes/2023/768.0427)) |
| **NY** | "Serious injury" under §5102(d), proven by objective evidence; sprains and subjective pain generally fail ([Pastuszynski](https://www.nycourts.gov/REPORTER/3dseries/2016/2016_04619.htm); [4th Dept 2025](https://www.nycourts.gov/courts/ad4/Clerk/Decisions/2025/0131T1500/pdf/0783.pdf)) | **Barred**, including after exhaustion: the patient may be billed only at fee-schedule rates ([DFS OGC 02-09-24](https://www.dfs.ny.gov/insurance/ogco2002/rg020924.htm); [09-05-01](https://www.dfs.ny.gov/insurance/ogco2009/rg090501.htm)) | No chiropractor lien statute found; a full-charge LOP is incompatible with covered services |
| **NJ** | Limitation on Lawsuit: 6 categories; permanency needs a treating physician's certification within 60 days of the defendant's answer. No Limitation: any injury ([a0393-23](https://njcourts.gov/system/files/court-opinions/2025/a0393-23.pdf); [a3319-22](https://www.njcourts.gov/system/files/court-opinions/2024/a3319-22.pdf)) | **Barred** (N.J.A.C. 11:3-29.6) ([Justia](https://regulations.justia.com/states/new-jersey/title-11/chapter-3/subchapter-29/section-11-3-29-6/)); deductible, copay and penalty copays are collectible; after exhaustion unresolved † | None found for chiropractors |
| **PA** | Limited tort only: "serious injury" (death, serious impairment of body function, permanent serious disfigurement), with exceptions such as a DUI defendant ([Lebovitz](https://lebovitzlaw.com/personal-injury-lawyer-pittsburgh/serious-injury-exception-limited-tort-pennsylvania/)) | **Barred**; the 1990 Fee Control Act covers chiropractors; no billing during PRO review ([Act 1990-81](https://www.legis.state.pa.us/WU01/LI/LI/US/HTM/1990/0/0081..HTM)) | None found; Act 6 limits also reach BI and UM claims |
| **MI** | Serious impairment of body function, permanent serious disfigurement, or death; patient may sue for medical costs above the PIP tier, but *Canty* applies the fee schedule to that claim ([michiganlegalcenter](https://www.michiganlegalcenter.com/mcl-§-500-3157-medical-fee-schedules-for-pip-charges-post-2019-reform-2)) | Payment capped at the schedule; an explicit bar on billing the patient is unconfirmed †; *Compass* rejected a provider's pursuit of balance bills ([Speaker Law](https://www.speakerlaw.com/blog/no-faults-one-year-back-rule-applies-to-medical-providers-balance-bills)) | None found; *Canty* cuts LOP value |
| **MN** | Medical over **$4,000** (excluding diagnostic X-rays and rehab), or permanent injury, disfigurement, death, or 60+ days of disability ([Nicolet](https://nicoletlaw.com/blog/minnesotas-no-fault-insurance-affects-your-car-accident-claim/)) | **Barred** for unremitted amounts when the insurer complies with 62J.536 e-billing ([65B.54](https://www.revisor.mn.gov/statutes/cite/65b.54)) | None found |
| **ND** | Medical over **$2,500**, or death, dismemberment, serious and permanent disfigurement, or disability beyond 60 days ([26.1-41-01](https://codes.findlaw.com/nd/title-26-1-insurance/nd-cent-code-sect-26-1-41-01/)) | Not found † | Not found † |
| **MA** | Reasonable medical over **$2,000** counted at billed (not paid) amounts, or listed injuries including fracture ([MFC Law](https://mfclaw.com/blogs/massachusetts-tort-threshold-rules-explained/)) | Not found † | c.111 §70A lien is for hospitals and HMOs, not individual practitioners ([Suffolk](https://dc.suffolk.edu/cgi/viewcontent.cgi?article=1205&context=suls-faculty)) |
| **HI** | **$5,000** of PIP medical-rehab benefits (fixed amount) or listed injuries ([HI Sup. Ct. 2020](https://www.courts.state.hi.us/wp-content/uploads/2020/03/SCWC-12-0001090ada.pdf)) | Likely improper given the statutory cap; explicit text not found † | Not researched † |
| **KS** | Medical with **reasonable value ≥ $2,000** (billed charges not conclusive) or listed injuries; limits only non-economic damages ([40-3117](https://ksrevisor.gov/statutes/chapters/ch40/040_031_0017.html)) | Not found † | Hospital lien (65-406); chiropractor use disputed ([65-407](https://ksrevisor.gov/statutes/chapters/ch65/065_004_0007.html)) |
| **KY** | PIP-payable medical over **$1,000** or listed injuries, unless the person rejected the tort limitation ([KRS 304.39-060](https://apps.legislature.ky.gov/law/statutes/statute.aspx?amp=&id=30030)) | **Barred** after HB 627 ‡ ([Aguiar](https://aguiarinjurylawyers.com/kentucky-pip-reform-2026/)) | No statewide lien statute ([MWL chart](https://www.mwl-law.com/wp-content/uploads/2019/09/HOSPITAL-LIEN-LAWS-IN-ALL-50-STATES-CHART-00215685x9EBBF.pdf)) |
| **UT** | Medical over **$3,000**, or death, dismemberment, permanent impairment, disfigurement, or fracture ([31A-22-309](https://le.utah.gov/xcode/Title31A/Chapter22/C31A-22-S309_2020051220210101.pdf)) | Not found † | Statewide lien statute (Title 38 ch. 7); chiropractor coverage unconfirmed † ([MWL chart](https://www.mwl-law.com/wp-content/uploads/2019/09/HOSPITAL-LIEN-LAWS-IN-ALL-50-STATES-CHART-00215685x9EBBF.pdf)) |

### Add-on PIP, MedPay and tort states

No add-on state researched restricts the right to sue, and none uses a PIP fee schedule. What differs is whether coverage is compulsory, the window for incurring expenses, the payment clock, and whether the PIP carrier is reimbursed out of the BI settlement.

| State | Status / medical limit | Expense window, notice and payment | Fee basis | Carrier reimbursement from the settlement |
|---|---|---|---|---|
| **DE** | Mandatory $15k/person ([Knepper & Stratton](https://knepperstratton.com/delaware-no-fault-pip-car-insurance/delaware-pip-law/)) | Expenses within 2 years; penalty interest under §2118B (days and rate †) | Reasonable and necessary ([Marshall Dennehey](https://www.marshalldennehey.com/eric-scott-thompson/thought-leadership/evaluating-reasonable-and-necessary-pip-charges-under-delaware-law)) | Subrogation between insurers only; usually no lien on the patient's settlement ([F&P](https://www.fandpnet.com/wp-content/uploads/2015/01/DE-PIP-and-UM-UIM-FAQs.pdf)) |
| **MD** | $2,500; must be offered, can be waived in writing ([MIA form](https://insurance.maryland.gov/Consumer/Documents/publicnew/MAIF-PIP-Form.pdf)) | Application within 12 months; pay within 30 days; 1.5%/month interest (2015 text ‡) ([Justia 19-508](https://law.justia.com/codes/maryland/2015/article-gin/title-19/subtitle-5/section-19-508)) | Reasonable | Believed none † |
| **OR** | Mandatory $15,000 ([ORS 742.524](https://law.justia.com/codes/oregon/volume-18/chapter-742/section-742-524/)) | Expenses within 2 years; **bills presumed reasonable unless denied within 60 days** | Reasonable (with that presumption) | Lien (insurer must elect within 30 days) or subrogation; made-whole rule ([MWL](https://www.mwl-law.com/oregon-replaces-make-half-rule-with-made-whole-rule-in-pip-subrogation/)) |
| **WA** | $10k medical; must be offered, rejection must be in writing ([RCW 48.22.095](https://lawfilesext.leg.wa.gov/Law/RCWPDF/RCW%20%2048%20%20TITLE/RCW%20%2048%20.%2022%20%20CHAPTER/RCW%20%2048%20.%2022%20.095.pdf)) | Expenses within 3 years | Reasonable | Reimbursed, but the carrier pays a pro-rata share of attorney fees (*Mahler*) ([Justia](https://law.justia.com/cases/washington/supreme-court/1998/64344-0-1.html)) |
| **TX** | $2,500; must be offered, rejection must be in writing ([Ryan Orsatti](https://ryanorsattilaw.com/pip/)) | Pay within 30 days of proof | Reasonable | **None**: no subrogation, so no lien on the settlement ([Texas Attorney](https://www.thetexasattorney.com/blog/personal-injury-protection-insurance-pip/)) |
| **AR** | $5,000; can be rejected in writing ([Justia 23-89-202](https://law.justia.com/codes/arkansas/2010/title-23/subtitle-3/chapter-89/subchapter-2/23-89-202)) | Expenses within 24 months | Reasonable | Statutory lien and credit (§23-89-207) ([Justia](https://law.justia.com/codes/arkansas/title-23/subtitle-3/chapter-89/subchapter-2/section-23-89-207/)) |
| **DC** | Election made after the accident; reported minimum $50k medical † ([Marks & Harrison](https://www.marksandharrison.com/points-of-law/understanding-personal-injury-protection-insurance-under-d-c-s-compulsory-no-fault-motor-vehicle-insurance-law/)) | **Must elect within 60 days** or the insured is deemed to have chosen a tort claim ([Nolo](https://www.nolo.com/legal-encyclopedia/washington-d-c-personal-injury-laws-and-liability-rules.html)) | Not found | Tort threshold applies after electing PIP |
| **VA** | MedPay must be offered; $2,000 minimum ([hsinjurylaw](https://www.hsinjurylaw.com/library/medical-payments-through-car-insurance-policies-in-virginia.cfm)) | — | — | MedPay anti-subrogation (§38.2-2209) ([Bilton](https://www.biltonlaw.com/pip-and-medpay-subrogation-in-the-washington-dc-area/)) |
| **WI** | MedPay $1,000 minimum, can be rejected, may be written as excess ([632.32](https://docs.legis.wisconsin.gov/document/statutes/632.32?view=section)) | — | — | Per policy and state law |

In tort states the clinic's leverage depends on lien law, which splits three ways.

**Statutes that expressly cover chiropractors**:

- **Georgia** (since 7/1/2023): file within **90 days of first treatment**; give 15 days' notice before filing; the clinic must bill health insurance first ([O.C.G.A. 44-14-471](https://law.justia.com/codes/georgia/title-44/chapter-14/article-8/part-8/section-44-14-471/)).
- **Arizona**: record the lien before or **within 30 days after first service**; the lien is void if an in-network contract does not allow it ([A.R.S. 33-932](https://law.justia.com/codes/arizona/title-33/section-33-932/)).
- **Colorado**: amounts capped at usual and customary charges; insurance payment options must be disclosed to the patient ([38-27.5-103](https://law.justia.com/codes/colorado/title-38/liens/article-27-5/section-38-27-5-103/)).
- **Louisiana** ([R.S. 9:4753](https://www.legis.la.gov/Legis/Law.aspx?d=108041)), **Montana** ([71-3-1115](https://mca.legmt.gov/bills/mca/title_0710/chapter_0030/part_0110/section_0150/0710-0030-0110-0150.html)) and **Oklahoma** ([42 O.S. §46](https://law.justia.com/codes/oklahoma/title-42/section-42-46/)).

**Statutes that cap provider liens**: Illinois caps all liens at **40%** of the recovery, with a 20% share for health professionals; whether chiropractors qualify needs counsel ([770 ILCS 23](https://law.justia.com/codes/illinois/chapter-770/act-770-ilcs-23/)). North Carolina caps them at **50% of the recovery after attorney fees** ([G.S. 44-50](http://www.ncleg.net/EnactedLegislation/Statutes/HTML/BySection/Chapter_44/GS_44-50.html)). Washington caps them at **25%** ([RCW 60.44](https://app.leg.wa.gov/RCW/default.aspx?cite=60.44&full=true&pdf=true)). Virginia allows **$750 per physician**, which includes chiropractors, and the lien is lost if health insurance is not billed ([8.01-66.2](https://codes.findlaw.com/va/title-8-01-civil-remedies-and-procedure/va-code-sect-8-01-66-2/)).

**Contract-only states**, where the clinic relies on LOPs: FL, CA, TX, plus OR and NE for chiropractors. Georgia's SB 68 (2025) now makes LOP terms discoverable there too, with a disputed trigger date ‡ ([SB 68](https://gov.georgia.gov/document/2025-signed-legislation/sb-68/download)).

Medicare patients add a federal overlay that applies everywhere. A provider pursuing a liability claim or lien may not bill Medicare. After 120 days it may withdraw the claim or lien and bill Medicare conditionally ([Palmetto GBA](https://files.palmettogba.com/palmetto/jja.nsf/DIDC/Y7I6RKN7HP~Medicare%20Secondary%20Payer%20(MSP)); [CMS R87MSP](https://www.cms.gov/Regulations-and-Guidance/Guidance/Transmittals/Downloads/R87MSP.pdf)).

## Clinical features travel; financial features need state rules

The table below classifies each app feature. "Universal" means no state parameter is needed. "Universal mechanism, state values" means the code stays and the numbers become configuration. "State-specific" means the feature exists only in some states or must be rebuilt.

| App feature (current FL behavior) | Classification | What changes by state |
|---|---|---|
| Referrals tracking, re-exam every 30 days, gaps in care, no-show outreach, huddle, audit, ADL/Oswestry/NDI assessments | **Universal** | Nothing statutory. Exceptions: NJ requires DPR/precert before some services ([N.J.A.C. 11:3-4](https://www.nj.gov/dobi/pipinfo/njac11_3_4_effect130104.pdf)); HI requires a treatment plan after 15 visits or 60 days ([HAR ch. 23](https://files.hawaii.gov/dcca/ins/har/har_23-c.pdf)); NY caps RVUs per day across providers ([TonaLaw](https://tonalaw.com/wcb-2024-fee-schedule/)) |
| Care guide: MRI script at visit 1, ortho after MRI, neuro for head injury, pain management at 12–16 weeks, MMI then maintenance | **Universal clinically, with state gates** | NJ: insert a DPR/precert step before MRI, EMG and similar tests where the carrier plan requires it. MN: insurers cite the 12-week workers' comp adjustment limit ([5221.6200](https://www.revisor.mn.gov/rules/5221.6200/)). MI: older dates of service carry chiropractic scope exclusions |
| EMC determination step and $2,500 cap | **FL only** | Turn off elsewhere; no other researched state has an EMC rule |
| 14-day initial-care alert | **FL only** | No equivalent found in any other state; NJ timing feeds DPR penalties instead |
| PIP-limit meter | **Universal mechanism, state values** | Limit and pool structure: shared pools (NY, ND, MA); separate medical and rehab buckets (KS); MA's $2k/$8k phases; tier picklists (NJ, MI, PA); unlimited (MI) |
| 80% insurer share, 20% moved to patient balance | **State-specific** | 100% of the allowed amount in NY and PA; NJ deductible plus 20% band up to $5,000; patient balance banned or limited in NY, NJ, PA, KY, MN |
| Fee estimate / expected reimbursement | **State-specific engine** | Medicare multiple (FL 200%×80%, PA 110%, MI 190%); workers' comp schedule (NY, HI, KY); reasonable charges (most others) |
| Bill-submission and insurer-overdue clocks (app has only a 45-day follow-up) | **Universal mechanism, state values** | Billing: FL 35 days, NY 45, KY 180. Expense windows: DE/OR 2 years, WA 3, AR 24 months, MA 2. Overdue: 30 days in most states; OR's 60-day denial presumption |
| Interest on overdue benefits | **State values** | NY 2%/month; PA 12%; MI 12% †; MN 15%; KS 18%; KY 12%/18%; UT, HI, MD 1.5%/month |
| Insurer review workflows | **State-specific modules** | FL demand letter; NY verification and IME/EUO; NJ DPR and APTP; PA PRO; MI DIFS utilization review; MN arbitration ≤ $10k; NJ Forthright arbitration; NY AAA arbitration |
| Policy-limits (BI/UM) case-value warning | **Universal mechanism, state valuation** | Medical totals should be valued at the fee schedule where it reaches the tort claim: PA Act 6, MI *Canty*, and FL §768.0427's admissible-amount rules |
| Permanency opinion at MMI | **Universal clinical step, state trigger** | FL permanency; NJ certification deadline; NY serious-injury categories; MI/PA serious impairment; dollar thresholds (KY $1k, KS $2k, MA $2k, ND $2.5k, UT $3k, MN $4k, HI $5k) |
| Attorney letters: status request, treatment complete | **Universal** | Wording only |
| Reduction request with an 80% floor | **Universal practice setting, state caps** | Statutory lien caps (IL 40/20%, NC 50% of net, WA 25%, VA $750) and fee-schedule-capped balances (NY, NJ, PA, MI) change the base |
| Letters of protection, patient-balance forwarding | **State-specific** | Contract only, statutory lien perfection (GA, AZ, CO, LA, MT, OK), or largely barred for PIP-covered services (NY, NJ, PA, KY); disclosure capture (FL, GA) |
| DWC-25 tracking, 18-visit/8-week workers' comp limit | **FL workers' comp only** | These are Florida workers' comp rules, not PIP. Workers' comp was outside this research and must be configured per state separately |
| Statute of limitations | **State values, effective-dated** | Ranges from 1 year (KY, TN) to 6 (ME, ND); FL and LA changed in 2023 and 2024 ([LimitationCalc](https://limitationcalc.com/blog/personal-injury-statute-of-limitations-by-state)) |

The answer on the general workflow is yes, with three qualifications. First, the clinical rhythm is state-neutral law-wise, but NJ, HI and NY add pre-authorization or frequency gates that the care guide has to respect. Second, the finance screens assume the clinic can recover unpaid PIP balances from the patient or the settlement at full charges, which is false in the strictest states. Third, the app's "letter of protection" concept splits into three different legal objects: contract, statutory lien, and post-exhaustion billing at fee-schedule rates.

## Effective-dated rule rows should replace every Florida constant

The core design change is to move every `define()` in `pi_rules.php` that encodes law into a jurisdiction rule table. Clinic habits stay as practice settings. Each rule row carries five things:

- the state;
- a stable `rule_key`;
- a typed value;
- the **date basis** that selects it. The research shows three different ones: date of loss (FL statute of limitations, LA statute of limitations, MI *Andary*), date of service (NY and MI fee schedules, MI chiropractic scope), and policy issue or renewal date (KY HB 627, MI tiers);
- an effective window, plus a citation, source URL and verification status.

```sql
CREATE TABLE jurisdiction_rules (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  state          CHAR(2)      NOT NULL,
  rule_key       VARCHAR(64)  NOT NULL,      -- 'pip.med_limit_default'
  value_json     JSON         NOT NULL,      -- number | string | object
  date_basis     ENUM('date_of_loss','date_of_service','policy_effective','claim_event','none') NOT NULL,
  effective_from DATE         NOT NULL,
  effective_to   DATE         NULL,          -- NULL = open-ended
  conditions     JSON         NULL,          -- {"policy_type":"standard"}, {"provider":"chiro"}
  citation       VARCHAR(255) NULL,
  source_url     VARCHAR(512) NULL,
  verification   ENUM('unverified','secondary_source','primary_text','attorney_reviewed') NOT NULL DEFAULT 'unverified',
  verified_by    VARCHAR(128) NULL,
  verified_on    DATE         NULL,
  review_due     DATE         NULL,          -- forces re-check of date-sensitive rows
  notes          TEXT         NULL,
  KEY (state, rule_key, effective_from)
);

CREATE TABLE fee_schedules (                 -- one row per schedule version
  id INT AUTO_INCREMENT PRIMARY KEY,
  state CHAR(2) NOT NULL,
  basis ENUM('reasonable','medicare_multiple','wc_schedule','state_pip_schedule') NOT NULL,
  multiplier DECIMAL(5,3) NULL,              -- FL 2.000, PA 1.100, MI 1.900
  payer_share DECIMAL(4,3) NOT NULL DEFAULT 1.000,  -- FL 0.800
  medicare_year_rule VARCHAR(40) NULL,       -- FL 'march1_of_service_year'
  floor_rule VARCHAR(60) NULL,               -- FL '2007_nonfacility_limiting'
  frequency_caps JSON NULL,                  -- NY {"rvu_per_day":12,"eval_day":[15,18]}, HI {"visits":15,"days":60}
  effective_from DATE NOT NULL, effective_to DATE NULL,   -- by date of service
  source_url VARCHAR(512) NULL,
  verification ENUM('unverified','secondary_source','primary_text','attorney_reviewed') NOT NULL DEFAULT 'unverified'
);

CREATE TABLE clock_rules (                   -- every statutory deadline as data
  id INT AUTO_INCREMENT PRIMARY KEY,
  state CHAR(2) NOT NULL,
  clock_key VARCHAR(64) NOT NULL,            -- 'bill_submission', 'pay_or_deny', 'lien_filing'
  anchor ENUM('accident','first_visit','date_of_service','proof_received','denial_received',
              'verification_request','determination','answer_filed','policy_effective') NOT NULL,
  offset_days INT NOT NULL,
  day_type ENUM('calendar','business') NOT NULL DEFAULT 'calendar',
  consequence VARCHAR(255) NULL,             -- 'benefits denied', 'interest accrues', 'lien void'
  effective_from DATE NOT NULL, effective_to DATE NULL,
  source_url VARCHAR(512) NULL, verification VARCHAR(20) NOT NULL DEFAULT 'unverified'
);
```

Case records need jurisdiction and election fields the app lacks today:

- **Three state fields:** `pip_state` (the policy's state), `accident_state` and `venue_state`. All three default from `practices.state`. The research did not cover conflict of laws. Treating PIP rules as following the policy, tort rules the accident or venue, and lien rules the provider's location is an engineering assumption that counsel must confirm. Even so, a Florida clinic treating a New York–insured visitor makes the single practice-level state field insufficient.
- **Policy fields:** `policy_effective_date`; `pip_limit` or `pip_tier`; `deductible` and copay band (NJ); and `health_primary` (NJ). Add `has_private_health` and `network_status` (MA phases; GA, VA and AZ lien conditions).
- **Election status:** `pip_election` (accepted, rejected in writing, waived, or elected post-accident for DC) and `tort_option`. `tort_option` values: full, limited, limitation on lawsuit, no limitation, or KY tort limitation rejected.
- **Federal payer flags:** `medicare` and `medicaid`.
- **Threshold counters:** reasonable value (KS), billed amount (MA), PIP benefits paid (HI), excluding X-rays and rehab (MN), and disability days (MN, ND).

A resolver such as `rule($key, $case, $dateOfService = null)` picks the right state and date, then returns the value along with its verification status. The UI can then badge any alert built on an unverified rule.

Current Florida constants map to the rule keys below. Values are drawn from the comparison tables and inherit their flags.

| Current constant / behavior | Rule key | FL value | Examples elsewhere |
|---|---|---|---|
| `PIP_DEFAULT_LIMIT` 10000 | `pip.med_limit_default` + `pip.pool_type` | 10000, medical | NY 50000 shared; NJ 250000 (tiered); PA 5000; MN 20000; ND 30000 shared; MA 8000 shared; KS 4500 + rehab 4500; UT 3000 |
| `PIP_NO_EMC_CAP` 2500 | `pip.restricted_cap` | {"if":"emc != yes","amount":2500} | none |
| `PIP_INITIAL_CARE_DAYS` 14 | `clock.initial_care` | 14 from accident | none |
| `PIP_PAYS_PCT` 0.80 | `fee_schedules.payer_share`, `pip.patient_share_rule` | 0.80 | NY/PA 1.00; NJ deductible + 20% to $5,000 |
| `EMC_DUE_DAYS` 7 | practice setting, FL-gated | 7 | n/a |
| `INSURANCE_FOLLOWUP_DAYS` 45 | `clock.bill_submission`, `clock.pay_or_deny`, `pip.interest` | 35-day bill †; 30-day pay † | NY 45/30 + 2%/month; KY 180/30 + 12%; OR 60-day presumption |
| Permanency alert text (§627.737) | `tort.threshold` (JSON spec) | verbal: permanency | {"monetary":2000,"counts":"reasonable_value"} KS; {"monetary":4000,"excludes":["xray","rehab"],"disability_days":60} MN |
| Patient-balance forwarding / LOP | `billing.patient_balance_allowed`, `lien.regime`, `lien.cap_formula`, `lop.disclosure_required` | verify †; contract; none; yes | NY/NJ/PA false; GA statutory, 90-day clock; IL 40%; NC 50% net |
| `REDUCTION_FLOOR_PCT` 0.80 | practice setting, bounded by `lien.cap_formula` | 0.80 | unchanged |
| `WC_CHIRO_MAX_VISITS`, `WC_DWC25_DAYS` | `wc.*` (separate research) | 18 visits / 3 days | not researched |
| Gap, re-exam and pain-management constants | practice settings | unchanged | unchanged |

## Florida-like states first; New York, New Jersey and Michigan last

Ranking by how much new machinery each state needs gives three tiers. Market size and the owner's expansion goals were not researched, and should reorder states within a tier.

| Tier | States | Why they are easy or hard | New build required |
|---|---|---|---|
| **1: Next** | **KS, UT, MN, ND**; add-on and MedPay states **TX, DE, OR, WA, MD, AR, VA, WI** | Reasonable-charge billing with no fee-schedule engine, no precert, a single benefit bucket and a 30-day overdue clock. Thresholds are simple dollar counters. Add-on states keep the tort claim fully open, which is close to the app's existing slip-and-fall LOP path | Rule table; limit meter with pool types; dollar-threshold counters; interest calculator; subrogation flag for the settlement worksheet; MN arbitration routing and e-billing balance-bill block; OR 60-day presumption alert; DC 60-day election alert (low priority) |
| **2: Then** | **MA, KY, HI, PA**; lien states **GA, AZ, CO, LA, OK, MT** (and IL, NC, WA caps) | Each adds one significant mechanism: MA's two-phase health coordination; KY's policy-date versioning, workers' comp fee lookup and balance-bill ban; HI's workers' comp fee and frequency caps plus treatment plans; PA's 110% Medicare engine, PRO clocks and tort option. Lien states need filing and notice workflows with short clocks (AZ 30 days, GA 90 days) | Payer-sequencing engine; fee-schedule versioning; visit-frequency counter; PRO module; lien perfection module (recipients, method, filing office, cap formula); health-insurance-first gates (GA, VA) |
| **3: Last** | **NY, NJ, MI** | NY: workers' comp RVU schedule with cross-provider daily caps, a pending new edition, prescribed NF forms, verification clocks and strict balance-bill rules. NJ: tier/deductible/copay math, per-carrier DPR plans, APTP generation, penalty copays and pending fee changes. MI: six tiers, three-date logic (*Andary*), 190% Medicare plus chargemaster CPI, DIFS utilization review, and a pending *Demske* decision | Full fee engines with code-level tables; carrier-specific configuration (NJ); forms library (NY); utilization-review state machines (NJ, MI) |

Florida also needs a short release of its own before any expansion: a 35-day bill clock, a demand-letter-plus-30-day-cure workflow, license validation for the EMC determiner, March-1 Medicare-year pricing with the 2007 floor, and §768.0427 disclosure fields (factoring sale, health coverage, referral source, coded itemization). Doing this first also tests the rule-table design on the state the owner knows best.

## Verify these figures before they become code

The research environment could not open any official statute site. Several items are in active flux as of October 2026, so each should be stored with `verification = 'unverified'` and a `review_due` date until counsel signs off.

| Item | Why it is risky |
|---|---|
| KY HB 627 workers' comp fee rule ‡† | Effective about 7/15/2026, for policies issued or renewed afterward; sources conflict on cap vs "greater of" ([HB 627 record](https://apps.legislature.ky.gov/record/26rs/hb627.html)) |
| UT §31A-22-309 ‡ | Amended 2026 (ch. 382); prior text superseded 5/6/2026; new text not retrieved ([le.utah.gov](https://le.utah.gov/xcode/Title31A/Chapter22/C31A-22-S309_2020051220210101.pdf)) |
| NY chiropractic fee schedule ‡ | New workers' comp edition revised 9/2/2026, effective TBD; current conversion factors unconfirmed ([WCB](https://www.wcb.ny.gov/content/main/regulations/revised/revised-med-fee-2026-08/)) |
| NJ PIP fee schedule ‡ | 2013 schedule; DOBI advance notices of an overhaul and a weekly physical-medicine cap ([Brach Eichler](https://www.bracheichler.com/insights/dobi-proposes-weekly-cap-on-new-jersey-pip-rehab-fees/)); S3142 could change health-primary rules |
| MI fee schedule application ‡ | *Demske v Fick* pending; CPI adjustments for 2024–2026 not found ([State brief](https://www.courts.michigan.gov/4ad870/siteassets/case-documents/briefs/msc/2024-2025/167153/167153_58_01_ae_supp_brf.pdf)) |
| FL Medicare base and repeal risk ‡ | Medicare amounts reset every March 1; repeal bills expected again in 2027 |
| GA SB 68 trigger date ‡ | Sources split between causes of action arising on or after, or claims brought after, 21/22 April 2025 |
| FL pay deadline, IME rules, balance billing, §627.737 text † | Not retrieved; the app's 20%-to-patient logic depends on them |
| NY 30/45-day notice and billing; NJ statutory notice and pay clocks † | From researcher recollection or older form text |
| ND overdue days, interest and limitations; MN notice and IME; KS/UT billing deadlines † | No primary source found |
| MA billing deadline; HI hearing deadline; DE §2118B days and rate † | Conflicting or truncated sources |
| Chiropractor eligibility for IL, WA, NC, KS and UT liens † | Statutes say "physician" or are hospital-focused; counsel needed |
| PA optional tiers; MI explicit balance-bill text; DC benefit minimums † | Secondary sources only |
| All statute-of-limitations entries except FL, LA, KY, TN † | Aggregator charts, not state codes ([LimitationCalc](https://limitationcalc.com/blog/personal-injury-statute-of-limitations-by-state)) |

## Conclusion

The more useful dividing line for InjuryCase is not "no-fault vs tort." It is whether a state lets the clinic recover above the PIP-allowed amount. Florida, the add-on states and the lien states still allow a patient balance, an LOP, or a lien to carry value, so the app's settlement and reduction screens transfer with new numbers. NY, NJ, PA, post-reform Kentucky and (in practice) Michigan cap recovery at a fee schedule. In those states the case-value and reduction features have to be rebuilt around the fee schedule rather than billed charges. That argues for expanding along the "balance recoverable" axis first, with Kansas, Utah, Minnesota, North Dakota and the add-on states, and for treating NY, NJ and MI as separate products, not configurations.

The second takeaway is that verification is ongoing work, not a one-time step. Kentucky, Utah, New York, New Jersey, Michigan and Florida all had live or pending changes within the past year. A rule table that records its source, its verification level and a review date turns that churn into a maintenance queue instead of silent wrong alerts. The `verification` column should be visible to clinic staff whenever a deadline or limit drives an alert, so that an unverified rule always reads as a prompt to check with the attorney rather than a legal conclusion.
