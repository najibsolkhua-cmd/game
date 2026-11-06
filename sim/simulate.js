// Балансная симуляция: боты против ботов.
// Запуск: node sim/simulate.js [игр=300] ['{"rules":{...},"targets":{"2":45},"maxRounds":{"2":22}}']
const { Game, mulberry32 } = require('../js/engine.js');
const { Bot, PROFILES } = require('../js/ai.js');

const N = +process.argv[2] || 300;
const profiles = Object.keys(PROFILES);
const override = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const f1 = (x) => x.toFixed(1);

async function one(nPlayers, seed) {
  const rng = mulberry32(seed * 7919);
  const players = [], controllers = [];
  for (let i = 0; i < nPlayers; i++) {
    const prof = profiles[(seed + i) % profiles.length];
    players.push({ name: 'Бот ' + (i + 1) + ' (' + prof + ')', type: 'bot' });
    controllers.push(new Bot(prof, rng));
  }
  const g = new Game({
    players, controllers, seed, rules: override.rules,
    target: override.targets && override.targets[nPlayers],
    maxRounds: override.maxRounds && override.maxRounds[nPlayers],
  });
  const m = { income: { company: 0, dividend: 0, bank: 0, auction: 0, offer: 0 }, spend: { buy: 0, share: 0 }, leadChanges: 0, firstSaleRound: null,
    taxes: 0, lawyers: 0, fines: 0, auctions: 0, auctionNoBid: 0, loans: 0, blocked: 0, deals: 0 };
  let leader = null;
  g.on((type, d) => {
    if (type === 'companySold') { m.income.company += d.kept; if (d.quick) m.quick = (m.quick || 0) + 1; if (m.firstSaleRound == null) m.firstSaleRound = g.round; }
    if (type === 'dividend') m.income.dividend += d.value;
    if (type === 'sellBank') m.income.bank += g.rules.sellPrice;
    if (type === 'auctionResult') { m.auctions++; if (d.winner == null) m.auctionNoBid++; m.income.auction += d.winner == null ? g.rules.auctionFloor : d.price; }
    if (type === 'buyBlind') m.spend.buy += g.buyPrice;
    if (type === 'invest') m.spend.share += g.rules.sharePrice;
    if (type === 'tax') m.taxes++;
    if (type === 'lawyer') m.lawyers++;
    if (type === 'taxResult' && d.fine != null) m.fines++;
    if (type === 'loan') m.loans++;
    if (type === 'offerResult' && d.accepted) m.deals++;
    if (type === 'event' && g.round > 1) {
      const l = g.ranking()[0].id;
      if (leader != null && l !== leader) m.leadChanges++;
      leader = l;
    }
  });
  let turns = 0;
  const origPlay = g.playTurn.bind(g);
  g.playTurn = async () => { if (++turns > 3000) { g.finish(g.ranking()[0], 'Лимит'); return; } return origPlay(); };
  await g.run();
  const r = g.ranking();
  m.margin = g.netWorth(r[0]) - g.netWorth(r[1]);
  return { g, m };
}

(async () => {
  for (const n of [2, 3, 4]) {
    const st = { rounds: [], byLimit: 0, seatWins: Array(n).fill(0), profWins: {}, sold: [], ms: [] };
    let target = 0, maxRounds = 0;
    for (let s = 1; s <= N; s++) {
      const { g, m } = await one(n, s);
      target = g.target; maxRounds = g.maxRounds;
      st.rounds.push(g.round);
      if (g.log.some((e) => e.kind === 'win' && /раундов/.test(e.text))) st.byLimit++;
      st.seatWins[g.winner.id]++;
      const prof = g.winner.name.match(/\((\w+)\)/)[1];
      st.profWins[prof] = (st.profWins[prof] || 0) + 1;
      st.sold.push(g.players.reduce((a, p) => a + p.companiesSold, 0));
      st.ms.push(m);
    }
    const sorted = st.rounds.slice().sort((a, b) => a - b);
    const M = (fn) => f1(avg(st.ms.map(fn)));
    console.log(`\n=== ${n} игрока, цель $${target}, лимит ${maxRounds} раундов ===`);
    console.log('Раундов: среднее', f1(avg(st.rounds)), 'медиана', sorted[sorted.length >> 1], 'p10', sorted[Math.floor(sorted.length * 0.1)], 'p90', sorted[Math.floor(sorted.length * 0.9)], '| конец по лимиту раундов:', (100 * st.byLimit / N).toFixed(0) + '%');
    console.log('Победы по местам:', st.seatWins.map((w) => (100 * w / N).toFixed(0) + '%').join(' / '), '| по профилям:', JSON.stringify(st.profWins));
    console.log('Продано компаний:', f1(avg(st.sold)), '| первая продажа в раунде', M((m) => m.firstSaleRound || 0), '| смен лидера', M((m) => m.leadChanges), '| отрыв победителя $' + M((m) => m.margin));
    console.log('Доход за игру ($): компании', M((m) => m.income.company), 'дивиденды', M((m) => m.income.dividend), 'банк', M((m) => m.income.bank), 'аукционы', M((m) => m.income.auction), '| расход: покупки', M((m) => m.spend.buy), 'акции', M((m) => m.spend.share));
    console.log('Налоговых', M((m) => m.taxes), '(отбито юристом', M((m) => m.lawyers) + ', штрафов', M((m) => m.fines) + ') | аукционов', M((m) => m.auctions), '(без ставок', M((m) => m.auctionNoBid) + ') | кредитов', M((m) => m.loans), '| сделок с игроками', M((m) => m.deals), '| срочных продаж', M((m) => m.quick || 0));
  }
})();
