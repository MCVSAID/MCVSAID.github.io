'use strict';
// The People page (Plus AI, administrators only): consenting performers, their reference pictures, stars and who each
// camera follows. Consent is one tick per performer, or none at all when the production handles releases by contract.
// See docs/PRIVACY_PERFORMER_LIBRARY.md.
const result = document.querySelector('#result');
let state = null, held = null, chosen = null, drawing = null, settingsOpen = false;

function el(tag, text, className) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (className) e.className = className; return e; }
async function api(path, body) {
  const options = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.concert.session?.csrf || '' }, body: JSON.stringify(body) };
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.detail || `HTTP ${response.status}`);
  return data;
}
async function act(call) { try { result.textContent = ''; const answer = await call(); if (answer && answer.performers) { state = answer; draw(); } return answer; } catch (error) { result.textContent = error.message; return null; } }
const day = seconds => new Date(seconds * 1000).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
const when = seconds => new Date(seconds * 1000).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function enter(session) {
  document.querySelector('#password').value = ''; document.querySelector('#login').hidden = true;
  window.concert.session = session; window.concert.nav(session.role);
  if (session.role !== 'admin') { document.querySelector('header p').textContent = 'Only the administrator can see or change this page.'; return; }
  document.querySelector('#people').hidden = false;
  await load();
}
document.querySelector('#login').onsubmit = async event => {
  event.preventDefault();
  try { await enter(await api('/api/login', { password: document.querySelector('#password').value })); } catch (error) { result.textContent = error.message; }
};
window.concert.resume().then(session => { if (session) enter(session); });

async function load() { await act(async () => api('/api/people')); }

function draw() {
  notice(); recognition(); addForm(); performers(); settings();
}

// -- what is missing, if anything ----------------------------------------------------------------------------------------
function notice() {
  const box = document.querySelector('#notice'); box.replaceChildren(); box.className = '';
  const say = (text, link) => { box.className = 'card warn'; const p = el('p', text); if (link) { p.append(' '); const a = el('a', link[1]); a.href = link[0]; p.append(a); } box.append(p); };
  if (!state.plus) say('Recognising performers is part of Plus AI. Choose Plus under AI assistance first.', ['/director', 'Director page, AI assistance']);
  else if (!state.detector || !state.appearance) say(`The Plus set-up is not finished: ${state.why || 'the appearance model is not downloaded yet'}.`, ['/director', 'Finish it under AI assistance']);
}

// -- on and off ----------------------------------------------------------------------------------------------------------
function recognition() {
  const box = document.querySelector('#recognition'); box.replaceChildren();
  const on = state.active, r = state.recognition || {};
  const head = el('h2'); head.append('Performer recognition: ', el('span', on ? 'ON' : 'OFF', on ? 'on' : 'off')); box.append(head);
  box.append(el('p', on ? (r.scope === 'location' ? 'On at this location until you turn it off.' : `On for today's show; it turns itself off at midnight${r.until ? ` (${when(r.until)})` : ''}.`)
                        : 'Off: nobody is recognised, whatever is enrolled. While it is on, every page of the dashboard says so.', 'hint'));
  const row = el('div', null, 'row');
  if (on) { const off = el('button', 'Turn off'); off.onclick = () => act(() => api('/api/people-settings', { recognition: { on: false } })); row.append(off); }
  else {
    const ready = state.plus && state.detector && state.appearance;
    const today = el('button', "Turn on for today's show"); today.disabled = !ready; today.onclick = () => act(() => api('/api/people-settings', { recognition: { on: true, scope: 'show' } }));
    const here = el('button', 'Turn on at this location'); here.disabled = !ready; here.onclick = () => act(() => api('/api/people-settings', { recognition: { on: true, scope: 'location' } }));
    row.append(today, here);
    if (!state.performers.length && ready) row.append(el('small', 'Add performers below first.'));
  }
  box.append(row);
}

// -- adding a performer --------------------------------------------------------------------------------------------------
function addForm() {
  const camera = document.querySelector('#camera'), keep = camera.value;
  camera.replaceChildren(...state.cameras.map(c => { const o = el('option', c.name); o.value = c.id; return o; }));
  if ([...camera.options].some(o => o.value === keep)) camera.value = keep;
  document.querySelector('#take').disabled = !state.cameras.length || !state.plus || !state.appearance;
  const as = document.querySelector('#as'), was = as.value;
  as.replaceChildren(el('option', 'a new performer'), ...state.performers.map(p => { const o = el('option', `another picture of ${p.name}`); o.value = p.id; return o; }));
  as.options[0].value = ''; as.value = [...as.options].some(o => o.value === was) ? was : '';
  // Under a contract arrangement the release is not asked for: the arrangement covers everyone enrolled.
  const contract = !!state.arrangement;
  document.querySelector('#release-line').hidden = contract;
  document.querySelector('#improve-text').textContent = contract && state.arrangement.improve
    ? 'Their contract also covers improving MCVSAID (untick if this performer opted out)' : 'They also agreed to their data being used to improve MCVSAID (optional)';
  if (contract && state.arrangement.improve && !document.querySelector('#enrol').dataset.touched) document.querySelector('#improve').checked = true;
  // Faces only where the release (or the contract) says so; without the face model there is nothing to ask.
  document.querySelector('#faces-line').hidden = !state.faces;
  document.querySelector('#faces-text').textContent = contract && state.arrangement.faces
    ? 'Their contract also covers recognising their face (untick if this performer opted out)' : 'Their release also covers recognising their face (optional: without it, only how they look is used)';
  if (contract && state.arrangement.faces && !document.querySelector('#enrol').dataset.touchedFaces) document.querySelector('#faces').checked = true;
  fields();
}
function fields() { document.querySelector('#new-fields').hidden = !!document.querySelector('#as').value; }
document.querySelector('#as').onchange = fields;
document.querySelector('#improve').onchange = () => { document.querySelector('#enrol').dataset.touched = 'yes'; };
document.querySelector('#faces').onchange = () => { document.querySelector('#enrol').dataset.touchedFaces = 'yes'; };

document.querySelector('#take').onclick = async () => {
  const button = document.querySelector('#take'); button.disabled = true; button.textContent = 'Taking…';
  const answer = await act(() => api('/api/people/picture', { camera_id: document.querySelector('#camera').value }));
  button.disabled = false; button.textContent = 'Take another picture';
  if (!answer) return;
  held = answer; chosen = null;
  const img = document.querySelector('#shot'); img.src = answer.url;
  document.querySelector('#picture').hidden = false; document.querySelector('#enrol').hidden = false;
  if (!answer.people.length) result.textContent = answer.detector ? 'Nobody was found in this picture: drag a box around the performer.' : 'Drag a box around the performer.';
  outline();
};
document.querySelector('#discard').onclick = () => { held = chosen = null; document.querySelector('#picture').hidden = true; document.querySelector('#enrol').hidden = true; document.querySelector('#shot').removeAttribute('src'); };

function outline() {
  const svg = document.querySelector('#boxes'); svg.replaceChildren();
  if (!held) return;
  const rect = (box, kind) => { const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('x', box[0]); r.setAttribute('y', box[1]); r.setAttribute('width', box[2] - box[0]); r.setAttribute('height', box[3] - box[1]); r.setAttribute('class', kind); svg.append(r); };
  for (const person of held.people) rect(person.box, chosen && person.box.join() === chosen.join() ? 'box chosen' : 'box');
  if (chosen && !held.people.some(p => p.box.join() === chosen.join())) rect(chosen, 'box chosen');
}
// A click picks the person under it; a drag draws a box.
const picture = document.querySelector('#picture');
const at = event => { const r = document.querySelector('#shot').getBoundingClientRect(); return [Math.min(1, Math.max(0, (event.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (event.clientY - r.top) / r.height))]; };
picture.addEventListener('pointerdown', event => { if (!held) return; drawing = at(event); picture.setPointerCapture(event.pointerId); });
picture.addEventListener('pointermove', event => { if (!drawing) return; const [x, y] = at(event); chosen = [Math.min(drawing[0], x), Math.min(drawing[1], y), Math.max(drawing[0], x), Math.max(drawing[1], y)]; outline(); });
picture.addEventListener('pointerup', event => {
  if (!drawing) return; const [x, y] = at(event), start = drawing; drawing = null;
  if (Math.abs(x - start[0]) < 0.01 && Math.abs(y - start[1]) < 0.02) {
    const hits = held.people.filter(p => x >= p.box[0] && x <= p.box[2] && y >= p.box[1] && y <= p.box[3]);
    hits.sort((a, b) => (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]) - (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]));
    chosen = hits.length ? hits[0].box : null;
  }
  outline();
  if (chosen) document.querySelector(document.querySelector('#as').value ? '#enrol-button' : '#name').focus();
});

document.querySelector('#enrol').onsubmit = async event => {
  event.preventDefault();
  if (!held) return;
  if (!chosen) { result.textContent = 'Click the performer in the picture first, or drag a box around them.'; return; }
  const existing = document.querySelector('#as').value;
  if (existing) { if (await act(() => api(`/api/people/${existing}`, { reference: { picture: held.picture, box: chosen } }))) result.textContent = 'Picture added.'; return; }
  const name = document.querySelector('#name').value.trim();
  if (!name) { result.textContent = 'Their name, please.'; document.querySelector('#name').focus(); return; }
  if (!state.arrangement && !document.querySelector('#release').checked) { result.textContent = "Tick that you have this performer's signed release, or set up a contract arrangement below."; document.querySelector('#release').focus(); return; }
  const done = await act(() => api('/api/people', { picture: held.picture, box: chosen, name, role: document.querySelector('#role').value,
    instruments: document.querySelector('#instruments').value.split(',').map(s => s.trim()).filter(Boolean),
    show: state.arrangement ? undefined : true, improve: document.querySelector('#improve').checked, faces: state.faces ? document.querySelector('#faces').checked : undefined }));
  if (done) {
    result.textContent = `${name} added.`;
    for (const id of ['#name', '#instruments']) document.querySelector(id).value = '';
    document.querySelector('#release').checked = false; document.querySelector('#improve').checked = false; document.querySelector('#faces').checked = false;
    delete document.querySelector('#enrol').dataset.touched; delete document.querySelector('#enrol').dataset.touchedFaces;
    chosen = null; outline(); addForm();
  }
};

// -- the performers ------------------------------------------------------------------------------------------------------
function performers() {
  const box = document.querySelector('#performers'); box.replaceChildren();
  box.append(el('h2', `Performers (${state.performers.length})`));
  if (!state.performers.length) { box.append(el('p', 'Nobody yet.', 'hint')); return; }
  const grid = el('div', null, 'grid'); box.append(grid);
  for (const p of state.performers) {
    const card = el('article', null, 'performer');
    const top = el('div', null, 'top');
    const pictures = el('div', null, 'thumbs');
    p.references.forEach((r, n) => {
      const figure = el('figure'); const img = el('img'); img.alt = `${p.name}, picture ${n + 1}`; if (r.thumbnail) img.src = `/api/people/${p.id}/thumbnail/${n}?${r.taken}`;
      const remove = el('button', '×', 'remove'); remove.title = 'Remove this picture'; remove.setAttribute('aria-label', `Remove picture ${n + 1} of ${p.name}`);
      remove.onclick = () => act(() => api(`/api/people/${p.id}`, { remove_reference: n }));
      figure.append(img, remove, quality(r)); pictures.append(figure);
    });
    const who = el('div'); who.append(el('h3', p.name), el('small', `${p.label}${p.instruments.length ? ' · ' + p.instruments.join(', ') : ''}`));
    top.append(pictures, who); card.append(top);
    for (const warning of p.advice || (p.references.length ? [] : ['No picture: they cannot be recognised. Add one above.'])) card.append(el('p', warning, 'warn'));
    const role = el('select'); for (const [value, text] of [['performer', 'Performer'], ['star', 'Star: priority on any camera']]) { const o = el('option', text); o.value = value; role.append(o); }
    role.value = p.role; role.onchange = () => act(() => api(`/api/people/${p.id}`, { role: role.value }));
    const roleLabel = el('label', 'Role '); roleLabel.append(role); card.append(roleLabel);
    const follow = el('fieldset', null, 'follow'); follow.append(el('legend', 'Cameras that follow them'));
    for (const c of state.cameras) {
      const label = el('label', null, 'check'); const box2 = el('input'); box2.type = 'checkbox'; box2.checked = p.follow.includes(c.id);
      box2.onchange = () => act(() => api(`/api/people/${p.id}`, { follow: [...follow.querySelectorAll('input')].filter(i => i.checked).map(i => i.dataset.id) }));
      box2.dataset.id = c.id; label.append(box2, c.name); follow.append(label);
    }
    card.append(follow);
    // Face blur's "Blur only chosen people" (Director page): this performer's face is blurred wherever they are recognised.
    // Experimental: shown only while an administrator has switched face blur on (System › This PC).
    if (state.face_blur) {
      const blurLabel = el('label', null, 'check'); const blurBox = el('input'); blurBox.type = 'checkbox'; blurBox.checked = !!p.blur_face;
      blurBox.onchange = () => act(() => api(`/api/people/${p.id}`, { blur_face: blurBox.checked }));
      blurLabel.append(blurBox, ' Blur their face, on cameras set to blur only chosen people (Director › Face blur). Experimental: it may miss their face, especially small, turned or moving fast; do not rely on it to hide them.'); card.append(blurLabel);
    }
    const show = p.consent.show, improve = p.consent.improve;
    const consent = el('p', null, 'consent');
    consent.append(show.basis === 'contract' ? `Covered by contract${show.reference ? ` (${show.reference})` : ''}, ${day(show.recorded)}.` : `Signed release confirmed ${day(show.recorded)}${show.reference ? ` (${show.reference})` : ''}.`);
    consent.append(' ', show.faces ? 'Recognised by face too.' : 'Recognised by how they look only, not their face.');
    consent.append(' ', improve ? `Improving MCVSAID: agreed (${improve.basis}).` : 'Improving MCVSAID: not agreed.');
    consent.append(' ', state.keep_days ? `Their data is deleted on ${day(p.expires)}.` : `Their data is deleted at the end of the show day, ${day(p.expires - 1)}.`);
    card.append(consent);
    const row = el('div', null, 'row');
    const better = el('button', improve ? 'Withdraw improvement consent' : 'They agreed to help improve MCVSAID');
    better.onclick = () => act(() => api(`/api/people/${p.id}`, improve ? { withdraw: 'improve' } : { consent: 'improve' }));
    const remove = el('button', 'Remove and delete their data', 'danger');
    remove.onclick = async () => { const ok = await window.concert.ask({ title: `Delete ${p.name}?`, text: 'Their pictures, appearance and consent record are deleted now, and anything kept to improve MCVSAID under their code. This cannot be undone.', fields: [], ok: 'Delete', danger: true }); if (ok) act(() => api(`/api/people/${p.id}`, { withdraw: 'show' })); };
    const faceButton = el('button', show.faces ? 'Stop using their face' : 'Their release covers their face');
    faceButton.title = show.faces ? 'Their face descriptors are deleted; they are recognised by how they look only' : 'From the next picture added, their face is used too';
    faceButton.onclick = () => act(() => api(`/api/people/${p.id}`, show.faces ? { withdraw: 'faces' } : { consent: 'faces' }));
    if (state.faces || show.faces) row.append(faceButton);
    row.append(better, remove); card.append(row);
    grid.append(card);
  }
}

// How good a reference picture is for recognising them by their face: found or not, its size, and why not.
function quality(r) {
  const camera = (state.cameras.find(c => c.id === r.camera) || {}).name || r.camera || 'a camera';
  const q = r.quality;
  if (!state.faces || !q) return el('figcaption', camera);
  const caption = el('figcaption', null, r.face ? 'face good' : 'face poor');
  caption.append(camera, el('br'), r.face ? `face clear, eyes ${Math.round(q.eyes)} px apart` : `face: ${q.found === false ? 'not found' : q.why || 'not usable'}${q.eyes ? `, eyes ${Math.round(q.eyes)} px apart` : ''}`);
  caption.title = q.sharp != null ? `turned ${q.turned}, tilted ${q.tilted}, sharpness ${q.sharp}` : '';
  return caption;
}

// -- how consent is handled, how long data is kept, delete everything --------------------------------------------------
function settings() {
  const box = document.querySelector('#settings'); box.replaceChildren();
  const details = el('details'); details.open = settingsOpen; details.ontoggle = () => { settingsOpen = details.open; }; details.append(el('summary', 'Consent and keeping data'));
  const contract = !!state.arrangement;
  const form = el('form');
  const ask = el('label', null, 'check'); const askBox = el('input'); askBox.type = 'radio'; askBox.name = 'how'; askBox.checked = !contract; ask.append(askBox, "Confirm each performer's signed release as they are added (one tick)");
  const byContract = el('label', null, 'check'); const contractBox = el('input'); contractBox.type = 'radio'; contractBox.name = 'how'; contractBox.checked = contract;
  byContract.append(contractBox, 'Releases are handled by contract before the show: do not ask for each performer');
  const extra = el('div', null, 'indent');
  const improve = el('label', null, 'check'); const improveBox = el('input'); improveBox.type = 'checkbox'; improveBox.checked = !!state.arrangement?.improve;
  improve.append(improveBox, 'The contracts also cover using their data to improve MCVSAID');
  const facesCovered = el('label', null, 'check'); const facesBox = el('input'); facesBox.type = 'checkbox'; facesBox.checked = !!state.arrangement?.faces;
  facesCovered.append(facesBox, 'The contracts also cover recognising their faces');
  const note = el('label', 'Contract or agreement (a note for your records, optional) '); const noteBox = el('input'); noteBox.value = state.arrangement?.reference || ''; noteBox.autocomplete = 'off'; note.append(noteBox);
  extra.append(improve, facesCovered, note);
  const sync = () => { extra.hidden = !contractBox.checked; }; askBox.onchange = contractBox.onchange = sync; sync();
  const save = el('button', 'Save');
  form.onsubmit = event => { event.preventDefault(); act(() => api('/api/people-settings', { arrangement: { contract: contractBox.checked, improve: contractBox.checked && improveBox.checked, faces: contractBox.checked && facesBox.checked, reference: noteBox.value } })); };
  form.append(el('p', 'MCVSAID records that consent was confirmed, by whom and when. The signed releases or contracts themselves stay with you.', 'hint'), ask, byContract, extra, save);
  details.append(form);
  const keep = el('label', 'Delete performer data '); const keepBox = el('select');
  for (const [days, text] of [[0, 'at the end of the show day'], [7, 'after 7 days'], [30, 'after 30 days'], [90, 'after 90 days'], [365, 'after a year']]) { const o = el('option', text); o.value = days; keepBox.append(o); }
  if (![...keepBox.options].some(o => Number(o.value) === state.keep_days)) { const o = el('option', `after ${state.keep_days} days`); o.value = state.keep_days; keepBox.append(o); }
  keepBox.value = state.keep_days; keepBox.onchange = () => act(() => api('/api/people-settings', { keep_days: Number(keepBox.value) }));
  keep.append(keepBox);
  details.append(el('h3', 'Keeping data'), keep, el('small', 'Ask each performer how long you may keep it (for a tour, say), and keep the shortest. Three years at most.', 'hint'));
  const wipe = el('button', 'Delete all performer data', 'danger');
  wipe.onclick = async () => { const answer = await window.concert.ask({ title: 'Delete all performer data?', text: 'Every performer, picture and consent record, and everything kept to improve MCVSAID, is deleted, and the encryption key with them. Type DELETE to confirm.', fields: [{ name: 'word', label: 'Type DELETE' }], ok: 'Delete everything', danger: true });
    if (answer && answer.word === 'DELETE') act(() => api('/api/people-settings', { delete_all: 'DELETE' })); };
  details.append(el('h3', 'Everything'), wipe);
  box.append(details);
}
