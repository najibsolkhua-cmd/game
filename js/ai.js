/* Боты «Холдинга». Видят только открытую информацию: свою руку, столы, сброс, деньги, число карт у соперников. */
(function (root) {
  'use strict';
  const C = (typeof module !== 'undefined' && module.exports) ? require('./cards.js') : root.HoldingCards;

  const PROFILES = {
    // aggression — склонность к налоговой и торговле, bluff — частота блефа, trust — доверие к заявкам
    balanced: { aggression: 0.6, bluff: 0.3, trust: 0.55, greed: 0.5 },
    trader:   { aggression: 0.4, bluff: 0.45, trust: 0.45, greed: 0.8 },
    shark:    { aggression: 0.9, bluff: 0.35, trust: 0.4, greed: 0.4 },
    careful:  { aggression: 0.4, bluff: 0.1, trust: 0.7, greed: 0.3 },
  };

  function filled(p, ind) { return C.STAGE_ORDER.filter((s) => p.table[ind][s]).length; }

  /** Насколько ценна карта для игрока p (в долларах, примерно). */
  function valueFor(g, p, card, exclude) {
    const hand = p.hand.filter((c) => c !== card && c !== exclude);
    switch (card.type) {
      case 'sale': {
        const salesHeld = hand.filter((c) => c.type === 'sale').length;
        let best = 0;
        for (const ind of C.IND_ORDER) best = Math.max(best, progress(p, ind, hand));
        if (salesHeld >= 2) return 2.5;
        if (salesHeld === 1) return best >= 3 ? 5 : 3;
        return best >= 4 ? 13 : best >= 3 ? 10 : best >= 2 ? 7 : 5;
      }
      case 'tax': return 4.5;
      case 'wild': {
        const f = filled(p, card.ind);
        if (f >= 4 && !C.STAGE_ORDER.some((s) => p.table[card.ind][s].type === 'wild')) return 1.5;
        return 3.5 + progress(p, card.ind, hand) * 0.8;
      }
      case 'stage': {
        const cur = p.table[card.ind][card.stage];
        const better = hand.some((c) => c.type === 'stage' && c.ind === card.ind && c.stage === card.stage && c.tier >= card.tier);
        if (better) return 1.2;
        const prog = progress(p, card.ind, hand);
        if (!cur) return 3 + prog * 0.9 + card.tier * 0.6;
        if (cur.type === 'wild') return 2 + card.tier * 0.8;
        if (card.tier > cur.tier) return 1.4 + (card.tier - cur.tier) * 0.9;
        return 1.2;
      }
    }
    return 1;
  }

  /** Сколько этапов отрасли уже есть или можно закрыть картами с руки. */
  function progress(p, ind, hand) {
    let n = 0;
    let wilds = (hand || p.hand).filter((c) => c.type === 'wild' && c.ind === ind).length;
    for (const s of C.STAGE_ORDER) {
      if (p.table[ind][s]) { n++; continue; }
      if ((hand || p.hand).some((c) => c.type === 'stage' && c.ind === ind && c.stage === s)) { n++; continue; }
      if (wilds > 0) { wilds--; n++; }
    }
    return n;
  }

  /** Карты, которых бот не видит (колода + руки соперников). */
  function unknownPool(g, p) {
    const seen = new Set();
    for (const c of p.hand) seen.add(c.id);
    for (const q of g.players) for (const ind of C.IND_ORDER) for (const s of C.STAGE_ORDER) { const c = q.table[ind][s]; if (c) seen.add(c.id); }
    for (const c of g.discard) seen.add(c.id);
    return C.buildDeck().filter((c) => !seen.has(c.id));
  }

  function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

  function blindEstimate(g, p, claim, trust) {
    const pool = unknownPool(g, p);
    const general = avg(pool.map((c) => valueFor(g, p, c)));
    if (!claim || claim === 'none' || !C.CLAIMS[claim]) return general;
    const matching = pool.filter(C.CLAIMS[claim].match);
    if (!matching.length) return general * 0.8; // заявка невозможна — почти наверняка блеф
    const claimed = avg(matching.map((c) => valueFor(g, p, c)));
    return trust * claimed + (1 - trust) * general;
  }

  class Bot {
    constructor(profileName, rng) {
      this.profileName = profileName || 'balanced';
      this.pr = PROFILES[this.profileName] || PROFILES.balanced;
      this.rng = rng || Math.random;
    }

    // ---- бесплатные действия ----
    async buildAndSell(g, pid) {
      const p = g.players[pid];
      let changed = true;
      while (changed && !g.over) {
        changed = false;
        for (const card of p.hand.slice()) {
          if (card.type !== 'stage') continue;
          const cur = p.table[card.ind][card.stage];
          if (!cur || cur.type === 'wild' || card.tier > cur.tier) {
            g.build(pid, card.id); changed = true; await g.pause(450); break;
          }
        }
        if (changed) continue;
        // Универсальная — только если она закрывает компанию (или их хватает на все пробелы).
        for (const ind of C.IND_ORDER) {
          const empty = C.STAGE_ORDER.filter((s) => !p.table[ind][s]);
          const wilds = p.hand.filter((c) => c.type === 'wild' && c.ind === ind);
          if (empty.length && wilds.length >= empty.length) {
            g.build(pid, wilds[0].id, empty[0]); changed = true; await g.pause(450); break;
          }
        }
        if (changed) continue;
        // Продажа готовых компаний — самая дорогая первой.
        const ready = C.IND_ORDER.filter((ind) => g.isComplete(p, ind)).sort((a, b) => g.companyValue(p, b).value - g.companyValue(p, a).value);
        if (ready.length && p.hand.some((c) => c.type === 'sale')) {
          g.sellCompany(pid, ready[0]); changed = true; await g.pause(700);
        }
      }
    }

    junk(g, p) {
      return p.hand.map((c) => ({ c, v: valueFor(g, p, c) })).sort((a, b) => a.v - b.v);
    }

    leader(g, pid) {
      return g.opponents(pid).slice().sort((a, b) => this.threat(g, b) - this.threat(g, a))[0];
    }
    threat(g, q) {
      let best = 0;
      for (const ind of C.IND_ORDER) best = Math.max(best, filled(q, ind));
      return q.money + best * 4 + q.hand.length * 0.5;
    }

    async takeTurn(g, pid) {
      const p = g.players[pid];
      await g.pause(500);
      await this.buildAndSell(g, pid);
      let guard = 0;
      while (g.actionsLeft > 0 && !g.over && guard++ < 6) {
        const done = await this.doAction(g, pid);
        if (!done) break;
        await g.pause(600);
        await this.buildAndSell(g, pid);
      }
      return p;
    }

    async doAction(g, pid) {
      const p = g.players[pid];
      const r = this.rng;
      const ranked = this.junk(g, p);
      const worst = ranked[0];
      const hasSale = p.hand.some((c) => c.type === 'sale');
      const completeNoSale = !hasSale && C.IND_ORDER.some((ind) => g.isComplete(p, ind));
      const opps = g.opponents(pid);

      // 1. Налоговая
      const tax = p.hand.find((c) => c.type === 'tax');
      if (tax) {
        const target = this.leader(g, pid);
        const juicy = target && (target.hand.length >= 3 || C.IND_ORDER.some((ind) => filled(target, ind) >= 2));
        if (juicy && (r() < this.pr.aggression + 0.3 || completeNoSale)) {
          await g.playTax(pid, target.id, tax.id);
          return true;
        }
      }
      // 2. Нет денег — продаём мусор банку
      if (p.money < g.rules.buyPrice && worst && worst.v <= 2.5) {
        g.sellBlind(pid, worst.c.id); return true;
      }
      // 3. Компания собрана, а Продажи нет — ищем её
      if (completeNoSale) {
        const rich = opps.filter((q) => q.hand.length >= 3).sort((a, b) => b.hand.length - a.hand.length)[0];
        if (rich && p.money >= 7 && r() < 0.35) { await g.requestBuy(pid, rich.id, 4 + Math.floor(r() * 2)); return true; }
        if (p.money >= g.rules.buyPrice && g.canDraw()) { g.buyBlind(pid); return true; }
      }
      // 4. Сплавить мусор другому игроку (с заявкой, возможно блефом)
      if (worst && worst.v <= 2 && r() < 0.25 + this.pr.greed * 0.25) {
        const buyers = opps.filter((q) => q.money >= 2);
        if (buyers.length) {
          const t = buyers[Math.floor(r() * buyers.length)];
          const claim = this.makeClaim(worst.c);
          const price = 2 + Math.floor(r() * 2) + (claim === 'sale' ? 1 : 0);
          await g.offer(pid, t.id, worst.c.id, price, claim);
          return true;
        }
      }
      // 5. Купить в тёмную у банка
      if (p.money >= g.rules.buyPrice && p.hand.length < g.rules.handLimit - 1 && (p.money >= 5 || r() < 0.5)) {
        if (g.canDraw()) { g.buyBlind(pid); return true; }
      }
      // 6. Купить у игрока в тёмную, если богаты
      if (p.money >= 12 && r() < 0.2) {
        const t = opps.filter((q) => q.hand.length >= 4).sort((a, b) => b.hand.length - a.hand.length)[0];
        if (t) { await g.requestBuy(pid, t.id, 3 + Math.floor(r() * 2)); return true; }
      }
      // 7. Разгрузить руку
      if (worst && worst.v <= 1.6 && (p.hand.length >= g.rules.handLimit - 1 || r() < 0.3)) {
        g.sellBlind(pid, worst.c.id); return true;
      }
      return false;
    }

    makeClaim(card) {
      const r = this.rng();
      if (r < this.pr.bluff) return this.rng() < 0.6 ? 'sale' : 'top';
      if (r < this.pr.bluff + 0.35) {
        if (card.type === 'stage' || card.type === 'wild') return card.ind;
        return card.type;
      }
      return 'none';
    }

    // ---- ответы на чужие действия ----
    async respondOffer(g, pid, offer) {
      await g.pause(700);
      const p = g.players[pid];
      if (p.money < offer.price) return false;
      const est = blindEstimate(g, p, offer.claim, this.pr.trust);
      const margin = p.hand.length >= g.rules.handLimit ? 1.5 : 0;
      const ok = offer.price <= est - 0.2 - margin + (this.rng() - 0.5);
      return ok;
    }

    async respondRequest(g, pid, req) {
      await g.pause(700);
      const p = g.players[pid];
      const loss = avg(p.hand.map((c) => valueFor(g, p, c)));
      return req.price >= loss + 0.3 - this.pr.greed * 0.6;
    }

    async pickBlind(g, pid, targetId, n) {
      await g.pause(400);
      return Math.floor(this.rng() * n);
    }

    async chooseTax(g, pid, targetId) {
      await g.pause(900);
      const p = g.players[pid], t = g.players[targetId];
      const options = [];
      for (const c of t.hand) options.push({ from: 'hand', cardId: c.id, card: c });
      for (const ind of C.IND_ORDER) for (const s of C.STAGE_ORDER) {
        const c = t.table[ind][s];
        if (c) options.push({ from: 'table', ind, stage: s, card: c });
      }
      if (!options.length) return null;
      let best = null;
      for (const o of options) {
        const gain = valueFor(g, p, o.card);
        let dmg = valueFor(g, t, o.card);
        if (o.from === 'table') dmg += filled(t, o.card.ind) * 1.2;
        const score = gain + dmg * (0.6 + this.pr.aggression * 0.4);
        if (!best || score > best.score) best = Object.assign({ score, gain }, o);
      }
      const mode = (best.gain >= 2 && p.hand.length < g.rules.handLimit + 1) ? 'take' : 'discard';
      return { from: best.from, cardId: best.cardId, ind: best.ind, stage: best.stage, mode };
    }

    async chooseExcess(g, pid, n) {
      const p = g.players[pid];
      return this.junk(g, p).slice(0, n).map((x) => x.c.id);
    }
  }

  const api = { Bot, PROFILES, valueFor, blindEstimate, progress };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HoldingAI = api;
})(typeof window !== 'undefined' ? window : globalThis);
