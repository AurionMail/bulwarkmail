// Finds text the sender meant to replace before sending: template
// placeholders, bracketed fill-ins that AI drafts and copied templates leave
// behind, and markers like TODO.

// Template syntax, as in template-utils. Spaces inside the braces are allowed
// because templates pasted from other tools often have them.
const TEMPLATE_PLACEHOLDER = /\{\{\s*[\w.-]+\s*\}\}/g;

// [TIME], [PRICE], [YOUR NAME]. Not followed by "(", which would make it a
// Markdown link.
const CAPS_BRACKET = /\[[\p{Lu}\d][\p{Lu}\d _./-]{0,28}[\p{Lu}\d]\](?!\()/gu;

// Fill-ins that ask the sender for something: [Your Name], [Insert date],
// [Votre nom], [Ваше имя], [您的姓名]. Matched by the word that opens or
// closes them, for the languages the app is translated into. "Your" and
// "insert/enter/add" are what AI drafts and templates use.
const PROMPT_START_WORDS = [
  // English
  'your', 'insert', 'enter', 'add',
  // German
  'ihr', 'ihre', 'ihren', 'dein', 'deine', 'deinen',
  // French
  'votre', 'vos', 'ton', 'ta', 'tes', 'insérer', 'insérez', 'ajouter', 'ajoutez', 'saisir', 'saisissez', 'indiquer', 'indiquez',
  // Spanish
  'tu', 'tus', 'su', 'sus', 'insertar', 'inserte', 'inserta', 'añadir', 'añade', 'agregar', 'agrega', 'escribe', 'escriba', 'indica', 'indique',
  // Portuguese
  'seu', 'sua', 'seus', 'suas', 'teu', 'tua', 'inserir', 'insira', 'adicionar', 'adicione', 'digite', 'informe',
  // Italian
  'il tuo', 'la tua', 'i tuoi', 'le tue', 'il suo', 'la sua', 'inserisci', 'inserire', 'aggiungi', 'aggiungere', 'indica',
  // Catalan
  'el teu', 'la teva', 'el vostre', 'la vostra', 'insereix', 'inseriu', 'afegeix', 'afegiu', 'escriviu',
  // Dutch
  'je', 'jouw', 'uw', 'voeg', 'vul',
  // Danish, Norwegian
  'din', 'dit', 'ditt', 'dine', 'indsæt', 'tilføj', 'sett inn', 'legg til', 'skriv',
  // Polish
  'twoje', 'twój', 'twoja', 'pana', 'pani', 'wstaw', 'wpisz', 'dodaj', 'podaj',
  // Czech, Slovak
  'vaše', 'váš', 'vaši', 'vaša', 'tvoje', 'tvůj', 'vložte', 'doplňte', 'zadejte', 'zadajte', 'uveďte',
  // Russian, Ukrainian
  'ваше', 'ваш', 'ваша', 'ваши', 'ваші', 'твоё', 'твое', 'твой', 'твоя', 'твоє', 'твій',
  'вставьте', 'укажите', 'введите', 'добавьте', 'вставте', 'вкажіть', 'введіть', 'додайте',
  // Romanian
  'introduceți', 'inserați', 'adăugați', 'completați',
  // Hungarian
  'az ön', 'a te', 'írja be', 'illessze be', 'adja meg',
  // Estonian, Latvian
  'teie', 'sinu', 'sisesta', 'sisestage', 'lisa', 'lisage',
  'jūsu', 'tavs', 'tava', 'ievadiet', 'ierakstiet', 'ievietojiet', 'pievienojiet', 'norādiet',
  // Turkish
  'şirketinizin', 'buraya',
  // Mongolian
  'таны', 'чиний',
  // Korean
  '귀하의', '당신의', '고객님의',
  // Arabic, Hebrew
  'أدخل', 'ادخل', 'أضف', 'اكتب', 'הכנס', 'הכניסו', 'הזן', 'הוסף',
];

// Languages that put the verb or "your" last: [Datum einfügen],
// [Numele tău], [נושא שלך], [نام شما], [이름 입력].
const PROMPT_END_WORDS = [
  'einfügen', 'eintragen', 'ergänzen',
  'invoegen', 'invullen', 'toevoegen',
  'tău', 'ta', 'dvs.', 'dumneavoastră',
  'ekleyin', 'girin', 'yazın',
  'оруулна уу',
  'שלך', 'שלכם',
  'شما', 'وارد کنید', 'اضافه کنید',
  '입력', '삽입', '추가',
];

// Japanese and Chinese have no spaces between words: [あなたの名前],
// [名前を入力], [您的姓名], [插入日期].
const PROMPT_START_UNSPACED = ['あなたの', '貴社の', '御社の', '您的', '你的', '贵公司', '貴公司', '插入', '输入', '輸入', '填写', '填寫', '添加', '新增', '在此'];
const PROMPT_END_UNSPACED = ['を入力', 'を記入', 'を挿入', 'を追加', 'を入れる'];

// Turkish possessive "your": [Adınız], [Şirket adınız].
const TURKISH_YOUR = '\\p{L}*[ıiuü]n[ıiuü]z';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alternation = (words: string[]) => words.map(escapeRegExp).join('|');

// Plain brackets, and the full-width and lenticular ones of CJK text.
const OPEN = '[\\[［【]';
const CLOSE = '[\\]］】]';
const INNER = '[^\\[\\]［］【】\\n]';

const PROMPT_BRACKET = new RegExp(
  `${OPEN}(?:` + [
    `(?:${alternation(PROMPT_START_WORDS)})\\s${INNER}{1,40}`,
    `${INNER}{1,40}\\s(?:${alternation(PROMPT_END_WORDS)})`,
    `(?:${alternation(PROMPT_START_UNSPACED)})${INNER}{1,40}`,
    `${INNER}{1,40}(?:${alternation(PROMPT_END_UNSPACED)})`,
    `(?:${INNER}{0,40}\\s)?${TURKISH_YOUR}`,
  ].join('|') + `)${CLOSE}(?!\\()`,
  'giu',
);

// Upper case only: "todo" or "tba" in a sentence is usually meant.
const UNFINISHED_WORD = /(?<![\p{L}\d_])(?:TODO|TBD|TBA|TBC|FIXME|XXX)(?![\p{L}\d_])/gu;

// Japanese and Korean stand-ins for a name or number: 〇〇様, ○○○ 님.
const CIRCLE_MARKER = /[〇○◯]{2,}/gu;

const SIGNATURE_START_SELECTOR = '[data-signature-block="separator"], [data-signature-block="start"]';
const SIGNATURE_END_SELECTOR = '[data-signature-block="end"]';

interface Match {
  start: number;
  end: number;
  text: string;
}

function collect(text: string, patterns: RegExp[]): Match[] {
  const matches: Match[] = [];
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) {
      if (pattern === CAPS_BRACKET && (m[0].match(/\p{Lu}/gu)?.length ?? 0) < 2) continue;
      matches.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    }
  }
  // "[TODO]" is a bracket and a word; keep the outer match only.
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Match[] = [];
  for (const match of matches) {
    const last = kept[kept.length - 1];
    if (last && match.start < last.end) continue;
    kept.push(match);
  }
  return kept;
}

/**
 * The unfilled placeholders in a message, each once, subject first. The
 * subject is only checked for template placeholders: it often carries tags
 * like [EXTERNAL] or words from the original message, which the sender did
 * not write. `bodyText` should be the text the sender wrote, without quoted
 * replies and the signature.
 */
export function findUnfilledPlaceholders(subject: string, bodyText: string): string[] {
  const found = [
    ...collect(subject, [TEMPLATE_PLACEHOLDER]),
    ...collect(bodyText, [TEMPLATE_PLACEHOLDER, CAPS_BRACKET, PROMPT_BRACKET, UNFINISHED_WORD, CIRCLE_MARKER]),
  ].map((m) => m.text);
  return Array.from(new Set(found));
}

/**
 * A compose body without its embedded signature. A signature is the same in
 * every message, so a placeholder in it would stop every send.
 */
export function stripEmbeddedSignatureHtml(html: string): string {
  if (!html.includes('data-signature-block')) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const startEl = doc.querySelector(SIGNATURE_START_SELECTOR);
  if (startEl) {
    const endEl = doc.querySelector(SIGNATURE_END_SELECTOR);
    let cursor: Node | null = startEl;
    while (cursor) {
      const next: Node | null = cursor.nextSibling;
      const isEnd = cursor === endEl;
      cursor.parentNode?.removeChild(cursor);
      if (isEnd) break;
      cursor = next;
    }
  }
  doc.querySelectorAll('[data-signature-block-node]').forEach((el) => el.remove());
  return doc.body.innerHTML;
}
