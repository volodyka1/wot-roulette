// Комнаты для игры с друзьями: Firebase Realtime Database + анонимный вход.
//
// Перед этим файлом страница подключает Firebase compat SDK 10.14.1 (аналитику не подключаем):
//   <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"></script>
//   <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js"></script>
//   <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-database-compat.js"></script>
//   <script src="js/room.js"></script>
// Сам SDK этот файл не грузит. Если приложение Firebase уже создано — используется оно.
//
// Все методы, кроме serverNow() и links(), сами вызывают init().
// Ошибки — Error с русским сообщением; e.code — исходный код Firebase ('PERMISSION_DENIED', 'auth/...', 'TIMEOUT').
(function () {
  'use strict';
  window.WR = window.WR || {};

  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyA2QzcnPMFE5GBiIItm1M1L0trRimFsfu8',
    authDomain: 'wotbase-311fc.firebaseapp.com',
    databaseURL: 'https://wotbase-311fc-default-rtdb.europe-west1.firebasedatabase.app',
    projectId: 'wotbase-311fc',
    storageBucket: 'wotbase-311fc.firebasestorage.app',
    messagingSenderId: '259612791074',
    appId: '1:259612791074:web:2fbcb943094e8c30be957b',
  };
  const REGIONS = ['eu', 'na', 'asia'];
  const STATUSES = ['pending', 'ok', 'fail', 'ambiguous', 'cancelled'];
  const TIMEOUT = 15000;
  const RULES_HINT = 'Проверь, что правила из database.rules.json вставлены в консоль Firebase (Realtime Database → Правила → Опубликовать).';

  let initP = null, db = null, auth = null, uid = null, offset = 0;

  // ---------- мелочи ----------
  const S = v => String(v == null ? '' : v).trim();
  // убирает undefined (Firebase их не принимает); ServerValue.TIMESTAMP — обычный объект и переживает JSON
  const clean = o => o == null ? null : JSON.parse(JSON.stringify(o));
  const TS = () => firebase.database.ServerValue.TIMESTAMP;

  function rand(n, chars) {
    const lim = 256 - (256 % chars.length);
    let out = '';
    while (out.length < n) {
      const buf = crypto.getRandomValues(new Uint8Array(n * 2));
      for (const b of buf) if (b < lim && out.length < n) out += chars[b % chars.length];
    }
    return out;
  }
  const newRoomId = () => rand(10, 'abcdefghijklmnopqrstuvwxyz0123456789');
  const newKey = () => rand(24, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');

  function checkRoomId(roomId) {
    roomId = S(roomId).toLowerCase();
    if (!/^[a-z0-9]{10}$/.test(roomId)) throw rErr('Неверный код комнаты — нужно 10 латинских букв и цифр', 'BAD_ROOM');
    return roomId;
  }
  function checkAcc(acc) {
    acc = S(acc);
    if (!/^\d{1,12}$/.test(acc)) throw rErr('Неверный account_id игрока — нужно число', 'BAD_ACC');
    return acc;
  }
  function checkNick(nick) {
    nick = S(nick);
    if (!nick) throw rErr('Не указан ник', 'BAD_NICK');
    return nick.slice(0, 40);
  }

  function rErr(msg, code, original) {
    const e = new Error(msg);
    e.code = code || 'ROOM';
    e.wr = true;
    if (original) e.original = original;
    return e;
  }

  // Ошибку Firebase -> понятное русское сообщение. denied — текст на случай отказа правил.
  function translate(e, denied) {
    if (e && e.wr) return e; // уже наша
    const code = (e && e.code) || '';
    const msg = (e && e.message) || String(e);
    if (code === 'PERMISSION_DENIED' || /permission[_ ]denied/i.test(msg))
      return rErr((denied || 'Нет прав на это действие.') + ' (PERMISSION_DENIED)', 'PERMISSION_DENIED', e);
    if (code === 'auth/network-request-failed' || code === 'TIMEOUT' || /network|offline|failed to fetch/i.test(msg))
      return rErr('Нет связи с Firebase — проверь интернет и попробуй ещё раз', code || 'NETWORK', e);
    if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation')
      return rErr('Анонимный вход выключен в консоли Firebase (Authentication → Sign-in method → Anonymous)', code, e);
    if (code === 'auth/too-many-requests')
      return rErr('Слишком много попыток входа — подожди пару минут', code, e);
    if (/^auth\//.test(code))
      return rErr('Ошибка входа в Firebase: ' + msg, code, e);
    if (/max.?retr|disconnect/i.test(msg))
      return rErr('Запись не прошла: связь с базой обрывалась — попробуй ещё раз', 'NETWORK', e);
    return rErr('Ошибка базы: ' + msg, code || 'ROOM', e);
  }

  // Записи в Realtime Database без связи висят вечно — ограничим ожидание.
  function withTimeout(p, ms) {
    let t;
    const to = new Promise((_, rej) => {
      t = setTimeout(() => rej(rErr('Нет ответа от Firebase за ' + Math.round((ms || TIMEOUT) / 1000) + ' с — проверь интернет. Если связь есть, запись уйдёт, когда база ответит', 'TIMEOUT')), ms || TIMEOUT);
    });
    return Promise.race([p, to]).finally(() => clearTimeout(t));
  }

  // Отказ правил -> сначала проверим, вставлены ли правила вообще, чтобы не путать «нет прав» и «нет правил».
  async function explain(e, denied) {
    const t = translate(e, denied);
    if (t.code !== 'PERMISSION_DENIED') return t;
    const d = await diagnose().catch(() => null);
    return d && d.ok === false ? rErr(d.text, 'RULES_MISSING', e) : t;
  }

  // обёртка операции: init, таймаут, перевод ошибок
  async function op(fn, denied) {
    await init();
    try { return await withTimeout(Promise.resolve().then(fn)); }
    catch (e) { throw await explain(e, denied); }
  }

  const ref = p => db.ref(p);
  const roomRef = (roomId, p) => db.ref('rooms/' + roomId + (p ? '/' + p : ''));

  // ---------- вход ----------
  function init() {
    if (initP) return initP;
    initP = (async () => {
      const fb = window.firebase;
      if (!fb || !fb.initializeApp) throw rErr('Firebase SDK не загружен — подключи firebase-app-compat.js, firebase-auth-compat.js и firebase-database-compat.js перед room.js', 'NO_SDK');
      if (!fb.auth || !fb.database) throw rErr('Не хватает firebase-auth-compat.js или firebase-database-compat.js', 'NO_SDK');
      const app = fb.apps.find(a => a.name === '[DEFAULT]') || fb.initializeApp(FIREBASE_CONFIG);
      auth = app.auth();
      db = app.database();
      // ждём, пока SDK восстановит прошлый вход: тот же uid после перезагрузки страницы
      let user = await new Promise(res => {
        let off = null, got = false;
        off = auth.onAuthStateChanged(u => { if (got) return; got = true; res(u); setTimeout(() => off && off()); });
      });
      if (!user) user = (await withTimeout(auth.signInAnonymously())).user;
      uid = user.uid;
      auth.onAuthStateChanged(u => { if (u) uid = u.uid; });
      await new Promise(res => db.ref('.info/serverTimeOffset').on('value', s => { offset = s.val() || 0; res(); }));
      return { uid };
    })().catch(e => { initP = null; throw translate(e); }); // после сбоя можно вызвать init() ещё раз
    return initP;
  }

  const serverNow = () => Date.now() + offset;

  // Вставлены ли правила: комнаты читает любой, ключи — никто.
  let rulesOk = false;
  async function diagnose() {
    await init();
    if (rulesOk) return { ok: true, text: 'Правила на месте: комнаты читаются, ключи закрыты' };
    const probe = async p => {
      try { await withTimeout(db.ref(p).get(), 8000); return 'ok'; }
      catch (e) { return /permission/i.test((e.code || '') + ' ' + e.message) ? 'denied' : 'error'; }
    };
    const rooms = await probe('rooms/zzzzzzzzzz/meta');
    const secrets = await probe('secrets/zzzzzzzzzz');
    if (rooms === 'error' || secrets === 'error') return { ok: null, text: 'Не удалось проверить правила — нет связи с базой' };
    if (rooms === 'denied') return { ok: false, text: 'Правила комнат не вставлены: база закрыта (правила по умолчанию). ' + RULES_HINT };
    if (secrets === 'ok') return { ok: false, text: 'База открыта всем (тестовый режим), ключи владельца не защищены. ' + RULES_HINT };
    rulesOk = true;
    return { ok: true, text: 'Правила на месте: комнаты читаются, ключи закрыты' };
  }

  // ---------- комната и владелец ----------
  async function create(opts) {
    opts = opts || {};
    const owner = opts.owner || {};
    const acc = checkAcc(owner.acc), nick = checkNick(owner.nick);
    const region = REGIONS.includes(opts.region) ? opts.region : 'eu';
    const title = S(opts.title).slice(0, 80) || 'Комната ' + nick;
    const roomId = newRoomId(), key = newKey();
    // порядок важен для правил: ключ -> заявка владельца -> всё остальное
    await op(() => ref('secrets/' + roomId).set(key), 'Не удалось сохранить ключ комнаты.');
    await op(() => ref('claims/' + roomId + '/' + uid).set(key), 'Не удалось записать права владельца.');
    const upd = {
      meta: { title, region, maxActive: 3, friendRerolls: 1, createdAt: TS() },
    };
    upd['whitelist/' + acc] = { nick, addedAt: TS() };
    upd['players/' + acc] = { uid, nick, region, joinedAt: TS(), owner: true };
    await op(() => roomRef(roomId).update(upd), 'Не удалось записать настройки комнаты.');
    return { roomId, key };
  }

  // true — ключ верный и права владельца получены, false — ключ не подошёл
  async function claimOwner(roomId, key) {
    roomId = checkRoomId(roomId);
    key = S(key);
    if (!key) return false;
    try {
      await op(() => ref('claims/' + roomId + '/' + uid).set(key));
      return true;
    } catch (e) {
      if (e.code === 'PERMISSION_DENIED') return false;
      throw e;
    }
  }

  async function addToWhitelist(roomId, p) {
    roomId = checkRoomId(roomId);
    p = p || {};
    const acc = checkAcc(p.acc), nick = checkNick(p.nick);
    await op(() => roomRef(roomId, 'whitelist/' + acc).set({ nick, addedAt: TS() }),
      'Менять список игроков может только владелец комнаты.');
  }

  // Убирает ник из списка и отвязывает его игрока: после этого друг не сможет публиковать спины,
  // а добавленный заново — сможет привязаться с нового устройства.
  async function removeFromWhitelist(roomId, acc) {
    roomId = checkRoomId(roomId);
    acc = checkAcc(acc);
    const pl = await op(() => roomRef(roomId, 'players/' + acc).get());
    if (pl.exists() && pl.child('owner').val() === true) throw rErr('Владельца комнаты нельзя убрать из списка', 'OWNER');
    const upd = {};
    upd['whitelist/' + acc] = null;
    upd['players/' + acc] = null;
    await op(() => roomRef(roomId).update(upd), 'Менять список игроков может только владелец комнаты.');
  }

  // ---------- игроки ----------
  async function join(roomId, p) {
    roomId = checkRoomId(roomId);
    p = p || {};
    const acc = checkAcc(p.acc), nick = checkNick(p.nick);
    const meta = await op(() => roomRef(roomId, 'meta').get(), 'Не удалось прочитать комнату.');
    if (!meta.exists()) throw rErr('Комната не найдена — проверь ссылку', 'NO_ROOM');
    const wl = await op(() => roomRef(roomId, 'whitelist/' + acc).get(), 'Не удалось прочитать список игроков.');
    if (!wl.exists()) throw rErr('Тебя нет в списке игроков этой комнаты — попроси стримера добавить твой ник', 'NOT_WHITELISTED');
    const old = (await op(() => roomRef(roomId, 'players/' + acc).get())).val();
    const owner = !!(old && old.owner === true);
    const taken = 'Этот ник уже привязан к другому устройству или браузеру — попроси стримера убрать тебя из списка и добавить снова';
    if (old && old.uid !== uid && !owner) throw rErr(taken, 'TAKEN');
    const same = old && old.uid === uid;
    const player = {
      uid,
      nick: wl.child('nick').val() || nick,
      region: REGIONS.includes(p.region) ? p.region : (old && old.region) || meta.child('region').val() || 'eu',
      joinedAt: (same && old.joinedAt) || TS(),
      owner,
    };
    try {
      await op(() => roomRef(roomId, 'players/' + acc).set(player));
    } catch (e) {
      if (e.code !== 'PERMISSION_DENIED') throw e;
      if (owner) throw rErr('Это ник владельца комнаты — открой админ-ссылку с ключом', 'OWNER_ONLY', e.original || e);
      throw rErr('База не пустила в комнату (PERMISSION_DENIED) — возможно, стример только что убрал тебя из списка', 'PERMISSION_DENIED', e.original || e);
    }
    return { acc, nick: player.nick, owner };
  }

  // ---------- спины ----------
  function checkSpinId(id) {
    id = S(id);
    if (!id || /[.#$\[\]\/]/.test(id)) throw rErr('Неверный id спина', 'BAD_SPIN');
    return id;
  }

  async function publishSpin(roomId, spin) {
    roomId = checkRoomId(roomId);
    if (!spin || typeof spin !== 'object') throw rErr('Пустой спин', 'BAD_SPIN');
    const data = clean(spin);
    delete data.id;
    data.acc = checkAcc(data.acc);
    if (data.status == null) data.status = 'pending'; // иначе resolveSpin его никогда не закроет
    if (!STATUSES.includes(data.status)) throw rErr('Неверный статус спина: ' + data.status, 'BAD_STATUS');
    data.ts = TS();
    const r = roomRef(roomId, 'spins').push();
    await op(() => r.set(data), 'Публиковать спины может только игрок из списка, вошедший в комнату, или владелец.');
    return r.key;
  }

  async function updateSpin(roomId, spinId, patch) {
    roomId = checkRoomId(roomId);
    spinId = checkSpinId(spinId);
    const data = clean(patch) || {};
    delete data.id;
    if ('acc' in data) data.acc = checkAcc(data.acc);
    if (data.status != null && !STATUSES.includes(data.status)) throw rErr('Неверный статус спина: ' + data.status, 'BAD_STATUS');
    if (!Object.keys(data).length) return;
    await op(() => roomRef(roomId, 'spins/' + spinId).update(data), 'Менять чужие спины может только владелец комнаты.');
  }

  // Итог спина транзакцией: пишет, только если статус ещё 'pending' (force — ручное решение владельца).
  // -> { committed, spin } ; committed: false — итог уже записал кто-то другой, spin — то, что сейчас в базе.
  async function resolveSpin(roomId, spinId, res, opts) {
    roomId = checkRoomId(roomId);
    spinId = checkSpinId(spinId);
    res = res || {};
    const force = !!(opts && opts.force);
    if (!STATUSES.includes(res.status)) throw rErr('Неверный итог спина: ' + res.status, 'BAD_STATUS');
    const result = clean(res.result);
    if (result && result.checkedAt == null) result.checkedAt = serverNow();
    const r = roomRef(roomId, 'spins/' + spinId);
    const snap = await op(() => r.get(), 'Не удалось прочитать спин.');
    if (!snap.exists()) throw rErr('Спин не найден — возможно, его удалили', 'NO_SPIN');
    const tx = await op(() => r.transaction(cur => {
      // нет локальной копии — вернём как есть, сервер пришлёт настоящее значение и функция вызовется снова
      if (cur === null) return null;
      if (!force && cur.status !== 'pending') return; // отмена: итог уже есть
      const next = Object.assign({}, cur, { status: res.status });
      if (result) next.result = result; else delete next.result;
      return next;
    }, undefined, false), 'Записать итог чужого спина может только владелец комнаты.');
    const s = tx.snapshot;
    // спин удалили между чтением и транзакцией: «записали» пустоту
    if (tx.committed && !(s && s.exists())) throw rErr('Спин не найден — возможно, его удалили', 'NO_SPIN');
    return { committed: !!tx.committed, spin: s && s.exists() ? Object.assign({ id: s.key }, s.val()) : null };
  }

  // ---------- подписки ----------
  function report(onErr, e) {
    if (onErr) onErr(e); else console.warn('[WR.room]', e.message);
  }
  // ошибка подписки (отказ правил) — один раз, с проверкой, вставлены ли правила
  function subErr(onErr, what) {
    let done = false;
    return e => {
      if (done) return;
      done = true;
      explain(e, 'Нет доступа к ' + what + '.').then(t => report(onErr, t));
    };
  }

  // cb('added' | 'changed' | 'removed', spin с полем id). 'removed' приходит и когда спин выпал из последних limit.
  function onSpins(roomId, opts, cb, onErr) {
    if (typeof opts === 'function') { onErr = cb; cb = opts; opts = {}; }
    roomId = checkRoomId(roomId);
    const limit = Math.max(1, Math.min(1000, (opts && opts.limit) || 100));
    let q = null, off = false;
    const hs = {};
    init().then(() => {
      if (off) return;
      q = roomRef(roomId, 'spins').orderByChild('ts').limitToLast(limit);
      const fail = subErr(onErr, 'спинам комнаты');
      [['child_added', 'added'], ['child_changed', 'changed'], ['child_removed', 'removed']].forEach(([ev, name]) => {
        hs[ev] = q.on(ev, s => cb(name, Object.assign({ id: s.key }, s.val())), fail);
      });
    }, e => report(onErr, e));
    return () => {
      off = true;
      if (q) for (const ev in hs) q.off(ev, hs[ev]);
    };
  }

  function onValue(roomId, path, what, empty, cb, onErr) {
    roomId = checkRoomId(roomId);
    let r = null, h = null, off = false;
    init().then(() => {
      if (off) return;
      r = roomRef(roomId, path);
      h = r.on('value', s => cb(s.exists() ? s.val() : empty()), subErr(onErr, what));
    }, e => report(onErr, e));
    return () => {
      off = true;
      if (r) r.off('value', h);
    };
  }
  // cb({ acc: {...} }) / cb(meta | null) -> unsubscribe
  const onPlayers = (roomId, cb, onErr) => onValue(roomId, 'players', 'списку игроков', () => ({}), cb, onErr);
  const onWhitelist = (roomId, cb, onErr) => onValue(roomId, 'whitelist', 'списку ников', () => ({}), cb, onErr);
  const onMeta = (roomId, cb, onErr) => onValue(roomId, 'meta', 'настройкам комнаты', () => null, cb, onErr);

  // cb(true | false) — есть ли сейчас связь с базой
  function onConnection(cb) {
    let r = null, h = null, off = false;
    init().then(() => {
      if (off) return;
      r = db.ref('.info/connected');
      h = r.on('value', s => cb(s.val() === true));
    }, () => cb(false));
    return () => {
      off = true;
      if (r) r.off('value', h);
    };
  }

  // ---------- ссылки ----------
  function links(roomId, key, base) {
    base = base || location.href.split(/[?#]/)[0]; // = location.origin + location.pathname
    const id = encodeURIComponent(roomId);
    const obs = base.replace(/[^/]*$/, '') + 'obs.html?room=' + id; // виджеты OBS — отдельная страница рядом
    return {
      friends: base + '?room=' + id,
      admin: key ? base + '?room=' + id + '&key=' + encodeURIComponent(key) : null,
      obsTeam: obs + '&w=team',
      obsSeries: obs + '&w=series',
      obsMain: obs,
      obsFeed: obs + '&w=feed',
      obsBoard: obs + '&w=board',
    };
  }

  // Настройки комнаты (только владелец): title, maxActive, friendRerolls
  async function updateMeta(roomId, patch) {
    roomId = checkRoomId(roomId);
    const p = patch || {}, data = {};
    if ('title' in p) data.title = S(p.title).slice(0, 80) || 'Комната';
    if ('maxActive' in p) data.maxActive = Math.max(1, Math.min(10, Math.round(+p.maxActive) || 1));
    if ('friendRerolls' in p) data.friendRerolls = Math.max(0, Math.min(10, Math.round(+p.friendRerolls) || 0));
    if (!Object.keys(data).length) return;
    await op(() => roomRef(roomId, 'meta').update(data), 'Менять настройки комнаты может только владелец.');
  }

  WR.room = {
    init, serverNow, create, claimOwner, addToWhitelist, removeFromWhitelist, join,
    publishSpin, updateSpin, resolveSpin, onSpins, onPlayers, onWhitelist, onMeta, links,
    // сверх спецификации: проверка правил, состояние связи, текущий uid
    diagnose, onConnection, updateMeta,
    get uid() { return uid; },
    STATUSES,
  };
})();
