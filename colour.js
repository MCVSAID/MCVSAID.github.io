'use strict';
// The Colour page (colour.py): white balance and exposure on the phones, set alike, and a LUT per
// camera made from a colour chart. The administrator's only. Uses app.js's api(), node(), editing(), part and role.
(() => {
  const panel = document.querySelector('#colour');
  if (!panel) return;
  const PRESETS = { incandescent: 'incandescent (~2850 K)', warm_fluorescent: 'warm fluorescent (~3000 K)', fluorescent: 'fluorescent (~4150 K)', daylight: 'daylight (~5500 K)', cloudy: 'cloudy (~6500 K)', twilight: 'twilight (~7000 K)', shade: 'shade (~7500 K)' };
  const CORNERS = ['top left (brown patch)', 'top right (bluish green)', 'bottom right (black)', 'bottom left (white)'];
  let state = null, said = '', busy = false, drawn = false, fitReady = () => {};
  const chosen = new Set();            // cameras the settings go to; empty means all
  const corners = {};                  // camera id -> [[x, y], ...] as clicked, 0-1 of its picture
  const boxes = {};                    // camera id -> [x0, y0, x1, y1]: the view the cameras share, for matching without a chart
  const boxStart = {};                 // camera id -> the first corner of a box being drawn
  const form = { wb_mode: 'kelvin', wb_kelvin: 5600, wb_preset: 'daylight', ae_mode: 'lock', ae_compensation: 0, exposure_us: 16667, iso: 200, kind: 'scene', reference: 'chart' };
  const status = node('div', ''), settings = node('div', ''), calibration = node('div', ''), message = node('p', '');
  panel.append(node('h2', 'Colour'), settings, status, calibration, message);

  async function ask(path, body, done) {
    busy = true; said = 'Working…'; paint();
    try {
      const answer = await api(path, { method: 'POST', body: JSON.stringify(body) });
      if (answer.colour) state = answer.colour;
      said = done ? done(answer) : '';
    } catch (error) { said = error.message; }
    busy = false; paint(true);
  }
  const named = id => state?.cameras.find(c => c.id === id)?.name || id;
  const when = seconds => seconds ? new Date(seconds * 1000).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '';
  const outcomeLine = cameras => Object.entries(cameras).map(([id, r]) => `${named(id)}: ${typeof r === 'string' ? r : r.problem ? r.problem : r.state ? `${r.state === 'SUCCEEDED' ? 'set' : r.state.toLowerCase()}${r.error ? ` (${r.error})` : ''}${r.note ? ` — ${r.note}` : ''}` : r.delta_e ? `ΔE ${r.delta_e.before.mean} → ${r.delta_e.after.mean} (worst ${r.delta_e.after.max})${r.reference ? ', the reference' : ''}${r.warnings?.length ? ` — ${r.warnings.join('; ')}` : ''}` : r.ok ? `picture ${r.width}×${r.height}` : r.problem || 'done'}`).join(' · ');

  function select(options, value, change, label) {
    const pick = document.createElement('select'); pick.setAttribute('aria-label', label);
    for (const [v, text] of options) { const option = node('option', text); option.value = v; option.selected = String(v) === String(value); pick.append(option); }
    pick.onchange = () => { change(pick.value); paint(true); };
    return pick;
  }
  function number(value, min, max, step, change, label) {
    const box = document.createElement('input'); box.type = 'number'; box.min = min; box.max = max; box.step = step; box.value = value; box.size = 6; box.setAttribute('aria-label', label);
    box.onchange = () => change(Number(box.value));
    return box;
  }

  // -- white balance and exposure, sent to the chosen cameras ------------------------------------------------
  function paintSettings() {
    settings.replaceChildren();
    const targets = node('p', 'Cameras: ');
    for (const camera of state.cameras) {
      const tick = document.createElement('input'); tick.type = 'checkbox'; tick.checked = !chosen.size || chosen.has(camera.id); tick.disabled = !camera.online;
      tick.onchange = () => { if (!chosen.size) state.cameras.forEach(c => chosen.add(c.id)); tick.checked ? chosen.add(camera.id) : chosen.delete(camera.id); if (chosen.size === state.cameras.length) chosen.clear(); };
      const label = node('label', ` ${camera.name} `); label.prepend(tick); targets.append(label);
    }
    settings.append(targets);
    const wb = node('p', 'White balance ');
    wb.append(select([['kelvin', 'set in kelvin'], ['preset', 'a preset'], ['lock', 'lock on what it sees now (a grey card)'], ['auto', 'automatic']], form.wb_mode, v => { form.wb_mode = v; }, 'White balance'));
    if (form.wb_mode === 'kelvin') wb.append(node('span', ' '), number(form.wb_kelvin, 2000, 10000, 50, v => { form.wb_kelvin = v; }, 'Kelvin'), node('span', ' K'));
    if (form.wb_mode === 'preset') wb.append(node('span', ' '), select(Object.entries(PRESETS), form.wb_preset, v => { form.wb_preset = v; }, 'Preset'));
    const sendWb = node('button', 'Set white balance'); sendWb.disabled = busy;
    sendWb.onclick = () => send({ wb_mode: form.wb_mode, ...(form.wb_mode === 'kelvin' ? { wb_kelvin: form.wb_kelvin } : {}), ...(form.wb_mode === 'preset' ? { wb_preset: form.wb_preset } : {}) },
      form.wb_mode === 'lock' ? 'Each camera settles on what it sees, then holds it: point them all at the same grey card first.' : '');
    wb.append(node('span', ' '), sendWb); settings.append(wb);
    const ae = node('p', 'Exposure ');
    ae.append(select([['lock', 'lock on what it sees now'], ['auto', 'automatic'], ['manual', 'shutter and ISO by hand']], form.ae_mode, v => { form.ae_mode = v; }, 'Exposure'));
    if (form.ae_mode !== 'manual') ae.append(node('span', ' compensation '), number(form.ae_compensation, -24, 24, 1, v => { form.ae_compensation = v; }, 'Exposure compensation steps'), node('span', ' steps'));
    else ae.append(node('span', ' shutter 1/'), number(Math.round(1e6 / form.exposure_us), 30, 8000, 1, v => { form.exposure_us = Math.round(1e6 / Math.max(30, v)); }, 'Shutter, 1/x second'),
      node('span', ' s, ISO '), number(form.iso, 25, 12800, 1, v => { form.iso = v; }, 'ISO'));
    const sendAe = node('button', 'Set exposure'); sendAe.disabled = busy;
    sendAe.onclick = () => send({ ae_mode: form.ae_mode, ...(form.ae_mode === 'manual' ? { exposure_us: form.exposure_us, iso: form.iso } : { ae_compensation: form.ae_compensation }) });
    ae.append(node('span', ' '), sendAe); settings.append(ae);
    settings.append(node('small', 'One kelvin for every camera is the usual choice (5600 K for daylight or LED stage light, 3200 K for tungsten). A phone that cannot be set in kelvin takes its nearest preset and says so. A lock is kept across stream restarts.'));
  }
  async function send(parameters, warning) {
    if (warning && !await concert.sure(warning)) return;
    const cameras = chosen.size ? [...chosen] : 'all';
    ask('/api/colour/settings', { cameras, settings: parameters, fallback: true }, answer => outcomeLine(answer.cameras));
  }

  // -- what each camera does now, and its calibration ------------------------------------------------------------
  function paintStatus() {
    status.replaceChildren();
    const table = document.createElement('table'); table.className = 'colour-table';
    const head = document.createElement('tr');
    for (const title of ['Camera', 'White balance', 'Exposure', 'Can do', 'Calibration', 'LUT in OBS']) head.append(node('th', title));
    table.append(head);
    for (const camera of state.cameras) {
      const row = document.createElement('tr'), c = camera.colour, a = c?.actual, s = camera.support;
      row.append(node('td', `${camera.name} · ${camera.lens}${camera.online ? '' : ' (offline)'}`));
      const wb = !c ? 'not reported' : `${c.wb_mode === 'kelvin' ? `${c.wb_kelvin} K` : c.wb_mode === 'preset' ? (c.wb_preset || '').replace('_', ' ') : c.wb_mode}${c.wb_state && c.wb_state !== 'set' ? ` (${c.wb_state})` : ''}${a?.kelvin_estimate ? ` · at about ${a.kelvin_estimate} K` : ''}`;
      const ex = !c ? 'not reported' : `${c.ae_mode}${c.ae_mode !== 'manual' && c.ae_compensation ? ` ${c.ae_compensation > 0 ? '+' : ''}${c.ae_compensation}` : ''}${c.ae_state && c.ae_state !== 'set' ? ` (${c.ae_state})` : ''}${a?.exposure_us ? ` · 1/${Math.round(1e6 / a.exposure_us)} s, ISO ${a.iso}` : ''}`;
      const wbCell = node('td', wb), exCell = node('td', ex);
      if (c?.error) { wbCell.className = 'recording-warning'; wbCell.title = c.error; wbCell.append(node('div', c.error)); }
      row.append(wbCell, exCell);
      row.append(node('td', !s ? 'app too old' : [s.wb_kelvin ? 'kelvin' : 'no kelvin', s.wb_lock ? 'WB lock' : null, s.manual_exposure ? 'shutter/ISO' : s.ae_lock ? 'AE lock' : null].filter(Boolean).join(', ')));
      const cal = camera.calibration;
      const calCell = node('td', cal ? `${when(cal.when)} · ${cal.kind === 'chart' ? 'chart' : cal.kind === 'scene' ? 'scene' : 'grey card'} → ${cal.target_name} · ΔE ${cal.delta_e.before.mean} → ${cal.delta_e.after.mean} (worst ${cal.delta_e.after.max})${cal.reference ? ' · reference' : ''}` : camera.other_lenses.length ? `only on ${camera.other_lenses.map(r => r.lens).join(', ')}` : 'not calibrated');
      if (cal?.warnings?.length) { calCell.className = 'recording-warning'; calCell.append(node('div', cal.warnings.join('; '))); }
      row.append(calCell);
      const obs = node('td', camera.in_obs ? (camera.in_obs.for_this_lens ? 'on' : 'on, but not this lens’s latest') : 'off');
      if (camera.in_obs && !camera.in_obs.for_this_lens) obs.className = 'recording-warning';
      const on = node('button', camera.in_obs?.for_this_lens ? 'Update' : 'On'); on.disabled = busy || !cal || cal.reference;
      on.onclick = () => ask('/api/colour/obs', { cameras: [camera.id], on: true }, answer => outcomeLine(answer.cameras));
      const off = node('button', 'Off'); off.disabled = busy || !camera.in_obs;
      off.onclick = () => ask('/api/colour/obs', { cameras: [camera.id], on: false }, answer => outcomeLine(answer.cameras));
      obs.append(node('span', ' '), on, off); row.append(obs);
      table.append(row);
    }
    status.append(table);
  }

  // -- calibrating from a chart or grey card ---------------------------------------------------------------------------
  function picture(camera) {
    const frame = node('div', ''); frame.className = 'colour-picture';
    const scene = form.kind === 'scene';
    const image = document.createElement('img'); image.alt = scene ? `${camera.name}: click two corners of a box round the view the cameras share` : `${camera.name}: click the ${form.kind === 'chart' ? 'chart’s patch area' : 'grey card’s'} corners`;
    image.src = `/api/colour/preview/${encodeURIComponent(camera.id)}?at=${camera.capture.when}`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 1 1'); svg.setAttribute('preserveAspectRatio', 'none');
    const draw = () => {
      svg.replaceChildren();
      const box = boxes[camera.id], start = boxStart[camera.id];
      const points = !scene ? corners[camera.id] || [] : box ? [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]] : start ? [start] : [];
      if (points.length > 1) { const outline = document.createElementNS(svg.namespaceURI, 'polygon'); outline.setAttribute('points', points.map(p => p.join(',')).join(' ')); outline.setAttribute('class', 'colour-outline'); svg.append(outline); }
      points.forEach(([x, y]) => { const dot = document.createElementNS(svg.namespaceURI, 'circle'); dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('r', 0.008); dot.setAttribute('class', 'colour-corner'); svg.append(dot); });
    };
    image.onclick = event => {
      const at = [event.offsetX / image.clientWidth, event.offsetY / image.clientHeight].map(v => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000);
      if (scene) {
        // Two clicks make a box: the first starts it, the second finishes it; a third starts again.
        if (!boxStart[camera.id] || boxes[camera.id]) { boxStart[camera.id] = at; delete boxes[camera.id]; }
        else { const [x, y] = boxStart[camera.id]; boxes[camera.id] = [Math.min(x, at[0]), Math.min(y, at[1]), Math.max(x, at[0]), Math.max(y, at[1])]; delete boxStart[camera.id]; }
        draw(); hint.textContent = hintFor(camera); fitReady(); return;
      }
      const points = corners[camera.id] && corners[camera.id].length < 4 ? corners[camera.id] : (corners[camera.id] = []);
      points.push([event.offsetX / image.clientWidth, event.offsetY / image.clientHeight].map(v => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000));
      draw(); hint.textContent = hintFor(camera); fitReady();
    };
    const hint = node('small', hintFor(camera));
    draw(); frame.append(image, svg);
    const box = node('div', ''); box.className = 'colour-camera';
    const clear = node('button', scene ? 'Whole picture' : 'Clear corners'); clear.onclick = () => { if (scene) { delete boxes[camera.id]; delete boxStart[camera.id]; } else delete corners[camera.id]; draw(); hint.textContent = hintFor(camera); fitReady(); };
    box.append(node('h3', `${camera.name} · ${camera.lens}`), frame, hint, clear);
    return box;
  }
  function hintFor(camera) {
    if (form.kind === 'scene') return boxes[camera.id] ? 'Only what is inside the box is compared. Click again to draw another.' : boxStart[camera.id] ? 'Now click the opposite corner of the box.'
      : 'The whole picture is compared. To leave out what the other cameras do not see (a window frame, a different part of the room), click two corners of a box round the view they share.';
    const n = (corners[camera.id] || []).length;
    if (n === 4) return 'Corners set. Click again to start over.';
    return form.kind === 'chart' ? `Click the corners of the patch area, going round: next the ${CORNERS[n]}. (Any starting corner works: the greys are found.)` : `Click the four corners of the grey card (${4 - n} to go).`;
  }
  function paintCalibration() {
    calibration.replaceChildren(node('h3', 'Calibrate colour'));
    const scene = form.kind === 'scene';
    if (scene && (form.reference === 'chart' || !state.cameras.some(c => c.id === form.reference))) form.reference = (state.cameras.find(c => c.online && c.capture) || state.cameras.find(c => c.capture) || state.cameras[0])?.id;
    const choose = node('p', '');
    choose.append(node('span', 'From '), select([['scene', 'the scene in front of them (no chart)'], ['chart', 'an X-Rite ColorChecker (24 patches)'], ['grey', 'a plain grey card (white balance and exposure only)']], form.kind, v => { form.kind = v; }, 'Calibrate from'),
      node('span', ' make them '),
      select([...(scene ? [] : [['chart', form.kind === 'chart' ? 'accurate: the chart’s own colours' : 'neutral at 18% grey']]), ...state.cameras.map(c => [c.id, `match ${c.name}`])], form.reference, v => { form.reference = v; }, 'Target'));
    calibration.append(choose);
    calibration.append(node('small', scene
      ? 'Point every camera at the same thing (the stage, as lit for the show, with some grey and some colour in it), set white balance and exposure above first, then take pictures. Box the view they share on each picture if they frame it differently. The cameras are made to look like the one chosen; nothing is made "accurate" without a chart. Its ΔE scores are rougher than a chart’s: a drop by half or more is a good match. Run it again whenever the light changes.'
      : 'Light the chart as the stage will be, point every camera at it (filling a fair part of the picture, with no glare), set white balance and exposure above first, then take pictures. Run it again whenever the light changes.'));
    const take = node('button', 'Take pictures from OBS'); take.disabled = busy;
    take.onclick = () => ask('/api/colour/capture', { cameras: chosen.size ? [...chosen] : 'all' }, answer => {
      for (const camera of state.cameras) {
        const before = camera.calibration?.corners; if (!before || !answer.cameras[camera.id]?.ok) continue;
        if (camera.calibration.kind === 'scene') { if (!boxes[camera.id]) boxes[camera.id] = before; } else if (!corners[camera.id]) corners[camera.id] = before;
      }
      return outcomeLine(answer.cameras) + (scene ? '. Box the shared view if needed, then Match.' : '. Click each chart’s corners, then Calibrate.');
    });
    // Matching on the scene uses the pictures taken together: those within ten minutes of the latest.
    const latest = Math.max(0, ...state.cameras.map(c => c.capture?.when || 0));
    const ready = () => state.cameras.filter(c => c.capture && (scene ? latest - c.capture.when < 600 : (corners[c.id] || []).length === 4));
    const fit = node('button', '');
    fitReady = () => { const n = ready(); const others = n.filter(c => c.id !== form.reference).length;
      fit.textContent = scene ? `Match ${others} camera${others === 1 ? '' : 's'} to ${named(form.reference)}` : `Calibrate ${n.length} camera${n.length === 1 ? '' : 's'}`;
      fit.disabled = busy || !n.length || (form.reference !== 'chart' && !n.some(c => c.id === form.reference)) || (scene && !others); };
    fitReady();
    fit.onclick = () => ask('/api/colour/calibrate', scene ? { kind: 'scene', reference: form.reference, cameras: ready().map(c => c.id), corners: Object.fromEntries(ready().filter(c => boxes[c.id]).map(c => [c.id, boxes[c.id]])) }
      : { kind: form.kind, reference: form.reference, corners: Object.fromEntries(ready().map(c => [c.id, corners[c.id]])) },
      answer => outcomeLine(answer.cameras) + (Object.values(answer.cameras).some(r => r.delta_e) ? '. Put the LUTs in OBS when they look right.' : ''));
    const apply = node('button', 'Put every LUT in OBS'); apply.disabled = busy || !state.cameras.some(c => c.calibration && !c.calibration.reference);
    apply.onclick = () => ask('/api/colour/obs', { cameras: state.cameras.filter(c => c.calibration && !c.calibration.reference).map(c => c.id), on: true }, answer => outcomeLine(answer.cameras));
    calibration.append(node('p', ''), take, fit, apply);
    const grid = node('div', ''); grid.className = 'colour-pictures';
    for (const camera of state.cameras) if (camera.capture) grid.append(picture(camera));
    calibration.append(grid);
    calibration.append(node('small', 'Each LUT is also put beside every recording’s camera files, for Resolve, Premiere or Final Cut.'));
  }

  function paint(all) {
    if (!state) return;
    if (all || !drawn) { paintSettings(); paintCalibration(); drawn = true; }
    paintStatus();
    message.textContent = said; message.className = /cannot|not |fail|refus|error|No /i.test(said) ? 'recording-warning' : '';
  }
  async function refresh() {
    if (typeof part === 'undefined' || part !== '/colour' || role !== 'admin' || !csrf) { panel.hidden = part !== '/colour' || role !== 'admin'; return; }
    if (busy || editing(panel)) return;
    try { state = await api('/api/colour'); paint(false); } catch (error) { message.textContent = error.message; }
  }
  setInterval(refresh, 3000); refresh();
})();
