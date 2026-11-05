# Ядро для игры с друзьями: каталог челленджей, трекер боёв, комнаты

Спецификация модулей, которые не зависят от дизайна страницы. Страница (`index.html`) подключит их через `<script src>` на этапе интеграции.

Сайт статический: GitHub Pages (https://volodyka1.github.io/wot-roulette/) и локальный сервер `serve.ps1`. Сборки и npm нет: обычные браузерные скрипты, общее пространство имён `window.WR`.

## Файлы

| Файл | Что внутри | Сеть |
|---|---|---|
| `js/catalog.js` | каталог челленджей и их проверка по итогам боя | нет |
| `js/tracker.js` | слепки статистики танка и сравнение после боя | WG API |
| `js/room.js` | комнаты в Firebase Realtime Database | Firebase |
| `database.rules.json` | правила доступа к базе (стример вставляет их в консоль Firebase) | — |
| `dev/tracker-test.html`, `dev/room-test.html` | страницы для ручной проверки, в продукт не входят (папка `dev/` в .gitignore) | — |

## Общие соглашения

- Каждый файл — классический скрипт: `(function () { 'use strict'; window.WR = window.WR || {}; WR.catalog = {...}; })();`. Без ES-модулей, без TypeScript.
- Все тексты, видимые пользователю, и все сообщения ошибок — на русском.
- Объект танка (из ангара страницы): `{id, name, tier, type, prem, img, hp}`. `type` ∈ `lightTank | mediumTank | heavyTank | AT-SPG | SPG`. `hp` — прочность из `encyclopedia/vehicles` (`default_profile.hp`), может отсутствовать или быть 0.
- Метки классов: lightTank ЛТ, mediumTank СТ, heavyTank ТТ, AT-SPG ПТ, SPG САУ.
- Сложность: `'easy' | 'normal' | 'hard'`, множитель `k = {easy: .75, normal: 1, hard: 1.35}`. `round50(n) = max(50, round(n / 50) * 50)`.
- Регионы WG API (как в `index.html`): eu `https://api.worldoftanks.eu`, na `https://api.worldoftanks.com`, asia `https://api.worldoftanks.asia`. Application ID по умолчанию `1e984dbbdf7b1c1fbd284d4cadc0b17f`.

## js/catalog.js

### Каталог

Значение `v` считается от уровня танка и сложности. `dmgV = round50(DMG[tier] * k * (SPG ? .75 : 1))`, где `DMG = [0,350,550,750,1000,1300,1700,2100,2600,3100,3600,4000]` (индекс — уровень I–XI).

Автоматические (проверяются по `delta` из трекера):

| id | Текст | Классы | Условие выполнения | v |
|---|---|---|---|---|
| dmg | Нанести {v} урона | все | `damage_dealt >= v` | dmgV |
| frags | Уничтожить {v} противников | все | `frags >= v` | `max(1, (tier <= 4 ? 4 : 3) + (hard ? 1 : easy ? -1 : 0))` |
| win_survive | Победить и выжить | все | `wins >= 1 && survived_battles >= 1` | — |
| dmg_2hp | Нанести урона больше двух своих запасов прочности ({v}) | все, только если hp > 0 | `damage_dealt >= v` | `2 * hp` |
| assist | Набрать {v} урона по своему засвету | ЛТ, СТ | `radio_assisted_damage >= v` | `round50(dmgV * .8)` |
| track | Набрать {v} урона по сбитой тобой гусле | ТТ, СТ, ПТ | `track_assisted_damage >= v` | `round50(dmgV * .4)` |
| spot | Засветить {v} противников | ЛТ | `spotted >= v` | easy 4, normal 6, hard 8 |
| block | Заблокировать бронёй {v} урона | ТТ, СТ, ПТ | `blocked >= v` | `round50(dmgV * .9)` |
| stun | Оглушить противников {v} раз | САУ | `stun_number >= v` | easy 6, normal 10, hard 15 |
| cap | Набрать очки захвата или сбить захват | все | `capture_points > 0 \|\| dropped_capture_points > 0` | — |
| xp | Набрать {v} базового опыта | все | `xp >= v` | `round50(XP[tier] * k)`, `XP = [0,300,350,400,450,550,650,750,850,950,1050,1150]` |
| pierce | Пробить броню противника {v} раз | все, кроме САУ | `piercings >= v` | easy 4, normal 6, hard 9 |
| accuracy | Точность от {v}% (минимум 5 выстрелов) | все, кроме САУ | `shots >= 5 && hits * 100 >= v * shots` | easy 70, normal 80, hard 90 |
| bounce | Получить {v} непробитий | ТТ | `no_damage_direct_hits_received >= v` | easy 3, normal 5, hard 8 |
| careful | Выжить, получив меньше {v} урона | все, только если hp > 0 | `survived_battles >= 1 && damage_received < v` | `max(50, round50(hp * {easy: .5, normal: .3, hard: .15}))` |
| medal_main | Получить медаль «Основной калибр» | все | `achievements.mainGun >= 1` | — |
| medal_any | Получить медаль «Воин», «Стальная стена», «Захватчик», «Защитник», «Разведчик» или «Поддержка» | все | любой из `warrior, steelwall, invader, defender, scout, supporter` >= 1 | — |

Ручные (только для стримера, подтверждает кнопками ✅/❌):

| id | Текст | Классы |
|---|---|---|
| he_only | Только фугасы весь бой 😈 | все, кроме САУ |
| no_gold | Без голды — только базовые снаряды | все |
| no_shoot_2min | Первые 2 минуты боя не стрелять | все |
| top1_dmg | Быть №1 по урону в своей команде | все |
| top3_xp | Попасть в топ-3 команды по опыту | все |
| chat | Чат решает: челлендж выбирают зрители | все |

Плюс свои ручные строки стримера (многострочный текст из настроек): одна строка — один челлендж, необязательный префикс `[ЛТ,СТ] ` ограничивает классы, как в нынешнем `index.html`. Их id — `custom:<номер строки>`.

Ключи медалей (`mainGun`, `warrior`, `steelwall`, `invader`, `defender`, `scout`, `supporter`) проверить по живому API (`tanks/achievements`, аккаунт EU 724061121) и поправить, если какой-то называется иначе.

### Интерфейс

```js
WR.catalog = {
  CLASS_LABEL,                 // { lightTank: 'ЛТ', ... }
  DIFF,                        // { easy: .75, normal: 1, hard: 1.35 }
  list(),                      // определения для экрана настроек: [{ id, sample, auto, classes }]
  instancesFor(tank, opts),    // экземпляры, подходящие танку
  evaluate(instance, delta),   // true / false
  describe(instance, delta),   // короткая строка с цифрой для стрима, напр. 'Урон: 2350 / 2100'
  needsAchievements(instance), // true для medal_*
}
```

- `opts = { difficulty, enabledIds: string[] | null (null — все стандартные включены), customManual: string, autoOnly: boolean }`.
- `instancesFor` возвращает JSON-сериализуемые объекты `{ id, text, auto, v }` (они хранятся в Firebase). Фильтрует по классу танка, отбрасывает челленджи с `hp`, если прочность неизвестна, при `autoOnly` отбрасывает ручные и свои строки. Без случайности: случайный выбор делает страница.
- `evaluate` и `describe` находят определение по `instance.id`. Для ручных `evaluate` возвращает `null`.
- `delta` — объект из трекера: числовые разницы полей плюс `delta.achievements = { ключ: разница }`.

## js/tracker.js

Поля статистики танка (`tanks/stats`, раздел `all`): `battles, wins, survived_battles, damage_dealt, damage_received, frags, spotted, xp, capture_points, dropped_capture_points, hits, shots, piercings, explosion_hits, no_damage_direct_hits_received, radio_assisted_damage, track_assisted_damage, stun_number, avg_damage_blocked`. Заблокированный урон всего: `blocked = Math.round(avg_damage_blocked * battles)` (API отдаёт только среднее).

Медали (`tanks/achievements`, поле `achievements`) запрашиваются, только если они нужны какому-то челленджу.

```js
WR.tracker = {
  async snapshot({ apiBase, appId, accountId, tankId, withAchievements }),
  // -> { takenAt, lastBattle, stats: {...числа, blocked}, achievements?: { ключ: число } }
  async check({ apiBase, appId, accountId, items: [{ key, tankId, snapshot, spunAt, withAchievements }] }),
  // -> { [key]: { state, delta?, snapshot? } }
  diff(snapStats, curStats, snapAch, curAch), // -> delta
}
```

- `snapshot`: `lastBattle` — `last_battle_time` аккаунта из `account/info` (секунды WG). Если танк ещё ни разу не играл, `tanks/stats` его не вернёт: тогда все числа 0.
- `check` делает на аккаунт не больше трёх запросов: один `tanks/stats` со списком `tank_id` (до 100), один `account/info`, один `tanks/achievements`, если он нужен хоть одному пункту. Для каждого пункта `db = cur.battles - snap.battles`:
  - `db <= 0` → `{ state: 'waiting' }`;
  - `db >= 1` и `lastBattle * 1000 <= spunAt` → `{ state: 'rebaseline', snapshot: новыйСлепок }`: новые бои были до спина (WG записал их с задержкой), страница сохраняет новый слепок и ждёт дальше;
  - `db === 1` → `{ state: 'done', delta }`;
  - `db > 1` → `{ state: 'ambiguous', delta }`: сыграно несколько боёв, разделить нельзя, нужна ручная проверка.
- `spunAt` — время спина по часам сервера (Firebase `ServerValue.TIMESTAMP` или `Date.now() + serverTimeOffset`), не локальные часы игрока.
- Ошибки API — `Error` с русским сообщением; сетевые сбои не должны валить вызывающий цикл (вызывающий ловит и пробует позже).

## js/room.js

Firebase JS SDK compat **10.14.1** с `https://www.gstatic.com/firebasejs/10.14.1/` (`firebase-app-compat.js`, `firebase-auth-compat.js`, `firebase-database-compat.js`); перед использованием проверить, что адреса отвечают. Аналитику не подключаем.

```js
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyA2QzcnPMFE5GBiIItm1M1L0trRimFsfu8',
  authDomain: 'wotbase-311fc.firebaseapp.com',
  databaseURL: 'https://wotbase-311fc-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'wotbase-311fc',
  storageBucket: 'wotbase-311fc.firebasestorage.app',
  messagingSenderId: '259612791074',
  appId: '1:259612791074:web:2fbcb943094e8c30be957b',
};
```

Вход — анонимный Firebase Auth (уже включён в консоли). Права владельца — через секретный ключ комнаты, без Google-входа.

### Данные

```
rooms/{roomId}
  meta:                { title, region, maxActive: 3, friendRerolls: 1, createdAt }
  whitelist/{acc}:     { nick, addedAt }
  players/{acc}:       { uid, nick, region, joinedAt, owner: bool }
  spins/{spinId}:      { acc, nick, owner: bool, ts, kind, items, winIndex, jitter, dur, ch,
                         tank: {...}, challenge: { id, text, auto, v }, snapshot, rerolls,
                         status: 'pending' | 'ok' | 'fail' | 'ambiguous' | 'cancelled',
                         result: { delta, checkedAt, by: 'auto' | 'manual' } }
secrets/{roomId}:      строка — ключ владельца
claims/{roomId}/{uid}: строка — тот же ключ
```

- `acc` (account_id WG) везде хранится **строкой**.
- `roomId` — 10 символов `[a-z0-9]`, ключ — 24 символа, оба из `crypto.getRandomValues`.
- `ts` пишется как `firebase.database.ServerValue.TIMESTAMP`.

### Интерфейс

```js
WR.room = {
  async init(),                      // один раз: initializeApp, signInAnonymously, serverTimeOffset -> { uid }
  serverNow(),                       // Date.now() + serverTimeOffset
  async create({ title, region, owner: { acc, nick } }),  // -> { roomId, key }: secrets, claims, meta, whitelist и players владельца
  async claimOwner(roomId, key),     // записать claims/{roomId}/{uid}; true/false
  async addToWhitelist(roomId, { acc, nick }),
  async removeFromWhitelist(roomId, acc),
  async join(roomId, { acc, nick, region }), // понятная ошибка, если ника нет в списке
  async publishSpin(roomId, spin),   // push, ts = ServerValue.TIMESTAMP -> spinId
  async updateSpin(roomId, spinId, patch),
  async resolveSpin(roomId, spinId, { status, result }, { force }), // транзакция: пишет, только если статус ещё 'pending' (force — ручное решение владельца)
  onSpins(roomId, { limit = 100 }, cb), // cb(event: 'added' | 'changed' | 'removed', spin с полем id) -> unsubscribe
  onPlayers(roomId, cb), onWhitelist(roomId, cb), onMeta(roomId, cb), // -> unsubscribe
  links(roomId, key),                // { friends, admin, obsMain, obsFeed, obsBoard } от location.origin + location.pathname
}
```

Ссылки: друзья `?room=ID`, админ `?room=ID&key=KEY`, OBS — отдельная страница `obs.html?room=ID` (основной), `obs.html?room=ID&w=feed` (лента друзей), `obs.html?room=ID&w=board` (таблица). Старые `index.html?obs=…` перенаправляются на `obs.html`. Сверх спецификации: `WR.room.updateMeta(roomId, { title, maxActive, friendRerolls })` — настройки комнаты (только владелец).

## database.rules.json

```json
{
  "rules": {
    "rooms": {
      "$room": {
        ".read": true,
        "meta": {
          ".write": "auth != null && root.child('claims/' + $room + '/' + auth.uid).exists()"
        },
        "whitelist": {
          ".write": "auth != null && root.child('claims/' + $room + '/' + auth.uid).exists()"
        },
        "players": {
          "$acc": {
            ".write": "auth != null && (root.child('claims/' + $room + '/' + auth.uid).exists() || (root.child('rooms/' + $room + '/whitelist/' + $acc).exists() && newData.child('uid').val() === auth.uid && (!data.exists() || data.child('uid').val() === auth.uid)))"
          }
        },
        "spins": {
          ".indexOn": ["ts", "acc", "status"],
          "$spin": {
            ".write": "auth != null && (root.child('claims/' + $room + '/' + auth.uid).exists() || (newData.exists() && newData.child('acc').isString() && root.child('rooms/' + $room + '/players/' + newData.child('acc').val() + '/uid').val() === auth.uid && (!data.exists() || data.child('acc').val() === newData.child('acc').val())))"
          }
        }
      }
    },
    "secrets": {
      "$room": {
        ".read": false,
        ".write": "auth != null && !data.exists() && newData.isString() && newData.val().length >= 20"
      }
    },
    "claims": {
      "$room": {
        "$uid": {
          ".read": false,
          ".write": "auth != null && auth.uid === $uid && newData.val() === root.child('secrets/' + $room).val()"
        }
      }
    }
  }
}
```

Смысл: комнату читает любой, кто знает её id (OBS-виджетам вход не нужен). Настройки, список ников и чужие спины меняет только владелец (тот, чей uid записал верный ключ в `claims`). Друг из списка может один раз занять свой `players/{acc}` (привязать к своему uid), создавать и обновлять только свои спины. Ключи владельца и `claims` прочитать нельзя никому.

## Правила игры, которые реализует страница (на будущее, для интеграции)

- Друзьям — только автоматические челленджи. Ручные — только стримеру.
- Танк, по которому есть челлендж в статусе `pending` или `ambiguous`, не выпадает этому игроку, пока результат не появится. В пуле он помечен ⏳.
- Одновременно у игрока не больше `meta.maxActive` активных челленджей. Другу можно перекрутить челлендж `meta.friendRerolls` раз за спин, стримеру — без ограничений.
- Проверку боёв делают страница друга (свои спины) и панель стримера (все спины комнаты) раз в 30 секунд, пока есть `pending`. Запись результата — транзакцией, поэтому двойная проверка безопасна.
