/* Интерфейс «Холдинга» */
(function () {
  'use strict';
  const C = window.HoldingCards, E = window.HoldingEngine, AI = window.HoldingAI;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const BOTS = [
    { name: 'Олег Нефтяник', ava: '🧔', profile: 'balanced' },
    { name: 'Инна Инвестор', ava: '👩‍💼', profile: 'trader' },
    { name: 'Аркадий Акула', ava: '🦈', profile: 'shark' },
    { name: 'Марина Магнат', ava: '👩‍🦰', profile: 'careful' },
  ];
  const HUMAN_AVAS = ['🙂', '😎', '🤠', '🧐'];
  const PROFILE_LABELS = { balanced: 'Бот: сбалансированный', trader: 'Бот: торговец', shark: 'Бот: акула', careful: 'Бот: осторожный' };
  const TYPE_ORDER = { stage: 0, wild: 1, tax: 2, sale: 3 };
  const CARD_BY_ID = {};
  for (const c of C.buildDeck()) CARD_BY_ID[c.id] = c;

  const S = {
    game: null, seats: null, humans: [], viewer: null,
    selected: null, mode: null, endTurn: null, busy: false,
    speed: 1, knownHand: new Set(), lastMoney: {}, renderQueued: false, curtainOpen: false,
  };

  // ======================== Карты ========================
  function cardHTML(card, opts) {
    opts = opts || {};
    const cls = ['card'];
    if (opts.cls) cls.push(opts.cls);
    const attrs = [];
    if (opts.zoom !== false) attrs.push(`data-zoom="${card.id}"`);
    if (opts.cid != null) attrs.push(`data-cid="${opts.cid}"`);
    if (opts.k != null) attrs.push(`data-k="${esc(opts.k)}"`);
    return `<div class="${cls.join(' ')}" ${attrs.join(' ')} title="${esc(card.title)}"><img src="${card.img}" alt="${esc(card.title)}" draggable="false"></div>`;
  }
  function backHTML(opts) {
    opts = opts || {};
    return `<div class="card back ${opts.cls || ''}" ${opts.k != null ? `data-k="${opts.k}"` : ''}><img src="${C.BACK_IMG}" alt="Рубашка" draggable="false"></div>`;
  }
  function sortHand(hand) {
    return hand.slice().sort((a, b) =>
      (TYPE_ORDER[a.type] - TYPE_ORDER[b.type]) ||
      (C.IND_ORDER.indexOf(a.ind) - C.IND_ORDER.indexOf(b.ind)) ||
      (C.STAGE_ORDER.indexOf(a.stage) - C.STAGE_ORDER.indexOf(b.stage)) ||
      ((b.tier || 0) - (a.tier || 0)) || (a.id - b.id));
  }

  // ======================== Модальные окна ========================
  function openModal(o) {
    const root = $('#modal-root');
    const ov = document.createElement('div');
    ov.className = 'overlay ' + (o.overlayCls || '');
    ov.innerHTML = `<div class="modal ${o.wide ? 'wide' : ''} ${o.cls || ''}">
      ${o.title ? `<h2>${o.title}</h2>` : ''}
      <div class="m-body">${o.html || ''}</div>
      ${(o.buttons && o.buttons.length) ? `<div class="btns">${o.buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-bi="${i}" ${b.disabled ? 'disabled' : ''}>${b.label}</button>`).join('')}</div>` : ''}
    </div>`;
    root.appendChild(ov);
    let resolve;
    const result = new Promise((r) => (resolve = r));
    const m = {
      el: ov,
      result,
      close(v) { ov.remove(); resolve(v); },
      btn(i) { return ov.querySelector(`[data-bi="${i}"]`); },
    };
    ov.addEventListener('click', (e) => {
      const b = e.target.closest('[data-bi]');
      if (b && !b.disabled) {
        const def = o.buttons[+b.dataset.bi];
        const v = def.value !== undefined ? def.value : def.label;
        if (def.onClick) { const r = def.onClick(m); if (r === false) return; }
        m.close(typeof v === 'function' ? v(m) : v);
        return;
      }
      if (o.dismiss && e.target === ov) m.close(o.dismissValue);
    });
    if (o.onMount) o.onMount(m);
    return m;
  }

  function zoomCard(card) {
    openModal({ html: `<div class="zoom">${cardHTML(card, { zoom: false })}<p><b>${esc(card.title)}</b></p></div>`, dismiss: true, buttons: [{ label: 'Закрыть', value: null }] });
  }

  function showRules() {
    openModal({ title: 'Правила игры «Холдинг»', wide: true, html: $('#rules-tpl').innerHTML, dismiss: true, buttons: [{ label: 'Понятно', cls: 'primary' }] });
  }

  function showGallery() {
    const uniq = {};
    for (const c of Object.values(CARD_BY_ID)) { const k = c.img; if (!uniq[k]) uniq[k] = c; }
    const groups = [
      ['Химическая промышленность', (c) => c.ind === 'chem' && c.type === 'stage'],
      ['Лесная промышленность', (c) => c.ind === 'forest' && c.type === 'stage'],
      ['Строительная промышленность', (c) => c.ind === 'build' && c.type === 'stage'],
      ['Особые карты', (c) => c.type !== 'stage'],
    ];
    const html = groups.map(([t, f]) => `<div class="section-label">${t}</div><div class="gallery">${Object.values(uniq).filter(f).map((c) => cardHTML(c)).join('')}</div>`).join('')
      + `<div class="section-label">Рубашка</div><div class="gallery">${backHTML()}</div>`;
    openModal({ title: 'Все карты колоды', wide: true, html, dismiss: true, buttons: [{ label: 'Закрыть' }] });
  }

  // ======================== Тосты и анимации ========================
  function toast(text, card, ms) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = (card ? cardHTML(card, { zoom: false }) : '') + `<div>${text}</div>`;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms || 2600);
  }
  function floatMoney(el, delta) {
    if (!el || !delta) return;
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const f = document.createElement('div');
    f.className = 'float-money' + (delta < 0 ? ' neg' : '');
    f.textContent = (delta > 0 ? '+$' : '−$') + Math.abs(delta);
    f.style.left = (r.left + r.width / 2 - 20) + 'px';
    f.style.top = (r.top - 4) + 'px';
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 1300);
  }

  // ======================== Меню ========================
  let customCount = 4;
  function defaultSeats(n, humansAll) {
    const seats = [];
    for (let i = 0; i < n; i++) {
      if (i === 0 || humansAll) seats.push({ name: humansAll ? 'Игрок ' + (i + 1) : 'Игрок', type: 'human', profile: 'balanced', ava: HUMAN_AVAS[i] });
      else { const b = BOTS[(i - 1) % BOTS.length]; seats.push({ name: b.name, type: 'bot', profile: b.profile, ava: b.ava }); }
    }
    return seats;
  }
  function renderSeats() {
    $('#seats').innerHTML = S.seats.map((s, i) => `
      <div class="seat" data-i="${i}">
        <span class="ava">${s.ava}</span>
        <input value="${esc(s.name)}" data-f="name" maxlength="18">
        <select data-f="type">
          <option value="human" ${s.type === 'human' ? 'selected' : ''}>Человек</option>
          ${Object.keys(PROFILE_LABELS).map((p) => `<option value="bot:${p}" ${s.type === 'bot' && s.profile === p ? 'selected' : ''}>${PROFILE_LABELS[p]}</option>`).join('')}
        </select>
      </div>`).join('');
    $$('#count-seg button').forEach((b) => b.classList.toggle('on', +b.dataset.n === S.seats.length));
    $('#target').value = E.DEFAULT_TARGETS[S.seats.length];
  }
  function openCustom(humansAll, n) {
    customCount = n || customCount;
    S.seats = defaultSeats(customCount, humansAll);
    $('#mode-pick').classList.add('hidden');
    $('#custom').classList.remove('hidden');
    renderSeats();
  }

  function initMenu() {
    $('#mode-pick').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mode]');
      if (!b) return;
      const m = b.dataset.mode;
      if (m === 'duel') startGame([{ name: 'Игрок', type: 'human', ava: '🙂' }, Object.assign({ type: 'bot' }, BOTS[2])]);
      else if (m === 'four') startGame(defaultSeats(4, false));
      else if (m === 'hotseat') openCustom(true, 2);
      else openCustom(false, 4);
    });
    $('#count-seg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-n]');
      if (!b) return;
      const n = +b.dataset.n;
      const allHuman = S.seats.every((s) => s.type === 'human');
      while (S.seats.length < n) {
        const i = S.seats.length;
        if (allHuman) S.seats.push({ name: 'Игрок ' + (i + 1), type: 'human', profile: 'balanced', ava: HUMAN_AVAS[i] });
        else { const bt = BOTS[(i - 1) % BOTS.length]; S.seats.push({ name: bt.name, type: 'bot', profile: bt.profile, ava: bt.ava }); }
      }
      S.seats.length = n;
      renderSeats();
    });
    $('#seats').addEventListener('input', (e) => {
      const row = e.target.closest('.seat');
      if (!row) return;
      const s = S.seats[+row.dataset.i];
      if (e.target.dataset.f === 'name') s.name = e.target.value.trim() || 'Игрок';
      if (e.target.dataset.f === 'type') {
        const v = e.target.value;
        if (v === 'human') { s.type = 'human'; s.ava = HUMAN_AVAS[+row.dataset.i]; }
        else { s.type = 'bot'; s.profile = v.split(':')[1]; const bt = BOTS.find((b) => b.profile === s.profile); s.ava = bt.ava; }
        row.querySelector('.ava').textContent = s.ava;
      }
    });
    $('#custom-back').addEventListener('click', () => { $('#custom').classList.add('hidden'); $('#mode-pick').classList.remove('hidden'); });
    $('#custom-start').addEventListener('click', () => {
      if (!S.seats.some((s) => s.type === 'human')) { toast('Нужен хотя бы один человек'); return; }
      startGame(S.seats.map((s) => Object.assign({}, s)), +$('#target').value || undefined);
    });
    document.addEventListener('click', (e) => {
      const o = e.target.closest('[data-open]');
      if (!o) return;
      if (o.dataset.open === 'rules') showRules();
      if (o.dataset.open === 'cards') showGallery();
    });
  }

  // ======================== Игра ========================
  class HumanController {
    async takeTurn(g, pid) {
      await ensureViewer(pid);
      S.selected = null; S.mode = null;
      if (S.humans.length === 1) toast('Ваш ход!', null, 1400);
      scheduleRender();
      return new Promise((res) => { S.endTurn = res; });
    }
    async respondOffer(g, pid, offer) {
      await ensureViewer(pid);
      const from = g.players[offer.from], me = g.players[pid];
      const claim = offer.claim && offer.claim !== 'none' ? `<p>Заявка продавца: <span class="claim-badge">${C.CLAIMS[offer.claim].label}</span><br><small style="color:var(--muted)">Заявка может быть блефом!</small></p>` : '<p style="color:var(--muted)">Продавец ничего не сказал о карте.</p>';
      const m = openModal({
        title: `${from.avatar} ${esc(from.name)} предлагает сделку`,
        html: `<div class="offer-card">${backHTML()}<div><p>Карта рубашкой вверх за <b class="money">$${offer.price}</b>.</p>${claim}<p>У вас: <b class="money">$${me.money}</b></p></div></div>`,
        buttons: [{ label: 'Отказаться', value: false }, { label: `Купить за $${offer.price}`, cls: 'primary', value: true, disabled: me.money < offer.price }],
      });
      const r = await m.result;
      await restoreViewer(g, pid);
      return r;
    }
    async respondRequest(g, pid, req) {
      await ensureViewer(pid);
      const from = g.players[req.from], me = g.players[pid];
      const m = openModal({
        title: `${from.avatar} ${esc(from.name)} хочет купить карту`,
        html: `<p>Предлагает <b class="money">$${req.price}</b> за одну вашу карту. Если согласитесь, покупатель сам вытянет <b>любую</b> карту из вашей руки по рубашке.</p>
               <div class="section-label">Ваша рука</div><div class="row-cards">${sortHand(me.hand).map((c) => cardHTML(c, { cls: 'static', zoom: false })).join('')}</div>`,
        buttons: [{ label: 'Не продавать', value: false }, { label: `Продать за $${req.price}`, cls: 'primary', value: true }],
      });
      const r = await m.result;
      await restoreViewer(g, pid);
      return r;
    }
    async pickBlind(g, pid, targetId, n) {
      await ensureViewer(pid);
      const t = g.players[targetId];
      const m = openModal({
        title: `Вытяните карту у ${esc(t.name)}`,
        html: `<p>${esc(t.name)} согласен. Выберите любую карту по рубашке:</p><div class="row-cards">${Array.from({ length: n }, (_, i) => backHTML({ k: i })).join('')}</div>`,
        onMount(mm) { mm.el.addEventListener('click', (e) => { const c = e.target.closest('[data-k]'); if (c) mm.close(+c.dataset.k); }); },
      });
      return m.result;
    }
    async chooseTax(g, pid, targetId) {
      await ensureViewer(pid);
      return taxModal(g, pid, targetId);
    }
    async chooseExcess(g, pid, n) {
      await ensureViewer(pid);
      const me = g.players[pid];
      const chosen = new Set();
      const m = openModal({
        title: 'Лимит руки — 7 карт',
        html: `<p>Выберите <b>${n}</b> ${plural(n, 'карту', 'карты', 'карт')} для распродажи банку по $${g.rules.dumpPrice}.</p><div class="row-cards">${sortHand(me.hand).map((c) => cardHTML(c, { k: c.id, zoom: false })).join('')}</div>`,
        buttons: [{ label: 'Распродать', cls: 'primary', disabled: true, value: () => Array.from(chosen) }],
        onMount(mm) {
          mm.el.addEventListener('click', (e) => {
            const c = e.target.closest('.row-cards [data-k]');
            if (!c) return;
            const id = +c.dataset.k;
            if (chosen.has(id)) chosen.delete(id); else if (chosen.size < n) chosen.add(id);
            c.classList.toggle('sel', chosen.has(id));
            mm.btn(0).disabled = chosen.size !== n;
          });
        },
      });
      return m.result;
    }
  }

  function plural(n, a, b, c) { const m10 = n % 10, m100 = n % 100; if (m10 === 1 && m100 !== 11) return a; if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return b; return c; }

  async function ensureViewer(pid) {
    if (S.humans.length <= 1) { S.viewer = pid; return; }
    if (S.viewer === pid) return;
    const p = S.game.players[pid];
    S.curtainOpen = true;
    const m = openModal({
      overlayCls: 'curtain',
      html: `<div class="big-ava">${p.avatar}</div><h2>Передайте устройство</h2><p>Сейчас действует <b>${esc(p.name)}</b>. Остальные — не подглядывайте!</p>`,
      buttons: [{ label: `Я — ${esc(p.name)}, показать мои карты`, cls: 'primary big' }],
    });
    await m.result;
    S.curtainOpen = false;
    S.viewer = pid;
    S.selected = null; S.mode = null;
    S.knownHand = new Set(p.hand.map((c) => c.id));
    renderNow();
  }
  async function restoreViewer(g, pid) {
    const c = g.cur;
    if (!g.over && c.type === 'human' && c.id !== pid) await ensureViewer(c.id);
  }

  function taxModal(g, pid, targetId) {
    const t = g.players[targetId];
    let pick = null;
    const tableCards = [];
    for (const ind of C.IND_ORDER) for (const s of C.STAGE_ORDER) { const c = t.table[ind][s]; if (c) tableCards.push({ c, ind, s }); }
    if (!t.hand.length && !tableCards.length) {
      return openModal({ title: 'Налоговая проверка', html: `<p>У ${esc(t.name)} нет ни одной карты.</p>`, buttons: [{ label: 'Закрыть', value: null }] }).result;
    }
    const m = openModal({
      title: `🏛 Налоговая проверка: ${t.avatar} ${esc(t.name)}`,
      wide: true,
      html: `<p>Вы видите все карты игрока. Выберите одну — заберите её себе или отправьте в сброс.</p>
        <div class="section-label">Рука (${t.hand.length})</div>
        <div class="row-cards">${t.hand.length ? sortHand(t.hand).map((c) => cardHTML(c, { k: 'h:' + c.id, zoom: false })).join('') : '<span style="color:var(--muted)">пусто</span>'}</div>
        <div class="section-label">Стол (${tableCards.length})</div>
        <div class="row-cards">${tableCards.length ? tableCards.map((x) => cardHTML(x.c, { k: `t:${x.ind}:${x.s}`, zoom: false })).join('') : '<span style="color:var(--muted)">пусто</span>'}</div>`,
      buttons: [
        { label: 'Отправить в сброс', cls: 'danger', disabled: true, value: () => mk('discard') },
        { label: 'Забрать себе', cls: 'primary', disabled: true, value: () => mk('take') },
      ],
      onMount(mm) {
        mm.el.addEventListener('click', (e) => {
          const c = e.target.closest('.row-cards [data-k]');
          if (!c) return;
          $$('.row-cards .card', mm.el).forEach((x) => x.classList.remove('sel'));
          c.classList.add('sel');
          pick = c.dataset.k;
          mm.btn(0).disabled = false; mm.btn(1).disabled = false;
        });
      },
    });
    function mk(mode) {
      const parts = pick.split(':');
      if (parts[0] === 'h') return { from: 'hand', cardId: +parts[1], mode };
      return { from: 'table', ind: parts[1], stage: parts[2], mode };
    }
    return m.result;
  }

  function startGame(seats, target) {
    if (S.game) S.game.aborted = true;
    $('#modal-root').innerHTML = '';
    S.seats = seats;
    S.humans = seats.map((s, i) => (s.type === 'human' ? i : -1)).filter((i) => i >= 0);
    const controllers = seats.map((s) => (s.type === 'human' ? new HumanController() : new AI.Bot(s.profile)));
    const g = new E.Game({
      players: seats.map((s) => ({ name: s.name, type: s.type, avatar: s.ava })),
      controllers,
      target,
      delay: (ms) => (g.aborted ? new Promise(() => {}) : sleep(ms * S.speed)),
    });
    S.game = g;
    S.viewer = S.humans[0];
    S.selected = null; S.mode = null; S.endTurn = null; S.busy = false;
    S.knownHand = new Set(g.players[S.viewer].hand.map((c) => c.id));
    S.lastMoney = {};
    for (const p of g.players) S.lastMoney[p.id] = p.money;
    $('#log').innerHTML = '';
    g.on(onEvent);
    $('#setup').classList.add('hidden');
    $('#game').classList.remove('hidden');
    $('#goal-v').textContent = '$' + g.target;
    renderNow();
    (async () => {
      if (S.humans.length > 1) { S.viewer = -1; await ensureViewer(S.humans[0]); }
      await g.run();
    })().catch((e) => { if (!g.aborted) { console.error(e); toast('Ошибка: ' + e.message); } });
  }

  function onEvent(type, d) {
    const g = S.game;
    if (!g || g.aborted) return;
    const v = S.viewer;
    switch (type) {
      case 'log': appendLog(d); break;
      case 'companySold': {
        const p = g.players[d.pid];
        toast(`${p.avatar} ${esc(p.name)} продаёт компанию «${C.INDUSTRIES[d.ind].short}» за <span class="money">$${d.value}</span>${d.clean ? ' · Чистый бизнес!' : ''}`, CARD_BY_ID[Object.values(CARD_BY_ID).find((c) => c.type === 'sale').id], 3000);
        break;
      }
      case 'buyBlind': if (d.pid === v) toast(`Из колоды: «${esc(d.card.title)}»`, d.card, 2200); break;
      case 'requestResult':
        if (d.accepted && d.from === v) toast(`Вы вытянули «${esc(d.card.title)}»`, d.card);
        if (d.accepted && d.to === v && S.humans.length === 1) toast(`У вас купили «${esc(d.card.title)}»`, d.card);
        break;
      case 'offerResult':
        if (d.accepted && d.to === v) toast(`Вы купили «${esc(d.card.title)}»`, d.card);
        break;
      case 'taxResult': {
        const f = g.players[d.from], t = g.players[d.to];
        if (d.to === v && S.humans.length === 1) toast(`🏛 Налоговая (${esc(f.name)}) ${d.mode === 'take' ? 'изъяла' : 'сбросила'} у вас «${esc(d.card.title)}»`, d.card, 3200);
        else if (d.from !== v) toast(`🏛 ${esc(f.name)} → ${esc(t.name)}: «${esc(d.card.title)}» ${d.mode === 'take' ? 'изъята' : 'в сброс'}`, d.card, 2600);
        break;
      }
      case 'gameOver': setTimeout(() => showVictory(d), 700); break;
    }
    scheduleRender();
  }

  function appendLog(e) {
    const el = document.createElement('div');
    el.className = 'e ' + e.kind;
    el.textContent = e.text;
    const log = $('#log');
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  function showVictory(d) {
    const g = S.game;
    const w = d.winner;
    const isMe = S.humans.includes(w.id);
    const rows = d.ranking.map((p, i) => `<tr class="${i === 0 ? 'first' : ''}"><td>${i + 1}</td><td>${p.avatar} ${esc(p.name)}</td><td class="money">$${p.money}</td><td>${p.companiesSold}</td><td>$${p.earned}</td></tr>`).join('');
    openModal({
      html: `<div class="win-ava">${isMe ? '🏆' : w.avatar}</div>
        <h2 class="win-title">${isMe && S.humans.length === 1 ? 'Вы победили!' : esc(w.name) + ' побеждает!'}</h2>
        <p style="text-align:center">${esc(d.reason)} Раундов сыграно: ${g.round}.</p>
        <table class="rank"><tr><th>#</th><th>Игрок</th><th>Капитал</th><th>Компаний продано</th><th>Заработано на продажах</th></tr>${rows}</table>`,
      buttons: [{ label: 'В меню', value: 'menu' }, { label: 'Сыграть ещё', cls: 'primary', value: 'again' }],
    }).result.then((v) => {
      if (v === 'again') startGame(S.seats.map((s) => Object.assign({}, s)), g.target);
      else toMenu();
    });
  }

  function toMenu() {
    if (S.game) S.game.aborted = true;
    S.game = null;
    $('#modal-root').innerHTML = '';
    $('#game').classList.add('hidden');
    $('#setup').classList.remove('hidden');
    $('#custom').classList.add('hidden');
    $('#mode-pick').classList.remove('hidden');
  }

  // ======================== Действия игрока ========================
  function canAct() {
    const g = S.game;
    return g && !g.over && g.phase === 'actions' && g.cur.type === 'human' && g.current === S.viewer && !S.busy && !S.curtainOpen && !!S.endTurn;
  }
  async function act(fn) {
    if (!canAct()) return;
    S.busy = true;
    try { await fn(); } catch (e) { toast('⚠️ ' + esc(e.message)); }
    S.busy = false;
    const me = S.game && S.game.players[S.viewer];
    if (me && S.selected != null && !me.hand.some((c) => c.id === S.selected)) { S.selected = null; S.mode = null; }
    renderNow();
  }

  function completeCompanies(p) { return C.IND_ORDER.filter((ind) => S.game.isComplete(p, ind)); }

  function chooseOpponent(title, filter, extra) {
    const g = S.game;
    const opps = g.opponents(S.viewer);
    let pick = null;
    const m = openModal({
      title,
      html: `<div class="choice-list">${opps.map((p) => {
        const ok = filter(p);
        return `<div class="choice ${ok ? '' : 'disabled'}" data-p="${ok ? p.id : ''}" style="${ok ? '' : 'opacity:.4;cursor:not-allowed'}">
          <span class="ava">${p.avatar}</span><div class="grow"><b>${esc(p.name)}</b><small>карт на руке: ${p.hand.length} · на столе: ${tableCount(p)}</small></div><span class="money">$${p.money}</span></div>`;
      }).join('')}</div>${extra ? extra.html : ''}`,
      dismiss: true, dismissValue: null,
      buttons: [{ label: 'Отмена', value: null }, { label: extra ? extra.ok : 'Выбрать', cls: 'primary', disabled: true, value: () => ({ target: pick, m }) }],
      onMount(mm) {
        mm.el.addEventListener('click', (e) => {
          const c = e.target.closest('.choice[data-p]');
          if (!c || c.dataset.p === '') return;
          $$('.choice', mm.el).forEach((x) => x.classList.remove('on'));
          c.classList.add('on');
          pick = +c.dataset.p;
          mm.btn(1).disabled = false;
        });
        if (extra && extra.mount) extra.mount(mm);
      },
    });
    return m.result;
  }
  function tableCount(p) { let n = 0; for (const ind of C.IND_ORDER) for (const s of C.STAGE_ORDER) if (p.table[ind][s]) n++; return n; }

  function stepperHTML(v) {
    return `<div class="field"><label>Цена:</label><div class="stepper"><button data-st="-1">−</button><span class="v">$${v}</span><button data-st="1">+</button></div></div>`;
  }
  function mountStepper(mm, state, max) {
    mm.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-st]');
      if (!b) return;
      state.price = Math.max(1, Math.min(max(), state.price + +b.dataset.st));
      $('.stepper .v', mm.el).textContent = '$' + state.price;
    });
  }

  const handlers = {
    build(card) {
      if (card.type === 'wild') { S.mode = S.mode === 'wild' ? null : 'wild'; renderNow(); return; }
      act(() => S.game.build(S.viewer, card.id));
    },
    sellBank(card) { act(() => S.game.sellBlind(S.viewer, card.id)); },
    offer(card) {
      if (!canAct()) return;
      const st = { price: 3, claim: 'none' };
      const claims = Object.entries(C.CLAIMS).map(([k, c]) => `<option value="${k}">${c.label}</option>`).join('');
      chooseOpponent('Продать карту игроку в тёмную', (p) => p.money >= 1, {
        ok: 'Предложить',
        html: `<div class="offer-card" style="margin-top:12px">${cardHTML(card, { zoom: false })}<div style="flex:1">
          ${stepperHTML(st.price)}
          <div class="field"><label>Заявка:</label><select id="claim-sel">${claims}</select></div>
          <p style="font-size:13px;color:var(--muted)">Покупатель увидит только рубашку и вашу заявку. Заявка может быть неправдой.</p></div></div>`,
        mount(mm) { mountStepper(mm, st, () => S.game.rules.maxOfferPrice); },
      }).then((r) => {
        if (!r || r.target == null) return;
        st.claim = $('#claim-sel', r.m.el) ? $('#claim-sel', r.m.el).value : st.claim;
        act(() => S.game.offer(S.viewer, r.target, card.id, st.price, st.claim));
      });
    },
    sale(card) {
      const me = S.game.players[S.viewer];
      const ready = completeCompanies(me);
      if (!ready.length) { toast('Нет собранной компании: нужны все 4 этапа одной отрасли'); return; }
      if (ready.length === 1) { act(() => S.game.sellCompany(S.viewer, ready[0], card.id)); return; }
      S.mode = S.mode === 'sale' ? null : 'sale'; renderNow();
    },
    tax(card) {
      if (!canAct()) return;
      chooseOpponent('Кого проверит налоговая?', () => true).then((r) => {
        if (!r || r.target == null) return;
        act(() => S.game.playTax(S.viewer, r.target, card.id));
      });
    },
    zoom(card) { zoomCard(card); },
  };

  function requestFlow() {
    if (!canAct()) return;
    const g = S.game, me = g.players[S.viewer];
    const st = { price: Math.min(4, me.money) };
    if (st.price < 1) { toast('Нет денег'); return; }
    chooseOpponent('Купить карту у игрока в тёмную', (p) => p.hand.length > 0, {
      ok: 'Предложить цену',
      html: `<div style="margin-top:10px">${stepperHTML(st.price)}<p style="font-size:13px;color:var(--muted)">Если продавец согласится, вы вытянете любую карту из его руки по рубашке.</p></div>`,
      mount(mm) { mountStepper(mm, st, () => Math.min(g.rules.maxOfferPrice, me.money)); },
    }).then((r) => {
      if (!r || r.target == null) return;
      act(() => g.requestBuy(S.viewer, r.target, st.price));
    });
  }

  function initGameEvents() {
    $('#speed').addEventListener('change', (e) => { S.speed = +e.target.value; });
    $('#to-menu').addEventListener('click', () => {
      openModal({ title: 'Выйти в меню?', html: '<p>Текущая партия будет потеряна.</p>', dismiss: true, buttons: [{ label: 'Остаться', value: false }, { label: 'Выйти', cls: 'danger', value: true }] })
        .result.then((v) => { if (v) toMenu(); });
    });
    $('#game').addEventListener('click', (e) => {
      const g = S.game;
      if (!g) return;
      const me = g.players[S.viewer];
      // кнопки панели
      const a = e.target.closest('[data-act]');
      if (a) {
        const k = a.dataset.act;
        if (k === 'buy') act(() => g.buyBlind(S.viewer));
        else if (k === 'request') requestFlow();
        else if (k === 'end') { if (canAct()) { const f = S.endTurn; S.endTurn = null; S.selected = null; S.mode = null; renderNow(); f(); } }
        else if (k === 'cancel') { S.mode = null; renderNow(); }
        else {
          const card = me.hand.find((c) => c.id === S.selected);
          if (card && handlers[k]) handlers[k](card);
        }
        return;
      }
      // слот для универсальной карты
      const slot = e.target.closest('.slot.targetable');
      if (slot && S.mode === 'wild') { const id = S.selected; act(() => g.build(S.viewer, id, slot.dataset.slot)); S.mode = null; return; }
      const co = e.target.closest('.company.targetable');
      if (co && S.mode === 'sale') { const id = S.selected; S.mode = null; act(() => g.sellCompany(S.viewer, co.dataset.ind, id)); return; }
      // клик по карте руки
      const hc = e.target.closest('#hand .card[data-cid]');
      if (hc) {
        const id = +hc.dataset.cid;
        S.selected = S.selected === id ? null : id;
        S.mode = null;
        renderNow();
        return;
      }
      if (e.target.closest('#deck') && canAct()) { act(() => g.buyBlind(S.viewer)); return; }
      const z = e.target.closest('[data-zoom]');
      if (z) { zoomCard(CARD_BY_ID[+z.dataset.zoom]); }
    });
    $('#game').addEventListener('dblclick', (e) => {
      const hc = e.target.closest('#hand .card[data-cid]');
      if (!hc || !S.game) return;
      const card = S.game.players[S.viewer].hand.find((c) => c.id === +hc.dataset.cid);
      if (card && card.type === 'stage') { S.selected = null; act(() => S.game.build(S.viewer, card.id)); }
    });
  }

  // ======================== Отрисовка ========================
  function scheduleRender() {
    if (S.renderQueued) return;
    S.renderQueued = true;
    requestAnimationFrame(() => { S.renderQueued = false; renderNow(); });
  }

  function renderNow() {
    const g = S.game;
    if (!g) return;
    const v = S.viewer >= 0 ? S.viewer : S.humans[0];
    const me = g.players[v];
    $('#round-v').textContent = g.round;

    // соперники
    const order = [];
    for (let k = 1; k < g.players.length; k++) order.push(g.players[(v + k) % g.players.length]);
    $('#opponents').innerHTML = order.map((p) => {
      const backs = Array.from({ length: Math.min(p.hand.length, 9) }, () => backHTML()).join('');
      const rows = C.IND_ORDER.map((ind) => `<div class="mini-row ${g.isComplete(p, ind) ? 'complete' : ''}" style="--ind:${C.INDUSTRIES[ind].color}">${C.STAGE_ORDER.map((s) => {
        const c = p.table[ind][s];
        return `<div class="mini-slot">${c ? cardHTML(c) : ''}</div>`;
      }).join('')}</div>`).join('');
      return `<div class="opp ${g.current === p.id && !g.over ? 'active' : ''}" data-pid="${p.id}">
        <div class="opp-head"><span class="ava">${p.avatar}</span><span class="nm">${esc(p.name)}</span><span class="money" data-money="${p.id}">$${p.money}</span></div>
        <div class="opp-sub"><div class="opp-hand">${backs}<span class="cnt">${p.hand.length} ${plural(p.hand.length, 'карта', 'карты', 'карт')}</span></div>
        <div class="opp-stats">продано: ${p.companiesSold}${p.type === 'bot' ? '<br>бот' : ''}</div></div>
        <div class="mini-table">${rows}</div></div>`;
    }).join('');

    // колода и сброс
    const dn = g.deck.length;
    $('#deck').innerHTML = dn ? Array.from({ length: Math.min(3, dn) }, () => backHTML()).join('') : '';
    $('#deck').classList.toggle('empty', !dn);
    $('#deck').style.cursor = canAct() ? 'pointer' : '';
    $('#deck-label').textContent = `Колода · ${dn}`;
    const top = g.discard[g.discard.length - 1];
    $('#discard').innerHTML = top ? cardHTML(top) : '';
    $('#discard').classList.toggle('empty', !top);
    $('#discard-label').textContent = `Сброс · ${g.discard.length}`;

    // статус
    const cur = g.cur;
    let who, hint;
    if (g.over) { who = 'Игра окончена'; hint = `Победитель — ${esc(g.winner.name)}`; }
    else if (g.phase === 'waiting') { who = `${cur.avatar} Ход: ${esc(cur.name)}`; hint = 'Ожидание ответа на сделку…'; }
    else if (cur.id === v && cur.type === 'human') {
      who = S.humans.length > 1 ? `${cur.avatar} Ход: ${esc(cur.name)}` : '🟢 Ваш ход';
      hint = contextHint(me);
    } else { who = `${cur.avatar} Ходит ${esc(cur.name)}…`; hint = cur.type === 'bot' ? 'Бот думает и торгует. Следите за журналом.' : 'Ждём другого игрока.'; }
    $('#status').innerHTML = `<div class="who">${who}</div><div class="hint">${hint}</div>`;

    // моя панель
    const my = canAct();
    const actions = g.current === v ? g.actionsLeft : 0;
    $('#me').classList.toggle('active', my);
    const pct = Math.min(100, Math.round(100 * me.money / g.target));
    $('#me-bar').innerHTML = `
      <div class="me-name"><span class="ava">${me.avatar}</span>${esc(me.name)}</div>
      <div class="money me-money" data-money="${me.id}">$${me.money}</div>
      <div class="progress-wrap"><div class="progress"><div style="width:${pct}%"></div></div><span>до цели $${g.target}: ещё $${Math.max(0, g.target - me.money)}</span></div>
      <div class="pips" title="Сделки на этот ход">${Array.from({ length: g.rules.actionsPerTurn }, (_, i) => `<span class="pip ${i < actions ? '' : 'used'}"></span>`).join('')}<span>сделки</span></div>
      <div class="me-buttons">
        <button class="btn" data-act="buy" ${my && actions > 0 && me.money >= g.rules.buyPrice && g.canDraw() ? '' : 'disabled'}>🂠 Купить у банка · $${g.rules.buyPrice}</button>
        <button class="btn" data-act="request" ${my && actions > 0 && me.money >= 1 ? '' : 'disabled'}>🤝 Купить у игрока</button>
        <button class="btn primary" data-act="end" ${my ? '' : 'disabled'}>Завершить ход ➜</button>
      </div>`;

    // компании
    const selCard = me.hand.find((c) => c.id === S.selected);
    $('#companies').innerHTML = C.IND_ORDER.map((ind) => {
      const info = C.INDUSTRIES[ind];
      const n = g.filled(me, ind);
      const val = g.companyValue(me, ind);
      const complete = n === 4;
      const saleT = S.mode === 'sale' && complete;
      return `<div class="company ${complete ? 'complete' : ''} ${saleT ? 'targetable' : ''}" data-ind="${ind}" style="--ind:${info.color}">
        <div class="co-head"><span class="dot"></span>${info.short}<span class="val">${n}/4 · ${complete ? 'продажа' : 'сейчас'} <b>$${val.value}</b>${val.clean ? ' ✨' : ''}</span></div>
        <div class="slots">${C.STAGE_ORDER.map((s) => {
          const c = me.table[ind][s];
          const wildT = S.mode === 'wild' && selCard && selCard.type === 'wild' && selCard.ind === ind;
          return `<div class="slot ${wildT ? 'targetable' : ''}" data-slot="${s}" data-ind="${ind}">${c ? cardHTML(c, { zoom: !wildT }) : C.STAGES[s]}</div>`;
        }).join('')}</div></div>`;
    }).join('');

    // рука
    const hand = sortHand(me.hand);
    $('#hand').innerHTML = hand.length ? hand.map((c) => cardHTML(c, { cid: c.id, zoom: false, cls: (c.id === S.selected ? 'sel ' : '') + (S.knownHand.has(c.id) ? '' : 'new') })).join('') : '<div class="empty-hand">На руке нет карт</div>';
    S.knownHand = new Set(me.hand.map((c) => c.id));

    // действия выбранной карты
    $('#sel-actions').innerHTML = selCard ? selActionsHTML(selCard, me, my, actions) : '';

    // всплывающие деньги
    for (const p of g.players) {
      const prev = S.lastMoney[p.id];
      if (prev != null && prev !== p.money) floatMoney($(`[data-money="${p.id}"]`), p.money - prev);
      S.lastMoney[p.id] = p.money;
    }
  }

  function selActionsHTML(card, me, my, actions) {
    const g = S.game;
    const b = (act, label, ok, cls) => `<button class="btn small ${cls || ''}" data-act="${act}" ${ok ? '' : 'disabled'}>${label}</button>`;
    const out = [`<span class="title">${esc(card.title)}</span>`];
    if (S.mode === 'wild') return `<span class="title">Выберите место в компании «${C.INDUSTRIES[card.ind].short}»</span>` + b('cancel', 'Отмена', true, 'ghost');
    if (S.mode === 'sale') return '<span class="title">Выберите собранную компанию для продажи</span>' + b('cancel', 'Отмена', true, 'ghost');
    if (card.type === 'stage') {
      const cur = me.table[card.ind][card.stage];
      out.push(b('build', cur ? `Построить (заменить «${esc(cur.title)}»)` : 'Построить', my, 'primary'));
    }
    if (card.type === 'wild') out.push(b('build', 'Построить…', my, 'primary'));
    if (card.type === 'sale') out.push(b('sale', 'Продать компанию', my && completeCompanies(me).length > 0, 'primary'));
    if (card.type === 'tax') out.push(b('tax', 'Налоговая проверка', my && actions > 0, 'primary'));
    out.push(b('sellBank', `Продать банку · +$${g.rules.sellPrice}`, my && actions > 0));
    out.push(b('offer', 'Предложить игроку', my && actions > 0));
    out.push(b('zoom', '🔍', true, 'ghost'));
    return out.join('');
  }

  function contextHint(me) {
    const g = S.game;
    const hasSale = me.hand.some((c) => c.type === 'sale');
    const ready = completeCompanies(me);
    if (ready.length && hasSale) return '💰 Компания собрана и есть «Продажа» — выберите карту «Продажа» и продайте!';
    if (ready.length) return 'Компания собрана — нужна карта «Продажа». Купите в тёмную или проверьте соперника налоговой.';
    const buildable = me.hand.filter((c) => c.type === 'stage' && (!me.table[c.ind][c.stage] || me.table[c.ind][c.stage].type === 'wild' || c.tier > me.table[c.ind][c.stage].tier));
    if (buildable.length) return `Можно построить ${buildable.length} ${plural(buildable.length, 'этап', 'этапа', 'этапов')} (двойной клик по карте). Стройка бесплатна.`;
    if (g.actionsLeft > 0) return `Осталось сделок: ${g.actionsLeft}. Выберите карту на руке или купите новую.`;
    return 'Сделки закончились. Достройте что нужно и завершите ход.';
  }

  // ======================== Старт ========================
  initMenu();
  initGameEvents();
  window.HoldingUI = { S, startGame };
})();
