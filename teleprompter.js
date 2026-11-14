'use strict';
// The teleprompter (prompter.py): the section being read, word by word, the word being said lit and kept at the reading
// line. The place is the manager's, shared by every tablet and the dashboard; between the manager's answers the lit word
// is moved on here: at the speaking pace the manager last heard while following, or at the chosen speed while playing.
// Moved by the buttons, by keys (a page turner pedal sends Page Down / Page Up or the arrows) and by an Xbox controller.
// On a karaoke night (karaoke.py) it faces the singer: who is singing and who is next, and between songs the QR code.
let csrf = '', state = null, sections = [], words = null;
let place = { section: -1, word: 0 }, local = 0, lastFetch = 0, playedTo = null;
// Where playing began (the word, and when), or changed speed: the lit word is reckoned from it, not added up frame by
// frame, so that a browser that draws seldom (a page not in view) loses no time.
let anchor = { word: 0, at: 0, speed: 0, playing: false };
const $ = selector => document.querySelector(selector);
const text = $('#text'), said = $('#said');
const onDashboard = location.pathname.startsWith('/teleprompter/');
const kept = (key, fallback) => { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (error) { return fallback; } };
const keep = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* this visit only */ } };
let size = kept('prompter-size', 48), mirrored = kept('prompter-mirror', false);
const wordsPerSecond = speed => 0.6 + 0.3 * speed;          // speed 4 is about 110 words a minute, 10 about 215
function node(tag, words, className) { const e = document.createElement(tag); if (words !== undefined) e.textContent = words; if (className) e.className = className; return e; }

async function api(path, body) {
  const r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const error = new Error(data.detail || `${r.status}`); error.status = r.status; throw error; }
  return data;
}
async function act(body) {
  try { take(await api('/api/teleprompter', body)); said.textContent = ''; } catch (error) { said.textContent = error.message; }
}

// ---- logging in: a PIN on a tablet; the dashboard's own login when opened from its Teleprompter page ----
function keypad() {
  const pad = $('#keypad'), pin = $('#pin');
  for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK']) {
    const button = node('button', key); button.type = key === 'OK' ? 'submit' : 'button';
    if (key === '⌫') { button.setAttribute('aria-label', 'Delete'); button.onclick = () => { pin.value = pin.value.slice(0, -1); }; }
    else if (key !== 'OK') button.onclick = () => { if (pin.value.length < 8) pin.value += key; };
    pad.append(button);
  }
  document.addEventListener('keydown', event => {
    if ($('#pin-login').hidden) return;
    if (/^\d$/.test(event.key) && pin.value.length < 8) pin.value += event.key;
    else if (event.key === 'Backspace') pin.value = pin.value.slice(0, -1);
  });
  $('#pin-login').onsubmit = async event => {
    event.preventDefault();
    try { await enter(await api('/api/login', { pin: pin.value })); } catch (error) { $('#pin-said').textContent = error.message; pin.value = ''; }
  };
}
async function start() {
  const session = await fetch('/api/session').then(r => r.ok ? r.json() : null).catch(() => null);
  if (session) return enter(session);
  if (onDashboard) { document.body.replaceChildren(node('p', 'Log in on the dashboard’s Teleprompter page first, then open it full screen from there.', 'end')); return; }
  if (location.hostname.startsWith('karaoke.')) { document.title = 'Karaoke'; $('#pin-login h1').textContent = 'Karaoke'; }
  $('#pin-login').hidden = false; keypad();
}

async function enter(session) {
  csrf = session.csrf; $('#pin-login').hidden = true; $('#prompter').hidden = false;
  shown();
  await refresh(); setInterval(refresh, 300);
  requestAnimationFrame(frame); setInterval(step, 100);
  setInterval(pad, 16);
  awake();
}

// ---- the manager's answers ----
async function refresh() {
  try { take(await api(`/api/teleprompter${words === null ? '' : `?have=${words}`}`)); said.textContent = ''; }
  catch (error) { if (error.status === 401) location.reload(); else said.textContent = `Not reaching the manager: ${error.message}`; }
}
function take(answer) {
  if (answer.sections) sections = answer.sections;
  const moved = !state || answer.section !== state.section || answer.word !== state.word || answer.script !== state.script;
  state = answer; words = answer.words; lastFetch = performance.now();
  if (answer.scripts) scripts(answer.scripts);
  if (place.section !== answer.section || place.script !== answer.script || answer.sections) draw();
  if (moved) { local = answer.word; playedTo = null; }
  if (moved || answer.playing !== anchor.playing || answer.speed !== anchor.speed) anchor = { word: local, at: performance.now(), speed: answer.speed, playing: answer.playing };
  bar();
}

// ---- drawing ----
function scripts(list) {
  const select = $('#script');
  if (select.dataset.key === JSON.stringify(list) && select.value === state.script) return;
  select.dataset.key = JSON.stringify(list);
  select.replaceChildren(...list.map(s => { const o = node('option', s.name); o.value = s.id; return o; }));
  if (!list.length) select.append(node('option', 'No scripts: write one on the dashboard’s Teleprompter page'));
  select.value = state.script || '';
}
function draw() {
  place = { section: state.section, script: state.script }; litAt = -2;
  const section = sections[state.section];
  text.replaceChildren(); text.className = section ? section.kind : '';
  text.classList.toggle('mirrored', mirrored);
  if (!section) { text.append(node('p', 'Nothing to read yet.', 'end')); list(); return; }
  if (section.title) text.append(node('h2', section.title));
  let line = -1, paragraph = null;
  section.words.forEach((word, n) => {
    if (word.line !== line) {
      // Empty lines between are kept as space between paragraphs.
      for (let gap = line + 1; gap < word.line && line >= 0; gap++) text.append(node('p', ' '));
      line = word.line; paragraph = node('p'); paragraph.dataset.line = String(line); text.append(paragraph);
    }
    const span = node('span', word.w, 'w'); span.dataset.i = String(n);
    paragraph.append(span, document.createTextNode(' '));
  });
  const following = sections[state.section + 1];
  text.append(node('p', following ? `Next: ${following.title || `section ${state.section + 2}`}` : 'End of the script', 'end'));
  list();
}
function list() {
  const box = $('#sections');
  box.replaceChildren(...sections.map((s, n) => {
    const item = node('li', s.title || `Section ${n + 1}`); if (n === state.section) item.className = 'here';
    item.append(node('small', s.kind === 'read' ? '' : s.kind));
    item.onclick = () => { act({ section: n }); toggleList(false); };
    return item;
  }));
  $('#where').textContent = sections.length ? `${state.section + 1} of ${sections.length}` : '';
}
function bar() {
  $('#play').firstChild.textContent = state.playing ? '⏸' : '▶'; $('#play').querySelector('span').textContent = state.playing ? 'Pause' : 'Play';
  $('#speed').textContent = String(state.speed);
  $('#follow').setAttribute('aria-pressed', String(state.follow));
  const listen = $('#listen');
  listen.className = state.follow && state.listening ? (state.behind ? 'behind' : 'on') : '';
  listen.textContent = !state.follow ? '' : !state.listening ? 'Not listening (switch speech on: Sound page)'
    : state.behind ? 'Following (programme sound: a few seconds behind)' : 'Following your voice';
  listen.title = state.behind ? 'Speech hears the programme, which is held a few seconds behind. Choose a microphone or a camera’s own sound under Listen to on the Sound page to follow without the wait.' : '';
  const tally = $('#tally');
  tally.className = state.on_air ? 'air' : ''; tally.textContent = [state.recording ? '● REC' : '', state.on_air ? `On air: ${state.on_air}` : ''].filter(Boolean).join('  ');
  tally.hidden = !tally.textContent;
  karaoke(state.karaoke);
}

// ---- karaoke night: who is singing, who is next, and between songs the QR code to sign up by ----
let qrFor = null;
function karaoke(night) {
  const on = Boolean(night);
  document.body.classList.toggle('karaoke', on);
  $('#singer').hidden = !on || !night.up; $('#next-singer').hidden = !on;
  $('#between').hidden = !on || Boolean(night.up);
  if (!on) return;
  const named = e => `${e.name} · ${e.song}`;
  if (night.up) {
    $('#singing').textContent = `🎤 ${named(night.up)}`;
    $('#coming').textContent = night.next.length ? `Up next: ${named(night.next[0])}` : '';
  } else {
    $('#between-next').textContent = night.next.length ? `Up next: ${named(night.next[0])}` : 'Nobody waiting to sing: sign up below';
  }
  $('#join').hidden = !night.code;
  if (night.code && qrFor !== night.code) { qrFor = night.code; $('#join-qr').src = `/api/karaoke/qr.svg?code=${night.code}`; }
  $('#join-code').textContent = night.code ? `or open /join and enter ${night.code}` : '';
}
const nextSinger = () => { if (state?.karaoke) act({ do: 'next_singer' }); };

// ---- the lit word, moved on between answers, and kept at the reading line ----
function frame(at) { step(at); requestAnimationFrame(frame); }
// Also on a timer: a browser that draws seldom or not at all (a page not in view) still moves on and turns the section.
function step(at = performance.now()) {
  const section = sections[state?.section];
  if (section) {
    const count = section.words.length;
    if (state.playing && section.kind !== 'notes') {
      local = Math.min(count, anchor.word + wordsPerSecond(state.speed) * (at - anchor.at) / 1000);
      // Played to the end: on to the next section, once.
      if (local >= count && playedTo !== state.section && state.section + 1 < sections.length) { playedTo = state.section; act({ do: 'next' }); }
    } else if (state.follow && state.heard_ago !== null && state.pace > 0) {
      // Between hearings, on at the pace last heard, but never more than three words past what was heard, nor for long.
      const since = state.heard_ago + (at - lastFetch) / 1000;
      if (since < 1.5) local = Math.max(local, Math.min(count, state.word + Math.min(3, state.pace * since * 0.8)));
    }
    light(Math.floor(local), count);
  }
}
let litAt = -2;
function light(now, count) {
  if (now === litAt) return;
  litAt = now;
  const spans = text.querySelectorAll('.w');
  spans.forEach((span, n) => { span.classList.toggle('done', n < now); span.classList.toggle('now', n === now); });
  text.querySelectorAll('p.here').forEach(p => p.classList.remove('here'));
  const target = spans[Math.min(now, count - 1)];
  if (target) target.parentElement.classList.add('here');
  // The word at the reading line, a third of the way down: the start of the section before anything is said.
  const window_ = $('#window'), mark = window_.clientHeight * 0.33;
  const at = now <= 0 || !target ? 0 : target.offsetTop + target.offsetHeight / 2;
  text.style.transform = `translateY(${Math.round(mark - (now <= 0 ? mark : at))}px)`;
}
function shown() {
  text.style.setProperty('--size', `${size}px`); text.classList.toggle('mirrored', mirrored);
  $('#mirror').setAttribute('aria-pressed', String(mirrored)); litAt = -2;
}

// ---- the controls ----
const here = () => Math.min(Math.floor(local), sections[state.section]?.words.length ?? 0);
const play = () => act(state.playing ? { do: 'pause', word: here() } : { do: 'play' });
const speed = delta => act({ speed: Math.max(1, Math.min(10, state.speed + delta)) });
const sized = delta => { size = Math.max(24, Math.min(120, size + delta)); keep('prompter-size', size); shown(); };
function toggleList(open = $('#sections').hidden) { $('#sections').hidden = !open; $('#sections-button').setAttribute('aria-expanded', String(open)); }
// A line moved from where the lit word is now (played on, or moved on at the speaking pace), not from where the manager last put it.
const line = delta => act({ do: delta > 0 ? 'line_next' : 'line_back', word: here() });
$('#back').onclick = () => act({ do: 'back' });
$('#next').onclick = () => act({ do: 'next' });
$('#line-back').onclick = () => line(-1);
$('#line-next').onclick = () => line(1);
$('#play').onclick = play;
$('#slower').onclick = () => speed(-1);
$('#faster').onclick = () => speed(1);
$('#follow').onclick = () => act({ follow: !state.follow });
$('#smaller').onclick = () => sized(-6);
$('#larger').onclick = () => sized(6);
$('#mirror').onclick = () => { mirrored = !mirrored; keep('prompter-mirror', mirrored); shown(); };
$('#script').onchange = event => act({ script: event.target.value });
$('#next-singer').onclick = nextSinger;
$('#sections-button').onclick = () => toggleList();
document.addEventListener('keydown', event => {
  if ($('#prompter').hidden || event.target.tagName === 'SELECT' || event.ctrlKey || event.metaKey || event.altKey) return;
  const keys = { ' ': play, ArrowDown: () => line(1), ArrowRight: () => line(1), PageDown: () => line(1), ArrowUp: () => line(-1), ArrowLeft: () => line(-1), PageUp: () => line(-1),
                 n: () => act({ do: 'next' }), ']': () => act({ do: 'next' }), p: () => act({ do: 'back' }), '[': () => act({ do: 'back' }),
                 '+': () => speed(1), '=': () => speed(1), '-': () => speed(-1), Home: () => act({ do: 'top' }), s: nextSinger };
  const done = keys[event.key];
  if (done) { event.preventDefault(); done(); }
});

// An Xbox controller (the Gamepad API): each button acts once as it is pressed.
const held = new Map();
const PAD = { 0: play, 2: nextSinger, 3: () => act({ follow: !state.follow }), 4: () => act({ do: 'back' }), 5: () => act({ do: 'next' }), 12: () => line(-1), 13: () => line(1), 14: () => speed(-1), 15: () => speed(1) };
function pad() {
  if (!state) return;
  for (const gamepad of navigator.getGamepads ? navigator.getGamepads() : []) {
    if (!gamepad) continue;
    const was = held.get(gamepad.index) || [];
    const now = gamepad.buttons.map(b => b.pressed);
    now.forEach((down, n) => { if (down && !was[n] && PAD[n]) PAD[n](); });
    held.set(gamepad.index, now);
  }
}

// Keeps the tablet's screen on while the teleprompter is open, where the browser allows it.
async function awake() {
  try { if (navigator.wakeLock && document.visibilityState === 'visible') await navigator.wakeLock.request('screen'); } catch (error) { /* not allowed here */ }
}
document.addEventListener('visibilitychange', awake);
// The reading line moves with the reading area's size (the tablet turned, the section list opened): the words with it.
new ResizeObserver(() => { litAt = -2; step(); }).observe($('#window'));
start();
