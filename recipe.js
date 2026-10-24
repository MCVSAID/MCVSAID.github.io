'use strict';
// The recipe being cooked (recipe.py), what is laid over the programme (overlay.py) and the cook's spoken cues
// (speech.py), in Cooking. The Recipe page has it all: load a recipe from its page or as text; every step of the
// preparation and the method in a list, the one being cooked picked out, with when each began, how long it has run and
// which of its stations have had their shots; go to any step, Next, Back and Undo; mark a step done or skipped; edit,
// add, delete and reorder steps, their captions and stations, before the show or during it; what goes on screen; and
// the spoken cues, with what was heard and what it did. The Show page keeps a line of it: the step now, Back and Next.
// Uses app.js's api(), node(), editing(), part, csrf.
(() => {
  const page = document.querySelector('#recipe'), summary = document.querySelector('#recipe-now');
  if (!page) return;
  let state = null, said = '', busy = false, fetchedAt = Date.now();
  let editingStep = null, adding = null;          // the step whose edit form is open; the section a step is being added to
  // Edit steps: the list as an editor (each step's words, Edit, Delete, up and down, dragging, adding between any two),
  // apart from the controls for cooking it, which hid editing in each step's More (2026-10-24: "not intuitive or easy").
  let arranging = false, dragging = null;
  const drawn = {};
  const boxes = Object.fromEntries(['load', 'now', 'run', 'ingredients', 'screen', 'voice'].map(name => [name, node('div', '')]));
  boxes.run.className = 'recipe-run-box';
  const message = node('p', ''); message.setAttribute('aria-live', 'polite');
  page.append(boxes.load, boxes.now, boxes.run, boxes.ingredients, boxes.screen, boxes.voice, message);

  async function send(path, data, done) {
    busy = true; said = done === undefined ? 'Working…' : ''; paint();
    try { state = await api(path, { method: 'POST', body: JSON.stringify(data) }); fetchedAt = Date.now(); said = done || ''; } catch (error) { said = error.message; }
    busy = false; for (const name in drawn) drawn[name] = ''; paint();
    return state;
  }
  const go = where => send('/api/recipe/step', { go: where });
  const step = data => send('/api/recipe/step', data);
  const change = (data, done) => send('/api/recipe/edit', data, done);
  const overlay = settings => send('/api/overlay', settings);
  const voice = settings => send('/api/recipe/voice', settings);
  const button = (text, act, title, kind) => { const b = node('button', text); b.type = 'button'; b.disabled = busy; if (title) b.title = title; if (kind) b.className = kind; b.onclick = act; return b; };
  const station = key => state.stations.find(s => s[0] === key)?.[1] || key;
  const clock = seconds => { const s = Math.max(0, Math.floor(seconds)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const timeOfDay = epoch => new Date(epoch * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  // A running time, kept up between answers from the manager.
  const running = (seconds, live) => { const span = node('span', clock(seconds)); if (live) { span.dataset.clock = String(seconds); } return span; };
  setInterval(() => { for (const span of document.querySelectorAll('[data-clock]')) span.textContent = clock(Number(span.dataset.clock) + (Date.now() - fetchedAt) / 1000); }, 1000);
  const openRecipePage = event => { if (event.metaKey || event.ctrlKey || event.shiftKey) return; event.preventDefault(); history.pushState(null, '', '/recipe'); window.concert.pick?.('/recipe'); };
  const checkbox = (text, on, act, disabled) => {
    const label = node('label', ''), tick = document.createElement('input'); tick.type = 'checkbox'; tick.checked = !!on; tick.disabled = busy || !!disabled; tick.onchange = () => act(tick.checked);
    label.append(tick, node('span', ` ${text}`)); return label;
  };

  // -- loading --------------------------------------------------------------------------------------------------------
  function loader(again) {
    // From its page (most recipe sites publish it in a form that can be read), or pasted.
    const box = node('div', '');
    const address = document.createElement('input'); address.type = 'url'; address.placeholder = 'https://… the recipe’s page'; address.size = 44; address.setAttribute('aria-label', 'Recipe address');
    if (!again) box.append(node('p', 'Load the recipe and the director follows it: each step’s stations are favoured until they have been shown, the steps are called out on screen, and the recipe and a QR code of its address can be put up beside the cook.'));
    const fromPage = node('p', ''); fromPage.className = 'recipe-load-row';
    fromPage.append(address, button('Load from page', () => send('/api/recipe', { url: address.value.trim() }, 'Loaded. Check the steps below.')));
    const text = document.createElement('textarea'); text.rows = 9; text.cols = 60; text.setAttribute('aria-label', 'Recipe text');
    text.placeholder = 'Or paste it:\nBeef stew\nIngredients\n1 kg stewing beef\n2 onions\nPreparation\nPreheat the oven to 160 °C.\nDice the onions.\nMethod\n1. Brown the beef in a heavy pot.\n2. Braise in the oven for two hours.';
    const pasted = node('p', ''); pasted.append(button('Load pasted recipe', () => send('/api/recipe', { text: text.value, url: address.value.trim() }, 'Loaded. Check the steps below.')),
      node('small', ' With a page address above as well, it is used for the QR code. Preparation (weighing, chopping, preheating) under a heading of its own — “Preparation”, “Prep”, “Before you start” — becomes a section of its own.'));
    box.append(fromPage, text, pasted);
    return box;
  }

  function loadBox(recipe) {
    const box = node('div', '');
    if (!recipe) { box.append(node('h2', 'Load a recipe'), loader(false)); return box; }
    const head = node('div', ''); head.className = 'recipe-head';
    const title = node('h2', recipe.title); head.append(title);
    if (recipe.url) { const link = document.createElement('a'); link.href = recipe.url; link.target = '_blank'; link.rel = 'noopener'; link.textContent = recipe.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60); head.append(link); }
    box.append(head);
    const details = document.createElement('details'); details.append(node('summary', 'Title and address, another recipe'));
    const name = document.createElement('input'); name.type = 'text'; name.value = recipe.title; name.maxLength = 120; name.size = 30; name.setAttribute('aria-label', 'Recipe title');
    const url = document.createElement('input'); url.type = 'url'; url.value = recipe.url || ''; url.size = 40; url.placeholder = 'https://… (for the QR code)'; url.setAttribute('aria-label', 'Recipe address');
    const line = node('p', ''); line.className = 'recipe-load-row'; line.append(name, url, button('Save', () => change({ action: 'details', title: name.value, url: url.value.trim() })));
    const away = button('Put the recipe away', async () => { if (await concert.ask({ title: 'Put the recipe away?', text: 'Its steps, what each has had and the cues heard are forgotten.', fields: [], ok: 'Put it away', danger: true })) send('/api/recipe', { clear: true }, ''); }, null, 'danger');
    details.append(line, node('h3', 'Load another recipe'), loader(true), away);
    box.append(details);
    return box;
  }

  // -- where the cooking is -------------------------------------------------------------------------------------------
  function nowBox(p) {
    const box = node('div', ''); box.className = 'recipe-now-card';
    const where = p.step ? `${p.step.label} of ${p.step.section === 'prep' ? p.prep.count : p.count - p.prep.count}${p.step.section === 'prep' ? ' (preparation)' : ''}` : (p.finished ? 'Finished' : 'Not begun');
    const line = node('p', ''); line.className = 'recipe-now-line';
    line.append(node('strong', where));
    if (p.step) { line.append(node('span', ` · ${p.step.caption}`)); if (p.seconds != null) { line.append(node('span', ' · ')); line.append(running(p.seconds, true)); } }
    else line.append(node('span', ` · ${p.count} steps${p.prep.count ? `, ${p.prep.count} of them preparation` : ''}`));
    box.append(line);
    if (p.step) box.append(node('small', p.step.text));
    const row = node('p', ''); row.className = 'recipe-controls';
    const back = button('Back', () => go('back'), 'The step before'); back.disabled = busy || !p.current || p.current === 1;
    const next = button(p.next ? `Next: ${p.next.label} · ${p.next.caption}` : (p.step && p.steps.find(s => s.id === p.current_id)?.status === 'current' ? 'Mark this step done' : 'No more steps'), () => go('next'), 'Shortcut: S');
    next.id = 'recipe-next'; next.disabled = busy || (!p.next && !(p.step && p.steps.find(s => s.id === p.current_id)?.status === 'current'));
    const undo = button(p.undo ? `Undo: ${p.undo}` : 'Undo', () => step({ undo: true }), p.undo ? `Puts back: ${p.undo}` : 'Nothing to undo'); undo.disabled = busy || !p.undo;
    row.append(back, next, undo); box.append(row);
    const follow = document.createElement('select'); follow.setAttribute('aria-label', 'Who moves through the steps');
    for (const [v, t] of [['auto', 'The director moves on when it sees the next step (you and spoken cues can too)'], ['manual', 'Only you and spoken cues move through the steps']]) { const o = node('option', t); o.value = v; o.selected = p.follow === v; follow.append(o); }
    follow.onchange = () => overlay({ follow: follow.value }); follow.disabled = busy;
    box.append(follow);
    const owed = Object.keys(p.needs || {});
    if (p.step) box.append(node('small', p.step.stations.length ? (owed.length ? `Still to show for this step: ${owed.map(station).join(', ')}.` : `This step’s ${p.step.stations.map(station).join(' and ')} ${p.step.stations.length > 1 ? 'have' : 'has'} been shown.`) : 'This step has no station of its own: whatever the model rates best.'));
    if (p.missed?.length) { const warn = node('p', `Not shown long enough: ${p.missed.map(n => p.steps[n - 1]?.label || `step ${n}`).join(', ')}. The cut log says what each step got.`); warn.className = 'recording-warning'; box.append(warn); }
    return box;
  }

  // -- every step -------------------------------------------------------------------------------------------------------
  const STATUS = { current: 'Now', done: 'Done', skipped: 'Skipped', 'to come': 'To come' };

  function stationPicks(chosen, label) {
    return [0, 1].map(n => {
      const pick = document.createElement('select'); pick.setAttribute('aria-label', `Station ${n + 1} for ${label}`);
      for (const [key, name] of [['', n ? '—' : 'any'], ...state.stations]) { const o = node('option', name); o.value = key; o.selected = (chosen[n] || '') === key; pick.append(o); }
      return pick;
    });
  }

  function stepForm(s, section, at) {
    // A step's words, caption (what the screen says) and stations (what has to be seen while it is done).
    const form = document.createElement('form'); form.className = 'recipe-step-form';
    const label = s ? s.label : `a new ${section === 'prep' ? 'preparation step' : 'step'}`;
    const text = document.createElement('textarea'); text.rows = 2; text.value = s ? s.text : ''; text.maxLength = 400; text.required = true; text.setAttribute('aria-label', `Words of ${label}`);
    text.placeholder = section === 'prep' ? 'Weigh out the flour and sugar.' : 'Fold in the flour.';
    const caption = document.createElement('input'); caption.type = 'text'; caption.value = s ? s.caption : ''; caption.maxLength = 80; caption.size = 28; caption.setAttribute('aria-label', `Caption for ${label}`);
    caption.placeholder = s ? '' : 'On screen (made from the words if left empty)';
    const picks = stationPicks(s ? s.stations : [], label);
    const stations = node('span', ''); stations.className = 'recipe-picks'; stations.append(node('span', 'Stations to show '), ...picks);
    const cap = node('label', 'On screen '); cap.append(caption);
    const save = node('button', s ? 'Save step' : 'Add step'); save.type = 'submit'; save.disabled = busy;
    const cancel = button('Cancel', () => { editingStep = null; adding = null; drawn.run = ''; paint(); });
    const row = node('p', ''); row.append(save, cancel);
    form.append(text, cap, stations, row);
    form.onsubmit = async event => {
      event.preventDefault();
      const chosen = [...new Set(picks.map(p => p.value).filter(Boolean))];
      const words = { text: text.value.trim(), stations: chosen, ...(caption.value.trim() ? { caption: caption.value.trim() } : {}) };
      // Unchanged stations are left to follow the words when the words change and nothing else was chosen.
      if (s && words.text !== s.text && JSON.stringify(chosen) === JSON.stringify(s.stations)) delete words.stations;
      if (s && words.text !== s.text && words.caption === s.caption) delete words.caption;
      const done = await (s ? change({ action: 'update', id: s.id, ...words }) : change({ action: 'add', section, ...(at != null ? { at } : {}), ...words }));
      if (done && !said) { editingStep = null; adding = null; drawn.run = ''; paint(); }
    };
    setTimeout(() => text.focus(), 0);
    return form;
  }

  const startAdding = (section, at) => { adding = { section, at }; editingStep = null; drawn.run = ''; paint(); };
  const startEditing = id => { editingStep = id; adding = null; drawn.run = ''; paint(); };

  function arrangedRow(s, list) {
    // In Edit steps: the step's words, and every change to it in plain sight. Dragged by its handle (or anywhere on it)
    // onto another step to go in that step's place, in either section.
    const li = document.createElement('li'); li.className = `recipe-step arranging ${s.status.replace(' ', '-')}`; li.dataset.id = s.id;
    const same = list.filter(x => x.section === s.section), at = same.indexOf(s);
    li.draggable = !busy;
    li.ondragstart = event => { dragging = s.id; li.classList.add('dragged'); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', s.id); };
    li.ondragend = () => { dragging = null; li.classList.remove('dragged'); for (const t of boxes.run.querySelectorAll('.drop-here')) t.classList.remove('drop-here'); };
    li.ondragover = event => { if (dragging && dragging !== s.id) { event.preventDefault(); li.classList.add('drop-here'); } };
    li.ondragleave = () => li.classList.remove('drop-here');
    li.ondrop = event => {
      event.preventDefault(); li.classList.remove('drop-here');
      const id = dragging || event.dataTransfer.getData('text/plain'); dragging = null;
      if (id && id !== s.id) change({ action: 'move', id, section: s.section, to: at });
    };
    const handle = node('span', '⠿'); handle.className = 'drag-handle'; handle.title = 'Drag to move'; handle.setAttribute('aria-hidden', 'true');
    const words = node('div', ''); words.className = 'recipe-arranged-words';
    const text = node('p', s.text); text.title = 'Click to edit'; text.onclick = () => startEditing(s.id);
    words.append(node('span', s.label), text);
    if (s.caption && s.caption !== s.text) words.append(node('small', `On screen: ${s.caption}`));
    if (s.stations.length) words.append(node('small', `Stations: ${s.stations.map(station).join(', ')}`));
    const tools = node('div', ''); tools.className = 'recipe-arranged-tools';
    const up = button('↑', () => change({ action: 'move', id: s.id, to: at - 1 }), `Move ${s.label} up`); up.disabled = busy || at === 0;
    const down = button('↓', () => change({ action: 'move', id: s.id, to: at + 1 }), `Move ${s.label} down`); down.disabled = busy || at === same.length - 1;
    const last = s.section === 'method' && same.length === 1;
    const other = button(s.section === 'prep' ? 'To method' : 'To preparation', () => s.section === 'prep' ? change({ action: 'move', id: s.id, section: 'method', to: 0 })
      : change({ action: 'move', id: s.id, section: 'prep', to: list.filter(x => x.section === 'prep').length }), s.section === 'prep' ? 'First in the method' : 'Last in the preparation');
    other.disabled = busy || last;
    const del = button('Delete', () => change({ action: 'delete', id: s.id }, `Deleted ${s.label}. Undo puts it back.`), `Delete ${s.label} (Undo puts it back)`, 'danger');
    del.disabled = busy || last;
    for (const b of [up, down]) b.setAttribute('aria-label', b.title);
    tools.append(up, down, button('Edit', () => startEditing(s.id), `Edit ${s.label}'s words, caption and stations`), other, del);
    li.append(handle, words, tools);
    return li;
  }

  function insertHere(section, at) {
    // Between two steps in Edit steps: add one just there.
    const li = document.createElement('li'); li.className = 'recipe-insert';
    const b = button('+ Add a step here', () => startAdding(section, at), null, 'link'); li.append(b);
    li.ondragover = event => { if (dragging) { event.preventDefault(); li.classList.add('drop-here'); } };
    li.ondragleave = () => li.classList.remove('drop-here');
    li.ondrop = event => { event.preventDefault(); const id = dragging || event.dataTransfer.getData('text/plain'); dragging = null; if (id) change({ action: 'move', id, section, to: at }); };
    return li;
  }

  function stepRow(s, index, list, p) {
    const li = document.createElement('li'); li.className = `recipe-step ${s.status.replace(' ', '-')}`; li.dataset.id = s.id;
    if (s.status === 'current') li.setAttribute('aria-current', 'step');
    if (editingStep === s.id) { li.append(stepForm(s, s.section)); return li; }
    if (arranging) return arrangedRow(s, list);
    const head = node('div', ''); head.className = 'recipe-step-head';
    head.append(node('span', s.label), node('strong', s.caption));
    const chip = node('span', STATUS[s.status] || s.status); chip.className = `pill ${{ current: 'air', done: 'ok', skipped: 'off', 'to come': 'off' }[s.status] || 'off'}`; head.append(chip);
    li.append(head);
    li.append(node('p', s.text));
    const facts = node('p', ''); facts.className = 'recipe-step-facts';
    if (s.began != null) { facts.append(node('span', `Began ${timeOfDay(s.began)} · `)); facts.append(running(s.seconds || 0, s.status === 'current')); }
    else facts.append(node('span', 'Not begun'));
    if (s.stations.length) {
      const shots = node('span', ''); shots.className = 'recipe-shots';
      for (const key of s.stations) { const got = s.shots.includes(key); const one = node('span', `${got ? '✓' : '○'} ${station(key)}`); one.className = got ? 'got' : 'owed'; one.title = got ? 'Shown long enough to be sure it was captured' : 'Not yet shown long enough'; shots.append(one); }
      facts.append(shots);
    } else facts.append(node('span', ' · no station of its own'));
    li.append(facts);
    const actions = node('div', ''); actions.className = 'recipe-step-actions';
    if (s.status !== 'current') actions.append(button('Go to this step', () => step({ id: s.id }), `${s.label} is being cooked now`));
    if (s.status === 'current' || s.status === 'to come') actions.append(button('Done', () => step({ mark: 'done', id: s.id }), `Mark ${s.label} done${s.status === 'current' ? ' and go on' : ''}`), button('Skip', () => step({ mark: 'skipped', id: s.id }), `Skip ${s.label}${s.status === 'current' ? ' and go on' : ''}`));
    else actions.append(button('To come again', () => step({ mark: 'pending', id: s.id }), `${s.label} is to be cooked again`));
    const more = document.createElement('details'); more.className = 'recipe-more'; more.append(node('summary', 'More'));
    const sameSection = list.filter(x => x.section === s.section), at = sameSection.indexOf(s);
    const up = button('Move up', () => change({ action: 'move', id: s.id, to: at - 1 }), 'Earlier in its section'); up.disabled = busy || at === 0;
    const down = button('Move down', () => change({ action: 'move', id: s.id, to: at + 1 }), 'Later in its section'); down.disabled = busy || at === sameSection.length - 1;
    const other = s.section === 'prep' ? button('Move to the method', () => change({ action: 'move', id: s.id, section: 'method', to: 0 }), 'First in the method')
      : button('Move to the preparation', () => change({ action: 'move', id: s.id, section: 'prep', to: list.filter(x => x.section === 'prep').length }), 'Last in the preparation');
    if (s.section === 'method' && list.filter(x => x.section === 'method').length === 1) other.disabled = true;
    const del = button('Delete', async () => { if (await concert.ask({ title: `Delete ${s.label}?`, text: `“${s.text}” — Undo puts it back.`, fields: [], ok: 'Delete', danger: true })) change({ action: 'delete', id: s.id }); }, null, 'danger');
    if (s.section === 'method' && list.filter(x => x.section === 'method').length === 1) del.disabled = true;
    more.append(button('Pop up on screen', () => step({ pop: s.id }), 'Shown over the programme for a few seconds'), button('Edit', () => startEditing(s.id)),
      up, down, other, button('Add a step after', () => startAdding(s.section, at + 1)), del);
    actions.append(more);
    li.append(actions);
    return li;
  }

  function section(name, steps, p) {
    const box = node('div', ''); box.className = `recipe-section ${name}`;
    const all = p.steps;
    const heading = node('div', ''); heading.className = 'recipe-section-head';
    heading.append(node('h3', name === 'prep' ? `Preparation${steps.length ? ` (${steps.length})` : ''}` : `Method (${steps.length})`));
    if (name === 'prep') {
      heading.append(checkbox('Show on screen', p.prep.shown, on => overlay({ prep: on })));
      const left = steps.filter(s => s.status === 'to come' || s.status === 'current');
      if (left.length) heading.append(button('Skip the preparation', () => step({ skip_prep: true }), 'Done before the show, or not to be shown: the cooking goes on with the method'));
    }
    box.append(heading);
    if (name === 'prep' && !steps.length) box.append(node('small', 'Weighing, chopping, preheating: what is done before the cooking proper, as steps of their own that the director follows with their own stations.'));
    const ol = document.createElement('ol'); ol.className = 'recipe-run';
    steps.forEach((s, index) => {
      if (adding && adding.section === name && adding.at === index) { const li = document.createElement('li'); li.className = 'recipe-step adding'; li.append(stepForm(null, name, index)); ol.append(li); }
      else if (arranging && !adding && !editingStep) ol.append(insertHere(name, index));
      ol.append(stepRow(s, index, all, p));
    });
    if (arranging && !adding && !editingStep && steps.length) ol.append(insertHere(name, steps.length));
    if (adding && adding.section === name && (adding.at == null || adding.at >= steps.length)) { const li = document.createElement('li'); li.className = 'recipe-step adding'; li.append(stepForm(null, name, null)); ol.append(li); }
    box.append(ol);
    if ((!adding || adding.section !== name) && (!arranging || !steps.length)) box.append(button(name === 'prep' ? 'Add a preparation step' : 'Add a step', () => startAdding(name, null)));
    return box;
  }

  function runBox(p) {
    const box = node('div', '');
    const prep = p.steps.filter(s => s.section === 'prep'), method = p.steps.filter(s => s.section === 'method');
    const bar = node('div', ''); bar.className = 'recipe-edit-bar';
    const toggle = button(arranging ? 'Done editing' : 'Edit steps', () => { arranging = !arranging; editingStep = null; adding = null; drawn.run = ''; paint(); }, arranging ? 'Back to cooking the steps' : 'Change, add, delete and reorder the steps', arranging ? 'primary' : '');
    toggle.setAttribute('aria-pressed', String(arranging));
    bar.append(toggle);
    if (arranging) bar.append(node('small', 'Click a step’s words to change them, drag a step (or use ↑ ↓) to move it, “+ Add a step here” between any two. Undo, above, takes back the last change.'));
    box.append(bar, section('prep', prep, p), section('method', method, p));
    return box;
  }

  function ingredientsBox(recipe) {
    const details = document.createElement('details'); details.append(node('summary', `Ingredients (${recipe.ingredients.length})`));
    const text = document.createElement('textarea'); text.rows = Math.min(14, Math.max(4, recipe.ingredients.length + 1)); text.value = recipe.ingredients.join('\n'); text.setAttribute('aria-label', 'Ingredients, one to a line');
    details.append(node('small', 'One to a line. Each is shown on screen when the cook names it, with spoken cues on.'), text, button('Save ingredients', () => change({ action: 'details', ingredients: text.value })));
    return details;
  }

  // OBS has stopped asking for the overlay (overlay.py, Overlay.watch): nothing laid over the programme shows.
  function notShown(o) {
    const warn = node('p', `OBS is not showing the overlay: its browser source has not asked for it for ${Math.round(o.quiet / 60) ? `${Math.round(o.quiet / 60)} min` : `${o.quiet} s`}, so the recipe, QR code and captions do not reach the programme. ${o.reloads ? 'The manager has asked OBS to load it again. ' : ''}If it stays like this, in OBS open the source “MCVSAID · Overlay” and press Refresh cache of current page, or restart OBS.`);
    warn.className = 'recording-warning'; return warn;
  }

  // -- on screen --------------------------------------------------------------------------------------------------------
  function screen(o, recipe) {
    const box = node('div', ''); box.append(node('h3', 'On screen'));
    const row = node('p', '');
    const toggle = (name, on, onText, offText, key) => { const b = button(on ? offText : onText, () => overlay({ [name]: !on }), `Shortcut: ${key}`); if (on) b.className = 'active'; return b; };
    row.append(toggle('recipe', o.recipe, 'Show recipe', 'Hide recipe', 'R'));
    const qr = toggle('qr', o.qr, 'Show QR code', 'Hide QR code', 'Q'); qr.disabled = busy || !recipe.url; if (!recipe.url) qr.title = 'Give the recipe’s address (Title and address, above) to show its QR code'; row.append(qr);
    row.id = 'overlay-buttons'; box.append(row);
    box.append(checkbox('Call out each step on screen as it begins, and “continued” when the programme comes back to it', o.captions, on => overlay({ captions: on })));
    const shown = o.showing || {};
    box.append(node('p', `The recipe goes on the side away from the cook: ${shown.on ? `the ${shown.side} now` : 'right, until the cook has been found'}. A step popped up goes there too; the QR code goes in the lower corner on the cook’s side, with an ingredient named just above it, and a recipe too long for its panel says how many steps are out of sight.`));
    const obs = node('p', '');
    if (!o.obs) obs.append(button('Add the overlay to OBS', () => overlay({ obs: true }), 'Puts a browser source on top in every programme scene'), node('small', ' Needed once: OBS shows the overlay in every programme scene.'));
    else {
      obs.append(node('span', o.problem ? `OBS: ${o.problem} ` : `In OBS: on top in ${o.scenes} scene${o.scenes === 1 ? '' : 's'}. `), button('Take it out of the programme', () => overlay({ obs: false })));
      if (o.problem) obs.className = 'recording-warning';
    }
    box.append(obs);
    if (o.obs && o.quiet) box.append(notShown(o));
    if (o.page) { const look = document.createElement('a'); look.href = o.page; look.target = '_blank'; look.rel = 'noopener'; look.textContent = 'Preview the overlay in a new tab'; box.append(look); }
    return box;
  }

  // -- spoken cues --------------------------------------------------------------------------------------------------------
  function voiceBox(v) {
    const box = node('div', ''); box.className = 'recipe-voice'; box.append(node('h3', 'Spoken cues'));
    box.append(node('p', 'What the cook says moves the recipe on and puts things on screen, alongside the director: the director keeps choosing the shots (and following the steps, if it is set to), and a spoken cue changes only the step and what is laid over the programme, taking precedence there when it is called out. Speech is recognised on this computer: nothing heard is sent anywhere, and what was heard is kept here only, for the last few phrases, never saved.'));
    const toDirector = () => { const a = document.createElement('a'); a.href = '/director'; a.textContent = 'AI assistance on the Director page'; a.onclick = event => { if (event.metaKey || event.ctrlKey || event.shiftKey) return; event.preventDefault(); history.pushState(null, '', '/director'); window.concert.pick?.('/director'); }; return a; };
    if (!v.allowed) { const need = node('p', 'Spoken cues are part of the Standard and Plus AI levels: choose one in '); need.append(toDirector(), node('span', '. You can still try a phrase below.')); need.className = 'recording-warning'; box.append(need); }
    box.append(checkbox('Act on what the cook says', v.enabled, on => voice({ enabled: on }), !v.allowed));
    const cues = node('div', ''); cues.className = 'recipe-cues';
    cues.append(checkbox('“Let’s see that recipe”: the recipe on screen, with its QR code when it has an address', v.cues.recipe, on => voice({ cues: { recipe: on } })),
      checkbox('“Right now we’re on step two”, “next step”, “back a step”, “back to the sauce”, “the final step”: that step begun, forward or back, and popped up on screen', v.cues.step, on => voice({ cues: { step: on } })),
      checkbox('An ingredient on the list named: its line at the foot of the screen for a few seconds; called out (“now to our butter”), shown again even if it just was', v.cues.ingredient, on => voice({ cues: { ingredient: on } })));
    box.append(cues);
    if (v.enabled) {
      const where = node('p', ''); where.className = 'recipe-load-row';
      const device = window.listenTo ? window.listenTo(v, name => voice({ device: name })) : document.createElement('span');
      const model = document.createElement('select'); model.setAttribute('aria-label', 'Speech model');
      for (const [name, size] of v.models) { const o = node('option', `Whisper ${name} (${size})${name === 'small.en' ? ', the default' : ', for a smaller computer'}`); o.value = name; o.selected = name === v.model; model.append(o); }
      model.onchange = () => voice({ model: model.value });
      where.append(node('span', 'Listen to '), device, model);
      box.append(where, node('small', 'The cook’s own microphone hears them as they speak; the programme’s sound is what OBS sends to BlackHole, behind by as much as the programme is.'));
      const status = node('p', '');
      if (v.problem || !v.runtime || !v.installed) { status.append(node('span', `Not listening yet: ${v.problem || (!v.runtime ? 'speech recognition is not installed' : 'the speech model is not downloaded')}. Set it up in `), toDirector(), node('span', '.')); status.className = 'recording-warning'; }
      else status.append(node('span', v.listening ? `Listening to ${v.source}.` : 'Ready.'));
      box.append(status);
    }
    const heard = node('div', ''); heard.className = 'recipe-heard'; heard.append(node('h4', 'Heard'));
    if (!v.heard.length) heard.append(node('small', v.enabled ? 'Nothing yet.' : 'Nothing: spoken cues are off. Try a phrase below to see what each would do.'));
    else {
      const list = document.createElement('ul');
      for (const entry of v.heard) {
        const li = document.createElement('li'); li.className = entry.did ? 'did' : 'ignored';
        li.append(node('q', entry.text), node('small', ` ${entry.typed ? 'typed' : `${Math.round(entry.sure * 100)}% sure`}, ${clock(entry.ago)} ago`), node('br', ''), node('span', entry.did ? `→ ${entry.did}` : `→ nothing: ${entry.why}`));
        list.append(li);
      }
      heard.append(list);
    }
    box.append(heard);
    const try_ = document.createElement('form'); try_.className = 'recipe-load-row';
    const phrase = document.createElement('input'); phrase.type = 'text'; phrase.maxLength = 240; phrase.size = 34; phrase.placeholder = 'Right now we’re on step two'; phrase.setAttribute('aria-label', 'A phrase, as if the cook said it');
    const act = node('button', 'Act on it'); act.disabled = busy;
    try_.append(node('span', 'Try a phrase, as if the cook said it: '), phrase, act);
    try_.onsubmit = event => { event.preventDefault(); const text = phrase.value.trim(); if (!text) return; phrase.value = ''; phrase.blur(); send('/api/recipe/voice', { say: text }, ''); };
    box.append(try_, node('small', 'It acts on the show as a spoken cue would.'));
    return box;
  }

  // -- the Show page's line -----------------------------------------------------------------------------------------------
  function summaryBox() {
    const box = node('div', '');
    if (!state.cooking) return box;
    const p = state.progress, link = document.createElement('a'); link.href = '/recipe'; link.onclick = openRecipePage;
    box.append(node('h2', 'Recipe'));
    if (!p) { link.textContent = 'Load a recipe on the Recipe page'; const line = node('p', 'No recipe loaded. '); line.append(link); box.append(line); return box; }
    link.textContent = 'All the steps';
    const line = node('p', ''); line.className = 'recipe-now-line';
    line.append(node('strong', `${p.title} · `), node('span', p.step ? `${p.step.label}: ${p.step.caption}` : p.finished ? 'Finished' : `Not begun · ${p.count} steps`));
    if (p.step && p.seconds != null) { line.append(node('span', ' · ')); line.append(running(p.seconds, true)); }
    box.append(line);
    const row = node('p', ''); row.className = 'recipe-controls';
    const back = button('Back', () => go('back'), 'The step before'); back.disabled = busy || !p.current || p.current === 1;
    const next = button(p.next ? `Next: ${p.next.caption}` : 'Last step', () => go('next'), 'Shortcut: S'); next.id = 'recipe-next-show'; next.disabled = busy || !p.next;
    row.append(back, next, link);
    box.append(row);
    const owed = Object.keys(p.needs || {});
    if (p.step && owed.length) box.append(node('small', `Still to show for this step: ${owed.map(station).join(', ')}.`));
    if (state.overlay?.obs && state.overlay.quiet) box.append(notShown(state.overlay));
    return box;
  }

  function put(name, key, make) {
    if (drawn[name] === key) return;
    drawn[name] = key; boxes[name].replaceChildren(make());
  }

  function paint() {
    if (!state) return;
    if (!editing(summary)) {
      const key = JSON.stringify([state.cooking, state.progress && { ...state.progress, seconds: null, caption: null, steps: null, history: null }, state.overlay?.quiet, busy]);
      if (drawn.summary !== key) { drawn.summary = key; summary.replaceChildren(summaryBox()); }
    }
    if (!state.cooking) {
      for (const box of Object.values(boxes)) box.replaceChildren();
      for (const name in drawn) drawn[name] = '';
      boxes.load.append(node('p', 'The Recipe page is for Cooking: choose it as the kind of event, under the name in the side bar.'));
      message.textContent = ''; return;
    }
    const recipe = state.recipe, p = state.progress;
    const open = name => boxes[name].querySelector('details')?.open;
    const plain = s => ({ ...s, seconds: null });
    if (!editing(boxes.load)) { const was = open('load'); put('load', JSON.stringify([recipe && [recipe.title, recipe.url], busy]), () => loadBox(recipe)); if (was) boxes.load.querySelector('details')?.setAttribute('open', ''); }
    if (!recipe) { for (const name of ['now', 'run', 'ingredients', 'screen', 'voice']) { boxes[name].replaceChildren(); drawn[name] = ''; } }
    else {
      put('now', JSON.stringify([{ ...p, seconds: null, caption: null, history: null, steps: p.steps.map(plain) }, busy]), () => nowBox(p));
      // An open form is not redrawn under the hand that is filling it in.
      if (!editingStep && !adding && !dragging && !editing(boxes.run)) {
        const opened = [...boxes.run.querySelectorAll('details.recipe-more[open]')].map(d => d.closest('li')?.dataset.id);
        put('run', JSON.stringify([p.steps.map(plain), p.prep, state.stations, busy, arranging]), () => runBox(p));
        for (const id of opened) boxes.run.querySelector(`li[data-id="${id}"] details.recipe-more`)?.setAttribute('open', '');
      } else if (drawn.run === '') put('run', 'form', () => runBox(p));
      if (!editing(boxes.ingredients)) { const was = open('ingredients'); put('ingredients', JSON.stringify([recipe.ingredients, busy]), () => ingredientsBox(recipe)); if (was) boxes.ingredients.querySelector('details')?.setAttribute('open', ''); }
      put('screen', JSON.stringify([state.overlay && { ...state.overlay, showing: state.overlay.showing?.side }, recipe.url, busy]), () => screen(state.overlay, recipe));
      if (!editing(boxes.voice)) put('voice', JSON.stringify([{ ...state.voice, heard: state.voice.heard.map(e => [e.at, e.text, e.did, e.why]), heard_at: null }, Math.floor(Date.now() / 10000), busy]), () => voiceBox(state.voice));
    }
    message.textContent = said; message.className = said && !/^(Working…|Loaded|Saved)/.test(said) ? 'recording-warning' : '';
  }

  // S: next step; R: the recipe on screen or off; Q: the QR code. On the Show and Recipe pages, not while typing.
  document.addEventListener('keydown', event => {
    if (!state?.recipe || !state.cooking || !['/', '/recipe'].includes(part) || event.metaKey || event.ctrlKey || event.altKey || event.repeat || event.target.closest?.('input, textarea, select, [contenteditable], dialog')) return;
    const which = event.key.toLowerCase();
    if (which === 's' && document.querySelector('#recipe-next:not([disabled]), #recipe-next-show:not([disabled])')) { event.preventDefault(); event.stopImmediatePropagation(); go('next'); }
    else if (which === 'r') { event.preventDefault(); overlay({ recipe: !state.overlay.recipe }); }
    else if (which === 'q' && state.recipe.url) { event.preventDefault(); overlay({ qr: !state.overlay.qr }); }
  }, true);

  async function refresh() {
    if (typeof part === 'undefined' || !['/', '/recipe'].includes(part) || !csrf) return;
    if (busy) return;
    try { state = await api('/api/recipe'); fetchedAt = Date.now(); paint(); } catch (error) { message.textContent = error.message; }
  }
  setInterval(refresh, 1500); refresh();
  document.addEventListener('event-mode', () => { for (const name in drawn) drawn[name] = ''; refresh(); });
})();
