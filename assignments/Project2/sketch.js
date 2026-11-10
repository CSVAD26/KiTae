/* =====================================================================
   HOME STAR TRAILS  (p5.js, global mode)

   Encoding
     angle    = local clock time, 00:00 at the top, clockwise, 24 h per turn
     radius   = distance from home on a log scale (home sits at the centre)
     arc      = one stay at one place; its length is how long I stayed
     star     = one place, drawn on its ring at the hour I am usually there, sized by total time
     curve    = travel between two places, coloured by how I moved
     dial     = one per home: before the move and after the move, same distance scale
     dashed   = the reach of a typical day (median of each day's farthest point)

   Pipeline
     1. acquire  buildSample()  or  a Google Maps Timeline export (file input)
     2. parse    readTimeline(): visits and travel segments out of the JSON
     3. clean    guessMove(): finds the date home changed
                 rebuild(): splits eras, groups visits into places, finds each home, measures km
                 ingest(): sorts, removes overlaps, cuts stays at midnight, labels travel by mode
     4. draw     renderTrails() into an offscreen buffer, draw() adds stars and overlays

   Times are wall-clock times stored as "naive" milliseconds
   (the digits the clock showed, read as if they were UTC).
   ===================================================================== */

const HOME_KM = 0.1;                 // closer than 100 m counts as being at home
const MS_DAY = 86400000;
const MIN_ERA_DAYS = 14;             // a home needs this many days of data to get its own dial
const TOP_PLACES = 12;               // stars per dial
const MONO = 'IBM Plex Mono';
const C = { sky: [9, 13, 28], rule: [39, 50, 92], dim: [70, 84, 130], muted: [142, 154, 192], ink: [228, 233, 251], trail: [205, 216, 250] };
const MODES = ['walk', 'bike', 'transit', 'car', 'flight', 'other'];
const MODE_COL = { walk: [86, 180, 233], bike: [38, 208, 160], transit: [214, 132, 184], car: [240, 160, 40], flight: [150, 156, 190], other: [84, 96, 140] };
const MODE_NAME = { walk: 'on foot', bike: 'bike', transit: 'bus or train', car: 'car', flight: 'flight', other: 'unknown' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
const SIZES = [[100, '100 m'], [300, '300 m'], [1000, '1 km']];

// ---- state ----------------------------------------------------------
let RAW = { visits: [], acts: [], file: null };
let MOVE_MS = null, MOVE_U = null, MOVE_AUTO = false, SPLIT_MS = null, PLACE_M = 100;
let HOME_PICK = [null, null];        // a place I marked as home by hand, one per era (grid cell key)
let CLUSTERS = new Map();            // place key -> { key, era, la, lo, km, home, auto, label }
let ERAS = [], ERA_N = [0, 0];
let DAYS = [], N_DAYS = 0, LOG_MAX = 1, YEARS = [];
let DOW_ON = new Array(7).fill(true), MON_ON = new Array(12).fill(true), YR_ON = [];
let PLACES = new Map(), STARS = [];
let SEL = null;                      // selected place key
let HSTAR = null;                    // place key under the pointer
let HOVER = null;                    // { day, seg } under the pointer
let PINNED = null;                   // day index kept lit after a click
let NAMES = {}, NAME_V = 0;          // names I typed for places, kept in this browser
let PTR = { x: -1, y: -1 };
let TRAILS = null, CNV = null, RO_KEY = '', RT_KEY = '', LAST_CW = 0;
let SUM_TAB = 'all';                 // side panel: 'all' = overall summary, 'month' = one row per month
let LAST_DAY = null;                 // the day shown in the route panel under the dials
let PREVIEW = null;                  // place lit while its row in the place table is hovered or being named
let FOCUS = null;                    // the place the dials are showing right now: SEL, else PREVIEW
let PB_KEY = '';
let DATA_V = 0;                      // goes up every time the data is rebuilt, so the panels know to refresh
let W = 0, H = 0, G = [], DSZ = 0, R_IN = 0, R_OUT = 0, BAND = 0, STRIP_TOP = 0, STRIP_H = 0, X0 = 0, X1 = 0, SC = 1;

// =====================================================================
// 1. ACQUIRE: synthetic sample (same shape as a parsed Timeline file)
//    170 days in one home with a car, then a move overseas to a home without one.
// =====================================================================
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function buildSample() {
  const rnd = mulberry32(5);
  const U = (lo, hi) => lo + (hi - lo) * rnd();
  const G4 = (m, s) => m + s * (rnd() + rnd() + rnd() + rnd() - 2) * 1.732;
  const ch = p => rnd() < p;
  const pickOf = list => list[Math.floor(rnd() * list.length)];
  const day0 = Date.UTC(2025, 10, 1) / 60000, n = 365, MOVE = 170;
  const T = m => (day0 + m) * 60000;
  const HOMES = [{ la: 37.5, lo: 127.0 }, { la: 34.41, lo: -119.86 }];       // made-up points, not real addresses
  const P = [
    { home: { n: 'Home', km: 0, b: 0 }, work: { n: 'Office', km: 11, b: 200 }, gym: { n: 'Gym', km: 0.6, b: 40 }, cafe: { n: 'Cafe', km: 0.4, b: 300 },
      out: [{ n: 'Dinner street', km: 9, b: 150 }, { n: 'Riverside park', km: 3.5, b: 20 }, { n: 'Friends’ neighbourhood', km: 14, b: 280 }, { n: 'Mall', km: 6, b: 100 }],
      far: [{ n: 'Grandparents', km: 62, b: 170 }, { n: 'Mountain trail', km: 45, b: 30 }] },
    { home: { n: 'Home', km: 0, b: 0 }, work: { n: 'Campus', km: 1.4, b: 80 }, gym: { n: 'Gym', km: 2.3, b: 95 }, cafe: { n: 'Cafe', km: 0.8, b: 60 },
      out: [{ n: 'Beach', km: 0.9, b: 200 }, { n: 'Groceries', km: 3.2, b: 70 }, { n: 'Downtown', km: 15, b: 100 }, { n: 'Friend’s place', km: 1.9, b: 120 }],
      far: [{ n: 'Trailhead', km: 28, b: 20 }, { n: 'Outlet town', km: 70, b: 110 }] }
  ];
  const trips = [
    { from: 55, to: 58, p: { n: 'Coast city', km: 320, b: 135 }, side: { n: 'Coast city market', km: 326, b: 135 } },
    { from: 118, to: 120, p: { n: 'Hot spring town', km: 140, b: 80 }, side: { n: 'Hot spring trail', km: 147, b: 80 } },
    { from: 214, to: 217, p: { n: 'Big city', km: 150, b: 105 }, side: { n: 'Big city museum', km: 158, b: 105 } },
    { from: 258, to: 279, p: { n: 'Family home', km: 0, b: 0, base: 0 }, side: { n: 'Old neighbourhood', km: 9, b: 150, base: 0 } },
    { from: 330, to: 333, p: { n: 'National park', km: 480, b: 350 }, side: { n: 'Park lodge', km: 492, b: 350 } }
  ];
  const visits = [], acts = [];
  let cur = { t: 0, p: P[0].home, era: 0 };
  const kmOf = (p, era) => (p.base != null && p.base !== era) ? 9580 : p.km;
  function pos(p, era) {
    const h = HOMES[p.base != null ? p.base : era], rad = p.b * Math.PI / 180;
    return [h.la + p.km * Math.cos(rad) / 111.19, h.lo + p.km * Math.sin(rad) / (111.19 * Math.cos(h.la * Math.PI / 180))];
  }
  function leave(until) {
    const ll = pos(cur.p, cur.era), b = Math.min(until, n * 1440);
    if (b > cur.t) visits.push({ u: T(cur.t), a: T(cur.t), b: T(b), la: ll[0], lo: ll[1], type: '', name: cur.p.n, lv: 0 });
  }
  const hop = km => km < 3 ? U(8, 15) : km < 25 ? U(25, 50) : km < 250 ? U(110, 160) : km < 800 ? U(200, 330) : U(760, 820);
  function modeFor(era, km) {
    if (km >= 800) return 'flight';
    if (era === 0) return km < 1 ? 'walk' : ch(0.85) ? 'car' : 'transit';
    if (km < 1.2) return 'walk';
    if (km < 4) return ch(0.7) ? 'bike' : 'walk';
    if (km < 30) return ch(0.78) ? 'transit' : 'car';
    return ch(0.45) ? 'car' : 'transit';
  }
  function go(p, depart, mins) {
    depart = Math.max(depart, cur.t + 20);
    leave(depart);
    const far = Math.max(kmOf(p, cur.era), kmOf(cur.p, cur.era)), dur = mins != null ? mins : hop(far);
    const awayHop = kmOf(p, cur.era) > 100 && kmOf(cur.p, cur.era) > 100;     // a short hop while away on a trip
    acts.push({ u: T(depart), ue: T(depart + dur), mode: awayHop ? (cur.era === 0 || ch(0.4) ? 'car' : 'transit') : modeFor(cur.era, far) });
    cur = { t: depart + dur, p: p, era: cur.era };
  }
  for (let d = 0; d < n; d++) {
    const base = d * 1440, wd = (6 + d) % 7, wk = wd >= 1 && wd <= 5, pl = P[cur.era];
    if (d === MOVE) {                                   // moving day
      leave(base + 8 * 60);
      acts.push({ u: T(base + 8 * 60), ue: T(base + 21 * 60), mode: 'flight' });
      cur = { t: base + 21 * 60, p: P[1].home, era: 1 };
      continue;
    }
    const trip = trips.find(x => d >= x.from && d <= x.to);
    if (trip) {
      if (d === trip.from) go(trip.p, base + U(7, 11) * 60);
      else if (d === trip.to) go(pl.home, base + U(9, 13) * 60);
      else if (ch(0.75)) { go(trip.side, base + U(9.5, 11.5) * 60, U(15, 40)); go(trip.p, cur.t + U(120, 300), U(15, 40)); }
      continue;
    }
    if (cur.era === 0) {
      if (wk) {
        go(pl.work, base + G4(7 * 60 + 50, 12), U(40, 55));
        const end = base + U(18.2, 21) * 60;
        if (ch(0.3)) { go(pickOf(pl.out), end, U(25, 45)); go(pl.home, cur.t + U(90, 180), U(25, 45)); }
        else if (ch(0.3)) { go(pl.gym, end, U(40, 55)); go(pl.home, cur.t + U(55, 80), 8); }
        else go(pl.home, end, U(40, 55));
      } else {
        const r = rnd();
        if (r < 0.2) { if (ch(0.5)) { go(pl.cafe, base + U(11, 16) * 60); go(pl.home, cur.t + U(40, 90)); } }
        else if (r < 0.8) { go(pickOf(pl.out), base + U(12.5, 15) * 60, U(20, 45)); go(pl.home, base + U(20, 24.5) * 60, U(20, 45)); }
        else { go(pickOf(pl.far), base + U(8, 10) * 60); go(pl.home, base + U(18, 21) * 60); }
      }
    } else {
      if (wk) {
        const mwf = wd === 1 || wd === 3 || wd === 5;   // early classes Mon/Wed/Fri, late start Tue/Thu
        go(pl.work, base + (mwf ? G4(8 * 60 + 35, 9) : G4(10 * 60 + 40, 14)));
        if (ch(0.3)) { go(pl.cafe, base + U(11.8, 12.6) * 60); go(pl.work, cur.t + U(35, 60)); }
        let end = base + U(17, 19.2) * 60;
        if (ch(0.12)) end = base + U(24.4, 26.8) * 60;                      // late night in the lab
        else if ((wd === 2 || wd === 4) && ch(0.7)) { go(pl.gym, end); end = cur.t + U(55, 90); }   // gym on Tue and Thu
        else if (ch(0.15)) { go(pl.out[2], end); end = cur.t + U(70, 130); }
        go(pl.home, end);
      } else {
        const r = rnd();
        if (r < 0.2) { if (ch(0.6)) { go(pl.out[0], base + U(15, 18) * 60); go(pl.home, cur.t + U(40, 90)); } }
        else if (r < 0.3) { go(pickOf(pl.far), base + U(8, 10) * 60); go(pl.home, base + U(17.5, 20.5) * 60); }
        else {
          go(ch(0.5) ? pl.out[0] : pl.out[2], base + U(11.5, 14) * 60);
          let t = cur.t + U(120, 240);
          if (ch(0.5)) { go(pl.out[1], t); t = cur.t + U(30, 50); }
          if (ch(0.45)) { go(pl.out[3], t); t = base + U(22.5, 25.5) * 60; }
          go(pl.home, t);
        }
      }
    }
  }
  leave(n * 1440);
  return { visits: visits, acts: acts, file: null };
}

// =====================================================================
// 2. PARSE: Google Maps Timeline export  ->  visits + travel segments
//    Handles the on-device export (root array on iPhone, { semanticSegments } on Android)
//    and the older Takeout "Semantic Location History" files ({ timelineObjects }).
// =====================================================================
function parseCoord(v) {
  if (v && typeof v === 'object') return parseCoord(v.latLng != null ? v.latLng : v.point);
  if (typeof v !== 'string') return null;
  const p = v.trim().replace(/^geo:/, '').split('?')[0].replace(/[°\s]/g, '').split(',');
  if (p.length < 2) return null;
  const la = Number(p[0]), lo = Number(p[1]);
  return Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180 ? [la, lo] : null;
}

// Returns { u, n }: u is the real instant, n is the wall-clock time where I was, as naive ms.
// The phone export writes every timestamp in the phone's CURRENT time zone and stores the zone that
// applied back then in a separate field (startTimeTimezoneUtcOffsetMinutes). That field wins when present:
// without it, months spent in another country would be drawn many hours off.
function readTime(s, offMin) {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i);
  if (!m) return null;
  const digits = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if (!m[7]) return { u: digits, n: digits };                       // no zone written: take the digits as local time
  const u = new Date(s.trim()).getTime();
  if (isNaN(u)) return null;
  if (typeof offMin === 'number' && isFinite(offMin)) return { u: u, n: u + offMin * 60000 };
  if (m[7].toUpperCase() !== 'Z') return { u: u, n: digits };       // the offset in the string is all we know
  const dt = new Date(u);                                           // "Z": fall back to this browser's zone
  return { u: u, n: Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate(), dt.getHours(), dt.getMinutes(), dt.getSeconds()) };
}

// A level-1 visit sits inside a level-0 visit (a building on a campus, a shop inside a mall).
// The most specific place wins: the parent keeps only the time around its children, so no time is counted twice.
function flattenVisits(visits) {
  const tops = visits.filter(v => !(v.lv > 0)).sort((p, q) => p.u - q.u);
  const kids = visits.filter(v => v.lv > 0).sort((p, q) => p.u - q.u);
  if (!kids.length) return tops;
  const piece = (v, u0, u1, type) => Object.assign({}, v, { u: u0, a: v.a + (u0 - v.u), b: v.a + (u1 - v.u), type: type || v.type });
  const out = [];
  let k = 0;
  for (const t of tops) {
    const tEnd = t.u + (t.b - t.a);
    while (k < kids.length && kids[k].u < t.u - 60000) out.push(kids[k++]);     // a child without a parent stays as it is
    let cur = t.u;
    while (k < kids.length && kids[k].u < tEnd) {
      const c = kids[k++], c0 = Math.max(c.u, cur), c1 = Math.min(tEnd, c.u + (c.b - c.a));
      if (c0 - cur >= 60000) out.push(piece(t, cur, c0));
      // a building inside a place Google calls work is still work
      if (c1 - c0 >= 60000) out.push(piece(c, c0, c1, /WORK/i.test(t.type) && !/HOME|WORK/i.test(c.type) ? t.type : null));
      cur = Math.max(cur, c1);
    }
    if (tEnd - cur >= 60000) out.push(piece(t, cur, tEnd));
  }
  while (k < kids.length) out.push(kids[k++]);
  return out;
}

// Google already labels each travel segment (WALKING, CYCLING, IN_BUS, IN_PASSENGER_VEHICLE, FLYING ...).
// When the label is missing, average speed gives a rough answer.
function modeOf(type, meters, ms) {
  const t = String(type || '').toUpperCase().replace(/\s+/g, '_');
  if (/FLY|PLANE|FLIGHT/.test(t)) return 'flight';
  if (/WALK|RUN|FOOT|HIK/.test(t)) return 'walk';
  if (/CYCL|BICY|BIKE/.test(t) && !/MOTOR/.test(t)) return 'bike';
  if (/BUS|TRAM|SUBWAY|TRAIN|RAIL|METRO|FERRY/.test(t)) return 'transit';
  if (/VEHICLE|CAR|TAXI|MOTOR|DRIV/.test(t)) return 'car';
  if (meters > 0 && ms > 0) {
    const kmh = meters / 1000 / (ms / 3600000);
    return kmh < 7 ? 'walk' : kmh < 22 ? 'bike' : kmh < 200 ? 'car' : 'flight';
  }
  return 'other';
}

// visits: { u (real start), a, b (wall-clock start and end), la, lo, type, name, lv }   acts: { u, ue (real start and end), mode }
function readTimeline(json) {
  let visits = [];
  const acts = [];
  const segs = Array.isArray(json) ? json : (json && Array.isArray(json.semanticSegments)) ? json.semanticSegments : null;
  if (segs) {
    for (const sg of segs) {
      if (!sg || typeof sg !== 'object' || (!sg.visit && !sg.activity)) continue;       // timelinePath and timelineMemory are not used
      const t0 = readTime(sg.startTime, sg.startTimeTimezoneUtcOffsetMinutes), t1 = readTime(sg.endTime, sg.endTimeTimezoneUtcOffsetMinutes);
      if (!t0 || !t1 || t1.u <= t0.u) continue;
      const tc = sg.visit && sg.visit.topCandidate;
      if (tc) {
        const ll = parseCoord(tc.placeLocation);
        if (ll) visits.push({ u: t0.u, a: t0.n, b: t0.n + (t1.u - t0.u), la: ll[0], lo: ll[1], type: String(tc.semanticType || ''), name: '', id: String(tc.placeId || tc.placeID || ''), lv: Number(sg.visit.hierarchyLevel) || 0 });
      }
      if (sg.activity) {
        const ac = sg.activity, tp = (ac.topCandidate && ac.topCandidate.type) || ac.activityType;
        acts.push({ u: t0.u, ue: t1.u, mode: modeOf(tp, Number(ac.distanceMeters), t1.u - t0.u) });
      }
    }
    visits = flattenVisits(visits);
  } else if (json && Array.isArray(json.timelineObjects)) {
    for (const o of json.timelineObjects) {
      const pv = o && o.placeVisit, as = o && o.activitySegment;
      if (pv && pv.location && pv.duration) {
        const la = pv.location.latitudeE7 / 1e7, lo = pv.location.longitudeE7 / 1e7;
        const t0 = readTime(pv.duration.startTimestamp), t1 = readTime(pv.duration.endTimestamp);
        if (Number.isFinite(la) && Number.isFinite(lo) && t0 && t1 && t1.u > t0.u)
          visits.push({ u: t0.u, a: t0.n, b: t0.n + (t1.u - t0.u), la: la, lo: lo, type: String(pv.location.semanticType || ''), name: String(pv.location.name || ''), id: String(pv.location.placeId || ''), lv: 0 });
      }
      if (as && as.duration) {
        const t0 = readTime(as.duration.startTimestamp), t1 = readTime(as.duration.endTimestamp);
        if (t0 && t1 && t1.u > t0.u) acts.push({ u: t0.u, ue: t1.u, mode: modeOf(as.activityType, Number(as.distance), t1.u - t0.u) });
      }
    }
  }
  return { visits: visits, acts: acts };
}

// =====================================================================
// 3. CLEAN
// =====================================================================
function haversineKm(la1, lo1, la2, lo2) {
  const k = Math.PI / 180, dLa = (la2 - la1) * k, dLo = (lo2 - lo1) * k;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * k) * Math.cos(la2 * k) * Math.sin(dLo / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// One place = one grid cell of roughly `meters` on a side.
function cellKey(la, lo, meters) {
  const dLa = meters / 111190, dLo = meters / (111190 * Math.max(0.2, Math.cos(Math.round(la) * Math.PI / 180)));
  return Math.floor(la / dLa) + ',' + Math.floor(lo / dLo);
}

// Two far-apart places that each hold a lot of time are two homes.
// The move date is the split that keeps the most time on the right side of each.
function guessMove(visits) {
  const cell = v => Math.round(v.la * 2) / 2 + ',' + Math.round(v.lo * 2) / 2;       // about 50 km
  const tot = new Map();
  for (const v of visits) {
    const k = cell(v), e = tot.get(k) || { k: k, ms: 0, wt: 0, la: v.la, lo: v.lo }, d = v.b - v.a;
    e.ms += d; e.wt += d * v.u; tot.set(k, e);
  }
  const top = Array.from(tot.values()).sort((p, q) => q.ms - p.ms);
  if (top.length < 2) return null;
  const A = top[0], B = top.find(e => haversineKm(e.la, e.lo, A.la, A.lo) > 300);
  if (!B || B.ms < 12 * MS_DAY) return null;
  const first = A.wt / A.ms <= B.wt / B.ms ? A : B, second = first === A ? B : A;
  const ev = visits.filter(v => { const k = cell(v); return k === first.k || k === second.k; }).sort((p, q) => p.u - q.u);
  let before = 0, after = second.ms, best = -1, bestV = null;
  for (const v of ev) {
    if (before + after > best) { best = before + after; bestV = v; }
    if (cell(v) === first.k) before += v.b - v.a; else after -= v.b - v.a;
  }
  if (!bestV || best < 0.8 * (first.ms + second.ms)) return null;
  return { u: bestV.u, day: Math.floor(bestV.a / MS_DAY) * MS_DAY };      // the real instant, and the local calendar day
}

function autoMove() {
  const mv = guessMove(RAW.visits);
  MOVE_U = mv ? mv.u : null; MOVE_MS = mv ? mv.day : null; MOVE_AUTO = !!mv;
  HOME_PICK = [null, null];
}

// Hours between midnight and 06:00 local time. Where those are spent is where I live.
function nightMs(a, b) {
  let n = 0;
  for (let d = Math.floor(a / MS_DAY); d <= Math.floor((b - 1) / MS_DAY); d++) n += Math.max(0, Math.min(b, d * MS_DAY + 6 * 3600000) - Math.max(a, d * MS_DAY));
  return n;
}

function rebuild() {
  const visits = RAW.visits;
  if (!visits.length) return false;
  // The move date found in the data is a real instant (MOVE_U). A date typed by hand is a local calendar day (MOVE_MS).
  const useU = MOVE_U != null, cut = useU ? MOVE_U : MOVE_MS, when = v => useU ? v.u : v.a;
  let t0 = Infinity, t1 = -Infinity;
  for (const v of visits) { t0 = Math.min(t0, when(v)); t1 = Math.max(t1, when(v) + (v.b - v.a)); }
  const split = cut != null && cut - t0 >= MIN_ERA_DAYS * MS_DAY && t1 - cut >= MIN_ERA_DAYS * MS_DAY;
  SPLIT_MS = split ? MOVE_MS : null;
  const eraOf = v => split && when(v) >= cut ? 1 : 0, nEra = split ? 2 : 1;
  const keyOf = v => eraOf(v) + '|' + cellKey(v.la, v.lo, PLACE_M);

  // group visits into places, separately for each home era
  const cl = new Map();
  for (const v of visits) {
    const k = keyOf(v), d = v.b - v.a;
    let e = cl.get(k);
    if (!e) { e = { key: k, era: eraOf(v), ms: 0, night: 0, work: 0, sla: 0, slo: 0, names: new Map(), ids: new Map() }; cl.set(k, e); }
    e.ms += d; e.night += nightMs(v.a, v.b); e.sla += v.la * d; e.slo += v.lo * d;
    if (/WORK/i.test(v.type)) e.work += d;
    if (v.name) e.names.set(v.name, (e.names.get(v.name) || 0) + d);
    if (v.id) e.ids.set(v.id, (e.ids.get(v.id) || 0) + d);
  }
  // home of each era = the place where the most night hours were spent (total time breaks ties)
  const homes = [];
  for (const e of cl.values()) {
    e.la = e.sla / e.ms; e.lo = e.slo / e.ms;
    const h = homes[e.era];
    if (!h || e.night > h.night || (e.night === h.night && e.ms > h.ms)) homes[e.era] = e;
  }
  // "This place is my home" in the side panel overrides the guess
  for (let i = 0; i < nEra; i++) { const pick = HOME_PICK[i] ? cl.get(i + '|' + HOME_PICK[i]) : null; if (pick) homes[i] = pick; }
  for (let i = 0; i < nEra; i++) {
    const list = Array.from(cl.values()).filter(e => e.era === i).sort((p, q) => q.ms - p.ms);
    let letter = 0, works = 0;
    list.forEach(e => {
      e.km = haversineKm(homes[i].la, homes[i].lo, e.la, e.lo);
      e.home = e === homes[i] || e.km < HOME_KM;
      let nm = '', top = 0, topId = 0;
      for (const [n, ms] of e.names) if (ms > top) { top = ms; nm = n; }
      e.pid = '';
      for (const [id, ms] of e.ids) if (ms > topId) { topId = ms; e.pid = id; }     // Google's place id, for the map link
      if (!nm && !e.home && i === 1 && haversineKm(homes[0].la, homes[0].lo, e.la, e.lo) < 1) nm = 'Old home';
      if (!nm && !e.home && e.work > e.ms * 0.5) nm = works++ ? 'Work ' + works : 'Work';       // Google's own guess
      if (!nm && !e.home) { letter++; nm = 'Place ' + (letter < 26 ? String.fromCharCode(65 + letter) : letter + 1); }
      e.auto = e.home ? 'Home' : nm;
      e.label = NAMES[PLACE_M + '|' + e.key] || e.auto;
    });
  }
  CLUSTERS = cl;
  const stays = visits.map(v => { const e = cl.get(keyOf(v)); return { u: v.u, a: v.a, b: v.b, km: e.home ? 0 : e.km, pk: e.key, era: e.era }; });
  return ingest(stays, RAW.acts);
}

// stays: { u (real start), a, b (wall-clock), km, pk, era }. Order and gaps use real time, so a change of
// time zone (a flight, daylight saving) cannot shuffle or stretch anything. Positions on the dial use wall-clock time.
function ingest(stays, acts) {
  const endU = s => s.u + (s.b - s.a);
  stays = stays.filter(s => s.b - s.a >= 60000).sort((p, q) => p.u - q.u);
  for (let i = 0; i < stays.length - 1; i++) { const over = endU(stays[i]) - stays[i + 1].u; if (over > 0) stays[i].b -= over; }
  stays = stays.filter(s => s.b - s.a >= 60000);
  if (!stays.length) return false;

  let d0 = Infinity, d1 = -Infinity;
  for (const s of stays) { d0 = Math.min(d0, Math.floor(s.a / MS_DAY)); d1 = Math.max(d1, Math.floor((s.b - 1) / MS_DAY)); }
  N_DAYS = d1 - d0 + 1;
  DAYS = []; ERA_N = [0, 0];
  for (let i = 0; i < N_DAYS; i++) {
    const ms = (d0 + i) * MS_DAY, dt = new Date(ms), wd = dt.getUTCDay(), era = SPLIT_MS != null && ms >= SPLIT_MS ? 1 : 0;
    DAYS.push({ i: i, ms: ms, dow: wd, mon: dt.getUTCMonth(), yr: dt.getUTCFullYear(), dom: dt.getUTCDate(), era: era, ei: ERA_N[era]++,
      segs: [], legs: [], maxKm: 0, homeMin: 0, seenMin: 0, firstLeave: null });
  }
  let far = 0;
  stays.forEach((s, sid) => {
    far = Math.max(far, s.km);
    const dA = Math.floor(s.a / MS_DAY);
    for (let d = dA; d <= Math.floor((s.b - 1) / MS_DAY); d++) {
      const dd = DAYS[d - d0], lo = Math.max(s.a, d * MS_DAY), hi = Math.min(s.b, (d + 1) * MS_DAY);
      dd.segs.push({ day: dd.i, sid: sid, first: d === dA, h0: (lo - d * MS_DAY) / 3600000, h1: (hi - d * MS_DAY) / 3600000, km: s.km, pk: s.pk, era: s.era });
      if (s.era === dd.era) dd.maxKm = Math.max(dd.maxKm, s.km);     // on moving day, only the new home's distances count
      dd.seenMin += (hi - lo) / 60000;
      if (s.km < HOME_KM) dd.homeMin += (hi - lo) / 60000;
    }
  });
  // travel between two stays. Its mode is the recorded activity that overlaps the gap the most.
  acts = acts.slice().sort((p, q) => p.u - q.u);
  let j = 0;
  for (let i = 0; i < stays.length - 1; i++) {
    const p = stays[i], q = stays[i + 1], pEnd = endU(p), gap = q.u - pEnd;
    if (gap <= 0 || gap > 30 * 3600000 || p.era !== q.era) continue;      // longer gaps are missing data, not a journey
    while (j < acts.length && acts[j].ue <= pEnd) j++;
    let mode = 'other', best = 0;
    for (let k = j; k < acts.length && acts[k].u < q.u; k++) {
      const ov = Math.min(acts[k].ue, q.u) - Math.max(acts[k].u, pEnd);
      if (ov > best) { best = ov; mode = acts[k].mode; }
    }
    const dd = DAYS[Math.max(0, Math.min(N_DAYS - 1, Math.floor(p.b / MS_DAY) - d0))], h = (p.b - dd.ms) / 3600000;
    dd.legs.push({ h0: h, h1: h + gap / 3600000, kmA: p.km, kmB: q.km, mode: mode, era: p.era });
    if (p.km < HOME_KM && q.km >= HOME_KM && dd.firstLeave == null && h > 4) dd.firstLeave = h;
  }
  LOG_MAX = Math.max(1, Math.ceil(Math.log10(Math.max(far, 1))));
  YEARS = Array.from(new Set(DAYS.map(d => d.yr)));
  YR_ON = YEARS.map(() => true);
  DOW_ON.fill(true); MON_ON.fill(true);
  ERAS = SPLIT_MS != null ? [{ i: 0, title: 'Before the move' }, { i: 1, title: 'After the move' }] : [{ i: 0, title: 'All days' }];
  SEL = null; HSTAR = null; HOVER = null; PINNED = null; STARS = []; LAST_DAY = null; PREVIEW = null; DATA_V++;
  computeView();                       // the eras must carry their numbers before anything is drawn
  return true;
}

const isOn = dd => DOW_ON[dd.dow] && MON_ON[dd.mon] && YR_ON[YEARS.indexOf(dd.yr)];
const byNum = (p, q) => p - q;
const median = list => list.length ? list[Math.floor(list.length / 2)] : null;       // list must be sorted
const labelOf = pk => { const e = CLUSTERS.get(pk); return e ? e.label : 'Place'; };

// Everything the picture and the side panel need, for the days that are switched on.
function computeView() {
  PLACES = new Map();
  for (const er of ERAS) { er.days = 0; er.modes = {}; er.homeMin = 0; er.seenMin = 0; er.maxes = []; er.leaves = []; }
  for (const dd of DAYS) {
    if (!isOn(dd)) continue;
    const er = ERAS[dd.era];
    er.days++; er.homeMin += dd.homeMin; er.seenMin += dd.seenMin;
    if (dd.seenMin > 0) er.maxes.push(dd.maxKm);
    if (dd.firstLeave != null) er.leaves.push(dd.firstLeave);
    for (const lg of dd.legs) er.modes[lg.mode] = (er.modes[lg.mode] || 0) + 1;
    for (const s of dd.segs) {
      if (s.km < HOME_KM) continue;
      let p = PLACES.get(s.pk);
      if (!p) {
        p = { pk: s.pk, era: s.era, km: s.km, hrs: 0, sx: 0, sy: 0, durs: new Map(), dow: new Array(7).fill(0), months: new Map(), arrivals: [], dayset: new Set(), first: dd.ms, last: dd.ms };
        PLACES.set(s.pk, p);
      }
      const d = s.h1 - s.h0, a = angOf((s.h0 + s.h1) / 2);
      p.hrs += d; p.sx += Math.cos(a) * d; p.sy += Math.sin(a) * d;
      if (!p.durs.has(s.sid)) {                           // a new visit
        p.dow[dd.dow]++;
        const mk = dd.yr * 12 + dd.mon;
        p.months.set(mk, (p.months.get(mk) || 0) + 1);
        if (s.first) p.arrivals.push(s.h0);
      }
      p.durs.set(s.sid, (p.durs.get(s.sid) || 0) + d);
      p.dayset.add(dd.i);
      p.last = dd.ms;
    }
  }
  for (const er of ERAS) { er.maxes.sort(byNum); er.leaves.sort(byNum); er.typKm = median(er.maxes) || 0; }
}

// =====================================================================
// 4. DRAW
// =====================================================================
const angOf = h => (h / 24) * Math.PI * 2 - Math.PI / 2;
function rOf(km) {
  if (km < HOME_KM) return R_IN;
  return R_IN + (Math.log10(km) + 1) / (LOG_MAX + 1) * (R_OUT - R_IN);     // 100 m sits on the home ring
}
// inside each band, earlier days sit closer to the centre
const offOf = dd => ERA_N[dd.era] > 1 ? (dd.ei / (ERA_N[dd.era] - 1) * 2 - 1) * BAND : 0;
const sw = x => x * Math.max(0.8, SC);

function layoutStage() {
  const stage = document.getElementById('stage'), nD = ERAS.length;
  W = Math.max(300, Math.min(nD === 2 ? 1040 : 680, Math.floor(stage.clientWidth)));
  const stacked = nD === 2 && W < 620, CAP = 78;
  DSZ = Math.min(stacked || nD === 1 ? W : W / 2, 560);
  SC = DSZ / 680;
  R_OUT = DSZ / 2 - Math.max(34, 44 * SC);
  R_IN = R_OUT * 0.13;
  BAND = Math.max(3, R_OUT * 0.022);
  G = [];
  for (let i = 0; i < nD; i++) {
    G.push(stacked ? { cx: W / 2, cy: DSZ / 2 + 2 + i * (DSZ + CAP) } : { cx: W / nD * (i + 0.5), cy: DSZ / 2 + 2 });
  }
  const dialsBottom = (stacked ? 2 : 1) * (DSZ + CAP);
  STRIP_TOP = dialsBottom + 30;
  STRIP_H = 52;
  X0 = 14; X1 = W - 14;
  H = STRIP_TOP + STRIP_H + 24;
}

function setup() {
  loadNames();
  RAW = buildSample();
  autoMove();
  rebuild();
  layoutStage();
  pixelDensity(Math.min(2, window.devicePixelRatio || 1));
  CNV = createCanvas(W, H);
  CNV.parent('stage');
  CNV.elt.setAttribute('role', 'img');
  CNV.elt.setAttribute('aria-label', 'Two polar charts, one for each home. Each day is a trail around a 24 hour dial, farther from the centre when farther from home. Stars mark the places visited most.');
  TRAILS = createGraphics(W, H);
  noLoop();
  wirePointer();
  wireControls();
  showSource();
  refreshView();
  LAST_CW = Math.floor(document.getElementById('stage').clientWidth);
  new ResizeObserver(() => requestAnimationFrame(() => {
    const cw = Math.floor(document.getElementById('stage').clientWidth);
    if (cw !== LAST_CW) { LAST_CW = cw; relayout(); }
  })).observe(document.getElementById('stage'));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => redraw());
}

function relayout() {
  layoutStage();
  resizeCanvas(W, H, true);            // true = do not redraw yet: the view is recomputed first
  TRAILS.resizeCanvas(W, H, true);     // keep the same buffer; removing and recreating it throws in p5 1.x
  refreshView();
  redraw();
}

function refreshView() {
  computeView();
  if (SEL && !PLACES.has(SEL)) SEL = null;
  placeStars();
  renderTrails();
}

// The most-visited places of each home become stars: on their distance ring, at the hour I am usually there.
function placeStars() {
  STARS = [];
  for (const er of ERAS) {
    const list = Array.from(PLACES.values()).filter(p => p.era === er.i).sort((p, q) => q.hrs - p.hrs).slice(0, TOP_PLACES);
    list.forEach((p, rank) => {
      const g = G[er.i], a = Math.atan2(p.sy, p.sx), rr = rOf(p.km);
      STARS.push({ pk: p.pk, era: er.i, x: g.cx + rr * Math.cos(a), y: g.cy + rr * Math.sin(a),
        size: Math.max(2.6, Math.min(10, 1.6 + Math.sqrt(p.hrs) * 0.3)) * Math.max(0.8, SC * 1.25), tag: rank < 5 });
    });
  }
}

function traceSeg(g, c, s, off) {
  const r = rOf(s.km) + off;
  if (s.h1 - s.h0 >= 23.98) g.circle(c.cx, c.cy, r * 2);
  else g.arc(c.cx, c.cy, r * 2, r * 2, angOf(s.h0), angOf(s.h1));
}

function traceLeg(g, c, lg, off) {
  const rA = rOf(lg.kmA) + off, rB = rOf(lg.kmB) + off;
  const n = Math.max(4, Math.ceil((lg.h1 - lg.h0) * 60 / 8));
  g.beginShape();
  for (let k = 0; k <= n; k++) {
    const u = k / n, e = u * u * (3 - 2 * u);                 // leave and land softly
    const r = rA + (rB - rA) * e, a = angOf(lg.h0 + (lg.h1 - lg.h0) * u);
    g.vertex(c.cx + r * Math.cos(a), c.cy + r * Math.sin(a));
  }
  g.endShape();
}

// All visible days go into one offscreen buffer. It is redrawn only when the data or a filter changes.
function renderTrails() {
  TRAILS.clear();
  TRAILS.noFill();
  TRAILS.strokeCap(SQUARE);
  for (const dd of DAYS) {
    if (!isOn(dd)) continue;
    const off = offOf(dd);
    TRAILS.strokeWeight(sw(0.9));
    for (const lg of dd.legs) {
      const c = MODE_COL[lg.mode];
      TRAILS.stroke(c[0], c[1], c[2], lg.mode === 'other' ? 40 : 84);
      traceLeg(TRAILS, G[lg.era], lg, off);
    }
    TRAILS.stroke(C.trail[0], C.trail[1], C.trail[2], 54); TRAILS.strokeWeight(sw(1.3));
    for (const s of dd.segs) traceSeg(TRAILS, G[s.era], s, off);
  }
}

function draw() {
  background(C.sky[0], C.sky[1], C.sky[2]);
  textFont(MONO);
  // a pinned day wins over the pointer: it stays until it is clicked again
  const act = PINNED != null ? { day: PINNED, seg: null } : HOVER;
  drawGuides();
  image(TRAILS, 0, 0, W, H);
  FOCUS = SEL && PLACES.has(SEL) ? SEL : PREVIEW && PLACES.has(PREVIEW) ? PREVIEW : null;
  if (FOCUS) drawPlaceFocus(); else if (act) drawActiveDay(act);
  drawTypicalRings();
  drawStars(!!act && !FOCUS);
  drawDialLabels();
  drawCaptions();
  drawStrip(act);
  if (HSTAR) drawTip(starLines(HSTAR)); else if (HOVER && PINNED == null) drawTip(dayLines(HOVER));
  syncReadout();
  syncDayRoute(act);
  syncPlaceBook();
}

function drawGuides() {
  noFill(); strokeWeight(1); strokeCap(ROUND);
  for (const g of G) {
    stroke(24, 31, 62);
    for (let h = 0; h < 24; h += 6) {
      const a = angOf(h);
      line(g.cx + R_IN * 1.7 * Math.cos(a), g.cy + R_IN * 1.7 * Math.sin(a), g.cx + R_OUT * Math.cos(a), g.cy + R_OUT * Math.sin(a));
    }
    stroke(C.rule[0], C.rule[1], C.rule[2]);
    for (let p = 0; p <= LOG_MAX; p++) circle(g.cx, g.cy, rOf(Math.pow(10, p)) * 2);
    const t0 = R_OUT + BAND + 3;
    for (let h = 0; h < 24; h++) {
      const a = angOf(h), big = h % 3 === 0, c = big ? C.muted : C.dim, t1 = t0 + (big ? 7 : 4);
      stroke(c[0], c[1], c[2]);
      line(g.cx + t0 * Math.cos(a), g.cy + t0 * Math.sin(a), g.cx + t1 * Math.cos(a), g.cy + t1 * Math.sin(a));
    }
  }
}

function veil(era) {
  const g = G[era];
  noStroke(); fill(C.sky[0], C.sky[1], C.sky[2], 176);
  rect(g.cx - DSZ / 2, g.cy - DSZ / 2, DSZ, DSZ);
}

// One place: every stay there stays lit, so the arcs show when I go and for how long.
function drawPlaceFocus() {
  const p = PLACES.get(FOCUS);
  if (!p) return;
  veil(p.era);
  noFill(); strokeCap(SQUARE); stroke(255, 255, 255, 150); strokeWeight(sw(1.5));
  for (const dd of DAYS) {
    if (!isOn(dd) || !p.dayset.has(dd.i)) continue;
    const off = offOf(dd);
    for (const s of dd.segs) if (s.pk === FOCUS) traceSeg(window, G[s.era], s, off);
  }
}

function drawActiveDay(act) {
  const dd = DAYS[act.day], off = offOf(dd);
  veil(dd.era);
  noFill(); strokeCap(ROUND); strokeWeight(sw(1.6));
  for (const lg of dd.legs) { const c = MODE_COL[lg.mode]; stroke(c[0], c[1], c[2]); traceLeg(window, G[lg.era], lg, off); }
  stroke(255);
  for (const s of dd.segs) { strokeWeight(sw(s === act.seg ? 3.8 : 2.4)); traceSeg(window, G[s.era], s, off); }
  textSize(Math.max(9, 10 * SC)); strokeJoin(ROUND);
  const seen = new Set();
  for (const s of dd.segs) {
    if (s.km < HOME_KM || s.h1 - s.h0 < 0.5 || seen.has(s.pk)) continue;
    seen.add(s.pk);
    const g = G[s.era], a = angOf((s.h0 + s.h1) / 2), r = rOf(s.km) + off + 11 * Math.max(0.8, SC);
    textAlign(Math.cos(a) >= 0 ? LEFT : RIGHT, CENTER);
    stroke(C.sky[0], C.sky[1], C.sky[2]); strokeWeight(4); fill(255);
    text(labelOf(s.pk), g.cx + r * Math.cos(a), g.cy + r * Math.sin(a));
  }
}

function drawTypicalRings() {
  const ctx = drawingContext;
  noFill(); stroke(255, 255, 255, 190); strokeWeight(1.2);
  ctx.setLineDash([5, 5]);
  for (const er of ERAS) if (er.typKm >= HOME_KM) circle(G[er.i].cx, G[er.i].cy, rOf(er.typKm) * 2);
  ctx.setLineDash([]);
}

function drawStars(dayLit) {
  const ctx = drawingContext;
  textSize(Math.max(10, 11 * SC)); strokeJoin(ROUND);
  for (const st of STARS) {
    const on = !FOCUS || FOCUS === st.pk, hot = HSTAR === st.pk || FOCUS === st.pk;
    noStroke();
    ctx.shadowColor = 'rgba(255,255,255,' + (on ? 0.9 : 0.15) + ')';
    ctx.shadowBlur = hot ? 18 : 9;
    fill(255, 255, 255, on ? 250 : 60);
    circle(st.x, st.y, st.size * 2);
    ctx.shadowBlur = 0;
    if (hot) { noFill(); stroke(255); strokeWeight(1); circle(st.x, st.y, st.size * 2 + 9); }
  }
  // names: the hovered or selected star first, then the biggest ones. A name that would collide is skipped.
  const isHot = st => HSTAR === st.pk || FOCUS === st.pk;
  const named = STARS.filter(st => (st.tag && !FOCUS && !dayLit) || isHot(st)).sort((p, q) => (isHot(q) ? 1 : 0) - (isHot(p) ? 1 : 0));
  const boxes = [];
  textAlign(LEFT, CENTER);
  for (const st of named) {
    const lab = labelOf(st.pk), tw = textWidth(lab), pad = st.size + 7;
    let right = st.x >= G[st.era].cx;
    if (right && st.x + pad + tw > W - 4) right = false;
    if (!right && st.x - pad - tw < 4) right = true;
    const x0 = right ? st.x + pad : st.x - pad - tw, box = [x0 - 3, st.y - 8, x0 + tw + 3, st.y + 8];
    if (!isHot(st) && boxes.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
    boxes.push(box);
    stroke(C.sky[0], C.sky[1], C.sky[2]); strokeWeight(4); fill(255);
    text(lab, x0, st.y);
  }
}

function drawDialLabels() {
  G.forEach((g, i) => {
    noStroke(); fill(C.muted[0], C.muted[1], C.muted[2]);
    textSize(Math.max(9, 11 * SC)); textAlign(CENTER, CENTER);
    const rl = R_OUT + BAND + 20;
    for (let h = 0; h < 24; h += 3) {
      const a = angOf(h), lab = h === 0 ? 'midnight' : h === 12 ? 'noon' : (h < 10 ? '0' : '') + h;
      text(lab, g.cx + rl * Math.cos(a), g.cy + rl * Math.sin(a));
    }
    if (i === 0) {                                      // distance rings are named once, along the 03:00 spoke
      const a = angOf(3.25);
      textAlign(LEFT, CENTER); textSize(Math.max(8.5, 10 * SC));
      stroke(C.sky[0], C.sky[1], C.sky[2]); strokeWeight(4); strokeJoin(ROUND);
      for (let p = 0; p <= LOG_MAX; p++) {
        const r = rOf(Math.pow(10, p));
        text(fmtKm(Math.pow(10, p)), g.cx + r * Math.cos(a) + 4, g.cy + r * Math.sin(a) - 7);
      }
    }
    if (R_IN - BAND > 16) { noStroke(); fill(C.muted[0], C.muted[1], C.muted[2]); textAlign(CENTER, CENTER); textSize(Math.max(8, 9 * SC)); text('HOME', g.cx, g.cy); }
  });
}

function modeLine(er, tot) {
  const parts = MODES.filter(m => m !== 'other' && er.modes[m]).sort((p, q) => er.modes[q] - er.modes[p]).slice(0, 3);
  if (parts.indexOf('car') < 0) parts.push('car');
  return 'trips: ' + parts.map(m => MODE_NAME[m] + ' ' + Math.round((er.modes[m] || 0) / tot * 100) + '%').join(' · ');
}

// Under each dial: which home, how far a typical day reaches, and how I got around.
function drawCaptions() {
  for (const er of ERAS) {
    const g = G[er.i], y0 = g.cy + DSZ / 2 + 4;
    noStroke(); textAlign(CENTER, BASELINE);
    fill(C.ink[0], C.ink[1], C.ink[2]); textSize(12);
    text(er.title + ' · ' + er.days + ' days', g.cx, y0 + 10);
    fill(C.muted[0], C.muted[1], C.muted[2]); textSize(11);
    text(er.typKm >= HOME_KM ? 'a typical day reaches ' + fmtKm(er.typKm) + ' from home' : 'a typical day stays at home', g.cx, y0 + 27);
    const tot = MODES.reduce((n, m) => n + (er.modes[m] || 0), 0);
    if (!tot) continue;
    const bw = Math.min(DSZ - 60, 320);
    let x = g.cx - bw / 2;
    for (const m of MODES) {
      const f = (er.modes[m] || 0) / tot;
      if (!f) continue;
      const c = MODE_COL[m];
      fill(c[0], c[1], c[2]); rect(x, y0 + 37, Math.max(0.5, bw * f - 1), 6);
      x += bw * f;
    }
    fill(C.muted[0], C.muted[1], C.muted[2]); textSize(10);
    text(modeLine(er, tot), g.cx, y0 + 59);
  }
}

// One bar per day under the dials: how far that day reached. Also a scrubber.
function drawStrip(act) {
  const bw = (X1 - X0) / N_DAYS, base = STRIP_TOP + STRIP_H, selP = FOCUS ? PLACES.get(FOCUS) : null;
  noStroke(); fill(C.muted[0], C.muted[1], C.muted[2]); textSize(10);
  textAlign(LEFT, BASELINE);
  text(selP ? 'DAYS WITH A VISIT TO ' + labelOf(FOCUS).toUpperCase() : 'FARTHEST POINT OF EACH DAY', X0, STRIP_TOP - 9);
  textAlign(RIGHT, BASELINE); text('log scale', X1, STRIP_TOP - 9);
  const longSpan = N_DAYS > 550, pxMonth = (X1 - X0) / Math.max(1, N_DAYS / 30.4), skip = pxMonth < 26 ? 2 : 1;
  let mCount = 0;
  for (const dd of DAYS) {
    const x = X0 + dd.i * bw;
    const hgt = 2 + (Math.log10(Math.max(dd.maxKm, HOME_KM)) + 1) / (LOG_MAX + 1) * (STRIP_H - 2);
    const lit = selP ? selP.dayset.has(dd.i) : false;
    if ((act && act.day === dd.i) || lit) fill(255);
    else fill(C.trail[0], C.trail[1], C.trail[2], selP ? 30 : isOn(dd) ? 190 : 34);
    rect(x, base - hgt, Math.max(bw - 0.4, 0.8), hgt);
    if (dd.dom === 1) {
      fill(C.dim[0], C.dim[1], C.dim[2]); rect(x, base + 2, 1, 4);
      const show = longSpan ? dd.mon === 0 : mCount % skip === 0;
      if (show) { fill(C.muted[0], C.muted[1], C.muted[2]); textAlign(LEFT, BASELINE); text(longSpan ? String(dd.yr) : MONTHS[dd.mon], x + 2, base + 17); }
      mCount++;
    }
  }
  if (SPLIT_MS != null) {                               // the day home changed
    const x = X0 + (SPLIT_MS - DAYS[0].ms) / MS_DAY * bw, ctx = drawingContext;
    stroke(255); strokeWeight(1); ctx.setLineDash([3, 3]); line(x, STRIP_TOP - 4, x, base); ctx.setLineDash([]);
    noStroke(); fill(255); textAlign(CENTER, BASELINE); text('moved', x, STRIP_TOP - 9);
  }
  if (act) {
    const x = X0 + (act.day + 0.5) * bw;
    noStroke(); fill(255); triangle(x - 4, STRIP_TOP - 6, x + 4, STRIP_TOP - 6, x, STRIP_TOP - 1);
  }
}

function starLines(pk) {
  const p = PLACES.get(pk);
  if (!p) return [labelOf(pk)];
  return [labelOf(pk), fmtH(p.hrs) + ' over ' + p.durs.size + (p.durs.size === 1 ? ' visit' : ' visits'), fmtKm(p.km) + ' from home', 'click for details'];
}
function dayLines(hv) {
  const dd = DAYS[hv.day], s = hv.seg;
  return s
    ? [fmtDate(dd.ms), hm(s.h0) + ' to ' + hm(s.h1) + '  ' + labelOf(s.pk), s.km < HOME_KM ? 'at home' : fmtKm(s.km) + ' from home']
    : [fmtDate(dd.ms), 'farthest ' + (dd.maxKm < HOME_KM ? 'stayed home' : fmtKm(dd.maxKm)), fmtH(dd.homeMin / 60) + ' at home'];
}
function drawTip(lines) {
  textSize(11); textAlign(LEFT, BASELINE);
  let tw = 0;
  for (const l of lines) tw = Math.max(tw, textWidth(l));
  const bw = tw + 18, bh = lines.length * 16 + 10;
  let tx = PTR.x + 14, ty = PTR.y + 14;
  if (tx + bw > W - 4) tx = PTR.x - bw - 14;
  if (ty + bh > H - 4) ty = PTR.y - bh - 14;
  tx = Math.max(4, tx); ty = Math.max(4, ty);
  stroke(C.muted[0], C.muted[1], C.muted[2]); strokeWeight(1); fill(14, 20, 48, 245);
  rect(tx, ty, bw, bh, 4);
  noStroke();
  lines.forEach((l, i) => {
    if (i === 0) fill(255); else fill(C.muted[0], C.muted[1], C.muted[2]);
    text(l, tx + 9, ty + 19 + i * 16);
  });
}

// ---- formatting ------------------------------------------------------
function fmtKm(km) {
  if (km < 1) return Math.round(km * 100) * 10 + ' m';
  if (km < 10) return km.toFixed(1) + ' km';
  return Math.round(km).toLocaleString('en-US') + ' km';
}
function fmtH(h) {
  if (h < 1) return Math.round(h * 60) + ' min';
  return (h < 100 ? h.toFixed(1) : Math.round(h).toLocaleString('en-US')) + ' h';
}
function hm(h) {
  const m = Math.round(h * 60), hh = Math.floor(m / 60) % 24, mm = m % 60;
  return (m === 1440 ? '24' : (hh < 10 ? '0' : '') + hh) + ':' + (mm < 10 ? '0' : '') + mm;
}
function fmtDate(ms, withYear) {
  const o = { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' };
  if (withYear) o.year = 'numeric';
  return new Date(ms).toLocaleDateString('en-US', o);
}
const isoDay = ms => new Date(ms).toISOString().slice(0, 10);

// =====================================================================
// INTERACTION
// =====================================================================
function pickHover() {
  HOVER = null; HSTAR = null;
  if (PTR.y >= STRIP_TOP - 8 && PTR.y <= STRIP_TOP + STRIP_H + 20 && PTR.x >= X0 && PTR.x <= X1) {
    const d = Math.min(N_DAYS - 1, Math.max(0, Math.floor((PTR.x - X0) / (X1 - X0) * N_DAYS)));
    if (isOn(DAYS[d])) HOVER = { day: d, seg: null };
    return;
  }
  let near = 1e9;
  for (const st of STARS) {                             // stars win over trails
    const d = Math.hypot(PTR.x - st.x, PTR.y - st.y);
    if (d < Math.max(st.size + 5, 10) && d < near) { near = d; HSTAR = st.pk; }
  }
  if (HSTAR) return;
  let era = 0, gd = 1e9;
  G.forEach((g, i) => { const d = Math.hypot(PTR.x - g.cx, PTR.y - g.cy); if (d < gd) { gd = d; era = i; } });
  if (gd > R_OUT + BAND + 8 || gd < R_IN - BAND - 8) return;
  const g = G[era], hr = ((Math.atan2(PTR.y - g.cy, PTR.x - g.cx) + Math.PI / 2) / (Math.PI * 2) * 24 + 24) % 24;
  let best = null, bd = 7;
  for (const dd of DAYS) {
    if (!isOn(dd)) continue;
    const off = offOf(dd);
    for (const s of dd.segs) {
      if (s.era !== era || hr < s.h0 || hr > s.h1 || (SEL && s.pk !== SEL)) continue;
      const gap = Math.abs(rOf(s.km) + off - gd);
      if (gap < bd) { bd = gap; best = s; }
    }
  }
  if (best) HOVER = { day: best.day, seg: best };
}

function wirePointer() {
  const el = CNV.elt;
  const at = e => {
    const r = el.getBoundingClientRect();
    PTR.x = (e.clientX - r.left) * (W / r.width);
    PTR.y = (e.clientY - r.top) * (H / r.height);
  };
  el.addEventListener('pointermove', e => { at(e); pickHover(); el.style.cursor = HSTAR ? 'pointer' : 'default'; redraw(); });
  el.addEventListener('pointerleave', () => { HOVER = null; HSTAR = null; redraw(); });
  el.addEventListener('pointerdown', e => {
    at(e); pickHover();
    if (HSTAR) { SEL = SEL === HSTAR ? null : HSTAR; PINNED = null; if (SEL) openPanel(); }
    else if (PINNED != null) PINNED = null;                    // second click anywhere on the picture: let the day go
    else if (HOVER && !SEL) PINNED = HOVER.day;                // first click: pin the day under the pointer
    else if (!HOVER) SEL = null;
    if (e.pointerType !== 'mouse') { HOVER = null; HSTAR = null; }
    redraw();
  });
  window.addEventListener('keydown', e => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'Escape') { PINNED = null; SEL = null; redraw(); return; }
    if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || PINNED == null) return;
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    for (let j = PINNED + dir; j >= 0 && j < N_DAYS; j += dir) if (isOn(DAYS[j])) { PINNED = j; break; }
    e.preventDefault();
    redraw();
  });
}

// click a chip while everything is on: isolate it. After that chips add or remove.
function solo(flags, i) {
  if (flags.every(Boolean)) { flags.fill(false); flags[i] = true; }
  else { flags[i] = !flags[i]; if (!flags.some(Boolean)) flags.fill(true); }
}

function syncChips() { document.querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', String(b._get()))); }

function filtersChanged() {
  syncChips();
  if (PINNED != null && !isOn(DAYS[PINNED])) PINNED = null;
  HOVER = null; HSTAR = null;
  refreshView();
  redraw();
}

// the move date or the place size changed: redo the cleaning step
function dataChanged() {
  if (!rebuild()) return;
  buildChips();
  showSource();
  relayout();
}

function makeChips(hostId, items) {
  const host = document.getElementById(hostId);
  host.textContent = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button'; b.id = it.id; b.className = 'chip'; b.textContent = it.label;
    b._get = it.get;
    b.setAttribute('aria-pressed', String(it.get()));
    b.addEventListener('click', it.hit);
    host.appendChild(b);
  }
}

function buildChips() {
  makeChips('sizeChips', SIZES.map(sz => ({ id: 'size' + sz[0], label: sz[1], get: () => PLACE_M === sz[0], hit: () => { PLACE_M = sz[0]; HOME_PICK = [null, null]; dataChanged(); } })));
  makeChips('dowChips', DOW_ORDER.map(d => ({ id: 'dow' + d, label: DOW_NAMES[d], get: () => DOW_ON[d], hit: () => { solo(DOW_ON, d); filtersChanged(); } })));
  makeChips('monChips', MONTHS.map((m, i) => ({ id: 'mon' + i, label: m, get: () => MON_ON[i], hit: () => { solo(MON_ON, i); filtersChanged(); } })));
  makeChips('yrChips', YEARS.map((y, i) => ({ id: 'yr' + y, label: String(y), get: () => YR_ON[i], hit: () => { solo(YR_ON, i); filtersChanged(); } })));
  document.getElementById('yrGroup').hidden = YEARS.length < 2;
}

function showSource(problem) {
  const line = document.getElementById('srcLine'), note = document.getElementById('moveNote'), inp = document.getElementById('moveDate');
  line.classList.toggle('bad', !!problem);
  inp.value = MOVE_MS != null ? isoDay(MOVE_MS) : '';
  note.textContent = MOVE_MS == null ? 'not set, one dial' : SPLIT_MS == null ? 'under ' + MIN_ERA_DAYS + ' days on one side, one dial' : MOVE_AUTO ? 'found in the data' : '';
  document.getElementById('sampleBtn').hidden = !RAW.file;
  if (problem) { line.textContent = problem; return; }
  line.textContent = RAW.file
    ? 'Showing ' + RAW.file + ', ' + N_DAYS.toLocaleString('en-US') + ' days. Read inside this browser only. Nothing is uploaded.'
    : 'Showing synthetic sample data, not a real person. Load a Google Maps Timeline export to see your own.';
}

function loadNames() { try { NAMES = JSON.parse(localStorage.getItem('homeStarTrails.names') || '{}') || {}; } catch (e) { NAMES = {}; } }
function saveNames() { try { localStorage.setItem('homeStarTrails.names', JSON.stringify(NAMES)); } catch (e) { /* names then last for this visit only */ } }

function wireControls() {
  buildChips();
  const set = (flags, fn) => { for (let i = 0; i < flags.length; i++) flags[i] = fn(i); filtersChanged(); };
  document.getElementById('preAll').addEventListener('click', () => set(DOW_ON, () => true));
  document.getElementById('preWd').addEventListener('click', () => set(DOW_ON, i => i >= 1 && i <= 5));
  document.getElementById('preWe').addEventListener('click', () => set(DOW_ON, i => i === 0 || i === 6));
  document.getElementById('preMon').addEventListener('click', () => set(MON_ON, () => true));

  document.getElementById('moveDate').addEventListener('change', e => {
    const v = e.target.value;
    MOVE_MS = v ? Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10)) : null;
    MOVE_U = null; MOVE_AUTO = false; HOME_PICK = [null, null];
    dataChanged();
  });

  const fileIn = document.getElementById('fileIn');
  const useData = raw => { RAW = raw; autoMove(); return rebuild(); };
  document.getElementById('loadBtn').addEventListener('click', () => fileIn.click());
  document.getElementById('sampleBtn').addEventListener('click', () => { useData(buildSample()); buildChips(); showSource(); relayout(); });
  // while testing with real data: lists how Google labelled the travel segments
  window.debugModes = () => console.table(DAYS.reduce((m, d) => { d.legs.forEach(l => { m[l.mode] = (m[l.mode] || 0) + 1; }); return m; }, {}));
  fileIn.addEventListener('change', async () => {
    const files = Array.from(fileIn.files || []);
    if (!files.length) return;
    showSource('Reading ' + files.length + (files.length === 1 ? ' file' : ' files') + '…');
    const keep = [RAW, MOVE_MS, MOVE_U, MOVE_AUTO];
    const restore = () => { RAW = keep[0]; MOVE_MS = keep[1]; MOVE_U = keep[2]; MOVE_AUTO = keep[3]; };
    let raw = null;
    try {
      raw = { visits: [], acts: [], file: files.length === 1 ? files[0].name : files.length + ' files' };
      for (const f of files) { const part = readTimeline(JSON.parse(await f.text())); raw.visits = raw.visits.concat(part.visits); raw.acts = raw.acts.concat(part.acts); }
    } catch (err) {
      raw = null;
      showSource('That file could not be read as JSON. Pick the Timeline.json or location-history.json export.');
    }
    if (raw) {
      if (!raw.visits.length || !useData(raw)) {
        restore(); rebuild();
        showSource('No visits found in that file. It needs a Google Maps Timeline export that contains visits (semanticSegments).');
      } else { buildChips(); showSource(); }
      relayout();
    }
    fileIn.value = '';
  });
}

// ---- side panel: a place, a day, or a summary of each home ----------------
function elx(tag, txt, cls) { const n = document.createElement(tag); if (txt != null) n.textContent = txt; if (cls) n.className = cls; return n; }
function dlOf(rows) {
  const dl = document.createElement('dl');
  for (const r of rows) { dl.appendChild(elx('dt', r[0])); dl.appendChild(elx('dd', r[1])); }
  return dl;
}
function miniBars(caption, values, ticks) {
  const box = elx('div', null, 'mini'), bars = elx('div', null, 'bars'), tk = elx('div', null, 'ticks');
  const top = Math.max(1, Math.max.apply(null, values));
  box.appendChild(elx('p', caption));
  values.forEach((v, i) => { const b = document.createElement('div'); b.style.height = (v ? Math.max(6, v / top * 100) : 0) + '%'; b.title = ticks[i] + ': ' + v; bars.appendChild(b); tk.appendChild(elx('span', ticks[i])); });
  box.appendChild(bars); box.appendChild(tk);
  return box;
}

function renamePlace(pk, raw) {
  const cl = CLUSTERS.get(pk);
  if (!cl) return;
  const v = String(raw).trim(), k = PLACE_M + '|' + pk;
  if (v && v !== cl.auto) NAMES[k] = v; else delete NAMES[k];
  cl.label = v || cl.auto;
  saveNames(); NAME_V++; redraw();
}
// Opens the spot in Google Maps so I can see what it is before naming it. Google's place id makes the map show the place itself.
function mapHref(cl) {
  return 'https://www.google.com/maps/search/?api=1&query=' + cl.la.toFixed(6) + '%2C' + cl.lo.toFixed(6) + (cl.pid ? '&query_place_id=' + encodeURIComponent(cl.pid) : '');
}
function openPanel() { document.getElementById('roWrap').open = true; }
function pickPlace(pk) { if (!PLACES.has(pk)) return; SEL = pk; PINNED = null; openPanel(); redraw(); }
const rgbOf = c => 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';

// One row per calendar month over all days (the chips do not apply here): reach, most visited place, share of car trips.
function monthRows() {
  const m = new Map();
  for (const dd of DAYS) {
    const mk = dd.yr * 12 + dd.mon;
    let r = m.get(mk);
    if (!r) { r = { mk: mk, yr: dd.yr, mon: dd.mon, days: 0, maxes: [], visits: new Map(), hrs: new Map(), sids: new Set(), car: 0, legs: 0 }; m.set(mk, r); }
    if (dd.seenMin > 0) { r.days++; r.maxes.push(dd.maxKm); }
    for (const lg of dd.legs) if (lg.mode !== 'other') { r.legs++; if (lg.mode === 'car') r.car++; }
    for (const s of dd.segs) {
      if (s.km < HOME_KM) continue;
      r.hrs.set(s.pk, (r.hrs.get(s.pk) || 0) + s.h1 - s.h0);
      if (r.sids.has(s.sid)) continue;
      r.sids.add(s.sid);
      r.visits.set(s.pk, (r.visits.get(s.pk) || 0) + 1);
    }
  }
  return Array.from(m.values()).sort((p, q) => p.mk - q.mk).map(r => {
    r.maxes.sort(byNum); r.typ = median(r.maxes) || 0; r.top = null; r.topN = 0;
    for (const [pk, n] of r.visits) if (n > r.topN) { r.topN = n; r.top = pk; }
    return r;
  });
}
const monthIsolated = r => MON_ON.every((on, i) => on === (i === r.mon)) && YR_ON.every((on, i) => on === (YEARS[i] === r.yr));
function isolateMonth(r) {
  if (monthIsolated(r)) { MON_ON.fill(true); YR_ON.fill(true); }
  else { for (let i = 0; i < 12; i++) MON_ON[i] = i === r.mon; for (let i = 0; i < YEARS.length; i++) YR_ON[i] = YEARS[i] === r.yr; }
  filtersChanged();
}

// ---- side panel: one place, or the summary (overall or month by month) ----
function syncReadout() {
  const key = [SEL || '', SUM_TAB, DOW_ON.join(''), MON_ON.join(''), YR_ON.join(''), DATA_V, NAME_V].join('|');
  if (key === RO_KEY) return;
  RO_KEY = key;
  const title = document.getElementById('roTitle'), box = document.getElementById('readout');
  box.textContent = '';
  const selP = SEL ? PLACES.get(SEL) : null;

  if (selP) {                                           // ---- one place
    const cl = CLUSTERS.get(SEL), durs = Array.from(selP.durs.values()).sort(byNum), arr = selP.arrivals.slice().sort(byNum);
    title.textContent = ERAS.length > 1 ? 'Place · ' + ERAS[selP.era].title.toLowerCase() : 'Place';
    const back = elx('button', '← back to summary', 'link');
    back.type = 'button'; back.id = 'backSum';
    back.addEventListener('click', () => { SEL = null; redraw(); });
    box.appendChild(back);
    const f = elx('div', null, 'field'), lab = elx('label', 'Name this place'), inp = document.createElement('input');
    lab.htmlFor = 'placeName'; inp.id = 'placeName'; inp.type = 'text'; inp.value = cl.label; inp.maxLength = 40; inp.autocomplete = 'off'; inp.placeholder = 'e.g. Gym';
    const namedPk = SEL;
    inp.addEventListener('change', () => renamePlace(namedPk, inp.value));
    f.appendChild(lab); f.appendChild(inp); box.appendChild(f);
    if (RAW.file) {                                     // not for the made-up sample points
      const a = elx('a', 'Not sure where this is? Open it in Google Maps', 'maplink');
      a.id = 'mapLink'; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.href = mapHref(cl);
      box.appendChild(a);
    }
    box.appendChild(dlOf([
      ['Visits', String(selP.durs.size)],
      ['Total time', fmtH(selP.hrs)],
      ['Typical stay', durs.length ? fmtH(median(durs)) : 'no data'],
      ['Usually arrive at', arr.length ? hm(median(arr)) : 'no data'],
      ['From home', fmtKm(selP.km)],
      ['First visit', fmtDate(selP.first, true)],
      ['Last visit', fmtDate(selP.last, true)]
    ]));
    box.appendChild(miniBars('Visits by day of the week', DOW_ORDER.map(d => selP.dow[d]), DOW_ORDER.map(d => DOW_NAMES[d][0])));
    const eraDays = DAYS.filter(d => d.era === selP.era), mk0 = eraDays[0].yr * 12 + eraDays[0].mon, mk1 = eraDays[eraDays.length - 1].yr * 12 + eraDays[eraDays.length - 1].mon;
    const mv = [], mt = [];
    for (let mk = mk0; mk <= mk1; mk++) { mv.push(selP.months.get(mk) || 0); mt.push(MONTHS[mk % 12][0]); }
    box.appendChild(miniBars('Visits by month', mv, mt));
    // home is guessed from where the night hours go. If the guess is wrong, any place can be made home.
    const pickedPk = SEL, pickedEra = selP.era, hb = elx('button', 'This place is my home', 'btn ghost');
    hb.type = 'button'; hb.id = 'makeHome';
    hb.addEventListener('click', () => { HOME_PICK[pickedEra] = pickedPk.slice(pickedPk.indexOf('|') + 1); dataChanged(); });
    box.appendChild(hb);
    return;
  }

  title.textContent = 'Summary';                        // ---- summary
  const tabs = elx('div', null, 'tabs');
  [['all', 'Overall'], ['month', 'By month']].forEach(t => {
    const b = elx('button', t[1], 'tab');
    b.type = 'button'; b.id = 'tab-' + t[0]; b.setAttribute('aria-pressed', String(SUM_TAB === t[0]));
    b.addEventListener('click', () => { SUM_TAB = t[0]; redraw(); });
    tabs.appendChild(b);
  });
  box.appendChild(tabs);

  if (SUM_TAB === 'month') {                            // one row per month; click a row to show only that month
    const tb = document.createElement('table'), head = document.createElement('tr');
    tb.className = 'months';
    ['Month', 'Reach', 'Most visited', 'Car'].forEach(t => head.appendChild(elx('th', t)));
    tb.appendChild(head);
    const rows = monthRows();
    for (const r of rows) {
      const tr = document.createElement('tr');
      tr.className = 'rowBtn'; tr.tabIndex = 0; tr.setAttribute('role', 'button'); tr.setAttribute('aria-pressed', String(monthIsolated(r) && !MON_ON.every(Boolean)));
      [MONTHS[r.mon] + ' ' + String(r.yr).slice(2), r.days ? (r.typ >= HOME_KM ? fmtKm(r.typ) : 'home') : '–',
        r.top ? labelOf(r.top) + ' ×' + r.topN : '–', r.legs ? Math.round(r.car / r.legs * 100) + '%' : '–'].forEach(t => tr.appendChild(elx('td', t)));
      tr.addEventListener('click', () => isolateMonth(r));
      tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); isolateMonth(r); } });
      tb.appendChild(tr);
    }
    box.appendChild(tb);
    box.appendChild(elx('p', 'Reach is how far a typical day got from home. Click a month to show only that month on the dials.', 'cap'));
    // the five most visited places of one month: the month that is clicked, else the latest one
    const pickM = rows.find(r => monthIsolated(r) && !MON_ON.every(Boolean)) || rows[rows.length - 1];
    if (pickM && pickM.visits.size) {
      box.appendChild(elx('p', 'Most visited in ' + MONTHS[pickM.mon] + ' ' + pickM.yr + ' (visits, time)', 'cap'));
      const ol = elx('ol', null, 'rank');
      Array.from(pickM.visits.entries()).sort((p, q) => q[1] - p[1] || (pickM.hrs.get(q[0]) || 0) - (pickM.hrs.get(p[0]) || 0)).slice(0, 5).forEach(e => {
        const li = document.createElement('li'), b = document.createElement('button');
        b.type = 'button';
        b.appendChild(elx('span', labelOf(e[0]))); b.appendChild(elx('span', e[1] + '\u00d7', 'n')); b.appendChild(elx('span', fmtH(pickM.hrs.get(e[0]) || 0), 'n'));
        b.addEventListener('click', () => pickPlace(e[0]));
        li.appendChild(b); ol.appendChild(li);
      });
      box.appendChild(ol);
    }
    return;
  }

  for (const er of ERAS) {                              // each home, for the days that are switched on
    const tot = MODES.reduce((n, m) => n + (er.modes[m] || 0), 0), pct = m => tot ? Math.round((er.modes[m] || 0) / tot * 100) + '%' : 'no data';
    const sec = document.createElement('div');
    sec.appendChild(elx('h3', er.title + ' · ' + er.days.toLocaleString('en-US') + ' days'));
    sec.appendChild(dlOf([
      ['Typical day reaches', er.typKm >= HOME_KM ? fmtKm(er.typKm) : 'stays home'],
      ['Farthest from home', er.maxes.length ? fmtKm(er.maxes[er.maxes.length - 1]) : 'no data'],
      ['Share of time at home', er.seenMin ? Math.round(er.homeMin / er.seenMin * 100) + '%' : 'no data'],
      ['Usually leave home at', er.leaves.length ? hm(median(er.leaves)) : 'no data'],
      ['Trips by car', pct('car')],
      ['Trips on foot or by bike', tot ? Math.round(((er.modes.walk || 0) + (er.modes.bike || 0)) / tot * 100) + '%' : 'no data']
    ]));
    const top = Array.from(PLACES.values()).filter(p => p.era === er.i).sort((p, q) => q.durs.size - p.durs.size || q.hrs - p.hrs).slice(0, 5);
    if (top.length) {
      sec.appendChild(elx('p', 'Most visited places (visits, time)', 'cap'));
      const ol = elx('ol', null, 'rank');
      for (const p of top) {
        const li = document.createElement('li'), b = document.createElement('button');
        b.type = 'button';
        b.appendChild(elx('span', labelOf(p.pk))); b.appendChild(elx('span', p.durs.size + '×', 'n')); b.appendChild(elx('span', fmtH(p.hrs), 'n'));
        b.addEventListener('click', () => pickPlace(p.pk));
        li.appendChild(b); ol.appendChild(li);
      }
      sec.appendChild(ol);
    }
    box.appendChild(sec);
  }
}

// ---- under the dials: one day laid out left to right, so the order of places is plain ----
// It keeps showing the last day that was hovered or pinned. Hover a block for the place, the times and the distance.
function syncDayRoute(act) {
  if (act) LAST_DAY = act.day;
  const key = [LAST_DAY, PINNED, DATA_V, NAME_V].join('|');
  if (key === RT_KEY) return;
  RT_KEY = key;
  const box = document.getElementById('dayRoute');
  box.textContent = '';
  box.appendChild(elx('h2', 'Route of one day'));
  if (LAST_DAY == null || !DAYS[LAST_DAY]) {
    box.appendChild(elx('p', 'Hover a day on the strip above to see where I went, in order. Click to keep that day, click again to let it go.', 'rt-sub'));
    return;
  }
  const dd = DAYS[LAST_DAY], segs = dd.segs.slice().sort((p, q) => p.h0 - q.h0);
  const pinned = PINNED === LAST_DAY, sub = elx('p', fmtDate(dd.ms, true) + ' \u00b7 farthest point ' + (dd.maxKm < HOME_KM ? 'home' : fmtKm(dd.maxKm)) + (pinned ? ' \u00b7 pinned ' : ' \u00b7 click the day to keep it here'), 'rt-sub');
  if (pinned) {                                         // a pinned day does not follow the pointer; this lets it go
    const rb = elx('button', 'release', 'link');
    rb.type = 'button'; rb.id = 'unpin';
    rb.addEventListener('click', () => { PINNED = null; redraw(); });
    sub.appendChild(rb);
  }
  box.appendChild(sub);
  if (!segs.length) { box.appendChild(elx('p', 'Nothing was recorded on this day.', 'rt-sub')); return; }

  const wrap = elx('div', null, 'trackWrap'), track = elx('div', null, 'track'), tip = elx('div', null, 'rt-tip');
  tip.hidden = true;
  const show = (node, lines) => {
    tip.textContent = '';
    lines.forEach((t, i) => tip.appendChild(elx(i === 0 ? 'b' : 'span', t)));
    const mid = parseFloat(node.style.left) + parseFloat(node.style.width) / 2;      // centre of the block, in percent
    tip.className = 'rt-tip' + (mid < 16 ? ' atLeft' : mid > 84 ? ' atRight' : '');
    tip.style.left = mid + '%';
    tip.hidden = false;
  };
  const hover = (node, lines) => {
    node.addEventListener('pointerenter', () => show(node, lines));
    node.addEventListener('pointerleave', () => { tip.hidden = true; });
  };
  for (const lg of dd.legs) {                           // travel: a thin bar in the colour of how I moved
    const a = Math.max(0, lg.h0), b = Math.min(24, lg.h1);
    if (b <= a) continue;
    const n = elx('div', null, 'leg'), bar = document.createElement('i');
    n.style.left = a / 24 * 100 + '%'; n.style.width = (b - a) / 24 * 100 + '%';
    bar.style.background = rgbOf(MODE_COL[lg.mode]);
    n.appendChild(bar);
    hover(n, [MODE_NAME[lg.mode], hm(lg.h0) + '–' + hm(lg.h1) + ' · ' + fmtH(lg.h1 - lg.h0)]);
    track.appendChild(n);
  }
  for (const s of segs) {                               // stays: one block per place
    const home = s.km < HOME_KM, n = elx('div', (s.h1 - s.h0) >= 1.2 ? labelOf(s.pk) : '', 'stay' + (home ? ' home' : ' go'));
    n.style.left = s.h0 / 24 * 100 + '%'; n.style.width = (s.h1 - s.h0) / 24 * 100 + '%';
    hover(n, [labelOf(s.pk), hm(s.h0) + '–' + hm(s.h1) + ' · ' + fmtH(s.h1 - s.h0), home ? 'at home' : fmtKm(s.km) + ' from home · click to show this place']);
    if (!home) n.addEventListener('click', () => pickPlace(s.pk));
    track.appendChild(n);
  }
  wrap.appendChild(track); wrap.appendChild(tip); box.appendChild(wrap);
  const axis = elx('div', null, 'axis');
  ['midnight', '06:00', 'noon', '18:00', 'midnight'].forEach(t => axis.appendChild(elx('span', t)));
  box.appendChild(axis);
}

// ---- place table: the same places as the stars, in one list per home ----
// Type a name, hover a row to light the place up on its dial, open the map link to see where it is.
function syncPlaceBook() {
  const key = [DATA_V, DOW_ON.join(''), MON_ON.join(''), YR_ON.join('')].join('|');
  if (key !== PB_KEY) { PB_KEY = key; buildPlaceBook(); }
  // names are refreshed in place: rebuilding the table would take the focus away while typing
  document.querySelectorAll('#placeBook input').forEach(inp => {
    const v = labelOf(inp.dataset.pk);
    if (inp !== document.activeElement && inp.value !== v) inp.value = v;
  });
  document.querySelectorAll('#placeBook tr[data-pk]').forEach(tr => tr.classList.toggle('lit', tr.dataset.pk === FOCUS));
}

function buildPlaceBook() {
  const box = document.getElementById('placeBook');
  box.textContent = '';
  document.getElementById('placeTitle').textContent = 'Places (' + STARS.length + ')';
  box.appendChild(elx('p', 'Name the places you recognise. Hover a row to find it on its dial.' + (RAW.file ? ' The map link opens that spot in Google Maps.' : ''), 'rt-sub'));
  const grid = elx('div', null, 'books');
  for (const er of ERAS) {
    const col = document.createElement('div'), tb = document.createElement('table'), head = document.createElement('tr');
    if (ERAS.length > 1) col.appendChild(elx('h3', er.title));
    tb.className = 'book';
    ['Name', 'Visits', 'Time', 'From home', 'Map'].forEach(t => head.appendChild(elx('th', t)));
    tb.appendChild(head);
    STARS.filter(st => st.era === er.i).forEach((st, n) => {
      const p = PLACES.get(st.pk), cl = CLUSTERS.get(st.pk);
      if (!p || !cl) return;
      const tr = document.createElement('tr'), td = document.createElement('td'), inp = document.createElement('input'), tdm = document.createElement('td');
      tr.dataset.pk = st.pk;
      inp.type = 'text'; inp.id = 'pb-' + er.i + '-' + n; inp.dataset.pk = st.pk; inp.value = cl.label; inp.maxLength = 40; inp.autocomplete = 'off';
      inp.setAttribute('aria-label', 'Name of ' + cl.auto);
      inp.addEventListener('change', () => renamePlace(st.pk, inp.value));
      inp.addEventListener('keydown', e => {            // Enter saves the name and jumps to the next place
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const all = Array.from(document.querySelectorAll('#placeBook input')), next = all[all.indexOf(inp) + 1];
        if (next) next.focus(); else inp.blur();
      });
      inp.addEventListener('focus', () => { PREVIEW = st.pk; redraw(); });
      inp.addEventListener('blur', () => { if (PREVIEW === st.pk) { PREVIEW = null; redraw(); } });
      td.appendChild(inp); tr.appendChild(td);
      tr.appendChild(elx('td', String(p.durs.size))); tr.appendChild(elx('td', fmtH(p.hrs))); tr.appendChild(elx('td', fmtKm(p.km)));
      if (RAW.file) {
        const a = elx('a', 'map');
        a.href = mapHref(cl); a.target = '_blank'; a.rel = 'noopener noreferrer'; a.setAttribute('aria-label', 'Open ' + cl.auto + ' in Google Maps');
        tdm.appendChild(a);
      } else tdm.textContent = '–';                 // the sample places are made-up points
      tr.appendChild(tdm);
      tr.addEventListener('pointerenter', () => { PREVIEW = st.pk; redraw(); });
      tr.addEventListener('pointerleave', () => { const f = document.activeElement; if (PREVIEW === st.pk && !(f && f.dataset && f.dataset.pk === st.pk)) { PREVIEW = null; redraw(); } });
      tr.addEventListener('click', e => { if (!e.target.closest('input, a')) pickPlace(st.pk); });      // the numbers open the details
      tb.appendChild(tr);
    });
    if (tb.rows.length > 1) col.appendChild(tb); else col.appendChild(elx('p', 'No places in the days that are switched on.', 'rt-sub'));
    grid.appendChild(col);
  }
  box.appendChild(grid);
}
