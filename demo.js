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
    explainCut(d.pair ? d.pair.map(named).join(' + ') : named(target), byHand);
  }
  // Explain the director (explain.py): in the demo, each cut becomes a caption, as the manager makes them.
  function explainState() {
    const recorded = S.answers['/api/explain'] || { on: false, seconds: 7, spotlight_seconds: 45, position: 'top-left', recent: [] };
    return S.explain = S.explain || { ...copy(recorded), overlay: { problem: null, scenes: 6, quiet: null } };
  }
  function explainCut(where, byHand) {
    const e = explainState(); if (!e.on || !where) return;
    const reasons = ['the performer it is given is playing and well framed', 'the guitarist is to the fore in the sound', 'a wider look after a long close shot', 'the singer turned towards this camera'];
    e.recent = [...e.recent, { at: now(), kind: 'cut', title: `Cut to ${where}`, text: byHand ? 'Operator: chosen by hand' : `AI director: ${reasons[Math.floor(Math.random() * reasons.length)]}` }].slice(-8);
  }
  // A gimbal camera's tracking, as its phone would report it: a caption when the demo's follow is switched on.
  function explainTracking(id, on) {
    const e = explainState(); if (!e.on || !on) return;
    const camera = cams().cameras.find(c => c.id === id), title = `${camera?.name || 'A camera'} is tracking`;
    if (e.recent.some(c => c.title === title && now() - c.at < 2)) return;            // the same switch seen twice
    e.recent = [...e.recent, { at: now(), kind: 'gimbal', title, text: 'its phone keeps them in frame, steering the gimbal itself' }].slice(-8);
  }
  function explainPost(body) {
    const e = explainState();
    if ('on' in body) { e.on = !!body.on; if (e.on) { e.recent = []; note('In the demo the captions are listed here; in a real show they are laid over the programme in OBS, and recorded with it.'); } }
    if (typeof body.seconds === 'number') e.seconds = body.seconds;
    if (typeof body.spotlight_seconds === 'number') e.spotlight_seconds = body.spotlight_seconds;
    if (body.position) e.position = body.position;
    save(); return answer(e);
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
    if (S.answers['/api/recipe']) { recipeStart(); d.recipe = cooking() ? progress() : null; }
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

  // ---- Cooking's recipe (recipe.py, speech.py): its steps followed, edited and moved through here, and what the cook
  // says simulated with the Recipe page's "Try a phrase". As the manager does it, in a smaller way: the shots each step
  // has had are made up from its time (a station counts as shown after 15 s), and a pasted recipe is read by its headings.
  const R = () => S.answers['/api/recipe'];
  const cooking = () => S.answers['/api/event-mode']?.mode === 'cooking';
  function recipeStart() {
    // The recipe as recorded, its times brought forward so that the step being cooked began a minute ago.
    const r = R(); if (!r || S.cook) return;
    const p = r.progress || { steps: [] }, began = p.steps.filter(s => s.began != null).map(s => s.began), shift = began.length ? now() - 60 - Math.max(...began) : 0;
    S.cook = { current: p.current_id || null, since: p.current_id ? now() - 60 : null, status: {}, began: {}, ran: {}, undos: [], history: [], flash: {} };
    for (const s of p.steps) { if (['done', 'skipped'].includes(s.status)) S.cook.status[s.id] = s.status; if (s.began != null) S.cook.began[s.id] = s.began + shift; if (s.seconds != null && s.status !== 'current') S.cook.ran[s.id] = s.seconds; }
    const v = r.voice; if (v) { const last = Math.max(0, ...v.heard.map(e => e.at)); v.heard.forEach(e => { e.at += now() - 75 - last; }); }
  }
  function run() {
    const r = R(); if (!r || !r.recipe) return [];
    const out = [];
    for (const [section, key, word] of [['prep', 'prep', 'Prep'], ['method', 'steps', 'Step']]) (r.recipe[key] || []).forEach((s, n) => out.push({ ...s, section, number: n + 1, label: `${word} ${n + 1}` }));
    return out;
  }
  const at = id => run().findIndex(s => s.id === id);
  function pendingFrom(start) { const steps = run(), c = S.cook; for (let n = Math.max(0, start); n < steps.length; n++) if (steps[n].id !== c.current && !c.status[steps[n].id]) return n; return null; }
  const upcoming = () => pendingFrom(S.cook.current == null ? 0 : at(S.cook.current) + 1);
  function remember(what, recipe) { const c = S.cook; c.undos.push({ what, state: copy({ current: c.current, status: c.status, began: c.began, ran: c.ran, since: c.since }), recipe: recipe ? copy(recipe) : null }); c.undos = c.undos.slice(-30); }
  function begin(index, by, keep = true) {
    const steps = run(), c = S.cook; if (!steps.length) return null;
    index = Math.max(0, Math.min(index, steps.length - 1));
    const target = steps[index], here = c.current == null ? null : at(c.current);
    if (index === here) return target;
    if (keep) remember(`${target.label} begun (${by})`);
    if (c.current != null) { c.ran[c.current] = (c.ran[c.current] || 0) + (now() - c.since); if (here == null || index > here) c.status[c.current] = c.status[c.current] || 'done'; else delete c.status[c.current]; }
    delete c.status[target.id]; c.current = target.id; c.since = now(); c.began[target.id] = c.began[target.id] || now();
    return target;
  }
  function progress() {
    const r = R(), c = S.cook, steps = run(); if (!r?.recipe) return null;
    const t = now(), index = c.current == null ? -1 : at(c.current), next = upcoming();
    const shown = id => { const ran = (c.ran[id] || 0) + (id === c.current ? t - c.since : 0); return ran; };
    const listed = steps.map((s, n) => ({ id: s.id, label: s.label, section: s.section, number: s.number, caption: s.caption, text: s.text, stations: s.stations,
      status: s.id === c.current && !c.status[s.id] ? 'current' : c.status[s.id] || 'to come', began: c.began[s.id] ?? null, seconds: c.began[s.id] != null ? Math.round(shown(s.id)) : null,
      shots: c.began[s.id] != null && (c.status[s.id] === 'done' || shown(s.id) >= 15) ? s.stations : [], next: n === next }));
    const step = index >= 0 ? steps[index] : null;
    return { title: r.recipe.title, url: r.recipe.url, count: steps.length, current: index >= 0 ? index + 1 : null, current_id: c.current, step, next: next != null ? steps[next] : null,
      seconds: step ? Math.round(t - c.since) : null, needs: step && t - c.since < 15 ? Object.fromEntries(step.stations.map(k => [k, 1])) : {}, follow: r.progress?.follow || 'auto',
      covered: {}, missed: [], caption: null, history: [], steps: listed, prep: { count: steps.filter(s => s.section === 'prep').length, shown: r.overlay.prep !== false },
      finished: listed.length > 0 && listed.every(s => ['done', 'skipped'].includes(s.status)), undo: c.undos.length ? c.undos[c.undos.length - 1].what : null };
  }
  function recipeRead() {
    recipeStart();
    const r = R(), v = r.voice;
    v.listening = v.enabled && cooking(); v.problem = null; v.runtime = v.installed = true;
    return { ...r, cooking: cooking(), progress: progress(), overlay: { ...r.overlay, page: null, showing: { on: !!r.recipe, side: 'right' } }, voice: { ...v, heard: v.heard.map(e => ({ ...e, ago: Math.round(now() - e.at) })) } };
  }
  const refused = (detail, status = 400) => answer({ detail }, status);
  function stepPost(body) {
    recipeStart();
    const c = S.cook, steps = run(); if (!steps.length) return refused('No recipe is loaded', 409);
    const known = Object.fromEntries(steps.map(s => [s.id, s]));
    if ('go' in body) {
      if (body.go === 'next') { const n = upcoming(); if (n != null) begin(n, 'operator'); else if (c.current && !c.status[c.current]) { remember(`${known[c.current].label} done (operator)`); c.status[c.current] = 'done'; } }
      else if (body.go === 'back') begin(c.current == null ? 0 : at(c.current) - 1, 'operator');
      else if (Number.isInteger(body.go) && body.go >= 1 && body.go <= steps.length) begin(body.go - 1, 'operator');
      else return refused('go must be "next", "back" or a step number');
    } else if ('mark' in body) {
      const s = known[body.id]; if (!s || !['done', 'skipped', 'pending'].includes(body.mark)) return refused('mark a step of the recipe "done", "skipped" or "pending"');
      remember(`${s.label} ${body.mark === 'pending' ? 'to come again' : body.mark} (operator)`);
      if (body.id === c.current && body.mark !== 'pending') { const n = upcoming(); if (n != null) begin(n, 'operator', false); c.status[body.id] = body.mark; }
      else if (body.mark === 'pending') delete c.status[body.id]; else c.status[body.id] = body.mark;
    } else if (body.undo) {
      const last = c.undos.pop(); if (!last) return refused('Nothing to undo', 409);
      Object.assign(c, last.state); if (last.recipe) R().recipe = last.recipe;
    } else if (body.skip_prep) {
      const prep = steps.filter(s => s.section === 'prep'); if (!prep.length) return refused('The recipe has no preparation', 409);
      remember('preparation skipped (operator)'); const onPrep = c.current && known[c.current].section === 'prep';
      prep.forEach(s => { if (!c.status[s.id] && s.id !== c.current) c.status[s.id] = 'skipped'; });
      if (onPrep) { const left = c.current, n = pendingFrom(prep.length); if (n != null) { begin(n, 'operator', false); c.status[left] = 'skipped'; } }
    } else if ('pop' in body) { if (!known[body.pop]) return refused('pop up a step of the recipe'); popUp(known[body.pop]); }
    else if ('id' in body) { if (!known[body.id]) return refused('that step is no longer in the recipe'); begin(at(body.id), 'operator'); }
    save(); return answer(recipeRead());
  }
  const shortCaption = text => { const t = text.replace(/\.$/, '').split(/[,;.]/)[0].trim(); return t.length <= 80 ? t : `${t.slice(0, 79).replace(/\s+\S*$/, '')}…`; };
  function freshId(prefix, taken) { for (let n = 1; ; n++) if (!taken.has(`${prefix}${n}`)) return `${prefix}${n}`; }
  function editPost(body) {
    const r = R(); if (!r.recipe) return refused('No recipe is loaded', 409);
    const before = copy(r.recipe), recipe = copy(r.recipe), parts = { prep: recipe.prep = recipe.prep || [], method: recipe.steps };
    const find = id => { for (const [name, list] of Object.entries(parts)) { const n = list.findIndex(s => s.id === id); if (n >= 0) return [name, n]; } return null; };
    const fill = (s, given) => {
      if ('text' in given) { const text = String(given.text || '').trim().slice(0, 400); if (!text) throw new Error('a step needs some words'); if (text !== s.text) { s.text = text; if (!('caption' in given)) s.caption = shortCaption(text); if (!('stations' in given)) s.stations = s.stations || []; } }
      if ('caption' in given) s.caption = String(given.caption || '').trim().slice(0, 80) || shortCaption(s.text);
      if (Array.isArray(given.stations)) s.stations = given.stations.filter(k => r.stations.some(([key]) => key === k)).slice(0, 2);
      return s;
    };
    try {
      if (body.action === 'update') { const f = find(body.id); if (!f) throw new Error('that step is no longer in the recipe'); fill(parts[f[0]][f[1]], body); }
      else if (body.action === 'add') {
        const list = parts[body.section || 'method']; if (!list) throw new Error('a step is in the preparation ("prep") or the method ("method")');
        const taken = new Set([...parts.prep, ...parts.method].map(s => s.id));
        const s = fill({ id: freshId(body.section === 'prep' ? 'p' : 's', taken), stations: [] }, body); if (!s.caption) s.caption = shortCaption(s.text);
        list.splice(Number.isInteger(body.at) ? Math.max(0, Math.min(body.at, list.length)) : list.length, 0, s);
      } else if (body.action === 'delete') { const f = find(body.id); if (!f) throw new Error('that step is no longer in the recipe'); parts[f[0]].splice(f[1], 1); }
      else if (body.action === 'move') {
        const f = find(body.id); if (!f || !Number.isInteger(body.to)) throw new Error('say where the step goes');
        const [s] = parts[f[0]].splice(f[1], 1), target = parts[body.section || f[0]]; target.splice(Math.max(0, Math.min(body.to, target.length)), 0, s);
      } else if (body.action === 'details') {
        if ('title' in body) recipe.title = String(body.title || '').trim() || recipe.title;
        if ('url' in body) recipe.url = String(body.url || '').trim();
        if ('ingredients' in body) recipe.ingredients = (Array.isArray(body.ingredients) ? body.ingredients : String(body.ingredients).split('\n')).map(l => l.trim().replace(/^[-*•]\s*/, '')).filter(Boolean);
      } else throw new Error('the change is "update", "add", "delete", "move" or "details"');
      if (!parts.method.length) throw new Error('the method needs at least one step: add another before deleting this one');
    } catch (error) { return refused(error.message); }
    remember({ update: 'step edited', add: 'step added', delete: 'step deleted', move: 'step moved', details: 'recipe details changed' }[body.action], before);
    r.recipe = recipe;
    const ids = new Set(run().map(s => s.id)), c = S.cook;
    for (const table of [c.status, c.began, c.ran]) for (const id of Object.keys(table)) if (!ids.has(id)) delete table[id];
    if (c.current && !ids.has(c.current)) { c.current = null; const n = pendingFrom(0); if (n != null) begin(n, 'operator', false); }
    save(); return answer(recipeRead());
  }
  function loadPost(body) {
    const r = R();
    if (body.clear) { r.recipe = null; S.cook = { current: null, since: null, status: {}, began: {}, ran: {}, undos: [], history: [], flash: {} }; r.voice.heard = []; save(); return answer(recipeRead()); }
    if (typeof body.text !== 'string' || !body.text.trim()) { note('In the demo a recipe is not read from the web: paste one instead.'); return refused('In this demo nothing is fetched from the web: paste the recipe as text instead'); }
    // Read as recipe.from_text does, by its headings: a title, the ingredients, any preparation, the method.
    const HEAD = { ingredients: 'ingredients', ingredient: 'ingredients', method: 'steps', directions: 'steps', instructions: 'steps', steps: 'steps', preparation: 'prep', prep: 'prep', 'before you start': 'prep', 'mise en place': 'prep', 'before you begin': 'prep' };
    const found = { ingredients: [], prep: [], steps: [], none: [] }; let title = '', part = null;
    for (const raw of body.text.split('\n')) {
      const line = raw.trim(); if (!line) continue;
      const head = HEAD[line.toLowerCase().replace(/:$/, '').trim()]; if (head) { part = head; continue; }
      if (!title && !part && !/^(\d+[.)]|[-*•])\s/.test(line)) { title = line; continue; }
      found[part || 'none'].push(line.replace(/^(step\s*\d+\s*[.):-]?|\d+\s*[.):-]|[-*•])\s*/i, ''));
    }
    if (!found.steps.length) { found.steps = found.none.length ? found.none : found.prep; if (!found.none.length) found.prep = []; }
    if (!found.steps.length) return refused('a recipe needs at least one step');
    const step = (text, id) => ({ id, text, caption: shortCaption(text), stations: [] });
    r.recipe = { title: title || 'Recipe', url: String(body.url || '').trim(), ingredients: found.ingredients, prep: found.prep.map((t, n) => step(t, `p${n + 1}`)), steps: found.steps.map((t, n) => step(t, `s${n + 1}`)) };
    S.cook = { current: null, since: null, status: {}, began: {}, ran: {}, undos: [], history: [], flash: {} };
    save(); return answer(recipeRead());
  }
  function overlayPost(body) {
    const r = R(), o = r.overlay;
    for (const k of ['recipe', 'qr', 'captions', 'obs']) if (typeof body[k] === 'boolean') o[k] = body[k];
    if (typeof body.prep === 'boolean') o.prep = body.prep;
    if (body.follow && r.progress) r.progress.follow = body.follow;
    if (body.obs) { o.scenes = 7; o.problem = null; note('In the demo there is no OBS: the overlay is shown on the programme monitor.'); }
    save(); return answer(recipeRead());
  }

  // What the cook says (speech.py's match, the same phrases and the same refusals, a little simplified).
  const NUM = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12 };
  const normal = text => String(text).toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9'\s-]/g, ' ').replace(/-/g, ' ').split(/\s+/).filter(Boolean)
    .map(w => (w in NUM ? String(NUM[w]) : /^\d+(st|nd|rd|th)$/.test(w) ? w.replace(/\D/g, '') : w)).join(' ');
  const singular = w => (w.length <= 3 || /(ss|us|is)$/.test(w) ? w : /ies$/.test(w) ? `${w.slice(0, -3)}y` : /(oes|ches|shes|xes)$/.test(w) ? w.slice(0, -2) : w.endsWith('s') ? w.slice(0, -1) : w);
  const UNITS = new Set('cup cups tbsp tsp tablespoon tablespoons teaspoon teaspoons g gram grams kg ml l litre litres oz ounce ounces lb lbs pound pounds pinch dash clove cloves can cans tin tins jar jars package packet stick sticks handful bunch sprig sprigs slice slices piece pieces of a an large medium small whole some few little plus optional or to'.split(' '));
  const PREPARED = new Set('chopped diced minced sliced grated softened melted beaten sifted peeled crushed finely roughly thinly freshly fresh cubed halved trimmed crumbled ground packed ripe divided'.split(' '));
  const names = line => String(line).toLowerCase().replace(/\([^)]*\)/g, ' ').split(/,|;|\bto (?:taste|serve)\b|\bfor (?:the )?(?:garnish|serving)\b/)[0].split(/\band\b|\bor\b|\//)
    .map(part => normal(part).split(' ').filter(w => !/^[\d.½¼¾⅓⅔]+$/.test(w) && !UNITS.has(w) && !PREPARED.has(w) && w.length > 1).map(singular).slice(-4)).filter(n => n.length);
  const NEG = /\b(not|don't|dont|didn't|won't|never|isn't|aren't|wasn't|no|can't)\b/;
  const negated = (text, start) => NEG.test(text.slice(0, start).split(' ').slice(-4).join(' '));
  const LED = "(?:on|onto|to|at|for|into|now|start|starting|begin|beginning|it's|its|this is|here's|that's|we're|were|time for|revisit|revisiting|redo|redoing)";
  const STEPS = [[new RegExp(`\\b${LED}\\s+(?:the\\s+|our\\s+)?(?:(prep|preparation)\\s+)?step\\s+(?:number\\s+)?(\\d{1,2})\\b`), 1], [new RegExp(`\\b${LED}\\s+(?:the|our)\\s+(\\d{1,2})\\s+(?:(prep|preparation)\\s+)?step\\b`), 1, true],
    [/\b(?:(prep|preparation)\s+)?step\s+(?:number\s+)?(\d{1,2})\s+(?:now|next|again)\b/, 1], [/^(?:\S+\s+){0,2}?(?:(prep|preparation)\s+)?step\s+(?:number\s+)?(\d{1,2})\b(?!\s+(?:is|was|will|would|can|could|should|where|when|that|of|in)\b)/, 0.85]];
  const ELSEWHERE = /\b(?:in|after|before|from|since|during|like|skip|skipping|until|till)\s+(?:the\s+)?(?:(?:prep|preparation)\s+)?step\s+(?:number\s+)?\d/;
  const NEXT = /\b(?:on|onto|to|for)\s+(?:the|our)\s+next\s+step\b|^(?:\S+\s+){0,2}?(?:the\s+)?next\s+step\b|\bnext\s+step\s*(?:now|then|please)?$|\b(?:moving|move|let's move|lets move|we'll move|carry|carrying|time to move)\s+on\b(?!\s+to\b)/;
  const BACK = /\b(?:go|going|let's go|lets go|we'll go|jump|jumping|step|stepping|head|heading|come|coming)\s+back\s+(?:a|one)\s+step\b|\bback\s+a\s+step\b|\b(?:to|on|onto)\s+(?:the|our)\s+(?:previous|step before)\b|^(?:\S+\s+){0,2}?(?:the\s+)?previous\s+step\b|\bback\s+to\s+(?:the|our)\s+last\s+step\b/;
  const BACK_ELSEWHERE = /\b(?:in|after|before|during|like|from)\s+(?:the|our)\s+(?:previous|last)\s+step\b/;
  const FINAL = /\b(?:on|onto|to|for|at|now)\s+(?:the|our)\s+(?:final|very last|last)\s+step\b|^(?:\S+\s+){0,2}?(?:the\s+)?final\s+step\b/;
  const BACK_TO = /\b(?:go|going|let's go|lets go|we'll go|jump|jumping|head|heading|come|coming|get|getting)?\s*back\s+to\s+(?:the\s+|our\s+)?(.+)$/;
  const JUMP_TO = /\b(?:jump|jumping|skip|skipping|fast forward)\s+(?:ahead\s+|forward\s+|back\s+)?to\s+(?:the\s+|our\s+)?(.+)$/;
  const CALLED = /\b(?:now to|on to|onto|back to|time for|next up|here's|here is|here are|here comes|in goes|in go|let's add|lets add|add our|grab our|our)\b/;
  const MOVING = /\b(?:moving|move|let's move|lets move|we'll move|carry|carrying|going|let's go)\s+on\s+to\s+(?:the\s+|our\s+)?(.+)$/;
  const RECIPE = /\b(?:see|show|look at|have a look at|take a look at|pull up|put up|bring up|check out|pop up)\s+(?:you\s+|us\s+|me\s+|everyone\s+|you guys\s+)?(?:the|that|this|our|my|a)\s+(?:full\s+|whole\s+)?recipe\b(?!\s+(?:calls|says|uses|needs|asks|wants|has|is|was|said|will|book|card)\b)|\bhere's\s+(?:the|that|our|my)\s+(?:full\s+)?recipe\b|\brecipe\s+(?:on|up on)\s+(?:the\s+)?screen\b/;
  const STOP = new Set('the a an to on onto and then our my some of in into with for it its this that now we let\'s go next bit part so okay ok right is are'.split(' '));
  function cues(text) {
    const steps = run(), found = [], elsewhere = ELSEWHERE.test(text);
    for (const [pattern, score, swapped] of STEPS) {
      const m = text.match(pattern); if (!m || negated(text, m.index) || (elsewhere && score === 1)) continue;
      const prep = swapped ? m[2] : m[1], n = Number(swapped ? m[1] : m[2]), section = prep ? 'prep' : 'method';
      const target = steps.find(s => s.section === section && s.number === n);
      found.push({ kind: 'step', score, id: target?.id || null, label: target?.label || `${prep ? 'Prep' : 'Step'} ${n}` }); break;
    }
    if (!found.length) {
      const m = text.match(NEXT), back = text.match(BACK), final = text.match(FINAL), method = steps.filter(s => s.section === 'method');
      if (back && !negated(text, back.index) && !BACK_ELSEWHERE.test(text)) found.push({ kind: 'back', score: 1 });
      else if (final && !negated(text, final.index) && !BACK_ELSEWHERE.test(text) && method.length) found.push({ kind: 'step', score: 1, id: method[method.length - 1].id, label: method[method.length - 1].label });
      else if (m && !negated(text, m.index) && !/\b(?:in|after|before|until|during)\s+(?:the|our)\s+next\s+step\b/.test(text)) found.push({ kind: 'next', score: 1 });
      else {
        // A step by its words: ahead ("moving on to the sauce"), behind ("back to the sauce"), or anywhere ("jump to the eggs").
        const here = S.cook.current == null ? -1 : at(S.cook.current);
        for (const [pattern, keep] of [[MOVING, n => n > here], [BACK_TO, n => n < here], [JUMP_TO, n => n !== here]]) {
          const moving = text.match(pattern);
          if (!moving || negated(text, moving.index)) continue;
          const wanted = moving[1].split(' ').filter(w => !STOP.has(w)).map(singular).slice(0, 6);
          // Equally good matches go to the nearest: "back to the garlic" is the last garlic step, not the first.
          let best = 0, chosen = null;
          steps.map((s, n) => [s, n]).filter(([, n]) => keep(n) && wanted.length).sort((a, b) => Math.abs(a[1] - here) - Math.abs(b[1] - here)).forEach(([s]) => {
            const have = new Set(normal(`${s.caption} ${s.text}`).split(' ').map(singular)); const share = wanted.filter(w => have.has(w)).length / wanted.length;
            if (share > best) { best = share; chosen = s; } });
          if (chosen && best >= 0.5) { found.push({ kind: 'step', score: 0.6 + 0.4 * best, id: chosen.id, label: chosen.label }); break; }
        }
      }
    }
    const r = text.match(RECIPE); if (r && !negated(text, r.index)) found.push({ kind: 'recipe', score: 1 });
    const words = text.split(' ').map(singular), heard = new Set(words), lines = R().recipe?.ingredients || [], seen = [];
    lines.forEach((line, index) => {
      let best = null, where = 0;
      for (const name of names(line)) { const head = name[name.length - 1]; if (!heard.has(head)) continue; const told = name.slice(0, -1).filter(w => heard.has(w)).length;
        if (!best || told > best[0]) best = [told, name.length > 1 ? told / (name.length - 1) : 1]; where = words.indexOf(head); }
      if (best) seen.push({ index, best, where, heads: new Set(names(line).map(n => n[n.length - 1])) });
    });
    for (const one of seen) {
      const rivals = seen.filter(o => o.index !== one.index && [...o.heads].some(h => one.heads.has(h))).map(o => o.best[0]);
      if (rivals.length && one.best[0] <= Math.max(...rivals)) continue;
      const called = CALLED.test(text.split(' ').slice(Math.max(0, one.where - 4), one.where).join(' '));
      found.push({ kind: 'ingredient', score: 0.85 + 0.15 * one.best[1], line: lines[one.index], index: one.index, where: one.where, called });
    }
    return found.sort((a, b) => (a.kind === 'ingredient' && b.kind === 'ingredient' ? a.where - b.where : 0));
  }
  function popUp(s) { S.cook.flash.popup = { label: s.label, of: run().filter(x => x.section === s.section).length, caption: s.caption, until: now() + 8 }; }
  function voicePost(body) {
    recipeStart();
    const r = R(), v = r.voice;
    if (!('say' in body)) {
      if (typeof body.enabled === 'boolean') v.enabled = body.enabled;
      for (const [k, on] of Object.entries(body.cues || {})) if (k in v.cues) v.cues[k] = !!on;
      if (typeof body.device === 'string') { v.device = body.device.trim(); v.source = v.device || 'BlackHole 2ch'; }
      if (body.model) v.model = body.model;
      save(); return answer(recipeRead());
    }
    if (!r.recipe) return refused('No recipe is loaded', 409);
    const t = now(), entry = { at: t, text: String(body.say).slice(0, 240), sure: 1, typed: true, did: null, why: null }, reasons = [];
    const shot = shotCall(entry.text, entry);
    if (entry.did) { v.heard.unshift(entry); v.heard = v.heard.slice(0, 10); save(); return answer({ ...recipeRead(), said: entry }); }
    if (shot) reasons.push(shot);
    S.lastCue = S.lastCue || {};
    const rest = { recipe: 20, step: 4, next: 8, back: 8, ingredient: 5 };
    for (const cue of cues(normal(body.say))) {
      const kind = ['next', 'back'].includes(cue.kind) ? 'step' : cue.kind;
      if (!v.cues[kind]) { reasons.push(`${kind} cues are off`); continue; }
      if (cue.score < v.min_confidence) { reasons.push(`not sure enough (${cue.score.toFixed(2)} of ${v.min_confidence.toFixed(2)} needed)`); continue; }
      const key = cue.kind === 'ingredient' ? `ingredient:${cue.index}` : cue.kind;
      // An ingredient called out ("now to our butter") is shown again even if it just was; named in passing, it rests.
      const resting = cue.kind === 'ingredient' ? (cue.called ? t - (S.lastCue.ingredient || -1e9) < 2 : t - (S.lastCue[key] || -1e9) < 45) : t - (S.lastCue[key] || -1e9) < rest[cue.kind];
      if (resting) { reasons.push('said again too soon'); continue; }
      if (cue.kind === 'recipe') { S.cook.flash.recipe = { until: t + 30 }; entry.did = `showed the recipe${r.recipe.url ? ' and its QR code' : ''} for 30 s`; }
      else if (['step', 'next', 'back'].includes(cue.kind)) {
        if (cue.kind === 'step' && !cue.id) { reasons.push(`heard ${cue.label}, but the recipe has no ${cue.label}`); continue; }
        if (cue.kind === 'step' && cue.id === S.cook.current) { reasons.push(`already on ${cue.label}`); continue; }
        const here = S.cook.current == null ? -1 : at(S.cook.current);
        if (cue.kind === 'back' && here <= 0) { reasons.push('heard “back a step”, but there is no step before this one'); continue; }
        const n = cue.kind === 'next' ? upcoming() : cue.kind === 'back' ? here - 1 : at(cue.id); if (n == null) { reasons.push('heard “next step”, but there is no step after this one'); continue; }
        const s = begin(n, 'voice'); popUp(s); entry.did = `moved to ${s.label} and showed it on screen`;
      } else { S.cook.flash.lower = { text: cue.line, until: t + 6 }; entry.did = `showed “${cue.line}” at the foot of the screen${cue.called ? ' (called out)' : ''}`; S.lastCue.ingredient = t; }
      S.lastCue[key] = t; break;
    }
    if (!entry.did) entry.why = [...new Set(reasons)].join('; ') || 'no cue in it';
    v.heard.unshift(entry); v.heard = v.heard.slice(0, 10);
    save(); return answer({ ...recipeRead(), said: entry });
  }
  // ---- voice shot calls (voicecalls.py): a camera's shot said aloud puts it on air; "Try a phrase" stands in for the host --
  // The phrases each camera answers to are the manager's own, as recorded for each kind of event; the matching is
  // voicecalls.match's, a little simplified: a call word before the phrase, or the phrase said alone; not denied, not a question.
  const mode = () => S.answers['/api/event-mode']?.mode;
  function voiceRead() {
    const recorded = (S.kinds[mode()] || {})['/api/voice'] || S.answers['/api/voice'];
    if (!recorded) return null;
    const v = S.voice = S.voice || { on: {}, phrases: {}, min: null }, shots = copy(recorded.shots), m = shots.mode;
    if (m in v.on) { shots.on = v.on[m] === null ? shots.default : v.on[m]; shots.set = v.on[m] !== null; }
    if (v.min) shots.min_confidence = v.min;
    shots.cameras.forEach(c => {
      if (!(c.id in v.phrases)) return;
      c.phrases = [...v.phrases[c.id].map(p => ({ phrase: p, source: 'own', shared: false })), ...c.phrases.filter(p => p.source !== 'own' && !v.phrases[c.id].some(o => o.toLowerCase() === p.phrase.toLowerCase()))];
    });
    const cue = R()?.voice;
    const heard = (cue ? cue.heard : S.voiceHeard || []).map(e => ({ ...e, ago: Math.round(now() - e.at) }));
    // Zoom calls (voicezoom.py): switched and given phrases of their own for each kind of event, as the manager keeps them.
    const zooms = recorded.zooms ? copy(recorded.zooms) : null;
    if (zooms) {
      const zm = zooms.mode, zon = (v.zoomOn || {})[zm], own = (v.zoomPhrases || {})[zm];
      if (zon !== undefined) { zooms.on = zon === null ? zooms.default : zon; zooms.set = zon !== null; }
      if (own) { zooms.own = own; zooms.phrases = [...own.map(p => ({ ...p, source: 'own' })), ...zooms.phrases.filter(p => p.source !== 'own')]; }
    }
    const spotter = recorded.spotter ? { ...recorded.spotter, ...(typeof v.spotter === 'boolean' ? { enabled: v.spotter } : {}) } : null;
    return { ...recorded, ...(cue ? { enabled: cue.enabled, device: cue.device, source: cue.source, model: cue.model } : {}), spotter, listening: !!(cue ? cue.enabled : recorded.enabled) && (shots.on || mode() === 'cooking'), shots, zooms, heard };
  }
  const LEAD = /\b(?:(?:cut|cutting|switch|switching|go|going|jump|change|move|take|let's go|lets go|let's cut|let's switch)\s+(?:back\s+|over\s+|across\s+)?to|over\s+to|back\s+to|show(?:ing)?(?:\s+(?:me|us|them|you|everyone))?|let's\s+see|lets\s+see|let's\s+look\s+at|give\s+(?:me|us)|camera\s+on|bring\s+up)\s+(?:the\s+|that\s+|our\s+|my\s+|this\s+)?$/;
  const FILLER = new Set(['the', 'a', 'shot', 'camera', 'cam', 'angle', 'view', 'please', 'now', 'okay', 'ok', 'and', 'so', 'right', 'go', 'on', 'over', 'there', 'thanks']);
  const TAIL = new Set(['shot', 'camera', 'cam', 'angle', 'view', 'please', 'now', 'for', 'a', 'sec', 'second', 'moment', 'bit', 'again', 'here', 'there', 'thanks']);
  const NUMBERS = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };
  const plainWords = text => String(text).toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9'\s-]/g, ' ').replace(/-/g, ' ').split(/\s+/).filter(Boolean).map(w => NUMBERS[w] || w);
  const one = w => (w.length > 3 && !/(ss|us|is)$/.test(w) && w.endsWith('s') ? w.slice(0, -1) : w);
  function shotMatch(text, shots) {
    const plain = plainWords(text), heard = plain.map(one), calls = [];
    for (const camera of shots.cameras) for (const p of camera.phrases) {
      if (p.shared) continue;
      const wanted = plainWords(p.phrase).filter(w => !['the', 'a', 'an'].includes(w)).map(one); if (!wanted.length) continue;
      for (let start = 0; start + wanted.length <= heard.length; start++) {
        if (wanted.some((w, i) => heard[start + i] !== w)) continue;
        const before = plain.slice(0, start).join(' '), end = start + wanted.length, lead = before ? `${before} `.match(LEAD) : null;
        const bare = !lead && plain.slice(0, start).every(w => FILLER.has(w)) && plain.slice(end).every(w => TAIL.has(w));
        if (!lead && !bare) continue;
        if (lead && /\b(?:not|don't|dont|never|won't|wont|can't|cannot|shouldn't|didn't)\s*$/.test(before.slice(0, lead.index).trim().split(' ').slice(-2).join(' '))) continue;
        calls.push({ id: camera.id, name: camera.name, phrase: p.phrase, score: lead ? 1 : 0.85, length: wanted.length, own: p.source === 'own' });
      }
    }
    if (!calls.length) return { why: shots.cameras.some(c => c.phrases.some(p => plainWords(p.phrase).every(w => heard.includes(one(w))))) ? 'a camera named in passing, not called' : null };
    if (/\?\s*$|^(?:should|shall|could|can|would|will|do|does|is|are|what|why|how|when|where|which|who)\b/i.test(text.trim())) return { why: 'a question, not a call' };
    calls.sort((a, b) => b.length - a.length || b.own - a.own); return calls[0];
  }
  // A phrase as the manager's Speech.hear takes it: a camera called first; null when it called none (the recipe's cues then).
  function shotCall(text, entry) {
    const state = voiceRead(); if (!state || !state.shots.on) return null;
    const call = shotMatch(text, state.shots), t = now(), d = director();
    if (!call.id) return call.why;
    if (call.score < state.shots.min_confidence) return `not sure enough of “${call.phrase}” for ${call.name} (${call.score.toFixed(2)} of ${state.shots.min_confidence.toFixed(2)} needed)`;
    if (!d.usable.includes(call.id)) return `heard ${call.name}, but it has no picture to show (not streaming)`;
    const hold = Number(d.hold_seconds || state.shots.hold_seconds || 30);
    if (d.on_air === call.id && !d.pair) entry.did = `kept ${call.name} on air for another ${Math.round(hold)} s`;
    else { cutTo(call.id, true); entry.did = `cut to ${call.name}; the director holds it ${Math.round(hold)} s`; }
    d.hold_until = t + hold; entry.kind = 'shot';
    if (chat()) said('director', `Heard “${text.slice(0, 120)}”: ${entry.did}.`, { system: true, voice: true });
    return '';
  }
  function voiceShotPost(body) {
    const cue = R()?.voice, v = S.voice = S.voice || { on: {}, phrases: {}, min: null };
    if ('say' in body) {
      const text = String(body.say || '').split(/\s+/).join(' ').trim().slice(0, 240); if (!text) return refused('say a phrase, 240 characters at most');
      const entry = { at: now(), text, sure: 1, typed: true, did: null, why: null };
      const why = shotCall(text, entry);
      if (!entry.did) entry.why = why || 'no camera called';
      const list = cue ? cue.heard : (S.voiceHeard = S.voiceHeard || []); list.unshift(entry); list.splice(10);
      save(); return answer({ ...voiceRead(), said: entry });
    }
    if (typeof body.listen === 'boolean' && cue) cue.enabled = body.listen;
    if ('on' in body) v.on[mode()] = body.on;
    for (const [id, list] of Object.entries(body.phrases || {})) v.phrases[id] = [...new Set((list || []).map(p => String(p).split(/\s+/).join(' ').trim()).filter(Boolean))].slice(0, 8);
    if (typeof body.min_confidence === 'number') v.min = body.min_confidence;
    if ('zoom_on' in body) (v.zoomOn = v.zoomOn || {})[mode()] = body.zoom_on;
    if (typeof body.spotter === 'boolean') v.spotter = body.spotter;
    if (Array.isArray(body.zoom_phrases)) (v.zoomPhrases = v.zoomPhrases || {})[mode()] = body.zoom_phrases.slice(0, 12).map(p => ({ phrase: String(p.phrase || '').split(/\s+/).join(' ').trim().slice(0, 40), action: p.action, camera: p.camera || 'on_air' })).filter(p => p.phrase);
    if (cue && typeof body.device === 'string') { cue.device = body.device.trim(); cue.source = cue.device || 'BlackHole 2ch'; }
    if (cue && body.model) cue.model = body.model;
    save(); return answer(voiceRead());
  }
  // On the programme monitor, what the overlay would lay over the programme now.
  function overlayNow() {
    const c = S.cook, r = R(); if (!c || !r?.recipe || !cooking()) return [];
    const t = now(), shown = [], f = c.flash || {};
    if (f.popup && f.popup.until > t) shown.push(['popup', `${f.popup.label} of ${f.popup.of}`, f.popup.caption]);
    else if (r.overlay.recipe || (f.recipe && f.recipe.until > t)) shown.push(['card', r.recipe.title, c.current ? run()[at(c.current)]?.label || '' : '']);
    if (f.lower && f.lower.until > t) shown.push(['lower', f.lower.text, '']);
    return shown;
  }

  // ---- answers -----------------------------------------------------------------------------------------
  const answer = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  function read(path, query) {
    const a = S.answers;
    if (path === '/api/stage') return { ...a['/api/stage'], director: director() };
    if (path === '/api/stage/place') return placing();
    if (path === '/api/coolers/job') return S.coolerJob || {};
    if (path === '/api/explain') return explainState();
    if (path === '/api/temperatures') {
      const exact = a[`${path}?${query}`]; if (exact) return exact;
      const key = Object.keys(a).find(k => k.startsWith('/api/temperatures?')); return key ? a[key] : { cameras: [] };
    }
    if (path === '/api/scene-chat' && a[path]) { chatActive(); return a[path]; }
    if (path === '/api/recipe' && a[path]) return recipeRead();
    if (path === '/api/voice') return voiceRead();
    if (path in a) return a[path];
    if (path.startsWith('/api/commands/')) return { state: 'SUCCEEDED', result: { type: 'ack', ok: true } };
    return null;
  }
  function operatePost(main) {
    // The Operate page's Main stage and Previous shot: as the manager does, a person's choice, held.
    const d = director();
    const target = main ? d.default_shot : (d.previous || null);
    if (!target) return answer({ detail: main ? 'No stage shot is set: choose a default shot on the Director page' : 'No earlier shot to go back to' }, 409);
    const camera = cams().cameras.find(c => c.id === target || `Cam ${c.name}` === target);
    d.previous = d.on_air; d.on_air = camera ? camera.id : null; d.scene = camera ? `Cam ${camera.name}` : target;
    save(); note('In the demo the gimbals are drawn, so nothing turns; the shot changes on the programme monitor.');
    return answer(d);
  }
  function coolersPost(kind) {
    // Forget all, or Re-pair all: the simulated phones are already right, so re-pairing gives each its own cooler back,
    // as the manager would from what the phones heard; forgetting clears them.
    const done = [];
    for (const camera of cams().cameras) {
      const c = camera.telemetry?.cooler;
      if (!camera.telemetry?.capabilities?.cooler || !c) continue;
      if (kind === 'forget') { if (c.address) { done.push({ camera: camera.name, cooler: null }); for (const x of [c, camera.cooler]) if (x) x.address = null; camera.cooler = null; } }
      else done.push(c.address ? { camera: camera.name, cooler: c.address, name: c.name, rssi: -42, how: 'heard it loudest, -42 dBm' } : { camera: camera.name, cooler: null });
    }
    S.coolerJob = { kind, state: 'done', step: '', done, skipped: [], failed: [], unclaimed: [] };
    save(); note(kind === 'repair' ? 'In the demo each phone hears its own cooler loudest, so each keeps it.' : 'In the demo the coolers are let go at once.');
    return answer(S.coolerJob);
  }
  function accessoryPost(id, body) {
    // Move here: the cooler or gimbal goes from one simulated camera's report to the other's, as the phones would say.
    const all = cams().cameras, to = all.find(c => c.id === id), from = all.find(c => c.id === body.from), kind = body.kind;
    if (!to || !from || !['cooler', 'gimbal'].includes(kind) || !from[kind]?.address) return answer({ detail: 'Nothing to move' }, 409);
    for (const key of ['telemetry', null]) {
      const a = key ? from.telemetry : from, b = key ? to.telemetry : to;
      if (!a || !b) continue;
      b[kind] = JSON.parse(JSON.stringify(a[kind]));
      a[kind] = kind === 'gimbal' && key ? { ...a[kind], address: null, name: '', state: 'none', connected: false } : null;
    }
    save(); note(`In the demo the ${kind} moves at once; a real one connects to its new phone within a few seconds.`);
    return answer({ request_id: 'demo', state: 'SUCCEEDED', result: { type: 'ack', ok: true, demo: true } });
  }
  function renamePost(id, body) {
    // As the manager does: 1 to 80 characters, no two cameras alike. Other pages keep the recorded name until Start over.
    const camera = cams().cameras.find(c => c.id === id); if (!camera) return answer({ detail: 'No such camera' }, 404);
    const name = String(body.name || '').split(/\s+/).filter(Boolean).join(' ');
    if (name.length < 1 || name.length > 80) return answer({ detail: 'Give the camera a name of 1 to 80 characters' }, 400);
    if (cams().cameras.some(c => c.id !== id && c.name.toLowerCase() === name.toLowerCase())) return answer({ detail: `There is already a camera called ${name}` }, 409);
    const was = camera.name; camera.name = name;
    // OBS takes the new name too (scenes.rename): its source, its scene and its split screens, and a default shot naming one.
    const scenes = {};
    if (was !== name) {
      scenes[`Cam ${was}`] = `Cam ${name}`;
      for (const other of cams().cameras.filter(c => c.id !== id)) {
        scenes[`Split ${was} + ${other.name}`] = `Split ${name} + ${other.name}`; scenes[`Split ${other.name} + ${was}`] = `Split ${other.name} + ${name}`;
      }
      const d = director(); for (const key of ['default_shot', 'scene']) if (d[key] in scenes) d[key] = scenes[d[key]];
    }
    save();
    return answer({ camera_id: id, name, was, obs: was === name ? { sources: {}, scenes: {}, skipped: [] } : { sources: { [was]: name }, scenes: { [`Cam ${was}`]: `Cam ${name}` }, skipped: [] } });
  }
  function gimbalStagePost(id, body) {
    // Aiming from the stage (stageaim.py): Set keeps the angles it reports now as the middle of the stage; Centre stage
    // turns it back to them; Forget drops them. As the manager answers, from the simulated phone's report.
    const camera = cams().cameras.find(c => c.id === id); if (!camera) return answer({ detail: 'No such camera' }, 404);
    const g = camera.gimbal, a = camera.telemetry?.gimbal?.attitude;
    if (!g?.stage) return answer({ detail: 'This camera’s gimbal cannot be aimed from the stage' }, 409);
    if (!['calibrate', 'centre', 'forget'].includes(body.action)) return answer({ detail: 'action is calibrate, centre or forget' }, 400);
    if (body.action === 'forget') { Object.assign(g.stage, { calibrated: false, at: null, state: null, why: null }); S.gimbalCentre = null; }
    else if (body.action === 'calibrate') {
      if (!a) return answer({ detail: 'Gimbal: the gimbal is not reporting its angles' }, 409);
      S.gimbalCentre = { pan: a.pan, tilt: a.tilt };
      Object.assign(g.stage, { calibrated: true, at: now() });
      note('Calibrated: the manager now turns this gimbal towards whoever the wide shot sees, when it loses them. In the demo the pictures are drawn, so nobody is found in them.');
    } else {
      if (!g.stage.calibrated) return answer({ detail: 'Calibrate it first: aim it at the middle of the stage and press Set' }, 409);
      const centre = S.gimbalCentre || { pan: 0, tilt: -6 };
      for (const x of [a, g.attitude].filter(Boolean)) { x.pan = centre.pan; x.tilt = centre.tilt; }
    }
    save();
    return answer(g.stage);
  }
  function gimbalPlanPost(id, body) {
    // A gimbal camera's follow plan (gimbalpick.py), from its card or the Operate page: what takes over, whom it follows in
    // what order, and following by the plan on or off. As the manager answers; nothing turns, the pictures are drawn.
    const camera = cams().cameras.find(c => c.id === id); if (!camera) return answer({ detail: 'No such camera' }, 404);
    const g = camera.gimbal; if (!g?.plan) return answer({ detail: 'This camera’s gimbal cannot follow performers' }, 409);
    for (const k of ['solos', 'prominent', 'anyone', 'zoom']) if (k in body) { if (typeof body[k] !== 'boolean') return answer({ detail: 'solos, prominent, anyone and start are true or false' }, 400); g.plan[k] = body[k]; }
    if (Array.isArray(body.order)) {
      const names = Object.fromEntries((g.choices || []).map(c => [c.id, c.name]));
      if (body.order.some(o => !names[o])) return answer({ detail: 'order is a list of enrolled, consenting performers, while recognition is on' }, 400);
      g.plan.order = body.order.map(o => ({ id: o, name: names[o] })); g.plan.count = body.order.length;
      for (const c of g.choices || []) c.chosen = body.order.includes(c.id);
    }
    if ('start' in body) {
      for (const x of [g, camera.telemetry?.gimbal].filter(Boolean)) x.follow = body.start ? { state: 'following', hands_on: false, by: 'face', pace: x.follow?.pace || 'normal' } : null;
      if (body.start) note('In the demo the camera says it follows by its plan, but the pictures are drawn, so nobody is recognised and nothing turns.');
    }
    const first = g.plan.order?.[0];
    g.performer = g.follow && (g.plan.count || g.plan.anyone) ? (first ? { name: first.name, seen_seconds: 0.6, why: null, reason: 'first in its order', anyone: false } : { name: null, seen_seconds: null, why: null, reason: 'anyone in view (none of its performers is)', anyone: true }) : null;
    save();
    return answer({ plan: g.plan, outcome: null });
  }
  function gimbalHomePost(id, body) {
    // A gimbal camera's home position: Set keeps the angles it reports now, Home turns it back (and stops following).
    const camera = cams().cameras.find(c => c.id === id); if (!camera) return answer({ detail: 'No such camera' }, 404);
    const g = camera.gimbal, a = camera.telemetry?.gimbal?.attitude || g?.attitude;
    if (!g?.home) return answer({ detail: 'Gimbal: the camera app cannot turn to a position' }, 409);
    if (!['set', 'go', 'forget'].includes(body.action)) return answer({ detail: 'action is set, go or forget' }, 400);
    if (body.action === 'forget') g.home = { set: false };
    else if (body.action === 'set') { if (!a) return answer({ detail: 'Gimbal: the phone is not reporting where it points' }, 409); g.home = { set: true, pan: a.pan, tilt: a.tilt, stale: false }; }
    else {
      if (!g.home.set) return answer({ detail: 'No home position yet: aim it, then Set home' }, 409);
      for (const x of [camera.telemetry?.gimbal, g].filter(Boolean)) { x.follow = null; if (x.attitude) { x.attitude.pan = g.home.pan; x.attitude.tilt = g.home.tilt; } }
      g.performer = null;
      note('In the demo the gimbal says it is back home, but the pictures are drawn, so nothing moves.');
    }
    save();
    return body.action === 'go' ? answer({ state: 'SUCCEEDED', demo: true }) : answer({ home: g.home });
  }
  function gimbalPerformerPost(id, body) {
    // One performer by name: the plan's order becomes just them, and it follows by the plan.
    return gimbalPlanPost(id, body.performer ? { order: [body.performer], start: true } : { order: [], start: false });
  }
  // The Operate page's live feeds: the demo's drawn stills (operate.js asks for these when it is here).
  window.concertDemo = Object.assign(window.concertDemo || {}, { feed: id => `/api/colour/preview/${encodeURIComponent(id)}` });
  let gimbalNoted = false;
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
        if (p.look) note('In the demo no other cooler is near: Move here takes one from another camera.');
        // Its fan speed as measured on a real one in each mode, and the line the card shows, as the manager writes it.
        const level = c.fan_level || 3;
        c.fan_rpm = { silent: 3050, smart: 3560, overclock: 5800, overclock_streaming: 5800, manual: 3930 + (level - 1) * 470 }[c.fan] || c.fan_rpm;
        const mode = { overclock_streaming: 'overclock while streaming', manual: `fixed speed ${level}` }[c.fan] || c.fan;
        if (typeof c.summary === 'string') c.summary = c.summary.replace(/^Cooler: [^,]*, [\d,]+ rpm/, `Cooler: ${mode}, ${c.fan_rpm.toLocaleString('en')} rpm`);
      }
    }
    else if (what === 'settings.update' && 'rotation' in (body.parameters || {})) {
      // The picture turned round; in the demo the pictures are drawn, so they stay as they are.
      t.rotation = body.parameters.rotation; note('In the demo the pictures are drawn, so they are not turned round.');
    }
    else if (what.startsWith('gimbal.')) {
      // As the simulated phone does: it says it is turning while an arrow is held, and keeps which way its axes go.
      // Nothing turns: the pictures are drawn.
      const p = body.parameters || {};
      for (const g of [t.gimbal, camera.gimbal].filter(x => x && typeof x === 'object')) {
        if (what === 'gimbal.settings') for (const k of ['swap', 'invert_pan', 'invert_tilt', 'upside_down']) if (k in p) g[k] = !!p[k];
        if (what === 'gimbal.move' || what === 'gimbal.stop') g.moving = what === 'gimbal.move' && !!(p.pan || p.tilt);
        if (what === 'gimbal.follow') { if (p.on && !g.follow) explainTracking(id, true); g.follow = p.on ? { state: 'following', hands_on: false } : null; }
        // Its angles, as the simulated phone reports them: the arrows turn them, a point takes them there.
        if (g.attitude && what === 'gimbal.move') { g.attitude.pan = Math.round(((g.attitude.pan + (p.pan || 0) * 0.27 + 540) % 360 - 180) * 10) / 10; g.attitude.tilt = Math.round(Math.max(-90, Math.min(90, g.attitude.tilt + (p.tilt || 0) * 0.27)) * 10) / 10; }
        if (g.attitude && what === 'gimbal.point') { g.attitude.pan = p.pan_deg; if ('tilt_deg' in p) g.attitude.tilt = p.tilt_deg; g.point = { state: 'arrived', pan_deg: p.pan_deg, tilt_deg: p.tilt_deg ?? null, pan_left: 0 }; }
        if ('summary' in g) g.summary = (g.moving ? 'Gimbal: connected, moving' : 'Gimbal: connected') + (g.follow ? '; following' : '');
      }
      if (what === 'gimbal.move' && !gimbalNoted) { gimbalNoted = true; note('In the demo the gimbal says it turns, but the pictures are drawn, so nothing moves.'); }
      if (p.look) note('In the demo no other gimbal is near: Move here takes one from another camera.');
      if (what === 'gimbal.follow' && p.on) note('In the demo the camera says it follows the most prominent face, but the pictures are drawn, so nothing moves.');
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
    if (path === '/api/voice') return voiceShotPost(body);
    if (path === '/api/explain') return explainPost(body);
    const m = path.match(/^\/api\/cameras\/([^/]+)\/commands$/); if (m) return command(decodeURIComponent(m[1]), body);
    const fleet = path.match(/^\/api\/coolers\/(forget|repair)$/); if (fleet) return coolersPost(fleet[1]);
    if (path === '/api/operate/control') return answer({ camera_id: body.camera_id, sent: body.pan || body.tilt ? 'gimbal.move' : null, zoom_percent: null, said: null });
    if (path === '/api/operate/main' || path === '/api/operate/previous') return operatePost(path.endsWith('main'));
    if (path === '/api/operate/settings') { if (![12, 24].includes(body.rate)) return answer({ detail: 'rate is 12 or 24' }, 400); S.answers['/api/operate/settings'] = { rate: body.rate }; save(); return answer({ rate: body.rate }); }
    const moved = path.match(/^\/api\/cameras\/([^/]+)\/accessory$/); if (moved) return accessoryPost(decodeURIComponent(moved[1]), body);
    const staged = path.match(/^\/api\/cameras\/([^/]+)\/gimbal-stage$/); if (staged) return gimbalStagePost(decodeURIComponent(staged[1]), body);
    const homed = path.match(/^\/api\/cameras\/([^/]+)\/gimbal-home$/); if (homed) return gimbalHomePost(decodeURIComponent(homed[1]), body);
    const planned = path.match(/^\/api\/cameras\/([^/]+)\/gimbal-(plan|performer)$/); if (planned) return (planned[2] === 'plan' ? gimbalPlanPost : gimbalPerformerPost)(decodeURIComponent(planned[1]), body);
    const named = path.match(/^\/api\/cameras\/([^/]+)\/name$/); if (named) return renamePost(decodeURIComponent(named[1]), body);
    if (path === '/api/obs/names') return answer({ sources: {}, scenes: {}, skipped: [] });     // renaming in the demo already carried through
    if (path === '/api/stage' && (body.layout || body.widths || body.room)) return stagePost(body);
    if (path === '/api/stage/place') return placePost(body);
    if (S.answers['/api/recipe']) {
      const recipeAnswer = { '/api/recipe': loadPost, '/api/recipe/step': stepPost, '/api/recipe/edit': editPost, '/api/recipe/voice': voicePost, '/api/overlay': overlayPost }[path];
      if (recipeAnswer) return recipeAnswer(body);
    }
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
    // What the overlay lays over the programme in Cooking: a step popped up, the recipe, an ingredient named.
    const layer = box.querySelector('.ovl'), over = overlayNow(), key = JSON.stringify(over);
    if (layer.dataset.key !== key) { layer.dataset.key = key; layer.replaceChildren(...over.map(([kind, top, line]) => { const el = document.createElement('div'); el.className = `o-${kind}`; const b = document.createElement('b'); b.textContent = top; el.append(b); if (line) { const s = document.createElement('span'); s.textContent = line; el.append(s); } return el; })); }
    box.querySelector('.rec').hidden = !d.recording; box.querySelector('.live').hidden = !d.streaming;
  }
  const css = `
    #demo-bar{position:fixed;right:12px;bottom:12px;z-index:9999;background:#2a1f05;color:#ffe2a6;border:1px solid #8a6a1c;border-radius:999px;padding:5px 8px 5px 14px;font:13px/1.3 system-ui,sans-serif;max-width:calc(100vw - 24px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 6px 24px rgba(0,0,0,.45)}
    #demo-bar b{color:#fff} #demo-bar a{color:#ffd27a} #demo-bar button{margin:0 0 0 8px;padding:2px 8px;font-size:12px;background:transparent;color:#ffe2a6;border:1px solid #8a6a1c;border-radius:6px;cursor:pointer}
    #demo-monitor{position:fixed;right:12px;top:12px;z-index:9998;width:240px;background:#0b1117;border:1px solid #547087;border-radius:10px;overflow:hidden;font:12px system-ui,sans-serif;color:#cfe0ee;box-shadow:0 6px 24px rgba(0,0,0,.45)}
    #demo-monitor .pics{display:flex;aspect-ratio:16/9;background:#000} #demo-monitor .pics img{flex:1;min-width:0;object-fit:cover}
    #demo-monitor .row{display:flex;gap:6px;align-items:center;padding:5px 8px} #demo-monitor .what{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #demo-monitor .tag{background:#1d3a50;color:#fff;border-radius:4px;padding:1px 5px;font-weight:600} #demo-monitor .rec{background:#a3261c} #demo-monitor .live{background:#a3261c}
    #demo-monitor{position:fixed} #demo-monitor .ovl{position:absolute;inset:0 0 auto 0;aspect-ratio:16/9;pointer-events:none;font:9px/1.25 system-ui,sans-serif}
    #demo-monitor .ovl div{position:absolute;background:rgba(14,18,24,.86);color:#fff;border-radius:3px;padding:3px 5px;max-width:55%;overflow:hidden}
    #demo-monitor .ovl b,#demo-monitor .ovl span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #demo-monitor .o-popup,#demo-monitor .o-card{top:6px;right:6px;border-left:2px solid #f6c35b} #demo-monitor .o-popup b,#demo-monitor .o-card b{color:#f6c35b}
    #demo-monitor .o-lower{bottom:8px;left:6px;border-left:2px solid #7fc8a9}
    #demo-monitor.small .pics,#demo-monitor.small .ovl{display:none}
    #demo-note{position:fixed;left:50%;transform:translateX(-50%);bottom:70px;z-index:9999;background:#1e2c39;color:#eef4f8;border:1px solid #547087;border-radius:8px;padding:6px 12px;font:13px system-ui,sans-serif}
    @media (max-width:700px){#demo-monitor{width:132px;top:auto;bottom:108px;right:8px}#demo-bar{right:8px;left:8px;bottom:70px;font-size:12px;white-space:normal;border-radius:12px}}`;
  function decorate() {
    const style = document.createElement('style'); style.textContent = css; document.head.append(style);
    const bar = document.createElement('div'); bar.id = 'demo-bar'; bar.setAttribute('role', 'note');
    bar.innerHTML = '<b>Demo</b> · simulated cameras, nothing connected · <a href="https://github.com/MCVSAID/mcvsaid-app">About</a> · <a href="mailto:mcvsaid@proton.me?subject=MCVSAID%20beta">Join the beta</a><button type="button" id="demo-reset" title="Put everything back as it was">Start over</button><button type="button" id="demo-hide" aria-label="Hide this note">×</button>';
    bar.title = 'The real MCVSAID dashboard, running in your browser with simulated cameras. Nothing is connected and nothing you press leaves your browser; the pictures are drawn stills, not video.';
    const mon = document.createElement('div'); mon.id = 'demo-monitor'; mon.setAttribute('aria-label', 'Programme monitor (simulated)');
    mon.innerHTML = '<div class="pics"></div><div class="ovl" aria-live="polite"></div><div class="row"><span class="tag">PGM</span><span class="what"></span><span class="tag rec" hidden>REC</span><span class="tag live" hidden>LIVE</span></div>';
    mon.title = 'What the programme shows: a still drawn by the demo for the camera on air'; mon.onclick = () => mon.classList.toggle('small'); if (innerWidth < 700) mon.classList.add('small');
    const toast = document.createElement('div'); toast.id = 'demo-note'; toast.hidden = true; toast.setAttribute('aria-live', 'polite');
    document.body.append(bar, mon, toast);
    bar.querySelector('#demo-hide').onclick = () => { bar.hidden = true; };
    bar.querySelector('#demo-reset').onclick = () => { try { sessionStorage.removeItem(KEY); } catch (error) { /* */ } location.reload(); };
    ready.then(() => { tick(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', decorate); else decorate();
})();
