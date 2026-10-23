'use strict';
// The Operate page: the cameras chosen here, live from the camera relay (no look-ahead, about a fifth of a second behind
// real life), steered with Xbox controllers through the browser's Gamepad API (no driver or plugin), or the buttons.
// Each controller drives one camera at a time (LB/RB to change); its readings go to the manager ten times a second while
// a stick or trigger is held (/api/operate/control), and the phone stops its gimbal by itself half a second after the last.
let csrf = '', state = null, speed = 1;
const result = document.querySelector('#result'), feeds = document.querySelector('#feeds'), choices = document.querySelector('#choices');
const tiles = new Map(), drives = new Map(), pads = new Map();          // camera id -> tile; gamepad index -> camera id; index -> last reading
const SPEEDS = [0.35, 0.65, 1];                                         // aiming speed presets: the most the stick asks for
const COLOURS = ['#5fb4ee', '#f4a261', '#90be6d', '#f78fb3'];
const DEAD = 0.15, ZOOM_DEAD = 0.08, EVERY_MS = 100;
// A camera's live feed; the clickable demo (demo-site) gives its drawn stills instead, having no relay.
const feed = (id, again) => window.concertDemo?.feed ? window.concertDemo.feed(id) : `/api/operate/feed/${encodeURIComponent(id)}${again ? `?t=${Date.now()}` : ''}`;
function node(tag, text, className) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
async function api(path, body) {
  const r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || `${r.status}`);
  return data;
}
async function act(path, body) { try { const answer = await api(path, body); result.textContent = ''; return answer; } catch (error) { result.textContent = error.message; return null; } }
const send = (camera, command, parameters = {}) => act(`/api/cameras/${encodeURIComponent(camera)}/commands`, { request_id: crypto.randomUUID(), command, parameters });

async function enter(session) {
  csrf = session.csrf; document.querySelector('#password').value = ''; document.querySelector('#login').hidden = true; document.querySelector('#operate').hidden = false;
  if (window.concert) { window.concert.session = session; window.concert.nav(session.role); }
  await refresh(); setInterval(refresh, 1000);
  // Read about sixty times a second, on a timer rather than animation frames, which a browser stops for a page not in view.
  setInterval(() => poll(performance.now()), 16);
}
document.querySelector('#login').onsubmit = async e => {
  e.preventDefault();
  try { await enter(await api('/api/login', { password: document.querySelector('#password').value })); } catch (error) { result.textContent = error.message; }
};
fetch('/api/session').then(r => r.ok ? r.json() : null).then(session => { if (session) enter(session); }).catch(() => {});

// Which cameras are shown: kept in this browser. At first, the cameras on a gimbal, or the first four.
function chosen() {
  let ids = null;
  try { ids = JSON.parse(localStorage.getItem('operate.cameras') || 'null'); } catch (error) { ids = null; }
  const usable = state.cameras.filter(c => c.in_use !== false);
  if (!Array.isArray(ids)) ids = (usable.some(c => c.gimbal?.address) ? usable.filter(c => c.gimbal?.address) : usable.slice(0, 4)).map(c => c.id);
  return usable.filter(c => ids.includes(c.id));
}
function choose(ids) { try { localStorage.setItem('operate.cameras', JSON.stringify(ids)); } catch (error) { /* kept for this visit only */ } draw(); }

async function refresh() {
  try { state = await api('/api/cameras'); } catch (error) { result.textContent = error.message; return; }
  draw();
}

function draw() {
  if (!state) return;
  const shown = chosen(), director = state.director || {};
  const name = id => state.cameras.find(c => c.id === id)?.name || id;
  document.querySelector('#programme').textContent = director.pair ? `On air: ${director.pair.map(name).join(' + ')}` : director.on_air ? `On air: ${name(director.on_air)}` : director.scene ? `On air: ${director.scene}` : '';
  document.querySelector('#main-stage').disabled = !director.default_shot;
  document.querySelector('#main-stage').title = director.default_shot ? `Put ${director.default_shot} on air. Controller: View` : 'No stage shot is set: choose a default shot on the Director page';
  // The list of cameras to show.
  if (!document.querySelector('#chooser').open || !choices.childElementCount) {
    choices.replaceChildren(...state.cameras.filter(c => c.in_use !== false).map(camera => {
      const label = node('label'), box = document.createElement('input'); box.type = 'checkbox'; box.checked = shown.some(c => c.id === camera.id);
      box.onchange = () => choose([...choices.querySelectorAll('input')].map((b, i) => b.checked ? state.cameras.filter(c => c.in_use !== false)[i].id : null).filter(Boolean));
      label.append(box, node('span', ` ${camera.name}${camera.gimbal?.address ? ' (gimbal)' : ''}`)); return label;
    }));
  }
  // A tile for each camera shown; its picture is the live feed, set once so the stream is not restarted.
  for (const [id, tile] of tiles) if (!shown.some(c => c.id === id)) { tile.querySelector('img').src = ''; tile.remove(); tiles.delete(id); }
  for (const camera of shown) {
    let tile = tiles.get(camera.id);
    if (!tile) {
      tile = node('article', undefined, 'feed'); tile.dataset.id = camera.id;
      const picture = node('div', undefined, 'picture'), img = document.createElement('img'), said = node('div', 'Waiting for its picture…', 'said');
      img.alt = `${camera.name}, live`; img.onload = () => { said.hidden = true; };
      img.onerror = () => { said.hidden = false; said.textContent = 'No live picture (is the camera streaming, and the relay on?). Trying again…'; setTimeout(() => { img.src = feed(camera.id, true); }, 3000); };
      img.src = feed(camera.id);
      picture.append(img, said);
      tile.append(node('h2'), picture, node('p', '', 'line'), node('div', undefined, 'buttons'));
      tile.onclick = event => { if (event.target.closest('button')) return; const index = [...drives.keys()][0]; if (index !== undefined) { drives.set(index, camera.id); draw(); } };
      feeds.append(tile); tiles.set(camera.id, tile);
    }
    const onAir = director.on_air === camera.id || (director.pair || []).includes(camera.id);
    const drivers = [...drives].filter(([, id]) => id === camera.id).map(([index]) => index);
    tile.classList.toggle('on-air', onAir); tile.classList.toggle('driven', drivers.length > 0);
    if (drivers.length) tile.style.setProperty('--driver', COLOURS[drivers[0] % COLOURS.length]);
    const heading = tile.querySelector('h2'); heading.replaceChildren(node('span', camera.name));
    if (onAir) heading.append(node('span', 'ON AIR', 'badge air'));
    for (const index of drivers) { const badge = node('span', `Controller ${index + 1}`, 'badge'); badge.style.background = COLOURS[index % COLOURS.length]; badge.style.color = '#101820'; heading.append(badge); }
    const t = camera.telemetry || {}, gimbal = camera.gimbal;
    const zoom = t.zoom_percent ? ` · zoom ${(t.zoom_percent / 100).toFixed(1)}×` : '';
    tile.querySelector('.line').textContent = `${!camera.online ? 'Offline' : gimbal?.summary || (gimbal ? 'Gimbal not connected' : 'No gimbal: zoom and cut only')}${zoom}${director.gimbal_out?.[camera.id] ? ` · kept off air: ${director.gimbal_out[camera.id]}` : ''}`;
    const buttons = tile.querySelector('.buttons'); buttons.replaceChildren();
    const take = node('button', onAir ? 'On air' : 'Put on air'); take.disabled = onAir || !camera.online; take.onclick = () => act('/api/director', { take: camera.id }).then(refresh);
    buttons.append(take);
    if (gimbal?.connected) {
      const stop = node('button', 'Stop'); stop.onclick = () => send(camera.id, 'gimbal.stop');
      buttons.append(stop);
      if (t.capabilities?.gimbal_follow) {
        const following = !!gimbal.follow;
        const follow = node('button', following ? 'Follow off' : 'Follow a face'); follow.onclick = () => send(camera.id, 'gimbal.follow', following ? { on: false } : { on: true, who: 'face' }).then(refresh);
        buttons.append(follow);
      }
    }
  }
  drawPads(shown);
}

document.querySelector('#main-stage').onclick = () => act('/api/operate/main', {}).then(refresh);
document.querySelector('#previous').onclick = () => act('/api/operate/previous', {}).then(refresh);

// ---- Xbox controllers --------------------------------------------------------------------------------------------
function drawPads(shown) {
  const box = document.querySelector('#pads');
  const connected = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean);
  if (!connected.length) { box.replaceChildren(node('p', 'No controller seen yet. Connect an Xbox controller (Bluetooth or USB) and press any button on it.')); return; }
  box.replaceChildren(...connected.map(pad => {
    const row = node('p'), pick = document.createElement('select');
    for (const camera of shown) { const option = node('option', camera.name); option.value = camera.id; option.selected = drives.get(pad.index) === camera.id; pick.append(option); }
    pick.onchange = () => { drives.set(pad.index, pick.value); draw(); };
    const swatch = node('span', '■ '); swatch.style.color = COLOURS[pad.index % COLOURS.length];
    row.append(swatch, node('span', `Controller ${pad.index + 1} drives `), pick, node('span', ` · aiming ${['slow', 'normal', 'fast'][speed]}`));
    return row;
  }));
}
const curve = v => { const a = Math.abs(v); if (a < DEAD) return 0; const x = (a - DEAD) / (1 - DEAD); return Math.sign(v) * (0.4 * x + 0.6 * x * x * x); };
function step(index, delta) {
  const shown = chosen(); if (!shown.length) return;
  const at = Math.max(0, shown.findIndex(c => c.id === drives.get(index)));
  drives.set(index, shown[(at + delta + shown.length) % shown.length].id); draw();
}
function poll(time) {
  if (!state || !navigator.getGamepads) return;
  const shown = chosen();
  for (const pad of navigator.getGamepads()) {
    if (!pad || pad.mapping !== 'standard') continue;
    if (!drives.has(pad.index) || !shown.some(c => c.id === drives.get(pad.index))) {
      // A new controller drives a shown camera no other controller has, or else the first.
      const free = shown.find(c => ![...drives.values()].includes(c.id)) || shown[0];
      if (!free) continue;
      drives.set(pad.index, free.id); draw();
    }
    const camera = drives.get(pad.index), last = pads.get(pad.index) || { buttons: [], sent: 0, active: false };
    const pressed = i => pad.buttons[i]?.pressed && !last.buttons[i];
    if (pressed(0)) act('/api/director', { take: camera }).then(refresh);
    if (pressed(1)) send(camera, 'gimbal.stop');
    if (pressed(2)) { const c = state.cameras.find(x => x.id === camera); if (c?.gimbal?.connected) send(camera, 'gimbal.follow', c.gimbal.follow ? { on: false } : { on: true, who: 'face' }).then(refresh); }
    if (pressed(3)) act('/api/operate/previous', {}).then(refresh);
    if (pressed(8)) act('/api/operate/main', {}).then(refresh);
    if (pressed(4) || pressed(14)) step(pad.index, -1);
    if (pressed(5) || pressed(15)) step(pad.index, 1);
    if (pressed(12)) { speed = Math.min(SPEEDS.length - 1, speed + 1); draw(); }
    if (pressed(13)) { speed = Math.max(0, speed - 1); draw(); }
    const most = SPEEDS[speed] * 100;
    // Aimed with the right stick (axes 2 and 3 in the standard mapping), as a camera operator's right hand does.
    const pan = Math.round(curve(pad.axes[2] || 0) * most), tilt = Math.round(-curve(pad.axes[3] || 0) * most);
    const zoomed = (pad.buttons[7]?.value || 0) - (pad.buttons[6]?.value || 0), zoom = Math.abs(zoomed) < ZOOM_DEAD ? 0 : Math.round(zoomed * 100) / 100;
    const active = pan !== 0 || tilt !== 0 || zoom !== 0;
    // Ten times a second while held; once more when let go, so the gimbal is told to stop at once.
    if ((active && time - last.sent >= EVERY_MS) || (!active && last.active)) {
      last.sent = time;
      api('/api/operate/control', { camera_id: camera, pan, tilt, zoom }).catch(error => { if (!/rate limit/i.test(error.message)) result.textContent = error.message; });
    }
    pads.set(pad.index, { buttons: pad.buttons.map(b => b.pressed), sent: last.sent, active });
  }
}
window.addEventListener('gamepadconnected', () => draw());
window.addEventListener('gamepaddisconnected', event => { const camera = drives.get(event.gamepad.index); drives.delete(event.gamepad.index); pads.delete(event.gamepad.index); if (camera) api('/api/operate/control', { camera_id: camera, pan: 0, tilt: 0, zoom: 0 }).catch(() => {}); draw(); });
