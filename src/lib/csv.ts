import Papa from 'papaparse';
import type { Card } from './types';

export function exportCSV(cards: Card[]): string {
  const rows = cards.map(c => ({
    hanzi: c.hanzi,
    pinyin: c.pinyin,
    meaning_de: c.meaning_de,
    radicals: c.radicals || '',
    tags: c.tags || ''
  }));
  return Papa.unparse(rows);
}

export function parseCSV(text: string): Omit<Card, 'id' | 'createdAt' | 'updatedAt'>[] {
  const res = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
  if (res.errors.length) {
    throw new Error('CSV-Fehler: ' + res.errors.map(e => e.message).join('; '));
  }
  const rows = res.data as any[];
  return rows.map(r => ({
    hanzi: String(r.hanzi || '').trim(),
    pinyin: String(r.pinyin || '').trim(),
    meaning_de: String(r.meaning_de || '').trim(),
    radicals: String(r.radicals || '').trim(),
    tags: String(r.tags || '').trim()
  }));
}

export function exportJSON(cards: Card[]): string {
  return JSON.stringify(cards, null, 2);
}

export function parseJSON(text: string): Omit<Card, 'id' | 'createdAt' | 'updatedAt'>[] {
  const arr = JSON.parse(text);
  if (!Array.isArray(arr)) throw new Error('JSON erwartet ein Array von Karten');
  return arr.map((r: any) => ({
    hanzi: String(r.hanzi || '').trim(),
    pinyin: String(r.pinyin || '').trim(),
    meaning_de: String(r.meaning_de || '').trim(),
    radicals: String(r.radicals || '').trim(),
    tags: String(r.tags || '').trim()
  }));

  function numberToTone(pinyinWithNumbers: string): string {
  // Map für Vokal+Ton → Vokal mit Tonzeichen
  const toneMap: Record<string, string> = {
    a1:'ā', a2:'á', a3:'ǎ', a4:'à',
    e1:'ē', e2:'é', e3:'ě', e4:'è',
    i1:'ī', i2:'í', i3:'ǐ', i4:'ì',
    o1:'ō', o2:'ó', o3:'ǒ', o4:'ò',
    u1:'ū', u2:'ú', u3:'ǔ', u4:'ù',
    v1:'ǖ', v2:'ǘ', v3:'ǚ', v4:'ǜ', // v = ü in Zahlennotation
    ü1:'ǖ', ü2:'ǘ', ü3:'ǚ', ü4:'ǜ'
  };
  // Regel: a > o > e > i/u/ü; bei iu/ui markiere den zweiten Vokal
  const syllable = (syll: string) => {
    const m = syll.match(/^([a-züv]+)([1-5])$/i);
    if (!m) return syll.replace(/v/g,'ü'); // kein Ton → nur v→ü
    const base = m[1].replace(/v/g,'ü'); const tone = m[2];
    if (tone === '5') return base; // neutraler Ton
    const lower = base.toLowerCase();
    const idxA = lower.indexOf('a');
    const idxO = lower.indexOf('o');
    const idxE = lower.indexOf('e');
    let i = -1;
    if (idxA !== -1) i = idxA;
    else if (idxO !== -1) i = idxO;
    else if (idxE !== -1) i = idxE;
    else {
      // i/u/ü oder Diphthonge
      const iu = lower.indexOf('iu');
      const ui = lower.indexOf('ui');
      if (iu !== -1) i = iu + 1; // zweiter Vokal u
      else if (ui !== -1) i = ui + 1; // zweiter Vokal i
      else {
        // erstes Vokal-vorkommen
        i = lower.search(/[iuü]/);
      }
    }
    if (i === -1) return base;
    const vowel = base[i];
    const key = vowel.toLowerCase() + tone as keyof typeof toneMap;
    const toned = toneMap[key] || vowel;
    return base.slice(0,i) + toned + base.slice(i+1);
  };
  return pinyinWithNumbers
    .split(/\s+/)
    .map(s => s.split(/-/).map(syllable).join('-'))
    .join(' ');
}

}
