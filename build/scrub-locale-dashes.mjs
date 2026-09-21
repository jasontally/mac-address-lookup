/**
 * One-off: em-dash scrub across the remaining sources.
 *
 * en.mjs was hand-edited (per-case separators). This script mirrors the
 * same per-case choices in src/i18n/locales/*.mjs and src/i18n/seo.mjs:
 *
 *   title.match   "{org} — {colon} | brand" → "{org} ({colon}) | brand"
 *   title.search  "{query} — brand"          → "{query} | brand"
 *   title.recent  "<phrase> — brand"         → "<phrase> | brand"
 *   hub.h1.former "{org} — former ..."       → reuse title.formerHub phrase
 *     (identical rephrase in en: "Former {org} MAC address blocks")
 *   remaining sentence keys: " — " glue → ", " (footer, ledes, badges…)
 *   seo.mjs: title separators " — " → " | "; prose glue " — "/"——" → ", " / "，"
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const BRAND = {
  de: 'MAC-Adressen-Suche', es: 'Buscador de direcciones MAC', fr: 'Recherche d’adresse MAC',
  pt: 'Buscador de endereços MAC', 'zh-Hans': 'MAC 地址查询', 'zh-Hant': 'MAC 位址查詢',
  hi: 'MAC एड्रेस लुकअप', bn: 'MAC ঠিকানা লুকআপ', mr: 'MAC पत्ता लुकअप', ur: 'MAC ایڈریس لوک اپ',
  gu: 'MAC સરનામું લુકઅપ', pa: 'MAC ਪਤਾ ਲੁੱਕਅੱਪ', ta: 'MAC முகவரி தேடல்', te: 'MAC చిరునామా శోధన',
  kn: 'MAC ವಿಳಾಸ ಹುಡುಕಾಟ', ml: 'MAC വിലാസം തിരച്ചിൽ', ru: 'Поиск MAC-адресов', ja: 'MACアドレス検索',
  ko: 'MAC 주소 조회', tr: 'MAC Adresi Sorgulama', vi: 'Tra cứu địa chỉ MAC', it: 'Ricerca indirizzi MAC',
  ar: 'البحث عن عناوين MAC', sw: 'Utafutaji wa Anwani za MAC', id: 'Pencarian Alamat MAC',
  ha: 'Binciken Adiresoshin MAC', pl: 'Wyszukiwanie adresów MAC', fa: 'جستجوی آدرس MAC',
  uk: 'Пошук MAC-адрес', nl: 'MAC-adres zoeken',
};
const eq = JSON.stringify;

// Sentence keys whose translated " — " glue becomes ", " in every locale
// (mirroring the en recasts: appositive clause → comma).
const COMMA_KEYS = [
  'batch.description', 'badge.subdivided', 'none.description', 'footer.dataNote',
  'enrich.oldest', 'hub.vendor.lede', 'hub.vendor.ledeLatest', 'hub.country.lede',
];

for (const [locale, brand] of Object.entries(BRAND)) {
  const file = path.join(root, 'src/i18n/locales', `${locale}.mjs`);
  let src = await readFile(file, 'utf8');
  const before = src;

  const valueOf = (key) => {
    const m = src.match(new RegExp(`"${key}": "((?:[^"\\\\]|\\\\.)*)"`));
    if (!m) return null;
    return JSON.parse(`"${m[1]}"`);
  };

  // --- title.match: "{org} — {colon} | <suffix>" → "{org} ({colon}) | <suffix>"
  const matchOld = valueOf('title.match');
  if (matchOld) {
    const m = matchOld.match(/^(.*) \{colon\} \| .+$/);
    if (m) {
      const prefix = m[1].endsWith('(') ? m[1].replace(/[(]$/, '') : `${m[1]} (`; // org sitting left of " — {colon}"
      // reconstruct: strip the pre-colon phrase entirely and rebuild from en form
      const suffix = matchOld.split(' | ').slice(1).join(' | ');
      const newMatch = `{org} ({colon}) | ${suffix}`;
      src = src.replace(new RegExp(`"${'title.match'}": "(?:[^"\\\\]|\\\\.)*",`),
        `"title.match": ${JSON.stringify(newMatch)},`);
    }
  }

  // --- title.search: "{query} — brand" → "{query} | brand"
  const search = valueOf('title.search');
  if (search && search.includes(' — ')) {
    const [q, ...rest] = search.split(' — ');
    const suffix = rest.join(' — ');
    src = src.replace(new RegExp(`"${'title.search'}": "(?:[^"\\\\]|\\\\.)*",`),
      `"title.search": ${JSON.stringify(`${q} | ${suffix}`)},`);
  }

  // --- title.recent: "<phrase> — brand" → "<phrase> | brand"
  const recent = valueOf('title.recent');
  if (recent && recent.includes(' — ')) {
    const idx = recent.lastIndexOf(' — ');
    const newer = `${recent.slice(0, idx)} | ${recent.slice(idx + 3)}`;
    src = src.replace(new RegExp(`"${'title.recent'}": "(?:[^"\\\\]|\\\\.)*",`),
      `"title.recent": ${JSON.stringify(newer)},`);
  }

  // --- hub.h1.former: reuse title.formerHub's own translated phrase
  const formerHub = valueOf('title.formerHub');
  if (formerHub) {
    const phrase = formerHub.split(' | ')[0]; // e.g. "Ehemalige {org} MAC-Adressblöcke"
    src = src.replace(new RegExp(`"${'hub.h1.former'}": "(?:[^"\\\\]|\\\\.)*",`),
      `"hub.h1.former": ${JSON.stringify(phrase)},`);
  }

  // --- sentence keys: kill the " — " glue with ", "
  for (const key of COMMA_KEYS) {
    src = src.replace(
      new RegExp(`("${key}": "(?:[^"\\\\]|\\\\.)*?) — ((?:[^"\\\\]|\\\\.)*?")`, 'g'),
      '$1, $2',
    );
    src = src.replace(
      new RegExp(`("${key}": "(?:[^"\\\\]|\\\\.)*?)——((?:[^"\\\\]|\\\\.)*?")`, 'g'),
      '$1，$2',
    );
  }

  if (src !== before) {
    await writeFile(file, src);
    await exec(process.execPath, ['--check', file]);
  }
}

// --- seo.mjs: believed separators + prose glue ---------------------------
{
  const file = path.join(root, 'src/i18n/seo.mjs');
  let src = await readFile(file, 'utf8');
  const before = src;
  // title lines: " — " → " | "
  src = src.replace(/(title: '[^']*) — ([^']*')/g, '$1 | $2');
  // prose glue in descriptions: latin comma / fullwidth comma for CJK
  src = src.split(' — ').join(', ').split('——').join('，');
  if (src !== before) {
    await writeFile(file, src);
    await exec(process.execPath, ['--check', file]);
  }
}
console.log('locale + seo em-dash scrub done');
