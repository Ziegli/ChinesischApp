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

  async function saveEdit() {
    if (!selectedId) return;
    const idx = cards.findIndex(x => x.id === selectedId);
    if (idx < 0) return;
    const now = Date.now();
    const updated: Card = {
      ...(cards[idx]),
      ...(edit as Partial<Card>),
      updatedAt: now
    } as Card;
    cards[idx] = updated;
    await upsertCard(updated);
    selectedId = null;
  }
</script>

<div class="container">
  <div class="header">
    <div style="display:flex; gap:8px; align-items:center;">
      <strong>CN‑SRS</strong>
      <span class="badge">Fällig: {dueCount}</span>
    </div>
    <div class="toolbar">
      <button class="btn" on:click={() => view='learn'}>Lernen</button>
      <button class="btn" on:click={() => view='manage'}>Karten</button>
      <button class="btn" on:click={() => view='import'}>Import/Export</button>
      <button class="btn" on:click={() => view='stats'}>Statistik</button>
    </div>
  </div>

  {#if view === 'learn'}
    <div class="card">
      {#if current}
        <!-- Obere Steuerleiste: Modus (links) + TTS Panel (rechts) -->
        <div style="display:flex; gap:1rem; align-items:center; margin-bottom:8px; flex-wrap:wrap; justify-content:space-between;">
          <div style="display:flex; gap:1rem; align-items:center;">
            <label for="learnMode">Übungsmodus</label>
            <select id="learnMode" bind:value={learnMode}>
              <option value="standard">Standard (Hanzi → Antwort)</option>
              <option value="pinyin-radical">Pinyin → Radikal wählen</option>
            </select>

            <div style="display:flex; align-items:center; gap:.25rem;">
              <input id="showMeaning" type="checkbox" bind:checked={showMeaningInChoice} />
              <label for="showMeaning">Deutsch anzeigen</label>
            </div>
          </div>

          <!-- TTS-Panel -->
          <div style="display:flex; gap:0.75rem; align-items:center;">
            <div>
              <label for="voice">TTS‑Stimme</label>
              <select id="voice" on:change={onVoiceChange} style="min-width:200px;">
                {#if voices.length === 0}
                  <option>(Lade Stimmen… ggf. Seite neu laden)</option>
                {:else}
                  {#each voices.filter(v => /zh|chinese|mandarin/i.test(v.lang + v.name)) as v}
                    <option value={v.name} selected={v.name === selectedVoiceName}>{v.name} ({v.lang})</option>
                  {/each}
                  <optgroup label="Andere Stimmen">
                    {#each voices.filter(v => !/zh|chinese|mandarin/i.test(v.lang + v.name)) as v}
                      <option value={v.name} selected={v.name === selectedVoiceName}>{v.name} ({v.lang})</option>
                    {/each}
                  </optgroup>
                {/if}
              </select>
            </div>

            <div style="display:flex; align-items:center; gap:.5rem;">
              <label for="rate">Tempo</label>
              <input id="rate" type="range" min="0.6" max="1.4" step="0.05" bind:value={ttsRate} />
              <span class="small">{ttsRate.toFixed(2)}</span>
            </div>

            <div style="display:flex; align-items:center; gap:.5rem;">
              <label for="pitch">Pitch</label>
              <input id="pitch" type="range" min="0.8" max="1.2" step="0.05" bind:value={ttsPitch} />
              <span class="small">{ttsPitch.toFixed(2)}</span>
            </div>

            <div style="display:flex; align-items:center; gap:.25rem;">
              <input id="autospeak" type="checkbox" bind:checked={autoSpeak} />
              <label for="autospeak">Automatisch vorlesen</label>
            </div>

            <div style="display:flex; gap:.25rem; align-items:center;">
              <button class="btn" on:click={speakHanzi}>🔊 Hanzi</button>
              <button class="btn" on:click={speakPinyin}>🔊 Pinyin</button>
            </div>
          </div>
        </div>

        {#if learnMode === 'standard'}
          {#if !showAnswer}
            <div class="center">
              <div class="hanzi">{current.hanzi}</div>
              <div class="radicals">Radikale: {current.radicals || '—'}</div>
              <div class="toolbar" style="justify-content:center; margin-top:12px;">
                <button class="btn" on:click={speakHanzi}>🔊 Hanzi</button>
                <button class="btn" on:click={speakPinyin}>🔊 Pinyin</button>
                <a class="btn" href={strokeOrderLink(current.hanzi)} target="_blank" rel="noopener noreferrer">✏️ Strichfolge</a>
              </div>
              <hr />
              <button class="btn-primary" on:click={() => { showAnswer = true; speak(current.pinyin, { rate: Math.max(0.8, ttsRate - 0.05) }); }}>
                Antwort anzeigen
              </button>
            </div>
          {:else}
            <div class="grid">
              <div class="pinyin">Pinyin: {current.pinyin}</div>
              <div class="meaning">Bedeutung: {current.meaning_de}</div>
              <div class="radicals">Radikale: {current.radicals || '—'}</div>
            </div>
            <div class="toolbar" style="justify-content:center; margin-top:12px;">
              <button class="btn-again" on:click={() => rate('again')}>Wiederholen</button>
              <button class="btn-hard" on:click={() => rate('hard')}>Schwer</button>
              <button class="btn-good" on:click={() => rate('good')}>Gut</button>
              <button class="btn" on:click={() => rate('easy')}>Einfach</button>
            </div>
          {/if}

        {:else}
          <!-- Pinyin -> Radikal Modus -->
          <div class="center">
            <div class="pinyin-large" style="font-size:48px;">{current.pinyin}</div>
            {#if showMeaningInChoice}
              <div class="small" style="margin-bottom:8px;">{current.meaning_de}</div>
            {/if}

            <div class="grid" style="grid-template-columns:repeat(2,1fr); gap:8px; max-width:420px; margin:auto;">
              {#each choices as r}
                <button
                  class="btn"
                  on:click={() => {
                    if (selectedChoice) return;
                    selectedChoice = r;
                    showChoiceFeedback = true;
                    const correct = (current.radicals || '').split(',')[0].trim() || '—';
                    const rating = (r === correct) ? 'good' : 'hard';
                    if (r === correct) speak(current.hanzi, { rate: ttsRate });
                    setTimeout(() => { rate(rating); }, 700);
                  }}
                  style="min-height:48px; font-size:18px;"
                >
                  {#if showChoiceFeedback && selectedChoice === r}
                    {#if r === (current.radicals || '').split(',')[0].trim()}
                      ✅ {r}
                    {:else}
                      ❌ {r}
                    {/if}
                  {:else if showChoiceFeedback && r === (current.radicals || '').split(',')[0].trim()}
                    ✅ {r}
                  {:else}
                    {r}
                  {/if}
                </button>
              {/each}
            </div>

            <div style="margin-top:12px;">
              <button class="btn" on:click={() => { selectedChoice=null; showChoiceFeedback=false; rate('again'); }}>Überspringen</button>
            </div>
          </div>
        {/if}

      {:else}
        <div class="center">
          <p>Keine fälligen Karten. 🎉</p>
          <p class="small">Füge neue Karten hinzu oder warte bis welche fällig sind.</p>
        </div>
      {/if}
    </div>
  {/if}

  {#if view === 'manage'}
    <div class="card">
      <div class="toolbar">
        <input class="input" placeholder="Suche (Hanzi, Pinyin, Tags)" bind:value={filter} />
        <button class="btn" on:click={copyRadicalsHint}>Hinweis Radikale</button>
      </div>

      <div class="grid" style="margin-top:12px;">
        {#each cards.filter(c =>
            !filter ||
            c.hanzi.includes(filter) ||
            c.pinyin.toLowerCase().includes(filter.toLowerCase()) ||
            (c.tags || '').toLowerCase().includes(filter.toLowerCase())
          ) as item (item.id)}
          <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div>
                <div class="hanzi" style="font-size:42px;">{item.hanzi}</div>
                <div class="pinyin">{item.pinyin}</div>
                <div class="meaning">{item.meaning_de}</div>
                <div class="radicals">Radikale: {item.radicals || '—'}</div>
                <div class="small">Tags: {item.tags || '—'}</div>
              </div>
              <div>
                <button class="btn" on:click={() => { selectedId = item.id; edit = { ...item }; }}>Bearbeiten</button>
                <button class="btn" on:click={() => removeCard(item.id)}>Löschen</button>
              </div>
            </div>

            {#if selectedId === item.id}
              <hr />
              <div class="grid grid-2">
                <input class="input" placeholder="Hanzi" bind:value={edit.hanzi} />
                <input class="input" placeholder="Pinyin" bind:value={edit.pinyin} />
                <input class="input" placeholder="Bedeutung (DE)" bind:value={edit.meaning_de} />
                <input class="input" placeholder="Radikale" bind:value={edit.radicals} />
                <input class="input" placeholder="Tags" bind:value={edit.tags} />
              </div>
              <div class="toolbar" style="margin-top:8px;">
                <button class="btn-primary" on:click={saveEdit}>Speichern</button>
                <button class="btn" on:click={() => { selectedId = null; }}>Abbrechen</button>
              </div>
            {/if}
          </div>
        {/each}
      </div>

      <hr />
      <h3>Neue Karte</h3>
      <div class="grid grid-2">
        <input class="input" placeholder="Hanzi" bind:value={newCard.hanzi} />
        <input class="input" placeholder="Pinyin (ni3 hao3)" bind:value={newCard.pinyin} />
        <input class="input" placeholder="Bedeutung (DE)" bind:value={newCard.meaning_de} />
        <input class="input" placeholder="Radikale (亻,讠)" bind:value={newCard.radicals} />
        <input class="input" placeholder="Tags (HSK1,Alltag)" bind:value={newCard.tags} />
      </div>
      <div class="toolbar" style="margin-top:8px%;">
        <button class="btn-primary" on:click={addCard}>Hinzufügen</button>
      </div>
    </div>
  {/if}

  {#if view === 'import'}
    <div class="card">
      <h3>Import/Export</h3>
      <div class="grid grid-3">
        <div>
          <label class="small" for="impCsv">Import CSV</label>
          <input id="impCsv" type="file" accept=".csv,text/csv" on:change={(e)=>importFromFile(e,'csv')} />
        </div>
        <div>
          <label class="small" for="impJson">Import JSON</label>
          <input id="impJson" type="file" accept=".json,application/json" on:change={(e)=>importFromFile(e,'json')} />
        </div>
        <div class="toolbar">
          <button class="btn" on:click={exportAsCSV}>Export CSV</button>
          <button class="btn" on:click={exportAsJSON}>Export JSON</button>
          <button class="btn" on:click={makeAllDueNow}>Alle Karten jetzt fällig machen</button>

          <!-- Debug-Buttons -->
          <button class="btn" on:click={testAlert}>Test: Alert</button>
          <button class="btn" on:click={logFirstReviews}>Debug: Reviews prüfen (Konsole)</button>
        </div>
      </div>

      <hr />
      <p class="small" style="margin-top:8px;">CSV-Spalten: hanzi,pinyin,meaning_de,radicals,tags</p>
    </div>
  {/if}

  {#if view === 'stats'}
    <div class="card center">
      <h3>Statistik</h3>
      <p>Fällige Karten: {dueCount}</p>
      <p class="small">Einfach gehalten – erweitern wir später gern.</p>
    </div>
  {/if}
</div>
