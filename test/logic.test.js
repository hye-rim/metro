'use strict';
const test = require('node:test');
const assert = require('node:assert');
const M = require('../logic.js');

const run = (st, sec) => { for (let i = 0; i < sec * 60 && !st.over; i++) M.step(st, 1 / 60); };

// 시험용 봇: 가까운 역끼리 이어 선 하나를 길게 늘린다 (새 역이 생길 때마다 끝에 붙임)
function bot(st, sec, lines = 1) {
  for (let i = 0; i < sec * 60 && !st.over; i++) {
    M.step(st, 1 / 60);
    if (i % 60 === 0) {
      for (let li = 0; li < lines && st.spare > 0; li++) M.addTrain(st, li);
      for (let li = 0; li < lines; li++) {
        const line = st.lines[li];
        const used = new Set(st.lines.flatMap((l) => l.stops));
        if (!line.stops.length) {
          const free = st.stations.filter((s) => !used.has(s.id));
          if (free.length >= 2) M.connect(st, li, free[0].id, free[1].id);
          continue;
        }
        const end = M.sid(st, line.stops[line.stops.length - 1]);
        const cand = st.stations.filter((s) => !used.has(s.id)).sort((a, b) => Math.hypot(a.x - end.x, a.y - end.y) - Math.hypot(b.x - end.x, b.y - end.y))[0];
        if (cand) M.connect(st, li, end.id, cand.id);
      }
    }
  }
}

test('same seed gives the same game', () => {
  const a = M.newGame(M.rng(5)), b = M.newGame(M.rng(5));
  run(a, 40); run(b, 40);
  assert.deepStrictEqual(a.stations.map((s) => [s.shape, s.x, s.y, s.queue.length]), b.stations.map((s) => [s.shape, s.x, s.y, s.queue.length]));
});

test('stations keep their distance and stay on the map', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const st = M.newGame(M.rng(seed), { level: 'normal' }); run(st, 200);
    for (const s of st.stations) assert.ok(s.x >= 0 && s.x <= M.W && s.y >= M.MAP_TOP && s.y <= M.MAP_BOTTOM);
    for (let i = 0; i < st.stations.length; i++) for (let j = i + 1; j < st.stations.length; j++) assert.ok(Math.hypot(st.stations[i].x - st.stations[j].x, st.stations[i].y - st.stations[j].y) >= 89);
  }
});

test('first stations are all different shapes and passengers never want their own shape', () => {
  const st = M.newGame(M.rng(3));
  assert.deepStrictEqual(st.stations.map((s) => s.shape), ['circle', 'square', 'triangle']);
  run(st, 60);
  for (const s of st.stations) for (const q of s.queue) assert.notStrictEqual(q, s.shape);
});

test('connect rules', () => {
  const st = M.newGame(M.rng(1));
  assert.ok(M.connect(st, 0, 0, 1));
  assert.deepStrictEqual(st.lines[0].stops, [0, 1]);
  assert.strictEqual(M.connect(st, 0, 0, 1), false);           // 이미 있음
  assert.strictEqual(M.connect(st, 0, 1, 1), false);
  assert.ok(M.connect(st, 0, 1, 2));
  assert.deepStrictEqual(st.lines[0].stops, [0, 1, 2]);
  assert.strictEqual(M.connect(st, 1, 0, 9), false);           // 없는 역
  assert.strictEqual(M.connect(st, 5, 0, 1), false);           // 없는 선
  assert.strictEqual(st.trains.length, 1);
});

test('can extend at the start of a line', () => {
  const st = M.newGame(M.rng(1));
  M.connect(st, 0, 1, 2);
  assert.ok(M.connect(st, 0, 1, 0));
  assert.deepStrictEqual(st.lines[0].stops, [0, 1, 2]);
});

test('a train delivers passengers to a matching station', () => {
  const st = M.newGame(M.rng(1)); M.connect(st, 0, 0, 1); M.connect(st, 0, 1, 2);
  run(st, 45);
  assert.ok(st.score > 0);
  assert.ok(st.events.some((e) => e.type === 'deliver'));
});

test('train stays on its line and cargo never exceeds capacity', () => {
  const st = M.newGame(M.rng(2)); bot(st, 120, 1);
  for (const tr of st.trains) {
    assert.ok(tr.cargo.length <= M.CAP);
    const n = st.lines[tr.line].stops.length;
    assert.ok(tr.i >= 0 && tr.i <= n - 1 + 1e-6);
  }
});

test('an unconnected map ends the game by overcrowding', () => {
  const st = M.newGame(M.rng(4), { level: 'normal' }); run(st, 400);
  assert.ok(st.over);
  assert.ok(st.events.some((e) => e.type === 'over'));
});

test('tutorial mode never ends', () => {
  const st = M.newGame(M.rng(4), { tutorial: true }); run(st, 400);
  assert.strictEqual(st.over, false);
});

test('removing a line removes its train', () => {
  const st = M.newGame(M.rng(1)); M.connect(st, 0, 0, 1);
  assert.ok(M.removeLine(st, 0));
  assert.strictEqual(st.trains.length, 0);
  assert.strictEqual(M.removeLine(st, 0), false);
});

test('a connecting bot lasts far longer than doing nothing', () => {
  let idle = 0, played = 0;
  for (let s = 1; s <= 12; s++) {
    const a = M.newGame(M.rng(s)); run(a, 600); idle += a.t;
    const b = M.newGame(M.rng(s)); bot(b, 600, 3); played += b.t;
  }
  assert.ok(played > idle * 1.5, played + ' vs ' + idle);
});

test('spare trains arrive over time and can be added to a line', () => {
  const st = M.newGame(M.rng(1), { tutorial: true }); M.connect(st, 0, 0, 1);
  assert.strictEqual(M.addTrain(st, 0), false);
  run(st, 46);
  assert.strictEqual(st.spare, 1);
  assert.ok(M.addTrain(st, 0));
  assert.strictEqual(st.trains.length, 2);
  assert.strictEqual(st.spare, 0);
  assert.strictEqual(M.addTrain(st, 1), false);
});
