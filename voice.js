'use strict';
// Voice shot calls (voicecalls.py), on the Director page: the host says a camera's shot aloud ("cut to the overhead",
// "show the stove", "wide shot") and the director puts it on air, holding it as it does a camera chosen by hand. The
// switches (listening, and shot calls for this kind of event), what each camera answers to with phrases of its own, how
// sure a call must be, what was heard and what it did, and a box to try a phrase. Each camera's card says what it
// answers to through window.voiceCard. Heard by the same listening as Cooking's spoken cues (speech.py).
// Uses app.js's api(), node(), editing(), part, role and csrf.
(() => {
  const panel = document.querySelector('#voice-shots');
  if (!panel) return;
  let state = null, drawnFrom = '', said = '', busy = false, fetchedAt = Date.now();
  const clock = seconds => { const s = Math.max(0, Math.floor(seconds)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const modeName = id => window.concert?.mode?.modes?.find(m => m.id === id)?.short || id;

  async function send(body, done) {
    busy = true; said = 'Saving…'; paint(true);
    try { state = await api('/api/voice', { method: 'POST', body: JSON.stringify(body) }); fetchedAt = Date.now(); said = done ?? 'Saved.'; }
    catch (error) { said = error.message; }
    finally { busy = false; paint(true); }
  }
  const button = (text, act, kind) => { const b = node('button', text); b.type = 'button'; b.disabled = busy; if (kind) b.className = kind; b.onclick = act; return b; };
  const checkbox = (text, on, act, disabled) => {
    const label = node('label', ''), tick = document.createElement('input'); tick.type = 'checkbox'; tick.checked = !!on; tick.disabled = busy || !!disabled; tick.onchange = () => act(tick.checked);
    label.append(tick, node('span', ` ${text}`)); return label;
  };
  const quoted = list => list.map(p => `“${p}”`).join(', ');

  function switches(v, s) {
    const box = node('div', ''); box.className = 'recipe-cues';
    box.append(checkbox(v.cooking ? 'Listen to the host (the same switch as the Recipe page’s spoken cues)' : 'Listen to the host', v.enabled, on => send({ listen: on }), !v.allowed));
    box.append(checkbox(`Cut to a camera when its shot is called, in ${modeName(s.mode)}`, s.on, on => send({ on })));
    const why = node('small', `${modeName(s.mode)}: ${s.default ? 'on' : 'off'} unless switched. On by default in Cooking and Studio, where one host talks to their own cameras; off in live music, worship and theatre (sung words, a congregation and scripted lines would call cameras by mistake) and in a podcast or panel (people call each other by the names cameras are given).`);
    box.append(why);
    if (s.set) box.append(button(`Back to ${modeName(s.mode)}’s default (${s.default ? 'on' : 'off'})`, () => send({ on: null })));
    return box;
  }

  function hearing(v) {
    const box = node('div', '');
    if (!v.enabled) return box;
    const where = node('p', ''); where.className = 'recipe-load-row';
    const device = document.createElement('input'); device.type = 'text'; device.value = v.device; device.size = 24; device.placeholder = 'the programme’s sound'; device.setAttribute('aria-label', 'Microphone input to listen to');
    const model = document.createElement('select'); model.setAttribute('aria-label', 'Speech model');
    for (const [name, size] of v.models) { const o = node('option', `Whisper ${name} (${size})${name === 'small.en' ? ', the default' : ', for a smaller computer'}`); o.value = name; o.selected = name === v.model; model.append(o); }
    model.onchange = () => send({ model: model.value });
    where.append(node('span', 'Listen to '), device, button('Save', () => send({ device: device.value.trim() })), model);
    const status = node('p', '');
    if (!v.listening) status.append(node('span', 'Not listening: nothing to act on in this kind of event while shot calls are off.'));
    else if (v.problem || !v.runtime || !v.installed) { status.textContent = `Not listening yet: ${v.problem || (!v.runtime ? 'speech recognition is not installed' : 'the speech model is not downloaded')}. Set it up in AI assistance above.`; status.className = 'recording-warning'; }
    else status.textContent = `Listening to ${v.source}.`;
    box.append(where, node('small', 'Blank: the programme’s sound (the host’s microphone monitored to it in OBS). Or the name of a sound input on this computer that has the host’s microphone.'), status);
    return box;
  }

  function cameras(s) {
    const box = node('div', ''); box.className = 'voice-cameras';
    box.append(node('h4', 'What each camera answers to'));
    if (!s.cameras.length) { box.append(node('small', 'No cameras are paired at this location yet.')); return box; }
    const list = document.createElement('ul');
    for (const camera of s.cameras) {
      const li = document.createElement('li');
      const own = camera.phrases.filter(p => p.source === 'own').map(p => p.phrase), given = camera.phrases.filter(p => p.source !== 'own');
      const line = node('div', ''); line.append(node('strong', camera.name), node('span', ' · '));
      given.forEach((p, n) => { const chip = node('span', p.phrase); chip.className = p.shared ? 'voice-phrase shared' : 'voice-phrase'; if (p.shared) chip.title = 'Another camera answers to this too: it is not acted on until one of them has a phrase of its own.'; line.append(chip, node('span', n < given.length - 1 ? ' ' : '')); });
      const form = document.createElement('form'); form.className = 'recipe-load-row';
      const input = document.createElement('input'); input.type = 'text'; input.size = 30; input.maxLength = 300; input.value = own.join(', '); input.placeholder = 'its own phrases, with commas: overhead, the bench'; input.setAttribute('aria-label', `${camera.name}: phrases of its own`);
      const save = node('button', 'Save'); save.disabled = busy;
      form.append(input, save);
      form.onsubmit = event => { event.preventDefault(); send({ phrases: { [camera.id]: input.value.split(',').map(p => p.trim()).filter(Boolean) } }, `${camera.name} saved.`); };
      li.append(line, form);
      list.append(li);
    }
    box.append(list, node('small', 'From its name, its slot (“camera 2”) and what it is given to show on its card, and phrases of its own, which win over another camera’s. A phrase shown struck through is shared by two cameras and is not acted on.'));
    return box;
  }

  function heardBox(v) {
    const heard = node('div', ''); heard.className = 'recipe-heard'; heard.append(node('h4', 'Heard'));
    if (!v.heard.length) { heard.append(node('small', v.listening ? 'Nothing yet.' : 'Nothing: not listening. Try a phrase below to see what it would do.')); return heard; }
    const list = document.createElement('ul');
    for (const entry of v.heard) {
      const li = document.createElement('li'); li.className = entry.did ? 'did' : 'ignored';
      const ago = entry.ago + (Date.now() - fetchedAt) / 1000;
      li.append(node('q', entry.text), node('small', ` ${entry.typed ? 'typed' : `${Math.round(entry.sure * 100)}% sure`}, ${clock(ago)} ago`), node('br', ''), node('span', entry.did ? `→ ${entry.did}` : `→ nothing: ${entry.why}`));
      list.append(li);
    }
    heard.append(list);
    return heard;
  }

  function paint(all) {
    if (!state || !state.shots) return;
    const v = state, s = v.shots;
    const now = JSON.stringify([{ ...v, heard: v.heard.map(e => [e.at, e.text, e.did, e.why]), heard_at: null }, said, busy, Math.floor(Date.now() / 10000)]);
    if (!all && (editing(panel) || now === drawnFrom)) return;
    drawnFrom = now;
    const intro = node('p', 'Say a camera’s shot aloud and the director puts it on air at once, then holds it as it does a camera chosen by hand' +
      ` (${Math.round(s.hold_seconds)} s, Hold after a person chooses, under Director settings), so the automatic choosing does not cut straight away: “cut to the overhead”, “show the stove”, “back to the wide”, or just “Wide shot!”. A name in passing (“the stove is hot”), a question or “don’t cut to the stove” does nothing. Speech is recognised on this computer: nothing heard is sent anywhere, and what was heard is kept here only, for the last few phrases, never saved.`);
    const parts = [node('h2', 'Voice shot calls'), intro];
    if (!v.allowed) { const need = node('p', 'Listening is part of the Standard and Plus AI levels: choose one in AI assistance above. You can still try a phrase below.'); need.className = 'recording-warning'; parts.push(need); }
    const sure = node('p', ''); sure.className = 'recipe-load-row';
    const pick = document.createElement('select'); pick.setAttribute('aria-label', 'How sure a call must be');
    for (const [value, text] of [[0.6, 'a little sure (60%)'], [0.7, 'fairly sure (70%), the default'], [0.8, 'quite sure (80%)'], [0.9, 'very sure (90%)']]) { const o = node('option', text); o.value = value; o.selected = Math.abs(value - s.min_confidence) < 0.01; pick.append(o); }
    pick.disabled = busy; pick.onchange = () => send({ min_confidence: Number(pick.value) });
    sure.append(node('span', 'Act on a call when the recogniser is '), pick);
    const try_ = document.createElement('form'); try_.className = 'recipe-load-row';
    const phrase = document.createElement('input'); phrase.type = 'text'; phrase.maxLength = 240; phrase.size = 34; phrase.placeholder = 'Cut to the overhead'; phrase.setAttribute('aria-label', 'A phrase, as if the host said it');
    const act = node('button', 'Act on it'); act.disabled = busy;
    try_.append(node('span', 'Try a phrase, as if the host said it: '), phrase, act);
    try_.onsubmit = event => { event.preventDefault(); const text = phrase.value.trim(); if (!text) return; phrase.value = ''; send({ say: text }, ''); };
    const message = node('p', said); message.setAttribute('aria-live', 'polite'); if (/not |need|fail|error|refus|must|at most/i.test(said)) message.className = 'recording-warning';
    parts.push(switches(v, s), hearing(v), sure, cameras(s), heardBox(v), try_, node('small', 'It acts on the show as a call would: the camera goes on air.'), message);
    panel.replaceChildren(...parts);
  }

  // Each camera's card: what it answers to, in "What it shows".
  window.voiceCard = (camera, shots) => {
    const mine = state?.shots?.cameras.find(c => c.id === camera.id);
    if (!mine || !state.shots.on) return;
    const line = node('small', `Called aloud: ${quoted(mine.phrases.filter(p => !p.shared).slice(0, 6).map(p => p.phrase))}. `);
    const go = document.createElement('a'); go.href = '/director'; go.textContent = 'Phrases of its own (Director)';
    go.onclick = event => { if (event.metaKey || event.ctrlKey || event.shiftKey) return; event.preventDefault(); history.pushState(null, '', '/director'); window.concert.pick?.('/director'); };
    line.append(go); line.className = 'card-setting'; shots.append(line);
  };

  async function refresh() {
    const showing = typeof part !== 'undefined' && (part === '/director' || part === '/cameras') && csrf;
    panel.hidden = !(showing && part === '/director');
    if (!showing || busy) return;
    try { state = await api('/api/voice'); fetchedAt = Date.now(); if (part === '/director') paint(false); } catch (error) { said = error.message; }
  }
  document.addEventListener('event-mode', refresh);
  setInterval(refresh, 3000); refresh();
})();
