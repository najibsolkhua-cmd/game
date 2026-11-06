/* Интерфейс «Холдинга»: всё на одном экране, действия перетаскиванием (мышь и палец), таймер хода, темы. */
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
  const THEMES = [
    { id: 'emerald', name: 'Изумруд', bg: 'linear-gradient(135deg,#1b5a43,#0b2a20)' },
    { id: 'midnight', name: 'Полночь', bg: 'linear-gradient(135deg,#1d3150,#0b1220)' },
    { id: 'graphite', name: 'Графит', bg: 'linear-gradient(135deg,#2a3037,#131518)' },
    { id: 'wine', name: 'Бордо', bg: 'linear-gradient(135deg,#42202b,#1c0c12)' },
    { id: 'coffee', name: 'Кофе', bg: 'linear-gradient(135deg,#3a2e23,#1a140f)' },
    { id: 'dusk', name: 'Сумерки', bg: 'linear-gradient(135deg,#312a45,#15131e)' },
  ];
  const TYPE_ORDER = { stage: 0, wild: 1, sale: 2, tax: 3, lawyer: 4, share: 5 };
  const CARD_BY_ID = {};
  for (const c of C.buildDeck()) CARD_BY_ID[c.id] = c;
  for (const c of C.buildEventDeck()) CARD_BY_ID[c.id] = c;
  const SALE_CARD = Object.values(CARD_BY_ID).find((c) => c.type === 'sale');
  const RESPONSE_SECONDS = 20;
  const STAGE_SHORT = { raw: 'Сырьё', prod: 'Произв.', store: 'Склад', trans: 'Трансп.' };

  const S = {
    game: null, seats: null, humans: [], viewer: null, events: true,
    endTurn: null, busy: false,
    knownHand: new Set(), lastMoney: {}, renderQueued: false, curtainOpen: false,
    modals: new Set(), timer: null, timedOutPid: null,
    settings: { theme: 'emerald', timer: 60, speed: 1 },
  };

  // ======================== Настройки ========================
  function loadSettings() {
    try { Object.assign(S.settings, JSON.parse(localStorage.getItem('holding-settings') || '{}')); } catch (e) { /* приватный режим */ }
    applyTheme();
  }
  function saveSettings() { try { localStorage.setItem('holding-settings', JSON.stringify(S.settings)); } catch (e) { /* нет хранилища */ } }
  function applyTheme() {
    const t = THEMES.find((x) => x.id === S.settings.theme) ? S.settings.theme : 'emerald';
    document.documentElement.dataset.theme = t;
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--felt').trim() || '#0b2a20';
  }
  function showSettings() {
    const seg = (name, opts, cur) => `<div class="seg" data-set="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(v) === String(cur) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    openModal({
      title: '⚙️ Настройки',
      html: `<div class="settings-grid">
        <div><div class="lbl">Тема стола</div><div class="themes">${THEMES.map((t) => `<div class="theme-sw ${t.id === S.settings.theme ? 'on' : ''}" data-theme="${t.id}" style="background:${t.bg}">${t.name}</div>`).join('')}</div></div>
        <div><div class="lbl">Таймер хода</div>${seg('timer', [[0, 'Выкл'], [30, '30 с'], [60, '60 с'], [90, '90 с'], [120, '2 мин']], S.settings.timer)}</div>
        <div><div class="lbl">Скорость ботов</div>${seg('speed', [[1.6, 'Медленно'], [1, 'Обычно'], [0.4, 'Быстро']], S.settings.speed)}</div>
      </div>`,
      dismiss: true, buttons: [{ label: 'Готово', cls: 'primary' }],
      onMount(mm) {
        mm.el.addEventListener('click', (e) => {
          const sw = e.target.closest('.theme-sw');
          if (sw) { S.settings.theme = sw.dataset.theme; $$('.theme-sw', mm.el).forEach((x) => x.classList.toggle('on', x === sw)); applyTheme(); saveSettings(); }
          const b = e.target.closest('[data-set] button');
          if (b) {
            const k = b.parentElement.dataset.set;
            S.settings[k] = +b.dataset.v;
            $$('button', b.parentElement).forEach((x) => x.classList.toggle('on', x === b));
            saveSettings();
            if (k === 'timer') { if (S.timer) { stopTimer(); if (canAct() && S.settings.timer > 0) startTimer(S.viewer); } renderNow(); }
          }
        });
      },
    });
  }

  // ======================== Карты ========================
  function cardHTML(card, opts) {
    opts = opts || {};
    const attrs = [];
    if (opts.zoom !== false) attrs.push(`data-zoom="${card.id}"`);
    if (opts.cid != null) attrs.push(`data-cid="${opts.cid}"`);
    if (opts.drag) attrs.push(`data-drag="${opts.drag}"`);
    if (opts.k != null) attrs.push(`data-k="${esc(opts.k)}"`);
    return `<div class="card ${opts.cls || ''}" ${attrs.join(' ')} title="${esc(card.title)}"><img src="${card.img}" alt="${esc(card.title)}" draggable="false">${opts.flag || ''}</div>`;
  }
  function backHTML(opts) {
    opts = opts || {};
    return `<div class="card back ${opts.cls || ''}" ${opts.k != null ? `data-k="${opts.k}"` : ''}><img src="${opts.img || C.BACK_IMG}" alt="Рубашка" draggable="false"></div>`;
  }
  function sortHand(hand) {
    return hand.slice().sort((a, b) =>
      (TYPE_ORDER[a.type] - TYPE_ORDER[b.type]) ||
      (C.IND_ORDER.indexOf(a.ind) - C.IND_ORDER.indexOf(b.ind)) ||
      (C.STAGE_ORDER.indexOf(a.stage) - C.STAGE_ORDER.indexOf(b.stage)) ||
      ((b.tier || 0) - (a.tier || 0)) || (a.id - b.id));
  }
  function plural(n, a, b, c) { const m10 = n % 10, m100 = n % 100; if (m10 === 1 && m100 !== 11) return a; if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return b; return c; }
  /** Нужна ли карта игроку p: закрывает пустое место, заменяет универсальную или улучшает этап. */
  function usefulFor(g, p, c) {
    if (c.type === 'stage') return g.improves(p, c);
    if (c.type === 'wild') return C.STAGE_ORDER.some((s) => !p.table[c.ind][s]);
    return false;
  }

  // ======================== Модальные окна ========================
  /**
   * o.auto — значение (или функция) при истечении времени хода; o.countdown — свои секунды на ответ;
   * o.forPid — чей это диалог (для таймера).
   */
  function openModal(o) {
    const ov = document.createElement('div');
    ov.className = 'overlay ' + (o.overlayCls || '');
    ov.innerHTML = `<div class="modal ${o.wide ? 'wide' : ''} ${o.cls || ''}">
      ${o.countdown ? `<div class="countdown"><div style="animation-duration:${o.countdown}s"></div></div>` : ''}
      ${o.title ? `<h2>${o.title}</h2>` : ''}
      <div class="m-body">${o.html || ''}</div>
      ${(o.buttons && o.buttons.length) ? `<div class="btns">${o.buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-bi="${i}" ${b.disabled ? 'disabled' : ''}>${b.label}</button>`).join('')}</div>` : ''}
    </div>`;
    $('#modal-root').appendChild(ov);
    let resolve, cdTimer = null;
    const result = new Promise((r) => (resolve = r));
    const m = {
      el: ov, result, o,
      close(v) {
        if (!ov.isConnected) return;
        ov.remove(); S.modals.delete(m); if (cdTimer) clearTimeout(cdTimer); resolve(v);
      },
      autoClose() {
        if (o.auto !== undefined) m.close(typeof o.auto === 'function' ? o.auto(m) : o.auto);
        else if (o.dismiss) m.close(o.dismissValue);
      },
      btn(i) { return ov.querySelector(`[data-bi="${i}"]`); },
    };
    S.modals.add(m);
    ov.addEventListener('click', (e) => {
      const b = e.target.closest('[data-bi]');
      if (b && !b.disabled) {
        const def = o.buttons[+b.dataset.bi];
        const v = def.value !== undefined ? def.value : def.label;
        m.close(typeof v === 'function' ? v(m) : v);
        return;
      }
      if (o.dismiss && e.target === ov) m.close(o.dismissValue);
    });
    if (o.onMount) o.onMount(m);
    if (o.countdown) cdTimer = setTimeout(() => m.autoClose(), o.countdown * 1000);
    // ход уже истёк — обязательные диалоги игрока закрываются сразу
    if (o.forPid != null && o.forPid === S.timedOutPid && o.auto !== undefined) setTimeout(() => m.autoClose(), 0);
    return m;
  }
  const responseCountdown = () => (S.settings.timer > 0 ? RESPONSE_SECONDS : 0);

  function showRules() {
    openModal({ title: 'Правила игры «Холдинг»', wide: true, html: $('#rules-tpl').innerHTML, dismiss: true, buttons: [{ label: 'Понятно', cls: 'primary' }] });
  }
  function showGallery() {
    const uniq = {};
    for (const c of Object.values(CARD_BY_ID)) if (!uniq[c.img]) uniq[c.img] = c;
    const all = Object.values(uniq);
    const groups = [
      ['Химическая промышленность', (c) => c.ind === 'chem' && c.type === 'stage'],
      ['Лесная промышленность', (c) => c.ind === 'forest' && c.type === 'stage'],
      ['Строительная промышленность', (c) => c.ind === 'build' && c.type === 'stage'],
      ['Особые карты', (c) => ['wild', 'sale', 'tax', 'lawyer', 'share'].includes(c.type)],
      ['События рынка (отдельная колода)', (c) => c.type === 'event'],
    ];
    const html = groups.map(([t, f]) => `<div class="section-label">${t}</div><div class="gallery">${all.filter(f).map((c) => cardHTML(c)).join('')}</div>`).join('')
      + `<div class="section-label">Рубашки</div><div class="gallery">${backHTML()}${backHTML({ img: C.EVENT_BACK_IMG })}${backHTML({ img: 'assets/cards/back-classic.svg' })}</div>`;
    openModal({ title: 'Все карты', wide: true, html, dismiss: true, buttons: [{ label: 'Закрыть' }] });
  }

  // ======================== Тосты ========================
  function toast(text, card, ms, big) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast' + (big ? ' big' : '');
    el.innerHTML = (card ? cardHTML(card, { zoom: false }) : '') + `<div>${text}</div>`;
    box.appendChild(el);
    while (box.children.length > (window.innerWidth < 700 ? 1 : 4)) box.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, Math.min(ms || 2600, window.innerWidth < 700 ? 2200 : 99999));
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

  // ======================== Таймер хода ========================
  function startTimer(pid) {
    stopTimer();
    if (!(S.settings.timer > 0)) { renderTimer(); return; }
    S.timer = { pid, deadline: Date.now() + S.settings.timer * 1000, iv: setInterval(tickTimer, 250) };
    renderTimer();
  }
  function stopTimer() {
    if (S.timer) clearInterval(S.timer.iv);
    S.timer = null;
    renderTimer();
  }
  function tickTimer() {
    if (!S.timer) return;
    if (S.busy && S.game && S.game.phase === 'waiting') S.timer.deadline += 250; // пока ждём ответа соперника — время не идёт
    renderTimer();
    if (Date.now() >= S.timer.deadline) {
      const pid = S.timer.pid;
      stopTimer();
      S.timedOutPid = pid;
      toast('⏱ Время хода вышло');
      for (const m of Array.from(S.modals)) if (m.o.forPid === pid || m.o.dismiss) m.autoClose();
      tryAutoEnd();
    }
  }
  function renderTimer() {
    const el = $('#timer');
    if (!el) return;
    if (!S.timer) { el.classList.add('off'); return; }
    const left = Math.max(0, Math.ceil((S.timer.deadline - Date.now()) / 1000));
    el.classList.remove('off');
    el.classList.toggle('warn', left <= 20 && left > 10);
    el.classList.toggle('crit', left <= 10);
    el.textContent = `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  }
  function tryAutoEnd() {
    if (S.timedOutPid != null && S.timedOutPid === S.viewer && canAct()) endTurnNow();
  }
  function endTurnNow() {
    const f = S.endTurn;
    if (!f) return;
    S.endTurn = null;
    stopTimer();
    renderNow();
    f();
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
      S.events = true;
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
        else { s.type = 'bot'; s.profile = v.split(':')[1]; s.ava = BOTS.find((b) => b.profile === s.profile).ava; }
        row.querySelector('.ava').textContent = s.ava;
      }
    });
    $('#custom-back').addEventListener('click', () => { $('#custom').classList.add('hidden'); $('#mode-pick').classList.remove('hidden'); });
    $('#custom-start').addEventListener('click', () => {
      if (!S.seats.some((s) => s.type === 'human')) { toast('Нужен хотя бы один человек'); return; }
      S.events = $('#opt-events').checked;
      startGame(S.seats.map((s) => Object.assign({}, s)), +$('#target').value || undefined);
    });
    document.addEventListener('click', (e) => {
      const o = e.target.closest('[data-open]');
      if (!o) return;
      if (o.dataset.open === 'rules') showRules();
      if (o.dataset.open === 'cards') showGallery();
      if (o.dataset.open === 'settings') showSettings();
    });
  }

  // ======================== Контроллер человека ========================
  class HumanController {
    async takeTurn(g, pid) {
      await ensureViewer(pid);
      S.timedOutPid = null;
      if (S.humans.length === 1 && g.round <= 2) toast('Ваш ход! Перетаскивайте карты.', null, 1500);
      startTimer(pid);
      scheduleRender();
      return new Promise((res) => { S.endTurn = res; });
    }
    async respondOffer(g, pid, offer) {
      await ensureViewer(pid);
      const from = g.players[offer.from], me = g.players[pid];
      const m = openModal({
        title: `${from.avatar} ${esc(from.name)} предлагает сделку`,
        html: `<div class="offer-card">${backHTML()}<div><p>Карта рубашкой вверх за <b class="money">$${offer.price}</b>.</p>${claimHTML(offer.claim)}<p>У вас: <b class="money">$${me.money}</b></p></div></div>`,
        buttons: [{ label: 'Отказаться', value: false }, { label: `Купить за $${offer.price}`, cls: 'primary', value: true, disabled: me.money < offer.price }],
        auto: false, countdown: responseCountdown(),
      });
      const r = await m.result;
      await restoreViewer(g, pid);
      return r;
    }
    async bidAuction(g, pid, auc) {
      await ensureViewer(pid);
      const from = g.players[auc.from], me = g.players[pid];
      const st = { price: Math.min(2, me.money) };
      const m = openModal({
        title: `🔨 Аукцион вслепую: ${from.avatar} ${esc(from.name)}`,
        html: `<div class="offer-card">${backHTML()}<div>${claimHTML(auc.claim)}
          <p>Ставки закрытые: побеждает самая высокая. У вас <b class="money">$${me.money}</b>.</p>${stepperHTML(st.price)}</div></div>`,
        buttons: [{ label: 'Пас', value: 0 }, { label: 'Сделать ставку', cls: 'primary', value: () => st.price }],
        onMount(mm) { mountStepper(mm, st, () => me.money, 0); },
        auto: 0, countdown: responseCountdown(),
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
        auto: false, countdown: responseCountdown(),
      });
      const r = await m.result;
      await restoreViewer(g, pid);
      return r;
    }
    async useLawyer(g, pid, info) {
      // Юрист срабатывает автоматически
      const from = g.players[info.from];
      if (S.humans.length === 1 || S.viewer === pid) toast(`⚖️ Ваш юрист отбил налоговую проверку (${esc(from.name)})`, CARD_BY_ID[Object.values(CARD_BY_ID).find((c) => c.type === 'lawyer').id], 3000);
      return true;
    }
    async pickBlind(g, pid, targetId, n) {
      await ensureViewer(pid);
      const t = g.players[targetId];
      const m = openModal({
        title: `Вытяните карту у ${esc(t.name)}`,
        html: `<p>Сделка! Выберите любую карту по рубашке:</p><div class="row-cards">${Array.from({ length: n }, (_, i) => backHTML({ k: i })).join('')}</div>`,
        onMount(mm) { mm.el.addEventListener('click', (e) => { const c = e.target.closest('[data-k]'); if (c) mm.close(+c.dataset.k); }); },
        forPid: pid, auto: () => Math.floor(Math.random() * n),
      });
      return m.result;
    }
    async chooseTax(g, pid, targetId) {
      await ensureViewer(pid);
      return taxModal(g, pid, targetId);
    }
    async chooseReserve(g, pid, ids, limit) {
      await ensureViewer(pid);
      const me = g.players[pid];
      const cards = ids.map((id) => me.hand.find((c) => c.id === id));
      // по умолчанию оставляем то, что нельзя выгодно выложить, — с наибольшим уровнем
      const def = cards.slice().sort((a, b) => (g.improves(me, a) - g.improves(me, b)) || (b.tier - a.tier))[0];
      let keep = def.id;
      const flagFor = (c) => (c.id === keep ? '<div class="flag">остаётся в руке</div>' : (g.improves(me, c) ? '<div class="flag">→ на стол</div>' : `<div class="flag bad">→ банку $${g.rules.dumpPrice}</div>`));
      const draw = (mm) => { $('.row-cards', mm.el).innerHTML = cards.map((c) => cardHTML(c, { k: c.id, zoom: false, cls: c.id === keep ? 'sel' : '', flag: flagFor(c) })).join(''); };
      const m = openModal({
        title: 'Рука — для сильных карт',
        html: `<p>В конце хода в руке можно оставить только <b>${limit}</b> обычный этап. Выберите, какой оставить, — остальные лягут на стол (если улучшают компанию) или уйдут банку по $${g.rules.dumpPrice}.</p><div class="row-cards"></div>`,
        buttons: [{ label: 'Готово', cls: 'primary', value: () => [keep] }],
        onMount(mm) {
          draw(mm);
          mm.el.addEventListener('click', (e) => { const c = e.target.closest('.row-cards [data-k]'); if (c) { keep = +c.dataset.k; draw(mm); } });
        },
        forPid: pid, auto: () => [keep],
      });
      return m.result;
    }
    async chooseExcess(g, pid, n) {
      await ensureViewer(pid);
      const me = g.players[pid];
      const chosen = new Set();
      const m = openModal({
        title: `Лимит руки — ${g.rules.handLimit} карт`,
        html: `<p>Выберите <b>${n}</b> ${plural(n, 'карту', 'карты', 'карт')} для продажи банку по $${g.rules.dumpPrice}.</p><div class="row-cards">${sortHand(me.hand).map((c) => cardHTML(c, { k: c.id, zoom: false })).join('')}</div>`,
        buttons: [{ label: 'Продать', cls: 'primary', disabled: true, value: () => Array.from(chosen) }],
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
        forPid: pid, auto: () => Array.from(chosen),
      });
      return m.result;
    }
  }

  function claimHTML(claim) {
    return claim && claim !== 'none'
      ? `<p>Заявка продавца: <span class="claim-badge">${C.CLAIMS[claim].label}</span><br><small style="color:var(--muted)">Заявка может быть блефом!</small></p>`
      : '<p style="color:var(--muted)">Продавец ничего не сказал о карте.</p>';
  }

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
    S.knownHand = new Set(p.hand.map((c) => c.id));
    renderNow();
  }
  async function restoreViewer(g, pid) {
    const c = g.cur;
    if (!g.over && c.type === 'human' && c.id !== pid) await ensureViewer(c.id);
  }

  /** Налоговая: стол соперника, нужные вам карты подсвечены зелёным. */
  function taxModal(g, pid, targetId) {
    const t = g.players[targetId], me = g.players[pid];
    const cards = g.tableCards(t);
    const scored = cards.map((x) => {
      const need = usefulFor(g, me, x.card);
      const harm = g.filled(t, x.ind) + (x.card.tier || 0) * 0.4;
      return Object.assign({ need, score: (need ? 10 : 0) + harm }, x);
    });
    const best = scored.slice().sort((a, b) => b.score - a.score)[0];
    let pick = best ? `${best.ind}:${best.stage}` : null;
    const m = openModal({
      title: `🏛 Налоговая проверка: ${t.avatar} ${esc(t.name)}`,
      wide: true,
      html: `<p>Выберите выложенную карту — заберите её себе или отправьте в сброс.</p>
        <div class="legend"><span><i style="background:#4fd18b"></i>нужна вам: закроет место или улучшит этап</span><span><i style="background:var(--gold)"></i>выбрана</span></div>
        ${C.IND_ORDER.map((ind) => {
          const row = scored.filter((x) => x.ind === ind);
          if (!row.length) return '';
          return `<div class="section-label" style="color:${C.INDUSTRIES[ind].color}">${C.INDUSTRIES[ind].name} · ${g.filled(t, ind)}/4</div><div class="row-cards">${row.map((x) => {
            const k = `${x.ind}:${x.stage}`;
            return cardHTML(x.card, { k, zoom: false, cls: (x.need ? 'need ' : '') + (k === pick ? 'sel' : ''), flag: x.need ? '<div class="flag">нужна вам</div>' : '' });
          }).join('')}</div>`;
        }).join('')}`,
      buttons: [
        { label: 'Отправить в сброс', cls: 'danger', value: () => mk('discard') },
        { label: 'Забрать себе', cls: 'primary', value: () => mk('take') },
      ],
      onMount(mm) {
        mm.el.addEventListener('click', (e) => {
          const c = e.target.closest('.row-cards [data-k]');
          if (!c) return;
          $$('.row-cards .card', mm.el).forEach((x) => x.classList.remove('sel'));
          c.classList.add('sel');
          pick = c.dataset.k;
        });
      },
      forPid: pid, auto: () => mk('take'),
    });
    function mk(mode) { const [ind, stage] = pick.split(':'); return { ind, stage, mode }; }
    return m.result;
  }

  // ======================== Запуск партии ========================
  function startGame(seats, target) {
    if (S.game) S.game.aborted = true;
    stopTimer();
    for (const m of Array.from(S.modals)) m.close();
    $('#modal-root').innerHTML = '';
    S.seats = seats;
    S.humans = seats.map((s, i) => (s.type === 'human' ? i : -1)).filter((i) => i >= 0);
    const controllers = seats.map((s) => (s.type === 'human' ? new HumanController() : new AI.Bot(s.profile)));
    const g = new E.Game({
      players: seats.map((s) => ({ name: s.name, type: s.type, avatar: s.ava })),
      controllers, target, events: S.events,
      delay: (ms) => (g.aborted ? new Promise(() => {}) : sleep(ms * S.settings.speed)),
    });
    S.game = g;
    S.viewer = S.humans[0];
    S.endTurn = null; S.busy = false; S.timedOutPid = null;
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
    })().catch((e) => { if (!g.aborted) { console.error(e); toast('Ошибка: ' + esc(e.message)); } });
  }

  function onEvent(type, d) {
    const g = S.game;
    if (!g || g.aborted) return;
    const v = S.viewer;
    const single = S.humans.length === 1;
    switch (type) {
      case 'log': appendLog(d); break;
      case 'turn': if (S.timedOutPid !== d.pid) S.timedOutPid = null; break;
      case 'event': toast(`📰 Раунд ${d.round}: <span style="color:var(--gold)">${esc(d.event.title)}</span><br><small style="font-weight:600">${esc(d.event.text)}</small>`, d.event, 4200, true); break;
      case 'reshuffle': toast('🔄 Колода закончилась — сброс перемешан в новую'); break;
      case 'companySold': {
        const p = g.players[d.pid];
        toast(`${p.avatar} ${esc(p.name)} продаёт «${C.INDUSTRIES[d.ind].short}» за <span class="money">$${d.value}</span>${d.synergy ? ' · 🔗' : ''}${d.clean ? ' · ✨' : ''}`, SALE_CARD, 3000);
        break;
      }
      case 'dividend': if (d.pid === v) toast(`📈 Дивиденды по акции: <span class="money">+$${d.value}</span>`); break;
      case 'buyBlind': if (d.pid === v) toast(`Из колоды: «${esc(d.card.title)}»`, d.card, 2200); break;
      case 'build': if (d.forced && d.pid === v) toast(`На стол: «${esc(d.card.title)}»`, d.card, 1800); break;
      case 'requestResult':
        if (d.accepted && d.from === v) toast(`Вы вытянули «${esc(d.card.title)}»`, d.card);
        if (d.accepted && d.to === v && single) toast(`У вас купили «${esc(d.card.title)}»`, d.card);
        break;
      case 'offerResult': if (d.accepted && d.to === v) toast(`Вы купили «${esc(d.card.title)}»`, d.card); break;
      case 'auctionResult':
        if (d.winner === v) toast(`🔨 Вы выиграли аукцион: «${esc(d.card.title)}»`, d.card);
        else if (d.from === v) toast(d.winner != null ? `🔨 Карта ушла за <span class="money">$${d.price}</span>` : `🔨 Ставок нет — банк дал $${g.rules.auctionFloor}`);
        break;
      case 'lawyer': if (d.from === v) toast('⚖️ Соперник выставил Юриста — проверка отменена'); break;
      case 'invest': if (d.to === v && single) toast(`📈 ${esc(g.players[d.from].name)} купил акцию вашей компании «${C.INDUSTRIES[d.ind].short}» (+$${g.rules.sharePrice})`); break;
      case 'taxResult': {
        const f = g.players[d.from], t = g.players[d.to];
        if (!d.card) { if (d.to === v && single) toast(`🏛 Стол пуст — штраф $${d.fine}`); break; }
        if (d.to === v && single) toast(`🏛 Налоговая (${esc(f.name)}) ${d.mode === 'take' ? 'изъяла' : 'сбросила'} у вас «${esc(d.card.title)}»`, d.card, 3200);
        else if (d.from !== v) toast(`🏛 ${esc(f.name)} → ${esc(t.name)}: «${esc(d.card.title)}» ${d.mode === 'take' ? 'изъята' : 'в сброс'}`, d.card, 2600);
        break;
      }
      case 'gameOver': {
        stopTimer();
        const f = S.endTurn; S.endTurn = null;
        for (const m of Array.from(S.modals)) if (!m.o.overlayCls) m.close(m.o.dismissValue);
        if (f) f();
        setTimeout(() => showVictory(d), 600);
        break;
      }
    }
    scheduleRender();
  }

  function appendLog(e) {
    const el = document.createElement('div');
    el.className = 'e ' + e.kind;
    el.textContent = e.text;
    const log = $('#log');
    log.appendChild(el);
    while (log.children.length > 250) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  }

  function showVictory(d) {
    const g = S.game;
    const w = d.winner;
    const isMe = S.humans.includes(w.id);
    const rows = d.ranking.map((p, i) => `<tr class="${i === 0 ? 'first' : ''}"><td>${i + 1}</td><td>${p.avatar} ${esc(p.name)}</td><td class="money">$${g.netWorth(p)}</td><td>${p.companiesSold}</td><td>$${p.dividends}</td></tr>`).join('');
    openModal({
      html: `<div class="win-ava">${isMe ? '🏆' : w.avatar}</div>
        <h2 class="win-title">${isMe && S.humans.length === 1 ? 'Вы победили!' : esc(w.name) + ' побеждает!'}</h2>
        <p style="text-align:center">${esc(d.reason)} Раундов: ${g.round}.</p>
        <table class="rank"><tr><th>#</th><th>Игрок</th><th>Капитал</th><th>Компаний</th><th>Дивиденды</th></tr>${rows}</table>`,
      buttons: [{ label: 'В меню', value: 'menu' }, { label: 'Сыграть ещё', cls: 'primary', value: 'again' }],
    }).result.then((val) => {
      if (val === 'again') startGame(S.seats.map((s) => Object.assign({}, s)), g.target);
      else toMenu();
    });
  }

  function toMenu() {
    if (S.game) S.game.aborted = true;
    S.game = null;
    stopTimer();
    for (const m of Array.from(S.modals)) m.close();
    $('#modal-root').innerHTML = '';
    $('#game').classList.add('hidden');
    $('#setup').classList.remove('hidden');
    $('#custom').classList.add('hidden');
    $('#mode-pick').classList.remove('hidden');
  }

  // ======================== Действия игрока ========================
  function canAct() {
    const g = S.game;
    return !!(g && !g.over && g.phase === 'actions' && g.cur.type === 'human' && g.current === S.viewer && !S.busy && !S.curtainOpen && S.endTurn);
  }
  async function act(fn) {
    if (!canAct()) return;
    S.busy = true;
    try { await fn(); } catch (e) { toast('⚠️ ' + esc(e.message)); }
    S.busy = false;
    renderNow();
    tryAutoEnd();
  }
  const me = () => S.game.players[S.viewer];

  function stepperHTML(v) {
    return `<div class="field"><label>Сумма:</label><div class="stepper"><button data-st="-1">−</button><span class="v">$${v}</span><button data-st="1">+</button></div></div>`;
  }
  function mountStepper(mm, state, max, min) {
    min = min == null ? 1 : min;
    mm.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-st]');
      if (!b) return;
      state.price = Math.max(min, Math.min(max(), state.price + +b.dataset.st));
      $('.stepper .v', mm.el).textContent = '$' + state.price;
    });
  }
  function claimSelectHTML() {
    return `<div class="field"><label>Заявка:</label><select class="claim-sel">${Object.entries(C.CLAIMS).map(([k, c]) => `<option value="${k}">${c.label}</option>`).join('')}</select></div>`;
  }

  function chooseOpponent(title, filter, sub) {
    const g = S.game;
    let pick = null;
    return openModal({
      title,
      html: `<div class="choice-list">${g.opponents(S.viewer).map((p) => {
        const ok = filter(p);
        return `<div class="choice" data-p="${ok ? p.id : ''}" style="${ok ? '' : 'opacity:.4;cursor:not-allowed'}">
          <span class="ava">${p.avatar}</span><div class="grow"><b>${esc(p.name)}</b><small>${sub ? sub(p) : `на руке ${p.hand.length} · на столе ${g.tableCards(p).length}`}</small></div><span class="money">$${p.money}</span></div>`;
      }).join('')}</div>`,
      dismiss: true, dismissValue: null,
      buttons: [{ label: 'Отмена', value: null }, { label: 'Выбрать', cls: 'primary', disabled: true, value: () => pick }],
      onMount(mm) {
        mm.el.addEventListener('click', (e) => {
          const c = e.target.closest('.choice[data-p]');
          if (!c || c.dataset.p === '') return;
          $$('.choice', mm.el).forEach((x) => x.classList.remove('on'));
          c.classList.add('on');
          pick = +c.dataset.p;
          mm.btn(1).disabled = false;
        });
      },
    }).result;
  }

  // ---- действия (общие для перетаскивания и кнопок увеличенной карты) ----
  const A = {
    build(card, stage) {
      const p = me();
      if (card.type === 'wild' && !stage) {
        stage = C.STAGE_ORDER.find((s) => !p.table[card.ind][s]) || C.STAGE_ORDER.find((s) => p.table[card.ind][s].type === 'wild');
        if (!stage) { toast('Все этапы уже настоящие — универсальная не нужна'); return; }
      }
      act(() => S.game.build(S.viewer, card.id, stage));
    },
    sell(card, ind) {
      const p = me();
      ind = ind || C.IND_ORDER.find((i) => S.game.isComplete(p, i) && !S.game.companyValue(p, i).blocked);
      if (!ind) { toast('Нет собранной компании (или на неё санкции)'); return; }
      act(() => S.game.sellCompany(S.viewer, ind, card.id));
    },
    sellBank(card) { act(() => S.game.sellBank(S.viewer, card.id)); },
    async auction(card) {
      if (!canAct()) return;
      const m = openModal({
        title: '🔨 Аукцион вслепую',
        html: `<div class="offer-card">${cardHTML(card, { zoom: false })}<div style="flex:1">${claimSelectHTML()}
          <p style="font-size:13px;color:var(--muted)">Соперники увидят только рубашку и заявку и сделают закрытые ставки. Нет ставок — банк заплатит $${S.game.rules.auctionFloor}.</p></div></div>`,
        dismiss: true, dismissValue: null,
        buttons: [{ label: 'Отмена', value: null }, { label: 'Выставить', cls: 'primary', value: (mm) => $('.claim-sel', mm.el).value }],
      });
      const claim = await m.result;
      if (claim != null) act(() => S.game.auction(S.viewer, card.id, claim));
    },
    async offer(card, targetId) {
      if (!canAct()) return;
      if (targetId == null) targetId = await chooseOpponent('Кому предложить карту?', (p) => p.money >= 1);
      if (targetId == null) return;
      const t = S.game.players[targetId];
      const st = { price: 3 };
      const m = openModal({
        title: `Предложить карту: ${t.avatar} ${esc(t.name)}`,
        html: `<div class="offer-card">${cardHTML(card, { zoom: false })}<div style="flex:1">${stepperHTML(st.price)}${claimSelectHTML()}
          <p style="font-size:13px;color:var(--muted)">У покупателя $${t.money}. Он увидит только рубашку и заявку.</p></div></div>`,
        dismiss: true, dismissValue: null,
        buttons: [{ label: 'Отмена', value: null }, { label: 'Предложить', cls: 'primary', value: (mm) => $('.claim-sel', mm.el).value }],
        onMount(mm) { mountStepper(mm, st, () => S.game.rules.maxOfferPrice); },
      });
      const claim = await m.result;
      if (claim != null) act(() => S.game.offer(S.viewer, targetId, card.id, st.price, claim));
    },
    async tax(card, targetId) {
      if (!canAct()) return;
      if (S.game.ev('taxfree')) { toast('🏖 Налоговые каникулы: в этом раунде проверок нет'); return; }
      if (targetId == null) targetId = await chooseOpponent('Кого проверит налоговая?', () => true, (p) => `на столе ${S.game.tableCards(p).length} карт`);
      if (targetId == null) return;
      act(() => S.game.playTax(S.viewer, targetId, card.id));
    },
    async share(card, targetId, ind) {
      if (!canAct()) return;
      const g = S.game;
      const eligible = (q) => C.IND_ORDER.filter((i) => g.filled(q, i) >= 2 && !q.shares[i]);
      if (targetId == null) targetId = await chooseOpponent('В чью компанию вложиться?', (q) => eligible(q).length > 0, (q) => eligible(q).map((i) => C.INDUSTRIES[i].short).join(', ') || 'нет компании с 2+ этапами без акций');
      if (targetId == null) return;
      const t = g.players[targetId];
      if (!ind) {
        const list = eligible(t);
        if (!list.length) { toast(shareReason(t)); return; }
        if (list.length === 1) ind = list[0];
        else {
          ind = await openModal({
            title: `Акция: компания ${esc(t.name)}`,
            html: `<div class="choice-list">${list.map((i) => `<div class="choice" data-i="${i}"><span class="ava" style="color:${C.INDUSTRIES[i].color}">●</span><div class="grow"><b>${C.INDUSTRIES[i].name}</b><small>этапов ${g.filled(t, i)}/4 · сейчас $${g.companyValue(t, i).value}</small></div></div>`).join('')}</div>`,
            dismiss: true, dismissValue: null, buttons: [{ label: 'Отмена', value: null }],
            onMount(mm) { mm.el.addEventListener('click', (e) => { const c = e.target.closest('[data-i]'); if (c) mm.close(c.dataset.i); }); },
          }).result;
          if (!ind) return;
        }
      }
      act(() => g.invest(S.viewer, targetId, ind, card.id));
    },
    buy() { act(() => S.game.buyBlind(S.viewer)); },
    async request(targetId) {
      if (!canAct()) return;
      const g = S.game, p = me(), t = g.players[targetId];
      const st = { price: Math.min(4, p.money) };
      if (st.price < 1) { toast('Нет денег'); return; }
      const m = openModal({
        title: `Купить карту у ${t.avatar} ${esc(t.name)} в тёмную`,
        html: `<p>Назовите цену. Если ${esc(t.name)} согласится, вы вытянете любую из ${t.hand.length} карт по рубашке.</p>${stepperHTML(st.price)}`,
        dismiss: true, dismissValue: null,
        buttons: [{ label: 'Отмена', value: null }, { label: 'Предложить', cls: 'primary', value: true }],
        onMount(mm) { mountStepper(mm, st, () => Math.min(g.rules.maxOfferPrice, p.money)); },
      });
      if (await m.result) act(() => g.requestBuy(S.viewer, targetId, st.price));
    },
  };

  function shareReason(q) {
    const g = S.game;
    if (C.IND_ORDER.every((i) => g.filled(q, i) < 2)) return `📈 Акция: у ${esc(q.name)} нет компании, где выложено 2+ этапа`;
    return `📈 Акция: во все подходящие компании ${esc(q.name)} уже вложились`;
  }

  async function quickSale(ind) {
    const g = S.game, p = me();
    if (!canAct()) return;
    if (g.actionsLeft <= 0) { toast('🚫 Сделки на этот ход закончились — срочная продажа тратит сделку'); return; }
    const cv = g.companyValue(p, ind), q = g.quickValue(p, ind);
    const hasSale = p.hand.some((c) => c.type === 'sale');
    const ok = await openModal({
      title: `⚡ Срочная продажа: ${C.INDUSTRIES[ind].name}`,
      html: `<p>Продать компанию <b>без карты «Продажа»</b> за половину цены: <b class="money">$${q}</b> вместо $${cv.value}. Тратит одну сделку.</p>
        ${p.shares[ind] ? `<p style="color:var(--muted)">Акционер получит треть от $${q}.</p>` : ''}
        ${hasSale ? '<p style="color:#ffcf6b">У вас есть «Продажа» — перетащите её на компанию и получите полную цену!</p>' : ''}`,
      dismiss: true, dismissValue: false,
      buttons: [{ label: 'Отмена', value: false }, { label: `Продать за $${q}`, cls: 'primary', value: true }],
    }).result;
    if (ok) act(() => g.quickSell(S.viewer, ind));
  }

  async function showBank() {
    const g = S.game, p = me(), ok = canAct();
    const cheap = g.ev('cheapcredit');
    const repay = cheap ? g.rules.loanAmount : g.rules.loanRepay;
    const m = openModal({
      title: '🏦 Банк',
      html: `<div class="bank-box">
        <div class="row"><span style="font-size:24px">💵</span><div class="grow"><b>Продать карту сразу — $${g.rules.sellPrice}</b><small>Перетащите карту из руки на 🏦. Тратит сделку.</small></div></div>
        <div class="row"><span style="font-size:24px">⚡</span><div class="grow"><b>Срочная продажа компании — 50%</b><small>Если «Продажа» не приходит: кнопка «⚡ Срочно» на собранной компании. Тратит сделку.</small></div></div>
        <div class="row"><span style="font-size:24px">🂠</span><div class="grow"><b>Купить карту вслепую — $${g.buyPrice}</b><small>Перетащите колоду в руку. Тратит сделку.</small></div></div>
        ${p.loan
          ? `<div class="row"><span style="font-size:24px">📄</span><div class="grow"><b>Ваш долг: $${p.loan.owe}</b><small>Спишется автоматически через ${p.loan.turnsLeft} ${plural(p.loan.turnsLeft, 'ход', 'хода', 'ходов')}. Не хватит денег — +$${g.rules.loanPenalty} пени.</small></div><button class="btn primary small" data-bk="repay" ${ok && p.money >= p.loan.owe ? '' : 'disabled'}>Погасить</button></div>`
          : `<div class="row"><span style="font-size:24px">💳</span><div class="grow"><b>Кредит $${g.rules.loanAmount} → вернуть $${repay}</b><small>Через ${g.rules.loanTurns} хода, автоматически. Бесплатное действие, один кредит одновременно.${cheap ? ' Сейчас — льготный, без процентов!' : ''}</small></div><button class="btn primary small" data-bk="loan" ${ok ? '' : 'disabled'}>Взять</button></div>`}
      </div>`,
      dismiss: true, dismissValue: null, buttons: [{ label: 'Закрыть', value: null }],
      onMount(mm) { mm.el.addEventListener('click', (e) => { const b = e.target.closest('[data-bk]'); if (b && !b.disabled) mm.close(b.dataset.bk); }); },
    });
    const v = await m.result;
    if (v === 'loan') act(() => g.takeLoan(S.viewer));
    if (v === 'repay') act(() => g.repayLoan(S.viewer));
  }

  // ======================== Перетаскивание ========================
  const D = { src: null, payload: null, ghost: null, x0: 0, y0: 0, dx: 0, dy: 0, moved: false, hover: null };

  function payloadOf(el) {
    if (!S.game) return null;
    const kind = el.dataset.drag;
    if (kind === 'hand') return { kind: 'card', card: me().hand.find((c) => c.id === +el.dataset.cid) };
    if (kind === 'deck') return { kind: 'deck' };
    if (kind === 'opphand') return { kind: 'opphand', pid: +el.dataset.pid };
    return null;
  }

  /** Можно ли бросить груз на цель. Возвращает true или строку-объяснение, почему нельзя. */
  function check(pl, el) {
    const g = S.game, p = me();
    const t = el.dataset.drop;
    const acts = g.actionsLeft > 0;
    const NO_ACTS = 'Сделки на этот ход закончились (2 из 2)';
    if (pl.kind === 'deck') {
      if (t !== 'hand') return 'Колоду тяните в свою руку';
      if (!acts) return NO_ACTS;
      if (p.money < g.buyPrice) return `Нужно $${g.buyPrice}`;
      return g.canDraw() ? true : 'Колода пуста';
    }
    if (pl.kind === 'opphand') {
      if (t !== 'hand') return 'Карты соперника тяните в свою руку';
      if (!acts) return NO_ACTS;
      if (p.money < 1) return 'Нет денег';
      return g.players[pl.pid].hand.length ? true : 'У соперника нет карт';
    }
    const c = pl.card;
    if (!c) return false;
    const ind = el.dataset.ind;
    const where = c.ind ? `«${C.INDUSTRIES[c.ind].short}»` : '';
    switch (t) {
      case 'slot':
        if (c.type === 'stage') {
          if (c.ind !== ind) return `Это этап отрасли ${where} — тащите в её компанию`;
          return c.stage === el.dataset.stage ? true : `Эта карта — «${C.STAGES[c.stage]}», её место в своей колонке`;
        }
        if (c.type === 'wild') return c.ind === ind ? true : `Универсальная подходит только для отрасли ${where}`;
        if (c.type === 'sale') return checkSale(p, ind);
        return 'Сюда выкладываются только этапы';
      case 'company':
        if (c.type === 'stage' || c.type === 'wild') return c.ind === ind ? true : `Это карта отрасли ${where}`;
        if (c.type === 'sale') return checkSale(p, ind);
        return 'В компанию выкладываются этапы, а «Продажа» — на собранную компанию';
      case 'oppco': {
        const q = g.players[+el.dataset.pid];
        if (c.type !== 'share') return false; // пусть решает панель игрока
        if (!acts) return NO_ACTS;
        if (p.money < g.rules.sharePrice) return `Акция стоит $${g.rules.sharePrice}`;
        if (q.shares[ind]) return 'В эту компанию уже вложились';
        return g.filled(q, ind) >= 2 ? true : `Акцию можно купить только в компанию с 2+ этапами (здесь ${g.filled(q, ind)})`;
      }
      case 'player': {
        const q = g.players[+el.dataset.pid];
        if (!acts) return NO_ACTS;
        if (c.type === 'tax') return g.ev('taxfree') ? '🏖 Налоговые каникулы: в этом раунде проверок нет' : true;
        if (c.type === 'share') {
          if (p.money < g.rules.sharePrice) return `Акция стоит $${g.rules.sharePrice}`;
          return C.IND_ORDER.some((i) => g.filled(q, i) >= 2 && !q.shares[i]) ? true : shareReason(q);
        }
        return q.money >= 1 ? true : `У ${q.name} нет денег`;
      }
      case 'auction': return acts ? true : NO_ACTS;
      case 'bank': return acts ? true : NO_ACTS;
      case 'hand': return false;
      default: return false;
    }
  }
  function checkSale(p, ind) {
    const g = S.game;
    if (!g.isComplete(p, ind)) return `Компания не собрана: ${g.filled(p, ind)}/4 этапа`;
    if (g.companyValue(p, ind).blocked) return '⛔ Санкции: в этом раунде эту отрасль продать нельзя';
    return true;
  }
  const accepts = (pl, el) => check(pl, el) === true;

  function perform(pl, el) {
    const t = el.dataset.drop;
    if (pl.kind === 'deck') return A.buy();
    if (pl.kind === 'opphand') return A.request(pl.pid);
    const c = pl.card;
    if (t === 'slot') return c.type === 'sale' ? A.sell(c, el.dataset.ind) : A.build(c, el.dataset.stage);
    if (t === 'company') return c.type === 'sale' ? A.sell(c, el.dataset.ind) : A.build(c, c.type === 'wild' ? null : c.stage);
    if (t === 'oppco') return A.share(c, +el.dataset.pid, el.dataset.ind);
    if (t === 'player') {
      const pid = +el.dataset.pid;
      if (c.type === 'tax') return A.tax(c, pid);
      if (c.type === 'share') return A.share(c, pid);
      return A.offer(c, pid);
    }
    if (t === 'auction') return A.auction(c);
    if (t === 'bank') return A.sellBank(c);
  }

  /** Самая глубокая цель под пальцем: принимающая — или первая отказавшая (для объяснения). */
  function targetsAt(x, y) {
    let el = document.elementFromPoint(x, y), refused = null;
    while (el && el !== document.body) {
      if (el.dataset && el.dataset.drop) {
        const r = check(D.payload, el);
        if (r === true) return { ok: el };
        if (!refused && typeof r === 'string') refused = { el, why: r };
        if (refused && el.dataset.drop === 'oppco') return { refused }; // конкретная компания отказала — не подменяем другой
      }
      el = el.parentElement;
    }
    return { refused };
  }

  function startDrag() {
    D.payload = payloadOf(D.src);
    if (!D.payload || (D.payload.kind === 'card' && !D.payload.card)) return false;
    if (!canAct()) {
      const g = S.game;
      toast(g && g.cur.id !== S.viewer ? 'Сейчас ходит другой игрок' : 'Подождите…', null, 1200);
      return false;
    }
    const r = D.src.getBoundingClientRect();
    const srcCard = D.payload.kind === 'card' ? D.src : (D.payload.kind === 'deck' ? $('#deck .card:last-child') : D.src.querySelector('.card'));
    const ghost = (srcCard || D.src).cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.classList.remove('new');
    const w = D.payload.kind === 'card' ? r.width : 72;
    ghost.style.width = w + 'px';
    ghost.style.height = (w * 1.4478) + 'px';
    ghost.style.setProperty('--w', w + 'px');
    D.dx = D.payload.kind === 'card' ? D.x0 - r.left : w / 2;
    D.dy = D.payload.kind === 'card' ? D.y0 - r.top : w * 0.7;
    document.body.appendChild(ghost);
    D.ghost = ghost;
    if (D.payload.kind === 'card') D.src.classList.add('dragging');
    document.body.classList.add('dragging');
    const okEls = $$('[data-drop]').filter((el) => accepts(D.payload, el));
    for (const el of okEls) if (!okEls.some((x) => x !== el && el.contains(x))) el.classList.add('drop-ok');
    if (D.payload.kind === 'card') $('#bank').classList.add('selling');
    return true;
  }
  function moveGhost(x, y) {
    if (!D.ghost) return;
    D.ghost.style.left = (x - D.dx) + 'px';
    D.ghost.style.top = (y - D.dy) + 'px';
    const t = targetsAt(x, y).ok || null;
    if (t !== D.hover) {
      if (D.hover) D.hover.classList.remove('drop-hover');
      D.hover = t;
      if (t) t.classList.add('drop-hover');
    }
  }
  function endDrag() {
    if (D.ghost) D.ghost.remove();
    if (D.src) D.src.classList.remove('dragging');
    $$('.drop-ok').forEach((x) => x.classList.remove('drop-ok'));
    $$('.drop-hover').forEach((x) => x.classList.remove('drop-hover'));
    document.body.classList.remove('dragging');
    $('#bank') && $('#bank').classList.remove('selling');
    D.src = null; D.ghost = null; D.payload = null; D.hover = null; D.moved = false;
  }

  function initDrag() {
    document.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || D.src) return;
      const el = e.target.closest('#game [data-drag]');
      if (!el) return;
      D.src = el; D.x0 = e.clientX; D.y0 = e.clientY; D.moved = false;
      e.preventDefault();
    });
    document.addEventListener('pointermove', (e) => {
      if (!D.src) return;
      if (!D.moved) {
        if (Math.hypot(e.clientX - D.x0, e.clientY - D.y0) < 7) return;
        D.moved = true;
        if (!startDrag()) { D.src = null; D.moved = false; return; }
      }
      moveGhost(e.clientX, e.clientY);
    });
    document.addEventListener('pointerup', (e) => {
      if (!D.src) return;
      const src = D.src;
      if (D.moved && D.payload) {
        const pl = D.payload;
        const hit = targetsAt(e.clientX, e.clientY);
        endDrag();
        if (hit.ok) perform(pl, hit.ok);
        else if (hit.refused) toast('🚫 ' + esc(hit.refused.why), null, 2600);
        return;
      }
      endDrag();
      tap(src);
    });
    document.addEventListener('pointercancel', endDrag);
  }

  function tap(el) {
    const g = S.game;
    if (!g) return;
    if (el.dataset.drag === 'hand') {
      const card = me().hand.find((c) => c.id === +el.dataset.cid);
      if (card) zoomHand(card);
    } else if (el.dataset.drag === 'deck') {
      toast('Перетащите колоду в свою руку, чтобы купить карту за $' + g.buyPrice, null, 2000);
    } else if (el.dataset.drag === 'opphand') {
      toast('Перетащите карты соперника в свою руку, чтобы купить одну вслепую', null, 2200);
    }
  }

  // ======================== Увеличенная карта ========================
  function zoomCard(card, extraHTML) {
    openModal({ html: `<div class="zoom">${cardHTML(card, { zoom: false })}${extraHTML || ''}</div>`, dismiss: true, buttons: [{ label: 'Закрыть', value: null }] });
  }
  function zoomHand(card) {
    const g = S.game, p = me(), ok = canAct(), acts = ok && g.actionsLeft > 0;
    const btns = [];
    const add = (label, fn, enabled, cls) => btns.push({ label, fn, enabled, cls });
    if (card.type === 'stage' || card.type === 'wild') add('Построить', () => A.build(card), ok, 'primary');
    if (card.type === 'sale') add('Продать компанию', () => A.sell(card), ok && C.IND_ORDER.some((i) => g.isComplete(p, i)), 'primary');
    if (card.type === 'tax') add('Налоговая проверка', () => A.tax(card), acts && !g.ev('taxfree'), 'primary');
    if (card.type === 'share') add('Купить акцию', () => A.share(card), acts && p.money >= g.rules.sharePrice, 'primary');
    add(`🏦 Банку +$${g.rules.sellPrice}`, () => A.sellBank(card), acts);
    add('🔨 На аукцион', () => A.auction(card), acts);
    add('Предложить игроку', () => A.offer(card), acts);
    const hint = card.type === 'lawyer' ? '<p style="font-size:13px;color:var(--muted)">Юрист срабатывает сам, когда на вас натравят налоговую.</p>'
      : '<p style="font-size:12px;color:var(--muted)">Подсказка: карты можно просто перетаскивать.</p>';
    openModal({
      html: `<div class="zoom">${cardHTML(card, { zoom: false })}<div class="acts">${btns.map((b, i) => `<button class="btn small ${b.cls || ''}" data-a="${i}" ${b.enabled ? '' : 'disabled'}>${b.label}</button>`).join('')}</div>${hint}</div>`,
      dismiss: true, buttons: [{ label: 'Закрыть', value: null }],
      onMount(mm) { mm.el.addEventListener('click', (e) => { const b = e.target.closest('[data-a]'); if (b && !b.disabled) { mm.close(); btns[+b.dataset.a].fn(); } }); },
    });
  }
  function breakdownHTML(p, ind) {
    const cv = S.game.companyValue(p, ind);
    return `<div class="breakdown">${cv.parts.map((x) => `<span>${esc(x.label)}</span><b>${x.v >= 0 ? '+' : '−'}$${Math.abs(x.v)}</b>`).join('')}<span>Итого</span><b style="color:var(--gold)">$${cv.value}</b></div>${cv.blocked ? '<p style="color:#ffb3b3">Санкции: в этом раунде не продаётся</p>' : ''}`;
  }

  // ======================== Прочие события интерфейса ========================
  function initGameEvents() {
    $('#log-btn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
    $('#log-close').addEventListener('click', () => $('#sidebar').classList.remove('open'));
    $('#to-menu').addEventListener('click', () => {
      openModal({ title: 'Выйти в меню?', html: '<p>Текущая партия будет потеряна.</p>', dismiss: true, buttons: [{ label: 'Остаться', value: false }, { label: 'Выйти', cls: 'danger', value: true }] })
        .result.then((v) => { if (v) toMenu(); });
    });
    $('#game').addEventListener('click', (e) => {
      const g = S.game;
      if (!g) return;
      const a = e.target.closest('[data-act]');
      if (a) {
        if (a.dataset.act === 'end' && canAct()) endTurnNow();
        if (a.dataset.act === 'quick') quickSale(a.dataset.ind);
        return;
      }
      if (e.target.closest('#bank')) { showBank(); return; }
      if (e.target.closest('[data-drag]')) return; // тапы по перетаскиваемым — в pointerup
      const z = e.target.closest('[data-zoom]');
      if (z) {
        const card = CARD_BY_ID[+z.dataset.zoom];
        const co = z.closest('.company');
        const extra = co ? breakdownHTML(me(), co.dataset.ind) : (card.type === 'event' ? `<p>${esc(card.text)}</p>` : '');
        zoomCard(card, extra);
        return;
      }
      const head = e.target.closest('.co-head');
      if (head) {
        const ind = head.closest('.company').dataset.ind;
        openModal({ title: C.INDUSTRIES[ind].name, html: `<div class="zoom">${breakdownHTML(me(), ind)}<p style="font-size:13px;color:var(--muted)">Связь отраслей: ${C.SUPPLIER[ind].why} — нужно 2+ этапа «${C.INDUSTRIES[C.SUPPLIER[ind].from].short}» на столе.</p></div>`, dismiss: true, buttons: [{ label: 'Ок' }] });
      }
    });
    window.addEventListener('resize', scheduleRender);
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
    const p = g.players[v];
    const my = canAct();
    const acts = g.current === v ? g.actionsLeft : 0;
    $('#round-v').textContent = `${g.round || 1}/${g.maxRounds}`;

    // ---- соперники ----
    const order = [];
    for (let k = 1; k < g.players.length; k++) order.push(g.players[(v + k) % g.players.length]);
    $('#opponents').innerHTML = order.map((q) => {
      const backs = Array.from({ length: Math.min(q.hand.length, 6) }, () => backHTML()).join('');
      const rows = C.IND_ORDER.map((ind) => {
        const sh = q.shares[ind];
        return `<div class="mini-row ${g.isComplete(q, ind) ? 'complete' : ''}" data-drop="oppco" data-pid="${q.id}" data-ind="${ind}" style="--ind:${C.INDUSTRIES[ind].color}" title="${C.INDUSTRIES[ind].name}: ${g.filled(q, ind)}/4, $${g.companyValue(q, ind).value}">
          ${sh ? `<span class="share-tag" title="Акция: ${esc(g.players[sh.pid].name)}">📈${g.players[sh.pid].avatar}</span>` : ''}
          ${C.STAGE_ORDER.map((s) => { const c = q.table[ind][s]; return `<div class="mini-slot">${c ? cardHTML(c) : ''}</div>`; }).join('')}</div>`;
      }).join('');
      return `<div class="opp ${g.current === q.id && !g.over ? 'active' : ''}" data-drop="player" data-pid="${q.id}">
        <div class="opp-head">
          <span class="who"><span class="ava">${q.avatar}</span><span class="nm">${esc(q.name)}</span>
            ${q.loan ? `<span class="badge loan" title="Кредит">🏦−$${q.loan.owe}</span>` : ''}
            ${q.companiesSold ? `<span class="badge" title="Продано компаний">💼${q.companiesSold}</span>` : ''}</span>
          <div class="opp-hand" data-drag="opphand" data-pid="${q.id}" title="Перетащите в свою руку, чтобы купить карту вслепую">${backs}<span class="cnt">${q.hand.length}</span></div>
          <span class="money" data-money="${q.id}">$${q.money}</span>
        </div>
        <div class="mini-table">${rows}</div></div>`;
    }).join('');

    // ---- центр ----
    const dn = g.deck.length;
    $('#deck').innerHTML = dn ? Array.from({ length: Math.min(3, dn) }, () => backHTML()).join('') : '';
    $('#deck').classList.toggle('empty', !dn);
    $('#deck-label').textContent = `Колода ${dn} · $${g.buyPrice}`;
    const top = g.discard[g.discard.length - 1];
    $('#discard').innerHTML = top ? cardHTML(top) : '';
    $('#discard').classList.toggle('empty', !top);
    $('#discard-label').textContent = `Сброс ${g.discard.length}`;
    $('#event').innerHTML = g.event ? cardHTML(g.event) : backHTML({ img: C.EVENT_BACK_IMG });
    $('#event-pile').classList.toggle('hidden', !g.useEvents);
    const repayAmt = g.ev('cheapcredit') ? g.rules.loanAmount : g.rules.loanRepay;
    $('#bank').innerHTML = `<span class="z-ico">🏦</span>
      <span class="idle">${p.loan ? `Долг<small>$${p.loan.owe}</small>` : `Кредит<small>+$${g.rules.loanAmount}</small>`}</span>
      <span class="sell">Продать<small>+$${g.rules.sellPrice}</small></span>`;
    $('#bank-label').textContent = p.loan ? `вернуть через ${p.loan.turnsLeft} х.` : `вернуть $${repayAmt}`;

    const cur = g.cur;
    let who, hint;
    if (g.over) { who = 'Игра окончена'; hint = `Победитель — ${esc(g.winner.name)}`; }
    else if (g.phase === 'waiting') { who = `${cur.avatar} ${esc(cur.name)}`; hint = 'Ожидание ответа…'; }
    else if (cur.id === v && cur.type === 'human') { who = S.humans.length > 1 ? `${cur.avatar} ${esc(cur.name)}` : '🟢 Ваш ход'; hint = contextHint(p); }
    else { who = `${cur.avatar} Ходит ${esc(cur.name)}…`; hint = 'Следите за журналом и уведомлениями.'; }
    $('#status').innerHTML = `<div class="who">${who}</div><div class="hint">${hint}</div>${g.event ? `<div class="ev">📰 ${esc(g.event.title)}: ${esc(g.event.text)}</div>` : ''}`;

    // ---- моя панель ----
    const nw = g.netWorth(p);
    const pct = Math.max(0, Math.min(100, Math.round(100 * nw / g.target)));
    $('#me-bar').innerHTML = `
      <div class="me-name"><span class="ava">${p.avatar}</span><span class="nm">${esc(p.name)}</span></div>
      <div class="money me-money" data-money="${p.id}">$${p.money}</div>
      <div class="progress-wrap"><div class="progress"><div style="width:${pct}%"></div></div><span>до $${g.target}: ещё $${Math.max(0, g.target - nw)}${p.loan ? ' (с долгом)' : ''}</span></div>
      <div class="pips" title="Сделки на этот ход">${Array.from({ length: g.rules.actionsPerTurn }, (_, i) => `<span class="pip ${i < acts ? '' : 'used'}"></span>`).join('')}<span>сделки</span></div>
      <div class="timer off" id="timer" title="Время хода"></div>
      <button class="btn primary end-btn" data-act="end" ${my ? '' : 'disabled'}>Завершить ход ➜</button>`;
    renderTimer();

    // ---- компании ----
    $('#companies').innerHTML = C.IND_ORDER.map((ind) => {
      const info = C.INDUSTRIES[ind];
      const n = g.filled(p, ind);
      const cv = g.companyValue(p, ind);
      const sh = p.shares[ind];
      const tags = [];
      if (cv.synergy) tags.push(`<span class="tag syn" title="${C.SUPPLIER[ind].why}">🔗+$${g.rules.synergyBonus}</span>`);
      if (cv.clean) tags.push('<span class="tag" title="Чистый бизнес">✨</span>');
      if (sh) tags.push(`<span class="tag sh" title="Акционер получит треть">📈${g.players[sh.pid].avatar}</span>`);
      if (cv.blocked) tags.push('<span class="tag block">⛔</span>');
      else if (g.ev('gov', ind) || g.ev('crisis') || g.ev('boom')) tags.push('<span class="tag ev">📰</span>');
      const quick = n === 4 && !cv.blocked && my && acts > 0
        ? `<button class="btn small primary quick-btn" data-act="quick" data-ind="${ind}" title="Без карты «Продажа», за 50% цены">⚡ Срочно $${g.quickValue(p, ind)}</button>` : '';
      return `<div class="company ${n === 4 ? 'complete' : ''}" data-drop="company" data-ind="${ind}" style="--ind:${info.color}">${quick}
        <div class="co-head" title="Нажмите — расшифровка цены"><span class="dot"></span><span class="nm">${info.short}</span><span class="tags">${tags.join('')}</span><span class="val">${n}/4 · <b>$${cv.value}</b></span></div>
        <div class="slots">${C.STAGE_ORDER.map((s) => {
          const c = p.table[ind][s];
          return `<div class="slot" data-drop="slot" data-ind="${ind}" data-stage="${s}">${c ? cardHTML(c) : `<span class="l-full">${C.STAGES[s]}</span><span class="l-short">${STAGE_SHORT[s]}</span>`}</div>`;
        }).join('')}</div></div>`;
    }).join('');

    // ---- рука ----
    const hand = sortHand(p.hand);
    const zone = $('#hand-zone');
    const handEl = $('#hand');
    handEl.style.removeProperty('--w');
    const probe = handEl.querySelector('.card');
    let cardW = probe ? probe.getBoundingClientRect().width : 100;
    const maxW = Math.floor((zone.clientHeight - 14) / 1.4478);
    if (maxW > 30 && cardW > maxW) { cardW = maxW; handEl.style.setProperty('--w', maxW + 'px'); }
    const need = hand.length * (cardW + 8);
    const hw = zone.clientWidth || 600;
    const overlap = need > hw ? Math.ceil((need - hw) / (hand.length * 2)) + 4 : -4;
    handEl.style.setProperty('--overlap', overlap + 'px');
    handEl.innerHTML = hand.length
      ? hand.map((c) => cardHTML(c, { cid: c.id, zoom: false, drag: 'hand', cls: S.knownHand.has(c.id) ? '' : 'new' })).join('')
      : '<div class="empty-hand">На руке нет карт</div>';
    S.knownHand = new Set(p.hand.map((c) => c.id));

    for (const q of g.players) {
      const prev = S.lastMoney[q.id];
      if (prev != null && prev !== q.money) floatMoney($(`[data-money="${q.id}"]`), q.money - prev);
      S.lastMoney[q.id] = q.money;
    }
  }

  function contextHint(p) {
    const g = S.game;
    const hasSale = p.hand.some((c) => c.type === 'sale');
    const ready = C.IND_ORDER.filter((i) => g.isComplete(p, i));
    if (ready.length && hasSale) {
      if (ready.every((i) => g.companyValue(p, i).blocked)) return '⛔ Компания собрана, но на отрасль санкции — ждите следующего раунда.';
      return '💰 Перетащите «Продажу» на собранную компанию!';
    }
    if (ready.length) return 'Компания собрана — нужна «Продажа». Или нажмите «⚡ Срочно» — продать за 50%.';
    const stages = p.hand.filter((c) => c.type === 'stage');
    const buildable = stages.filter((c) => g.improves(p, c));
    if (buildable.length) return `Перетащите ${buildable.length} ${plural(buildable.length, 'этап', 'этапа', 'этапов')} в компании — это бесплатно.`;
    if (stages.length > g.rules.stageReserve) return `В конце хода в руке останется ${g.rules.stageReserve} этап — лишние продайте 🏦 или выставьте на 🔨.`;
    if (g.actionsLeft > 0) return `Сделок: ${g.actionsLeft}. Колоду — в руку, карту — на 🏦, 🔨 или соперника.`;
    return 'Сделки закончились — завершите ход.';
  }

  // ======================== Старт ========================
  loadSettings();
  initMenu();
  initGameEvents();
  initDrag();
  window.HoldingUI = { S, startGame, A, showSettings };
})();
