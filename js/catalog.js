// Каталог челленджей и их проверка по итогам боя (delta из WR.tracker). Сети нет.
(function () {
  'use strict';
  window.WR = window.WR || {};

  const CLASS_LABEL = { lightTank: 'ЛТ', mediumTank: 'СТ', heavyTank: 'ТТ', 'AT-SPG': 'ПТ', SPG: 'САУ' };
  const DIFF = { easy: 0.75, normal: 1, hard: 1.35 };
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  const DMG = [0, 350, 550, 750, 1000, 1300, 1700, 2100, 2600, 3100, 3600, 4000];
  const XP = [0, 300, 350, 400, 450, 550, 650, 750, 850, 950, 1050, 1150];
  const LABEL_TYPE = Object.fromEntries(Object.entries(CLASS_LABEL).map(([k, v]) => [v, k]));

  const round50 = n => Math.max(50, Math.round(n / 50) * 50);
  const diffKey = d => (d in DIFF ? d : 'normal');
  const byDiff = (o, d) => o[diffKey(d)];
  const num = x => (typeof x === 'number' && isFinite(x) ? x : 0);
  const dmgV = (t, d) => round50((DMG[t.tier] || 3000) * DIFF[diffKey(d)] * (t.type === 'SPG' ? 0.75 : 1));
  const hpOf = t => num(+t.hp);
  const ach = (delta, k) => num(((delta && delta.achievements) || {})[k]);
  const yn = b => (b ? 'да' : 'нет');

  const MEDALS_ANY = [
    ['warrior', 'Воин'], ['steelwall', 'Стальная стена'], ['invader', 'Захватчик'],
    ['defender', 'Защитник'], ['scout', 'Разведчик'], ['supporter', 'Поддержка'],
  ];
  // Эпические медали за один бой (названия из энциклопедии WG)
  const MEDALS_EPIC = [
    ['medalRadleyWalters', 'Рэдли-Уолтерса'], ['medalKolobanov', 'Колобанова'], ['medalLafayettePool', 'Пула'],
    ['medalNikolas', 'Николса'], ['medalPascucci', 'Паскуччи'], ['medalHalonen', 'Халонена'], ['medalFadin', 'Фадина'],
    ['medalOrlik', 'Орлика'], ['medalBurda', 'Бурды'], ['medalBillotte', 'Бийота'], ['medalDeLanglade', 'де Ланглада'],
    ['medalGore', 'Гора'], ['medalTarczay', 'Тарцая'], ['medalBrunoPietro', 'Бруно'], ['medalTamadaYoshio', 'Йошио Тамада'],
    ['huntsman', 'Найдина'], ['medalLehvaslaiho', 'Лехвеслайхо'], ['medalStark', 'Старка'], ['medalOskin', 'Оськина'],
    ['heroesOfRassenay', 'героев Расейняя'],
  ];

  // Простой челлендж «поле >= v»
  const ge = (field, label) => ({
    test: (d, v) => num(d[field]) >= v,
    show: (d, v) => `${label}: ${num(d[field])} / ${v}`,
  });
  // Любая медаль из списка за бой
  const anyMedal = (list, prefix) => ({
    test: d => list.some(([k]) => ach(d, k) >= 1),
    show: d => {
      const got = list.filter(([k]) => ach(d, k) >= 1).map(([, n]) => n);
      return got.length ? `${prefix}: ${got.join(', ')}` : `${prefix}: нет`;
    },
  });
  const lived = d => num(d.survived_battles) >= 1;
  const won = d => num(d.wins) >= 1;
  const assistOf = d => num(d.radio_assisted_damage) + num(d.track_assisted_damage);
  const fragsV = (t, d) => Math.max(1, (t.tier <= 4 ? 4 : 3) + (d === 'hard' ? 1 : d === 'easy' ? -1 : 0));
  const halfHp = t => Math.max(50, round50(hpOf(t) * 0.5));

  const NOT_SPG = ['lightTank', 'mediumTank', 'heavyTank', 'AT-SPG'];

  // Автоматические. classes: null — все классы; hp: нужна известная прочность; ach: нужны медали
  const AUTO = [
    { id: 'dmg', text: 'Нанести {v} урона', classes: null, v: dmgV, ...ge('damage_dealt', 'Урон') },
    {
      id: 'frags', text: 'Уничтожить {v:противника|противника|противников}', classes: null,
      v: fragsV, ...ge('frags', 'Фраги'),
    },
    {
      id: 'win_survive', text: 'Победить и выжить', classes: null, v: null,
      test: d => num(d.wins) >= 1 && num(d.survived_battles) >= 1,
      show: d => `Победа: ${yn(num(d.wins) >= 1)}, выжил: ${yn(num(d.survived_battles) >= 1)}`,
    },
    {
      id: 'dmg_2hp', text: 'Нанести {v} урона — два своих запаса прочности', classes: null, hp: true,
      v: t => 2 * hpOf(t), ...ge('damage_dealt', 'Урон'),
    },
    {
      id: 'assist', text: 'Набрать {v} урона по своему засвету', classes: ['lightTank', 'mediumTank'],
      v: (t, d) => round50(dmgV(t, d) * 0.8), ...ge('radio_assisted_damage', 'По засвету'),
    },
    {
      id: 'track', text: 'Набрать {v} урона по сбитой тобой гусле', classes: ['heavyTank', 'mediumTank', 'AT-SPG'],
      v: (t, d) => round50(dmgV(t, d) * 0.4), ...ge('track_assisted_damage', 'По гусле'),
    },
    {
      id: 'spot', text: 'Засветить {v:противника|противника|противников}', classes: ['lightTank'],
      v: (t, d) => byDiff({ easy: 4, normal: 6, hard: 8 }, d), ...ge('spotted', 'Засвечено'),
    },
    {
      id: 'block', text: 'Заблокировать бронёй {v} урона', classes: ['heavyTank', 'mediumTank', 'AT-SPG'],
      v: (t, d) => round50(dmgV(t, d) * 0.9), ...ge('blocked', 'Заблокировано'),
    },
    {
      id: 'stun', text: 'Оглушить противников {v:раз|раза|раз}', classes: ['SPG'],
      v: (t, d) => byDiff({ easy: 6, normal: 10, hard: 15 }, d), ...ge('stun_number', 'Оглушений'),
    },
    {
      id: 'cap', text: 'Набрать очки захвата или сбить захват', classes: null, v: null,
      test: d => num(d.capture_points) > 0 || num(d.dropped_capture_points) > 0,
      show: d => `Захват: ${num(d.capture_points)}, сбито: ${num(d.dropped_capture_points)}`,
    },
    {
      id: 'xp', text: 'Набрать {v} базового опыта', classes: null,
      v: (t, d) => round50((XP[t.tier] || 1000) * DIFF[diffKey(d)]), ...ge('xp', 'Опыт'),
    },
    {
      id: 'pierce', text: 'Пробить броню противника {v:раз|раза|раз}', classes: NOT_SPG,
      v: (t, d) => byDiff({ easy: 4, normal: 6, hard: 9 }, d), ...ge('piercings', 'Пробитий'),
    },
    {
      id: 'accuracy', text: 'Точность от {v}% (минимум 5 выстрелов)', classes: NOT_SPG,
      v: (t, d) => byDiff({ easy: 70, normal: 80, hard: 90 }, d),
      test: (d, v) => num(d.shots) >= 5 && num(d.hits) * 100 >= v * num(d.shots),
      show: (d, v) => {
        const s = num(d.shots), h = num(d.hits);
        return `Точность: ${s ? Math.round(h * 100 / s) : 0}% (${h}/${s}), нужно ${v}%`;
      },
    },
    {
      id: 'bounce', text: 'Получить {v:непробитие|непробития|непробитий}', classes: ['heavyTank'],
      v: (t, d) => byDiff({ easy: 3, normal: 5, hard: 8 }, d), ...ge('no_damage_direct_hits_received', 'Непробитий'),
    },
    {
      id: 'careful', text: 'Выжить, получив меньше {v} урона', classes: null, hp: true,
      v: (t, d) => Math.max(50, round50(hpOf(t) * byDiff({ easy: 0.5, normal: 0.3, hard: 0.15 }, d))),
      test: (d, v) => num(d.survived_battles) >= 1 && num(d.damage_received) < v,
      show: (d, v) => `Получено: ${num(d.damage_received)} (нужно меньше ${v}), выжил: ${yn(num(d.survived_battles) >= 1)}`,
    },
    {
      id: 'medal_main', text: 'Получить медаль «Основной калибр»', classes: null, v: null, ach: true,
      test: d => ach(d, 'mainGun') >= 1,
      show: d => `Основной калибр: ${ach(d, 'mainGun') >= 1 ? 'есть' : 'нет'}`,
    },
    {
      id: 'medal_any', classes: null, v: null, ach: true,
      text: 'Получить медаль «Воин», «Стальная стена», «Захватчик», «Защитник», «Разведчик» или «Поддержка»',
      test: d => MEDALS_ANY.some(([k]) => ach(d, k) >= 1),
      show: d => {
        const got = MEDALS_ANY.filter(([k]) => ach(d, k) >= 1).map(([, n]) => n);
        return got.length ? `Медали: ${got.join(', ')}` : 'Медалей нет';
      },
    },

    // ---------- урон и размен ----------
    {
      id: 'dmg_hp_live', text: 'Нанести {v} урона (свой запас прочности) и выжить', classes: null, hp: true,
      v: t => hpOf(t),
      test: (d, v) => num(d.damage_dealt) >= v && lived(d),
      show: (d, v) => `Урон: ${num(d.damage_dealt)} / ${v}, выжил: ${yn(lived(d))}`,
    },
    {
      id: 'trade', text: 'Нанести вдвое больше урона, чем получил (и не меньше {v})', classes: NOT_SPG,
      v: (t, d) => round50(dmgV(t, d) * 0.5),
      test: (d, v) => num(d.damage_dealt) >= v && num(d.damage_dealt) >= 2 * num(d.damage_received),
      show: (d, v) => `Нанёс ${num(d.damage_dealt)}, получил ${num(d.damage_received)} (нужно вдвое больше и от ${v})`,
    },
    {
      id: 'combo', text: 'Суммарный вклад {v}: свой урон + урон по засвету и гусле', classes: null,
      v: (t, d) => round50(dmgV(t, d) * 1.5),
      test: (d, v) => num(d.damage_dealt) + assistOf(d) >= v,
      show: (d, v) => `Вклад: ${num(d.damage_dealt) + assistOf(d)} / ${v}`,
    },
    {
      id: 'frags_live', text: 'Уничтожить {v:противника|противника|противников} и выжить', classes: null,
      v: (t, d) => Math.max(1, (t.tier <= 4 ? 3 : 2) + (d === 'hard' ? 1 : d === 'easy' ? -1 : 0)),
      test: (d, v) => num(d.frags) >= v && lived(d),
      show: (d, v) => `Фраги: ${num(d.frags)} / ${v}, выжил: ${yn(lived(d))}`,
    },

    {
      id: 'dmg_big', text: 'Мощный бой: нанести {v} урона', classes: null,
      v: (t, d) => round50(dmgV(t, d) * 1.5), ...ge('damage_dealt', 'Урон'),
    },
    {
      id: 'dmg_3hp', text: 'Нанести {v} урона — три своих запаса прочности', classes: null, hp: true,
      v: t => 3 * hpOf(t), ...ge('damage_dealt', 'Урон'),
    },
    {
      id: 'dmg_win', text: 'Нанести {v} урона и победить', classes: null,
      v: (t, d) => round50(dmgV(t, d) * 0.8),
      test: (d, v) => num(d.damage_dealt) >= v && won(d),
      show: (d, v) => `Урон: ${num(d.damage_dealt)} / ${v}, победа: ${yn(won(d))}`,
    },
    {
      id: 'dmg_low_taken', text: 'Нанести {v} урона, получив меньше {w}', classes: null, hp: true,
      v: dmgV, w: halfHp,
      test: (d, v, w) => num(d.damage_dealt) >= v && num(d.damage_received) < w,
      show: (d, v, w) => `Урон: ${num(d.damage_dealt)} / ${v}, получено: ${num(d.damage_received)} (нужно меньше ${w})`,
    },
    {
      id: 'dmg_or_frags', text: 'Нанести {v} урона или уничтожить {w:противника|противника|противников}', classes: null,
      v: (t, d) => round50(dmgV(t, d) * 1.2), w: (t, d) => fragsV(t, d) + 1,
      test: (d, v, w) => num(d.damage_dealt) >= v || num(d.frags) >= w,
      show: (d, v, w) => `Урон: ${num(d.damage_dealt)} / ${v} или фраги: ${num(d.frags)} / ${w}`,
    },
    {
      id: 'frags_big', text: 'Мясорубка: уничтожить {v:противника|противника|противников}', classes: null,
      v: (t, d) => (t.tier <= 4 ? 4 : 3) + byDiff({ easy: 1, normal: 2, hard: 3 }, d), ...ge('frags', 'Фраги'),
    },
    {
      id: 'frags_win', text: 'Уничтожить {v:противника|противника|противников} и победить', classes: null,
      v: fragsV,
      test: (d, v) => num(d.frags) >= v && won(d),
      show: (d, v) => `Фраги: ${num(d.frags)} / ${v}, победа: ${yn(won(d))}`,
    },
    {
      id: 'frags_spot', text: 'Уничтожить и засветить по {v:противнику|противника|противников}', classes: null,
      v: (t, d) => byDiff({ easy: 1, normal: 2, hard: 3 }, d),
      test: (d, v) => num(d.frags) >= v && num(d.spotted) >= v,
      show: (d, v) => `Фраги: ${num(d.frags)} / ${v}, засвечено: ${num(d.spotted)} / ${v}`,
    },
    {
      id: 'frags_dmg', text: 'Уничтожить {v:противника|противника|противников} и нанести {w} урона', classes: null,
      v: (t, d) => Math.max(1, fragsV(t, d) - 1), w: (t, d) => round50(dmgV(t, d) * 0.8),
      test: (d, v, w) => num(d.frags) >= v && num(d.damage_dealt) >= w,
      show: (d, v, w) => `Фраги: ${num(d.frags)} / ${v}, урон: ${num(d.damage_dealt)} / ${w}`,
    },
    {
      id: 'frags_low_taken', text: 'Уничтожить {v:противника|противника|противников}, получив меньше {w} урона', classes: null, hp: true,
      v: (t, d) => Math.max(1, fragsV(t, d) - 1), w: halfHp,
      test: (d, v, w) => num(d.frags) >= v && num(d.damage_received) < w,
      show: (d, v, w) => `Фраги: ${num(d.frags)} / ${v}, получено: ${num(d.damage_received)} (нужно меньше ${w})`,
    },
    {
      id: 'frags_untouched', text: 'Уничтожить {v:противника|противника|противников}, не дав пробить себя ни разу', classes: NOT_SPG,
      v: (t, d) => byDiff({ easy: 1, normal: 2, hard: 3 }, d),
      test: (d, v) => num(d.frags) >= v && num(d.piercings_received) === 0,
      show: (d, v) => `Фраги: ${num(d.frags)} / ${v}, пробитий по тебе: ${num(d.piercings_received)}`,
    },

    // ---------- засвет и помощь ----------
    {
      id: 'spot_team', text: 'Засветить {v:противника|противника|противников}', classes: ['mediumTank', 'heavyTank', 'AT-SPG'],
      v: (t, d) => byDiff({ easy: 2, normal: 3, hard: 5 }, d), ...ge('spotted', 'Засвечено'),
    },
    {
      id: 'assist_all', text: 'Набрать {v} урона по засвету и сбитой гусле вместе', classes: ['lightTank', 'mediumTank'],
      v: (t, d) => dmgV(t, d),
      test: (d, v) => assistOf(d) >= v,
      show: (d, v) => `Помощь: ${assistOf(d)} / ${v}`,
    },

    // ---------- стрельба ----------
    {
      id: 'no_miss', text: 'Ни одного промаха (минимум {v:выстрел|выстрела|выстрелов})', classes: NOT_SPG,
      v: (t, d) => byDiff({ easy: 3, normal: 5, hard: 8 }, d),
      test: (d, v) => num(d.shots) >= v && num(d.hits) >= num(d.shots),
      show: (d, v) => `Попал ${num(d.hits)} из ${num(d.shots)} (нужно все, минимум ${v})`,
    },
    {
      id: 'hits', text: 'Попасть по противникам {v:раз|раза|раз}', classes: null,
      v: (t, d) => (t.type === 'SPG' ? byDiff({ easy: 3, normal: 5, hard: 7 }, d) : byDiff({ easy: 6, normal: 9, hard: 13 }, d)),
      ...ge('hits', 'Попаданий'),
    },
    {
      id: 'he_hits', text: 'Попасть фугасами {v:раз|раза|раз}', classes: NOT_SPG,
      v: (t, d) => byDiff({ easy: 2, normal: 3, hard: 5 }, d), ...ge('explosion_hits', 'Попаданий фугасами'),
    },

    // ---------- броня и выживание ----------
    {
      id: 'untouchable', text: 'Выжить, не дав пробить себя ни разу', classes: NOT_SPG, v: null,
      test: d => lived(d) && num(d.piercings_received) === 0,
      show: d => `Пробитий по тебе: ${num(d.piercings_received)}, выжил: ${yn(lived(d))}`,
    },
    {
      id: 'bounce_mt', text: 'Получить {v:непробитие|непробития|непробитий}', classes: ['mediumTank', 'AT-SPG'],
      v: (t, d) => byDiff({ easy: 2, normal: 3, hard: 5 }, d), ...ge('no_damage_direct_hits_received', 'Непробитий'),
    },
    {
      id: 'block_more', text: 'Заблокировать бронёй больше урона, чем получил (и не меньше {v})', classes: ['heavyTank', 'mediumTank', 'AT-SPG'],
      v: (t, d) => round50(dmgV(t, d) * 0.4),
      test: (d, v) => num(d.blocked) >= v && num(d.blocked) > num(d.damage_received),
      show: (d, v) => `Заблокировано ${num(d.blocked)}, получено ${num(d.damage_received)} (нужно больше и от ${v})`,
    },

    // ---------- база ----------
    {
      id: 'cap_points', text: 'Набрать {v:очко|очка|очков} захвата базы', classes: NOT_SPG,
      v: (t, d) => byDiff({ easy: 20, normal: 40, hard: 70 }, d), ...ge('capture_points', 'Очки захвата'),
    },
    {
      id: 'defend', text: 'Сбить {v:очко|очка|очков} захвата своей базы', classes: NOT_SPG,
      v: (t, d) => byDiff({ easy: 10, normal: 25, hard: 50 }, d), ...ge('dropped_capture_points', 'Сбито'),
    },

    // ---------- САУ ----------
    {
      id: 'stun_dmg', text: 'Набрать {v} урона по оглушённым тобой противникам', classes: ['SPG'],
      v: (t, d) => round50(dmgV(t, d) * 0.6), ...ge('stun_assisted_damage', 'Урон по оглушению'),
    },

    // ---------- медали ----------
    {
      id: 'medal_warrior', text: 'Получить медаль «Воин» (6 фрагов)', classes: null, v: null, ach: true,
      ...anyMedal([['warrior', 'Воин']], 'Медаль'),
    },
    {
      id: 'medal_team', text: 'Получить «Поддержку», «Дозорного» или «Разведчика»', classes: ['lightTank', 'mediumTank'], v: null, ach: true,
      ...anyMedal([['supporter', 'Поддержка'], ['evileye', 'Дозорный'], ['scout', 'Разведчик']], 'Медали'),
    },
    {
      id: 'medal_sniper', text: 'Получить медаль «Танкист-снайпер» (больше всех урона с 300+ м)', classes: ['AT-SPG', 'mediumTank', 'heavyTank'], v: null, ach: true,
      ...anyMedal([['sniper2', 'Танкист-снайпер']], 'Медаль'),
    },
    {
      id: 'medal_wall', text: 'Получить медаль «Стальная стена»', classes: ['heavyTank'], v: null, ach: true,
      ...anyMedal([['steelwall', 'Стальная стена']], 'Медаль'),
    },
    {
      id: 'medal_epic', text: 'Получить эпическую медаль (Рэдли-Уолтерса, Колобанова, Пула и другие)', classes: null, v: null, ach: true,
      ...anyMedal(MEDALS_EPIC, 'Эпическая медаль'),
    },
  ];

  // Ручные — подтверждает стример
  const MANUAL = [
    { id: 'he_only', text: 'Только фугасы весь бой 😈', classes: NOT_SPG },
    { id: 'no_gold', text: 'Без голды — только базовые снаряды', classes: null },
    { id: 'no_shoot_2min', text: 'Первые 2 минуты боя не стрелять', classes: null },
    { id: 'top1_dmg', text: 'Быть №1 по урону в своей команде', classes: null },
    { id: 'top3_xp', text: 'Попасть в топ-3 команды по опыту', classes: null },
    { id: 'chat', text: 'Чат решает: челлендж выбирают зрители', classes: null },
  ];

  const DEFS = {};
  AUTO.forEach(d => { d.auto = true; DEFS[d.id] = d; });
  MANUAL.forEach(d => { d.auto = false; d.v = null; DEFS[d.id] = d; });

  // 1 противника, 2 противника, 5 противников — окончание после числа
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  };
  // {v}/{w} — числа челленджа; {v:раз|раза|раз} — число со словом в нужной форме
  const put = (text, key, val) => (val == null ? text : text.replace(new RegExp('\\{' + key + '(?::([^|}]+)\\|([^|}]+)\\|([^}]+))?\\}'),
    (m, one, few, many) => (one ? `${val} ${plural(Math.abs(Math.round(val)), one, few, many)}` : String(val))));
  const fill = (text, v, w) => put(put(text, 'v', v), 'w', w);
  const valOf = (def, key, tank, d) => (typeof def[key] === 'function' ? def[key](tank, d) : null);
  const fits = (def, tank) => !def.classes || def.classes.includes(tank.type);

  // Свои строки стримера: «[ЛТ,СТ] текст». Подстановки как в index.html: {dmg} {frags} {assist} {block} {spots} {stuns} {tier}
  function parseCustom(text, tank, d) {
    const out = [];
    String(text || '').split('\n').forEach((raw, i) => {
      const line = raw.trim();
      if (!line) return;
      const m = line.match(/^\[([^\]]+)\]\s*(.+)$/);
      const labels = m ? m[1].split(',').map(s => s.trim().toUpperCase()) : null;
      if (labels && !labels.includes(CLASS_LABEL[tank.type])) return;
      const dmg = dmgV(tank, d);
      const vals = {
        dmg, tier: ROMAN[tank.tier] || tank.tier,
        frags: DEFS.frags.v(tank, d), assist: round50(dmg * 0.8), block: round50(dmg * 0.9),
        spots: DEFS.spot.v(tank, d), stuns: DEFS.stun.v(tank, d),
      };
      const txt = (m ? m[2] : line).replace(/\{(\w+)\}/g, (s, k) => (vals[k] != null ? vals[k] : s));
      out.push({ id: 'custom:' + (i + 1), text: txt, auto: false, v: null });
    });
    return out;
  }

  // Определения для экрана настроек. sample — текст для танка VIII уровня (прочность 1500), нормальная сложность
  function list() {
    return AUTO.concat(MANUAL).map(def => {
      const tank = { tier: 8, type: def.classes ? def.classes[0] : 'mediumTank', hp: 1500 };
      return {
        id: def.id,
        sample: fill(def.text, valOf(def, 'v', tank, 'normal'), valOf(def, 'w', tank, 'normal')),
        auto: def.auto,
        classes: def.classes ? def.classes.slice() : null,
        hp: !!def.hp,
      };
    });
  }

  function instancesFor(tank, opts) {
    opts = opts || {};
    if (!tank || !CLASS_LABEL[tank.type]) return [];
    const d = diffKey(opts.difficulty);
    const enabled = Array.isArray(opts.enabledIds) ? opts.enabledIds : null;
    const out = [];
    for (const def of AUTO.concat(MANUAL)) {
      if (enabled && !enabled.includes(def.id)) continue;
      if (opts.autoOnly && !def.auto) continue;
      if (!fits(def, tank)) continue;
      if (def.hp && !(hpOf(tank) > 0)) continue;
      const v = valOf(def, 'v', tank, d), w = valOf(def, 'w', tank, d);
      const inst = { id: def.id, text: fill(def.text, v, w), auto: def.auto, v };
      if (w != null) inst.w = w; // второе число (урон к фрагам, порог полученного урона)
      out.push(inst);
    }
    // Свои строки не зависят от enabledIds
    if (!opts.autoOnly) out.push(...parseCustom(opts.customManual, tank, d));
    return out;
  }

  const defOf = inst => (inst && DEFS[inst.id]) || null;

  // true / false; для ручных и неизвестных — null
  function evaluate(instance, delta) {
    const def = defOf(instance);
    if (!def || !def.auto) return null;
    return !!def.test(delta || {}, num(instance.v), num(instance.w));
  }

  // Короткая строка для стрима
  function describe(instance, delta) {
    const def = defOf(instance);
    if (!def || !def.auto) return (instance && instance.text) || 'Ручная проверка';
    if (!delta) return instance.text || fill(def.text, instance.v, instance.w);
    return def.show(delta, num(instance.v), num(instance.w));
  }

  const needsAchievements = instance => !!(defOf(instance) || {}).ach;

  WR.catalog = {
    CLASS_LABEL, DIFF, LABEL_TYPE, list, instancesFor, evaluate, describe, needsAchievements, round50,
  };
})();
