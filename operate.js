'use strict';
// The Operate page: the cameras chosen here, live from the camera relay (no look-ahead, about a fifth of a second behind
// real life), steered with Xbox controllers through the browser's Gamepad API (no driver or plugin), or the buttons.
// Each controller drives one camera at a time (LB/RB to change); its readings go to the manager ten times a second while
// a stick or trigger is held (/api/operate/control), and the phone stops its gimbal by itself half a second after the last.
let csrf = '', state = null, speed = 1;
try { const kept = Number(localStorage.getItem('operate-speed')); if (kept >= 0 && kept <= 4) speed = kept; } catch (error) {}
const result = document.querySelector('#result'), feeds = document.querySelector('#feeds'), choices = document.querySelector('#choices');
const tiles = new Map(), drives = new Map(), pads = new Map();          // camera id -> tile; gamepad index -> camera id; index -> last reading
const SPEEDS = [0.08, 0.15, 0.25, 0.4, 0.6];                            // aiming speed presets: the most the stick asks for
const SPEED_WORDS = ['very slow', 'slow', 'normal', 'fast', 'very fast'];
const COLOURS = ['#5fb4ee', '#f4a261', '#90be6d', '#f78fb3'];
const DEAD = 0.18, ZOOM_DEAD = 0.1, EVERY_MS = 100, SOONEST_MS = 45;   // the manager takes a reading every 40 ms at most
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

// Which cameras are shown: kept in this browser. At first, every camera in use, up to six (each shown is decoded live).
function chosen() {
  let ids = null;
  try { ids = JSON.parse(localStorage.getItem('operate.cameras') || 'null'); } catch (error) { ids = null; }
  const usable = state.cameras.filter(c => c.in_use !== false);
  if (!Array.isArray(ids)) ids = usable.slice(0, 6).map(c => c.id);
  return usable.filter(c => ids.includes(c.id));
}
function choose(ids) { try { localStorage.setItem('operate.cameras', JSON.stringify(ids)); } catch (error) { /* kept for this visit only */ } draw(); }

// How many live pictures a second: 24 shows a zoom or a pan smoothly, for twice the work per camera watched.
const rate = document.querySelector('#rate');
api('/api/operate/settings').then(s => { rate.value = String(s.rate); }).catch(() => {});
rate.onchange = async () => {
  const done = await act('/api/operate/settings', { rate: Number(rate.value) });
  if (done) for (const [id, tile] of tiles) tile.querySelector('img').src = feed(id, true);
};

async function refresh() {
  try { state = await api('/api/cameras'); } catch (error) { result.textContent = error.message; return; }
  draw();
}

const showsContext = {
  words: () => window.concert?.mode?.words || { role: 'instrument', roles: 'instruments', anyone: 'anyone performing', crowd: 'crowd', example: 'banjo, harmonica, pedal steel' },
  ask: dialog => window.concert.ask(dialog), tell: message => { result.textContent = message; },
  direct: async body => { await act('/api/director', body); refresh(); },
  framing: async (id, framing) => { await act(`/api/cameras/${encodeURIComponent(id)}/framing`, { framing }); refresh(); } };
const followContext = camera => ({ role: window.concert?.session?.role || 'operator', off: !camera.online,
  post: (path, body) => api(path, body), send: (c, command, parameters) => send(c.id, command, parameters), refresh, tell: message => { result.textContent = message; } });

function draw() {
  if (!state) return;
  const shown = chosen(), director = state.director || {};
  const name = id => state.cameras.find(c => c.id === id)?.name || id;
  document.querySelector('#programme').textContent = director.pair ? `On air: ${director.pair.map(name).join(' + ')}` : director.on_air ? `On air: ${name(director.on_air)}` : director.scene ? `On air: ${director.scene}` : '';
  drawProgramme(director);
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
      tile.append(node('h2'), picture, onscreenPad(camera.id), node('p', '', 'line'), node('div', undefined, 'buttons'), node('div', undefined, 'shows'), node('div', undefined, 'follow'));
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
    if (camera.online && t.recording) heading.append(node('span', 'REC', 'badge rec'));
    const heat = temperature(camera); if (heat) heading.append(heat);
    const zoom = t.zoom_percent ? ` · zoom ${(t.zoom_percent / 100).toFixed(1)}×` : '';
    const line = tile.querySelector('.line');
    line.textContent = `${!camera.online ? 'Offline' : gimbal?.summary || (gimbal ? 'Gimbal not connected' : 'No gimbal: zoom and cut only')}${camera.lens_now ? '' : zoom}${director.gimbal_out?.[camera.id] ? ` · kept off air: ${director.gimbal_out[camera.id]}` : ''}`;
    if (camera.lens_now) line.append(' ', window.lensChip(camera.lens_now));
    const buttons = tile.querySelector('.buttons'); buttons.replaceChildren();
    const take = node('button', onAir ? 'On air' : 'Put on air'); take.disabled = onAir || !camera.online; take.onclick = () => act('/api/director', { take: camera.id }).then(refresh);
    buttons.append(take);
    // Back to no zoom (1x), kept on the phone, for a camera left zoomed in.
    if (camera.online && (t.zoom_percent || 100) !== 100) {
      const reset = node('button', 'Reset zoom'); reset.title = `Back to 1x (now ${((t.zoom_live_percent || t.zoom_percent) / 100).toFixed(1)}x), and kept on the phone`;
      reset.onclick = () => resetZoom(camera, t);
      buttons.append(reset);
    }
    const pad = tile.querySelector('.onscreen');
    pad.hidden = !onscreen;
    for (const b of pad.querySelectorAll('[data-pan], [data-tilt]')) b.disabled = !camera.online || !gimbal?.connected;
    for (const b of pad.querySelectorAll('[data-zoom]')) b.disabled = !camera.online;
    // Arming, streaming and recording, as on its card: only what fits the camera's state; stopping asks first.
    if (camera.online) buttons.append(...capture(camera, t));
    if (gimbal?.connected) {
      const stop = node('button', 'Stop'); stop.onclick = () => send(camera.id, 'gimbal.stop');
      buttons.append(stop);
      // Its home position (gimbal.point to angles kept here): set where it points now, and go back there.
      if (gimbal.home) {
        const home = node('button', 'Home'); home.disabled = !gimbal.home.set || gimbal.home.stale;
        home.title = !gimbal.home.set ? 'No home position yet: aim it, then Set home' : gimbal.home.stale ? 'The phone restarted since Set home: aim it and Set home again' : 'Turn it back to its home position (stops following). Controller: press the right stick';
        home.onclick = () => goHome(camera.id);
        const sethome = node('button', gimbal.home.set ? 'Set home again' : 'Set home'); sethome.title = 'Keep where it points now as its home position';
        sethome.onclick = () => act(`/api/cameras/${encodeURIComponent(camera.id)}/gimbal-home`, { action: 'set' }).then(done => { if (done) result.textContent = `${camera.name}: home set`; refresh(); });
        buttons.append(home, sethome);
      }
    }
    // What it shows: the camera card's own control (shows.js), the same setting; for every camera, gimbal or not.
    const shows = tile.querySelector('.shows');
    if (director.camera_focus !== undefined) window.whatItShows.into(shows, camera, director, { ...showsContext, studio: state.creator });
    else { shows.replaceChildren(); delete shows.dataset.signature; }
    // Whom its gimbal follows and its follow plan: the camera card's own control (follow.js), the same setting.
    const follow = tile.querySelector('.follow');
    if (gimbal?.connected && t.capabilities?.gimbal_follow) window.gimbalFollow.into(follow, camera, followContext(camera));
    else { follow.replaceChildren(); delete follow.dataset.signature; }
  }
  drawPads(shown);
}

// The capture controls of a tile: Arm when not armed; once armed, the stream and the recording each started or
// stopped, and Disarm when it is doing neither. Stopping asks first, with the card's words; starting syncs the phone's
// clock first when it is off, as the card does.
const WARN = { 'stream.stop': 'This can interrupt capture.', 'recording.stop': 'This can interrupt capture.',
  'camera.disarm': 'Disarm stops the capture service. Remote Arm only works on a phone set up as device owner; otherwise someone must tap Arm on the phone.' };
function capture(camera, t) {
  const streaming = !!(t.streaming || t.capture?.streamRequested), made = [];
  const button = (label, command, danger) => {
    const b = node('button', label); if (danger) b.className = 'danger';
    b.onclick = async () => {
      if (WARN[command] && !await window.concert.sure(`${label} on ${camera.name}?\n${WARN[command]}`, { ok: label, danger: true })) return;
      b.disabled = true;
      const clockOff = ['stream.start', 'recording.start'].includes(command) && t.capabilities?.time_sync && typeof camera.clock_offset_ms === 'number' && Math.abs(camera.clock_offset_ms) > 20;
      if (clockOff) await send(camera.id, 'time.sync');
      await send(camera.id, command, command === 'camera.arm' && t.capabilities?.stream_only_arm ? { local_recording: false } : {});
      refresh();
    };
    return b;
  };
  if (!t.armed) return [button('Arm', 'camera.arm')];
  made.push(streaming ? button('Stop stream', 'stream.stop', true) : button('Start stream', 'stream.start'));
  made.push(t.recording ? button('Stop recording', 'recording.stop', true) : button('Record', 'recording.start'));
  if (!streaming && !t.recording) made.push(button('Disarm', 'camera.disarm', true));
  return made;
}

// The phone's temperature, small, coloured by how hot (thermal.py's levels), and the rest when pointed at.
function temperature(camera) {
  const h = camera.thermal; if (!camera.online || !h || h.temperature_c == null) return null;
  const chip = node('span', `${Math.round(h.temperature_c)}°`, `badge heat ${h.level}`);
  const trend = typeof h.trend_c_per_minute === 'number' && Math.abs(h.trend_c_per_minute) >= 0.05 ? `, ${h.trend_c_per_minute > 0 ? 'rising' : 'falling'} ${Math.abs(h.trend_c_per_minute).toFixed(1)} °C a minute` : ', steady';
  const left = typeof h.minutes_to_stop === 'number' ? `; at this rate it reaches its ${h.stop_c} °C stop in about ${Math.round(h.minutes_to_stop)} minutes` : '';
  const word = { ok: '', warm: ' Warm: give it air or a lighter load.', hot: ' Hot: at its stop temperature, the phone protects itself.', critical: ' Critical: cool it now.' }[h.level] || '';
  chip.title = `Phone at ${h.temperature_c.toFixed(1)} °C${trend}${left}.${word}`;
  chip.setAttribute('aria-label', chip.title);
  if (h.level !== 'ok') chip.textContent += ` ${h.level}`;
  return chip;
}

// Reset zoom: a phone that zooms by itself glides back to 1x; every phone is then given 1x as its zoom, which it keeps
// (the Pixel 8 had kept a zoom it was left at, 2026-10-24).
async function resetZoom(camera, t) {
  if (t.capabilities?.zoom_ramp && (t.streaming || t.recording)) await send(camera.id, 'camera.zoom', { to_percent: 100, seconds: 0.6 });
  await send(camera.id, 'camera.lens', { zoom_percent: 100 });
  refresh();
}

// On-screen controls (a choice kept in this browser): under each picture, arrows that aim its gimbal while held and
// buttons that zoom while held, sent as a controller's readings are (/api/operate/control), for a person without one.
let onscreen = false;
try { onscreen = localStorage.getItem('operate.onscreen') === '1'; } catch (error) { /* off */ }
document.querySelector('#onscreen').checked = onscreen;
document.querySelector('#onscreen').onchange = event => { onscreen = event.target.checked; try { localStorage.setItem('operate.onscreen', onscreen ? '1' : '0'); } catch (error) { /* this visit */ } draw(); };
const HELD_PAN = 45, HELD_ZOOM = 0.6;
function onscreenPad(id) {
  // Made once with the tile and never redrawn, so a press held across a refresh is let go of properly.
  const pad = node('div', undefined, 'onscreen'); pad.hidden = true;
  let timer = null, reading = null;
  const sendReading = () => api('/api/operate/control', { camera_id: id, ...reading }).catch(error => { if (!/rate limit/i.test(error.message)) result.textContent = error.message; });
  const release = () => { if (!timer) return; clearInterval(timer); timer = null; reading = { pan: 0, tilt: 0, zoom: 0 }; sendReading(); };
  const hold = (label, title, values, kind) => {
    const b = node('button', label); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.dataset[kind] = '1';
    b.onpointerdown = event => { event.preventDefault(); b.setPointerCapture?.(event.pointerId); reading = { pan: 0, tilt: 0, zoom: 0, ...values }; sendReading(); clearInterval(timer); timer = setInterval(sendReading, 120); };
    b.onpointerup = b.onpointercancel = b.onlostpointercapture = release;
    b.oncontextmenu = event => event.preventDefault();
    return b;
  };
  const aim = node('div', undefined, 'aim');
  aim.append(node('span'), hold('▲', 'Tilt up (hold)', { tilt: HELD_PAN }, 'tilt'), node('span'),
    hold('◀', 'Pan left (hold)', { pan: -HELD_PAN }, 'pan'), hold('■', 'Stop the gimbal', { pan: 0, tilt: 0 }, 'pan'), hold('▶', 'Pan right (hold)', { pan: HELD_PAN }, 'pan'),
    node('span'), hold('▼', 'Tilt down (hold)', { tilt: -HELD_PAN }, 'tilt'), node('span'));
  const zoom = node('div', undefined, 'zoom');
  zoom.append(hold('−', 'Zoom out (hold)', { zoom: -HELD_ZOOM }, 'zoom'), node('span', 'Zoom'), hold('+', 'Zoom in (hold)', { zoom: HELD_ZOOM }, 'zoom'));
  pad.append(aim, zoom);
  window.addEventListener('blur', release);
  return pad;
}

// The programme: recorded to a file, and OBS's own stream, as on the Show page. Stopping either asks first.
document.querySelector('#record').onclick = async () => {
  const recording = state?.director?.recording;
  if (recording && !await window.concert.sure('Stop recording the programme? The file is finished and checked.', { ok: 'Stop recording', danger: true })) return;
  await act('/api/director', { record: !recording }); refresh();
};
document.querySelector('#stream').onclick = async () => {
  const live = state?.director?.streaming;
  if (!await window.concert.sure(live ? 'Stop OBS streaming? Viewers lose the programme.' : 'Start OBS streaming to the service set up in OBS? The programme goes out to its audience.', { ok: live ? 'Stop stream' : 'Start stream', danger: !!live })) return;
  await act('/api/director', { stream: !live }); refresh();
};
function drawProgramme(director) {
  const record = document.querySelector('#record'), stream = document.querySelector('#stream');
  const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  record.textContent = director.recording ? `Stop recording ${clock(director.recording.seconds || 0)}` : 'Record programme';
  record.classList.toggle('danger', !!director.recording);
  stream.textContent = director.streaming ? `Stop stream ${clock(director.streaming.seconds || 0)}${director.streaming.reconnecting ? ' · reconnecting' : ''}` : 'Start stream';
  stream.classList.toggle('danger', !!director.streaming);
}

function goHome(id) { return act(`/api/cameras/${encodeURIComponent(id)}/gimbal-home`, { action: 'go' }).then(refresh); }

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
    row.append(swatch, node('span', `Controller ${pad.index + 1} drives `), pick, node('span', ` · aiming ${SPEED_WORDS[speed]} (d-pad up / down)`));
    return row;
  }));
}
// Gentle near the middle for small corrections, the full preset only at the edge: mostly cubic.
const curve = v => { const a = Math.abs(v); if (a < DEAD) return 0; const x = (a - DEAD) / (1 - DEAD); return Math.sign(v) * (0.15 * x + 0.85 * x * x * x); };
// A trigger: squared, so a light squeeze creeps and a full one moves.
const squeeze = v => { const a = Math.abs(v); if (a < ZOOM_DEAD) return 0; const x = (a - ZOOM_DEAD) / (1 - ZOOM_DEAD); return Math.sign(v) * x * x; };
const keepSpeed = () => { try { localStorage.setItem('operate-speed', String(speed)); } catch (error) {} };
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
    if (pressed(11)) goHome(camera);
    if (pressed(4) || pressed(14)) step(pad.index, -1);
    if (pressed(5) || pressed(15)) step(pad.index, 1);
    if (pressed(12)) { speed = Math.min(SPEEDS.length - 1, speed + 1); keepSpeed(); draw(); }
    if (pressed(13)) { speed = Math.max(0, speed - 1); keepSpeed(); draw(); }
    const most = SPEEDS[speed] * 100;
    // Aimed with the right stick (axes 2 and 3 in the standard mapping), as a camera operator's right hand does.
    const pan = Math.round(curve(pad.axes[2] || 0) * most), tilt = Math.round(-curve(pad.axes[3] || 0) * most);
    const zoomed = (pad.buttons[7]?.value || 0) - (pad.buttons[6]?.value || 0), zoom = Math.round(squeeze(zoomed) * 100) / 100;
    const active = pan !== 0 || tilt !== 0 || zoom !== 0;
    // At once when a stick or trigger is first pushed or moves clearly (no waiting for the next tenth of a second), ten
    // times a second while held, and once more when let go, so the gimbal is told to stop at once.
    const moved = !last.active || Math.abs(pan - (last.pan || 0)) >= 8 || Math.abs(tilt - (last.tilt || 0)) >= 8 || Math.abs(zoom - (last.zoom || 0)) >= 0.08;
    if ((active && (time - last.sent >= EVERY_MS || (moved && time - last.sent >= SOONEST_MS))) || (!active && last.active)) {
      last.sent = time; last.pan = pan; last.tilt = tilt; last.zoom = zoom;
      api('/api/operate/control', { camera_id: camera, pan, tilt, zoom }).catch(error => { if (!/rate limit/i.test(error.message)) result.textContent = error.message; });
    }
    pads.set(pad.index, { buttons: pad.buttons.map(b => b.pressed), sent: last.sent, active, pan: last.pan, tilt: last.tilt, zoom: last.zoom });
  }
}
window.addEventListener('gamepadconnected', () => draw());
window.addEventListener('gamepaddisconnected', event => { const camera = drives.get(event.gamepad.index); drives.delete(event.gamepad.index); pads.delete(event.gamepad.index); if (camera) api('/api/operate/control', { camera_id: camera, pan: 0, tilt: 0, zoom: 0 }).catch(() => {}); draw(); });
