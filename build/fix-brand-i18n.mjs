/**
 * One-off repair pass over the localized title.* keys in all 30 locale
 * tables. Derives each file's CURRENT title.batch / title.recent phrases,
 * then rewrites both lines canonically:
 *   title.batch  = "<phrase> | <brand>"
 *   title.recent = "<phrase> - <brand>"
 * and normalizes the hub-title pipe suffixes. Idempotent + node --check.
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
let repaired = 0;

for (const [locale, brand] of Object.entries(BRAND)) {
  const file = path.join(root, 'src/i18n/locales', `${locale}.mjs`);
  let src = await readFile(file, 'utf8');
  const before = src;

  const lineFor = (key) => src.match(new RegExp(`\\s*"${key}": (.+),\\n`))?.[1] ?? null;
  const parse = (key) => {
    const raw = lineFor(key);
    if (raw === null) return null;
    try { return JSON.parse(raw); } catch { return null; }
  };

  // --- title.batch: canonical "<phrase> | <brand>" -----------------------
  const batchValue = parse('title.batch');
  let batchPhrase = null;
  if (batchValue !== null) {
    batchPhrase = batchValue.includes(' | ') ? batchValue.split(' | ')[0] : batchValue;
  } else {
    // Broken line, e.g. `"..." | <brand>,`: recover the phrase from the source.
    const m = src.match(/"title\.batch": "((?:[^"\\]|\\.)*)"/);
    if (!m) { console.error(`${locale}: cannot recover title.batch`); process.exit(1); }
    batchPhrase = JSON.parse(`"${m[1]}"`);
  }
  const batchNew = `  "title.batch": ${eq(`${batchPhrase} | ${brand}`)},`;
  src = src.replace(/  "title\.batch": .+,\n/, batchNew + '\n');

  // --- title.recent: canonical "<phrase> - <brand>" ----------------------
  const recentValue = parse('title.recent');
  if (recentValue === null) { console.error(`${locale}: title.recent unparseable`); process.exit(1); }
  const recentPhrase = recentValue.split(` - ${brand}`).join('').split(`- ${brand}`).join('').split(`-${brand}`).join('').replace(/\s*[-–]\s*$/, '').trimEnd();
  const recentNew = `  "title.recent": ${eq(`${recentPhrase} - ${brand}`)},`;
  src = src.replace(/  "title\.recent": .+,\n/, recentNew + '\n');

  if (src !== before) {
    await writeFile(file, src);
    await exec(process.execPath, ['--check', file]);
    repaired += 1;
  }
}
console.log(`repaired ${repaired} tables`);
