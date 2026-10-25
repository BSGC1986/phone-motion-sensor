/* Motion Games — core. One page, two roles:
   • host (PC):   index.html            → pick a game, run the clock + scoreboard
   • phone:       index.html?join=ID    → sensor that stays linked while the host changes games */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const G = 9.81, TAU = Math.PI * 2;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const params = new URLSearchParams(location.search);
  const joinId = params.get('join');
  const baseUrl = location.href.split(/[?#]/)[0];
  const GAMES = window.GAMES;
  const COLORS = ['#ff6b6b', '#5aa8ff', '#4cd37b', '#ffb547', '#c084fc', '#2dd4bf', '#f472b6', '#a3e635'];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

  /* ---------- sound ---------- */
  let audio = null;
  function ensureAudio() { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch (_) {} }
  document.addEventListener('pointerdown', ensureAudio);
  function beep(freq, ms, vol = .15, type = 'sine') {
    if (!$('sound') || !$('sound').checked) return;
    try {
      ensureAudio(); const o = audio.createOscillator(), g = audio.createGain();
      o.type = type; o.frequency.value = freq; g.gain.value = vol; o.connect(g); g.connect(audio.destination);
      o.start(); g.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + ms / 1000); o.stop(audio.currentTime + ms / 1000);
    } catch (_) {}
  }
  const fmt = (ms, up) => {
    const t = up ? Math.floor(ms / 100) : Math.ceil(ms / 100);
    return `${Math.floor(t / 600)}:${String(Math.floor(t / 10) % 60).padStart(2, '0')}.${t % 10}`;
  };
  async function wake() { try { if ('wakeLock' in navigator) await navigator.wakeLock.request('screen'); } catch (_) {} }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && (joinId || window.__hostOn)) wake(); });

  /* =====================================================================
     PHONE SIDE — reads sensors, streams frames, shows the host's status
     ===================================================================== */
  class Sensor {
    constructor(send) {
      this.send = send; this.cfg = { thr: 2.5, gap: 200, air: .5 };
      this.rot = 0; this.wob = 0; this.b = 0; this.c = 0; this.g = 1; this.gmax = 0; this.gmin = 99;
      this.pend = null; this.rearm = true; this.lastHit = -1e9; this.airStart = 0; this.airN = 0;
      this.lastT = 0; this.lastFrame = performance.now(); this.got = false;
    }
    async start() {
      if (!window.isSecureContext) throw new Error('Sensors need HTTPS.');
      for (const E of [window.DeviceMotionEvent, window.DeviceOrientationEvent])
        if (E && typeof E.requestPermission === 'function' && await E.requestPermission() !== 'granted') throw new Error('Motion permission was denied.');
      addEventListener('devicemotion', e => this.motion(e));
      addEventListener('deviceorientation', e => { if (e.beta != null) { this.b = e.beta; this.c = e.gamma; } });
      setInterval(() => this.tick(), 20);
      wake();
      await new Promise(r => setTimeout(r, 1500));
      if (!this.got) throw new Error('No motion data. Use a phone and allow Motion sensors in Chrome site settings.');
    }
    motion(e) {
      const a = e.accelerationIncludingGravity; if (!a || a.x == null) return;
      this.got = true;
      const now = performance.now(), dt = this.lastT ? Math.min(now - this.lastT, 100) / 1000 : .016; this.lastT = now;
      const g = Math.hypot(a.x, a.y, a.z) / G; this.g = g;
      const r = e.rotationRate; if (r && r.alpha != null) this.rot += Math.hypot(r.alpha, r.beta, r.gamma) * dt;   // degrees
      this.wob += Math.abs(g - 1) * dt;
      if (g > this.gmax) this.gmax = g; if (g < this.gmin) this.gmin = g;
      const c = this.cfg;
      if (this.pend) { if (g > this.pend.peak) this.pend.peak = g; if (now - this.pend.t0 >= 40) this.commit(); }
      if (!this.rearm && g < c.thr * .7 && now - this.lastHit > c.gap) this.rearm = true;
      if (this.rearm && !this.pend && g > c.thr && now - this.lastHit > c.gap) { this.pend = { t0: now, peak: g }; this.rearm = false; this.lastHit = now; }
      // weightlessness = thrown or dropped
      if (g < c.air) { if (!this.airStart) { this.airStart = now; this.airN = 0; } this.airN++; }
      else if (this.airStart) {
        const ms = now - this.airStart; if (this.airN >= 4 && ms >= 100) this.send({ t: 'air', ms: Math.round(ms) });
        this.airStart = 0;
      }
    }
    commit() { const p = this.pend; this.pend = null; this.send({ t: 'hit', g: +p.peak.toFixed(2) }); }
    tick() {
      const now = performance.now();
      if (this.pend && now - this.pend.t0 >= 40) this.commit();
      if (now - this.lastFrame >= 50) {
        const f = { t: 'f', dt: Math.round(now - this.lastFrame), gx: +this.gmax.toFixed(2), gn: +Math.min(this.gmin, 9).toFixed(2), b: +this.b.toFixed(1), c: +this.c.toFixed(1), rot: +this.rot.toFixed(1), wob: +this.wob.toFixed(3), air: this.airN >= 3 && !!this.airStart };
        this.lastFrame = now; this.gmax = this.g; this.gmin = this.g;
        this.send(f); $('pGauge').textContent = f.gx.toFixed(1);
      }
    }
  }

  function runPhone(hostId) {
    $('phone').classList.remove('hidden');
    let devId = params.get('dev') || lsGet('mgDev');
    if (!devId) { devId = Math.random().toString(36).slice(2, 10); lsSet('mgDev', devId); }
    let peer, conn, retry = false;
    const setConn = (txt, ok) => { $('pConn').textContent = txt; $('pConn').style.color = ok ? 'var(--good)' : 'var(--accent)'; };
    const sensor = new Sensor(m => { if (conn && conn.open) conn.send(m); });

    function onData(m) {
      if (m.t === 'cfg') Object.assign(sensor.cfg, m.cfg);
      else if (m.t === 'mode') {
        $('pGame').textContent = m.id ? `${m.emoji} ${m.title}` : '🏠 Waiting for a game';
        document.documentElement.style.setProperty('--ga', m.accent || '#ffb547');
      } else if (m.t === 'ph') {
        $('pTeam').textContent = m.name; $('pTeam').style.color = m.color;
        $('pBig').textContent = m.big ?? ''; $('pSub').textContent = m.sub || '';
        $('pMeter').classList.toggle('hidden', m.meter == null);
        if (m.meter != null) { $('pBar').style.width = (m.meter * 100) + '%'; $('pBar').style.background = `hsl(${m.meter * 120},80%,50%)`; }
        $('pBox').style.background = m.bg || '';
      }
    }
    function connect() {
      retry = false;
      conn = peer.connect(hostId, { reliable: true });
      conn.on('open', () => { setConn('Connected ✓', true); conn.send({ t: 'hello', id: devId }); });
      conn.on('data', onData);
      const lost = () => { setConn('Reconnecting…', false); if (!retry) { retry = true; setTimeout(connect, 2000); } };
      conn.on('close', lost); conn.on('error', lost);
    }
    $('pStart').addEventListener('click', async () => {
      $('pMsg').className = 'muted'; $('pMsg').textContent = 'Starting…';
      try { await sensor.start(); } catch (e) { $('pMsg').className = 'err'; $('pMsg').textContent = e.message; return; }
      $('pStartCard').classList.add('hidden'); $('pLive').classList.remove('hidden');
      peer = new Peer();
      peer.on('open', connect);
      peer.on('disconnected', () => peer.reconnect());
      peer.on('error', e => {
        setConn(e.type === 'peer-unavailable' ? 'Host not found — is it open?' : 'Link error: ' + e.type, false);
        if (e.type === 'peer-unavailable' && !retry) { retry = true; setTimeout(connect, 2000); }
      });
    });
  }

  /* =====================================================================
     HOST SIDE — clock, teams, scoreboard
     ===================================================================== */
  const H = window.H = {
    teams: [], game: null, st: 'idle', startAt: 0, endAt: Infinity, dur: 0, el: 0, set: {},
    G, fmt, beep, clamp,
    elapsed(now) { return this.st === 'running' ? now - this.startAt : (this.st === 'finished' ? this.el : 0); },
    log(t, msg) { feed.unshift({ c: t.color, n: t.name, m: msg }); if (feed.length > 60) feed.pop(); renderFeed(); },
    pushCfg(t) { t.send && t.send({ t: 'cfg', cfg: { thr: t.thr, gap: H.set.gap || 200, air: t.air == null ? .5 : t.air } }); },
    pushAll() { H.teams.forEach(t => { t.lastPh = ''; }); },
    finish(timeUp) { finish(timeUp); }
  };
  const feed = [];

  /* ---- sensitivity: one value per game, set for all phones or overridden per phone ---- */
  const sensStore = (() => { try { return JSON.parse(lsGet('mgSens')) || {}; } catch (_) { return {}; } })();
  const saveSens = () => lsSet('mgSens', JSON.stringify(sensStore));
  H.sv = t => {
    const g = H.game, s = g && g.sens; if (!s) return 0;
    const own = sensStore[g.id + '|' + t.id], all = sensStore[g.id + '|all'];
    return own != null ? own : all != null ? all : s.def;
  };
  const decimals = s => (String(s.step).split('.')[1] || '').length;
  function applySens(t) { const s = H.game && H.game.sens; if (s && s.apply) s.apply(t); H.pushCfg(t); }
  function setSens(t, val) { sensStore[H.game.id + '|' + t.id] = val; saveSens(); applySens(t); syncSensUi(); }
  function setAllSens(val) {
    const id = H.game.id; sensStore[id + '|all'] = val;
    Object.keys(sensStore).forEach(k => { if (k.startsWith(id + '|') && k !== id + '|all') delete sensStore[k]; });
    saveSens(); H.teams.forEach(applySens); syncSensUi();
  }
  function syncSensUi() {
    const g = H.game, s = g && g.sens; if (!s) return;
    const dp = decimals(s);
    H.teams.forEach(t => {
      if (!t.card) return;
      const v = H.sv(t), sl = t.card.querySelector('.ssl');
      if (sl && +sl.value !== v) sl.value = v;
      const own = sensStore[g.id + '|' + t.id] != null;
      t.card.querySelector('.sval').textContent = v.toFixed(dp) + s.unit + (own ? ' (this phone)' : '');
    });
    const all = sensStore[g.id + '|all'], av = all != null ? all : s.def;
    if ($('sensAll') && +$('sensAll').value !== av) $('sensAll').value = av;
    if ($('sensAllV')) $('sensAllV').textContent = av.toFixed(dp) + s.unit;
  }
  function sensMeter(t) {                                   // live signal vs the trigger line
    const s = H.game.sens, v = H.sv(t), sig = s.signal(t);
    if (!isFinite(sig) || !t.card) return;
    const trig = s.flip ? sig < v : sig > v, f = t.card.querySelector('.sfill');
    f.style.width = clamp(sig / s.scale, 0, 1) * 100 + '%'; f.style.background = trig ? 'var(--ga)' : '#5aa8ff';
    t.card.querySelector('.smark').style.left = clamp(v / s.scale, 0, 1) * 100 + '%';
    t.card.querySelector('.slive').textContent = `now ${sig.toFixed(s.dp != null ? s.dp : 1)}${s.unit}`;
  }
  const saved = (() => { try { return JSON.parse(lsGet('mgTeams')) || {}; } catch (_) { return {}; } })();
  const saveNames = () => { const o = {}; H.teams.forEach(t => { o[t.id] = { name: t.name, color: t.color }; }); lsSet('mgTeams', JSON.stringify(o)); };

  function renderFeed() {
    $('feed').innerHTML = feed.slice(0, 16).map(e => `<li><b style="color:${e.c}">${esc(e.n)}</b> ${esc(e.m)}</li>`).join('');
  }

  /* ---- home grid ---- */
  function buildHome() {
    $('games').innerHTML = Object.values(GAMES).map(g => `
      <button class="gcard" data-id="${g.id}" style="--ga:${g.accent}">
        <span class="gemoji">${g.emoji}</span><b>${g.title}</b><span>${g.blurb}</span>
      </button>`).join('') + `
      <a class="gcard tool" href="sensors.html"><span class="gemoji">📱</span><b>Sensor Viewer</b><span>Live orientation, level, acceleration and rotation on one phone.</span></a>`;
    $('games').querySelectorAll('button.gcard').forEach(b => b.onclick = () => openGame(b.dataset.id));
  }

  /* ---- teams ---- */
  function addTeam(id) {
    let t = H.teams.find(x => x.id === id);
    if (t) return t;
    const s = saved[id], i = H.teams.length;
    t = { id, i, online: false, send: null, conn: null, f: null, lr: null, lw: null, thr: 2.5, lastPh: '', lastDraw: performance.now(),
          name: s ? s.name : 'Team ' + (i + 1), color: s ? s.color : COLORS[i % COLORS.length], s: {} };
    H.teams.push(t); saveNames();
    if (H.game) { H.game.reset(t); buildCard(t); applySens(t); }
    return t;
  }
  function renderPhones() {
    $('phones').innerHTML = H.teams.length ? '' : '<div class="muted">No phones yet — scan the QR code.</div>';
    H.teams.forEach(t => {
      const row = document.createElement('div'); row.className = 'prow';
      row.innerHTML = `<span class="dot" style="background:${t.color}"></span><input maxlength="20" aria-label="Team name"><span class="pst ${t.online ? 'on' : ''}">${t.online ? '● online' : '○ offline'}</span>${t.online ? '' : '<button class="x" title="Remove">×</button>'}`;
      const inp = row.querySelector('input'); inp.value = t.name;
      inp.oninput = () => { t.name = inp.value; saveNames(); t.lastPh = ''; };
      const x = row.querySelector('.x');
      if (x) x.onclick = () => { H.teams.splice(H.teams.indexOf(t), 1); if (t.card) t.card.remove(); saveNames(); renderPhones(); };
      $('phones').appendChild(row);
    });
    const n = H.teams.filter(t => t.online).length;
    $('conn').textContent = n ? `${n} phone${n === 1 ? '' : 's'} connected ✓` : 'Waiting for phones…';
    if ($('startBtn')) $('startBtn').disabled = !H.teams.length;
  }

  function buildCard(t) {
    const g = H.game, d = document.createElement('div');
    d.className = 'team'; d.style.setProperty('--tc', t.color);
    d.innerHTML = `<div class="thead"><span class="tn"></span><span class="ts"></span></div><canvas class="arena"></canvas><div class="tscore">0</div><div class="tsub"></div>${g.sens ? `<div class="sens"><div class="sbar"><i class="sfill"></i><b class="smark"></b></div><div class="srow"><span>${g.sens.label}: <b class="sval"></b></span><span class="slive"></span></div><input type="range" class="ssl" min="${g.sens.min}" max="${g.sens.max}" step="${g.sens.step}"></div>` : ''}<div class="textra">${g.extra ? g.extra(t) : ''}</div>`;
    t.card = d; t.cv = d.querySelector('canvas'); t.cx = t.cv.getContext('2d'); t.ex = d.querySelector('.textra');
    $('teams').appendChild(d);
    if (g.bind) g.bind(t, t.ex);
    if (g.sens) { d.querySelector('.ssl').oninput = e => setSens(t, +e.target.value); syncSensUi(); }
  }

  /* ---- settings panel ---- */
  function buildSettings() {
    const g = H.game, box = $('settings'); box.innerHTML = ''; H.set = {};
    const row = html => { const d = document.createElement('div'); d.className = 'field'; d.innerHTML = html; box.appendChild(d); return d; };
    if (g.sens) {
      const s = g.sens, d = row(`<label>🎚️ Sensitivity — <b>all phones</b>: <b id="sensAllV"></b><br><span style="font-size:.8rem">${s.hint}<br>Each team's card has its own slider for a single phone.</span></label><input type="range" id="sensAll" min="${s.min}" max="${s.max}" step="${s.step}">`);
      d.querySelector('#sensAll').oninput = e => setAllSens(+e.target.value);
    }
    if (g.mode === 'timed') {
      H.set.min = Math.floor(g.defDur / 60); H.set.sec = g.defDur % 60;
      const d = row(`<label>Everyone plays for (0:00 = no limit)</label><div class="time"><input type="number" id="s_min" min="0" max="99" value="${H.set.min}" inputmode="numeric"> <span class="muted">min</span> <input type="number" id="s_sec" min="0" max="59" value="${H.set.sec}" inputmode="numeric"> <span class="muted">sec</span></div>`);
      d.querySelector('#s_min').oninput = e => { H.set.min = +e.target.value || 0; }; d.querySelector('#s_sec').oninput = e => { H.set.sec = +e.target.value || 0; };
    }
    (g.settings || []).forEach(s => {
      H.set[s.k] = s.val; let d;
      if (s.type === 'check') {
        d = row(`<label class="chk"><input type="checkbox" ${s.val ? 'checked' : ''}> ${s.label}</label>`);
        d.querySelector('input').onchange = e => { H.set[s.k] = e.target.checked; g.onSetting && g.onSetting(s.k); };
      } else if (s.type === 'range') {
        d = row(`<label>${s.label.replace('{v}', `<b class="v">${s.val}</b>`)}</label><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.val}">`);
        d.querySelector('input').oninput = e => { H.set[s.k] = +e.target.value; d.querySelector('.v').textContent = e.target.value; g.onSetting && g.onSetting(s.k); };
      } else {
        d = row(`<label>${s.label}</label><input type="number" min="${s.min}" max="${s.max}" value="${s.val}" inputmode="numeric">`);
        d.querySelector('input').oninput = e => { H.set[s.k] = clamp(+e.target.value || s.min, s.min, s.max); g.onSetting && g.onSetting(s.k); };
      }
    });
    $('settingsCard').classList.toggle('hidden', !box.children.length);
  }
  const cfgDur = () => ((H.set.min || 0) * 60 + (H.set.sec || 0)) * 1000;

  /* ---- screens ---- */
  function sendMode(t) {
    const g = H.game;
    t.send && t.send({ t: 'mode', id: g ? g.id : null, emoji: g && g.emoji, title: g && g.title, accent: g ? g.accent : '#ffb547' });
    t.lastPh = '';
  }
  function openGame(id) {
    if (H.game && H.game.destroy) H.game.destroy();
    const g = H.game = GAMES[id];
    H.st = 'idle'; H.el = 0; H.startAt = 0; H.endAt = Infinity; feed.length = 0; renderFeed();
    $('banner').classList.add('hidden');
    $('home').classList.add('hidden'); $('play').classList.remove('hidden');
    $('crumb').textContent = `${g.emoji} ${g.title}`; $('homeLink').classList.remove('hidden');
    $('howto').textContent = g.how; $('clock').style.setProperty('--ga', g.accent);
    document.documentElement.style.setProperty('--ga', g.accent);
    buildSettings(); $('teams').innerHTML = '';
    H.teams.forEach(t => { g.reset(t); buildCard(t); });
    syncSensUi(); renderPhones();
    H.teams.forEach(t => { sendMode(t); applySens(t); });
  }
  function goHome() {
    H.game = null; H.st = 'idle';
    $('play').classList.add('hidden'); $('home').classList.remove('hidden'); $('homeLink').classList.add('hidden');
    $('crumb').textContent = ''; $('settingsCard').classList.add('hidden'); document.documentElement.style.setProperty('--ga', '#ffb547');
    $('teams').innerHTML = ''; feed.length = 0; renderFeed();
    H.teams.forEach(t => { t.card = null; sendMode(t); });
  }

  /* ---- run state machine ---- */
  function startGame() {
    const g = H.game; if (!g || H.st === 'running' || H.st === 'armed' || !H.teams.length) return;
    H.teams.forEach(t => g.reset(t)); feed.length = 0; renderFeed();
    $('banner').classList.add('hidden'); H.teams.forEach(t => t.card.classList.remove('win'));
    H.dur = g.mode === 'timed' ? cfgDur() : 0;
    if (g.mode === 'rounds') { begin(performance.now()); g.onStart && g.onStart(); }
    else if (H.set.onFirst && g.armable) H.st = 'armed';
    else begin(performance.now());
    H.pushAll();
  }
  function begin(now) {
    const g = H.game; H.st = 'running'; H.startAt = now;
    H.endAt = g.mode === 'timed' && H.dur > 0 ? now + H.dur : Infinity;
    g.onBegin && g.onBegin(now);
  }
  function finish(timeUp) {
    if (H.st === 'finished' || !H.game) return;
    const g = H.game, now = performance.now();
    H.el = timeUp ? H.dur : now - H.startAt; H.st = 'finished';
    g.onFinish && g.onFinish();
    const key = t => g.rankKey ? g.rankKey(t) : g.score(t);
    const pl = H.teams.filter(t => !g.played || g.played(t));
    let txt;
    if (!pl.length) txt = timeUp ? "Time's up — no scores" : 'No scores';
    else {
      const ks = pl.map(key), best = g.better === 'low' ? Math.min(...ks) : Math.max(...ks);
      const win = pl.filter(t => key(t) === best);
      if (H.teams.length === 1) txt = `${g.title}: ${g.scoreText(pl[0])}`;
      else if (win.length === 1) txt = `🏆 ${win[0].name} wins — ${g.scoreText(win[0])}`;
      else txt = `🤝 Tie: ${win.map(t => t.name).join(' & ')} — ${g.scoreText(win[0])}`;
      if (H.teams.length > 1) win.forEach(t => t.card.classList.add('win'));
    }
    $('banner').textContent = txt; $('banner').classList.remove('hidden');
    beep(440, 600, .25); H.pushAll();
  }
  function stopGame() {
    if (H.st === 'running') finish(false);
    else if (H.st === 'armed') H.st = 'idle';
  }
  function resetGame() {
    const g = H.game; if (!g) return;
    H.st = 'idle'; H.el = 0; H.teams.forEach(t => { g.reset(t); t.card.classList.remove('win'); });
    feed.length = 0; renderFeed(); $('banner').classList.add('hidden'); H.pushAll();
  }

  /* ---- messages from phones ---- */
  function onPhoneData(c, ref, m) {
    const g = H.game, now = performance.now();
    if (m.t === 'hello') {
      const t = addTeam(m.id);
      if (t.conn && t.conn !== c && t.conn.open) t.conn.close();
      t.conn = c; t.online = true; ref.t = t; t.lr = null; t.lw = null;
      t.send = x => { if (c.open) c.send(x); };
      sendMode(t); applySens(t); renderPhones(); beep(660, 80);
      return;
    }
    const t = ref.t; if (!t) return;
    if (m.t === 'f') {
      t.f = m;
      const d = { rot: t.lr == null ? 0 : Math.max(0, m.rot - t.lr), wob: t.lw == null ? 0 : Math.max(0, m.wob - t.lw) };
      t.lr = m.rot; t.lw = m.wob;
      if (g && g.onFrame) g.onFrame(t, m, d, m.dt || 50, now);
    } else if (m.t === 'hit' && g) {
      if (H.st === 'armed' && g.armable) begin(now);
      const counted = H.st === 'running' && now <= H.endAt;
      g.onHit && g.onHit(t, m.g, counted, now);
      if (t.card) { t.card.classList.add('flash'); setTimeout(() => t.card && t.card.classList.remove('flash'), 120); }
    } else if (m.t === 'air' && g) {
      g.onAir && g.onAir(t, m.ms, now);
    }
  }

  /* ---- render loop ---- */
  // Draws one team's arena on any canvas (PC card or live-view window). The arena is laid out 150 px tall and scaled up.
  function drawOn(t, cv, cx, now, win) {
    const r = win.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * r)) { cv.width = Math.round(w * r); cv.height = Math.round(h * r); }
    const dt = Math.max(0, Math.min(.05, (now - t.lastDraw) / 1000)); t.lastDraw = Math.max(now, t.lastDraw);
    const k = h / 150;
    cx.setTransform(r * k, 0, 0, r * k, 0, 0);
    H.game.draw(t, cx, w / k, 150, now, dt);
  }
  const drawTeam = (t, now) => drawOn(t, t.cv, t.cx, now, window);
  function paint() {
    requestAnimationFrame(paint);
    if (!H.game) return;
    const now = performance.now();
    H.teams.forEach(t => { if (t.card) drawTeam(t, now); });
  }
  function logic() {                                        // runs on a timer so a hidden tab keeps the clock honest
    const g = H.game, now = performance.now();
    if (!g) { viewTick(now); return; }
    if (H.st === 'running' && now >= H.endAt) finish(true);
    g.tick && g.tick(now);
    const ck = g.clock ? g.clock(now) : null, el = H.elapsed(now);
    const d = (H.st === 'running' || H.st === 'finished') ? H.dur : cfgDur();
    if (ck) { $('timer').textContent = ck.big; $('timer').classList.add('small'); $('tsubline').textContent = ck.sub; $('clock').dataset.mood = ck.mood || ''; }
    else {
      $('timer').classList.remove('small'); $('clock').dataset.mood = '';
      $('timer').textContent = g.mode === 'timed' && d > 0 ? fmt(Math.max(0, d - el), false) : fmt(el, true);
      $('tsubline').textContent = '';
    }
    $('pill').textContent = { idle: 'ready', armed: 'waiting for the first bounce', running: g.mode === 'timed' ? 'counting' : 'in progress', finished: 'finished' }[H.st];
    $('pill').className = H.st;
    const live = H.st === 'running' || H.st === 'armed';
    $('startBtn').textContent = live ? 'Stop' : 'Start'; $('startBtn').className = live ? 'stop' : '';
    H.teams.forEach(t => {
      if (!t.card) return;
      t.card.querySelector('.tn').textContent = t.name; t.card.querySelector('.tn').style.color = t.color;
      const st = t.card.querySelector('.ts'); st.textContent = t.online ? '● online' : '○ offline'; st.className = 'ts' + (t.online ? ' on' : '');
      t.card.classList.toggle('off', !t.online);
      t.card.querySelector('.tscore').textContent = g.scoreText(t);
      t.card.querySelector('.tsub').textContent = g.sub ? g.sub(t) : '';
      g.cardUpdate && g.cardUpdate(t, t.ex);
      if (g.sens) sensMeter(t);
      if (t.send && t.online && g.phone) {                  // keep the phone's screen in step
        const ph = g.phone(t, now), msg = { t: 'ph', name: t.name, color: t.color, big: ph.big, sub: ph.sub || '', meter: ph.meter == null ? null : +ph.meter.toFixed(2), bg: ph.bg || null };
        const key = JSON.stringify(msg);
        if (key !== t.lastPh && now - (t.lastPhAt || 0) > 150) { t.lastPh = key; t.lastPhAt = now; t.send(msg); }
      }
    });
    viewTick(now);
  }

  /* ---- live view: a second window (drag it to a projector / TV) that only shows the game, then the results ---- */
  let view = null;
  function openView() {
    if (view && !view.w.closed) { view.w.focus(); return; }
    const w = window.open('view.html', 'mgview', 'width=1280,height=720');
    if (!w) { alert('The browser blocked the pop-up. Allow pop-ups for this site, then click Live view again.'); return; }
    H.attachView(w);
  }
  H.attachView = w => { view = { w, d: null, key: '', fin: false, painting: false }; };
  function viewTick(now) {
    if (!view) return;
    if (view.w.closed) { view = null; return; }
    let d; try { d = view.w.document; } catch (_) { return; }
    const v = id => d.getElementById(id);
    if (!v('vTeams')) return;                               // still loading
    if (view.d !== d) { view.d = d; view.key = ''; view.painting = false; }
    const g = H.game, key = (g ? g.id : 'home') + '|' + H.teams.map(t => t.id).join(',');
    if (key !== view.key) {                                 // game or team list changed → rebuild the cards
      view.key = key; view.fin = false;
      v('vHome').classList.toggle('hidden', !!g); v('vGame').classList.toggle('hidden', !g); v('vResults').classList.add('hidden');
      v('vTeams').innerHTML = ''; v('vTeams').dataset.n = H.teams.length;
      H.teams.forEach(t => { t.vcard = null; });
      if (g) {
        d.documentElement.style.setProperty('--ga', g.accent); v('vTitle').textContent = `${g.emoji} ${g.title}`;
        H.teams.forEach(t => {
          const c = d.createElement('div'); c.className = 'vt'; c.style.setProperty('--tc', t.color);
          c.innerHTML = '<div class="vn"></div><canvas></canvas><div class="vs"></div><div class="vsub"></div>';
          v('vTeams').appendChild(c); t.vcard = c; t.vcv = c.querySelector('canvas'); t.vcx = t.vcv.getContext('2d');
        });
      }
    }
    if (!view.painting) {                                   // paint on the view window's own frame clock
      view.painting = true; const w = view.w;
      const loop = () => { if (!view || view.w !== w || w.closed) return; w.requestAnimationFrame(loop); vPaint(performance.now()); };
      w.requestAnimationFrame(loop);
    }
    if (!g) {
      v('vChips').innerHTML = H.teams.length ? H.teams.map(t => `<span class="chip" style="--tc:${t.color}">${esc(t.name)}${t.online ? '' : ' ○'}</span>`).join('') : '<span class="muted">Waiting for phones to join…</span>';
      return;
    }
    v('vTimer').textContent = $('timer').textContent; v('vSub').textContent = $('tsubline').textContent;
    v('vClock').dataset.mood = $('clock').dataset.mood; v('vPill').textContent = $('pill').textContent; v('vPill').className = $('pill').className;
    H.teams.forEach(t => {
      if (!t.vcard) return;
      t.vcard.querySelector('.vn').textContent = t.name; t.vcard.querySelector('.vs').textContent = g.scoreText(t);
      t.vcard.querySelector('.vsub').textContent = g.sub ? g.sub(t) : '';
      t.vcard.classList.toggle('off', !t.online); t.vcard.classList.toggle('win', !!(t.card && t.card.classList.contains('win')));
    });
    if (H.st === 'finished') { if (!view.fin) { view.fin = true; vResults(d, g); } }
    else if (view.fin) { view.fin = false; v('vResults').classList.add('hidden'); }
  }
  function vPaint(now) {
    if (!H.game || !view || !view.d) return;
    H.teams.forEach(t => { if (t.vcard) drawOn(t, t.vcv, t.vcx, now, view.w); });
  }
  function vResults(d, g) {
    const key = t => g.rankKey ? g.rankKey(t) : g.score(t), dir = g.better === 'low' ? 1 : -1;
    const played = H.teams.filter(t => !g.played || g.played(t)), rest = H.teams.filter(t => !played.includes(t));
    const ranked = [...played].sort((a, b) => dir * (key(a) - key(b)));
    const medals = ['🥇', '🥈', '🥉'];
    const rows = ranked.map((t, i) => {
      const pos = ranked.findIndex(x => key(x) === key(t));      // ties share a place
      return `<li style="--tc:${t.color}"><span class="rk">${pos < 3 ? medals[pos] : (pos + 1) + '.'}</span><span class="rn">${esc(t.name)}</span><span class="rsc">${esc(g.scoreText(t))}</span><span class="rsub">${esc(g.sub ? g.sub(t) : '')}</span></li>`;
    }).concat(rest.map(t => `<li style="--tc:${t.color}" class="dim"><span class="rk">–</span><span class="rn">${esc(t.name)}</span><span class="rsc">${esc(g.scoreText(t))}</span><span class="rsub">did not score</span></li>`));
    d.getElementById('vResTitle').textContent = `${g.emoji} ${g.title} — Results`;
    d.getElementById('vBanner').textContent = $('banner').textContent;
    d.getElementById('vList').innerHTML = rows.join('');
    d.getElementById('vResults').classList.remove('hidden');
  }
  // home screen: tell phones their name while no game is open
  setInterval(() => {
    if (H.game) return;
    H.teams.forEach(t => {
      if (!t.send || !t.online) return;
      const msg = { t: 'ph', name: t.name, color: t.color, big: '', sub: 'Waiting for the host to pick a game…', meter: null, bg: null }, key = JSON.stringify(msg);
      if (key !== t.lastPh) { t.lastPh = key; t.send(msg); }
    });
  }, 400);

  /* ---- host start-up ---- */
  function runHost() {
    window.__hostOn = true; wake();
    $('host').classList.remove('hidden');
    buildHome(); renderPhones();
    $('homeLink').onclick = e => { e.preventDefault(); if (H.st === 'running') { if (!confirm('A game is running. Go back to the games list?')) return; } goHome(); };
    $('viewBtn').onclick = openView;
    $('startBtn').onclick = () => { if (H.st === 'running' || H.st === 'armed') stopGame(); else startGame(); };
    $('resetBtn').onclick = resetGame;
    document.addEventListener('keydown', e => {
      if ($('play').classList.contains('hidden') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); $('startBtn').click(); }
      if (e.key === 'r' || e.key === 'R') $('resetBtn').click();
    });
    paint(); setInterval(logic, 50);

    const newId = () => 'mg-' + Math.random().toString(36).slice(2, 8);
    function open(id) {
      lsSet('mgHost', id);
      const peer = new Peer(id);
      peer.on('open', () => {
        const url = `${baseUrl}?join=${id}`, qr = qrcode(0, 'M'); qr.addData(url); qr.make();
        $('qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
        $('link').textContent = url; $('qrBox').classList.remove('hidden');
      });
      peer.on('connection', c => {
        const ref = { t: null };
        c.on('data', m => onPhoneData(c, ref, m));
        c.on('close', () => { if (ref.t && ref.t.conn === c) { ref.t.online = false; ref.t.send = null; renderPhones(); } });
      });
      peer.on('disconnected', () => peer.reconnect());
      peer.on('error', e => {
        if (e.type === 'unavailable-id') { peer.destroy(); open(newId()); }
        else { $('conn').textContent = 'Link error: ' + e.type; $('conn').className = 'err'; }
      });
    }
    open(lsGet('mgHost') || newId());
  }

  if (joinId) runPhone(joinId); else runHost();
})();
