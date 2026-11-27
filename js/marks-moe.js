// Отметки на стволе — WR.moe: формулы (раздел 6 спецификации), итог боя (5.6), пороги и id танка (7.1–7.3).
// Чистые функции: без DOM и сети (запросы — в marks.html, здесь адреса и разбор ответов).
// kn — узлы кривой «средний -> %»: [[0,0],[20,D20],…,[100,D100]]; k — D20..D100 массивом (для кэша).
// Кривая:    knots kk f finv slope floor2 fitEst pickCurve
// Бой:       combined anchor delta project band bandText rough goal cross live prog progBattle
// Сколько:   total left plus1 avgN battlesTo zeroCost plan
// Отметки:   lb marksOf
// Итог боя:  bigId counts parseResult preAvg refineP1 residual pickBase
// Источники: url.{mastery,pol,ency,polVeh,ach,render} parseMastery parsePol parseMoeInfo parseEncy parsePolVeh parseAch
// Прочее:    tagKey nation isLesta realm serverDay sameDay srcLine; текст: fmtInt fmtP fmtPct fmtDelta plural marksWord battlesWord ord ordG
(function () {
  'use strict';
  window.WR = window.WR || {};

  const K = 2 / 101;                          // EMA «последние 100 боёв» (реверс сообщества)
  const T = [65, 85, 95];                     // пороги отметок
  const PCTS = [20, 40, 55, 65, 75, 85, 95, 100];
  const MUST = [65, 85, 95, 100];             // без этих узлов источник не годится
  const BONUS = [1, 37, 46];                  // bonusType случайных боёв
  const MODES = ['REGULAR', 'MAPBOX', 'RANDOM_NP2'];
  const LESTA = ['RU', 'RPT', 'CT', 'PT_RU'];
  const NBSP = '\u00a0', MINUS = '\u2212';
  const APP = '1e984dbbdf7b1c1fbd284d4cadc0b17f'; // application_id панели, как в obs.html

  const num = x => (typeof x === 'number' && isFinite(x) ? x : null);
  const toNum = x => (typeof x === 'string' && x.trim() !== '' ? Number(x) : x);
  const obj = x => (x && typeof x === 'object' ? x : null);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const floorD = (x, d) => { const m = Math.pow(10, d); return Math.floor(x * m + 1e-9) / m; };
  const floor2 = x => floorD(x, 2);           // так досье хранит %: отсечение
  const r2 = x => Math.round(x * 100) / 100;  // шум вычитания чисел с 2 знаками

  // ---------- кривая ----------
  // [D20..D100], [0,D20..D100] (Lesta) или {'20':D,…} -> kn | null. 65/85/95/100 обязательны (> 0), остальные — если есть;
  // узлы строго растут, иначе источник отброшен
  function knots(src) {
    if (!obj(src)) return null;
    const a = Array.isArray(src) ? (src.length === 9 ? src.slice(1) : src.length === 8 ? src : null) : PCTS.map(p => src[p]);
    if (!a) return null;
    const kn = [[0, 0]];
    let prev = -1;
    for (let i = 0; i < 8; i++) {
      const v = toNum(a[i]), p = PCTS[i], must = MUST.indexOf(p) >= 0;
      if (num(v) == null || v < 0 || (must && v <= 0)) { if (must) return null; continue; }
      if (v <= prev) return null;
      prev = v;
      kn.push([p, v]);
    }
    return kn;
  }
  const kk = kn => PCTS.map(p => { const e = kn && kn.find(x => x[0] === p); return e ? e[1] : null; });

  // % по среднему: прямая между узлами; 0 при A ≤ 0, 100 выше D100
  function f(kn, A) {
    if (!kn || !(A > 0)) return 0;
    for (let i = 1; i < kn.length; i++) {
      if (A <= kn[i][1]) { const a = kn[i - 1], b = kn[i]; return a[0] + (b[0] - a[0]) * (A - a[1]) / (b[1] - a[1]); }
    }
    return 100;
  }
  // обратная: средний для P%; D100 при P ≥ 100
  function finv(kn, P) {
    if (!kn || !(P > 0)) return 0;
    for (let i = 1; i < kn.length; i++) {
      if (P <= kn[i][0]) { const a = kn[i - 1], b = kn[i]; return a[1] + (b[1] - a[1]) * (P - a[0]) / (b[0] - a[0]); }
    }
    return kn[kn.length - 1][1];
  }
  // п.п. на единицу среднего на текущем отрезке
  function slope(kn, A) {
    if (!kn) return 0;
    for (let i = 1; i < kn.length; i++) {
      const a = kn[i - 1], b = kn[i];
      if (b[1] > a[1] && A <= b[1]) return (b[0] - a[0]) / (b[1] - a[1]);
    }
    return 0;
  }

  // оценка по своим точным (A, P): медианная форма D/D65 (802 танка EU), D65 = ΣA·x / Σx²
  const SH_P = [0, 20, 40, 55, 65, 75, 85, 95, 100], SH_X = [0, .261, .596, .831, 1, 1.194, 1.435, 1.782, 2.064];
  function shapeX(P) {
    for (let i = 1; i < 9; i++) if (P <= SH_P[i]) return SH_X[i - 1] + (SH_X[i] - SH_X[i - 1]) * (P - SH_P[i - 1]) / (SH_P[i] - SH_P[i - 1]);
    return SH_X[8];
  }
  function fitEst(pairs) {
    let sx = 0, sxx = 0, n = 0;
    for (const p of pairs || []) {
      const A = num(Array.isArray(p) ? p[0] : p && p.A), P = num(Array.isArray(p) ? p[1] : p && p.P);
      if (!(A > 0 && P > 0)) continue;
      const x = shapeX(Math.min(P, 100));
      sx += A * x; sxx += x * x; n++;
    }
    if (!n || !(sxx > 0)) return null;
    const D65 = sx / sxx, kn = [[0, 0]].concat(PCTS.map((p, i) => [p, D65 * SH_X[i + 1]]));
    return { kn, k: kk(kn), n, D65 };
  }

  // цепочка (7.1): игра (Lesta) -> WG -> poliroid -> оценка -> нет.
  // o: { tag, moeAvail, moeCur, wg:{k,upd,at}, pol:{k,upd,at}, pairs } -> { kn, src, upd, fit1 }
  function pickCurve(o) {
    o = o || {};
    if (o.moeAvail === true) { const g = parseMoeInfo(o.moeCur, o.tag); if (g) return { kn: g.kn, src: 'game', upd: 0, fit1: false }; }
    for (const s of ['wg', 'pol']) {
      const c = obj(o[s]), kn = c && knots(c.k || c);
      if (kn) return { kn, src: s, upd: c.upd || c.at || 0, fit1: false };
    }
    const e = fitEst(o.pairs);
    return e ? { kn: e.kn, src: 'est', upd: 0, fit1: e.n === 1 } : { kn: null, src: 'none', upd: 0, fit1: false };
  }

  // ---------- бой ----------
  // урон + max(засвет, гусеницы, оглушение) — максимум, не сумма. Помощь без событий (окно подключилось позже)
  // отдаём доминирующему виду; Cunc — неуверенность
  function combined(eff, R, Tr) {
    eff = obj(eff) || {};
    const dmg = num(eff.damage) || 0, S = num(eff.stun) || 0, as = num(eff.assist);
    R = num(R) || 0; Tr = num(Tr) || 0;
    const unk = as == null ? 0 : Math.max(0, as - (R + Tr));
    if (R >= Tr) R += unk; else Tr += unk;
    const ast = Math.max(R, Tr, S);
    return { C: dmg + ast, Cunc: unk / 2, dmg, ast, R, T: Tr, S, unk };
  }

  // сдвиг к % досье (6.3): шум floor2 — 0; |δ| > 1,5 — кривая подозрительна, переходим на оценку (est)
  function anchor(raw, sameDay) {
    if (num(raw) == null) return { d: 0, anchored: false, est: false, raw: 0 };
    if (raw > -0.011 && raw <= 0.001) return { d: 0, anchored: true, est: false, raw };
    if (Math.abs(raw) > 1.5) return { d: 0, anchored: false, est: true, raw };
    const anchored = !!sameDay || Math.abs(raw) < 0.15;
    return { d: anchored ? raw : 0, anchored, est: false, raw };
  }
  const delta = (kn, A0, P0, sameDay) => anchor(P0 - f(kn, A0), sameDay);

  // «после боя будет»: A1r без округления (сервер хранит целое — разница ≤ 0,01 п.п.)
  function project(kn, A0, P0, C, d) {
    const A1r = A0 + K * (C - A0), P1 = f(kn, A1r) + (d || 0), show = floor2(P1);
    return { A1r, A1: Math.round(A1r), P1, show, dP: r2(show - P0) };
  }

  // сколько нужно (6.5), без запаса на округление: верно и при round, и при trunc среднего
  const total = (A0, D) => Math.max(0, Math.ceil(A0 + (D - A0) / K - 1e-6));         // за один бой
  const left = (A0, D, C) => Math.max(0, Math.ceil(A0 + (D - A0) / K - C - 1e-6));    // ещё в этом бою
  const plus1 = (kn, P0, d) => finv(kn, Math.min(100, P0 + 1) - (d || 0));
  const avgN = (A0, D, N) => { const q = Math.pow(1 - K, N); return (D - A0 * q) / (1 - q); };
  const battlesTo = (A0, D, X) => A0 >= D ? 0 : X <= D ? Infinity : Math.ceil(Math.log((X - D) / (X - A0)) / Math.log(1 - K) - 1e-9);
  const zeroCost = (kn, A0) => f(kn, A0 * (1 - K)) - f(kn, A0);

  // точность, п.п. (6.11), до 0,001. o: { src, dP, anchored, ageDays, fit1, Cunc, slope | kn+A1r }
  function band(o) {
    o = o || {};
    const dP = Math.abs(o.dP || 0);
    let b = o.src === 'game' ? 0.02
      : o.src === 'est' ? 0.05 + 0.15 * dP + (o.fit1 ? 0.10 : 0)
      : 0.05 + 0.03 * dP + (o.anchored === false ? 0.25 : 0) + ((o.ageDays || 0) > 3 ? 0.10 : 0);
    b += (o.slope != null ? o.slope : o.kn ? slope(o.kn, o.A1r) : 0) * K * (o.Cunc || 0); // помощь без разбивки
    return Math.round(b * 1000) / 1000;
  }
  const rough = (b, src) => src === 'est' || b >= 0.30;   // тогда % с одним знаком и «≈»
  function bandText(b, src) {
    if (rough(b, src)) return '±' + dec(Math.max(0.1, Math.ceil(b * 10 - 1e-9) / 10), 1);
    return b < 0.03 ? 'точно' : '±' + dec(Math.ceil(b * 100 - 1e-9) / 100, 2);
  }

  // цель боя (6.6): отметка, если реальна за бой (≤ 2× среднего), иначе +1%, иначе только «в ноль».
  // o: { kn, A0, P0, d, marks } -> { type:'mark'|'plus1'|'none', T, D, total, n, label, to, even, maxC }
  function goal(o) {
    const kn = o.kn, A0 = o.A0, P0 = o.P0, d = o.d || 0, n = clamp(o.marks || 0, 0, 3), ref = Math.max(A0, 1500);
    let g = null;
    if (kn && n < 3) {
      const Tn = T[n], D = finv(kn, Tn - d), tot = total(A0, D);
      if (tot <= 2 * ref) g = { type: 'mark', T: Tn, D, total: tot, n: n + 1, label: Tn + '% · ' + (n + 1) + '-Я', to: (n + 1) + '-й отметки' };
    }
    if (kn && !g) {
      const D = plus1(kn, P0, d), tot = total(A0, D);
      if (tot <= 2 * ref) g = { type: 'plus1', T: Math.min(100, P0 + 1), D, total: tot, n: 0, label: '+1%', to: '+1%' };
    }
    g = g || { type: 'none', T: null, D: null, total: 0, n: 0, label: '', to: '' };
    g.even = A0;
    g.maxC = Math.ceil(g.type === 'none' ? Math.max(A0 * 1.6, 1000) : Math.max(g.total * 1.1, A0 * 1.45, 1000)); // шкала полосы
    return g;
  }

  // порог (6.7): edge — ≥ T в пределах точности; secure — с запасом, в бою назад не откатывается
  function cross(g, P1, b, C, prev) {
    if (prev === 'secure') return 'secure';
    if (g && g.type === 'mark') return P1 >= g.T + b ? 'secure' : P1 >= g.T ? 'edge' : 'none';
    if (g && g.type === 'plus1') return C >= g.total ? 'secure' : 'none';
    return 'none';
  }

  // заряд следующего кольца 0..1 (6.10)
  function prog(marks, P) {
    const m = clamp(marks || 0, 0, 3), lo = m ? T[m - 1] : 0, hi = m < 3 ? T[m] : 100;
    return clamp(((num(P) || 0) - lo) / (hi - lo), 0, 1);
  }
  const progBattle = (g, C, marks, P1) => (g && g.type === 'mark' && g.total > 0 ? clamp(C / g.total, 0, 1) : prog(marks, P1));

  // карточка боя одним вызовом. o: { kn, src, A0, P0, d, anchored, ageDays, fit1, marks, C, Cunc, goal (на начало боя), prev }
  function live(o) {
    const g = o.goal || goal(o), C = o.C || 0, d = o.d || 0, A1r = o.A0 + K * (C - o.A0);
    const out = { goal: g, A1r, A1: Math.round(A1r), leftEven: left(o.A0, o.A0, C), left: g.type !== 'none' ? left(o.A0, g.D, C) : 0 };
    if (!o.kn) return Object.assign(out, { P1: null, show: null, dP: null, band: 0, bandText: '', rough: false, cross: 'none', leftSafe: 0, over: 0, prog: 0 });
    const pr = project(o.kn, o.A0, o.P0, C, d);
    const b = band({ src: o.src, dP: pr.P1 - o.P0, anchored: o.anchored, ageDays: o.ageDays, fit1: o.fit1, kn: o.kn, A1r, Cunc: o.Cunc });
    return Object.assign(out, pr, {
      band: b, bandText: bandText(b, o.src), rough: rough(b, o.src), cross: cross(g, pr.P1, b, C, o.prev),
      leftSafe: g.type === 'mark' ? left(o.A0, finv(o.kn, g.T + b - d), C) : 0, // «для запаса ещё N»
      over: g.type === 'mark' ? r2(pr.show - g.T) : 0,                            // «запас сверху»
      prog: progBattle(g, C, o.marks || 0, pr.P1),
    });
  }

  // плитки ангара (6.8). o: { kn, A0, P0, d, marks, b } -> [{ label, v, hot, N }]
  function plan(o) {
    const kn = o.kn, A0 = o.A0, d = o.d || 0, n = clamp(o.marks || 0, 0, 3), ref = Math.max(A0, 1500);
    const avg = { label: 'СРЕДНИЙ', v: Math.round(A0) }, bt = { label: 'БОЁВ НА ТАНКЕ', v: o.b || 0 };
    if (!kn) return [avg, bt];
    if (n >= 3) return [avg, { label: 'ПОРОГ 95%', v: Math.round(finv(kn, 95 - d)) }, bt];
    const Tn = T[n], D = finv(kn, Tn - d), one = total(A0, D);
    const oneT = { label: Tn + '% ЗА 1 БОЙ', v: one, N: 1 };
    const byN = N => ({ label: N + ' ' + plural(N, 'БОЙ', 'БОЯ', 'БОЁВ') + ' ПО', v: Math.round(avgN(A0, D, N)), N });
    if (one <= 1.6 * ref) return [avg, Object.assign(oneT, { hot: true }), byN(10)];
    const Ns = [5, 10, 20, 30, 50, 75, 100];
    let i = Ns.findIndex(N => avgN(A0, D, N) <= 1.4 * ref);
    if (i < 0) i = Ns.length - 1;
    return [avg, Object.assign(byN(Ns[i]), { hot: true }), i === 0 ? oneT : byN(Ns[i - 1])];
  }

  // ---------- отметки (6.9) ----------
  const lb = P => (P >= 95 ? 3 : P >= 85 ? 2 : P >= 65 ? 1 : 0);
  // максимум из итогов боёв, WG API и нижней границы по %; sure — знаем не только по %
  function marksOf(rec, P0) {
    const m = obj(rec && rec.marks) || {}, api = obj(rec && rec.marksApi) || {};
    return { n: Math.min(3, Math.max(num(m.n) || 0, num(api.v) || 0, lb(num(P0) || 0))), sure: m.src === 'res' || num(api.v) != null };
  }

  // ---------- итог боя ----------
  // id боя цифрами из сырого текста (19 знаков не влезают в число JS): state/init или итог боя
  function bigId(raw, fb) {
    const s = typeof raw === 'string' ? raw : '';
    let m = s.match(/"arenaUniqueID"\s*:\s*"?(\d{6,})/);
    if (!m) { const o = s.match(/\{[^{}]*"battle\.arenaId"[^{}]*\}/); if (o) m = o[0].match(/"value"\s*:\s*"?(\d{6,})/); }
    return m ? m[1] : fb == null ? '' : String(fb);
  }
  const counts = (mode, level) => MODES.indexOf(mode) >= 0 && (num(level) || 0) >= 5;

  // итог боя (сырой или { data }) -> что нужно отметкам (5.6) | null
  function parseResult(raw, rawText, pid) {
    const r = obj(raw) && (raw.personal ? raw : obj(raw.data) && raw.data.personal ? raw.data : null);
    if (!r || !obj(r.personal)) return null;
    const P = r.personal, av = obj(P.avatar) || {};
    const key = Object.keys(P).find(k => k !== 'avatar' && obj(P[k]));
    if (key == null) return null;
    const p = P[key], c = obj(r.common) || {}, n = x => num(x) || 0;
    const me = String(pid || av.accountDBID || p.accountDBID || '');
    let vOwn = null;                            // свой танк в vehicles: постоянные отметки на стволе
    const vs = obj(r.vehicles) || {};
    for (const id in vs) {
      const e = Array.isArray(vs[id]) ? vs[id][0] : vs[id];
      if (obj(e) && me && String(e.accountDBID) === me) { vOwn = e; break; }
    }
    const dmg = n(p.damageDealt), R = n(p.damageAssistedRadio), Tr = n(p.damageAssistedTrack), S = n(p.damageAssistedStun);
    const bonus = num(c.bonusType), Pint = num(p.damageRating), mkP = n(p.marksOnGun), mkV = vOwn ? n(vOwn.marksOnGun) : null;
    const t0 = num(c.arenaCreateTime);
    return {
      arena: bigId(rawText, r.arenaUniqueID), bonus, counted: BONUS.indexOf(bonus) >= 0 && Pint > 0,
      cd: num(p.typeCompDescr) != null ? p.typeCompDescr : +key, acc: me,
      dmg, R, T: Tr, S, Cf: dmg + Math.max(R, Tr, S),
      A1: num(p.movingAvgDamage), Pint,          // новый средний и новый % целым (отсечение)
      mk: Math.max(mkV || 0, mkP), mkP, mkV,
      at: t0 ? Math.round((t0 + n(c.duration)) * 1000) : 0,
    };
  }
  const preAvg = (A1, Cf) => (A1 - K * Cf) / (1 - K);   // средний до боя, если боя нет в истории
  // % после боя: кривая (или прежняя оценка) в пределах [Pint, Pint + 0,99]. o: { kn, A1, d, Pint, P1 }
  function refineP1(o) {
    const est = o.kn ? f(o.kn, o.A1) + (o.d || 0) : num(o.P1) != null ? o.P1 : o.Pint + 0.5;
    return floor2(clamp(est, o.Pint, o.Pint + 0.99));
  }
  const residual = (A0, Cf, A1) => A1 - Math.round(A0 + K * (Cf - A0)); // проверка K и правила максимума

  // база боя (4.3): досье этого танка или последняя запись — что новее по числу боёв (поровну — досье)
  function pickBase(tag, dc, last) {
    const a = obj(dc) && tag && tagKey(dc.vehicleTag) === tagKey(tag) && num(dc.movingAvgDamage) != null && num(dc.damageRating) != null
      ? { A0: dc.movingAvgDamage, P0: dc.damageRating, b0: num(dc.battlesCount) || 0, exact: true, src: 'dossier' } : null;
    const b = obj(last) && num(last.A) != null && num(last.P) != null
      ? { A0: last.A, P0: last.P, b0: num(last.b) || 0, exact: !!last.exact, src: last.src || 'live' } : null;
    return a && b ? (b.b0 > a.b0 ? b : a) : a || b || null;
  }

  // ---------- танк, регион, день сервера ----------
  const tagKey = t => String(t || '').split(':').pop().toLowerCase();  // usa:A183_XM69_Hacker -> a183_xm69_hacker
  const nation = t => { const s = String(t || ''), i = s.indexOf(':'); return i > 0 ? s.slice(0, i).toLowerCase() : ''; };
  const isLesta = r => LESTA.indexOf(String(r || '').toUpperCase()) >= 0;
  const realm = r => { const u = String(r || '').toUpperCase(); return isLesta(u) ? 'ru' : u === 'NA' ? 'com' : u === 'ASIA' ? 'asia' : 'eu'; };
  // смена кривой ~09:00 UTC у WG, ~03:00 у Lesta (наблюдение dm.threemarks, не проверено)
  const serverDay = (ms, lesta) => Math.floor((ms / 1000 - (lesta ? 3 : 9) * 3600) / 86400);
  const sameDay = (a, b, lesta) => a > 0 && b > 0 && serverDay(a, lesta) === serverDay(b, lesta);

  // ---------- адреса ----------
  const API = { eu: 'https://api.worldoftanks.eu', com: 'https://api.worldoftanks.com', asia: 'https://api.worldoftanks.asia' };
  const POL = 'https://poliroid.me/gunmarks/api/v2/';
  function wgUrl(rl, method, q, app) {      // Lesta (ru) — null: там пороги из игры
    const h = API[rl];
    if (!h) return null;
    const p = Object.assign({ application_id: app || APP }, q);
    return h + '/wot/' + method + '/?' + Object.keys(p).map(k => k + '=' + encodeURIComponent(p[k]).replace(/%2C/gi, ',')).join('&');
  }
  const url = {
    mastery: (rl, cd, app) => wgUrl(rl, 'tanks/mastery', { distribution: 'damage', percentile: PCTS.join(','), tank_id: [].concat(cd).join(',') }, app),
    pol: rl => POL + 'data/' + rl + '/vehicles/' + PCTS.join(','),
    ency: (rl, nat, app) => wgUrl(rl, 'encyclopedia/vehicles', { nation: nat, fields: 'tank_id,tag' }, app),
    polVeh: (rl, lang) => POL + 'vehicles/' + rl + '/' + (lang || 'ru'),
    ach: (rl, pid, cd, app) => wgUrl(rl, 'tanks/achievements', { account_id: pid, tank_id: [].concat(cd).join(','), fields: 'tank_id,achievements' }, app),
    // рендер танкопедии 1920×900 (CORS *); иконку 160×100 не берём
    render: (tag, region) => { const t = tagKey(tag); return (isLesta(region) ? 'https://tanki.su' : 'https://eu-wotp.wgcdn.co') + '/dcont/tankopedia_images/' + t + '/' + t + '_image.png'; },
  };

  // ---------- разбор ответов ----------
  const okData = j => (obj(j) && j.status === 'ok' && obj(j.data) ? j.data : null);
  // WG tanks/mastery -> { k, kn, upd (мс) } | null; с живым ключом формат не проверен — разбираем осторожно
  function parseMastery(j, cd) {
    const d = okData(j), kn = d && knots((obj(d.distribution) || d)[cd]);
    if (!kn) return null;
    let upd = num(toNum(d.updated_at)) || num(toNum(j.updated_at)) || 0;
    if (upd > 0 && upd < 1e11) upd *= 1000;
    return { k: kk(kn), kn, upd };
  }
  // poliroid, все танки региона -> { '<id>': [D20..D100] } (только годные строки) | null
  function parsePol(j) {
    const d = okData(j), rows = d && Array.isArray(d.data) ? d.data : null;
    if (!rows) return null;
    const out = {};
    for (const r of rows) { if (!obj(r) || num(r.id) == null) continue; const kn = knots(r.marks); if (kn) out[String(r.id)] = kk(kn); }
    return out;
  }
  // Lesta moeInfo.current этого танка -> { k, kn } | null; damageBetterThanNPercent — 9 чисел [0, D20..D100]
  function parseMoeInfo(cur, tag) {
    if (!obj(cur) || !tag || tagKey(cur.vehicleTag) !== tagKey(tag)) return null;
    const a = cur.damageBetterThanNPercent, kn = Array.isArray(a) && a.length === 9 ? knots(a) : null;
    return kn ? { k: kk(kn), kn } : null;
  }
  // WG encyclopedia/vehicles -> { tagKey: tank_id } (у WG тег без нации)
  function parseEncy(j) {
    const d = okData(j);
    if (!d) return null;
    const out = {};
    for (const id in d) { const v = obj(d[id]); if (!v || !v.tag) continue; const cd = num(v.tank_id) || +id; if (cd > 0) out[tagKey(v.tag)] = cd; }
    return out;
  }
  // poliroid vehicles, строки [id, tag, nation, class, tier, name, short, …] -> { tagKey: id }
  function parsePolVeh(j) {
    const d = okData(j), rows = d && obj(d.data) && Array.isArray(d.data.vehicles) ? d.data.vehicles : null;
    if (!rows) return null;
    const out = {};
    for (const r of rows) if (Array.isArray(r) && num(r[0]) > 0 && r[1]) out[tagKey(r[1])] = r[0];
    return out;
  }
  // WG tanks/achievements -> отметок | null (нет ключа marksOnGun — «неизвестно», не 0)
  function parseAch(j, pid, cd) {
    const d = okData(j), list = d && d[pid];
    if (!Array.isArray(list)) return null;
    const t = list.find(x => obj(x) && String(x.tank_id) === String(cd)), a = t && obj(t.achievements);
    return a && num(a.marksOnGun) != null ? a.marksOnGun : null;
  }

  // ---------- русские числа и слова ----------
  const dec = (v, d) => v.toFixed(d).replace('.', ',');
  function fmtInt(v) {                        // «3 873» с неразрывным пробелом, минус U+2212
    const n = Math.round(num(v) || 0);
    return (n < 0 ? MINUS : '') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  }
  const fmtP = (v, d = 2) => dec(floorD(num(v) || 0, d), d);      // % с отсечением, как в досье
  const fmtPct = (v, d = 2) => fmtP(v, d) + '%';                   // «84,37%»
  function fmtDelta(v, d = 2) {               // «+0,24» / «−1,78» / «±0,00»
    v = num(v) || 0;
    const h = 0.5 / Math.pow(10, d);
    return (v >= h ? '+' : v <= -h ? MINUS : '±') + dec(Math.abs(v), d);
  }
  const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many; };
  const marksWord = n => plural(n, 'отметка', 'отметки', 'отметок');
  const battlesWord = n => plural(n, 'бой', 'боя', 'боёв');
  const ord = n => n + '-я';                  // «2-я отметка»
  const ordG = n => n + '-й';                 // «до 2-й»
  // строка источника порогов (раздел 10); sure === false — «отметки уточнятся»
  const ddmm = ms => { const t = new Date(ms); return ('0' + t.getUTCDate()).slice(-2) + '.' + ('0' + (t.getUTCMonth() + 1)).slice(-2); };
  function srcLine(src, ms, sure) {
    const at = ms > 0 ? ' от ' + ddmm(ms) : '';
    const s = src === 'wg' ? 'Пороги WG' + at : src === 'pol' ? 'Пороги poliroid' + at : src === 'game' ? 'Пороги из игры'
      : src === 'est' ? 'Пороги — оценка по твоим боям' : src === 'demo' ? 'Пороги: пример' : 'Пороги недоступны — показываем средний';
    return sure === false ? s + ' · отметки уточнятся после боя' : s;
  }

  window.WR.moe = {
    K, T, PCTS, BONUS, MODES, APP, NBSP, MINUS,
    knots, kk, f, finv, slope, floor2, fitEst, pickCurve,
    combined, anchor, delta, project, band, bandText, rough, goal, cross, live, prog, progBattle,
    total, left, plus1, avgN, battlesTo, zeroCost, plan,
    lb, marksOf,
    bigId, counts, parseResult, preAvg, refineP1, residual, pickBase,
    tagKey, nation, isLesta, realm, serverDay, sameDay,
    url, parseMastery, parsePol, parseMoeInfo, parseEncy, parsePolVeh, parseAch,
    fmtInt, fmtP, fmtPct, fmtDelta, plural, marksWord, battlesWord, ord, ordG, srcLine,
  };
})();
