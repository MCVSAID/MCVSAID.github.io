'use strict';
// A picture of the stage with one button per camera, named for what that camera shows. Press one to put it on air; in
// Arrange, drag them to where they stand, as monitors are dragged about in a computer's display settings.
//
// It reads like a stage plot, from the stage outward: the performers and instruments at the top, from the back of the
// stage to the front; under them the wide (whole band) shots, across the full width; at the bottom the audience, as it
// sits in front of the stage. Left and right are the performers' (stage left is the right of the page), and each
// button is as wide as its camera's framing: narrow for one performer, the whole width for the band or the crowd. A
// small mark on each button's edge shows where its camera stands and which way it points: from the room map (room.js)
// where the camera is on it, unless a mark is set here by hand.
let csrf = '', state = null, arranging = false, splitting = false, picked = null, dragging = null, selected = null, shown = '', justMoved = false;
const places = {}, sizes = {}, talls = {}, marks = {}, tiles = new Map();
const stage = document.querySelector('#stage'), result = document.querySelector('#result'), hint = document.querySelector('#hint'), now = document.querySelector('#now');
const zones = { single: document.querySelector('#performers'), wide: document.querySelector('#wides'), crowd: document.querySelector('#crowds') };
const buttons = { auto: document.querySelector('#auto'), split: document.querySelector('#split'), arrange: document.querySelector('#arrange') };
const FRONT = 0.625;            // the middle of a button's lower edge, a quarter round its edge for each side from the top left
function node(tag, text, className) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
async function api(path, body) { const r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) }); const d = await r.json(); if (!r.ok) throw Error(d.detail || `HTTP ${r.status}`); return d; }
async function act(path, body) { try { const answer = await api(path, body); result.textContent = ''; return answer; } catch (error) { result.textContent = error.message; return null; } finally { refresh(); } }

async function enter(session) {
  csrf = session.csrf; document.querySelector('#password').value = ''; document.querySelector('#login').hidden = true; document.querySelector('#shots').hidden = false;
  if (window.concert) { window.concert.session = session; window.concert.nav(session.role); }
  await refresh(); setInterval(refresh, 1000);
}
document.querySelector('#login').onsubmit = async e => {
  e.preventDefault();
  try { await enter(await api('/api/login', { password: document.querySelector('#password').value })); }
  catch (error) { result.textContent = error.message; }
};
// A login already made, on this page or another, is picked up without asking again.
fetch('/api/session').then(r => r.ok ? r.json() : null).then(session => { if (session) enter(session); }).catch(() => {});

const capital = text => text.charAt(0).toUpperCase() + text.slice(1);
const words = () => state.words || { crowd: 'crowd', audience: 'audience', any: 'Any performer' };
// What a camera is called here: what it shows, not which phone it is.
function shows(camera) {
  // In the words of the kind of event in use: the crowd, the congregation or the audience; anyone performing or speaking.
  const said = words();
  if (camera.crowd) return capital(said.crowd);
  const given = camera.instruments;
  return !given.length ? said.any : camera.wide ? camera.wide : given.length > 2 ? `${given.slice(0, 2).join(' + ')} + ${given.length - 2} more` : given.join(' + ');
}
const kindOf = camera => camera.kind || (camera.crowd ? 'crowd' : camera.wide ? 'wide' : 'single');
const saved = id => state.layout[id] || {};
const widthOf = camera => sizes[camera.id] ?? saved(camera.id).w ?? state.widths?.[kindOf(camera)] ?? (kindOf(camera) === 'single' ? 0.18 : 1);
const heightOf = camera => talls[camera.id] ?? saved(camera.id).h ?? 1;
const fromRoom = id => state.room?.derived?.[id];
const markOf = camera => marks[camera.id] || saved(camera.id).cam || fromRoom(camera.id)?.cam || { at: FRONT, aim: 0 };
function place(camera) {
  // Performers not yet arranged stand in a row across the front of the stage, in slot order, spaced so that they do
  // not cover each other. A wide or crowd camera's place is its order along its row.
  if (places[camera.id]) return places[camera.id];
  if (saved(camera.id).x !== undefined) return { x: saved(camera.id).x, y: saved(camera.id).y };
  const loose = state.cameras.filter(c => kindOf(c) === kindOf(camera) && !places[c.id] && saved(c.id).x === undefined), index = loose.findIndex(c => c.id === camera.id);
  return { x: (index + 0.5) / loose.length, y: loose.length > 4 && index % 2 ? 0.86 : 0.7 };
}

// Where a mark stands on a button's edge, as shares of its width and height.
function onEdge(at) {
  const t = ((at % 1) + 1) % 1 * 4, side = Math.floor(t), f = t - side;
  return [[f, 0], [1, f], [1 - f, 1], [0, 1 - f]][side];
}
// The point on a button's edge nearest to x, y (shares of its width and height), as a share of the way round.
function nearestAt(x, y, width, height) {
  x = Math.min(1, Math.max(0, x)); y = Math.min(1, Math.max(0, y));
  const away = [y * height, (1 - x) * width, (1 - y) * height, x * width], side = away.indexOf(Math.min(...away));
  return [x, 1 + y, 3 - x, 4 - y][side] / 4 % 1;
}
// The way from a mark to the middle of its button: a camera on the edge usually points at what it stands beside.
function inward(at, width, height) {
  const [x, y] = onEdge(at), degrees = Math.atan2((0.5 - x) * width, -(0.5 - y) * height) * 180 / Math.PI;
  return (Math.round(degrees / 15) * 15 + 360) % 360;
}
// In the performers' words: stage left is to their left as they face the audience, the right of this page.
function standsWord(at) { return ['behind it, upstage', 'on its stage-left side', 'in front of it, downstage', 'on its stage-right side'][Math.floor(((at % 1) + 1) % 1 * 4)]; }
function aimWord(aim) {
  return ['up the stage', 'upstage, towards stage left', 'across to stage left', 'downstage, towards stage left', `out at the ${words().audience || 'audience'}`,
    'downstage, towards stage right', 'across to stage right', 'upstage, towards stage right'][Math.round(aim / 45) % 8];
}
const markWords = camera => { const m = markOf(camera); return `camera ${standsWord(m.at)}, pointing ${aimWord(m.aim)}`; };

async function refresh() {
  if (dragging || window.roomBusy) return;
  try { state = await api('/api/stage'); } catch (error) { result.textContent = error.message; return; }
  draw();
}

function draw() {
  const director = state.director, cameras = state.cameras, usable = new Set(director.usable || []), pair = director.pair || [];
  const named = id => { const camera = cameras.find(c => c.id === id); return camera ? `${shows(camera)} (${camera.name})` : id; };
  const seconds = Date.now() / 1000, held = director.hold_until && director.hold_until > seconds ? Math.ceil(director.hold_until - seconds) : 0;
  const solo = director.sound?.solo, soloName = solo && ((director.instruments || []).find(i => i[0] === solo.instrument)?.[1] || solo.instrument);
  const said = window.concert ? window.concert.programme(director) : { word: 'On air', suffix: '', blank: false };
  // What is coming next, when the director has decided a cut and waits for its moment: the preview, in green.
  const planned = director.planned ? (director.planned.pair || [director.planned.camera_id]) : [];
  now.textContent = `${said.word}: ${pair.length ? pair.map(named).join(' and ') + ' (split screen)' : director.on_air ? named(director.on_air) : director.scene || 'nothing known'}${said.suffix}`
    + (planned.length ? ` · next: ${planned.map(named).join(' and ')}` : '')
    + (director.enabled ? held ? ` · automatic resumes in ${held} s` : ' · choosing automatically' : ' · automatic is off')
    + (soloName ? ` · solo heard: ${soloName}` : '') + (director.problem ? ` · ${director.problem}` : '')
    + (state.people_recognition ? ' · Performer recognition: ON' : '');
  buttons.auto.setAttribute('aria-pressed', String(!!director.enabled)); buttons.auto.textContent = director.enabled ? 'Automatic: on' : 'Automatic: off';
  buttons.split.setAttribute('aria-pressed', String(splitting)); buttons.arrange.setAttribute('aria-pressed', String(arranging));
  buttons.split.disabled = arranging || !Object.keys(director.splits || {}).length;
  buttons.arrange.textContent = arranging ? 'Done arranging' : 'Arrange';
  stage.classList.toggle('arranging', arranging);
  hint.textContent = arranging ? 'Drag a camera to where it stands; drag a corner to resize it; drag the small camera mark round its edge to where the camera really is. Press one to set it exactly. Saved as you let go.'
    : splitting ? (picked ? 'Now press the second camera for the split screen.' : 'Press the two cameras to show side by side; the first goes on the left.')
    : 'Press a camera to put it on air.';
  zones.crowd.querySelector('.label').textContent = capital(words().audience || 'audience'); zones.crowd.setAttribute('aria-label', capital(words().audience || 'audience'));
  offer();
  if (selected && !cameras.some(c => c.id === selected)) selected = null;
  for (const [id, tile] of tiles) if (!cameras.some(c => c.id === id)) { tile.remove(); tiles.delete(id); }
  // Along the wide and crowd rows, by each camera's place from left to right.
  const along = new Map(), rows = { wide: [], crowd: [] };
  cameras.forEach(c => { if (kindOf(c) !== 'single') rows[kindOf(c)].push(c); });
  for (const row of Object.values(rows)) row.map(c => [c, place(c).x]).sort((a, b) => a[1] - b[1] || a[0].slot - b[0].slot).forEach(([c], i) => along.set(c.id, i));
  zones.wide.hidden = !rows.wide.length; zones.crowd.hidden = !rows.crowd.length;
  cameras.forEach(camera => {
    let tile = tiles.get(camera.id);
    if (!tile) {
      tile = node('button', undefined, 'shot'); tile.append(node('b'), node('span'), node('em'), mark());
      // A handle at each corner, as a window or a picture is resized: the opposite corner stays where it is.
      for (const corner of ['nw', 'ne', 'se', 'sw']) { const handle = node('span', undefined, 'corner'); handle.dataset.corner = corner; handle.setAttribute('aria-hidden', 'true'); tile.append(handle); }
      wire(tile, camera.id); tiles.set(camera.id, tile);
    }
    const kind = kindOf(camera);
    if (tile.parentNode !== zones[kind]) zones[kind].append(tile);
    tile.dataset.kind = kind;
    const live = usable.has(camera.id), on = camera.id === director.onAir || camera.id === director.on_air || pair.includes(camera.id), next = !on && planned.includes(camera.id);
    tile.children[0].textContent = shows(camera); tile.children[1].textContent = camera.name;
    tile.children[2].textContent = on ? 'ON AIR' : next ? 'NEXT' : picked === camera.id ? 'PICKED · LEFT' : !camera.online ? 'OFFLINE' : !live ? 'NO PICTURE'
      : solo && (director.camera_focus?.[camera.id] || []).includes(solo.instrument) ? 'SOLO' : '';
    tile.classList.toggle('on-air', on); tile.classList.toggle('next', next); tile.classList.toggle('dead', !live && !on); tile.classList.toggle('picked', picked === camera.id);
    tile.classList.toggle('selected', arranging && selected === camera.id);
    tile.setAttribute('aria-label', `${shows(camera)}, ${camera.name}${on ? ', on air' : next ? ', next' : !live ? ', no picture' : ''}; ${markWords(camera)}`);
    if (kind !== 'single') tile.style.order = String(along.get(camera.id));
    size(tile, camera); aim(tile, camera);
  });
  apart(); tools(); defaults();
  if (window.roomDraw) window.roomDraw();
  if (window.placeDraw) window.placeDraw();
}
window.stageDraw = draw;

// Buttons kept from covering each other, as shown, not as saved: on a phone the smallest button a thumb can press is
// wider than the space between two cameras placed side by side at a computer. Overlapping pairs are eased apart along
// the way they overlap least, a few times over, and the stage keeps the arrangement's shape.
function apart() {
  // While arranging, room between buttons for their corner handles.
  const zone = zones.single, W = zone.clientWidth, H = zone.clientHeight, gap = arranging ? 24 : 6;
  if (!W || !H) return;
  const boxes = [...zone.querySelectorAll('.shot')].filter(t => !t.classList.contains('dragging'))
    .map(t => ({ t, w: t.offsetWidth, h: t.offsetHeight, x: parseFloat(t.style.left) / 100 * W, y: parseFloat(t.style.top) / 100 * H }));
  for (let round = 0; round < 40; round++) {
    let moved = false;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j], ox = (a.w + b.w) / 2 + gap - Math.abs(a.x - b.x), oy = (a.h + b.h) / 2 + gap - Math.abs(a.y - b.y);
      if (ox <= 0 || oy <= 0) continue;
      moved = true;
      if (ox / W < oy / H) { const s = a.x <= b.x ? -1 : 1; a.x += s * ox / 2; b.x -= s * ox / 2; }
      else { const s = a.y <= b.y ? -1 : 1; a.y += s * oy / 2; b.y -= s * oy / 2; }
      for (const box of [a, b]) { box.x = Math.min(W - box.w / 2, Math.max(box.w / 2, box.x)); box.y = Math.min(H - box.h / 2, Math.max(box.h / 2, box.y)); }
    }
    if (!moved) break;
  }
  for (const box of boxes) { box.t.style.left = `${box.x / W * 100}%`; box.t.style.top = `${box.y / H * 100}%`; }
}

// A button's size, and among the performers its place, kept wholly on the stage. Its height is in buttons: never less
// than its words need.
function size(tile, camera) {
  const w = widthOf(camera), h = heightOf(camera);
  tile.style.minHeight = h > 1 ? `calc(var(--tall) * ${h})` : '';
  if (kindOf(camera) !== 'single') { tile.style.width = `max(calc(${w * 100}% - ${(1 - w) * 8}px), var(--least))`; tile.style.left = tile.style.top = ''; return; }
  tile.style.width = `max(${w * 100}%, var(--least))`;
  const zone = zones.single, at = place(camera), half = tile.offsetWidth / 2 / (zone.clientWidth || 1), tall = tile.offsetHeight / 2 / (zone.clientHeight || 1);
  const x = half >= 0.5 ? 0.5 : Math.min(1 - half, Math.max(half, at.x)), y = tall >= 0.5 ? 0.5 : Math.min(1 - tall, Math.max(tall, at.y));
  tile.style.left = `${x * 100}%`; tile.style.top = `${y * 100}%`;
}
// The camera mark: a dot for the camera, an arrowhead the way it points.
function mark() {
  const holder = node('span', undefined, 'cam'), svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '-10 -10 20 20'); svg.setAttribute('aria-hidden', 'true');
  const dot = document.createElementNS(svg.namespaceURI, 'circle'); dot.setAttribute('r', '3.6');
  const head = document.createElementNS(svg.namespaceURI, 'path'); head.setAttribute('d', 'M0 -9.5 L5.5 -2.5 L-5.5 -2.5 Z');
  svg.append(dot, head); holder.append(svg); return holder;
}
function aim(tile, camera) {
  const m = markOf(camera), [x, y] = onEdge(m.at), holder = tile.querySelector('.cam');
  holder.style.left = `${x * 100}%`; holder.style.top = `${y * 100}%`; holder.firstChild.style.transform = `rotate(${m.aim}deg)`;
  holder.title = capital(markWords(camera));
}

async function keep(id, entry) {
  const answer = await act('/api/stage', { layout: { [id]: entry } });
  if (answer) { state = answer; delete places[id]; delete sizes[id]; delete talls[id]; delete marks[id]; }
  return answer;
}

// In Arrange, for the camera pressed: its size, where it stands and which way it points, set exactly.
function tools() {
  const panel = document.querySelector('#tools'), camera = arranging && state.cameras.find(c => c.id === selected);
  panel.hidden = !camera;
  if (!camera) { panel.dataset.key = ''; return; }
  const kind = kindOf(camera), own = saved(camera.id).w, fallback = state.widths?.[kind] ?? 0.18, m = markOf(camera);
  const suggested = fromRoom(camera.id)?.w, derivedMark = fromRoom(camera.id)?.cam;
  const key = JSON.stringify([camera.id, own, saved(camera.id).h, fallback, saved(camera.id).cam, shows(camera), suggested, derivedMark]);
  if (panel.dataset.key === key) return;
  const focused = panel.contains(document.activeElement) ? document.activeElement.dataset.k : null;
  panel.dataset.key = key; panel.replaceChildren();
  panel.append(node('h2', `${shows(camera)} (${camera.name})`));
  const kindWord = { single: 'a single shot', wide: 'a wide shot', crowd: `the ${words().crowd} camera` }[kind];
  // Width: a share of the stage, as the camera's framing is a share of it.
  const width = node('div', undefined, 'field'), label = node('label', 'Width '), slider = document.createElement('input'), value = node('output', `${Math.round(widthOf(camera) * 100)}%`);
  slider.type = 'range'; slider.min = '8'; slider.max = '100'; slider.step = '1'; slider.value = String(Math.round(widthOf(camera) * 100)); slider.dataset.k = 'width';
  slider.oninput = () => { sizes[camera.id] = Number(slider.value) / 100; value.textContent = `${slider.value}%`; size(tiles.get(camera.id), camera); };
  slider.onchange = () => keep(camera.id, { w: Number(slider.value) / 100 });
  label.append(slider, value); width.append(label);
  const high = node('label', 'Height '), lift = document.createElement('input'), times = node('output', `${heightOf(camera)}×`);
  lift.type = 'range'; lift.min = '1'; lift.max = '4'; lift.step = '0.25'; lift.value = String(heightOf(camera)); lift.dataset.k = 'height';
  lift.oninput = () => { talls[camera.id] = Number(lift.value); times.textContent = `${lift.value}×`; size(tiles.get(camera.id), camera); apart(); };
  lift.onchange = () => keep(camera.id, { h: Number(lift.value) });
  high.append(lift, times); width.append(high);
  const plainSize = own === undefined && saved(camera.id).h === undefined;
  const reset = node('button', plainSize ? `Default size for ${kindWord}: ${Math.round(fallback * 100)}% wide` : `Back to the default size for ${kindWord} (${Math.round(fallback * 100)}% wide)`);
  reset.dataset.k = 'size-reset'; reset.disabled = plainSize; reset.onclick = () => keep(camera.id, { w: null, h: null });
  width.append(reset);
  // The width the room map suggests: as much of the stage as the camera's view takes in where its subject stands.
  if (suggested && Math.round(suggested * 100) !== Math.round(widthOf(camera) * 100)) {
    const take = node('button', `Use the room map’s ${Math.round(suggested * 100)}% wide`); take.dataset.k = 'size-room'; take.onclick = () => keep(camera.id, { w: suggested }); width.append(take);
  }
  panel.append(width);
  // The camera mark: round the edge, and which way it points.
  const where = node('div', undefined, 'field');
  where.append(node('p', `Its camera stands ${standsWord(m.at)}, pointing ${aimWord(m.aim)}${saved(camera.id).cam || !derivedMark ? '' : ': from the room map'}.`));
  const round = node('div', undefined, 'compass');
  for (const [text, step, says] of [['◀ Round', -1 / 16, 'Move the camera mark anticlockwise round the edge'], ['Round ▶', 1 / 16, 'Move the camera mark clockwise round the edge']]) {
    const b = node('button', text); b.dataset.k = text; b.setAttribute('aria-label', says);
    b.onclick = () => { const at = ((m.at + step) % 1 + 1) % 1, t = tiles.get(camera.id); keep(camera.id, { cam: { at: Math.round(at * 16) / 16, aim: inward(at, t.offsetWidth, t.offsetHeight) } }); };
    round.append(b);
  }
  where.append(round);
  const compass = node('div', undefined, 'compass');
  ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'].forEach((arrow, i) => {
    const b = node('button', arrow + '\uFE0E'); b.dataset.k = `aim-${i}`; b.setAttribute('aria-label', `Points ${aimWord(i * 45)}`); b.setAttribute('aria-pressed', String(m.aim === i * 45));
    b.onclick = () => keep(camera.id, { cam: { at: m.at, aim: i * 45 } }); compass.append(b);
  });
  where.append(compass);
  const angle = node('label', 'Exact angle '), turn = document.createElement('input'), degrees = node('output', `${m.aim}°`);
  turn.type = 'range'; turn.min = '0'; turn.max = '355'; turn.step = '5'; turn.value = String(m.aim); turn.dataset.k = 'angle';
  turn.oninput = () => { marks[camera.id] = { at: m.at, aim: Number(turn.value) }; degrees.textContent = `${turn.value}°`; aim(tiles.get(camera.id), camera); };
  turn.onchange = () => keep(camera.id, { cam: { at: m.at, aim: Number(turn.value) } });
  angle.append(turn, degrees); where.append(angle);
  const plain = node('button', derivedMark ? 'Follow the room map again' : 'Put the mark back in front'); plain.dataset.k = 'mark-reset'; plain.disabled = !saved(camera.id).cam; plain.onclick = () => keep(camera.id, { cam: null });
  where.append(plain); panel.append(where);
  const done = node('button', 'Close'); done.dataset.k = 'close'; done.onclick = () => { selected = null; draw(); }; panel.append(done);
  if (focused) panel.querySelector(`[data-k="${CSS.escape(focused)}"]`)?.focus();
}

// The administrator's, on the manager's own dashboard: how wide each kind of shot is when a camera has no width of its own.
function defaults() {
  const panel = document.querySelector('#defaults'), mine = arranging && state.remote && state.widths;
  panel.hidden = !mine;
  if (!mine) { panel.dataset.key = ''; return; }
  const key = JSON.stringify([state.widths, words().crowd]);
  if (panel.dataset.key === key || panel.contains(document.activeElement) && document.activeElement.type === 'range') return;
  panel.dataset.key = key; panel.replaceChildren(node('h2', 'Default widths'), node('p', 'For every camera of each kind that has no width of its own. A share of the stage’s width.'));
  for (const [kind, text] of [['single', 'One performer or instrument'], ['wide', 'Whole band or wide shot'], ['crowd', `${capital(words().crowd)} camera`]]) {
    const label = node('label', `${text} `), slider = document.createElement('input'), value = node('output', `${Math.round(state.widths[kind] * 100)}%`);
    slider.type = 'range'; slider.min = '8'; slider.max = '100'; slider.step = '1'; slider.value = String(Math.round(state.widths[kind] * 100));
    slider.oninput = () => { value.textContent = `${slider.value}%`; state.widths[kind] = Number(slider.value) / 100; state.cameras.forEach(c => { if (kindOf(c) === kind) size(tiles.get(c.id), c); }); };
    slider.onchange = async () => { const answer = await act('/api/stage', { widths: { [kind]: Number(slider.value) / 100 } }); if (answer) state = answer; };
    label.append(slider, value); panel.append(label);
  }
}

// Only on the manager's own dashboard: whether this page is also offered to a phone on the camera network.
function offer() {
  const panel = document.querySelector('#remote'), remote = state.remote;
  panel.hidden = !remote; if (!remote || panel.contains(document.activeElement)) return;
  panel.replaceChildren();
  const label = node('label'), box = document.createElement('input'); box.type = 'checkbox'; box.checked = remote.wanted;
  box.onchange = async () => { const answer = await act('/api/stage', { remote: box.checked }); if (answer?.remote?.passcode_once) shown = answer.remote.passcode_once; draw(); };
  label.append(box, node('span', ' Offer this page to phones on the camera network, for choosing shots from the room')); panel.append(label);
  panel.append(node('small', remote.wanted !== remote.running ? `Restart the manager to ${remote.wanted ? 'start' : 'stop'} offering it.`
    : remote.running ? `Open ${remote.address} on a phone joined to the camera Wi-Fi. The phone will warn about the certificate the first time: it is the manager's own. It opens this page only: no settings, recordings or camera controls.`
    : 'Off: this page is only on this computer.'));
  if (remote.wanted) {
    const fresh = node('button', remote.passcode_set ? 'Make a new passcode' : 'Make a passcode');
    fresh.onclick = async () => { if (remote.passcode_set && !await concert.sure('Make a new passcode? The present one stops working and phones using this page are logged out.')) return; const answer = await act('/api/stage', { new_passcode: true }); if (answer?.remote?.passcode_once) shown = answer.remote.passcode_once; draw(); };
    panel.append(fresh);
    // Or one of the operator's own choosing. Shown as it is typed: it is being chosen here, not entered.
    const own = document.createElement('input'); own.type = 'text'; own.autocomplete = 'off'; own.spellcheck = false; own.minLength = 4; own.maxLength = 64; own.placeholder = 'or type your own (4 or more)'; own.setAttribute('aria-label', 'A passcode of your own');
    const use = node('button', 'Set this passcode');
    use.onclick = async () => {
      const chosen = own.value;
      if (chosen.length < 4) { result.textContent = 'A passcode is at least 4 characters.'; return; }
      if (remote.passcode_set && !await concert.sure('Set this passcode? The present one stops working and phones using this page are logged out.')) return;
      const answer = await act('/api/stage', { set_passcode: chosen });
      if (answer) { shown = ''; own.value = ''; result.textContent = 'Passcode set. It is not kept anywhere readable, so note it down.'; own.blur(); draw(); }
    };
    own.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); use.click(); } });
    panel.append(own, use);
    if (!remote.passcode_set && !shown) panel.append(node('small', 'No passcode has been made yet, so nobody can log in from a phone.'));
  }
  if (shown) { const once = node('p', `Passcode: ${shown}. Write it down now: it is not kept anywhere and cannot be shown again. If it is lost, make a new one.`); once.className = 'recording-warning'; panel.append(once); }
}

// In Arrange: the button itself moves, a corner sizes it (the opposite corner staying put), its camera mark goes round its edge.
function wire(tile, id) {
  let start = null, moved = false, how = null;
  const camera = () => state.cameras.find(c => c.id === id);
  tile.addEventListener('pointerdown', event => {
    if (!arranging || !camera()) return;
    const corner = event.target.closest('.corner');
    how = corner ? 'size' : event.target.closest('.cam') ? 'mark' : 'move';
    start = { x: event.clientX, y: event.clientY, box: tile.getBoundingClientRect(), corner: corner?.dataset.corner }; moved = false; dragging = id; tile.classList.add('dragging'); tile.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  tile.addEventListener('pointermove', event => {
    if (dragging !== id) return;
    if (Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y) > 4) moved = true;
    if (!moved) return;
    const c = camera(), kind = kindOf(c), zone = zones[kind].getBoundingClientRect();
    if (how === 'size') {
      // The corner opposite the one held stays where it was; the button spans from it to the pointer.
      const b = start.box, west = start.corner.includes('w'), north = start.corner.includes('n');
      const fixedX = west ? b.right : b.left, fixedY = north ? b.bottom : b.top, base = parseFloat(getComputedStyle(stage).getPropertyValue('--tall')) || 76;
      sizes[id] = Math.round(Math.min(1, Math.max(0.08, Math.abs(event.clientX - fixedX) / zone.width)) * 100) / 100;
      talls[id] = Math.round(Math.min(4, Math.max(1, Math.abs(event.clientY - fixedY) / base)) * 4) / 4;
      size(tile, c);
      if (kind === 'single') {
        // Placed by its middle: half its new size from the fixed corner, towards the pointer.
        const middleX = fixedX + (west ? -1 : 1) * tile.offsetWidth / 2, middleY = fixedY + (north ? -1 : 1) * tile.offsetHeight / 2;
        places[id] = { x: Math.min(1, Math.max(0, (middleX - zone.left) / zone.width)), y: Math.min(1, Math.max(0, (middleY - zone.top) / zone.height)) }; size(tile, c);
      }
    } else if (how === 'mark') {
      const box = tile.getBoundingClientRect(), at = nearestAt((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height, box.width, box.height);
      marks[id] = { at: Math.round(at * 1000) / 1000, aim: inward(at, box.width, box.height) }; aim(tile, c);
    } else if (kind === 'single') {
      places[id] = { x: Math.min(1, Math.max(0, (event.clientX - zone.left) / zone.width)), y: Math.min(1, Math.max(0, (event.clientY - zone.top) / zone.height)) }; size(tile, c);
    } else tile.style.transform = `translateX(${event.clientX - start.x}px)`;
  });
  const drop = async event => {
    if (dragging !== id) return;
    dragging = null; tile.classList.remove('dragging'); tile.style.transform = '';
    if (!moved) return;
    justMoved = true; setTimeout(() => { justMoved = false; }, 0);
    const c = camera();
    if (how === 'size' && sizes[id] !== undefined) {
      const whole = { w: sizes[id], h: talls[id] };
      if (places[id]) Object.assign(whole, { x: Math.round(places[id].x * 1000) / 1000, y: Math.round(places[id].y * 1000) / 1000 });
      await keep(id, whole);
    }
    else if (how === 'mark' && marks[id]) await keep(id, { cam: marks[id] });
    else if (how === 'move' && kindOf(c) === 'single' && places[id]) await keep(id, { x: Math.round(places[id].x * 1000) / 1000, y: Math.round(places[id].y * 1000) / 1000 });
    else if (how === 'move' && event.type === 'pointerup') {
      // Along a row: put it among the others by where it was let go, and keep the order of the whole row.
      const row = state.cameras.filter(o => kindOf(o) === kindOf(c) && o.id !== id).sort((a, b) => tiles.get(a.id).style.order - tiles.get(b.id).style.order);
      const index = row.filter(o => { const b = tiles.get(o.id).getBoundingClientRect(); return b.bottom <= event.clientY || b.top <= event.clientY && b.left + b.width / 2 < event.clientX; }).length;
      row.splice(index, 0, c);
      const layout = Object.fromEntries(row.map((o, i) => [o.id, { x: Math.round((i + 0.5) / row.length * 1000) / 1000, y: saved(o.id).y ?? 0.5 }]));
      const answer = await act('/api/stage', { layout }); if (answer) state = answer;
    }
    draw();
  };
  tile.addEventListener('pointerup', drop); tile.addEventListener('pointercancel', drop);
  tile.addEventListener('click', () => {
    if (arranging) {
      if (!justMoved) { selected = selected === id ? null : id; draw(); if (selected) document.querySelector('#tools').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      return;
    }
    if (!splitting) { act('/api/director', { take: id }); return; }
    if (!picked) { picked = id; draw(); return; }
    if (picked === id) { picked = null; draw(); return; }
    // The split scene holding these two, left one first if there is one that way round.
    const splits = Object.entries(state.director.splits || {}), first = picked; picked = null; splitting = false;
    const scene = (splits.find(([, members]) => members[0] === first && members[1] === id) || splits.find(([, members]) => members.includes(first) && members.includes(id)) || [])[0];
    if (scene) act('/api/director', { take: scene }); else { result.textContent = 'OBS has no split-screen scene for those two cameras.'; draw(); }
  });
}

buttons.auto.onclick = () => act('/api/director', { enabled: !state?.director.enabled });
buttons.split.onclick = () => { splitting = !splitting; picked = null; draw(); };
buttons.arrange.onclick = () => { arranging = !arranging; splitting = false; picked = null; selected = null; draw(); };
window.addEventListener('resize', () => { if (state) draw(); });
