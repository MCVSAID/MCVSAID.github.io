'use strict';
// Shared by every page of the dashboard: the way between the pages, and picking up a login made on another page, so
// that the password is asked for once and not again on each page.
window.concert = {
  // Where things are, by what they are for: what is watched while live, what is set up for a show, the recordings (the
  // files and how they are made), and the administration. Each is [path, name, what it is for, who may see it, group, icon].
  pages: [['/', 'Show', 'Readiness, what is on air, recording the programme', null, 'Show', 'show'],
          ['/recipe', 'Recipe', 'The recipe being cooked: its preparation and steps, what is on screen, spoken cues', null, 'Show', 'recipe'],
          ['/cameras', 'Cameras', 'Each phone: its state, its controls, what it shows', null, 'Show', 'camera'],
          ['/stage', 'Stage Shots', 'Choose shots from a picture of the stage', null, 'Show', 'stage'],
          ['/operate', 'Operate', 'Chosen cameras live, steered with an Xbox controller: aim, zoom, cut', null, 'Show', 'gamepad'],
          ['/temperatures', 'Temperatures', 'Heat now and run by run', null, 'Show', 'heat'],
          ['/director', 'Director', 'How shots are chosen, timing', null, 'Set up', 'director'],
          ['/colour', 'Colour', 'White balance, exposure, chart calibration and LUTs', 'admin', 'Set up', 'colour'],
          ['/people', 'People', 'People on stage recognised with their consent (performers, speakers): stars, who each camera follows (Plus AI)', 'admin', 'Set up', 'people'],
          ['/offload', 'Recordings', 'On the phones and on this PC: the files, and how they are made', null, 'Library', 'recordings'],
          ['/system', 'System', 'Cameras and devices, network, logins, locations, this PC', 'admin', 'Administration', 'system']],
  // On a phone, these are along the bottom; the rest are under More.
  handy: ['/', '/cameras', '/stage', '/director'],
  handyIn: { cooking: ['/', '/recipe', '/cameras', '/stage'] },     // in Cooking, the recipe is followed during the show
  // Pages that sit under one of the above, which is shown as the current one while they are open.
  under: { '/recordings': '/offload', '/phones': '/system', '/locations': '/system' },
  // Pages only for one kind of event (modes.py): shown in the side bar only while it is the one in use.
  onlyIn: { '/recipe': 'cooking' },
  inPlace: ['/', '/recipe', '/cameras', '/colour', '/director', '/recordings', '/system', '/locations'],   // parts of the one main page: switched without loading anything
  // The tabs within Recordings, the same on its two pages, and System's sections: under their page in the side bar.
  recordingTabs: [['/offload', 'Local recordings (phones)'], ['/recordings', 'PC recordings']],
  systemTabs: [['/system#devices', 'Cameras & devices'], ['/system#updates', 'Updates'], ['/system#network', 'Network'], ['/system#logins', 'Logins'], ['/system#locations', 'Locations & backups'], ['/system#pc', 'This PC']],
  subCurrent: null,          // the section open within its page, as one of the addresses above
  latest: null, fedAt: 0,    // the last /api/cameras answer, for the status line and the counts beside the pages
  session: null,

  /** Asks for one or more values in a dialog over the page, and answers {name: value}, or null if cancelled.
   * In place of window.prompt, which some browsers (those built into apps among them) do not show at all, so that a
   * button asking for something seemed to do nothing; and which shows a passphrase in plain text as it is typed.
   * fields: [{name, label, type ('text' | 'password'), value, minLength}]; ok: the button's words; danger: a red button. */
  ask({ title, text = '', fields, ok = 'OK', danger = false, cancel = 'Cancel' }) {
    return new Promise(resolve => {
      const dialog = document.createElement('dialog'); dialog.className = 'ask';
      const form = document.createElement('form'); form.method = 'dialog';
      const heading = document.createElement('h3'); heading.textContent = title; form.append(heading);
      if (text) { const said = document.createElement('p'); said.textContent = text; form.append(said); }
      const inputs = {};
      for (const field of fields) {
        const label = document.createElement('label'); label.textContent = field.label;
        const input = document.createElement('input'); input.type = field.type || 'text'; input.value = field.value || ''; input.required = true;
        input.autocomplete = field.type === 'password' ? 'new-password' : 'off'; input.spellcheck = false;
        if (field.minLength) input.minLength = field.minLength;
        label.append(input); form.append(label); inputs[field.name] = input;
      }
      const row = document.createElement('p');
      const no = document.createElement('button'); no.type = 'button'; no.textContent = cancel; no.onclick = () => dialog.close('cancel');
      const go = document.createElement('button'); go.type = 'submit'; go.value = 'ok'; go.textContent = ok; if (danger) go.className = 'danger';
      if (cancel) row.append(no); row.append(go); form.append(row); dialog.append(form); document.body.append(dialog);
      dialog.addEventListener('close', () => {
        const answer = dialog.returnValue === 'ok' ? Object.fromEntries(Object.entries(inputs).map(([name, input]) => [name, input.value])) : null;
        dialog.remove(); resolve(answer);
      });
      dialog.showModal();
      (Object.values(inputs)[0] || go).focus();
    });
  },

  /** Asks yes or no in a dialog over the page: true for OK. In place of window.confirm, which browsers can stop showing
   * (Firefox's "don't allow this site to prompt you again", and those built into apps) and then answer "Cancel" by
   * themselves, so that Stop SRT seemed to do nothing (2026-10-17). The first line is the heading, the rest the text. */
  async sure(question, { ok = 'OK', danger = false } = {}) {
    const [title, ...rest] = String(question).split('\n');
    return (await this.ask({ title, text: rest.join('\n').trim(), fields: [], ok, danger })) !== null;
  },

  /** Says something in a dialog over the page, with only OK: in place of window.alert, for the same reason. */
  async tell(message) {
    const [title, ...rest] = String(message).split('\n');
    await this.ask({ title, text: rest.join('\n').trim(), fields: [], cancel: null });
  },

  /** A login already made in this browser, on any page: {csrf, role, away}, or null when there is none. */
  async resume() {
    try { const response = await fetch('/api/session'); this.session = response.ok ? await response.json() : null; } catch (error) { this.session = null; }
    return this.session;
  },

  /** Draws the side bar: the pages in their groups, each page's sections under it, the show's status at its foot; on a
   * phone, the four pages used during a show along the bottom. `pick` is called instead of loading, for the parts of
   * the main page. */
  nav(role, pick) {
    this.role = role; this.pick = pick;
    let bar = document.querySelector('#pages');
    if (!bar) {
      bar = document.createElement('nav'); bar.id = 'pages'; bar.setAttribute('aria-label', 'Pages'); document.body.prepend(bar);
      document.body.classList.add('has-sidebar');
      document.addEventListener('keydown', event => { if (event.key === 'Escape' && (document.body.classList.contains('menu-open') || document.body.classList.contains('rail-open'))) { const back = document.body.classList.contains('menu-open') ? '#menu-button' : '#widen'; this.menu(false); document.querySelector(back)?.focus(); } });
      setInterval(() => this.poll(), 3000);
    }
    bar.replaceChildren();
    const here = location.pathname.replace(/\/+$/, '') || '/', current = this.under[here] || here;
    const handy = this.handyIn[this.mode?.mode] || this.handy;
    const visible = this.pages.filter(([path, , , who]) => (who !== 'admin' || role === 'admin') && (!this.onlyIn[path] || this.onlyIn[path] === this.mode?.mode));
    const go = (link, path) => {
      if (!(pick && this.inPlace.includes(path.split('#')[0]))) return;
      link.onclick = event => { if (event.metaKey || event.ctrlKey || event.shiftKey) return; event.preventDefault(); this.menu(false); history.pushState(null, '', path); pick(path.split('#')[0]); this.nav(role, pick); };
    };
    // Its name, and a way to open it out on a tablet, where it is a strip of icons.
    const top = document.createElement('div'); top.className = 'brand';
    const name = document.createElement('a'); name.href = '/'; name.title = 'MultiCam Video Stream AI Director'; name.innerHTML = `${this.icon('logo')}<span>MCVSAID</span>`; go(name, '/');
    const widen = document.createElement('button'); widen.type = 'button'; widen.id = 'widen'; widen.innerHTML = this.icon('menu');
    const wide = document.body.classList.contains('rail-open'); widen.setAttribute('aria-label', wide ? 'Narrow the side bar' : 'Widen the side bar'); widen.setAttribute('aria-expanded', String(wide));
    widen.onclick = () => { document.body.classList.toggle('rail-open'); this.nav(role, pick); document.querySelector('#widen')?.focus(); };
    top.append(name, widen); bar.append(top);
    // Under the name: the kind of event being directed, on every page. The administrator's to change.
    const kind = document.createElement('div'); kind.id = 'event-mode'; bar.append(kind); this.drawMode();
    if (!this.mode) this.loadMode();
    const list = document.createElement('div'); list.className = 'groups'; bar.append(list);
    let group = null, section = null;
    for (const [path, title, about, , heading, icon] of visible) {
      if (heading !== group) { group = heading; section = document.createElement('div'); section.className = 'group'; section.setAttribute('role', 'group'); section.setAttribute('aria-label', heading);
        const label = document.createElement('p'); label.className = 'group-name'; label.textContent = heading; section.append(label); list.append(section); }
      const link = document.createElement('a'); link.href = path; link.title = about; link.dataset.page = path;
      link.innerHTML = `${this.icon(icon)}<span class="label"></span><span class="badge" hidden></span>`; link.querySelector('.label').textContent = title;
      if (path === current) link.setAttribute('aria-current', 'page');
      go(link, path); section.append(link);
      // The sections of the page that is open, under it.
      const subs = path === '/system' ? this.systemTabs : path === '/offload' ? this.recordingTabs : null;
      if (subs && path === current) {
        const inner = document.createElement('div'); inner.className = 'sub';
        const open = here === '/phones' ? '/system#devices' : this.subCurrent || (here === '/system' ? `/system${location.hash || '#devices'}` : here);
        for (const [href, text] of subs) {
          const item = document.createElement('a'); item.href = href; item.textContent = text;
          if (href === open) item.setAttribute('aria-current', 'location');
          go(item, href); inner.append(item);
        }
        section.append(inner);
      }
    }
    const foot = document.createElement('div'); foot.className = 'foot';
    const status = document.createElement('div'); status.id = 'live'; status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-label', 'The show now');
    const version = document.createElement('p'); version.id = 'version';
    const out = document.createElement('button'); out.type = 'button'; out.id = 'logout'; out.innerHTML = `${this.icon('logout')}<span class="label">Log out</span>`;
    out.onclick = async () => { try { await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': this.session?.csrf || '' } }); } catch (error) { /* gone either way */ } location.reload(); };
    foot.append(status, version, out); bar.append(foot);
    // A phone: the pages used during a show along the bottom, and More for the whole list.
    let bottom = document.querySelector('#bottom-bar');
    if (!bottom) { bottom = document.createElement('nav'); bottom.id = 'bottom-bar'; bottom.setAttribute('aria-label', 'Pages used during a show'); document.body.append(bottom); }
    bottom.replaceChildren();
    for (const [path, title, , , , icon] of visible.filter(([path]) => handy.includes(path))) {
      const link = document.createElement('a'); link.href = path; link.dataset.page = path; link.innerHTML = `${this.icon(icon)}<span class="label"></span><span class="badge" hidden></span>`; link.querySelector('.label').textContent = title;
      if (path === current) link.setAttribute('aria-current', 'page');
      go(link, path); bottom.append(link);
    }
    const more = document.createElement('button'); more.type = 'button'; more.id = 'menu-button'; more.setAttribute('aria-controls', 'pages');
    more.innerHTML = `${this.icon('menu')}<span class="label">More</span>`; more.setAttribute('aria-expanded', String(document.body.classList.contains('menu-open')));
    if (!handy.includes(current)) more.setAttribute('aria-current', 'page');
    more.onclick = () => this.menu(!document.body.classList.contains('menu-open'));
    bottom.append(more);
    // Where the side bar is a strip or hidden, the show's state rides along the top of the page instead.
    if (!document.querySelector('#live-top')) { const strip = document.createElement('div'); strip.id = 'live-top'; strip.setAttribute('aria-hidden', 'true'); document.querySelector('header')?.before(strip); }
    let shade = document.querySelector('#shade'); if (!shade) { shade = document.createElement('div'); shade.id = 'shade'; shade.onclick = () => this.menu(false); document.body.append(shade); }
    this.messages(); this.show();
  },

  /** The kind of event being directed (/api/event-mode): live music unless the administrator has chosen another. */
  mode: null,
  async loadMode() {
    try { const response = await fetch('/api/event-mode'); if (response.ok) this.takeMode(await response.json()); } catch (error) { /* shown when /api/cameras next answers */ }
  },
  /** A mode report from the manager: kept, drawn, and told to the page (an 'event-mode' event) when it is a change. */
  takeMode(report) {
    if (!report) return;
    const changed = this.mode?.mode !== report.mode;
    if (!changed && JSON.stringify(report) === JSON.stringify(this.mode)) return;      // not redrawn, so a list being chosen from stays open
    this.mode = report; this.drawMode();
    if (changed) {
      if (this.role && document.querySelector('#pages')) this.nav(this.role, this.pick);     // a page for this kind of event shown, or put away
      document.dispatchEvent(new CustomEvent('event-mode', { detail: report }));
    }
  },
  /** Under the name in the side bar: a list to choose from for the administrator, the mode's name for an operator. In
   * the narrow rail a small button with the mode's short name, which widens the bar to show the rest. */
  drawMode() {
    const box = document.querySelector('#event-mode'); if (!box) return;
    const report = this.mode; box.replaceChildren(); box.className = 'event-mode';
    if (!report) return;
    const label = document.createElement('label'); label.htmlFor = 'event-mode-pick'; label.textContent = 'Event';
    const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'mode-chip'; chip.title = `${report.name}: ${report.about}`;
    chip.setAttribute('aria-label', `Event: ${report.name}${this.role === 'admin' ? '. Widen the side bar to change it' : ''}`);
    chip.innerHTML = `${this.icon(`mode-${report.mode}`)}<span></span>`; chip.querySelector('span').textContent = report.short;
    chip.onclick = () => { document.body.classList.add('rail-open'); this.nav(this.role, this.pick); document.querySelector('#event-mode-pick, #event-mode .mode-now')?.focus(); };
    if (this.role === 'admin') {
      const pick = document.createElement('select'); pick.id = 'event-mode-pick'; pick.title = report.about;
      for (const each of report.modes) { const option = document.createElement('option'); option.value = each.id; option.textContent = each.name; option.title = each.about; option.selected = each.id === report.mode; pick.append(option); }
      pick.onchange = async () => {
        const wanted = pick.value; pick.disabled = true;
        try {
          const response = await fetch('/api/event-mode', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': this.session?.csrf || '' }, body: JSON.stringify({ mode: wanted }) });
          if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || `The manager answered ${response.status}`);
          this.takeMode(await response.json());
        } catch (error) { pick.value = report.mode; const said = document.querySelector('#result'); if (said) said.textContent = `The event could not be changed: ${error.message}`; }
        finally { pick.disabled = false; }
      };
      const row = document.createElement('div'); row.className = 'mode-row'; row.append(pick);
      box.append(label, row, chip);
    } else {
      // An operator sees what is in use; changing it is the administrator's.
      const now = document.createElement('p'); now.className = 'mode-now'; now.tabIndex = -1; now.title = `${report.about} Chosen by the administrator.`;
      now.innerHTML = `${this.icon(`mode-${report.mode}`)}<span></span>`; now.querySelector('span').textContent = report.name;
      label.removeAttribute('for'); box.append(label, now, chip);
    }
  },

  /** Opens or shuts the whole list of pages over a phone's screen. */
  menu(open) {
    document.body.classList.toggle('menu-open', open);
    if (!open && document.body.classList.contains('rail-open')) { document.body.classList.remove('rail-open'); const widen = document.querySelector('#widen'); widen?.setAttribute('aria-expanded', 'false'); widen?.setAttribute('aria-label', 'Widen the side bar'); }
    document.querySelector('#menu-button')?.setAttribute('aria-expanded', String(open));
    if (open) document.querySelector('#pages a[aria-current=page]')?.focus({ preventScroll: true });
  },

  /** Takes a fresh /api/cameras answer from the page that asked for it; pages that do not ask are looked after by poll(). */
  feed(data) { this.latest = data; this.fedAt = Date.now(); this.show(); },
  async poll() {
    if (!this.session || Date.now() - this.fedAt < 4000) return;
    try { const response = await fetch('/api/cameras'); if (response.ok) this.feed(await response.json()); } catch (error) { /* said by the page itself */ }
  },

  /** How to name what OBS has in its programme: "On air" only while OBS streams or records it, "Programme" when nothing
   * goes out; and "(no picture)" when a camera in it is not streaming or shows nothing in OBS (not in director.usable).
   * OBS keeps its last scene when the cameras stop, and the director never cuts to a camera without a picture, so the
   * programme can name a camera that sends nothing: "On air: S20FE" then read as wrong (2026-10-17). */
  programme(director) {
    const out = !!(director.recording || director.streaming);
    const members = director.pair || (director.on_air ? [director.on_air] : []);
    const blank = members.length > 0 && members.some(id => !(director.usable || []).includes(id));
    return { word: out ? 'On air' : 'Programme', blank, suffix: blank ? ' (no picture)' : '', kind: blank ? 'warn' : out ? 'air' : 'off' };
  },

  /** The show in one line at the foot of the side bar (along the top on a phone), and a count or a dot beside the pages
   * where something wants a look. */
  show() {
    const data = this.latest, live = document.querySelector('#live'); if (!data || !live) return;
    if (data.event_mode) this.takeMode(data.event_mode);
    const cameras = data.cameras || [], director = data.director || {}, ready = data.ready;
    const named = id => cameras.find(c => c.id === id)?.name || id;
    const clock = seconds => { const s = Math.max(0, Math.floor(seconds)); return `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ''}${String(Math.floor(s / 60) % 60).padStart(Math.floor(s / 3600) ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`; };
    const item = (text, kind, title) => { const span = document.createElement('span'); span.className = `pill ${kind}`; span.textContent = text; if (title) span.title = title; return span; };
    const onAir = director.problem ? null : director.pair ? director.pair.map(named).join(' + ') : director.on_air ? named(director.on_air) : director.scene || null;
    const state = ready ? { ok: ['Ready', 'ok'], warn: ['Check', 'warn'], fail: ['Not ready', 'fail'] }[ready.state] : null;
    const pills = () => [
      state && item(state[0], state[1], ready.state === 'ok' ? 'Ready for a show' : [...(ready.stopping || []), ...(ready.worth_checking || [])].join('\n')),
      onAir ? (said => item(`${said.word}: ${onAir}${said.suffix}`, said.kind, said.blank ? 'This camera is not sending a picture: the programme shows nothing until another camera is put on' : said.word === 'Programme' ? 'What OBS shows; it is neither streaming nor recording' : 'What OBS is streaming or recording'))(this.programme(director)) : item('Nothing on air', 'off'),
      director.recording && item(`REC ${clock(director.recording.seconds)}`, 'rec', 'The programme is being recorded'),
      // Whoever is logged in, on every page: performers are being recognised (docs/PRIVACY_PERFORMER_LIBRARY.md).
      data.people_recognition && item('Performer recognition: ON', 'people', 'Consenting performers are being recognised for the show. Nobody else is identified.'),
      director.streaming && item(`LIVE ${clock(director.streaming.seconds)}`, director.streaming.reconnecting ? 'warn' : 'rec', 'OBS is streaming out'),
    ].filter(Boolean);
    live.replaceChildren(...pills());
    // Along the top of a phone's page, where the side bar is out of sight, the kind of event rides with the show's state.
    const kind = this.mode && item(this.mode.short, 'mode', `Event: ${this.mode.name}`);
    document.querySelector('#live-top')?.replaceChildren(...[kind, ...pills()].filter(Boolean));
    const version = document.querySelector('#version'); if (version && data.manager_version) version.textContent = `Manager ${data.manager_version}`;
    // Beside the pages.
    const online = cameras.filter(c => c.online).length, hot = cameras.filter(c => ['hot', 'critical'].includes(c.thermal?.level));
    const badges = {
      '/': state && ready.state !== 'ok' ? ['', state[1], state[0]] : null,
      '/cameras': cameras.length ? [`${online}/${cameras.length}`, online < cameras.length ? 'warn' : 'ok', `${online} of ${cameras.length} cameras online`] : null,
      '/recipe': director.recipe?.current ? [`${director.recipe.current}/${director.recipe.count}`, 'ok', `${director.recipe.step?.label || 'Step'} of ${director.recipe.title}`] : null,
      '/director': director.problem ? ['', 'fail', `Programme control is not working: ${director.problem}`] : null,
      '/offload': director.recording ? ['REC', 'rec', 'The programme is being recorded'] : null,
      '/temperatures': hot.length ? ['', hot.some(c => c.thermal.level === 'critical') ? 'fail' : 'warn', `Hot: ${hot.map(c => c.name).join(', ')}`] : null,
    };
    for (const link of document.querySelectorAll('#pages a[data-page], #bottom-bar a[data-page]')) {
      const badge = link.querySelector('.badge'), said = badges[link.dataset.page];
      badge.hidden = !said; if (!said) continue;
      badge.textContent = said[0]; badge.className = `badge ${said[1]}${said[0] ? '' : ' dot'}`; badge.title = said[2];
      badge.setAttribute('aria-label', said[2]);
    }
  },

  /** A small line drawing for a page, in the text's colour. */
  icon(name) {
    const paths = {
      logo: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3"/><circle cx="9" cy="12" r="2.5"/>',
      recipe: '<path d="M6 3h10l3 3v15H6z"/><path d="M16 3v3h3"/><path d="M9 10h7M9 14h7M9 18h4"/>',
      show: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M10 8.5v5l4-2.5z" fill="currentColor"/>',
      camera: '<path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="4"/>',
      gamepad: '<path d="M6 9h12a4 4 0 0 1 3.9 4.8l-.8 3.6a2 2 0 0 1-3.4.9L15.5 16h-7l-2.2 2.3a2 2 0 0 1-3.4-.9l-.8-3.6A4 4 0 0 1 6 9z"/><path d="M8 11.5v3M6.5 13h3"/><circle cx="16" cy="12" r=".8"/><circle cx="17.6" cy="14" r=".8"/>',
      stage: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
      director: '<path d="M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 9l2-5 15 3-1 2"/><path d="M9 5.2l-1 3.8M14 6.2l-1 2.8"/>',
      colour: '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5 1-1.5 2-1.5h2a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="10" cy="7" r="1.2" fill="currentColor"/><circle cx="15" cy="7" r="1.2" fill="currentColor"/>',
      recordings: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13.5" r="2.5" fill="currentColor"/>',
      heat: '<path d="M10 4a2 2 0 0 1 4 0v10.5a4 4 0 1 1-4 0z"/><path d="M12 9v7"/>',
      people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.6 2.7-6 6-6s6 2.4 6 6"/><path d="M16 4.5a3 3 0 0 1 0 6M18 14.4c1.9.8 3 2.8 3 5.6"/>',
      system: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
      menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
      // The kinds of event: a note, a church, a microphone, a panel at a table, a stage's curtain, a pot on the heat.
      'mode-concert': '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
      'mode-worship': '<path d="M12 2v5M9.5 4.5h5"/><path d="M5 21V11l7-4 7 4v10z"/><path d="M10 21v-4a2 2 0 0 1 4 0v4"/>',
      'mode-podcast': '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
      'mode-panel': '<circle cx="6" cy="7" r="2.2"/><circle cx="12" cy="6" r="2.2"/><circle cx="18" cy="7" r="2.2"/><path d="M2 13h20M4 13v8M20 13v8M3.5 13c0-2 1-3 2.5-3s2.5 1 2.5 3M9.5 12c0-2 1-3 2.5-3s2.5 1 2.5 3M15.5 13c0-2 1-3 2.5-3s2.5 1 2.5 3"/>',
      'mode-theatre': '<path d="M3 3h18v3H3z"/><path d="M4 6c0 6 2 10 6 13M20 6c0 6-2 10-6 13"/><path d="M3 21h18"/>',
      'mode-cooking': '<path d="M4 11h16v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z"/><path d="M2 11h2M20 11h2"/><path d="M9 4c-1 1 1 2 0 4M13 4c-1 1 1 2 0 4"/>',
      logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/>',
    };
    return `<svg class="icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name] || ''}</svg>`;
  },

  /** A row of tabs within a page: [[href, name]], the one at `current` marked. `pick`, when given, is called instead of
   * following the link, for tabs within the one main page. */
  tabs(container, items, current, pick) {
    container.replaceChildren(); container.classList.add('tabs');
    for (const [href, name] of items) {
      const link = document.createElement('a'); link.href = href; link.textContent = name;
      if (href === current) link.setAttribute('aria-current', 'page');
      if (pick) link.onclick = event => { if (event.metaKey || event.ctrlKey || event.shiftKey) return; event.preventDefault(); pick(href); };
      container.append(link);
    }
  },

  /** The page's messages (#result) in a bar at the foot of the window, where they are seen, with a way to put them away.
   * A long raw answer from a camera is cut to a few lines until it is clicked. */
  messages() {
    const said = document.querySelector('#result'); if (!said || said.dataset.bar) return;
    said.dataset.bar = 'yes'; document.body.classList.add('message-bar');
    const close = document.createElement('button'); close.type = 'button'; close.id = 'result-close'; close.textContent = '×'; close.setAttribute('aria-label', 'Put the message away'); close.hidden = true;
    close.onclick = () => { said.textContent = ''; };
    said.after(close);
    said.title = 'Click to see all of it';
    said.onclick = () => said.classList.toggle('open');
    const look = () => { const text = said.textContent.trim(); close.hidden = !text; said.classList.toggle('raw', /^[[{]/.test(text)); if (!text) said.classList.remove('open'); };
    new MutationObserver(look).observe(said, { childList: true, characterData: true, subtree: true }); look();
  },
};

// A click is a press and a release on the same element. Every page redraws from fresh state every second or two, and a
// redraw between the press and the release replaced the button pressed with a new one, so the browser dropped the
// click and it took a second try ("I always have to double click", 2026-10-24). When the button pressed is gone by the
// release, the click goes to the one now in its place with the same words: what the person meant to press.
(() => {
  const PRESSABLE = 'button, summary, [role=button]';
  let pressed = null;
  document.addEventListener('pointerdown', event => {
    const target = event.button === 0 && event.isPrimary ? event.target.closest?.(PRESSABLE) : null;
    pressed = target ? { element: target, words: target.textContent.trim(), x: event.clientX, y: event.clientY } : null;
  }, true);
  document.addEventListener('pointercancel', () => { pressed = null; }, true);
  document.addEventListener('pointerup', event => {
    const was = pressed; pressed = null;
    if (!was || was.element.isConnected || Math.hypot(event.clientX - was.x, event.clientY - was.y) > 12) return;
    const now = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(PRESSABLE);
    if (!now || now === was.element || now.disabled || now.textContent.trim() !== was.words) return;
    setTimeout(() => now.click(), 0);           // after the browser's own click, which had no button to go to
  }, true);
})();
