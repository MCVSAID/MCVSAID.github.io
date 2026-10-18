'use strict';
// EXPERIMENTAL, in Stage Shots' Arrange on the manager's dashboard: each camera's button placed and sized from where its
// picture is found in the wide camera's (autoplace.py). The look takes about half a minute; what it found is drawn
// over the wide picture and listed, and nothing changes until the operator applies it, camera by camera, with an undo.
// A camera's aim for the room map is only offered, unticked: it is less sure than the place. Uses stage.js's state,
// helpers and act(); loaded after it, on the manager's dashboard only.
(() => {
  const COLOURS = ['#4cc9f0', '#f4a261', '#90be6d', '#f78fb3', '#b5a1ff', '#ffd166', '#2ec4b6', '#ff7b72'];
  const bar = document.querySelector('#bar'), panel = document.querySelector('#place');
  if (!panel) return;
  const button = node('button', 'Place from the wide shot '), badge = node('span', 'Experimental', 'badge warn');
  button.id = 'place-open'; button.setAttribute('aria-pressed', 'false'); button.hidden = true; button.append(badge); bar.append(button);
  let open = false, report = null, wide = null, busy = false, said = '', drawn = '', undo = null, polling = null;
  const use = {}, aims = {};                       // camera id -> ticked to apply its place / its room-map aim
  const colour = camera => COLOURS[(camera.slot - 1 + COLOURS.length) % COLOURS.length];
  const named = id => { const c = state.cameras.find(o => o.id === id); return c ? `${shows(c)} (${c.name})` : id; };

  async function ask() {
    try { report = await api('/api/stage/place'); } catch (error) { said = error.message; }
    if (report?.running && !polling) polling = setInterval(ask, 1000);
    if (!report?.running && polling) { clearInterval(polling); polling = null; }
    paint();
  }
  async function look() {
    busy = true; said = ''; undo = null; paint();
    try { report = await api('/api/stage/place', { wide }); } catch (error) { said = error.message; }
    busy = false; Object.keys(use).forEach(k => delete use[k]); Object.keys(aims).forEach(k => delete aims[k]);
    ask();
  }

  // Everything ticked, in one save: the buttons' places and widths, and any room-map aims ticked.
  async function apply() {
    const layout = {}, room = {}, before = { layout: {}, room: {} };
    for (const [id, found] of Object.entries(report.cameras || {})) {
      if (!found.layout || use[id] === false) continue;
      layout[id] = found.layout;
      const old = state.layout[id] || {};
      before.layout[id] = old.x === undefined ? { x: null, y: null, w: old.w ?? null } : { x: old.x, y: old.y, w: old.w ?? null };
      if (found.aim !== undefined && aims[id] && state.room?.map?.[id]) { room[id] = { aim: found.aim }; before.room[id] = { aim: state.room.map[id].aim }; }
    }
    if (!Object.keys(layout).length) { said = 'Nothing ticked to apply.'; paint(); return; }
    const answer = await act('/api/stage', Object.keys(room).length ? { layout, room } : { layout });
    if (answer) {
      state = answer; undo = before;
      said = `Applied to ${Object.keys(layout).length} camera${Object.keys(layout).length === 1 ? '' : 's'}${Object.keys(room).length ? `, and ${Object.keys(room).length} aim${Object.keys(room).length === 1 ? '' : 's'} on the room map` : ''}.`;
    }
    drawn = ''; window.stageDraw();
  }
  async function takeBack() {
    const body = Object.keys(undo.room).length ? { layout: undo.layout, room: undo.room } : { layout: undo.layout };
    const answer = await act('/api/stage', body);
    if (answer) { state = answer; undo = null; said = 'Put back as it was.'; }
    drawn = ''; window.stageDraw();
  }

  // The wide picture with each camera found drawn on it as its outline, in its colour.
  function picture() {
    const figure = node('figure', undefined, 'seen'), img = document.createElement('img');
    img.src = `/api/stage/place/picture?at=${report.finished || report.started}`; img.alt = `The ${named(report.wide)} camera's picture, with what each camera found sees outlined on it`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 1 1'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
    for (const [id, found] of Object.entries(report.cameras || {})) {
      const c = state.cameras.find(o => o.id === id);
      if (!found.found || !c) continue;
      const shape = document.createElementNS(svg.namespaceURI, 'polygon');
      shape.setAttribute('points', found.outline.map(p => p.join(',')).join(' ')); shape.style.stroke = colour(c);
      shape.classList.toggle('off', use[id] === false); svg.append(shape);
    }
    figure.append(img, svg); return figure;
  }

  // How far across the stage, in the performers' words as Stage Shots uses them (stage right is house left).
  const acrossWords = x => x < 0.2 ? 'at stage right' : x < 0.4 ? 'stage right of centre' : x <= 0.6 ? 'in the middle' : x <= 0.8 ? 'stage left of centre' : 'at stage left';

  function row(id, found) {
    const c = state.cameras.find(o => o.id === id), line = node('div', undefined, 'found');
    if (!c) return line;
    line.style.setProperty('--swatch', colour(c));
    const title = node('b', named(id));
    if (!found.found) {
      line.classList.add('missed'); line.append(title, node('span', ` Not placed: ${found.why}.`)); return line;
    }
    if (!found.layout) { line.classList.add('missed'); line.append(title, node('span', ' Found, but where it looks does not reach the stage from where the wide camera stands on the room map.')); return line; }
    const label = node('label'), box = document.createElement('input'); box.type = 'checkbox'; box.checked = use[id] !== false;
    box.onchange = () => { use[id] = box.checked; drawn = ''; paint(); };
    const sure = `found in ${found.agreeing} of ${found.rounds} pictures`;
    label.append(box, title, node('span', ` takes in about ${Math.round(found.layout.w * 100)}% of the stage, ${acrossWords(found.layout.x)} (${sure})`));
    line.append(label);
    if (found.aim !== undefined) {
      const was = state.room.map[id]?.aim, turnLabel = node('label', undefined, 'aim'), turn = document.createElement('input'); turn.type = 'checkbox'; turn.checked = !!aims[id];
      turn.onchange = () => { aims[id] = turn.checked; };
      turnLabel.append(turn, node('span', ` Also turn it on the room map to ${found.aim}° (now ${was}°). Less sure than the place: tick it only if that looks right.`));
      line.append(turnLabel);
    }
    return line;
  }

  function paint() {
    if (!open || !state) return;
    const key = JSON.stringify([report, wide, busy, said, !!undo, use, state.cameras.map(c => [c.id, shows(c)]), state.room?.map]);
    if (key === drawn || panel.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
    drawn = key; panel.replaceChildren();
    const heading = node('h2', 'Place cameras from the wide shot '); heading.append(node('span', 'Experimental', 'badge warn')); panel.append(heading);
    if (report) { const caution = node('p', report.experimental); caution.className = 'recording-warning'; panel.append(caution); }
    if (report && !report.available) { panel.append(node('p', `Not available on this computer: ${report.why}.`)); return; }
    panel.append(node('p', 'It takes every camera’s picture a few times over, finds where each one’s picture is in the wide camera’s, and sizes and places its button from that. Nothing changes until you apply it.'));
    const choose = node('label', 'Wide camera '), select = document.createElement('select');
    if (!wide || !state.cameras.some(c => c.id === wide)) wide = report?.wide || state.cameras.find(c => kindOf(c) === 'wide')?.id || state.cameras[0]?.id;
    state.cameras.forEach(c => { const o = node('option', `${shows(c)} (${c.name})`); o.value = c.id; o.selected = c.id === wide; select.append(o); });
    select.onchange = () => { wide = select.value; drawn = ''; paint(); };
    choose.append(select); panel.append(choose);
    const go = node('button', report?.running ? `Looking… picture ${report.round} of ${report.rounds}` : report?.cameras ? 'Look again' : 'Look now');
    go.disabled = busy || !!report?.running || !wide; go.onclick = look; panel.append(go);
    if (report?.problem) { const trouble = node('p', `The look stopped: ${report.problem}`); trouble.className = 'recording-warning'; panel.append(trouble); }
    const results = Object.entries(report?.cameras || {});
    if (results.length && !report.running) {
      panel.append(picture());
      const list = node('div', undefined, 'list');
      results.sort(([, a], [, b]) => (b.found && !!b.layout) - (a.found && !!a.layout)).forEach(([id, found]) => list.append(row(id, found)));
      panel.append(list);
      if (results.some(([, f]) => f.layout)) { const put = node('button', 'Apply to the ticked cameras'); put.onclick = apply; panel.append(put); }
      if (!state.room?.map?.[report.wide]) panel.append(node('small', 'The wide camera is not on the room map, so its picture is taken to span the stage. Put it on the map for places measured from where it really stands, and to be offered aims.'));
    }
    if (undo) { const back = node('button', 'Undo'); back.onclick = takeBack; panel.append(back); }
    if (said) panel.append(node('p', said));
  }

  window.placeDraw = () => {
    const roomOpen = !document.querySelector('#room')?.hidden;
    button.hidden = !window.concert || !arranging || roomOpen;
    if (button.hidden && open) { open = false; }
    button.setAttribute('aria-pressed', String(open)); panel.hidden = !open;
    paint();
  };
  button.onclick = () => { open = !open; drawn = ''; window.placeDraw(); if (open) { ask(); panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } };
})();
