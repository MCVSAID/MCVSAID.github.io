'use strict';
// Explain the director (explain.py), on the Director page: a demonstration mode that lays the director's decisions over
// the programme as captions (why it cut, what it heard, whom a gimbal turned to), so a video made with it shows how it
// was made. The switch, how long each caption stays, how often a feature in use is spotlit, the corner, whether OBS
// has the overlay, and the last captions. Uses app.js's api(), node(), editing(), part and csrf.
(() => {
  const panel = document.querySelector('#explain');
  if (!panel) return;
  let state = null, said = '', busy = false, drawnFrom = '';
  const clock = at => new Date(at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  async function send(body, done) {
    busy = true; said = 'Saving…'; paint(true);
    try { state = await api('/api/explain', { method: 'POST', body: JSON.stringify(body) }); said = done ?? 'Saved.'; }
    catch (error) { said = error.message; }
    finally { busy = false; paint(true); }
  }
  const choose = (label, options, now, act) => {
    const line = node('p', ''); line.className = 'recipe-load-row';
    const pick = document.createElement('select'); pick.setAttribute('aria-label', label); pick.disabled = busy;
    for (const [value, text] of options) { const o = node('option', text); o.value = value; o.selected = String(value) === String(now); pick.append(o); }
    pick.onchange = () => act(pick.value);
    line.append(node('span', `${label}: `), pick); return line;
  };

  function paint(all) {
    if (!state) return;
    const now = JSON.stringify([state, said, busy]);
    if (!all && (editing(panel) || now === drawnFrom)) return;
    drawnFrom = now;
    const parts = [node('h2', 'Explain the director (demo captions)'),
      node('p', 'For demo videos: the director’s decisions laid over the programme as captions, so whoever watches sees what the AI did and why. Each cut and who made it, a solo heard, a gimbal turning to someone, a lens change, a voice call, and now and then a feature in use. OBS’s recording and stream carry them. Performers are never named, only their instrument or role.')];
    const label = node('label', ''), tick = document.createElement('input'); tick.type = 'checkbox'; tick.checked = state.on; tick.disabled = busy;
    tick.onchange = () => send({ on: tick.checked }, tick.checked ? 'On: the captions are in OBS.' : 'Off.');
    label.append(tick, node('span', ' Lay the director’s decisions over the programme'));
    parts.push(label);
    parts.push(choose('Each caption stays', [[4, '4 s'], [7, '7 s, the default'], [10, '10 s'], [15, '15 s']], state.seconds, v => send({ seconds: Number(v) })));
    parts.push(choose('A feature in use spotlit', [[0, 'never'], [30, 'every 30 s'], [45, 'every 45 s, the default'], [90, 'every 90 s'], [180, 'every 3 minutes']], state.spotlight_seconds, v => send({ spotlight_seconds: Number(v) })));
    parts.push(choose('Corner', [['top-left', 'top left'], ['top-right', 'top right'], ['bottom-left', 'bottom left']], state.position, v => send({ position: v })));
    if (state.on) {
      const o = state.overlay || {};
      const where = node('p', o.problem ? `Not in OBS: ${o.problem}` : o.quiet ? `OBS has not shown the captions for ${o.quiet} s: it is being asked to load them again.` : o.scenes ? `In OBS, on top of ${o.scenes} scene${o.scenes === 1 ? '' : 's'}.` : 'Putting the captions into OBS…');
      if (o.problem || o.quiet) where.className = 'recording-warning';
      parts.push(where);
    }
    const recent = node('div', ''); recent.className = 'recipe-heard'; recent.append(node('h4', 'Last captions'));
    if (!state.recent.length) recent.append(node('small', state.on ? 'None yet: the next cut makes one.' : 'Off.'));
    else {
      const list = document.createElement('ul');
      for (const card of [...state.recent].reverse()) { const li = document.createElement('li'); li.append(node('strong', card.title), node('small', ` ${clock(card.at)}`), node('br', ''), node('span', card.text)); list.append(li); }
      recent.append(list);
    }
    parts.push(recent);
    const message = node('p', said); message.setAttribute('aria-live', 'polite'); if (/not |must|is \d|refus|fail/i.test(said)) message.className = 'recording-warning';
    parts.push(message);
    panel.replaceChildren(...parts);
  }

  async function refresh() {
    const showing = typeof part !== 'undefined' && part === '/director' && csrf;
    panel.hidden = !showing;
    if (!showing || busy) return;
    try { state = await api('/api/explain'); paint(false); } catch (error) { said = error.message; }
  }
  setInterval(refresh, 2000); refresh();
})();
