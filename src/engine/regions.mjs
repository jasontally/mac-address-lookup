/** Continent/region grouping for ISO 3166-1 alpha-2 registration countries. */

export const REGION_NAMES = {
  africa: 'Africa',
  americas: 'Americas',
  antarctica: 'Antarctica',
  asia: 'Asia',
  europe: 'Europe',
  oceania: 'Oceania',
};

/**
 * Registration-address region, not device location. Territories follow their
 * geographic continent; remote/sovereign bases use the nearest sensible group.
 */
export const COUNTRY_REGIONS = {
  // Africa
  AO: 'africa', BF: 'africa', BI: 'africa', BJ: 'africa', BW: 'africa', CD: 'africa',
  CF: 'africa', CG: 'africa', CI: 'africa', CM: 'africa', CV: 'africa', DJ: 'africa',
  DZ: 'africa', EG: 'africa', EH: 'africa', ER: 'africa', ET: 'africa', GA: 'africa',
  GH: 'africa', GM: 'africa', GN: 'africa', GQ: 'africa', GW: 'africa', KE: 'africa',
  KM: 'africa', LR: 'africa', LS: 'africa', LY: 'africa', MA: 'africa', MG: 'africa',
  ML: 'africa', MR: 'africa', MU: 'africa', MW: 'africa', MZ: 'africa', NA: 'africa',
  NE: 'africa', NG: 'africa', RE: 'africa', RW: 'africa', SC: 'africa', SD: 'africa',
  SH: 'africa', SL: 'africa', SN: 'africa', SO: 'africa', SS: 'africa', ST: 'africa',
  SZ: 'africa', TD: 'africa', TG: 'africa', TN: 'africa', TZ: 'africa', UG: 'africa',
  YT: 'africa', ZA: 'africa', ZM: 'africa', ZW: 'africa',

  // Americas
  AG: 'americas', AI: 'americas', AR: 'americas', AW: 'americas', BB: 'americas',
  BL: 'americas', BM: 'americas', BO: 'americas', BQ: 'americas', BR: 'americas',
  BS: 'americas', BZ: 'americas', CA: 'americas', CL: 'americas', CO: 'americas',
  CR: 'americas', CU: 'americas', CW: 'americas', DM: 'americas', DO: 'americas',
  EC: 'americas', FK: 'americas', GD: 'americas', GF: 'americas', GL: 'americas',
  GP: 'americas', GT: 'americas', GY: 'americas', HN: 'americas', HT: 'americas',
  JM: 'americas', KN: 'americas', KY: 'americas', LC: 'americas', MF: 'americas',
  MQ: 'americas', MS: 'americas', MX: 'americas', NI: 'americas', PA: 'americas',
  PE: 'americas', PM: 'americas', PR: 'americas', PY: 'americas', SR: 'americas',
  SV: 'americas', SX: 'americas', TC: 'americas', TT: 'americas', US: 'americas',
  UY: 'americas', VC: 'americas', VE: 'americas', VG: 'americas', VI: 'americas',

  // Antarctica and nearby sub-Antarctic territories
  AQ: 'antarctica', BV: 'antarctica', GS: 'antarctica', HM: 'antarctica', TF: 'antarctica',

  // Asia
  AE: 'asia', AF: 'asia', AM: 'asia', AZ: 'asia', BD: 'asia', BH: 'asia', BN: 'asia',
  BT: 'asia', CC: 'asia', CN: 'asia', CX: 'asia', GE: 'asia', HK: 'asia', ID: 'asia',
  IL: 'asia', IN: 'asia', IO: 'asia', IQ: 'asia', IR: 'asia', JO: 'asia', JP: 'asia',
  KG: 'asia', KH: 'asia', KP: 'asia', KR: 'asia', KW: 'asia', KZ: 'asia', LA: 'asia',
  LB: 'asia', LK: 'asia', MM: 'asia', MN: 'asia', MO: 'asia', MV: 'asia', MY: 'asia',
  NP: 'asia', OM: 'asia', PH: 'asia', PK: 'asia', PS: 'asia', QA: 'asia', SA: 'asia',
  SG: 'asia', SY: 'asia', TH: 'asia', TJ: 'asia', TL: 'asia', TM: 'asia', TR: 'asia',
  TW: 'asia', UZ: 'asia', VN: 'asia', YE: 'asia',

  // Europe
  AD: 'europe', AL: 'europe', AT: 'europe', AX: 'europe', BA: 'europe', BE: 'europe',
  BG: 'europe', CH: 'europe', CY: 'europe', CZ: 'europe', DE: 'europe', DK: 'europe',
  EE: 'europe', ES: 'europe', FI: 'europe', FO: 'europe', FR: 'europe', GB: 'europe',
  GG: 'europe', GI: 'europe', GR: 'europe', HR: 'europe', HU: 'europe', IE: 'europe',
  IM: 'europe', IS: 'europe', IT: 'europe', JE: 'europe', LI: 'europe', LT: 'europe',
  LU: 'europe', LV: 'europe', MC: 'europe', MD: 'europe', ME: 'europe', MK: 'europe',
  MT: 'europe', NL: 'europe', NO: 'europe', PL: 'europe', PT: 'europe', RO: 'europe',
  RS: 'europe', RU: 'europe', SE: 'europe', SI: 'europe', SJ: 'europe', SK: 'europe',
  SM: 'europe', UA: 'europe', VA: 'europe',

  // Oceania
  AS: 'oceania', AU: 'oceania', CK: 'oceania', FJ: 'oceania', FM: 'oceania',
  GU: 'oceania', KI: 'oceania', MH: 'oceania', MP: 'oceania', NC: 'oceania',
  NF: 'oceania', NR: 'oceania', NU: 'oceania', NZ: 'oceania', PF: 'oceania',
  PG: 'oceania', PN: 'oceania', PW: 'oceania', SB: 'oceania', TK: 'oceania',
  TO: 'oceania', TV: 'oceania', VU: 'oceania', WF: 'oceania', WS: 'oceania',
};

/** Region key for a country code, or `other` for unknown/missing values. */
export function regionForCountry(code) {
  if (!code) return 'other';
  const normalized = String(code).toUpperCase() === 'UK' ? 'GB' : String(code).toUpperCase();
  return COUNTRY_REGIONS[normalized] ?? 'other';
}

/** Display name for a region key; unknown values fall back to the key. */
export function regionName(key) {
  return REGION_NAMES[key] ?? (key === 'other' ? 'Other regions' : key);
}

/** Stable slug for `/region/<slug>` URLs. */
export function regionSlug(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'other';
}
