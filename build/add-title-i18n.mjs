/**
 * One-off: append the page-title and hub-heading keys to every locale table
 * (the same workflow as merge-hub-i18n.mjs: script owns the module edits).
 * Keys already present are skipped. Validates with node --check.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const BRAND = ' | MAC Address Lookup';
const T = {
  de: {
    'title.batch': '{count} MAC-Abfragen',
    'title.vendorHub': '{org} MAC-Adressblöcke' + BRAND,
    'title.formerHub': 'Ehemalige {org} MAC-Adressblöcke' + BRAND,
    'title.countryHub': '{country} MAC-Adressblöcke' + BRAND,
    'title.recent': 'Neueste OUIs - MAC Address Lookup',
    'hub.h1.vendor': '{org} MAC-Adressblöcke',
    'hub.h1.former': '{org} - ehemalige MAC-Adressblöcke',
    'hub.h1.country': '{country} MAC-Adressblöcke',
  },
  es: {
    'title.batch': '{count} búsquedas MAC',
    'title.vendorHub': 'Bloques de direcciones MAC de {org}' + BRAND,
    'title.formerHub': 'Antiguos bloques de direcciones MAC de {org}' + BRAND,
    'title.countryHub': 'Bloques de direcciones MAC de {country}' + BRAND,
    'title.recent': 'Últimos OUI - MAC Address Lookup',
    'hub.h1.vendor': 'Bloques de direcciones MAC de {org}',
    'hub.h1.former': '{org} - antiguos bloques de direcciones MAC',
    'hub.h1.country': 'Bloques de direcciones MAC de {country}',
  },
  fr: {
    'title.batch': '{count} recherches MAC',
    'title.vendorHub': 'Blocs d’adresses MAC de {org}' + BRAND,
    'title.formerHub': 'Anciens blocs d’adresses MAC de {org}' + BRAND,
    'title.countryHub': 'Blocs d’adresses MAC de {country}' + BRAND,
    'title.recent': 'Derniers OUI - MAC Address Lookup',
    'hub.h1.vendor': 'Blocs d’adresses MAC de {org}',
    'hub.h1.former': '{org} - anciens blocs d’adresses MAC',
    'hub.h1.country': 'Blocs d’adresses MAC de {country}',
  },
  pt: {
    'title.batch': '{count} buscas MAC',
    'title.vendorHub': 'Blocos de endereços MAC de {org}' + BRAND,
    'title.formerHub': 'Antigos blocos de endereços MAC de {org}' + BRAND,
    'title.countryHub': 'Blocos de endereços MAC de {country}' + BRAND,
    'title.recent': 'OUIs recentes - MAC Address Lookup',
    'hub.h1.vendor': 'Blocos de endereços MAC de {org}',
    'hub.h1.former': '{org} - antigos blocos de endereços MAC',
    'hub.h1.country': 'Blocos de endereços MAC de {country}',
  },
  it: {
    'title.batch': '{count} ricerche MAC',
    'title.vendorHub': 'Blocchi di indirizzi MAC di {org}' + BRAND,
    'title.formerHub': 'Ex blocchi di indirizzi MAC di {org}' + BRAND,
    'title.countryHub': 'Blocchi di indirizzi MAC di {country}' + BRAND,
    'title.recent': 'OUI più recenti - MAC Address Lookup',
    'hub.h1.vendor': 'Blocchi di indirizzi MAC di {org}',
    'hub.h1.former': '{org} - ex blocchi di indirizzi MAC',
    'hub.h1.country': 'Blocchi di indirizzi MAC di {country}',
  },
  nl: {
    'title.batch': '{count} MAC-zoekopdrachten',
    'title.vendorHub': 'MAC-adresblokken van {org}' + BRAND,
    'title.formerHub': 'Voormalige MAC-adresblokken van {org}' + BRAND,
    'title.countryHub': 'MAC-adresblokken van {country}' + BRAND,
    'title.recent': 'Nieuwste OUI’s - MAC Address Lookup',
    'hub.h1.vendor': 'MAC-adresblokken van {org}',
    'hub.h1.former': '{org} - voormalige MAC-adresblokken',
    'hub.h1.country': 'MAC-adresblokken van {country}',
  },
  pl: {
    'title.batch': '{count} wyszukiwań MAC',
    'title.vendorHub': 'Bloki adresów MAC firmy {org}' + BRAND,
    'title.formerHub': 'Dawne bloki adresów MAC firmy {org}' + BRAND,
    'title.countryHub': 'Bloki adresów MAC w {country}' + BRAND,
    'title.recent': 'Najnowsze OUI - MAC Address Lookup',
    'hub.h1.vendor': 'Bloki adresów MAC firmy {org}',
    'hub.h1.former': '{org} - dawne bloki adresów MAC',
    'hub.h1.country': 'Bloki adresów MAC w {country}',
  },
  ru: {
    'title.batch': '{count} запросов MAC',
    'title.vendorHub': 'Блоки MAC-адресов организации {org}' + BRAND,
    'title.formerHub': 'Бывшие блоки MAC-адресов ({org})' + BRAND,
    'title.countryHub': 'Блоки MAC-адресов в {country}' + BRAND,
    'title.recent': 'Новейшие OUI - MAC Address Lookup',
    'hub.h1.vendor': 'Блоки MAC-адресов организации {org}',
    'hub.h1.former': '{org} - бывшие блоки MAC-адресов',
    'hub.h1.country': 'Блоки MAC-адресов в {country}',
  },
  ja: {
    'title.batch': '{count} 件のMAC検索',
    'title.vendorHub': '{org} のMACアドレスブロック | MAC Address Lookup',
    'title.formerHub': '旧 {org} のMACアドレスブロック | MAC Address Lookup',
    'title.countryHub': '{country} のMACアドレスブロック | MAC Address Lookup',
    'title.recent': '最新のOUI - MAC Address Lookup',
    'hub.h1.vendor': '{org} のMACアドレスブロック',
    'hub.h1.former': '旧 {org} のMACアドレスブロック',
    'hub.h1.country': '{country} のMACアドレスブロック',
  },
  ko: {
    'title.batch': '{count}건의 MAC 조회',
    'title.vendorHub': '{org}의 MAC 주소 블록 | MAC Address Lookup',
    'title.formerHub': '이전 {org}의 MAC 주소 블록 | MAC Address Lookup',
    'title.countryHub': '{country}의 MAC 주소 블록 | MAC Address Lookup',
    'title.recent': '최신 OUI - MAC Address Lookup',
    'hub.h1.vendor': '{org}의 MAC 주소 블록',
    'hub.h1.former': '이전 {org}의 MAC 주소 블록',
    'hub.h1.country': '{country}의 MAC 주소 블록',
  },
  'zh-Hans': {
    'title.batch': '{count} 次 MAC 查询',
    'title.vendorHub': '{org} 的 MAC 地址块 | MAC Address Lookup',
    'title.formerHub': '原 {org} 的 MAC 地址块 | MAC Address Lookup',
    'title.countryHub': '{country} 的 MAC 地址块 | MAC Address Lookup',
    'title.recent': '最新 OUI - MAC Address Lookup',
    'hub.h1.vendor': '{org} 的 MAC 地址块',
    'hub.h1.former': '原 {org} 的 MAC 地址块',
    'hub.h1.country': '{country} 的 MAC 地址块',
  },
  'zh-Hant': {
    'title.batch': '{count} 次 MAC 查詢',
    'title.vendorHub': '{org} 的 MAC 位址區塊 | MAC Address Lookup',
    'title.formerHub': '原 {org} 的 MAC 位址區塊 | MAC Address Lookup',
    'title.countryHub': '{country} 的 MAC 位址區塊 | MAC Address Lookup',
    'title.recent': '最新 OUI - MAC Address Lookup',
    'hub.h1.vendor': '{org} 的 MAC 位址區塊',
    'hub.h1.former': '原 {org} 的 MAC 位址區塊',
    'hub.h1.country': '{country} 的 MAC 位址區塊',
  },
  tr: {
    'title.batch': '{count} MAC sorgulaması',
    'title.vendorHub': '{org} MAC adres blokları' + BRAND,
    'title.formerHub': 'Eski {org} MAC adres blokları' + BRAND,
    'title.countryHub': '{country} MAC adres blokları' + BRAND,
    'title.recent': 'En yeni OUI’ler - MAC Address Lookup',
    'hub.h1.vendor': '{org} MAC adres blokları',
    'hub.h1.former': '{org} - eski MAC adres blokları',
    'hub.h1.country': '{country} MAC adres blokları',
  },
  vi: {
    'title.batch': '{count} tra cứu MAC',
    'title.vendorHub': 'Các khối địa chỉ MAC của {org}' + BRAND,
    'title.formerHub': 'Các khối địa chỉ MAC cũ của {org}' + BRAND,
    'title.countryHub': 'Các khối địa chỉ MAC tại {country}' + BRAND,
    'title.recent': 'OUI mới nhất - MAC Address Lookup',
    'hub.h1.vendor': 'Các khối địa chỉ MAC của {org}',
    'hub.h1.former': '{org} - các khối địa chỉ MAC cũ',
    'hub.h1.country': 'Các khối địa chỉ MAC của {country}',
  },
  id: {
    'title.batch': '{count} pencarian MAC',
    'title.vendorHub': 'Blok alamat MAC milik {org}' + BRAND,
    'title.formerHub': 'Blok alamat MAC mantan milik {org}' + BRAND,
    'title.countryHub': 'Blok alamat MAC di {country}' + BRAND,
    'title.recent': 'OUI terbaru - MAC Address Lookup',
    'hub.h1.vendor': 'Blok alamat MAC milik {org}',
    'hub.h1.former': '{org} - blok alamat MAC yang lama',
    'hub.h1.country': 'Blok alamat MAC di {country}',
  },
  ar: {
    'title.batch': '{count} عمليات بحث MAC',
    'title.vendorHub': 'كتل عناوين MAC الخاصة بـ {org} | MAC Address Lookup',
    'title.formerHub': 'كتل عناوين MAC السابقة لـ {org} | MAC Address Lookup',
    'title.countryHub': 'كتل عناوين MAC في {country} | MAC Address Lookup',
    'title.recent': 'أحدث OUI - MAC Address Lookup',
    'hub.h1.vendor': 'كتل عناوين MAC الخاصة بـ {org}',
    'hub.h1.former': '{org} - كتل عناوين MAC السابقة',
    'hub.h1.country': 'كتل عناوين MAC في {country}',
  },
  fa: {
    'title.batch': '{count} جستجوی MAC',
    'title.vendorHub': 'بلاک‌های آدرس MAC {org} | MAC Address Lookup',
    'title.formerHub': 'بلاک‌های پیشین آدرس MAC {org} | MAC Address Lookup',
    'title.countryHub': 'بلاک‌های آدرس MAC در {country} | MAC Address Lookup',
    'title.recent': 'جدیدترین OUI - MAC Address Lookup',
    'hub.h1.vendor': 'بلاک‌های آدرس MAC {org}',
    'hub.h1.former': '{org} - بلاک‌های پیشین آدرس MAC',
    'hub.h1.country': 'بلاک‌های آدرس MAC در {country}',
  },
  hi: {
    'title.batch': '{count} MAC लुकअप',
    'title.vendorHub': '{org} के MAC एड्रेस ब्लॉक | MAC Address Lookup',
    'title.formerHub': '{org} के पुराने MAC एड्रेस ब्लॉक | MAC Address Lookup',
    'title.countryHub': '{country} के MAC एड्रेस ब्लॉक | MAC Address Lookup',
    'title.recent': 'नवीनतम OUI - MAC Address Lookup',
    'hub.h1.vendor': '{org} के MAC एड्रेस ब्लॉक',
    'hub.h1.former': '{org} - पुराने MAC एड्रेस ब्लॉक',
    'hub.h1.country': '{country} के MAC एड्रेस ब्लॉक',
  },
  bn: {
    'title.batch': '{count}টি MAC লুকআপ',
    'title.vendorHub': '{org}-এর MAC ঠিকানা ব্লক | MAC Address Lookup',
    'title.formerHub': '{org}-এর পুরনো MAC ঠিকানা ব্লক | MAC Address Lookup',
    'title.countryHub': '{country}-এর MAC ঠিকানা ব্লক | MAC Address Lookup',
    'title.recent': 'সাম্প্রতিক OUI - MAC Address Lookup',
    'hub.h1.vendor': '{org}-এর MAC ঠিকানা ব্লক',
    'hub.h1.former': '{org}-এর পুরনো MAC ঠিকানা ব্লক',
    'hub.h1.country': '{country}-এর MAC ঠিকানা ব্লক',
  },
  mr: {
    'title.batch': '{count} MAC लुकअप',
    'title.vendorHub': '{org} चे MAC पत्ता ब्लॉक | MAC Address Lookup',
    'title.formerHub': '{org} चे जुणे MAC पत्ता ब्लॉक | MAC Address Lookup',
    'title.countryHub': '{country} मधील MAC पत्ता ब्लॉक | MAC Address Lookup',
    'title.recent': 'नवीनतम OUI - MAC Address Lookup',
    'hub.h1.vendor': '{org} चे MAC पत्ता ब्लॉक',
    'hub.h1.former': '{org} - जुणे MAC पत्ता ब्लॉक',
    'hub.h1.country': '{country} मधील MAC पत्ता ब्लॉक',
  },
  ur: {
    'title.batch': '{count} MAC لوک اپ',
    'title.vendorHub': '{org} کے MAC ایڈریس بلاک | MAC Address Lookup',
    'title.formerHub': '{org} کے سابق MAC ایڈریس بلاک | MAC Address Lookup',
    'title.countryHub': '{country} کے MAC ایڈریس بلاک | MAC Address Lookup',
    'title.recent': 'تازہ ترین OUI - MAC Address Lookup',
    'hub.h1.vendor': '{org} کے MAC ایڈریس بلاک',
    'hub.h1.former': '{org} - سابق MAC ایڈریس بلاک',
    'hub.h1.country': '{country} کے MAC ایڈریس بلاک',
  },
  gu: {
    'title.batch': '{count} MAC લુકઅપ',
    'title.vendorHub': '{org} ના MAC સરનામાં બ્લોક | MAC Address Lookup',
    'title.formerHub': '{org} ના અગાઉના MAC સરનામાં બ્લોક | MAC Address Lookup',
    'title.countryHub': '{country} ના MAC સરનામાં બ્લોક | MAC Address Lookup',
    'title.recent': 'તાજેતરના OUI - MAC Address Lookup',
    'hub.h1.vendor': '{org} ના MAC સરનામાં બ્લોક',
    'hub.h1.former': '{org} - અગાઉના MAC સરનામાં બ્લોક',
    'hub.h1.country': '{country} ના MAC સરનામાં બ્લોક',
  },
  pa: {
    'title.batch': '{count} MAC ਲੁੱਕਅੱਪ',
    'title.vendorHub': '{org} ਦੇ MAC ਪਤਾ ਬਲਾਕ | MAC Address Lookup',
    'title.formerHub': '{org} ਦੇ ਪੁਰਾਣੇ MAC ਪਤਾ ਬਲਾਕ | MAC Address Lookup',
    'title.countryHub': '{country} ਦੇ MAC ਪਤਾ ਬਲਾਕ | MAC Address Lookup',
    'title.recent': 'ਨਵੇਂ OUI - MAC Address Lookup',
    'hub.h1.vendor': '{org} ਦੇ MAC ਪਤਾ ਬਲਾਕ',
    'hub.h1.former': '{org} - ਪੁਰਾਣੇ MAC ਪਤਾ ਬਲਾਕ',
    'hub.h1.country': '{country} ਦੇ MAC ਪਤਾ ਬਲਾਕ',
  },
  ta: {
    'title.batch': '{count} MAC தேடல்கள்',
    'title.vendorHub': '{org} இன் MAC முகவரி தொகுதிகள் | MAC Address Lookup',
    'title.formerHub': '{org} இன் முன்னைய MAC முகவரி தொகுதிகள் | MAC Address Lookup',
    'title.countryHub': '{country} இன் MAC முகவரி தொகுதிகள் | MAC Address Lookup',
    'title.recent': 'சமீபத்திய OUI - MAC Address Lookup',
    'hub.h1.vendor': '{org} இன் MAC முகவரி தொகுதிகள்',
    'hub.h1.former': '{org} - முன்னைய MAC முகவரி தொகுதிகள்',
    'hub.h1.country': '{country} இன் MAC முகவரி தொகுதிகள்',
  },
  te: {
    'title.batch': '{count} MAC శోధనలు',
    'title.vendorHub': '{org} యొక్క MAC చిరునామా బ్లాక్‌లు | MAC Address Lookup',
    'title.formerHub': '{org} యొక్క పూర్వపు MAC చిరునామా బ్లాక్‌లు | MAC Address Lookup',
    'title.countryHub': '{country} యొక్క MAC చిరునామా బ్లాక్‌లు | MAC Address Lookup',
    'title.recent': 'తాజా OUIలు - MAC Address Lookup',
    'hub.h1.vendor': '{org} యొక్క MAC చిరునామా బ్లాక్‌లు',
    'hub.h1.former': '{org} - పూర్వపు MAC చిరునామా బ్లాక్‌లు',
    'hub.h1.country': '{country} యొక్క MAC చిరునామా బ్లాక్‌లు',
  },
  kn: {
    'title.batch': '{count} MAC ಹುಡುಕಾಟಗಳು',
    'title.vendorHub': '{org} ನ MAC ವಿಳಾಸ ಬ್ಲಾಕ್‌ಗಳು | MAC Address Lookup',
    'title.formerHub': '{org} ನ ಹಿಂದಿನ MAC ವಿಳಾಸ ಬ್ಲಾಕ್‌ಗಳು | MAC Address Lookup',
    'title.countryHub': '{country} ನ MAC ವಿಳಾಸ ಬ್ಲಾಕ್‌ಗಳು | MAC Address Lookup',
    'title.recent': 'ಇತ್ತೀಚಿನ OUI - MAC Address Lookup',
    'hub.h1.vendor': '{org} ನ MAC ವಿಳಾಸ ಬ್ಲಾಕ್‌ಗಳು',
    'hub.h1.former': '{org} - ಹಿಂದಿನ MAC ವಿಳಾಸ ಬ್ಲಾಕ್‌ಗಳು',
    'hub.h1.country': '{country} ನ MAC ವಿಳಾಸ ಬ್ಲಾಕ್‌ಗಳು',
  },
  ml: {
    'title.batch': '{count} MAC തിരച്ചിലുകൾ',
    'title.vendorHub': '{org} ന്റെ MAC വിലാസ ബ്ലോക്കുകൾ | MAC Address Lookup',
    'title.formerHub': '{org} ന്റെ മുൻകാല MAC വിലാസ ബ്ലോക്കുകൾ | MAC Address Lookup',
    'title.countryHub': '{country} ലെ MAC വിലാസ ബ്ലോക്കുകൾ | MAC Address Lookup',
    'title.recent': 'ഏറ്റവും പുതിയ OUI - MAC Address Lookup',
    'hub.h1.vendor': '{org} ന്റെ MAC വിലാസ ബ്ലോക്കുകൾ',
    'hub.h1.former': '{org} - മുൻകാല MAC വിലാസ ബ്ലോക്കുകൾ',
    'hub.h1.country': '{country} ലെ MAC വിലാസ ബ്ലോക്കുകൾ',
  },
  sw: {
    'title.batch': 'Utafutaji {count} wa MAC',
    'title.vendorHub': 'Bululi za MAC za {org}' + BRAND,
    'title.formerHub': 'Bululi za MAC za zamani za {org}' + BRAND,
    'title.countryHub': 'Bululi za MAC za {country}' + BRAND,
    'title.recent': 'OUI mpya zaidi - MAC Address Lookup',
    'hub.h1.vendor': 'Bululi za MAC za {org}',
    'hub.h1.former': '{org} - bululi za MAC za zamani',
    'hub.h1.country': 'Bululi za MAC za {country}',
  },
  ha: {
    'title.batch': 'Binciken MAC {count}',
    'title.vendorHub': 'Bulullukan adireshin MAC na {org}' + BRAND,
    'title.formerHub': 'Tsoffin bulullukan adireshin MAC na {org}' + BRAND,
    'title.countryHub': 'Bulullukan adireshin MAC a {country}' + BRAND,
    'title.recent': 'Sabbin OUI - MAC Address Lookup',
    'hub.h1.vendor': 'Bulullukan adireshin MAC na {org}',
    'hub.h1.former': '{org} - tsoffin bulullukan adireshin MAC',
    'hub.h1.country': 'Bulullukan adireshin MAC a {country}',
  },
};

/** {locale: exported table name} mirrors locales.mjs. */
const TABLE_NAMES = {
  de: 'de', es: 'es', fr: 'fr', pt: 'pt', 'zh-Hans': 'zhHans', 'zh-Hant': 'zhHant',
  hi: 'hi', bn: 'bn', mr: 'mr', ur: 'ur', gu: 'gu', pa: 'pa', ta: 'ta', te: 'te',
  kn: 'kn', ml: 'ml', ru: 'ru', ja: 'ja', ko: 'ko', tr: 'tr', vi: 'vi', it: 'it',
  ar: 'ar', sw: 'sw', id: 'id', ha: 'ha', pl: 'pl', fa: 'fa', uk: 'uk', nl: 'nl',
};

// uk handled separately below (translated like ru but Ukrainian).
T.uk = {
  'title.batch': '{count} запитів MAC',
  'title.vendorHub': 'Блоки MAC-адресів організації {org}' + BRAND,
  'title.formerHub': 'Колишні блоки MAC-адресів ({org})' + BRAND,
  'title.countryHub': 'Блоки MAC-адресів у {country}' + BRAND,
  'title.recent': 'Найновіші OUI - MAC Address Lookup',
  'hub.h1.vendor': 'Блоки MAC-адресів організації {org}',
  'hub.h1.former': '{org} - колишні блоки MAC-адресів',
  'hub.h1.country': 'Блоки MAC-адресів у {country}',
};

let touched = 0;
for (const [locale, additions] of Object.entries(T)) {
  const file = path.join(root, 'src/i18n/locales', `${locale}.mjs`);
  const task = additions;
  const tableName = TABLE_NAMES[locale];
  let source = await readFile(file, 'utf8');
  const missing = Object.entries(task).filter(([key]) => !source.includes(`"${key}"`));
  if (missing.length === 0) continue;
  const block =
    `\n  // Page titles and hub headings\n` +
    missing.map(([k, v]) => `  "${k}": ${JSON.stringify(v)},`).join('\n') +
    '\n';
  // Append before the final closing "};"
  const closeIndex = source.lastIndexOf('};');
  source = source.slice(0, closeIndex) + block + '\n' + source.slice(closeIndex);
  await writeFile(file, source);
  await exec(process.execPath, ['--check', file]);
  touched += 1;
  console.log(`${locale}: +${missing.length} keys (${tableName})`);
}
console.log(`touched ${touched} locale tables`);
