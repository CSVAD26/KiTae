// Golden Spiral Composition (황금 나선 컴포지션) - MAT236 Project 1, a drawing tool in p5.js
//
// Every gesture drawn on the painting is snapped to the golden ratio:
//   straight line           -> cuts the cell under it at 0.382 or 0.618 of its side
//   line along a black bar  -> removes that cut (and every cut inside it)
//   spiral, clockwise, winding inward        -> fills the cell with a golden spiral that flows toward its eye
//   spiral, counter-clockwise, winding outward -> stops that spiral where it is (a clockwise inward spiral restarts it);
//                                                 drawn again on a stopped spiral, turns it back into a plain white cell
//   click                   -> paints the cell, or the spiral piece under the cursor, with the brush color
//   double click            -> empties the cell, or the spiral piece under the cursor, back to white
// Any other stroke does nothing.
// The composition is a binary tree of cells: each cut stores its direction and position,
// each leaf stores its color and, optionally, a golden spiral.
// The rail on the right has no words: a logo, six brush colors, and three icon buttons
// (undo, back to the opening piece, save PNG). Keys: 1-6 brush, Z undo, S save.

/* ---------- golden ratio constants ---------- */
const PHI = (1 + Math.sqrt(5)) / 2;
const INV = 1 / PHI;        // 0.618...
const INV2 = INV * INV;     // 0.382...
// Eye of the whirling squares (the point they converge to) in the canonical golden
// rectangle [0, PHI] x [0, 1] whose first square sits on the left.
const EYE = { x: PHI / (1 + INV2), y: 1 / (1 + INV2) };

/* ---------- layout ---------- */
const W = 1000, H = 618;                  // painting size: a golden rectangle
const PAD = 20;                           // margin around the painting
const RAIL_X = PAD + W + PAD;             // the rail on the right
const RAIL_W = 56;
const BAR = 10;                           // thickness of the black division bars
const MIN_PIECE = 30;                     // a cut must leave both pieces at least this big
const MIN_SPIRAL = 60;                    // smallest cell that can hold a spiral
const TOTAL_W = RAIL_X + RAIL_W + PAD;    // size of the whole tool, painting plus rail
const TOTAL_H = PAD + H + PAD;

/* ---------- paint ---------- */
const PAINT = {
  red:    { hex: '#C8322B' },
  yellow: { hex: '#EDBD27' },
  blue:   { hex: '#1F4C99' },
  black:  { hex: '#17191B' },
  gray:   { hex: '#BFC3BD' },
  white:  { hex: '#F5F4EE' },
};
const BRUSHES = ['red', 'yellow', 'blue', 'black', 'gray', 'white'];
const PRIMARY = ['red', 'yellow', 'blue'];

/* ---------- state ---------- */
let root;                 // the composition tree
let brush = 'red';
let undoStack = [];       // JSON snapshots of root
let strokePts = null;     // points of the stroke being drawn, in painting coordinates
let buttons = [];
let zoom = 1, offX = 0, offY = 0;   // the tool is scaled and centered to fit the window

function setup() {
  createCanvas(windowWidth, windowHeight);
  fitWindow();
  const bx = RAIL_X + 12, by = PAD + 320;
  buttons = [
    { icon: 'undo', x: bx, y: by, w: 32, h: 32, action: undo },
    { icon: 'new', x: bx, y: by + 40, w: 32, h: 32, action: clearCanvas },
    { icon: 'save', x: bx, y: by + 80, w: 32, h: 32, action: savePNG },
  ];
  root = buildExample();
}

function draw() {
  const dt = min(deltaTime, 100) / 1000;
  for (const n of leaves(root)) if (n.spiral) advanceFlow(n.spiral, dt);
  background('#E8ECE7');
  translate(offX, offY);
  scale(zoom);
  push();
  translate(PAD, PAD);
  // nothing may stick out of the painting: bars and strokes are clipped to it
  drawingContext.beginPath();
  drawingContext.rect(0, 0, W, H);
  drawingContext.clip();
  drawPainting();
  if (strokePts) drawStrokePath();
  pop();
  noFill();
  stroke('#C5CDC7');
  strokeWeight(1);
  rect(PAD, PAD, W, H);
  drawRail();
}
function fitWindow() {
  zoom = min(windowWidth / TOTAL_W, windowHeight / TOTAL_H);
  offX = (windowWidth - TOTAL_W * zoom) / 2;
  offY = (windowHeight - TOTAL_H * zoom) / 2;
}
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  fitWindow();
}

/* ---------- the composition: a binary tree of golden cuts ---------- */
function leaf(x, y, w, h, fill) {
  return { x, y, w, h, fill: fill || 'white', split: null, a: null, b: null, spiral: null };
}
function leaves(n, out = []) {
  if (n.split) { leaves(n.a, out); leaves(n.b, out); } else out.push(n);
  return out;
}
function internals(n, out = []) {
  if (n.split) { out.push(n); internals(n.a, out); internals(n.b, out); }
  return out;
}
function leafAt(n, p) {
  while (n.split) {
    const s = n.split;
    n = (s.dir === 'v' ? p.x < s.pos : p.y < s.pos) ? n.a : n.b;
  }
  return n;
}
// dir 'v' puts a vertical bar at x = pos, 'h' a horizontal bar at y = pos. Both halves keep the color.
function splitAt(n, dir, pos) {
  const fill = n.fill;
  n.split = { dir, pos };
  if (dir === 'v') {
    n.a = leaf(n.x, n.y, pos - n.x, n.h, fill);
    n.b = leaf(pos, n.y, n.x + n.w - pos, n.h, fill);
  } else {
    n.a = leaf(n.x, n.y, n.w, pos - n.y, fill);
    n.b = leaf(n.x, pos, n.w, n.y + n.h - pos, fill);
  }
  n.fill = null;
  n.spiral = null;
}
// Removes a cut: the node becomes one plain cell with the bigger half's color.
function mergeNode(n) {
  const big = n.a.w * n.a.h >= n.b.w * n.b.h ? n.a : n.b;
  n.fill = big.split ? 'white' : big.fill;
  n.split = null;
  n.a = n.b = null;
  n.spiral = null;
}
function cutSegment(n) {
  const s = n.split;
  return s.dir === 'v'
    ? { x1: s.pos, y1: n.y, x2: s.pos, y2: n.y + n.h, dir: 'v' }
    : { x1: n.x, y1: s.pos, x2: n.x + n.w, y2: s.pos, dir: 'h' };
}

/* ---------- golden spiral cells ---------- */
// Largest golden rectangle inside a cell, and the cut that separates it from the leftover.
function goldenFit(n, target) {
  const wide = n.w >= n.h, L = max(n.w, n.h), S = min(n.w, n.h);
  let gw, gh, dir;
  if (L / S >= PHI) {             // long enough: keep the short side, cut across the long side
    if (wide) { gh = n.h; gw = gh * PHI; dir = 'v'; } else { gw = n.w; gh = gw * PHI; dir = 'h'; }
  } else {                        // too squat: keep the long side, cut across the short side
    if (wide) { gw = n.w; gh = gw / PHI; dir = 'h'; } else { gh = n.h; gw = gh / PHI; dir = 'v'; }
  }
  const leftover = dir === 'v' ? n.w - gw : n.h - gh;
  // the golden part goes on the side nearer to the drawn spiral
  const first = dir === 'v' ? target.x < n.x + n.w / 2 : target.y < n.y + n.h / 2;
  const pos = dir === 'v' ? (first ? n.x + gw : n.x + n.w - gw) : (first ? n.y + gh : n.y + n.h - gh);
  return { land: wide, dir, pos, first, leftover };
}
// Maps a point of the canonical golden rectangle onto the cell (same mapping as spiralTransform).
function cellPoint(n, px, py) {
  const sp = n.spiral;
  if (sp.fx) px = PHI - px;
  if (sp.fy) py = 1 - py;
  if (sp.land) return { x: n.x + px * n.w / PHI, y: n.y + py * n.h };
  return { x: n.x + py * n.w, y: n.y + px * n.h / PHI };
}
// Turning direction of the spiral on screen: +1 clockwise, -1 counter-clockwise.
function spiralHand(sp) {
  return (sp.fx ? -1 : 1) * (sp.fy ? -1 : 1) * (sp.land ? 1 : -1);
}
// Picks, among the clockwise mirror variants, the one whose eye is nearest to target.
function orientSpiral(n, target) {
  let best = null, bd = Infinity;
  for (const fx of [false, true]) for (const fy of [false, true]) {
    n.spiral.fx = fx;
    n.spiral.fy = fy;
    if (spiralHand(n.spiral) !== 1) continue;
    const e = cellPoint(n, EYE.x, EYE.y);
    const d = dist(e.x, e.y, target.x, target.y);
    if (d < bd) { bd = d; best = [fx, fy]; }
  }
  n.spiral.fx = best[0];
  n.spiral.fy = best[1];
}
// Carves the golden rectangle out of the cell and fills it with a flowing spiral.
function makeSpiral(n, target, base) {
  const fit = goldenFit(n, target);
  let cell = n;
  if (fit.leftover >= 8) {
    splitAt(n, fit.dir, fit.pos);
    cell = fit.first ? n.a : n.b;
  }
  cell.fill = 'white';
  cell.spiral = { land: fit.land, fx: false, fy: false, cycle: colorCycle(base), over: {}, flow: 'on', clock: 0, t: 0 };
  orientSpiral(cell, target);
}
// Three colors starting with the brush color, then the other primaries.
function colorCycle(base) {
  if (base === 'white') base = 'red';
  return [base].concat(PRIMARY.filter(c => c !== base)).slice(0, 3);
}
// Piece k of the spiral is colored where the Fibonacci word has a 1 (a 0.382 share of all pieces),
// unless it was painted by hand (spiral.over). Pieces that enter from outside while the spiral
// flows (k < 0) start white and are left to the user.
function fibBit(k) {
  return floor((k + 2) * INV2) - floor((k + 1) * INV2);
}
function spiralColor(n, k) {
  const cyc = n.spiral.cycle;
  if (n.spiral.over[k]) return n.spiral.over[k];
  if (k < 0 || !cyc || !fibBit(k)) return 'white';
  const i = ((floor((k + 2) * INV2) - 1) % cyc.length + cyc.length) % cyc.length;
  return cyc[i];
}

/* ---------- spiral animation ---------- */
// A spiral holds still for FLOW_HOLD seconds, then takes one smooth step over FLOW_MOVE seconds:
// every piece turns a quarter turn and shrinks by 1/1.618 toward the eye, while a bigger piece enters from outside.
// Each spiral has its own clock and flow time t. flow is 'on', 'stopping' (finishes the current step) or 'off'.
const FLOW_HOLD = 2.6, FLOW_MOVE = 1.3;
function easeInOut(t) {
  t = constrain(t, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2;
}
function flowTime(c) {
  const period = FLOW_HOLD + FLOW_MOVE;
  const i = floor(c / period);
  return i + easeInOut((c - i * period - FLOW_HOLD) / FLOW_MOVE);
}
function advanceFlow(sp, dt) {
  if (sp.flow === 'off') return;
  sp.clock += dt;
  sp.t = -flowTime(sp.clock);          // t falls, so e = k - t grows and the pieces shrink inward
  if (sp.flow === 'stopping' && sp.clock % (FLOW_HOLD + FLOW_MOVE) < FLOW_HOLD) sp.flow = 'off';
}
// Sets the transform so that the unit square becomes piece e of the spiral in cell n.
// e = 0 is the first (largest) square; each +1 is a quarter turn and a /1.618 shrink toward the eye.
function spiralTransform(n, e) {
  const sp = n.spiral;
  translate(n.x, n.y);
  if (sp.land) scale(n.w / PHI, n.h);
  else { scale(n.w, n.h / PHI); applyMatrix(0, 1, 1, 0, 0, 0); }   // tall cell: swap x and y
  if (sp.fy) applyMatrix(1, 0, 0, -1, 0, 1);                         // mirror top-bottom
  if (sp.fx) applyMatrix(-1, 0, 0, 1, PHI, 0);                       // mirror left-right
  translate(EYE.x, EYE.y);
  rotate(e * HALF_PI);
  scale(pow(INV, e));
  translate(-EYE.x, -EYE.y);
}
// Piece indices to draw right now: from zoomed-out ones bigger than the cell down to sub-pixel ones.
function pieceRange(n) {
  const eMax = log(min(n.w, n.h) / 0.8) / log(PHI);
  return [ceil(n.spiral.t - 4), floor(n.spiral.t + eMax)];
}
// Index of the spiral piece under painting point p right now, or null.
function pieceAt(n, p) {
  const sp = n.spiral;
  // painting -> canonical golden rectangle: the reverse of cellPoint
  let px = sp.land ? (p.x - n.x) * PHI / n.w : (p.y - n.y) * PHI / n.h;
  let py = sp.land ? (p.y - n.y) / n.h : (p.x - n.x) / n.w;
  if (sp.fx) px = PHI - px;
  if (sp.fy) py = 1 - py;
  const [kLo, kHi] = pieceRange(n);
  for (let k = kLo; k <= kHi; k++) {
    // undo the whirl of piece k (turn back and grow about the eye), then test the unit square
    const e = k - sp.t, a = -e * HALF_PI, s = pow(PHI, e);
    const dx = px - EYE.x, dy = py - EYE.y;
    const ux = EYE.x + (dx * cos(a) - dy * sin(a)) * s;
    const uy = EYE.y + (dx * sin(a) + dy * cos(a)) * s;
    if (ux >= 0 && ux <= 1 && uy >= 0 && uy <= 1) return k;
  }
  return null;
}
function drawSpiral(n) {
  const [kLo, kHi] = pieceRange(n);
  const lin = sqrt(n.w * n.h / PHI);                  // pixels per canonical unit
  push();
  // clip everything to the cell: zoomed-out pieces are bigger than the cell
  drawingContext.beginPath();
  drawingContext.rect(n.x, n.y, n.w, n.h);
  drawingContext.clip();
  noStroke();
  fill(PAINT.white.hex);
  rect(n.x, n.y, n.w, n.h);
  // colored pieces: only the quarter disc inside each piece's arc is painted
  for (let k = kLo; k <= kHi; k++) {
    const col = spiralColor(n, k);
    if (col === 'white') continue;
    push();
    spiralTransform(n, k - n.spiral.t);
    fill(PAINT[col].hex);
    arc(1, 1, 2, 2, PI, PI * 1.5, PIE);
    pop();
  }
  // outlines and quarter arcs, drawn in local units so they stay the same width on screen
  noFill();
  stroke(PAINT.black.hex);
  for (let k = kLo; k <= kHi; k++) {
    const e = k - n.spiral.t;
    push();
    spiralTransform(n, e);
    const px = max(0.7, BAR * 0.42 * max(0.18, pow(INV, e * 0.55)));
    strokeWeight(px / (lin * pow(INV, e)));
    rect(0, 0, 1, 1);
    arc(1, 1, 2, 2, PI, PI * 1.5);
    pop();
  }
  pop();
}

/* ---------- painting ---------- */
function drawPainting() {
  const cells = leaves(root);
  noStroke();
  for (const n of cells) {
    if (n.spiral) continue;
    fill(PAINT[n.fill].hex);
    rect(n.x, n.y, n.w, n.h);
  }
  for (const n of cells) if (n.spiral) drawSpiral(n);
  // a black bar on every cut
  noStroke();
  fill(PAINT.black.hex);
  for (const n of internals(root)) {
    const s = cutSegment(n);
    if (s.dir === 'v') rect(s.x1 - BAR / 2, s.y1 - BAR / 2, BAR, s.y2 - s.y1 + BAR);
    else rect(s.x1 - BAR / 2, s.y1 - BAR / 2, s.x2 - s.x1 + BAR, BAR);
  }
}
function drawStrokePath() {
  noFill();
  stroke(brush === 'white' ? '#8B918C' : PAINT[brush].hex);
  strokeWeight(4);
  strokeCap(ROUND);
  strokeJoin(ROUND);
  beginShape();
  for (const p of strokePts) vertex(p.x, p.y);
  endShape();
}

/* ---------- reading a stroke ---------- */
// Spaces the points evenly so heading changes can be measured.
function resample(pts, step) {
  const out = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = out[out.length - 1];
    const b = pts[i];
    let d = dist(a.x, a.y, b.x, b.y);
    while (acc + d >= step) {
      const t = (step - acc) / d;
      const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      out.push(q);
      a = q;
      d = dist(a.x, a.y, b.x, b.y);
      acc = 0;
    }
    acc += d;
  }
  const last = pts[pts.length - 1], end = out[out.length - 1];
  if (out.length === 1 || dist(last.x, last.y, end.x, end.y) > step * 0.3) out.push(last);
  return out;
}
// tap / line / spiral from the stroke's length, straightness and total turning; null for anything else.
function classify(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
  if (L < 10) return { kind: 'tap', p: pts[0] };
  const rs = resample(pts, 6);
  const s = rs[0], e = rs[rs.length - 1];
  const chord = dist(s.x, s.y, e.x, e.y);
  let turn = 0, absTurn = 0, prev = null, cx = 0, cy = 0;
  for (let i = 1; i < rs.length; i++) {
    const h = atan2(rs[i].y - rs[i - 1].y, rs[i].x - rs[i - 1].x);
    if (prev !== null) {
      let d = h - prev;
      d -= TWO_PI * round(d / TWO_PI);
      turn += d;
      absTurn += abs(d);
    }
    prev = h;
  }
  for (const p of rs) { cx += p.x; cy += p.y; }
  const c = { x: cx / rs.length, y: cy / rs.length };
  const straight = chord / L;
  if (straight > 0.86 || (straight > 0.7 && abs(turn) < 0.9)) {
    return { kind: 'line', dir: abs(e.x - s.x) >= abs(e.y - s.y) ? 'h' : 'v', c };
  }
  if (abs(turn) >= 1.3 * TWO_PI && abs(turn) / max(1e-6, absTurn) >= 0.62) {
    const inward = dist(e.x, e.y, c.x, c.y) <= dist(s.x, s.y, c.x, c.y);   // ended near the middle
    return { kind: 'spiral', cw: turn > 0, inward, eye: inward ? e : s, c };
  }
  return null;
}
// A straight stroke traced along an existing bar: returns that cut's node, or null.
function cutAlong(pts, dir) {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const lo = dir === 'h' ? min(xs) : min(ys), hi = dir === 'h' ? max(xs) : max(ys);
  let best = null, bd = Infinity;
  for (const n of internals(root)) {
    if (n.split.dir !== dir) continue;
    const seg = cutSegment(n);
    const a = dir === 'h' ? seg.x1 : seg.y1, b = dir === 'h' ? seg.x2 : seg.y2;
    const overlap = max(0, min(hi, b) - max(lo, a));
    if (overlap < 0.6 * max(1, hi - lo)) continue;
    let d = 0;
    for (const p of pts) d += abs((dir === 'h' ? p.y : p.x) - n.split.pos);
    d /= pts.length;
    if (d <= 14 && d < bd) { bd = d; best = n; }
  }
  return best;
}
// Turns the stroke into a plan: what to do to which cell. null means nothing happens.
function analyze(pts) {
  const g = classify(pts);
  if (!g) return null;
  if (g.kind === 'tap') return { kind: 'tap', p: g.p };
  if (g.kind === 'line') {
    const hit = cutAlong(pts, g.dir);
    if (hit) return { kind: 'erase', node: hit };
    const n = leafAt(root, g.c);
    if (n.spiral) return null;                                 // spiral cells cannot be cut
    const start = g.dir === 'h' ? n.y : n.x, len = g.dir === 'h' ? n.h : n.w;
    if (len * INV2 < MIN_PIECE) return null;                   // too small to cut again
    // the golden point nearer to the stroke wins
    const at = g.dir === 'h' ? g.c.y : g.c.x;
    const ratio = abs(at - (start + INV2 * len)) <= abs(at - (start + INV * len)) ? INV2 : INV;
    return { kind: 'cut', n, dir: g.dir, pos: start + ratio * len };
  }
  // a spiral: clockwise winding inward starts one, counter-clockwise winding outward stops one
  const n = leafAt(root, g.c);
  if (g.cw && g.inward) {
    if (!n.spiral && min(n.w, n.h) < MIN_SPIRAL) return null;
    return { kind: 'spiral', n, eye: g.eye };
  }
  if (!g.cw && !g.inward && n.spiral) return { kind: 'stop', n };
  return null;
}

/* ---------- actions ---------- */
function commit(p) {
  const n = p.n;
  if (p.kind === 'tap') {
    pushUndo();
    if (!paintAt(p.p, brush)) undoStack.pop();   // nothing changed: drop the snapshot
  } else if (p.kind === 'cut') {
    pushUndo();
    splitAt(n, p.dir, p.pos);
  } else if (p.kind === 'erase') {
    pushUndo();
    mergeNode(p.node);
  } else if (p.kind === 'spiral') {
    pushUndo();
    if (n.spiral) { orientSpiral(n, p.eye); n.spiral.flow = 'on'; }
    else makeSpiral(n, p.eye, brush);
  } else if (p.kind === 'stop') {
    if (n.spiral.flow === 'stopping') return;
    pushUndo();
    if (n.spiral.flow === 'on') n.spiral.flow = 'stopping';
    else n.spiral = null;                        // already stopped: back to a plain cell
  }
}
// Paints the cell under p, or the spiral piece under p, with a color ('white' empties it).
// Returns whether anything changed.
function paintAt(p, color) {
  const n = leafAt(root, p);
  if (!n.spiral) {
    if (n.fill === color) return false;
    n.fill = color;
    return true;
  }
  const k = pieceAt(n, p);
  if (k === null || spiralColor(n, k) === color) return false;
  n.spiral.over[k] = color;
  return true;
}
function pushUndo() {
  undoStack.push(JSON.stringify(root));
  if (undoStack.length > 100) undoStack.shift();
}
function undo() {
  if (undoStack.length) root = JSON.parse(undoStack.pop());
}
// Back to the opening piece, as if the sketch had just started.
function clearCanvas() {
  pushUndo();
  root = buildExample();
}
function savePNG() {
  get(offX + PAD * zoom, offY + PAD * zoom, W * zoom, H * zoom).save('golden-composition', 'png');
}
// The opening piece: every cut at 0.382 or 0.618 and one golden spiral.
function buildExample() {
  const r = leaf(0, 0, W, H);
  const cut = (n, dir, g) => {
    splitAt(n, dir, dir === 'v' ? n.x + g * n.w : n.y + g * n.h);
    return [n.a, n.b];
  };
  const [A, B] = cut(r, 'v', INV);
  const [A1, A2] = cut(A, 'h', INV);
  const [A2a, A2b] = cut(A2, 'v', INV2);
  const [, A2b2] = cut(A2b, 'v', INV);
  const [B1, B2] = cut(B, 'h', INV2);
  const [, B1b] = cut(B1, 'v', INV);
  const [, B2b] = cut(B2, 'h', INV);
  const [B2b1] = cut(B2b, 'v', INV2);
  A2a.fill = 'blue';
  A2b2.fill = 'yellow';
  B1b.fill = 'black';
  B2b1.fill = 'red';
  makeSpiral(A1, { x: W / 2, y: H / 2 }, 'red');
  return r;
}

/* ---------- rail: logo, brush colors, buttons ---------- */
function swatchRect(i) {
  return { x: RAIL_X + 12, y: PAD + 64 + i * 40, w: 32, h: 32 };
}
function inRect(mx, my, r) {
  return mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h;
}
function drawRail() {
  noStroke();
  fill('#DEE4DE');
  rect(RAIL_X, PAD, RAIL_W, H);
  drawLogo(RAIL_X + 6, PAD + 10, 44);
  for (let i = 0; i < BRUSHES.length; i++) {
    const r = swatchRect(i), on = BRUSHES[i] === brush;
    stroke(on ? '#1E2326' : '#C5CDC7');
    strokeWeight(on ? 3 : 1);
    fill(PAINT[BRUSHES[i]].hex);
    rect(r.x, r.y, r.w, r.h);
  }
  for (const b of buttons) {
    stroke('#C5CDC7');
    strokeWeight(1);
    fill('#F8F9F5');
    rect(b.x, b.y, b.w, b.h);
    drawIcon(b.icon, b.x, b.y);
  }
}
// The logo is a small golden spiral in the three primaries, drawn with the same code as the painting.
function drawLogo(x, y, w) {
  const n = { x, y, w, h: w / PHI, spiral: { land: true, fx: false, fy: false, cycle: PRIMARY, over: {} } };
  for (let k = 0; k < 7; k++) {
    push();
    spiralTransform(n, k);
    const col = spiralColor(n, k);
    if (col !== 'white') {
      noStroke();
      fill(PAINT[col].hex);
      arc(1, 1, 2, 2, PI, PI * 1.5, PIE);
    }
    noFill();
    stroke('#1E2326');
    strokeWeight(1.2 / (n.h * pow(INV, k)));
    rect(0, 0, 1, 1);
    arc(1, 1, 2, 2, PI, PI * 1.5);
    pop();
  }
}
// Button pictures, each in a 32 x 32 box: undo arrow, blank sheet, download.
function drawIcon(kind, x, y) {
  stroke('#1E2326');
  strokeWeight(2);
  strokeCap(ROUND);
  strokeJoin(ROUND);
  noFill();
  if (kind === 'undo') {
    arc(x + 17, y + 16, 16, 16, PI * 0.95, PI * 2.45);
    noStroke();
    fill('#1E2326');
    triangle(x + 5, y + 13, x + 13, y + 16, x + 7, y + 22);
  } else if (kind === 'new') {
    beginShape();
    vertex(x + 9, y + 6);
    vertex(x + 19, y + 6);
    vertex(x + 24, y + 11);
    vertex(x + 24, y + 26);
    vertex(x + 9, y + 26);
    endShape(CLOSE);
    line(x + 19, y + 6, x + 19, y + 11);
    line(x + 19, y + 11, x + 24, y + 11);
  } else if (kind === 'save') {
    line(x + 16, y + 7, x + 16, y + 19);
    line(x + 11, y + 14, x + 16, y + 19);
    line(x + 21, y + 14, x + 16, y + 19);
    line(x + 8, y + 24, x + 24, y + 24);
  }
}

/* ---------- mouse and keys ---------- */
// Mouse position in tool coordinates (undoing the window fit).
function mouse() {
  return { x: (mouseX - offX) / zoom, y: (mouseY - offY) / zoom };
}
// Mouse position in painting coordinates, or null when outside the painting.
function toPainting(m, clampIt) {
  const p = { x: m.x - PAD, y: m.y - PAD };
  if (clampIt) {
    p.x = constrain(p.x, 0, W - 0.01);
    p.y = constrain(p.y, 0, H - 0.01);
    return p;
  }
  return p.x < 0 || p.y < 0 || p.x >= W || p.y >= H ? null : p;
}
function mousePressed() {
  const m = mouse();
  for (let i = 0; i < BRUSHES.length; i++) {
    if (inRect(m.x, m.y, swatchRect(i))) { brush = BRUSHES[i]; return; }
  }
  for (const b of buttons) {
    if (inRect(m.x, m.y, b)) { b.action(); return; }
  }
  const p = toPainting(m, false);
  if (p) strokePts = [p];
}
function mouseDragged() {
  if (!strokePts) return;
  const p = toPainting(mouse(), true), q = strokePts[strokePts.length - 1];
  if (dist(p.x, p.y, q.x, q.y) >= 1.2) strokePts.push(p);
}
function mouseReleased() {
  if (!strokePts) return;
  const p = analyze(strokePts);
  if (p) commit(p);
  strokePts = null;
}
// A double click empties the cell or spiral piece under the mouse (the two single clicks before it painted it).
function doubleClicked() {
  const p = toPainting(mouse(), false);
  if (!p) return;
  pushUndo();
  if (!paintAt(p, 'white')) undoStack.pop();
}
function keyPressed() {
  if (key === 'z' || key === 'Z') undo();
  else if (key === 's' || key === 'S') savePNG();
  else if (key >= '1' && key <= '6') brush = BRUSHES[key - 1];
}
