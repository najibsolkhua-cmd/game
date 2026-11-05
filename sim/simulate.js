// Балансная симуляция: боты против ботов.
// Запуск: node sim/simulate.js [игр=300] ['{"rules":{...},"targets":{"2":60}}']
const { Game, mulberry32 } = require('../js/engine.js');
const { Bot, PROFILES } = require('../js/ai.js');

const N = +process.argv[2] || 300;
const profiles = Object.keys(PROFILES);
const override = process.argv[3] ? JSON.parse(process.argv[3]) : {};

async function one(nPlayers, seed) {
  const rng = mulberry32(seed * 7919);
  const players = [], controllers = [];
  for (let i = 0; i < nPlayers; i++) {
    const prof = profiles[(seed + i) % profiles.length];
    players.push({ name: 'Бот ' + (i + 1) + ' (' + prof + ')', type: 'bot' });
    controllers.push(new Bot(prof, rng));
  }
  const g = new Game({ players, controllers, seed, rules: override.rules, target: override.targets && override.targets[nPlayers] });
  let turns = 0;
  const origPlay = g.playTurn.bind(g);
  g.playTurn = async () => { if (++turns > 2000) { g.finish(g.ranking()[0], 'Лимит'); return; } return origPlay(); };
  await g.run();
  return g;
}

(async () => {
  for (const n of [2, 3, 4]) {
    const st = { rounds: [], byExhaust: 0, seatWins: Array(n).fill(0), profWins: {}, sold: [], taxes: 0, offers: 0, deals: 0 };
    let target = 0;
    for (let s = 1; s <= N; s++) {
      const g = await one(n, s);
      target = g.target;
      st.rounds.push(g.round);
      if (g.log.some((e) => e.text.startsWith('Колода исчерпана.'))) st.byExhaust++;
      st.seatWins[g.winner.id]++;
      const prof = g.winner.name.match(/\((\w+)\)/)[1];
      st.profWins[prof] = (st.profWins[prof] || 0) + 1;
      st.sold.push(g.players.reduce((a, p) => a + p.companiesSold, 0));
      st.taxes += g.log.filter((e) => e.kind === 'tax' && e.text.includes('налоговая проверка')).length;
      st.offers += g.log.filter((e) => e.kind === 'offer').length;
      st.deals += g.log.filter((e) => e.kind === 'deal').length;
    }
    const avg = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
    const sorted = st.rounds.slice().sort((a, b) => a - b);
    console.log(`\n=== ${n} игрока, цель $${target} ===`);
    console.log('Раундов: среднее', avg(st.rounds), 'медиана', sorted[sorted.length >> 1], 'p90', sorted[Math.floor(sorted.length * 0.9)]);
    console.log('Конец по исчерпанию колоды:', (100 * st.byExhaust / N).toFixed(0) + '%');
    console.log('Победы по местам:', st.seatWins.map((w) => (100 * w / N).toFixed(0) + '%').join(' / '));
    console.log('Победы по профилям:', JSON.stringify(st.profWins));
    console.log('Продано компаний за игру:', avg(st.sold), '| налоговых:', (st.taxes / N).toFixed(1), '| сделок предложено:', (st.offers / N).toFixed(1), 'заключено:', (st.deals / N).toFixed(1));
  }
})();
