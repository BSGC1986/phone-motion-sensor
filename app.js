/* Motion Games — core. One page, two roles:
   • host (PC):   index.html            → pick a game, run the clock + scoreboard
   • phone:       index.html?join=ID    → sensor that stays linked while the host changes games */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const G = 9.81, TAU = Math.PI * 2;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const params = new URLSearchParams(location.search);
  // Every game has its own 6-character code (no I, O, 0 or 1 so it is easy to read out and type).
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const newCode = () => { const r = new Uint32Array(6); crypto.getRandomValues(r); return Array.from(r, x => ALPHA[x % ALPHA.length]).join(''); };
  const normCode = s => { const c = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^MG(?=[A-Z0-9]{6}$)/, ''); return /^[A-HJ-NP-Z2-9]{6}$/.test(c) ? c : null; };
  // A PC is never a sensor: desktops always host. Phones and tablets join (add ?host=1 to host from one).
  // ('dev' is only used by the automated tests to run a fake phone in a desktop browser.)
  const isMobile = /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  const asPhone = params.has('dev') || (isMobile && !params.has('host'));
  const joinPrefill = normCode(params.get('join'));
  window.__role = asPhone ? 'phone' : 'host';
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
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && window.__role) wake(); });

  /* =====================================================================
     PHONE SIDE — reads sensors, streams frames, shows the host's status
     ===================================================================== */
  class Sensor {
    constructor(send) {
      this.send = send; this.cfg = { thr: 2.5, gap: 200, air: .5, sw: 250 };
      this.swg = null; this.swEnd = -1e9; this.wmax = 0;                  // swing detector state (see swing())
      this.rot = 0; this.wob = 0; this.b = 0; this.c = 0; this.g = 1; this.gmax = 0; this.gmin = 99;
      this.pend = null; this.rearm = true; this.lastHit = -1e9; this.airStart = 0; this.airN = 0;
      this.lastT = 0; this.lastFrame = performance.now(); this.got = false;
      this.sgn = /iP(hone|ad|od)/.test(navigator.userAgent) ? -1 : 1;     // iOS reports gravity with the opposite sign
      this.ax = 0; this.ay = 0; this.az = 9.81; this.gv = null; this.lx = 0; this.ly = 0; this.lz = 0; this.rr = [0, 0, 0]; this.al = 0;
    }
    async start() {
      if (!window.isSecureContext) throw new Error('Sensors need HTTPS.');
      for (const E of [window.DeviceMotionEvent, window.DeviceOrientationEvent])
        if (E && typeof E.requestPermission === 'function' && await E.requestPermission() !== 'granted') throw new Error('Motion permission was denied.');
      addEventListener('devicemotion', e => this.motion(e));
      addEventListener('deviceorientation', e => { if (e.beta != null) { this.b = e.beta; this.c = e.gamma; this.al = e.alpha || 0; } });
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
      const r = e.rotationRate; if (r && r.alpha != null) { this.rot += Math.hypot(r.alpha, r.beta, r.gamma) * dt; this.rr = [r.alpha, r.beta, r.gamma]; }   // degrees
      this.ax = a.x * this.sgn; this.ay = a.y * this.sgn; this.az = a.z * this.sgn;
      if (!this.gv) this.gv = { x: this.ax, y: this.ay, z: this.az };
      const kg = 1 - Math.exp(-dt / .15);                        // slow average = gravity
      this.gv.x += (this.ax - this.gv.x) * kg; this.gv.y += (this.ay - this.gv.y) * kg; this.gv.z += (this.az - this.gv.z) * kg;
      const l = e.acceleration;
      if (l && l.x != null) { this.lx = l.x * this.sgn; this.ly = l.y * this.sgn; this.lz = l.z * this.sgn; }
      else { this.lx = this.ax - this.gv.x; this.ly = this.ay - this.gv.y; this.lz = this.az - this.gv.z; }
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
      this.swing(now, dt);
    }
    /* A swing = the phone spinning faster than cfg.sw degrees/second, then settling again.
       One summary message per swing: peak speed, when the peak happened (this phone's clock), how long it lasted,
       how far it turned, how hard it accelerated, which way it twisted, and the shape of the speed curve. */
    swing(now, dt) {
      const c = this.cfg, r = this.rr, w = Math.hypot(r[0], r[1], r[2]), acc = Math.hypot(this.lx, this.ly, this.lz);
      if (w > this.wmax) this.wmax = w;
      // "address": the phone has been still for a moment (hand-held stillness is well under 30°/s; walking never gets there)
      if (!this.swg) {                                                         // a 350 ms ramp-up out of stillness is allowed before the timer resets
        if (w < 30) { this.rest = (this.rest || 0) + dt * 1000; this.restAt = now; } else if (now - (this.restAt || 0) > 350) this.rest = 0;
      }
      let S = this.swg;
      if (!S) {
        if (now - this.swEnd < 40) return;                                     // (a backswing straight into a downswing must not lose the downswing)
        const strong = w > c.sw, soft = c.sw <= 300 && w > Math.max(40, c.sw * .28) && this.rest >= 250;   // gentle swings count only from address, and only while the slider is in its sensitive range
        if (!strong && !soft) return;
        const gv = this.gv || { x: 0, y: 0, z: G }, m = Math.hypot(gv.x, gv.y, gv.z) || 1;
        S = this.swg = { t0: now, pk: w, tPk: now, acc, ang: 0, ax: [0, 0, 0], tw: 0, twPk: 0, quiet: 0, sat: false, tr: [], g0: [gv.x / m, gv.y / m, gv.z / m], g1: null,
                         addr: this.rest >= 250, thr: strong ? c.sw : Math.max(40, c.sw * .28), kmin: strong ? 1.4 : 1.6, soft: !strong };
      }
      S.ang += w * dt;
      S.ax[0] += r[1] * dt; S.ax[1] += r[2] * dt; S.ax[2] += r[0] * dt;      // turning about the phone's x (tip), y (long axis / twist) and z (steering wheel) axes
      S.tw += r[2] * dt;
      if (acc > S.acc) S.acc = acc;
      if (w >= 1950) S.sat = true;                                            // gyros top out around 2000°/s — the real peak may be higher
      if (w > S.pk) { S.pk = w; S.tPk = now; S.twPk = S.tw; const gv = this.gv || { x: 0, y: 0, z: G }, m = Math.hypot(gv.x, gv.y, gv.z) || 1; S.g1 = [gv.x / m, gv.y / m, gv.z / m]; }
      if (S.tr.length < 200) S.tr.push(w);
      S.quiet = w < S.thr * .5 ? S.quiet + dt * 1000 : 0;
      if (S.quiet < 50 && now - S.t0 < 1600) return;
      this.swg = null; this.swEnd = now; this.rest = 0;
      const dur = now - S.t0;
      if (S.pk < S.thr * S.kmin || dur < 70 || S.ang < 15) return;           // too small or too brief to be a swing
      if (S.soft && S.pk < c.sw * 1.4 && dur > 900) return;                  // sustained gentle motion (setting off walking, waving) is not a stroke
      const am = Math.hypot(S.ax[0], S.ax[1], S.ax[2]) || 1, n = 16, tr = [];
      for (let i = 0; i < n; i++) { let m = 0; for (let k = Math.floor(i * S.tr.length / n); k < Math.max(Math.floor((i + 1) * S.tr.length / n), Math.floor(i * S.tr.length / n) + 1) && k < S.tr.length; k++) m = Math.max(m, S.tr[k]); tr.push(Math.round(m / 10)); }
      const q = v => +v.toFixed(2);
      this.send({ t: 'swing', pk: Math.round(S.pk), at: Math.round(S.tPk), dur: Math.round(dur), tpk: Math.round(S.tPk - S.t0), ang: Math.round(S.ang), acc: +S.acc.toFixed(1),
                  tw: Math.round(S.twPk), ax: S.ax.map(v => q(v / am)), g0: S.g0.map(q), g1: (S.g1 || S.g0).map(q), sat: S.sat, addr: S.addr, tr });
    }
    commit() { const p = this.pend; this.pend = null; this.send({ t: 'hit', g: +p.peak.toFixed(2) }); }
    tick() {
      const now = performance.now();
      if (this.pend && now - this.pend.t0 >= 40) this.commit();
      if (now - this.lastFrame >= 50) {
        const f = { t: 'f', dt: Math.round(now - this.lastFrame), gx: +this.gmax.toFixed(2), gn: +Math.min(this.gmin, 9).toFixed(2), b: +this.b.toFixed(1), c: +this.c.toFixed(1), rot: +this.rot.toFixed(1), wob: +this.wob.toFixed(3), air: this.airN >= 3 && !!this.airStart, v: document.visibilityState === 'visible' ? 1 : 0,
          ax: +this.ax.toFixed(2), ay: +this.ay.toFixed(2), az: +this.az.toFixed(2), lx: +this.lx.toFixed(2), ly: +this.ly.toFixed(2), lz: +this.lz.toFixed(2),
          ra: Math.round(this.rr[0]), rb: Math.round(this.rr[1]), rg: Math.round(this.rr[2]), al: Math.round(this.al), wm: Math.round(this.wmax) };
        this.lastFrame = now; this.gmax = this.g; this.gmin = this.g; this.wmax = 0;
        this.send(f); $('pGauge').textContent = f.gx.toFixed(1);
      }
    }
  }

  function runPhone(prefill) {
    $('phone').classList.remove('hidden');
    let devId = params.get('dev') || lsGet('mgDev');
    if (!devId) { devId = Math.random().toString(36).slice(2, 10); lsSet('mgDev', devId); }
    let peer, conn, retry = false, hostId = null, sensorOn = false, everConnected = false;

    /* step 1 — type the game code (the QR code fills it in for you) */
    const showJoin = msg => {
      $('pStartCard').classList.add('hidden'); $('pLive').classList.add('hidden'); $('pJoinCard').classList.remove('hidden');
      $('pJoinMsg').textContent = msg || '';
    };
    const join = () => {
      const c = normCode($('pCode').value);
      if (!c) { $('pJoinMsg').textContent = 'That code is not valid. It is 6 letters and numbers (never O, I, 0 or 1).'; return; }
      hostId = 'mg-' + c; $('pGameCode').textContent = c; $('pJoinMsg').textContent = '';
      $('pJoinCard').classList.add('hidden'); $('pStartCard').classList.remove('hidden');
      if (/Android/i.test(navigator.userAgent)) {            // hand over to the app if it is installed, otherwise offer the download
        const dir = baseUrl.replace(/[^/]*$/, '');
        $('pApp').href = `intent://join/${c}#Intent;scheme=motiongames;package=com.bsgc.motiongames;S.browser_fallback_url=${encodeURIComponent(dir + 'app.html')};end`;
        $('pApp').classList.remove('hidden');
      }
    };
    $('pJoin').onclick = join;
    $('pCode').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
    $('pChange').onclick = e => { e.preventDefault(); showJoin(); };
    $('pCode').value = prefill || ''; showJoin();
    const setConn = (txt, ok) => {
      $('pConn').textContent = txt; $('pConn').style.color = ok ? 'var(--good)' : 'var(--accent)';
      $('pDimDot').style.background = ok ? '#0a3d1c' : '#4a3500';          // faint status light in dim mode
    };
    const sensor = new Sensor(m => { if (conn && conn.open) conn.send(m); });

    /* dim mode: the screen stays on (so sensors keep running) but goes black */
    let holdT = null, autoT = null;
    function dim(on) {
      $('pDimBox').classList.toggle('hidden', !on);
      try {
        if (on && document.documentElement.requestFullscreen) { const p = document.documentElement.requestFullscreen(); if (p && p.catch) p.catch(() => {}); }
        else if (!on && document.fullscreenElement) { const p = document.exitFullscreen(); if (p && p.catch) p.catch(() => {}); }
      } catch (_) {}
    }
    $('pDim').onclick = () => dim(true);
    $('pAuto').checked = lsGet('mgAutoDim') !== '0';
    $('pAuto').onchange = () => { lsSet('mgAutoDim', $('pAuto').checked ? '1' : '0'); if (!$('pAuto').checked) clearTimeout(autoT); };
    const box = $('pDimBox');
    box.addEventListener('pointerdown', () => { clearTimeout(holdT); holdT = setTimeout(() => dim(false), 2000); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => box.addEventListener(ev, () => clearTimeout(holdT)));
    // tell the host straight away if the screen is about to switch off
    document.addEventListener('visibilitychange', () => { if (conn && conn.open) conn.send({ t: 'vis', v: document.visibilityState === 'visible' ? 1 : 0 }); });

    function onData(m) {
      if (m.t === 'cfg') Object.assign(sensor.cfg, m.cfg);
      else if (m.t === 'mode') {
        $('pGame').textContent = m.id ? `${m.emoji} ${m.title}` : '🏠 Waiting for a game';
        document.documentElement.style.setProperty('--ga', m.accent || '#ffb547');
      } else if (m.t === 'ph') {
        $('pTeam').textContent = m.name; $('pTeam').style.color = m.color; $('pDimTxt').textContent = m.name;
        $('pBig').textContent = m.big ?? ''; $('pSub').textContent = m.sub || '';
        $('pBig').classList.toggle('long', String(m.big ?? '').length > 6);
        $('pMeter').classList.toggle('hidden', m.meter == null);
        if (m.meter != null) { $('pBar').style.width = (m.meter * 100) + '%'; $('pBar').style.background = `hsl(${m.meter * 120},80%,50%)`; }
        $('pBox').style.background = m.bg || '';
      }
    }
    function connect() {
      retry = false;
      conn = peer.connect(hostId, { reliable: true });
      conn.on('open', () => { everConnected = true; setConn('Connected ✓', true); conn.send({ t: 'hello', id: devId }); });
      conn.on('data', onData);
      const lost = () => { setConn('Reconnecting…', false); if (!retry) { retry = true; setTimeout(connect, 2000); } };
      conn.on('close', lost); conn.on('error', lost);
    }
    $('pStart').addEventListener('click', async () => {
      $('pMsg').className = 'muted'; $('pMsg').textContent = 'Starting…';
      if (!sensorOn) {
        try { await sensor.start(); sensorOn = true; } catch (e) { $('pMsg').className = 'err'; $('pMsg').textContent = e.message; return; }
      }
      $('pStartCard').classList.add('hidden'); $('pLive').classList.remove('hidden');
      clearTimeout(autoT);
      if ($('pAuto').checked) autoT = setTimeout(() => { if ($('pAuto').checked) dim(true); }, 20000);
      everConnected = false; retry = false;
      if (peer) { try { peer.destroy(); } catch (_) {} }
      const p = peer = new Peer();
      p.on('open', connect);
      p.on('disconnected', () => { if (!p.destroyed) p.reconnect(); });
      p.on('error', e => {
        if (e.type === 'peer-unavailable' && !everConnected) {          // wrong code: nobody is hosting that game
          dim(false); clearTimeout(autoT); try { p.destroy(); } catch (_) {}
          showJoin(`No game found with code ${$('pGameCode').textContent}. Check the code on the PC screen and try again.`);
          return;
        }
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
    pushCfg(t) { t.send && t.send({ t: 'cfg', cfg: { thr: t.thr, gap: H.set.gap || 200, air: t.air == null ? .5 : t.air, sw: t.sw == null ? 250 : t.sw } }); },
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
    $('games').innerHTML = Object.values(GAMES).sort((a, b) => (a.mode === 'free') - (b.mode === 'free')).map(g => `
      <button class="gcard" data-id="${g.id}" style="--ga:${g.accent}">
        <span class="gemoji">${g.emoji}</span><b>${g.title}</b><span>${g.blurb}</span>
      </button>`).join('');
    $('games').insertAdjacentHTML('afterbegin', `
      <button class="gcard" id="tourCard" style="--ga:#ffd166">
        <span class="gemoji">🏆</span><b>Tournament</b><span>Pick several games, set the rounds and timings, and crown an overall champion — with a countdown break between games.</span>
      </button>`);
    $('games').querySelectorAll('button.gcard[data-id]').forEach(b => b.onclick = () => openGame(b.dataset.id));
    $('tourCard').onclick = tourSetup;
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
      row.innerHTML = `<span class="dot" style="background:${t.color}"></span><input maxlength="20" aria-label="Team name"><span class="pst ${t.asleep ? 'zz' : t.online ? 'on' : ''}">${t.asleep ? '😴 asleep' : t.online ? '● online' : '○ offline'}${t.kind === 'app' ? ' 📲' : ''}</span>${t.online ? '' : '<button class="x" title="Remove">×</button>'}`;
      const inp = row.querySelector('input'); inp.value = t.name;
      inp.oninput = () => { t.name = inp.value; saveNames(); t.lastPh = ''; };
      const x = row.querySelector('.x');
      if (x) x.onclick = () => { H.teams.splice(H.teams.indexOf(t), 1); if (t.card) t.card.remove(); saveNames(); renderPhones(); };
      $('phones').appendChild(row);
    });
    const n = H.teams.filter(t => t.online).length, z = H.teams.filter(t => t.asleep).length;
    $('conn').textContent = n ? `${n} phone${n === 1 ? '' : 's'} connected ✓${z ? ` · ${z} asleep 😴` : ''}` : 'Waiting for phones…';
    if ($('startBtn')) $('startBtn').disabled = !H.teams.length;
  }

  function buildCard(t) {
    const g = H.game, d = document.createElement('div');
    d.className = 'team'; d.style.setProperty('--tc', t.color);
    d.innerHTML = `<div class="thead"><span class="tn"></span><span class="ts"></span></div><canvas class="arena"${g.arenaH ? ` style="height:${g.arenaH}px"` : ''}></canvas><div class="tscore${g.small ? ' small' : ''}">0</div><div class="tsub"></div>${g.sens ? `<div class="sens"><div class="sbar"><i class="sfill"></i><b class="smark"></b></div><div class="srow"><span>${g.sens.label}: <b class="sval"></b></span><span class="slive"></span></div><input type="range" class="ssl" min="${g.sens.min}" max="${g.sens.max}" step="${g.sens.step}"></div>` : ''}<div class="textra">${g.extra ? g.extra(t) : ''}</div>`;
    t.card = d; t.cv = d.querySelector('canvas'); t.cx = t.cv.getContext('2d'); t.ex = d.querySelector('.textra');
    $('teams').appendChild(d);
    if (g.bind) g.bind(t, t.ex);
    if (g.sens) { d.querySelector('.ssl').oninput = e => setSens(t, +e.target.value); syncSensUi(); }
  }

  /* ---- settings panel ---- */
  function buildSettings(ov) {                              // ov = values forced by a tournament setup
    const g = H.game, box = $('settings'); box.innerHTML = ''; H.set = {};
    const row = html => { const d = document.createElement('div'); d.className = 'field'; d.innerHTML = html; box.appendChild(d); return d; };
    if (g.sens) {
      const s = g.sens, d = row(`<label>🎚️ Sensitivity — <b>all phones</b>: <b id="sensAllV"></b><br><span style="font-size:.8rem">${s.hint}<br>Each team's card has its own slider for a single phone.</span></label><input type="range" id="sensAll" min="${s.min}" max="${s.max}" step="${s.step}">`);
      d.querySelector('#sensAll').oninput = e => setAllSens(+e.target.value);
    }
    if (g.mode === 'timed') {
      H.set.min = ov && ov.min != null ? ov.min : Math.floor(g.defDur / 60); H.set.sec = ov && ov.sec != null ? ov.sec : g.defDur % 60;
      const d = row(`<label>Everyone plays for (0:00 = no limit)</label><div class="time"><input type="number" id="s_min" min="0" max="99" value="${H.set.min}" inputmode="numeric"> <span class="muted">min</span> <input type="number" id="s_sec" min="0" max="59" value="${H.set.sec}" inputmode="numeric"> <span class="muted">sec</span></div>`);
      d.querySelector('#s_min').oninput = e => { H.set.min = +e.target.value || 0; }; d.querySelector('#s_sec').oninput = e => { H.set.sec = +e.target.value || 0; };
    }
    (g.settings || []).forEach(s => {
      const val = ov && ov[s.k] != null ? ov[s.k] : s.val;
      H.set[s.k] = val; let d;
      if (s.type === 'check') {
        d = row(`<label class="chk"><input type="checkbox" ${val ? 'checked' : ''}> ${s.label}</label>`);
        d.querySelector('input').onchange = e => { H.set[s.k] = e.target.checked; g.onSetting && g.onSetting(s.k); };
      } else if (s.type === 'range') {
        d = row(`<label>${s.label.replace('{v}', `<b class="v">${val}</b>`)}</label><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${val}">`);
        d.querySelector('input').oninput = e => { H.set[s.k] = +e.target.value; d.querySelector('.v').textContent = e.target.value; g.onSetting && g.onSetting(s.k); };
      } else {
        d = row(`<label>${s.label}</label><input type="number" min="${s.min}" max="${s.max}" value="${val}" inputmode="numeric">`);
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
  function openGame(id, ov) {
    if (H.game && H.game.destroy) H.game.destroy();
    const g = H.game = GAMES[id];
    H.st = 'idle'; H.el = 0; H.startAt = 0; H.endAt = Infinity; feed.length = 0; renderFeed();
    $('banner').classList.add('hidden'); $('play').classList.remove('intour'); $('tbar').classList.add('hidden');
    $('home').classList.add('hidden'); $('tour').classList.add('hidden'); $('play').classList.remove('hidden');
    $('crumb').textContent = `${g.emoji} ${g.title}`; $('homeLink').classList.remove('hidden');
    $('howto').textContent = g.how; $('clock').style.setProperty('--ga', g.accent); $('clock').dataset.free = g.mode === 'free' ? '1' : '';
    document.documentElement.style.setProperty('--ga', g.accent);
    buildSettings(ov); $('teams').innerHTML = '';
    H.teams.forEach(t => { g.reset(t); buildCard(t); });
    syncSensUi(); renderPhones();
    H.teams.forEach(t => { sendMode(t); applySens(t); });
  }
  function leaveGame() {                                    // close the current game's screen (nothing else shown yet)
    if (H.game && H.game.destroy) H.game.destroy();
    H.game = null; H.st = 'idle';
    $('play').classList.add('hidden'); $('play').classList.remove('intour'); $('tbar').classList.add('hidden');
    $('settingsCard').classList.add('hidden'); $('teams').innerHTML = ''; feed.length = 0; renderFeed();
    H.teams.forEach(t => { t.card = null; });
  }
  function goHome() {
    leaveGame();
    $('tour').classList.add('hidden'); $('home').classList.remove('hidden'); $('homeLink').classList.add('hidden');
    $('crumb').textContent = ''; document.documentElement.style.setProperty('--ga', '#ffb547');
    H.teams.forEach(sendMode);
  }

  /* ---- run state machine ---- */
  function startGame() {
    const g = H.game; if (!g || g.mode === 'free' || H.st === 'running' || H.st === 'armed' || !H.teams.length) return;
    H.teams.forEach(t => g.reset(t)); feed.length = 0; renderFeed();
    $('banner').classList.add('hidden'); H.teams.forEach(t => t.card.classList.remove('win'));
    H.dur = g.mode === 'timed' ? cfgDur() : g.mode === 'stopwatch' ? (H.set.limit || 0) * 1000 : 0;
    if (g.mode === 'rounds') { begin(performance.now()); g.onStart && g.onStart(); }
    else if (H.set.onFirst && g.armable) H.st = 'armed';
    else begin(performance.now());
    H.pushAll();
  }
  function begin(now) {
    const g = H.game; H.st = 'running'; H.startAt = now;
    H.endAt = (g.mode === 'timed' || g.mode === 'stopwatch') && H.dur > 0 ? now + H.dur : Infinity;
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
      if (t.online && t.conn === c) { ref.t = t; t.lastFrameAt = now; sendMode(t); applySens(t); return; }   // an app repeating its hello
      if (t.conn && t.conn !== c && t.conn.open) t.conn.close();
      t.conn = c; t.online = true; ref.t = t; t.lr = null; t.lw = null; t.lastFrameAt = now; t.hidden = false; t.kind = m.app ? 'app' : 'web';
      t.send = x => { if (c.open) c.send(x); };
      sendMode(t); applySens(t); renderPhones(); beep(660, 80);
      return;
    }
    const t = ref.t; if (!t) return;
    if (m.t === 'vis') { t.hidden = !m.v; if (m.v) t.lastFrameAt = now; return; }      // phone says its screen is going off / back on
    if (m.t === 'f') {
      t.f = m; t.lastFrameAt = now; t.hidden = m.v === 0;
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
    } else if (m.t === 'swing' && g) {
      g.onSwing && g.onSwing(t, m, now);
    }
  }

  /* ---- render loop ---- */
  // Draws one team's arena on any canvas (PC card or live-view window). The arena is laid out 150 px tall and scaled up.
  function drawOn(t, cv, cx, now, win) {
    const r = win.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * r)) { cv.width = Math.round(w * r); cv.height = Math.round(h * r); }
    const dt = Math.max(0, Math.min(.05, (now - t.lastDraw) / 1000)); t.lastDraw = Math.max(now, t.lastDraw);
    const LH = H.game.arenaH || 150, k = h / LH;                     // each game lays its arena out LH tall, scaled to fit
    cx.setTransform(r * k, 0, 0, r * k, 0, 0);
    H.game.draw(t, cx, w / k, LH, now, dt);
  }
  const drawTeam = (t, now) => drawOn(t, t.cv, t.cx, now, window);
  function paint() {
    requestAnimationFrame(paint);
    if (!H.game) return;
    const now = performance.now();
    H.teams.forEach(t => { if (t.card) drawTeam(t, now); });
  }
  // a phone whose screen turned off stops sending sensor data — spot it quickly and say so
  function checkSleep(now) {
    let changed = false;
    H.teams.forEach(t => {
      if (t.kind === 'app' && t.online && t.lastFrameAt && now - t.lastFrameAt > 15000) { t.online = false; t.send = null; changed = true; }   // an app has no connection-closed event
      const was = !!t.asleep;
      t.asleep = !!(t.online && (t.hidden || (t.lastFrameAt && now - t.lastFrameAt > 2500)));
      if (t.asleep === was) return;
      changed = true;
      if (t.asleep) { beep(200, 400, .2, 'square'); if (H.game) H.log(t, '😴 went to sleep — wake it up!'); }
      else if (t.online && H.game) H.log(t, '👋 is awake again');
    });
    if (changed) renderPhones();
  }
  const asleepWarn = () => { const s = H.teams.filter(t => t.asleep).map(t => t.name); return s.length ? `😴 ${s.join(' & ')} ${s.length === 1 ? 'is' : 'are'} asleep — wake ${s.length === 1 ? 'that phone' : 'those phones'} before the next game!` : ''; };
  function logic() {                                        // runs on a timer so a hidden tab keeps the clock honest
    const g = H.game, now = performance.now();
    checkSleep(now);
    if (!g) { tourTick(now); viewTick(now); return; }
    if (H.st === 'running' && now >= H.endAt) finish(true);
    g.tick && g.tick(now);
    const ck = g.clock ? g.clock(now) : null, el = H.elapsed(now);
    const d = (H.st === 'running' || H.st === 'finished') ? H.dur : cfgDur();
    if (ck) { $('timer').textContent = ck.big; $('timer').classList.add('small'); $('tsubline').textContent = ck.sub; $('clock').dataset.mood = ck.mood || ''; }
    else {
      $('timer').classList.remove('small'); $('clock').dataset.mood = '';
      $('timer').textContent = g.mode === 'timed' && d > 0 ? fmt(Math.max(0, d - el), false) : fmt(el, true);
      $('tsubline').textContent = g.mode === 'stopwatch' && H.dur > 0 ? 'Time limit ' + fmt(H.dur, true) : '';
    }
    $('pill').textContent = { idle: 'ready', armed: 'waiting for the first bounce', running: g.mode === 'timed' ? 'counting' : 'in progress', finished: 'finished' }[H.st];
    $('pill').className = H.st;
    const live = H.st === 'running' || H.st === 'armed';
    $('startBtn').textContent = live ? 'Stop' : 'Start'; $('startBtn').className = live ? 'stop' : '';
    $('startBtn').style.display = T.state !== 'off' && !live ? 'none' : '';             // tournaments start games automatically
    H.teams.forEach(t => {
      if (!t.card) return;
      t.card.querySelector('.tn').textContent = t.name; t.card.querySelector('.tn').style.color = t.color;
      const st = t.card.querySelector('.ts'); st.textContent = t.asleep ? '😴 asleep — wake the phone' : t.online ? '● online' : '○ offline'; st.className = 'ts' + (t.asleep ? ' zz' : t.online ? ' on' : '');
      t.card.classList.toggle('off', !t.online || t.asleep);
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
    tourTick(now);
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
      view.key = key; view.fin = false; view.ov = null; view.bs = '';
      v('vHome').classList.toggle('hidden', !!g); v('vGame').classList.toggle('hidden', !g); v('vResults').classList.add('hidden');
      v('vTeams').innerHTML = ''; v('vTeams').dataset.n = H.teams.length;
      H.teams.forEach(t => { t.vcard = null; });
      if (g) {
        v('vClock').classList.toggle('hidden', g.mode === 'free');
        d.documentElement.style.setProperty('--ga', g.accent); v('vTitle').textContent = `${g.emoji} ${g.title}`;
        H.teams.forEach(t => {
          const c = d.createElement('div'); c.className = 'vt'; c.style.setProperty('--tc', t.color);
          c.innerHTML = `<div class="vn"></div><canvas></canvas><div class="vs${g.small ? ' small' : ''}"></div><div class="vsub"></div>`;
          v('vTeams').appendChild(c); t.vcard = c; t.vcv = c.querySelector('canvas'); t.vcx = t.vcv.getContext('2d');
        });
      }
    }
    if (!view.painting) {                                   // paint on the view window's own frame clock
      view.painting = true; const w = view.w;
      const loop = () => { if (!view || view.w !== w || w.closed) return; w.requestAnimationFrame(loop); vPaint(performance.now()); };
      w.requestAnimationFrame(loop);
    }
    const ov = T.state === 'break' && T.screen === 'break' ? 'break' : T.state === 'final' && T.screen === 'final' ? 'final' : '';
    if (ov !== view.ov) {                                   // tournament break / final screens take over the live view
      view.ov = ov; view.bs = ''; v('vBreak').classList.toggle('hidden', ov !== 'break');
      if (ov === 'final') vFinal(d); else if (view.finShown) v('vResults').classList.add('hidden');
      view.finShown = ov === 'final';
    }
    if (ov === 'break') { const s = vBreakHtml(); if (s !== view.bs) { view.bs = s; v('vBreak').innerHTML = s; } }
    if (ov) return;
    if (!g) {
      v('vChips').innerHTML = H.teams.length ? H.teams.map(t => `<span class="chip" style="--tc:${t.color}">${esc(t.name)}${t.online ? '' : ' ○'}</span>`).join('') : '<span class="muted">Waiting for phones to join…</span>';
      return;
    }
    v('vTitle').textContent = (T.cur && (T.state === 'playing' || T.state === 'break') ? `🏆 ${T.next}/${T.seq.length} · ` : '') + `${g.emoji} ${g.title}`;
    v('vTimer').textContent = $('timer').textContent; v('vSub').textContent = $('tsubline').textContent;
    v('vClock').dataset.mood = $('clock').dataset.mood; v('vPill').textContent = $('pill').textContent; v('vPill').className = $('pill').className;
    H.teams.forEach(t => {
      if (!t.vcard) return;
      t.vcard.querySelector('.vn').textContent = t.name + (t.asleep ? ' 😴' : ''); t.vcard.querySelector('.vs').textContent = g.scoreText(t);
      t.vcard.querySelector('.vsub').textContent = g.sub ? g.sub(t) : '';
      t.vcard.classList.toggle('off', !t.online || t.asleep); t.vcard.classList.toggle('win', !!(t.card && t.card.classList.contains('win')));
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
  /* =====================================================================
     TOURNAMENT — a series of games with a break between each, points per game, and an overall champion
     ===================================================================== */
  const T = {
    state: 'off',      // off | setup | playing | break | final
    screen: '',        // what the PC is showing: setup | game | break | final
    cfg: null, seq: [], next: 0, cur: null, scores: {}, hist: [], lastPts: {}, lastBanner: '', finalText: '',
    breakSecs: 20, breakEnd: 0, holdUntil: 0, awarded: false, secShown: -1
  };
  const fmtPts = v => Number.isInteger(v) ? String(v) : v.toFixed(1);
  const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const playable = () => Object.keys(GAMES).filter(id => GAMES[id].mode !== 'free');

  function defaultCfg() {
    const order = playable(), games = {};
    order.forEach(id => {
      const g = GAMES[id], set = {}; (g.settings || []).forEach(s => { set[s.k] = s.val; });
      games[id] = { inc: true, plays: 1, min: g.mode === 'timed' ? Math.floor(g.defDur / 60) : 0, sec: g.mode === 'timed' ? g.defDur % 60 : 0, set };
    });
    return { order, games, breakSecs: 20 };
  }
  function loadCfg() {
    const d = defaultCfg();
    try {
      const s = JSON.parse(lsGet('mgTour'));
      if (s) {
        d.breakSecs = s.breakSecs || 20;
        if (Array.isArray(s.order)) { const o = s.order.filter(id => d.games[id]); Object.keys(d.games).forEach(id => { if (!o.includes(id)) o.push(id); }); d.order = o; }
        Object.keys(d.games).forEach(id => {
          if (!s.games || !s.games[id]) return;
          const defSet = d.games[id].set; Object.assign(d.games[id], s.games[id]); d.games[id].set = Object.assign({}, defSet, s.games[id].set || {});
        });
      }
    } catch (_) {}
    return d;
  }
  const saveCfg = () => lsSet('mgTour', JSON.stringify(T.cfg));
  const estSecs = (id, c) => {
    const g = GAMES[id], s = c.set;
    if (g.mode === 'timed') return (c.min * 60 + c.sec) || 60;
    if (id === 'freeze') return s.rounds * (5 + s.freezeSecs + 2.6);
    if (id === 'drop') return s.rounds * 18;
    if (id === 'waiter') return s.limit || 120;
    if (id === 'simon') return s.rounds * 22;
    if (id === 'pose') return s.rounds * 14;
    return 60;
  };

  function showTour() {
    $('home').classList.add('hidden'); $('play').classList.add('hidden'); $('tour').classList.remove('hidden');
    $('homeLink').classList.remove('hidden'); $('crumb').textContent = '🏆 Tournament';
    document.documentElement.style.setProperty('--ga', '#ffd166');
  }

  /* ---- setup screen ---- */
  function tourSetup() {
    T.state = 'setup'; T.screen = 'setup'; T.cfg = loadCfg(); showTour();
    $('tourBody').innerHTML = `<h2 class="th">🏆 Tournament setup</h2>
      <p class="muted">Choose the games, put them in order, then set how many rounds of each to play and how long each lasts. Every round is scored: 1st place earns the most points and last place the fewest. The highest total at the end is the champion.</p>
      <div id="trows"></div>
      <div class="tbreak"><label>⏳ Break between games <input type="number" id="tBreak" min="5" max="300" value="${T.cfg.breakSecs}"> seconds</label>
        <span class="muted">Each break introduces the next game with a countdown. You can change the break during the tournament too.</span></div>
      <div id="tEst" class="muted"></div>
      <div class="tbtns"><button id="tGo">▶ Start tournament</button><button id="tBack" class="alt">Cancel</button></div><div id="tWarn" class="err"></div>`;
    drawRows();
  }
  function drawRows() {
    const cfg = T.cfg;
    $('trows').innerHTML = cfg.order.map((id, i) => {
      const g = GAMES[id], c = cfg.games[id]; let opts = '';
      if (g.mode === 'timed') opts += `<label>Time <input type="number" data-f="min" min="0" max="99" value="${c.min}"> m <input type="number" data-f="sec" min="0" max="59" value="${c.sec}"> s</label>`;
      (g.settings || []).forEach(s => {
        const v = c.set[s.k];
        if (s.type === 'check') opts += `<label class="chk"><input type="checkbox" data-k="${s.k}" ${v ? 'checked' : ''}> ${s.label}</label>`;
        else if (s.type === 'range') opts += `<label>${s.label.replace('{v}', `<b>${v}</b>`)}<input type="range" data-k="${s.k}" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}"></label>`;
        else opts += `<label>${s.label} <input type="number" data-k="${s.k}" min="${s.min}" max="${s.max}" value="${v}"></label>`;
      });
      return `<div class="trow ${c.inc ? '' : 'off'}" data-id="${id}" style="--ga:${g.accent}">
        <label class="tinc"><input type="checkbox" class="inc" ${c.inc ? 'checked' : ''}><span class="temoji">${g.emoji}</span><b>${g.title}</b></label>
        <label class="tplays">Rounds <input type="number" data-f="plays" min="1" max="9" value="${c.plays}"></label>
        <div class="topts">${opts}</div>
        <span class="tord"><button class="alt up" ${i === 0 ? 'disabled' : ''}>↑</button><button class="alt dn" ${i === cfg.order.length - 1 ? 'disabled' : ''}>↓</button></span></div>`;
    }).join('');
    updateEst();
  }
  function updateEst() {
    const cfg = T.cfg; let plays = 0, secs = 0, games = 0;
    cfg.order.forEach(id => { const c = cfg.games[id]; if (!c.inc) return; games++; plays += c.plays; secs += c.plays * estSecs(id, c); });
    secs += plays * cfg.breakSecs;
    if ($('tEst')) $('tEst').textContent = plays ? `${games} game${games === 1 ? '' : 's'} · ${plays} round${plays === 1 ? '' : 's'} in total · about ${Math.round(secs / 60)} minutes including breaks.` : 'Tick at least one game.';
  }

  function tourBind() {                                    // one set of listeners for every tournament screen
    const body = $('tourBody');
    body.addEventListener('input', e => {
      const el = e.target;
      if (el.id === 'tBreak') { T.cfg.breakSecs = clamp(+el.value || 20, 5, 300); saveCfg(); updateEst(); return; }
      if (el.id === 'tbLen') { T.breakSecs = clamp(+el.value || 20, 5, 300); if (T.cfg) { T.cfg.breakSecs = T.breakSecs; saveCfg(); } return; }
      const row = el.closest('.trow'); if (!row || T.state !== 'setup') return;
      const id = row.dataset.id, c = T.cfg.games[id], g = GAMES[id];
      if (el.classList.contains('inc')) { c.inc = el.checked; row.classList.toggle('off', !c.inc); }
      else if (el.dataset.f) { const lim = { plays: [1, 9], min: [0, 99], sec: [0, 59] }[el.dataset.f]; c[el.dataset.f] = clamp(Math.round(+el.value || lim[0]), lim[0], lim[1]); }
      else if (el.dataset.k) {
        const s = g.settings.find(x => x.k === el.dataset.k);
        c.set[s.k] = s.type === 'check' ? el.checked : clamp(+el.value || s.min, s.min, s.max);
        if (s.type === 'range') el.parentNode.querySelector('b').textContent = el.value;
      }
      saveCfg(); updateEst();
    });
    body.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const now = performance.now();
      if (b.classList.contains('up') || b.classList.contains('dn')) {
        const id = b.closest('.trow').dataset.id, o = T.cfg.order, i = o.indexOf(id), j = b.classList.contains('up') ? i - 1 : i + 1;
        [o[i], o[j]] = [o[j], o[i]]; saveCfg(); drawRows();
      }
      else if (b.id === 'tBack') { T.state = 'off'; goHome(); }
      else if (b.id === 'tGo') tourStart();
      else if (b.id === 'tbM') T.breakEnd = Math.max(now + 1000, T.breakEnd - 10000);
      else if (b.id === 'tbP') T.breakEnd += 10000;
      else if (b.id === 'tbSkip') T.breakEnd = now;
      else if (b.id === 'tbEnd') { if (confirm('End the tournament now?')) { endTour(); goHome(); } }
      else if (b.id === 'tfNew') tourSetup();
      else if (b.id === 'tfHome') { endTour(); goHome(); }
    });
  }

  /* ---- running it ---- */
  function tourStart() {
    const cfg = T.cfg, seq = [];
    cfg.order.forEach(id => { const c = cfg.games[id]; if (c.inc) for (let p = 1; p <= c.plays; p++) seq.push({ id, play: p, plays: c.plays }); });
    if (!seq.length) { $('tWarn').textContent = 'Tick at least one game.'; return; }
    if (!H.teams.length) { $('tWarn').textContent = 'Connect at least one phone first — scan the QR code on the right.'; return; }
    T.seq = seq; T.next = 0; T.cur = null; T.scores = {}; T.hist = []; T.lastPts = {}; T.lastBanner = ''; T.finalText = '';
    T.breakSecs = cfg.breakSecs; ensureAudio(); enterBreak(performance.now(), 0);
  }
  function enterBreak(now, hold) {                         // hold = seconds to keep showing the last game's results first
    T.state = 'break'; T.breakEnd = now + T.breakSecs * 1000; T.holdUntil = now + hold * 1000; T.secShown = -1;
    if (hold > 0) T.screen = 'game'; else showBreakScreen();
  }
  function standings() {
    const rows = H.teams.map(t => ({ t, total: T.scores[t.id] || 0, last: T.lastPts[t.id] || 0 })).sort((a, b) => b.total - a.total);
    rows.forEach(r => { r.place = rows.findIndex(x => x.total === r.total) + 1; });
    return rows;
  }
  function boardHtml(final) {
    const medals = ['🥇', '🥈', '🥉'], rows = standings();
    const head = final ? `<tr><th></th><th>Team</th>${T.hist.map(h => `<th title="${esc(h.title)}">${h.emoji}</th>`).join('')}<th>Total</th></tr>` : '';
    const body = rows.map(r => `<tr style="--tc:${r.t.color}"><td>${r.place <= 3 && (final || T.hist.length) ? medals[r.place - 1] : r.place + '.'}</td><td class="tn2">${esc(r.t.name)}</td>${final ? T.hist.map(h => `<td>${fmtPts(h.pts[r.t.id] || 0)}</td>`).join('') : ''}<td class="tot">${fmtPts(r.total)}${!final && T.hist.length ? `<small> +${fmtPts(r.last)}</small>` : ''}</td></tr>`).join('');
    return `<table class="board">${head}${body}</table>`;
  }
  function award() {                                       // points for this round: 1st = number of teams … last = 1; ties share
    const g = H.game, key = t => g.rankKey ? g.rankKey(t) : g.score(t), dir = g.better === 'low' ? 1 : -1, n = H.teams.length;
    const sorted = H.teams.filter(t => !g.played || g.played(t)).sort((a, b) => dir * (key(a) - key(b))), pts = {};
    for (let i = 0; i < sorted.length;) {
      let j = i; while (j + 1 < sorted.length && key(sorted[j + 1]) === key(sorted[i])) j++;
      let sum = 0; for (let p = i; p <= j; p++) sum += n - p;
      for (let p = i; p <= j; p++) pts[sorted[p].id] = sum / (j - i + 1);
      i = j + 1;
    }
    H.teams.forEach(t => { T.scores[t.id] = (T.scores[t.id] || 0) + (pts[t.id] || 0); });
    T.hist.push({ emoji: g.emoji, title: g.title, pts }); T.lastPts = pts; T.lastBanner = $('banner').textContent; T.awarded = true;
  }

  function showBreakScreen() {
    leaveGame(); showTour(); T.screen = 'break';
    const p = T.seq[T.next], g = GAMES[p.id];
    document.documentElement.style.setProperty('--ga', g.accent);
    $('tourBody').innerHTML = `
      <div class="tbn">🏆 Game ${T.next + 1} of ${T.seq.length}${p.plays > 1 ? ` · round ${p.play} of ${p.plays}` : ''}</div>
      <div class="tbnext" style="--ga:${g.accent}"><span class="gemoji">${g.emoji}</span><div><b>Up next: ${esc(g.title)}</b><div>${esc(g.blurb)}</div><div class="muted">${esc(g.how)}</div></div></div>
      <div class="tbclock"><span class="cap">Starts in</span><div id="tbSecs">0</div></div>
      <div class="tbctl"><button id="tbM" class="alt">−10 s</button><button id="tbP" class="alt">+10 s</button><button id="tbSkip">Start now ▶</button>
        <label>Break length <input type="number" id="tbLen" min="5" max="300" value="${T.breakSecs}"> s</label><button id="tbEnd" class="alt">End tournament</button></div>
      <div id="tbWarn" class="err" style="text-align:center;font-weight:700"></div>
      ${T.lastBanner ? `<div class="tblast">Last game: <b>${esc(T.lastBanner)}</b></div>` : ''}
      <h3 class="th">Standings</h3><div id="tbBoard">${boardHtml(false)}</div>`;
    H.teams.forEach(t => { t.send && t.send({ t: 'mode', id: 'break', emoji: '⏳', title: `Next: ${g.emoji} ${g.title}`, accent: g.accent }); t.lastPh = ''; });
  }
  function showFinalScreen() {
    leaveGame(); showTour(); T.screen = 'final';
    const rows = standings(), champs = rows.filter(r => r.place === 1);
    T.finalText = H.teams.length === 1 ? `🏁 Tournament complete — ${fmtPts(rows[0].total)} points`
      : champs.length === 1 ? `🏆 ${champs[0].t.name} is the champion!` : `🤝 Joint champions: ${champs.map(r => r.t.name).join(' & ')}`;
    $('tourBody').innerHTML = `<div class="tfwin">${esc(T.finalText)}</div><h3 class="th">Final standings</h3>${boardHtml(true)}
      <div class="tbtns"><button id="tfNew">New tournament</button><button id="tfHome" class="alt">Back to games</button></div>`;
    H.teams.forEach(t => { t.send && t.send({ t: 'mode', id: 'final', emoji: '🏆', title: 'Tournament over', accent: '#ffd166' }); t.lastPh = ''; });
    beep(523, 200, .2); setTimeout(() => beep(659, 200, .2), 220); setTimeout(() => beep(784, 400, .2), 440);
  }
  function startPlay() {
    const p = T.seq[T.next++], c = T.cfg.games[p.id];
    T.cur = p; T.state = 'playing'; T.screen = 'game'; T.awarded = false;
    openGame(p.id, Object.assign({ min: c.min, sec: c.sec }, c.set));
    $('play').classList.add('intour'); $('tbar').classList.remove('hidden');
    $('tbText').textContent = `🏆 Tournament · game ${T.next} of ${T.seq.length}${p.plays > 1 ? ` · round ${p.play} of ${p.plays}` : ''}`;
    beep(880, 300, .2);
    setTimeout(() => { if (T.state === 'playing' && H.game && H.game.id === p.id && H.st === 'idle') startGame(); }, 800);
  }
  function endTour() {
    T.state = 'off'; T.screen = ''; T.cur = null;
    $('play').classList.remove('intour'); $('tbar').classList.add('hidden');
  }
  function phoneTour(kind, secs) {
    const rows = standings();
    H.teams.forEach(t => {
      if (!t.send || !t.online) return;
      const r = rows.find(x => x.t === t); let msg;
      if (kind === 'break') {
        const g = GAMES[T.seq[T.next].id];
        msg = { t: 'ph', name: t.name, color: t.color, big: secs, sub: `Next: ${g.emoji} ${g.title}${T.hist.length ? ` · you're ${ordinal(r.place)} (${fmtPts(r.total)} pts)` : ''}`, meter: null, bg: '#14301f' };
      } else msg = { t: 'ph', name: t.name, color: t.color, big: r.place === 1 ? '🏆' : ordinal(r.place), sub: `${fmtPts(r.total)} points`, meter: null, bg: r.place === 1 ? '#3b3216' : null };
      const key = JSON.stringify(msg); if (key !== t.lastPh) { t.lastPh = key; t.send(msg); }
    });
  }
  function tourTick(now) {
    if (T.state === 'off' || T.state === 'setup') return;
    if (T.state === 'playing') {
      if (H.game && H.st === 'finished' && !T.awarded) {
        award();
        if (T.next >= T.seq.length) { T.state = 'final'; T.screen = 'game'; T.holdUntil = now + 8000; }
        else enterBreak(now, Math.min(8, T.breakSecs * .4));
      }
      return;
    }
    if (T.state === 'break') {
      if (T.screen === 'game' && now >= T.holdUntil) showBreakScreen();
      const left = T.breakEnd - now, secs = Math.max(0, Math.ceil(left / 1000));
      if (secs !== T.secShown) { T.secShown = secs; if (secs > 0 && secs <= 5) beep(620, 90); }
      if (T.screen === 'break') { const el = $('tbSecs'); if (el) el.textContent = secs; if ($('tbWarn')) $('tbWarn').textContent = asleepWarn(); phoneTour('break', secs); }
      if (left <= 0) startPlay();
      return;
    }
    if (T.state === 'final') {
      if (T.screen === 'game' && now >= T.holdUntil) showFinalScreen();
      if (T.screen === 'final') phoneTour('final');
    }
  }
  // the same screens on the live-view window
  function vBreakHtml() {
    const p = T.seq[T.next]; if (!p) return '';
    const g = GAMES[p.id], secs = Math.max(0, Math.ceil((T.breakEnd - performance.now()) / 1000));
    return `<div class="bk-top">🏆 Game ${T.next + 1} of ${T.seq.length}${p.plays > 1 ? ` · round ${p.play} of ${p.plays}` : ''}</div>
      <div class="bk-next" style="--ga:${g.accent}"><span class="bk-e">${g.emoji}</span><div><div class="bk-t">Up next: ${esc(g.title)}</div><div class="bk-b">${esc(g.blurb)}</div></div></div>
      <div class="bk-count"><small>starts in</small>${secs}</div>
      ${asleepWarn() ? `<div class="bk-warn">${esc(asleepWarn())}</div>` : ''}
      <div class="bk-board">${T.lastBanner ? `<div class="bk-last">${esc(T.lastBanner)}</div>` : ''}${boardHtml(false)}</div>`;
  }
  function vFinal(d) {
    const medals = ['🥇', '🥈', '🥉'], rows = standings();
    d.getElementById('vResTitle').textContent = '🏆 Tournament Results'; d.getElementById('vBanner').textContent = T.finalText;
    d.getElementById('vList').innerHTML = rows.map(r => `<li style="--tc:${r.t.color}"><span class="rk">${r.place <= 3 ? medals[r.place - 1] : r.place + '.'}</span><span class="rn">${esc(r.t.name)}</span><span class="rsc">${fmtPts(r.total)}</span><span class="rsub">${T.hist.map(h => `${h.emoji} ${fmtPts(h.pts[r.t.id] || 0)}`).join('  ·  ')}</span></li>`).join('');
    d.getElementById('vResults').classList.remove('hidden');
  }

  // home screen: tell phones their name while no game is open
  setInterval(() => {
    if (H.game || T.state !== 'off') return;
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
    $('homeLink').onclick = e => {
      e.preventDefault();
      if (T.state === 'break' || T.state === 'playing') { if (!confirm('End the tournament and go back to the games list?')) return; }
      else if (H.st === 'running') { if (!confirm('A game is running. Go back to the games list?')) return; }
      endTour(); goHome();
    };
    $('viewBtn').onclick = openView;
    $('startBtn').onclick = () => {
      if (H.st === 'running' || H.st === 'armed') stopGame();
      else if (T.state === 'off') startGame();               // a tournament starts its games by itself
    };
    $('resetBtn').onclick = resetGame;
    $('tbEndBtn').onclick = () => { if (confirm('End the tournament now?')) { endTour(); goHome(); } };
    tourBind();
    document.addEventListener('keydown', e => {
      if ($('play').classList.contains('hidden') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); $('startBtn').click(); }
      if ((e.key === 'r' || e.key === 'R') && T.state === 'off') $('resetBtn').click();
    });
    paint(); setInterval(logic, 50);

    const newId = () => 'mg-' + newCode();
    $('newGameBtn').onclick = () => {
      if (confirm('Start a brand-new game with a new code? Phones already connected will have to join the new code.')) { lsSet('mgHost', ''); location.reload(); }
    };
    function open(id) {
      lsSet('mgHost', id);                                  // the same browser keeps its code if the page is reloaded
      const peer = new Peer(id), code = id.slice(3);
      peer.on('open', () => {
        const url = `${baseUrl}?join=${code}`, qr = qrcode(0, 'M'); qr.addData(url); qr.make();
        $('qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
        $('link').textContent = baseUrl.replace(/index\.html$/, '').replace(/^https?:\/\//, ''); $('qrBox').classList.remove('hidden'); $('codeBig').textContent = code; openMqtt(id);
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
    const stored = lsGet('mgHost');
    open(/^mg-[A-HJ-NP-Z2-9]{6}$/.test(stored || '') ? stored : newId());

    /* Android-app phones talk through a public MQTT broker (a browser can't accept their connections directly).
       Same JSON messages as the web phones; one shared "up" topic in, one "dn" topic per phone out. */
    let mq = null;
    function openMqtt(id) {
      if (typeof mqtt === 'undefined' || (mq && mq.id === id)) return;
      if (mq) { mq.cl.end(true); clearInterval(mq.timer); }
      const base = `motiongames/v1/${id}`, refs = {};
      const cl = mqtt.connect('wss://broker.hivemq.com:8884/mqtt', { clientId: 'mgh-' + Math.random().toString(16).slice(2, 10), reconnectPeriod: 3000, keepalive: 30 });
      const who = () => { if (cl.connected) cl.publish(`${base}/all`, JSON.stringify({ t: 'who' })); };   // "any app phones out there? say hello"
      cl.on('connect', () => { cl.subscribe(`${base}/up`); who(); });
      mq = { id, cl, timer: setInterval(who, 10000) };
      cl.on('message', (_topic, buf) => {
        let m; try { m = JSON.parse(buf.toString()); } catch (_) { return; }
        if (!m || !m.d) return;
        const ref = refs[m.d] || (refs[m.d] = { t: null, c: { open: true, close() {}, send: x => { if (cl.connected) cl.publish(`${base}/dn/${m.d}`, JSON.stringify(x)); } } });
        if (m.t === 'bye') { if (ref.t) { ref.t.online = false; ref.t.send = null; renderPhones(); } return; }
        if (m.t === 'hello') m.id = m.d;
        onPhoneData(ref.c, ref, m);
      });
      cl.on('error', () => {});
    }
  }

  if (asPhone) runPhone(joinPrefill); else runHost();
})();
