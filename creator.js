'use strict';
// Creator Studio on the Cameras page (creator.py, docs/CREATOR_STUDIO.md): everyone on camera, the user's own framings
// built from body regions with a live preview, and when it cuts. Each camera's card gets its own part through
// window.studioCard. The administrator's only. Uses app.js's api(), node(), editing(), part, role and result.
(() => {
  const panel = document.querySelector('#studio');
  if (!panel) return;
  let state = null, drawnFrom = '', draft = null, said = '', busy = false, look = null, lookCamera = '';
  const adding = { name: '', consent: false, adult: false, by: '' };     // the add-a-person form, kept through redraws
  const COLOURS = ['#4fc3f7', '#ffb74d', '#aed581', '#f06292', '#ba68c8', '#fff176', '#4db6ac', '#ff8a65'];
  const EDGES = [[5, 6], [5, 7], [7, 9], [6, 8], [8, 10], [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [0, 5], [0, 6]];
  const regionName = id => state?.regions.find(r => r.id === id)?.name || id;
  const studio = () => window.concert?.mode?.mode === 'creator';

  async function change(body, done) {
    busy = true; said = 'Saving…'; paint();
    try { state = await api('/api/creator', { method: 'POST', body: JSON.stringify(body) }); said = done || 'Saved.'; return true; }
    catch (error) { said = error.message; return false; }
    finally { busy = false; paint(true); }
  }
  const select = (choices, value, label) => {
    const pick = document.createElement('select'); if (label) pick.setAttribute('aria-label', label);
    for (const [v, text] of choices) { const option = document.createElement('option'); option.value = v; option.textContent = text; option.selected = String(v) === String(value); pick.append(option); }
    return pick;
  };
  const tick = (text, checked) => { const label = node('label', ''), box = document.createElement('input'); box.type = 'checkbox'; box.checked = !!checked; box.setAttribute('aria-label', text); label.append(box, node('span', ' ' + text)); return [label, box]; };
  const number = (value, min, max, step, label) => { const input = document.createElement('input'); input.type = 'number'; input.min = min; input.max = max; input.step = step; input.value = value; input.setAttribute('aria-label', label); return input; };

  // -- face blur, only while experimental face blur is switched on (System › This PC): then every face with the
  // fail-safe is this kind of event's default (faceblur.py), set on the Director page. Off, Creator Studio neither
  // shows nor relies on it.
  function faces() {
    const blur = state.face_blur || {};
    if (!blur.enabled) return [];
    const line = node('p', '');
    const every = blur.mode === 'everyone', safe = blur.failsafe && blur.failsafe !== 'off';
    line.append(node('span', every ? `Face blur (experimental): every face${safe ? ', and the whole picture when detection cannot keep up' : ', without a fail-safe'}${blur.chosen ? '' : ' (the default here)'}. ` : `Face blur (experimental): ${blur.mode === 'off' ? 'off' : 'on for some faces'}. `));
    const go = document.createElement('a'); go.href = '/director'; go.textContent = 'Change it (Director page, Face blur)'; line.append(go);
    line.append(node('span', '. It may miss faces, especially small, turned or fast-moving ones: do not rely on it to hide anyone.'));
    if (!every || !safe) line.className = 'recording-warning';
    return [line];
  }

  // -- everyone on camera ------------------------------------------------------------------------------------------
  function people() {
    const box = node('div', ''); box.className = 'studio-block';
    box.append(node('h3', 'Everyone on camera'));
    box.append(node('p', 'List everyone who will appear. Cameras arm and record only once each has consented and is confirmed as 18 or over.'));
    const list = node('ul', ''); list.className = 'studio-people';
    for (const person of state.on_camera) {
      const item = node('li', ''), name = node('strong', person.name || 'removed from the library');
      const consent = node('span', person.consent ? ' · consent on record' : ' · no consent on record');
      const adult = node('span', person.adult?.confirmed ? ` · 18 or over: confirmed by ${person.adult.by} on ${person.adult.date}` : ' · 18 or over: not confirmed');
      if (!person.consent || !person.adult?.confirmed) item.className = 'recording-warning';
      item.append(name, consent, adult);
      if (person.name && !person.adult?.confirmed) {
        const confirm = node('button', 'Confirm 18 or over');
        confirm.onclick = async () => {
          const got = await window.concert.ask({ title: `${person.name} is 18 or over`, text: state.age_note, fields: [{ name: 'by', label: 'Confirmed by (your name)' }], ok: 'Confirm' });
          if (got?.by?.trim()) change({ adult: { id: person.id, confirmed: true, by: got.by.trim() } }, 'Confirmation recorded.');
        };
        item.append(' ', confirm);
      } else if (person.adult?.confirmed) {
        const undo = node('button', 'Withdraw confirmation'); undo.onclick = () => change({ adult: { id: person.id, confirmed: false } }, 'Confirmation withdrawn.');
        item.append(' ', undo);
      }
      const remove = node('button', 'Take off the list'); remove.onclick = () => change({ people: state.people.filter(p => p !== person.id) }, 'Taken off the list.');
      item.append(' ', remove); list.append(item);
    }
    if (!state.on_camera.length) list.append(node('li', 'Nobody listed yet.'));
    box.append(list);
    if (state.library.length) {
      const pick = select([['', 'Add someone from the library…'], ...state.library.map(p => [p.id, p.name])], '', 'Add someone from the library');
      pick.onchange = () => { if (pick.value) change({ people: [...state.people, pick.value] }, 'Added to the list.'); };
      box.append(pick);
    }
    const form = node('form', ''); form.className = 'studio-add';
    const name = document.createElement('input'); name.placeholder = 'Name'; name.setAttribute('aria-label', 'Name'); name.maxLength = 120; name.value = adding.name;
    const [consentLabel, consent] = tick('They have consented to being recorded', adding.consent);
    const [adultLabel, adult] = tick('They are 18 or over', adding.adult);
    const by = document.createElement('input'); by.placeholder = 'Confirmed by (your name)'; by.setAttribute('aria-label', 'Confirmed by'); by.maxLength = 80; by.value = adding.by;
    name.oninput = () => { adding.name = name.value; }; by.oninput = () => { adding.by = by.value; };
    consent.onchange = () => { adding.consent = consent.checked; }; adult.onchange = () => { adding.adult = adult.checked; };
    const add = node('button', 'Add a person');
    form.onsubmit = event => {
      event.preventDefault();
      if (!name.value.trim() || !consent.checked || !adult.checked || !by.value.trim()) { said = 'Give their name, tick both confirmations and say who confirmed them.'; paint(true); return; }
      change({ add_person: { name: name.value.trim(), consent: true, adult: true, by: by.value.trim() } }, 'Added to the list.')
        .then(done => { if (done) Object.assign(adding, { name: '', consent: false, adult: false }); paint(true); });
    };
    form.append(name, consentLabel, adultLabel, by, add);
    box.append(form, node('small', state.age_note));
    return box;
  }

  // -- framings ---------------------------------------------------------------------------------------------------
  function framings() {
    const box = node('div', ''); box.className = 'studio-block';
    box.append(node('h3', 'Framings'));
    box.append(node('p', 'Build your own: each framing spans from one body region to another, with any others added, and room around it. Give each a name; cameras favour the ones you choose below.'));
    draft = draft || state.framings.map(f => ({ ...f, also: [...(f.also || [])] }));
    const regions = state.regions.map(r => [r.id, r.name]);
    const table = node('div', ''); table.className = 'studio-framings';
    draft.forEach((framing, n) => {
      const row = node('div', ''); row.className = 'studio-framing';
      row.style.borderLeftColor = COLOURS[n % COLOURS.length];
      const name = document.createElement('input'); name.value = framing.name; name.maxLength = 40; name.setAttribute('aria-label', 'Framing name');
      name.oninput = () => { framing.name = name.value; };
      const from = select(regions, framing.from, 'From'), to = select(regions, framing.to, 'To');
      from.onchange = () => { framing.from = from.value; }; to.onchange = () => { framing.to = to.value; };
      const pad = number(Math.round(framing.padding * 100), 0, 50, 1, 'Room around it, % of height');
      pad.oninput = () => { framing.padding = Math.max(0, Math.min(50, Number(pad.value) || 0)) / 100; };
      const also = node('span', ' also: ');
      for (const [id, label] of regions) {
        const [l, b] = tick(label, framing.also.includes(id)); b.onchange = () => { framing.also = b.checked ? [...framing.also, id] : framing.also.filter(x => x !== id); }; also.append(l);
      }
      const remove = node('button', 'Delete'); remove.type = 'button'; remove.onclick = () => { draft.splice(n, 1); paint(true); };
      row.append(name, node('span', ' from '), from, node('span', ' to '), to, node('span', ' room '), pad, node('span', '%'), also, remove);
      table.append(row);
    });
    if (!draft.length) table.append(node('p', 'No framings: cameras show the whole person.'));
    const more = node('button', 'Add a framing'); more.disabled = draft.length >= 24;
    more.onclick = () => { draft.push({ name: `Framing ${draft.length + 1}`, from: 'head', to: 'feet', also: [], padding: 0.08 }); paint(true); };
    const save = node('button', 'Save framings'); save.disabled = busy;
    save.onclick = async () => { if (await change({ framings: draft }, 'Framings saved.')) draft = null; paint(true); };
    const undo = node('button', 'Undo changes'); undo.onclick = () => { draft = null; paint(true); };
    box.append(table, more, save, undo);
    return box;
  }

  // -- the preview: a camera's newest picture, everyone's keypoints and where each framing falls ---------------------------
  function preview() {
    const box = node('div', ''); box.className = 'studio-block';
    box.append(node('h3', 'Preview'));
    const cameras = (window.studioCameras || []).filter(c => c.online);
    const pick = select([['', 'Choose a camera…'], ...cameras.map(c => [c.id, c.name])], lookCamera, 'Camera to preview');
    pick.onchange = () => { lookCamera = pick.value; };
    const take = node('button', 'Take a look'); take.disabled = busy;
    take.onclick = async () => {
      if (!lookCamera) { said = 'Choose a camera to look through.'; paint(true); return; }
      busy = true; said = 'Looking…'; paint();
      try { look = await api('/api/creator/preview', { method: 'POST', body: JSON.stringify({ camera_id: lookCamera }) }); said = look.why || `${look.people.length} ${look.people.length === 1 ? 'person' : 'people'} found.`; }
      catch (error) { said = error.message; }
      busy = false; paint(true);
    };
    box.append(pick, take);
    if (look) {
      const canvas = document.createElement('canvas'); canvas.className = 'studio-preview';
      const image = new Image();
      image.onload = () => {
        canvas.width = image.width; canvas.height = image.height;
        const g = canvas.getContext('2d'); g.drawImage(image, 0, 0); g.lineWidth = 2;
        const W = image.width, H = image.height;
        for (const person of look.people) {
          const k = person.keypoints;
          if (k) {
            g.strokeStyle = 'rgba(255,255,255,.8)';
            for (const [a, b] of EDGES) if (k[a][2] >= 0.3 && k[b][2] >= 0.3) { g.beginPath(); g.moveTo(k[a][0] * W, k[a][1] * H); g.lineTo(k[b][0] * W, k[b][1] * H); g.stroke(); }
            g.fillStyle = '#fff'; for (const [x, y, c] of k) if (c >= 0.3) { g.beginPath(); g.arc(x * W, y * H, 3, 0, 7); g.fill(); }
          } else { g.strokeStyle = 'rgba(255,255,255,.6)'; const [x0, y0, x1, y1] = person.box; g.strokeRect(x0 * W, y0 * H, (x1 - x0) * W, (y1 - y0) * H); }
          state.framings.forEach((framing, n) => {
            const r = person.framings?.[framing.id]; if (!r) return;
            g.strokeStyle = COLOURS[n % COLOURS.length]; g.setLineDash([6, 4]); g.strokeRect(r[0] * W, r[1] * H, (r[2] - r[0]) * W, (r[3] - r[1]) * H); g.setLineDash([]);
            g.fillStyle = COLOURS[n % COLOURS.length]; g.font = '12px system-ui'; g.fillText(framing.name, r[0] * W + 3, r[1] * H + 13);
          });
        }
      };
      image.src = look.picture;
      box.append(canvas, node('small', 'Saved framings are drawn, each in its colour. The picture is not kept.'));
    }
    return box;
  }

  // -- when it cuts ---------------------------------------------------------------------------------------------------
  function cuts() {
    const box = node('div', ''); box.className = 'studio-block';
    box.append(node('h3', 'When it cuts'));
    const c = state.cuts;
    const shortest = number(c.min_seconds, 0.5, 600, 0.5, 'Shortest shot, seconds'), longest = number(c.max_seconds, 0.5, 600, 0.5, 'Longest shot, seconds');
    const order = select([['turn', 'cameras in turn'], ['random', 'cameras at random']], c.order, 'Order');
    const [lostLabel, lost] = tick('Cut away when a camera’s framing goes out of shot, after', c.lost);
    const lostSeconds = number(c.lost_seconds, 0.5, 600, 0.5, 'Seconds out of shot');
    const [foundLabel, found] = tick('Cut to a camera when its framing comes into shot', c.found);
    const row = (...items) => { const p = node('div', ''); p.className = 'card-setting'; p.append(...items); return p; };
    const save = node('button', 'Save cutting'); save.disabled = busy;
    save.onclick = () => change({ cuts: { min_seconds: Number(shortest.value), max_seconds: Number(longest.value), order: order.value, lost: lost.checked, lost_seconds: Number(lostSeconds.value), found: found.checked } }, 'Cutting saved.');
    box.append(row(node('span', 'Shots last from '), shortest, node('span', ' to '), longest, node('span', ' seconds, '), order),
      row(lostLabel, lostSeconds, node('span', ' seconds')), row(foundLabel), save,
      node('small', 'A cut by hand, here or from Stage Shots, always works: the shot is held for its shortest length before the rules take over again.'));
    const [vlmLabel, vlm] = tick('Let the vision model rate shots too (off by default; framing never comes from it)', state.vlm);
    vlm.onchange = () => change({ vlm: vlm.checked }, vlm.checked ? 'The vision model may rate shots.' : 'The vision model is off here.');
    box.append(row(vlmLabel));
    return box;
  }

  function paint(all) {
    if (!state) return;
    // Redrawn when something changed, not on every poll: what is being filled in stays as it is.
    const now = JSON.stringify(state);
    if (!all && (editing(panel) || now === drawnFrom)) return;
    drawnFrom = now;
    const status = node('p', state.armable ? 'Ready: everyone listed has consent and the 18-or-over confirmation.' : state.why.replace(/^Creator Studio: /, '') + '. Cameras do not arm or record until then.');
    if (!state.armable) status.className = 'recording-warning';
    const models = state.models.pose ? null : node('p', !state.models.plus ? 'Framings need Plus in AI assistance (the person detector and the body keypoint model).' : !state.models.detector ? 'Install the person detector in AI assistance: until then cameras show the whole picture.' : 'Download the body keypoint model in AI assistance: until then framings show the whole person.');
    if (models) models.className = 'recording-warning';
    const message = node('p', said); if (/not |need|fail|error|refus|no |must|Give|at most|Confirm/i.test(said)) message.className = 'recording-warning';
    panel.replaceChildren(node('h2', 'Creator Studio'), status, ...(models ? [models] : []), ...faces(), people(), framings(), preview(), cuts(), message);
  }

  // Each camera's own part, drawn by app.js in its card's "What it shows".
  window.studioCard = (camera, shots) => {
    if (!state) { shots.append(node('small', 'Loading Creator Studio…')); return; }
    const own = state.cameras[camera.id] || { framings: [], closeness: 'medium', follow: 'largest' };
    const set = settings => change({ cameras: { [camera.id]: { ...own, ...settings } } }, `${camera.name} saved.`);
    const names = Object.fromEntries(state.framings.map(f => [f.id, f.name]));
    const favours = node('div', 'Favours, first in shot wins: '); favours.className = 'card-setting';
    for (let place = 0; place < Math.min(4, state.framings.length); place++) {
      const here = own.framings[place] || '';
      const offered = state.framings.filter(f => f.id === here || !own.framings.includes(f.id)).map(f => [f.id, f.name]);
      const pick = select([['', here ? 'remove' : place === 0 ? 'the whole person' : '—'], ...offered], here, `Framing ${place + 1}`);
      pick.disabled = place > own.framings.length;
      pick.onchange = () => { const next = [...own.framings]; if (pick.value) next[Math.min(place, next.length)] = pick.value; else next.splice(place, 1); set({ framings: [...new Set(next.filter(Boolean))] }); };
      favours.append(pick);
    }
    const close = node('label', 'How close '), closePick = select([['tight', 'tight'], ['medium', 'medium'], ['loose', 'loose']], own.closeness, 'How close');
    closePick.onchange = () => set({ closeness: closePick.value }); close.append(closePick); close.className = 'card-setting';
    const follow = node('label', 'With several people in shot, follow '), followPick = select([['largest', 'the largest'], ['left', 'the leftmost'], ['right', 'the rightmost'], ['centre', 'the one nearest the centre']], own.follow, 'Whom it follows');
    followPick.onchange = () => set({ follow: followPick.value }); follow.append(followPick); follow.className = 'card-setting';
    const length = node('label', 'Its shots last '), seconds = number(state.cuts.camera_seconds?.[camera.id] ?? '', 0.5, 600, 0.5, 'Its own shot length, seconds');
    seconds.placeholder = 'as set'; seconds.onchange = () => change({ cuts: { camera_seconds: { [camera.id]: seconds.value ? Number(seconds.value) : null } } }, `${camera.name} saved.`);
    length.append(seconds, node('span', ' seconds')); length.className = 'card-setting';
    shots.append(favours, close, follow, length);
    shots.querySelector('summary')?.append(node('span', ` · ${own.framings.length ? own.framings.map(f => names[f] || f).join(', ') : 'the whole person'}`));
  };

  async function refresh() {
    const showing = typeof part !== 'undefined' && part === '/cameras' && role === 'admin' && csrf && studio();
    panel.hidden = !showing;
    if (!showing || busy) return;
    try { state = await api('/api/creator'); paint(false); } catch (error) { said = error.message; }
  }
  document.addEventListener('event-mode', refresh);
  setInterval(refresh, 3000); refresh();
})();
