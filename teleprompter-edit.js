'use strict';
// The dashboard's Teleprompter page (prompter.py): what is on the teleprompter and its controls, the scripts written for
// it, and (for the administrator) offering it to a tablet on the camera network behind its PIN.
let csrf = '', state = null, editing = null, shownPin = '';
const $ = selector => document.querySelector(selector), result = $('#result');
function node(tag, text, className) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
async function api(path, body) {
  const r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || `${r.status}`);
  return data;
}
async function act(path, body) { try { const answer = await api(path, body); result.textContent = ''; return answer; } catch (error) { result.textContent = error.message; return null; } }
const control = async body => { const answer = await act('/api/teleprompter', body); if (answer) take(answer); };

// What each kind of event's teleprompter is for (modes.py): said above the scripts.
const FOR = {
  concert: 'Live music: lyrics, a line at a time. Following is off by default, as sung words are heard less surely than spoken ones: ▼ or a page turner moves on a line.',
  worship: 'Worship: readings and the sermon followed by voice as they are read; songs as lyrics; sermon points as notes.',
  podcast: 'Podcast: the opening, ad reads and the close read out, followed by voice; questions as notes to speak from.',
  panel: 'Panel: the moderator’s introduction and thanks read out, followed by voice; questions as notes.',
  theatre: 'Theatre: the MC’s links between acts, read out and followed by voice.',
  cooking: 'Cooking: “The recipe” is a script made from the recipe, a section for each step, its concise wording first. It keeps to the recipe’s step, and its Next and Back move the recipe as the Recipe page’s do. Scripts of your own (a hello, a goodbye) are read as anywhere else.',
  creator: 'Creator Studio: a script read to camera, followed word by word.',
  karaoke: 'Karaoke night: each script is a song, named “Title – Artist”, its words lyrics, followed as they are sung. The Karaoke page’s Next singer puts each singer’s song up; guests choose from these when they sign up. Type in only words you have the right to show.',
};

async function enter(session) {
  csrf = session.csrf; $('#password').value = ''; $('#login').hidden = true; $('#prompter-edit').hidden = false;
  if (window.concert) { window.concert.session = session; window.concert.nav(session.role); }
  await refresh(); setInterval(refresh, 1000);
  pick(null);
}
$('#login').onsubmit = async event => {
  event.preventDefault();
  try { await enter(await api('/api/login', { name: $('#username').value, password: $('#password').value })); } catch (error) { result.textContent = error.message; }
};
fetch('/api/session').then(r => r.ok ? r.json() : null).then(session => { if (session) enter(session); }).catch(() => {});

async function refresh() { const answer = await act('/api/teleprompter'); if (answer) take(answer); }
let sections = [];
function take(answer) {
  if (answer.sections) sections = answer.sections;
  state = answer; draw();
}

function draw() {
  const use = $('#use'), list = state.scripts || [];
  if (!use.matches(':focus')) {
    use.replaceChildren(...list.map(s => { const o = node('option', s.name); o.value = s.id; return o; }));
    use.value = state.script || '';
  }
  const section = sections[state.section];
  $('#now-said').textContent = section ? `Section ${state.section + 1} of ${sections.length}${section.title ? `: ${section.title}` : ''} (${section.kind})` : 'No script yet: write one below.';
  const words = section ? section.words : [];
  $('#preview').textContent = section ? [words.slice(Math.max(0, state.word - 8), state.word).map(w => w.w).join(' '), '▸', words.slice(state.word, state.word + 12).map(w => w.w).join(' ')].join(' ') : '';
  $('#d-play').textContent = state.playing ? '⏸ Pause' : '▶ Play';
  $('#d-follow').checked = state.follow;
  $('#follow-said').textContent = !state.follow ? 'Moved by hand, or by Play at the tablet’s speed.'
    : !state.listening ? 'Following needs speech switched on (Sound page, Standard AI or above); until then it is moved by hand.'
    : state.behind ? 'Following the programme’s sound, which is held a few seconds behind. For no wait, choose a microphone, or the speaker’s camera’s own sound, under Listen to on the Sound page.'
    : 'Following the voice as it is heard.';
  $('#mode-said').textContent = FOR[state.mode] || '';
  // The scripts to edit: those written here (the recipe's is the recipe's).
  const pickList = $('#pick'), own = list.filter(s => !s.own), key = JSON.stringify(own);
  if (pickList.dataset.key !== key) {
    pickList.dataset.key = key;
    const prompt = node('option', own.length ? 'Choose a script to edit' : 'No scripts yet'); prompt.value = '';
    pickList.replaceChildren(prompt, ...own.map(s => { const o = node('option', s.name); o.value = s.id; return o; }));
    pickList.value = editing || '';
  }
  tablet();
}

// ---- the controls, as on the tablet ----
$('#use').onchange = event => control({ script: event.target.value });
$('#d-back').onclick = () => control({ do: 'back' });
$('#d-next').onclick = () => control({ do: 'next' });
$('#d-line-back').onclick = () => control({ do: 'line_back' });
$('#d-line-next').onclick = () => control({ do: 'line_next' });
$('#d-play').onclick = () => control({ do: state.playing ? 'pause' : 'play' });
$('#d-follow').onchange = event => control({ follow: event.target.checked });

// ---- writing scripts ----
async function pick(identifier) {
  const answer = await act(`/api/teleprompter/scripts/${encodeURIComponent(identifier || 'new')}`);
  if (!answer) return;
  editing = answer.id; $('#name').value = answer.name; $('#script-text').value = answer.text;
  $('#pick').value = editing || ''; $('#remove').hidden = !editing;
}
$('#pick').onchange = event => { if (event.target.value) pick(event.target.value); };
$('#new').onclick = () => pick(null);
$('#save').onclick = async () => {
  const answer = await act('/api/teleprompter/scripts', { name: $('#name').value || 'Script', text: $('#script-text').value, ...(editing ? { id: editing } : {}) });
  if (answer) { editing = answer.saved; take(answer); $('#pick').value = editing; $('#remove').hidden = false; result.textContent = 'Saved.'; }
};
$('#remove').onclick = async () => {
  if (!editing || !await concert.sure(`Remove “${$('#name').value}”?\nIt cannot be brought back.`, { ok: 'Remove', danger: true })) return;
  const answer = await act('/api/teleprompter/scripts', { remove: editing });
  if (answer) { take(answer); pick(null); }
};

// ---- the tablet: offered on the camera network, behind its PIN (the administrator's) ----
function tablet() {
  const access = state.access, panel = $('#tablet-panel');
  $('#tablet').hidden = !access;
  // Not while a PIN is being typed into it.
  if (!access || (panel.contains(document.activeElement) && document.activeElement.type === 'text')) return;
  const key = JSON.stringify([access, shownPin]);
  if (panel.dataset.key === key) return;
  panel.dataset.key = key; panel.replaceChildren();
  const label = node('label'), box = document.createElement('input'); box.type = 'checkbox'; box.checked = access.wanted;
  box.onchange = async () => { const answer = await act('/api/teleprompter', { enabled: box.checked }); if (answer) { if (answer.access?.pin_once) shownPin = answer.access.pin_once; take(answer); } };
  label.append(box, node('span', ' Offer the teleprompter to tablets on the camera network')); panel.append(label);
  panel.append(node('small', access.wanted !== access.running ? `Restart the manager to ${access.wanted ? 'start' : 'stop'} offering it.`
    : access.running ? `Open ${access.address} on a tablet joined to the camera Wi-Fi, and enter the PIN. It opens the teleprompter only: no settings, recordings or cameras.${access.tablets ? ` Open on ${access.tablets} tablet${access.tablets === 1 ? '' : 's'} now.` : ''}`
    : 'Off: the teleprompter is only on this computer (Open full screen above).'));
  if (shownPin) panel.append(node('p', `PIN: ${shownPin} (shown this once: note it down)`, 'recording-warning'));
  if (access.wanted) {
    const fresh = node('button', access.pin_set ? 'Make a new PIN' : 'Make a PIN');
    fresh.onclick = async () => {
      if (access.pin_set && !await concert.sure('Make a new PIN? The present one stops working and tablets using the teleprompter are logged out.')) return;
      const answer = await act('/api/teleprompter', { new_pin: true }); if (answer) { if (answer.access?.pin_once) shownPin = answer.access.pin_once; take(answer); }
    };
    const own = document.createElement('input'); own.type = 'text'; own.inputMode = 'numeric'; own.autocomplete = 'off'; own.maxLength = 8; own.placeholder = 'or type your own (4 to 8 digits)'; own.setAttribute('aria-label', 'A PIN of your own');
    const use = node('button', 'Set this PIN');
    use.onclick = async () => {
      if (!/^\d{4,8}$/.test(own.value)) { result.textContent = 'A PIN is 4 to 8 digits.'; return; }
      if (access.pin_set && !await concert.sure('Set this PIN? The present one stops working and tablets using the teleprompter are logged out.')) return;
      const answer = await act('/api/teleprompter', { set_pin: own.value });
      if (answer) { shownPin = ''; own.value = ''; result.textContent = 'PIN set. It is not kept anywhere readable, so note it down.'; take(answer); }
    };
    panel.append(node('p'), fresh, own, use);
  }
}
