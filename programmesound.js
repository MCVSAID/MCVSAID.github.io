'use strict';
// Programme sound from (programmesound.py), on the Director page: which camera's microphone the programme carries, and
// whether the other cameras' join it, each only while it is lined up with the chosen one.
(() => {
  const panel = document.querySelector('#programme-sound');
  if (!panel) return;
  let state = null, drawnFrom = '', said = '', busy = false;

  async function send(body) {
    busy = true; said = 'Saving…'; paint(true);
    try { state = await api('/api/programme-sound', { method: 'POST', body: JSON.stringify(body) }); said = 'Saved.'; }
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
    for (const [value, text] of [['aligned', 'join it, each while lined up with it'], ['muted', 'stay out']]) {
      const o = node('option', text); o.value = value; o.selected = state.others === value; others.append(o);
    }
    pick.onchange = () => send({ camera: pick.value || null, others: others.value });
    others.onchange = () => send({ camera: state.camera, others: others.value });
    row.append(node('span', 'Programme sound from '), pick, node('span', '; the other cameras '), others);
    parts.push(row);
    if (state.camera) {
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
    const message = node('p', said); message.setAttribute('aria-live', 'polite'); if (/not |need|fail|error|no such/i.test(said)) message.className = 'recording-warning';
    parts.push(message);
    panel.replaceChildren(...parts);
  }

  async function refresh() {
    const showing = typeof part !== 'undefined' && part === '/director' && csrf && role === 'admin';
    panel.hidden = !showing;
    if (!showing || busy) return;
    try { state = await api('/api/programme-sound'); paint(false); } catch (error) { said = error.message; }
  }
  setInterval(refresh, 5000); refresh();
})();
