'use strict';
// The room map, reached from Stage Shots' Arrange: the room from above, the stage at the top and the house below, with
// each camera where it stands and a wedge for what it sees. Drag a camera to move it; drag the round handle in front
// of it to turn it, or type the angle. Laid out once at setup: Stage Shots' camera marks follow from it (see
// roommap.py), except where one was set by hand in Arrange. Uses stage.js's state and helpers: it is loaded after it,
// on the manager's dashboard only.
//
// Room view puts the two together: the shot buttons stand on the map's stage where the performers are, the wide shots
// in a row at the front of the stage and the audience out in the house, with each camera drawn where it stands.
// Pressing a button puts it on air as ever; in Arrange both the buttons and the cameras can be dragged. stage.js's
// own rows are moved onto the map for it and back again after, so everything it does with them goes on working. Not
// offered on a screen too narrow for buttons a finger can press on a map that small.
(() => {
  const NS = 'http://www.w3.org/2000/svg', W = 1000;
  const COLOURS = ['#4cc9f0', '#f4a261', '#90be6d', '#f78fb3', '#b5a1ff', '#ffd166', '#2ec4b6', '#ff7b72'];
  const panel = document.querySelector('#room'), button = document.querySelector('#roommap'), together = document.querySelector('#roomview');
  const NARROWEST = 720;              // pixels across, below which Room view is not offered
  let open = false, chosen = null, built = null, held = null, combined = false;
  try { combined = localStorage.getItem('stage-room-view') === 'on'; } catch (error) { /* private window: not remembered */ }
  // stage.js's rows, moved onto the map in Room view, and where they go back to.
  const rows = ['#performers', '#wides', '#crowds'].map(selector => document.querySelector(selector)), home = document.querySelector('#front');
  const local = {}, drawn = new Map();
  function svg(tag, attributes = {}, parent) { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attributes)) e.setAttribute(k, v); if (parent) parent.append(e); return e; }
  const room = () => state.room;
  const H = () => room().depth * W;
  const spot = id => local[id] || room().map[id];
  const colour = camera => COLOURS[(camera.slot - 1 + COLOURS.length) % COLOURS.length];
  const fovOf = id => spot(id)?.fov ?? room().map[id]?.fov ?? room().views[id]?.fov ?? 70;
  const turn = degrees => ((Math.round(degrees) % 360) + 360) % 360;

  // Where a camera stands, in words: on the stage by the performers' sides, in the house by the audience's.
  function whereWords(entry) {
    const s = room().stage, onStage = entry.y < s.front, side = entry.x < 0.4 ? 0 : entry.x > 0.6 ? 2 : 1;
    return onStage ? `on the stage, ${['stage right', 'centre', 'stage left'][side]}` : `in the house, ${['house left', 'in the middle', 'house right'][side]}`;
  }

  // The room itself: drawn once, its words kept a readable size whatever the width of the screen.
  function build() {
    const box = panel.querySelector('.map'), s = room().stage, h = H();
    // Room view's buttons go back to stage.js before the map they stand on is made again.
    if (rows[0].closest('#room')) home.before(rows[0], rows[1]), home.after(rows[2]);
    box.replaceChildren();
    const canvas = node('div', undefined, 'canvas'), over = node('div', undefined, 'over'); box.append(canvas);
    for (const [name, value] of [['--left', s.left], ['--right', s.right], ['--front', s.front]]) over.style.setProperty(name, value);
    const root = svg('svg', { viewBox: `0 0 ${W} ${h}`, role: 'group', 'aria-label': 'The room from above: the stage at the top, the house below. Each camera is a dot, with a wedge for what it sees.' }, canvas);
    canvas.append(over);
    const clip = svg('clipPath', { id: 'room-clip' }, svg('defs', {}, root)); svg('rect', { x: 0, y: 0, width: W, height: h }, clip);
    svg('rect', { x: 0, y: 0, width: W, height: h, class: 'house' }, root);
    const sx = s.left * W, sw = (s.right - s.left) * W, sd = s.front * h;
    svg('rect', { x: sx, y: 0, width: sw, height: sd, class: 'platform' }, root);
    svg('line', { x1: sx, y1: sd, x2: sx + sw, y2: sd, class: 'lip' }, root);
    const words = svg('g', { class: 'words', 'aria-hidden': 'true' }, root);
    const say = (text, x, y, anchor, className) => { const t = svg('text', { x, y, 'text-anchor': anchor, class: className || '' }, words); t.textContent = text; return t; };
    built = {
      root, over, cones: svg('g', { 'clip-path': 'url(#room-clip)' }, root), marks: svg('g', {}, root), words,
      text: [say('Back of stage', W / 2, 0, 'middle', 'quiet'), say('Stage', W / 2, sd / 2, 'middle', 'big'),
        say('SR', sx, sd / 2, 'start', 'side'), say('SL', sx + sw, sd / 2, 'end', 'side'), say('Front of stage', W / 2, sd, 'middle', 'quiet'),
        say('House left', 0, h, 'start'), say('House right', W, h, 'end'), say('House', W / 2, (sd + h) / 2, 'middle', 'big')],
      key: JSON.stringify([room().depth, s]),
    };
  }

  // Viewbox units for one pixel on screen: icons and words are sized in pixels, so that a phone's are big enough to touch.
  const pixel = () => W / Math.max(1, built.root.clientWidth || panel.querySelector('.map').clientWidth || W);
  function placeWords() {
    const p = pixel(), s = room().stage, h = H(), sx = s.left * W, sw = (s.right - s.left) * W, sd = s.front * h, size = 13 * p, pad = 8 * p;
    built.words.style.fontSize = `${size}px`;
    const [back, big, sr, sl, front, hl, hr, house] = built.text;
    back.setAttribute('y', size + pad); big.setAttribute('y', sd / 2); front.setAttribute('y', sd - pad);
    // SR and SL low in the wings, clear of the cameras that usually stand at their middle.
    sr.setAttribute('x', sx + pad); sl.setAttribute('x', sx + sw - pad); sr.setAttribute('y', sd * 0.8); sl.setAttribute('y', sd * 0.8);
    hl.setAttribute('x', pad); hl.setAttribute('y', h - pad); hr.setAttribute('x', W - pad); hr.setAttribute('y', h - pad); house.setAttribute('y', (sd + h) / 2);
  }

  // A camera on the map: its wedge, a dot with an arrowhead the way it points, a handle to turn it, and its name.
  function camera(id) {
    if (drawn.has(id)) return drawn.get(id);
    const cone = svg('path', { class: 'cone' }, built.cones);
    const g = svg('g', { class: 'mark', tabindex: '0', role: 'button' }, built.marks);
    const turnable = svg('g', {}, g), stem = svg('line', { class: 'stem' }, turnable), handle = svg('circle', { class: 'handle' }, turnable);
    const body = svg('circle', { class: 'body' }, g), head = svg('path', { class: 'head' }, g), label = svg('text', { class: 'label', 'text-anchor': 'middle' }, g);
    const parts = { cone, g, turnable, stem, handle, body, head, label };
    wire(id, parts); drawn.set(id, parts); return parts;
  }

  function wedge(id) {
    const entry = spot(id), fov = fovOf(id), r = 2 * W, a = (entry.aim - fov / 2) * Math.PI / 180, b = (entry.aim + fov / 2) * Math.PI / 180;
    const x = entry.x * W, y = entry.y * H();
    return `M${x} ${y} L${x + r * Math.sin(a)} ${y - r * Math.cos(a)} A${r} ${r} 0 0 1 ${x + r * Math.sin(b)} ${y - r * Math.cos(b)} Z`;
  }

  function show(id) {
    const c = state.cameras.find(o => o.id === id), entry = spot(id), parts = camera(id), p = pixel();
    const radius = 15 * p, reach = 52 * p, mine = chosen === id;
    parts.cone.setAttribute('d', wedge(id)); parts.cone.style.fill = parts.cone.style.stroke = colour(c); parts.cone.style.strokeWidth = 1.5 * p; parts.cone.classList.toggle('chosen', mine);
    parts.g.setAttribute('transform', `translate(${entry.x * W} ${entry.y * H()})`); parts.g.classList.toggle('chosen', mine); parts.g.style.color = colour(c);
    parts.turnable.setAttribute('transform', `rotate(${entry.aim})`);
    parts.stem.setAttribute('y1', -radius); parts.stem.setAttribute('y2', -reach); parts.stem.style.strokeWidth = 2 * p;
    parts.handle.setAttribute('cy', -reach); parts.handle.setAttribute('r', 9 * p); parts.handle.style.strokeWidth = 2 * p;
    parts.body.setAttribute('r', radius); parts.body.style.strokeWidth = (mine ? 4 : 2.5) * p;
    const t = entry.aim * Math.PI / 180, tip = (x, y) => `${x * Math.cos(t) - y * Math.sin(t)} ${x * Math.sin(t) + y * Math.cos(t)}`;
    parts.head.setAttribute('d', `M${tip(0, -radius * 0.75)} L${tip(radius * 0.5, radius * 0.25)} L${tip(-radius * 0.5, radius * 0.25)} Z`);
    // The name below the dot, unless its handle is there (pointing down the page): then above. At the back wall,
    // where there is no room below, beside it; at a side wall, running inwards. On a map too small for every name, only
    // the chosen camera's is shown: the list beside the map names them all.
    const near = entry.y > 0.88, below = Math.cos(t) > -0.5, side = entry.x > 0.7 ? -1 : 1;
    parts.label.textContent = shows(c); parts.label.style.fontSize = `${13 * p}px`; parts.label.style.strokeWidth = 4 * p;
    parts.label.style.display = mine || built.root.clientWidth >= 560 ? '' : 'none';
    if (near && below) { parts.label.setAttribute('x', side * (radius + 8 * p)); parts.label.setAttribute('y', 5 * p); parts.label.setAttribute('text-anchor', side > 0 ? 'start' : 'end'); }
    else {
      parts.label.setAttribute('y', below ? radius + 17 * p : -radius - 8 * p);
      parts.label.setAttribute('text-anchor', entry.x > 0.85 ? 'end' : entry.x < 0.15 ? 'start' : 'middle'); parts.label.setAttribute('x', entry.x > 0.85 ? radius : entry.x < 0.15 ? -radius : 0);
    }
    parts.g.setAttribute('aria-label', `${shows(c)} (${c.name}), ${whereWords(entry)}, pointing ${aimWord(entry.aim)}, seeing ${Math.round(fovOf(id))} degrees across`);
  }

  // Dragging a camera moves it; dragging its handle turns it. Saved when let go. Arrow keys move a camera a little, and
  // with Shift turn it instead.
  function wire(id, parts) {
    const point = event => { const m = built.root.getScreenCTM().inverse(), p = new DOMPoint(event.clientX, event.clientY).matrixTransform(m); return { x: p.x / W, y: p.y / H() }; };
    // In Room view the cameras are there to be seen while shots are chosen: moved only in Arrange.
    const still = () => panel.classList.contains('together') && !arranging;
    parts.g.addEventListener('pointerdown', event => {
      if (still()) return;
      const how = event.target === parts.handle || event.target === parts.stem ? 'turn' : 'move', at = point(event), entry = spot(id);
      held = { id, how, from: at, start: { ...entry }, moved: false }; window.roomBusy = true;
      parts.g.setPointerCapture(event.pointerId); event.preventDefault();
    });
    parts.g.addEventListener('pointermove', event => {
      if (!held || held.id !== id) return;
      const at = point(event), entry = { ...held.start, ...local[id] };
      if (!held.moved && Math.hypot((at.x - held.from.x) * W, (at.y - held.from.y) * H()) < 3 * pixel()) return;
      held.moved = true;
      if (held.how === 'move') { entry.x = Math.min(1, Math.max(0, held.start.x + at.x - held.from.x)); entry.y = Math.min(1, Math.max(0, held.start.y + at.y - held.from.y)); }
      else {
        // Clockwise from up the page; within 4 degrees of a multiple of 15 it settles on it, as straight lines are easier to keep.
        const raw = Math.atan2((at.x - entry.x) * W, -(at.y - entry.y) * H()) * 180 / Math.PI, snapped = Math.round(raw / 15) * 15;
        entry.aim = turn(Math.abs(raw - snapped) < 4 ? snapped : raw);
      }
      local[id] = entry; show(id); details();
    });
    const drop = async () => {
      if (!held || held.id !== id) return;
      const was = held; held = null; window.roomBusy = false;
      if (!was.moved) { chosen = chosen === id ? null : id; draw(); return; }
      chosen = id;
      const entry = local[id];
      await save(id, was.how === 'move' ? { x: round(entry.x), y: round(entry.y) } : { aim: entry.aim });
    };
    parts.g.addEventListener('pointerup', drop); parts.g.addEventListener('pointercancel', drop);
    parts.g.addEventListener('keydown', event => {
      if (still()) return;
      const entry = spot(id), step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chosen = id; draw(); return; }
      if (!step) return;
      event.preventDefault(); chosen = id;
      if (event.shiftKey) save(id, { aim: turn(entry.aim + (step[0] || step[1]) * 5) });
      else save(id, { x: round(Math.min(1, Math.max(0, entry.x + step[0] / 100))), y: round(Math.min(1, Math.max(0, entry.y + step[1] / 100))) });
    });
  }
  const round = value => Math.round(value * 1000) / 1000;

  async function save(id, entry) {
    const answer = await act('/api/stage', { room: { [id]: entry } });
    delete local[id];
    if (answer) state = answer;
    draw();
  }

  // The camera chosen: where it stands, its aim exactly, what it sees and why, and what Stage Shots takes from it.
  function details() {
    const box = panel.querySelector('.details'), c = chosen && state.cameras.find(o => o.id === chosen), entry = c && spot(c.id);
    if (!c || !entry) { box.replaceChildren(node('p', 'Press a camera on the map to set it exactly. Stage Shots’ camera marks follow from this map, unless a mark was set by hand in Arrange.')); box.dataset.key = ''; return; }
    const view = room().views[c.id] || { fov: 70, lens: 'usual lens', source: 'typical' }, own = room().map[c.id]?.fov, derived = room().derived[c.id], hand = state.layout[c.id]?.cam;
    const key = JSON.stringify([c.id, entry, view, own, derived, hand, !!state.remote, shows(c)]);
    if (box.dataset.key === key) return;
    const focused = box.contains(document.activeElement) ? document.activeElement.dataset.k : null;
    box.dataset.key = key; box.replaceChildren();
    const title = node('h2', `${shows(c)} (${c.name})`); title.style.setProperty('--swatch', colour(c)); box.append(title);
    box.append(node('p', `Stands ${whereWords(entry)}, pointing ${aimWord(entry.aim)}.`));
    // The aim, exactly: a dial for the hand and a number for the keyboard.
    const aimField = node('div', undefined, 'field');
    const dial = node('label', 'Aim '), slider = document.createElement('input'), number = document.createElement('input');
    slider.type = 'range'; slider.min = '0'; slider.max = '359'; slider.step = '1'; slider.value = String(entry.aim); slider.dataset.k = 'aim-range';
    number.type = 'number'; number.min = '0'; number.max = '359'; number.step = '1'; number.value = String(entry.aim); number.dataset.k = 'aim-number'; number.setAttribute('aria-label', 'Aim in degrees, clockwise from up the page');
    slider.oninput = () => { local[c.id] = { ...entry, aim: Number(slider.value) }; number.value = slider.value; show(c.id); };
    slider.onchange = () => save(c.id, { aim: Number(slider.value) });
    number.onchange = () => { const v = Number(number.value); if (Number.isFinite(v)) save(c.id, { aim: turn(v) }); };
    dial.append(slider, number, node('span', '°')); aimField.append(dial);
    const nudges = node('div', undefined, 'compass');
    for (const [text, by] of [['↺ 15°', -15], ['↺ 1°', -1], ['1° ↻', 1], ['15° ↻', 15]]) {
      const b = node('button', text); b.dataset.k = `nudge${by}`; b.setAttribute('aria-label', `Turn ${Math.abs(by)} degrees ${by < 0 ? 'anticlockwise' : 'clockwise'}`);
      b.onclick = () => save(c.id, { aim: turn(entry.aim + by) }); nudges.append(b);
    }
    aimField.append(nudges, node('small', 'Degrees clockwise from up the page: 0 points at the back of the stage, 180 out at the house.')); box.append(aimField);
    // What it sees: from its lens, unless the administrator has set it.
    const seeing = node('div', undefined, 'field');
    seeing.append(node('p', own !== undefined ? `Sees ${own}° across: set by the administrator. Its lens gives ${view.fov}° (${view.lens}, ${view.source}).`
      : `Sees ${view.fov}° across: ${view.lens}, ${view.source}.`));
    if (state.remote) {
      const set = node('label', 'Field of view '), field = document.createElement('input');
      field.type = 'number'; field.min = String(room().narrowest); field.max = String(room().widest); field.step = '1'; field.value = String(own ?? view.fov); field.dataset.k = 'fov';
      field.onchange = () => { const v = Number(field.value); if (v >= room().narrowest && v <= room().widest) save(c.id, { fov: v }); else result.textContent = `A field of view is from ${room().narrowest} to ${room().widest} degrees.`; };
      set.append(field, node('span', '°'));
      const back = node('button', `Use the lens’s ${view.fov}°`); back.dataset.k = 'fov-reset'; back.disabled = own === undefined; back.onclick = () => save(c.id, { fov: null });
      seeing.append(set, back);
    }
    box.append(seeing);
    // What Stage Shots takes from it.
    if (derived) {
      const follows = node('div', undefined, 'field');
      const marked = `In Stage Shots its button’s mark shows the camera ${standsWord(derived.cam.at)}, pointing ${aimWord(derived.cam.aim)}.`;
      follows.append(node('p', hand ? `${marked} A mark set by hand in Arrange is shown instead, until it is put back.` : marked));
      if (derived.w) follows.append(node('small', `It takes in about ${Math.round(derived.w * 100)}% of the ${c.kind === 'crowd' ? words().audience || 'audience' : 'stage'}’s width there: Arrange offers that as its button’s width.`));
      box.append(follows);
    }
    const off = node('button', 'Take it off the map'); off.dataset.k = 'off';
    off.onclick = async () => { chosen = null; await save(c.id, { x: null, y: null }); };
    const close = node('button', 'Close'); close.dataset.k = 'close'; close.onclick = () => { chosen = null; draw(); };
    box.append(off, close);
    if (focused) box.querySelector(`[data-k="${CSS.escape(focused)}"]`)?.focus();
  }

  // Every camera by name: those on the map, pressed to choose one (a camera hidden under another, or on a phone, is
  // still easy to reach); those not on it yet, each put on it with a press, in the middle of the house pointing at the stage.
  function waiting() {
    const box = panel.querySelector('.waiting'), on = state.cameras.filter(c => room().map[c.id]), off = state.cameras.filter(c => !room().map[c.id]);
    const key = JSON.stringify([state.cameras.map(c => [c.id, shows(c), c.name, !!room().map[c.id]]), chosen]);
    if (box.dataset.key === key) return;
    box.dataset.key = key; box.replaceChildren();
    if (on.length) {
      box.append(node('h3', 'On the map'));
      const list = node('div', undefined, 'placed');
      on.forEach(c => {
        const b = node('button', `${shows(c)} (${c.name})`); b.style.setProperty('--swatch', colour(c)); b.setAttribute('aria-pressed', String(chosen === c.id));
        b.onclick = () => { chosen = chosen === c.id ? null : c.id; draw(); }; list.append(b);
      });
      box.append(list);
    }
    if (!off.length) return;
    box.append(node('h3', 'Not on the map yet'));
    off.forEach((c, i) => {
      const b = node('button', `＋ ${shows(c)} (${c.name})`);
      b.onclick = () => { chosen = c.id; save(c.id, { x: round((i + 1) / (off.length + 1)), y: round(room().stage.front + (1 - room().stage.front) * 0.45), aim: 0 }); };
      box.append(b);
    });
  }

  // Room view: stage.js's rows onto the map, or back where they were.
  function seat(onMap) {
    const there = rows[0].closest('#room');
    if (onMap && !there) built.over.append(...rows);
    else if (!onMap && there) { home.before(rows[0], rows[1]); home.after(rows[2]); }
  }

  function draw() {
    if (!window.concert || !room()) { button.hidden = true; together.hidden = true; return; }
    const roomy = window.innerWidth >= NARROWEST, mixed = combined && roomy && !open;
    together.hidden = !roomy || open; together.setAttribute('aria-pressed', String(mixed)); together.textContent = mixed ? 'Room view: on' : 'Room view';
    button.hidden = !(arranging || open); button.setAttribute('aria-pressed', String(open)); button.textContent = open ? 'Back to the buttons' : 'Room map';
    stage.hidden = open || mixed; panel.hidden = !(open || mixed);
    panel.classList.toggle('together', mixed); panel.classList.toggle('arranging', arranging);
    if (open) { document.querySelector('#tools').hidden = true; document.querySelector('#defaults').hidden = true; }
    if (!open && !mixed) { if (built) seat(false); return; }
    if (mixed) hint.textContent = arranging ? 'Drag a button to where its performer stands, or a camera to where it stands and its round handle to where it points. Press a button or a camera to set it exactly. Saved as you let go.'
      : 'Press a camera’s button to put it on air. The room is seen from above: each dot is where a camera stands, its wedge what it sees.';
    else hint.textContent = 'Drag each camera to where it stands and its round handle to where it points; the wedge is what it sees. Press one to set it exactly. Saved as you let go.';
    if (!built || built.key !== JSON.stringify([room().depth, room().stage])) { build(); drawn.clear(); }
    seat(mixed);
    // Each button striped in its camera's colour, to find its dot and wedge on the map by.
    state.cameras.forEach(c => tiles.get(c.id)?.style.setProperty('--swatch', mixed && room().map[c.id] ? colour(c) : 'transparent'));
    placeWords();
    if (chosen && !room().map[chosen]) chosen = null;
    panel.querySelector('.map').classList.toggle('choosing', !!chosen);
    for (const [id, parts] of drawn) if (!room().map[id] || !state.cameras.some(c => c.id === id)) { parts.cone.remove(); parts.g.remove(); drawn.delete(id); }
    // The chosen camera drawn last, over the others.
    const ids = state.cameras.map(c => c.id).filter(id => room().map[id]).sort((a, b) => (a === chosen) - (b === chosen));
    ids.forEach(id => { show(id); built.marks.append(drawn.get(id).g); });
    // In Room view the list and the chosen camera's details are for arranging only: choosing shots needs the map alone.
    if (mixed && !arranging) { chosen = null; return; }
    details(); waiting();
  }

  button.onclick = () => { open = !open; chosen = null; window.stageDraw(); };
  together.onclick = () => {
    combined = !combined; chosen = null;
    try { localStorage.setItem('stage-room-view', combined ? 'on' : 'off'); } catch (error) { /* not remembered */ }
    window.stageDraw();
  };
  buttons.arrange.addEventListener('click', () => { if (!arranging && open) { open = false; window.stageDraw(); } });
  window.roomDraw = draw;
})();
