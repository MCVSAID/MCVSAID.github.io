'use strict';
// Programme sound from (programmesound.py), on the Sound page: which camera's microphone the programme carries, and
// whether the other cameras' join it, each only while it is lined up with the chosen one.
(() => {
  const panel = document.querySelector('#programme-sound');
  if (!panel) return;
  let state = null, drawnFrom = '', said = '', busy = false;

  async function send(body, where = '/api/programme-sound', saying = 'Saving…', done = 'Saved.') {
    busy = true; said = saying; paint(true);
    try { state = await api(where, { method: 'POST', body: JSON.stringify(body) }); said = done; }
    catch (error) { said = error.message; }
    finally { busy = false; paint(true); }
  }

  function paint(all) {
    if (!state) return;
    const now = JSON.stringify([state, said, busy]);
    if (!all && (now === drawnFrom || (panel.contains(document.activeElement) && document.activeElement.tagName === 'SELECT'))) return;
    drawnFrom = now;
    const parts = [node('h2', 'Programme sound'),
      node('p', 'Every streaming camera’s microphone is in the programme. Mixed together, a camera whose picture (and so its sound) is a little off the others is heard as an echo. Choose the camera whose microphone leads: it is always heard, and the others either join it, each only while it is lined up with it, or stay out.')];
    const row = node('p', ''); row.className = 'recipe-load-row';
    const pick = document.createElement('select'); pick.setAttribute('aria-label', 'Programme sound from'); pick.disabled = busy;
    for (const [value, text] of [['', 'every camera, as they are'], ...state.cameras.map(c => [c.id, c.name])]) {
      const o = node('option', text); o.value = value; o.selected = (state.camera || '') === value; pick.append(o);
    }
    const others = document.createElement('select'); others.setAttribute('aria-label', 'The other cameras'); others.disabled = busy || !state.camera;
    // Stay out first: phone microphones in different places, mixed, sound hollow and phasey however closely they are lined
    // up (2026-10-24), so one microphone is the coherent sound; joining is for when the others add something wanted.
    for (const [value, text] of [['muted', 'stay out: one coherent sound (recommended)'], ['auto', 'follow the speaker: only the microphone that hears them best (automixer)'],
      ['aligned', 'join it, each while lined up with it (can sound hollow)']]) {
      const o = node('option', text); o.value = value; o.selected = state.others === value; others.append(o);
    }
    pick.onchange = () => send({ camera: pick.value || null, others: state.camera ? others.value : 'muted' });
    others.onchange = () => send({ camera: state.camera, others: others.value });
    row.append(node('span', 'Programme sound from '), pick, node('span', '; the other cameras '), others);
    parts.push(row);
    if (state.camera && state.others === 'auto') {
      // The automixer: which microphone is open, and how clearly each hears someone now.
      const a = state.automix;
      const line = node('p', a ? `Open now: ${a.open || '—'}${a.heard && a.heard !== a.open ? ` (changing to ${a.heard} as the programme gets there)` : ''}. ` : 'The automixer is starting (it needs the camera relay on).');
      if (a) line.append(node('small', Object.entries(a.clarity_db).map(([name, db]) => `${name} ${db == null ? '—' : `${db > 0 ? '+' : ''}${db} dB`}`).join(' · ')));
      parts.push(line, node('small', `Only one microphone is open at a time: the one hearing whoever is talking most clearly, over its own background. ${state.cameras.find(c => c.id === state.camera)?.name || 'The chosen camera'}'s is open while nobody is heard. It changes with a 0.3 s crossfade, as the programme reaches the moment.`));
    }
    if (state.camera && state.others !== 'auto') {
      const list = node('ul', '');
      for (const c of state.cameras) {
        const trim = c.trim_ms ? ` · sound moved ${c.trim_ms > 0 ? 'later' : 'earlier'} by ${Math.abs(c.trim_ms)} ms to line up` : '';
        const line = node('li', `${c.name}: ${c.id === state.camera ? 'leads' : c.in_programme ? 'in the programme' : `out (${c.why})`}${trim}`);
        if (!c.in_programme && c.why !== 'not streaming' && state.others === 'aligned') line.className = 'recording-warning';
        list.append(line);
      }
      parts.push(list);
      const m = state.measured;
      if (m && state.others === 'aligned') parts.push(node('small', m.error ? `Lining up: ${m.error}.` : `Lined up ${Math.max(0, Math.round(Date.now() / 1000 - m.at))} s ago against the chosen camera, from the cameras’ own streams; ${Object.keys(m.moved || {}).length ? 'moved: ' + Object.entries(m.moved).map(([k, v]) => `${k} ${v} ms`).join(', ') : 'nothing needed moving'}.`));
    }
    // Lip sync: every camera's sound moved against its picture, for a voice that comes after the mouth.
    const lips = node('p', ''); lips.className = 'recipe-load-row';
    const ms = document.createElement('input'); ms.type = 'number'; ms.min = -400; ms.max = 400; ms.step = 10; ms.value = state.lip_sync_ms || 0; ms.setAttribute('aria-label', 'Lip sync, milliseconds');
    const setLips = document.createElement('button'); setLips.textContent = 'Set'; setLips.disabled = busy; setLips.onclick = () => send({ lip_sync_ms: Number(ms.value) || 0 });
    lips.append(node('span', 'Lip sync: every camera’s sound '), ms, node('span', ' ms '), setLips,
      node('small', ' Negative moves the sound earlier: try −100 if voices come after the mouths, and adjust by ear on the programme. A camera measured by Calibrate sync uses its own instead.'));
    parts.push(lips);
    // Calibrate sync (avsync.py): a phone or tablet flashes and beeps in front of the cameras; each one's sound is
    // measured against its own picture and set as its own lip sync.
    const calibrate = node('div', ''); calibrate.className = 'recipe-load-row';
    const page = `${location.origin}${state.flash_page || '/sync-flash'}`;
    const open = node('a', page); open.href = page; open.target = '_blank'; open.rel = 'noopener';
    const measure = document.createElement('button'); measure.textContent = 'Measure'; measure.disabled = busy;
    measure.onclick = () => send({}, '/api/sync/calibrate', 'Recording 12 s of the programme to measure: keep the sync page flashing…', 'Measured.');
    const clear = document.createElement('button'); clear.textContent = 'Forget measurements'; clear.disabled = busy || !state.cameras.some(c => c.calibrated_ms != null);
    clear.onclick = () => send({ clear: true }, '/api/sync/calibrate', 'Forgetting…', 'Every camera is back on the one lip sync.');
    const how = node('p', 'Calibrate sync: open '); how.append(open, node('span', ' on a phone or tablet, turn its sound up, press Start flashing, and hold it where the cameras see it (all of them at once if you can). While it flashes, press '), measure, node('span', ' and keep it there until it says Measured (about 15 s: OBS records the programme with the camera your sound comes from on air, then puts the shot back). '), clear);
    calibrate.append(how);
    const cal = state.calibration;
    const results = node('ul', '');
    for (const c of state.cameras) {
      const r = cal && cal.cameras ? cal.cameras[c.name] : null;
      const text = r ? (r.set_ms != null ? `sound ${Math.abs(r.offset_ms)} ms ${r.offset_ms >= 0 ? 'after' : 'before'} the picture in its own stream; lip sync set to ${r.set_ms} ms (${r.pairs} flashes, ±${r.spread_ms} ms)` : `not measured: ${r.why}`)
        : c.calibrated_ms != null ? `lip sync ${c.calibrated_ms} ms, as measured` : `lip sync ${c.lip_sync_ms} ms (every camera’s)`;
      const line = node('li', `${c.name}: ${text}`); if (r && r.set_ms == null) line.className = 'recording-warning';
      results.append(line);
    }
    if (cal && cal.programme) results.prepend(node('li', cal.programme.offset_ms != null
      ? `Programme (OBS's own recording, ${cal.programme.camera} on air): sound ${Math.abs(cal.programme.offset_ms)} ms ${cal.programme.offset_ms >= 0 ? 'after' : 'before'} the picture before this measurement${cal.programme.why ? `. ${cal.programme.why}.` : ''}`
      : `Programme not measured: ${cal.programme.why}`));
    calibrate.append(results);
    parts.push(calibrate);
    const message = node('p', said); message.setAttribute('aria-live', 'polite'); if (/not |need|fail|error|no such/i.test(said)) message.className = 'recording-warning';
    parts.push(message);
    panel.replaceChildren(...parts);
  }

  async function refresh() {
    const showing = typeof part !== 'undefined' && part === '/sound' && csrf && role === 'admin';
    panel.hidden = !showing;
    if (!showing || busy) return;
    try { state = await api('/api/programme-sound'); paint(false); } catch (error) { said = error.message; }
  }
  setInterval(refresh, 5000); refresh();
})();
