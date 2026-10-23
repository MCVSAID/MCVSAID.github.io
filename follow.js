'use strict';
// Whom a camera's gimbal follows, and its follow plan (gimbalpick.py): one control for the camera card (app.js) and
// the Operate page's tiles (operate.js), so the two are the same setting. A page gives it how to reach the manager:
//   ctx.post(path, body)                     a POST to the manager, resolving to its answer or throwing its message
//   ctx.send(camera, command, parameters, label)   a command to the phone, as the page sends them
//   ctx.refresh(), ctx.tell(message), ctx.role ('admin' or 'operator'), ctx.off (the controls disabled)
// Names of performers reach an administrator only; others see how many a camera follows.
(() => {
  function node(tag, text, className) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
  const STATES = { searching: 'looking for someone', lost: 'lost them; still', no_picture: 'no picture to follow by: start the camera' };
  const RULES = [['solos', 'Solos take over', 'While the sound hears a solo, whoever plays that instrument (their instruments on the People page), even if they are not in the list below. A solo nobody enrolled plays turns a gimbal aimed from the stage to where that instrument stands.'],
                 ['prominent', 'Prominent players too', 'An instrument that has been loudest in the sound for a few seconds takes over without a solo being declared. Voices are left out: a singer is to the fore most of a song.'],
                 ['anyone', 'Anyone else when none of them is in view', 'Rather than holding an empty spot: the phone follows whichever face it sees, so a guest who walks on from the other side is in shot.']];

  function block(camera, ctx) {
    const gimbal = camera.gimbal || {}, plan = gimbal.plan, admin = ctx.role === 'admin', id = encodeURIComponent(camera.id);
    const box = node('div', undefined, 'gimbal-follow');
    // A choice made lets go of the list, so a page that redraws (into) shows what it did.
    box.addEventListener('change', event => { if (event.target.tagName === 'SELECT') event.target.blur(); }, true);
    const post = async (path, body, label) => {
      try { await ctx.post(`/api/cameras/${id}/${path}`, body); } catch (error) { ctx.tell(`${camera.name}: ${label}: ${error.message}`); }
      ctx.refresh();
    };
    // Whom: nobody, the most prominent face (the phone's own choice), one performer, or the follow plan.
    const follows = node('p', 'Follow: '), pick = document.createElement('select'); pick.setAttribute('aria-label', 'Whom the gimbal follows'); pick.disabled = ctx.off;
    const choices = [['off', 'Nobody'], ['face', 'The most prominent face']];
    if (gimbal.choices) for (const performer of gimbal.choices) choices.push([`performer:${performer.id}`, performer.name]);
    if (plan) choices.push(['plan', 'By its follow plan (below)']);
    else if (gimbal.performer) choices.push(['plan', 'Its performer']);
    const chosen = (gimbal.choices || []).filter(p => p.chosen), ruled = plan && RULES.some(([key]) => plan[key]);
    const now = !gimbal.follow ? 'off' : gimbal.performer ? (chosen.length === 1 && !ruled ? `performer:${chosen[0].id}` : 'plan') : 'face';
    for (const [value, text] of choices) { const option = node('option', text); option.value = value; option.selected = value === now; pick.append(option); }
    pick.onchange = () => {
      const value = pick.value;
      if (value.startsWith('performer:')) return post('gimbal-performer', { performer: value.slice(10) }, 'Follow');
      if (value === 'plan') return post('gimbal-plan', { start: true }, 'Follow by its plan');
      const leave = gimbal.performer ? ctx.post(`/api/cameras/${id}/gimbal-plan`, { start: false }).catch(() => {}) : Promise.resolve();
      leave.then(() => ctx.send(camera, 'gimbal.follow', value === 'off' ? { on: false } : { on: true, who: 'face' }, value === 'off' ? 'Follow off' : 'Follow the most prominent face')).then(() => ctx.refresh());
    };
    follows.append(pick);
    // How quickly (app 0.9.35): kept by the phone, sent with Follow or on its own while following.
    if ((camera.telemetry || {}).capabilities?.gimbal_follow_pace) {
      const pace = document.createElement('select'); pace.setAttribute('aria-label', 'How quickly the gimbal follows'); pace.disabled = ctx.off;
      for (const [value, text] of [['calm', 'Calm'], ['normal', 'Normal'], ['quick', 'Quick']]) { const option = node('option', text); option.value = value; option.selected = value === (gimbal.follow?.pace || 'normal'); pace.append(option); }
      pace.onchange = () => ctx.send(camera, 'gimbal.follow', { on: !!gimbal.follow, pace: pace.value }, `Follow speed: ${pace.value}`);
      follows.append(node('span', ' Speed: '), pace);
    }
    // How it is going, and why it is on whom it is.
    if (gimbal.follow) {
      const f = gimbal.follow;
      follows.append(node('span', ` · ${f.state === 'following' ? f.hands_on ? 'paused while you aim' : f.by === 'person' ? 'following, by their body (face not seen)' : 'following' : STATES[f.state] || f.state}`));
    }
    const performer = gimbal.performer;
    if (performer) {
      const who = performer.anyone ? 'anyone in view' : performer.name || (performer.seen_seconds != null ? 'its performer' : '');
      const parts = [performer.reason ? `on: ${performer.reason}` : '', who && performer.seen_seconds != null ? `${who} seen ${performer.seen_seconds} s ago` : '', performer.why || ''].filter(Boolean);
      if (parts.length) follows.append(node('span', ` · ${parts.join(' · ')}`, 'follow-why'));
    }
    box.append(follows);
    // The plan: who, first choice first (an administrator), and what may take over.
    if (plan) {
      const details = node('details', undefined, 'follow-plan'); details.open = now === 'plan' || ruled || plan.count > 1;
      details.append(node('summary', `Follow plan${plan.count ? ` · ${plan.count} performer${plan.count === 1 ? '' : 's'}` : ''}${ruled ? ' · ' + RULES.filter(([key]) => plan[key]).map(([, text]) => text.split(' ')[0].toLowerCase()).join(', ') : ''}`));
      if (admin && plan.order) {
        const list = node('ol', undefined, 'follow-order'), order = plan.order.map(p => p.id);
        const save = ids => post('gimbal-plan', { order: ids }, 'Follow plan');
        plan.order.forEach((p, n) => {
          const item = node('li'); item.append(node('span', p.name));
          const up = node('button', '↑'); up.title = `Put ${p.name} before ${plan.order[n - 1]?.name || ''}`; up.setAttribute('aria-label', `Move ${p.name} up`); up.disabled = ctx.off || n === 0;
          up.onclick = () => { const ids = [...order]; [ids[n - 1], ids[n]] = [ids[n], ids[n - 1]]; save(ids); };
          const drop = node('button', '✕'); drop.title = `Stop following ${p.name}`; drop.setAttribute('aria-label', `Remove ${p.name}`); drop.disabled = ctx.off;
          drop.onclick = () => save(order.filter(x => x !== p.id));
          item.append(' ', up, ' ', drop); list.append(item);
        });
        const others = (gimbal.choices || []).filter(p => !order.includes(p.id));
        details.append(plan.order.length ? list : node('p', 'Nobody in the list yet.'));
        if (others.length) {
          const add = document.createElement('select'); add.setAttribute('aria-label', 'Add a performer to the follow plan'); add.disabled = ctx.off;
          add.append(node('option', 'Add a performer…'));
          for (const p of others) { const option = node('option', `${p.name}${p.plays?.length ? ` (${p.plays.join(', ').replace(/_/g, ' ')})` : ''}`); option.value = p.id; add.append(option); }
          add.onchange = () => { if (add.value && add.selectedIndex > 0) save([...order, add.value]); };
          details.append(add);
        }
      } else details.append(node('p', plan.count ? `It follows ${plan.count} performer${plan.count === 1 ? '' : 's'}, in an order an administrator sets.` : 'An administrator chooses whom it follows, and in what order.'));
      for (const [key, text, hint] of RULES) {
        const line = node('label', undefined, 'follow-rule'), tick = document.createElement('input'); tick.type = 'checkbox'; tick.checked = !!plan[key]; tick.disabled = ctx.off; tick.title = hint;
        tick.onchange = () => post('gimbal-plan', { [key]: tick.checked }, text);
        line.title = hint; line.append(tick, node('span', ` ${text}`)); details.append(line);
      }
      details.append(node('small', 'First choice first: a solo, then a prominent player (when ticked), then the list in order, then anyone. It stays on someone at least four seconds before a better choice takes over, and two more after a solo ends. The arrows and controllers always win: following waits while you aim.'));
      box.append(details);
    }
    return box;
  }

  // For a page that redraws often (the Operate page): rebuilt only when what it shows changed, and never while one of
  // its lists is being chosen from (a button or tick that keeps focus after a click does not hold it back).
  function into(holder, camera, ctx) {
    const g = camera.gimbal || {};
    const signature = JSON.stringify([g.follow, g.performer, g.plan, g.choices, ctx.off, ctx.role]);
    if (holder.dataset.signature === signature || (holder.contains(document.activeElement) && document.activeElement.tagName === 'SELECT')) return;
    const open = holder.querySelector('details')?.open;
    holder.dataset.signature = signature;
    holder.replaceChildren(block(camera, ctx));
    const details = holder.querySelector('details'); if (details && open !== undefined) details.open = open;
  }

  window.gimbalFollow = { block, into };
})();
