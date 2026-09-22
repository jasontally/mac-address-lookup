/**
 * Authored per-locale home-page copy for the localized home pages
 * (`/lang/{locale}/`). Build-time only, never shipped to the client.
 *
 * This is discoverability work, not "SEO": the goal is helping people
 * find a utility in their own words. No brand is promoted as part of the
 * app; each locale's title leads with its own native site name, because
 * an English brand name would make the tool harder to find for everyone
 * else.
 *
 * Every entry is hand-authored, not machine-translated, so each
 * `hreflang` variant serves genuinely native copy (Google's guidance for
 * multi-language sets). Locales without an entry fall back to English;
 * the en pair is the source of truth for tone and length limits.
 *
 * Each locale's site name (nav.brand, e.g. "MAC-Adressen-Suche") leads
 * the home title; the English name below is the source-of-truth brand.
 */

const EN = {
  title: 'MAC Address Lookup | Vendor & OUI Lookup',
  description:
    'Free, private MAC address lookup. Paste a full or partial MAC address or OUI to identify the vendor, IEEE block details, randomization, virtualization, and prefix lineage, all in your browser.',
};

export const DISCOVERY = {
  en: EN,
  de: {
    title: 'MAC-Adressen-Suche | Vendor- & OUI-Lookup',
    description:
      'Kostenlose, private MAC-Adressensuche. Fügen Sie eine vollständige oder teilweise MAC-Adresse oder OUI ein, um Hersteller, IEEE-Block-Details, Randomisierung und Präfix-Herkunft zu ermitteln, direkt im Browser.',
  },
  es: {
    title: 'Buscador de direcciones MAC y OUI',
    description:
      'Buscador gratuito y privado de direcciones MAC. Pegue una dirección MAC u OUI completa o parcial para identificar el fabricante, los detalles del bloque IEEE, la aleatorización y el historial del prefijo, todo en su navegador.',
  },
  fr: {
    title: 'Recherche d’adresse MAC et OUI',
    description:
      'Recherche gratuite et privée d’adresses MAC. Collez une adresse MAC ou un OUI complet ou partiel pour identifier le fabricant, les détails du bloc IEEE, la randomisation et l’historique du préfixe, le tout dans votre navigateur.',
  },
  pt: {
    title: 'Buscador de endereços MAC e OUI',
    description:
      'Busca gratuita e privada de endereços MAC. Cole um endereço MAC ou OUI completo ou parcial para identificar o fabricante, os detalhes do bloco IEEE, a randomização e o histórico do prefixo, tudo no seu navegador.',
  },
  'zh-Hans': {
    title: 'MAC 地址查询',
    description:
      '免费、私密的 MAC 地址查询。粘贴完整或部分 MAC 地址或 OUI，即可识别厂商、IEEE 块详情、随机化检测与地址前缀来源，全程在浏览器中完成。',
  },
  'zh-Hant': {
    title: 'MAC 位址查詢',
    description:
      '免費、私密的 MAC 位址查詢。貼上完整或部分 MAC 位址或 OUI，即可識別廠商、IEEE 區塊詳情、隨機化偵測與位址前緣來源，全程在瀏覽器內完成。',
  },
  hi: {
    title: 'MAC एड्रेस लुकअप',
    description:
      'निःशुल्क और निजी MAC एड्रेस लुकअप। पूरा या आंशिक MAC एड्रेस या OUI पेस्ट करें और वेंडर, IEEE ब्लॉक विवरण, रैंडमाइज़ेशन तथा प्रीफ़िक्स इतिहास जानें, सब आपके ब्राउज़र में।',
  },
  bn: {
    title: 'MAC ঠিকানা লুকআপ',
    description:
      'বিনামূল্যে, নিরাপদে MAC ঠিকানা লুকআপ। সম্পূর্ণ বা আংশিক MAC ঠিকানা বা OUI পেস্ট করে ভেন্ডর, IEEE ব্লকের বিবরণ, র‍্যান্ডমাইজেশন ও প্রিফিক্সের ইতিহাস দেখুন, সব আপনার ব্রাউজারেই।',
  },
  mr: {
    title: 'MAC पत्ता लुकअप',
    description:
      'मोफत व खाजगी MAC पत्ता लुकअप. संपूर्ण किंवा आंशिक MAC पत्ता किंवा OUI पेस्ट करून विक्रेता, IEEE ब्लॉक तपशील, रँडमायझेशन व प्रीफिक्स इतिहास पहा, सर्व तुमच्या ब्राउझरमध्येच.',
  },
  ur: {
    title: 'MAC ایڈریس لوک اپ',
    description:
      'مفت اور نجی MAC ایڈریس لوک اپ۔ مکمل یا جزوی MAC ایڈریس یا OUI پیسٹ کریں اور وینڈر، IEEE بلاک کی تفصیل، رینڈمائزیشن اور پریفکس کی تاریخ دیکھیں, سب آپ کے براؤزر میں۔',
  },
  gu: {
    title: 'MAC સરનામું લુકઅપ',
    description:
      'મફત અને ખાનગી MAC સરનામું લુકઅપ. સંપૂર્ણ અથવા આંશિક MAC સરનામું કે OUI પેસ્ટ કરો અને વેન્ડર, IEEE બ્લોક વિગતો, રેન્ડમાઇઝેશન તથા પ્રીફિક્સ ઇતિહાસ જુઓ, બધું તમારા બ્રાઉઝરમાં જ.',
  },
  pa: {
    title: 'MAC ਪਤਾ ਲੁੱਕਅੱਪ',
    description:
      'ਮੁਫ਼ਤ ਤੇ ਨਿੱਜੀ MAC ਪਤਾ ਲੁੱਕਅੱਪ। ਪੂਰਾ ਜਾਂ ਅਧੂਰਾ MAC ਪਤਾ ਜਾਂ OUI ਪੇਸਟ ਕਰੋ ਅਤੇ ਵੈਂਡਰ, IEEE ਬਲਾਕ ਵੇਰਵੇ, ਰੈਂਡਮਾਈਜ਼ੇਸ਼ਨ ਤੇ ਪ੍ਰੀਫਿਕਸ ਅਤੀਤ ਵੇਖੋ, ਸਭ ਤੁਹਾਡੇ ਬਰਾਊਜ਼ਰ ਵਿੱਚ।',
  },
  ta: {
    title: 'MAC முகவரி தேடல்',
    description:
      'இலவசமான, தனிப்பட்ட MAC முகவரி தேடல். முழு அல்லது பகுதி MAC முகவரி அல்லது OUI ஐ ஒட்டி விற்பனையாளர், IEEE தொகுதி விவரங்கள், சீரற்ற முறை கண்டறிதல் மற்றும் முன்னொட்டு வரலாற்றைக் காணலாம், அனைத்தும் உங்கள் உலாவியில்.',
  },
  te: {
    title: 'MAC చిరునామా శోధన',
    description:
      'ఉచిత, గోప్యమైన MAC చిరునామా శోధన. పూర్తి లేదా పాక్షిక MAC చిరునామా లేదా OUI ని పేస్ట్ చేసి విక్రేత, IEEE బ్లాక్ వివరాలు, రాండమైజేషన్, ప్రీఫిక్స్ చరిత్రను చూడండి, అంతా మీ బ్రౌజర్‌లోనే.',
  },
  kn: {
    title: 'MAC ವಿಳಾಸ ಹುಡುಕಾಟ',
    description:
      'ಉಚಿತ ಮತ್ತು ಖಾಸಗಿ MAC ವಿಳಾಸ ಹುಡುಕಾಟ. ಪೂರ್ಣ ಅಥವಾ ಆಂಶಿಕ MAC ವಿಳಾಸ ಅಥವಾ OUI ಅನ್ನು ಅಂಟಿಸಿ ಪೂರೈಕೆದಾರ, IEEE ಬ್ಲಾಕ್ ವಿವರಗಳು, ರ್ಯಾಂಡಮೈಸೇಶನ್ ಮತ್ತು ಪ್ರಿಫಿಕ್ಸ್ ಇತಿಹಾಸ ನೋಡಿ, ಎಲ್ಲವೂ ನಿಮ್ಮ ಬ್ರೌಸರ್‌ನಲ್ಲೇ.',
  },
  ml: {
    title: 'MAC വിലാസം തിരച്ചിൽ',
    description:
      'സൗജന്യവും സ്വകാര്യവുമായ MAC വിലാസ തിരച്ചിൽ. പൂർണ്ണമോ ഭാഗികമോ ആയ MAC വിലാസമോ OUI യോ പേസ്റ്റ് ചെയ്ത് വെണ്ടർ, IEEE ബ്ലോക്ക് വിവരങ്ങൾ, റാൻഡമൈസേഷൻ, പ്രീഫിക്സ് ചരിത്രം കാണുക, എല്ലാം നിങ്ങളുടെ ബ്രൗസറിൽ തന്നെ.',
  },
  ru: {
    title: 'Поиск MAC-адресов',
    description:
      'Бесплатный и приватный поиск MAC-адресов. Вставьте полный или частичный MAC-адрес или OUI, чтобы определить производителя, данные блока IEEE, рандомизацию и историю префикса, прямо в вашем браузере.',
  },
  ja: {
    title: 'MACアドレス検索',
    description:
      '無料でプライバシー保護されたMACアドレス検索。完全または部分MACアドレスやOUIを貼り付けるだけで、ベンダー、IEEEブロックの詳細、ランダム化検出、プレフィックスの変遷をブラウザだけで確認できます。',
  },
  ko: {
    title: 'MAC 주소 조회',
    description:
      '무료 비공개 MAC 주소 조회. 전체 또는 부분 MAC 주소나 OUI를 붙여넣어 벤더, IEEE 블록 정보, 랜덤화 감지, 프리픽스 변경 이력을 확인하세요, 모든 작업은 브라우저에서 이루어집니다.',
  },
  tr: {
    title: 'MAC Adresi Sorgulama',
    description:
      'Ücretsiz ve gizliliğe saygılı MAC adresi sorgulama. Tam veya kısmi bir MAC adresi ya da OUI yapıştırın; üreticiyi, IEEE blok ayrıntılarını, rastgeleleştirme tespitini ve önek geçmişini görün, hepsi tarayıcınızda.',
  },
  vi: {
    title: 'Tra cứu địa chỉ MAC',
    description:
      'Tra cứu địa chỉ MAC miễn phí, riêng tư. Dán địa chỉ MAC hoặc OUI đầy đủ hay một phần để nhận diện nhà sản xuất, chi tiết khối IEEE, phát hiện ngẫu nhiên hóa và lịch sử tiền tố, tất cả ngay trong trình duyệt.',
  },
  it: {
    title: 'Ricerca indirizzi MAC',
    description:
      'Ricerca di indirizzi MAC gratuita e privata. Incolla un indirizzo MAC o OUI completo o parziale per identificare il produttore, i dettagli del blocco IEEE, la randomizzazione e la cronologia del prefisso, tutto nel tuo browser.',
  },
  ar: {
    title: 'البحث عن عناوين MAC',
    description:
      'بحث مجاني وخاص عن عناوين MAC. الصق عنوان MAC كاملاً أو جزئياً أو OUI لمعرفة الشركة المصنِّعة وتفاصيل كتلة IEEE واكتشاف العشوائية وسجل البادئة, كل ذلك في متصفحك.',
  },
  sw: {
    title: 'Utafutaji wa Anwani za MAC',
    description:
      'Utafutaji wa anwani za MAC wa bila malipo na faragha. Bandika anwani ya MAC au OUI kamili au ya sehemu ili kutambua muuzaji, maelezo ya bloku ya IEEE, utambuzi wa nasibu na historia ya kiambishi, vyote kwenye kivinjari chako.',
  },
  id: {
    title: 'Pencarian Alamat MAC',
    description:
      'Pencarian alamat MAC gratis dan privat. Tempel alamat MAC atau OUI lengkap atau sebagian untuk mengenali vendor, detail blok IEEE, deteksi randomisasi, dan riwayat prefiks, semuanya di browser Anda.',
  },
  ha: {
    title: 'Binciken Adiresoshin MAC',
    description:
      'Binciken adiresoshin MAC kyauta ne mai kare bayanai. Liƙa cikakken ko ɓangarorin adireshin MAC ko OUI domin gano mai sayarwa, cikakken bayanin rukunin IEEE, gano RNG da tarihin prefix, duk a cikin burauzarka.',
  },
  pl: {
    title: 'Wyszukiwanie adresów MAC',
    description:
      'Darmowe i prywatne wyszukiwanie adresów MAC. Wklej pełny lub częściowy adres MAC albo OUI, aby ustalić producenta, szczegóły bloku IEEE, randomizację i historię prefiksu, wszystko w przeglądarce.',
  },
  fa: {
    title: 'جستجوی آدرس MAC',
    description:
      'جستجوی رایگان و خصوصی آدرس MAC. یک آدرس MAC کامل یا جزئی یا OUI را بچسبانید تا سازنده، جزئیات بلوک IEEE، تشخیص تصادفی‌سازی و تاریخ پیشوند را ببینید, همه در مرورگر شما.',
  },
  uk: {
    title: 'Пошук MAC-адрес',
    description:
      'Безкоштовний і приватний пошук MAC-адрес. Вставте повну або часткову MAC-адресу чи OUI, щоб визначити виробника, дані блоку IEEE, рандомізацію та історію префікса, прямо у вашому браузері.',
  },
  nl: {
    title: 'MAC-adres zoeken',
    description:
      'Gratis en privé MAC-adressen zoeken. Plak een volledig of gedeeltelijk MAC-adres of OUI om de fabrikant, IEEE-blokdetails, randomisering en de prefix-geschiedenis te zien, volledig in je browser.',
  },
};

/** Home-page copy for a locale code, falling back to English. */
export function discoveryFor(locale) {
  return DISCOVERY[locale] ?? EN;
}
