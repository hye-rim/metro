'use strict';
// 지하철 노선 연결: 규칙만 (DOM 없음). 화면·입력·소리는 game.js.
// 역(●■▲)을 선으로 이어 열차를 다니게 하고, 승객이 원하는 모양의 역에 내려 주면 점수. 역에 승객이 너무 오래 쌓이면 끝.
(function (root) {
  const W = 360, MAP_TOP = 56, MAP_BOTTOM = 540, MARGIN = 34;
  const SHAPES = ['circle', 'square', 'triangle', 'star'];
  const MAX_LINES = 3, CAP = 6, SPEED = 75, DWELL = 0.7, OVER_AT = 8, OVER_TIME = 14, MIN_DIST = 90;
  const LEVELS = {
    easy: { label: '쉬움', first: 3, every: 32, max: 8, spawn: 5.2, ramp: 0.0035 },
    normal: { label: '보통', first: 3, every: 24, max: 10, spawn: 4.0, ramp: 0.005 },
  };
  const rng = (seed) => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function newGame(rand, opts = {}) {
    rand = rand || Math.random;
    const lv = LEVELS[opts.level] ? opts.level : 'normal';
    const p = Object.assign({}, LEVELS[lv]);
    const st = { rand, level: lv, params: p, tutorial: !!opts.tutorial, t: 0, stations: [], lines: [], trains: [], score: 0, events: [], over: false, nextStation: p.every, nextSpare: 45, spare: 0, shapes: 3, nid: 0, delivered: 0 };
    for (let i = 0; i < MAX_LINES; i++) st.lines.push({ id: i, stops: [] });
    for (let i = 0; i < p.first; i++) addStation(st, i);
    return st;
  }
  function addStation(st, k) {
    for (let tries = 0; tries < 200; tries++) {
      const x = MARGIN + st.rand() * (W - 2 * MARGIN), y = MAP_TOP + MARGIN + st.rand() * (MAP_BOTTOM - MAP_TOP - 2 * MARGIN);
      if (st.stations.every((s) => Math.hypot(s.x - x, s.y - y) >= MIN_DIST)) {
        // 처음 세 역은 서로 다른 모양, 이후는 가끔 새 모양(별)
        const shape = k < 3 ? SHAPES[k] : SHAPES[Math.floor(st.rand() * Math.min(st.shapes, SHAPES.length))];
        const s = { id: st.nid++, x: Math.round(x), y: Math.round(y), shape, queue: [], over: 0, timer: st.rand() * 2 };
        st.stations.push(s); st.events.push({ type: 'station', id: s.id }); return s;
      }
    }
    return null;
  }

  const lineStations = (st, line) => line.stops.map((id) => st.stations[id]);
  const sid = (st, id) => st.stations.find((s) => s.id === id);

  // 선 잇기: line 의 끝(또는 처음)에 역을 붙인다. 비어 있으면 두 역을 한꺼번에.
  function connect(st, li, from, to) {
    const line = st.lines[li]; if (!line || st.over || from === to) return false;
    if (!sid(st, from) || !sid(st, to)) return false;
    if (line.stops.includes(to)) return false;
    if (line.stops.length === 0) { line.stops = [from, to]; }
    else if (line.stops[line.stops.length - 1] === from) line.stops.push(to);
    else if (line.stops[0] === from) line.stops.unshift(to);
    else return false;
    ensureTrain(st, line);
    st.events.push({ type: 'connect', line: li, n: line.stops.length });
    return true;
  }
  function ensureTrain(st, line) {
    if (st.trains.some((t) => t.line === line.id)) { for (const t of st.trains) if (t.line === line.id) t.i = Math.min(t.i, line.stops.length - 1.001); return; }
    st.trains.push({ line: line.id, i: 0, dir: 1, dwell: 0, cargo: [], x: 0, y: 0 });
  }
  // 쉬는 열차를 한 대 더 투입 (45초마다 한 대씩 생김)
  function addTrain(st, li) {
    const line = st.lines[li];
    if (st.over || !line || line.stops.length < 2 || st.spare <= 0) return false;
    const last = st.trains.filter((t) => t.line === li).length;
    if (last >= 4) return false;
    st.spare--;
    const n = line.stops.length;
    st.trains.push({ line: li, i: (last % 2 ? n - 1 : 0), dir: last % 2 ? -1 : 1, dwell: 0, cargo: [], x: 0, y: 0 });
    st.events.push({ type: 'train', line: li }); return true;
  }
  function removeLine(st, li) {
    const line = st.lines[li]; if (!line || !line.stops.length) return false;
    line.stops = [];
    st.trains = st.trains.filter((t) => t.line !== li);
    st.events.push({ type: 'clear', line: li }); return true;
  }

  function trainPos(st, tr) {
    const line = st.lines[tr.line], n = line.stops.length;
    const i = Math.max(0, Math.min(n - 1, tr.i)), a = Math.floor(i), b = Math.min(n - 1, a + 1), f = i - a;
    const A = sid(st, line.stops[a]), B = sid(st, line.stops[b]);
    return { x: A.x + (B.x - A.x) * f, y: A.y + (B.y - A.y) * f };
  }

  function arrive(st, tr, station) {
    const line = st.lines[tr.line];
    const served = new Set(lineStations(st, line).map((s) => s.shape));
    const keep = [], out = [];
    for (const sh of tr.cargo) (sh === station.shape ? out : keep).push(sh);
    tr.cargo = keep;
    if (out.length) { st.score += out.length; st.delivered += out.length; st.events.push({ type: 'deliver', n: out.length, x: station.x, y: station.y, score: st.score }); }
    // 태우기: 이 선이 가는 역 중 원하는 모양이 있는 승객 (이 역과 같은 모양이면 안 만들어짐)
    const rest = [];
    for (const sh of station.queue) { if (tr.cargo.length < CAP && served.has(sh) && sh !== station.shape) tr.cargo.push(sh); else rest.push(sh); }
    if (rest.length !== station.queue.length) st.events.push({ type: 'board', n: station.queue.length - rest.length });
    station.queue = rest;
    tr.dwell = DWELL;
  }

  function step(st, dt) {
    if (st.over) return;
    st.t += dt;
    // 새 역
    if (st.t >= st.nextStation && st.stations.length < st.params.max) {
      st.nextStation += st.params.every;
      if (st.stations.length === 5 || st.stations.length === 6) st.shapes = 4;
      addStation(st, st.stations.length);
    }
    if (st.t >= st.nextSpare) { st.nextSpare += 45; st.spare++; st.events.push({ type: 'spare', spare: st.spare }); }
    // 승객
    const rate = st.params.spawn / (1 + st.t * st.params.ramp);
    for (const s of st.stations) {
      s.timer -= dt;
      if (s.timer <= 0) {
        s.timer += rate * (0.7 + st.rand() * 0.6);
        const shapes = [...new Set(st.stations.map((q) => q.shape))].filter((x) => x !== s.shape);
        if (shapes.length) s.queue.push(shapes[Math.floor(st.rand() * shapes.length)]);
      }
      if (!st.tutorial) {
        if (s.queue.length >= OVER_AT) s.over += dt; else s.over = Math.max(0, s.over - dt * 2);
        if (s.over >= OVER_TIME) { st.over = true; st.events.push({ type: 'over', score: st.score, t: st.t, station: s.id }); return; }
      }
    }
    // 열차
    for (const tr of st.trains) {
      const line = st.lines[tr.line], n = line.stops.length;
      if (n < 2) continue;
      if (tr.dwell > 0) { tr.dwell -= dt; if (tr.dwell > 0) continue; }
      const cur = Math.round(tr.i);
      let adv = SPEED * dt;
      while (adv > 0) {
        const target = tr.dir > 0 ? Math.floor(tr.i + 1e-9) + 1 : Math.ceil(tr.i - 1e-9) - 1;
        const A = sid(st, line.stops[Math.floor(tr.i + 1e-9) < n - 1 ? Math.floor(tr.i + 1e-9) : n - 2]), B = sid(st, line.stops[Math.min(n - 1, Math.max(0, target))]);
        const segLen = Math.max(1, dist(A, B)), left = Math.abs(target - tr.i) * segLen;
        if (adv < left) { tr.i += tr.dir * adv / segLen; adv = 0; }
        else {
          adv -= left; tr.i = target;
          const stn = sid(st, line.stops[target]); arrive(st, tr, stn);
          if (target === 0) tr.dir = 1; else if (target === n - 1) tr.dir = -1;
          adv = 0; break;
        }
      }
      const p = trainPos(st, tr); tr.x = p.x; tr.y = p.y;
    }
  }

  const api = { W, MAP_TOP, MAP_BOTTOM, SHAPES, MAX_LINES, CAP, SPEED, OVER_AT, OVER_TIME, LEVELS, rng, newGame, connect, addTrain, removeLine, step, sid, trainPos };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LOGIC_METRO = api;
})(typeof window !== 'undefined' ? window : globalThis);
