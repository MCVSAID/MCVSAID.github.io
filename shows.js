'use strict';
// What a camera is there to show: one control for the camera card's "What it shows" (app.js) and the Operate page's
// tiles (operate.js), so the two are the same setting. The model rates the camera by whether that performer (or role)
// is in its picture, solos on its instrument favour it, and the zoom looks for them. A page gives it:
//   ctx.direct(body)   a POST to /api/director, then a refresh
//   ctx.ask(dialog)    a question with fields (nav.js's concert.ask), answering the fields or null
//   ctx.tell(message)  a word for the person when something is refused
//   ctx.words()        the kind of event's words (role, roles, anyone, crowd, example…)
// It answers {element, summary, urgent}: the settings, the words the folded group shows, and a line that matters now
// (a lens changing or failed), or null.
(() => {
  function node(tag, text, className) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
  const capital = text => text.charAt(0).toUpperCase() + text.slice(1);
  const FOCUS = [['', 'the same as usual'], ['face_hands', 'the face and hands together'], ['hands', 'the hands'], ['face', 'the face'], ['chest', 'head and chest'], ['waist', 'head to waist'], ['person', 'the whole person']];

  function build(camera, director, ctx) {
    const words = ctx.words, box = node('div', '');
    const label = key => (director.instruments || []).find(i => i[0] === key)?.[1] || director.role_names?.[key] || (key.startsWith('custom:') ? key.slice(7) : key);
    if (camera.id === director.crowd_camera) {
      box.append(node('small', `This is the ${words().crowd} camera: it shows the ${words().crowd}, by its own rules.`));
      return { element: box, summary: `the ${words().crowd}`, urgent: null };
    }
    // Eight places, each a list of instruments (or, in another kind of event, roles). "Other" lets one be typed in.
    const shows = node('div', 'Shows'), given = director.camera_focus?.[camera.id] || [];
    const places = node('div', ''); places.className = 'instrument-places';
    const set = (place, value) => {
      const next = [...given]; if (value) next[Math.min(place, next.length)] = value; else next.splice(place, 1);
      ctx.direct({ camera_focus: { [camera.id]: [...new Set(next.filter(Boolean))] } });
    };
    for (let place = 0; place < 8; place++) {
      const pick = document.createElement('select'), here = given[place] || ''; pick.setAttribute('aria-label', `${capital(words().role)} ${place + 1}`);
      pick.disabled = place > given.length;                    // filled in order: the next empty place is the one to use
      const offered = (director.instruments || []).filter(i => i[0] === here || !given.includes(i[0]));
      if (here && !here.startsWith('custom:') && !offered.some(i => i[0] === here)) offered.push([here, label(here)]);     // given in another kind of event: kept
      const choices = [['', place === 0 && !given.length ? words().anyone : here ? 'remove' : '—'], ...offered];
      if (here.startsWith('custom:')) choices.push([here, label(here)]);
      choices.push(['other', 'other: type a name…']);
      for (const [value, text] of choices) { const option = node('option', text); option.value = value; option.selected = value === here; pick.append(option); }
      pick.onchange = async () => {
        if (pick.value !== 'other') { set(place, pick.value); return; }
        const got = await ctx.ask({ title: `Another ${words().role}`, fields: [{ name: 'name', label: `Name of the ${words().role} this camera shows (for example: ${words().example})` }], ok: 'Use it' });
        const typed = (got?.name || '').trim().replace(/\s+/g, ' ');
        if (!typed) { pick.value = here; return; }
        if (typed.length > 30 || !/^[\p{L}\p{N} '&/+.-]+$/u.test(typed) || !/\p{L}/u.test(typed)) {
          ctx.tell(`A name of ${words().role === 'instrument' ? 'an instrument' : 'a ' + words().role} is letters and digits, 30 characters at most.`); pick.value = here; return;
        }
        set(place, `custom:${typed}`);
      };
      places.append(pick);
    }
    shows.append(places);
    if (given.some(key => key.startsWith('custom:'))) shows.append(node('small', words().named ? words().named : director.event_mode?.music === false ? `A ${words().role} you named is looked for in the picture; give the camera its microphone to have it chosen when that person talks.` : 'An instrument you named is looked for in the picture, but cannot be listened for: solos are only heard for instruments on the list.'));
    const isWide = given.some(key => (director.wide_roles || ['band']).includes(key)) || given.length > 2;
    if (isWide) shows.append(node('small', 'A wide camera: shown whole, never zoomed in, and favoured when the whole group has the moment.'));
    const solo = node('label', 'During a solo, zoom in on '), soloPick = document.createElement('select'); soloPick.disabled = !director.zoom || !given.length || isWide;
    const chosen = director.camera_solo_focus?.[camera.id] ?? (director.solo_focus || '');
    for (const [value, text] of FOCUS) { const option = node('option', text); option.value = value; option.selected = chosen === value; soloPick.append(option); }
    soloPick.onchange = () => ctx.direct({ camera_solo_focus: { [camera.id]: soloPick.value } });
    solo.append(soloPick);
    shows.className = solo.className = 'card-setting';
    box.append(shows);
    if (director.event_mode?.music !== false) box.append(solo);           // no music, no solos
    if (director.talk && director.event_mode?.speaking) {
      // Its person's microphone on the mixer: the camera is chosen while they talk into it.
      const mic = node('label', 'Microphone on the mixer '), micPick = document.createElement('select'), own = director.talk.mics?.[camera.id] || '';
      for (const [value, text] of [['', 'none'], ...Array.from({ length: 16 }, (_, n) => [n + 1, `channel ${n + 1}`])]) { const option = node('option', text); option.value = value; option.selected = String(own) === String(value); micPick.append(option); }
      micPick.onchange = () => ctx.direct({ talk: { mics: { [camera.id]: micPick.value ? Number(micPick.value) : null } } });
      mic.append(micPick); mic.className = 'card-setting'; box.append(mic);
    }
    // Where a camera with this role is best put (a kitchen's: overhead for the board, low for the oven).
    for (const key of given) if (director.event_mode?.places?.[key]) shows.append(node('small', `${label(key)}: ${director.event_mode.places[key]}`));
    if (!given.length) box.append(node('small', words().give ? words().give : director.event_mode?.music === false ? `Give it a ${words().role} so the model knows whom it shows.` : director.event_mode?.mode && director.event_mode.mode !== 'concert' ? 'Give it a role or an instrument so the model knows whom it shows, and solos favour it.' : 'Give it an instrument to have solos on that instrument favour this camera.'));
    // Its telephoto, for tight shots: changed only while the camera is off air, and held out of the choosing until the new picture is in OBS.
    const lens = director.lenses?.[camera.id];
    if (lens?.telephoto) {
      const tele = node('label', ''), teleBox = document.createElement('input'); teleBox.type = 'checkbox'; teleBox.checked = lens.allowed; teleBox.disabled = !director.zoom || isWide;
      teleBox.onchange = () => ctx.direct({ camera_telephoto: { [camera.id]: teleBox.checked } });
      tele.append(teleBox, node('span', ` Use its ${lens.telephoto.replace(/ only$/, '')} lens for tight shots (changed only while off air)`));
      tele.className = 'card-setting'; box.append(tele);
    }
    let urgent = null;
    if (lens) {
      const said = lens.changing ? `changing to ${lens.changing.to} (${lens.changing.seconds} s): not chosen until its picture is in OBS` : lens.failed ? `the telephoto did not work: ${lens.failed}` : lens.by_director && lens.reason ? lens.reason : '';
      const tag = node('p', `Lens: ${lens.lens}${lens.by_director ? ', chosen by the director' : ''}${said ? ` · ${said}` : ''}`);
      tag.className = lens.failed ? 'app-version recording-warning' : 'app-version';
      // A lens that is changing or failed matters now; otherwise it is detail.
      if (lens.changing || lens.failed) urgent = tag; else box.append(tag);
    }
    return { element: box, summary: given.length ? given.map(label).join(', ') : words().anyone, urgent };
  }

  // For a page that redraws often (the Operate page): a fold, rebuilt only when what it shows changed and never while
  // one of its lists is being chosen from; open or shut as it was.
  function into(holder, camera, director, ctx) {
    const signature = JSON.stringify([director.camera_focus?.[camera.id], director.camera_solo_focus?.[camera.id], director.solo_focus, director.crowd_camera, director.zoom,
      director.lenses?.[camera.id], director.talk?.mics?.[camera.id], director.event_mode?.mode, (director.instruments || []).length]);
    if (holder.dataset.signature === signature || (holder.contains(document.activeElement) && document.activeElement.tagName === 'SELECT')) return;
    const open = holder.querySelector('details')?.open;
    holder.dataset.signature = signature;
    const made = build(camera, director, ctx), fold = node('details', undefined, 'what-it-shows');
    fold.addEventListener('change', event => { if (event.target.tagName === 'SELECT' && event.target.value !== 'other') event.target.blur(); }, true);
    fold.append(node('summary', `What it shows · ${made.summary}`), made.element);
    fold.open = !!open;
    holder.replaceChildren(fold, ...(made.urgent ? [made.urgent] : []));
  }

  window.whatItShows = { build, into };
})();
