/* Колода «Холдинг»: 54 карты + рубашка. */
(function (root) {
  'use strict';

  const INDUSTRIES = {
    chem:   { key: 'chem',   name: 'Химическая промышленность',   short: 'Химия',   color: '#b10dc9' },
    forest: { key: 'forest', name: 'Лесная промышленность',       short: 'Лес',     color: '#e46f0a' },
    build:  { key: 'build',  name: 'Строительная промышленность', short: 'Стройка', color: '#e00000' },
  };
  const IND_ORDER = ['chem', 'forest', 'build'];

  const STAGES = {
    raw:   'Сырьё',
    prod:  'Производство',
    store: 'Склад',
    trans: 'Транспорт',
  };
  const STAGE_ORDER = ['raw', 'prod', 'store', 'trans'];

  // Названия карт этапов: [tier 0, tier +2, tier +3]
  const TITLES = {
    chem: {
      raw:   ['Этиловый спирт', 'Газ бутилен', 'Ксилол'],
      prod:  ['Маленький химический завод', 'Средний химический завод', 'Большой химический завод'],
      store: ['Маленький склад (химия)', 'Средний склад (химия)', 'Большой склад (химия)'],
      trans: ['Автомобильный транспорт (химия)', 'Железнодорожный транспорт (химия)', 'Трубопроводный транспорт'],
    },
    forest: {
      raw:   ['Берёза', 'Орех', 'Карельская берёза'],
      prod:  ['Маленькое производство', 'Среднее производство', 'Большое производство'],
      store: ['Маленький склад (лес)', 'Средний склад (лес)', 'Большой склад (лес)'],
      trans: ['Автомобильный транспорт (лес)', 'Железнодорожный транспорт (лес)', 'Водный транспорт (лес)'],
    },
    build: {
      raw:   ['Арматура', 'Кирпич', 'Минеральная вата'],
      prod:  ['Маленькое строительное предприятие', 'Среднее строительное предприятие', 'Большое строительное предприятие'],
      store: ['Маленький склад (стройка)', 'Средний склад (стройка)', 'Большой склад (стройка)'],
      trans: ['Автомобильный транспорт (стройка)', 'Водный транспорт (стройка)', 'Воздушный транспорт'],
    },
  };
  const TIERS = [0, 2, 3];

  const IMG = (n) => 'assets/cards/' + n + '.svg';
  const BACK_IMG = IMG('back');

  function buildDeck() {
    const deck = [];
    let id = 0;
    for (const ind of IND_ORDER) {
      for (const stage of STAGE_ORDER) {
        TIERS.forEach((tier, i) => {
          deck.push({
            id: id++, type: 'stage', ind, stage, tier,
            title: TITLES[ind][stage][i],
            img: IMG(ind + '-' + stage + '-' + tier),
          });
        });
      }
    }
    for (const ind of IND_ORDER) {
      for (let k = 0; k < 2; k++) {
        deck.push({ id: id++, type: 'wild', ind, stage: null, tier: 0,
          title: 'Универсальная: ' + INDUSTRIES[ind].name, img: IMG('wild-' + ind) });
      }
    }
    for (let k = 0; k < 6; k++) deck.push({ id: id++, type: 'tax', title: 'Налоговая', img: IMG('tax') });
    for (let k = 0; k < 6; k++) deck.push({ id: id++, type: 'sale', title: 'Продажа', img: IMG('sale') });
    return deck;
  }

  // Что игрок может «заявить» при продаже карты в тёмную (заявка может быть блефом).
  const CLAIMS = {
    none:   { label: 'Без заявки',            match: () => true },
    sale:   { label: '«Это Продажа»',          match: (c) => c.type === 'sale' },
    tax:    { label: '«Это Налоговая»',        match: (c) => c.type === 'tax' },
    chem:   { label: '«Это Химия»',            match: (c) => (c.type === 'stage' || c.type === 'wild') && c.ind === 'chem' },
    forest: { label: '«Это Лес»',              match: (c) => (c.type === 'stage' || c.type === 'wild') && c.ind === 'forest' },
    build:  { label: '«Это Стройка»',          match: (c) => (c.type === 'stage' || c.type === 'wild') && c.ind === 'build' },
    top:    { label: '«Это карта +3»',         match: (c) => c.type === 'stage' && c.tier === 3 },
    wild:   { label: '«Это Универсальная»',    match: (c) => c.type === 'wild' },
  };

  const api = { INDUSTRIES, IND_ORDER, STAGES, STAGE_ORDER, TIERS, BACK_IMG, CLAIMS, buildDeck };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HoldingCards = api;
})(typeof window !== 'undefined' ? window : globalThis);
