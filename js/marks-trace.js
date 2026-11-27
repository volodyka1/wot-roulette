// marks-trace.js — «Отметки на стволе»: контур танка (SVG-путь) и ствол на рендере танковеда WG 1920×900.
// Порт mk-trace.js (логика та же) + загрузка, поправки, кэш. Только считает: ни таймеров, ни анимаций.
(function (root) {
'use strict';
const VER = 12, PFX = 'mk:v1:sil:', MAXN = 40, INF = 1e20;
const now = () => (root.performance ? root.performance.now() : Date.now());
const rad = d => d * Math.PI / 180;
// параметры для рендеров 1920×900, ствол под ≈138,6°
const OPT = Object.freeze({ iso: 220, hairFrac: .0035, openFrac: .028, dir: Object.freeze([Math.cos(rad(138.6)), Math.sin(rad(138.6))]),
  maxDevDeg: 35, rejectDeg: 12, refineDeg: 6, minFitN: 25, minLenFrac: .03, minEl: 1.8,
  minHoleFrac: .012, holeFillFrac: .03, smoothFrac: .0045, epsFrac: .0011, cornerDeg: 48, k: .3, dec: 1,
  rgb: true, rgbWinFrac: .06, rgbMin: 6, rgbEdgeRel: .45, rgbBand: Object.freeze([.56, .84]) });
// поправки: wMul — толщина ×; w, tip — свои (px кадра); off — значок вместо колец
const FIX = { 'germany:G42_Maus': { wMul: 1.3 }, // по краям выходит ≈30 % тоньше
  'uk:GB31_Conqueror_Gun': { off: true } }; // орудие смотрит в камеру, не под 138,6°

// --- маска: расстояния (Felzenszwalb–Huttenlocher), открытие, компоненты, дыры ---
function dt1(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    const fq = f[q] + q * q;
    let s = (fq - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = (fq - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const t = q - v[k]; d[q] = t * t + f[v[k]]; }
}
function edt(src, W, H) { // квадраты расстояний
  const N = W * H, D = new Float64Array(N);
  for (let i = 0; i < N; i++) D[i] = src[i] ? 0 : INF;
  const n = Math.max(W, H), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = D[y * W + x];
    dt1(f, H, d, v, z);
    for (let y = 0; y < H; y++) D[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y++) {
    const r = y * W;
    for (let x = 0; x < W; x++) f[x] = D[r + x];
    dt1(f, W, d, v, z);
    for (let x = 0; x < W; x++) D[r + x] = d[x];
  }
  return D;
}
function opening(M, W, H, r) { // открытие диском r
  const N = W * H, bg = new Uint8Array(N);
  for (let i = 0; i < N; i++) bg[i] = M[i] ? 0 : 1;
  const din = edt(bg, W, H), r2 = r * r, E = new Uint8Array(N);
  for (let i = 0; i < N; i++) E[i] = M[i] && din[i] > r2 ? 1 : 0;
  const de = edt(E, W, H), O = new Uint8Array(N);
  for (let i = 0; i < N; i++) O[i] = M[i] && de[i] <= r2 ? 1 : 0;
  return { O, din };
}
function label(B, W, H) { // компоненты, 8-связность
  const N = W * H, L = new Int32Array(N), st = new Int32Array(N); let n = 0;
  for (let i = 0; i < N; i++) {
    if (!B[i] || L[i]) continue;
    n++; let sp = 0; st[sp++] = i; L[i] = n;
    while (sp) {
      const p = st[--sp], x = p % W, y = (p / W) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= W) continue;
          const q = yy * W + xx; if (B[q] && !L[q]) { L[q] = n; st[sp++] = q; }
        }
      }
    }
  }
  return { L, n };
}
// заливка дыр ≤ maxArea: дырчатый тормоз E 100, канал ствола
function fillHoles(S, W, H, maxArea) {
  const N = W * H, L = new Uint8Array(N), st = new Int32Array(N), out = S.slice();
  for (let i = 0; i < N; i++) {
    if (S[i] || L[i]) continue;
    let sp = 0, cnt = 0, border = false; const mem = []; st[sp++] = i; L[i] = 1;
    while (sp) {
      const p = st[--sp], x = p % W, y = (p / W) | 0; cnt++;
      if (cnt <= maxArea) mem.push(p);
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
      if (x > 0 && !S[p - 1] && !L[p - 1]) { L[p - 1] = 1; st[sp++] = p - 1; }
      if (x < W - 1 && !S[p + 1] && !L[p + 1]) { L[p + 1] = 1; st[sp++] = p + 1; }
      if (y > 0 && !S[p - W] && !L[p - W]) { L[p - W] = 1; st[sp++] = p - W; }
      if (y < H - 1 && !S[p + W] && !L[p + W]) { L[p + W] = 1; st[sp++] = p + W; }
    }
    if (!border && cnt <= maxArea) for (const p of mem) out[p] = 1;
  }
  return { S: out };
}
function compStats(L, n, W, H) {
  const c = [];
  for (let k = 0; k <= n; k++) c.push({ a: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, x0: 1e9, y0: 1e9, x1: -1, y1: -1 });
  for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
    const k = L[i]; if (!k) continue; const s = c[k], X = x + .5, Y = y + .5;
    s.a++; s.sx += X; s.sy += Y; s.sxx += X * X; s.syy += Y * Y; s.sxy += X * Y;
    if (x < s.x0) s.x0 = x; if (x > s.x1) s.x1 = x; if (y < s.y0) s.y0 = y; if (y > s.y1) s.y1 = y;
  }
  return c;
}
function pcaOf(s) {
  const mx = s.sx / s.a, my = s.sy / s.a;
  const cxx = s.sxx / s.a - mx * mx, cyy = s.syy / s.a - my * my, cxy = s.sxy / s.a - mx * my;
  const tr = cxx + cyy, det = cxx * cyy - cxy * cxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(0, tr / 2 - disc);
  let ux = cxy, uy = l1 - cxx;
  if (Math.abs(ux) + Math.abs(uy) < 1e-9) { ux = cxx >= cyy ? 1 : 0; uy = cxx >= cyy ? 0 : 1; }
  const l = Math.hypot(ux, uy); return { mx, my, ux: ux / l, uy: uy / l, l1, l2 };
}

// --- контур: marching squares, внутри — справа ---
function marching(A, W, H, iso) {
  const GW = W + 2, GH = H + 2, nE = GW * GH * 2;
  const next = new Int32Array(nE).fill(-1), PX = new Float32Array(nE), PY = new Float32Array(nE);
  const val = (X, Y) => (X >= 1 && X <= W && Y >= 1 && Y <= H) ? A[(Y - 1) * W + (X - 1)] : 0;
  const hE = (X, Y) => { const id = (Y * GW + X) * 2, a = val(X, Y), b = val(X + 1, Y); PX[id] = X - .5 + (iso - a) / (b - a); PY[id] = Y - .5; return id; };
  const vE = (X, Y) => { const id = (Y * GW + X) * 2 + 1, a = val(X, Y), b = val(X, Y + 1); PX[id] = X - .5; PY[id] = Y - .5 + (iso - a) / (b - a); return id; };
  for (let Y = 0; Y < GH - 1; Y++) for (let X = 0; X < GW - 1; X++) {
    const a = val(X, Y), b = val(X + 1, Y), c = val(X + 1, Y + 1), d = val(X, Y + 1);
    const idx = (a >= iso ? 8 : 0) | (b >= iso ? 4 : 0) | (c >= iso ? 2 : 0) | (d >= iso ? 1 : 0);
    if (idx === 0 || idx === 15) continue;
    const T = () => hE(X, Y), B = () => hE(X, Y + 1), L = () => vE(X, Y), R = () => vE(X + 1, Y);
    const seg = (p, q) => { next[p()] = q(); };
    switch (idx) {
      case 1: seg(L, B); break; case 2: seg(B, R); break; case 3: seg(L, R); break; case 4: seg(R, T); break;
      case 6: seg(B, T); break; case 7: seg(L, T); break; case 8: seg(T, L); break; case 9: seg(T, B); break;
      case 11: seg(T, R); break; case 12: seg(R, L); break; case 13: seg(R, B); break; case 14: seg(B, L); break;
      case 5: if ((a + b + c + d) / 4 >= iso) { seg(L, T); seg(R, B); } else { seg(R, T); seg(L, B); } break;
      case 10: if ((a + b + c + d) / 4 >= iso) { seg(T, R); seg(B, L); } else { seg(T, L); seg(B, R); } break;
    }
  }
  const seen = new Uint8Array(nE), loops = [];
  for (let e = 0; e < nE; e++) {
    if (next[e] < 0 || seen[e]) continue;
    const pts = []; let c = e;
    while (c >= 0 && !seen[c]) { seen[c] = 1; pts.push([PX[c], PY[c]]); c = next[c]; }
    if (pts.length >= 3) loops.push(pts);
  }
  return loops;
}
function area(p) { let s = 0; for (let i = 0, n = p.length; i < n; i++) { const a = p[i], b = p[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
// размытие маски (3 box ≈ гаусс): без зубцов гусениц
function boxBlur(src, W, H, r) {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H), n = 2 * r + 1;
  for (let y = 0; y < H; y++) { const o = y * W; let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[o + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) { tmp[o + x] = acc / n; acc += src[o + Math.min(W - 1, x + r + 1)] - src[o + Math.max(0, x - r)]; } }
  for (let x = 0; x < W; x++) { let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) { out[y * W + x] = acc / n; acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x]; } }
  return out;
}
function smoothMask(S, W, H, sigma) {
  let f = new Float32Array(W * H); for (let i = 0; i < W * H; i++) f[i] = S[i] ? 255 : 0;
  const r = Math.max(1, Math.round(sigma * .87));
  for (let k = 0; k < 3; k++) f = boxBlur(f, W, H, r);
  return f;
}
// Рамер–Дуглас–Пекер
function rdp(pts, eps) {
  const n = pts.length; if (n < 3) return pts.slice();
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const st = [0, n - 1];
  while (st.length) {
    const b = st.pop(), a = st.pop();
    const ax = pts[a][0], ay = pts[a][1], dx = pts[b][0] - ax, dy = pts[b][1] - ay, L = Math.hypot(dx, dy) || 1e-9;
    let md = -1, mi = -1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L; if (d > md) { md = d; mi = i; } }
    if (md > eps) { keep[mi] = 1; st.push(a, mi, mi, b); }
  }
  return pts.filter((_, i) => keep[i]);
}
function rdpClosed(pts, eps) {
  let far = 0, fd = -1;
  for (let i = 0; i < pts.length; i++) { const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
  const a = rdp(pts.slice(0, far + 1), eps), b = rdp(pts.slice(far).concat([pts[0]]), eps);
  return a.concat(b.slice(1, -1));
}
// Безье с углами (поворот > cornerDeg)
function toBezier(pts, cornerDeg, k, dec) {
  const n = pts.length, cosC = Math.cos(rad(cornerDeg));
  const corner = new Uint8Array(n), tx = new Float64Array(n), ty = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    let ax = p1[0] - p0[0], ay = p1[1] - p0[1], bx = p2[0] - p1[0], by = p2[1] - p1[1];
    const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
    ax /= la; ay /= la; bx /= lb; by /= lb;
    corner[i] = ax * bx + ay * by < cosC ? 1 : 0;
    const x = ax + bx, y = ay + by, l = Math.hypot(x, y) || 1;
    tx[i] = x / l; ty[i] = y / l;
  }
  const m = 10 ** dec, f = v => Math.round(v * m) / m, P = p => f(p[0]) + ' ' + f(p[1]);
  let d = 'M' + P(pts[0]), segs = 0, lines = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, p = pts[i], q = pts[j], dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy);
    segs++;
    if (corner[i] && corner[j]) { d += 'L' + P(q); lines++; continue; }
    const c1 = corner[i] ? [p[0] + dx / 3, p[1] + dy / 3] : [p[0] + tx[i] * L * k, p[1] + ty[i] * L * k];
    const c2 = corner[j] ? [q[0] - dx / 3, q[1] - dy / 3] : [q[0] - tx[j] * L * k, q[1] - ty[j] * L * k];
    d += 'C' + P(c1) + ' ' + P(c2) + ' ' + P(q);
  }
  return { d: d + 'Z', segs, lines };
}

// --- ствол по альфе: тонкая часть за корпусом ---
function inMask(S, W, H, x, y) { const xi = Math.floor(x), yi = Math.floor(y); return xi >= 0 && yi >= 0 && xi < W && yi < H && S[yi * W + xi] === 1; }
function section(S, W, H, x, y, nx, ny, maxT) {
  if (!inMask(S, W, H, x, y)) return null;
  const st = .5; let a = 0, b = 0;
  while (a < maxT && inMask(S, W, H, x + nx * (a + st), y + ny * (a + st))) a += st;
  while (b < maxT && inMask(S, W, H, x - nx * (b + st), y - ny * (b + st))) b += st;
  return { w: a + b + st, off: (a - b) / 2, cut: a >= maxT || b >= maxT };
}
// профиль ширины; s — от среза к казённику
function walk(S, W, H, tip, u, maxS, maxT, ahead) {
  const n = [-u[1], u[0]], out = [];
  for (let s = -Math.round(ahead || 6); s <= maxS; s += 1) {
    const x = tip[0] - u[0] * s, y = tip[1] - u[1] * s, c = section(S, W, H, x, y, n[0], n[1], maxT);
    out.push({ s, x, y, w: c ? c.w : 0, off: c ? c.off : 0, cut: c ? c.cut : false });
  }
  return out;
}
function median(a) { if (!a.length) return 0; const b = a.slice().sort((p, q) => p - q); return b[b.length >> 1]; }
function fitLine(pts) {
  let sx = 0, sy = 0; for (const p of pts) { sx += p[0]; sy += p[1]; }
  const mx = sx / pts.length, my = sy / pts.length; let xx = 0, yy = 0, xy = 0;
  for (const p of pts) { const dx = p[0] - mx, dy = p[1] - my; xx += dx * dx; yy += dy * dy; xy += dx * dy; }
  const a = .5 * Math.atan2(2 * xy, xx - yy); return { mx, my, ux: Math.cos(a), uy: Math.sin(a) };
}
// профиль: срез, скос, тормоз, толщина, где ствол уходит в корпус
function readProfile(pr, bodyW) {
  // срез — первый отсчёт без разрывов за ним
  const i0 = pr.findIndex((p, i) => p.w > 0 && pr.slice(i, i + 4).every(q => q.w > 0));
  if (i0 < 0) return null;
  const s0 = pr[i0].s, P = pr.slice(i0).map(p => ({ ...p, s: p.s - s0 }));
  const lim = .085 * bodyW;
  // 1) конец видимой части
  let end = P.length, run = 0;
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    if (p.cut || p.w > lim || p.w === 0) { if (++run >= 3) { end = i - 2; break; } } else run = 0;
  }
  let vis = P.slice(0, Math.max(1, end));
  // 2) скос среза
  let ramp = 0;
  while (ramp < Math.min(8, vis.length - 1) && vis[ramp].w < .85 * Math.max(...vis.slice(ramp, ramp + 5).map(p => p.w))) ramp++;
  // 3) толщина — самый тонкий из населённых кластеров ширин ±8 %
  const ws = vis.slice(ramp).map(p => p.w).filter(w => w > 0).sort((x, y) => x - y);
  let wThin = median(ws) || 1;
  const cl = [];
  for (let i = 0, j0 = 0, j1 = 0; i < ws.length; i++) {
    const v = ws[i]; while (ws[j0] < .92 * v) j0++; while (j1 < ws.length && ws[j1] <= 1.08 * v) j1++;
    cl.push({ v, n: j1 - j0, j0, j1 });
  }
  const maxN = cl.reduce((m, c) => Math.max(m, c.n), 0);
  const pick = cl.find(c => c.n >= Math.max(5, .3 * maxN));
  if (pick) wThin = median(ws.slice(pick.j0, pick.j1));
  // 4) тормоз: подряд шире толщины в 1,22+ раза
  let brake = 0, gap = 0;
  for (let i = ramp; i < vis.length && vis[i].s < 7 * wThin; i++) {
    if (vis[i].w >= 1.22 * wThin) { brake = vis[i].s + 1; gap = 0; } else if (++gap > 2) break;
  }
  if (brake - (vis[ramp] ? vis[ramp].s : 0) < .45 * wThin) brake = 0;
  if (brake > 4.5 * wThin) brake = 0;
  // 5) виден почти один тормоз: толщина ≈ 0,58 его ширины
  let est = false;
  if (!brake && vis.length < 2.2 * wThin && wThin > .035 * bodyW) { brake = vis[vis.length - 1].s + 1; wThin *= .58; est = true; }
  // 6) ширина резко выросла и держится — ствол лёг на корпус
  run = 0;
  for (let i = 0; i < vis.length; i++) {
    if (vis[i].s <= brake + 1) continue;
    if (vis[i].w > 1.85 * wThin) { if (++run >= 3) { vis = vis.slice(0, i - 2); break; } } else run = 0;
  }
  // ровная часть ±12 % (у угла корпуса её мало)
  const wRef = est ? wThin / .58 : wThin;
  const plateau = vis.slice(ramp).filter(p => p.w >= .88 * wRef && p.w <= 1.12 * wRef).length;
  return { P, s0, vis, ramp, len: vis.length ? vis[vis.length - 1].s : 0, wThin, brake, est, plateau, wRef };
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const angDeg = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180 / Math.PI;
function findBarrel(S, W, H, opt) {
  let x0 = W, x1 = -1, area = 0, sx = 0, sy = 0;
  for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) if (S[i]) { area++; sx += x + .5; sy += y + .5; if (x < x0) x0 = x; if (x > x1) x1 = x; }
  const bodyW = x1 - x0 + 1;
  const R = Math.max(2, Math.min(42, opt.openFrac * bodyW));
  const { O } = opening(S, W, H, R);
  // корпус — крупнейшее после открытия, остальное — кандидаты
  const lo = label(O, W, H), ls = compStats(lo.L, lo.n, W, H);
  let main = 0; for (let k = 1; k <= lo.n; k++) if (!main || ls[k].a > ls[main].a) main = k;
  const body = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) body[i] = lo.L[i] === main ? 1 : 0;
  const bc = main ? [ls[main].sx / ls[main].a, ls[main].sy / ls[main].a] : [sx / area, sy / area];
  const thin = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) thin[i] = S[i] && !body[i] ? 1 : 0;
  const lt = label(thin, W, H), cs = compStats(lt.L, lt.n, W, H);
  const touch = new Uint8Array(lt.n + 1);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, k = lt.L[i]; if (!k || touch[k]) continue;
    if (body[i - 1] || body[i + 1] || body[i - W] || body[i + W] || body[i - W - 1] || body[i - W + 1] || body[i + W - 1] || body[i + W + 1]) touch[k] = 1;
  }
  const ex = opt.dir;
  let extMax = -Infinity; for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) if (S[i]) { const pr = (x + .5) * ex[0] + (y + .5) * ex[1]; if (pr > extMax) extMax = pr; }
  const cands = [];
  for (let k = 1; k <= lt.n; k++) {
    const c = cs[k]; if (c.a < Math.max(6, .00004 * area)) continue;
    let p = pcaOf(c);
    // ось по своим пикселям (без прилипших краёв корпуса)
    for (let it = 0; it < 2; it++) {
      const wbar = Math.max(1.5, 2 * Math.sqrt(Math.max(p.l2, .25)) * 1.5);
      const st = { a: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0 };
      for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
        if (lt.L[y * W + x] !== k) continue; const X = x + .5, Y = y + .5;
        const d = Math.abs((X - p.mx) * p.uy - (Y - p.my) * p.ux); if (d > wbar) continue;
        st.a++; st.sx += X; st.sy += Y; st.sxx += X * X; st.syy += Y * Y; st.sxy += X * Y;
      }
      if (st.a > 5) p = pcaOf(st);
    }
    let smin = Infinity, smax = -Infinity;
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
      if (lt.L[y * W + x] !== k) continue; const s = (x + .5 - p.mx) * p.ux + (y + .5 - p.my) * p.uy;
      if (s < smin) smin = s; if (s > smax) smax = s;
    }
    const L = smax - smin, wbar = c.a / Math.max(1, L), el = L / Math.max(1, wbar);
    // к дулу — дальний от корпуса конец
    const e1 = [p.mx + p.ux * smax, p.my + p.uy * smax], e0 = [p.mx + p.ux * smin, p.my + p.uy * smin];
    let u = [p.ux, p.uy], tip = e1;
    if (Math.hypot(e0[0] - bc[0], e0[1] - bc[1]) > Math.hypot(e1[0] - bc[0], e1[1] - bc[1])) { u = [-p.ux, -p.uy]; tip = e0; }
    const cosd = u[0] * ex[0] + u[1] * ex[1];
    const dirW = cosd < Math.cos(rad(opt.maxDevDeg)) ? 0 : cosd ** 3;
    const extW = 1 + Math.max(0, 1 - (extMax - (tip[0] * ex[0] + tip[1] * ex[1])) / (.15 * bodyW));
    const score = L * Math.min(1, el / 7) * dirW * extW * (touch[k] ? 1 : .25);
    cands.push({ k, a: c.a, L, wbar, el, u, tip, cosd, touch: touch[k], score });
  }
  cands.sort((a, b) => b.score - a.score);
  const res = { ok: false, bodyW, method: 'none' };
  const extremeOf = (k) => { // крайняя по ex точка куска k или силуэта
    let bp = -Infinity, bx = 0, by = 0;
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
      if (k ? lt.L[i] !== k : !S[i]) continue; const pr = (x + .5) * ex[0] + (y + .5) * ex[1];
      if (pr > bp) { bp = pr; bx = x + .5; by = y + .5; }
    }
    if (!k) return [bx, by];
    const c = cs[k], mx = c.sx / c.a, my = c.sy / c.a, t = bp - (mx * ex[0] + my * ex[1]);
    return [mx + ex[0] * t, my + ex[1] * t];
  };
  // уточнение: ось по центрам сечений, иначе сдвиг поперёк
  const maxS = .6 * bodyW, maxT = .09 * bodyW;
  const refine = (tip, u) => {
    let rp = null, fit = 0;
    for (let it = 0; it < 4; it++) {
      rp = readProfile(walk(S, W, H, tip, u, maxS, maxT, .12 * bodyW), bodyW);
      if (!rp) break;
      const n = [-u[1], u[0]];
      const thinS = rp.vis.filter(p => p.s > rp.brake + 1 && p.w > 0 && p.w < 1.3 * rp.wThin && !p.cut);
      if (thinS.length >= opt.minFitN) {
        const ln = fitLine(thinS.map(p => [p.x + n[0] * p.off, p.y + n[1] * p.off]));
        let nu = [ln.ux, ln.uy]; if (dot(nu, u) < 0) nu = [-nu[0], -nu[1]];
        if (angDeg(nu, ex) <= opt.refineDeg) {
          const t = (tip[0] - ln.mx) * nu[0] + (tip[1] - ln.my) * nu[1];
          const moved = Math.hypot(ln.mx + nu[0] * t - tip[0], ln.my + nu[1] * t - tip[1]) + 50 * angDeg(nu, u) / 57.3;
          tip = [ln.mx + nu[0] * t, ln.my + nu[1] * t]; u = nu; fit = thinS.length;
          if (moved < .3) break; continue;
        }
      }
      const src = thinS.length >= 3 ? thinS : rp.vis.filter(p => p.w > 0 && !p.cut);
      const off = src.length ? median(src.map(p => p.off)) : 0;
      tip = [tip[0] + n[0] * off, tip[1] + n[1] * off];
      if (Math.abs(off) < .3) break;
    }
    return { rp, tip, u, fit };
  };
  // первый кандидат с профилем ствола — он
  const list = cands.slice(0, 4).filter(c => c.score > 0 && c.L >= opt.minLenFrac * bodyW && c.el >= opt.minEl);
  list.push({ k: 0, extreme: true, el: 0, L: 0, u: ex.slice() }); // запасной: крайняя точка силуэта
  for (const c of list) {
    const dev0 = c.extreme ? 0 : angDeg(c.u, ex);
    if (!c.extreme && c.el >= 2.5 && dev0 > opt.rejectDeg) continue; // край корпуса
    const snap = c.extreme || c.el < 5; // короткий — ось камеры
    const r = refine(snap ? extremeOf(c.k) : c.tip, snap ? ex.slice() : c.u);
    const rp = r.rp;
    if (opt.log) opt.log(c, rp, dev0); // отладка: что пробовали
    if (!rp || rp.wThin > .06 * bodyW || rp.wThin < .006 * bodyW || rp.len < 1.2 * rp.wThin || rp.plateau < Math.max(6, .8 * rp.wRef)) continue;
    Object.assign(res, { ok: true, method: c.extreme ? 'extreme-point' : 'thin-part', u: r.u, n: [-r.u[1], r.u[0]],
      tip: [r.tip[0] - r.u[0] * rp.s0, r.tip[1] - r.u[1] * rp.s0], w: rp.wThin, brake: rp.brake, len: rp.len, profile: rp.P });
    break;
  }
  if (!res.ok) { // не торчит: дальше края в яркости или значок
    res.method = 'fallback';
    res.u = ex.slice(); res.n = [-ex[1], ex[0]]; res.w = .024 * bodyW; res.brake = 0; res.len = 0;
    res.tip = extremeOf(0);
  }
  res.angle = Math.atan2(res.u[1], res.u[0]) * 180 / Math.PI;
  return layRings(res);
}
// три кольца на СЕРЕДИНЕ ствола: между тормозом и маской (ствол над корпусом — по светотени, см. gunOverHull), шаг — толщина;
// из чистых участков (не на эжектор) — ближайший к середине; нет чистого — просто середина
function layRings(res) {
  const w = res.w, ringW = .52 * w, step = 1.05 * w, span = 2 * step + ringW, P = res.ok ? res.profile : null;
  const len = res.len || 0, gun = Math.max(len, res.gun || 0), C = res.ok ? res.cor : null;
  const start = res.brake ? res.brake + .6 * w : 1.2 * w, end = gun - .3 * w;
  // свободная часть — по ширине профиля, над корпусом — по сходству светотени
  const clean = (a, b) => {
    if (P && a < len) { const seg = P.filter(p => p.s >= a - .5 && p.s <= Math.min(b, len) + .5); if (!(seg.length && seg.every(p => p.w > .7 * w && p.w < 1.18 * w))) return false; }
    if (b > len) { if (!C) return false; for (let s = Math.round(Math.max(a, len)); s <= b; s++) if (!(C[s] >= res.corThr)) return false; }
    return true;
  };
  let first = start;
  if (res.ok && end - start >= span) {
    const mid = (start + end) / 2;
    first = Math.max(start, Math.min(end - span, mid - span / 2));
    if (P || C) {
      let best = null;
      for (let s0 = start; s0 + span <= end; s0 += 1) {
        if (clean(s0, s0 + span)) { const d = Math.abs(s0 + span / 2 - mid); if (!best || d < best.d) best = { s0, d }; }
      }
      if (best && best.d <= .18 * (end - start)) first = best.s0; // чистое далеко от середины — ставим на середину
    }
  }
  first += ringW / 2;
  res.rings = [0, 1, 2].map(i => {
    const s = first + i * step, pw = s < len && res.profile ? res.profile.find(p => Math.abs(p.s - s) < .6) : null;
    return { s, w: Math.max(w, pw && pw.w > 0 && pw.w < 1.6 * w ? pw.w : w), rw: ringW };
  });
  res.need = first + 2 * step + ringW / 2 + .3 * w;
  res.extrap = res.method === 'fallback' || !(gun >= res.need);
  return res;
}
// ствол поверх корпуса: силуэт его не видит, а светотень цилиндра (поперёк ствола) та же, что на свободной части.
// Образец — с чистой части за тормозом (ствол целиком на корпусе — с куска, найденного по краям в яркости). Идём вдоль
// оси и подстраиваемся поперёк (ось «по камере» бывает чуть косой; у спаренных стволов не перескакиваем на соседний),
// пока сечение похоже на образец. Провал перешагиваем, только если за ним снова ствол (хомут, кожух, эжектор);
// иначе это маска — конец пушки. Кусок по краям бывает у самой башни — тогда сначала идём от него вперёд к дулу.
// Ось, взятую по камере, потом поправляем по найденным центрам.
function gunOverHull(Y, S, W, H, b) {
  b.gun = b.len || 0; b.cor = null;
  if (!Y || !b.ok || b.method === 'fallback' || !(b.w > 0)) return b;
  const w = b.w, hw = w / 2, len = b.len || 0, rgb = b.method === 'rgb-edges', loose = rgb || b.method === 'extreme-point';
  const u = b.u.slice(), n = [-u[1], u[0]], tip = b.tip.slice();
  const samp = (a, o) => {
    const x = tip[0] - u[0] * a + n[0] * o - .5, y = tip[1] - u[1] * a + n[1] * o - .5;
    const x0 = Math.floor(x), y0 = Math.floor(y); if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) return NaN;
    const i0 = y0 * W + x0; if (!(S[i0] && S[i0 + 1] && S[i0 + W] && S[i0 + W + 1])) return NaN;
    const fx = x - x0, fy = y - y0;
    return (Y[i0] * (1 - fx) + Y[i0 + 1] * fx) * (1 - fy) + (Y[i0 + W] * (1 - fx) + Y[i0 + W + 1] * fx) * fy;
  };
  const K = 9, offs = Array.from({ length: K }, (_, i) => (-1 + 2 * i / (K - 1)) * .8 * hw);
  const sect = (s, o0) => { // нормированное сечение (без краёв) или null
    const v = offs.map(o => samp(s, o0 + o)); if (v.some(x => x !== x)) return null;
    const m = v.reduce((a, x) => a + x, 0) / K, d = v.map(x => x - m), sd = Math.sqrt(d.reduce((a, x) => a + x * x, 0) / K);
    return sd < 2 ? null : d.map(x => x / sd);                // плоское (нет светотени) — не сравниваем
  };
  const s0 = b.brake ? b.brake + .6 * w : rgb ? .4 * w : 1.2 * w;
  let s1 = Math.min(len - .5 * w, s0 + 8 * w);
  if (s1 - s0 < 2 * w) s1 = s0 + 2.5 * w;                     // свободной части нет (торчит один тормоз) — образец сразу за ним
  const acc = new Array(K).fill(0), smp = [];
  for (let s = Math.round(s0); s <= s1; s++) { const q = sect(s, 0); if (q) { smp.push(q); q.forEach((x, i) => { acc[i] += x; }); } }
  if (smp.length < 1.5 * w) return b;
  const T = (() => { const m = acc.map(x => x / smp.length), mm = m.reduce((a, x) => a + x, 0) / K, d = m.map(x => x - mm), sd = Math.sqrt(d.reduce((a, x) => a + x * x, 0) / K) || 1; return d.map(x => x / sd); })();
  const corr = q => q ? q.reduce((a, x, i) => a + x * T[i], 0) / K : NaN;
  const q0 = median(smp.map(corr));
  if (!(q0 >= .55)) return b;                                  // образец ненадёжный — только свободная часть
  const thr = Math.max(.45, Math.min(.7, .8 * q0)), lo = thr - .15;
  // слежение: сечение в точке s со сдвигом o; сдвиг меняем на ±1, только если заметно лучше (окно вылезло за ствол — ищем до ±3)
  const track = (from, to, dir) => {
    const L = Math.abs(to - from) + 1, raw = new Float32Array(L).fill(NaN), OFF = new Float32Array(L);
    let o = 0;
    for (let i = 0; i < L; i++) {
      const s = from + dir * i;
      let c = corr(sect(s, o));
      if (i > 0 && (i % 2 === 0 || c !== c)) {
        let best = c === c ? c : -2, bo = o;
        for (const d of [-1, 1, -2, 2, -3, 3]) {
          if (Math.abs(d) > 1 && c === c) break;
          const oo = o + d; if (Math.abs(oo) > .45 * w) continue;
          const cc = corr(sect(s, oo));
          if (cc === cc && cc > best + (c === c ? .04 : 0)) { best = cc; bo = oo; }
        }
        if (bo !== o && best >= lo) { o = bo; c = best; }
      }
      OFF[i] = o; raw[i] = c;
    }
    const C = new Float32Array(L).fill(-1);                    // сглаживание ±3, пустые (вне силуэта) не в счёт
    for (let i = 0; i < L; i++) { let a = 0, k = 0, all = 0; for (let j = -3; j <= 3; j++) { const v = raw[i + j]; if (v === undefined) continue; all++; if (v === v) { a += v; k++; } } C[i] = k >= Math.max(1, all / 2) ? a / k : -1; }
    return { raw, OFF, C };
  };
  // идти дальше — мягкий порог; провал перешагиваем, если за ним снова ствол (1,5 толщины, 80 % выше мягкого).
  // Провал «слабый» (сечение всё ещё похоже, ≥ 0,3) — до 3 толщин (кожух, хомуты), «пустой» — до 1,2 (у края корпуса 1,6)
  const follow = (C, i0, iMax, edge) => {
    const runLen = 1.5 * w;
    let good = i0, i = i0 + 1;
    while (i < iMax) {
      if (C[i] >= lo) { good = i++; continue; }
      let gapMax = (i < edge ? 1.6 : 1.2) * w, sum = 0, k = 0;
      for (let j = i; j < Math.min(iMax, i + 3 * w); j++) { if (C[j] >= lo) break; sum += C[j]; k++; }
      if (k && sum / k >= .3) gapMax = 3 * w;
      let rec = -1;
      for (let t = i + 1; t <= good + gapMax && t < iMax; t++) {
        if (C[t] < thr) continue;
        let ok = 0, all = 0;
        for (let j = t; j < t + runLen && j < iMax; j++) { all++; if (C[j] >= lo) ok++; }
        if (all >= runLen - 1 && ok >= .8 * all) { rec = t; break; }
      }
      if (rec < 0) break;
      i = rec;
    }
    return good;
  };
  // кусок по краям в яркости бывает у самой башни: вперёд по стволу, потом по дульному устройству, пока ствол торчит из корпуса
  if (rgb && !b._fwd) {
    const fMax = Math.round(Math.min(3 * Math.max(len, 8 * w), Math.hypot(W, H)));
    const F = track(0, -fMax, -1), eBar = follow(F.C, 0, fMax, 0);
    let e = eBar;
    if (eBar > w) {                                            // дальше — дуло: точка оси в силуэте, а рядом сбоку пусто
      for (let i = eBar + 1, miss = 0; i < fMax && miss < 3; i++) {
        const s = -i, inside = samp(s, F.OFF[eBar]) === samp(s, F.OFF[eBar]);
        const free = !(samp(s, F.OFF[eBar] + 1.7 * w) === samp(s, F.OFF[eBar] + 1.7 * w)) || !(samp(s, F.OFF[eBar] - 1.7 * w) === samp(s, F.OFF[eBar] - 1.7 * w));
        if (inside && free) { e = i; miss = 0; } else miss++;
      }
    }
    // вперёд по силуэту, держась середины ствола (кусок по краям бывает сбоку от оси): в каждом шаге — сплошной кусок силуэта
    // поперёк (±1,6 толщины) у прежнего центра, его середина — новый центр; кончик должен торчать в пустоту с обеих сторон
    const inS = (a, o) => samp(a, o) === samp(a, o);
    let last = 0, cen = 0, cLast = 0, freeN = 0, tot = 0;
    const WD = new Float32Array(fMax + 1), FR = new Uint8Array(fMax + 1);
    const runAt = (s, c) => { // куски силуэта поперёк (±1,6 толщины): похожий на ствол (не шире 2,6) — ближайший к c; иначе широкий (корпус)
      const lim = 1.6 * w, a0 = Math.round(c - lim), a1 = Math.round(c + lim), runs = [];
      for (let o = a0, st = null; o <= a1 + 1; o++) {
        const v = o <= a1 && inS(s, o);
        if (v && st === null) st = o; else if (!v && st !== null) { runs.push({ lo: st, hi: o - 1, free: st > a0 && o - 1 < a1 }); st = null; }
      }
      if (!runs.length) return null;
      const thin = runs.filter(r => r.hi - r.lo <= 2.6 * w);
      if (thin.length) return thin.reduce((p, q) => Math.abs((q.lo + q.hi) / 2 - c) < Math.abs((p.lo + p.hi) / 2 - c) ? q : p);
      return runs.reduce((p, q) => (q.hi - q.lo > p.hi - p.lo ? q : p));
    };
    for (let i = 1, miss = 0; i < fMax && miss <= 3; i++) {
      const R = runAt(-i, cen);
      if (!R) { miss++; continue; }
      if (R.hi - R.lo <= 2.6 * w) cen += Math.max(-1, Math.min(1, (R.lo + R.hi) / 2 - cen)); // над корпусом (широко) — центр не трогаем
      last = i; cLast = cen; miss = 0; WD[i] = R.hi - R.lo + 1; FR[i] = R.free ? 1 : 0;
    }
    for (let j = Math.max(1, last - Math.round(1.5 * w)); j <= last; j++) { tot++; const R = runAt(-j, cLast); if (R && R.free) freeN++; }
    if (last > Math.max(e, eBar) + w && last > 1.5 * w && freeN >= .6 * tot && b.bodyW) {
      // от кончика назад: свободная часть (торчит из корпуса), её толщина, дульное устройство (шире ствола)
      let k = last, gaps = 0;
      while (k > 0 && gaps <= 3) { if (FR[k]) gaps = 0; else gaps++; k--; }
      const ws = []; for (let j = k + 1; j <= last; j++) if (FR[j] && WD[j] <= 2.6 * w) ws.push(WD[j]);
      const wBar = median(ws) || w;
      let br = 0; for (let j = last; j > k && WD[j] > 1.3 * wBar; j--) br = last - j + 1;
      if (br > 4.5 * wBar) br = 0;
      const nt = [tip[0] + u[0] * last + n[0] * cLast, tip[1] + u[1] * last + n[1] * cLast];
      Object.assign(b, { tip: nt, brake: br, len: Math.max(br + 1, last - k), profile: null, method: 'rgb-fwd', _fwd: true, fwd: last, _minGun: last + len });
      return gunOverHull(Y, S, W, H, b);
    }
    if (eBar > w) {
      const o = F.OFF[eBar];
      b.tip = [tip[0] + u[0] * e + n[0] * o, tip[1] + u[1] * e + n[1] * o];
      b.len = len + e; b.brake = e - eBar > .3 * w ? e - eBar : 0; b._fwd = true; b.fwd = e;
      return gunOverHull(Y, S, W, H, b);
    }
  }
  const sMax = Math.round(Math.min(len + 3 * Math.max(len, 12 * w), 2 * Math.hypot(W, H)));
  const { raw, OFF, C } = track(0, sMax, 1);
  const good = follow(C, Math.round(Math.max(s0, len - w)), sMax, len + 1.5 * w);
  b.gun = Math.max(len, good, b._minGun || 0); b.cor = C; b.corThr = lo;
  // ось «по камере» или по короткому куску — поправить по центрам найденного ствола (наклон до 7°)
  if (b.gun > len + 4 * w && (loose || b.gun > 2 * len)) {
    let m = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let t = Math.ceil(s0); t <= b.gun; t++) if (raw[t] >= lo) { m++; sx += t; sy += OFF[t]; sxx += t * t; sxy += t * OFF[t]; }
    const den = m * sxx - sx * sx;
    if (m > 3 * w && den > 0) {
      const k = (m * sxy - sx * sy) / den, a = (sy - k * sx) / m;
      if (Math.abs(k) < .12 && Math.abs(a) < .6 * w) {
        const nu = [u[0] - n[0] * k, u[1] - n[1] * k], L = Math.hypot(nu[0], nu[1]);
        b.tip = [tip[0] + n[0] * a, tip[1] + n[1] * a]; b.u = [nu[0] / L, nu[1] / L]; b.n = [-b.u[1], b.u[0]];
        b.angle = Math.atan2(b.u[1], b.u[0]) * 180 / Math.PI; b.axisFix = +k.toFixed(4);
      }
    }
  }
  return b;
}

// --- ствол на корпусе: пара параллельных краёв в яркости вдоль известной оси ---
function findBarrelRGB(Y, S, W, H, u, bodyW, opt) {
  const t0 = now(), n = [-u[1], u[0]];
  let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
  for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) if (S[i]) {
    const X = x + .5, Yy = y + .5, a = X * u[0] + Yy * u[1], b = X * n[0] + Yy * n[1];
    if (a < amin) amin = a; if (a > amax) amax = a; if (b < bmin) bmin = b; if (b > bmax) bmax = b;
  }
  const Na = Math.ceil(amax - amin) + 1, Nb = Math.ceil(bmax - bmin) + 1;
  const R = new Float32Array(Na * Nb), Rm = new Uint8Array(Na * Nb);
  for (let bi = 0; bi < Nb; bi++) for (let ai = 0; ai < Na; ai++) {
    const a = amin + ai, b = bmin + bi, x = a * u[0] + b * n[0] - .5, y = a * u[1] + b * n[1] - .5;
    const x0 = Math.floor(x), y0 = Math.floor(y); if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) continue;
    const i0 = y0 * W + x0; if (!(S[i0] && S[i0 + 1] && S[i0 + W] && S[i0 + W + 1])) continue;
    const fx = x - x0, fy = y - y0;
    R[bi * Na + ai] = (Y[i0] * (1 - fx) + Y[i0 + 1] * fx) * (1 - fy) + (Y[i0 + W] * (1 - fx) + Y[i0 + W + 1] * fx) * fy; Rm[bi * Na + ai] = 1;
  }
  // производная поперёк оси, усреднённая вдоль
  const Lw = Math.max(8, Math.round(opt.rgbWinFrac * bodyW)), M = new Float32Array(Na * Nb);
  const D = new Float32Array(Na), V = new Uint8Array(Na);
  for (let bi = 1; bi < Nb - 1; bi++) {
    let acc = 0, cnt = 0; const row = bi * Na; D.fill(0); V.fill(0);
    for (let ai = 0; ai < Na; ai++) if (Rm[row - Na + ai] && Rm[row + Na + ai]) { D[ai] = R[row + Na + ai] - R[row - Na + ai]; V[ai] = 1; }
    for (let ai = 0; ai < Na; ai++) {
      acc += D[ai]; cnt += V[ai];
      if (ai >= Lw) { acc -= D[ai - Lw]; cnt -= V[ai - Lw]; }
      const c = ai - (Lw >> 1); if (c >= 0) M[row + c] = cnt > .8 * Lw ? acc / cnt : 0;
    }
  }
  // пары краёв разного знака; ствол — на осевой корпуса (rgbBand поперёк силуэта, замер на 60 танках)
  const wMin = Math.max(4, Math.round(.012 * bodyW)), wMax = Math.round(.045 * bodyW), aFront = Math.round(.45 * (Na - 1));
  const best = [], band = opt.rgbBand || [0, 1], bL = band[0] * (Nb - 1), bH = band[1] * (Nb - 1);
  for (let w = wMin; w <= wMax; w++) for (let bi = Math.max(1, Math.ceil(bL - w / 2)); bi + w < Nb - 1 && bi + w / 2 <= bH; bi++) for (let ai = aFront; ai < Na; ai += 2) {
    const s1 = M[bi * Na + ai], s2 = M[(bi + w) * Na + ai]; if (s1 * s2 >= 0) continue;
    const sc = Math.min(Math.abs(s1), Math.abs(s2)); if (sc < opt.rgbMin) continue;
    best.push({ ai, bi, w, sc });
  }
  best.sort((p, q) => q.sc - p.sc);
  // тянем пару вдоль оси, пока держится; дуло — передний конец
  const ok = (bi, w, aa) => { let s1 = 0, s2 = 0, c = 0; const k = 5;
    for (let j = aa - k; j <= aa + k; j++) { if (j < 0 || j >= Na) continue; const p = bi * Na + j, q = (bi + w) * Na + j;
      if (!Rm[p - Na] || !Rm[p + Na] || !Rm[q - Na] || !Rm[q + Na]) continue; s1 += R[p + Na] - R[p - Na]; s2 += R[q + Na] - R[q - Na]; c++; }
    return c > k && s1 * s2 < 0 && Math.min(Math.abs(s1), Math.abs(s2)) / c > opt.rgbMin * .45; };
  const run = (bi, w, a0, sgn) => { let a = a0, miss = 0;
    while (a + sgn >= 0 && a + sgn < Na && miss < 4) { a += sgn; if (ok(bi, w, a)) miss = 0; else miss++; }
    return a - sgn * miss; };
  const cands = [];
  for (const c of best.slice(0, 80)) {
    if (cands.some(o => Math.abs(o.bi - c.bi) < 4 && Math.abs(o.w - c.w) < 4)) continue;
    const aEnd = run(c.bi, c.w, c.ai, +1), aBeg = run(c.bi, c.w, c.ai, -1), len = aEnd - aBeg;
    if (len < 3.5 * c.w) continue;
    cands.push({ ...c, aEnd, aBeg, len, score: c.sc * Math.sqrt(len) });
    if (cands.length >= 8) break;
  }
  cands.sort((p, q) => q.score - p.score);
  if (!cands.length) return { ok: false, ms: now() - t0 };
  const c = cands[0];
  // ширина — по внешним сильным краям (пара могла сесть на блик)
  const mid = c.bi + c.w / 2, half = Math.round(wMax / 2) + 2, prof = [];
  for (let o = -half; o <= half; o++) {
    const bi = Math.round(mid + o); let sAbs = 0, sSg = 0, k = 0;
    if (bi < 1 || bi >= Nb - 1) { prof.push({ o, a: 0, g: 0 }); continue; }
    for (let ai = c.aBeg; ai <= c.aEnd; ai++) { const p = bi * Na + ai; if (!Rm[p - Na] || !Rm[p + Na]) continue; const d = R[p + Na] - R[p - Na]; sAbs += Math.abs(d); sSg += d; k++; }
    prof.push({ o, a: k ? sAbs / k : 0, g: k ? sSg / k : 0 });
  }
  const side = sgn => {
    const pts = prof.filter(q => sgn * q.o >= c.w / 2 - 2);
    const peaks = pts.filter((q, i) => i > 0 && i < pts.length - 1 && Math.abs(q.g) >= Math.abs(pts[i - 1].g) && Math.abs(q.g) >= Math.abs(pts[i + 1].g));
    const mx = peaks.reduce((m, q) => Math.max(m, Math.abs(q.g)), 0);
    const strong = peaks.filter(q => Math.abs(q.g) >= opt.rgbEdgeRel * mx && Math.abs(q.g) >= opt.rgbMin * .6);
    return strong.length ? strong.reduce((b, q) => (sgn * q.o > sgn * b.o ? q : b)) : null;
  };
  const L = side(-1), Rr = side(+1);
  let w = c.w, cen = mid;
  if (L && Rr && Rr.o - L.o >= c.w && Rr.o - L.o <= wMax) { w = Rr.o - L.o; cen = mid + (L.o + Rr.o) / 2; }
  const bc = bmin + cen + .5, ae = amin + c.aEnd;
  return { ok: true, ms: now() - t0, tip: [ae * u[0] + bc * n[0], ae * u[1] + bc * n[1]], w, w0: c.w, len: c.len, score: c.score };
}
// поправка из FIX, затем кольца заново
function fixBarrel(b, f) {
  if (f.off) { b.ok = false; b.method = 'fallback'; return; }
  if (f.tip) { b.tip = f.tip.slice(); b.ok = true; b.method = 'fix'; }
  if (f.w) b.w = f.w;
  if (f.wMul) b.w *= f.wMul;
  const ex = b.extrap; layRings(b);
  if (b.method === 'rgb-edges') b.extrap = ex;
}

// --- разбор: F = {W, H, A альфа, Y яркость} → контур (px кадра от ox,oy) + ствол ---
function analyze(F, opt) {
  opt = Object.assign({}, OPT, opt);
  const T = {}; let t = now();
  const iso = opt.iso;
  let x0 = F.W, y0 = F.H, x1 = -1, y1 = -1;
  for (let y = 0; y < F.H; y++) { const r = y * F.W; for (let x = 0; x < F.W; x++) if (F.A[r + x] >= iso) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; } }
  if (x1 < 0 || (x1 - x0) * (y1 - y0) > .8 * F.W * F.H) return null; // нет силуэта или нет прозрачности
  const pad = 4; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(F.W - 1, x1 + pad); y1 = Math.min(F.H - 1, y1 + pad);
  const W = x1 - x0 + 1, H = y1 - y0 + 1, N = W * H, A = new Uint8ClampedArray(N);
  for (let y = 0; y < H; y++) A.set(F.A.subarray((y + y0) * F.W + x0, (y + y0) * F.W + x0 + W), y * W);
  const M = new Uint8Array(N); for (let i = 0; i < N; i++) M[i] = A[i] >= iso ? 1 : 0;
  let Yc = null;
  if (F.Y) { Yc = new Uint8ClampedArray(N); for (let y = 0; y < H; y++) Yc.set(F.Y.subarray((y + y0) * F.W + x0, (y + y0) * F.W + x0 + W), y * W); }
  // антенны и тросы — открытием; мелкие куски — прочь
  const bw = x1 - x0 + 1 - 2 * pad, hair = opt.hairFrac * bw;
  let S = M;
  if (hair >= .8) S = opening(M, W, H, hair).O;
  const lb = label(S, W, H), st = compStats(lb.L, lb.n, W, H);
  let mainA = 0; for (let k = 1; k <= lb.n; k++) mainA = Math.max(mainA, st[k].a);
  const S2 = new Uint8Array(N); for (let i = 0; i < N; i++) S2[i] = lb.L[i] && st[lb.L[i]].a >= .02 * mainA ? 1 : 0;
  S = fillHoles(S2, W, H, Math.round((opt.holeFillFrac * bw) ** 2)).S;
  T.mask = now() - t; t = now();
  const barrel = findBarrel(S, W, H, opt);
  if ((!barrel.ok || opt.rgbAlways) && Yc && opt.rgb) {
    const g = findBarrelRGB(Yc, S, W, H, opt.dir, barrel.bodyW, opt);
    barrel.rgb = g;
    if (g.ok && !barrel.ok) {
      Object.assign(barrel, { ok: true, method: 'rgb-edges', tip: g.tip, u: opt.dir.slice(), n: [-opt.dir[1], opt.dir[0]], w: g.w, brake: 0, len: g.len, profile: null,
        angle: Math.atan2(opt.dir[1], opt.dir[0]) * 180 / Math.PI });
      layRings(barrel); barrel.extrap = false;
    }
  }
  if (opt.fix) fixBarrel(barrel, opt.fix);
  if (barrel.ok && Yc && opt.overHull !== false) { gunOverHull(Yc, S, W, H, barrel); if (barrel.cor) layRings(barrel); }
  T.barrel = now() - t; t = now();
  let loops;
  if (opt.smoothFrac > 0) loops = marching(smoothMask(S, W, H, opt.smoothFrac * bw), W, H, 127.5);
  else {
    const dS = edt(S, W, H), A2 = new Uint8ClampedArray(N);
    for (let i = 0; i < N; i++) A2[i] = dS[i] <= 2.25 ? A[i] : 0;
    loops = marching(A2, W, H, iso);
  }
  T.march = now() - t; t = now();
  const rawPts = loops.reduce((s, l) => s + l.length, 0);
  const minA = Math.max(4, (opt.minHoleFrac * bw) ** 2);
  loops = loops.map(l => ({ l, a: area(l) })).filter(o => Math.abs(o.a) >= minA);
  const eps = opt.epsFrac * bw;
  const simp = loops.map(o => rdpClosed(o.l, eps)).filter(l => l.length >= 3);
  T.rdp = now() - t; t = now();
  let d = '', segs = 0, lines = 0;
  for (const l of simp) { const b = toBezier(l, opt.cornerDeg, opt.k, opt.dec); d += b.d; segs += b.segs; lines += b.lines; }
  T.bezier = now() - t;
  T.total = T.mask + T.barrel + T.march + T.rdp + T.bezier;
  return { W, H, ox: x0, oy: y0, bodyW: bw, d, loops: simp.length, rawPts, pts: simp.reduce((s, l) => s + l.length, 0), segs, lines, barrel, T, S, A };
}

// --- картинка ---
const tagKey = tag => String(tag || '').split(':').pop().toLowerCase(); // usa:A183_XM69_Hacker → a183_xm69_hacker
const LESTA = /^(ru|rpt|ct|pt_ru)$/i;
function imgUrl(tag, realm) {
  const k = tagKey(tag);
  return (LESTA.test(realm || '') ? 'https://tanki.su' : 'https://eu-wotp.wgcdn.co') + `/dcont/tankopedia_images/${k}/${k}_image.png`;
}
function fail(code, msg) { const e = new Error('[marks] ' + code + (msg ? ' ' + msg : '')); e.code = code; return e; }
function loadImg(url) { // CORS открыт; значок API 160×100 не берём никогда
  return new Promise((res, rej) => {
    const i = new Image(); let done = false;
    i.crossOrigin = 'anonymous'; i.decoding = 'async';
    i.onload = () => (i.decode ? i.decode().catch(() => {}) : Promise.resolve()).then(() => {
      if (!done) { done = true; i.naturalWidth ? res(i) : rej(fail('img', url)); } });
    i.onerror = () => { if (!done) { done = true; rej(fail('img', url)); } };
    i.src = url;
  });
}
function readField(img, scale = 1) {
  const W = Math.round((img.naturalWidth || img.width) * scale), H = Math.round((img.naturalHeight || img.height) * scale);
  const c = root.document ? root.document.createElement('canvas') : new OffscreenCanvas(W, H); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data;
  c.width = c.height = 0;
  const A = new Uint8ClampedArray(W * H), Y = new Uint8ClampedArray(W * H);
  for (let i = 0, j = 0; i < A.length; i++, j += 4) { A[i] = d[j + 3]; Y[i] = .299 * d[j] + .587 * d[j + 1] + .114 * d[j + 2]; }
  return { W, H, A, Y };
}

// --- кэш: путь + ствол, ≈5 КБ на танк, ≤ 40 танков ---
const r2 = v => Math.round(v * 100) / 100, r1 = v => Math.round(v * 10) / 10;
function pack(r, src, fx) {
  const b = r.barrel;
  return { v: VER, at: Date.now(), src: src || 'wg', fx: fx || '', W: r.W, H: r.H, ox: r.ox, oy: r.oy, bodyW: r.bodyW, d: r.d,
    b: { ok: !!b.ok, m: b.method, tip: b.tip.map(r2), u: b.u.map(v => Math.round(v * 1e5) / 1e5), ang: r2(b.angle), w: r2(b.w),
      brake: r1(b.brake || 0), len: r1(b.len || 0), gun: r1(b.gun || 0), need: r1(b.need || 0), extrap: !!b.extrap, rings: b.rings.map(g => ({ s: r2(g.s), w: r2(g.w), rw: r2(g.rw) })) } };
}
function memStore() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); },
    key: i => Array.from(m.keys())[i] ?? null, get length() { return m.size; } };
}
let ST = null; // null — localStorage
function store() { if (ST) return ST; try { if (root.localStorage) return root.localStorage; } catch (e) {} return (ST = memStore()); }
function keys() { const s = store(), out = []; try { for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k && k.startsWith(PFX)) out.push(k); } } catch (e) {} return out; }
function del(k) { try { store().removeItem(k); } catch (e) {} }
function atOf(k) { // «at» — второй ключ
  let v = null; try { v = store().getItem(k); } catch (e) {}
  const m = v && /^\{"v":\d+,"at":(\d+)/.exec(v); if (m) return +m[1];
  try { return (v && JSON.parse(v).at) || 0; } catch (e) { return 0; }
}
function dropOldest(keep) { const k = keys().filter(x => x !== keep).sort((a, b) => atOf(a) - atOf(b))[0]; if (k) del(k); return !!k; }
function write(k, e) { // места нет — выкинуть самый старый и ещё раз
  const v = JSON.stringify(e);
  for (let i = 0; i < 2; i++) { try { store().setItem(k, v); return true; } catch (x) { if (!i && dropOldest(k)) continue; return false; } }
  return false;
}
const fixFor = key => { for (const t in FIX) if (tagKey(t) === key) return FIX[t]; return null; };
const sigOf = key => { const f = fixFor(key); return f ? JSON.stringify(f) : ''; };
function get(key, src, fx) {
  let e = null; const k = PFX + key;
  try { const v = store().getItem(k); e = v ? JSON.parse(v) : null; } catch (x) { e = null; }
  if (!e || e.v !== VER || typeof e.d !== 'string' || !e.b || !Array.isArray(e.b.tip) || !Array.isArray(e.b.rings) || e.b.rings.length !== 3) return null;
  if ((src && e.src !== src) || (e.fx || '') !== (fx == null ? sigOf(key) : fx)) return null;
  if (Date.now() - (e.at || 0) > 12 * 3600e3) { e.at = Date.now(); write(k, e); }
  return e;
}
function put(key, e) {
  const k = PFX + key; e.at = Date.now();
  const ok = write(k, e), ks = keys();
  if (ks.length > MAXN) ks.filter(x => x !== k).map(x => [x, atOf(x)]).sort((a, b) => a[1] - b[1]).slice(0, ks.length - MAXN).forEach(([x]) => del(x));
  return ok;
}
const cache = {
  get: (tag, src, fx) => get(tagKey(tag), src, fx),
  put: (tag, e) => put(tagKey(tag), e),
  del: tag => del(PFX + tagKey(tag)),
  clear() { const ks = keys(); ks.forEach(del); return ks.length; },
  keys,
  use(s) { ST = s === 'memory' ? memStore() : s || null; }, // 'memory' | Storage | null
};

// --- вход: картинка + геометрия (из кэша — без разбора) ---
// o: realm | url | fresh | cache:false | opt, fix (свои — без кэша) | raw. Ошибки e.code: img, cors, empty
let LAST = null; // держим только последний танк
function trace(tag, o = {}) {
  const url = o.url || imgUrl(tag, o.realm), id = tagKey(tag) + '|' + url, own = o.opt || o.fix !== undefined; // свои параметры — мимо памяти и кэша
  if (!o.fresh && !own && LAST && LAST.id === id) return LAST.p;
  const p = run(tag, url, o, own);
  if (!own) { LAST = { id, p }; p.catch(() => { if (LAST && LAST.p === p) LAST = null; }); }
  return p;
}
async function run(tag, url, o, own) {
  const key = tagKey(tag), fix = o.fix !== undefined ? o.fix : fixFor(key), fx = fix ? JSON.stringify(fix) : '';
  const src = /tanki\.su/.test(url) ? 'lesta' : 'wg', useCache = o.cache !== false && !own;
  const ms = { cache: 0, load: 0, read: 0, analyze: 0 };
  let t = now(), sil = useCache && !o.fresh ? get(key, src, fx) : null, raw = null;
  ms.cache = now() - t; t = now();
  const img = await loadImg(url);
  ms.load = now() - t;
  if (!sil) {
    let F; t = now();
    try { F = readField(img, 1); } catch (e) { throw fail('cors', url); }
    ms.read = now() - t; t = now();
    raw = analyze(F, Object.assign({}, o.opt, { fix }));
    ms.analyze = now() - t;
    if (!raw) throw fail('empty', key);
    sil = pack(raw, src, fx);
    if (useCache) put(key, sil);
  }
  return { tag, key, url, img, sil, cached: !raw, ms, raw: o.raw ? raw : null };
}

root.MK = { VER, OPT, FIX, edt, opening, label, marching, area, rdpClosed, toBezier, findBarrel, findBarrelRGB, gunOverHull, layRings, analyze,
  tagKey, imgUrl, loadImg, readField, pack, trace, cache };
})(typeof self !== 'undefined' ? self : this);
