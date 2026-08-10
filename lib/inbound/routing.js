/**
 * Where a lead is, and whose queue that puts them in.
 *
 * Nothing in the database records a country for most companies (`hq_country` is
 * null on 41 of 51) and nothing anywhere records an owner, so territory is
 * derived here, in the frontend, from whatever the row happens to carry. When
 * stage 1 starts writing a real `hq_country` this file shrinks to the rep table
 * and the region map.
 *
 * ponytail: heuristic geocoder. Ceiling — it only knows the places our traffic
 * has actually come from. Upgrade path is a country column filled by the
 * pipeline, not a longer table here.
 */

/** A two-letter code means one thing in RB2B's `state` field: the US state. */
const US = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY",
  "LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH",
  "OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
  "ALABAMA","ALASKA","ARIZONA","ARKANSAS","CALIFORNIA","COLORADO","CONNECTICUT","DELAWARE",
  "FLORIDA","GEORGIA","HAWAII","IDAHO","ILLINOIS","INDIANA","IOWA","KANSAS","KENTUCKY",
  "LOUISIANA","MAINE","MARYLAND","MASSACHUSETTS","MICHIGAN","MINNESOTA","MISSISSIPPI",
  "MISSOURI","MONTANA","NEBRASKA","NEVADA","NEW HAMPSHIRE","NEW JERSEY","NEW MEXICO",
  "NEW YORK","NORTH CAROLINA","NORTH DAKOTA","OHIO","OKLAHOMA","OREGON","PENNSYLVANIA",
  "RHODE ISLAND","SOUTH CAROLINA","SOUTH DAKOTA","TENNESSEE","TEXAS","UTAH","VERMONT",
  "VIRGINIA","WASHINGTON","WEST VIRGINIA","WISCONSIN","WYOMING","DISTRICT OF COLUMBIA",
]);

/** No Canadian province code collides with a US state code, so these can go first. */
const CANADA = new Set([
  "ON","QC","BC","AB","MB","SK","NS","NB","NL","PE","NT","YT","NU",
  "ONTARIO","QUEBEC","BRITISH COLUMBIA","ALBERTA","MANITOBA","SASKATCHEWAN","NOVA SCOTIA",
  "NEW BRUNSWICK","NEWFOUNDLAND AND LABRADOR","PRINCE EDWARD ISLAND","NORTHWEST TERRITORIES",
  "YUKON","NUNAVUT",
]);

/** Mexican states arrive as three letters, which nothing else uses. */
const MEXICO = new Set([
  "AGU","BCN","BCS","CAM","CHP","CHH","CMX","COA","COL","DUR","GUA","GRO","HID","JAL","MEX",
  "MIC","MOR","NAY","NLE","OAX","PUE","QUE","ROO","SLP","SIN","SON","TAB","TAM","TLA","VER",
  "YUC","ZAC","DIF","CIUDAD DE MEXICO","JALISCO","NUEVO LEON",
]);

const UK = new Set([
  "ENG","SCT","WLS","NIR","LND","ENGLAND","SCOTLAND","WALES","NORTHERN IRELAND","GREATER LONDON",
]);

/**
 * The region codes below are read off the `state` field rather than the city,
 * because the cities they cover are ambiguous and the codes are not. Paris is
 * also a town in Texas; `IDF` is Île-de-France and nowhere else. Jakarta arrives
 * as "West Jakarta" and four other compass variants, none of which a city list
 * matches, while `JK` covers all of them at once.
 */
const FRANCE = new Set([
  "IDF","ARA","BFC","BRE","CVL","COR","GES","HDF","NOR","NAQ","OCC","PDL","PAC",
  "ILE-DE-FRANCE","ÎLE-DE-FRANCE",
]);

const INDONESIA = new Set([
  "JK","JB","JI","JT","BT","YO","BA","SN","SU","AC","RI","SS","LA","KI","KS","NB","NT","PA",
  "JAKARTA","WEST JAVA","EAST JAVA","CENTRAL JAVA","BANTEN","BALI",
]);

/** DU is unambiguous; AZ and SH are not, so Abu Dhabi and Sharjah ride on the city. */
const UAE_STATE = new Set(["DU","DUBAI","ABU DHABI","AJMAN","FUJAIRAH","RAS AL KHAIMAH","UMM AL QUWAIN"]);

/**
 * Cities that mean one country and nothing else. London, Birmingham, Manchester,
 * Cambridge, Windsor, Victoria and Hamilton are deliberately absent — each is two
 * places on two continents, and the state code settles them correctly.
 */
const CITY = {
  // Asia
  chennai: "IN", mumbai: "IN", bombay: "IN", bengaluru: "IN", bangalore: "IN", hyderabad: "IN",
  "new delhi": "IN", gurugram: "IN", gurgaon: "IN", noida: "IN", kolkata: "IN", ahmedabad: "IN",
  pune: "IN", kochi: "IN", jaipur: "IN",
  tokyo: "JP", osaka: "JP", yokohama: "JP", nagoya: "JP", kyoto: "JP",
  // A Yokohama ward. Its state arrives as the bare prefecture number "14", and a
  // bare number means something different in every country RB2B reports from —
  // "00" and "40" are Philippine — so the city is the only safe read here.
  sugita: "JP", kawasaki: "JP", sapporo: "JP", fukuoka: "JP", kobe: "JP",
  singapore: "SG", seoul: "KR", busan: "KR",
  shanghai: "CN", beijing: "CN", shenzhen: "CN", guangzhou: "CN", "hong kong": "HK", taipei: "TW",
  bangkok: "TH", jakarta: "ID", "kuala lumpur": "MY", "ho chi minh city": "VN",
  hanoi: "VN", karachi: "PK", lahore: "PK", dhaka: "BD", colombo: "LK",
  manila: "PH", "makati city": "PH", makati: "PH", "quezon city": "PH", "cebu city": "PH",
  "general trias": "PH", taguig: "PH", pasig: "PH",
  // Gulf
  dubai: "AE", "abu dhabi": "AE", sharjah: "AE", ajman: "AE",
  doha: "QA", riyadh: "SA", jeddah: "SA", "kuwait city": "KW", manama: "BH", muscat: "OM",
  "tel aviv": "IL", istanbul: "TR",
  // Mexico
  "mexico city": "MX", "ciudad de mexico": "MX", monterrey: "MX", guadalajara: "MX",
  tijuana: "MX", puebla: "MX", cancun: "MX", queretaro: "MX", merida: "MX",
  // Canada
  toronto: "CA", vancouver: "CA", montreal: "CA", calgary: "CA", ottawa: "CA", edmonton: "CA",
  winnipeg: "CA", mississauga: "CA", halifax: "CA", "quebec city": "CA",
  // UK + Ireland
  edinburgh: "GB", glasgow: "GB", leeds: "GB", liverpool: "GB", bristol: "GB", cardiff: "GB",
  belfast: "GB", sheffield: "GB", nottingham: "GB", dublin: "IE",
};

/**
 * Reserved by RFC 2606 and RFC 6761: these never resolve, so nothing under them
 * was ever a customer. Metro Harbor Properties (`metroharbor.example`) arrived
 * with a visit and a webhook row and is still a test — that is what testing the
 * webhook looks like.
 */
export const RESERVED_TLD = /\.(example|test|invalid|localhost)$/i;

/** A country-coded domain is a strong signal and costs nothing to read. */
const TLD = {
  ae: "AE", in: "IN", jp: "JP", sg: "SG", kr: "KR", cn: "CN", hk: "HK", tw: "TW", my: "MY",
  th: "TH", id: "ID", ph: "PH", vn: "VN", pk: "PK", qa: "QA", sa: "SA", kw: "KW", bh: "BH",
  om: "OM", il: "IL", tr: "TR", mx: "MX", ca: "CA", uk: "GB", gb: "GB", ie: "IE",
  de: "DE", fr: "FR", nl: "NL", es: "ES", it: "IT", se: "SE", ch: "CH", be: "BE", pl: "PL",
  au: "AU", nz: "NZ", za: "ZA", br: "BR", ar: "AR", cl: "CL",
};

const ASIA = new Set(["IN","JP","SG","KR","CN","HK","TW","MY","TH","ID","PH","VN","PK","BD","LK",
                      "QA","SA","KW","BH","OM","IL","TR"]);
const EU = new Set(["DE","FR","NL","ES","IT","SE","CH","BE","PL","IE","DK","NO","FI","AT","PT"]);

/** The five territories the rep table divides, plus the two ways a lead can miss. */
export const REGIONS = {
  US:      { label: "United States", short: "US" },
  CA:      { label: "Canada",        short: "CA" },
  MX:      { label: "Mexico",        short: "MX" },
  GB:      { label: "United Kingdom",short: "UK" },
  AE:      { label: "UAE",           short: "UAE" },
  ASIA:    { label: "Asia",          short: "Asia" },
  EU:      { label: "Europe",        short: "EU" },
  OTHER:   { label: "Elsewhere",     short: "Other" },
  UNKNOWN: { label: "No location",   short: "—" },
};

const regionOfCountry = (cc) => {
  if (!cc) return "UNKNOWN";
  const c = cc.toUpperCase();
  if (c === "US" || c === "USA" || c === "UNITED STATES") return "US";
  if (c === "CA" || c === "CANADA") return "CA";
  if (c === "MX" || c === "MEXICO") return "MX";
  if (c === "GB" || c === "UK" || c === "UNITED KINGDOM") return "GB";
  if (c === "AE" || c === "UAE") return "AE";
  if (ASIA.has(c)) return "ASIA";
  if (EU.has(c)) return "EU";
  return "OTHER";
};

const norm = (s) => (s ?? "").trim().toUpperCase();

/** City, then state code. Returns null when neither says anything. */
function fromPlace(city, state) {
  const byCity = CITY[(city ?? "").trim().toLowerCase()];
  if (byCity) return { region: regionOfCountry(byCity), basis: "city" };

  const s = norm(state);
  if (MEXICO.has(s)) return { region: "MX", basis: "state" };
  if (CANADA.has(s)) return { region: "CA", basis: "state" };
  if (UK.has(s)) return { region: "GB", basis: "state" };
  if (UAE_STATE.has(s)) return { region: "AE", basis: "state" };
  // Before the US check: no US state code collides with these, and reading them
  // late would have `IDF` and `JK` fall through to unrouted, which is what put
  // a Jakarta lead and a Tokyo-area lead in nobody's queue.
  if (INDONESIA.has(s)) return { region: "ASIA", basis: "state" };
  if (FRANCE.has(s)) return { region: "EU", basis: "state" };
  if (US.has(s)) return { region: "US", basis: "state" };
  return null;
}

/**
 * Read a lead's territory, best evidence first.
 *
 * The order is the whole trick, and each step earned its place against a real
 * row:
 *
 *   1. a country the pipeline actually recorded
 *   2. where the *person* was — RB2B geolocates the visitor, so this beats
 *      anything about the company. "Chennai, TN" is Tamil Nadu, not Tennessee;
 *      "London, ON" is Ontario, not England
 *   3. only then the domain — asistio.ca visits from General Trias in the
 *      Philippines, so a ccTLD read before the visitor's own city sends the
 *      lead to the wrong continent
 *   4. the city on the company row — which is *not* a head office. RB2B fills
 *      `hq_city`/`hq_state` from the browsing session, so on a company-level
 *      payload it is the visitor's city with no person attached: the same signal
 *      as step 2, arriving one row over. It routes for that reason, not because
 *      it says anything about where the company is
 *   5. where their buildings are — the only geography in the schema that is
 *      actually about the company, and the last resort precisely because it
 *      answers a different question. Barings reads "New York, NY" at step 4
 *      because someone browsed from there; its buildings are in DC, Charlotte,
 *      Franklin MA, Germany and Sweden, and a rep is not chasing Germany
 *
 * A person whose city and state we hold but cannot resolve stops at unknown
 * rather than falling through to the domain: an unrouted lead someone claims is
 * a better failure than a confident lead in the wrong queue.
 */
export function locate(person, company, buildings = []) {
  const city = (person?.city ?? "").trim();
  const state = person?.state ?? "";
  const place = [city || company?.hq_city, state || company?.hq_state].filter(Boolean).join(", ");

  const explicit = company?.hq_country;
  if (explicit) return { region: regionOfCountry(explicit), place, basis: "country on file" };

  if (city || state) {
    const hit = fromPlace(city, state);
    if (hit) return { ...hit, place };
    return { region: "UNKNOWN", place, basis: "unrecognised place" };
  }

  const tld = (company?.domain ?? "").split(".").pop()?.toLowerCase();
  if (tld && TLD[tld]) return { region: regionOfCountry(TLD[tld]), place, basis: "domain" };

  const hq = fromPlace(company?.hq_city, company?.hq_state);
  if (hq) return { ...hq, place, basis: `visiting ${hq.basis}` };

  // Whichever country the most buildings sit in. A portfolio split across two
  // countries routes to the larger half rather than to whichever row sorted
  // first, and `country` is filled by research rather than by a browser.
  const byCountry = new Map();
  for (const b of buildings) {
    const r = b?.country ? regionOfCountry(b.country) : fromPlace(b?.city, b?.state)?.region;
    if (r && r !== "UNKNOWN") byCountry.set(r, (byCountry.get(r) ?? 0) + 1);
  }
  const top = [...byCountry.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top) return { region: top[0], place, basis: "where their buildings are" };

  return { region: "UNKNOWN", place, basis: place ? "unrecognised place" : "nothing to go on" };
}

/**
 * The division, as given. Canada is worked by two people rather than split, so
 * a Canadian lead appears in both queues — the alternative is a rule nobody
 * agreed on deciding which of them sees it.
 */
export const REPS = [
  { id: "justin-kim", name: "Justin Kim", initials: "JK", tint: "var(--tint-1)",
    regions: ["MX", "GB", "CA"], role: "Mexico · UK · Canada" },
  { id: "gulraiz-khalid", name: "Gulraiz Khalid", initials: "GK", tint: "var(--tint-2)",
    regions: ["ASIA", "AE"], role: "Asia · UAE" },
  { id: "mark-dolan", name: "Mark Dolan", initials: "MD", tint: "var(--tint-3)",
    regions: ["CA"], role: "Canada" },
  { id: "mark-vasu", name: "Mark Vasu", initials: "MV", tint: "var(--tint-4)",
    regions: ["US"], role: "United States" },
];

/**
 * Anything outside the five territories — Europe, Australia, or a visitor whose
 * location never resolved — lands here rather than being force-fitted to a rep.
 * An unowned lead someone can claim is honest; a mis-routed one is not.
 */
export const UNROUTED = {
  id: "unrouted", name: "Unrouted", initials: "?", tint: "var(--tint-n)",
  regions: ["EU", "OTHER", "UNKNOWN"], role: "Outside the division",
};

export const ALL_REPS = [...REPS, UNROUTED];

/** Every rep who owns this region. Canada returns two; nowhere returns Unrouted. */
export function repsFor(region) {
  const owners = REPS.filter((r) => r.regions.includes(region));
  return owners.length ? owners : [UNROUTED];
}

export const repById = (id) => ALL_REPS.find((r) => r.id === id) ?? null;
