/**
 * Starter city lists for registry discovery when a state goes into Growth prelaunch with
 * no cities yet. Larger population centers first; admins edit the list per target.
 */
export const STATE_CITIES: Record<string, string[]> = {
  AL: ["Birmingham", "Huntsville", "Montgomery", "Mobile", "Tuscaloosa", "Hoover", "Auburn", "Dothan", "Madison", "Decatur"],
  AK: ["Anchorage", "Fairbanks", "Juneau", "Wasilla", "Palmer", "Kenai", "Soldotna", "Ketchikan"],
  AZ: ["Phoenix", "Tucson", "Mesa", "Chandler", "Scottsdale", "Gilbert", "Glendale", "Tempe", "Peoria", "Surprise", "Flagstaff", "Prescott", "Yuma"],
  AR: ["Little Rock", "Fayetteville", "Fort Smith", "Springdale", "Jonesboro", "Rogers", "Conway", "Bentonville", "North Little Rock", "Hot Springs"],
  CA: ["Los Angeles", "San Diego", "San Jose", "San Francisco", "Fresno", "Sacramento", "Long Beach", "Oakland", "Bakersfield", "Anaheim", "Irvine", "Santa Ana", "Riverside", "Fremont", "Torrance", "Pasadena", "Santa Monica", "Walnut Creek", "Santa Barbara", "Santa Rosa"],
  CO: ["Denver", "Colorado Springs", "Aurora", "Fort Collins", "Lakewood", "Boulder", "Littleton", "Highlands Ranch", "Arvada", "Westminster", "Pueblo", "Grand Junction"],
  CT: ["Bridgeport", "New Haven", "Stamford", "Hartford", "Waterbury", "Norwalk", "Danbury", "Greenwich", "West Hartford", "Glastonbury"],
  DE: ["Wilmington", "Dover", "Newark", "Middletown", "Lewes", "Rehoboth Beach", "Milford"],
  DC: ["Washington"],
  FL: ["Orlando", "Tampa", "Jacksonville", "Miami", "Fort Lauderdale", "St Petersburg", "Sarasota", "Naples", "Fort Myers", "West Palm Beach", "Boca Raton", "Tallahassee", "Gainesville", "Pensacola", "Melbourne", "Daytona Beach"],
  GA: ["Atlanta", "Marietta", "Alpharetta", "Savannah", "Augusta", "Columbus", "Macon", "Athens", "Roswell", "Lawrenceville", "Kennesaw", "Peachtree City"],
  HI: ["Honolulu", "Kailua", "Hilo", "Kahului", "Kapolei", "Pearl City", "Kihei", "Lihue"],
  ID: ["Boise", "Meridian", "Nampa", "Idaho Falls", "Coeur d'Alene", "Pocatello", "Twin Falls", "Eagle"],
  IL: ["Chicago", "Naperville", "Aurora", "Rockford", "Joliet", "Schaumburg", "Springfield", "Peoria", "Champaign", "Oak Brook", "Arlington Heights", "Evanston"],
  IN: ["Indianapolis", "Fort Wayne", "Evansville", "Carmel", "Fishers", "South Bend", "Bloomington", "Lafayette", "Noblesville", "Greenwood"],
  IA: ["Des Moines", "Cedar Rapids", "Davenport", "Iowa City", "West Des Moines", "Ankeny", "Sioux City", "Waterloo", "Ames", "Dubuque"],
  KS: ["Wichita", "Overland Park", "Kansas City", "Olathe", "Topeka", "Lawrence", "Lenexa", "Manhattan", "Shawnee", "Salina"],
  KY: ["Louisville", "Lexington", "Bowling Green", "Owensboro", "Covington", "Florence", "Richmond", "Elizabethtown", "Paducah", "Frankfort"],
  LA: ["New Orleans", "Baton Rouge", "Shreveport", "Lafayette", "Lake Charles", "Metairie", "Kenner", "Covington", "Monroe", "Mandeville"],
  ME: ["Portland", "Bangor", "Lewiston", "South Portland", "Auburn", "Augusta", "Biddeford", "Brunswick", "Scarborough"],
  MD: ["Baltimore", "Columbia", "Silver Spring", "Rockville", "Frederick", "Bethesda", "Annapolis", "Towson", "Gaithersburg", "Ellicott City", "Bel Air", "Salisbury"],
  MA: ["Boston", "Worcester", "Springfield", "Cambridge", "Lowell", "Newton", "Quincy", "Framingham", "Plymouth", "Burlington", "Wellesley", "Hyannis"],
  MI: ["Detroit", "Grand Rapids", "Ann Arbor", "Lansing", "Troy", "Southfield", "Kalamazoo", "Novi", "Rochester Hills", "Livonia", "Traverse City", "Flint"],
  MN: ["Minneapolis", "St Paul", "Rochester", "Bloomington", "Duluth", "Eden Prairie", "Maple Grove", "Woodbury", "Plymouth", "St Cloud", "Edina", "Eagan"],
  MS: ["Jackson", "Gulfport", "Hattiesburg", "Southaven", "Biloxi", "Tupelo", "Ridgeland", "Madison", "Oxford", "Meridian"],
  MO: ["Kansas City", "St Louis", "Springfield", "Columbia", "Independence", "Lee's Summit", "Chesterfield", "O'Fallon", "St Charles", "Joplin"],
  MT: ["Billings", "Missoula", "Bozeman", "Great Falls", "Helena", "Kalispell", "Butte", "Whitefish"],
  NE: ["Omaha", "Lincoln", "Bellevue", "Grand Island", "Kearney", "Papillion", "Norfolk", "North Platte"],
  NV: ["Las Vegas", "Henderson", "Reno", "North Las Vegas", "Sparks", "Carson City", "Summerlin", "Elko"],
  NH: ["Manchester", "Nashua", "Concord", "Portsmouth", "Dover", "Salem", "Keene", "Bedford", "Londonderry"],
  NJ: ["Newark", "Jersey City", "Paterson", "Edison", "Toms River", "Morristown", "Hackensack", "Princeton", "Cherry Hill", "Red Bank", "Freehold", "Paramus"],
  NM: ["Albuquerque", "Las Cruces", "Santa Fe", "Rio Rancho", "Roswell", "Farmington", "Clovis", "Los Alamos"],
  NY: ["New York", "Brooklyn", "Buffalo", "Rochester", "Syracuse", "Albany", "Yonkers", "White Plains", "Long Island City", "Huntington", "Garden City", "Staten Island", "Ithaca", "Saratoga Springs"],
  NC: ["Charlotte", "Raleigh", "Greensboro", "Durham", "Winston-Salem", "Cary", "Wilmington", "Asheville", "Fayetteville", "Chapel Hill", "Huntersville", "Mooresville"],
  ND: ["Fargo", "Bismarck", "Grand Forks", "Minot", "West Fargo", "Williston", "Dickinson", "Mandan"],
  OH: ["Columbus", "Cleveland", "Cincinnati", "Toledo", "Akron", "Dayton", "Dublin", "Westerville", "Mason", "Canton", "Youngstown", "Strongsville"],
  OK: ["Oklahoma City", "Tulsa", "Norman", "Broken Arrow", "Edmond", "Lawton", "Moore", "Stillwater", "Owasso", "Enid"],
  OR: ["Portland", "Eugene", "Salem", "Bend", "Beaverton", "Hillsboro", "Medford", "Lake Oswego", "Corvallis", "Tigard"],
  PA: ["Philadelphia", "Pittsburgh", "Allentown", "Harrisburg", "Lancaster", "Erie", "Reading", "Scranton", "State College", "King of Prussia", "West Chester", "Bethlehem"],
  PR: ["San Juan", "Bayamón", "Carolina", "Ponce", "Caguas", "Guaynabo", "Arecibo", "Mayagüez", "Trujillo Alto", "Humacao"],
  VI: ["Charlotte Amalie", "Christiansted", "Frederiksted", "Cruz Bay"],
  RI: ["Providence", "Warwick", "Cranston", "Pawtucket", "Newport", "East Providence", "Woonsocket", "Westerly"],
  SC: ["Charleston", "Columbia", "Greenville", "Myrtle Beach", "Mount Pleasant", "Rock Hill", "Spartanburg", "Summerville", "Hilton Head Island", "Florence"],
  SD: ["Sioux Falls", "Rapid City", "Aberdeen", "Brookings", "Watertown", "Mitchell", "Spearfish"],
  TN: ["Nashville", "Memphis", "Knoxville", "Chattanooga", "Clarksville", "Murfreesboro", "Franklin", "Brentwood", "Johnson City", "Jackson", "Hendersonville"],
  TX: ["Houston", "Dallas", "San Antonio", "Austin", "Fort Worth", "Plano", "Frisco", "Arlington", "El Paso", "Corpus Christi", "The Woodlands", "Sugar Land", "Round Rock", "McKinney", "Lubbock", "Katy"],
  UT: ["Salt Lake City", "Provo", "West Jordan", "Orem", "Sandy", "St George", "Ogden", "Lehi", "Layton", "Draper", "Logan"],
  VT: ["Burlington", "South Burlington", "Rutland", "Montpelier", "Brattleboro", "Essex Junction", "Williston", "St Albans"],
  VA: ["Virginia Beach", "Richmond", "Arlington", "Norfolk", "Chesapeake", "Alexandria", "Fairfax", "Reston", "Roanoke", "Charlottesville", "Leesburg", "Williamsburg"],
  WA: ["Seattle", "Spokane", "Tacoma", "Bellevue", "Vancouver", "Kent", "Everett", "Redmond", "Kirkland", "Olympia", "Bellingham", "Yakima"],
  WV: ["Charleston", "Huntington", "Morgantown", "Parkersburg", "Wheeling", "Martinsburg", "Beckley", "Bridgeport"],
  WI: ["Milwaukee", "Madison", "Green Bay", "Kenosha", "Appleton", "Waukesha", "Eau Claire", "Oshkosh", "Brookfield", "La Crosse"],
  WY: ["Cheyenne", "Casper", "Laramie", "Gillette", "Rock Springs", "Sheridan", "Jackson"],
};

/**
 * Canada (prospecting only; the marketplace isn't open there): starter cities per province with
 * fixed centers, because address geocoding is limited to the U.S. and its territories. Used by
 * ensureMarkets and to place Canadian prospects in a market.
 */
export const CA_CITY_CENTERS: Record<string, [string, number, number][]> = {
  ON: [["Toronto", 43.6532, -79.3832], ["Ottawa", 45.4215, -75.6972], ["Mississauga", 43.589, -79.6441], ["Hamilton", 43.2557, -79.8711], ["London", 42.9849, -81.2453], ["Kitchener", 43.4516, -80.4925]],
  QC: [["Montreal", 45.5019, -73.5674], ["Quebec City", 46.8139, -71.208], ["Laval", 45.6066, -73.7124], ["Gatineau", 45.4765, -75.7013], ["Sherbrooke", 45.4042, -71.8929]],
  BC: [["Vancouver", 49.2827, -123.1207], ["Surrey", 49.1913, -122.849], ["Burnaby", 49.2488, -122.9805], ["Victoria", 48.4284, -123.3656], ["Kelowna", 49.888, -119.496]],
  AB: [["Calgary", 51.0447, -114.0719], ["Edmonton", 53.5461, -113.4938], ["Red Deer", 52.2681, -113.8112], ["Lethbridge", 49.6956, -112.8451]],
  MB: [["Winnipeg", 49.8951, -97.1384], ["Brandon", 49.8485, -99.9501]],
  SK: [["Saskatoon", 52.1579, -106.6702], ["Regina", 50.4452, -104.6189]],
  NS: [["Halifax", 44.6488, -63.5752], ["Sydney", 46.1368, -60.1942]],
  NB: [["Moncton", 46.0878, -64.7782], ["Saint John", 45.2733, -66.0633], ["Fredericton", 45.9636, -66.6431]],
  NL: [["St. John's", 47.5615, -52.7126]],
  PE: [["Charlottetown", 46.2382, -63.1311]],
  YT: [["Whitehorse", 60.7212, -135.0568]],
  NT: [["Yellowknife", 62.454, -114.3718]],
  NU: [["Iqaluit", 63.7467, -68.517]],
};
for (const [prov, list] of Object.entries(CA_CITY_CENTERS)) STATE_CITIES[prov] = list.map(([c]) => c);

/** A Canadian city's center from the starter list (null for other cities or U.S. regions). */
export function canadianCityCenter(region: string, city: string | null | undefined) {
  if (!city) return null;
  const hit = CA_CITY_CENTERS[region.toUpperCase()]?.find(([c]) => c.toLowerCase() === city.trim().toLowerCase());
  return hit ? { lat: hit[1], lng: hit[2] } : null;
}
