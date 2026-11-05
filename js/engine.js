/* Игровой движок «Холдинг». Не зависит от интерфейса — работает и в браузере, и в Node (симуляция). */
(function (root) {
  'use strict';
  const C = (typeof module !== 'undefined' && module.exports) ? require('./cards.js') : root.HoldingCards;

  const DEFAULT_RULES = {
    startMoney: 10,     // стартовый капитал
    seatBonus: 1,       // компенсация очерёдности: каждый следующий игрок получает +$1
    startHand: 5,       // карт на руке в начале
    actionsPerTurn: 2,  // сделок за ход
    handLimit: 7,       // лимит руки в конце хода
    buyPrice: 3,        // купить у банка в тёмную
    sellPrice: 2,       // продать банку в тёмную
    dumpPrice: 1,       // принудительная распродажа сверх лимита
    companyBase: 12,    // базовая цена компании
    cleanBonus: 3,      // бонус «Чистый бизнес» (без универсальных карт)
    maxReshuffles: 3,   // сколько раз сброс замешивается в колоду
    maxOfferPrice: 15,
  };
  const DEFAULT_TARGETS = { 2: 50, 3: 45, 4: 40 };

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
      this.target = opts.target || DEFAULT_TARGETS[opts.players.length] || 50;
      this.players = opts.players.map((p, i) => ({
        id: i, name: p.name, type: p.type || 'bot', avatar: p.avatar || '',
        money: this.rules.startMoney + i * this.rules.seatBonus, hand: [], table: emptyTable(),
        companiesSold: 0, earned: 0,
      }));
      this.controllers = opts.controllers || [];
      this.deck = this.shuffle(C.buildDeck());
      this.discard = [];
      this.current = 0;
      this.turn = 0;
      this.round = 1;
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

    draw() {
      if (!this.deck.length) {
        if (this.reshuffles >= this.rules.maxReshuffles || !this.discard.length) {
          if (!this.exhausted) { this.exhausted = true; this.say('Колода исчерпана — игра закончится после этого хода.', 'warn'); }
          return null;
        }
        this.reshuffles++;
        this.deck = this.shuffle(this.discard.splice(0));
        this.say(`Сброс перемешан и стал новой колодой (${this.reshuffles}/${this.rules.maxReshuffles}).`, 'warn');
        this.emit('reshuffle');
      }
      return this.deck.pop();
    }

    canDraw() { return this.deck.length > 0 || (this.discard.length > 0 && this.reshuffles < this.rules.maxReshuffles); }

    findInHand(p, cardId) { return p.hand.findIndex((c) => c.id === cardId); }
    takeFromHand(p, cardId) {
      const i = this.findInHand(p, cardId);
      if (i < 0) throw new Error('Нет такой карты на руке');
      return p.hand.splice(i, 1)[0];
    }

    // ---------- оценка компаний ----------
    filled(p, ind) { return C.STAGE_ORDER.filter((s) => p.table[ind][s]).length; }
    isComplete(p, ind) { return this.filled(p, ind) === 4; }
    companyValue(p, ind) {
      const cards = C.STAGE_ORDER.map((s) => p.table[ind][s]).filter(Boolean);
      let v = this.rules.companyBase;
      let clean = cards.length === 4;
      for (const c of cards) { if (c.type === 'stage') v += c.tier; else clean = false; }
      if (clean) v += this.rules.cleanBonus;
      return { value: v, clean, bonus: clean ? this.rules.cleanBonus : 0 };
    }
    tableWorth(p) {
      let w = 0;
      for (const ind of C.IND_ORDER) for (const s of C.STAGE_ORDER) { const c = p.table[ind][s]; if (c) w += 1 + (c.tier || 0); }
      return w;
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
    canBuildCard(p, card) {
      if (card.type === 'stage') return true;
      if (card.type === 'wild') return true;
      return false;
    }

    // ---------- бесплатные действия ----------
    /** Выложить этап (или универсальную карту) в свою компанию. Занятое место — старая карта возвращается в руку. */
    build(pid, cardId, stage) {
      this.assertTurn(pid);
      const p = this.players[pid];
      const card = p.hand.find((c) => c.id === cardId);
      if (!card) throw new Error('Нет такой карты');
      if (card.type === 'stage') stage = card.stage;
      else if (card.type === 'wild') { if (!C.STAGE_ORDER.includes(stage)) throw new Error('Выберите этап для универсальной карты'); }
      else throw new Error('Эту карту нельзя построить');
      this.takeFromHand(p, cardId);
      const slot = p.table[card.ind];
      const old = slot[stage];
      slot[stage] = card;
      if (old) p.hand.push(old);
      const where = `${C.INDUSTRIES[card.ind].short} · ${C.STAGES[stage]}`;
      this.say(`${p.name} строит «${card.title}» (${where})${old ? `, «${old.title}» возвращается в руку` : ''}.`, 'build', pid);
      this.emit('build', { pid, card, stage, old });
      return { ok: true };
    }

    /** Сыграть «Продажа»: продать готовую компанию. */
    sellCompany(pid, ind, saleCardId) {
      this.assertTurn(pid);
      const p = this.players[pid];
      if (!this.isComplete(p, ind)) throw new Error('Компания ещё не собрана (нужны все 4 этапа)');
      const sale = saleCardId != null ? p.hand.find((c) => c.id === saleCardId) : p.hand.find((c) => c.type === 'sale');
      if (!sale || sale.type !== 'sale') throw new Error('Нужна карта «Продажа»');
      const { value, clean } = this.companyValue(p, ind);
      this.takeFromHand(p, sale.id);
      const cards = C.STAGE_ORDER.map((s) => p.table[ind][s]);
      for (const s of C.STAGE_ORDER) p.table[ind][s] = null;
      this.discard.push(...cards, sale);
      p.money += value;
      p.earned += value;
      p.companiesSold++;
      this.say(`${p.name} продаёт компанию «${C.INDUSTRIES[ind].name}» за $${value}${clean ? ' (Чистый бизнес +$' + this.rules.cleanBonus + ')' : ''}!`, 'sale', pid);
      this.emit('companySold', { pid, ind, value, clean });
      return { ok: true, value };
    }

    // ---------- сделки (тратят действие) ----------
    buyBlind(pid) {
      this.assertAction(pid);
      const p = this.players[pid];
      if (p.money < this.rules.buyPrice) throw new Error(`Нужно $${this.rules.buyPrice}`);
      if (!this.canDraw()) throw new Error('Колода пуста');
      const card = this.draw();
      if (!card) throw new Error('Колода пуста');
      p.money -= this.rules.buyPrice;
      p.hand.push(card);
      this.actionsLeft--;
      this.say(`${p.name} покупает карту у банка в тёмную за $${this.rules.buyPrice}.`, 'buy', pid);
      this.emit('buyBlind', { pid, card });
      return { ok: true, card };
    }

    sellBlind(pid, cardId) {
      this.assertAction(pid);
      const p = this.players[pid];
      const card = this.takeFromHand(p, cardId);
      this.discard.push(card);
      p.money += this.rules.sellPrice;
      this.actionsLeft--;
      this.say(`${p.name} продаёт карту банку рубашкой вверх за $${this.rules.sellPrice}.`, 'sell', pid);
      this.emit('sellBlind', { pid, card });
      return { ok: true };
    }

    /** Предложить карту рубашкой вверх другому игроку. claim — заявка (может быть блефом). */
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
        this.say(`${t.name}: отказ${t.money < price ? ' (не хватает денег)' : ''}.`, 'reject', targetId);
      }
      this.emit('offerResult', { from: pid, to: targetId, accepted, card: accepted ? card : null });
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
      return { ok: true, accepted, card };
    }

    /** Налоговая: посмотреть все карты игрока, одну забрать себе или отправить в сброс. */
    async playTax(pid, targetId, taxCardId) {
      this.assertAction(pid);
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
      const choice = await this.controllers[pid].chooseTax(this, pid, targetId);
      this.phase = 'actions';
      if (!choice) { this.say(`Проверка (${t.name}) ничего не нашла.`, 'info', pid); return { ok: true }; }
      let card = null;
      if (choice.from === 'table') {
        const slot = t.table[choice.ind];
        card = slot && slot[choice.stage];
        if (card) slot[choice.stage] = null;
      } else {
        const i = t.hand.findIndex((c) => c.id === choice.cardId);
        if (i >= 0) card = t.hand.splice(i, 1)[0];
      }
      if (!card) { this.say('Проверка ничего не изъяла.', 'info', pid); return { ok: true }; }
      const where = choice.from === 'table' ? 'со стола' : 'с руки';
      if (choice.mode === 'take') {
        p.hand.push(card);
        this.say(`🏛 ${t.name}: изъята карта ${where} «${card.title}». Забирает ${p.name}.`, 'tax', pid);
      } else {
        this.discard.push(card);
        this.say(`🏛 ${t.name}: карта ${where} «${card.title}» отправлена в сброс.`, 'tax', pid);
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

    async playTurn() {
      const p = this.cur;
      this.turn++;
      this.actionsLeft = this.rules.actionsPerTurn;
      this.phase = 'actions';
      this.say(`— Ход ${p.name} —`, 'turn', p.id);
      const card = this.draw();
      if (card) { p.hand.push(card); this.emit('draw', { pid: p.id, card }); }
      this.emit('turn', { pid: p.id });
      await this.controllers[p.id].takeTurn(this, p.id);
      if (this.over) return;
      await this.finishTurn(p);
    }

    async finishTurn(p) {
      this.phase = 'cleanup';
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
      if (p.money >= this.target) return this.finish(p, `${p.name} достигает $${this.target}!`);
      if (this.exhausted) {
        const best = this.ranking()[0];
        return this.finish(best, 'Колода исчерпана.');
      }
      this.current = (this.current + 1) % this.players.length;
      if (this.current === 0) this.round++;
    }

    ranking() {
      return this.players.slice().sort((a, b) => (b.money - a.money) || (this.tableWorth(b) - this.tableWorth(a)) || (b.companiesSold - a.companiesSold));
    }

    finish(winner, reason) {
      this.over = true;
      this.phase = 'over';
      this.winner = winner;
      this.say(`${reason} Победитель — ${winner.name} ($${winner.money}).`, 'win', winner.id);
      this.emit('gameOver', { winner, reason, ranking: this.ranking() });
    }
  }

  const api = { Game, DEFAULT_RULES, DEFAULT_TARGETS, mulberry32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HoldingEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
