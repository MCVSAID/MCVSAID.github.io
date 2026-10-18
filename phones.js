'use strict';
// Setting up a phone plugged into this PC. The manager does the work and says how each step went; this page asks
// what the phone should become and shows the answer.
const result = document.querySelector('#result'), list = document.querySelector('#phones'), trouble = document.querySelector('#trouble');
const asked = {};                    // serial -> what has been chosen on its card, kept while the card is redrawn
let csrf = '';
function node(tag, text, name) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (name) e.className = name; return e; }
async function api(path, body) {
  const r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || `Request failed (${r.status})`);
  return data;
}
function item(state, text, more) { const line = node('li', text, state); if (more) line.append(node('small', more)); return line; }

// What is so on the phone now, before anything is done.
function findings(phone, report) {
  const lines = node('ul'), app = phone.app, release = report.release;
  if (!app) lines.append(item('todo', 'App: not installed', release ? `Will install ${release.version_name}` : 'No app is published on this manager yet'));
  else if (phone.move) lines.append(item('note', `App: ${app.version_name}, signed with a different key from the published app`, `It cannot take ${release.version_name} as an update. It can be moved to it below`));
  else if (release && app.version_code < release.version_code) lines.append(item('todo', `App: ${app.version_name}`, `Will be updated to ${release.version_name}`));
  else lines.append(item('ok', `App: ${app.version_name}`));
  if (app) {
    const missing = Object.entries(app.granted).filter(([name, yes]) => !yes && !(name.endsWith('POST_NOTIFICATIONS') && (phone.sdk || 0) < 33)).map(([name]) => name.split('.').pop().replace('_', ' ').toLowerCase());
    lines.append(missing.length ? item('todo', `Permissions: ${missing.join(', ')} not allowed yet`) : item('ok', 'Permissions: camera, microphone and notifications allowed'));
  }
  if (phone.is_owner) lines.append(item('ok', 'Device owner: yes', 'Remote arming, restarting, clock setting and updating work'));
  else if (phone.owner) lines.append(item('stop', `Device owner: another app (${phone.owner})`, 'The phone has to be reset before this app can be device owner'));
  else if (phone.accounts) lines.append(item('stop', `Device owner: not possible yet, the phone has ${phone.accounts} account${phone.accounts === 1 ? '' : 's'}`, 'Remove them in the phone’s Settings › Passwords and accounts, or reset the phone and skip signing in'));
  else lines.append(item('todo', 'Device owner: not yet'));
  lines.append(phone.battery_exempt ? item('ok', 'Battery saving: exempt') : item('todo', 'Battery saving: not exempt yet'));
  if (phone.camera) lines.append(item('ok', `Paired as ${phone.camera.name} (slot ${phone.camera.slot})`, phone.camera.online ? (phone.camera.busy ? 'Connected, and armed, streaming or recording: disarm it before changing anything' : 'Connected to the manager now') : 'Not connected to the manager at the moment'));
  else lines.append(item('todo', phone.identity ? 'Paired with another manager, or with a camera this one no longer has' : 'Not paired with this manager'));
  lines.append(phone.wifi ? item('ok', `Wi-Fi: ${phone.wifi}`) : item('note', 'Wi-Fi: not connected', 'Join it to the camera network on the phone, unless it is wired'));
  return lines;
}

// What the phone should become.
function choices(phone, report) {
  const pick = asked[phone.serial] ||= { pair: phone.move ? 'move' : phone.camera ? 'keep' : 'new', name: phone.model || '', slot: null, camera_id: '', leave: false };
  if (!phone.camera && pick.pair === 'keep') pick.pair = 'new';
  if (!phone.move && pick.pair === 'move') pick.pair = phone.camera ? 'keep' : 'new';
  if (!report.free_slots.includes(pick.slot)) pick.slot = report.free_slots[0] ?? null;
  const off = report.cameras.filter(camera => !camera.online && camera.id !== phone.camera?.id);
  if (!off.some(camera => camera.id === pick.camera_id)) pick.camera_id = off[0]?.id || '';
  const box = node('fieldset'); box.append(node('legend', 'Make this phone'));
  const way = (value, text, usable, extra) => {
    const label = node('label'), radio = node('input'); radio.type = 'radio'; radio.name = `pair-${phone.serial}`; radio.checked = pick.pair === value; radio.disabled = !usable;
    radio.onchange = () => { pick.pair = value; draw(); };
    label.append(radio, ` ${text}`); box.append(label);
    if (extra && pick.pair === value && usable) box.append(extra);
  };
  if (phone.move) {
    const about = node('div', undefined, 'how');
    about.append(node('small', `The app gives up being device owner, is removed and replaced by ${report.release.version_name}, and the phone is set up again as ${phone.camera.name} in slot ${phone.camera.slot}. Its settings on the phone (picture size, bitrate, lens) go back to the app’s own and are set again on its card afterwards. Do this with time to spare, not just before a show.`));
    if (phone.move.recordings) {
      const label = node('label'), tick = node('input'); tick.type = 'checkbox'; tick.checked = pick.leave; tick.onchange = () => { pick.leave = tick.checked; };
      label.append(tick, ` It has ${phone.move.recordings} recording${phone.move.recordings === 1 ? '' : 's'} not yet copied to this PC. Leave ${phone.move.recordings === 1 ? 'it' : 'them'} on the phone: the manager will not be able to fetch ${phone.move.recordings === 1 ? 'it' : 'them'} afterwards.`);
      about.append(label);
    }
    way('move', `stay ${phone.camera.name}, moved to the signed app published here`, true, about);
  }
  if (phone.camera) way('keep', `stay ${phone.camera.name}: only put right what has drifted`, true);
  const fresh = node('div', undefined, 'how'), name = node('input'), slot = node('select');
  name.type = 'text'; name.maxLength = 80; name.value = pick.name; name.setAttribute('aria-label', 'Camera name'); name.oninput = () => { pick.name = name.value; };
  for (const free of report.free_slots) { const option = node('option', `Slot ${free} (stream port ${8999 + free})`); option.value = free; option.selected = free === pick.slot; slot.append(option); }
  slot.setAttribute('aria-label', 'Slot'); slot.onchange = () => { pick.slot = Number(slot.value); };
  fresh.append(node('span', 'called'), name, node('span', 'in'), slot);
  way('new', report.free_slots.length ? 'a new camera' : `a new camera (no free slot: all ${report.capacity} are taken; raise the camera capacity on the System page)`, report.free_slots.length > 0, fresh);
  const place = node('div', undefined, 'how'), which = node('select');
  for (const camera of off) { const option = node('option', `${camera.name} (slot ${camera.slot})`); option.value = camera.id; option.selected = camera.id === pick.camera_id; which.append(option); }
  which.setAttribute('aria-label', 'Camera to replace'); which.onchange = () => { pick.camera_id = which.value; };
  place.append(which, node('small', 'It keeps that camera’s name, slot and settings. The phone that was that camera will no longer be able to connect.'));
  way('as', off.length ? 'take the place of a camera that is off' : 'take the place of a camera that is off (none is)', off.length > 0, place);
  return box;
}

function progress(job) {
  const box = node('div'); box.append(node('h3', job.state === 'running' ? 'Setting up…' : job.state === 'done' ? `Set up finished ${new Date(job.finished * 1000).toLocaleTimeString()}` : `Stopped ${new Date(job.finished * 1000).toLocaleTimeString()}`));
  const lines = node('ul');
  for (const step of job.steps) lines.append(item(step.state, step.label, step.detail));
  box.append(lines); return box;
}

// ---- a code for a factory-reset phone ----
const codePick = { pair: 'new', name: '', slot: null, camera_id: '' };
let codeDrawn = false, codeTimer = null;
function hideCode() { clearTimeout(codeTimer); document.querySelector('#code-squares').replaceChildren(); document.querySelector('#code-shown').hidden = true; }
function showCode(made) {
  const size = made.rows.length, quiet = 4, svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size + quiet * 2} ${size + quiet * 2}`); svg.setAttribute('shape-rendering', 'crispEdges'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Set-up code');
  let path = '';
  made.rows.forEach((row, y) => { for (let x = 0; x < size; x++) if (row[x] === '1') path += `M${x + quiet} ${y + quiet}h1v1h-1z`; });
  const squares = document.createElementNS('http://www.w3.org/2000/svg', 'path'); squares.setAttribute('d', path); squares.setAttribute('fill', '#000'); svg.append(squares);
  document.querySelector('#code-squares').replaceChildren(svg);
  document.querySelector('#code-title').textContent = `Code for ${made.name} (slot ${made.slot}, stream port ${made.port})`;
  document.querySelector('#code-note').textContent = `Installs ${made.version_name}. Hidden by itself after ten minutes. A new code for the same camera makes this one useless.`;
  document.querySelector('#code-shown').hidden = false; document.querySelector('#code-shown').scrollIntoView({ block: 'start' });
  clearTimeout(codeTimer); codeTimer = setTimeout(hideCode, 600000);
}
function drawCode(report) {
  const code = report.code, why = document.querySelector('#code-why'), form = document.querySelector('#code-form');
  why.hidden = code.possible; why.textContent = code.possible ? '' : `A code cannot be made yet: ${code.why}.`;
  form.hidden = !code.possible;
  document.querySelector('#code-download').textContent = code.download ? `Phones will fetch ${code.download}` : '';
  if (!codeDrawn) { document.querySelector('#code-repository').value = code.repository; document.querySelector('#setup-ssid').value = code.setup_ssid; document.querySelector('#camera-ssid').value = code.camera_ssid; codeDrawn = true; }
  const which = document.querySelector('#code-which');
  if (which.contains(document.activeElement) && document.activeElement.type !== 'radio') return;
  which.replaceChildren();
  if (!report.free_slots.includes(codePick.slot)) codePick.slot = report.free_slots[0] ?? null;
  const off = report.cameras.filter(camera => !camera.online);
  if (!off.some(camera => camera.id === codePick.camera_id)) codePick.camera_id = off[0]?.id || '';
  if (codePick.pair === 'new' && !report.free_slots.length && off.length) codePick.pair = 'as';
  const way = (value, text, usable, extra) => {
    const label = node('label'), radio = node('input'); radio.type = 'radio'; radio.name = 'code-pair'; radio.checked = codePick.pair === value; radio.disabled = !usable;
    radio.onchange = () => { codePick.pair = value; drawCode(latest); };
    label.append(radio, ` ${text}`); which.append(label);
    if (extra && codePick.pair === value && usable) which.append(extra);
  };
  const fresh = node('div', undefined, 'how'), name = node('input'), slot = node('select');
  name.type = 'text'; name.maxLength = 80; name.value = codePick.name; name.setAttribute('aria-label', 'Camera name'); name.oninput = () => { codePick.name = name.value; };
  for (const free of report.free_slots) { const option = node('option', `Slot ${free} (stream port ${8999 + free})`); option.value = free; option.selected = free === codePick.slot; slot.append(option); }
  slot.setAttribute('aria-label', 'Slot'); slot.onchange = () => { codePick.slot = Number(slot.value); };
  fresh.append(node('span', 'called'), name, node('span', 'in'), slot);
  way('new', report.free_slots.length ? 'a new camera' : `a new camera (no free slot: all ${report.capacity} are taken; raise the camera capacity on the System page)`, report.free_slots.length > 0, fresh);
  const place = node('div', undefined, 'how'), chosen = node('select');
  for (const camera of off) { const option = node('option', `${camera.name} (slot ${camera.slot})`); option.value = camera.id; option.selected = camera.id === codePick.camera_id; chosen.append(option); }
  chosen.setAttribute('aria-label', 'Camera to replace'); chosen.onchange = () => { codePick.camera_id = chosen.value; };
  place.append(chosen, node('small', 'The phone that is that camera now will no longer be able to connect.'));
  way('as', off.length ? 'take the place of a camera that is off' : 'take the place of a camera that is off (none is)', off.length > 0, place);
}
document.querySelector('#code-place').onsubmit = async e => {
  e.preventDefault(); result.textContent = '';
  try { await api('/api/phones/code', { repository: document.querySelector('#code-repository').value.trim() }); await refresh(); } catch (error) { result.textContent = error.message; }
};
document.querySelector('#code-form').onsubmit = async e => {
  e.preventDefault(); result.textContent = '';
  const plan = codePick.pair === 'new' ? { pair: 'new', name: codePick.name.trim(), slot: codePick.slot } : { pair: 'as', camera_id: codePick.camera_id };
  plan.setup_wifi = { ssid: document.querySelector('#setup-ssid').value, password: document.querySelector('#setup-password').value };
  plan.camera_wifi = { ssid: document.querySelector('#camera-ssid').value, password: document.querySelector('#camera-password').value };
  try { showCode(await api('/api/phones/code', plan)); codePick.name = ''; await refresh(); } catch (error) { result.textContent = error.message; hideCode(); }
};
document.querySelector('#code-hide').onclick = hideCode;

let latest = null;
function draw() {
  const report = latest; if (!report) return;
  trouble.hidden = !report.problem; trouble.textContent = report.problem || '';
  // Nothing to install yet: say where it is brought from, before anyone fills in a phone's card or a code.
  document.querySelector('#no-app').hidden = Boolean(report.release);
  drawCode(report);
  // A card someone is typing in is left as it is.
  const busy = document.activeElement && list.contains(document.activeElement) && ['INPUT', 'SELECT'].includes(document.activeElement.tagName) && document.activeElement.type !== 'radio' ? document.activeElement.closest('.phone')?.dataset.serial : null;
  for (const card of [...list.children]) if (card.dataset.serial !== busy) card.remove();
  if (!report.phones.length && !report.problem) list.append(node('p', 'No phone is plugged in, or none has USB debugging switched on. See “Preparing a phone from scratch” below.'));
  for (const phone of report.phones) {
    if (phone.serial === busy) continue;
    const card = node('section', undefined, 'phone'); card.dataset.serial = phone.serial;
    card.append(node('h2', phone.camera ? `${phone.camera.name} · ${phone.model || 'phone'}` : phone.model || 'Phone'), node('small', `Serial ${phone.serial}${phone.android ? ` · Android ${phone.android}` : ''}`));
    if (phone.state === 'unauthorized') card.append(node('p', 'The phone has not allowed this computer yet. Unlock it, tick “Always allow from this computer” and tap Allow. If nothing is asked, unplug it and plug it in again.', 'recording-warning'));
    else if (phone.state !== 'device') card.append(node('p', `The phone is plugged in but not answering (${phone.state}). Unplug it and plug it in again.`, 'recording-warning'));
    else if (phone.problem) card.append(node('p', phone.problem, 'recording-warning'));
    else {
      const running = phone.job?.state === 'running';
      card.append(findings(phone, report));
      if (!running) {
        card.append(choices(phone, report));
        const go = node('button', 'Set up this phone', 'go'), pick = asked[phone.serial];
        go.disabled = Boolean(phone.camera?.busy);
        go.onclick = async () => {
          if (pick.pair === 'move' && !await concert.sure(`Move ${phone.camera.name} to the signed app?\n\nThe app on the phone is removed and replaced. This cannot be undone from here, and the phone is off the system until it finishes.`)) return;
          const plan = pick.pair === 'move' ? { pair: 'move', leave_recordings: pick.leave } : pick.pair === 'new' ? { pair: 'new', name: pick.name.trim(), slot: pick.slot } : pick.pair === 'as' ? { pair: 'as', camera_id: pick.camera_id } : { pair: 'keep' };
          if (pick.pair === 'as' && !await concert.sure('The phone that is this camera now will no longer be able to connect. Put this phone in its place?')) return;
          go.disabled = true; result.textContent = '';
          try { await api(`/api/phones/${encodeURIComponent(phone.serial)}/setup`, plan); delete asked[phone.serial]; } catch (error) { result.textContent = error.message; }
          await refresh();
        };
        card.append(go);
      }
      if (phone.job) card.append(progress(phone.job));
    }
    list.append(card);
  }
}
async function refresh() {
  try { latest = await api('/api/phones'); draw(); }
  catch (error) { result.textContent = error.message; }
}

async function enter(session) {
  csrf = session.csrf; window.concert.session = session; window.concert.nav(session.role);
  document.querySelector('#password').value = ''; document.querySelector('#login').hidden = true; document.querySelector('#setup').hidden = false;
  if (session.role !== 'admin' || session.away) { trouble.hidden = false; trouble.textContent = 'Phones are set up by the administrator, at the PC they are plugged into.'; return; }
  await refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 2500);
}
document.querySelector('#login').onsubmit = async e => {
  e.preventDefault();
  try { await enter(await api('/api/login', { password: document.querySelector('#password').value })); }
  catch (error) { result.textContent = error.message; }
};
window.concert.resume().then(session => { if (session) enter(session); });
