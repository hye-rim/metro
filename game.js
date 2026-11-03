'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 지하철 노선 연결: 화면·입력·소리. 규칙은 logic.js (LOGIC_METRO).
const M = LOGIC_METRO;
const $ = (id) => document.getElementById(id);
const W = 360, H = 640;
const canvas = $('game'), ctx = canvas.getContext('2d');
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
const TUTORIAL = new URLSearchParams(location.search).get('tutorial') === '1';
const TUT = TUTORIAL;
const COLORS = ['#e5484d', '#3b82f6', '#22a55b'];

let audio = null, muted = store.get('metroMuted') === '1';
function ac() { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); return audio; } catch (_) { return null; } }
function tone(freq, dur, type = 'triangle', vol = 0.05, slide = 0) {
  if (muted) return;
  const a = ac(); if (!a) return;
  try {
    const o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  } catch (_) {}
}
const sfx = {
  connect() { tone(520, 0.1, 'triangle', 0.06, 240); },
  deliver() { tone(880, 0.08, 'sine', 0.05); },
  station() { tone(330, 0.12, 'sine', 0.04); },
  train() { tone(260, 0.2, 'square', 0.04, 160); },
  warn() { tone(200, 0.12, 'sawtooth', 0.04); },
  over() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.22, 'triangle', 0.06), i * 150)); },
  bad() { tone(160, 0.1, 'square', 0.04); },
};
function toggleMute() { muted = !muted; store.set('metroMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').textContent = muted ? '🔇' : '🔊';

let G = null, level = 'easy', active = 0, drag = null, floats = [], lastTs = 0, seedCount = 0, warnT = 0;

/* @test-hooks:start */
window.__mt = { get G() { return G; }, M, step: (dt) => update(dt), draw: () => draw(), get drag() { return drag; } };
/* @test-hooks:end */

function showOverlay(html) {
  const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); $('bar').classList.add('hidden');
  o.querySelectorAll('button[data-level]').forEach((b) => { b.onclick = () => start(b.dataset.level); });
  o.querySelectorAll('button[data-again]').forEach((b) => { b.onclick = () => start(level); });
  o.querySelectorAll('button[data-resume]').forEach((b) => { b.onclick = resumeGame; });
}
function hideOverlay() { $('overlay').classList.add('hidden'); $('bar').classList.remove('hidden'); }
function showTitle() {
  const best = +store.get('metroBest') || 0;
  showOverlay(`<h1>지하철<br>노선 연결</h1><div class="big">● ■ ▲ ★</div>
    <p>역을 <b>선으로 이어</b> 열차를 다니게 하세요<br>승객이 원하는 <b>모양의 역</b>에 내려 주면 점수!</p>
    <p class="help">역에 승객이 너무 오래 쌓이면 끝이에요.<br>역은 계속 늘어나요</p>
    ${best ? `<p class="note">최고 ${best}명</p>` : ''}
    <div class="lv"><button data-level="easy">쉬움<small>천천히 늘어남</small></button><button data-level="normal">보통<small>빨리 늘어남</small></button></div>`);
}
function start(lv) {
  paused = false; level = lv; seedCount++; active = 0; drag = null; floats = [];
  G = M.newGame(M.rng((Date.now() + seedCount * 104729) >>> 0), { level: lv, tutorial: TUTORIAL });
  hideOverlay(); syncBar();
}
function finish() {
  const s = G.score, old = +store.get('metroBest') || 0, isBest = s > old;
  if (isBest) store.set('metroBest', String(s));
  sfx.over();
  setTimeout(() => showOverlay(`<h2>혼잡해서 끝!</h2><p class="big">🚇 ${s}명</p><p class="help">${Math.round(G.t)}초 동안 운행 · 역 ${G.stations.length}개<br>${isBest ? '🏆 최고 기록!' : `최고 ${old}명`}</p>
    <button data-again="1">다시 하기</button><button data-level="${level === 'easy' ? 'normal' : 'easy'}" style="background:#888;box-shadow:none;font-size:14px">${level === 'easy' ? '보통으로' : '쉬움으로'}</button>`), 800);
}

// ---------- 입력 ----------
function pos(e) { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H]; }
function stationAt(x, y, r = 30) { let best = null, bd = r; for (const s of G.stations) { const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = s; } } return best; }
function lineFor(from) {
  const ends = (li) => { const st = G.lines[li].stops; return st.length && (st[0] === from.id || st[st.length - 1] === from.id); };
  if (ends(active)) return active;
  if (!G.lines[active].stops.length) return active;
  for (let i = 0; i < M.MAX_LINES; i++) if (ends(i)) return i;
  return -1;
}
canvas.addEventListener('pointerdown', (e) => {
  if (!G || G.over) return;
  const [x, y] = pos(e), s = stationAt(x, y);
  if (!s) return;
  const li = lineFor(s);
  if (li < 0) { sfx.bad(); return; }
  setActive(li); drag = { from: s, line: li, x, y, pid: e.pointerId };
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  e.preventDefault();
});
canvas.addEventListener('pointermove', (e) => { if (drag && drag.pid === e.pointerId) { const [x, y] = pos(e); drag.x = x; drag.y = y; } });
function up(e) {
  if (!drag || drag.pid !== e.pointerId) return;
  const [x, y] = pos(e), to = stationAt(x, y), d = drag; drag = null;
  if (!to || to === d.from) return;
  if (M.connect(G, d.line, d.from.id, to.id)) { sfx.connect(); tutorialSignal('connect'); syncBar(); } else sfx.bad();
}
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', () => { drag = null; });
function setActive(i) { active = i; for (let k = 0; k < 3; k++) $('btnL' + k).classList.toggle('on', k === i); }
for (let k = 0; k < 3; k++) $('btnL' + k).onclick = () => setActive(k);
$('btnTrain').onclick = () => { if (G && M.addTrain(G, active)) { sfx.train(); tutorialSignal('train'); syncBar(); } else sfx.bad(); };
$('btnDel').onclick = () => { if (G && M.removeLine(G, active)) { sfx.bad(); syncBar(); } };
function syncBar() { if (!G) return; $('spareN').textContent = G.spare; $('btnTrain').disabled = G.spare <= 0; }
addEventListener('keydown', (e) => { if (e.key >= '1' && e.key <= '3') setActive(+e.key - 1); else if (e.key === 'm' || e.key === 'M') toggleMute(); });

// 창이 가려지거나 다른 앱으로 갔다 오면 저절로 멈춘다 (튜토리얼 중에는 멈추지 않음)
let paused = false;
function pauseGame() {
  if (paused || !G || G.over || TUT || !$('overlay').classList.contains('hidden')) return;
  paused = true; drag = null;
  showOverlay('<h2>⏸ 일시정지</h2><p class="help">돌아오면 이어서 해요</p><button data-resume="1">계속하기</button>');
}
function resumeGame() { paused = false; hideOverlay(); lastTs = 0; }
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
addEventListener('blur', pauseGame);
function fit() { const s = Math.min(innerWidth / W, innerHeight / H); canvas.style.width = `${Math.floor(W * s)}px`; canvas.style.height = `${Math.floor(H * s)}px`; $('wrap').style.width = canvas.style.width; $('wrap').style.height = canvas.style.height; }
addEventListener('resize', fit); fit();
$('muteBtn').onclick = toggleMute;

// ---------- 갱신 ----------
function update(dt) {
  if (!G || paused) return;
  M.step(G, dt);
  while (G.events.length) {
    const ev = G.events.shift();
    if (ev.type === 'deliver') { sfx.deliver(); tutorialSignal('deliver'); floats.push({ x: ev.x, y: ev.y - 20, t: 0, text: `+${ev.n}`, c: '#1a7f37' }); }
    else if (ev.type === 'station') sfx.station();
    else if (ev.type === 'spare') { sfx.train(); syncBar(); floats.push({ x: 180, y: 90, t: 0, text: '🚆 열차가 한 대 더 생겼어요!', c: '#6b5b95' }); }
    else if (ev.type === 'over') finish();
  }
  warnT += dt;
  for (const f of floats) { f.t += dt; f.y -= 24 * dt; }
  floats = floats.filter((f) => f.t < 1.6);
}

// ---------- 그리기 ----------
function shape(kind, x, y, r, fill, stroke) {
  ctx.beginPath();
  if (kind === 'circle') ctx.arc(x, y, r, 0, 7);
  else if (kind === 'square') ctx.rect(x - r, y - r, r * 2, r * 2);
  else if (kind === 'triangle') { ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x + r * 1.1, y + r * 0.85); ctx.lineTo(x - r * 1.1, y + r * 0.85); ctx.closePath(); }
  else { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.5 : r * 1.2; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.closePath(); }
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.lineWidth = 3; ctx.strokeStyle = stroke; ctx.stroke(); }
}
function draw() {
  ctx.fillStyle = '#f4efe3'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(0,0,0,.05)'; ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 30) { ctx.beginPath(); ctx.moveTo(x, M.MAP_TOP); ctx.lineTo(x, M.MAP_BOTTOM); ctx.stroke(); }
  for (let y = M.MAP_TOP; y < M.MAP_BOTTOM; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  if (!G) return;
  // 선
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  G.lines.forEach((ln, i) => {
    if (ln.stops.length < 2) return;
    ctx.strokeStyle = COLORS[i]; ctx.lineWidth = 9; ctx.beginPath();
    ln.stops.forEach((id, k) => { const s = M.sid(G, id); k ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); ctx.stroke();
  });
  if (drag) { ctx.strokeStyle = COLORS[drag.line]; ctx.globalAlpha = 0.55; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(drag.from.x, drag.from.y); ctx.lineTo(drag.x, drag.y); ctx.stroke(); ctx.globalAlpha = 1; }
  // 역
  for (const s of G.stations) {
    if (s.over > 0) { const k = Math.min(1, s.over / M.OVER_TIME); ctx.beginPath(); ctx.arc(s.x, s.y, 24 + Math.sin(warnT * 8) * 2, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); ctx.lineWidth = 5; ctx.strokeStyle = '#d23b40'; ctx.stroke(); }
    shape(s.shape, s.x, s.y, 13, '#fff', '#333');
    s.queue.forEach((q, i) => shape(q, s.x + 22 + (i % 4) * 11, s.y - 14 + Math.floor(i / 4) * 12, 4.5, '#444'));
  }
  // 열차
  for (const tr of G.trains) {
    const p = tr.x || tr.y ? tr : M.trainPos(G, tr);
    ctx.fillStyle = COLORS[tr.line]; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(p.x - 12, p.y - 8, 24, 16, 4) : ctx.rect(p.x - 12, p.y - 8, 24, 16); ctx.fill(); ctx.stroke();
    tr.cargo.slice(0, 6).forEach((q, i) => shape(q, p.x - 8 + (i % 3) * 8, p.y - 3 + Math.floor(i / 3) * 7, 2.6, '#fff'));
  }
  // 표시줄
  ctx.fillStyle = 'rgba(244,239,227,.92)'; ctx.fillRect(0, 0, W, 44);
  ctx.fillStyle = '#222'; ctx.font = '900 16px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(`🚇 ${G.score}명`, 10, 22);
  ctx.textAlign = 'center'; ctx.font = '700 12px sans-serif'; ctx.fillStyle = '#666';
  ctx.fillText(TUTORIAL ? '연습 중' : `${Math.floor(G.t / 60)}:${String(Math.floor(G.t % 60)).padStart(2, '0')}`, 190, 22);
  for (const f of floats) { ctx.globalAlpha = Math.max(0, 1 - f.t / 1.6); ctx.fillStyle = f.c; ctx.font = '800 15px sans-serif'; ctx.fillText(f.text, f.x, f.y); ctx.globalAlpha = 1; }
}
function frame(ts) {
  const dt = Math.min(0.05, (ts - (lastTs || ts)) / 1000); lastTs = ts;
  update(dt); draw(); requestAnimationFrame(frame);
}
showTitle();
requestAnimationFrame(frame);
