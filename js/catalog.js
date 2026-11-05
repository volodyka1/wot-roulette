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

  // Простой челлендж «поле >= v»
  const ge = (field, label) => ({
    test: (d, v) => num(d[field]) >= v,
    show: (d, v) => `${label}: ${num(d[field])} / ${v}`,
  });

  const NOT_SPG = ['lightTank', 'mediumTank', 'heavyTank', 'AT-SPG'];

  // Автоматические. classes: null — все классы; hp: нужна известная прочность; ach: нужны медали
  const AUTO = [
    { id: 'dmg', text: 'Нанести {v} урона', classes: null, v: dmgV, ...ge('damage_dealt', 'Урон') },
    {
      id: 'frags', text: 'Уничтожить {v} противников', classes: null,
      v: (t, d) => Math.max(1, (t.tier <= 4 ? 4 : 3) + (d === 'hard' ? 1 : d === 'easy' ? -1 : 0)),
      ...ge('frags', 'Фраги'),
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
      id: 'spot', text: 'Засветить {v} противников', classes: ['lightTank'],
      v: (t, d) => byDiff({ easy: 4, normal: 6, hard: 8 }, d), ...ge('spotted', 'Засвечено'),
    },
    {
      id: 'block', text: 'Заблокировать бронёй {v} урона', classes: ['heavyTank', 'mediumTank', 'AT-SPG'],
      v: (t, d) => round50(dmgV(t, d) * 0.9), ...ge('blocked', 'Заблокировано'),
    },
    {
      id: 'stun', text: 'Оглушить противников {v} раз', classes: ['SPG'],
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
      id: 'pierce', text: 'Пробить броню противника {v} раз', classes: NOT_SPG,
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
      id: 'bounce', text: 'Получить {v} непробитий', classes: ['heavyTank'],
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

  const fill = (text, v) => (v == null ? text : text.replace('{v}', v));
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
        sample: fill(def.text, typeof def.v === 'function' ? def.v(tank, 'normal') : null),
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
      const v = typeof def.v === 'function' ? def.v(tank, d) : null;
      out.push({ id: def.id, text: fill(def.text, v), auto: def.auto, v });
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
    return !!def.test(delta || {}, num(instance.v));
  }

  // Короткая строка для стрима
  function describe(instance, delta) {
    const def = defOf(instance);
    if (!def || !def.auto) return (instance && instance.text) || 'Ручная проверка';
    if (!delta) return instance.text || fill(def.text, instance.v);
    return def.show(delta, num(instance.v));
  }

  const needsAchievements = instance => !!(defOf(instance) || {}).ach;

  WR.catalog = {
    CLASS_LABEL, DIFF, LABEL_TYPE, list, instancesFor, evaluate, describe, needsAchievements, round50,
  };
})();
