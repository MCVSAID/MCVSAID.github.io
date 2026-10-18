'use strict';
// One fixed colour per camera, in slot order, so a camera keeps its colour from run to run. Eight at most are drawn.
const COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const SVG = 'http://www.w3.org/2000/svg';
let runs = [], drawn = null, refreshing = null;
const view = document.querySelector('#view'), compare = document.querySelector('#compare'), result = document.querySelector('#result');
function node(tag, text) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; return e; }
function shape(tag, attributes) { const e = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attributes || {})) e.setAttribute(k, v); return e; }
async function api(path, body) { const r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const d = await r.json(); if (!r.ok) throw Error(d.detail || `HTTP ${r.status}`); return d; }
function clock(seconds) { return new Date(seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function day(seconds) { return new Date(seconds * 1000).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }); }
function elapsed(seconds) { const m = Math.max(0, Math.round(seconds / 60)); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; }
function length(seconds) { const m = Math.round(seconds / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; }
function runName(run) { return `${day(run.start)} ${clock(run.start)}–${clock(run.end)} · ${length(run.end - run.start)} · ${run.cameras.length} camera${run.cameras.length === 1 ? '' : 's'}${run.resolutions.length ? ' · ' + run.resolutions.join(', ') : ''} · peak ${run.peak_c.toFixed(1)} °C`; }

async function enter(session) {
  document.querySelector('#password').value = ''; document.querySelector('#login').hidden = true; document.querySelector('#history').hidden = false;
  window.concert.session = session; window.concert.nav(session.role);
  await start();
}
document.querySelector('#login').onsubmit = async e => {
  e.preventDefault();
  try { await enter(await api('/api/login', { password: document.querySelector('#password').value })); }
  catch (error) { result.textContent = error.message; }
};
window.concert.resume().then(session => { if (session) enter(session); });

async function start() {
  await listRuns();
  view.onchange = () => { listCompare(); load(); };
  compare.onchange = load;
  window.addEventListener('resize', () => { if (drawn) draw(drawn); });
  await load();
  // A period ending now keeps moving; a past run does not change.
  refreshing = setInterval(async () => { if (view.value.startsWith('last:')) { await listRuns(); await load(); } }, 30000);
}

async function listRuns() {
  const chosen = view.value || 'last:3', against = compare.value;
  runs = (await api('/api/temperatures/runs')).runs;
  view.replaceChildren();
  for (const [value, text] of [['last:1', 'the last hour'], ['last:3', 'the last 3 hours'], ['last:12', 'the last 12 hours'], ['last:24', 'the last 24 hours']]) { const o = node('option', text); o.value = value; view.append(o); }
  if (runs.length) { const group = document.createElement('optgroup'); group.label = 'A past run'; for (const run of runs) { const o = node('option', runName(run)); o.value = `run:${run.start}`; group.append(o); } view.append(group); }
  view.value = [...view.options].some(o => o.value === chosen) ? chosen : 'last:3';
  listCompare(against);
}

function listCompare(keep) {
  const chosen = keep ?? compare.value;
  compare.replaceChildren(Object.assign(node('option', view.value.startsWith('run:') ? 'nothing' : 'choose a past run under Show first'), { value: '' }));
  compare.disabled = !view.value.startsWith('run:');
  if (!compare.disabled) for (const run of runs) { if (`run:${run.start}` === view.value) continue; const o = node('option', runName(run)); o.value = `run:${run.start}`; compare.append(o); }
  compare.value = [...compare.options].some(o => o.value === chosen) ? chosen : '';
}

function runOf(value) { return runs.find(run => `run:${run.start}` === value); }
async function readings(from, to) { return api(`/api/temperatures?start=${from}&end=${to}`); }

async function load() {
  try {
    const state = { compare: null };
    if (view.value.startsWith('last:')) {
      const now = Date.now() / 1000, from = now - Number(view.value.slice(5)) * 3600;
      state.main = await readings(from, now); state.mode = 'clock'; state.from = from; state.to = now; state.origin = 0;
    } else {
      const run = runOf(view.value); if (!run) return;
      state.main = await readings(run.start - 60, run.end + 60); state.mode = 'elapsed'; state.origin = run.start; state.from = 0; state.to = run.end - run.start; state.run = run;
      const other = runOf(compare.value);
      if (other) { state.compare = await readings(other.start - 60, other.end + 60); state.compareOrigin = other.start; state.other = other; state.to = Math.max(state.to, other.end - other.start); }
    }
    result.textContent = ''; draw(state); coolers(state.main.coolers || []);
  } catch (error) { result.textContent = error.message; }
}

// Lines for one set of readings: [{camera, color, points: [[x, °C, load, size]]}], x measured from `origin`.
function lines(data, origin) {
  const cameras = [...data.cameras].sort((a, b) => a.slot - b.slot);
  return cameras.map((camera, index) => ({ camera, color: COLORS[index], points: (data.readings[camera.id] || []).map(p => [p[0] - origin, p[1], p[2], p[3]]) })).filter(s => s.points.length && s.color);
}
function nearest(points, x) { let low = 0, high = points.length - 1; while (high - low > 1) { const mid = (low + high) >> 1; if (points[mid][0] < x) low = mid; else high = mid; } return Math.abs(points[low][0] - x) <= Math.abs(points[high][0] - x) ? points[low] : points[high]; }

function draw(state) {
  drawn = state;
  const main = lines(state.main, state.origin), other = state.compare ? lines(state.compare, state.compareOrigin) : [];
  const chart = document.querySelector('#chart'), empty = document.querySelector('#empty'), table = document.querySelector('#summary'), tip = document.querySelector('#tip');
  if (!main.length && !other.length) {
    chart.hidden = table.hidden = true; empty.hidden = false;
    empty.textContent = 'No temperature readings in this period. The history starts from when this page was added, and a reading is kept every half minute while a camera is connected and streaming or recording, every two minutes otherwise.';
    return;
  }
  chart.hidden = false; empty.hidden = true; tip.hidden = true;
  const limits = state.main.limits, all = [...main, ...other].flatMap(s => s.points.map(p => p[1]));
  const low = Math.floor(Math.min(...all)) - 1, high = Math.max(limits.critical + 1, Math.ceil(Math.max(...all)) + 1);
  const plot = document.querySelector('#plot'), width = Math.max(320, chart.clientWidth - 32), height = Math.round(Math.min(460, Math.max(260, width * 0.45)));
  const left = 44, right = 92, top = 12, bottom = 30, x0 = state.from, x1 = Math.max(state.to, x0 + 60);
  const X = v => left + (v - x0) / (x1 - x0) * (width - left - right), Y = v => top + (high - v) / (high - low) * (height - top - bottom);
  plot.setAttribute('viewBox', `0 0 ${width} ${height}`); plot.replaceChildren();
  // Grid and axes: quiet, behind everything.
  const stepY = high - low > 24 ? 5 : high - low > 10 ? 2 : 1;
  for (let v = Math.ceil(low / stepY) * stepY; v <= high; v += stepY) {
    plot.append(shape('line', { x1: left, x2: width - right, y1: Y(v), y2: Y(v), stroke: 'var(--grid)', 'stroke-width': 1 }));
    const label = shape('text', { x: left - 8, y: Y(v) + 4, 'text-anchor': 'end' }); label.textContent = `${v}°`; plot.append(label);
  }
  const span = (x1 - x0) / 60, stepX = [5, 10, 15, 30, 60, 120, 180, 360].find(m => span / m <= Math.max(3, Math.floor((width - left - right) / 90))) || 720;
  if (state.mode === 'elapsed') { for (let m = 0; m * 60 <= x1; m += stepX) { const label = shape('text', { x: X(m * 60), y: height - 8, 'text-anchor': 'middle' }); label.textContent = elapsed(m * 60); plot.append(label); } }
  else { const first = new Date(x0 * 1000); first.setSeconds(0, 0); first.setMinutes(Math.ceil(first.getMinutes() / stepX) * stepX); for (let t = first.getTime() / 1000; t <= x1; t += stepX * 60) { if (t < x0) continue; const label = shape('text', { x: X(t), y: height - 8, 'text-anchor': 'middle' }); label.textContent = clock(t); plot.append(label); } }
  // The warning levels, named at the right-hand end.
  for (const [name, value] of [['Warm', limits.warm], ['Hot', limits.hot], ['Critical', limits.critical]]) {
    if (value < low || value > high) continue;
    plot.append(shape('line', { x1: left, x2: width - right, y1: Y(value), y2: Y(value), stroke: 'var(--text-secondary)', 'stroke-width': 1, 'stroke-dasharray': '2 5', opacity: 0.8 }));
    const label = shape('text', { x: width - right + 6, y: Y(value) + 4 }); label.textContent = `${name} ${value}°`; plot.append(label);
  }
  // A break in the readings (a phone offline) is a break in its line, not a straight stroke across the gap.
  const gap = Math.max(300, (x1 - x0) / 1200 * 6);
  const path = points => { let d = '', last = null; for (const p of points) { if (p[0] < x0 || p[0] > x1) continue; d += `${last !== null && p[0] - last <= gap ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`; last = p[0]; } return d; };
  for (const s of other) plot.append(shape('path', { d: path(s.points), fill: 'none', stroke: s.color, 'stroke-width': 1.5, 'stroke-dasharray': '6 5', 'stroke-linejoin': 'round', opacity: 0.8 }));
  for (const s of main) plot.append(shape('path', { d: path(s.points), fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  // Legend: always there, names in plain text beside a sample of the line.
  const legend = document.querySelector('#legend'); legend.replaceChildren();
  const named = new Map([...main, ...other].map(s => [s.camera.id, s]));
  for (const s of named.values()) { const item = node('span'); const mark = node('i'); mark.style.borderTopColor = s.color; item.append(mark, node('span', s.camera.name)); legend.append(item); }
  if (state.compare) { const note = node('span', `Solid: ${day(state.run.start)} ${clock(state.run.start)} · Dashed: ${day(state.other.start)} ${clock(state.other.start)} · both from the start of the run`); note.className = 'note'; legend.append(note); }
  if (state.main.cameras.length > COLORS.length) { const note = node('span', `Only the first ${COLORS.length} cameras by slot are drawn.`); note.className = 'note'; legend.append(note); }
  // Hover: a hairline at the nearest moment and every camera's reading there.
  const hair = shape('line', { y1: top, y2: height - bottom, stroke: 'var(--text-secondary)', 'stroke-width': 1, visibility: 'hidden' }), dots = shape('g');
  const target = shape('rect', { x: left, y: top, width: width - left - right, height: height - top - bottom, fill: 'transparent' });
  plot.append(hair, dots, target);
  const moved = event => {
    const box = plot.getBoundingClientRect(), at = x0 + (Math.min(Math.max((event.clientX - box.left) / box.width * width, left), width - right) - left) / (width - left - right) * (x1 - x0);
    const rows = []; dots.replaceChildren();
    for (const s of named.values()) {
      const mine = main.find(m => m.camera.id === s.camera.id), theirs = other.find(m => m.camera.id === s.camera.id);
      const a = mine && nearest(mine.points, at), b = theirs && nearest(theirs.points, at);
      const here = a && Math.abs(a[0] - at) <= gap ? a : null, there = b && Math.abs(b[0] - at) <= gap ? b : null;
      if (!here && !there) continue;
      for (const p of [here, there]) if (p) dots.append(shape('circle', { cx: X(p[0]), cy: Y(p[1]), r: 4, fill: s.color, stroke: 'var(--surface-1)', 'stroke-width': 2 }));
      rows.push([s, here, there]);
    }
    if (!rows.length) { tip.hidden = true; hair.setAttribute('visibility', 'hidden'); return; }
    hair.setAttribute('x1', X(at)); hair.setAttribute('x2', X(at)); hair.setAttribute('visibility', 'visible');
    tip.replaceChildren(Object.assign(node('div', state.mode === 'elapsed' ? `${elapsed(at)} into the run` : `${day(at)} ${clock(at)}`), { className: 'when' }));
    for (const [s, here, there] of rows.sort((p, q) => (q[1] || q[2])[1] - (p[1] || p[2])[1])) {
      const row = node('div'), mark = node('i'); mark.style.background = s.color;
      row.append(mark, node('b', here ? `${here[1].toFixed(1)} °C` : '—'), node('span', s.camera.name));
      if (state.compare) row.append(Object.assign(node('span', there ? `· ${there[1].toFixed(1)} °C compared` : '· no reading compared'), { className: 'other' }));
      tip.append(row);
    }
    tip.hidden = false;
    const rootBox = chart.getBoundingClientRect(), px = event.clientX - rootBox.left, wide = tip.offsetWidth;
    tip.style.left = `${px + 16 + wide > rootBox.width ? Math.max(4, px - wide - 16) : px + 16}px`; tip.style.top = `${Math.max(8, event.clientY - rootBox.top - 20)}px`;
  };
  target.addEventListener('pointermove', moved); target.addEventListener('pointerdown', moved);
  target.addEventListener('pointerleave', () => { tip.hidden = true; hair.setAttribute('visibility', 'hidden'); dots.replaceChildren(); });
  summarise(state, main, other, limits);
}

// The same figures as a table: what each camera started at, peaked at and ended at, and how long it spent hot.
function figures(points, hot) {
  if (!points || !points.length) return null;
  let peak = points[0], above = 0;
  for (let i = 0; i < points.length; i++) { if (points[i][1] > peak[1]) peak = points[i]; if (i && points[i][1] >= hot && points[i][0] - points[i - 1][0] < 600) above += points[i][0] - points[i - 1][0]; }
  return { start: points[0][1], peak, end: points[points.length - 1][1], above, sizes: [...new Set(points.map(p => p[3]).filter(Boolean))].join(', ') };
}
function summarise(state, main, other, limits) {
  const table = document.querySelector('#summary'); table.hidden = false; table.replaceChildren();
  const head = node('tr'); for (const title of ['Camera', 'Start', 'Peak', 'Peak at', 'End', `At or above ${limits.hot}°`, 'Stream size', ...(state.compare ? ['Compared peak', 'Difference'] : [])]) head.append(node('th', title)); table.append(head);
  const ids = new Map([...main, ...other].map(s => [s.camera.id, s.camera.name]));
  for (const [id, name] of ids) {
    const a = figures(main.find(s => s.camera.id === id)?.points, limits.hot), b = figures(other.find(s => s.camera.id === id)?.points, limits.hot), row = node('tr');
    const when = a && (state.mode === 'elapsed' ? `${elapsed(a.peak[0])} in` : clock(a.peak[0]));
    for (const text of [name, a ? `${a.start.toFixed(1)} °C` : '—', a ? `${a.peak[1].toFixed(1)} °C` : '—', a ? when : '—', a ? `${a.end.toFixed(1)} °C` : '—', a ? (a.above ? length(a.above) : 'none') : '—', a?.sizes || '—']) row.append(node('td', text));
    if (state.compare) { row.append(node('td', b ? `${b.peak[1].toFixed(1)} °C` : '—')); const d = a && b ? a.peak[1] - b.peak[1] : null; row.append(node('td', d === null ? '—' : `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toFixed(1)} °C`)); }
    table.append(row);
  }
}

// Phones with a cooler, as they are now (not kept in the history). Hidden when none has one.
const FAN = { smart: 'Smart', overclock: 'Overclock', silent: 'Silent', manual: 'Fixed speed' };
function coolers(list) {
  const section = document.querySelector('#coolers'), table = document.querySelector('#cooler-table');
  section.hidden = !list.length; table.replaceChildren();
  if (!list.length) return;
  const head = node('tr'); for (const title of ['Camera', 'Phone', 'Cooler', 'Fan', 'Fan speed', 'Lights']) head.append(node('th', title)); table.append(head);
  for (const c of list) {
    const row = node('tr'), on = c.online && c.connected;
    const fan = !on ? (c.online ? 'not connected' : 'camera offline') : c.fan_mode === 'manual' && c.fan_speed ? `Fixed speed ${c.fan_speed}` : FAN[c.fan_mode] || '—';
    for (const text of [c.name, c.phone_c != null ? `${c.phone_c.toFixed(1)} °C` : '—', on && c.temperature_c != null ? `${c.temperature_c} °C` : '—', fan,
      on && c.fan_rpm != null ? `${c.fan_rpm.toLocaleString()} rpm` : '—', on && c.lights_on != null ? (c.lights_on ? 'on' : 'off') : '—']) row.append(node('td', text));
    table.append(row);
  }
}
