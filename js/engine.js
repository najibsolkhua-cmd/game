/* Игровой движок «Холдинг». Не зависит от интерфейса — работает и в браузере, и в Node (симуляция). */
(function (root) {
  'use strict';
  const C = (typeof module !== 'undefined' && module.exports) ? require('./cards.js') : root.HoldingCards;

  const DEFAULT_RULES = {
    startMoney: 10,     // стартовый капитал
    seatBonus: null,    // компенсация очерёдности: null — по таблице SEAT_BONUS, число — +$N за место, массив — точные суммы
    startHand: 5,       // карт на руке в начале
    actionsPerTurn: 2,  // сделок за ход
    handLimit: 6,       // лимит руки в конце хода
    stageReserve: 1,    // сколько обычных этапов можно держать в руке в конце хода (остальные — на стол)
    buyPrice: 3,        // купить у банка в тёмную
    sellPrice: 2,       // продать карту банку сразу
    auctionFloor: 2,    // если на аукционе нет ставок — банк платит столько
    dumpPrice: 1,       // принудительная распродажа сверх лимита
    companyBase: 12,    // базовая цена компании
    cleanBonus: 3,      // бонус «Чистый бизнес» (без универсальных карт)
    synergyBonus: 3,    // бонус связи отраслей
    synergyNeed: 2,     // сколько этапов отрасли-поставщика нужно на столе
    taxFine: 3,         // штраф, если на столе у проверяемого пусто
    loanAmount: 10,     // кредит
    loanRepay: 13,      // вернуть
    loanTurns: 3,       // через сколько своих ходов
    loanPenalty: 3,     // пеня за просрочку
    sharePrice: 3,      // цена акции (получает владелец компании)
    quickSaleRate: 0.5, // срочная продажа без карты «Продажа»
    shareCut: 1 / 3,    // доля акционера от выплаты
    maxReshuffles: Infinity, // сброс замешивается в новую колоду сразу, как только колода кончилась
    maxOfferPrice: 15,
  };
  const DEFAULT_TARGETS = { 2: 60, 3: 55, 4: 50 };
  const DEFAULT_MAX_ROUNDS = { 2: 30, 3: 26, 4: 22 };
  const SEAT_BONUS = { 2: [0, 2], 3: [2, 0, 0], 4: [2, 0, 1, 1] }; // подобрано симуляцией

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function emptyTable() {
    const t = {};
    for (const ind of C.IND_ORDER) {
      t[ind] = {};
      for (const s of C.STAGE_ORDER) t[ind][s] = null;
    }
    return t;
  }

  class Game {
    constructor(opts) {
      this.seed = opts.seed != null ? opts.seed : (Date.now() & 0x7fffffff);
      this.rng = mulberry32(this.seed);
      this.rules = Object.assign({}, DEFAULT_RULES, opts.rules || {});
      this.useEvents = opts.events !== false;
      this.target = opts.target || DEFAULT_TARGETS[opts.players.length] || 50;
      this.maxRounds = opts.maxRounds || DEFAULT_MAX_ROUNDS[opts.players.length] || 20;
      this.players = opts.players.map((p, i) => ({
        id: i, name: p.name, type: p.type || 'bot', avatar: p.avatar || '',
        money: this.rules.startMoney + this.seatBonusFor(i, opts.players.length), hand: [], table: emptyTable(),
        shares: {},      // shares[ind] = { pid, card } — чья акция стоит на моей компании
        loan: null,      // { owe, turnsLeft }
        companiesSold: 0, earned: 0, dividends: 0,
      }));
      this.controllers = opts.controllers || [];
      this.deck = this.shuffle(C.buildDeck());
      this.discard = [];
      this.eventDeck = this.shuffle(C.buildEventDeck());
      this.eventDiscard = [];
      this.event = null;
      this.current = 0;
      this.turn = 0;
      this.round = 0;
      this.reshuffles = 0;
      this.actionsLeft = 0;
      this.phase = 'setup';
      this.exhausted = false;
      this.over = false;
      this.winner = null;
      this.log = [];
      this.listeners = [];
      this.delay = opts.delay || null; // async (ms) => {} — пауза для анимаций ботов
      for (let r = 0; r < this.rules.startHand; r++) {
        for (const p of this.players) p.hand.push(this.deck.pop());
      }
    }

    seatBonusFor(i, n) {
      const sb = this.rules.seatBonus;
      if (sb == null) return (SEAT_BONUS[n] || [])[i] || 0;
      return Array.isArray(sb) ? (sb[i] || 0) : i * sb;
    }

    // ---------- утилиты ----------
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
    on(fn) { this.listeners.push(fn); }
    emit(type, data) { for (const fn of this.listeners) { try { fn(type, data || {}); } catch (e) { console.error(e); } } }
    say(text, kind, pid) {
      const entry = { text, kind: kind || 'info', pid: pid == null ? null : pid, turn: this.turn };
      this.log.push(entry);
      this.emit('log', entry);
    }
    get cur() { return this.players[this.current]; }
    opponents(pid) { return this.players.filter((p) => p.id !== pid); }
    async pause(ms) { if (this.delay) await this.delay(ms); }
    ev(kind, ind) { return this.event && this.event.kind === kind && (ind === undefined || this.event.ind === ind); }

    canDraw() { return this.deck.length > 0 || (this.discard.length > 0 && this.reshuffles < this.rules.maxReshuffles); }
    /** Колода кончилась — сразу замешиваем сброс в новую, чтобы на столе не было пустой колоды. */
    refillDeck() {
      if (this.deck.length || !this.discard.length) return;
      if (this.reshuffles >= this.rules.maxReshuffles) {
        if (!this.exhausted) { this.exhausted = true; this.say('Колода исчерпана — игра закончится после этого хода.', 'warn'); }
        return;
      }
      this.reshuffles++;
      this.deck = this.shuffle(this.discard.splice(0));
      this.say(`🔄 Колода закончилась — сброс перемешан в новую колоду (${this.deck.length} карт).`, 'warn');
      this.emit('reshuffle');
    }
    draw() {
      this.refillDeck();
      const card = this.deck.pop() || null;
      this.refillDeck();
      return card;
    }

    findInHand(p, cardId) { return p.hand.findIndex((c) => c.id === cardId); }
    takeFromHand(p, cardId) {
      const i = this.findInHand(p, cardId);
      if (i < 0) throw new Error('Нет такой карты на руке');
      return p.hand.splice(i, 1)[0];
    }

    // ---------- цены с учётом события ----------
    get buyPrice() { return this.rules.buyPrice + (this.ev('inflation') ? 1 : 0); }
    netWorth(p) { return p.money - (p.loan ? p.loan.owe : 0); }

    // ---------- оценка компаний ----------
    filled(p, ind) { return C.STAGE_ORDER.filter((s) => p.table[ind][s]).length; }
    isComplete(p, ind) { return this.filled(p, ind) === 4; }
    synergyActive(p, ind) { return this.filled(p, C.SUPPLIER[ind].from) >= this.rules.synergyNeed; }
    /** Цена компании с расшифровкой: база, бонусы этапов, чистый бизнес, связь отраслей, событие рынка. */
    companyValue(p, ind) {
      const R = this.rules;
      const cards = C.STAGE_ORDER.map((s) => p.table[ind][s]).filter(Boolean);
      const parts = [{ label: 'База', v: R.companyBase }];
      let tiers = 0;
      let clean = cards.length === 4;
      for (const c of cards) { if (c.type === 'stage') tiers += c.tier; else clean = false; }
      if (tiers) parts.push({ label: 'Бонусы этапов', v: tiers });
      if (clean) parts.push({ label: 'Чистый бизнес', v: R.cleanBonus });
      const synergy = this.synergyActive(p, ind);
      if (synergy) parts.push({ label: 'Связь: ' + C.INDUSTRIES[C.SUPPLIER[ind].from].short, v: R.synergyBonus });
      if (this.ev('crisis')) parts.push({ label: 'Кризис', v: -4 });
      if (this.ev('boom')) parts.push({ label: 'Бум', v: 3 });
      if (this.ev('gov', ind)) parts.push({ label: 'Госзаказ', v: 5 });
      const value = Math.max(0, parts.reduce((a, x) => a + x.v, 0));
      const blocked = this.ev('sanction', ind);
      return { value, clean, synergy, parts, blocked };
    }
    tableWorth(p) {
      let w = 0;
      for (const ind of C.IND_ORDER) for (const s of C.STAGE_ORDER) { const c = p.table[ind][s]; if (c) w += 1 + (c.tier || 0); }
      return w;
    }
    tableCards(p) {
      const out = [];
      for (const ind of C.IND_ORDER) for (const s of C.STAGE_ORDER) { const c = p.table[ind][s]; if (c) out.push({ ind, stage: s, card: c }); }
      return out;
    }

    // ---------- проверки ----------
    assertTurn(pid) {
      if (this.over) throw new Error('Игра окончена');
      if (pid !== this.current || this.phase !== 'actions') throw new Error('Сейчас не ваш ход');
    }
    assertAction(pid) {
      this.assertTurn(pid);
      if (this.actionsLeft <= 0) throw new Error('Сделки на этот ход закончились');
    }

    // ---------- бесплатные действия ----------
    /** Выложить этап (или универсальную карту) в свою компанию. Занятое место — старая карта возвращается в руку. */
    build(pid, cardId, stage) {
      this.assertTurn(pid);
      const p = this.players[pid];
      const card = p.hand.find((c) => c.id === cardId);
      if (!card) throw new Error('Нет такой карты');
      if (card.type === 'stage') {
        if (stage && stage !== card.stage) throw new Error(`Эта карта — «${C.STAGES[card.stage]}»`);
        stage = card.stage;
      } else if (card.type === 'wild') { if (!C.STAGE_ORDER.includes(stage)) throw new Error('Выберите этап для универсальной карты'); }
      else throw new Error('Эту карту нельзя построить');
      this.place(p, card, stage, false);
      return { ok: true };
    }
    place(p, card, stage, forced) {
      this.takeFromHand(p, card.id);
      const slot = p.table[card.ind];
      const old = slot[stage];
      slot[stage] = card;
      if (old) p.hand.push(old);
      const where = `${C.INDUSTRIES[card.ind].short} · ${C.STAGES[stage]}`;
      this.say(`${p.name} ${forced ? 'обязан выложить' : 'строит'} «${card.title}» (${where})${old ? `, «${old.title}» возвращается в руку` : ''}.`, 'build', p.id);
      this.emit('build', { pid: p.id, card, stage, old, forced });
    }
    /** Улучшит ли этап компанию: пустое место, замена универсальной или более высокий уровень. */
    improves(p, card) {
      if (card.type !== 'stage') return false;
      const cur = p.table[card.ind][card.stage];
      return !cur || cur.type === 'wild' || card.tier > cur.tier;
    }

    /** Продать карту банку сразу, рубашкой вверх (тратит сделку). */
    sellBank(pid, cardId) {
      this.assertAction(pid);
      const p = this.players[pid];
      const card = this.takeFromHand(p, cardId);
      this.discard.push(card);
      p.money += this.rules.sellPrice;
      this.actionsLeft--;
      this.say(`🏦 ${p.name} продаёт карту банку рубашкой вверх за $${this.rules.sellPrice}.`, 'sell', pid);
      this.emit('sellBank', { pid, card });
      this.checkWin();
      return { ok: true };
    }

    /** Сыграть «Продажа»: продать готовую компанию. */
    sellCompany(pid, ind, saleCardId) {
      this.assertTurn(pid);
      const p = this.players[pid];
      if (!this.isComplete(p, ind)) throw new Error('Компания ещё не собрана (нужны все 4 этапа)');
      const sale = saleCardId != null ? p.hand.find((c) => c.id === saleCardId) : p.hand.find((c) => c.type === 'sale');
      if (!sale || sale.type !== 'sale') throw new Error('Нужна карта «Продажа»');
      const cv = this.companyValue(p, ind);
      if (cv.blocked) throw new Error(`Санкции: компании отрасли «${C.INDUSTRIES[ind].short}» в этом раунде не продаются`);
      this.discard.push(this.takeFromHand(p, sale.id));
      const extras = cv.parts.filter((x) => x.label !== 'База' && x.label !== 'Бонусы этапов').map((x) => `${x.label} ${x.v > 0 ? '+' : '−'}$${Math.abs(x.v)}`);
      this.payout(p, ind, cv.value, `💰 ${p.name} продаёт компанию «${C.INDUSTRIES[ind].short}» за $${cv.value}${extras.length ? ' (' + extras.join(', ') + ')' : ''}.`, cv, false);
      return { ok: true, value: cv.value };
    }

    quickValue(p, ind) { return Math.floor(this.companyValue(p, ind).value * this.rules.quickSaleRate); }
    /** Срочная продажа без карты «Продажа» — за половину цены, тратит сделку. */
    quickSell(pid, ind) {
      this.assertAction(pid);
      const p = this.players[pid];
      if (!this.isComplete(p, ind)) throw new Error('Компания ещё не собрана (нужны все 4 этапа)');
      const cv = this.companyValue(p, ind);
      if (cv.blocked) throw new Error(`Санкции: компании отрасли «${C.INDUSTRIES[ind].short}» в этом раунде не продаются`);
      const value = this.quickValue(p, ind);
      this.actionsLeft--;
      this.payout(p, ind, value, `⚡ ${p.name} срочно продаёт компанию «${C.INDUSTRIES[ind].short}» без карты «Продажа» за $${value} (50% от $${cv.value}).`, cv, true);
      return { ok: true, value };
    }

    payout(p, ind, value, text, cv, quick) {
      const cards = C.STAGE_ORDER.map((s) => p.table[ind][s]);
      for (const s of C.STAGE_ORDER) p.table[ind][s] = null;
      this.discard.push(...cards);
      let kept = value;
      let divTxt = '';
      const sh = p.shares[ind];
      if (sh) {
        const div = Math.round(value * this.rules.shareCut);
        const holder = this.players[sh.pid];
        holder.money += div; holder.dividends += div; holder.earned += div;
        kept -= div;
        this.discard.push(sh.card);
        delete p.shares[ind];
        divTxt = ` Акционер ${holder.name} получает дивиденды $${div}.`;
        this.emit('dividend', { pid: sh.pid, from: p.id, value: div });
      }
      p.money += kept;
      p.earned += kept;
      p.companiesSold++;
      this.say(text + divTxt, 'sale', p.id);
      this.emit('companySold', { pid: p.id, ind, value, kept, clean: cv.clean, synergy: cv.synergy, quick });
      this.checkWin();
    }

    /** Мгновенная победа: кто набрал цель (за вычетом долга) — побеждает сразу. */
    checkWin() {
      if (this.over) return true;
      const ok = this.players.filter((q) => this.netWorth(q) >= this.target);
      if (!ok.length) return false;
      const w = ok.find((q) => q.id === this.current) || ok.sort((a, b) => this.netWorth(b) - this.netWorth(a))[0];
      this.finish(w, `${w.name} набирает $${this.netWorth(w)}${w.loan ? ' (за вычетом кредита)' : ''} — цель $${this.target} достигнута!`);
      return true;
    }

    /** Взять кредит в банке (бесплатно, только один одновременно). */
    takeLoan(pid) {
      this.assertTurn(pid);
      const p = this.players[pid];
      if (p.loan) throw new Error('У вас уже есть кредит');
      const repay = this.ev('cheapcredit') ? this.rules.loanAmount : this.rules.loanRepay;
      p.loan = { owe: repay, turnsLeft: this.rules.loanTurns };
      p.money += this.rules.loanAmount;
      this.say(`🏦 ${p.name} берёт кредит $${this.rules.loanAmount} — вернуть $${repay} через ${this.rules.loanTurns} хода.`, 'loan', pid);
      this.emit('loan', { pid });
      return { ok: true };
    }
    repayLoan(pid) {
      this.assertTurn(pid);
      const p = this.players[pid];
      if (!p.loan) throw new Error('Кредита нет');
      if (p.money < p.loan.owe) throw new Error(`Нужно $${p.loan.owe}`);
      p.money -= p.loan.owe;
      this.say(`🏦 ${p.name} досрочно гасит кредит ($${p.loan.owe}).`, 'loan', pid);
      p.loan = null;
      this.emit('loan', { pid });
      return { ok: true };
    }
    processLoan(p) {
      if (!p.loan) return;
      p.loan.turnsLeft--;
      if (p.loan.turnsLeft > 0) return;
      if (p.money >= p.loan.owe) {
        p.money -= p.loan.owe;
        this.say(`🏦 ${p.name} возвращает кредит $${p.loan.owe}.`, 'loan', p.id);
        p.loan = null;
      } else {
        const paid = p.money;
        p.money = 0;
        p.loan.owe = p.loan.owe - paid + this.rules.loanPenalty;
        p.loan.turnsLeft = 1;
        this.say(`🏦 ${p.name} не может вернуть кредит! Внесено $${paid}, долг с пеней — $${p.loan.owe}.`, 'warn', p.id);
      }
      this.emit('loan', { pid: p.id });
    }

    // ---------- сделки (тратят действие) ----------
    buyBlind(pid) {
      this.assertAction(pid);
      const p = this.players[pid];
      const price = this.buyPrice;
      if (p.money < price) throw new Error(`Нужно $${price}`);
      if (!this.canDraw()) throw new Error('Колода пуста');
      const card = this.draw();
      if (!card) throw new Error('Колода пуста');
      p.money -= price;
      p.hand.push(card);
      this.actionsLeft--;
      this.say(`${p.name} покупает карту у банка в тёмную за $${price}.`, 'buy', pid);
      this.emit('buyBlind', { pid, card });
      return { ok: true, card };
    }

    /** Аукцион вслепую: карта рубашкой вверх, остальные делают закрытые ставки. Нет ставок — банк платит минимум. */
    async auction(pid, cardId, claim) {
      this.assertAction(pid);
      const p = this.players[pid];
      claim = C.CLAIMS[claim] ? claim : 'none';
      const card = this.takeFromHand(p, cardId);
      this.actionsLeft--;
      const claimTxt = claim !== 'none' ? ` с заявкой ${C.CLAIMS[claim].label}` : '';
      this.say(`🔨 ${p.name} выставляет карту на аукцион вслепую${claimTxt}.`, 'auction', pid);
      this.phase = 'waiting';
      this.emit('auction', { from: pid, claim });
      const bids = [];
      for (let k = 1; k < this.players.length; k++) {
        const q = this.players[(pid + k) % this.players.length];
        let bid = 0;
        if (q.money > 0) bid = Math.round(+(await this.controllers[q.id].bidAuction(this, q.id, { from: pid, claim })) || 0);
        bid = Math.max(0, Math.min(q.money, bid));
        bids.push({ pid: q.id, bid });
      }
      this.phase = 'actions';
      const best = bids.reduce((a, b) => (b.bid > a.bid ? b : a), { bid: 0 });
      this.say(`Ставки: ${bids.map((b) => `${this.players[b.pid].name} — ${b.bid ? '$' + b.bid : 'пас'}`).join(', ')}.`, 'auction', pid);
      let winner = null;
      if (best.bid > 0) {
        winner = this.players[best.pid];
        winner.money -= best.bid; p.money += best.bid;
        winner.hand.push(card);
        this.say(`🔨 Продано ${winner.name} за $${best.bid}!`, 'deal', best.pid);
      } else {
        p.money += this.rules.auctionFloor;
        this.discard.push(card);
        this.say(`🔨 Ставок нет — банк забирает карту за $${this.rules.auctionFloor}.`, 'sell', pid);
      }
      this.emit('auctionResult', { from: pid, winner: winner ? winner.id : null, price: best.bid, card, bids });
      this.checkWin();
      return { ok: true, winner, price: best.bid };
    }

    /** Предложить карту рубашкой вверх конкретному игроку. claim — заявка (может быть блефом). */
    async offer(pid, targetId, cardId, price, claim) {
      this.assertAction(pid);
      const p = this.players[pid], t = this.players[targetId];
      if (!t || t.id === pid) throw new Error('Неверный покупатель');
      price = Math.max(1, Math.min(this.rules.maxOfferPrice, Math.round(price)));
      claim = C.CLAIMS[claim] ? claim : 'none';
      const card = p.hand.find((c) => c.id === cardId);
      if (!card) throw new Error('Нет такой карты');
      this.actionsLeft--;
      const claimTxt = claim !== 'none' ? ` с заявкой ${C.CLAIMS[claim].label}` : '';
      this.say(`${p.name} → ${t.name}: предлагает карту рубашкой вверх за $${price}${claimTxt}.`, 'offer', pid);
      this.phase = 'waiting';
      this.emit('offer', { from: pid, to: targetId, price, claim });
      let accepted = false;
      if (t.money >= price) {
        accepted = !!(await this.controllers[targetId].respondOffer(this, targetId, { from: pid, price, claim }));
      }
      this.phase = 'actions';
      if (accepted && t.money >= price) {
        this.takeFromHand(p, cardId);
        t.hand.push(card);
        t.money -= price; p.money += price;
        this.say(`${t.name}: сделка! Платит $${price}.`, 'deal', targetId);
      } else {
        accepted = false;
        this.say(`${t.name}: отказ${t.money < price ? ' (не хватает денег)' : ''}.`, 'reject', targetId);
      }
      this.emit('offerResult', { from: pid, to: targetId, accepted, card: accepted ? card : null });
      this.checkWin();
      return { ok: true, accepted, card };
    }

    /** Купить у игрока случайную карту в тёмную: предлагаем цену, при согласии выбираем карту по рубашке. */
    async requestBuy(pid, targetId, price) {
      this.assertAction(pid);
      const p = this.players[pid], t = this.players[targetId];
      if (!t || t.id === pid) throw new Error('Неверный продавец');
      if (!t.hand.length) throw new Error(`У ${t.name} нет карт`);
      price = Math.max(1, Math.min(this.rules.maxOfferPrice, Math.round(price)));
      if (p.money < price) throw new Error('Не хватает денег');
      this.actionsLeft--;
      this.say(`${p.name} → ${t.name}: хочет купить карту в тёмную за $${price}.`, 'offer', pid);
      this.phase = 'waiting';
      this.emit('request', { from: pid, to: targetId, price });
      const accepted = !!(await this.controllers[targetId].respondRequest(this, targetId, { from: pid, price }));
      let card = null;
      if (accepted) {
        const idx = await this.controllers[pid].pickBlind(this, pid, targetId, t.hand.length);
        const i = Math.max(0, Math.min(t.hand.length - 1, idx | 0));
        card = t.hand.splice(i, 1)[0];
        p.hand.push(card);
        p.money -= price; t.money += price;
        this.say(`${t.name}: сделка! ${p.name} вытягивает карту по рубашке и платит $${price}.`, 'deal', targetId);
      } else {
        this.say(`${t.name}: отказ.`, 'reject', targetId);
      }
      this.phase = 'actions';
      this.emit('requestResult', { from: pid, to: targetId, accepted, card });
      this.checkWin();
      return { ok: true, accepted, card };
    }

    /** Акция: вложиться в компанию соперника (2+ этапа). Владелец получает деньги сразу, акционер — долю при продаже. */
    invest(pid, targetId, ind, shareCardId) {
      this.assertAction(pid);
      const p = this.players[pid], t = this.players[targetId];
      if (!t || t.id === pid) throw new Error('Вкладываться можно только в чужую компанию');
      const card = shareCardId != null ? p.hand.find((c) => c.id === shareCardId) : p.hand.find((c) => c.type === 'share');
      if (!card || card.type !== 'share') throw new Error('Нужна карта «Акция»');
      if (this.filled(t, ind) < 2) throw new Error('В компании должно быть хотя бы 2 этапа');
      if (t.shares[ind]) throw new Error('В эту компанию уже вложился другой игрок');
      const price = this.rules.sharePrice;
      if (p.money < price) throw new Error(`Нужно $${price}`);
      this.takeFromHand(p, card.id);
      p.money -= price; t.money += price;
      t.shares[ind] = { pid, card };
      this.actionsLeft--;
      this.say(`📈 ${p.name} покупает акцию компании «${C.INDUSTRIES[ind].short}» (${t.name}) за $${price}. При продаже получит треть выплаты.`, 'share', pid);
      this.emit('invest', { from: pid, to: targetId, ind });
      this.checkWin();
      return { ok: true };
    }

    /** Налоговая: проверяет только стол. Можно отбиться Юристом. Пустой стол — штраф. */
    async playTax(pid, targetId, taxCardId) {
      this.assertAction(pid);
      if (this.ev('taxfree')) throw new Error('Налоговые каникулы: в этом раунде проверок нет');
      const p = this.players[pid], t = this.players[targetId];
      if (!t || t.id === pid) throw new Error('Неверная цель');
      const tax = taxCardId != null ? p.hand.find((c) => c.id === taxCardId) : p.hand.find((c) => c.type === 'tax');
      if (!tax || tax.type !== 'tax') throw new Error('Нужна карта «Налоговая»');
      this.takeFromHand(p, tax.id);
      this.discard.push(tax);
      this.actionsLeft--;
      this.say(`🏛 ${p.name} → ${t.name}: налоговая проверка!`, 'tax', pid);
      this.phase = 'waiting';
      this.emit('tax', { from: pid, to: targetId });
      const lawyer = t.hand.find((c) => c.type === 'lawyer');
      if (lawyer && await this.controllers[targetId].useLawyer(this, targetId, { from: pid })) {
        this.discard.push(this.takeFromHand(t, lawyer.id));
        this.phase = 'actions';
        this.say(`⚖️ ${t.name} выставляет Юриста — проверка отменена!`, 'lawyer', targetId);
        this.emit('lawyer', { from: pid, to: targetId });
        return { ok: true, blocked: true };
      }
      const options = this.tableCards(t);
      if (!options.length) {
        const fine = Math.min(this.rules.taxFine, t.money);
        t.money -= fine;
        this.phase = 'actions';
        this.say(`🏛 На столе у ${t.name} пусто — штраф $${fine} в бюджет.`, 'tax', pid);
        this.emit('taxResult', { from: pid, to: targetId, card: null, fine });
        return { ok: true };
      }
      const choice = await this.controllers[pid].chooseTax(this, pid, targetId);
      this.phase = 'actions';
      const slot = choice && t.table[choice.ind];
      const card = slot && slot[choice.stage];
      if (!card) { this.say('Проверка ничего не изъяла.', 'info', pid); return { ok: true }; }
      slot[choice.stage] = null;
      if (choice.mode === 'take') {
        p.hand.push(card);
        this.say(`🏛 ${t.name}: изъята карта со стола «${card.title}». Забирает ${p.name}.`, 'tax', pid);
      } else {
        this.discard.push(card);
        this.say(`🏛 ${t.name}: карта со стола «${card.title}» отправлена в сброс.`, 'tax', pid);
      }
      this.emit('taxResult', { from: pid, to: targetId, card, mode: choice.mode });
      return { ok: true, card };
    }

    // ---------- ход ----------
    async run() {
      this.emit('start');
      this.say(`Игра началась! Цель — $${this.target}.`, 'info');
      while (!this.over) {
        await this.playTurn();
      }
      return this.winner;
    }

    startRound() {
      this.round++;
      if (!this.useEvents) return;
      if (this.event) this.eventDiscard.push(this.event);
      if (!this.eventDeck.length) this.eventDeck = this.shuffle(this.eventDiscard.splice(0));
      this.event = this.eventDeck.pop();
      this.say(`📰 Раунд ${this.round}. Событие рынка: «${this.event.title}» — ${this.event.text}`, 'event');
      this.emit('event', { event: this.event, round: this.round });
    }

    async playTurn() {
      if (this.current === 0) {
        if (this.round >= this.maxRounds) {
          const best = this.ranking()[0];
          return this.finish(best, `Сыграно ${this.maxRounds} раундов — побеждает самый богатый.`);
        }
        this.startRound();
      }
      this.refillDeck();
      const p = this.cur;
      this.turn++;
      this.actionsLeft = this.rules.actionsPerTurn;
      this.phase = 'actions';
      this.say(`— Ход ${p.name} —`, 'turn', p.id);
      this.processLoan(p);
      const card = this.draw();
      if (card) { p.hand.push(card); this.emit('draw', { pid: p.id, card }); }
      this.emit('turn', { pid: p.id });
      await this.controllers[p.id].takeTurn(this, p.id);
      if (this.over) return;
      await this.finishTurn(p);
    }

    /** Рука — для сильных карт: обычных этапов можно оставить не больше stageReserve, остальные — на стол или банку по $1. */
    async enforceReserve(p) {
      const limit = this.rules.stageReserve;
      const stages = p.hand.filter((c) => c.type === 'stage');
      if (stages.length <= limit) return;
      let keep = await this.controllers[p.id].chooseReserve(this, p.id, stages.map((c) => c.id), limit);
      keep = new Set((keep || []).filter((id) => stages.some((c) => c.id === id)).slice(0, limit));
      for (let guard = 0; guard < 30; guard++) {
        const c = p.hand.find((x) => x.type === 'stage' && !keep.has(x.id));
        if (!c) break;
        if (this.improves(p, c)) this.place(p, c, c.stage, true);
        else {
          this.discard.push(this.takeFromHand(p, c.id));
          p.money += this.rules.dumpPrice;
          this.say(`${p.name}: «${c.title}» некуда выложить — продана банку за $${this.rules.dumpPrice}.`, 'sell', p.id);
          this.emit('dump', { pid: p.id, card: c });
        }
      }
    }

    async finishTurn(p) {
      this.phase = 'cleanup';
      await this.enforceReserve(p);
      const extra = p.hand.length - this.rules.handLimit;
      if (extra > 0) {
        let ids = await this.controllers[p.id].chooseExcess(this, p.id, extra);
        ids = (ids || []).filter((id) => p.hand.some((c) => c.id === id)).slice(0, extra);
        while (ids.length < extra) {
          const rest = p.hand.filter((c) => !ids.includes(c.id));
          ids.push(rest[rest.length - 1].id);
        }
        for (const id of ids) { this.discard.push(this.takeFromHand(p, id)); p.money += this.rules.dumpPrice; }
        this.say(`${p.name} распродаёт лишние карты (${extra}) по $${this.rules.dumpPrice}.`, 'sell', p.id);
      }
      this.emit('endTurn', { pid: p.id });
      if (this.checkWin()) return;
      if (this.exhausted) {
        const best = this.ranking()[0];
        return this.finish(best, 'Колода исчерпана.');
      }
      this.current = (this.current + 1) % this.players.length;
    }

    ranking() {
      return this.players.slice().sort((a, b) => (this.netWorth(b) - this.netWorth(a)) || (this.tableWorth(b) - this.tableWorth(a)) || (b.companiesSold - a.companiesSold));
    }

    finish(winner, reason) {
      this.over = true;
      this.phase = 'over';
      this.winner = winner;
      this.say(`${reason} Победитель — ${winner.name} ($${this.netWorth(winner)}).`, 'win', winner.id);
      this.emit('gameOver', { winner, reason, ranking: this.ranking() });
    }
  }

  const api = { Game, DEFAULT_RULES, DEFAULT_TARGETS, DEFAULT_MAX_ROUNDS, mulberry32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HoldingEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
