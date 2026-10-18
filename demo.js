'use strict';
// The public demo's stand-in for the manager. Loaded first on every page, it answers the dashboard's requests from a
// recording of the demonstration manager (demo-data.json, made by demo-site/build.py) and keeps a small live state in
// this browser tab, so that what is pressed does what it would: a cut, automatic shots, recording and streaming,
// arming and streaming cameras, the kind of event. Nothing is sent anywhere; there is no server. A banner on every page
// says so, and a small programme monitor shows the picture of the camera on air (a still the demo drew, not video).
(() => {
  const realFetch = window.fetch.bind(window);
  // build.py loads this as /demo.js?v=<its own digest>, so that a new one is never taken from the browser's cache (GitHub
  // Pages lets it keep files ten minutes); what an earlier one kept in this tab, in a shape it may no longer read, is
  // left behind with it.
  const VERSION = new URL(document.currentScript.src).searchParams.get('v') || 'dev';
  const KEY = `mcvsaid-demo-state-${VERSION}`;
  const now = () => Date.now() / 1000;
  const copy = value => JSON.parse(JSON.stringify(value));
  let S = null;
  const ready = realFetch(`/demo-data.json?v=${VERSION}`).then(r => r.json()).then(recorded => {
    try { const kept = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (kept && kept.recordedOn === recorded['/api/cameras'].manager_version) S = kept; } catch (error) { /* a private window */ }
    if (!S) {
      S = { answers: copy(recorded), recordedOn: recorded['/api/cameras'].manager_version, recStart: null, streamStart: null, nextCut: now() + 9 };
      const d = S.answers['/api/cameras'].director; d.recording = null; d.streaming = null; d.since = now();
      // Scene Chat as recorded, brought forward so that its last line is a minute and a half old.
      const c = S.answers['/api/scene-chat'];
      if (c) {
        const shift = now() - 90 - Math.max(c.show.started, ...c.messages.map(m => m.at));
        c.show.started += shift; c.messages.forEach(m => { m.at += shift; }); c.wishes.forEach(w => { w.at += shift; w.until += shift; });
      }
    }
    S.kinds = recorded.__kinds__ || {};
    S.recordedFocus = recorded['/api/cameras'].director.camera_focus || {};
    delete S.answers.__kinds__;
    return S;
  });
  const save = () => { try { const { kinds, ...rest } = S; sessionStorage.setItem(KEY, JSON.stringify(rest)); } catch (error) { /* full or private */ } };
  const cams = () => S.answers['/api/cameras'];
  const director = () => cams().director;
  const named = id => (cams().cameras.find(c => c.id === id) || {}).name;

  // ---- what the director does by itself ------------------------------------------------------------
  function cutTo(target, byHand = false) {
    const d = director(), now_ = now();
    if (d.splits && d.splits[target]) { d.pair = d.splits[target]; d.on_air = null; d.scene = target; }
    else if (named(target)) { d.pair = null; d.on_air = target; d.scene = `${d.prefix || 'Cam '}${named(target)}`; }
    else return;
    d.since = now_; S.nextCut = now_ + 8 + Math.random() * 10;
    if (d.recording) { d.cuts = (d.cuts || 0) + 1; }
    if (!byHand) chatCut(d.pair ? d.pair.map(named).join(' + ') : named(target));
  }
  function tick() {
    if (!S) return;
    const d = director(), t = now();
    d.usable = cams().cameras.filter(c => c.online && (c.telemetry || {}).streaming).map(c => c.id);
    if (d.on_air && !d.usable.includes(d.on_air) && d.usable.length) cutTo(d.usable[0]);
    if (d.enabled && !(d.hold_until && d.hold_until > t) && t >= S.nextCut && d.usable.length > 1) {
      const choices = d.usable.filter(id => id !== d.on_air);
      cutTo(choices[Math.floor(Math.random() * choices.length)]); d.hold_until = null;
      save();
    }
    if (d.hold_until && d.hold_until <= t) d.hold_until = null;
    if (d.recording) d.recording.seconds = Math.round(t - S.recStart);
    if (d.streaming) d.streaming.seconds = Math.round(t - S.streamStart);
    d.next_cut_at = d.enabled ? S.nextCut : null;
    monitor();
  }
  setInterval(tick, 1000);


  // ---- Scene Chat (scenechat.py): the director's canned replies, chosen as the manager chooses them ------------------
  const chat = () => S.answers['/api/scene-chat'];
  const CHAT = { most: 4, lasts: 15 * 60 };
  const SAME = { keyboards: ['keys', 'keyboard', 'synth', 'organ'], drums: ['drum', 'drummer', 'kit'], vocals: ['singer', 'singing', 'vocal', 'vocalist', 'voice'],
    guitar: ['guitarist'], bass: ['bassist'], band: ['whole band', 'wide', 'wide shot', 'everyone'], host: ['host'], board: ['cutting board', 'board', 'knife', 'chopping'],
    stovetop: ['stove', 'pan', 'pot', 'hob'], cook_host: ['host', 'chef'], kitchen_wide: ['wide', 'whole kitchen'], wide: ['wide', 'wide shot', 'everyone'] };
  const said = (who, text, more = {}) => { const m = { id: Math.random().toString(16).slice(2, 10), at: now(), who, text, ...more }; chat().messages.push(m); chat().messages = chat().messages.slice(-200); return m; };
  const has = (text, word) => new RegExp(`(^|[^\\w-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w-])`, 'i').test(text);
  function chatTopic(text) {
    const words = S.answers['/api/event-mode']?.words || {};
    const found = [];
    for (const [key, name] of director().instruments || []) {
      const short = name.split(/ \/ | \(/)[0].toLowerCase();
      for (const word of [name.toLowerCase(), short, ...(SAME[key] || [])]) found.push([word, key, short]);
    }
    for (const word of ['crowd', 'audience', 'congregation', words.crowd || 'crowd']) found.push([word, 'crowd', words.crowd || 'crowd']);
    for (const c of cams().cameras) found.push([c.name.toLowerCase(), `camera:${c.id}`, c.name]);
    found.sort((a, b) => b[0].length - a[0].length);
    return found.find(([word]) => has(text, word)) || null;
  }
  function chatActive() { const c = chat(); c.wishes = c.wishes.filter(w => w.until > now() || (said('director', `Wish expired: “${w.text}”`, { system: true }), false)); return c.wishes.sort((a, b) => b.at - a.at); }
  function chatSay(text) {
    if (chat().ai_tier === 'none') return answer({ detail: 'Wishes need AI assistance (Standard or Plus): at No AI there is no model to tell.' }, 409);
    text = text.split(/\s+/).join(' ').trim().slice(0, 160);
    if (!text) return answer({ detail: 'Type a wish first' }, 400);
    const mine = said('you', text), active = chatActive();
    const clearing = text.match(/^\s*(?:clear|reset|cancel|forget|drop|undo|never ?mind|back to (?:the )?(?:brief|normal))\b(?:\s+(?:it|that|all|everything|them))*\s*(.*?)[.!]*\s*$/i);
    const way = /\b(less|fewer|not so much|too much|stop|avoid|no more|never|don'?t|away from|skip|enough)\b/i.test(text) ? 'less' : /\b(only|just|stay on|stay with|stick to|keep on)\b/i.test(text) ? 'only' : /\b(more|focus|favou?r|feature|show|go to|cut to|watch|follow|get)\b/i.test(text) ? 'more' : null;
    let reply;
    if (clearing && !/\bmore\b/i.test(clearing[1] || '')) {
      const topic = clearing[1] ? chatTopic(clearing[1]) : null;
      const hit = active.filter(w => !topic || w.topic === topic[1]);
      chat().wishes = active.filter(w => !hit.includes(w));
      reply = topic ? (hit.length ? `Cleared: ${topic[2]}.` : `Nothing to clear about the ${topic[2]}.`) : hit.length ? 'Cleared. Back to the brief.' : 'Nothing to clear: only the brief is in force.';
    } else {
      const topic = chatTopic(text), name = topic && topic[2], on = topic && (topic[1].startsWith('camera:') || /\d$/.test(name)) ? name : `the ${name}`;
      const replaced = topic ? active.filter(w => w.topic === topic[1]) : [];
      let wishes = [{ id: mine.id, text, at: mine.at, until: mine.at + CHAT.lasts, topic: topic && topic[1], toward: way, about: name }, ...active.filter(w => !replaced.includes(w))];
      const dropped = wishes.slice(CHAT.most); wishes = wishes.slice(0, CHAT.most); chat().wishes = wishes;
      reply = !topic ? (way === 'less' ? 'Noted: less of that.' : 'On it.')
        : replaced.length && replaced[0].toward !== way ? (way === 'less' || way === 'more' ? `Changing focus: ${way} on ${on}.` : `Changing focus: ${on}.`)
        : way === 'less' ? `Less on ${on}.` : way === 'only' ? `Staying with ${on}.` : way === 'more' ? `More on ${on}.` : `On it: ${on}.`;
      if (dropped.length) reply += ` Dropped the oldest wish (“${dropped[0].text}”): ${CHAT.most} at a time.`;
      S.chatNoted = null;
    }
    const r = said('director', reply, { to: mine.id }); save();
    return answer({ ...chat(), reply: r });
  }
  function chatCut(where) {
    const c = chat(); if (!c || !where) return;
    const latest = [...c.wishes].sort((a, b) => b.at - a.at)[0];
    if (!latest || S.chatNoted === latest.id || now() - latest.at > 180) return;
    S.chatNoted = latest.id; said('director', `Cut to ${where}: rated best by the model.`, { system: true });
  }
  function chatPost(body) {
    const c = chat(); if (!c) return answer({ detail: 'Not in the demo' }, 404);
    if ('say' in body) return chatSay(String(body.say || ''));
    let reply = null;
    if ('clear' in body) {
      const active = chatActive(), hit = active.filter(w => body.clear === 'all' || w.id === body.clear);
      c.wishes = active.filter(w => !hit.includes(w));
      reply = said('director', body.clear === 'all' ? (hit.length ? 'Cleared. Back to the brief.' : 'Nothing to clear.') : `Cleared: “${hit[0]?.text || ''}”`);
    } else if ('brief' in body) {
      const text = String(body.brief).split(/\s+/).join(' ').trim();
      if (text !== c.brief) { c.brief = text; said('you', text ? `Brief: ${text}` : 'Brief cleared', { brief: true }); reply = said('director', text ? 'Brief updated.' : 'Brief cleared: the rolling wishes only.'); }
    } else if (body.new_show) {
      Object.assign(c, { show: { id: Math.random().toString(16).slice(2, 10), started: now() }, wishes: [], messages: [] });
      said('director', 'New show. The brief stays; no wishes yet.');
    }
    save(); return answer({ ...c, reply });
  }

  // ---- answers -----------------------------------------------------------------------------------------
  const answer = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  function read(path, query) {
    const a = S.answers;
    if (path === '/api/stage') return { ...a['/api/stage'], director: director() };
    if (path === '/api/stage/place') return placing();
    if (path === '/api/temperatures') {
      const exact = a[`${path}?${query}`]; if (exact) return exact;
      const key = Object.keys(a).find(k => k.startsWith('/api/temperatures?')); return key ? a[key] : { cameras: [] };
    }
    if (path === '/api/scene-chat' && a[path]) { chatActive(); return a[path]; }
    if (path in a) return a[path];
    if (path.startsWith('/api/commands/')) return { state: 'SUCCEEDED', result: { type: 'ack', ok: true } };
    return null;
  }
  function command(id, body) {
    const camera = cams().cameras.find(c => c.id === id); if (!camera) return answer({ detail: 'No such camera' }, 404);
    const t = camera.telemetry = camera.telemetry || {}, capture = t.capture = t.capture || {};
    const what = body.command;
    if (what === 'stream.start') { t.streaming = true; capture.streamRequested = true; t.armed = true; }
    else if (what === 'stream.stop') { t.streaming = false; capture.streamRequested = false; }
    else if (what === 'camera.arm') t.armed = true;
    else if (what === 'camera.disarm') { t.armed = false; t.streaming = false; t.recording = false; capture.streamRequested = false; }
    else if (what === 'recording.start') { t.recording = true; t.armed = true; }
    else if (what === 'recording.stop') t.recording = false;
    else if (what === 'cooler.settings') {
      // As the simulated phone does: the fan choice, a manual level, a shutdown timer; the lights are always kept off.
      const p = body.parameters || {};
      for (const c of [t.cooler, camera.cooler].filter(x => x && typeof x === 'object')) {
        if (p.fan) { c.fan = p.fan; c.fan_mode = p.fan === 'overclock_streaming' ? 'smart' : p.fan; c.fan_speed = p.fan === 'manual' ? (p.level || c.fan_level || 3) : null; }
        if (p.level) { c.fan_level = p.level; if (c.fan === 'manual') c.fan_speed = p.level; }
        if ('shutdown' in p) c.shutdown = p.shutdown || null;
        if (p.look) note('In the demo the cooler is already found.');
        // Its fan speed as measured on a real one in each mode, and the line the card shows, as the manager writes it.
        const level = c.fan_level || 3;
        c.fan_rpm = { silent: 3050, smart: 3560, overclock: 5800, overclock_streaming: 5800, manual: 3930 + (level - 1) * 470 }[c.fan] || c.fan_rpm;
        const mode = { overclock_streaming: 'overclock while streaming', manual: `fixed speed ${level}` }[c.fan] || c.fan;
        if (typeof c.summary === 'string') c.summary = c.summary.replace(/^Cooler: [^,]*, [\d,]+ rpm/, `Cooler: ${mode}, ${c.fan_rpm.toLocaleString('en')} rpm`);
      }
    }
    tick(); save();
    return answer({ id: body.request_id || 'demo', camera_id: id, state: 'SUCCEEDED', result: { type: 'ack', ok: true, demo: true }, created: now() });
  }
  function directorPost(body) {
    const d = director(), t = now();
    if ('take' in body) { cutTo(body.take, true); d.hold_until = d.enabled ? t + 10 : null; }
    if ('enabled' in body) { d.enabled = !!body.enabled; S.nextCut = t + 6; }
    if (body.camera_focus && typeof body.camera_focus === 'object') focusPost(body.camera_focus);
    if ('record' in body) {
      if (body.record) { S.recStart = t; d.recording = { started: t, seconds: 0, file: 'demo-programme.mkv' }; d.cuts = 0; }
      else d.recording = null;
    }
    if ('stream' in body) {
      if (body.stream) { S.streamStart = t; d.streaming = { seconds: 0, reconnecting: false }; } else d.streaming = null;
    }
    for (const [k, v] of Object.entries(body)) if (!['take', 'enabled', 'record', 'stream'].includes(k) && k in d && typeof v !== 'object') d[k] = v;
    tick(); save(); return answer(d);
  }
  function kindPost(body) {
    const kind = S.kinds[body.mode]; if (!kind) return answer({ detail: 'Unknown kind of event' }, 400);
    const live = director(), liveCams = cams().cameras;
    S.answers['/api/event-mode'] = copy(kind['/api/event-mode']);
    S.answers['/api/stage'] = { ...copy(kind['/api/stage']), layout: S.answers['/api/stage'].layout, widths: S.answers['/api/stage'].widths, room: S.answers['/api/stage'].room };
    const fresh = copy(kind['/api/cameras']);
    for (const k of ['on_air', 'pair', 'scene', 'since', 'enabled', 'recording', 'streaming', 'hold_until', 'cuts']) fresh.director[k] = live[k];
    fresh.cameras.forEach(c => { const was = liveCams.find(x => x.id === c.id); if (was) c.telemetry = was.telemetry; });
    S.answers['/api/cameras'] = fresh;
    const said = kind['/api/scene-chat'];
    if (said && chat()) Object.assign(chat(), { examples: said.examples, mode: said.mode });
    tick(); save(); return answer(S.answers['/api/event-mode']);
  }
  // Stage Shots: its layout and room map, a camera at a time and field by field, a field set to null going back to its
  // default (or, for x and y on the room map, taking the camera off it), as stageplot.arranged and roommap.arranged do.
  function stagePost(body) {
    const st = S.answers['/api/stage'];
    for (const [id, entry] of Object.entries(body.layout || {})) {
      const changed = { ...(st.layout[id] || {}) };
      for (const [field, value] of Object.entries(entry || {})) {
        if (field === 'y') continue;
        if (value === null) { delete changed[field]; if (field === 'x') delete changed.y; }
        else if (field === 'x') { changed.x = value; changed.y = entry.y; } else changed[field] = value;
      }
      if (Object.keys(changed).length) st.layout[id] = changed; else delete st.layout[id];
    }
    if (body.widths) st.widths = { ...(st.widths || {}), ...body.widths };
    const room = st.room;
    for (const [id, entry] of Object.entries((room && body.room) || {})) {
      if ('x' in entry && entry.x === null) { delete room.map[id]; delete room.derived[id]; continue; }
      const changed = { ...(room.map[id] || {}), ...entry };
      if (entry.fov === null) delete changed.fov;
      room.map[id] = changed;
      // What Stage Shots takes from it: the mark's aim follows; where it stands round the edge stays as recorded.
      if (room.derived[id]?.cam && 'aim' in entry) room.derived[id].cam.aim = entry.aim;
    }
    save(); return answer(read('/api/stage'));
  }
  // What each camera is there to show, as the director page and Stage Shots' who-is-who buttons set it.
  function focusPost(given) {
    const d = director(), focus = { ...(d.camera_focus || {}), ...given };
    for (const [id, keys] of Object.entries(focus)) if (!keys.length) delete focus[id];
    d.camera_focus = focus;
    const names = { ...(S.answers['/api/stage/place'] || {}).names };
    for (const c of S.answers['/api/stage'].cameras) (S.recordedFocus[c.id] || []).forEach((key, i) => { names[key] = names[key] || c.instruments[i]; });
    for (const c of S.answers['/api/stage'].cameras) if (c.id in given) c.instruments = (focus[c.id] || []).map(key => names[key] || key.replace(/^custom:/, ''));
  }

  // Stage Shots' "Place from the wide shot" (experimental): a few seconds of looking, then what the demonstration
  // manager found from its wide camera (Centre Wide). Its answers change from one look to the next, as its director
  // zooms, so these are copied from its looks (2026-10-18), the picture they are drawn over is the one build.py's look
  // recorded, and anything else is the recording's. From another camera nothing was recorded.
  const LOOK = { rounds: 5, round: 1.2, naming: 2 };
  const FOUND = {
    'a76e3060-1ffb-5873-895c-3151261352ac': { found: true, left: 0.0788, right: 0.4406, outline: [[0.0796, 0.3196], [0.4398, 0.3194], [0.4406, 0.6788], [0.0788, 0.6791]], turn: -15, matches: 45, rounds: 5, agreeing: 5, layout: { x: 0.214, y: 0.55, w: 0.43 }, aim: 345, plays: { plays: 'vocals', sure: 0.86 } },
    '1ce523cc-1cb8-5712-bcbd-0f8f16bc8498': { found: true, left: 0.3582, right: 0.6598, outline: [[0.3599, 0.349], [0.6596, 0.3508], [0.6598, 0.6507], [0.3582, 0.6513]], turn: 0, matches: 36, rounds: 5, agreeing: 5, layout: { x: 0.511, y: 0.55, w: 0.37 }, aim: 0, plays: { plays: 'guitar_or_bass', sure: 0.52 } },
    '91e097bb-25db-5054-bcf4-462fa19129b9': { found: true, left: 0.5995, right: 0.9396, outline: [[0.5995, 0.3299], [0.9396, 0.3305], [0.9396, 0.6706], [0.5996, 0.6709]], turn: 15, matches: 35, rounds: 5, agreeing: 5, layout: { x: 0.811, y: 0.25, w: 0.38 }, aim: 15, plays: { plays: 'drums', sure: 0.93 } },
    '649b0963-0a5f-5140-a2e9-4bf3a9f526df': { found: false, why: 'nothing in common with the wide picture', rounds: 5, agreeing: 0, plays: { plays: 'keyboards', sure: 0.71 } },
    '79454bd5-6007-5276-9143-903d0cf2fcc4': { found: false, why: 'nothing in common with the wide picture', rounds: 5, agreeing: 0 },
  };
  function placing() {
    const found = S.answers['/api/stage/place'] || { running: false, available: false, why: 'it is not in this demo' };
    const { wide, round, rounds, started, finished, cameras, people, step, problem, ...always } = found;
    const report = { ...copy(always), running: false, showing: {} };
    for (const c of S.answers['/api/stage'].cameras) report.showing[c.id] = (director().camera_focus || {})[c.id] || [];
    const look = S.look; if (!look) return report;
    const t = now() - look.started, looking = LOOK.rounds * LOOK.round;
    Object.assign(report, { wide: look.wide, rounds: LOOK.rounds, started: look.started, round: Math.min(LOOK.rounds, Math.floor(t / LOOK.round)) });
    if (t < looking + LOOK.naming) return { ...report, running: true, step: t >= looking && found.naming ? 'naming' : null, cameras: {} };
    report.finished = look.started + looking + LOOK.naming;
    const fixed = Object.keys(FOUND).every(id => named(id) && id !== wide) && named(wide) === 'Centre Wide';
    if (look.wide === wide) return { ...report, cameras: copy(fixed ? FOUND : cameras || {}), ...(people ? { people: copy(people) } : {}) };
    report.cameras = {};
    for (const c of S.answers['/api/stage'].cameras) if (c.id !== look.wide) report.cameras[c.id] = { found: false, why: `in this demo only a look from the ${named(wide) || 'wide'} camera was recorded`, rounds: LOOK.rounds, agreeing: 0 };
    return report;
  }
  function placePost(body) {
    if (!named(body.wide)) return answer({ detail: 'No such camera' }, 404);
    if (placing().running) return answer({ detail: 'A look is already being taken' }, 409);
    S.look = { wide: body.wide, started: now() }; save(); return answer(placing());
  }
  function merge(path, body) {
    const target = S.answers[path];
    if (target && typeof target === 'object' && body && typeof body === 'object' && !Array.isArray(body)) {
      for (const [k, v] of Object.entries(body)) if (k in target && typeof target[k] === typeof v) target[k] = v;
      save(); return answer(target);
    }
    note('In the demo this setting is shown but not kept.');
    return answer(target || { ok: true, demo: true });
  }
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init);
    await ready;
    const method = (init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
    const path = url.pathname, query = url.search.slice(1);
    if (method === 'GET') { const data = read(path, query); return data === null ? answer({ detail: 'Not in the demo' }, 404) : answer(data); }
    let body = {}; try { body = init.body ? JSON.parse(init.body) : {}; } catch (error) { body = {}; }
    if (path === '/api/login') return answer(S.answers['/api/session']);
    if (path === '/api/logout') { note('This is a demo: there is nobody to log out.'); return answer({ logged_out: false }); }
    if (path === '/api/director') return directorPost(body);
    if (path === '/api/event-mode') return kindPost(body);
    if (path === '/api/scene-chat') return chatPost(body);
    const m = path.match(/^\/api\/cameras\/([^/]+)\/commands$/); if (m) return command(decodeURIComponent(m[1]), body);
    if (path === '/api/stage' && (body.layout || body.widths || body.room)) return stagePost(body);
    if (path === '/api/stage/place') return placePost(body);
    return merge(path, body);
  };

  // ---- the banner and the programme monitor --------------------------------------------------------------
  let noteTimer = null;
  function note(text) {
    const el = document.querySelector('#demo-note'); if (!el) return;
    el.textContent = text; el.hidden = false; clearTimeout(noteTimer); noteTimer = setTimeout(() => { el.hidden = true; }, 4000);
  }
  function monitor() {
    const box = document.querySelector('#demo-monitor'); if (!box || !S) return;
    const d = director(), ids = d.pair || (d.on_air ? [d.on_air] : []);
    const pics = box.querySelector('.pics'), want = ids.join(',');
    if (pics.dataset.ids !== want) {
      pics.dataset.ids = want; pics.replaceChildren(...ids.map(id => { const i = document.createElement('img'); i.src = `/api/colour/preview/${id}`; i.alt = named(id) || ''; return i; }));
    }
    box.querySelector('.what').textContent = ids.length ? (d.pair ? `Split: ${ids.map(named).join(' + ')}` : named(ids[0])) : 'nothing on air';
    box.querySelector('.rec').hidden = !d.recording; box.querySelector('.live').hidden = !d.streaming;
  }
  const css = `
    #demo-bar{position:fixed;right:12px;bottom:12px;z-index:9999;background:#2a1f05;color:#ffe2a6;border:1px solid #8a6a1c;border-radius:999px;padding:5px 8px 5px 14px;font:13px/1.3 system-ui,sans-serif;max-width:calc(100vw - 24px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 6px 24px rgba(0,0,0,.45)}
    #demo-bar b{color:#fff} #demo-bar a{color:#ffd27a} #demo-bar button{margin:0 0 0 8px;padding:2px 8px;font-size:12px;background:transparent;color:#ffe2a6;border:1px solid #8a6a1c;border-radius:6px;cursor:pointer}
    #demo-monitor{position:fixed;right:12px;top:12px;z-index:9998;width:240px;background:#0b1117;border:1px solid #547087;border-radius:10px;overflow:hidden;font:12px system-ui,sans-serif;color:#cfe0ee;box-shadow:0 6px 24px rgba(0,0,0,.45)}
    #demo-monitor .pics{display:flex;aspect-ratio:16/9;background:#000} #demo-monitor .pics img{flex:1;min-width:0;object-fit:cover}
    #demo-monitor .row{display:flex;gap:6px;align-items:center;padding:5px 8px} #demo-monitor .what{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #demo-monitor .tag{background:#1d3a50;color:#fff;border-radius:4px;padding:1px 5px;font-weight:600} #demo-monitor .rec{background:#a3261c} #demo-monitor .live{background:#a3261c}
    #demo-monitor.small .pics{display:none}
    #demo-note{position:fixed;left:50%;transform:translateX(-50%);bottom:70px;z-index:9999;background:#1e2c39;color:#eef4f8;border:1px solid #547087;border-radius:8px;padding:6px 12px;font:13px system-ui,sans-serif}
    @media (max-width:700px){#demo-monitor{width:132px;top:auto;bottom:108px;right:8px}#demo-bar{right:8px;left:8px;bottom:70px;font-size:12px;white-space:normal;border-radius:12px}}`;
  function decorate() {
    const style = document.createElement('style'); style.textContent = css; document.head.append(style);
    const bar = document.createElement('div'); bar.id = 'demo-bar'; bar.setAttribute('role', 'note');
    bar.innerHTML = '<b>Demo</b> · simulated cameras, nothing connected · <a href="https://github.com/MCVSAID/mcvsaid-app">About</a> · <a href="mailto:mcvsaid@proton.me?subject=MCVSAID%20beta">Join the beta</a><button type="button" id="demo-reset" title="Put everything back as it was">Start over</button><button type="button" id="demo-hide" aria-label="Hide this note">×</button>';
    bar.title = 'The real MCVSAID dashboard, running in your browser with simulated cameras. Nothing is connected and nothing you press leaves your browser; the pictures are drawn stills, not video.';
    const mon = document.createElement('div'); mon.id = 'demo-monitor'; mon.setAttribute('aria-label', 'Programme monitor (simulated)');
    mon.innerHTML = '<div class="pics"></div><div class="row"><span class="tag">PGM</span><span class="what"></span><span class="tag rec" hidden>REC</span><span class="tag live" hidden>LIVE</span></div>';
    mon.title = 'What the programme shows: a still drawn by the demo for the camera on air'; mon.onclick = () => mon.classList.toggle('small'); if (innerWidth < 700) mon.classList.add('small');
    const toast = document.createElement('div'); toast.id = 'demo-note'; toast.hidden = true; toast.setAttribute('aria-live', 'polite');
    document.body.append(bar, mon, toast);
    bar.querySelector('#demo-hide').onclick = () => { bar.hidden = true; };
    bar.querySelector('#demo-reset').onclick = () => { try { sessionStorage.removeItem(KEY); } catch (error) { /* */ } location.reload(); };
    ready.then(() => { tick(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', decorate); else decorate();
})();
