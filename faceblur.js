'use strict';
// Face blur (faceblur.py), on the Director page: the administrator's only. EXPERIMENTAL: hidden, and nothing blurred,
// until switched on in System › This PC (the switch is drawn here too). Then every face, or everyone but consenting
// performers, for the show and camera by camera; margin, strength, the fail-safe, and recordings.
// Uses app.js's api(), node(), editing(), part, systemTab, role and csrf; nav.js's concert.sure().
(() => {
  const panel = document.querySelector('#face-blur'), system = document.querySelector('#face-blur-system');
  if (!panel) return;
  let state = null, said = '', busy = false, drawn = '', switchDrawn = '';
  const statuses = {};                 // camera id -> its status line, updated in place between rebuilds
  const body = node('div', ''), message = node('p', '');
  const heading = node('h2', 'Face blur '), badge = node('span', 'Experimental'); badge.className = 'badge warn'; heading.append(badge); heading.hidden = true;
  panel.append(heading, body, message);
  panel.hidden = true;                 // until the manager says whether it is switched on
  const caution = () => { const line = node('p', state.experimental); line.className = 'recording-warning'; return line; };

  async function change(settings) {
    busy = true; said = 'Saving…'; paint();
    try { state = await api('/api/face-blur', { method: 'POST', body: JSON.stringify(settings) }); said = ''; } catch (error) { said = error.message; }
    busy = false; paint();
  }
  function select(options, value, pick, label) {
    const choice = document.createElement('select'); choice.setAttribute('aria-label', label); choice.disabled = busy;
    for (const [v, text] of options) { const option = node('option', text); option.value = v; option.selected = String(v) === String(value); choice.append(option); }
    choice.onchange = () => pick(choice.value);
    return choice;
  }
  const row = (label, ...controls) => { const line = node('p', ''); line.append(node('span', `${label} `), ...controls); return line; };
  const modeName = id => state.modes.find(m => m.id === id)?.name || id;

  function cameraLine(camera) {
    const own = state.own[camera.id], now = state.cameras[camera.id] || { mode: 'off' };
    const line = node('li', '');
    const options = [['', `As the show (${modeName(state.mode).toLowerCase()})`], ...state.modes.map(m => [m.id, m.name])];
    line.append(node('strong', `${camera.name} `), select(options, own || '', v => change({ cameras: { [camera.id]: v || null } }), `Face blur for ${camera.name}`));
    statuses[camera.id] = node('small', ''); line.append(statuses[camera.id]); status(camera.id);
    return line;
  }
  function status(id) {
    const now = state.cameras[id] || { mode: 'off' }, line = statuses[id];
    if (!line) return;
    let text = '';
    if (now.mode === 'off') text = '';
    else if (now.blind) text = `${state.failsafe === 'off' ? 'faces may show unblurred' : state.failsafe === 'off_air' ? 'kept off air and blurred whole' : 'whole picture blurred'} for ${Math.round(now.blind_seconds)} s: ${now.why}`;
    else if (now.why) text = now.why;
    else text = `${now.looks_per_second} looks a second${now.ahead_seconds != null ? `, ${now.ahead_seconds.toFixed(1)} s ahead of OBS` : ''}${now.detect_ms != null ? `, ${Math.round(now.detect_ms)} ms to find faces (at most ${Math.round(now.detect_ms_most)})` : ''}, ${now.faces ?? 0} face${now.faces === 1 ? '' : 's'} now${now.decoder ? `, ${now.decoder === 'processor' ? 'decoded on the processor' : `decoded by ${now.decoder}`}` : ''}${now.in_obs ? '' : ' · not in OBS yet'}`;
    line.textContent = text ? ` ${text}` : '';
    line.className = now.mode !== 'off' && (now.blind || (now.why && !now.looks_per_second)) ? 'recording-warning' : '';
  }

  function paint() {
    if (!state) return;
    if (editing(panel)) return;
    // Rebuilt only when a setting changes; otherwise only the cameras' lines, so nothing moves under the pointer.
    const { cameras, files_job, ...settings } = state;
    const key = JSON.stringify([settings, Object.fromEntries(Object.entries(cameras).map(([id, c]) => [id, c.mode])), files_job, busy, said]);
    if (key === drawn) { Object.keys(statuses).forEach(status); return; }
    drawn = key;
    body.replaceChildren();
    body.append(node('p', 'Faces in the programme made unrecognisable, placed as OBS shows each moment: the manager finds them in each camera’s picture a few seconds before OBS shows it, on this computer. Off unless chosen here.'));
    if (state.migrated) body.append(node('p', 'Switched on for you when the manager was updated, because face blur was already in use here: it was not stopped. Switch it off in System › This PC.'));
    const caveat = node('p', state.caveat); caveat.className = 'recording-warning'; body.append(caveat);
    body.append(row('For the show:', select(state.modes.map(m => [m.id, m.name]), state.mode, v => change({ mode: v }), 'Face blur for the show')));
    body.append(caution());
    if (!state.chosen && state.event_default !== 'off') body.append(node('small', `This kind of event starts with “${modeName(state.event_default).toLowerCase()}”.`));
    const used = [state.mode, ...Object.values(state.own)];
    if ((used.includes('others') || used.includes('chosen')) && !state.recognising)
      body.append(node('p', 'No performer can be recognised now (Plus AI, with performers enrolled on the People page and recognition on): every face is blurred.'));
    if (used.includes('chosen')) {
      const chosen = node('p', state.recognising ? `${state.chosen_people} ${state.chosen_people === 1 ? 'person is' : 'people are'} chosen. ` : '');
      chosen.append('Choose who on the ');
      const link = document.createElement('a'); link.href = '/people'; link.textContent = 'People page'; chosen.append(link);
      chosen.append(': enrol them from a camera’s picture, with their consent, and tick “Blur their face”. Only enrolled people can be recognised: a chosen person the camera does not recognise (turned away, changed clothes) may show unblurred.');
      body.append(chosen);
    }
    const list = node('ul', ''); list.className = 'face-blur-cameras';
    for (const camera of state.cameras_list) list.append(cameraLine(camera));
    body.append(node('h3', 'Camera by camera'), node('small', 'Experimental, on every camera: it may miss faces.'), list);
    body.append(node('h3', 'How'));
    const margin = document.createElement('input'); margin.type = 'number'; margin.min = 0; margin.max = 150; margin.step = 5; margin.value = Math.round(state.margin * 100); margin.size = 4; margin.disabled = busy;
    margin.setAttribute('aria-label', 'Margin round each face, percent of the face');
    const setMargin = node('button', 'Set'); setMargin.disabled = busy; setMargin.onclick = () => change({ margin: Number(margin.value) / 100 });
    body.append(row('Margin round each face:', margin, node('span', ' % of the face '), setMargin));
    body.append(row('Strength:', select([['strong', 'Strong (at most 4 blocks down a face)'], ['medium', 'Medium (at most 6)'], ['light', 'Light (at most 9)']], state.strength, v => change({ strength: v }), 'Strength')));
    body.append(row('What is covered:', select([['whole', 'The whole face, and some of the head round it'], ['face', 'The face: ears, forehead, eyes, nose and chin'], ['eyes', 'Only the eyes and nose']], state.area, v => change({ area: v }), 'What is covered')));
    if (state.area === 'eyes') body.append(node('small', 'Covering only the eyes and nose hides less: people can still be recognised by their mouth, jaw, hair and voice. For anonymity, cover the whole face.'));
    if (state.area === 'face') body.append(node('small', 'The face from ear to ear and forehead to chin; hair and neck stay visible, and people can be recognised by them. For anonymity, cover the whole face and head.'));
    body.append(row('Shape:', select([['oval', 'An oval'], ['rectangle', 'A rectangle']], state.shape, v => change({ shape: v }), 'Shape')));
    body.append(row('Look:', select([['pixelate', 'Square blocks'], ['smooth', 'Soft blur']], state.style, v => change({ style: v }), 'Look')));
    body.append(row('If detection stalls or falls behind:', select(state.failsafes.map(f => [f.id, f.name]), state.failsafe, v => change({ failsafe: v }), 'Fail-safe')));
    body.append(node('small', 'For strict anonymity, keep a fail-safe on: a camera whose pictures were not all looked at in time is blurred whole (or kept off air) for exactly those moments, logged and shown in its readiness.'));
    body.append(node('h3', 'Recordings'));
    const files = [['off', 'No'], ['copy', 'Yes, a blurred copy beside it'], ['replace', 'Yes, and keep only the blurred one']];
    body.append(row('Blur each camera file afterwards:', select(files, state.files, v => change({ files: v }), 'Camera files')));
    body.append(row('Blur the programme recording afterwards:', select(files, state.programme, v => change({ programme: v }), 'Programme recording')));
    body.append(node('small', 'Afterwards every picture is looked at, more closely than live, so faces the live blur missed are caught too. It takes about as long as the recording for each file. Exports: python -m camera_manager.blurfiles "<file>"'));
    const job = state.files_job;
    if (job) body.append(node('p', `${job.state === 'blurring' ? 'Blurring' : job.state === 'failed' ? `Could not blur: ${job.problem}` : 'Last blurred'}: ${(job.files || []).map(f => `${f.file.split('/').pop()} ${f.state === 'blurring' ? Math.round(f.share * 100) + '%' : f.state}${f.problem ? ` (${f.problem})` : ''}`).join(' · ')}`));
    const detector = node('p', state.problem ? `Face detector: ${state.problem}` : state.detector ? `Faces are found by ${state.detector}, on this computer.` : `Face detector: ${state.detector_kind === 'vision' ? 'Apple Vision' : 'YuNet'}, loaded when face blur is first used.`);
    if (state.problem) detector.className = 'recording-warning';
    body.append(detector);
    if (state.detector_kind === 'vision') body.append(node('small', 'Download YuNet in AI assistance above to find small faces too: Vision misses faces smaller than about a twentieth of the picture’s height.'));
    if (state.obs_problem) { const trouble = node('p', `OBS: ${state.obs_problem}`); trouble.className = 'recording-warning'; body.append(trouble); }
    const off = state.mode === 'off' && !Object.values(state.own).some(m => m !== 'off');
    if (off) {
      const remove = node('button', 'Take face blur out of OBS'); remove.disabled = busy;
      remove.title = 'Removes the scenes face blur made in OBS and its layer from every scene. It makes them again when face blur is next on.';
      remove.onclick = async () => { busy = true; try { const done = await api('/api/face-blur/remove', { method: 'POST', body: '{}' }); said = `Removed ${done.removed.length} scenes from OBS.`; } catch (error) { said = error.message; } busy = false; refresh(); };
      body.append(remove);
    }
    message.textContent = said; message.className = said && said !== 'Saving…' ? 'recording-warning' : '';
  }
  // The switch (System › This PC): face blur exists only once an administrator switches it on.
  async function flip(on) {
    const question = on
      ? `Switch experimental face blur on?\n\n${state.experimental}\n\nIts settings then appear on the Director page; nothing is blurred until you choose it there.`
      : 'Switch face blur off?\n\nNothing is blurred from now on, live or in recordings, and its settings are hidden. They are kept for when it is next switched on.';
    if (!await concert.sure(question, { ok: on ? 'Switch on' : 'Switch off', danger: !on })) { switchDrawn = ''; paintSwitch(); return; }
    busy = true;
    try { state = await api('/api/face-blur/experimental', { method: 'POST', body: JSON.stringify({ enabled: on }) }); said = ''; } catch (error) { said = error.message; }
    busy = false; drawn = ''; switchDrawn = ''; paintSwitch();
  }
  function paintSwitch() {
    if (!system || !state || editing(system)) return;
    const key = JSON.stringify([state.enabled, state.migrated, busy, said]);
    if (key === switchDrawn) return;
    switchDrawn = key;
    const label = node('label', ''), box = document.createElement('input'); box.type = 'checkbox'; box.checked = !!state.enabled; box.disabled = busy;
    box.onchange = () => flip(box.checked);
    label.append(box, node('span', ' Face blur (experimental): may miss faces, especially small, turned or fast-moving ones. Do not rely on it to hide anyone.'));
    system.replaceChildren(node('h3', 'Experimental features'), label);
    system.append(node('small', state.enabled ? ' On: set it up on the Director page (Face blur).' : ' Off: nothing is blurred, and face blur’s settings are hidden everywhere.'));
    if (state.migrated) system.append(node('p', 'Switched on when the manager was updated, because face blur was already in use here, so that it did not silently stop blurring.'));
    if (said) { const trouble = node('p', said); trouble.className = 'recording-warning'; system.append(trouble); }
  }
  async function refresh() {
    const director = typeof part !== 'undefined' && part === '/director', switching = system && !system.hidden;
    if (role !== 'admin' || !csrf || !(director || switching)) { if (!director || role !== 'admin') panel.hidden = true; return; }
    if (busy || editing(panel) || (system && editing(system))) return;
    try { state = await api('/api/face-blur'); } catch (error) { message.textContent = error.message; return; }
    panel.hidden = !director || !state.enabled; heading.hidden = !state.enabled;
    if (!state.enabled) { body.replaceChildren(); drawn = ''; }
    else if (director) paint();
    paintSwitch();
  }
  setInterval(refresh, 3000); refresh();
})();
