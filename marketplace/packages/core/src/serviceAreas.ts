/**
 * Marketing service areas per state for the public landing pages (/<profession>/<state>
 * and /<profession>/<state>/<area>). Cities are largest first; the ZIP3 decides which
 * rate group a city is shown under. A state with one area has no area pages of its own:
 * its cities are listed on the state page (no near-duplicate pages for search engines).
 */
import type { AreaCity, ServiceArea, StateAreas } from "./seo";

/** "Houston:770, Dallas:752" → cities. */
function cities(list: string): AreaCity[] {
  return list.split(",").map((x) => {
    const [name, zip3] = x.trim().split(":");
    return { name: name.trim(), zip3: zip3.trim() };
  });
}
const area = (slug: string, name: string, blurb: string, list: string): ServiceArea => ({ slug, name, blurb, cities: cities(list) });
const one = (code: string, slug: string, name: string, blurb: string, list: string): StateAreas => ({ code, slug, name, areas: [area(slug, name, blurb, list)] });

export const FLORIDA: StateAreas = {
  code: "FL",
  slug: "florida",
  name: "Florida",
  areas: [
    area("north-florida", "North Florida", "From the First Coast to the Panhandle.", "Jacksonville:322, Tallahassee:323, Gainesville:326, St. Augustine:320, Pensacola:325, Panama City:324"),
    area("central-florida", "Central Florida", "Orlando, Tampa Bay, the Space Coast and everything between.", "Orlando:328, Tampa:336, St. Petersburg:337, Kissimmee:347, Sanford:327, Brandon:335, Clearwater:337, Lakeland:338, Daytona Beach:321, Melbourne:329, Ocala:344, Sarasota:342"),
    area("south-florida", "South Florida", "Miami-Dade, Broward, Palm Beach, the Treasure Coast and Southwest Florida.", "Miami:331, Fort Lauderdale:333, West Palm Beach:334, Boca Raton:334, Port St. Lucie:349, Fort Myers:339, Naples:341, Key West:330"),
  ],
};

/** Every state, DC and territory, A–Z by code (PR and VI last). Pages render only for live pairs. */
export const STATE_AREAS: StateAreas[] = [
  one("AL", "alabama", "Alabama", "From the Tennessee Valley to the Gulf Coast.", "Birmingham:352, Huntsville:358, Montgomery:361, Mobile:366, Tuscaloosa:354, Auburn:368, Dothan:363"),
  one("AK", "alaska", "Alaska", "Anchorage, the Mat-Su Valley and the Interior.", "Anchorage:995, Wasilla:996, Fairbanks:997, Juneau:998"),
  {
    code: "AZ", slug: "arizona", name: "Arizona",
    areas: [
      area("phoenix-area", "Phoenix area", "The Valley of the Sun, from Glendale to Mesa.", "Phoenix:850, Mesa:852, Chandler:852, Scottsdale:852, Glendale:853, Gilbert:852, Tempe:852, Peoria:853"),
      area("southern-and-northern-arizona", "Southern & Northern Arizona", "Tucson, Yuma, Flagstaff and Prescott.", "Tucson:857, Yuma:853, Flagstaff:860, Prescott:863, Sierra Vista:856, Lake Havasu City:864"),
    ],
  },
  one("AR", "arkansas", "Arkansas", "Central Arkansas, the Northwest corridor and the Delta.", "Little Rock:722, Fayetteville:727, Fort Smith:729, Springdale:727, Jonesboro:724, Rogers:727, Conway:720"),
  {
    code: "CA", slug: "california", name: "California",
    areas: [
      area("southern-california", "Southern California", "Los Angeles, Orange County, the Inland Empire and San Diego.", "Los Angeles:900, San Diego:921, Long Beach:908, Anaheim:928, Irvine:926, Riverside:925, Santa Ana:927, San Bernardino:924, Pasadena:911, Torrance:905"),
      area("northern-california", "Northern California", "The Bay Area, Sacramento and up to the Oregon line.", "San Jose:951, San Francisco:941, Oakland:946, Sacramento:958, Fremont:945, Santa Rosa:954, Walnut Creek:945, Redding:960"),
      area("central-california", "Central California", "The Central Valley and the Central Coast.", "Fresno:937, Bakersfield:933, Stockton:952, Modesto:953, Visalia:932, San Luis Obispo:934, Santa Barbara:931, Salinas:939"),
    ],
  },
  {
    code: "CO", slug: "colorado", name: "Colorado",
    areas: [
      area("front-range", "Front Range", "Denver, Boulder, Colorado Springs and Fort Collins.", "Denver:802, Colorado Springs:809, Aurora:800, Fort Collins:805, Lakewood:802, Boulder:803, Longmont:805, Pueblo:810"),
      area("western-colorado", "Western Colorado", "The Western Slope and the mountain towns.", "Grand Junction:815, Durango:813, Glenwood Springs:816, Steamboat Springs:804, Montrose:814"),
    ],
  },
  one("CT", "connecticut", "Connecticut", "Fairfield County to Hartford and the shoreline.", "Bridgeport:066, New Haven:065, Stamford:069, Hartford:061, Waterbury:067, Norwalk:068, Danbury:068, New London:063"),
  one("DE", "delaware", "Delaware", "Wilmington, Dover and the beaches.", "Wilmington:198, Dover:199, Newark:197, Middletown:197, Lewes:199"),
  one("DC", "district-of-columbia", "District of Columbia", "Every neighborhood in the District.", "Washington:200"),
  FLORIDA,
  {
    code: "GA", slug: "georgia", name: "Georgia",
    areas: [
      area("metro-atlanta", "Metro Atlanta", "Atlanta and its suburbs, from Marietta to Lawrenceville.", "Atlanta:303, Marietta:300, Alpharetta:300, Sandy Springs:303, Roswell:300, Lawrenceville:300, Decatur:300, Kennesaw:301"),
      area("rest-of-georgia", "Rest of Georgia", "Savannah, Augusta, Macon, Columbus and Athens.", "Augusta:309, Columbus:319, Savannah:314, Athens:306, Macon:312, Albany:317, Valdosta:316"),
    ],
  },
  one("HI", "hawaii", "Hawaii", "Oahu, Maui, the Big Island and Kauai.", "Honolulu:968, Kailua:967, Hilo:967, Kahului:967, Kona:967, Lihue:967"),
  one("ID", "idaho", "Idaho", "The Treasure Valley, North Idaho and the Snake River Plain.", "Boise:837, Meridian:836, Nampa:836, Idaho Falls:834, Pocatello:832, Coeur d'Alene:838, Twin Falls:833"),
  {
    code: "IL", slug: "illinois", name: "Illinois",
    areas: [
      area("chicagoland", "Chicagoland", "Chicago and the collar counties.", "Chicago:606, Aurora:605, Naperville:605, Joliet:604, Elgin:601, Waukegan:600, Schaumburg:601, Evanston:602"),
      area("central-and-southern-illinois", "Central & Southern Illinois", "Rockford, Peoria, Springfield and down to the Metro East.", "Rockford:611, Peoria:616, Springfield:627, Champaign:618, Bloomington:617, Belleville:622, Carbondale:629"),
    ],
  },
  one("IN", "indiana", "Indiana", "Indianapolis, Fort Wayne, the Region and Southern Indiana.", "Indianapolis:462, Fort Wayne:468, Evansville:477, South Bend:466, Carmel:460, Fishers:460, Bloomington:474, Lafayette:479"),
  one("IA", "iowa", "Iowa", "Des Moines, the Corridor and the Quad Cities.", "Des Moines:503, Cedar Rapids:524, Davenport:528, Sioux City:511, Iowa City:522, Waterloo:507, Ames:500, Dubuque:520"),
  one("KS", "kansas", "Kansas", "Kansas City suburbs, Wichita and Topeka.", "Wichita:672, Overland Park:662, Kansas City:661, Olathe:660, Topeka:666, Lawrence:660, Manhattan:665"),
  one("KY", "kentucky", "Kentucky", "Louisville, the Bluegrass and Northern Kentucky.", "Louisville:402, Lexington:405, Bowling Green:421, Owensboro:423, Covington:410, Richmond:404, Elizabethtown:427"),
  one("LA", "louisiana", "Louisiana", "New Orleans, Baton Rouge, Acadiana and North Louisiana.", "New Orleans:701, Baton Rouge:708, Shreveport:711, Lafayette:705, Lake Charles:706, Metairie:700, Monroe:712"),
  one("ME", "maine", "Maine", "Southern Maine to Bangor and beyond.", "Portland:041, Lewiston:042, Bangor:044, South Portland:041, Auburn:042, Augusta:043"),
  one("MD", "maryland", "Maryland", "Baltimore, the D.C. suburbs and the Eastern Shore.", "Baltimore:212, Frederick:217, Rockville:208, Gaithersburg:208, Silver Spring:209, Annapolis:214, Columbia:210, Salisbury:218"),
  {
    code: "MA", slug: "massachusetts", name: "Massachusetts",
    areas: [
      area("greater-boston", "Greater Boston", "Boston, the North and South Shores and MetroWest.", "Boston:021, Cambridge:021, Quincy:021, Lowell:018, Newton:024, Framingham:017, Brockton:023, Lynn:019"),
      area("central-and-western-massachusetts", "Central & Western Massachusetts", "Worcester, Springfield, the Berkshires and the Cape.", "Worcester:016, Springfield:011, New Bedford:027, Fall River:027, Pittsfield:012, Hyannis:026"),
    ],
  },
  {
    code: "MI", slug: "michigan", name: "Michigan",
    areas: [
      area("southeast-michigan", "Southeast Michigan", "Detroit, Oakland and Macomb counties and Ann Arbor.", "Detroit:482, Warren:480, Sterling Heights:483, Ann Arbor:481, Dearborn:481, Troy:480, Livonia:481, Southfield:480"),
      area("west-and-northern-michigan", "West & Northern Michigan", "Grand Rapids, Lansing, Kalamazoo and up north.", "Grand Rapids:495, Lansing:489, Kalamazoo:490, Flint:485, Saginaw:486, Traverse City:496, Marquette:498"),
    ],
  },
  one("MN", "minnesota", "Minnesota", "The Twin Cities, Rochester, St. Cloud and Duluth.", "Minneapolis:554, St. Paul:551, Rochester:559, Bloomington:554, Duluth:558, St. Cloud:563, Mankato:560, Eagan:551"),
  one("MS", "mississippi", "Mississippi", "Jackson, the Gulf Coast and North Mississippi.", "Jackson:392, Gulfport:395, Southaven:386, Hattiesburg:394, Biloxi:395, Tupelo:388, Oxford:386"),
  {
    code: "MO", slug: "missouri", name: "Missouri",
    areas: [
      area("st-louis-and-eastern-missouri", "St. Louis & Eastern Missouri", "St. Louis city and county, St. Charles and Cape Girardeau.", "St. Louis:631, St. Charles:633, Chesterfield:630, O'Fallon:633, Florissant:630, Cape Girardeau:637"),
      area("kansas-city-and-western-missouri", "Kansas City & Western Missouri", "Kansas City, Springfield, Columbia and Joplin.", "Kansas City:641, Springfield:658, Independence:640, Columbia:652, Lee's Summit:640, Joplin:648"),
    ],
  },
  one("MT", "montana", "Montana", "Billings, Missoula, Bozeman and the rest of Big Sky Country.", "Billings:591, Missoula:598, Great Falls:594, Bozeman:597, Butte:597, Helena:596, Kalispell:599"),
  one("NE", "nebraska", "Nebraska", "Omaha, Lincoln and out across the state.", "Omaha:681, Lincoln:685, Bellevue:680, Grand Island:688, Kearney:688, North Platte:691"),
  one("NV", "nevada", "Nevada", "Las Vegas Valley, Reno and Carson City.", "Las Vegas:891, Henderson:890, Reno:895, North Las Vegas:890, Sparks:894, Carson City:897"),
  one("NH", "new-hampshire", "New Hampshire", "Southern New Hampshire, the Seacoast and the Lakes Region.", "Manchester:031, Nashua:030, Concord:033, Dover:038, Portsmouth:038, Keene:034"),
  {
    code: "NJ", slug: "new-jersey", name: "New Jersey",
    areas: [
      area("north-jersey", "North Jersey", "Newark, Jersey City, Bergen and Morris counties.", "Newark:071, Jersey City:073, Paterson:075, Elizabeth:072, Hackensack:076, Morristown:079, Clifton:070"),
      area("central-and-south-jersey", "Central & South Jersey", "New Brunswick, Trenton, the Shore and the Philadelphia suburbs.", "Edison:088, Toms River:087, Trenton:086, New Brunswick:089, Cherry Hill:080, Camden:081, Atlantic City:084, Princeton:085"),
    ],
  },
  one("NM", "new-mexico", "New Mexico", "Albuquerque, Santa Fe, Las Cruces and beyond.", "Albuquerque:871, Las Cruces:880, Rio Rancho:871, Santa Fe:875, Roswell:882, Farmington:874"),
  {
    code: "NY", slug: "new-york", name: "New York",
    areas: [
      area("new-york-city-and-long-island", "New York City & Long Island", "The five boroughs, Long Island and Westchester.", "New York:100, Brooklyn:112, Queens:113, Bronx:104, Staten Island:103, Hempstead:115, White Plains:106, Yonkers:107"),
      area("upstate-new-york", "Upstate New York", "The Capital Region, Hudson Valley, Central and Western New York.", "Buffalo:142, Rochester:146, Syracuse:132, Albany:122, Poughkeepsie:126, Binghamton:139, Utica:135, Ithaca:148"),
    ],
  },
  {
    code: "NC", slug: "north-carolina", name: "North Carolina",
    areas: [
      area("charlotte-and-the-triad", "Charlotte & the Triad", "Charlotte, Greensboro, Winston-Salem and the western mountains.", "Charlotte:282, Greensboro:274, Winston-Salem:271, High Point:272, Concord:280, Gastonia:280, Asheville:288, Hickory:286"),
      area("raleigh-durham-and-the-east", "Raleigh-Durham & the East", "The Triangle, Fayetteville and the coast.", "Raleigh:276, Durham:277, Cary:275, Fayetteville:283, Wilmington:284, Greenville:278, Chapel Hill:275, Jacksonville:285"),
    ],
  },
  one("ND", "north-dakota", "North Dakota", "Fargo, Bismarck, Grand Forks and Minot.", "Fargo:581, Bismarck:585, Grand Forks:582, Minot:587, West Fargo:580, Williston:588"),
  {
    code: "OH", slug: "ohio", name: "Ohio",
    areas: [
      area("northern-ohio", "Northern Ohio", "Cleveland, Akron, Toledo and Youngstown.", "Cleveland:441, Toledo:436, Akron:443, Parma:441, Canton:447, Youngstown:445, Lorain:440, Mentor:440"),
      area("central-and-southern-ohio", "Central & Southern Ohio", "Columbus, Cincinnati and Dayton.", "Columbus:432, Cincinnati:452, Dayton:454, Hamilton:450, Springfield:455, Dublin:430, Athens:457"),
    ],
  },
  one("OK", "oklahoma", "Oklahoma", "Oklahoma City, Tulsa and every corner between.", "Oklahoma City:731, Tulsa:741, Norman:730, Broken Arrow:740, Edmond:730, Lawton:735, Stillwater:740"),
  one("OR", "oregon", "Oregon", "Portland, the Willamette Valley, Central and Southern Oregon.", "Portland:972, Salem:973, Eugene:974, Gresham:970, Hillsboro:971, Bend:977, Medford:975, Corvallis:973"),
  {
    code: "PA", slug: "pennsylvania", name: "Pennsylvania",
    areas: [
      area("eastern-pennsylvania", "Eastern Pennsylvania", "Philadelphia and its suburbs, the Lehigh Valley and Scranton.", "Philadelphia:191, Allentown:181, Reading:196, Scranton:185, Bethlehem:180, Lancaster:176, King of Prussia:194, Wilkes-Barre:187"),
      area("central-and-western-pennsylvania", "Central & Western Pennsylvania", "Pittsburgh, Harrisburg, Erie and State College.", "Pittsburgh:152, Harrisburg:171, Erie:165, State College:168, York:174, Altoona:166, Johnstown:159"),
    ],
  },
  one("RI", "rhode-island", "Rhode Island", "Providence to Newport and South County.", "Providence:029, Warwick:028, Cranston:029, Pawtucket:028, Newport:028, Westerly:028"),
  one("SC", "south-carolina", "South Carolina", "The Upstate, the Midlands and the Lowcountry.", "Charleston:294, Columbia:292, Greenville:296, Myrtle Beach:295, Rock Hill:297, Spartanburg:293, Hilton Head Island:299"),
  one("SD", "south-dakota", "South Dakota", "Sioux Falls, Rapid City and the towns between.", "Sioux Falls:571, Rapid City:577, Aberdeen:574, Brookings:570, Watertown:572"),
  {
    code: "TN", slug: "tennessee", name: "Tennessee",
    areas: [
      area("middle-tennessee", "Middle Tennessee", "Nashville, Murfreesboro, Franklin and Clarksville.", "Nashville:372, Murfreesboro:371, Franklin:370, Clarksville:370, Hendersonville:370, Cookeville:385"),
      area("east-and-west-tennessee", "East & West Tennessee", "Knoxville, Chattanooga, the Tri-Cities and Memphis.", "Memphis:381, Knoxville:379, Chattanooga:374, Johnson City:376, Kingsport:376, Jackson:383"),
    ],
  },
  {
    code: "TX", slug: "texas", name: "Texas",
    areas: [
      area("dallas-fort-worth", "Dallas-Fort Worth", "The Metroplex, from Fort Worth to Plano and McKinney.", "Dallas:752, Fort Worth:761, Arlington:760, Plano:750, Frisco:750, Irving:750, McKinney:750, Denton:762"),
      area("houston-and-southeast-texas", "Houston & Southeast Texas", "Greater Houston, Beaumont and the Gulf Coast.", "Houston:770, The Woodlands:773, Sugar Land:774, Pasadena:775, Katy:774, Beaumont:777, Galveston:775"),
      area("austin-and-san-antonio", "Austin & San Antonio", "Central Texas and the Hill Country.", "San Antonio:782, Austin:787, Round Rock:786, New Braunfels:781, San Marcos:786, Georgetown:786, Waco:767, Killeen:765"),
      area("south-and-west-texas", "South & West Texas", "El Paso, the Valley, Corpus Christi and the Panhandle.", "El Paso:799, Corpus Christi:784, Lubbock:794, Laredo:780, McAllen:785, Amarillo:791, Brownsville:785, Midland:797"),
    ],
  },
  one("UT", "utah", "Utah", "The Wasatch Front, Utah County and St. George.", "Salt Lake City:841, West Valley City:841, Provo:846, West Jordan:840, Orem:840, Sandy:840, Ogden:844, St. George:847"),
  one("VT", "vermont", "Vermont", "Burlington, Montpelier and the rest of the Green Mountain State.", "Burlington:054, South Burlington:054, Rutland:057, Montpelier:056, Brattleboro:053"),
  {
    code: "VA", slug: "virginia", name: "Virginia",
    areas: [
      area("northern-virginia", "Northern Virginia", "Fairfax, Arlington, Loudoun and Prince William.", "Arlington:222, Alexandria:223, Fairfax:220, Reston:201, Ashburn:201, Manassas:201, Woodbridge:221"),
      area("central-and-coastal-virginia", "Central & Coastal Virginia", "Richmond, Hampton Roads, Charlottesville and Roanoke.", "Virginia Beach:234, Norfolk:235, Chesapeake:233, Richmond:232, Newport News:236, Roanoke:240, Charlottesville:229, Lynchburg:245"),
    ],
  },
  {
    code: "WA", slug: "washington", name: "Washington",
    areas: [
      area("puget-sound", "Puget Sound", "Seattle, Tacoma, Bellevue and Everett.", "Seattle:981, Tacoma:984, Bellevue:980, Kent:980, Everett:982, Renton:980, Olympia:985, Bellingham:982"),
      area("eastern-washington", "Eastern Washington", "Spokane, the Tri-Cities and Yakima.", "Spokane:992, Kennewick:993, Yakima:989, Richland:993, Wenatchee:988, Walla Walla:993"),
    ],
  },
  one("WV", "west-virginia", "West Virginia", "Charleston, Huntington, Morgantown and the Eastern Panhandle.", "Charleston:253, Huntington:257, Morgantown:265, Parkersburg:261, Wheeling:260, Martinsburg:254"),
  one("WI", "wisconsin", "Wisconsin", "Milwaukee, Madison, the Fox Valley and Green Bay.", "Milwaukee:532, Madison:537, Green Bay:543, Kenosha:531, Racine:534, Appleton:549, Waukesha:531, Eau Claire:547"),
  one("WY", "wyoming", "Wyoming", "Cheyenne, Casper and the towns across the state.", "Cheyenne:820, Casper:826, Laramie:820, Gillette:827, Rock Springs:829, Sheridan:828"),
  one("PR", "puerto-rico", "Puerto Rico", "San Juan metro and across the island.", "San Juan:009, Bayamón:009, Carolina:009, Ponce:007, Caguas:007, Mayagüez:006, Arecibo:006"),
  one("VI", "us-virgin-islands", "U.S. Virgin Islands", "St. Thomas, St. Croix and St. John.", "Charlotte Amalie:008, Christiansted:008, Frederiksted:008, Cruz Bay:008"),
];
