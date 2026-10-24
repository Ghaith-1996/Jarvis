// Pure text helpers used for speech: reply language guess, sentence chunking, pronunciation rules, ASR cleanup.
import type { Lang, Pronunciation } from './contracts.ts';

const FR_WORDS = new Set(['le', 'la', 'les', 'des', 'une', 'est', 'et', 'je', 'tu', 'vous', 'nous', 'pas', 'que', 'qui', 'pour', 'dans', 'avec', 'sur', 'ce', 'cette', 'du', 'au', 'aux', 'mais', 'ou', 'bonjour', 'oui', 'merci', 'ça', 'très', 'il', 'elle', 'sont', 'être', 'avoir', 'fait', 'peux', 'voici']);
const EN_WORDS = new Set(['the', 'a', 'an', 'is', 'are', 'and', 'i', 'you', 'we', 'not', 'that', 'which', 'for', 'in', 'with', 'on', 'this', 'of', 'to', 'but', 'or', 'hello', 'yes', 'thanks', 'it', 'he', 'she', 'be', 'have', 'do', 'can', 'here', 'what', 'your']);

/** Guess whether a reply is French or English; `fallback` wins ties (e.g. the user's speech language). */
export function guessLang(text: string, fallback: Lang): Lang {
  let fr = 0, en = 0;
  for (const w of text.toLowerCase().match(/[\p{L}']+/gu) ?? []) {
    if (FR_WORDS.has(w)) fr++;
    if (EN_WORDS.has(w)) en++;
  }
  fr += (text.match(/[éèêàçùâîôûœ]/gi) ?? []).length * 0.5;
  return fr > en ? 'fr' : en > fr ? 'en' : fallback;
}

/** Split text into speakable chunks at sentence ends, keeping chunks under ~300 chars so TTS starts quickly. */
export function sentences(text: string): string[] {
  const cleaned = text.replace(/```[\s\S]*?```/g, ' ').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
  const parts = cleaned.match(/[^.!?…]+[.!?…]*["»)]?\s*/g) ?? [];
  const out: string[] = [];
  for (const p of parts.map((s) => s.trim()).filter(Boolean)) {
    if (p.length <= 140) { out.push(p); continue; }
    // Long sentence: break at commas/semicolons so slower voices start speaking sooner; hard-cut anything still huge.
    let cur = '';
    for (const piece of p.split(/(?<=[,;:])\s+/)) {
      if (cur && cur.length + piece.length > 140) { out.push(cur); cur = ''; }
      cur = cur ? `${cur} ${piece}` : piece;
    }
    if (cur) out.push(cur);
  }
  return out.flatMap((c) => (c.length <= 300 ? [c] : Array.from({ length: Math.ceil(c.length / 300) }, (_, i) => c.slice(i * 300, i * 300 + 300))));
}

/** Plain-ASCII version for engines that cannot take Unicode on their command line (accents dropped, quotes/dashes mapped). */
export function toAscii(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[‘’]/g, "'").replace(/[“”«»]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Apply user pronunciation rules for one language, whole words only, case-sensitive as written. */
export function applyPronunciations(text: string, lang: Lang, rules: Pronunciation[]): string {
  let out = text;
  for (const r of rules) {
    if (r.lang !== lang || !r.from) continue;
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(r.from)}(?![\\p{L}\\p{N}])`, 'gu'), r.to);
  }
  return out;
}

/** Drop whisper's non-speech annotations ("[MUSIC]", "(Musique)", "*rires*"); returns '' when nothing spoken remains. */
export function cleanTranscript(text: string): string {
  return text.replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ').replace(/\s+/g, ' ').trim();
}
