// Слепки статистики танка (WG API tanks/stats) и сравнение после боя.
(function () {
  'use strict';
  window.WR = window.WR || {};

  const FIELDS = [
    'battles', 'wins', 'survived_battles', 'damage_dealt', 'damage_received', 'frags', 'spotted', 'xp',
    'capture_points', 'dropped_capture_points', 'hits', 'shots', 'piercings', 'explosion_hits',
    'no_damage_direct_hits_received', 'radio_assisted_damage', 'track_assisted_damage', 'stun_number',
    'avg_damage_blocked', 'piercings_received', 'stun_assisted_damage',
  ];
  const STATS_FIELDS = 'tank_id,' + FIELDS.map(f => 'all.' + f).join(',');
  const DEFAULT_APP = '1e984dbbdf7b1c1fbd284d4cadc0b17f';

  const ERRORS = {
    INVALID_APPLICATION_ID: 'Неверный Application ID',
    APPLICATION_IS_BLOCKED: 'Application ID заблокирован',
    INVALID_IP_ADDRESS: 'Application ID не разрешён для этого адреса',
    REQUEST_LIMIT_EXCEEDED: 'Слишком много запросов к WG API, попробую позже',
    SOURCE_NOT_AVAILABLE: 'WG API временно недоступен',
    ACCOUNT_ID_NOT_SPECIFIED: 'Не указан ID аккаунта',
    INVALID_ACCOUNT_ID: 'Неверный ID аккаунта',
    INVALID_TANK_ID: 'Неверный ID танка',
    INVALID_FIELDS: 'Неверный список полей запроса',
    ACCOUNT_ID_LIST_LIMIT_EXCEEDED: 'Слишком много аккаунтов в одном запросе',
    TANK_ID_LIST_LIMIT_EXCEEDED: 'Слишком много танков в одном запросе',
  };

  async function api(apiBase, appId, method, q) {
    if (!apiBase) throw new Error('Не указан адрес WG API (регион)');
    let u;
    try { u = new URL(`${String(apiBase).replace(/\/+$/, '')}/wot/${method}/`); }
    catch (e) { throw new Error('Неверный адрес WG API: ' + apiBase); }
    u.searchParams.set('application_id', String(appId || DEFAULT_APP).trim());
    for (const [k, v] of Object.entries(q)) if (v != null) u.searchParams.set(k, v);
    let r, j;
    try { r = await fetch(u, { cache: 'no-store' }); }
    catch (e) { throw new Error('Нет связи с WG API'); }
    if (!r.ok) throw new Error(`WG API ответил ошибкой HTTP ${r.status}`);
    try { j = await r.json(); }
    catch (e) { throw new Error('WG API вернул непонятный ответ'); }
    if (!j || j.status !== 'ok') {
      const e = (j && j.error) || {};
      const msg = ERRORS[e.message] || `Ошибка WG API: ${e.message || 'неизвестная'}${e.field ? ` (${e.field})` : ''}`;
      const err = new Error(msg);
      err.code = e.message || 'UNKNOWN';
      throw err;
    }
    return j.data || {};
  }

  const num = x => (typeof x === 'number' && isFinite(x) ? x : 0);

  // Числа из раздела all; танка нет в ответе — все нули
  function pickStats(all) {
    const s = {};
    for (const f of FIELDS) s[f] = num(all && all[f]);
    s.blocked = Math.round(s.avg_damage_blocked * s.battles);
    return s;
  }

  function pickAch(a) {
    const out = {};
    for (const [k, v] of Object.entries(a || {})) if (typeof v === 'number') out[k] = v;
    return out;
  }

  // Разница: числовые поля (кроме среднего avg_damage_blocked) и achievements — только ненулевые
  function diff(snapStats, curStats, snapAch, curAch) {
    const a = snapStats || {}, b = curStats || {};
    const delta = {};
    const keys = new Set(Object.keys(a).concat(Object.keys(b)));
    for (const k of keys) {
      if (k === 'avg_damage_blocked') continue;
      // поля нет в слепке (спин сделан до того, как трекер стал его снимать) — разницу не выдумываем
      if (typeof a[k] !== 'number' || typeof b[k] !== 'number') continue;
      delta[k] = num(b[k]) - num(a[k]);
    }
    if (snapAch || curAch) {
      const sa = snapAch || {}, ca = curAch || {};
      const ach = {};
      for (const k of new Set(Object.keys(sa).concat(Object.keys(ca)))) {
        const d = num(ca[k]) - num(sa[k]);
        if (d) ach[k] = d;
      }
      delta.achievements = ach;
    }
    return delta;
  }

  const accKey = id => String(id).trim();

  function checkAccount(accountId) {
    if (accountId == null || !/^\d+$/.test(accKey(accountId))) throw new Error('Неверный ID аккаунта');
    return accKey(accountId);
  }

  async function lastBattleOf(apiBase, appId, acc) {
    const info = await api(apiBase, appId, 'account/info', { account_id: acc, fields: 'last_battle_time' });
    const a = info[acc];
    if (!a) throw new Error('Аккаунт не найден в этом регионе');
    return num(a.last_battle_time);
  }

  // tank_id -> stats, кусками по 100
  async function statsMap(apiBase, appId, acc, tankIds) {
    const map = {};
    for (let i = 0; i < tankIds.length; i += 100) {
      const data = await api(apiBase, appId, 'tanks/stats', {
        account_id: acc, tank_id: tankIds.slice(i, i + 100).join(','), fields: STATS_FIELDS,
      });
      for (const t of data[acc] || []) map[t.tank_id] = pickStats(t.all);
    }
    return map;
  }

  async function achMap(apiBase, appId, acc, tankIds) {
    const map = {};
    for (let i = 0; i < tankIds.length; i += 100) {
      const data = await api(apiBase, appId, 'tanks/achievements', {
        account_id: acc, tank_id: tankIds.slice(i, i + 100).join(','), fields: 'tank_id,achievements',
      });
      for (const t of data[acc] || []) map[t.tank_id] = pickAch(t.achievements);
    }
    return map;
  }

  const tankNum = id => {
    const n = Number(id);
    return Number.isInteger(n) && n > 0 ? n : null;
  };

  // achTaken — метка, что медали в слепке есть, даже если их ноль (Firebase выкидывает пустой объект)
  function makeSnap(takenAt, lastBattle, stats, ach) {
    const s = { takenAt, lastBattle, stats };
    if (ach) { s.achievements = ach; s.achTaken = true; }
    return s;
  }

  async function snapshot({ apiBase, appId, accountId, tankId, withAchievements }) {
    const acc = checkAccount(accountId);
    const tid = tankNum(tankId);
    if (!tid) throw new Error('Неверный ID танка');
    const [lastBattle, stats, achs] = await Promise.all([
      lastBattleOf(apiBase, appId, acc),
      statsMap(apiBase, appId, acc, [tid]),
      withAchievements ? achMap(apiBase, appId, acc, [tid]) : null,
    ]);
    return makeSnap(Date.now(), lastBattle, stats[tid] || pickStats(null), achs ? achs[tid] || {} : null);
  }

  // Медали из слепка: объект, {} если сняты, но пусто; null — в слепке их не снимали
  const snapAch = s => (s.achievements ? s.achievements : s.achTaken ? {} : null);

  function judge(it, cur, curAch, lastBattle, takenAt) {
    const snap = it.snapshot;
    const spunAt = Number(it.spunAt);
    if (!isFinite(spunAt) || spunAt <= 0) return { state: 'error', error: 'Нет времени спина' };
    const fresh = () => makeSnap(takenAt, lastBattle, cur, it.withAchievements ? curAch : null);
    const base = it.withAchievements ? snapAch(snap) : null;
    const db = cur.battles - num(snap.stats.battles);
    if (db <= 0) {
      // Слепок без медалей, а они нужны — боёв не было, можно спокойно заменить
      return it.withAchievements && !base ? { state: 'rebaseline', snapshot: fresh() } : { state: 'waiting' };
    }
    // Время последнего боя из профиля аккаунта здесь не используем: WG обновляет профиль позже статистики
    // танка (бывает, на минуты), и настоящий бой после спина выглядел бы «боем до спина» и терялся.
    // Слепок снят в момент спина, поэтому новый бой на этом танке считаем сыгранным после спина.
    const delta = diff(snap.stats, cur, base, it.withAchievements ? curAch : null);
    if (it.withAchievements && !base) return { state: 'ambiguous', delta };
    return { state: db === 1 ? 'done' : 'ambiguous', delta };
  }

  // items: [{ key, tankId, snapshot, spunAt, withAchievements }] -> { [key]: { state, delta?, snapshot?, error? } }
  // Бросает только при сбое запроса целиком; ошибки отдельного пункта — state: 'error'
  async function check({ apiBase, appId, accountId, items }) {
    const acc = checkAccount(accountId);
    const res = {};
    const valid = [];
    for (const it of Array.isArray(items) ? items : []) {
      if (!it || it.key == null) continue;
      const key = String(it.key);
      const tid = tankNum(it.tankId);
      if (!tid) { res[key] = { state: 'error', error: 'Неверный ID танка' }; continue; }
      if (!it.snapshot || !it.snapshot.stats) { res[key] = { state: 'error', error: 'Нет слепка статистики' }; continue; }
      valid.push({ it, key, tid });
    }
    if (!valid.length) return res;

    const ids = [...new Set(valid.map(v => v.tid))];
    // Медали — только для танков, которым они нужны
    const achIds = [...new Set(valid.filter(v => v.it.withAchievements).map(v => v.tid))];
    const [lastBattle, stats, achs] = await Promise.all([
      lastBattleOf(apiBase, appId, acc),
      statsMap(apiBase, appId, acc, ids),
      achIds.length ? achMap(apiBase, appId, acc, achIds) : null,
    ]);
    const takenAt = Date.now();

    for (const { it, key, tid } of valid) {
      try {
        const cur = stats[tid] || pickStats(null);
        const curAch = achs ? achs[tid] || {} : {};
        res[key] = judge(it, cur, curAch, lastBattle, takenAt);
      } catch (e) {
        res[key] = { state: 'error', error: 'Не удалось проверить: ' + (e && e.message || e) };
      }
    }
    return res;
  }

  // Список танков аккаунта (для страниц проверки): [{ tank_id, battles }]
  async function accountTanks({ apiBase, appId, accountId }) {
    const acc = checkAccount(accountId);
    const data = await api(apiBase, appId, 'account/tanks', { account_id: acc, fields: 'tank_id,statistics.battles' });
    if (!data[acc]) throw new Error('Нет данных — профиль скрыт или аккаунт пустой');
    return data[acc].map(t => ({ tank_id: t.tank_id, battles: num(t.statistics && t.statistics.battles) }));
  }

  // Ник -> { account_id, nickname }
  async function findAccount({ apiBase, appId, nick }) {
    const q = String(nick || '').trim();
    if (!q) throw new Error('Введи ник');
    const list = await api(apiBase, appId, 'account/list', { search: q, type: 'exact' });
    if (!list || !list.length) throw new Error('Игрок не найден в этом регионе');
    return list[0];
  }

  // judge и pickStats — для симуляции на dev-странице
  WR.tracker = { FIELDS, snapshot, check, diff, api, accountTanks, findAccount, judge, pickStats };
})();
