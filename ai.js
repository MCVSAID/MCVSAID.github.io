'use strict';
// AI assistance (camera_manager/ai.py): how much AI helps the director, and setting a level up. Drawn on the Director page
// (#ai-setup), where an administrator opening an AI page for the first time is asked to choose, and under System › This
// PC (#ai-system), where the level can be changed at any time. Each step either has a button, for what the manager can
// do by itself, or the command to run, for what needs an administrator's password. Administrators only.
(() => {
  const NOT_NOW = 'mcvsaid-ai-not-now';
  let state = null, failed = null, loadedAt = 0;
  const remembered = () => { try { return localStorage.getItem(NOT_NOW) === '1'; } catch (error) { return false; } };
  const remember = on => { try { if (on) localStorage.setItem(NOT_NOW, '1'); else localStorage.removeItem(NOT_NOW); } catch (error) { /* private window */ } };
  const el = (tag, text, className) => { const made = document.createElement(tag); if (text != null) made.textContent = text; if (className) made.className = className; return made; };

  async function send(body) {
    try { state = await api('/api/ai', { method: 'POST', body: JSON.stringify(body) }); failed = null; }
    catch (error) { failed = error.message; }
    loadedAt = Date.now(); draw(true);
  }

  function levels(container, current) {
    const list = el('div', null, 'ai-levels');
    for (const level of state.tiers) {
      const fits = state.hardware.fits[level.id] || { ok: true, why: '' };
      const card = el('article', null, `ai-level${level.id === current ? ' chosen' : ''}`);
      card.append(el('h4', level.name + (level.id === current ? ' (in use)' : '')), el('p', level.about));
      card.append(el('small', (fits.ok ? '✓ This computer: ' : '⚠ This computer: ') + fits.why, fits.ok ? '' : 'warn'));
      if (level.id !== current) {
        const choose = el('button', level.id === 'none' ? 'Use No AI' : `Set up ${level.name}`);
        choose.onclick = async () => {
          if (level.id === 'none' && !await concert.sure('Switch AI assistance off? The model stops choosing shots and zooming; what is installed stays, ready for later.')) return;
          remember(false); send({ tier: level.id });
        };
        card.append(choose);
      }
      list.append(card);
    }
    container.append(list);
  }

  function steps(container) {
    const list = el('ol', null, 'ai-steps');
    for (const step of state.steps) {
      const item = el('li', null, step.done ? 'done' : step.job?.state === 'failed' ? 'failed' : step.job?.state === 'running' ? 'running' : 'todo');
      item.append(el('strong', `${step.done ? '✓' : '○'} ${step.title}`), el('span', ` — ${step.detail}`));
      if (step.job?.state === 'running') {
        const bar = el('progress'); if (step.job.progress != null) { bar.max = 1; bar.value = step.job.progress; }
        item.append(el('br'), bar, el('small', ` ${step.job.detail || 'working…'}`));
      } else if (step.job?.state === 'failed') item.append(el('br'), el('small', `Did not work: ${step.job.detail}`, 'warn'));
      else if (step.job?.state === 'done' && !step.done) item.append(el('br'), el('small', step.job.detail));
      if (!step.done && step.command) {
        const box = el('div', null, 'ai-command');
        box.append(el('small', step.admin ? 'Needs an administrator: run this in Terminal, and type the password it asks for there (it is never typed here):' : 'Run this in Terminal:'));
        const code = el('code', step.command), copy = el('button', 'Copy');
        copy.onclick = async () => { try { await navigator.clipboard.writeText(step.command); copy.textContent = 'Copied'; } catch (error) { copy.textContent = 'Select and copy'; } };
        box.append(el('br'), code, copy); item.append(box);
      }
      if (!step.done && step.link) { const go = el('a', 'Open the People page'); go.href = step.link; go.className = 'button'; item.append(el('br'), go); }
      if (!step.done && step.action && step.job?.state !== 'running') {
        const run = el('button', step.action); run.onclick = () => send({ run: step.id }); item.append(el('br'), run);
      }
      list.append(item);
    }
    container.append(list);
  }

  function panel(container, where) {
    container.replaceChildren(el('h2', 'AI assistance'));
    if (failed) container.append(el('p', failed, 'warn'));
    if (!state) { container.append(el('p', 'Looking at what this computer has…')); return; }
    const current = state.tier;
    const firstTime = !state.chosen && current === 'none';
    const quiet = where === 'director' && current === 'none' && remembered();
    if (quiet) {
      const line = el('p', 'No AI: shots are chosen by hand, on Stage Shots or by timed rotation. ');
      const open = el('button', 'Set up AI assistance…'); open.onclick = () => { remember(false); draw(); };
      line.append(open); container.append(line); return;
    }
    if (current === 'none') {
      container.append(el('p', firstTime ? 'How much should AI help direct the show? This installation starts with No AI, which runs on any computer. Standard and Plus add a vision model on this computer; choose one to see what setting it up takes here.'
                                         : 'AI assistance is off. Choose a level to see what setting it up takes on this computer.'));
      levels(container, current);
      if (where === 'director') { const later = el('button', 'Not now'); later.onclick = () => { remember(true); draw(); }; container.append(later); }
      return;
    }
    const heading = el('p', state.ready ? `${state.name} is set up and in use.` : `${state.name}: ${state.steps.filter(s => s.done).length} of ${state.steps.length} steps done.`);
    container.append(heading);
    if (where === 'director' && state.ready) {
      const more = el('details'); more.append(el('summary', 'The set-up, and other levels')); steps(more); levels(more, current); container.append(more);
    } else { steps(container); const other = el('details'); other.append(el('summary', 'Other levels')); levels(other, current); container.append(other); }
  }

  function draw(force = false) {
    // A button just pressed keeps the focus: after an action the panel is redrawn anyway; otherwise not while in use.
    if (force && document.activeElement?.closest?.('.ai-setup')) document.activeElement.blur();
    const director = document.querySelector('#ai-setup'), system = document.querySelector('#ai-system');
    const admin = (window.concert?.session?.role || 'admin') === 'admin';
    for (const [container, where] of [[director, 'director'], [system, 'system']]) {
      if (!container) continue;
      if (!admin) { container.replaceChildren(); continue; }
      if (!container.hidden && (force || !container.contains(document.activeElement))) panel(container, where);
    }
  }

  async function load() {
    const visible = ['#ai-setup', '#ai-system'].some(id => { const c = document.querySelector(id); return c && !c.hidden; });
    if (!visible || typeof csrf === 'undefined' || !csrf || (window.concert?.session?.role || 'admin') !== 'admin') return;
    const running = state?.steps?.some(s => s.job?.state === 'running');
    if (state && Date.now() - loadedAt < (running ? 2000 : 15000)) { draw(); return; }
    try { state = await api('/api/ai'); failed = null; } catch (error) { failed = error.message; }
    loadedAt = Date.now(); draw();
  }
  setInterval(load, 1000);
})();
