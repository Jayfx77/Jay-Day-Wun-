// Converts text to the GSM 03.38 SMS alphabet. Any character outside it (₵, …, curly quotes,
// emoji, Twi letters such as ɛ and ɔ) makes the whole text use Unicode encoding, which fits
// about 70 characters per SMS instead of 160 and roughly doubles the cost.

const BASIC = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const EXTENDED = '^{}\\[~]|€'; // allowed, but each counts as 2 characters
const ALLOWED = new Set([...BASIC, ...EXTENDED]);

const REPLACE = [
  [/GH₵\s?/g, 'GHS '],
  [/₵\s?/g, 'GHS '],
  [/[‘’‚‛′]/g, "'"],
  [/[“”„‟″«»]/g, '"'],
  [/[‐-―−]/g, '-'],
  [/…/g, '...'],
  [/[  -​  　]/g, ' '],
  [/[·•]/g, '-'],
  [/[ɛƐ]/g, (c) => (c === 'ɛ' ? 'e' : 'E')],
  [/[ɔƆ]/g, (c) => (c === 'ɔ' ? 'o' : 'O')],
  [/[ŋŊ]/g, (c) => (c === 'ŋ' ? 'n' : 'N')],
  [/✔|✓/g, ''],
];

function toGsm(text) {
  let s = String(text);
  for (const [re, to] of REPLACE) s = s.replace(re, to);
  let out = '';
  for (const ch of s) {
    if (ALLOWED.has(ch)) { out += ch; continue; }
    // Strip accents from letters GSM doesn't have (e.g. ê -> e, ô -> o).
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (base && [...base].every((c) => ALLOWED.has(c))) out += base;
    // Anything else (emoji, symbols) is dropped.
  }
  return out.replace(/ {2,}/g, ' ').trim();
}

const isGsm = (text) => [...String(text)].every((c) => ALLOWED.has(c));

module.exports = { toGsm, isGsm };
