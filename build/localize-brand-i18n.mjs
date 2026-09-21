/**
 * One-off: localize the brand - `nav.brand` (wordmark + breadcrumb home
 * link) and the "MAC Address Lookup" suffix in every `title.*` value -
 * across all 30 locale tables. The brand becomes each locale's own site
 * name (the same phrases already lead the authored SEO titles in
 * src/i18n/seo.mjs). Idempotent; validates with node --check.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Localized site name per locale (matches src/i18n/seo.mjs head phrases). */
const BRAND = {
  de: 'MAC-Adressen-Suche',
  es: 'Buscador de direcciones MAC',
  fr: 'Recherche d’adresse MAC',
  pt: 'Buscador de endereços MAC',
  'zh-Hans': 'MAC 地址查询',
  'zh-Hant': 'MAC 位址查詢',
  hi: 'MAC एड्रेस लुकअप',
  bn: 'MAC ঠিকানা লুকআপ',
  mr: 'MAC पत्ता लुकअप',
  ur: 'MAC ایڈریس لوک اپ',
  gu: 'MAC સરનામું લુકઅપ',
  pa: 'MAC ਪਤਾ ਲੁੱਕਅੱਪ',
  ta: 'MAC முகவரி தேடல்',
  te: 'MAC చిరునామా శోధన',
  kn: 'MAC ವಿಳಾಸ ಹುಡುಕಾಟ',
  ml: 'MAC വിലാസം തിരച്ചിൽ',
  ru: 'Поиск MAC-адресов',
  ja: 'MACアドレス検索',
  ko: 'MAC 주소 조회',
  tr: 'MAC Adresi Sorgulama',
  vi: 'Tra cứu địa chỉ MAC',
  it: 'Ricerca indirizzi MAC',
  ar: 'البحث عن عناوين MAC',
  sw: 'Utafutaji wa Anwani za MAC',
  id: 'Pencarian Alamat MAC',
  ha: 'Binciken Adiresoshin MAC',
  pl: 'Wyszukiwanie adresów MAC',
  fa: 'جستجوی آدرس MAC',
  uk: 'Пошук MAC-адрес',
  nl: 'MAC-adres zoeken',
};

const brandJson = (value) => JSON.stringify(value).slice(1, -1); // unq-noted
const pipeChanges = Object.entries(BRAND).flatMap(([locale, brand]) => [locale, brandJson(brand)]);

for (const [locale, brand] of Object.entries(BRAND)) {
  const file = path.join(root, 'src/i18n/locales', `${locale}.mjs`);
  let source = await readFile(file, 'utf8');
  const before = source;

  // 1. nav.brand
  source = source.replace(
    /"nav\.brand": "MAC Address Lookup",/,
    `"nav.brand": ${JSON.stringify(brand)},`,
  );

  // 2. brand suffix inside the title.* keys (' | MAC Address Lookup')
  for (const key of ['title.vendorHub', 'title.formerHub', 'title.countryHub']) {
    source = source.replace(
      new RegExp(`("${key}": ")((?:[^"\\\\]|\\\\.)*) \\| MAC Address Lookup(",?\n)`),
      (_m, head, body, tail) => `${head}${body} | ${brandJson(brand)}${tail}`,
    );
  }
  // title.batch and title.recent use the em-dash/plain suffix form.
  source = source.replace(
    /"title\.batch": "((?:[^"\\]|\\.)*) \| MAC Address Lookup\(\)?(,?)"/,
    (_m, body, comma) => `"title.batch": "${body} | ${brandJson(brand)}"${comma}`,
  );
  source = source.replace(
    /"(title\.recent|title\.batch)": "((?:[^"\\]|\\.)*) MAC Address Lookup(",?\n)/,
    (_m, key, body, tail) => `"${key}": "${body}${brandJson(brand)}${tail}`,
  );

  // 3. Append the dynamic single/batch/search title keys using the brand.
  const addition =
    `  "title.match": "${brandJson('{org} - {colon}')} | ${brandJson(brand)}",\n` +
    `  "title.none": "{colon} | ${brandJson(brand)}",\n` +
    `  "title.search": "{query} - ${brandJson(brand)}",\n`;
  if (!source.includes('"title.match"')) {
    const closeIndex = source.lastIndexOf('};');
    source = source.slice(0, closeIndex) + '\n' + addition + source.slice(closeIndex);
  }

  if (source === before) {
    console.error(`${locale}: no changes made - check the patterns`);
    process.exitCode = 1;
    process.exit(1);
  }
  await writeFile(file, source);
  await exec(process.execPath, ['--check', file]);
}
console.log('localized nav.brand + title suffixes in all locale tables');
