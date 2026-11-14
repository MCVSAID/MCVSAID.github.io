'use strict';
// The dashboard's Karaoke page (karaoke.py): the night's line of singers, calling up the next, and the QR code guests sign
// up by. The songs are the teleprompter's scripts, written on its page.
let csrf = '', state = null;
const $ = selector => document.querySelector(selector), result = $('#result');
function node(tag, text, className) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
async function api(path, body) {
  const r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || `${r.status}`);
  return data;
}
async function change(body) { try { take(await api('/api/karaoke', body)); result.textContent = ''; return true; } catch (error) { result.textContent = error.message; return false; } }

async function enter(session) {
  csrf = session.csrf; $('#password').value = ''; $('#login').hidden = true; $('#karaoke-page').hidden = false;
  if (window.concert) { window.concert.session = session; window.concert.nav(session.role); }
  await refresh(); setInterval(refresh, 2000);
}
$('#login').onsubmit = async event => {
  event.preventDefault();
  try { await enter(await api('/api/login', { password: $('#password').value })); } catch (error) { result.textContent = error.message; }
};
fetch('/api/session').then(r => r.ok ? r.json() : null).then(session => { if (session) enter(session); }).catch(() => {});
async function refresh() { try { take(await api('/api/karaoke')); } catch (error) { result.textContent = error.message; } }

const STATE = { asked: 'Asked from a phone', waiting: '', up: 'Singing now', done: 'Sung', skipped: 'Skipped' };
let drawn = '';
function take(answer) {
  state = answer;
  $('#not-karaoke').hidden = answer.mode === 'karaoke';
  $('#up-said').textContent = answer.up ? `${answer.up.name} · ${answer.up.song_name}` : answer.waiting ? 'Nobody yet: call up the first singer.' : 'Nobody is singing, and nobody is waiting.';
  $('#next-singer').disabled = !answer.waiting && !answer.up;
  $('#next-singer').textContent = answer.waiting ? '🎤 Next singer' : '🎤 Song over (nobody waiting)';
  const key = JSON.stringify([answer.line, answer.songs]);
  if (key !== drawn) { drawn = key; line(); songs(); }
  $('#join-at').textContent = answer.join.split('?')[0]; $('#code').textContent = answer.code;
  const qr = `/api/karaoke/qr.svg?code=${answer.code}`; if ($('#qr').getAttribute('src') !== qr) $('#qr').src = qr;
  $('#signup-on').checked = answer.signup; $('#approve-on').checked = answer.approve;
  $('#offer-said').textContent = answer.offered ? `The singer’s screen: open ${answer.screen} on a tablet or TV and enter the teleprompter’s PIN.`
    : 'The singer’s screen and signing up from phones need the teleprompter offered on the camera network: the administrator switches it on at the bottom of the Teleprompter page.';
  $('#song-count').textContent = answer.songs.length ? `${answer.songs.length} song${answer.songs.length === 1 ? '' : 's'} on the list.` : 'No songs yet.';
}

function line() {
  const still = state.line.filter(e => e.state === 'asked' || e.state === 'waiting');
  const rows = state.line.filter(e => e.state === 'up').concat(still);
  $('#line').replaceChildren(...rows.map(entry => {
    const item = node('li', '', entry.state); item.append(node('strong', entry.name), node('span', ` · ${entry.song_name}`));
    if (STATE[entry.state]) item.append(node('small', ` ${STATE[entry.state]}`));
    const buttons = node('span', '', 'row');
    const button = (label, body, title) => { const b = node('button', label); b.title = title || ''; b.onclick = () => change(body); buttons.append(b); };
    const at = still.indexOf(entry);
    if (entry.state === 'asked') button('Approve', { approve: entry.id });
    if (at > 0) button('▲', { move: entry.id, to: at - 1 }, 'Earlier in the line');
    if (at >= 0 && at < still.length - 1) button('▼', { move: entry.id, to: at + 1 }, 'Later in the line');
    if (entry.state !== 'up') button('Skip', { skip: entry.id }, 'Out of the line, kept as skipped');
    button('Remove', { remove: entry.id }, 'Out of the line altogether');
    item.append(buttons); return item;
  }));
  if (!rows.length) $('#line').append(node('li', 'Nobody in the line yet.', 'none'));
  const sung = state.line.filter(e => e.state === 'done').length;
  $('#done-said').textContent = sung ? `${sung} sung tonight.` : '';
}
function songs() {
  const pick = $('#add-song'), was = pick.value;
  pick.replaceChildren(...state.songs.map(s => { const o = node('option', s.name); o.value = s.id; return o; }));
  if (!state.songs.length) pick.append(node('option', 'No songs yet'));
  if (state.songs.some(s => s.id === was)) pick.value = was;
}

$('#next-singer').onclick = () => change({ do: 'next' });
$('#add').onclick = async () => { if (await change({ add: { name: $('#add-name').value, song: $('#add-song').value } })) $('#add-name').value = ''; };
$('#signup-on').onchange = event => change({ signup: event.target.checked });
$('#approve-on').onchange = event => change({ approve_asks: event.target.checked });
$('#new-night').onclick = async () => {
  if (!await concert.sure('Start a new night? The line is cleared and a new code is made, so the present QR code stops working.', { ok: 'New night', danger: true })) return;
  change({ do: 'new_night' });
};
