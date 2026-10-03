/**
 * Test site cast: Florida clinics and chiropractors with deliberately different
 * situations, so every screen has something real to show. All addresses are
 * plausible but fictional; emails end in @sandbox.test (never deliverable).
 */

export const DEMO_DOMAIN = "sandbox.test";
/** Every demo login uses this password (shown on Admin → Test site). */
export const DEMO_PASSWORD = "TestSite-2026!";

export interface DemoLocation {
  name: string;
  address: string;
  city: string;
  zip: string;
  lat: number;
  lng: number;
  patientsPerDay: number;
  ehr: string;
  arrival: string;
}

export interface DemoClinic {
  key: string;
  name: string;
  legal: string;
  owner: string;
  /** "yours" = the owner's own test clinic: bots never act for it. */
  yours?: boolean;
  /** How many shifts a week it posts on its own (Sunday top-up). */
  perWeek: number;
  minYears?: number;
  relaxInEmergency?: boolean;
  /** No card on file yet (onboarding view). */
  noPayment?: boolean;
  staff?: string;
  locations: DemoLocation[];
}

export const CLINICS: DemoClinic[] = [
  {
    key: "yours", yours: true, name: "Sandbox Family Chiropractic", legal: "Sandbox Family Chiropractic LLC", owner: "Your Test Clinic", perWeek: 2, staff: "Jordan Front-Desk",
    locations: [{ name: "Downtown Orlando", address: "100 N Orange Ave", city: "Orlando", zip: "32801", lat: 28.5421, lng: -81.379, patientsPerDay: 40, ehr: "ChiroTouch", arrival: "Park in the garage on Pine St (we validate). Staff entrance is the blue door off the lobby." }],
  },
  {
    key: "lakeside", name: "Lakeside Family Chiropractic", legal: "Lakeside Family Chiropractic LLC", owner: "Lauren Hayes", perWeek: 3, relaxInEmergency: true,
    locations: [{ name: "Winter Park", address: "1201 Lakeview Ave", city: "Winter Park", zip: "32789", lat: 28.5999, lng: -81.3392, patientsPerDay: 32, ehr: "ChiroTouch", arrival: "Back lot parking; the front desk will meet you at the staff door." }],
  },
  {
    key: "baldwin", name: "Baldwin Park Spine & Wellness", legal: "Baldwin Park Spine & Wellness PA", owner: "Chris Navarro", perWeek: 2, minYears: 2,
    locations: [{ name: "Baldwin Park", address: "4800 New Broad St", city: "Orlando", zip: "32814", lat: 28.5664, lng: -81.3262, patientsPerDay: 26, ehr: "Genesis", arrival: "Street parking on New Broad. Ask for Maria." }],
  },
  {
    key: "bay", name: "Bay Area Chiropractic Group", legal: "Bay Area Chiropractic Group LLC", owner: "Renee Whitfield", perWeek: 4, staff: "Tom Office-Manager",
    locations: [
      { name: "South Tampa", address: "2310 S Dale Mabry Hwy", city: "Tampa", zip: "33629", lat: 27.9265, lng: -82.5052, patientsPerDay: 45, ehr: "ECLIPSE", arrival: "Rear entrance by the dumpsters is staff only; parking spots 1-4 are ours." },
      { name: "Brandon", address: "1020 W Brandon Blvd", city: "Brandon", zip: "33511", lat: 27.9378, lng: -82.3009, patientsPerDay: 30, ehr: "ECLIPSE", arrival: "Plaza parking. Front door; check in with the front desk." },
    ],
  },
  {
    key: "stpete", name: "Sunshine City Chiropractic", legal: "Sunshine City Chiropractic PA", owner: "Marco DeLuca", perWeek: 2,
    locations: [{ name: "St. Petersburg", address: "550 Central Ave", city: "St. Petersburg", zip: "33701", lat: 27.7711, lng: -82.6424, patientsPerDay: 22, ehr: "ChiroFusion", arrival: "Metered parking; we reimburse. Suite 210." }],
  },
  {
    key: "miami", name: "Brickell Spine Center", legal: "Brickell Spine Center LLC", owner: "Isabel Moreno", perWeek: 3, minYears: 5,
    locations: [{ name: "Brickell", address: "1110 Brickell Ave", city: "Miami", zip: "33131", lat: 25.7629, lng: -80.1918, patientsPerDay: 50, ehr: "Jane", arrival: "Valet at the building entrance (we cover it). 7th floor." }],
  },
  {
    key: "ftl", name: "Las Olas Chiropractic & Rehab", legal: "Las Olas Chiropractic & Rehab Inc", owner: "Derek Simmons", perWeek: 2,
    locations: [{ name: "Fort Lauderdale", address: "800 E Las Olas Blvd", city: "Fort Lauderdale", zip: "33301", lat: 26.1194, lng: -80.1335, patientsPerDay: 34, ehr: "ChiroTouch", arrival: "Garage behind the building, level 2. Staff badge at the front desk." }],
  },
  {
    key: "jax", name: "First Coast Chiropractic", legal: "First Coast Chiropractic LLC", owner: "Hannah Brooks", perWeek: 2,
    locations: [{ name: "San Marco", address: "1950 San Marco Blvd", city: "Jacksonville", zip: "32207", lat: 30.3048, lng: -81.6537, patientsPerDay: 28, ehr: "Genesis", arrival: "Lot behind the building. Ring the bell at the side door before 8." }],
  },
  {
    key: "gville", name: "Gator Spine & Sports", legal: "Gator Spine & Sports PLLC", owner: "Tyler Nguyen", perWeek: 1,
    locations: [{ name: "Gainesville", address: "3700 W University Ave", city: "Gainesville", zip: "32607", lat: 29.6519, lng: -82.3793, patientsPerDay: 18, ehr: "ChiroFusion", arrival: "Plenty of parking. Main entrance." }],
  },
  {
    key: "pensacola", name: "Emerald Coast Chiropractic", legal: "Emerald Coast Chiropractic LLC", owner: "Grace Ellison", perWeek: 1, relaxInEmergency: true,
    locations: [{ name: "Pensacola", address: "4400 Bayou Blvd", city: "Pensacola", zip: "32503", lat: 30.4705, lng: -87.2079, patientsPerDay: 24, ehr: "ChiroTouch", arrival: "Front lot. We'll have coffee waiting." }],
  },
  {
    key: "ftmyers", name: "Gulf Coast Wellness Chiropractic", legal: "Gulf Coast Wellness Chiropractic PA", owner: "Paul Rivers", perWeek: 2,
    locations: [{ name: "Fort Myers", address: "12801 Cleveland Ave", city: "Fort Myers", zip: "33907", lat: 26.5629, lng: -81.8723, patientsPerDay: 36, ehr: "ECLIPSE", arrival: "Side door by the pharmacy. Code 2468 (demo)." }],
  },
  {
    key: "ocala", name: "Horse Country Chiropractic", legal: "Horse Country Chiropractic LLC", owner: "Wendy Pratt", perWeek: 1, noPayment: true,
    locations: [{ name: "Ocala", address: "2100 SW College Rd", city: "Ocala", zip: "34471", lat: 29.1676, lng: -82.1588, patientsPerDay: 16, ehr: "Paper charts", arrival: "Front entrance." }],
  },
];

export type ProviderKind = "active" | "pendingLicense" | "pendingMalpractice" | "expiringLicense" | "student" | "noPayouts" | "suspended";

export interface DemoProvider {
  key: string;
  first: string;
  last: string;
  city: string;
  zip: string;
  lat: number;
  lng: number;
  grad: number;
  kind: ProviderKind;
  yours?: boolean;
  drive?: number;
  overnight?: boolean;
  pi?: boolean;
  langs?: string[];
  skills?: string[];
  /** Minimum full-day pay (dollars), private to them. */
  floor?: number;
  onCall?: boolean;
  /** Weekdays (0 = Sun) they work; default Mon-Sat. */
  days?: number[];
  bio: string;
}

const P = (key: string, first: string, last: string, city: string, zip: string, lat: number, lng: number, grad: number, kind: ProviderKind, more: Partial<DemoProvider> & { bio: string }): DemoProvider => ({ key, first, last, city, zip, lat, lng, grad, kind, ...more });

export const PROVIDERS: DemoProvider[] = [
  P("you", "Sam", "Tester", "Orlando", "32803", 28.5536, -81.3473, 2015, "active", { yours: true, days: [0, 1, 2, 3, 4, 5, 6], drive: 90, overnight: true, pi: true, skills: ["Diversified", "Activator", "Webster"], bio: "This is your own test provider. Apply to shifts, accept invitations, clock in and out, and get paid, all with demo money." }),
  // Orlando area
  P("marcus", "Marcus", "Bell", "Altamonte Springs", "32701", 28.6611, -81.3656, 2014, "active", { drive: 60, pi: true, skills: ["Diversified", "Gonstead"], onCall: true, bio: "12 years in family and personal-injury practice. Calm with new patients, quick with notes." }),
  P("priya", "Priya", "Shah", "Orlando", "32806", 28.5146, -81.3626, 2017, "active", { drive: 45, skills: ["Activator", "Diversified", "Extremity Adjusting"], floor: 450, bio: "Sports and family chiropractic. Comfortable with busy days and digital charting." }),
  P("daniel", "Daniel", "Ortiz", "Kissimmee", "34741", 28.2919, -81.4076, 2011, "active", { drive: 75, pi: true, langs: ["Spanish"], skills: ["Diversified", "Cox Flexion-Distraction"], bio: "Bilingual (English/Spanish). 14 years in multi-provider clinics and PI documentation." }),
  P("emily", "Emily", "Carter", "Oviedo", "32765", 28.67, -81.2081, 2019, "active", { drive: 50, skills: ["Webster", "Activator"], days: [1, 2, 3, 4, 5], bio: "Pediatric and prenatal (Webster) certified. Organized and used to 30+ patients a day." }),
  P("kevin", "Kevin", "O'Brien", "Sanford", "32771", 28.8029, -81.2695, 2008, "active", { drive: 90, overnight: true, skills: ["Gonstead", "Thompson Drop"], onCall: true, bio: "Gonstead-trained, 17 years. Happy to travel for multi-day coverage." }),
  P("alicia", "Alicia", "Grant", "Winter Garden", "34787", 28.5653, -81.5862, 2021, "active", { days: [0, 1, 2, 3, 4, 5, 6], drive: 40, skills: ["Diversified", "SOT"], bio: "Newer grad with a strong rehab background. Weekends welcome." }),
  P("tran", "Minh", "Tran", "Orlando", "32819", 28.4522, -81.4678, 2016, "pendingLicense", { drive: 60, langs: ["Vietnamese"], skills: ["Diversified"], bio: "Just joined; license is waiting for review." }),
  P("rachel", "Rachel", "Kim", "Orlando", "32828", 28.5195, -81.1775, 2025, "student", { drive: 45, bio: "Final-year student, graduating soon; building my profile early." }),
  // Tampa Bay
  P("james", "James", "Whitaker", "Tampa", "33606", 27.9356, -82.4651, 2010, "active", { drive: 60, pi: true, skills: ["Diversified", "Gonstead", "Upper Cervical"], onCall: true, bio: "PI and workers' comp. Fast notes, great with first visits." }),
  P("sofia", "Sofia", "Alvarez", "Brandon", "33511", 27.9378, -82.3009, 2018, "active", { drive: 50, langs: ["Spanish"], skills: ["Activator", "Webster"], bio: "Family practice, prenatal and pediatric. Bilingual." }),
  P("noah", "Noah", "Fischer", "Clearwater", "33755", 27.9659, -82.8001, 2013, "active", { drive: 70, skills: ["Thompson Drop", "Diversified"], floor: 500, bio: "High-volume clinics are my comfort zone (50+ visits)." }),
  P("olivia", "Olivia", "Hart", "St. Petersburg", "33704", 27.7953, -82.6386, 2020, "active", { drive: 45, skills: ["Diversified", "Extremity Adjusting"], days: [2, 3, 4, 6], bio: "Sports chiropractic, CrossFit and runners." }),
  P("ben", "Benjamin", "Cole", "Lakeland", "33803", 28.0222, -81.9496, 2009, "expiringLicense", { drive: 80, overnight: true, skills: ["Gonstead"], bio: "Covering Polk County and beyond. License renewal in progress." }),
  P("ivy", "Ivy", "Chen", "Tampa", "33612", 28.0545, -82.4384, 2024, "student", { drive: 40, langs: ["Mandarin"], bio: "New graduate waiting on my Florida license." }),
  // South Florida
  P("carlos", "Carlos", "Mendez", "Miami", "33135", 25.766, -80.2312, 2007, "active", { drive: 45, pi: true, langs: ["Spanish"], skills: ["Diversified", "Cox Flexion-Distraction"], onCall: true, bio: "18 years, PI heavy. Spanish-speaking patients love him." }),
  P("ana", "Ana", "Torres", "Coral Gables", "33134", 25.7215, -80.2684, 2016, "active", { drive: 40, langs: ["Spanish", "Portuguese"], skills: ["Activator", "Webster"], bio: "Prenatal and family; trilingual." }),
  P("david", "David", "Levine", "Fort Lauderdale", "33304", 26.1376, -80.1173, 2012, "active", { drive: 60, skills: ["Diversified", "Torque Release"], floor: 520, bio: "Busy multi-doctor offices, strong documentation." }),
  P("maya", "Maya", "Patel", "Boca Raton", "33432", 26.3587, -80.0831, 2019, "active", { drive: 55, skills: ["Activator", "Logan Basic"], bio: "Gentle techniques, older patients, and lots of patience." }),
  P("luis", "Luis", "Garcia", "Hialeah", "33012", 25.8576, -80.2781, 2022, "noPayouts", { drive: 40, langs: ["Spanish"], skills: ["Diversified"], bio: "Ready to work; finishing payout setup." }),
  P("zoe", "Zoe", "Williams", "West Palm Beach", "33401", 26.7153, -80.0534, 2015, "active", { drive: 70, overnight: true, skills: ["Diversified", "SOT"], bio: "Treasure Coast to Broward; overnight trips are fine." }),
  // North Florida
  P("ethan", "Ethan", "Ward", "Jacksonville", "32205", 30.3172, -81.7212, 2011, "active", { drive: 75, overnight: true, pi: true, skills: ["Diversified", "Gonstead"], bio: "First Coast native. PI and family practice." }),
  P("grace", "Grace", "Lin", "St. Augustine", "32084", 29.8947, -81.3145, 2017, "active", { drive: 60, skills: ["Activator", "Upper Cervical"], bio: "Upper cervical and tonal; detailed notes." }),
  P("owen", "Owen", "Reed", "Gainesville", "32605", 29.6788, -82.3876, 2014, "active", { drive: 90, overnight: true, skills: ["Diversified", "Extremity Adjusting"], bio: "Gainesville to Ocala and Lake City." }),
  P("hannah", "Hannah", "Moss", "Tallahassee", "32308", 30.4766, -84.2246, 2010, "active", { drive: 120, overnight: true, skills: ["Gonstead", "Thompson Drop"], bio: "Big Bend and the Panhandle. Will travel with lodging." }),
  P("liam", "Liam", "Foster", "Pensacola", "32504", 30.5097, -87.1869, 2018, "pendingMalpractice", { drive: 60, skills: ["Diversified"], bio: "Malpractice certificate uploaded; waiting for review." }),
  // Southwest / Space Coast / others
  P("nora", "Nora", "Blake", "Fort Myers", "33908", 26.5205, -81.9353, 2013, "active", { drive: 70, skills: ["Diversified", "Activator"], bio: "Lee and Collier counties. Snowbird season pro." }),
  P("victor", "Victor", "Hale", "Naples", "34102", 26.1427, -81.7948, 2005, "active", { drive: 60, skills: ["Gonstead", "Cox Flexion-Distraction"], floor: 600, bio: "20 years, senior DC; prefers full days." }),
  P("chloe", "Chloe", "Bennett", "Sarasota", "34236", 27.3364, -82.5307, 2020, "active", { drive: 60, skills: ["Activator", "Webster"], bio: "Family wellness and prenatal." }),
  P("ryan", "Ryan", "Doyle", "Melbourne", "32901", 28.0836, -80.6081, 2012, "active", { drive: 90, overnight: true, skills: ["Diversified", "Thompson Drop"], bio: "Space Coast to Orlando. Weekend shifts welcome." }),
  P("tessa", "Tessa", "Young", "Daytona Beach", "32114", 29.1971, -81.0465, 2016, "active", { drive: 75, skills: ["Diversified", "Torque Release"], bio: "Volusia and Flagler counties." }),
  P("ocean", "Omar", "Haddad", "Ocala", "34474", 29.1564, -82.2068, 2009, "suspended", { drive: 60, skills: ["Gonstead"], bio: "Account suspended by an admin (demo of the suspended state)." }),
  P("julia", "Julia", "Ross", "Orlando", "32804", 28.5755, -81.3926, 2006, "active", { drive: 80, pi: true, skills: ["Diversified", "Gonstead", "Activator"], onCall: true, bio: "Senior DC, 19 years. Calm under pressure; last-minute calls welcome." }),
  P("max", "Max", "Silva", "Miami Beach", "33139", 25.7826, -80.1341, 2021, "active", { drive: 35, langs: ["Spanish", "Portuguese"], skills: ["Activator"], bio: "Newer grad, energetic and quick with patients." }),
];

/** Notes clinics write on shifts. */
export const SHIFT_NOTES = [
  "Our associate is at a seminar. Mostly established patients.",
  "Front desk handles X-rays; you'll have a dedicated room.",
  "Busy Monday-style day with two new-patient exams scheduled.",
  "Doctor on vacation. Patients are used to Diversified.",
  "Maternity leave coverage. Several prenatal patients (Webster).",
  "Light day: mostly maintenance visits.",
  "PI-heavy schedule; documentation in our EHR templates.",
  "Saturday hours; walk-ins likely.",
];

export const APPLY_NOTES = [
  "Free that day and only 15 minutes away.",
  "Happy to help, I know the area well.",
  "Bilingual and used to busy PI schedules.",
  "I've covered offices with a similar setup.",
  null,
  null,
];

export const CLINIC_REVIEWS = [
  "Patients loved the doctor. Notes were done before leaving.",
  "On time, professional and great with our new patients.",
  "Smooth day. We'd book again.",
  "Very thorough; ran a little behind but patients were happy.",
];
export const PROVIDER_REVIEWS = [
  "Organized front desk, great team.",
  "Clear instructions and a friendly staff.",
  "Busy but well run. Would cover again.",
  "Easy parking and a good setup.",
];
