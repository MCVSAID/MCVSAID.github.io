'use strict';
// Scene Chat (scenechat.py): guiding the director through the show in a few words, down the right of the Show and Stage
// Shots pages. The standing brief at the top, the wishes in force under it, the show's chat, and a box to type into.
// The director's replies are canned and come back at once: the model is never asked to answer the chat.
//
// Wide screens: a panel down the right, shut to a narrow strip with its button. Tablets: the same panel over the page,
// opened from a button at the right edge. Phones: a sheet from the bottom, opened from a button above the bottom bar.
(() => {
  const PAGES = ['/', '/stage'];
  const DOCK = 1180;                           // at least this wide, the panel sits beside the page instead of over it
  let box = null, state = null, open = null, seen = 0, timer = null, editingBrief = false, sending = false, redraw = false, problem = '', pinned = true;
  const store = { get(key) { try { return localStorage.getItem(key); } catch (error) { return null; } }, set(key, value) { try { localStorage.setItem(key, value); } catch (error) { /* a private window */ } } };
  const el = (tag, text, className) => { const e = document.createElement(tag); if (text !== undefined && text !== null) e.textContent = text; if (className) e.className = className; return e; };
  const clock = at => new Date(at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const here = () => location.pathname.replace(/\/+$/, '') || '/';
  const wide = () => window.matchMedia(`(min-width: ${DOCK}px)`).matches;
  const icon = '<svg class="icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/></svg>';

  async function call(body) {
    const response = await fetch('/api/scene-chat', { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.concert.session?.csrf || '' }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `The manager answered ${response.status}`);
    if (body) problem = '';
    return data;
  }

  function build() {
    box = el('aside'); box.id = 'scene-chat'; box.setAttribute('aria-label', 'Scene Chat');
    box.innerHTML = `<div class="chat-head"><h2>${icon}<span>Scene Chat</span></h2><span class="chat-show"></span><button type="button" class="chat-new">New show</button><button type="button" class="chat-close" aria-label="Shut Scene Chat">×</button></div>
      <details class="chat-brief"><summary>Standing brief <span></span></summary><div class="brief-body"></div></details>
      <div class="chat-wishes" aria-label="Wishes in force"></div>
      <ol class="chat-log" role="log" aria-live="polite" aria-label="The show's chat with the director"></ol>
      <p class="chat-note" hidden></p>
      <form class="chat-say"><textarea rows="3" maxlength="160" autocomplete="off" spellcheck="true" enterkeyhint="send" aria-label="A wish for the director (Enter sends, Shift+Enter for a new line)"></textarea><button>Send</button></form>`;
    const toggle = el('button', null, 'chat-toggle'); toggle.type = 'button'; toggle.id = 'scene-chat-toggle';
    toggle.innerHTML = `${icon}<span class="label">Scene Chat</span><span class="badge" hidden></span>`;
    toggle.setAttribute('aria-controls', 'scene-chat');
    toggle.onclick = () => show(!open);
    box.querySelector('.chat-close').onclick = () => { show(false); toggle.focus(); };
    box.querySelector('.chat-new').onclick = async () => {
      if (!await window.concert.sure('Start a new show?\nThe chat and every wish in force are cleared. The standing brief stays as it is.', { ok: 'New show', danger: true })) return;
      try { draw(await call({ new_show: true })); } catch (error) { await window.concert.tell(`The chat could not be started afresh\n${error.message}`); }
    };
    box.querySelector('.chat-say').onsubmit = async event => {
      event.preventDefault();
      const input = box.querySelector('.chat-say textarea'), text = input.value.split(/\s+/).join(' ').trim();      // a wish is one line
      if (!text || sending) return;
      sending = true; input.disabled = true;
      try { draw(await call({ say: text })); input.value = ''; grow(input); }
      catch (error) { problem = error.message; state ? draw(state) : note(problem, true); }
      finally { sending = false; input.disabled = !!(state && state.ai_tier === 'none'); input.focus(); }
    };
    // The chat stays at its newest line while it is there, as the panel opens, the page is resized or the brief is opened.
    const log = box.querySelector('.chat-log');
    log.addEventListener('scroll', () => { pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 40; });
    new ResizeObserver(() => { if (pinned) scrollDown(); }).observe(log);
    // A box several lines high, easy to type into on a tablet: Enter sends, Shift+Enter starts a new line, and it grows
    // with what is typed up to a few lines more.
    const area = box.querySelector('.chat-say textarea');
    area.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); box.querySelector('.chat-say').requestSubmit(); } });
    area.addEventListener('input', () => grow(area));
    const shade = el('div'); shade.id = 'chat-shade'; shade.onclick = () => show(false);
    document.body.append(shade, box, toggle);
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && open && !wide() && !document.querySelector('dialog[open]')) { show(false); toggle.focus(); } });
    window.matchMedia(`(min-width: ${DOCK}px)`).addEventListener('change', () => show(wide() ? store.get('scene-chat-open') !== 'no' : false, false));
  }

  /** Opens or shuts the panel. Beside the page, whether it is open is remembered; over the page it starts shut. */
  function show(wanted, remember = true) {
    open = wanted;
    document.body.classList.toggle('chat-open', open);
    document.body.classList.toggle('chat-docked', wide());
    if (remember && wide()) store.set('scene-chat-open', open ? 'yes' : 'no');
    const toggle = document.querySelector('#scene-chat-toggle');
    toggle.setAttribute('aria-expanded', String(open)); toggle.setAttribute('aria-label', open ? 'Shut Scene Chat' : 'Open Scene Chat');
    box.inert = !open; box.setAttribute('aria-hidden', String(!open));
    if (open) { seen = (state?.messages || []).length; badge(); scrollDown(); if (!wide()) box.querySelector('.chat-say textarea:not(:disabled)')?.focus({ preventScroll: true }); }
  }

  function badge() {
    const fresh = (state?.messages || []).slice(seen).filter(m => m.who === 'director').length;
    const mark = document.querySelector('#scene-chat-toggle .badge'); if (!mark) return;
    mark.hidden = open || !fresh; mark.textContent = fresh; mark.className = 'badge ok';
    mark.setAttribute('aria-label', `${fresh} new from the director`);
  }

  function grow(area) { area.style.height = ''; area.style.height = `${Math.min(area.scrollHeight + 2, 160)}px`; }

  function scrollDown() { const log = box.querySelector('.chat-log'); log.scrollTop = log.scrollHeight; }

  function note(text, warn = false) {
    const said = box.querySelector('.chat-note'); said.hidden = !text; said.textContent = text || ''; said.classList.toggle('warn', warn);
  }

  /** Draws what the manager answered. The log is redrawn only when it has changed, and what is being typed is left alone. */
  function draw(data) {
    const before = state; state = data;
    const words = window.concert.mode?.words || {};
    box.querySelector('.chat-show').textContent = `Show since ${clock(data.show.started)}`;
    // The standing brief: the Director page's wishes for the shot, the same setting.
    const brief = box.querySelector('.chat-brief');
    brief.querySelector('summary span').textContent = data.brief ? '' : '(none)';
    if (!editingBrief) {
      const body = brief.querySelector('.brief-body'); body.replaceChildren();
      body.append(el('p', data.brief || `No brief yet. For example: ${data.examples.brief}`, data.brief ? 'brief-text' : 'brief-text empty'));
      const edit = el('button', data.brief ? 'Edit brief' : 'Write a brief'); edit.type = 'button'; edit.disabled = data.ai_tier === 'none';
      edit.onclick = () => {
        editingBrief = true; body.replaceChildren();
        const area = el('textarea'); area.rows = 3; area.maxLength = 2000; area.value = data.brief; area.placeholder = data.examples.brief; area.setAttribute('aria-label', 'Standing brief');
        const save = el('button', 'Save brief'); save.type = 'button';
        const cancel = el('button', 'Cancel'); cancel.type = 'button';
        const done = () => { editingBrief = false; draw(state); };
        save.onclick = async () => { try { editingBrief = false; draw(await call({ brief: area.value })); } catch (error) { problem = error.message; editingBrief = true; draw(state); } };
        cancel.onclick = done;
        body.append(area, el('small', 'Told to the model on every look, before the wishes typed during the show.'), save, cancel); area.focus();
      };
      body.append(edit);
    }
    // The wishes in force, newest first, each with its own clear button.
    const wishes = box.querySelector('.chat-wishes'); wishes.replaceChildren();
    if (data.wishes.length) {
      const head = el('div', null, 'wishes-head');
      head.append(el('span', `In force (${data.wishes.length} of ${data.most}, newest first)`));
      const all = el('button', 'Clear all'); all.type = 'button'; all.onclick = async () => { try { draw(await call({ clear: 'all' })); } catch (error) { problem = error.message; state ? draw(state) : note(problem, true); } };
      head.append(all); wishes.append(head);
      const list = el('ul');
      for (const wish of data.wishes) {
        const item = el('li'); item.title = `Typed at ${clock(wish.at)}; lasts until ${clock(wish.until)} unless cleared or replaced`;
        item.append(el('span', wish.text));
        const clear = el('button', '×'); clear.type = 'button'; clear.setAttribute('aria-label', `Clear the wish “${wish.text}”`);
        clear.onclick = async () => { try { draw(await call({ clear: wish.id })); } catch (error) { problem = error.message; state ? draw(state) : note(problem, true); } };
        item.append(clear); list.append(item);
      }
      wishes.append(list);
    }
    // The chat itself.
    const log = box.querySelector('.chat-log');
    const last = data.messages[data.messages.length - 1]?.id, had = before?.messages?.[before.messages.length - 1]?.id;
    if (!before || redraw || last !== had || data.show.id !== before.show.id) {
      redraw = false;
      const atFoot = pinned;
      log.replaceChildren();
      if (!data.messages.length) log.append(el('li', `Tell the director what you want as the show goes: “${data.examples.wish}”, “less on the ${words.crowd || 'crowd'}”, “clear”. Its replies are instant; the model reads your wishes on its next look.`, 'msg system'));
      for (const message of data.messages) {
        const item = el('li', null, `msg ${message.who}${message.system ? ' system' : ''}${message.brief ? ' brief' : ''}`);
        item.append(el('span', message.text, 'text'), el('time', clock(message.at)));
        item.querySelector('time').dateTime = new Date(message.at * 1000).toISOString();
        log.append(item);
      }
      if (atFoot || !before || data.show.id !== before.show.id || data.reply) scrollDown();
      if (open || !before) seen = data.messages.length;        // only what arrives while the page is open counts as new
      if (before && data.show.id !== before.show.id) seen = open ? data.messages.length : 0;
    }
    badge();
    // At No AI there is no model to tell: said plainly, and the history is still shown.
    const input = box.querySelector('.chat-say textarea'), send = box.querySelector('.chat-say button');
    input.placeholder = `e.g. ${data.examples.wish}`;
    input.disabled = send.disabled = data.ai_tier === 'none';
    note(problem || (data.ready ? '' : data.why), !!problem || data.ai_tier === 'none');
  }

  async function poll() {
    if (!box || box.hidden || !window.concert.session) return;
    try { draw(await call()); } catch (error) { /* said by the page when the manager is unreachable */ }
  }

  /** Shown on the Show and Stage Shots pages, to whoever is logged in to the dashboard. */
  function place() {
    const wanted = PAGES.includes(here()) && !!window.concert.session && !!document.querySelector('#pages');
    if (!wanted) { if (box) { box.hidden = true; document.querySelector('#scene-chat-toggle').hidden = true; document.body.classList.remove('chat-open', 'chat-docked', 'has-chat'); } return; }
    if (!box) { build(); show(wide() ? store.get('scene-chat-open') !== 'no' : false, false); }
    box.hidden = false; document.querySelector('#scene-chat-toggle').hidden = false;
    document.body.classList.add('has-chat'); document.body.classList.toggle('chat-open', open); document.body.classList.toggle('chat-docked', wide());
    if (!timer) { poll(); timer = setInterval(poll, 2500); }
  }

  // The pages draw their side bar on every change of page (concert.nav): the panel follows.
  const nav = window.concert.nav.bind(window.concert);
  window.concert.nav = (...args) => { nav(...args); place(); };
  // The page may have logged in and drawn its side bar before this script arrived.
  if (window.concert.session) place();
  window.addEventListener('popstate', () => setTimeout(place));
  // Another kind of event: its examples, at once.
  document.addEventListener('event-mode', () => { redraw = true; poll(); });
})();
