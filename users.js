'use strict';
// The Users page (administrators only): the named accounts that can log in, each with one role (users.py). Adding,
// renaming, a new password, another role, removing; each takes effect at once for whoever is logged in to it.
const result = document.querySelector('#result');
let state = null;

function el(tag, text, className) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (className) e.className = className; return e; }
async function api(path, body) {
  const options = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.concert.session?.csrf || '' }, body: JSON.stringify(body) };
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.detail || `HTTP ${response.status}`);
  return data;
}
// A password made here, shown until the page is left: the manager cannot show it again.
function showOnce(who, password) {
  const box = document.querySelector('#once');
  box.replaceChildren(el('h3', `Password for ${who}`), el('p', password), el('p', 'Hand it over or write it down now: it is not kept anywhere and cannot be shown again.'));
  box.hidden = false;
}
async function act(call, who) {
  try {
    result.textContent = '';
    const answer = await call();
    if (answer?.users) { state = answer; draw(); }
    if (answer?.password_once) showOnce(who, answer.password_once);
    return answer;
  } catch (error) { result.textContent = error.message; return null; }
}
const day = seconds => seconds ? new Date(seconds * 1000).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '';

async function enter(session) {
  document.querySelector('#password').value = ''; document.querySelector('#login').hidden = true;
  window.concert.session = session; window.concert.nav(session.role);
  if (session.role !== 'admin') { document.querySelector('header p').textContent = 'Only the administrator can see or change this page, at the manager PC.'; return; }
  document.querySelector('#users').hidden = false;
  await act(() => api('/api/users'));
}
document.querySelector('#login').onsubmit = async event => {
  event.preventDefault();
  try { await enter(await api('/api/login', { name: document.querySelector('#username').value, password: document.querySelector('#password').value })); } catch (error) { result.textContent = error.message; }
};
window.concert.resume().then(session => { if (session) enter(session); });

document.querySelector('#add').onsubmit = async event => {
  event.preventDefault();
  const name = document.querySelector('#add-name').value.trim(), role = document.querySelector('#add-role').value, password = document.querySelector('#add-password').value;
  const done = await act(() => api('/api/users', { name, role, ...(password ? { password } : {}) }), name);
  if (done) { document.querySelector('#add-name').value = ''; document.querySelector('#add-password').value = ''; if (password) result.textContent = `${name} added, with the password you typed.`; }
};

function label(user) { return user.name || (user.role === 'admin' ? 'The administrator (no name yet)' : user.role === 'operator' ? 'Operators’ shared password (no name yet)' : 'No name yet'); }

function draw() {
  const table = document.querySelector('#accounts');
  const head = el('tr'); for (const title of ['Name', 'Role', 'Logged in', 'Added', '']) head.append(el('th', title));
  table.replaceChildren(head);
  const admins = state.users.filter(u => u.role === 'admin').length;
  for (const user of state.users) {
    const row = el('tr'), who = label(user);
    const name = el('td', who); if (user.you) name.append(el('small', ' (you)'));
    if (!user.name) name.append(el('small', user.role === 'operator' ? ' Opened by the old operator password with no name: give it a name, or add each operator and remove it.' : ' Opened by its password with no name.', 'hint'));
    const role = el('td'), pick = document.createElement('select'); pick.setAttribute('aria-label', `Role of ${who}`);
    for (const [value, word] of Object.entries(state.roles)) { const option = el('option', word.charAt(0).toUpperCase() + word.slice(1)); option.value = value; option.selected = value === user.role; pick.append(option); }
    pick.disabled = user.role === 'admin' && admins === 1;
    if (pick.disabled) pick.title = 'The only administrator: make another administrator first';
    pick.onchange = async () => {
      const word = state.roles[pick.value];
      const less = ['admin', 'operator', 'stage'].indexOf(pick.value) > ['admin', 'operator', 'stage'].indexOf(user.role);
      if (!await concert.sure(`Give ${who} the ${word} role?${less ? '\nThis takes away rights at once: wherever they are logged in, they are logged down, or out where the new role does not open that page.' : ''}`, { danger: less })) { pick.value = user.role; return; }
      await act(() => api(`/api/users/${user.id}`, { role: pick.value }), who);
      if (user.you && pick.value !== 'admin') location.reload();
    };
    role.append(pick);
    const actions = el('td');
    const rename = el('button', user.name ? 'Rename' : 'Give a name'); rename.type = 'button';
    rename.onclick = async () => { const answer = await concert.ask({ title: `Name for ${who}`, fields: [{ name: 'name', label: 'Name', value: user.name }], ok: 'Save' }); if (answer) await act(() => api(`/api/users/${user.id}`, { name: answer.name }), answer.name); };
    const out = user.you ? 'Your other logins are logged out; this one stays.' : 'They are logged out everywhere.';
    const reset = el('button', 'New password'); reset.type = 'button';
    reset.onclick = async () => { if (await concert.sure(`Make a new password for ${who}?\nIt is shown here once. The present one stops working. ${out}`, { ok: 'Make one' })) await act(() => api(`/api/users/${user.id}`, { password: 'new' }), who); };
    const own = el('button', 'Set password…'); own.type = 'button';
    own.onclick = async () => {
      const answer = await concert.ask({ title: `Password for ${who}`, text: `At least ${user.role === 'admin' ? 12 : 8} characters. ${out}`, fields: [{ name: 'password', label: 'Password', type: 'password', minLength: user.role === 'admin' ? 12 : 8 }], ok: 'Set' });
      if (answer && await act(() => api(`/api/users/${user.id}`, { password: answer.password }), who)) result.textContent = `Password set for ${who}.`;
    };
    const remove = el('button', 'Remove'); remove.type = 'button'; remove.className = 'danger'; remove.disabled = user.role === 'admin' && admins === 1;
    remove.onclick = async () => { if (await concert.sure(`Remove ${who}?\nThey can no longer log in, and are logged out everywhere now.`, { ok: 'Remove', danger: true })) { await act(() => api(`/api/users/${user.id}`, { remove: true }), who); if (user.you) location.reload(); } };
    actions.append(rename, reset, own, remove);
    row.append(name, role, el('td', user.logged_in ? `${user.logged_in} ${user.logged_in === 1 ? 'device' : 'devices'}` : '—'), el('td', day(user.since)), actions);
    table.append(row);
  }
}
