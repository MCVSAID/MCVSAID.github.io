'use strict';
// The recipe being cooked (recipe.py) and what is laid over the programme (overlay.py), on the Show page in Cooking:
// load a recipe from its page or as text, check each step's caption and stations, move through the steps (or let the
// director), and put the recipe, its QR code and the step captions on screen. Uses app.js's api(), node(), editing(), part, csrf.
(() => {
  const panel = document.querySelector('#recipe');
  if (!panel) return;
  let state = null, said = '', busy = false, drawn = '';
  const body = node('div', ''), message = node('p', '');
  panel.append(node('h2', 'Recipe'), body, message);

  async function send(path, data, done) {
    busy = true; said = done === undefined ? 'Working…' : ''; paint();
    try { state = await api(path, { method: 'POST', body: JSON.stringify(data) }); said = done || ''; } catch (error) { said = error.message; }
    busy = false; drawn = ''; paint();
  }
  const go = where => send('/api/recipe/step', { go: where });
  const overlay = settings => send('/api/overlay', settings);
  const button = (text, act, title) => { const b = node('button', text); b.disabled = busy; if (title) b.title = title; b.onclick = act; return b; };
  const station = key => state.stations.find(s => s[0] === key)?.[1] || key;
  const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

  function loader() {
    // No recipe yet: from its page (most recipe sites publish it in a form that can be read), or pasted.
    const box = node('div', '');
    const address = document.createElement('input'); address.type = 'url'; address.placeholder = 'https://… the recipe’s page'; address.size = 44; address.setAttribute('aria-label', 'Recipe address');
    box.append(node('p', 'Load the recipe and the director follows it: each step’s stations are favoured until they have been shown, the steps are called out on screen, and the recipe and a QR code of its address can be put up beside the cook.'));
    const fromPage = node('p', ''); fromPage.append(address, button('Load from page', () => send('/api/recipe', { url: address.value.trim() }, 'Loaded. Check the steps below.')));
    const text = document.createElement('textarea'); text.rows = 8; text.cols = 60; text.setAttribute('aria-label', 'Recipe text');
    text.placeholder = 'Or paste it:\nBeef stew\nIngredients\n1 kg stewing beef\n2 onions\nMethod\n1. Dice the onions.\n2. Brown the beef in a heavy pot.\n3. Braise in the oven for two hours.';
    const pasted = node('p', ''); pasted.append(button('Load pasted recipe', () => send('/api/recipe', { text: text.value, url: address.value.trim() }, 'Loaded. Check the steps below.')),
      node('small', ' With a page address above as well, it is used for the QR code.'));
    box.append(fromPage, text, pasted);
    return box;
  }

  function editor(recipe) {
    // Each step's caption (what the screen says) and stations (what has to be seen while it is done), checked before the show.
    const details = document.createElement('details'); details.append(node('summary', `Steps, captions and stations (${recipe.steps.length})`));
    const table = document.createElement('table'); table.className = 'recipe-steps';
    const head = document.createElement('tr'); for (const h of ['#', 'Step', 'On screen', 'Stations to show']) head.append(node('th', h)); table.append(head);
    const rows = recipe.steps.map((step, index) => {
      const tr = document.createElement('tr');
      const caption = document.createElement('input'); caption.type = 'text'; caption.value = step.caption; caption.maxLength = 60; caption.size = 28; caption.setAttribute('aria-label', `Caption for step ${index + 1}`);
      const picks = [0, 1].map(n => {
        const pick = document.createElement('select'); pick.setAttribute('aria-label', `Station ${n + 1} for step ${index + 1}`);
        for (const [key, name] of [['', n ? '—' : 'any'], ...state.stations]) { const o = node('option', name); o.value = key; o.selected = (step.stations[n] || '') === key; pick.append(o); }
        return pick;
      });
      const cells = [node('td', String(index + 1)), node('td', step.text), node('td', ''), node('td', '')];
      cells[2].append(caption); cells[3].append(...picks); tr.append(...cells); table.append(tr);
      return { caption, picks };
    });
    const address = document.createElement('input'); address.type = 'url'; address.value = recipe.url || ''; address.size = 44; address.placeholder = 'https://… (for the QR code)'; address.setAttribute('aria-label', 'Recipe address');
    const save = button('Save steps', () => send('/api/recipe', { recipe: { ...recipe, url: address.value.trim(), steps: recipe.steps.map((step, index) => ({
      text: step.text, caption: rows[index].caption.value.trim() || step.caption, stations: [...new Set(rows[index].picks.map(p => p.value).filter(Boolean))] })) } }, 'Saved.'));
    const line = node('p', 'Recipe address '); line.append(address);
    const away = button('Put the recipe away', async () => { if (await concert.ask({ title: 'Put the recipe away?', fields: [], ok: 'Put it away', danger: true })) send('/api/recipe', { clear: true }, ''); });
    const actions = node('p', ''); actions.append(save, away);
    details.append(table, line, actions);
    return details;
  }

  function progress(p, recipe) {
    const box = node('div', '');
    const now = p.current ? `Step ${p.current} of ${p.count}: ${p.step.caption}${p.seconds != null ? ` · ${clock(p.seconds)}` : ''}` : `Not begun · ${p.count} steps`;
    const line = node('p', ''); line.append(node('strong', `${recipe.title} · `), node('span', now)); box.append(line);
    if (p.step) box.append(node('small', p.step.text));
    const steps = node('p', '');
    steps.append(button('Back', () => go('back'), 'The step before'), button(p.next ? `Next: ${p.next.caption}` : 'Last step', () => go('next'), 'Shortcut: S'));
    steps.querySelector('button:last-child').id = 'recipe-next'; if (!p.next) steps.querySelector('button:last-child').disabled = true;
    const follow = document.createElement('select'); follow.setAttribute('aria-label', 'Who moves through the steps');
    for (const [v, t] of [['auto', 'The director moves on when it sees the next step (you can too)'], ['manual', 'Only you move through the steps']]) { const o = node('option', t); o.value = v; o.selected = p.follow === v; follow.append(o); }
    follow.onchange = () => overlay({ follow: follow.value });
    steps.append(follow); box.append(steps);
    const owed = Object.keys(p.needs || {});
    if (p.step) box.append(node('small', p.step.stations.length ? (owed.length ? `Still to show for this step: ${owed.map(station).join(', ')}.` : `This step’s ${p.step.stations.map(station).join(' and ')} ${p.step.stations.length > 1 ? 'have' : 'has'} been shown.`) : 'This step has no station of its own: whatever the model rates best.'));
    if (p.missed?.length) { const warn = node('p', `Not shown long enough: step ${p.missed.join(', ')}. The cut log says what each step got.`); warn.className = 'recording-warning'; box.append(warn); }
    return box;
  }

  function screen(o, recipe) {
    // At the touch of a button: the recipe and the QR code on screen, beside the cook.
    const box = node('div', ''); box.append(node('h3', 'On screen'));
    const row = node('p', '');
    const toggle = (name, on, onText, offText, key) => { const b = button(on ? offText : onText, () => overlay({ [name]: !on }), `Shortcut: ${key}`); if (on) b.className = 'active'; return b; };
    row.append(toggle('recipe', o.recipe, 'Show recipe', 'Hide recipe', 'R'));
    const qr = toggle('qr', o.qr, 'Show QR code', 'Hide QR code', 'Q'); qr.disabled = busy || !recipe.url; if (!recipe.url) qr.title = 'Give the recipe’s address (Steps, captions and stations) to show its QR code'; row.append(qr);
    row.id = 'overlay-buttons'; box.append(row);
    const captions = node('label', ''), tick = document.createElement('input'); tick.type = 'checkbox'; tick.checked = o.captions; tick.onchange = () => overlay({ captions: tick.checked });
    captions.append(tick, node('span', ' Call out each step on screen as it begins, and “continued” when the programme comes back to it')); box.append(captions);
    const shown = o.showing || {};
    box.append(node('p', `The recipe goes on the side away from the cook: ${shown.on ? `the ${shown.side} now` : 'right, until the cook has been found'}.`));
    const obs = node('p', '');
    if (!o.obs) obs.append(button('Add the overlay to OBS', () => overlay({ obs: true }), 'Puts a browser source on top in every programme scene'), node('small', ' Needed once: OBS shows the overlay in every programme scene.'));
    else {
      obs.append(node('span', o.problem ? `OBS: ${o.problem} ` : `In OBS: on top in ${o.scenes} scene${o.scenes === 1 ? '' : 's'}. `), button('Take it out of the programme', () => overlay({ obs: false })));
      if (o.problem) obs.className = 'recording-warning';
    }
    box.append(obs);
    if (o.page) { const look = document.createElement('a'); look.href = o.page; look.target = '_blank'; look.rel = 'noopener'; look.textContent = 'Preview the overlay in a new tab'; box.append(look); }
    return box;
  }

  function paint() {
    if (!state) return;
    panel.hidden = !state.cooking;
    if (!state.cooking) return;
    const key = JSON.stringify([state.recipe, state.progress && { ...state.progress, seconds: null, caption: null }, state.overlay && { ...state.overlay, showing: state.overlay.showing?.side }, busy]);
    if (key !== drawn && !editing(panel)) {
      drawn = key;
      const open = panel.querySelector('details')?.open;
      body.replaceChildren();
      if (!state.recipe) body.append(loader());
      else {
        body.append(progress(state.progress, state.recipe), screen(state.overlay, state.recipe), editor(state.recipe));
        if (open) body.querySelector('details').open = true;
      }
    }
    message.textContent = said; message.className = said && !/^(Working…|Loaded|Saved)/.test(said) ? 'recording-warning' : '';
  }

  // S: next step; R: the recipe on screen or off; Q: the QR code. Not while typing.
  document.addEventListener('keydown', event => {
    if (!state?.recipe || !state.cooking || panel.hidden || event.metaKey || event.ctrlKey || event.altKey || event.repeat || event.target.closest?.('input, textarea, select, [contenteditable], dialog')) return;
    const which = event.key.toLowerCase();
    if (which === 's' && document.querySelector('#recipe-next:not([disabled])')) { event.preventDefault(); event.stopImmediatePropagation(); go('next'); }
    else if (which === 'r') { event.preventDefault(); overlay({ recipe: !state.overlay.recipe }); }
    else if (which === 'q' && state.recipe.url) { event.preventDefault(); overlay({ qr: !state.overlay.qr }); }
  }, true);

  async function refresh() {
    if (typeof part === 'undefined' || part !== '/' || !csrf) { panel.hidden = true; return; }
    if (busy) return;
    try { state = await api('/api/recipe'); paint(); } catch (error) { message.textContent = error.message; }
  }
  setInterval(refresh, 1500); refresh();
})();
