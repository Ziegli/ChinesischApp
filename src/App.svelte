<script lang="ts">
  import { onMount, afterUpdate } from 'svelte';
  import { getAll, saveAll, upsertCard, deleteCard, upsertReview } from './lib/storage';
  import type { Card, ReviewState } from './lib/types';
  import { initReviewState, review, type Rating } from './lib/srs';
  import { exportCSV, parseCSV, exportJSON, parseJSON } from './lib/csv';

  // Debug
  function logFirstReviews() {
    const now = Date.now();
    console.log('=== DEBUG REVIEWS START ===');
    console.log('Cards total:', cards.length);
    const sample = cards.slice(0, Math.min(5, cards.length));
    for (const c of sample) {
      const r = reviews[c.id];
      console.log(
        'Card',
        c?.id,
        c?.hanzi,
        r
          ? { dueAt: r.dueAt, interval: r.interval, ease: r.ease, due: r.dueAt <= now }
          : 'NO REVIEW'
      );
    }
    console.log('=== DEBUG REVIEWS END ===');
  }
  async function testAlert() { alert('Debug-Button wurde geklickt'); }

  // TTS
  let voices: SpeechSynthesisVoice[] = [];
  let selectedVoiceName = '';
  let preferredVoice: SpeechSynthesisVoice | null = null;
  let ttsRate = 0.9;
  let ttsPitch = 1.0;

  function refreshVoices() {
    if (!('speechSynthesis' in window)) return;
    voices = window.speechSynthesis.getVoices();
    if (!preferredVoice && voices.length) {
      const byName = voices.find(v => /Google.*Chinese|Ting-?Ting|Mei-?Jia|Xiao-?Yu/i.test(v.name));
      const byLang = voices.find(v => /zh|chinese|mandarin/i.test(v.lang + v.name));
      preferredVoice = byName || byLang || voices[0] || null;
      selectedVoiceName = preferredVoice?.name || '';
    }
  }
  if ('speechSynthesis' in window) {
    refreshVoices();
    window.speechSynthesis.onvoiceschanged = refreshVoices;
  }

  function speak(text: string, opts?: { lang?: string; rate?: number; pitch?: number; volume?: number }) {
    if (!('speechSynthesis' in window)) { console.warn('Web Speech API nicht verfügbar'); return; }
    const u = new SpeechSynthesisUtterance(text);
    const chosen = voices.find(v => v.name === selectedVoiceName) || preferredVoice;
    if (chosen) { u.voice = chosen; u.lang = chosen.lang; } else { u.lang = opts?.lang ?? 'zh-CN'; }
    u.rate = opts?.rate ?? ttsRate;
    u.pitch = opts?.pitch ?? ttsPitch;
    u.volume = opts?.volume ?? 1.0;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }
  function speakHanzi(){ if(!current) return; speak(current.hanzi, { rate: ttsRate }); }
  function speakPinyin(){ if(!current) return; speak(current.pinyin, { rate: Math.max(0.8, ttsRate-0.05) }); }
  function onVoiceChange(e: Event){ const sel = e.target as HTMLSelectElement; selectedVoiceName = sel?.value || ''; }

  // ID/Utils
  function uid(){ return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2); }

  async function makeAllDueNow() {
    const now = Date.now();
    for (const c of cards) {
      if (!reviews[c.id]) reviews[c.id] = initReviewState(c.id);
      reviews[c.id].dueAt = now;
      reviews[c.id].interval = reviews[c.id].interval ?? 0;
      reviews[c.id].ease = reviews[c.id].ease ?? 2.5;
      await upsertReview(reviews[c.id]);
    }
    alert('Alle Karten sind jetzt fällig.');
  }

  // State
  let cards: Card[] = [];
  let reviews: Record<string, ReviewState> = {};
  let view: 'learn' | 'manage' | 'import' | 'stats' = 'learn';
  let showAnswer = false;

  let filter = '';
  let selectedId: string | null = null;
  let edit: Partial<Card> = {};
  let newCard: Partial<Card> = { hanzi: '', pinyin: '', meaning_de: '', radicals: '', tags: '' };

  // Lernmodus & Optionen
  type LearnMode = 'standard' | 'pinyin-radical';
  let learnMode: LearnMode = 'standard';
  let showMeaningInChoice = true; // Checkbox: deutsche Bedeutung im Radikalmodus anzeigen
  let autoSpeak = true;            // Auto‑TTS Toggle
  let lastSpokenId: string | null = null;

  // Pinyin->Radikal Modus state
  let choices: string[] = [];
  let selectedChoice: string | null = null;
  let showChoiceFeedback = false;

  // Reaktiv
  $: dueCards = cards.filter(c => {
    const r = reviews[c.id];
    return r?.dueAt !== undefined && r.dueAt <= Date.now();
  });
  $: dueCount = dueCards.length;
  $: current = dueCards.length ? dueCards[0] : null;

  // Auswahl-Set für Radikalmodus
  function sampleRadicals(n: number, exclude?: string) {
    const pool = Array.from(new Set(cards.map(c => (c.radicals || '—').split(',')[0].trim()).filter(x => x && x !== '—')));
    const candidates = pool.filter(x => x !== exclude);
    const out: string[] = [];
    while (out.length < n && candidates.length > 0) {
      const i = Math.floor(Math.random() * candidates.length);
      out.push(candidates.splice(i,1)[0]);
    }
    // Fallbacks
    const common = ['口','亻','氵','木','日','月','女','心','手','言'];
    for (const c of common) {
      if (out.length >= n) break;
      if (c !== exclude && !out.includes(c)) out.push(c);
    }
    return out.slice(0,n);
  }

  // Choices neu generieren, wenn Modus/Karte wechselt
  $: if (learnMode === 'pinyin-radical' && current) {
    const correct = (current.radicals || '').split(',')[0].trim() || '—';
    const wrong = sampleRadicals(3, correct);
    choices = [...wrong, correct].sort(() => Math.random() - 0.5);
    selectedChoice = null;
    showChoiceFeedback = false;
  }

  // Review State sichern
  function ensureState(id: string): ReviewState {
    if (!reviews[id]) reviews[id] = initReviewState(id);
    return reviews[id];
  }

  async function rate(r: Rating) {
    if (!current) return;
    const prev = ensureState(current.id);
    const next = review(prev, r);
    reviews[current.id] = next;
    await upsertReview(next);
    showAnswer = false;
  }

  // Auto-TTS auf Kartenwechsel
  afterUpdate(() => {
    if (autoSpeak && view === 'learn' && current && !showAnswer && current.id !== lastSpokenId) {
      speak(current.hanzi, { rate: ttsRate });
      lastSpokenId = current.id;
    }
  });

  // CRUD / Import-Export
  async function addCard() {
    if (!newCard.hanzi || !newCard.pinyin || !newCard.meaning_de) {
      alert('Bitte Hanzi, Pinyin und Bedeutung ausfüllen.');
      return;
    }
    const now = Date.now();
    const c: Card = {
      id: uid(),
      hanzi: newCard.hanzi!.trim(),
      pinyin: newCard.pinyin!.trim(),
      meaning_de: newCard.meaning_de!.trim(),
      radicals: (newCard.radicals || '').trim(),
      tags: (newCard.tags || '').trim(),
      createdAt: now,
      updatedAt: now
    };
    cards = [...cards, c];
    reviews[c.id] = ensureState(c.id);
    await upsertCard(c);
    newCard = { hanzi: '', pinyin: '', meaning_de: '', radicals: '', tags: '' };
    view = 'learn';
  }

  async function removeCard(id: string) {
    if (!confirm('Diese Karte wirklich löschen?')) return;
    await deleteCard(id);
    const { cards: c2, reviews: r2 } = await getAll();
    cards = c2; reviews = r2;
  }

  async function exportAsCSV() {
    const text = exportCSV(cards);
    downloadText('cards.csv', text);
  }
  async function exportAsJSON() {
    const text = exportJSON(cards);
    downloadText('cards.json', text);
  }
  function downloadText(filename: string, text: string) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  async function importFromFile(ev: Event, kind: 'csv' | 'json') {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    const items = kind === 'csv' ? parseCSV(text) : parseJSON(text);
    const now = Date.now();
    const newOnes: Card[] = items.map(it => ({
      id: uid(),
      hanzi: it.hanzi,
      pinyin: it.pinyin,
      meaning_de: it.meaning_de,
      radicals: it.radicals,
      tags: it.tags,
      createdAt: now,
      updatedAt: now
    }));
    cards = [...cards, ...newOnes];
    for (const c of newOnes) reviews[c.id] = initReviewState(c.id);
    await saveAll(cards, reviews);
    alert(`${newOnes.length} Karten importiert.`);
    view = 'learn';
  }

  function strokeOrderLink(hanzi: string) {
    const ch = encodeURIComponent(hanzi);
    return `https://www.google.com/search?q=${ch}+stroke+order`;
  }
  function copyRadicalsHint() { alert('Radikale als Komma-Liste speichern: 亻,讠,口'); }

  onMount(async () => {
    const data = await getAll();
    cards = data.cards;
    reviews = data.reviews;
  });

  // FIXED: robustes Mergen ohne problematische TS-Casts im Literal
  async function saveEdit() {
    if (!selectedId) return;
    const idx = cards.findIndex(x => x.id === selectedId);
    if (idx < 0) return;

    const now = Date.now();
    const base = cards[idx];
    const patch = (edit ?? {}) as Partial<Card>;

    const merged = {
      ...base,
      ...patch,
      updatedAt: now
    };

    const updated: Card = merged as Card;

    cards[idx] = updated;
    await upsertCard(updated);
    selectedId = null;
  }
</script>
