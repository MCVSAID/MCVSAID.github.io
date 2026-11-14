'use strict';
// The set layout (setlayout.py), under the room map: what is drawn under the cameras for this kind of event, and the
// panel below the map that changes it. Reached in Arrange, from Room map. Uses stage.js's state and helpers and
// room.js's map: loaded after both, on the manager's dashboard only.
//
// A map from photos. Ordinary photos of the set (from a phone, or what a camera here sees now) are straightened into
// a view from above through four points on the floor, each photo by a homography (a plane seen in perspective is the
// same plane seen from above, through one 3x3 matrix fixed by four points). The first photo's four points are the
// corners of something on the floor of known size (a rug, floor tiles, tape marks, the foot of a riser): that fixes the
// map's scale in metres as well. A further photo is joined on by marking four points in it and the same four on the map
// so far. Where photos overlap, each spot of the map is taken from the photo that sees it nearest (lowest in that
// photo). It is all done here in the browser: the photos are never sent anywhere, only the map made from them.
// What is not on the floor's level leans away from where each photo was taken: a counter's foot is in the right place,
// its top stretched. Lens distortion is not corrected (the phones' main lenses correct their own; an ultrawide bends).
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const panel = document.querySelector('#set');
  let layer = null, view = { W: 1000, H: 800 }, key = '', picking = null, held = null, chosenShape = null;
  const local = { shapes: null };                         // shapes being moved, before they are saved
  const set = () => state?.room?.set;
  const layout = () => set()?.layout;
  function svg(tag, attributes = {}, parent) { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attributes)) e.setAttribute(k, v); if (parent) parent.append(e); return e; }
  const round = v => Math.round(v * 10000) / 10000;
  const clamp = (v, low, high) => Math.min(high, Math.max(low, v));
  const shapesNow = () => local.shapes || layout()?.shapes || [];

  // -- homographies ---------------------------------------------------------------------------------------------
  // The 3x3 matrix taking four points to four others (each [x, y]), from the eight equations they give.
  function homography(from, to) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = from[i], [u, v] = to[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    for (let c = 0; c < 8; c++) {                         // Gaussian elimination with partial pivoting
      let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-12) return null;        // three of the points in a line
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
    }
    const h = b.map((v, i) => v / A[i][i]);
    return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
  }
  const apply = (M, x, y) => { const w = M[2][0] * x + M[2][1] * y + M[2][2]; return [(M[0][0] * x + M[0][1] * y + M[0][2]) / w, (M[1][0] * x + M[1][1] * y + M[1][2]) / w, w]; };
  function invert(M) {
    const [[a, b, c], [d, e, f], [g, h, i]] = M, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-15) return null;
    return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
  }
  // A quadrilateral marked in order round its edge is not twisted (its corners all turn the same way).
  function plain(points) {
    const turns = points.map((p, n) => { const q = points[(n + 1) % 4], r = points[(n + 2) % 4]; return Math.sign((q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0])); });
    return turns.every(t => t === turns[0] && t !== 0);
  }

  // -- the map from photos --------------------------------------------------------------------------------------
  // A photo is read at most LONGEST_PHOTO wide and the map made MAP_PIXELS wide. The map reaches at most REACH times the
  // reference's size round it, and takes in only floor a photo sees clearly: where one of its pixels covers no more
  // than STRETCH times the floor one covers at the reference (towards the horizon a pixel covers more and more floor,
  // and the map would be smears).
  const LONGEST_PHOTO = 2000, MAP_PIXELS = 1600, REACH = 2, STRETCH = 9;
  const photos = { list: [], marking: null, mapping: [], reference: { w: '', d: '' }, made: null, why: '', bounds: null, trimming: [] };
  // How much floor (square metres) one pixel of a photo covers at a point of it.
  function cover(M, u, v) {
    const [x, y] = apply(M, u, v), [x1, y1] = apply(M, u + 1, v), [x2, y2] = apply(M, u, v + 1);
    return Math.abs((x1 - x) * (y2 - y) - (y1 - y) * (x2 - x));
  }
  // A photo, read here: turned as the phone held it, and at most LONGEST_PHOTO wide.
  async function read(blob, name) {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const scale = Math.min(1, LONGEST_PHOTO / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close?.();
    return { name, canvas, pixels: context.getImageData(0, 0, canvas.width, canvas.height), points: [], toWorld: null };
  }

  // The map: every photo's floor, from above, in metres, the first photo's reference's far left corner at 0, 0.
  function make() {
    const ready = photos.list.filter(p => p.toWorld);
    if (!ready.length) return null;
    const first = ready[0], ref = { w: Number(photos.reference.w), d: Number(photos.reference.d) };
    const middle = [ref.w / 2, ref.d / 2], reach = clamp(REACH * Math.max(ref.w, ref.d), 6, 30);
    // How far the floor goes: each photo's grid of points carried onto the floor, in front of it and near the reference.
    let x0 = 0, y0 = 0, x1 = ref.w, y1 = ref.d;
    const centre = first.points.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]), clear = STRETCH * cover(first.toWorld, ...centre);
    for (const photo of ready) for (let i = 0; i <= 32; i++) for (let j = 0; j <= 32; j++) {
      const u = (photo.canvas.width - 1) * i / 32, v = (photo.canvas.height - 1) * j / 32, [X, Y, w] = apply(photo.toWorld, u, v);
      if (w <= 0 || Math.hypot(X - middle[0], Y - middle[1]) > reach || cover(photo.toWorld, u, v) > clear) continue;
      x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
    }
    if (photos.bounds) ({ x0, y0, x1, y1 } = photos.bounds);          // trimmed by hand
    // Within the shapes a map may have (0.25 to 2 times as deep as wide), kept round the reference.
    let width = x1 - x0, depth = y1 - y0;
    if (depth > 2 * width) { const keep = 2 * width, centre = clamp(middle[1], y0 + keep / 2, y1 - keep / 2); y0 = centre - keep / 2; y1 = centre + keep / 2; depth = keep; }
    if (depth < 0.25 * width) { const keep = 4 * depth, centre = clamp(middle[0], x0 + keep / 2, x1 - keep / 2); x0 = centre - keep / 2; x1 = centre + keep / 2; width = keep; }
    const W = MAP_PIXELS, H = Math.round(W * depth / width), perMetre = W / width;
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const context = canvas.getContext('2d'), out = context.createImageData(W, H);
    const back = ready.map(p => invert(p.toWorld));
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      const X = x0 + (px + 0.5) / perMetre, Y = y0 + (py + 0.5) / perMetre;
      let best = -1, sx = 0, sy = 0, from = null;
      ready.forEach((photo, n) => {
        if (!back[n]) return;
        const [u, v, w] = apply(back[n], X, Y);
        // Seen by this photo, in front of it, and nearer its bottom edge (nearer the camera) than any other photo has it.
        if (w <= 0 || u < 0 || v < 0 || u >= photo.canvas.width - 1 || v >= photo.canvas.height - 1 || cover(photo.toWorld, u, v) > clear) return;
        const near = v / photo.canvas.height;
        if (near > best) { best = near; sx = u; sy = v; from = photo; }
      });
      const o = (py * W + px) * 4;
      if (!from) { out.data[o] = 20; out.data[o + 1] = 29; out.data[o + 2] = 38; out.data[o + 3] = 255; continue; }
      const i = (Math.floor(sy) * from.canvas.width + Math.floor(sx)) * 4;
      out.data[o] = from.pixels.data[i]; out.data[o + 1] = from.pixels.data[i + 1]; out.data[o + 2] = from.pixels.data[i + 2]; out.data[o + 3] = 255;
    }
    context.putImageData(out, 0, 0);
    // The reference outlined, so it can be checked against what is on the floor.
    context.strokeStyle = '#ffd166'; context.lineWidth = 3; context.setLineDash([12, 8]);
    context.strokeRect((0 - x0) * perMetre, (0 - y0) * perMetre, ref.w * perMetre, ref.d * perMetre);
    return { canvas, x0, y0, perMetre, width, depth, photos: ready.length };
  }

  // The first photo: its four points are the reference's corners, far left first and round clockwise, so the far side
  // of the floor is at the top of the map, as the stage is on the room map.
  function straighten(photo) {
    const w = Number(photos.reference.w), d = Number(photos.reference.d);
    if (!(w >= 0.1 && w <= 100 && d >= 0.1 && d <= 100)) return 'Give the size of what the four points mark, in metres (0.1 to 100).';
    if (!plain(photo.points)) return 'The four points cross over: mark them in order round the edge, far left, far right, near right, near left.';
    photo.toWorld = homography(photo.points, [[0, 0], [w, 0], [w, d], [0, d]]);
    return photo.toWorld ? '' : 'Three of those points are in a line: mark four corners.';
  }
  // A further photo: four points in it, and the same four on the map so far (in its pixels).
  function join(photo, onMap) {
    const made = photos.made;
    if (!plain(photo.points) || !plain(onMap)) return 'The four points cross over: mark them in the same order round the edge, in the photo and on the map.';
    photo.toWorld = homography(photo.points, onMap.map(([x, y]) => [made.x0 + x / made.perMetre, made.y0 + y / made.perMetre]));
    return photo.toWorld ? '' : 'Three of those points are in a line: mark four spread out.';
  }

  // -- drawn on the room map ------------------------------------------------------------------------------------
  // Under the cameras: the background, the shapes (the main area brighter), the saved gimbal targets and a scale bar.
  window.setLayer = (root, W, H, before) => {
    view = { W, H, root };
    layer = svg('g', { class: 'set' }); root.insertBefore(layer, before);
    drawnKey = ''; draw();
  };
  function point(event) {
    const m = view.root.getScreenCTM().inverse(), p = new DOMPoint(event.clientX, event.clientY).matrixTransform(m);
    return { x: clamp(p.x / view.W, 0, 1), y: clamp(p.y / view.H, 0, 1) };
  }
  let drawnKey = '';
  function draw() {
    if (!layer || !layout()) return;
    const L = layout(), { W, H } = view, editing = !panel.hidden && picking === null;
    // Drawn afresh only when something in it changed: the page refreshes every second.
    const wanted = JSON.stringify([{ ...L, cameras: undefined }, local.shapes, editing, chosenShape, picking && picking.marks, set().targets, W, H, layer.isConnected]);
    if (wanted === drawnKey) return;
    drawnKey = wanted;
    layer.replaceChildren(); layer.classList.toggle('over-plan', !!L.background);
    if (L.background) {
      // (The clickable demo shows a picture made in the visit from the visitor's own browser: concertDemo.setPicture.)
      const href = window.concertDemo?.setPicture?.(L.background.image) || `/api/stage/set/picture/${L.background.image}`;
      const image = svg('image', { href, x: 0, y: 0, width: W, height: H, preserveAspectRatio: 'none', class: 'backdrop' }, layer);
      image.addEventListener('error', () => { image.remove(); result.textContent = 'The set’s background picture is not on this computer (a settings file carries the layout but not its pictures; a location file carries both).'; }, { once: true });
    }
    shapesNow().forEach(shape => {
      const g = svg('g', { class: `shape ${shape.kind}${shape.main ? ' main' : ''}${chosenShape === shape.id ? ' chosen' : ''}${editing ? ' editable' : ''}`, 'data-id': shape.id }, layer);
      const box = { x: shape.x * W, y: shape.y * H, width: shape.w * W, height: shape.h * H };
      if (shape.round) svg('ellipse', { cx: box.x + box.width / 2, cy: box.y + box.height / 2, rx: box.width / 2, ry: box.height / 2 }, g);
      else svg('rect', { ...box, rx: 6 }, g);
      const label = svg('text', { x: box.x + box.width / 2, y: box.y + box.height / 2, 'text-anchor': 'middle' }, g);
      label.textContent = shape.label; label.style.fontSize = `${Math.max(12, Math.min(28, box.height * 0.35, box.width / Math.max(4, shape.label.length) * 1.6))}px`;
      if (editing) { const grip = svg('rect', { class: 'grip', x: box.x + box.width - 14, y: box.y + box.height - 14, width: 28, height: 28, rx: 4 }, g); wire(g, shape, grip); }
    });
    for (const [id, spot] of Object.entries(L.targets || {})) {
      const about = set().targets[id]; if (!about) continue;
      const g = svg('g', { class: 'target', transform: `translate(${spot.x * W} ${spot.y * H})` }, layer);
      svg('path', { d: 'M0 -11 L11 0 L0 11 L-11 0 Z' }, g);
      const t = svg('text', { y: -16, 'text-anchor': 'middle' }, g); t.textContent = about.name;
    }
    if (L.width_m) {                                          // a scale bar of a round number of metres
      const metres = [0.5, 1, 2, 5, 10, 20, 50].find(m => m / L.width_m * W >= 90) || 50, long = metres / L.width_m * W;
      const g = svg('g', { class: 'scalebar', transform: `translate(${W - long - 24} ${H - 24})` }, layer);
      svg('line', { x1: 0, y1: 0, x2: long, y2: 0 }, g);
      const t = svg('text', { x: long / 2, y: -10, 'text-anchor': 'middle' }, g); t.textContent = `${metres} m`;
    }
    if (picking) {
      const catcher = svg('rect', { x: 0, y: 0, width: W, height: H, class: 'catcher' }, layer);
      (picking.marks || []).forEach(m => svg('circle', { cx: m.x * W, cy: m.y * H, r: 9, class: 'picked' }, layer));
      catcher.addEventListener('click', event => picking.then(point(event)));
    }
  }

  // A shape is dragged to move it and by its corner to size it; saved when let go.
  function wire(g, shape, grip) {
    g.addEventListener('pointerdown', event => {
      const how = event.target === grip ? 'size' : 'move';
      held = { id: shape.id, how, from: point(event), start: { ...shape }, moved: false };
      local.shapes = shapesNow().map(s => ({ ...s })); chosenShape = shape.id;
      g.setPointerCapture(event.pointerId); event.preventDefault(); event.stopPropagation(); window.roomBusy = true;
    });
    g.addEventListener('pointermove', event => {
      if (!held || held.id !== shape.id) return;
      const at = point(event), s = local.shapes.find(o => o.id === shape.id), dx = at.x - held.from.x, dy = at.y - held.from.y;
      if (!held.moved && Math.hypot(dx * view.W, dy * view.H) < 3) return;
      held.moved = true;
      if (held.how === 'move') { s.x = round(clamp(held.start.x + dx, 0, 1 - s.w)); s.y = round(clamp(held.start.y + dy, 0, 1 - s.h)); }
      else { s.w = round(clamp(held.start.w + dx, 0.02, 1 - s.x)); s.h = round(clamp(held.start.h + dy, 0.02, 1 - s.y)); }
      draw();
    });
    const drop = async () => {
      if (!held || held.id !== shape.id) return;
      const was = held; held = null; window.roomBusy = false;
      if (!was.moved) { local.shapes = null; key = ''; panelDraw(); draw(); return; }
      await saveShapes(local.shapes);
    };
    g.addEventListener('pointerup', drop); g.addEventListener('pointercancel', drop);
  }

  async function change(body) {
    const answer = await act('/api/stage/set', body);
    if (answer) state = answer;
    local.shapes = null; key = ''; window.stageDraw();
    return answer;
  }
  const saveShapes = shapes => change({ shapes: shapes.map(({ id, kind, label, x, y, w, h, main, round: r }) => ({ id, kind, label, x, y, w, h, ...(main ? { main } : {}), ...(r ? { round: r } : {}) })) });

  async function upload(body, query) {
    result.textContent = 'Sending…';
    try {
      const r = await fetch(`/api/stage/set/background?${new URLSearchParams(query)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': csrf }, body });
      const d = await r.json();
      if (!r.ok) throw Error(d.detail || `HTTP ${r.status}`);
      state = d; result.textContent = ''; key = ''; window.stageDraw(); return d;
    } catch (error) { result.textContent = error.message; return null; }
  }

  // -- the panel ------------------------------------------------------------------------------------------------
  const section = (title, intro) => { const box = node('div', undefined, 'part'); box.append(node('h3', title)); if (intro) box.append(node('p', intro, 'quiet')); return box; };
  const labelled = (text, input) => { const l = node('label', text); l.append(input); return l; };
  function input(type, value, attributes = {}) { const e = document.createElement('input'); e.type = type; if (value !== undefined) e.value = value; for (const [k, v] of Object.entries(attributes)) e.setAttribute(k, v); return e; }
  function choice(options, value) { const s = document.createElement('select'); for (const [v, t] of options) { const o = node('option', t); o.value = v; s.append(o); } if (value !== undefined) s.value = value; return s; }
  // Asks for points on the map, one press each; `done` is given them.
  function pick(count, asking, done) {
    const marks = [];
    picking = { marks, then: spot => { marks.push(spot); if (marks.length === count) { picking = null; done(marks); } else hint.textContent = asking(marks.length); draw(); } };
    hint.textContent = asking(0); draw();
  }

  function panelDraw() {
    const s = set(), L = layout();
    const wanted = JSON.stringify([s?.mode, L && { ...L, cameras: undefined }, Object.keys(s?.targets || {}), state.cameras.map(c => [c.id, c.name])]);
    if (wanted === key && panel.childElementCount) return;
    key = wanted; panel.replaceChildren();
    panel.append(node('h2', `The set, for ${s.mode_name}`));
    panel.append(node('p', L ? `${L.background ? { photos: `A map made from ${L.background.photos || 1} photo${(L.background.photos || 1) > 1 ? 's' : ''} of the set`, pdf: `A floor plan (page ${L.background.page} of ${L.background.pages})`, image: 'A floor plan picture' }[L.background.from] : 'Shapes on a plain floor'}${L.width_m ? `, ${L.width_m < 10 ? L.width_m.toFixed(1) : Math.round(L.width_m)} m across` : ', not to scale yet'}. Cameras placed here are this kind of event’s own.`
      : 'The plain stage. Give this kind of event a set of its own: a map from photos, a floor plan, or a template to change.', 'quiet'));
    panel.append(photosPart());
    panel.append(planPart(), templatePart());
    if (L) panel.append(shapesPart(), scalePart(), targetsPart(), removePart());
  }

  // Photos: the way most sets will be mapped. Built once and kept, so marking points survives the page's refreshes.
  let photosBox = null;
  function photosPart() {
    if (photosBox) { photosDraw(); return photosBox; }
    photosBox = section('Map from photos', 'Take a photo or two of the set from where you can see its floor: a phone is fine, or use what a camera here sees now. Mark four points on the floor in each, and the photos are straightened into a map from above. The photos stay in this browser: only the map is kept.');
    photosBox.append(node('div', undefined, 'photo-work'));
    photosDraw(); return photosBox;
  }
  function photosDraw() {
    const work = photosBox.querySelector('.photo-work'); work.replaceChildren();
    const first = photos.list[0], current = photos.marking !== null ? photos.list[photos.marking] : null;
    // Where photos come from.
    const adding = node('div', undefined, 'row');
    const files = input('file', undefined, { accept: 'image/jpeg,image/png,image/heic,image/webp', multiple: '' });
    files.onchange = async () => {
      for (const file of files.files) {
        try { photos.list.push(await read(file, file.name)); } catch (error) { photos.why = `${file.name}: this browser cannot read that picture.`; }
      }
      if (photos.marking === null) photos.marking = photos.list.findIndex(p => !p.toWorld);
      if (photos.marking < 0) photos.marking = null;
      photosDraw();
    };
    adding.append(labelled(photos.list.length ? 'Add photos ' : 'Photos of the set ', files));
    const online = state.cameras.filter(c => c.online);
    if (online.length) {
      const which = choice(online.map(c => [c.id, `${shows(c)} (${c.name})`])), grab = node('button', 'Use what it sees');
      grab.onclick = async () => {
        grab.disabled = true;
        try {
          const r = await fetch(`/api/stage/set/grab/${encodeURIComponent(which.value)}`);
          if (!r.ok) throw Error((await r.json()).detail);
          photos.list.push(await read(await r.blob(), `${online.find(c => c.id === which.value).name} now`));
          if (photos.marking === null) photos.marking = photos.list.length - 1;
          photos.why = '';
        } catch (error) { photos.why = error.message; }
        photosDraw();
      };
      adding.append(labelled('or a camera ', which), grab);
    }
    work.append(adding);
    if (photos.why) work.append(node('p', photos.why, 'warn'));
    if (!photos.list.length) {
      work.append(node('p', 'Best: a photo from high up and well back, with the whole floor of the set in it. Four points on the floor of something whose size you know: the corners of a rug or a run of floor tiles, tape marks put down for it, the foot of a riser or counter. Not a table top: everything off the floor’s level leans away in the map.', 'quiet'));
      return;
    }
    if (current) {
      const isFirst = current === first;
      const steps = isFirst ? ['the far left corner', 'the far right corner', 'the near right corner', 'the near left corner'] : ['a first point', 'a second', 'a third', 'a fourth'];
      work.append(node('p', current.points.length < 4 ? `${current.name}: press ${steps[current.points.length]}${isFirst ? ' of what you know the size of, on the floor' : ', on the floor and on the map so far, going round in order'}.` : `${current.name}: four points marked.`, 'step'));
      work.append(marker(current, (x, y) => { if (current.points.length < 4) { current.points.push([x, y]); photosDraw(); } }));
      const row = node('div', undefined, 'row');
      const undo = node('button', 'Undo a point'); undo.disabled = !current.points.length; undo.onclick = () => { current.points.pop(); photos.mapping = []; photosDraw(); };
      const skip = node('button', 'Leave this photo out'); skip.onclick = () => { photos.list.splice(photos.marking, 1); next(); photosDraw(); };
      row.append(undo, skip); work.append(row);
      if (isFirst && current.points.length === 4) {
        const w = input('number', photos.reference.w, { min: '0.1', max: '100', step: '0.01', 'aria-label': 'Width in metres, far left to far right' });
        const d = input('number', photos.reference.d, { min: '0.1', max: '100', step: '0.01', 'aria-label': 'Depth in metres, far to near' });
        w.oninput = () => { photos.reference.w = w.value; }; d.oninput = () => { photos.reference.d = d.value; };
        const go = node('button', 'Straighten'); go.className = 'primary';
        go.onclick = () => { photos.why = straighten(current); if (!photos.why) { photos.made = make(); next(); } photosDraw(); };
        const size = node('div', undefined, 'row'); size.append(labelled('Its width ', w), node('span', 'm'), labelled(' by depth ', d), node('span', 'm'), go);
        work.append(size);
      }
      if (!isFirst && current.points.length === 4 && photos.made) {
        work.append(node('p', `Now the same four points on the map, in the same order (${photos.mapping.length} of 4).`, 'step'));
        if (photos.mapping.length === 4) {
          photos.why = join(current, photos.mapping); photos.mapping = [];
          if (!photos.why) { photos.made = make(); next(); }
          setTimeout(photosDraw); return;
        }
      }
    }
    if (photos.made) {
      const made = photos.made;
      work.append(node('p', `The map so far: ${made.width.toFixed(1)} by ${made.depth.toFixed(1)} m, from ${made.photos} photo${made.photos > 1 ? 's' : ''}. The yellow outline is your reference: check it lies on what you marked.`, 'quiet'));
      const joining = current && current !== photos.list[0] && current.points.length === 4;
      // Trimming: two opposite corners of the part to keep, pressed on the map.
      const cutting = photos.cutting && !joining;
      if (cutting) work.append(node('p', `Press ${photos.trimming.length ? 'the opposite corner' : 'one corner'} of the part of the map to keep.`, 'step'));
      const pressed = joining ? (x, y) => { photos.mapping.push([x, y]); photosDraw(); }
        : cutting ? (x, y) => {
          photos.trimming.push([made.x0 + x / made.perMetre, made.y0 + y / made.perMetre]);
          if (photos.trimming.length === 2) {
            const [[a, b], [c, d]] = photos.trimming;
            if (Math.abs(c - a) > 0.5 && Math.abs(d - b) > 0.5) photos.bounds = { x0: Math.min(a, c), y0: Math.min(b, d), x1: Math.max(a, c), y1: Math.max(b, d) };
            photos.trimming = []; photos.cutting = false; photos.made = make();
          }
          photosDraw();
        } : null;
      work.append(marker({ canvas: made.canvas, points: joining ? photos.mapping : cutting ? photos.trimming.map(([X, Y]) => [(X - made.x0) * made.perMetre, (Y - made.y0) * made.perMetre]) : [] }, pressed));
      const row = node('div', undefined, 'row');
      const use = node('button', 'Use this map for the set'); use.className = 'primary';
      use.onclick = async () => {
        use.disabled = true;
        const blob = await new Promise(done => made.canvas.toBlob(done, 'image/jpeg', 0.9));
        const d = await upload(blob, { kind: 'photos', width_m: made.width.toFixed(3), photos: made.photos, depth: (made.canvas.height / made.canvas.width).toFixed(4) });
        if (d && !layout()?.shapes?.length) result.textContent = 'Map kept. Add shapes over it below (the counter, the stove, the table) to name what is where: the main one is where the shots are.';
        use.disabled = false;
      };
      const trim = node('button', photos.trimming.length ? `Trimming: ${photos.trimming.length} of 2 corners` : 'Trim to a box');
      trim.onclick = () => { photos.trimming = []; photos.cutting = true; photosDraw(); };
      const whole = node('button', 'Untrim'); whole.hidden = !photos.bounds; whole.onclick = () => { photos.bounds = null; photos.made = make(); photosDraw(); };
      const again = node('button', 'Start again'); again.onclick = () => { Object.assign(photos, { list: [], marking: null, mapping: [], made: null, why: '', bounds: null, trimming: [], cutting: false }); photosDraw(); };
      row.append(use, trim, whole, again); work.append(row);
    }
  }
  window.setPhotos = photos;                              // the photos being mapped, to look at from the browser's console
  function next() { const n = photos.list.findIndex(p => !p.toWorld); photos.marking = n < 0 ? null : n; }

  // A picture with its points drawn on it, pressed to add one.
  function marker(item, onPress) {
    const holder = node('div', undefined, 'marker'), canvas = document.createElement('canvas');
    canvas.width = item.canvas.width; canvas.height = item.canvas.height;
    const c = canvas.getContext('2d'); c.drawImage(item.canvas, 0, 0);
    const r = Math.max(6, canvas.width / 120);
    c.lineWidth = r / 2.5; c.strokeStyle = '#ffd166'; c.fillStyle = '#ffd166'; c.font = `bold ${r * 2.2}px system-ui`;
    if (item.points.length > 1) { c.beginPath(); item.points.forEach(([x, y], n) => n ? c.lineTo(x, y) : c.moveTo(x, y)); if (item.points.length === 4) c.closePath(); c.stroke(); }
    item.points.forEach(([x, y], n) => { c.beginPath(); c.arc(x, y, r, 0, 2 * Math.PI); c.fill(); c.fillText(String(n + 1), x + r * 1.4, y - r * 1.4); });
    if (onPress) { canvas.classList.add('pressable'); canvas.onclick = event => { const box = canvas.getBoundingClientRect(); onPress((event.clientX - box.left) * canvas.width / box.width, (event.clientY - box.top) * canvas.height / box.height); }; }
    holder.append(canvas); return holder;
  }

  function planPart() {
    const box = section('Floor plan', `A picture (PNG or JPEG, up to ${set().limits.picture_mb} MB) or a PDF (up to ${set().limits.pdf_mb} MB and ${set().limits.pages} pages; its page is drawn on the manager).`);
    const file = input('file', undefined, { accept: 'image/png,image/jpeg,application/pdf' }), page = input('number', '1', { min: '1', max: String(set().limits.pages), step: '1' });
    const go = node('button', 'Use it');
    go.onclick = async () => {
      const f = file.files[0]; if (!f) { result.textContent = 'Choose a file first.'; return; }
      go.disabled = true;
      const pdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
      // A picture is drawn afresh here first: turned as it was taken, and without what a photo carries besides itself.
      let body = f;
      if (!pdf) { try { const p = await read(f, f.name); body = await new Promise(done => p.canvas.toBlob(done, 'image/png')); } catch (error) { /* sent as it is: checked and cleaned there */ } }
      await upload(body, { kind: pdf ? 'pdf' : 'image', page: page.value || '1' });
      go.disabled = false;
    };
    const row = node('div', undefined, 'row'); row.append(file, labelled('PDF page ', page), go); box.append(row);
    return box;
  }

  function templatePart() {
    const s = set(), box = section('Start from a template', layout() ? 'Starts this set afresh: its shapes and map are replaced (cameras keep their places).' : 'Shapes to move and resize, for each kind of event.');
    const which = choice([...s.templates.map(t => [t.id, `${t.name} (${t.for})`]), ['blank', 'Nothing: a blank floor']], s.templates.some(t => t.id === s.mode) ? s.mode : 'blank');
    const go = node('button', layout() ? 'Start afresh' : 'Use it');
    go.onclick = async () => { if (!layout() || await window.concert.sure('Replace this set’s shapes and map with the template? Cameras keep their places.', { ok: 'Start afresh', danger: true })) change({ use: which.value }); };
    const row = node('div', undefined, 'row'); row.append(which, go); box.append(row);
    return box;
  }

  function shapesPart() {
    const s = set(), box = section('Shapes', 'Drag a shape on the map to move it, its corner to size it. The main one is where the shots are: Stage Shots’ buttons stand on it and a gimbal is set on its middle.');
    const list = node('div', undefined, 'shapes');
    shapesNow().forEach(shape => {
      const row = node('div', undefined, 'row'); row.classList.toggle('chosen', chosenShape === shape.id);
      const kind = choice(Object.entries(s.kinds), shape.kind), label = input('text', shape.label, { maxlength: '40', 'aria-label': 'Name' });
      const main = input('radio', undefined, { name: 'main-shape', 'aria-label': 'The main area' }); main.checked = !!shape.main;
      const roundIt = input('checkbox', undefined, { 'aria-label': 'Round' }); roundIt.checked = !!shape.round;
      const gone = node('button', '✕'); gone.setAttribute('aria-label', `Remove ${shape.label}`);
      const save = changed => saveShapes(shapesNow().map(o => o.id === shape.id ? { ...o, ...changed } : changed.main ? { ...o, main: false } : o));
      kind.onchange = () => save({ kind: kind.value }); label.onchange = () => save({ label: label.value || s.kinds[kind.value] });
      main.onchange = () => save({ main: true }); roundIt.onchange = () => save({ round: roundIt.checked });
      gone.onclick = () => saveShapes(shapesNow().filter(o => o.id !== shape.id));
      const m = node('label', 'Main'); m.prepend(main); const ro = node('label', 'Round'); ro.prepend(roundIt);
      row.append(kind, label, m, ro, gone); list.append(row);
    });
    box.append(list);
    const kind = choice(Object.entries(s.kinds), 'zone'), add = node('button', 'Add a shape');
    add.disabled = shapesNow().length >= s.limits.shapes;
    add.onclick = () => saveShapes([...shapesNow(), { id: Math.random().toString(36).slice(2, 8), kind: kind.value, label: s.kinds[kind.value], x: 0.4, y: 0.4, w: 0.2, h: 0.12 }]);
    const row = node('div', undefined, 'row'); row.append(kind, add); box.append(row);
    return box;
  }

  function scalePart() {
    const L = layout(), box = section('Scale', L.width_m ? `The map is ${L.width_m} m across.` : 'Mark two points on the map a known distance apart, to measure it by.');
    const go = node('button', 'Mark two points'), metres = input('number', '', { min: '0.05', max: '1000', step: '0.01', 'aria-label': 'Distance between them in metres' });
    go.onclick = () => pick(2, n => n ? 'Now the second point.' : 'Press the first of two points on the map a known distance apart.', ([a, b]) => {
      const d = Number(metres.value);
      if (!(d > 0)) { result.textContent = 'Give the distance between them in metres first, then mark them.'; return; }
      change({ scale: { a: [round(a.x), round(a.y)], b: [round(b.x), round(b.y)], metres: d } });
    });
    const row = node('div', undefined, 'row'); row.append(labelled('Distance ', metres), node('span', 'm'), go);
    if (L.width_m) { const off = node('button', 'Not to scale'); off.onclick = () => change({ width_m: null }); row.append(off); }
    box.append(row); return box;
  }

  function targetsPart() {
    const s = set(), box = section('Gimbal targets', 'Where each saved target (“show the pot”) is on the set.');
    const ids = Object.keys(s.targets);
    if (!ids.length) { box.append(node('p', 'None saved for this kind of event: save one from a gimbal camera’s card.', 'quiet')); return box; }
    ids.forEach(id => {
      const about = s.targets[id], camera = state.cameras.find(c => c.id === about.camera), placed = layout().targets?.[id];
      const row = node('div', undefined, 'row'); row.append(node('span', `${about.name} (${camera ? camera.name : 'camera'})`));
      const put = node('button', placed ? 'Move it' : 'Put it on the map');
      put.onclick = () => pick(1, () => `Press where ${about.name} is on the map.`, ([at]) => change({ targets: { [id]: { x: round(at.x), y: round(at.y) } } }));
      row.append(put);
      if (placed) { const off = node('button', 'Take it off'); off.onclick = () => change({ targets: { [id]: null } }); row.append(off); }
      box.append(row);
    });
    return box;
  }

  function removePart() {
    const box = section('Back to the plain stage', 'Takes this kind of event’s set away; the room map is the plain stage again, with the cameras where it had them.');
    const go = node('button', 'Remove this set'); go.onclick = async () => { if (await window.concert.sure('Remove this set? Its shapes and where its cameras stand go; its map picture stays on the manager, to use again.', { ok: 'Remove', danger: true })) change({ remove: true }); };
    box.append(go); return box;
  }

  window.setDraw = () => {
    const open = !!window.concert && document.querySelector('#roommap')?.getAttribute('aria-pressed') === 'true' && !!set();
    panel.hidden = !open;
    if (!open) { picking = null; return; }
    panelDraw();
    if (!held) draw();
  };
})();
