// Связь панели с игрой через мод WotStat «Виджеты» на этом компьютере (data-provider, ws://localhost:38200).
// Нужен один сигнал — полный итог боя (battle.onBattleResult): в нём статистика всех игроков боя,
// поэтому панель стримера может сразу засчитать и свой челлендж, и челленджи друзей из того же боя.
// Сети кроме localhost нет, в комнату отсюда ничего не пишется — итог записывает панель.
(function () {
  'use strict';
  window.WR = window.WR || {};

  const WS_URL = 'ws://localhost:38200';
  const num = x => (typeof x === 'number' && isFinite(x) ? x : null);

  // поле разницы статистики (как у WR.tracker) <- поля итога боя из игры (первое найденное)
  const MAP = {
    damage_dealt: ['damageDealt'], damage_received: ['damageReceived'], frags: ['kills'], spotted: ['spotted'],
    capture_points: ['capturePoints'], dropped_capture_points: ['droppedCapturePoints'],
    hits: ['directEnemyHits', 'directHits'], shots: ['shots'], piercings: ['piercingEnemyHits', 'piercings'],
    explosion_hits: ['explosionHits'], no_damage_direct_hits_received: ['noDamageDirectHitsReceived'],
    radio_assisted_damage: ['damageAssistedRadio'], track_assisted_damage: ['damageAssistedTrack'],
    stun_number: ['stunNum'], piercings_received: ['piercingsReceived'], stun_assisted_damage: ['damageAssistedStun'],
    blocked: ['damageBlockedByArmor'],
  };

  // Один танк в итоге боя -> статистика за этот бой в полях WR.tracker. Чего игра не прислала — того поля нет.
  // Опыт — subtotalXP: базовый с премиум-множителем, ровно так его считает статистика танка у WG (проверено на бою:
  // originalXP 1294 × 1,5 = 1941 = прирост xp в WG API). Он есть только у себя (раздел personal); у друзей в итоге
  // лишь базовый опыт без их премиума — их опыт по-прежнему проверяет WG API.
  // Медали — номера записей досье, названия как у WG API (WR.catalog.achNames): свои и чужие из того же боя.
  function deltaOf(v, winnerTeam) {
    if (!v || typeof v !== 'object') return null;
    const d = { battles: 1 };
    for (const k in MAP) {
      for (const src of MAP[k]) { const x = num(v[src]); if (x != null) { d[k] = x; break; } }
    }
    const team = num(v.team), win = num(winnerTeam);
    if (team != null && win != null) d.wins = win !== 0 && win === team ? 1 : 0;
    const death = num(v.deathReason);
    if (death != null) d.survived_battles = death < 0 ? 1 : 0;
    const xp = num(v.subtotalXP);
    if (xp != null) d.xp = xp;
    if (Array.isArray(v.achievements) && WR.catalog && typeof WR.catalog.achNames === 'function') d.achievements = WR.catalog.achNames(v.achievements);
    return d;
  }

  // Итог боя из игры -> { arena, startedAt (мс, часы сервера WG; 0 — неизвестно), bonusType, entries: [{ acc, tankId, own, delta }] }
  // own — это сам игрок (раздел personal, цифры полные); остальные — из раздела vehicles (статистика всех участников боя).
  function parseResult(raw, ownAcc) {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw.personal ? raw : raw.data && typeof raw.data === 'object' && raw.data.personal ? raw.data : null;
    if (!r || !r.personal || typeof r.personal !== 'object') return null;
    const common = r.common && typeof r.common === 'object' ? r.common : {};
    const win = num(common.winnerTeam);
    const created = num(common.arenaCreateTime);
    const out = {
      arena: r.arenaUniqueID != null ? String(r.arenaUniqueID) : '',
      startedAt: created != null && created > 1e9 ? Math.round(created * 1000) : 0,
      bonusType: num(common.bonusType),
      entries: [],
    };
    const seen = new Set(), dup = new Set();
    const add = (acc, tankId, v, own, team) => {
      acc = acc != null ? String(acc) : '';
      const tid = Number(tankId);
      if (!/^\d+$/.test(acc) || !Number.isInteger(tid) || tid <= 0) return;
      const src = team != null && num(v.team) == null ? Object.assign({}, v, { team }) : v;
      const delta = deltaOf(src, win);
      if (!delta) return;
      const key = acc + ':' + tid;
      if (seen.has(key)) return; // свои цифры из personal уже есть
      // несколько танков у одного игрока за бой (режимы с возрождением) — не обычный бой, не засчитываем
      if (out.entries.some(e => e.acc === acc)) { dup.add(acc); return; }
      seen.add(key);
      out.entries.push({ acc, tankId: tid, own: !!own, delta });
    };
    const avatar = r.personal.avatar && typeof r.personal.avatar === 'object' ? r.personal.avatar : {};
    const mine = Object.keys(r.personal).filter(k => k !== 'avatar' && r.personal[k] && typeof r.personal[k] === 'object');
    for (const k of mine) {
      const p = r.personal[k];
      add(p.accountDBID != null ? p.accountDBID : avatar.accountDBID != null ? avatar.accountDBID : ownAcc,
        p.typeCompDescr != null ? p.typeCompDescr : k, p, true, num(avatar.team));
    }
    const vehicles = r.vehicles && typeof r.vehicles === 'object' ? r.vehicles : {};
    for (const id of Object.keys(vehicles)) {
      const list = Array.isArray(vehicles[id]) ? vehicles[id] : [vehicles[id]];
      if (list.length > 1) { for (const v of list) if (v && v.accountDBID != null) dup.add(String(v.accountDBID)); continue; }
      const v = list[0];
      if (v && typeof v === 'object') add(v.accountDBID, v.typeCompDescr, v, false, null);
    }
    if (mine.length > 1) for (const k of mine) { const p = r.personal[k]; dup.add(String(p.accountDBID != null ? p.accountDBID : ownAcc)); }
    out.entries = out.entries.filter(e => !dup.has(e.acc));
    return out;
  }

  // ---- соединение ----
  let ws = null, timer = 0, wait = 2000, want = false, on = false;
  let cb = { onStatus: null, onResult: null };
  const st = new Map();      // состояние игры: путь -> значение (только нужные пути)
  const battles = new Map(); // arenaId -> когда эта страница увидела начало боя (Date.now())
  const KEEP = new Set(['player.id', 'battle.isInBattle', 'battle.arenaId']);

  function status() {
    const pid = st.get('player.id');
    return { want, on, pid: pid != null && pid !== '' ? String(pid) : '', inBattle: on && st.get('battle.isInBattle') === true };
  }
  function tell() { if (cb.onStatus) { try { cb.onStatus(status()); } catch (e) { console.error(e); } } }
  function noteBattle() {
    const a = st.get('battle.arenaId');
    if (st.get('battle.isInBattle') === true && a != null && a !== '' && !battles.has(String(a))) {
      battles.set(String(a), Date.now());
      if (battles.size > 30) battles.delete(battles.keys().next().value);
    }
  }
  function onMsg(m) {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'init' && Array.isArray(m.states)) {
      st.clear();
      m.states.forEach(s => { if (s && KEEP.has(s.path)) st.set(s.path, s.value); });
      on = true; noteBattle(); tell();
    } else if (m.type === 'state' && KEEP.has(m.path)) {
      st.set(m.path, m.value); noteBattle(); tell();
    } else if (m.type === 'trigger' && m.path === 'battle.onBattleResult') {
      const res = parseResult(m.value, status().pid);
      if (!res) return;
      res.seenAt = battles.get(res.arena) || 0; // запасной способ узнать, когда начался бой
      if (cb.onResult) { try { cb.onResult(res); } catch (e) { console.error(e); } }
    }
  }
  function open() {
    clearTimeout(timer); timer = 0;
    if (!want || ws) return;
    let s;
    try { s = new WebSocket(WS_URL); } catch (e) { timer = setTimeout(open, wait); return; }
    ws = s;
    s.onopen = () => { wait = 2000; };
    s.onmessage = ev => { let m = null; try { m = JSON.parse(ev.data); } catch (e) {} if (m && ws === s) onMsg(m); };
    s.onclose = () => {
      if (ws !== s) return;
      ws = null;
      if (on) { on = false; st.clear(); tell(); }
      if (want) { timer = setTimeout(open, wait); wait = Math.min(20000, Math.round(wait * 1.6)); }
    };
  }
  // handlers: { onStatus({ want, on, pid, inBattle }), onResult(итог боя из parseResult + seenAt) }
  function start(handlers) {
    cb = Object.assign({ onStatus: null, onResult: null }, handlers || {});
    want = true; wait = 2000;
    open(); tell();
  }
  function stop() {
    want = false;
    clearTimeout(timer); timer = 0;
    const s = ws;
    ws = null; on = false; st.clear();
    if (s) { try { s.close(); } catch (e) {} }
    tell();
  }

  // _msg — для проверочной страницы: подать сообщение так, как его прислала бы игра
  WR.game = { start, stop, status, parseResult, deltaOf, _msg: onMsg };
})();
