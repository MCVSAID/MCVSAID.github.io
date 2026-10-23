'use strict';
let csrf = '', busy = new Set();
// Latest command per camera: shown on its card while running and until the next one.
const activity = new Map();
function paintActivity() {
  // Only the per-camera command lines; other status boxes share the styling but are not driven from here.
  for (const line of document.querySelectorAll('.activity[data-camera]')) {
    const current = activity.get(line.dataset.camera);
    line.hidden = !current;
    if (!current) continue;
    line.replaceChildren();
    if (current.state === 'RUNNING') {
      line.className = 'activity running';
      line.append(document.createElement('progress'), node('span', `${current.label}: waiting for the camera… ${Math.round((Date.now() - current.started) / 1000)} s`));
    } else {
      line.className = `activity ${current.state === 'SUCCEEDED' ? 'done' : 'failed'}`;
      line.append(node('span', `${current.label}: ${current.state === 'SUCCEEDED' ? 'done' : current.state}${current.error ? ` — ${current.error}` : ''} (${new Date(current.finished).toLocaleTimeString()})`));
    }
  }
}
setInterval(paintActivity, 500);
const result = document.querySelector('#result');
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
  return data;
}
// Which part of the main page is showing, and which sections belong to it.
const PARTS = {
  '/': ['#ready', '#recording-alerts', '#program', '#recipe-now', '#fleet', '#heat-plan'],
  '/recipe': ['#recipe'],
  '/cameras': ['#studio', '#bands', '#cameras'],
  '/colour': ['#colour'],
  '/director': ['#ai-setup', '#director-settings', '#voice-shots', '#explain', '#face-blur', '#obs-sync'],
  '/recordings': ['#recordings-tabs', '#pc-recordings', '#relay'],
  '/system': ['#system-tabs', '#devices-setup', '#release', '#battery', '#silence', '#network', '#access', '#locations', '#transfer', '#ai-system', '#relay-system', '#manager-update', '#decoding', '#face-blur-system'],
};
// System's own sections, each a tab: [address after the #, name, its panels]. Done once per installation, phone or venue.
const SYSTEM = [
  ['devices', 'Cameras & devices', ['#devices-setup', '#release', '#battery', '#silence']],
  ['network', 'Network', ['#network']],
  ['logins', 'Logins', ['#access']],
  ['locations', 'Locations & backups', ['#locations', '#transfer']],
  ['pc', 'This PC', ['#ai-system', '#relay-system', '#manager-update', '#decoding', '#face-blur-system']],
];
// The tab an older link (/system#release, /locations) means.
const systemTabOf = name => SYSTEM.find(([id, , panels]) => id === name || panels.includes(`#${name}`))?.[0] || 'devices';
const ADMIN_ONLY = ['/system', '/colour'];
let part = '/', role = 'admin', systemTab = 'devices';
function show(path) {
  if (path === '/locations') { path = '/system'; systemTab = 'locations'; }
  else if (path === '/system') systemTab = systemTabOf(location.hash.slice(1));
  part = PARTS[path] ? path : '/';
  // The Recipe page is Cooking's: in another kind of event it is the Show page.
  if (part === '/recipe' && window.concert.mode && window.concert.mode.mode !== 'cooking') { part = '/'; history.replaceState(null, '', '/'); }
  if (ADMIN_ONLY.includes(part) && role !== 'admin') { part = '/'; history.replaceState(null, '', '/'); }
  for (const [name, sections] of Object.entries(PARTS)) for (const id of sections) { const section = document.querySelector(id); if (section) section.hidden = name !== part; }
  if (part === '/system') {
    for (const [id, , panels] of SYSTEM) for (const panel of panels) document.querySelector(panel).hidden = id !== systemTab;
    window.concert.tabs(document.querySelector('#system-tabs'), SYSTEM.map(([id, name]) => [`#${id}`, name]), `#${systemTab}`, href => { history.pushState(null, '', `/system${href}`); show('/system'); });
    // Setting a phone up by cable is done at this PC only.
    document.querySelector('#add-phone').hidden = !!window.concert.session?.away;
  }
  if (part === '/recordings') window.concert.tabs(document.querySelector('#recordings-tabs'), window.concert.recordingTabs, '/recordings');
  const page = window.concert.pages.find(p => p[0] === (window.concert.under[part] || part));
  const title = part === '/recordings' ? 'PC recordings' : part === '/system' ? SYSTEM.find(([id]) => id === systemTab)[1] : page[1];
  document.title = `${title} · MCVSAID`;
  document.querySelector('header h1').textContent = part === '/recordings' ? 'Recordings' : page[1];
  // The side bar marks the section that is open, and shows the pages' state.
  window.concert.subCurrent = part === '/system' ? `/system#${systemTab}` : part === '/recordings' ? '/recordings' : null;
  window.concert.nav(role, show);
  refresh();
}
async function enter(session) {
  csrf = session.csrf; role = session.role || 'admin'; window.concert.session = session;
  document.querySelector('#password').value = '';
  document.querySelector('#login').hidden = true; document.querySelector('#dashboard').hidden = false;
  window.concert.nav(role, show);
  show(location.pathname.replace(/\/+$/, '') || '/');
  // Opened at a panel (the Add a phone page links to /system#release): go to it once it has been drawn.
  const wanted = location.hash && document.querySelector(location.hash);
  if (wanted) refresh().then(() => { if (!wanted.hidden) wanted.scrollIntoView({ block: 'start' }); });
  setInterval(refresh, 2000);
}
window.addEventListener('hashchange', () => { if (csrf && part === '/system') show('/system'); });
window.addEventListener('popstate', () => { if (csrf) { show(location.pathname.replace(/\/+$/, '') || '/'); window.concert.nav(role, show); } });
document.querySelector('#login').onsubmit = async event => {
  event.preventDefault();
  try { await enter(await api('/api/login', { method: 'POST', body: JSON.stringify({ password: document.querySelector('#password').value }) })); }
  catch (error) { result.textContent = error.message; }
};
// A login made on another page, or before this one was reloaded, is picked up: the password is asked for once.
window.concert.resume().then(session => { if (session) enter(session); });
// A group of a card's settings, folded until opened. It stays open, or shut, through the two-second redraw.
const opened = new Set();
function fold(key, title) {
  const group = document.createElement('details'); group.className = 'fold'; group.open = opened.has(key);
  group.append(node('summary', title));
  group.addEventListener('toggle', () => { if (group.open) opened.add(key); else opened.delete(key); });
  return group;
}
function node(tag, text) { const element = document.createElement(tag); element.textContent = text; return element; }
// Aiming a camera's gimbal: a move every 300 ms for as long as an arrow is held (each lasts half a second on the phone,
// so a closed page stops it by itself), and a stop on letting go, wherever that happens: the card is redrawn every two
// seconds beneath the pointer. A stop waits for a move on its way, so that it is the last word.
let aiming = null;
const aimSpeeds = new Map();
async function aimSend(cameraId, command, parameters) {
  try {
    const outcome = await api(`/api/cameras/${encodeURIComponent(cameraId)}/commands`, { method: 'POST', body: JSON.stringify({ request_id: crypto.randomUUID(), command, parameters, timeout_seconds: 3 }) });
    if (outcome.state !== 'SUCCEEDED') result.textContent = `Gimbal: ${outcome.result?.error || outcome.state}`;
  } catch (error) { if (!/rate limit/i.test(error.message)) result.textContent = `Gimbal: ${error.message}`; }
}
function aimStart(camera, pan, tilt) {
  aimStop();
  const held = aiming = { id: camera.id };
  const step = () => {
    if (aiming !== held) return;
    const began = Date.now();
    held.flight = aimSend(held.id, 'gimbal.move', { pan, tilt }).then(() => { if (aiming === held) held.timer = setTimeout(step, Math.max(0, 300 - (Date.now() - began))); });
  };
  step();
}
function aimStop() {
  if (!aiming) return;
  const held = aiming; aiming = null; clearTimeout(held.timer);
  Promise.resolve(held.flight).finally(() => aimSend(held.id, 'gimbal.stop', {}));
}
for (const event of ['pointerup', 'pointercancel', 'blur']) window.addEventListener(event, aimStop);
document.addEventListener('visibilitychange', () => { if (document.hidden) aimStop(); });
/** A button that turns the gimbal while held, by mouse, touch or keyboard. */
function aimButton(camera, label, title, pan, tilt, off) {
  const button = node('button', label); button.title = title; button.setAttribute('aria-label', title); button.disabled = off;
  const speed = () => aimSpeeds.get(camera.id) || 50;
  button.onpointerdown = event => { event.preventDefault(); aimStart(camera, pan * speed(), tilt * speed()); };
  button.onkeydown = event => { if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) { event.preventDefault(); aimStart(camera, pan * speed(), tilt * speed()); } };
  button.onkeyup = event => { if (event.key === 'Enter' || event.key === ' ') aimStop(); };
  button.oncontextmenu = event => event.preventDefault();
  return button;
}
async function send(camera, command, parameters = {}, label = command) {
  if (busy.has(camera.id)) return;
  const warnings = {
    'camera.disarm': 'Disarm stops the capture service. Remote Arm only works on a phone set up as device owner; otherwise someone must tap Arm on the phone. Stop SRT / Finalize local MP4 leave the camera armed and idle.',
    'system.reboot': 'Reboot the phone? It reconnects by itself after starting. Local recording stays unavailable until the screen lock has been entered once.',
    'stream.stop': 'This can interrupt capture.', 'stream.restart': 'This can interrupt capture.', 'recording.stop': 'This can interrupt capture.' };
  if (warnings[command] && !await concert.sure(`${label} on ${camera.name}?\n${warnings[command]}`, { ok: label, danger: true })) return;
  busy.add(camera.id);
  activity.set(camera.id, { label, started: Date.now(), state: 'RUNNING' });
  result.textContent = `${camera.name}: waiting for final acknowledgement…`;
  refresh();
  try {
    const outcome = await api(`/api/cameras/${encodeURIComponent(camera.id)}/commands`, { method: 'POST', body: JSON.stringify({ request_id: crypto.randomUUID(), command, parameters }) });
    result.textContent = JSON.stringify(outcome, null, 2);
    activity.set(camera.id, { label, state: outcome.state, error: outcome.result?.error, finished: Date.now() });
  } catch (error) {
    result.textContent = `${camera.name}: ${error.message}`;
    activity.set(camera.id, { label, state: 'FAILED', error: error.message, finished: Date.now() });
  }
  finally { busy.delete(camera.id); refresh(); settle(); }
}
// Runs several commands in order on one camera, stopping at the first that does not succeed.
async function sequence(camera, steps, label) {
  if (busy.has(camera.id)) return;
  busy.add(camera.id); refresh();
  let done = 0;
  try {
    for (const [name, command, parameters] of steps) {
      activity.set(camera.id, { label: `${label} — step ${done + 1} of ${steps.length}: ${name}`, started: Date.now(), state: 'RUNNING' });
      paintActivity();
      const outcome = await api(`/api/cameras/${encodeURIComponent(camera.id)}/commands`, { method: 'POST', body: JSON.stringify({ request_id: crypto.randomUUID(), command, parameters: parameters || {} }) });
      result.textContent = JSON.stringify(outcome, null, 2);
      if (outcome.state !== 'SUCCEEDED') throw new Error(`${name}: ${outcome.state}${outcome.result?.error ? ` — ${outcome.result.error}` : ''}`);
      done++;
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    activity.set(camera.id, { label, state: 'SUCCEEDED', finished: Date.now() });
  } catch (error) {
    activity.set(camera.id, { label, state: 'FAILED', error: `stopped at step ${done + 1} of ${steps.length} (${error.message})`, finished: Date.now() });
  } finally { busy.delete(camera.id); refresh(); }
}
// What a camera's temperature means right now, in one sentence; null when there is nothing to say.
// Until the manager has been restarted with temperature tracking, work from the phone's reading alone.
function heatOf(camera) {
  if (camera.thermal) return camera.thermal;
  const value = camera.telemetry?.temperature_c;
  if (typeof value !== 'number') return null;
  return { temperature_c: value, warn_c: 45, stop_c: 47, danger_c: 50, level: value >= 50 ? 'critical' : value >= 47 ? 'hot' : value >= 45 ? 'warm' : 'ok', phone_safeguard: !!camera.telemetry?.capabilities?.thermal_safeguard };
}
function heatMessage(camera) {
  const h = heatOf(camera);
  if (!h || h.temperature_c == null || h.level === 'ok' || h.level === 'unknown') return null;
  const at = `${h.temperature_c.toFixed(1)} °C`;
  if (!camera.online) return `went offline while hot (${at}). It has probably shut itself down; let it cool before switching it on.`;
  if (h.level === 'critical') return `very hot at ${at}. Phones shut themselves down around ${h.danger_c} °C and above. Cool it now: airflow, shade, or stop its stream.`;
  if (h.level === 'hot') return h.phone_safeguard ? `at its heat limit (${at}). The phone stops its local recording to cool down; the stream continues.`
    : `hot at ${at}. Stop its local recording to reduce heat; this phone's app has no automatic safeguard yet.`;
  return `getting warm at ${at}${h.minutes_to_stop != null ? `, about ${Math.max(1, Math.round(h.minutes_to_stop))} min from its ${h.stop_c} °C limit` : ''}. Improve airflow or keep it out of the sun.`;
}
// Where a camera's temperature is heading under what it is doing now, in a sentence or two.
const about = minutes => minutes >= 90 ? `about ${(minutes / 60).toFixed(1)} hours` : `about ${Math.max(1, Math.round(minutes))} min`;
function heatOutlook(camera) {
  const h = camera.thermal, p = h?.projection;
  if (!p || !camera.online || h.temperature_c == null) return null;
  const doing = { idle: 'idle', stream: 'streaming', record: 'recording', both: 'streaming and recording' }[p.load] || p.load;
  let text, concern = false;
  if (p.method === 'learned') {
    if (p.minutes_to_stop == null) text = `While ${doing} it should level off near ${p.levels_off_c} °C, below its ${h.stop_c} °C limit: fine for a ${p.show_minutes}-minute show.`;
    else if (p.minutes_to_stop > 0) {
      concern = !p.lasts_show;
      text = `While ${doing} it is heading for ${p.levels_off_c} °C: ${about(p.minutes_to_stop)} until its ${h.stop_c} °C limit${p.minutes_to_danger ? `, ${about(p.minutes_to_danger)} until ${h.danger_c} °C` : ''}. ${p.lasts_show ? `That is longer than a ${p.show_minutes}-minute show.` : `It will not last a ${p.show_minutes}-minute show at this load.`}`;
    }
  } else if (p.method === 'trend' && p.minutes_to_stop > 0) {
    concern = !p.lasts_show;
    text = `Rising: at this pace ${about(p.minutes_to_stop)} until its ${h.stop_c} °C limit. This is a rough estimate from the last few minutes; phones usually slow down as they warm.`;
  } else if (p.method === 'steady') text = `Holding steady while ${doing}.`;
  else if (!p.method) text = 'Heat projection needs a few more minutes of readings.';
  // Worth saying only when a rest is likely to be needed: it is heading for its limit, or already warm.
  if (p.rest_minutes && (p.lasts_show === false || h.level !== 'ok')) text = `${text ? text + ' ' : ''}${p.rest_from_c > h.temperature_c ? 'Once at its limit, a rest of' : 'A rest of'} ${about(p.rest_minutes)} idle would bring it back to ${p.rest_to_c} °C.`;
  return text ? { text, concern } : null;
}
function heatPanel(camera) {
  const h = heatOf(camera);
  if (!h || h.temperature_c == null) return null;
  const box = node('div', ''); box.className = `heat ${h.level}`;
  // Green below the warning temperature, amber up to the recording limit, red beyond.
  const meter = document.createElement('meter'); meter.min = 20; meter.max = 60; meter.low = h.warn_c; meter.high = h.stop_c; meter.optimum = 25;
  meter.value = Math.max(20, Math.min(60, h.temperature_c));
  let reading = `Temperature ${h.temperature_c.toFixed(1)} °C`;
  if (!camera.online) reading += ' when last heard from';
  else if (h.trend_c_per_minute != null) reading += Math.abs(h.trend_c_per_minute) < 0.1 ? ' · steady' : ` · ${h.trend_c_per_minute > 0 ? 'rising' : 'falling'} ${Math.abs(h.trend_c_per_minute).toFixed(1)} °C/min`;
  if (h.peak_c != null && h.peak_c > h.temperature_c + 0.5) reading += ` · peak ${h.peak_c.toFixed(1)} °C`;
  box.append(meter, node('span', reading));
  const message = heatMessage(camera);
  if (message) { const line = node('p', message[0].toUpperCase() + message.slice(1)); line.className = 'recording-warning'; box.append(line); }
  // A battery charged to full adds heat: said beside a heat warning when this phone's charge is not limited.
  if (message && camera.online && h.battery_limited === false && h.battery_note) { const line = node('p', h.battery_note[0].toUpperCase() + h.battery_note.slice(1) + '.'); line.className = 'recording-warning'; box.append(line); }
  const outlook = heatOutlook(camera);
  if (outlook) { const line = node('p', outlook.text); if (outlook.concern) line.className = 'recording-warning'; box.append(line); }
  box.append(node('small', `Warning from ${h.warn_c} °C · local recording stops at ${h.stop_c} °C${h.phone_safeguard ? '' : ' once this phone has app 0.7.5'}`));
  return box;
}
// Starts the update on one camera and waits for it to come back on the new version.
// Stops its stream and recording first when asked to. Returns null on success, else why it failed.
async function updateCamera(camera, release, stopCapture) {
  const t = camera.telemetry || {};
  const steps = [];
  if (stopCapture && (t.streaming || t.capture?.streamRequested)) steps.push(['Stop SRT', 'stream.stop']);
  if (stopCapture && t.recording) steps.push(['Finalize local MP4', 'recording.stop']);
  steps.push(['Start update', 'app.update']);
  busy.add(camera.id);
  try {
    for (const [name, command] of steps) {
      activity.set(camera.id, { label: `Update to ${release.version_name} — ${name}`, started: Date.now(), state: 'RUNNING' }); paintActivity();
      const outcome = await api(`/api/cameras/${encodeURIComponent(camera.id)}/commands`, { method: 'POST', body: JSON.stringify({ request_id: crypto.randomUUID(), command, parameters: {} }) });
      if (outcome.state !== 'SUCCEEDED') throw new Error(`${name}: ${outcome.state}${outcome.result?.error ? ` — ${outcome.result.error}` : ''}`);
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    activity.set(camera.id, { label: `Update to ${release.version_name} — installing, waiting for the camera to return`, started: Date.now(), state: 'RUNNING' }); paintActivity();
    const deadline = Date.now() + 300000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const now = (await api('/api/cameras')).cameras.find(c => c.id === camera.id);
      if (now?.online && now.app?.version_code >= release.version_code) { activity.set(camera.id, { label: `Update to ${release.version_name}`, state: 'SUCCEEDED', finished: Date.now() }); return null; }
      if (now?.app?.status?.startsWith('Update failed')) throw new Error(now.app.status);
    }
    throw new Error('the camera did not come back on the new version within five minutes');
  } catch (error) {
    activity.set(camera.id, { label: `Update to ${release.version_name}`, state: 'FAILED', error: error.message, finished: Date.now() });
    return error.message;
  } finally { busy.delete(camera.id); refresh(); }
}
let updatingAll = false;
// Actions that apply to every camera at once. Each lists exactly which cameras it will touch
// and which it will leave alone, and does nothing until the operator accepts.
let fleetBusy = false, fleetNote = '', coolerJob = null;
const armedNow = c => c.online && c.telemetry?.armed === true;
const streamingNow = c => !!(c.telemetry?.streaming || c.telemetry?.capture?.streamRequested);
// Only a phone still on app 0.7.6 that was armed on its own screen starts a recording along with its stream.
const recordsWithStream = c => !c.telemetry?.capabilities?.explicit_recording && c.telemetry?.armed === true && c.telemetry?.capture?.localRecordingWanted !== false && !c.telemetry?.recording;
const FLEET = [
  { label: 'Arm All Devices', command: 'camera.arm', step: 'arming', did: 'armed',
    // Arming never switches recording on. Phones on app 0.7.6 need to be told; 0.7.7 and later never record unasked.
    parameters: c => c.telemetry?.capabilities?.stream_only_arm ? { local_recording: false } : {},
    lead: n => `Arm ${n} camera${n === 1 ? '' : 's'}?`, tail: 'Arming leaves a camera idle. Streaming and local recording are separate steps; neither starts by itself.',
    targets: c => c.online && c.telemetry?.armed === false && c.telemetry?.capabilities?.device_owner,
    skipped: c => !c.online ? (c.telemetry?.armed ? null : 'offline') : c.telemetry?.armed === false && !c.telemetry?.capabilities?.device_owner ? 'not device owner, so it must be armed on the phone' : null },
  { label: 'Start All Streams', command: 'stream.start', step: 'starting SRT', did: 'started streaming on', preflight: true,
    lead: n => `Start the stream on ${n} camera${n === 1 ? '' : 's'}?`, tail: 'Each needs its OBS input listening. Starting a stream does not start local recording, except on a camera marked with a warning above.',
    targets: c => armedNow(c) && !streamingNow(c),
    detail: c => recordsWithStream(c) ? 'WARNING: this one WILL ALSO START RECORDING; press Arm on its card first to turn that off' : null,
    skipped: c => !c.online ? 'offline' : c.telemetry?.armed === false ? 'not armed' : null },
  { label: 'Stop All Streams', command: 'stream.stop', step: 'stopping SRT', did: 'stopped streaming on', danger: true,
    lead: n => `Stop the stream on ${n} camera${n === 1 ? '' : 's'}?`, tail: 'Their pictures will stop in OBS. Local recordings keep running.',
    targets: c => c.online && streamingNow(c),
    skipped: c => !c.online && streamingNow(c) ? 'offline; was streaming when last heard from' : null },
  { label: 'Start All Recordings', command: 'recording.start', step: 'starting local MP4', did: 'started recording on', preflight: true,
    lead: n => `Start local recording on ${n} camera${n === 1 ? '' : 's'}?`, tail: 'Recording and streaming together runs two encoders and makes phones hotter.',
    targets: c => armedNow(c) && !c.telemetry?.recording,
    skipped: c => !c.online ? 'offline' : c.telemetry?.armed === false ? 'not armed' : null },
  { label: 'Stop All Recordings', command: 'recording.stop', step: 'finalizing local MP4', did: 'stopped recording on', danger: true,
    lead: n => `Stop local recording on ${n} camera${n === 1 ? '' : 's'}?`, tail: 'Each file is finalized. Streams to OBS keep running.',
    targets: c => c.online && !!c.telemetry?.recording,
    skipped: c => !c.online && c.telemetry?.recording ? 'offline; was recording when last heard from' : null },
  { label: 'Disarm All Devices', command: 'camera.disarm', step: 'disarming', did: 'disarmed', danger: true,
    lead: n => `Disarm ${n} camera${n === 1 ? '' : 's'}?`, tail: 'Disarming stops the capture service: any stream stops and any local recording is finalized. Unarmed cameras can take app updates. A camera that is not device owner must be armed again on the phone.',
    targets: c => armedNow(c),
    detail: c => [streamingNow(c) ? 'streaming' : null, c.telemetry?.recording ? 'RECORDING' : null, c.telemetry?.capabilities?.device_owner ? null : 'cannot be re-armed from here'].filter(Boolean).join(', ') || null,
    skipped: c => !c.online && c.telemetry?.armed ? 'offline; was armed when last heard from' : null },
];
// A camera not used at this location is set aside, kept paired; one no longer wanted at all is removed (administrator).
function asideButton(camera) {
  const inUse = camera.in_use !== false;
  const button = node('button', inUse ? 'Not used here' : 'Use here');
  button.title = inUse ? 'Keep it paired, but leave it out of the shows at this location' : 'Use this camera at this location again';
  button.onclick = async () => {
    if (inUse && !await concert.sure(`Set ${camera.name} aside at this location?\n\nIt stays paired and keeps its settings, but the director never chooses it, “Start All” leaves it out, no OBS scenes are made for it and it is not checked for readiness. If it connects it is shown under “Not in use here”, and nothing more. Each location keeps its own cameras set aside: switching location brings back that location's.`)) return;
    try { await api(`/api/cameras/${encodeURIComponent(camera.id)}/in-use`, { method: 'POST', body: JSON.stringify({ in_use: !inUse }) }); } catch (error) { result.textContent = error.message; }
    refresh();
  };
  return button;
}
/** Coolers or gimbals other cameras have, each with Move here: that phone lets it go, and this one takes it. */
function moveHere(camera, kind, paired) {
  const word = kind === 'cooler' ? 'cooler' : 'gimbal';
  const others = paired.filter(other => other.id !== camera.id && other[kind]?.address);
  if (!others.length) return null;
  const list = node('ul', '');
  for (const other of others) {
    const item = node('li', `${other[kind].name || word} on ${other.name}${other[kind].connected ? '' : ' (not connected there)'} `);
    const move = node('button', 'Move here'); move.disabled = !camera.online || busy.has(camera.id);
    move.onclick = async () => {
      if (!await concert.sure(`Move the ${word} from ${other.name} to ${camera.name}?\n\n${other.name} lets it go${other.online ? '' : ' when it is next connected'}, and ${camera.name} connects to it. Put it on ${camera.name} first.`, { ok: 'Move here' })) return;
      try { const done = await api(`/api/cameras/${encodeURIComponent(camera.id)}/accessory`, { method: 'POST', body: JSON.stringify({ kind, from: other.id }) }); result.textContent = done.state === 'SUCCEEDED' ? `${camera.name} has the ${word} now.` : JSON.stringify(done, null, 2); }
      catch (error) { result.textContent = error.message; }
      refresh();
    };
    item.append(move); list.append(item);
  }
  const box = node('div', ''); box.append(node('small', `Or move one here from another camera:`), list);
  return box;
}
function renameButton(camera) {
  const button = node('button', 'Rename…'); button.disabled = busy.has(camera.id);
  button.title = 'Change this camera\'s name here and in OBS: its source, its scene and its split screens.';
  button.onclick = async () => {
    const got = await concert.ask({ title: `Rename ${camera.name}`, text: 'It keeps its slot, its settings and its place in OBS. Its OBS source and scenes take the new name too, and a default shot naming one of them follows; the programme stays on air. Recordings already on this computer stay in its old folder; new ones go in a folder with the new name.',
      fields: [{ name: 'name', label: 'New name', value: camera.name }], ok: 'Rename' });
    if (!got || got.name.trim() === camera.name) return;
    try { const done = await api(`/api/cameras/${encodeURIComponent(camera.id)}/name`, { method: 'POST', body: JSON.stringify({ name: got.name }) }); result.textContent = `${done.was} is now ${done.name}.` + inObs(done.obs); }
    catch (error) { result.textContent = error.message; }
    refresh();
  };
  return button;
}
function removeButton(camera) {
  const t = camera.telemetry || {}, capturing = camera.online && (t.streaming || t.recording || t.capture?.streamRequested);
  const button = node('button', 'Remove camera…'); button.className = 'danger';
  button.disabled = !!capturing || busy.has(camera.id);
  button.title = capturing ? 'Stop its stream and local recording first' : 'Unpair it for good';
  button.onclick = async () => {
    if (!await concert.sure(`Remove ${camera.name} (slot ${camera.slot}) for good?\n\nIt is unpaired: its credential stops working, so the phone can no longer connect${camera.online ? ' (it is disconnected now)' : ''}, and its slot is free. What is set for it here is cleared: what it shows, its place on the stage picture, its microphone, telephoto, decoding and colour. Its recordings stay, and a restore point is kept (System › Locations & backups).\n\nTo use the phone again it must be paired again. To keep it for another time, use “Not used here” instead.`)) return;
    try { const done = await api(`/api/cameras/${encodeURIComponent(camera.id)}`, { method: 'DELETE' }); result.textContent = `Removed ${done.removed}: slot ${done.slot} is free.`; } catch (error) { result.textContent = error.message; }
    refresh();
  };
  return button;
}
async function fleetAction(action, cameras) {
  // Before anything starts: set the clocks, then show each camera's readiness in the prompt.
  if (action.preflight && cameras.some(action.targets)) cameras = await preflight(cameras);
  const targets = cameras.filter(action.targets);
  const left = cameras.filter(c => !action.targets(c)).map(c => [c, action.skipped(c)]).filter(([, why]) => why);
  if (!targets.length) return;
  let question = `${action.lead(targets.length)}\n\n${targets.map(c => `  • ${c.name}${action.detail && action.detail(c) ? ` (${action.detail(c)})` : ''}${action.preflight && c.readiness ? (problems(c) ? `\n      ${c.readiness.overall === 'fail' ? 'NOT READY' : 'check'}: ${problems(c)}` : ' — ready') : ''}`).join('\n')}\n\n${action.tail}`;
  if (left.length) question += `\n\nNOT included:\n${left.map(([c, why]) => `  • ${c.name} (${why})`).join('\n')}`;
  if (!await concert.sure(question)) return;
  fleetBusy = true; fleetNote = ''; refresh();
  const done = [], failed = [];
  // Started a third of a second apart (the manager limits how fast commands arrive), then awaited together.
  await Promise.all(targets.map(async (camera, index) => {
    await new Promise(resolve => setTimeout(resolve, index * 350));
    if (busy.has(camera.id)) { failed.push(`${camera.name}: busy with another command`); return; }
    busy.add(camera.id);
    activity.set(camera.id, { label: `${action.label} — ${action.step}`, started: Date.now(), state: 'RUNNING' }); paintActivity();
    try {
      const outcome = await api(`/api/cameras/${encodeURIComponent(camera.id)}/commands`, { method: 'POST', body: JSON.stringify({ request_id: crypto.randomUUID(), command: action.command, parameters: action.parameters ? action.parameters(camera) : {} }) });
      if (outcome.state !== 'SUCCEEDED') throw new Error(`${outcome.state}${outcome.result?.error ? ` — ${outcome.result.error}` : ''}`);
      activity.set(camera.id, { label: action.label, state: 'SUCCEEDED', finished: Date.now() }); done.push(camera.name);
    } catch (error) {
      activity.set(camera.id, { label: action.label, state: 'FAILED', error: error.message, finished: Date.now() }); failed.push(`${camera.name}: ${error.message}`);
    } finally { busy.delete(camera.id); }
  }));
  fleetBusy = false;
  fleetNote = `${new Date().toLocaleTimeString()} ${action.label}: ${action.did} ${done.length ? done.join(', ') : 'no cameras'}.${failed.length ? ` FAILED: ${failed.join('; ')}.` : ''}${left.length ? ` Not included: ${left.map(([c, why]) => `${c.name} (${why})`).join('; ')}.` : ''}`;
  result.textContent = fleetNote;
  refresh(); settle();
}
// Pre-flight: one line per camera saying whether it is ready, then anything that is not right.
const notRight = camera => (camera.readiness?.checks || []).filter(check => check.status !== 'ok');
const problems = camera => notRight(camera).map(check => `${check.label}: ${check.detail}`).join('; ');
function readinessPanel(camera) {
  const report = camera.readiness;
  if (!report) return null;
  const box = node('div', ''); box.className = `readiness ${report.overall}`;
  const issues = notRight(camera);
  box.append(node('strong', report.overall === 'ok' ? 'Ready' : report.overall === 'warn' ? `Ready, with ${issues.length} thing${issues.length === 1 ? '' : 's'} to check` : 'Not ready'));
  if (report.overall === 'ok') box.append(node('span', ` · ${report.checks.map(check => check.label.toLowerCase()).join(', ')} all good`));
  for (const check of issues) {
    const line = node('p', `${check.status === 'fail' ? '✖' : '!'} ${check.label}: ${check.detail}`); line.className = check.status; box.append(line);
    if (check.id === 'clock') { const fix = clockFix(camera); if (fix) box.append(fix); }
  }
  // A clock repair just finished: say how it went for a minute, though the warning it fixed has gone.
  const done = camera.clock_fix;
  if (done && done.state !== 'RUNNING' && !issues.some(check => check.id === 'clock') && Date.now() / 1000 - done.at < 60)
    box.append(node('p', done.state === 'SUCCEEDED' ? `✔ Clock set${done.detail ? ` (${done.detail})` : ''}; back in the choosing` : `✖ Clock not set: ${done.detail}`));
  return box;
}
// The clock warning's Fix button: the manager takes the camera off air, stops its stream, sets its clock, starts it
// again and puts it back in the choosing once it is in sync (server.fix_clock). Its progress shows in place of the button.
function clockFix(camera) {
  const fix = camera.clock_fix;
  if (fix && fix.state === 'RUNNING') {
    const line = node('p', `⟳ Fixing the clock: ${fix.step}${fix.detail ? ` · ${fix.detail}` : ''}`); line.className = 'activity'; return line;
  }
  if (!camera.online || !camera.telemetry?.capabilities?.time_sync) return null;
  const row = node('div', ''); row.className = 'fix';
  if (fix && fix.state === 'FAILED' && Date.now() / 1000 - fix.at < 300) row.append(node('small', `Last try failed: ${fix.detail} `));
  const button = node('button', 'Fix'); button.title = 'Take this camera off air, set its clock, and bring it back once it is in sync';
  button.onclick = async () => {
    button.disabled = true;
    try { await api(`/api/cameras/${encodeURIComponent(camera.id)}/fix-clock`, { method: 'POST' }); }
    catch (error) { concert.tell(`${camera.name}: ${error.message}`); }
    refresh();
  };
  row.prepend(button); return row;
}
// Sets each phone's clock from this computer where it is off, then returns the cameras as they are afterwards.
async function syncClocks(cameras, note) {
  const off = cameras.filter(c => c.online && c.telemetry?.capabilities?.time_sync && typeof c.clock_offset_ms === 'number' && Math.abs(c.clock_offset_ms) > 20 && !busy.has(c.id));
  if (!off.length) return { cameras, synced: [], failed: [] };
  const synced = [], failed = [];
  await Promise.all(off.map(async (camera, index) => {
    await new Promise(resolve => setTimeout(resolve, index * 350));
    busy.add(camera.id);
    activity.set(camera.id, { label: 'Sync clock', started: Date.now(), state: 'RUNNING' }); paintActivity();
    try {
      const outcome = await api(`/api/cameras/${encodeURIComponent(camera.id)}/commands`, { method: 'POST', body: JSON.stringify({ request_id: crypto.randomUUID(), command: 'time.sync', parameters: {} }) });
      if (outcome.state !== 'SUCCEEDED') throw new Error(`${outcome.state}${outcome.result?.error ? ` — ${outcome.result.error}` : ''}`);
      activity.set(camera.id, { label: `Sync clock (moved ${Math.round(camera.clock_offset_ms)} ms)`, state: 'SUCCEEDED', finished: Date.now() }); synced.push(camera.name);
    } catch (error) {
      activity.set(camera.id, { label: 'Sync clock', state: 'FAILED', error: error.message, finished: Date.now() }); failed.push(`${camera.name}: ${error.message}`);
    } finally { busy.delete(camera.id); }
  }));
  // The manager needs a few fresh readings to measure the clocks again.
  if (note) note('Clocks set; measuring again…');
  await new Promise(resolve => setTimeout(resolve, 7000));
  return { cameras: (await api('/api/cameras')).cameras, synced, failed };
}
async function preflight(cameras) {
  fleetBusy = true; fleetNote = 'Pre-flight: checking clocks…'; refresh();
  const outcome = await syncClocks(cameras, text => { fleetNote = `Pre-flight: ${text}`; refresh(); });
  fleetBusy = false; fleetNote = '';
  refresh();
  return outcome.cameras;
}
// How one camera's app version compares with the published release: text plus whether it is a mismatch.
function versionOf(camera, release) {
  const app = camera.app || {};
  const name = app.version_name || 'not reported (older than 0.7.6)';
  if (!release) return { text: name, mismatch: false };
  if (app.version_code == null) return { text: `${name} — cannot be compared with the published ${release.version_name}`, mismatch: true };
  if (app.version_code < release.version_code) return { text: `${name} — older than the published ${release.version_name}`, mismatch: true };
  if (app.version_code > release.version_code) return { text: `${name} — newer than the published ${release.version_name}`, mismatch: true };
  return { text: `${name} — matches the published release`, mismatch: false };
}
function bytes(value) {
  return Number.isFinite(value) ? `${(value / 1073741824).toFixed(1)} GiB` : 'unavailable';
}
function duration(seconds) {
  if (!Number.isFinite(seconds)) return 'unavailable';
  const minutes = Math.floor(seconds / 60);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
document.querySelector('#capacity-form').onsubmit = async event => {
  event.preventDefault();
  try {
    await api('/api/settings/camera-capacity', { method: 'POST', body: JSON.stringify({camera_capacity: Number(document.querySelector('#camera-capacity').value)}) });
    result.textContent = 'Camera capacity saved. Existing pairings preserved.';
    await refresh();
  } catch (error) { result.textContent = error.message; }
};
// A panel is left alone only while someone is typing in it or has a list open, so their entry is not wiped by the
// two-second redraw. A button or tick box that was just clicked keeps the keyboard focus, and used to freeze its whole
// panel the same way: the new state (armed, recording, switched on) did not show until the page was reloaded.
// A phone reports its new state a second or two after it is told to do something. Looking again shortly after an
// action shows that state without waiting for the next regular redraw.
function settle() { for (const wait of [700, 1800, 3500]) setTimeout(refresh, wait); }
// What the operator has picked in the "how the phones find this manager" list but not yet confirmed. The panel is
// redrawn every two seconds from what the manager says; without this the list snapped back before "Use this" could be pressed.
let networkPicked = null;
// An operator password just made, shown until the page is reloaded: the manager cannot show it again.
let operatorShown = '';
let githubApp = null, githubBusy = false;   // the last look at GitHub for a newer camera app, and whether one is under way
// Why the last request about the manager's own version was refused, shown in its panel.
let updateSaid = '';
// The look-ahead just asked for, until the cameras have reached it.
let holdAsked = 0;
// What the last thing asked of a location came to, shown on its page.
let placeSaid = '';
// The band profile picked in the list, and what the last thing asked of one came to.
let bandPicked = '', bandSaid = '';
// Whether the list of things worth a look is open under the readiness line.
let readyOpen = false;
let relayAdvancedOpen = false;     // the camera relay's Troubleshooting fold, kept open across refreshes
// Making in OBS what the cameras need: a listening source for each, its scene and its split screens.
let scenesSaid = '';
async function refreshScenes(button) {
  button.disabled = true; scenesSaid = 'Looking at OBS…'; refresh();
  try {
    const done = await api('/api/obs/scenes', { method: 'POST', body: '{}' });
    const parts = [];
    if (done.sources_made.length) parts.push(`made a source for ${done.sources_made.join(', ')}`);
    if (done.scenes_made.length) parts.push(`made ${done.scenes_made.length} scene${done.scenes_made.length === 1 ? '' : 's'}`);
    scenesSaid = `${new Date().toLocaleTimeString()} OBS: ${parts.length ? parts.join(' and ') : `nothing missing for the ${done.cameras} cameras`}.`
      + (done.unused.length ? ` Sources with no camera on their port, left as they are: ${done.unused.join(', ')}.` : '')
      + (done.sources_made.length ? ' A new source shows its picture once that camera is streaming.' : '');
  } catch (error) { scenesSaid = `Could not refresh OBS scenes: ${error.message}`; }
  button.disabled = false; refresh();
}
// What renaming did in OBS (scenes.rename), in a sentence; '' when there was nothing to rename.
function inObs(obs) {
  if (!obs) return '';
  if (obs.error) return ` OBS was not changed (${obs.error}): press Refresh names in OBS once it is running.`;
  const sources = Object.keys(obs.sources || {}).length, scenes = Object.keys(obs.scenes || {}).length;
  return (sources ? ` In OBS: ${sources} source${sources === 1 ? '' : 's'} and ${scenes} scene${scenes === 1 ? '' : 's'} renamed.` : '')
    + (obs.skipped || []).map(left => ` ${left.camera} left as it is in OBS: ${left.why}.`).join('');
}
async function refreshNames(button) {
  button.disabled = true; scenesSaid = 'Looking at OBS…'; refresh();
  try {
    const done = await api('/api/obs/names', { method: 'POST', body: '{}' });
    scenesSaid = `${new Date().toLocaleTimeString()}` + (inObs(done) || ' OBS: every camera\'s source already has its name.');
  } catch (error) { scenesSaid = `Could not refresh names in OBS: ${error.message}`; }
  button.disabled = false; refresh();
}
function namesButton() {
  const button = node('button', 'Refresh names in OBS');
  button.title = 'Gives each camera\'s OBS source the camera\'s name here, and its full-screen scene, split screens and face blur scenes the names that go with it. Their contents are not changed, and the programme stays on air.';
  button.onclick = () => refreshNames(button);
  return button;
}
function scenesButton() {
  const button = node('button', 'Refresh OBS scenes');
  button.title = 'Makes in OBS what the cameras need and it does not have: a listening source for each camera, its full-screen scene and its split screens. Nothing is changed or removed.';
  button.onclick = () => refreshScenes(button);
  return button;
}
function editing(panel) {
  const active = document.activeElement;
  return !!active && panel.contains(active) && active.matches('input:not([type=checkbox]):not([type=radio]), select, textarea');
}
// A list or tick box has done its job once it changes; letting go of it lets its panel show the result.
document.addEventListener('change', event => { if (event.target.matches?.('select, input[type=checkbox], input[type=radio]')) event.target.blur(); });
// The dashboard's words for the kind of event in use (modes.UI): live music's until the manager has said otherwise.
const words = () => window.concert.mode?.words || { profile: 'band', role: 'instrument', roles: 'instruments', anyone: 'anyone performing', crowd: 'crowd', example: 'banjo, harmonica, pedal steel', performer: 'performer' };
const capital = text => text.charAt(0).toUpperCase() + text.slice(1);
// A new kind of event changes what each camera can be given: shown at once.
document.addEventListener('event-mode', () => { if (csrf) { if (part === '/recipe' && window.concert.mode?.mode !== 'cooking') show('/'); else refresh(); } });
// S marks the next recipe step while the programme records (the button is there only then), unless typing somewhere.
document.addEventListener('keydown', event => {
  if (event.key.toLowerCase() !== 's' || event.metaKey || event.ctrlKey || event.altKey || event.repeat || event.target.closest?.('input, textarea, select, [contenteditable], dialog')) return;
  const mark = document.querySelector('#mark-step'); if (!mark || mark.closest('[hidden]')) return;
  event.preventDefault(); mark.click();
});

async function refresh() {
  try {
    const answer = await api('/api/cameras'); window.concert.feed(answer);
    const { cameras: paired, camera_capacity = 5, release, app_auto_update, battery_protect, phone_silence, sync, show_minutes, director, manager_version, away = false, ready, clocks_set_automatically } = answer;
    // The cameras in use at this location; those set aside are left out of everything but their own short list.
    const cameras = paired.filter(c => c.in_use !== false), aside = paired.filter(c => c.in_use === false);
    // Show length, and which cameras are not expected to last it at their present load.
    const heatPlan = document.querySelector('#heat-plan');
    if (show_minutes !== undefined && !editing(heatPlan)) {
      heatPlan.replaceChildren(node('h2', 'Show plan'));
      const length = document.createElement('input'); length.type = 'number'; length.min = 5; length.max = 720; length.value = show_minutes; length.size = 4;
      const set = node('button', 'Set'); set.onclick = async () => { try { await api('/api/settings/show-minutes', { method: 'POST', body: JSON.stringify({ minutes: Number(length.value) }) }); } catch (error) { result.textContent = error.message; } length.blur(); refresh(); };
      const row = node('label', 'Show length in minutes (used for heat projections) '); row.append(length, set); heatPlan.append(row);
      const short = cameras.filter(c => c.online && c.thermal?.projection?.lasts_show === false);
      const known = cameras.filter(c => c.online && ['learned', 'trend'].includes(c.thermal?.projection?.method));
      const line = node('p', short.length ? `Heat outlook: ${short.map(c => `${c.name} reaches its limit in ${about(c.thermal.projection.minutes_to_stop)}`).join('; ')}. Give ${short.length === 1 ? 'it' : 'them'} a lighter load, more airflow, or a planned rest.`
        : known.length ? `Heat outlook: every camera with a projection is expected to last a ${show_minutes}-minute show at its present load.` : 'Heat outlook: projections appear after a few minutes of readings.');
      if (short.length) line.className = 'recording-warning'; heatPlan.append(line);
    }
    // The programme: which camera is on air, who is choosing, and recording the result to a file.
    const program = document.querySelector('#program');
    const settings = document.querySelector('#director-settings');
    if (director && !editing(program) && !editing(settings)) {
      program.replaceChildren(); settings.replaceChildren(node('h2', 'How shots are chosen'));
      // At No AI (AI assistance, ai.py) there is no model: what needs one is left off, and the page says so.
      const aiOff = director.ai_tier === 'none';
      const named = identifier => cameras.find(c => c.id === identifier)?.name || identifier;
      const direct = async body => { try { await api('/api/director', { method: 'POST', body: JSON.stringify(body) }); } catch (error) { result.textContent = error.message; } refresh(); settle(); };
      const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
      const nowSeconds = Date.now() / 1000;
      program.append(node('h2', 'Programme'));
      const said = concert.programme(director);
      const air = node('p', director.problem ? `Programme control is not working: ${director.problem}`
        : `${said.word}: ${director.pair ? `split screen, ${director.pair.map(named).join(' and ')}` : director.on_air ? named(director.on_air) : director.scene ? `scene “${director.scene}”` : 'unknown'}${said.suffix}${director.since ? ` for ${clock(Math.max(0, nowSeconds - director.since))}` : ''}`
          + (director.enabled ? (director.hold_until ? ` · your choice is held for ${Math.max(0, Math.round(director.hold_until - nowSeconds))} s more` : director.ai?.enabled ? ' · the model is watching and cuts when another camera rates clearly better' : director.next_cut_at ? ` · next cut in about ${Math.max(0, Math.round(director.next_cut_at - nowSeconds))} s` : director.usable.length < 2 ? ' · fewer than two usable cameras, so nothing to cut to' : '') : ''));
      if (director.problem || said.blank) air.className = 'recording-warning';
      program.append(air);
      const cutRow = node('p', 'Put on air: ');
      for (const camera of cameras) {
        const usable = director.usable.includes(camera.id);
        const button = node('button', camera.name); button.disabled = !usable || director.on_air === camera.id;
        button.title = director.on_air === camera.id ? 'On air now' : usable ? `Cut to ${camera.name}` : 'Not usable right now: offline, not streaming, or no picture in OBS (or no “Cam” scene for it)';
        button.onclick = () => direct({ take: camera.id }); cutRow.append(button);
      }
      program.append(cutRow);
      const splitNames = Object.keys(director.splits || {});
      if (splitNames.length) {
        const splitRow = node('p', 'Split screen: ');
        for (const scene of splitNames) {
          const members = director.splits[scene], usable = members.every(identifier => director.usable.includes(identifier));
          const button = node('button', members.map(named).join(' + ')); button.disabled = !usable || director.scene === scene;
          button.title = director.scene === scene ? 'On air now' : usable ? `Show ${members.map(named).join(' and ')} side by side` : 'One of these cameras is not usable right now';
          button.onclick = () => direct({ take: scene }); splitRow.append(button);
        }
        program.append(splitRow);
      }
      const label = node('label', ''); const box = document.createElement('input'); box.type = 'checkbox'; box.checked = director.enabled;
      box.onchange = () => direct({ enabled: box.checked });
      label.append(box, node('span', ` Choose shots automatically (only the model changes the shot: a camera stays on air for as long as it is rated best${director.max_stay_seconds ? `, up to ${director.max_stay_seconds} s` : ''}. Never shows a camera with no picture)`)); program.append(label);
      const fallback = node('label', 'Default shot, used when the model is not answering or the camera on air loses its picture ');
      const pick = document.createElement('select');
      for (const [value, text] of [['', 'none: stay on the current shot'], ...(director.scenes || []).map(scene => [scene, scene])]) { const option = document.createElement('option'); option.value = value; option.textContent = text; option.selected = (director.default_shot || '') === value; pick.append(option); }
      pick.onchange = () => direct({ default_shot: pick.value || null });
      fallback.append(pick); settings.append(fallback);
      if (director.default_shot && !(director.scenes || []).includes(director.default_shot)) { const gone = node('p', `The default shot “${director.default_shot}” is not a scene in OBS any more, so there is no fallback.`); gone.className = 'recording-warning'; settings.append(gone); }
      const aiFrom = settings.children.length;
      const zoom = node('label', ''); const zoomBox = document.createElement('input'); zoomBox.type = 'checkbox'; zoomBox.checked = director.zoom; zoomBox.disabled = !director.ai?.enabled;
      zoomBox.onchange = () => direct({ zoom: zoomBox.checked });
      zoom.append(zoomBox, node('span', ` Let the model zoom in on the performer${director.zoom && director.zoomed > 1 ? ` · on air at ${director.zoomed}×${director.on_air && director.lenses?.[director.on_air]?.lens?.startsWith('telephoto') ? ' through the telephoto' : ''}` : ''}`)); settings.append(zoom);
      // How far it may go: never fewer than this many rows of the camera's real picture, so the picture stays sharp.
      const least = Number(director.zoom_least_height) || 720;
      const leastRow = node('label', 'Never showing less than ');
      const leastPick = document.createElement('select'); leastPick.disabled = !director.zoom; leastPick.setAttribute('aria-label', 'Least of the camera’s picture a zoom shows');
      for (const rows of [720, 1080, 1440]) { const option = document.createElement('option'); option.value = rows; option.textContent = `${rows}p`; option.selected = rows === least; leastPick.append(option); }
      leastPick.onchange = () => direct({ zoom_least_height: Number(leastPick.value) });
      // What that allows from each size of camera (at most 3×; a zoom of less than about 1.1× is not made at all).
      const reach = rows => { const times = Math.min(3, (rows - Math.ceil(rows * 16 / 1080) - 2) / least);      // less the timing strip, as framing() does
        return times < 1.12 ? `none from ${rows === 2160 ? '4K' : `${rows}p`}` : `up to ${+times.toFixed(2)}× from ${rows === 2160 ? 'a 4K camera' : `${rows}p`}`; };
      leastRow.append(leastPick, node('span', ` of the camera’s real picture: ${[2160, 1440, 1080].map(reach).join(', ')}. Higher keeps the picture sharper and zooms less.`));
      settings.append(leastRow);
      const focus = node('label', 'Zoom in on ');
      const focusPick = document.createElement('select'); focusPick.disabled = !director.zoom;
      for (const [value, text] of [['person', 'the whole person (zooms least)'], ['waist', 'head to waist'], ['chest', 'head and chest'], ['face', 'the face (zooms most)'], ['chest_only', 'the chest'], ['hips', 'the waist and hips'], ['hands', 'the hands'], ['face_hands', 'the face and hands together']]) { const option = document.createElement('option'); option.value = value; option.textContent = text; option.selected = (director.zoom_focus || 'person') === value; focusPick.append(option); }
      focusPick.onchange = () => direct({ zoom_focus: focusPick.value });
      focus.append(focusPick); settings.append(focus);
      // Following the performer's eyes: the camera they look into goes on air. Scored on this computer from the phones' pictures.
      if (director.gaze) {
        const gaze = director.gaze, gazeRow = node('label', ''), gazeBox = document.createElement('input'); gazeBox.type = 'checkbox'; gazeBox.checked = gaze.enabled;
        gazeBox.onchange = () => direct({ gaze: gazeBox.checked });
        const looked = gaze.camera ? ` · looking at ${named(gaze.camera)}` : gaze.enabled && gaze.minutes != null ? ' · not looking at any camera: the other choices apply' : '';
        gazeRow.append(gazeBox, node('span', ` Cut to the camera the performer is looking at${gaze.enabled && gaze.problem ? ` · not working: ${gaze.problem}` : looked}`)); settings.append(gazeRow);
        const holdRow = node('label', 'Keep a shot the eyes chose at least ');
        const hold = document.createElement('input'); hold.type = 'number'; hold.min = 0.5; hold.max = 60; hold.step = 0.5; hold.value = director.gaze_min_hold_seconds; hold.disabled = !gaze.enabled; hold.setAttribute('aria-label', 'Least time on air for a shot chosen by gaze, seconds');
        const holdSet = node('button', 'Set'); holdSet.disabled = !gaze.enabled; holdSet.onclick = () => direct({ gaze_min_hold_seconds: Number(hold.value) });
        holdRow.append(hold, node('span', ' s, so a glance does not cut '), holdSet); settings.append(holdRow);
        if (gaze.enabled && gaze.minutes != null) {
          // How well the cut follows the eyes, over the last few minutes.
          const value = (v, unit, digits = 1) => v == null ? '–' : `${Number(v).toFixed(digits)}${unit}`;
          const scores = Object.entries(gaze.scores || {}).map(([id, s]) => `${named(id)} ${s.face ? Math.round(s.score * 100) + '%' : 'no face'}`).join(', ');
          settings.append(node('small', `Over the last ${gaze.minutes} min: a look every ${value(gaze.every_seconds, ' s', 2)} (each takes ${value(gaze.look_seconds, ' s', 2)}, scoring ${value(gaze.score_ms, ' ms')} a picture) · `
            + `look to cut ${value(gaze.react_seconds, ' s', 2)}${gaze.after_shown_seconds != null ? ` (${value(gaze.after_shown_seconds, ' s', 2)} after the programme showed the look)` : ''} · `
            + `${value(gaze.switches_per_minute, '', 2)} cuts a minute, the eyes moved to another camera ${value(gaze.changes_per_minute, '', 2)} times a minute, ${gaze.held_back} held back as glances · `
            + `looking at a camera ${gaze.looking_share == null ? '–' : Math.round(gaze.looking_share * 100) + '%'} of the time${scores ? ` · now: ${scores}` : ''}`));
        }
      }
      const crowd = node('label', `${capital(words().crowd)} camera `);
      const crowdPick = document.createElement('select');
      for (const [value, text] of [['', 'none'], ...cameras.map(c => [c.id, c.name])]) { const option = document.createElement('option'); option.value = value; option.textContent = text; option.selected = (director.crowd_camera || '') === value; crowdPick.append(option); }
      crowdPick.onchange = () => direct({ crowd_camera: crowdPick.value || null });
      const every = document.createElement('input'); every.type = 'number'; every.min = 5; every.max = 3600; every.value = director.crowd_every_seconds;
      const most = document.createElement('input'); most.type = 'number'; most.min = 2; most.max = 120; most.value = director.crowd_max_seconds;
      const crowdSet = node('button', 'Set'); crowdSet.onclick = () => direct({ crowd_every_seconds: Number(every.value), crowd_max_seconds: Number(most.value) });
      crowd.append(crowdPick, node('span', ` shown only when the ${words().crowd} is lively and ${director.event_mode?.speaking ? 'nobody is clearly the one to watch' : 'the stage is quiet'}, at most every `), every, node('span', ' s, for up to '), most, node('span', ' s '), crowdSet); settings.append(crowd);
      if (director.sound) {
        const sound = node('label', ''), soundBox = document.createElement('input'); soundBox.type = 'checkbox'; soundBox.checked = director.sound.enabled;
        soundBox.onchange = () => direct({ audio_cues: soundBox.checked });
        const heard = Object.entries(director.sound.heard || {}).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([key, level]) => `${(director.instruments || []).find(i => i[0] === key)?.[1] || key} ${Math.round(level * 100)}%`);
        sound.append(soundBox, node('span', ` ${words().listen ? words().listen : director.event_mode?.music === false ? `Listen to the room: laughter and applause favour the ${words().crowd} camera` : director.event_mode?.mode && director.event_mode.mode !== 'concert' ? 'Listen for which instrument or voice is to the fore, and favour its camera' : 'Listen for which instrument is to the fore, and favour its camera'}${director.sound.enabled ? (director.sound.problem ? ` · not listening: ${director.sound.problem}` : heard.length ? ` · hearing ${heard.join(', ')}` : ' · nothing clearly to the fore') : ''}${director.sound.solo ? ` · SOLO: ${(director.instruments || []).find(i => i[0] === director.sound.solo.instrument)?.[1] || director.sound.solo.instrument} for ${Math.round(director.sound.solo.seconds)} s` : ''}`)); settings.append(sound);
        // Not listening for want of something installable: the AI assistance panel has the steps, with buttons or commands.
        if (director.sound.enabled && director.sound.problem && role === 'admin') {
          const fix = node('button', 'Set up listening…');
          fix.onclick = () => { const panel = document.querySelector('#ai-setup'); panel?.querySelectorAll('details').forEach(d => { d.open = true; }); panel?.scrollIntoView({ block: 'start' }); };
          settings.append(fix);
        }
      }
      if (aiOff) {
        for (const element of [...settings.children].slice(aiFrom)) element.hidden = true;
        settings.append(node('p', 'AI assistance is off (No AI): shots are chosen by hand, on Stage Shots or by timed rotation, and the safety rules still cut away from a camera that breaks. The model, zoom, listening and following the performer’s eyes come with Standard or Plus AI: see AI assistance above.'));
      } else settings.append(node('small', `What each camera shows${director.event_mode?.music === false ? '' : ', and how it zooms during a solo,'} are set on the Cameras page.`));
      if (director.talk && director.event_mode?.speaking) {
        // Who is talking, from each person's own microphone on a mixer (talk.py): the cameras are given their channel on the Cameras page.
        const talk = director.talk, row = node('label', ''), box = document.createElement('input'); box.type = 'checkbox'; box.checked = talk.switched_on;
        box.onchange = () => direct({ talk: { enabled: box.checked } });
        const who = talk.speaking?.length ? ` · talking: ${talk.speaking.map(named).join(', ')}` : talk.crosstalk ? ' · several talking at once: the wide shot' : talk.enabled && !talk.problem ? ` · nobody talking for ${Math.round(talk.silent_seconds)} s` : '';
        const why = !talk.switched_on ? '' : !talk.device ? ' · give the mixer’s sound device below' : !Object.keys(talk.mics || {}).length ? ' · give each camera its microphone’s channel on the Cameras page' : talk.problem ? ` · not listening: ${talk.problem}` : '';
        row.append(box, node('span', ` Switch to whoever is talking, from each person’s microphone on the mixer${why}${who}`)); settings.append(row);
        const deviceRow = node('label', 'Mixer’s sound device '), device = document.createElement('input'); device.type = 'text'; device.size = 28; device.value = talk.device || ''; device.placeholder = 'for example RODECaster Pro II'; device.spellcheck = false;
        const deviceSet = node('button', 'Set'); deviceSet.onclick = () => direct({ talk: { device: device.value.trim() } });
        deviceRow.append(device, deviceSet); settings.append(deviceRow);
        const levels = Object.entries(talk.levels || {}).map(([channel, db]) => `${channel}: ${Math.round(db)} dB`).join(' · ');
        settings.append(node('small', `A mixer or audio interface that gives the computer each microphone on its own channel. Without one, the model rates whoever is visibly speaking${director.event_mode?.mode === 'worship' ? ', and in a service the sound of speech favours the pastor’s and readers’ cameras' : ''}.${levels ? ` Levels now: ${levels}.` : ''}`));
      }
      const turn = node('label', ''); const turnBox = document.createElement('input'); turnBox.type = 'checkbox'; turnBox.checked = director.rotate; turnBox.onchange = () => direct({ rotate: turnBox.checked });
      turn.append(turnBox, node('span', ` With no model choosing, rotate through the cameras by the clock (${director.min_shot_seconds}–${director.max_shot_seconds} s each)`)); settings.append(turn);
      const lengths = node('label', 'Shot length, seconds: shortest ');
      const shortest = document.createElement('input'); shortest.type = 'number'; shortest.min = 2; shortest.max = 600; shortest.value = director.min_shot_seconds;
      const longest = document.createElement('input'); longest.type = 'number'; longest.min = 2; longest.max = 600; longest.value = director.max_shot_seconds;
      const set = node('button', 'Set'); set.onclick = () => direct({ min_shot_seconds: Number(shortest.value), max_shot_seconds: Number(longest.value) });
      lengths.append(shortest, node('span', ' longest '), longest, set); settings.append(lengths);
      // With the model choosing, the longest length above does not apply: this does.
      const stayRow = node('label', 'With the model choosing, move on after at most ');
      const stay = document.createElement('input'); stay.type = 'number'; stay.min = 0; stay.max = 600; stay.value = director.max_stay_seconds || 0; stay.setAttribute('aria-label', 'Longest shot with the model, seconds');
      const staySet = node('button', 'Set'); staySet.onclick = () => direct({ max_stay_seconds: Number(stay.value) });
      stayRow.append(stay, node('span', ' s '), staySet);
      settings.append(stayRow, node('small', director.max_stay_seconds ? ` Then it cuts to the best other camera with a picture, unless the shot on air is the only one the model rates worth showing.` : ' 0: it stays on a shot until the model rates another clearly better, however long that takes.'));
      if (director.ai?.enabled && !director.cameras_told) { const untold = node('p', 'The model has not been told what any camera shows (Cameras page), so it rates them by your wishes alone and may find little worth cutting to.'); untold.className = 'recording-warning'; settings.append(untold); }
      const recording = director.recording;
      const record = node('button', recording ? 'Stop Recording Programme' : 'Record Programme To File'); if (recording) record.className = 'danger';
      record.onclick = async () => { if (!recording || await concert.sure('Stop recording the programme? The file is finished and checked.')) direct({ record: !recording }); };
      const recordRow = node('p', ''); recordRow.append(record, node('span', recording ? ` Recording: ${clock(recording.seconds)} · ${(recording.bytes / 1048576).toFixed(0)} MiB · ${recording.cuts} shot(s) logged` : ` Saves what OBS is showing into ${director.folder}`));
      if (recording) recordRow.className = 'activity running'; program.append(recordRow);
      if (recording && words().step && !director.recipe) {        // with a recipe loaded, its own Next step does this (recipe.js)
        // A step of the recipe, marked as it begins: "Step N: <text>" in the cut log, and markers in the edit (also the S key).
        const next = (recording.step_count || 0) + 1, mark = node('button', `Mark ${words().step} ${next}`); mark.id = 'mark-step'; mark.title = 'Shortcut: S';
        mark.onclick = async () => {
          const got = await concert.ask({ title: `Step ${next}`, fields: [{ name: 'text', label: 'What this step is (for example: fold in the flour)' }], ok: 'Mark it' });
          if (got) direct({ step: (got.text || '').trim().slice(0, 120) });
        };
        const steps = (recording.steps || []).map(step => `${step.number}: ${step.text || '—'} at ${clock(step.offset_seconds)}`).join(' · ');
        const stepRow = node('p', ''); stepRow.append(mark, node('span', steps ? ` Marked: ${steps}` : ' Mark each step as it begins: the editor finds it in the cut log and as markers beside the camera files.')); program.append(stepRow);
      }
      const last = director.finished[director.finished.length - 1];
      if (last) { const line = node('p', last.ok ? `Last recording: ${last.file} · ${clock(last.seconds)} · ${(last.bytes / 1048576).toFixed(0)} MiB · ${last.video}${last.audio ? ` + ${last.audio} sound` : ' · NO SOUND TRACK'} · ${last.cuts} shot(s) in its cut log` : `Last recording has a problem: ${last.detail} (${last.file})`); line.className = last.ok && last.audio ? 'activity done' : 'recording-warning'; program.append(line); }
      // A shot held a long while, said plainly with the director's reason.
      if (director.holding) {
        const h = director.holding, minutes = Math.floor(h.seconds / 60), seconds = h.seconds % 60;
        const line = node('p', `Holding ${h.camera_id ? named(h.camera_id) : `“${h.scene}”`} for ${minutes ? `${minutes} min ` : ''}${seconds} s${h.reason ? `: ${h.reason}` : ''}.${director.max_stay_seconds ? '' : ' Set “move on after at most” on the Director page to limit this.'}`);
        line.className = 'recording-warning'; program.append(line);
      }
      // Each camera's own file of a recording, and the edit of them, are with the recordings.
      if (last) { const more = node('small', ' '); const link = document.createElement('a'); link.href = '/recordings'; link.textContent = `Programme recordings${last.camera_files ? ', with each camera’s own file and the edit (EDL)' : ''} →`; more.append(link); program.append(more); }
      const cut = director.cuts[director.cuts.length - 1];
      if (cut) program.append(node('small', `Last cut ${new Date(cut.at * 1000).toLocaleTimeString()}: ${cut.pair ? `split of ${cut.pair.map(named).join(' and ')}` : cut.camera_id ? named(cut.camera_id) : `scene “${cut.scene}”`} (${cut.reason}${cut.by === 'ai' ? ', chosen by the model' : ''}).`));
      const held = (director.stays || [])[(director.stays || []).length - 1];
      if (held && (!cut || held.at > cut.at)) program.append(node('small', `Last look ${new Date(held.at * 1000).toLocaleTimeString()}: ${held.reason}.`));
      if (director.ai?.enabled && director.looked) {
        // Look-ahead, camera by camera: whose pictures the model is seeing early, and for any that are not, since when and why.
        const watch = director.lookahead || [], behind = watch.filter(w => !w.ahead), ahead = watch.length - behind.length;
        const line = node('small', !watch.length ? 'Look-ahead: no camera is being looked at yet.'
          : `Look-ahead: ${ahead} of ${watch.length} cameras seen from their own phones${ahead ? `, about ${Math.max(0, director.looked.ahead_seconds).toFixed(1)} s before OBS shows that moment` : ''}${director.planned ? ` · a cut to ${director.planned.pair ? director.planned.pair.map(named).join(' + ') : named(director.planned.camera_id)} is due in ${Math.max(0, director.planned.at - nowSeconds).toFixed(1)} s` : ''}.`);
        program.append(line);
        for (const w of behind) {
          const note = node(w.warn ? 'p' : 'small', `${named(w.camera_id)} is being seen through OBS, not ahead, for ${w.seconds < 90 ? `${Math.round(w.seconds)} s` : `${Math.round(w.seconds / 60)} min`}: ${w.reason}. Cuts to it are made as its picture arrives, so they land a little late.`);
          if (w.warn) note.className = 'recording-warning';
          program.append(note);
        }
      }
      // OBS's own outgoing stream, to whatever service is set up in OBS.
      const live = director.streaming;
      const stream = node('button', live ? 'Stop OBS Stream' : 'Start OBS Stream'); if (live) stream.className = 'danger';
      stream.onclick = async () => { if (await concert.sure(live ? 'Stop OBS streaming? Viewers lose the programme.' : 'Start OBS streaming to the service set up in OBS? The programme goes out to its audience.')) direct({ stream: !live }); };
      const streamRow = node('p', ''); streamRow.append(stream, node('span', live ? ` Streaming from OBS for ${clock(live.seconds)}${live.reconnecting ? ' · RECONNECTING' : ''} · ${live.dropped_frames} dropped frame(s)` : ' OBS is not streaming out'));
      if (live) streamRow.className = live.reconnecting ? 'recording-warning' : 'activity running'; program.append(streamRow);
      // A vision model that advises on the next shot: any server that speaks the OpenAI chat format.
      const ai = director.ai;
      if (ai && !aiOff) {
        const advise = node('label', ''); const use = document.createElement('input'); use.type = 'checkbox'; use.checked = ai.enabled; use.disabled = !ai.configured;
        use.onchange = () => direct({ ai: { enabled: use.checked } });
        advise.append(use, node('span', ai.configured ? ` Let the model ${ai.model} choose the shots (the rules still keep dead cameras off air, and take over if it is slow)` : ' Let a vision model choose the shots (give its server and model name below first)')); settings.append(advise);
        const field = (text, value, width, type = 'text') => { const input = document.createElement('input'); input.type = type; input.value = value; input.size = width; input.spellcheck = false; input.autocomplete = 'off'; const row = node('label', text + ' '); row.append(input); settings.append(row); return input; };
        const url = field('Model server address (chat completions)', ai.url, 52), model = field('Model name', ai.model, 28), key = field(`API key (${ai.key_set ? 'one is saved; leave empty to keep it' : 'if the server needs one'})`, '', 28, 'password');
        key.autocomplete = 'new-password';
        const wishes = document.createElement('textarea'); wishes.rows = 2; wishes.cols = 70; wishes.value = ai.guidance; wishes.placeholder = `What you want favoured, in your own words: e.g. ${words().brief || 'stay on whoever is singing; wide shot between songs.'}`;
        // The standing brief. Wishes typed during the show go on top of it, in Scene Chat on the Show and Stage Shots pages.
        const wishRow = node('label', 'Your wishes for the shots (the standing brief) '); wishRow.append(wishes); settings.append(wishRow);
        settings.append(node('small', 'During the show, type wishes such as “more on the keyboards” in Scene Chat, on the Show page: they go on top of this brief.'));
        const saveAi = node('button', 'Save model settings');
        saveAi.onclick = () => { const body = { url: url.value.trim(), model: model.value.trim(), guidance: wishes.value }; if (key.value) body.key = key.value; direct({ ai: body }); };
        settings.append(saveAi);
        if (ai.last) { const said = node('small', ai.last.ok ? `Model’s last answer (${ai.last.ms} ms): rates ${Object.entries(ai.last.scores || {}).map(([identifier, score]) => `${named(identifier)} ${score}`).join(', ')}${ai.last.reason ? ` — ${ai.last.reason}` : ''}` : `Model’s last answer failed: ${ai.last.detail}. The rules are choosing meanwhile.`); if (!ai.last.ok) said.className = 'recording-warning'; settings.append(said); }
      }
    }
    // Keeping the feeds aligned in OBS: the switch, what it is aiming for, and what it last corrected.
    // How the phones find the manager: by its address alone, or by a name that follows it to whatever address it has.
    // An operator sees what runs a show. What only the administrator may change is left off their page altogether.
    const operator = role === 'operator';
    document.body.classList.toggle('operator', operator);
    const who = document.querySelector('#who') || (() => { const made = node('p', ''); made.id = 'who'; document.querySelector('header').append(made); return made; })();
    who.textContent = operator ? `Logged in as an operator${away ? ' from the camera network' : ''}: cameras, streams, recording and shots. Updating, pairing, deleting from the phones and passwords are for the administrator, at the manager PC.` : '';
    // Locations: sets of cameras and settings for different places, switching between them, and going back.
    const placesPanel = document.querySelector('#locations');
    if (!operator && !placesPanel.hidden && !editing(placesPanel)) {
      let places = null; try { places = await api('/api/locations'); } catch (error) { places = null; }
      if (places) {
        const ask = async body => { try { const answer = await api('/api/locations', { method: 'POST', body: JSON.stringify(body) }); placeSaid = ''; if (answer.restarting) { placeSaid = 'Restarting the manager for the change…'; setTimeout(() => location.reload(), 7000); } else if (answer.restart_needed) placeSaid = 'Done. Restart the manager for it to take effect.'; return answer; } catch (error) { placeSaid = error.message; return null; } finally { refresh(); } };
        const when = at => at ? new Date(at * 1000).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
        placesPanel.replaceChildren(node('h2', 'Locations'), node('p', 'A location is a set of cameras with its own way of running a show: what each camera shows, the stage picture, how shots are chosen. One is in use at a time. Switching restarts the manager, and it then answers to that location’s cameras only.'));
        for (const place of places.locations) {
          const card = node('article', ''); card.className = place.active ? 'place in-use' : 'place';
          card.append(node('h3', place.active ? `${place.name} · in use` : place.name));
          card.append(node('p', `${place.cameras.length ? `${place.cameras.length} camera${place.cameras.length === 1 ? '' : 's'}: ${place.cameras.join(', ')}` : 'No cameras yet: pair some into it'}${place.answers_to ? ` · answers to ${place.answers_to}` : ''} · ${place.restore_points} restore point${place.restore_points === 1 ? '' : 's'}`));
          const row = node('div', '');
          if (!place.active) {
            const use = node('button', 'Switch to this'); use.disabled = places.connected > 0;
            use.onclick = async () => { if (await concert.sure(`Switch to “${place.name}”? The location in use is put away exactly as it is, and the manager restarts answering to ${place.cameras.length ? place.cameras.join(', ') : 'no cameras yet'}. Stop any recording first.`)) ask({ switch: place.id }); };
            row.append(use);
          }
          const rename = node('button', 'Rename'); rename.onclick = async () => { const got = await concert.ask({ title: 'Rename this location', fields: [{ name: 'name', label: 'Name', value: place.name }], ok: 'Rename' }); const name = got?.name?.trim(); if (name && name !== place.name) ask({ rename: { id: place.id, name } }); };
          row.append(rename);
          const send = node('button', 'Export…');
          send.onclick = async () => {
            const got = await concert.ask({ title: `Export “${place.name}”`, text: 'The file is encrypted with this passphrase. It holds what its cameras trust: with the passphrase it lets a PC stand in for this manager, so keep the two apart. The passphrase is not kept anywhere.',
              fields: [{ name: 'passphrase', label: 'Passphrase (12 characters or more)', type: 'password', minLength: 12 }, { name: 'again', label: 'The same passphrase again', type: 'password', minLength: 12 }], ok: 'Export' });
            if (!got) return;
            const passphrase = got.passphrase;
            if (passphrase.length < 12) { placeSaid = 'The passphrase has to be 12 characters or more; nothing was exported.'; refresh(); return; }
            if (got.again !== passphrase) { placeSaid = 'The two passphrases were not the same; nothing was exported.'; refresh(); return; }
            try { const made = await api('/api/locations/export', { method: 'POST', body: JSON.stringify({ id: place.id, passphrase }) }); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([JSON.stringify(made, null, 1)], { type: 'application/json' })); link.download = `concert-camera-location-${place.name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`; document.body.append(link); link.click(); link.remove(); placeSaid = `“${place.name}” exported with ${made.cameras} cameras.`; } catch (error) { placeSaid = error.message; } refresh();
          };
          row.append(send);
          if (!place.active) { const remove = node('button', 'Remove'); remove.className = 'danger'; remove.onclick = async () => { if (await concert.sure(`Remove “${place.name}” from this PC, with its ${place.cameras.length} cameras’ pairing and its restore points? Its phones would have to be paired again to be used. This cannot be undone; export it first if in doubt.`)) ask({ remove: place.id }); }; row.append(remove); }
          card.append(row); placesPanel.append(card);
        }
        if (places.connected > 0) placesPanel.append(node('small', `${places.connected} camera${places.connected === 1 ? ' is' : 's are'} connected, so the location cannot be switched now. Disarm and disconnect them, or switch when they are off.`));
        // A new one, to pair cameras into.
        const fresh = document.createElement('input'); fresh.type = 'text'; fresh.placeholder = 'Name, for example the venue'; fresh.maxLength = 60; fresh.setAttribute('aria-label', 'Name of the new location');
        const copy = document.createElement('input'); copy.type = 'checkbox'; copy.checked = true; const copyLabel = node('label', ''); copyLabel.append(copy, node('span', ' start with the settings in use now'));
        const make = node('button', 'New location'); make.onclick = async () => { if (!fresh.value.trim()) { placeSaid = 'Give the new location a name.'; refresh(); return; } const made = await ask({ create: { name: fresh.value.trim(), copy_settings: copy.checked } }); if (made) { fresh.value = ''; fresh.blur(); placeSaid = 'Made. Switch to it to pair cameras into it.'; refresh(); } };
        const makeRow = node('div', ''); makeRow.append(fresh, make, copyLabel); placesPanel.append(node('h3', 'A new location'), makeRow);
        // One from a file.
        const file = document.createElement('input'); file.type = 'file'; file.accept = '.json,application/json'; file.setAttribute('aria-label', 'A location file');
        const opening = document.createElement('input'); opening.type = 'password'; opening.autocomplete = 'off'; opening.placeholder = 'Its passphrase'; opening.setAttribute('aria-label', 'Its passphrase');
        const bring = node('button', 'Add a location from a file');
        bring.onclick = () => { const chosen = file.files[0]; if (!chosen) { placeSaid = 'Choose the location file first.'; refresh(); return; } const reader = new FileReader(); reader.onload = async () => { try { const answer = await api('/api/locations/import', { method: 'POST', body: JSON.stringify({ file: JSON.parse(reader.result), passphrase: opening.value }) }); placeSaid = `Added “${answer.brought_in.name}” with ${answer.brought_in.cameras.length} cameras. It is in the list; nothing about the location in use has changed.`; opening.value = ''; file.value = ''; opening.blur(); } catch (error) { placeSaid = error.message; } refresh(); }; reader.readAsText(chosen); };
        const bringRow = node('div', ''); bringRow.append(file, opening, bring); placesPanel.append(bringRow);
        // Going back.
        placesPanel.append(node('h3', 'Going back'), node('p', 'Restore points for the location in use. One is kept by itself before a switch, an import or a restore; make one before changing things you may want back.'));
        const label = document.createElement('input'); label.type = 'text'; label.placeholder = 'What this is, for example “Friday’s show”'; label.maxLength = 80; label.setAttribute('aria-label', 'A name for the restore point');
        const keep = node('button', 'Make a restore point'); keep.onclick = async () => { const made = await ask({ save_point: label.value }); if (made) { label.value = ''; label.blur(); placeSaid = 'Restore point made.'; refresh(); } };
        const keepRow = node('div', ''); keepRow.append(label, keep); placesPanel.append(keepRow);
        for (const point of places.restore_points.slice(0, 15)) {
          const line = node('div', ''); line.className = 'restore-point';
          line.append(node('span', `${when(point.at)} · ${point.label}${point.automatic ? ' (kept automatically)' : ''} · ${point.cameras.length} cameras, ${point.settings} settings `));
          const back = node('button', 'Restore settings'); back.onclick = async () => { if (await concert.sure(`Put the settings back to how they were at “${point.label}”? The cameras stay as they are. How things are now is kept as a restore point first.`)) ask({ restore: { point: point.id } }); };
          const all = node('button', 'Restore settings and cameras'); all.disabled = places.connected > 0;
          all.onclick = async () => { if (await concert.sure(`Go back to the settings and the cameras of “${point.label}” (${point.cameras.join(', ') || 'none'})? Cameras paired since then will no longer be let in. The manager restarts. How things are now is kept as a restore point first.`)) ask({ restore: { point: point.id, cameras_too: true } }); };
          line.append(back, all); placesPanel.append(line);
        }
        if (places.restore_points.length > 15) placesPanel.append(node('small', `…and ${places.restore_points.length - 15} older.`));
        if (placeSaid) { const line = node('p', placeSaid); line.className = /cannot|not |No |wrong|Give|Choose/.test(placeSaid) && !/^Made|^Added|^Restore point|exported/.test(placeSaid) ? 'recording-warning' : ''; placesPanel.append(line); }
      }
    }
    // Carrying this set-up to another PC, or bringing one here. Drawn once: it shows nothing that changes by itself.
    const transferPanel = document.querySelector('#transfer');
    if (!operator && !transferPanel.hidden && !transferPanel.childElementCount) {
      const save = (name, content) => { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([JSON.stringify(content, null, 1)], { type: 'application/json' })); link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 10000); };
      const read = input => new Promise((resolve, reject) => { const file = input.files[0]; if (!file) { reject(new Error('Choose the file first.')); return; } if (file.size > 2000000) { reject(new Error('That file is far too large to be one of these.')); return; } const reader = new FileReader(); reader.onload = () => { try { resolve(JSON.parse(reader.result)); } catch (error) { reject(new Error('That file is not one of these: it could not be read.')); } }; reader.onerror = () => reject(new Error('The file could not be read.')); reader.readAsText(file); });
      const said = node('p', ''); const tell = (text, bad) => { said.textContent = text; said.className = bad ? 'recording-warning' : ''; };
      const stamp = new Date().toISOString().slice(0, 10);
      transferPanel.append(node('h3', 'Settings alone, as a file'));
      // Settings: nothing secret.
      transferPanel.append(node('p', 'Settings: how shots are chosen, what each camera shows, the stage picture, the look-ahead. Nothing in the file is secret.'));
      const exportSettings = node('button', 'Export settings');
      exportSettings.onclick = async () => { try { save(`mcvsaid-settings-${stamp}.json`, await api('/api/transfer/settings')); tell('Settings exported.'); } catch (error) { tell(error.message, true); } };
      const settingsFile = document.createElement('input'); settingsFile.type = 'file'; settingsFile.accept = '.json,application/json'; settingsFile.setAttribute('aria-label', 'A settings file');
      const importSettings = node('button', 'Import settings');
      importSettings.onclick = async () => { try { const file = await read(settingsFile); if (!await concert.sure('Load these settings over the ones here? The settings in the file replace this PC’s; nothing else is touched.')) return; const report = await api('/api/transfer/settings', { method: 'POST', body: JSON.stringify({ file }) }); tell(`${report.applied.length} settings loaded.${report.for_cameras_not_here.length ? ` ${report.for_cameras_not_here.length} left out because they are for cameras this location does not have.` : ''}`); settingsFile.value = ''; refresh(); } catch (error) { tell(error.message, true); } };
      const settingsRow = node('div', ''); settingsRow.append(exportSettings, settingsFile, importSettings); transferPanel.append(settingsRow);
      transferPanel.append(node('small', 'A settings file carries no cameras. To move cameras to another PC, export the location above: it carries the cameras and their settings together, encrypted. Neither carries passwords and passcodes (each PC keeps its own), recordings and history, or OBS, which exports its own scenes and settings from its Scene Collection and Profile menus.'), said);
    }
    // The manager's own version: look for a newer one, install it, restart.
    const updatePanel = document.querySelector('#manager-update');
    if (!operator && !updatePanel.hidden && !editing(updatePanel)) {
      let up = null; try { up = await api('/api/updates'); } catch (error) { up = null; }
      if (up) {
        updatePanel.replaceChildren(node('h3', 'This manager'));
        const ask = async (body, button, doing) => { if (button) { button.disabled = true; button.textContent = doing; } try { await api('/api/updates', { method: 'POST', body: JSON.stringify(body) }); updateSaid = ''; } catch (error) { updateSaid = error.message; } refresh(); };
        const found = up.found, work = up.work, busy = work?.state === 'installing';
        updatePanel.append(node('p', `Running version ${up.installed}.${found && !found.problem ? (found.newer ? ` Version ${found.latest} is available.` : ' That is the newest.') : ''}${found ? ` Last looked ${new Date(found.checked * 1000).toLocaleTimeString()}.` : ''}`));
        const row = node('div', '');
        const check = node('button', 'Check for updates'); check.disabled = busy || !up.repository_ready; check.onclick = () => ask({ check: true }, check, 'Looking…');
        const restart = node('button', 'Restart manager'); restart.disabled = busy || !up.restartable;
        restart.onclick = async () => { if (await concert.sure('Restart the manager? The cameras drop for a few seconds and reconnect by themselves. OBS, the streams and a recording in progress are not interrupted, but shots are not chosen automatically until it is back.')) { ask({ restart: true }, restart, 'Restarting…'); setTimeout(() => location.reload(), 6000); } };
        row.append(check, restart); updatePanel.append(row);
        if (!up.restartable) updatePanel.append(node('small', 'The manager is not running as its service here, so it cannot restart itself.'));
        if (found?.problem) { const line = node('p', `Could not compare versions: ${found.problem}.`); line.className = 'recording-warning'; updatePanel.append(line); }
        if (found?.newer && !busy && work?.state !== 'installed') {
          updatePanel.append(node('small', `What is new in ${found.latest}:`));
          const list = node('ul', ''); for (const change of found.changes) list.append(node('li', change)); if (found.more) list.append(node('li', `…and ${found.more} more`)); updatePanel.append(list);
          const install = node('button', `Install ${found.latest} and restart`);
          install.onclick = async () => { if (await concert.sure(`Install ${found.latest} and restart the manager? It downloads the new version, which takes a minute or two, then restarts: the cameras drop for a few seconds and reconnect. The version running now is kept, to go back to.`)) ask({ install: true, restart: true }, install, 'Starting…'); };
          updatePanel.append(install);
        }
        if (work) { const line = node('p', `${work.version}: ${work.detail}`); if (work.state === 'failed') line.className = 'recording-warning'; updatePanel.append(line); if (work.state === 'installed' && /Restarting/.test(work.detail)) setTimeout(() => location.reload(), 7000); }
        if (updateSaid) { const line = node('p', updateSaid); line.className = 'recording-warning'; updatePanel.append(line); }
        // Where newer versions are looked for: the installation's own copy unless another has been named.
        if (!up.repository_ready) { const line = node('p', `There is no copy of the repository at ${up.repository || 'the usual place'} to look for updates in. Run scripts/bootstrap.sh from a clone to make one.`); line.className = 'recording-warning'; updatePanel.append(line); }
        else updatePanel.append(node('small', `Looks for newer versions in ${up.repository}${up.repository_chosen ? ' (set by hand)' : ', this installation’s own copy'}, on the ${up.branch} branch.`));
      }
    }
    // Who else can get in: the operator's password, the dashboard on the camera network, and who is logged in now.
    const accessPanel = document.querySelector('#access');
    if (!operator && !accessPanel.hidden && !editing(accessPanel)) {
      let access = null; try { access = await api('/api/access'); } catch (error) { access = null; }
      if (access) {
        accessPanel.replaceChildren(node('h3', 'Who else can log in'));
        const change = async body => { try { const answer = await api('/api/access', { method: 'POST', body: JSON.stringify(body) }); if (answer.operator_password_once) operatorShown = answer.operator_password_once; return answer; } catch (error) { result.textContent = error.message; return null; } finally { refresh(); } };
        accessPanel.append(node('p', access.operator_password_set ? 'An operator password is set. An operator can run a show but cannot update, restart or pair the phones, delete recordings from them, or change passwords.' : 'No operator password is set, so only the administrator can log in.'));
        const make = node('button', access.operator_password_set ? 'Make a new operator password' : 'Make an operator password');
        make.onclick = async () => { if (!access.operator_password_set || await concert.sure('Make a new operator password? The present one stops working and operators are logged out.')) change({ operator_password: 'new' }); };
        const own = document.createElement('input'); own.type = 'text'; own.autocomplete = 'off'; own.spellcheck = false; own.minLength = 8; own.maxLength = 128; own.placeholder = 'or type your own (8 or more)'; own.setAttribute('aria-label', 'An operator password of your own');
        const use = node('button', 'Set this password');
        use.onclick = async () => { if (own.value.length < 8) { result.textContent = 'An operator password is at least 8 characters.'; return; } if (access.operator_password_set && !await concert.sure('Set this operator password? The present one stops working and operators are logged out.')) return; const done = await change({ operator_password: { set: own.value } }); if (done) { operatorShown = ''; own.value = ''; own.blur(); result.textContent = 'Operator password set. It is not kept anywhere readable.'; } };
        const row = node('div', ''); row.append(make, own, use);
        if (access.operator_password_set) { const none = node('button', 'Remove it'); none.onclick = async () => { if (await concert.sure('Remove the operator password? Nobody will be able to log in as an operator.')) { operatorShown = ''; change({ operator_password: null }); } }; row.append(none); }
        accessPanel.append(row);
        if (operatorShown) { const once = node('p', `Operator password: ${operatorShown}. Write it down now: it is not kept anywhere and cannot be shown again.`); once.className = 'recording-warning'; accessPanel.append(once); }
        // The dashboard on the camera network, for a tablet.
        const net = access.network, offer = node('label', ''), box = document.createElement('input'); box.type = 'checkbox'; box.checked = net.wanted;
        box.onchange = () => change({ network: box.checked });
        offer.append(box, node('span', ' Offer this dashboard to the camera network, for a tablet. Only an operator can log in from there; the administrator logs in at this PC.')); accessPanel.append(offer);
        if (net.wanted !== net.running) accessPanel.append(node('small', `Restart the manager to ${net.wanted ? 'start' : 'stop'} offering it.`));
        else if (net.running) {
          accessPanel.append(node('small', `On the tablet, joined to the camera Wi-Fi, open ${net.addresses[0]}${net.addresses.length > 1 ? ` (or ${net.addresses.slice(1).join(', ')})` : ''}. If this PC has a firewall, open the port once: sudo ufw allow in ${net.interface ? `on ${net.interface} ` : ''}to any port ${net.port} proto tcp`));
          accessPanel.append(node('small', `To stop the tablet warning about the certificate: on the tablet open ${net.addresses[0]}authority.crt, install the profile it downloads, then switch on full trust for “MCVSAID (this installation)” (on an iPad: Settings › General › About › Certificate Trust Settings). This is done once; it covers this dashboard and Stage Shots.`));
          if (!access.operator_password_set) { const need = node('small', 'Nobody can log in from the network until an operator password is made.'); need.className = 'recording-warning'; accessPanel.append(need); }
        }
        // Who is logged in now, and a way to log any of them out.
        accessPanel.append(node('p', 'Logged in now:'));
        const ago = at => { if (!at) return ''; const s = Math.max(0, Date.now() / 1000 - at); return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };
        const gadget = text => /iPad/.test(text) ? 'iPad' : /iPhone/.test(text) ? 'iPhone' : /Android/.test(text) ? 'Android device' : /Macintosh/.test(text) ? 'Mac' : /Windows/.test(text) ? 'Windows PC' : /Linux/.test(text) ? 'Linux PC' : 'a browser';
        for (const person of access.logged_in) {
          const line = node('small', `${person.what}, ${person.where}, ${gadget(person.device || '')}, since ${person.since ? new Date(person.since * 1000).toLocaleTimeString() : 'earlier'}, last active ${ago(person.seen)} `);
          const mine = person.what === 'administrator' && person.where === 'this PC' && access.logged_in.filter(p => p.what === 'administrator').length === 1;
          if (!mine) { const end = node('button', 'Log out'); end.onclick = () => change({ end: person.id }); line.append(end); }
          accessPanel.append(line);
        }
        if (access.logged_in.length > 1) { const all = node('button', 'Log everyone else out'); all.onclick = async () => { if (await concert.sure('Log out every other device, including phones on Stage Shots?')) change({ end_all: true }); }; accessPanel.append(all); }
      }
    }
    // The camera relay (System › This PC): it holds each camera's look-ahead as compressed video, where OBS would hold
    // decoded pictures. On by default; switching it off is a troubleshooting step, so it is kept under Troubleshooting.
    const relaySystem = document.querySelector('#relay-system'), relayFiles = document.querySelector('#relay');
    const relay = !operator && (!relaySystem.hidden || !relayFiles.hidden) ? await api('/api/relay').catch(() => null) : null;
    const switchRelay = async (on, question) => {
      if (!await concert.sure(question)) return false;
      try { await api('/api/relay', { method: 'POST', body: JSON.stringify({ enabled: on }) }); result.textContent = on ? 'Camera relay on.' : 'Camera relay off.'; }
      catch (error) { result.textContent = error.message; }
      refresh(); return true;
    };
    const MEMORY = 'Measured on a Mac with 48 GB and six cameras at 4K (25 Mb/s, 5.5 s look-ahead): OBS used 11.0 GB with the relay off and 2.6 GB with it on, the relay itself 0.13 GB; the whole Mac 38.8 GB against 30.7 GB.';
    if (relay && !relaySystem.hidden && !editing(relaySystem)) {
      relaySystem.replaceChildren(node('h3', 'Camera relay: the look-ahead, held as video'));
      relaySystem.append(node('p', 'Each camera’s stream passes through a relay on this PC on its way to OBS, unchanged. The relay holds the look-ahead (the seconds the programme runs behind the stage, so the director’s cuts land on time) as the compressed stream, about 12 MB for 4 s, where OBS would hold it as pictures, about 1.5-1.8 GB per 4K camera. The phones do no extra work.'));
      if (relay.switched_on && relay.unavailable) {
        const why = node('p', `The relay is switched on but cannot run on this PC: ${relay.unavailable}. The cameras go straight to OBS instead, which holds the look-ahead in memory. Put it right, then restart the manager (or switch the relay off and on again below).`);
        why.className = 'recording-warning'; relaySystem.append(why);
      } else if (relay.enabled) {
        const state = node('p', relay.running ? `The relay is running${relay.files ? ', and keeping each camera’s file of every programme recording' : ''}.` : `The relay is switched on but not running${relay.problem ? `: ${relay.problem}` : ''}. Pictures cannot reach OBS: switch it off and on again under Troubleshooting.`);
        state.className = relay.running ? 'activity done' : 'recording-warning'; relaySystem.append(state);
        const list = document.createElement('ul');
        for (const [slot, camera] of Object.entries(relay.cameras || {})) {
          const said = camera.state === 'connected' ? `passing ${camera.mbps.toFixed(1)} Mb/s to OBS` : camera.state === 'listening' ? 'waiting for the camera to stream' : `${camera.state}${camera.problem ? `: ${camera.problem}` : ''}`;
          const held = camera.delay_ms ? `; holding it ${(camera.delay_ms / 1000).toFixed(1)} s before OBS (${((camera.held_bytes || 0) / 1048576).toFixed(0)} MB)` : '';
          const line = node('li', `${camera.name} (UDP ${camera.port}): ${said}${held}${camera.spool_problem ? `; NOT KEPT: ${camera.spool_problem}` : ''}.`);
          if (camera.spool_problem || (camera.state !== 'connected' && camera.problem)) line.className = 'recording-warning';
          list.append(line);
        }
        if (list.children.length) relaySystem.append(list);
        relaySystem.append(node('small', ' Each camera’s look-ahead is moved from OBS into the relay while that camera is off air. OBS keeps half a second of it, to adjust.'));
      } else {
        // An installation from before the relay was the default: recommended, not switched on behind the operator's back.
        const advice = node('article', ''); advice.className = 'recording-warning';
        advice.append(node('p', `Recommended: switch the camera relay on. With it off, OBS holds every camera’s look-ahead in memory, about 1.5-1.8 GB per 4K camera${relay.cameras_4k ? `, and ${relay.cameras_4k} of your cameras stream at 4K` : ''}. ${MEMORY}`));
        const on = node('button', 'Switch the camera relay on');
        on.onclick = () => switchRelay(true, 'Switch the camera relay on? Every camera’s OBS source is pointed at the relay. A camera that is streaming drops for a few seconds and comes back by itself. Camera files stay as they are (PC recordings).');
        advice.append(on); relaySystem.append(advice);
      }
      // Off, as a troubleshooting step only.
      if (relay.switched_on) {
        const fold = document.createElement('details'); fold.className = 'fold'; fold.open = relayAdvancedOpen;
        fold.ontoggle = () => { relayAdvancedOpen = fold.open; };
        const summary = node('summary', 'Advanced: troubleshooting'); fold.append(summary);
        const warning = node('p', 'Turn off only to troubleshoot or if the relay fails: OBS then holds the look-ahead in memory, about 1.5-1.8 GB per 4K camera, and recordings get no camera files.'); warning.className = 'recording-warning';
        const off = node('button', 'Switch the camera relay off'); off.className = 'danger';
        off.onclick = () => switchRelay(false, 'Switch the camera relay off? Every camera’s OBS source is pointed back at the camera and OBS holds the look-ahead in memory, about 1.5-1.8 GB per 4K camera. A streaming camera drops for a few seconds.');
        fold.append(warning, off); relaySystem.append(fold);
      }
    }
    // Camera files (PC recordings): each camera's whole stream kept while the programme is recorded, for its own file and the EDL.
    if (relay && !relayFiles.hidden && !editing(relayFiles)) {
      relayFiles.replaceChildren(node('h2', 'Camera files: each camera’s own file'));
      relayFiles.append(node('p', 'With this on, the camera relay keeps each camera’s stream while the programme is recorded. When the recording stops, each camera gets its own file of it beside the programme, at the stream’s own quality, with the cuts as an edit (EDL) that a videographer can open, change or re-cut.'));
      relayFiles.append(node('p', 'It takes disk space: about 3 GB an hour per camera at 1080p, 5 GB at 1440p and 11 GB at 4K, and up to twice that while the files are being made. The readiness check counts it when this is on.'));
      const label = node('label', ''), box = document.createElement('input'); box.type = 'checkbox'; box.checked = !!relay.files;
      box.disabled = !relay.enabled;
      box.onchange = async () => {
        box.disabled = true;
        try { await api('/api/relay', { method: 'POST', body: JSON.stringify({ files: box.checked }) }); result.textContent = box.checked ? 'Camera files on.' : 'Camera files off.'; }
        catch (error) { result.textContent = error.message; }
        refresh();
      };
      label.append(box, node('span', ' Keep each camera’s own file of every programme recording')); relayFiles.append(label);
      if (!relay.enabled) {
        const link = document.createElement('a'); link.href = '/system#pc'; link.textContent = 'System › This PC';
        const need = node('small', relay.switched_on ? 'Camera files need the camera relay, which cannot run on this PC now: see ' : 'Camera files need the camera relay, which is off: switch it on in ');
        need.append(link, node('span', '.')); relayFiles.append(need);
      } else if (relay.files) relayFiles.append(node('small', ' Without a recording the relay keeps about ten minutes of each camera.'));
      else relayFiles.append(node('small', ' Off: the relay keeps only the last minute or so of each camera, and nothing for the length of a recording.'));
    }
    // Decoding each camera on the graphics card or the processor, with a measurement to help choose.
    const decodingPanel = document.querySelector('#decoding');
    if (!operator && !decodingPanel.hidden && !editing(decodingPanel)) {
      let d = null; try { d = await api('/api/decoding'); } catch (error) { d = null; }
      if (d) {
        decodingPanel.replaceChildren(node('h3', 'Decoding: graphics card or processor'));
        decodingPanel.append(node('p', `OBS decodes every camera, on the graphics card's video decoder unless it is set to the processor. On the PC this was built on the processor did better: six 4K cameras took about 16% of it, while the graphics card, shared with the shot-choosing model, filled up at three. The suggestion below starts every camera on the processor and moves the largest to the graphics card only if the processor would be over half busy. Now: video decoder ${d.decoder_percent ?? '—'}% busy, processor ${d.processor_percent ?? '—'}%.`));
        const ask = async body => { try { await api('/api/decoding', { method: 'POST', body: JSON.stringify(body) }); } catch (error) { result.textContent = error.message; } refresh(); };
        for (const camera of d.cameras) {
          const row = node('label', `${camera.name}${camera.height ? ` (${camera.height === 2160 ? '4K' : `${camera.height}p`})` : ''}: decode on `);
          const pick = document.createElement('select'); pick.setAttribute('aria-label', `Where ${camera.name} is decoded`);
          for (const [value, text] of [['gpu', 'the graphics card'], ['cpu', 'the processor']]) { const option = document.createElement('option'); option.value = value; option.textContent = text; option.selected = camera.decode === value; pick.append(option); }
          pick.onchange = () => ask({ camera_id: camera.id, decode: pick.value });
          row.append(pick); if (camera.on_air) row.append(node('small', ' on air: changed once it is off air'));
          decodingPanel.append(row);
        }
        const m = d.measurement, running = d.measuring?.running;
        const measure = node('button', running ? `Measuring… ${d.measuring.step || ''}` : 'Measure this PC'); measure.disabled = running || d.cameras.some(c => c.streaming);
        measure.onclick = () => ask({ measure: true });
        decodingPanel.append(measure, node('small', d.cameras.some(c => c.streaming) ? ' Not while a camera is streaming: the measurement uses the same hardware as OBS.' : ' About two minutes. Decodes the real phone footage captured for the tests, on each, until they fall behind.'));
        if (d.measuring?.problem) { const said = node('p', `The measurement failed: ${d.measuring.problem}`); said.className = 'recording-warning'; decodingPanel.append(said); }
        if (m) {
          const size = h => Number(h) === 2160 ? '4K' : `${h}p`;
          const lines = [];
          for (const [kind, label, of] of [['gpu', 'graphics card', 'of its decoder'], ['cpu', 'processor', 'of the processor']])
            for (const [h, r] of Object.entries(m.results[kind] || {})) lines.push(`${label}: each ${size(h)} camera about ${r.per_stream_percent.toFixed(1)}% ${of}${r.streams < 8 ? ` (most that kept up: ${r.streams})` : ' (8 kept up, the most tried)'}`);
          decodingPanel.append(node('p', `Measured ${new Date(m.at * 1000).toLocaleString()}: ${lines.join('; ')}.`));
          const s = d.suggested;
          if (s) {
            const onCpu = d.cameras.filter(c => s.decode[c.id] === 'cpu').map(c => c.name);
            const differs = d.cameras.some(c => (s.decode[c.id] || 'gpu') !== c.decode);
            const onGpu = d.cameras.filter(c => s.decode[c.id] === 'gpu').map(c => c.name);
            const where = !onGpu.length ? 'every camera on the processor' : !onCpu.length ? 'every camera on the graphics card' : `${onGpu.join(', ')} on the graphics card, the rest on the processor`;
            const line = node('p', `Suggested for the sizes set now: ${where}, for about ${s.cpu_percent}% of the processor and ${s.gpu_percent}% of the decoder${s.fits ? '' : ': MORE THAN THIS PC SHOULD CARRY. Lower some stream sizes'}.`);
            if (!s.fits) line.className = 'recording-warning';
            decodingPanel.append(line);
            if (differs) { const apply = node('button', 'Use the suggestion'); apply.onclick = async () => { if (await concert.sure('Change where the cameras are decoded as suggested? A camera\'s picture in OBS restarts as it changes; one on air changes once it is off air.')) ask({ apply: 'suggested' }); }; decodingPanel.append(apply); }
          }
        } else decodingPanel.append(node('p', 'Not measured yet on this PC.'));
      }
    }
    const networkPanel = document.querySelector('#network');
    if (!operator && !networkPanel.hidden && !editing(networkPanel)) {
      let net = null; try { net = await api('/api/network'); } catch (error) { net = null; }
      if (net) {
        networkPanel.replaceChildren(node('h3', 'How the phones find this manager'));
        const change = async body => { try { await api('/api/network', { method: 'POST', body: JSON.stringify(body) }); } catch (error) { result.textContent = error.message; } refresh(); };
        const here = net.addresses.join(' and ');
        networkPanel.append(node('p', net.name ? `By name: ${net.name}, at ${here}. A phone paired to the name follows the manager if its address changes.` : `By address alone: ${here}. A phone paired this way has to be paired again if the address ever changes.`));
        // The choices, each with what it needs of the network.
        const pick = document.createElement('select'); pick.setAttribute('aria-label', 'How the phones find the manager');
        const saved = !net.name ? 'address' : net.name === net.suggested ? 'suggested' : net.kind === 'announced' ? 'local' : 'router';
        const kind = networkPicked?.kind ?? saved;
        for (const [value, text] of [['address', 'its address alone'], ['suggested', `${net.suggested} (announced by this PC; nothing to set on the router)`], ['local', 'another name ending in .local (announced by this PC)'], ['router', 'a name I have given an address on the router']]) { const option = document.createElement('option'); option.value = value; option.textContent = text; option.selected = value === kind; pick.append(option); }
        const typed = document.createElement('input'); typed.type = 'text'; typed.autocomplete = 'off'; typed.spellcheck = false; typed.setAttribute('aria-label', 'The name');
        typed.value = networkPicked ? networkPicked.text : net.name && saved !== 'suggested' ? net.name : ''; typed.hidden = !['local', 'router'].includes(pick.value);
        typed.oninput = () => { networkPicked = { kind: pick.value, text: typed.value }; };
        const note = node('small', '');
        const explain = () => {
          typed.hidden = !['local', 'router'].includes(pick.value); typed.placeholder = pick.value === 'local' ? 'for example stage-cameras.local' : 'for example cameras.myvenue.com';
          note.textContent = pick.value === 'address' ? 'Nothing is announced. Give this PC a fixed address on the router (a DHCP reservation), because every phone is tied to it.'
            : pick.value === 'router' ? `On the router, add a local name record (often under “DNS”, “Hostnames” or “Static leases”) giving this name the address ${net.addresses[0]}, and give this PC a fixed address there. The phones must use the router for looking names up, which is the usual arrangement. Avoid a name ending in a public ending you do not own (.camera, .com and so on): on a network with internet it could lead to someone else’s server.`
            : 'Nothing to set on the router, and no fixed address needed: the name follows the PC. The network must let the phones hear the PC’s announcements: on the Wi-Fi, switch off “client isolation” (also called “AP isolation”) and any “multicast” or “mDNS filtering”.';
        };
        pick.onchange = () => { networkPicked = { kind: pick.value, text: typed.value }; explain(); }; explain();
        const set = node('button', 'Use this');
        set.onclick = () => { const name = pick.value === 'address' ? null : pick.value === 'suggested' ? net.suggested : typed.value.trim(); if (pick.value !== 'address' && !name) { result.textContent = 'Type the name first.'; return; } if (pick.value === 'local' && !name.toLowerCase().endsWith('.local')) { result.textContent = 'A name this PC announces has to end in .local'; return; } networkPicked = null; set.disabled = true; set.textContent = 'Setting…'; change({ name }); };
        const row = node('label', 'Phones find it by '); row.append(pick, typed, set); networkPanel.append(row, note);
        // The adapter whose address the manager follows: a replacement router handing out another range is then followed.
        const port = document.createElement('select'); port.setAttribute('aria-label', 'Camera network adapter');
        const ports = [['', `none: stay at ${net.interface ? 'the address it was set up with' : here}`], ...Object.entries(net.adapters || {}).map(([name, at]) => [name, `${name} (${at.join(', ')})`])];
        if (net.interface && !(net.interface in (net.adapters || {}))) ports.push([net.interface, `${net.interface} (no address now)`]);
        for (const [value, text] of ports) { const option = document.createElement('option'); option.value = value; option.textContent = text; option.selected = value === (net.interface || ''); port.append(option); }
        const follow = node('button', 'Use this');
        follow.onclick = () => { follow.disabled = true; follow.textContent = 'Setting…'; change({ interface: port.value || null }); };
        const portRow = node('label', 'Follow the address of '); portRow.append(port, follow);
        // What the phones are meant to be on: a phone on anything else shows in its readiness.
        const expect = document.createElement('select'); expect.setAttribute('aria-label', 'What the cameras are meant to be on');
        for (const [value, text] of [['any', 'either'], ['ethernet', 'wired Ethernet'], ['wifi', 'Wi-Fi']]) { const option = document.createElement('option'); option.value = value; option.textContent = text; option.selected = (net.expect || 'any') === value; expect.append(option); }
        expect.onchange = () => change({ expect: expect.value });
        const expectRow = node('label', 'The cameras are meant to be on '); expectRow.append(expect);
        networkPanel.append(expectRow, node('small', net.expect === 'ethernet' ? ' A camera on Wi-Fi shows as a warning in its readiness: usually an adapter not plugged in.' : ' Choose wired Ethernet to be warned of any camera that is on Wi-Fi instead.'));
        // The camera Wi-Fi: an armed phone that loses it rejoins it by itself; this is its name for phones that do not know it, and whether they may drift.
        const wifiName = document.createElement('input'); wifiName.type = 'text'; wifiName.autocomplete = 'off'; wifiName.spellcheck = false; wifiName.setAttribute('aria-label', 'Camera Wi-Fi name');
        wifiName.value = net.camera_wifi_set || ''; wifiName.placeholder = net.camera_wifi ? `${net.camera_wifi} (from the set-up codes)` : 'the camera network’s Wi-Fi name';
        const nameSet = node('button', 'Use this');
        nameSet.onclick = () => { nameSet.disabled = true; nameSet.textContent = 'Setting…'; change({ camera_wifi: wifiName.value.trim() || null }); };
        const wifiRow = node('label', 'The camera Wi-Fi is '); wifiRow.append(wifiName, nameSet);
        const hold = document.createElement('input'); hold.type = 'checkbox'; hold.checked = !!net.wifi_hold;
        hold.onchange = () => change({ hold: hold.checked });
        const holdRow = node('label', ''); holdRow.append(hold, node('span', ' While armed, switch each phone’s other saved Wi-Fi networks off, so it cannot drift to them'));
        networkPanel.append(wifiRow, node('small', net.camera_wifi ? ` An armed phone on Wi-Fi that loses “${net.camera_wifi}” rejoins it by itself, retrying every few seconds up to a minute apart. Phones on Ethernet are left alone.` : ' Type it so that an armed phone that loses the camera Wi-Fi can rejoin it by itself.'),
          holdRow, node('small', ' They are switched back on when the phone is disarmed, or after 5 minutes without the camera Wi-Fi, so a phone is never left with nowhere to go.'));
        networkPanel.append(portRow, node('small', net.interface
          ? `The manager listens at whatever address ${net.interface} has (now on ${net.networks.join(', ')}), and accepts recordings from that range. A replacement router handing out another range is followed within about 10 seconds.`
          : 'Pick the adapter the camera switch is plugged into, so that a replacement router handing out another range does not strand the manager. Phones paired by name follow it.'));
        if (networkPicked && kind !== saved) { const pending = node('small', 'Not set yet: press “Use this” to make the change.'); pending.className = 'recording-warning'; networkPanel.append(pending); }
        if (net.name) {
          const ok = net.leads_here, line = node('p', ok ? `Checked from this PC: ${net.name} leads to ${net.looked_up.join(', ')}, which is here.${net.kind === 'announced' ? ' It is being announced.' : ''}`
            : net.looked_up.length ? `${net.name} leads to ${net.looked_up.join(', ')}, which is not this PC (${here}). ${net.kind === 'router' ? 'Correct the record on the router.' : 'Something else on the network is using this name: choose another.'}`
            : net.kind === 'router' ? `${net.name} does not lead anywhere yet: the record on the router is missing, or this PC does not look names up there.` : `${net.name} cannot be looked up from this PC${net.problem ? `: ${net.problem}` : ' yet; it can take a few seconds after being set'}.`);
          if (!ok) line.className = 'recording-warning'; networkPanel.append(line);
          const byName = net.cameras.filter(c => c.reaches_manager_at === net.name), movable = net.cameras.filter(c => c.online && c.can_be_moved && c.reaches_manager_at !== net.name), stuck = net.cameras.filter(c => c.reaches_manager_at !== net.name && !c.can_be_moved);
          networkPanel.append(node('p', `${byName.length} of ${net.cameras.length} cameras reach the manager by this name${byName.length ? `: ${byName.map(c => c.name).join(', ')}` : ''}.`));
          if (movable.length) {
            const move = node('button', `Move ${movable.map(c => c.name).join(', ')} to ${net.name}`); move.disabled = !ok;
            move.onclick = async () => { move.disabled = true; move.textContent = 'Moving…'; try { const answer = await api('/api/network/move', { method: 'POST', body: JSON.stringify({}) }); result.textContent = answer.outcomes.map(o => `${net.cameras.find(c => c.id === o.camera_id)?.name || o.camera_id}: ${o.moved ? 'now by name' : `not moved (${o.why})`}`).join('\n'); } catch (error) { result.textContent = error.message; } refresh(); };
            networkPanel.append(move, node('small', 'Each phone tries the name first and keeps its present pairing if that does not work. Its stream is not interrupted.'));
          }
          if (stuck.length) networkPanel.append(node('small', `${stuck.map(c => c.name).join(', ')} ${stuck.length === 1 ? 'needs' : 'need'} a newer app before ${stuck.length === 1 ? 'it' : 'they'} can be moved without a cable; until then ${stuck.length === 1 ? 'it goes' : 'they go'} on connecting by address.`));
        }
        for (const old of net.names.filter(n => !n.current)) {
          const using = net.cameras.filter(c => c.reaches_manager_at === old.name), retire = node('button', `Stop answering to ${old.name}`);
          retire.onclick = async () => { if (await concert.sure(`Stop answering to ${old.name}? ${using.length ? `${using.map(c => c.name).join(', ')} still use it and will not be able to connect.` : 'No camera is using it.'}`)) change({ retire: old.name }); };
          networkPanel.append(node('small', `Still answering to an earlier name, ${old.name}${using.length ? `, used by ${using.map(c => c.name).join(', ')}` : ', which no camera is using'}. `), retire);
        }
      }
    }
    const syncPanel = document.querySelector('#obs-sync');
    if (sync && !editing(syncPanel)) {
      syncPanel.replaceChildren(node('h2', 'Timing in OBS'));
      const label = node('label', ''); const box = document.createElement('input'); box.type = 'checkbox'; box.checked = sync.enabled;
      box.onchange = async () => { try { await api('/api/settings/obs-sync', { method: 'POST', body: JSON.stringify({ enabled: box.checked }) }); } catch (error) { result.textContent = error.message; } refresh(); };
      label.append(box, node('span', ' Keep camera feeds aligned in OBS automatically')); syncPanel.append(label);
      const scenesRow = node('p'); scenesRow.append(scenesButton(), ' ', namesButton(), node('small', scenesSaid ? ` ${scenesSaid}` : ' Makes a source, a scene and split screens in OBS for any camera that has none, and gives them the cameras\' names.')); syncPanel.append(scenesRow);
      const states = Object.values(sync.cameras || {}), reading = states.filter(s => s.latency_ms != null);
      let summary = sync.problem ? `OBS sync cannot run: ${sync.problem}.`
        : !reading.length ? 'OBS sync: no camera with a readable timing strip is streaming yet.'
        : `OBS sync: ${reading.filter(s => s.status === 'in sync' || s.status === 'corrected').length} of ${reading.length} streaming cameras aligned · all feeds held ${(sync.target_ms / 1000).toFixed(2)} s behind real life${sync.enabled ? '' : ' · measuring only, not correcting'}`;
      if ((sync.wandering || []).length) summary += ` · ${sync.wandering.map(identifier => cameras.find(c => c.id === identifier)?.name || identifier).join(', ')} wandering: held at a steady delay`;
      const line = node('p', summary); if (sync.problem || reading.some(s => s.status === 'out of sync')) line.className = 'recording-warning'; syncPanel.append(line);
      const audio = document.createElement('input'); audio.type = 'text'; audio.size = 18; audio.placeholder = 'none'; audio.value = sync.audio_input || '';
      const save = node('button', 'Set'); save.onclick = async () => { try { await api('/api/settings/obs-sync', { method: 'POST', body: JSON.stringify({ audio_input: audio.value.trim() || null }) }); result.textContent = audio.value.trim() ? `Soundboard input “${audio.value.trim()}” will be delayed to match the pictures.` : 'No soundboard input is being delayed.'; } catch (error) { result.textContent = error.message; } refresh(); };
      const row = node('label', 'Soundboard audio input in OBS (delayed to match the pictures) '); row.append(audio, save); syncPanel.append(row);
      const most = sync.most_hold_ms || 3000;
      const hold = document.createElement('input'); hold.type = 'number'; hold.min = 0; hold.max = most; hold.step = 100; hold.value = sync.hold_ms || 0; hold.setAttribute('aria-label', 'Look-ahead in milliseconds');
      const holdSaid = node('small', '');
      const holdSet = node('button', 'Set');
      holdSet.onclick = async () => {
        const wanted = Number(hold.value);
        // Said beside the box, not at the foot of the page: a refused number looked like a button that did nothing.
        if (!Number.isFinite(wanted) || wanted < 0 || wanted > most) { holdSaid.textContent = `Enter 0 to ${most} ms.`; holdSaid.className = 'recording-warning'; return; }
        try { await api('/api/settings/obs-sync', { method: 'POST', body: JSON.stringify({ hold_ms: wanted }) }); holdAsked = wanted; hold.blur(); } catch (error) { holdSaid.textContent = error.message; holdSaid.className = 'recording-warning'; return; }
        await refresh();
      };
      hold.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); holdSet.click(); } });
      // What is set, and where the cameras are now: the two differ for a few seconds after a change, and showing only
      // the second made a change that had been taken look as if it had not.
      const where = !sync.target_ms ? '' : holdAsked && Math.abs(sync.target_ms - holdAsked) >= 60 ? `(set to ${holdAsked} ms; the cameras are at ${sync.target_ms} ms and follow within about ten seconds) ` : `(the cameras are at ${sync.target_ms} ms) `;
      if (holdAsked && sync.target_ms && Math.abs(sync.target_ms - holdAsked) < 60) holdAsked = 0;
      const holdRow = node('label', 'Look-ahead: keep the programme at least '); holdRow.append(hold, node('span', ` ms behind real life ${where}`), holdSet, holdSaid, node('small', `0 to ${most}. 0 means no more than the slowest camera needs. More gives the shot chooser longer to look, and to change its mind, before a moment is on air; the recording and stream run that much later, and a shot chosen by hand lands that much ahead of what the audience sees. OBS holds the extra in system memory: at 5000 ms about 1.5 GB for a 4K camera and 0.65 GB for a 1440p one.`)); syncPanel.append(holdRow);
      const called = identifier => cameras.find(c => c.id === identifier)?.name || identifier;
      // A camera that fell well behind after a stall: say so, and count down to the restart of its OBS source.
      for (const [identifier, state] of Object.entries(sync.cameras || {})) if (state.fell_behind_ms) {
        const due = (sync.pending_restarts || []).find(p => p.camera_id === identifier);
        const warn = node('p', `${called(identifier)} has fallen ${state.fell_behind_ms} ms behind its normal. ${due ? `Its OBS source restarts in ${Math.max(0, Math.round(due.at - Date.now() / 1000))} s: about 8 seconds without its picture, so cut away from it now.` : sync.enabled ? 'If it stays behind, its OBS source will be restarted.' : 'Switch automatic alignment on to have its OBS source restarted, or restart that source in OBS by hand.'}`);
        warn.className = 'recording-warning'; syncPanel.append(warn);
      }
      const last = (sync.corrections || []).slice(-1)[0];
      if (last) syncPanel.append(node('small', last.restart ? `Last action ${new Date(last.at * 1000).toLocaleTimeString()}: restarted ${called(last.camera_id)}’s OBS source (it was ${last.was_ms - last.normal_ms} ms behind its normal).`
        : `Last correction ${new Date(last.at * 1000).toLocaleTimeString()}: ${called(last.camera_id)} delay ${last.from_ms} → ${last.to_ms} ms (was ${Math.abs(last.error_ms)} ms ${last.error_ms < 0 ? 'early' : 'late'}).`));
    }
    // One answer, kept current without being asked for: is everything ready? The PC and every camera together.
    const readyPanel = document.querySelector('#ready');
    if (ready && part === '/') {
      readyPanel.replaceChildren(); readyPanel.className = `ready-${ready.state}`;
      const count = ready.worth_checking.length;
      readyPanel.append(node('strong', ready.state === 'ok' ? 'Ready for a show' : ready.state === 'warn' ? `Ready, with ${count} thing${count === 1 ? '' : 's'} worth a look` : 'Not ready'));
      readyPanel.append(node('span', ready.state === 'ok' ? ` · this PC ${ready.cameras ? `and ${ready.cameras === 1 ? 'its camera' : `all ${ready.cameras} cameras`} ` : ''}checked${clocks_set_automatically ? ', clocks kept set' : ''}${ready.cameras ? '' : ' · no cameras paired yet'}` : ''));
      for (const item of ready.stopping) { const line = node('p', `✖ ${item}`); line.className = 'fail'; readyPanel.append(line); }
      if (ready.worth_checking.length) {
        const shown = ready.state === 'fail' || readyOpen;
        for (const item of shown ? ready.worth_checking : []) { const line = node('p', `! ${item}`); line.className = 'warn'; readyPanel.append(line); }
        if (ready.state !== 'fail') { const more = node('button', readyOpen ? 'Hide' : 'Show what'); more.onclick = () => { readyOpen = !readyOpen; refresh(); }; readyPanel.append(more); }
      }
      // A camera OBS has no source for is put right from here.
      if ([...ready.stopping, ...ready.worth_checking].some(item => item.includes('Stream target'))) readyPanel.append(scenesButton());
      if (scenesSaid) readyPanel.append(node('p', scenesSaid));
    }
    // Actions for every camera at once.
    const fleet = document.querySelector('#fleet');
    if (!editing(fleet)) {
      fleet.replaceChildren(node('h2', 'All cameras'));
      // Starting and stopping apart, the stops in red on a row of their own, so that one is not pressed for the other.
      for (const [heading, actions] of [['Start', FLEET.filter(a => !a.danger)], ['Stop', [...FLEET.filter(a => a.danger)].sort((a, b) => FLEET.indexOf(b) - FLEET.indexOf(a))]]) {
        const row = node('div', ''); row.className = `fleet-row ${heading.toLowerCase()}`; row.setAttribute('role', 'group'); row.setAttribute('aria-label', `${heading} on every camera`);
        row.append(node('span', heading));
        for (const action of actions) {
          const count = cameras.filter(action.targets).length;
          const button = node('button', count ? `${action.label} (${count})` : action.label);
          if (action.danger) button.className = 'danger';
          button.disabled = !count || fleetBusy;
          button.title = count ? cameras.filter(action.targets).map(c => c.name).join(', ') : 'No camera needs this right now';
          button.onclick = () => fleetAction(action, cameras);
          row.append(button);
        }
        fleet.append(row);
      }
      const online = cameras.filter(c => c.online);
      fleet.append(node('p', fleetBusy ? (fleetNote || 'Working…') : `${online.length} of ${cameras.length} cameras online · armed ${online.filter(armedNow).length} · streaming ${online.filter(streamingNow).length} · recording ${online.filter(c => c.telemetry?.recording).length}`));
      // Coolers, all at once: forget them all, or let every phone go of its own and give each cooler to the phone that hears
      // it loudest (the one it is clamped to). The work is the manager's; this shows how it goes and what it did.
      const cooled = cameras.filter(c => c.telemetry?.capabilities?.cooler);
      if (role === 'admin' && cooled.length) {
        try { coolerJob = await api('/api/coolers/job'); } catch (error) { /* the last one known stands */ }
        const running = coolerJob?.state === 'running';
        const row = node('div', ''); row.className = 'fleet-row coolers'; row.setAttribute('role', 'group'); row.setAttribute('aria-label', 'Coolers on every camera');
        row.append(node('span', 'Coolers'));
        const start = async (action, question) => {
          if (!await concert.sure(question, { ok: action === 'repair' ? 'Re-pair' : 'Forget all', danger: action === 'forget' })) return;
          try { coolerJob = await api(`/api/coolers/${action}`, { method: 'POST', body: '{}' }); } catch (error) { result.textContent = error.message; }
          refresh();
        };
        const repair = node('button', 'Re-pair all coolers'); repair.disabled = running;
        repair.title = 'Every phone lets go of its cooler and looks for 10 s; each cooler then goes to the phone that hears it loudest. Phones streaming or recording keep theirs.';
        repair.onclick = () => start('repair', `Re-pair all coolers?\n\nEvery phone that is not streaming or recording lets go of its cooler and looks for 10 seconds. Each cooler then goes to the phone that hears it loudest, which is the one it is clamped to. It takes about half a minute.\n\nSwitch every cooler on and close the Black Shark app on the phones first.`);
        const forget = node('button', 'Forget all coolers'); forget.className = 'danger'; forget.disabled = running;
        forget.title = 'Every phone lets go of its cooler (an offline one, when it is next connected).';
        forget.onclick = () => start('forget', `Forget all coolers?\n\nEvery phone lets go of its cooler; one that is offline does when it is next connected. A phone does not take back the cooler it let go of.`);
        row.append(repair, forget);
        fleet.append(row);
        if (coolerJob?.state) {
          const word = coolerJob.kind === 'repair' ? 'Re-pairing coolers' : 'Forgetting coolers';
          const lines = [running ? `${word}: ${coolerJob.step || 'working'}…` : `${word}: ${coolerJob.state === 'done' ? 'done' : 'failed'}`];
          for (const d of coolerJob.done || []) lines.push(d.cooler ? `${d.camera}: ${d.name || 'cooler'} ${d.cooler.slice(-5)} (${d.how})` : coolerJob.kind === 'repair' ? `${d.camera}: no cooler heard` : `${d.camera}: let go`);
          for (const s of coolerJob.skipped || []) lines.push(`Left as it was: ${s}`);
          for (const f of coolerJob.failed || []) lines.push(`FAILED: ${f}`);
          if (coolerJob.unclaimed?.length) lines.push(`Heard but given to no phone: ${coolerJob.unclaimed.join(', ')}`);
          const note = node('pre', lines.join('\n')); note.className = coolerJob.failed?.length ? 'recording-warning' : 'activity done'; fleet.append(note);
        }
      }
      if (fleetNote && !fleetBusy) { const note = node('p', fleetNote); note.className = fleetNote.includes('FAILED') || fleetNote.includes('Not included') ? 'recording-warning' : 'activity done'; fleet.append(note); }
    }
    // The recordings on this PC: the programme, each camera's own file of it with the edit, and the colour LUTs that go with them.
    const pcPanel = document.querySelector('#pc-recordings');
    if (director && !pcPanel.hidden && !editing(pcPanel)) {
      let colour = null;
      if (!operator) try { colour = await api('/api/colour'); } catch (error) { colour = null; }
      const clock = seconds => `${Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)}:` : ''}${String(Math.floor(seconds / 60) % 60).padStart(Math.floor(seconds / 3600) ? 2 : 1, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
      pcPanel.replaceChildren(node('h2', 'Programme recordings'));
      const where = node('p', `OBS records the programme into ${director.folder}. Recording is started and stopped on the `); const showLink = document.createElement('a'); showLink.href = '/'; showLink.textContent = 'Show page'; where.append(showLink, node('span', '.')); pcPanel.append(where);
      if (director.recording) { const now = node('p', `Recording now: ${clock(director.recording.seconds)} · ${(director.recording.bytes / 1048576).toFixed(0)} MiB · ${director.recording.cuts} shot(s) logged`); now.className = 'activity running'; pcPanel.append(now); }
      const finished = [...(director.finished || [])].reverse();
      if (!finished.length) pcPanel.append(node('p', 'No programme has been recorded since the manager last started. The last five are listed here.'));
      for (const done of finished) {
        const item = node('article', ''); item.className = 'recording-item';
        item.append(node('h3', (done.file || '').split('/').pop() || 'Recording'));
        const summary = node('p', done.ok ? `${done.stopped ? `${new Date(done.stopped * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · ` : ''}${clock(done.seconds || 0)} · ${((done.bytes || 0) / 1048576).toFixed(0)} MiB · ${done.video}${done.audio ? ` + ${done.audio} sound` : ' · NO SOUND TRACK'} · ${done.cuts} shot(s) in its cut log` : `This recording has a problem: ${done.detail}`);
        summary.className = done.ok && done.audio ? 'activity done' : 'recording-warning'; item.append(summary, node('small', done.file));
        if (done.cut_log) item.append(node('small', `Cut log: ${done.cut_log}`));
        const files = done.camera_files;
        if (files) {
          const problems = Object.entries(files.problems || {});
          const line = node('p', files === 'being made' || files.state === 'making' ? 'Each camera’s own file of it, and the edit (EDL), are being made…'
            : files.state === 'made' ? `Camera files: ${files.cameras} in “${files.folder}”, with the cuts as an edit in ${files.edl}${problems.length ? `. Not made: ${problems.map(([name, why]) => `${name} (${why})`).join('; ')}` : ''}.`
            : `The camera files could not be made: ${files.problem}`);
          if (files.state === 'failed' || problems.length) line.className = 'recording-warning';
          item.append(line);
        } else item.append(node('small', 'No camera files: camera files (below) were off while it was recorded.'));
        pcPanel.append(item);
      }
      if (colour) {
        const graded = colour.cameras.filter(c => c.calibration), link = document.createElement('a'); link.href = '/colour'; link.textContent = 'Colour page';
        const line = node('p', graded.length ? `${graded.map(c => c.name).join(', ')} ${graded.length === 1 ? 'has a LUT' : 'have LUTs'} from a colour chart, copied beside ${graded.length === 1 ? 'its' : 'their'} camera files so the edit can match the programme. Calibrate on the `
          : 'No camera has been calibrated from a colour chart, so camera files come without a LUT. Calibrate on the ');
        line.append(link, node('span', '.')); pcPanel.append(node('h3', 'Colour LUTs'), line);
      }
    }
    // Battery protection: each charging phone holds its battery short of full where it can, which keeps it cooler. On by default.
    const batteryPanel = document.querySelector('#battery');
    if (battery_protect !== undefined && !editing(batteryPanel)) {
      batteryPanel.replaceChildren(node('h3', 'Battery protection'));
      const label = node('label', ''); const box = document.createElement('input'); box.type = 'checkbox'; box.checked = !!battery_protect;
      box.onchange = async () => { try { await api('/api/settings/battery-protection', { method: 'POST', body: JSON.stringify({ enabled: box.checked }) }); } catch (error) { result.textContent = error.message; } refresh(); };
      label.append(box, node('span', ' While a phone is charging (on its Ethernet hub, say), hold its battery at about 80–85% instead of full'));
      batteryPanel.append(label, node('small', ' A battery charged to full adds to a camera’s heat over a long show, and kept full and hot it wears out fastest. Each phone uses its own charge limit, switched on after 30 s on power, and gets its own setting back 2 minutes after it is unplugged. Phones are allowed to do this when set up over USB.'));
      const said = c => {
        const g = c.telemetry?.battery_protection;
        if (!g) return 'needs a newer app';
        if (!g.supported) return `not possible: ${g.why_not}`;
        if (!g.allowed) return 'not allowed yet: run its set-up again over USB';
        if (g.error) return `failed: ${g.error}`;
        if (g.effect === 'not_holding') return `on, but still charging past ${g.limit_percent}%`;
        const how = `${g.method}${g.verified ? '' : ', unconfirmed on this Android'}`;
        return g.on === true ? `on (${how})${g.effect === 'holding' ? ', holding' : ''}` : g.on_power ? `switching on (${how})` : `can (${how}); not charging now`;
      };
      if (paired.length) { const list = node('ul', ''); for (const c of paired) list.append(node('li', `${c.name}: ${said(c)}`)); batteryPanel.append(list); }
    }
    // Silence while armed: each phone's microphone feeds the show, so the phone itself plays nothing. On by default.
    const silencePanel = document.querySelector('#silence');
    if (phone_silence !== undefined && !editing(silencePanel)) {
      silencePanel.replaceChildren(node('h3', 'Silence while armed'));
      const label = node('label', ''); const box = document.createElement('input'); box.type = 'checkbox'; box.checked = !!phone_silence;
      box.onchange = async () => { try { await api('/api/settings/phone-silence', { method: 'POST', body: JSON.stringify({ enabled: box.checked }) }); } catch (error) { result.textContent = error.message; } refresh(); };
      label.append(box, node('span', ' While a phone is armed, keep it from playing any sound or vibrating: no notifications, calls, alarms, key or charging sounds'));
      silencePanel.append(label, node('small', ' Its microphone feeds the show, so anything the phone plays could be heard in the recording. Each phone switches Do Not Disturb to total silence and mutes its sounds as it arms (as device owner), turns touch vibration off where it was set up over USB, and gets its owner’s settings back 10 s after it is disarmed. Recording is not affected.'));
      const said = c => {
        const q = c.telemetry?.phone_silence;
        if (!q) return 'needs a newer app';
        if (!q.can?.do_not_disturb) return `cannot: ${q.missing}`;
        if (q.error) return `failed: ${q.error}`;
        const vibration = q.can.touch_vibration ? '' : '; touch vibration stays on (set it up again over USB)';
        if (!q.armed) return `ready, not armed${vibration}`;
        return (q.silenced ? 'silenced' : q.level === 'partly' ? 'partly silenced' : 'not silenced') + vibration;
      };
      if (paired.length) { const list = node('ul', ''); for (const c of paired) list.append(node('li', `${c.name}: ${said(c)}`)); silencePanel.append(list); }
    }
    // Which app version the manager offers, and whether cameras take it by themselves.
    const panel = document.querySelector('#release');
    if (!editing(panel)) {
      panel.replaceChildren(node('h3', 'Camera app'));
      if (release === undefined) { /* manager not yet restarted with update support */ }
      else if (!release) {
        panel.append(node('p', 'App updates: no release published. Bring the newest build from GitHub below, or publish a file with the manager’s “release” command.'));
        // With nothing published to compare against, still say when the cameras differ from each other.
        const seen = [...new Set(cameras.map(c => c.app?.version_name || 'not reported'))];
        if (seen.length > 1) { const warn = node('p', `Cameras are on different app versions: ${cameras.map(c => `${c.name} ${c.app?.version_name || 'not reported'}`).join('; ')}.`); warn.className = 'recording-warning'; panel.append(warn); }
      }
      else {
        const behind = cameras.filter(c => c.app?.update_available).length;
        panel.append(node('p', `App release offered to cameras: ${release.version_name} · ${behind ? `${behind} camera(s) not on it yet` : 'all paired cameras are on it'}`));
        const odd = cameras.filter(c => versionOf(c, release).mismatch);
        if (odd.length) { const warn = node('p', `App version mismatch: ${odd.map(c => `${c.name} is on ${c.app?.version_name || 'an older, unreported version'}`).join('; ')}. Published: ${release.version_name}.`); warn.className = 'recording-warning'; panel.append(warn); }
        const label = node('label', ''); const box = document.createElement('input'); box.type = 'checkbox'; box.checked = !!app_auto_update;
        box.onchange = async () => { try { await api('/api/settings/app-auto-update', { method: 'POST', body: JSON.stringify({ enabled: box.checked }) }); } catch (error) { result.textContent = error.message; } refresh(); };
        label.append(box, node('span', ' Update unarmed cameras automatically, one at a time')); panel.append(label);
        // Update now: every camera that can take the release without interrupting a stream or recording.
        const ready = cameras.filter(c => c.online && c.app?.can_update), waiting = cameras.filter(c => c.app?.update_available && !(c.online && c.app?.can_update));
        const all = node('button', ready.length ? `Update ${ready.length} camera${ready.length === 1 ? '' : 's'} now` : 'Update cameras now');
        all.disabled = !ready.length || updatingAll;
        all.onclick = async () => {
          if (!await concert.sure(`Update ${ready.map(c => c.name).join(', ')} to ${release.version_name} now, one after another? Each disarms, disconnects for about half a minute and comes back unarmed.`)) return;
          updatingAll = true; refresh();
          const failures = [];
          for (const camera of ready) { const failure = await updateCamera(camera, release, false); if (failure) { failures.push(`${camera.name}: ${failure}`); break; } }
          updatingAll = false;
          result.textContent = failures.length ? `Update stopped. ${failures.join('; ')}` : `Updated ${ready.length} camera(s) to ${release.version_name}.`;
          refresh();
        };
        panel.append(all);
        if (!ready.length && !waiting.length) panel.append(node('small', ' Nothing to update: every paired camera is on this release.'));
        for (const camera of waiting) panel.append(node('small', ` ${camera.name}: ${!camera.online ? 'offline' : camera.app.blocked_reason || 'not ready'}.`));
        if (release.halted) { const stop = node('p', `Automatic updates are paused for this release: ${release.halted}. Check that camera, then untick and tick the box to continue.`); stop.className = 'recording-warning'; panel.append(stop); }
      }
      // Bringing a newer app from GitHub: looking is one button, publishing another, because the cameras start taking a published release.
      if (!operator && release !== undefined) {
        const look = node('button', githubBusy ? 'Working…' : 'Check GitHub for a newer app'); look.disabled = githubBusy;
        look.onclick = async () => { githubBusy = true; refresh(); try { githubApp = await api('/api/app-release/github'); } catch (error) { githubApp = { problem: error.message }; } githubBusy = false; refresh(); };
        panel.append(look);
        if (githubApp?.problem) { const said = node('p', `Could not check GitHub: ${githubApp.problem}`); said.className = 'recording-warning'; panel.append(said); }
        else if (githubApp && !githubApp.newest) panel.append(node('small', ' GitHub has no app release yet.'));
        else if (githubApp && !githubApp.newer) panel.append(node('small', ` Newest on GitHub: ${githubApp.newest.tag}. The manager already offers it.`));
        else if (githubApp) {
          const tag = githubApp.newest.tag, when = new Date(githubApp.newest.published_at).toLocaleString();
          const publish = node('button', `Publish ${tag} to the cameras`); publish.disabled = githubBusy;
          publish.onclick = async () => {
            const then = app_auto_update ? 'Automatic updates are on: unarmed cameras start taking it, one at a time, within a minute. Cameras that are streaming or recording wait.' : 'Automatic updates are off: cameras take it when you press “Update cameras now”.';
            if (!await concert.sure(`Publish ${tag} as the app offered to the cameras? ${then}`)) return;
            githubBusy = true; refresh();
            try { const done = await api('/api/app-release/github', { method: 'POST', body: JSON.stringify({ tag }) }); result.textContent = `Published app ${done.published.version_name} from ${tag}.`; githubApp = null; }
            catch (error) { result.textContent = error.message; }
            githubBusy = false; refresh();
          };
          panel.append(node('p', `GitHub has a newer app: ${tag}, built ${when}${githubApp.published ? `; the cameras are offered ${githubApp.published.version_name}` : ''}.`), publish);
        }
      }
    }
    const alerts = document.querySelector('#recording-alerts'); alerts.replaceChildren();
    for (const camera of cameras) {
      if (camera.telemetry?.recording_warning) {
        const alert = node('p', `${camera.name}${camera.online ? '' : ' (last reported)'}: ${camera.telemetry.recording_warning}`);
        alert.className = 'recording-warning'; alerts.append(alert);
      }
      const heat = heatMessage(camera);
      if (heat && (heatOf(camera).level !== 'warm' || !camera.online)) { const alert = node('p', `${camera.name} ${heat}`); alert.className = 'recording-warning'; alerts.append(alert); }
    }
    // Band profiles: who is where on stage, kept by name and loaded in one step when the same band is back.
    const bandPanel = document.querySelector('#bands');
    if (part === '/cameras' && !editing(bandPanel)) {
      let kept = null; try { kept = await api('/api/bands'); } catch (error) { kept = null; }
      if (kept) {
        const ask = async (body, said) => { try { const answer = await api('/api/bands', { method: 'POST', body: JSON.stringify(body) }); bandSaid = said ? said(answer) : ''; return answer; } catch (error) { bandSaid = error.message; return null; } finally { refresh(); } };
        const loaded = kept.bands.find(band => band.id === kept.loaded);
        const profile = words().profile; bandPanel.replaceChildren(node('h2', capital(profile)));
        bandPanel.append(node('p', loaded ? `Set up for ${loaded.name}${kept.changed ? ', with changes made since that are not saved to it' : ''}.` : kept.bands.length ? `No ${profile} profile is loaded. Load one, or set the cameras up below and save it as one.` : `Set up what each camera shows below, then save it as a ${profile} profile to bring it back in one step next time.`));
        if (kept.bands.length) {
          const pick = document.createElement('select'); pick.setAttribute('aria-label', `${capital(profile)} profile`);
          for (const band of kept.bands) { const option = document.createElement('option'); option.value = band.id; option.textContent = `${band.name} · ${band.cameras} camera${band.cameras === 1 ? '' : 's'}${band.instruments.length ? `: ${band.instruments.map(key => (director?.instruments || []).find(i => i[0] === key)?.[1] || director?.role_names?.[key] || key.replace(/^custom:/, '')).join(', ')}` : ''}`; option.selected = band.id === (bandPicked || kept.loaded || kept.bands[0].id); pick.append(option); }
          pick.onchange = () => { bandPicked = pick.value; };
          const chosen = () => kept.bands.find(band => band.id === pick.value);
          const load = node('button', 'Load'); load.onclick = async () => { const band = chosen(); if (!kept.changed && !loaded || await concert.sure(`Set the cameras up for ${band.name}? What each camera shows, the stage picture and the zoom choices are replaced. How they are now is kept as a restore point.`)) ask({ load: band.id }, answer => `Set up for ${answer.loaded.name}.${answer.loaded.left_out ? ` ${answer.loaded.left_out} thing${answer.loaded.left_out === 1 ? '' : 's'} in the profile ${answer.loaded.left_out === 1 ? 'is' : 'are'} for cameras this location no longer has, and ${answer.loaded.left_out === 1 ? 'was' : 'were'} left out.` : ''}`); };
          const over = node('button', 'Save over it'); over.onclick = async () => { const band = chosen(); if (await concert.sure(`Replace the profile for ${band.name} with how the cameras are set up now?`)) ask({ save_over: band.id }, () => `Saved over ${band.name}.`); };
          const rename = node('button', 'Rename'); rename.onclick = async () => { const band = chosen(); const got = await concert.ask({ title: `Rename this ${profile} profile`, fields: [{ name: 'name', label: 'Name', value: band.name }], ok: 'Rename' }); const name = got?.name?.trim(); if (name && name !== band.name) ask({ rename: { id: band.id, name } }); };
          const remove = node('button', 'Remove'); remove.className = 'danger'; remove.onclick = async () => { const band = chosen(); if (await concert.sure(`Remove the ${profile} profile for ${band.name}? The cameras stay set up as they are; only the saved profile goes.`)) { bandPicked = ''; ask({ remove: band.id }, () => `Removed the profile for ${band.name}.`); } };
          const row = node('div', ''); row.append(pick, load, over, rename, remove); bandPanel.append(row);
        }
        const name = document.createElement('input'); name.type = 'text'; name.maxLength = 60; name.placeholder = `${capital(profile)} name`; name.setAttribute('aria-label', `Name for a new ${profile} profile`);
        const save = node('button', `Save as a new ${profile} profile`); save.onclick = async () => { if (!name.value.trim()) { bandSaid = `Give the ${profile} profile a name.`; refresh(); return; } const done = await ask({ save: name.value.trim() }, () => `Saved as ${name.value.trim()}.`); if (done) { bandPicked = ''; name.value = ''; name.blur(); refresh(); } };
        name.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); save.click(); } });
        const saveRow = node('div', ''); saveRow.append(name, save); bandPanel.append(saveRow);
        bandPanel.append(node('small', `A ${profile} profile keeps what each camera shows, its solo zoom, the stage picture, the ${words().crowd} camera, the default shot, the zoom choices and your wishes for the shots. It belongs to this location, since it is written in terms of its cameras. The kind of event is not part of it: that is chosen under the name in the side bar.`));
        if (bandSaid) { const line = node('p', bandSaid); if (/already|No such|Give /.test(bandSaid)) line.className = 'recording-warning'; bandPanel.append(line); }
      }
    }
    // Every paired camera, in use here or not: where a camera is set aside, brought back or removed.
    const pairedPanel = document.querySelector('#paired-cameras');
    if (pairedPanel && !editing(pairedPanel)) {
      pairedPanel.replaceChildren(node('h3', 'Paired cameras'));
      if (!paired.length) pairedPanel.append(node('p', 'No cameras are paired at this location yet.'));
      for (const camera of paired) {
        const row = node('div', ''); row.className = 'paired-camera';
        row.append(node('span', `${camera.name} · slot ${camera.slot} · ${camera.online ? 'connected' : 'offline'}${camera.in_use === false ? ' · not in use here' : ''}`));
        if (role === 'admin') row.append(renameButton(camera), asideButton(camera), removeButton(camera));
        pairedPanel.append(row);
      }
      pairedPanel.append(node('small', 'A camera this location does not use is set aside: it stays paired, for another location or another time. Removing a camera unpairs it for good; its recordings stay.'));
    }
    const grid = document.querySelector('#cameras');
    window.studioCameras = cameras;                  // for Creator Studio's preview (creator.js)
    if (editing(grid)) return;
    grid.replaceChildren();
    if (document.activeElement !== document.querySelector('#camera-capacity')) document.querySelector('#camera-capacity').value = camera_capacity;
    for (let slot = 1; slot <= camera_capacity; slot++) {
      const camera = paired.find(c => c.slot === slot);
      if (camera?.in_use === false) continue;              // set aside here: in the short list below, not a card
      const card = node('article', '');
      card.append(node('h2', camera ? camera.name : `Camera ${slot} — not paired`));
      // What is needed during a show stays in view; the rest is folded into groups, each opened when wanted.
      const key = camera ? camera.id : `slot-${slot}`;
      const shots = fold(`${key}:shows`, 'What it shows'), picture = fold(`${key}:picture`, 'Picture & stream'), upkeep = fold(`${key}:upkeep`, 'Maintenance');
      if (camera && director?.event_mode?.mode === 'creator') {
        // Creator Studio: the user's own framings, how close and whom this camera follows (creator.js). The administrator's.
        if (concert.role === 'admin' && window.studioCard) window.studioCard(camera, shots);
        else shots.append(node('small', 'This camera follows the framings the administrator set up for it.'));
      } else if (camera && concert.role === 'admin') {
        // Particular people, rather than instruments: reference pictures of consenting performers, on the People page.
        const people = node('small', 'Particular performers, and stars: '); const go = document.createElement('a'); go.href = '/people'; go.textContent = 'reference pictures and who this camera follows (People)';
        people.append(go); shots.append(people);
      }
      // Voice shot calls: what the host can say to put this camera on air (voice.js).
      if (camera && window.voiceCard) window.voiceCard(camera, shots);
      if (camera && director && director.event_mode?.mode !== 'creator') {
        // What this camera is there to show: the model rates it by whether that performer is playing in its picture, and the zoom looks for them.
        const direct = async body => { try { await api('/api/director', { method: 'POST', body: JSON.stringify(body) }); } catch (error) { result.textContent = error.message; } refresh(); };
        if (camera.id === director.crowd_camera) shots.append(node('small', `This is the ${words().crowd} camera: it shows the ${words().crowd}, by its own rules.`));
        else {
          // What it shows: eight places, each a list of instruments (or, in another kind of event, roles). "Other" lets one be typed in that is not on the list.
          const shows = node('div', 'Shows'), given = director.camera_focus?.[camera.id] || [];
          const label = key => (director.instruments || []).find(i => i[0] === key)?.[1] || director.role_names?.[key] || (key.startsWith('custom:') ? key.slice(7) : key);
          const places = node('div', ''); places.className = 'instrument-places';
          const set = (place, value) => {
            const next = [...given]; if (value) next[Math.min(place, next.length)] = value; else next.splice(place, 1);
            direct({ camera_focus: { [camera.id]: [...new Set(next.filter(Boolean))] } });
          };
          for (let place = 0; place < 8; place++) {
            const pick = document.createElement('select'), here = given[place] || ''; pick.setAttribute('aria-label', `${capital(words().role)} ${place + 1}`);
            pick.disabled = place > given.length;                    // filled in order: the next empty place is the one to use
            const offered = (director.instruments || []).filter(i => i[0] === here || !given.includes(i[0]));
            if (here && !here.startsWith('custom:') && !offered.some(i => i[0] === here)) offered.push([here, label(here)]);     // given in another kind of event: kept
            const choices = [['', place === 0 && !given.length ? words().anyone : here ? 'remove' : '—'], ...offered];
            if (here.startsWith('custom:')) choices.push([here, label(here)]);
            choices.push(['other', 'other: type a name…']);
            for (const [value, text] of choices) { const option = document.createElement('option'); option.value = value; option.textContent = text; option.selected = value === here; pick.append(option); }
            pick.onchange = async () => {
              if (pick.value !== 'other') { set(place, pick.value); return; }
              const got = await concert.ask({ title: `Another ${words().role}`, fields: [{ name: 'name', label: `Name of the ${words().role} this camera shows (for example: ${words().example})` }], ok: 'Use it' });
              const typed = (got?.name || '').trim().replace(/\s+/g, ' ');
              if (!typed) { pick.value = here; return; }
              if (typed.length > 30 || !/^[\p{L}\p{N} '&/+.-]+$/u.test(typed) || !/\p{L}/u.test(typed)) { result.textContent = `A name of ${words().role === 'instrument' ? 'an instrument' : 'a ' + words().role} is letters and digits, 30 characters at most.`; pick.value = here; return; }
              set(place, `custom:${typed}`);
            };
            places.append(pick);
          }
          shows.append(places);
          if (given.some(key => key.startsWith('custom:'))) shows.append(node('small', words().named ? words().named : director.event_mode?.music === false ? `A ${words().role} you named is looked for in the picture; give the camera its microphone to have it chosen when that person talks.` : 'An instrument you named is looked for in the picture, but cannot be listened for: solos are only heard for instruments on the list.'));
          const isWide = given.some(key => (director.wide_roles || ['band']).includes(key)) || given.length > 2;
          if (isWide) shows.append(node('small', 'A wide camera: shown whole, never zoomed in, and favoured when the whole group has the moment.'));
          const solo = node('label', 'During a solo, zoom in on '), soloPick = document.createElement('select'); soloPick.disabled = !director.zoom || !given.length || isWide;
          const chosen = director.camera_solo_focus?.[camera.id] ?? (director.solo_focus || '');
          for (const [value, text] of [['', 'the same as usual'], ['face_hands', 'the face and hands together'], ['hands', 'the hands'], ['face', 'the face'], ['chest', 'head and chest'], ['waist', 'head to waist'], ['person', 'the whole person']]) { const option = document.createElement('option'); option.value = value; option.textContent = text; option.selected = chosen === value; soloPick.append(option); }
          soloPick.onchange = () => direct({ camera_solo_focus: { [camera.id]: soloPick.value } });
          solo.append(soloPick);
          shows.className = solo.className = 'card-setting';
          shots.append(shows);
          if (director.event_mode?.music !== false) shots.append(solo);           // no music, no solos
          if (director.talk && director.event_mode?.speaking) {
            // Its person's microphone on the mixer: the camera is chosen while they talk into it.
            const mic = node('label', 'Microphone on the mixer '), micPick = document.createElement('select'), own = director.talk.mics?.[camera.id] || '';
            for (const [value, text] of [['', 'none'], ...Array.from({ length: 16 }, (_, n) => [n + 1, `channel ${n + 1}`])]) { const option = document.createElement('option'); option.value = value; option.textContent = text; option.selected = String(own) === String(value); micPick.append(option); }
            micPick.onchange = () => direct({ talk: { mics: { [camera.id]: micPick.value ? Number(micPick.value) : null } } });
            mic.append(micPick); mic.className = 'card-setting'; shots.append(mic);
          }
          // Where a camera with this role is best put (a kitchen's: overhead for the board, low for the oven).
          for (const key of given) if (director.event_mode?.places?.[key]) shows.append(node('small', `${label(key)}: ${director.event_mode.places[key]}`));
          if (!given.length) shots.append(node('small', words().give ? words().give : director.event_mode?.music === false ? `Give it a ${words().role} so the model knows whom it shows.` : director.event_mode?.mode && director.event_mode.mode !== 'concert' ? 'Give it a role or an instrument so the model knows whom it shows, and solos favour it.' : 'Give it an instrument to have solos on that instrument favour this camera.'));
          // The folded group says what is set, so it need not be opened to know.
          shots.querySelector('summary').append(node('span', ` · ${given.length ? given.map(label).join(', ') : words().anyone}`));
          // Its telephoto, for tight shots: changed only while the camera is off air, and held out of the choosing until the new picture is in OBS.
          const lens = director.lenses?.[camera.id];
          if (lens?.telephoto) {
            const tele = node('label', ''), teleBox = document.createElement('input'); teleBox.type = 'checkbox'; teleBox.checked = lens.allowed; teleBox.disabled = !director.zoom || isWide;
            teleBox.onchange = () => direct({ camera_telephoto: { [camera.id]: teleBox.checked } });
            tele.append(teleBox, node('span', ` Use its ${lens.telephoto.replace(/ only$/, '')} lens for tight shots (changed only while off air)`));
            tele.className = 'card-setting'; shots.append(tele);
          }
          if (lens) {
            const said = lens.changing ? `changing to ${lens.changing.to} (${lens.changing.seconds} s): not chosen until its picture is in OBS` : lens.failed ? `the telephoto did not work: ${lens.failed}` : lens.by_director && lens.reason ? lens.reason : '';
            const tag = node('p', `Lens: ${lens.lens}${lens.by_director ? ', chosen by the director' : ''}${said ? ` · ${said}` : ''}`);
            tag.className = lens.failed ? 'app-version recording-warning' : 'app-version';
            // A lens that is changing or failed matters now; otherwise it is detail.
            (lens.changing || lens.failed ? card : shots).append(tag);
          }
        }
      }
      if (camera) {
        const t = camera.telemetry || {};
        // Its state in one line, then what it is doing and whether it is ready.
        const state = node('p', `${camera.online ? 'Online' : 'Offline (last reported state)'} · ${t.camera_state || 'Unknown'}${t.armed ? ' · armed' : ''}${t.streaming || t.capture?.streamRequested ? ' · streaming' : ''}${t.recording ? ' · RECORDING' : ''}`);
        state.className = `camera-state ${camera.online ? 'online' : 'offline'}`; card.append(state);
        const line = node('p', ''); line.className = 'activity'; line.dataset.camera = camera.id; line.hidden = true; card.append(line);
        const ready = readinessPanel(camera); if (ready) card.append(ready);
        // Anything wrong is said on the card itself, never folded away.
        if (t.recording_warning) { const warning = node('p', t.recording_warning); warning.className = 'recording-warning'; card.append(warning); }
        if (t.last_error) card.append(node('p', t.last_error));
        if (Math.abs(t.clock_skew_ms ?? 0) > 30000) { const skew = node('p', `Phone clock differs from this computer by ${Math.round(t.clock_skew_ms / 1000)} s. Recording timestamps will be off; correct the phone date/time.`); skew.className = 'recording-warning'; card.append(skew); }
        if (t.locked_since_boot) { const locked = node('p', 'Phone has not been unlocked since it started: streaming can be controlled, local recording and offload wait for the screen lock.'); locked.className = 'recording-warning'; card.append(locked); }
        // Each camera must send to its own OBS input. A phone first armed from here, before
        // ever being armed on its own screen, used the first camera's port until app 0.7.4.
        const sendingTo = t.capture?.srtPort;
        if (Number.isInteger(sendingTo) && sendingTo > 0 && sendingTo !== camera.srt_port) { const wrong = node('p', `This camera is sending to UDP ${sendingTo}, but its OBS input is UDP ${camera.srt_port}. Press “Send to UDP ${camera.srt_port}” under Picture & stream.`); wrong.className = 'recording-warning'; card.append(wrong); }
        if (recordsWithStream(camera)) { const auto = node('p', 'Start SRT would also start a local recording on this camera, because it was armed on the phone with app 0.7.6. Press Arm to turn that off.'); auto.className = 'recording-warning'; card.append(auto); }
        const heat = heatPanel(camera); if (heat) card.append(heat);
        const storage = camera.storage || {};
        // At a glance: what it sends, its battery, its network and its room; what it has not said is left out.
        const glance = [t.resolution, t.encoder_fps != null && `${Math.round(t.encoder_fps)} fps`, t.video_bitrate_mbps != null && `${t.video_bitrate_mbps} Mbps`,
          t.battery_percent != null && `battery ${t.battery_percent}%${t.battery_charging === false ? ' (not charging)' : ''}`,
          t.network === 'ethernet' ? 'wired Ethernet' : t.wifi_rssi_dbm != null && `Wi-Fi ${t.wifi_rssi_dbm} dBm`,
          Number.isFinite(storage.free_bytes) && `${bytes(storage.free_bytes)} free${Number.isFinite(storage.estimated_seconds_to_full) ? `, about ${duration(storage.estimated_seconds_to_full)} of recording` : ''}`].filter(Boolean);
        card.append(node('p', glance.length ? glance.join(' · ') : 'No readings from it yet.'));
        // The capture controls, in the order they are used; the ones that interrupt are last and red.
        const controls = node('div', ''); controls.className = 'camera-controls';
        const capturing = t.recording || t.streaming || t.capture?.streamRequested;
        const command = (label, command, danger) => {
          const button = node('button', label); button.disabled = !camera.online || busy.has(camera.id); if (danger) button.className = 'danger';
          const clockOff = ['stream.start', 'recording.start'].includes(command) && t.capabilities?.time_sync && typeof camera.clock_offset_ms === 'number' && Math.abs(camera.clock_offset_ms) > 20;
          button.onclick = () => clockOff ? sequence(camera, [['Sync clock', 'time.sync'], [label, command]], label)
            : send(camera, command, command === 'camera.arm' && t.capabilities?.stream_only_arm ? { local_recording: false } : {}, label);
          return button;
        };
        controls.append(command('Arm', 'camera.arm'), command('Start SRT', 'stream.start'), command('Start local MP4', 'recording.start'),
          command('Finalize local MP4', 'recording.stop', true), command('Stop SRT', 'stream.stop', true), command('Disarm', 'camera.disarm', true));
        card.append(controls);
        // Local recording is a deliberate step: say so.
        if (t.armed && !t.recording && !recordsWithStream(camera)) card.append(node('small', 'Not recording locally. Recording starts only when you press “Start local MP4”.'));

        // Picture & stream: how it captures and sends.
        const latency = document.createElement('select');
        latency.setAttribute('aria-label', 'Requested SRT latency');
        for (const [label, ms] of [['Stable: 200 ms', 200], ['Balanced: 120 ms', 120], ['Low Latency: 80 ms', 80]]) {
          const option = node('option', label); option.value = ms; option.selected = ms === (t.capture?.srtLatencyMs ?? 80); latency.append(option);
        }
        latency.disabled = !camera.online || busy.has(camera.id) || capturing || (t.armed !== false && !t.capabilities?.idle_settings);
        latency.onchange = () => send(camera, 'settings.update', { latency_ms: Number(latency.value) }, 'Change latency');
        const latencyRow = node('label', 'Latency '); latencyRow.append(latency);
        picture.append(latencyRow, node('small', 'Stop SRT and local recording to change latency, then match the OBS listener.'));
        // Stream picture size. Larger pictures cost heat on the phone and Wi-Fi for everyone.
        if (t.capabilities?.video_heights) {
          const sizes = { 1080: ['1080p · 7 Mbps', 7], 1440: ['1440p · 12 Mbps', 12], 2160: ['4K · 25 Mbps', 25] };
          const size = document.createElement('select'); size.setAttribute('aria-label', 'Stream picture size');
          for (const height of t.capabilities.video_heights) if (sizes[height]) { const option = node('option', sizes[height][0]); option.value = height; option.selected = height === (t.video_height ?? 1080); size.append(option); }
          size.disabled = !camera.online || busy.has(camera.id) || capturing;
          size.onchange = async () => {
            const height = Number(size.value);
            // What this PC would make of it, from what is measured now: the video decoder and the memory OBS needs.
            let said = null; try { said = await api('/api/capacity/estimate', { method: 'POST', body: JSON.stringify({ camera_id: camera.id, video_height: height }) }); } catch (error) { said = null; }
            const ahead = said?.warnings?.length ? `\n\nOn this PC: ${said.warnings.join('; ')}.` : said?.decoder_percent != null ? `\n\nOn this PC the video decoder would be about ${said.decoder_percent}% busy.` : '';
            if ((height > 1080 || said?.warnings?.length) && !await concert.sure(`${camera.name}: switch its stream to ${sizes[height][0]}? Larger pictures make the phone run hotter and use more of the network. It applies the next time the stream starts.${ahead}`)) { refresh(); return; }
            send(camera, 'settings.update', { video_height: height, video_bitrate_mbps: sizes[height][1] }, `Set stream to ${sizes[height][0]}`);
          };
          const sizeRow = node('label', 'Stream size '); sizeRow.append(size);
          picture.append(sizeRow, node('small', 'Stream picture size at 30 fps. Stop SRT and local recording to change it.'));
        }
        // The picture turned round, for a phone mounted upside down (with a gimbal or without). Portrait is set on the phone.
        if (t.capabilities?.picture_turn && (t.rotation ?? 0) % 180 === 0) {
          const turnRow = node('label', ''), turnBox = document.createElement('input'); turnBox.type = 'checkbox';
          turnBox.checked = t.rotation === 180; turnBox.disabled = !camera.online || busy.has(camera.id);
          // The phone takes it when its camera starts: a running camera is stopped, turned and started again, once asked.
          turnBox.onchange = async () => {
            const rotation = turnBox.checked ? 180 : 0, label = rotation ? 'Turn picture 180°' : 'Picture the right way up';
            if (!capturing) { send(camera, 'settings.update', { rotation }, label); return; }
            const streaming = t.streaming || t.capture?.streamRequested, recording = t.recording;
            if (!await concert.sure(`${camera.name}: this stops its ${[streaming && 'stream', recording && 'local recording'].filter(Boolean).join(' and ')} for a few seconds, turns the picture ${rotation ? 'round 180°' : 'the right way up'}, then starts ${recording && streaming ? 'them' : 'it'} again.${recording ? ' The current recording file is closed and a new one begins.' : ''}`, { ok: label })) { turnBox.checked = !turnBox.checked; return; }
            sequence(camera, [streaming && ['Stop SRT', 'stream.stop'], recording && ['Finalize local MP4', 'recording.stop'], [label, 'settings.update', { rotation }],
              recording && ['Start local MP4', 'recording.start'], streaming && ['Start SRT', 'stream.start']].filter(Boolean), label);
          };
          turnRow.append(turnBox, node('span', ' Turn picture 180° (phone mounted upside down)'));
          picture.append(turnRow, node('small', capturing ? 'Changing it stops this camera for a few seconds and starts it again: the phone turns its picture as its camera starts.'
            : 'Applies the next time the camera starts.'));
        }
        // Which rear lens the phone uses, and zoom on its sensor. Phones with one lens show only the zoom.
        if (t.capabilities?.lens_choice) {
            const lenses = t.lenses || [];
            const row = node('p', '');
            if (lenses.length > 1) {
              const lens = document.createElement('select'); lens.setAttribute('aria-label', 'Lens');
              for (const [value, text] of [['', 'usual lens'], ...lenses.map(l => [l.id, `${l.label}${l.sensor ? ` · ${l.sensor}` : ''}`])]) { const option = node('option', text); option.value = value; option.selected = (t.lens_id || '') === value; lens.append(option); }
              lens.disabled = !camera.online || busy.has(camera.id);
              lens.onchange = async () => {
                const chosen = lenses.find(l => l.id === lens.value);
                if ((t.streaming || t.capture?.streamRequested) && !await concert.sure(`${camera.name} is streaming. Changing lens breaks its picture for a moment while the camera reopens. Change it now?`)) { refresh(); return; }
                if (chosen && !chosen.listed && !await concert.sure(`${chosen.label}: this lens is not one the phone offers to apps. It may not open; if the picture goes black, choose another lens. Try it?`)) { refresh(); return; }
                send(camera, 'camera.lens', { lens_id: lens.value }, `Use ${chosen ? chosen.label : 'the usual lens'}`);
              };
              row.append(node('span', 'Lens '), lens, node('span', ' '));
            }
            const least = (t.zoom_min_percent ?? 100) / 100, most = (t.zoom_max_percent ?? 800) / 100;
            const zoom = document.createElement('input'); zoom.type = 'number'; zoom.min = least; zoom.max = most; zoom.step = 0.1; zoom.value = ((t.zoom_percent ?? 100) / 100).toFixed(1); zoom.setAttribute('aria-label', 'Zoom on the sensor');
            const zoomSet = node('button', 'Set zoom'); zoomSet.disabled = !camera.online || busy.has(camera.id);
            zoomSet.onclick = () => { const times = Number(zoom.value); if (!(times >= least && times <= most)) { result.textContent = `${camera.name} zooms from ${least} to ${most}.`; return; } send(camera, 'camera.lens', { zoom_percent: Math.round(times * 100) }, `Zoom ${times.toFixed(1)}×`); };
            row.append(node('span', 'Zoom '), zoom, node('span', '× '), zoomSet); picture.append(row);
            if (t.lens_error) { const failed = node('p', t.lens_error); failed.className = 'recording-warning'; card.append(failed); }
            picture.append(node('small', `Zooming on the sensor keeps real detail up to about ${t.video_height === 2160 ? '1.0' : t.video_height === 1440 ? '1.5' : '2.1'}× at this stream size; beyond that the picture is enlarged.${least < 1 ? ` Below 1× this phone hands over to its ultrawide lens.` : ''}${lenses.length > 1 ? ' A lens change is best made while the camera is off air.' : ''}`));
        }
        // White balance and exposure, as set on the Colour page (administrator), and what the phone is doing.
        if (t.colour?.wb_mode) {
          const c = t.colour;
          const line = node('p', `Colour: white balance ${c.wb_mode === 'kelvin' ? `${c.wb_kelvin} K` : c.wb_mode === 'preset' ? `${(c.wb_preset || '').replace('_', ' ')} preset` : c.wb_mode === 'lock' ? 'locked' : 'automatic'}${c.actual?.kelvin_estimate ? ` (at about ${c.actual.kelvin_estimate} K)` : ''} · exposure ${c.ae_mode === 'manual' ? `1/${Math.round(1e6 / c.exposure_us)} s, ISO ${c.iso}` : c.ae_mode === 'lock' ? 'locked' : 'automatic'}${c.ae_mode !== 'manual' && c.ae_compensation ? ` ${c.ae_compensation > 0 ? '+' : ''}${c.ae_compensation}` : ''}`);
          line.className = c.error ? 'app-version recording-warning' : 'app-version'; if (c.error) line.textContent += ` — ${c.error}`;
          if (role === 'admin') { const link = document.createElement('a'); link.href = '/colour'; link.textContent = ' Set on the Colour page'; line.append(link); }
          (c.error ? card : picture).append(line);
        }
        // One press: stop what is running, set the port, and start the same things again.
        const port = node('button', `Send to UDP ${camera.srt_port} (its OBS input)`); port.title = 'Stops this camera briefly, points it at its assigned OBS port, then restarts what was running';
        port.disabled = !camera.online || busy.has(camera.id);
        port.onclick = async () => {
          const streaming = t.streaming || t.capture?.streamRequested, recording = t.recording;
          if (capturing && !await concert.sure(`${camera.name}: this stops its ${[streaming && 'stream', recording && 'local recording'].filter(Boolean).join(' and ')} for a few seconds, sets UDP ${camera.srt_port}, then starts ${recording && streaming ? 'them' : 'it'} again. The current recording file is closed and a new one begins.`)) return;
          sequence(camera, [streaming && ['Stop SRT', 'stream.stop'], recording && ['Finalize local MP4', 'recording.stop'], [`Set UDP ${camera.srt_port}`, 'settings.update', { srt_port: camera.srt_port }],
            recording && ['Start local MP4', 'recording.start'], streaming && ['Start SRT', 'stream.start']].filter(Boolean), `Send to UDP ${camera.srt_port}`);
        };
        picture.append(port);

        // Maintenance: its app, its timing in OBS, its storage, and the commands used when something is wrong.
        if (camera.app) { const version = versionOf(camera, release); const tag = node('p', `App ${version.text}${camera.online ? '' : ' (last reported)'}`); tag.className = version.mismatch ? 'app-version recording-warning' : 'app-version'; (version.mismatch ? card : upkeep).append(tag); }
        const aligned = sync?.cameras?.[camera.id];
        if (aligned && camera.online) {
          const text = aligned.latency_ms != null ? `OBS sync: ${aligned.status}${aligned.error_ms ? ` (${Math.abs(aligned.error_ms)} ms ${aligned.error_ms < 0 ? 'early' : 'late'})` : ''} · picture ${(aligned.latency_ms / 1000).toFixed(2)} s behind · held back ${aligned.delay_ms} ms` : `OBS sync: ${aligned.status}`;
          const bad = aligned.status === 'out of sync' || aligned.status.startsWith('fell behind') || aligned.status.startsWith('no picture');
          const tag = node('p', text); tag.className = bad ? 'app-version recording-warning' : 'app-version'; (bad ? card : upkeep).append(tag);
        }
        const app = camera.app;
        if (app) {
          if (app.updating) { const going = node('p', ''); going.className = 'activity running'; going.append(document.createElement('progress'), node('span', `Updating: ${app.status || 'starting'}. The camera disconnects briefly and returns on the new version.`)); card.append(going); }
          else if (app.status && (app.update_available || app.status.startsWith('Update failed'))) upkeep.append(node('small', `Last update: ${app.status}`));
          if (release && !app.updating) {
            // Always shown, so it is clear where updating happens; greyed out with the reason when it cannot run.
            const capturingNow = app.update_available && (app.blocked_reason || '').startsWith('Stop SRT');
            const update = node('button', app.update_available ? `Update now to ${release.version_name}` : 'Update now (up to date)');
            update.disabled = !camera.online || busy.has(camera.id) || updatingAll || !(app.can_update || capturingNow);
            update.onclick = async () => {
              if (await concert.sure(capturingNow ? `Update ${camera.name} to ${release.version_name}? This STOPS its stream and local recording first. It then disconnects for about half a minute and comes back unarmed; you start it again afterwards.`
                : `Update ${camera.name} to ${release.version_name}? It disarms, disconnects for about half a minute and comes back unarmed.`)) updateCamera(camera, release, capturingNow);
            };
            upkeep.append(update);
            if (app.update_available && app.blocked_reason && !capturingNow) upkeep.append(node('small', `Cannot update yet: ${app.blocked_reason}.`));
            if (capturingNow) upkeep.append(node('small', 'Updating will stop this camera’s stream and recording first.'));
          }
        }
        upkeep.append(node('p', `UDP ${camera.srt_port} · queue ${t.queue_depth ?? '—'} · dropped ${t.frames_dropped ?? '—'} · SRT RTT ${t.srt_rtt_ms ?? 'unavailable'} · last contact ${camera.last_contact ? new Date(camera.last_contact * 1000).toLocaleTimeString() : 'never'}`));
        upkeep.append(node('p', `Device storage: ${bytes(storage.free_bytes)} free${storage.total_bytes ? ` / ${bytes(storage.total_bytes)} total` : ''}`));
        upkeep.append(node('p', `Estimated local recording time to full: ${duration(storage.estimated_seconds_to_full)}${t.recording ? '' : ' (if recording starts)'}`));
        upkeep.append(node('small', `${storage.estimate_basis || 'No storage telemetry'}; approximate, not a safe-stop guarantee.`));
        if (Number.isFinite(storage.estimated_seconds_to_recording_stop)) card.append(node('p', `Estimated time until recording safety stop: ${duration(storage.estimated_seconds_to_recording_stop)}`));
        if (t.capabilities) upkeep.append(node('small', `Remote arm/reboot: ${t.capabilities.device_owner ? 'available (device owner)' : 'unavailable until the phone is set up as device owner'}`));
        // On the camera Wi-Fi but unable to reach this computer, the phone dropped and rejoined it (in the last hour).
        if (camera.wifi_rejoined) { const line = node('p', camera.wifi_rejoined); line.className = 'app-version'; upkeep.append(line); }
        // No cooler found yet (none, or not heard): a quiet line here, and a way to look again, instead of a card section.
        if (t.capabilities?.cooler && !camera.cooler && t.cooler) {
          const c = t.cooler, last = c.last_look;
          const said = c.looking ? 'looking now…' : c.state === 'no_permission' ? 'the app is not allowed to use Bluetooth: allow it on the phone' : c.state === 'bluetooth_off' ? 'Bluetooth is off on the phone'
            : `none found${last ? ` (looked ${Math.max(1, Math.round(last.seconds_ago / 60))} min ago)` : ''}`;
          const row = node('p', `Black Shark cooler: ${said}${c.error ? ` · ${c.error}` : ''} `); row.className = 'app-version';
          const look = node('button', 'Look for a cooler'); look.disabled = !camera.online || busy.has(camera.id) || c.looking;
          look.title = 'Switch the cooler on and close the Black Shark app first: while it holds the cooler, the cooler cannot be found. Not while streaming or recording.';
          look.onclick = () => send(camera, 'cooler.settings', { look: true }, 'Look for a cooler');
          if (capturing) look.title += ' It looks once this camera stops.';
          row.append(look); upkeep.append(row);
          // A look asked from here is made with the phone's screen off, mostly: Android then gives only what is named in
          // the app's list, so a cooler it does not know by name is missed. The phone's own button listens to everything.
          if (!c.looking && c.state === 'not_found' && last && !last.wide)
            upkeep.append(node('small', 'Not found? Switch the cooler on, close the Black Shark app, and tap Black Shark cooler… in the camera app on the phone: with its screen on, the phone hears every cooler, not only those it knows by name.'));
          const moving = moveHere(camera, 'cooler', paired); if (moving) upkeep.append(moving);
        }
        // No gimbal: the same, to look for one (a new one: pair it with the phone once in Hohem's app, or look here).
        if (t.capabilities?.gimbal && !camera.gimbal && t.gimbal) {
          const g = t.gimbal;
          const said = g.looking ? 'looking now…' : g.state === 'no_permission' ? 'the app is not allowed to use Bluetooth: allow it on the phone' : g.state === 'bluetooth_off' ? 'Bluetooth is off on the phone' : 'none paired with this phone';
          const row = node('p', `Hohem gimbal: ${said}${g.error ? ` · ${g.error}` : ''} `); row.className = 'app-version';
          const look = node('button', 'Look for a gimbal'); look.disabled = !camera.online || busy.has(camera.id) || g.looking;
          look.title = 'Switch the gimbal on and close Hohem’s app first: while it holds the gimbal, the gimbal cannot be found. Not while streaming or recording.' + (capturing ? ' It looks once this camera stops.' : '');
          look.onclick = () => send(camera, 'gimbal.settings', { look: true }, 'Look for a gimbal');
          row.append(look); upkeep.append(row);
          const moving = moveHere(camera, 'gimbal', paired); if (moving) upkeep.append(moving);
        }
        const tools = node('div', ''); tools.className = 'camera-controls';
        tools.append(command('Status', 'status.get'), command('Telemetry', 'metrics.get'), command('Restart SRT', 'stream.restart'), command('Reboot phone', 'system.reboot', true));
        upkeep.append(tools);
        if (role === 'admin') { const manage = node('div', ''); manage.className = 'camera-controls'; manage.append(renameButton(camera), asideButton(camera), removeButton(camera)); upkeep.append(manage); }
      } else if (role === 'admin' && !window.concert.session?.away) {
        // An empty slot is where a new camera goes: say how.
        const add = document.createElement('a'); add.href = '/phones'; add.className = 'button'; add.textContent = 'Add a phone…';
        card.append(node('p', 'No phone is paired in this slot.'), add);
      }
      // A Black Shark cooler on the phone: what it is doing stays in view, its fan is in a fold. Nothing for a phone without one.
      const chill = fold(`${key}:cooler`, 'Cooler');
      if (camera?.cooler) {
        const cooler = camera.cooler, off = !camera.online || busy.has(camera.id);
        const set = (parameters, label) => send(camera, 'cooler.settings', parameters, label);
        if (cooler.summary) { const line = node('p', cooler.summary); line.className = cooler.address && (!cooler.connected || cooler.fan_refused || cooler.asking_to_pair) ? 'app-version recording-warning' : 'app-version'; card.append(line); }
        if (cooler.address) {
          const fan = document.createElement('select'); fan.setAttribute('aria-label', 'Cooler fan');
          for (const [value, text] of [['smart', 'Smart'], ['overclock_streaming', 'Overclock while streaming'], ['overclock', 'Overclock'], ['silent', 'Silent'], ['manual', 'Fixed speed']]) {
            const option = node('option', text); option.value = value; option.selected = cooler.fan === value; fan.append(option);
          }
          fan.disabled = off; fan.onchange = () => set({ fan: fan.value }, `Cooler fan: ${fan.selectedOptions[0].textContent}`);
          const row = node('p', ''); row.append(node('span', 'Fan '), fan);
          if (cooler.fan === 'manual') {
            const speed = document.createElement('select'); speed.setAttribute('aria-label', 'Cooler fan speed');
            for (let level = 1; level <= 5; level++) { const option = node('option', `${level}${level === 1 ? ' (quietest)' : level === 5 ? ' (fastest)' : ''}`); option.value = level; option.selected = cooler.fan_level === level; speed.append(option); }
            speed.disabled = off; speed.onchange = () => set({ level: Number(speed.value) }, `Cooler speed ${speed.value}`);
            row.append(node('span', ' speed '), speed);
          }
          chill.append(row);
          if (cooler.fan_refused) chill.append(node('small', `The cooler refused ${fan.querySelector(`option[value="${cooler.fan_refused}"]`)?.textContent || cooler.fan_refused}, so it runs Smart; it is asked again every 5 minutes. Black Shark's own app gets the same answer. A stronger USB charger may help.`));
          chill.append(node('small', 'Its lights are kept off while this phone holds it: they sit beside the lens, and could tint the shot or show in a reflection.'));
          // A trial of the cooler's own Auto Shutdown: does it switch itself off, and can it be woken after?
          if (cooler.connected) {
            const trial = node('p', 'Test: '); const stop = node('button', 'Switch off in 30 min'), cancel = node('button', 'Cancel');
            stop.disabled = cancel.disabled = off;
            stop.onclick = async () => { if (await concert.sure(`${camera.name}: set its cooler to switch itself off in 30 minutes? This is a test: it may need its button pressed, or unplugging, to come back on.`, { ok: 'Set' })) send(camera, 'cooler.settings', { shutdown: 1 }, 'Cooler off in 30 min'); };
            cancel.onclick = () => send(camera, 'cooler.settings', { shutdown: 0 }, 'Cancel cooler shutdown');
            trial.append(stop, node('span', ' '), cancel);
            const s = cooler.shutdown;
            if (s) trial.append(node('small', `Set to ${['off', '30 min', '60 min'][s.set]} ${Math.round(s.seconds_ago / 60)} min ago; the cooler reads ${s.read || 'nothing yet'}`));
            chill.append(trial);
          }
          const other = node('button', 'Pair a different cooler'); other.disabled = off;
          other.title = 'Lets go of this one and looks for coolers near the phone. Not while streaming or recording.';
          other.onclick = async () => { if (await concert.sure(`${camera.name}: let go of this cooler and look for another? Switch the new one on near the phone first.`, { ok: 'Look' })) set({ address: '', look: true }, 'Pair a different cooler'); };
          chill.append(other);
          const forget = node('button', 'Forget this cooler'); forget.disabled = off;
          forget.onclick = async () => { if (await concert.sure(`${camera.name}: forget its cooler? The phone lets go of it and looks for coolers nearby again.`, { ok: 'Forget' })) set({ address: '' }, 'Forget cooler'); };
          chill.append(node('p', `${cooler.name || 'Cooler'} ${cooler.address}${cooler.firmware ? ` · firmware ${cooler.firmware}` : ''}`), forget);
        }
        if (cooler.nearby.length) {
          chill.append(node('p', cooler.address ? 'Other coolers nearby:' : 'Several coolers are nearby. Which one is clamped to this phone? The nearest is usually the strongest signal.'));
          const list = node('ul', '');
          for (const other of cooler.nearby) {
            const item = node('li', `${other.name || 'Cooler'} ${other.address}${other.rssi != null ? ` · ${other.rssi} dBm` : ''} `);
            const use = node('button', 'This one'); use.disabled = off; use.onclick = () => set({ address: other.address }, `Use cooler ${other.address}`);
            item.append(use); list.append(item);
          }
          const again = node('button', 'Look again'); again.disabled = off; again.onclick = () => set({ look: true }, 'Look for coolers');
          chill.append(list, again);
        }
        chill.append(node('small', ' Power the cooler from a USB charger, not from the camera switch. Close the Black Shark app on the phone: it holds the cooler while it is open.'));
      }
      // A Hohem gimbal holding the phone: hold an arrow to turn it. Nothing for a phone without one.
      const turn = fold(`${key}:gimbal`, 'Gimbal');
      if (camera?.gimbal) {
        const gimbal = camera.gimbal, off = !camera.online || busy.has(camera.id);
        const set = (parameters, label) => send(camera, 'gimbal.settings', parameters, label);
        if (gimbal.summary) { const line = node('p', gimbal.summary); line.className = gimbal.address && !gimbal.connected ? 'app-version recording-warning' : 'app-version'; card.append(line); }
        // The director keeps a camera whose gimbal lost its person off air until it is following again (director.gimbal_out).
        const keptOut = director?.gimbal_out?.[camera.id];
        if (keptOut) { const kept = node('p', `Off air for now: ${keptOut}. The director cuts back once it is following again.`); kept.className = 'app-version recording-warning'; card.append(kept); }
        if (gimbal.address) {
          if (gimbal.connected) {
            // An MT3's AI tracker steers it too while it tracks: the arrows still work, but say they will fight it.
            const tracking = gimbal.ai_tracker === 'tracking', fighting = tracking ? ' — the AI tracker is steering it too' : '';
            if (tracking) { const warn = node('p', 'The gimbal’s AI tracker is following someone, so the arrows will fight it. Pause or stop tracking at the gimbal (the trigger) to aim by hand.'); warn.className = 'recording-warning'; turn.append(warn); }
            else if (gimbal.ai_tracker) turn.append(node('small', `AI tracker: ${{ ready: 'ready', starting: 'starting' }[gimbal.ai_tracker] || `in a state not yet known (${gimbal.ai_tracker})`}. It is started and stopped at the gimbal (a gesture or the trigger).`));
            const pad = node('div', ''); pad.className = tracking ? 'aim-pad tracking' : 'aim-pad';
            const stop = node('button', '■'); stop.title = 'Stop'; stop.setAttribute('aria-label', 'Stop the gimbal'); stop.disabled = !camera.online;
            stop.onclick = () => { aimStop(); aimSend(camera.id, 'gimbal.stop', {}); };
            pad.append(node('span', ''), aimButton(camera, '▲', `Tilt up (hold)${fighting}`, 0, 1, off), node('span', ''),
              aimButton(camera, '◀', `Pan left (hold)${fighting}`, -1, 0, off), stop, aimButton(camera, '▶', `Pan right (hold)${fighting}`, 1, 0, off),
              node('span', ''), aimButton(camera, '▼', `Tilt down (hold)${fighting}`, 0, -1, off), node('span', ''));
            const speed = document.createElement('select'); speed.setAttribute('aria-label', 'Gimbal speed');
            for (const [text, value] of [['Slow', 20], ['Medium', 50], ['Fast', 100]]) { const option = node('option', text); option.value = value; option.selected = (aimSpeeds.get(camera.id) || 50) === value; speed.append(option); }
            speed.onchange = () => aimSpeeds.set(camera.id, Number(speed.value));
            const row = node('div', ''); row.className = 'aim-row'; row.append(pad, speed);
            turn.append(row, node('small', 'Hold an arrow to turn the camera; it stops when you let go, and by itself within half a second if this page or the network goes.'));
            // Its home position (app 0.9.37's gimbal.point), also on the Operate page: set where it points now, go back there.
            if (gimbal.home) {
              const homeLine = node('p', 'Home position: '), home = gimbal.home;
              const gimbalHome = async (action, label) => {
                try { await api(`/api/cameras/${encodeURIComponent(camera.id)}/gimbal-home`, { method: 'POST', body: JSON.stringify({ action }) }); refresh(); }
                catch (error) { concert.tell(`${camera.name}: ${label}: ${error.message}`); }
              };
              const go = node('button', 'Home'); go.disabled = off || !home.set || home.stale; go.title = 'Turn it back to its home position (stops following)';
              go.onclick = () => gimbalHome('go', 'Home');
              const keep = node('button', home.set ? 'Set again' : 'Set home'); keep.disabled = off; keep.title = 'Keep where it points now as its home position';
              keep.onclick = () => gimbalHome('set', 'Set home');
              homeLine.append(go, ' ', keep);
              if (home.set) homeLine.append(node('span', home.stale ? ' · the phone restarted since it was set: set it again' : ` · pan ${home.pan}°, tilt ${home.tilt}°`));
              turn.append(homeLine);
            }
            // Following someone (app 0.9.27): the phone finds faces in its own picture and turns the gimbal itself; the
            // arrows take over for a few seconds whenever they are used.
            if ((camera.telemetry || {}).capabilities?.gimbal_follow) {
              // Whom to follow, and its follow plan: follow.js, shared with the Operate page so both are the same setting.
              turn.append(gimbalFollow.block(camera, { role, off, post: (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) }),
                send: (c, command, parameters, label) => send(c, command, parameters, label), refresh, tell: message => concert.tell(message) }),
                node('small', 'The phone turns the gimbal to keep that face a little above the middle, and keeps someone who turns away by their body (app 0.9.30); for performers, the manager recognises them about once a second and points the phone at whom its plan says. The arrows take over for three seconds whenever you use them.'));
            }
            // Aiming from the stage (app 0.9.37, stageaim.py): the wide shot says where someone stands, the room map which
            // way that is from here. Calibrated once: aim it at the middle of the stage with the arrows, then Set.
            if (gimbal.stage) {
              const stage = gimbal.stage, gimbalStage = async (action, label) => {
                try { await api(`/api/cameras/${encodeURIComponent(camera.id)}/gimbal-stage`, { method: 'POST', body: JSON.stringify({ action }) }); refresh(); }
                catch (error) { result.textContent = `${label}: ${error.message}`; }
              };
              const aimed = node('p', 'Aim from the stage: ');
              const calibrate = node('button', stage.calibrated ? 'Set again' : 'Set: it points at centre stage'); calibrate.disabled = off || !stage.on_map;
              calibrate.title = stage.on_map ? 'Aim it at the middle of the stage with the arrows first. The manager then turns it towards whoever the wide shot sees, when it has lost them or before the director needs it.' : 'Put this camera on the room map first (Stage Shots, Room map)';
              calibrate.onclick = () => gimbalStage('calibrate', 'Set centre stage');
              aimed.append(calibrate);
              if (stage.calibrated) {
                const centre = node('button', 'Centre stage'); centre.disabled = off; centre.title = 'Turn it back to the middle of the stage, to check the calibration';
                centre.onclick = () => gimbalStage('centre', 'Centre stage');
                const drop = node('button', 'Forget'); drop.disabled = off; drop.onclick = () => gimbalStage('forget', 'Forget the calibration');
                aimed.append(' ', centre, ' ', drop);
                if (stage.why) aimed.append(node('span', ` · ${{ following: '', pointing: 'turning it to ', waiting: 'waiting: ', idle: '' }[stage.state] ?? ''}${stage.why}`));
              } else if (!stage.on_map) aimed.append(node('small', ' Put this camera and the wide camera on the room map first (Stage Shots).'));
              turn.append(aimed);
              if (gimbal.attitude) turn.append(node('small', `The phone says its camera points at pan ${gimbal.attitude.pan}°, tilt ${gimbal.attitude.tilt}° (from its rotation sensor; the pan counts from wherever the sensor started, and is kept anchored from the wide shot while it follows someone).`));
            }
          }
          // Hung upside down: the arrows are turned round. The picture is turned round on its own, under Picture & stream.
          const hung = node('p', ''), hungLabel = node('label', ''), hungBox = document.createElement('input'); hungBox.type = 'checkbox';
          hungBox.checked = gimbal.upside_down; hungBox.disabled = off;
          hungBox.onchange = () => set({ upside_down: hungBox.checked }, `Gimbal: upside down ${hungBox.checked ? 'on' : 'off'}`);
          hungLabel.append(hungBox, node('span', ' Mounted upside down (hanging)'));
          hung.append(hungLabel);
          turn.append(hung, node('small', 'Turns both arrows round, so they still go the way they point. To turn the picture itself, see Picture & stream.'));
          // Right on an X3 or MT3 as it comes; for a gimbal that turns another way, put right here once, for this phone.
          const axes = node('p', 'If it turns the wrong way: ');
          for (const [key, text] of [['swap', 'swap pan and tilt'], ['invert_pan', 'reverse pan'], ['invert_tilt', 'reverse tilt']]) {
            const label = node('label', ''), box = document.createElement('input'); box.type = 'checkbox'; box.checked = gimbal[key]; box.disabled = off;
            box.onchange = () => set({ [key]: box.checked }, `Gimbal: ${text} ${box.checked ? 'on' : 'off'}`);
            label.append(box, node('span', ` ${text} `)); axes.append(label);
          }
          const other = node('button', 'Pair a different gimbal'); other.disabled = off;
          other.title = 'Lets go of this one and looks for gimbals near the phone. Not while streaming or recording.';
          other.onclick = async () => { if (await concert.sure(`${camera.name}: let go of this gimbal and look for another? Switch the new one on near the phone, and close Hohem’s app.`, { ok: 'Look' })) set({ address: '', look: true }, 'Pair a different gimbal'); };
          turn.append(other);
          const forget = node('button', 'Forget this gimbal'); forget.disabled = off;
          forget.onclick = async () => { if (await concert.sure(`${camera.name}: forget its gimbal? The phone lets go of it until one is chosen again.`, { ok: 'Forget' })) set({ address: '' }, 'Forget gimbal'); };
          turn.append(axes, node('p', `${gimbal.model ? `Hohem ${gimbal.model} · ` : ''}${gimbal.name || 'Gimbal'} ${gimbal.address}`), forget);
        }
        if (gimbal.nearby.length) {
          // A gimbal let go of here is listed again by a later look, but never taken by itself: it may be the only one.
          turn.append(node('p', gimbal.address ? 'Other gimbals nearby:' : gimbal.nearby.length === 1 ? 'A gimbal is nearby. Is it the one holding this phone?' : 'Several gimbals are nearby. Which one holds this phone?'));
          const list = node('ul', '');
          for (const other of gimbal.nearby) {
            const item = node('li', `${other.name || 'Gimbal'} ${other.address}${other.rssi ? ` · ${other.rssi} dBm` : ''} `);
            const use = node('button', 'This one'); use.disabled = off; use.onclick = () => set({ address: other.address }, `Use gimbal ${other.address}`);
            item.append(use); list.append(item);
          }
          const again = node('button', 'Look again'); again.disabled = off; again.onclick = () => set({ look: true }, 'Look for gimbals');
          turn.append(list, again);
        }
        turn.append(node('small', ' Pair the gimbal with the phone once (Hohem’s app does it), then close Hohem’s app: it holds the gimbal while it is open.'));
      }
      for (const group of [shots, picture, upkeep, chill, turn]) if (group.childElementCount > 1) card.append(group);
      grid.append(card);
    }
    if (aside.length) {
      // Paired, but not used at this location: one line each, and the way back.
      const card = node('article', ''); card.className = 'set-aside';
      card.append(node('h2', 'Not in use here'));
      for (const camera of aside) {
        const t = camera.telemetry || {}, row = node('div', ''); row.className = 'paired-camera';
        row.append(node('span', `${camera.name} · slot ${camera.slot} · ${camera.online ? `connected, not used${t.armed ? ' · armed' : ''}${t.streaming ? ' · streaming' : ''}${t.recording ? ' · RECORDING' : ''}` : 'offline'}`));
        if (role === 'admin') row.append(renameButton(camera), asideButton(camera), removeButton(camera));
        card.append(row);
      }
      card.append(node('small', 'Kept paired with their settings, and left out of the director, “Start All”, the OBS scenes and the readiness checks at this location.'));
      grid.append(card);
    }
    paintActivity();
  } catch (error) { result.textContent = error.message; }
}
