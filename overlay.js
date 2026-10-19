// The overlay page in OBS (overlay.py): asks the manager twice a second what to show, and shows it: the recipe, its QR
// code, the step captions, and for a few seconds a step popped up or an ingredient's line as a lower third.
const key = new URLSearchParams(location.search).get('key') || '';
const $ = id => document.getElementById(id);
let shown = { side: null, recipeKey: null, current: null, address: null, caption: null, popup: null, lower: null };

function fade(element, show, then) {
  // Shown or hidden with a fade; `then` runs while it is invisible (to change side or content without a jump).
  if (show && element.hidden) { if (then) then(); element.classList.add('fading'); element.hidden = false; requestAnimationFrame(() => requestAnimationFrame(() => element.classList.remove('fading'))); return; }
  if (!show && !element.hidden) { element.classList.add('fading'); setTimeout(() => { element.hidden = true; element.classList.remove('fading'); }, 450); return; }
  if (show && then) { element.classList.add('fading'); setTimeout(() => { then(); element.classList.remove('fading'); }, 450); }
}

function fit(card) {
  // The whole recipe in its panel: the type made smaller until it fits (down to a size still readable on a phone).
  let size = 1.05;
  card.style.fontSize = `${size}vw`;
  while (card.scrollHeight > card.clientHeight + 1 && size > 0.62) { size -= 0.04; card.style.fontSize = `${size}vw`; }
  // Still too long: the current step kept in view.
  const now = card.querySelector('li.current');
  if (now && card.scrollHeight > card.clientHeight + 1) card.scrollTop = Math.max(0, now.offsetTop - card.clientHeight / 3);
}

function fill(state) {
  $('title').textContent = state.title;
  const ingredients = state.recipe.ingredients || [];
  $('ingredients-part').hidden = !ingredients.length;
  $('ingredients').replaceChildren(...ingredients.map(text => Object.assign(document.createElement('li'), { textContent: text })));
  const prep = state.recipe.prep || [];
  $('prep-part').hidden = !prep.length;
  $('prep').replaceChildren(...prep.map(text => Object.assign(document.createElement('li'), { textContent: text })));
  $('steps').replaceChildren(...state.recipe.steps.map(text => Object.assign(document.createElement('li'), { textContent: text })));
}

function mark(state) {
  // The step being cooked picked out; those done or skipped faded.
  const done = state.done || { prep: [], method: [] };
  for (const [list, current, finished] of [[$('prep'), state.current_prep, done.prep], [$('steps'), state.current, done.method]]) {
    [...list.children].forEach((li, index) => {
      li.classList.toggle('current', current === index + 1);
      li.classList.toggle('done', finished.includes(index + 1));
    });
  }
}

function show(state) {
  const card = $('card'), qr = $('qr'), caption = $('caption'), popup = $('popup'), lower = $('lower');
  if (!state.on) { for (const element of [card, qr, caption, popup, lower]) fade(element, false); shown.popup = shown.lower = null; return; }
  const sideChanged = shown.side !== null && shown.side !== state.side;
  const place = () => { document.body.classList.toggle('side-left', state.side === 'left'); document.body.classList.toggle('side-right', state.side !== 'left'); };
  if (shown.side === null) place();
  document.body.classList.toggle('no-qr', !state.qr);
  // The recipe.
  // The recipe, giving way to a step popped up where it goes.
  const recipeKey = state.recipe ? JSON.stringify([state.title, state.recipe]) : null;
  const where = JSON.stringify([state.current_prep, state.current, state.done]);
  if (state.recipe && !state.popup) {
    const refill = recipeKey !== shown.recipeKey;
    fade(card, true, sideChanged || refill || card.hidden ? () => { place(); if (refill) fill(state); mark(state); fit(card); } : null);
    if (!refill && shown.current !== where) { mark(state); fit(card); }
  } else fade(card, false);
  // A step popped up: "Step 2 of 5", its caption, its words.
  const popped = state.popup ? `${state.popup.at}|${state.popup.label}` : null;
  if (popped !== shown.popup) {
    if (state.popup) fade(popup, true, () => { place(); $('popup-label').textContent = `${state.popup.label} of ${state.popup.of}${state.popup.section === 'prep' ? ' · Preparation' : ''}`;
      $('popup-caption').textContent = state.popup.caption; $('popup-text').textContent = state.popup.text; });
    else fade(popup, false);
  } else if (state.popup && sideChanged) fade(popup, true, place);
  // An ingredient's line, as a lower third on the cook's side.
  const named = state.lower ? `${state.lower.at}|${state.lower.text}` : null;
  if (named !== shown.lower) {
    if (state.lower) fade(lower, true, () => { lower.textContent = state.lower.text; });
    else fade(lower, false);
  }
  document.body.classList.toggle('lower-up', !!state.lower);
  // The QR code of the recipe's address.
  if (state.qr) {
    const changed = state.address !== shown.address;
    fade(qr, true, changed || sideChanged ? () => { place(); if (changed) { $('qr-image').src = `/overlay/qr.svg?key=${encodeURIComponent(key)}&v=${encodeURIComponent(state.address)}`; $('address').textContent = state.address; } } : null);
  } else fade(qr, false);
  if (sideChanged && !state.recipe && !state.qr) place();
  // The step's caption.
  const said = state.caption ? `${state.caption.at}|${state.caption.text}` : null;
  if (said !== shown.caption) {
    if (state.caption) fade(caption, true, () => { caption.textContent = state.caption.text; caption.classList.toggle('continued', state.caption.kind === 'continued'); });
    else fade(caption, false);
  }
  shown = { side: state.side, recipeKey, current: where, address: state.address, caption: said, popup: popped, lower: named };
}

async function poll() {
  try {
    const response = await fetch(`/api/overlay/state?key=${encodeURIComponent(key)}`, { cache: 'no-store' });
    if (response.ok) show(await response.json());
    else show({ on: false });
  } catch (error) { /* the manager restarting: keep what is shown, try again */ }
  setTimeout(poll, 500);
}
poll();
