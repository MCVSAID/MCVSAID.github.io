'use strict';
// A guest signing up to sing at karaoke night (karaoke.py): the night's code from the QR code's address, a first name, a
// song from the list. Their place in the line is shown after, from the ticket kept on this phone for the night.
const $ = selector => document.querySelector(selector), said = $('#said');
let code = (new URLSearchParams(location.search).get('code') || '').toUpperCase(), songs = [], chosen = null;
function node(tag, text, className) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
const kept = () => { try { return JSON.parse(localStorage.getItem(`karaoke-${code}`) || '[]'); } catch (error) { return []; } };
const keep = tickets => { try { localStorage.setItem(`karaoke-${code}`, JSON.stringify(tickets)); } catch (error) { /* this visit only */ } };
let tickets = [];

async function api(path, body) {
  const r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const error = new Error(data.detail || `${r.status}`); error.status = r.status; throw error; }
  return data;
}

async function open() {
  if (!code) { $('#code-form').hidden = false; return; }
  try {
    const answer = await api(`/api/karaoke/songs?code=${encodeURIComponent(code)}`);
    songs = answer.songs; $('#code-form').hidden = true; $('#join-form').hidden = false; said.textContent = '';
    $('#approve-said').textContent = answer.approve ? 'The host sees your name before it goes on the screen.' : '';
    list(); tickets = kept(); places(); setInterval(places, 10000);
  } catch (error) { said.textContent = error.message; if (error.status === 403) { $('#code-form').hidden = false; $('#join-form').hidden = true; } }
}
$('#code-form').onsubmit = event => { event.preventDefault(); code = $('#code').value.trim().toUpperCase(); open(); };

function list() {
  const wanted = $('#find').value.trim().toLowerCase();
  const shown = songs.filter(s => !wanted || s.name.toLowerCase().includes(wanted));
  $('#songs').replaceChildren(...shown.map(s => {
    const item = node('li', s.name); item.setAttribute('role', 'option'); item.tabIndex = 0;
    item.setAttribute('aria-selected', String(s.id === chosen));
    item.onclick = item.onkeydown = event => { if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return; event.preventDefault?.(); chosen = s.id; list(); };
    return item;
  }));
  if (!shown.length) $('#songs').append(node('li', songs.length ? 'No song matches: ask the host' : 'No songs on the list yet', 'none'));
  $('#sing').disabled = !chosen;
}
$('#find').oninput = list;

$('#join-form').onsubmit = async event => {
  event.preventDefault();
  try {
    const answer = await api('/api/karaoke/join', { code, name: $('#name').value, song: chosen });
    tickets = [...tickets, answer.ticket]; keep(tickets); chosen = null; $('#find').value = ''; list();
    $('#join-form').hidden = true; said.textContent = '';
    await places();
  } catch (error) { said.textContent = error.message; }
};
$('#another').onclick = () => { $('#join-form').hidden = false; $('#another').hidden = true; };

const WORDS = { asked: 'Waiting for the host to put you in the line', up: 'You’re up! Head to the microphone', done: 'Sung: thank you!', skipped: 'Taken out of the line: ask the host' };
async function places() {
  if (!tickets.length) { $('#mine').hidden = true; return; }
  const rows = [];
  for (const ticket of tickets) {
    try {
      const p = await api(`/api/karaoke/place?ticket=${encodeURIComponent(ticket)}`);
      const where = p.state === 'waiting' ? (p.place === 1 ? 'You’re next!' : `Number ${p.place} in the line`) : WORDS[p.state];
      const item = node('li'); item.append(node('strong', `${p.name} · ${p.song}`), node('span', where, `place ${p.state}`)); rows.push(item);
    } catch (error) { if (error.status === 404) tickets = tickets.filter(t => t !== ticket); }
  }
  keep(tickets);
  $('#tickets').replaceChildren(...rows); $('#mine').hidden = !rows.length;
  $('#another').hidden = !$('#join-form').hidden;
}
open();
