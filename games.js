/* Game definitions for Motion Games.
   Each game plugs into the host in app.js (global H). Per-team game state lives in t.s.
   Hooks: reset(t) onBegin() onFrame(t,f,d,dt,now) onHit(t,g,counted,now) onAir(t,ms,now) tick(now)
          score(t) scoreText(t) sub(t) phone(t,now) draw(t,ctx,w,h,now,dt) extra(t) bind(t,el) clock(now) */
(() => {
  const G = 9.81, TAU = Math.PI * 2;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const rnd = Math.random;

  /* ---------- drawing helpers ---------- */
  function bg(c, w, h, top, bottom) {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, top); g.addColorStop(1, bottom);
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }
  function rr(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function txt(c, s, x, y, size, color, align = 'center', weight = 700) {
    c.font = `${weight} ${size}px system-ui, sans-serif`; c.fillStyle = color; c.textAlign = align; c.fillText(s, x, y);
  }
  function drawBall(c, x, y, r, col, ang = 0, sx = 1, sy = 1) {
    c.save(); c.translate(x, y); c.scale(sx, sy); c.rotate(ang);
    c.fillStyle = col; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.38)'; c.lineWidth = Math.max(1.5, r * 0.09);
    for (let i = 0; i < 3; i++) { c.beginPath(); c.ellipse(0, 0, r * 0.42, r, i * Math.PI / 3, 0, TAU); c.stroke(); }
    c.rotate(-ang);
    const g = c.createRadialGradient(-r * .35, -r * .4, r * .05, 0, 0, r);
    g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(.35, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.45)');
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
    c.restore();
  }
  // angle in degrees away from the level captured at the start of the run
  const tiltOf = (t, f) => {
    const b = (f.b - (t.s.b0 || 0)) * Math.PI / 180, c = (f.c - (t.s.c0 || 0)) * Math.PI / 180;
    return Math.acos(clamp(Math.cos(b) * Math.cos(c), -1, 1)) * 180 / Math.PI;
  };
  const allDone = (fn) => H.teams.length > 0 && H.teams.every(fn);

  // what "sensitivity" means for the games that detect weightlessness (thrown / dropped)
  const AIR_SENS = {
    label: 'Counts as airborne below', unit: ' g', min: .2, max: .9, step: .05, def: .5, scale: 2, flip: true, dp: 2,
    hint: 'Higher = more sensitive. The phone counts as "in the air" when the force on it falls below this.',
    signal: t => t.f ? t.f.gn : 1, apply: t => { t.air = H.sv(t); }
  };

  const GAMES = {};

  /* ======================================================================
     1. BOUNCE COUNTER
     ====================================================================== */
  GAMES.bounce = {
    id: 'bounce', emoji: '🏀', title: 'Bounce Counter', accent: '#ff9f43', mode: 'timed', defDur: 60, better: 'high', armable: true,
    blurb: 'Count every bounce before the clock runs out.',
    how: 'Put the phone in a ball. Bounces only count while the clock is running. Grey flashes are hits that did not count.',
    settings: [
      { k: 'onFirst', type: 'check', label: 'Start the clock on the first bounce (any team)', val: false },
      { k: 'gap', type: 'range', min: 80, max: 1000, step: 20, val: 200, label: 'Ignore repeat hits within {v} ms' }
    ],
    reset(t) { t.s = { count: 0, maxG: 0, last: null, y: 0, vy: 0, sq: 0, rings: [] }; },
    sens: {
      label: 'Hit trigger', unit: ' g', min: 1.3, max: 8, step: .1, def: 2.5, scale: 8,
      hint: 'Lower = more sensitive. A hit has to reach this force to count.',
      signal: t => t.f ? t.f.gx : 1, apply: t => { t.thr = H.sv(t); }
    },
    onSetting(k) { if (k === 'gap') H.teams.forEach(H.pushCfg); },
    onHit(t, g, counted) {
      const s = t.s; s.last = { g, c: counted };
      if (counted) { s.count++; s.maxG = Math.max(s.maxG, g); H.log(t, `#${s.count} · ${g.toFixed(1)} g`); H.beep(500 + t.i * 110, 90); }
      s.vy = clamp(300 + g * 40, 300, 560); s.sq = 1; s.rings.push({ a: 0, c: counted });
    },
    score: t => t.s.count, scoreText: t => String(t.s.count),
    sub: t => t.s.last ? `Max ${t.s.maxG.toFixed(1)} g · last ${t.s.last.g.toFixed(1)} g${t.s.last.c ? '' : ' (not counted)'}` : 'Waiting for a bounce…',
    phone: t => ({ big: t.s.count, sub: t.s.last ? `Last hit ${t.s.last.g.toFixed(1)} g` : 'Bounce it!' }),
    draw(t, c, w, h, now, dt) {
      const s = t.s, gy = h - 24, r = Math.min(24, h * .17), x = w / 2;
      bg(c, w, h, '#1c2230', '#12161d');
      c.fillStyle = '#243044'; c.fillRect(0, gy + r * .9, w, h);
      s.vy -= 2200 * dt; s.y += s.vy * dt; if (s.y < 0) { s.y = 0; s.vy = 0; }
      s.sq = Math.max(0, s.sq - dt * 5);
      c.fillStyle = `rgba(0,0,0,${.35 * (1 - Math.min(1, s.y / 120))})`;
      c.beginPath(); c.ellipse(x, gy + r * .95, r * (1 - s.y / 260), r * .22, 0, 0, TAU); c.fill();
      s.rings = s.rings.filter(q => (q.a += dt) < .5);
      s.rings.forEach(q => {
        c.strokeStyle = q.c ? `rgba(255,200,100,${1 - q.a * 2})` : `rgba(150,160,175,${1 - q.a * 2})`; c.lineWidth = 2;
        c.beginPath(); c.ellipse(x, gy + r * .95, r + q.a * 120, (r + q.a * 120) * .22, 0, 0, TAU); c.stroke();
      });
      const sy = 1 - .3 * s.sq, sx = 1 + .3 * s.sq;
      drawBall(c, x, gy - s.y - r * sy, r, t.color, s.y * .04, sx, sy);
      // live force bar with the trigger line
      const bx = w - 14, bh = h - 24, lvl = clamp((t.f ? t.f.gx : 1) / (t.thr * 1.6), 0, 1);
      c.fillStyle = '#262b36'; c.fillRect(bx, 12, 6, bh);
      c.fillStyle = lvl > .625 ? '#ff9f43' : '#5aa8ff'; c.fillRect(bx, 12 + bh * (1 - lvl), 6, bh * lvl);
      c.fillStyle = '#ff6b6b'; c.fillRect(bx - 3, 12 + bh * (1 - .625), 12, 2);
    }
  };

  /* ======================================================================
     2. WAITER SERVICE
     ====================================================================== */
  GAMES.waiter = {
    id: 'waiter', emoji: '🍽️', title: 'Waiter Service', accent: '#4cc9f0', mode: 'stopwatch', better: 'high',
    blurb: 'Carry the tray round the course without spilling a drop.',
    settings: [{ k: 'limit', type: 'number', min: 0, max: 900, val: 180, label: 'Time limit in seconds (0 = no limit)' }],
    how: 'Lay the phone flat on a tray. Start at 1000 points: wobbles and tilting drain them, and tipping past the spill angle (adjust it with the sensitivity sliders) is a spill (−50). Press Finished when a team completes the course. Highest score wins, fastest time breaks ties.',
    sens: {
      label: 'Spill angle', unit: '°', min: 4, max: 40, step: 1, def: 12, scale: 40, dp: 0,
      hint: 'Lower = more sensitive. Tipping the tray past this angle spills a drink.',
      signal: t => t.s.tilt
    },
    reset(t) { t.s = { wobPen: 0, tiltPen: 0, spills: 0, lastSpill: -1e9, rate: 0, tilt: 0, finished: false, finT: 0, level: 1, sl: 0, vsl: 0, parts: [], spawn: 0, b0: 0, c0: 0 }; },
    onBegin() { H.teams.forEach(t => { if (t.f) { t.s.b0 = t.f.b; t.s.c0 = t.f.c; } }); },
    onFrame(t, f, d, dt, now) {
      const s = t.s; s.tilt = tiltOf(t, f);
      s.rate += ((dt > 0 ? d.wob / (dt / 1000) : 0) - s.rate) * .2;
      s.vsl += (rnd() - .5) * d.wob * 500;
      if (H.st !== 'running' || s.finished) return;
      s.wobPen += d.wob * 120;
      if (s.tilt > 5) s.tiltPen += (s.tilt - 5) * dt / 1000 * .5;
      if (s.tilt > H.sv(t) && now - s.lastSpill > 1500) {
        s.spills++; s.lastSpill = now; s.level = Math.max(.15, s.level - .12); s.spawn = (f.c - s.c0) >= 0 ? 1 : -1;
        H.beep(170, 220, .2, 'sawtooth'); H.log(t, '💦 spilled!');
      }
    },
    score: t => Math.max(0, Math.round(1000 - t.s.wobPen - t.s.tiltPen - t.s.spills * 50)),
    rankKey: t => GAMES.waiter.score(t) * 1e6 - t.s.finT,
    scoreText: t => GAMES.waiter.score(t) + ' pts',
    sub: t => `Tilt ${t.s.tilt.toFixed(0)}° · Spills ${t.s.spills}${t.s.finished ? ' · 🏁 ' + H.fmt(t.s.finT, true) : ''}`,
    phone: (t, now) => ({ big: GAMES.waiter.score(t), sub: `Tilt ${t.s.tilt.toFixed(0)}° · Spills: ${t.s.spills}${t.s.finished ? ' · finished!' : ''}`, meter: clamp(1 - t.s.rate * 6, 0, 1), bg: now - t.s.lastSpill < 700 ? '#4a1620' : null }),
    onFinish() { H.teams.forEach(t => { if (!t.s.finished) { t.s.finished = true; t.s.finT = H.el; } }); },
    extra: () => '<button class="fin">🏁 Finished!</button>',
    bind(t, el) {
      el.querySelector('.fin').onclick = () => {
        if (H.st !== 'running' || t.s.finished) return;
        t.s.finished = true; t.s.finT = H.elapsed(performance.now()); H.log(t, `🏁 finished in ${H.fmt(t.s.finT, true)}`);
        H.beep(660, 150); if (allDone(x => x.s.finished)) H.finish(false);
      };
    },
    cardUpdate(t, el) { el.querySelector('.fin').disabled = H.st !== 'running' || t.s.finished; },
    draw(t, c, w, h, now, dt) {
      const s = t.s, cx = w / 2, by = h - 32;
      bg(c, w, h, '#1d2a3a', '#131a24');
      c.fillStyle = '#10161f'; c.fillRect(0, by + 22, w, h);
      const rel = t.f ? t.f.c - s.c0 : 0, th = clamp(rel * Math.PI / 180, -.9, .9);
      s.vsl += (-60 * s.sl - 4 * s.vsl) * dt; s.sl = clamp(s.sl + s.vsl * dt, -.6, .6);
      const gh = Math.min(h * .5, 64), gb = 20, gt = 27;
      if (s.spawn) {                                        // splash from the rim
        const d = s.spawn, x0 = d * gt, y0 = -gh;
        const px = cx + x0 * Math.cos(th) - y0 * Math.sin(th), py = by + x0 * Math.sin(th) + y0 * Math.cos(th);
        for (let i = 0; i < 16; i++) s.parts.push({ x: px, y: py, vx: d * (60 + rnd() * 110), vy: -(70 + rnd() * 120), a: 0 });
        s.spawn = 0;
      }
      c.save(); c.translate(cx, by); c.rotate(th);
      const tw = Math.min(w * .7, 230);
      c.fillStyle = '#b98a5e'; rr(c, -tw / 2, 0, tw, 9, 4); c.fill();
      c.fillStyle = '#d9ab7d'; rr(c, -tw / 2, 0, tw, 3, 2); c.fill();
      c.beginPath(); c.moveTo(-gt, -gh); c.lineTo(-gb, 0); c.lineTo(gb, 0); c.lineTo(gt, -gh); c.closePath();
      c.fillStyle = 'rgba(255,255,255,.07)'; c.fill();
      c.save(); c.clip();
      c.translate(0, -s.level * gh * .9); c.rotate(-th + s.sl);
      c.globalAlpha = .85; c.fillStyle = t.color; c.fillRect(-90, 0, 180, 120); c.globalAlpha = 1;
      c.fillStyle = 'rgba(255,255,255,.5)'; c.fillRect(-90, -1, 180, 2);
      c.restore();
      c.strokeStyle = 'rgba(220,240,255,.75)'; c.lineWidth = 2; c.stroke();
      c.restore();
      s.parts = s.parts.filter(p => (p.a += dt) < 1.1);
      s.parts.forEach(p => { p.vy += 600 * dt; p.x += p.vx * dt; p.y += p.vy * dt; c.globalAlpha = 1 - p.a / 1.1; c.fillStyle = t.color; c.beginPath(); c.arc(p.x, p.y, 3, 0, TAU); c.fill(); });
      c.globalAlpha = 1;
      txt(c, `${s.tilt.toFixed(0)}°`, 8, 18, 13, s.tilt > H.sv(t) ? '#ff6b6b' : s.tilt > 5 ? '#ffb547' : '#8a92a3', 'left');
      // (spill threshold is a setting; recolour when past it)
      if (now - s.lastSpill < 900) txt(c, 'SPILL!', w - 10, 20, 15, '#ff6b6b', 'right', 800);
    }
  };

  /* ======================================================================
     3. HANG TIME
     ====================================================================== */
  GAMES.hang = {
    id: 'hang', emoji: '🚀', title: 'Hang Time', accent: '#a78bfa', mode: 'timed', defDur: 60, better: 'high',
    blurb: 'Throw it high and keep it in the air the longest.',
    how: 'Throw the ball (and phone) up and catch it. The phone knows when it is weightless. Your best throw counts; height is worked out from the time in the air.',
    settings: [], sens: AIR_SENS,
    reset(t) { t.s = { best: 0, throws: [], air: false, t0: 0, by: 0, fall: 0, pops: [], spark: [], ang: 0 }; },
    onFrame(t, f, d, dt, now) { const s = t.s; if (f.air && !s.air) { s.air = true; s.t0 = now; } else if (!f.air && s.air) s.air = false; },
    onAir(t, ms) {
      const s = t.s; if (H.st !== 'running' || ms < 250 || ms > 9000) return;
      s.throws.push(ms); s.pops.push({ txt: (ms / 1000).toFixed(2) + ' s', a: 0 });
      const best = ms > s.best; if (best) s.best = ms;
      H.log(t, `🚀 ${(ms / 1000).toFixed(2)} s${best ? ' — new best!' : ''}`); H.beep(best ? 880 : 600, 160);
    },
    score: t => t.s.best, played: t => t.s.best > 0,
    scoreText: t => t.s.best ? (t.s.best / 1000).toFixed(2) + ' s' : '–',
    sub: t => t.s.best ? `≈ ${(G * (t.s.best / 1000) ** 2 / 8).toFixed(1)} m high · ${t.s.throws.length} throw${t.s.throws.length === 1 ? '' : 's'}` : 'Throw it up!',
    phone: t => ({ big: GAMES.hang.scoreText(t), sub: t.s.air ? 'IN THE AIR! 🚀' : `Throws: ${t.s.throws.length}`, bg: t.s.air ? '#10294d' : null }),
    draw(t, c, w, h, now, dt) {
      const s = t.s, gy = h - 16, r = 14, x = w * .5;
      const bestM = s.best ? G * (s.best / 1000) ** 2 / 8 : 0, maxM = Math.max(3, bestM * 1.25), ppm = (gy - 24) / maxM;
      bg(c, w, h, '#0a0e2a', '#1d2f66');
      for (let i = 0; i < 18; i++) { c.fillStyle = `rgba(255,255,255,${.25 + (i % 4) * .15})`; c.fillRect((i * 83) % w, (i * 47) % (h - 30), 1.5, 1.5); }
      c.fillStyle = '#1d3d2c'; c.fillRect(0, gy, w, h - gy);
      if (bestM) {
        const y = gy - bestM * ppm - r;
        c.setLineDash([6, 5]); c.strokeStyle = '#ffd166'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); c.setLineDash([]);
        txt(c, `best ${bestM.toFixed(1)} m`, w - 8, y - 5, 12, '#ffd166', 'right');
      }
      if (s.air) {
        const tau = (now - s.t0) / 1000, target = (1 - Math.exp(-1.6 * tau)) * Math.max(bestM, 2.2) * .92 * ppm;
        s.by += (target - s.by) * Math.min(1, dt * 8); s.fall = 0; s.ang += dt * 7;
        s.spark.push({ x: x + (rnd() - .5) * 8, y: gy - s.by - r + 8, a: 0 });
      } else {
        s.fall += 1600 * dt; s.by = Math.max(0, s.by - s.fall * dt); if (!s.by) s.fall = 0;
      }
      s.spark = s.spark.filter(p => (p.a += dt) < .5);
      s.spark.forEach(p => { c.fillStyle = `rgba(255,${140 + p.a * 200 | 0},60,${1 - p.a * 2})`; c.beginPath(); c.arc(p.x, p.y + p.a * 40, 3 * (1 - p.a), 0, TAU); c.fill(); });
      c.fillStyle = `rgba(0,0,0,${.3 * (1 - Math.min(1, s.by / 150))})`; c.beginPath(); c.ellipse(x, gy + 3, r * (1 - s.by / 400), 3, 0, 0, TAU); c.fill();
      drawBall(c, x, gy - s.by - r, r, t.color, s.ang);
      s.pops = s.pops.filter(p => (p.a += dt) < 1.5);
      s.pops.forEach(p => { c.globalAlpha = 1 - p.a / 1.5; txt(c, p.txt, x + 34, gy - s.by - 24 - p.a * 30, 18, '#fff'); c.globalAlpha = 1; });
      if (s.air) txt(c, 'IN THE AIR!', 8, 18, 13, '#7dd3fc', 'left', 800);
    }
  };

  /* ======================================================================
     4. SPIN CYCLE
     ====================================================================== */
  GAMES.spin = {
    id: 'spin', emoji: '🌀', title: 'Spin Cycle', accent: '#f472b6', mode: 'timed', defDur: 30, better: 'high',
    blurb: 'Spin or roll the ball for the most full turns.',
    how: 'The phone adds up every degree it rotates while the clock runs. Spin it, roll it, whirl it — most full turns wins.',
    settings: [],
    sens: {
      label: 'Ignore turning slower than', unit: ' °/s', min: 0, max: 200, step: 5, def: 15, scale: 600, dp: 0,
      hint: 'Higher = less sensitive. Slow drifting and jitter below this speed is not counted.',
      signal: t => t.s.rate
    },
    reset(t) { t.s = { rot: 0, rate: 0, ang: 0, lastRev: 0, pulses: [], peak: 0 }; },
    onFrame(t, f, d, dt) {
      const s = t.s, r = dt > 0 ? d.rot / (dt / 1000) : 0; s.rate += (r - s.rate) * .3;
      if (H.st === 'running') { if (r > H.sv(t)) s.rot += d.rot; s.peak = Math.max(s.peak, s.rate); }
    },
    score: t => t.s.rot / 360, played: t => t.s.rot > 0,
    scoreText: t => (t.s.rot / 360).toFixed(1),
    sub: t => `Now ${Math.round(t.s.rate / 6)} rpm · top ${Math.round(t.s.peak / 6)} rpm`,
    phone: t => ({ big: GAMES.spin.scoreText(t), sub: `${Math.round(t.s.rate / 6)} rpm`, meter: clamp(t.s.rate / 1200, 0, 1), bg: t.s.rate > 400 ? '#3b1a30' : null }),
    draw(t, c, w, h, now, dt) {
      const s = t.s, cx = w / 2, cy = h / 2, r = Math.min(h * .26, 34), vis = Math.min(s.rate, 900);
      const g = c.createRadialGradient(cx, cy, 5, cx, cy, w * .6); g.addColorStop(0, '#2a1233'); g.addColorStop(1, '#0f0a18');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      s.ang += vis * dt * Math.PI / 180;
      const n = Math.min(5, Math.floor(vis / 180));
      for (let i = n; i >= 1; i--) { c.globalAlpha = .13; drawBall(c, cx, cy, r, t.color, s.ang - i * .28); }
      c.globalAlpha = 1; drawBall(c, cx, cy, r, t.color, s.ang);
      const frac = clamp(s.rate / 1200, 0, 1);
      c.lineWidth = 6; c.lineCap = 'round'; c.strokeStyle = '#2a2236'; c.beginPath(); c.arc(cx, cy, r + 14, 0, TAU); c.stroke();
      if (frac > .01) { c.strokeStyle = `hsl(${300 - frac * 280},90%,60%)`; c.beginPath(); c.arc(cx, cy, r + 14, -Math.PI / 2, -Math.PI / 2 + TAU * frac); c.stroke(); }
      const rev = Math.floor(s.rot / 360); if (rev > s.lastRev) { s.lastRev = rev; s.pulses.push({ a: 0 }); H.beep(700 + (rev % 8) * 60, 60, .08); }
      s.pulses = s.pulses.filter(p => (p.a += dt) < .6);
      s.pulses.forEach(p => { c.strokeStyle = `rgba(255,255,255,${.6 - p.a})`; c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, r + 16 + p.a * 70, 0, TAU); c.stroke(); });
      if (s.rate > 700) for (let i = 0; i < 3; i++) { const a = now / 180 + i * TAU / 3; txt(c, '★', cx + Math.cos(a) * (r + 26), cy - r - 12 + Math.sin(a) * 6, 14, '#ffd166'); }
      txt(c, `${Math.round(s.rate / 6)} rpm`, 8, 18, 13, '#c9a7d6', 'left');
    }
  };

  /* ======================================================================
     5. FREEZE!
     ====================================================================== */
  const F = { phase: 'idle', round: 0, at: 0, len: 0 };
  GAMES.freeze = {
    id: 'freeze', emoji: '❄️', title: 'Freeze!', accent: '#38bdf8', mode: 'rounds', better: 'low',
    blurb: 'Keep moving… then freeze solid when the PC shouts.',
    how: 'Move the ball about until FREEZE! appears, then go completely still. Any movement during the freeze earns penalty points. Fewest penalty points after all rounds wins.',
    settings: [
      { k: 'rounds', type: 'number', min: 1, max: 12, val: 5, label: 'Freezes per game' },
      { k: 'freezeSecs', type: 'number', min: 2, max: 10, val: 4, label: 'Freeze lasts (seconds)' }
    ],
    sens: {
      label: 'Movement allowed', unit: ' pts', min: 0, max: 40, step: 1, def: 6, scale: 40, dp: 0,
      hint: 'Lower = stricter. Movement above this during a freeze earns penalty points.',
      signal: t => t.s.M
    },
    reset(t) { t.s = { M: 0, rp: null, total: 0, rate: 0, hist: [] }; F.phase = 'idle'; F.round = 0; },
    onStart() { F.round = 0; this.nextRound(performance.now()); },
    nextRound(now) {
      F.round++; F.phase = 'move'; F.at = now; F.len = (3 + rnd() * 4) * 1000;
      H.teams.forEach(t => { t.s.M = 0; t.s.rp = null; }); H.beep(760, 160); H.pushAll();
    },
    tick(now) {
      if (H.st !== 'running') return;
      const e = now - F.at;
      if (F.phase === 'move' && e >= F.len) {
        F.phase = 'freeze'; F.at = now; F.len = H.set.freezeSecs * 1000; H.teams.forEach(t => { t.s.M = 0; }); H.beep(300, 700, .25); H.pushAll();
      } else if (F.phase === 'freeze' && e >= F.len) {
        F.phase = 'result'; F.at = now; F.len = 2600;
        H.teams.forEach(t => { t.s.rp = Math.round(Math.max(0, t.s.M - H.sv(t))); t.s.total += t.s.rp; t.s.hist.push(t.s.rp); H.log(t, `R${F.round}: ${t.s.rp ? '+' + t.s.rp + ' pts' : 'frozen solid ✨'}`); });
        H.beep(520, 200); H.pushAll();
      } else if (F.phase === 'result' && e >= F.len) {
        if (F.round >= H.set.rounds) { F.phase = 'done'; H.finish(false); } else this.nextRound(now);
      }
    },
    onFrame(t, f, d, dt, now) {
      const s = t.s; s.rate += ((dt > 0 ? d.rot / (dt / 1000) : 0) - s.rate) * .3;
      if (H.st === 'running' && F.phase === 'freeze' && now - F.at > 500) s.M += d.wob * 100 + d.rot * .1;
    },
    score: t => t.s.total, scoreText: t => t.s.total + ' pts',
    sub: t => t.s.hist.length ? 'Rounds: ' + t.s.hist.map(x => x || '✓').join(' · ') : 'Fewest penalty points wins',
    clock(now) {
      const left = Math.max(0, (F.len - (now - F.at)) / 1000), R = `Round ${F.round}/${H.set.rounds}`;
      if (H.st === 'finished') return { big: 'GAME OVER', sub: '', mood: 'ice' };
      if (H.st !== 'running') return null;
      if (F.phase === 'move') return { big: 'MOVE!', sub: R, mood: 'go' };
      if (F.phase === 'freeze') return { big: 'FREEZE!', sub: `${R} · ${left.toFixed(1)} s`, mood: 'ice' };
      return { big: 'Results', sub: R, mood: '' };
    },
    phone(t) {
      const m = F.phase === 'move' ? { big: 'MOVE!', bg: '#14351f' } : F.phase === 'freeze' ? { big: 'FREEZE!', bg: '#12324f' } : { big: F.phase === 'result' ? (t.s.rp ? '+' + t.s.rp : '✨') : '❄️', bg: null };
      return { big: m.big, sub: `Penalty: ${t.s.total} pts`, meter: F.phase === 'freeze' ? clamp(t.s.M / 40, 0, 1) : null, bg: m.bg };
    },
    draw(t, c, w, h, now, dt) {
      const s = t.s, cx = w / 2, cy = h * .48, r = Math.min(h * .2, 26), ph = F.phase;
      if (ph === 'freeze') bg(c, w, h, '#0c2a45', '#0a4a73'); else if (ph === 'move') bg(c, w, h, '#3a2210', '#1a1008'); else bg(c, w, h, '#18202c', '#10151c');
      let ox = 0, oy = 0;
      if (ph === 'move') { const a = clamp(s.rate / 160, .5, 6); ox = (rnd() - .5) * a; oy = (rnd() - .5) * a; c.fillStyle = 'rgba(255,150,60,.15)'; c.beginPath(); c.arc(cx, cy, r + 14 + Math.sin(now / 120) * 4, 0, TAU); c.fill(); }
      drawBall(c, cx + ox, cy + oy, r, t.color, now / 400);
      if (ph === 'freeze' || (ph === 'result' && s.rp !== null)) {
        c.fillStyle = 'rgba(180,230,255,.28)'; rr(c, cx - r - 12, cy - r - 12, (r + 12) * 2, (r + 12) * 2, 10); c.fill();
        c.strokeStyle = 'rgba(230,248,255,.8)'; c.lineWidth = 2; c.stroke();
        c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 1.3;
        const n = Math.min(14, Math.floor(s.M / 3));
        for (let i = 0; i < n; i++) {
          const a = i * 2.4, l = 14 + (i * 37) % 26, x1 = cx + Math.cos(a) * 4, y1 = cy + Math.sin(a) * 4;
          c.beginPath(); c.moveTo(x1, y1); c.lineTo(x1 + Math.cos(a + .3) * l * .5, y1 + Math.sin(a + .3) * l * .5); c.lineTo(x1 + Math.cos(a) * l, y1 + Math.sin(a) * l); c.stroke();
        }
        const fr = clamp(s.M / 40, 0, 1), bw = w - 30;
        c.fillStyle = 'rgba(0,0,0,.35)'; rr(c, 15, h - 18, bw, 8, 4); c.fill();
        c.fillStyle = `hsl(${200 - fr * 200},85%,55%)`; rr(c, 15, h - 18, Math.max(8, bw * fr), 8, 4); c.fill();
        c.fillStyle = '#fff'; c.fillRect(15 + bw * (H.sv(t) / 40), h - 21, 2, 14);
      }
      if (ph === 'result' && s.rp !== null) txt(c, s.rp ? `+${s.rp}` : 'PERFECT!', cx, 24, 20, s.rp ? '#ff8a8a' : '#7be0a0', 'center', 800);
    }
  };

  /* ======================================================================
     6. DROP ZONE
     ====================================================================== */
  const D = { phase: 'idle', round: 0, target: 0, at: 0, len: 0 };
  GAMES.drop = {
    id: 'drop', emoji: '🎯', title: 'Drop Zone', accent: '#fbbf24', mode: 'rounds', better: 'low',
    blurb: 'Drop the ball from exactly the height the PC calls out.',
    how: 'Each round the PC shows a target height. Release the ball from where you think that is. The phone times the fall and works out the real height — closest to the target wins. Fewest total centimetres off wins.',
    settings: [{ k: 'rounds', type: 'number', min: 1, max: 10, val: 3, label: 'Drops per game' }], sens: AIR_SENS,
    reset(t) { t.s = { cur: null, total: 0, hist: [], t0: 0 }; D.phase = 'idle'; D.round = 0; D.target = 0; },
    onStart() { D.round = 0; this.nextRound(performance.now()); },
    nextRound(now) {
      D.round++; D.phase = 'open'; D.at = now; D.len = 30000; D.target = Math.round((.8 + rnd() * 1.7) * 20) / 20;
      H.teams.forEach(t => { t.s.cur = null; }); H.beep(780, 200); H.pushAll();
    },
    onAir(t, ms, now) {
      const s = t.s; if (H.st !== 'running' || D.phase !== 'open' || s.cur || ms < 150 || ms > 2000) return;
      const hgt = G * (ms / 1000) ** 2 / 2, err = Math.abs(hgt - D.target) * 100;
      s.cur = { h: hgt, err }; s.t0 = now; s.total += err; s.hist.push(Math.round(err));
      H.log(t, `🎯 ${hgt.toFixed(2)} m (off by ${Math.round(err)} cm)`); H.beep(err < 10 ? 990 : 520, 200); H.pushAll();
    },
    tick(now) {
      if (H.st !== 'running') return;
      const e = now - D.at;
      if (D.phase === 'open' && (e >= D.len || allDone(t => t.s.cur))) {
        H.teams.forEach(t => { if (!t.s.cur) { t.s.cur = { h: 0, err: 100, miss: true }; t.s.total += 100; t.s.hist.push(100); } });
        D.phase = 'result'; D.at = now; D.len = 4200; H.pushAll();
      } else if (D.phase === 'result' && e >= D.len) {
        if (D.round >= H.set.rounds) { D.phase = 'done'; H.finish(false); } else this.nextRound(now);
      }
    },
    score: t => t.s.total, scoreText: t => Math.round(t.s.total) + ' cm',
    sub: t => t.s.hist.length ? 'Off by: ' + t.s.hist.map(x => x + ' cm').join(' · ') : 'Total centimetres off — lowest wins',
    clock(now) {
      if (H.st === 'finished') return { big: 'GAME OVER', sub: '', mood: '' };
      if (H.st !== 'running') return null;
      const R = `Round ${D.round}/${H.set.rounds}`;
      if (D.phase === 'open') return { big: `DROP FROM ${D.target.toFixed(2)} m`, sub: `${R} · waiting for ${H.teams.filter(t => !t.s.cur).length} team(s)`, mood: 'go' };
      return { big: `Target was ${D.target.toFixed(2)} m`, sub: R, mood: '' };
    },
    phone(t) {
      const s = t.s;
      if (D.phase === 'open' && !s.cur) return { big: 'DROP IT!', sub: `Target ${D.target.toFixed(2)} m`, bg: '#3a2f10' };
      if (s.cur && !s.cur.miss) return { big: s.cur.h.toFixed(2) + ' m', sub: `Off by ${Math.round(s.cur.err)} cm · total ${Math.round(s.total)}`, bg: null };
      return { big: Math.round(s.total) + ' cm', sub: 'Total off so far', bg: null };
    },
    draw(t, c, w, h, now, dt) {
      const s = t.s, gy = h - 14, ppm = (gy - 16) / 3.2, r = 11, x = w * .6;
      bg(c, w, h, '#2a6fb3', '#9fd3f5');
      c.fillStyle = '#4b7b3a'; c.fillRect(0, gy, w, h - gy);
      c.fillStyle = 'rgba(255,255,255,.7)';
      [[.2, .25, 22], [.75, .15, 17], [.45, .4, 14]].forEach(([a, b, k]) => { c.beginPath(); c.ellipse(w * a, h * b, k * 1.6, k * .6, 0, 0, TAU); c.fill(); });
      c.fillStyle = 'rgba(10,30,60,.55)'; c.fillRect(0, 0, 40, gy);
      for (let m = 0; m <= 3; m += .5) {
        const y = gy - m * ppm; c.fillStyle = '#fff'; c.fillRect(30, y, 10, 1); if (m % 1 === 0) txt(c, m + 'm', 26, y + 4, 10, '#fff', 'right');
      }
      if (D.target > 0 && D.phase !== 'idle') {
        const y = gy - D.target * ppm;
        c.setLineDash([7, 5]); c.strokeStyle = '#ffd166'; c.lineWidth = 2; c.beginPath(); c.moveTo(40, y); c.lineTo(w, y); c.stroke(); c.setLineDash([]);
        c.fillStyle = '#ffd166'; c.beginPath(); c.moveTo(44, y); c.lineTo(44, y - 16); c.lineTo(62, y - 11); c.lineTo(44, y - 6); c.fill();
        txt(c, D.target.toFixed(2) + ' m', w - 6, y - 5, 12, '#7a5200', 'right', 800);
      }
      if (s.cur && !s.cur.miss) {
        const tau = (now - s.t0) / 1000, fall = Math.sqrt(2 * s.cur.h / G), hn = tau < fall ? s.cur.h - .5 * G * tau * tau : 0;
        c.globalAlpha = .35; drawBall(c, x, gy - s.cur.h * ppm - r, r, t.color); c.globalAlpha = 1;
        drawBall(c, x, gy - hn * ppm - r, r, t.color, tau * 6);
        if (tau >= fall) { const col = s.cur.err < 10 ? '#0b6b2c' : s.cur.err < 30 ? '#8a5a00' : '#a31b1b'; txt(c, `${s.cur.h.toFixed(2)} m · off ${Math.round(s.cur.err)} cm`, x, gy - 30, 13, col, 'center', 800); }
      } else {
        drawBall(c, x, gy - r, r, t.color);
        if (D.phase === 'open') { c.strokeStyle = `rgba(255,255,255,${.4 + .4 * Math.sin(now / 200)})`; c.lineWidth = 2; c.beginPath(); c.arc(x, gy - r, r + 6 + 3 * Math.sin(now / 200), 0, TAU); c.stroke(); txt(c, 'waiting to drop…', x, gy - 40, 12, '#103a63'); }
        else if (s.cur && s.cur.miss) txt(c, 'no drop (+100 cm)', x, gy - 40, 12, '#a31b1b');
      }
    }
  };

  /* ======================================================================
     7. SENSOR LAB  (no scoring — a live view of every phone's sensors)
     ====================================================================== */
  const posture = g => {
    const ax = Math.abs(g.x), ay = Math.abs(g.y), az = Math.abs(g.z);
    if (az >= ax && az >= ay) return g.z > 0 ? 'Face up' : 'Face down';
    if (ay >= ax) return g.y > 0 ? 'Upright' : 'Upside down';
    return g.x > 0 ? 'Top to left' : 'Top to right';
  };
  const cell = (k, l) => `<div class="c"><span>${l}</span><b data-k="${k}">–</b></div>`;
  GAMES.sensors = {
    id: 'sensors', emoji: '📱', title: 'Sensor Lab', accent: '#34d399', mode: 'free', small: true,
    blurb: 'See what every phone feels: which way up, tilt, shake and spin — live.',
    how: 'No scoring here — just watch each phone. Tilt it, shake it, spin it. Every phone that scans the QR code appears as its own live card.',
    settings: [],
    reset(t) { t.s = { g: { x: 0, y: 0, z: 9.81 }, l: { x: 0, y: 0, z: 0 }, lm: 0, peak: 0, b: 0, c: 0, al: 0, rr: { x: 0, y: 0, z: 0 }, f: 1, init: false }; },
    onFrame(t, f) {
      const s = t.s; if (f.ax == null) return;
      const k = s.init ? .35 : 1; s.init = true;
      s.g.x += (f.ax - s.g.x) * k; s.g.y += (f.ay - s.g.y) * k; s.g.z += (f.az - s.g.z) * k;
      s.l.x += (f.lx - s.l.x) * .5; s.l.y += (f.ly - s.l.y) * .5; s.l.z += (f.lz - s.l.z) * .5;
      s.lm = Math.hypot(s.l.x, s.l.y, s.l.z); if (s.lm > s.peak) s.peak = s.lm;
      s.b = f.b; s.c = f.c; s.al = f.al; s.rr = { x: f.rb, y: f.rg, z: f.ra }; s.f = f.gx;
    },
    score: () => 0, scoreText: t => posture(t.s.g),
    sub: t => `β ${t.s.b.toFixed(0)}° · γ ${t.s.c.toFixed(0)}° · α ${t.s.al.toFixed(0)}°`,
    phone: t => ({ big: posture(t.s.g), sub: `Force ${t.s.f.toFixed(1)} g · accel ${t.s.lm.toFixed(1)} m/s²` }),
    extra: () => `<div class="sdata"><div class="sh">Acceleration, gravity removed (m/s²)</div>${cell('lx', 'X')}${cell('ly', 'Y')}${cell('lz', 'Z')}
      <div class="sh">Rotation (°/s)</div>${cell('rx', 'X')}${cell('ry', 'Y')}${cell('rz', 'Z')}
      <div class="sh">Totals</div>${cell('lm', 'Accel')}${cell('pk', 'Peak')}${cell('fg', 'Force g')}</div>
      <button class="alt rp" style="margin-top:8px;padding:6px">Reset peak</button>`,
    bind(t, el) { el.querySelector('.rp').onclick = () => { t.s.peak = 0; }; },
    cardUpdate(t, el) {
      const s = t.s, v = { lx: s.l.x.toFixed(2), ly: s.l.y.toFixed(2), lz: s.l.z.toFixed(2), rx: s.rr.x, ry: s.rr.y, rz: s.rr.z, lm: s.lm.toFixed(2), pk: s.peak.toFixed(2), fg: s.f.toFixed(2) };
      el.querySelectorAll('[data-k]').forEach(e => { e.textContent = v[e.dataset.k]; });
    },
    draw(t, c, w, h, now, dt) {
      const s = t.s, mid = h / 2;
      bg(c, w, h, '#10231f', '#0a1411');
      // --- spirit level (left): the bubble drifts toward the high side
      const lx = w * .2, R = Math.min(48, w * .16), gx = clamp(s.g.x / G, -1, 1), gy = clamp(s.g.y / G, -1, 1), flat = Math.hypot(gx, gy) < .06 && s.g.z > 0;
      c.strokeStyle = '#2f4a42'; c.lineWidth = 2; c.beginPath(); c.arc(lx, mid, R, 0, TAU); c.stroke();
      c.beginPath(); c.arc(lx, mid, R * .28, 0, TAU); c.stroke();
      c.beginPath(); c.moveTo(lx - R, mid); c.lineTo(lx + R, mid); c.moveTo(lx, mid - R); c.lineTo(lx, mid + R); c.stroke();
      c.fillStyle = flat ? '#4cd37b' : '#ffb547'; c.shadowColor = c.fillStyle; c.shadowBlur = 10;
      c.beginPath(); c.arc(lx + gx * R * .78, mid - gy * R * .78, R * .16, 0, TAU); c.fill(); c.shadowBlur = 0;
      txt(c, flat ? 'LEVEL' : 'level', lx, mid + R + 16, 11, flat ? '#4cd37b' : '#6d8a80');
      // --- 3D phone (centre): real orientation, drawn by projecting its four corners
      const D = Math.PI / 180, cb = Math.cos(s.b * D), sb = Math.sin(s.b * D), cg = Math.cos(s.c * D), sg = Math.sin(s.c * D), el = 25 * D, S = Math.min(64, h * .42);
      const P = (x, y) => {                                 // device (x right, y top) → screen
        const E = x * cg, N = y * cb + x * sg * sb, U = y * sb - x * sg * cb;
        return [w * .5 + E * S, mid - (U * Math.cos(el) + N * Math.sin(el)) * S];
      };
      const nN = -cg * sb, nU = cg * cb, front = nN * -Math.cos(el) + nU * Math.sin(el) > 0;
      const corners = [[-.25, .5], [.25, .5], [.25, -.5], [-.25, -.5]].map(p => P(p[0], p[1]));
      c.beginPath(); corners.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath();
      c.fillStyle = front ? '#1f6feb' : '#5a6270'; c.fill(); c.lineWidth = 3; c.strokeStyle = '#dbe4f0'; c.lineJoin = 'round'; c.stroke();
      const a = P(-.08, .43), b2 = P(.08, .43);              // speaker slot marks the top edge
      c.strokeStyle = '#fff'; c.lineWidth = 3; c.lineCap = 'round'; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b2[0], b2[1]); c.stroke();
      if (!front) { const q = P(-.14, .36); c.fillStyle = '#222'; c.beginPath(); c.arc(q[0], q[1], 4, 0, TAU); c.fill(); }
      txt(c, front ? 'screen side' : 'back side', w * .5, h - 6, 10, '#6d8a80');
      // --- compass (right): alpha is the heading relative to where the phone started
      const cx2 = w * .8, r2 = Math.min(30, w * .1), ang = -s.al * D;
      c.strokeStyle = '#2f4a42'; c.lineWidth = 2; c.beginPath(); c.arc(cx2, mid, r2, 0, TAU); c.stroke();
      c.save(); c.translate(cx2, mid); c.rotate(ang);
      c.fillStyle = '#ff6b6b'; c.beginPath(); c.moveTo(0, -r2 + 3); c.lineTo(6, 0); c.lineTo(-6, 0); c.fill();
      c.fillStyle = '#8a92a3'; c.beginPath(); c.moveTo(0, r2 - 3); c.lineTo(6, 0); c.lineTo(-6, 0); c.fill(); c.restore();
      txt(c, `${s.al.toFixed(0)}°`, cx2, mid + r2 + 16, 11, '#6d8a80');
      // --- live force bar (far right)
      const lvl = clamp((s.f - .5) / 3, 0, 1);
      c.fillStyle = '#1b2a26'; c.fillRect(w - 12, 10, 6, h - 20); c.fillStyle = lvl > .5 ? '#ffb547' : '#34d399'; c.fillRect(w - 12, 10 + (h - 20) * (1 - lvl), 6, (h - 20) * lvl);
    }
  };

  /* ======================================================================
     TILT CONTROLS — shared by Tilt Racer, Marble Maze and Catch the Stars.
     The phone is a controller: "zero" remembers how it is being held, then tilting away from that steers.
     Works for a phone held like a steering wheel (upright) or lying flat in the hands like a tray.
     ====================================================================== */
  const wrapA = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const rng = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  function tiltFrame(t, f) {                                        // keep a lightly smoothed gravity vector
    const s = t.s; if (f.ax == null) return;
    const k = s.gs ? .4 : 1; s.gs = s.gs || { x: 0, y: 0, z: 9.81 };
    s.gs.x += (f.ax - s.gs.x) * k; s.gs.y += (f.ay - s.gs.y) * k; s.gs.z += (f.az - s.gs.z) * k;
    if (!s.g0) s.g0 = { ...s.gs };
    s.sdeg = ctl(s, 30).deg;
  }
  const zeroTilt = t => { if (t.s.gs) t.s.g0 = { ...t.s.gs }; };
  function ctl(s, full) {                                           // → steer −1..1 (right +), throttle −1..1 (lean forward +), steer angle in degrees
    const g = s.gs, g0 = s.g0; if (!g || !g0) return { st: 0, th: 0, deg: 0 };
    const flat = Math.abs(g0.z) >= Math.abs(g0.x) && Math.abs(g0.z) >= Math.abs(g0.y);
    let sd, pd;
    if (flat) {                                                      // lying flat: roll steers, nose-down = forward
      sd = -(Math.atan2(g.x, g.z) - Math.atan2(g0.x, g0.z));
      pd = -(Math.atan2(g.y, g.z) - Math.atan2(g0.y, g0.z));
    } else {                                                         // upright wheel: turning the wheel steers, pushing the top away = forward
      sd = -wrapA(Math.atan2(g.x, g.y) - Math.atan2(g0.x, g0.y));
      pd = Math.atan2(g.z, Math.hypot(g.x, g.y)) - Math.atan2(g0.z, Math.hypot(g0.x, g0.y));
    }
    const lim = (x, fullDeg) => { const a = Math.abs(x) * 180 / Math.PI, m = Math.max(0, (a - 3) / Math.max(1, fullDeg - 3)); return Math.sign(x) * Math.min(1, m); };
    return { st: lim(sd, full), th: lim(pd, 25), deg: sd * 180 / Math.PI };
  }
  const tiltSens = def => ({
    label: 'Tilt for full steering', unit: '°', min: 10, max: 60, step: 1, def, scale: 60, dp: 0,
    hint: 'Lower = more sensitive: a smaller tilt steers all the way. The bar shows how far the phone is tilted.',
    signal: t => Math.abs(t.s.sdeg || 0)
  });
  const zeroBtn = { extra: () => '<button class="alt rz" style="padding:6px">↺ Re-zero (hold the phone comfortably, then press)</button>', bind(t, el) { el.querySelector('.rz').onclick = () => zeroTilt(t); } };
  function starPath(c, x, y, r) { c.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r * .45 : r; c.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); } c.closePath(); }
  const countdown = (c, w, h, now, goAt) => {                       // 3 · 2 · 1 · GO! overlay
    if (now < goAt) { const n = Math.ceil((goAt - now) / 1000); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(0, 0, w, h); txt(c, String(n), w / 2, h / 2 + 22, 70, '#fff', 'center', 800); txt(c, 'hold your phone comfortably', w / 2, h / 2 + 46, 12, '#cfd6e6'); return true; }
    if (now < goAt + 800) { txt(c, 'GO!', w / 2, h / 2 + 22, 70, '#4cd37b', 'center', 800); }
    return false;
  };

  /* ======================================================================
     8. TILT RACER — steer a car (or a spaceship) down a course; lean forward to go faster
     ====================================================================== */
  let RC = null;                                                    // the course, shared so every racer faces the same one
  function makeCourse() {
    const r = rng((Math.random() * 1e9) | 0), obs = [], slots = [-.8, -.4, 0, .4, .8], L = 900;
    for (let z = 70; z < L - 50; z += 22 + r() * 14) {
      const free = slots.slice(), n = r() < .35 ? 2 : 1;
      for (let i = 0; i < n; i++) obs.push({ z, x: free.splice((r() * free.length) | 0, 1)[0] + (r() - .5) * .12, k: 'o' });
      if (r() < .3) obs.push({ z: z + 9, x: free[(r() * free.length) | 0], k: 'b' });   // boost pad
    }
    return { L, obs, goAt: 0 };
  }
  function stepRacer(t, now) {
    const s = t.s; if (!RC || H.st !== 'running') return;
    if (s.last == null) s.last = now;
    let dt = (now - s.last) / 1000; if (dt <= 0) return; dt = Math.min(dt, .1); s.last = now;
    if (!s.zeroed && now >= RC.goAt) { zeroTilt(t); s.zeroed = true; }
    if (s.finished) { s.v = Math.max(0, s.v - 15 * dt); s.z += s.v * dt * .2; return; }
    if (now < RC.goAt) return;
    const VMAX = 40, c = ctl(s, H.sv(t));
    const target = VMAX * clamp(.55 + c.th * .45, 0, 1);              // cruise by default; lean forward = faster, back = brake
    s.v += (target - s.v) * Math.min(1, dt * (target > s.v ? 1.6 : 3));
    if (now - s.boostT < 1200) s.v = Math.min(VMAX * 1.15, s.v + 25 * dt);
    s.x = clamp(s.x + c.st * (.35 + 1.3 * s.v / VMAX) * dt, -1, 1);
    s.steer = c.st;
    if (Math.abs(s.x) > .92) s.v *= (1 - 1.2 * dt);                   // the verge slows you down
    s.z += s.v * dt;
    for (const o of RC.obs) {
      if (o.z < s.z - 3 || o.z > s.z + 3 || s.hitSet.has(o) || Math.abs(o.x - s.x) > .24) continue;
      s.hitSet.add(o);
      if (o.k === 'b') { s.boostT = now; H.beep(900, 120, .1); }
      else { s.v = Math.min(s.v, VMAX * .2); s.hitT = now; s.hits++; H.beep(160, 160, .15, 'square'); }
    }
    if (s.z >= RC.L) { s.finished = true; s.finT = now - RC.goAt; H.beep(660, 150); H.log(t, `🏁 finished in ${(s.finT / 1000).toFixed(1)} s`); }
  }
  GAMES.racer = {
    id: 'racer', emoji: '🏎️', title: 'Tilt Racer', accent: '#f43f5e', mode: 'timed', defDur: 90, better: 'high', arenaH: 260,
    blurb: 'Steer a car or spaceship down the course by tilting your phone.',
    how: 'Hold the phone like a steering wheel (or flat in your hands). It zeroes after the 3-2-1, so hold it comfortably: turn it to steer, lean the top forward to go faster, back to slow down. Dodge the cones, hit the blue boost pads. First to the finish wins; otherwise furthest wins.',
    settings: [{ k: 'space', type: 'check', label: 'Space theme (spaceship through an asteroid field)', val: false }],
    sens: tiltSens(30),
    reset(t) { t.s = { x: 0, v: 0, z: 0, steer: 0, hits: 0, hitT: -1e9, boostT: -1e9, hitSet: new Set(), finished: false, finT: 0, zeroed: false, last: null, gs: null, g0: null, sdeg: 0 }; },
    onBegin(now) { RC = makeCourse(); RC.goAt = now + 3000; H.teams.forEach(t => { t.s.last = now; t.s.zeroed = false; }); },
    onFrame(t, f) { tiltFrame(t, f); },
    tick(now) {
      if (H.st !== 'running') return;
      H.teams.forEach(t => stepRacer(t, now));
      if (H.teams.length && H.teams.every(t => t.s.finished)) H.finish(false);
    },
    rankKey: t => t.s.finished ? 1e9 - t.s.finT : t.s.z,
    score: t => t.s.finished ? 1e9 - t.s.finT : t.s.z,
    scoreText: t => t.s.finished ? `🏁 ${(t.s.finT / 1000).toFixed(1)} s` : `${Math.round(t.s.z)} m`,
    sub: t => `${Math.round(t.s.v * 3.6)} km/h · ${t.s.hits} crash${t.s.hits === 1 ? '' : 'es'}${RC ? ` · ${Math.min(100, Math.round(t.s.z / RC.L * 100))}%` : ''}`,
    phone: (t, now) => {
      const s = t.s, go = RC && now >= RC.goAt;
      return { big: s.finished ? '🏁' : (RC && H.st === 'running' && !go) ? Math.ceil((RC.goAt - now) / 1000) : go ? Math.min(100, Math.round(s.z / RC.L * 100)) + '%' : 'Ready',
               sub: s.finished ? `Finished in ${(s.finT / 1000).toFixed(1)} s` : 'Turn to steer · lean forward = faster', meter: clamp(s.v / 46, 0, 1),
               bg: now - s.hitT < 400 ? '#4a1620' : now - s.boostT < 800 ? '#10294d' : null };
    },
    ...zeroBtn,
    draw(t, c, w, h, now, dt) {
      const s = t.s; stepRacer(t, now);
      const space = !!H.set.space, cx = w / 2, half = Math.min(w * .36, 105), sc = 3.6, carY = h * .78, z = s.z;
      if (space) { bg(c, w, h, '#04060f', '#0a1028'); for (let i = 0; i < 46; i++) { c.fillStyle = `rgba(255,255,255,${.3 + (i % 3) * .25})`; c.fillRect((i * 97) % w, (((i * 53) + z * sc * (.3 + (i % 3) * .2)) % h), 1.6, 1.6 + (i % 3)); } }
      else { bg(c, w, h, '#1d6a38', '#16502a'); const off = (z * sc) % 44; c.fillStyle = 'rgba(255,255,255,.035)'; for (let y = -44 + off; y < h; y += 44) c.fillRect(0, y, w, 22); }
      c.fillStyle = space ? '#121833' : '#3a404b'; c.fillRect(cx - half, 0, half * 2, h);
      const off2 = (z * sc) % 36;                                   // kerbs and lane dashes scroll with the car
      for (let y = -36 + off2; y < h; y += 36) { c.fillStyle = (Math.round((y - off2) / 36) % 2) ? '#e8eaf0' : '#e5484d'; c.fillRect(cx - half - 4, y, 4, 18); c.fillRect(cx + half, y, 4, 18); c.fillStyle = 'rgba(255,255,255,.55)'; c.fillRect(cx - half / 3 - 1, y + 4, 2, 14); c.fillRect(cx + half / 3 - 1, y + 4, 2, 14); }
      if (RC) {
        const fy = carY - (RC.L - z) * sc;                           // finish line
        if (fy > -20 && fy < h + 20) for (let i = 0; i < 12; i++) for (let j = 0; j < 2; j++) { c.fillStyle = (i + j) % 2 ? '#111' : '#fff'; c.fillRect(cx - half + i * (half * 2 / 12), fy + j * 9 - 9, half * 2 / 12, 9); }
        for (const o of RC.obs) {
          const y = carY - (o.z - z) * sc; if (y < -24 || y > h + 24) continue;
          const x = cx + o.x * half * .9;
          if (o.k === 'b') {
            c.fillStyle = space ? 'rgba(80,200,255,.25)' : '#1d6fe0'; rr(c, x - 15, y - 12, 30, 24, 5); c.fill();
            c.strokeStyle = '#9fe8ff'; c.lineWidth = 2.5; for (let q = 0; q < 2; q++) { c.beginPath(); c.moveTo(x - 7, y + 6 - q * 8); c.lineTo(x, y - 2 - q * 8); c.lineTo(x + 7, y + 6 - q * 8); c.stroke(); }
          } else if (space) { c.fillStyle = '#6b7385'; c.beginPath(); c.arc(x, y, 13, 0, TAU); c.fill(); c.fillStyle = '#4b5263'; c.beginPath(); c.arc(x - 4, y - 3, 4, 0, TAU); c.arc(x + 5, y + 4, 3, 0, TAU); c.fill(); }
          else { c.fillStyle = '#ff7a1a'; c.beginPath(); c.moveTo(x, y - 14); c.lineTo(x + 11, y + 10); c.lineTo(x - 11, y + 10); c.closePath(); c.fill(); c.fillStyle = '#fff'; c.fillRect(x - 6, y - 2, 12, 4); c.fillStyle = '#c24d00'; c.fillRect(x - 13, y + 9, 26, 4); }
        }
      }
      const hit = now - s.hitT < 300, boost = now - s.boostT < 1200;
      if (boost || s.v > 37) { c.strokeStyle = 'rgba(255,255,255,.4)'; c.lineWidth = 1.5; for (let i = 0; i < 9; i++) { const lx = cx - half + ((i * 67) % (half * 2)), ly = (((i * 41) + now * .9) % h); c.beginPath(); c.moveTo(lx, ly); c.lineTo(lx, ly + 22); c.stroke(); } }
      const px = cx + s.x * half * .9 + (hit ? (Math.random() - .5) * 7 : 0), py = carY + (hit ? (Math.random() - .5) * 4 : 0);
      c.save(); c.translate(px, py); c.rotate(s.steer * .28);
      if (boost) { c.fillStyle = 'rgba(90,200,255,.35)'; c.beginPath(); c.ellipse(0, 6, 19, 30, 0, 0, TAU); c.fill(); }
      if (space) {
        c.fillStyle = `rgba(255,${140 + Math.random() * 90 | 0},60,.9)`; c.beginPath(); c.moveTo(-6, 14); c.lineTo(0, 14 + 8 + s.v * .55 * Math.random() + 6); c.lineTo(6, 14); c.fill();
        c.fillStyle = t.color; c.beginPath(); c.moveTo(0, -20); c.lineTo(14, 14); c.lineTo(0, 8); c.lineTo(-14, 14); c.closePath(); c.fill();
        c.fillStyle = '#bfe9ff'; c.beginPath(); c.ellipse(0, -2, 4, 7, 0, 0, TAU); c.fill();
      } else {
        c.fillStyle = '#111'; c.fillRect(-12, -13, 4, 9); c.fillRect(8, -13, 4, 9); c.fillRect(-12, 6, 4, 9); c.fillRect(8, 6, 4, 9);
        c.fillStyle = t.color; rr(c, -9, -18, 18, 36, 6); c.fill();
        c.fillStyle = 'rgba(190,235,255,.9)'; rr(c, -6, -9, 12, 8, 3); c.fill(); c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(-6, 4, 12, 9);
        c.fillStyle = '#fff6b0'; c.fillRect(-7, -19, 4, 2); c.fillRect(3, -19, 4, 2);
      }
      c.restore();
      if (hit) { c.fillStyle = 'rgba(255,60,60,.22)'; c.fillRect(0, 0, w, h); }
      if (RC) { c.fillStyle = 'rgba(0,0,0,.4)'; c.fillRect(8, 6, w - 16, 6); c.fillStyle = t.color; c.fillRect(8, 6, (w - 16) * clamp(z / RC.L, 0, 1), 6); }
      txt(c, `${Math.round(s.v * 3.6)} km/h`, 10, h - 8, 13, '#fff', 'left');
      if (!RC || H.st === 'idle') txt(c, 'Ready — press Start', w / 2, h / 2, 16, '#fff');
      else if (H.st === 'running' && !s.finished) countdown(c, w, h, now, RC.goAt);
      if (s.finished) { c.fillStyle = 'rgba(0,0,0,.4)'; c.fillRect(0, h / 2 - 30, w, 56); txt(c, `🏁 ${(s.finT / 1000).toFixed(1)} s`, w / 2, h / 2 + 8, 30, '#ffd166', 'center', 800); }
    }
  };

  /* ======================================================================
     9. MARBLE MAZE — tilt the phone to roll a marble out of a maze; each cleared maze is bigger
     ====================================================================== */
  const MZ_SIZES = [[4, 3], [5, 4], [6, 4], [7, 5], [8, 5], [9, 6], [10, 7]];
  let MZ = { seed: 1, cache: {}, goAt: 0 };
  function genMaze(level) {
    if (MZ.cache[level]) return MZ.cache[level];
    const [cols, rows] = MZ_SIZES[Math.min(level, MZ_SIZES.length - 1)], r = rng(MZ.seed + level * 7919);
    const vw = Array.from({ length: rows }, () => Array(cols + 1).fill(true)), hw = Array.from({ length: rows + 1 }, () => Array(cols).fill(true));
    const seen = Array.from({ length: rows }, () => Array(cols).fill(false)), stack = [[0, 0]]; seen[0][0] = true;
    while (stack.length) {                                           // depth-first "recursive backtracker"
      const [x, y] = stack[stack.length - 1], nb = [];
      if (x > 0 && !seen[y][x - 1]) nb.push([x - 1, y, 'l']); if (x < cols - 1 && !seen[y][x + 1]) nb.push([x + 1, y, 'r']);
      if (y > 0 && !seen[y - 1][x]) nb.push([x, y - 1, 'u']); if (y < rows - 1 && !seen[y + 1][x]) nb.push([x, y + 1, 'd']);
      if (!nb.length) { stack.pop(); continue; }
      const [nx, ny, d] = nb[(r() * nb.length) | 0]; seen[ny][nx] = true;
      if (d === 'l') vw[y][x] = false; else if (d === 'r') vw[y][x + 1] = false; else if (d === 'u') hw[y][x] = false; else hw[y + 1][x] = false;
      stack.push([nx, ny]);
    }
    const segs = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x <= cols; x++) if (vw[y][x]) segs.push([x, y, x, y + 1]);
    for (let y = 0; y <= rows; y++) for (let x = 0; x < cols; x++) if (hw[y][x]) segs.push([x, y, x + 1, y]);
    return (MZ.cache[level] = { cols, rows, segs, gx: cols - .5, gy: rows - .5 });
  }
  function stepMaze(t, now) {
    const s = t.s; if (H.st !== 'running') return;
    if (s.last == null) s.last = now;
    let dt = (now - s.last) / 1000; if (dt <= 0) return; dt = Math.min(dt, .1); s.last = now;
    if (!s.zeroed && now >= MZ.goAt) { zeroTilt(t); s.zeroed = true; }
    if (now < MZ.goAt) return;
    const mz = genMaze(s.level), c = ctl(s, H.sv(t)), R = .2, A = 20, n = Math.ceil(dt / .008), h = dt / n, m = s.m;
    for (let i = 0; i < n; i++) {
      m.vx += c.st * A * h; m.vy += -c.th * A * h;                  // nose-down rolls the marble up the screen
      const damp = 1 - 1.3 * h; m.vx *= damp; m.vy *= damp;
      const sp = Math.hypot(m.vx, m.vy); if (sp > 6) { m.vx *= 6 / sp; m.vy *= 6 / sp; }
      m.x += m.vx * h; m.y += m.vy * h;
      for (const g of mz.segs) {                                    // push the marble out of any wall it overlaps
        const px = clamp(m.x, Math.min(g[0], g[2]), Math.max(g[0], g[2])), py = clamp(m.y, Math.min(g[1], g[3]), Math.max(g[1], g[3]));
        const dx = m.x - px, dy = m.y - py, d2 = dx * dx + dy * dy; if (d2 >= R * R || d2 === 0) continue;
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d; m.x = px + nx * R; m.y = py + ny * R;
        const vn = m.vx * nx + m.vy * ny; if (vn < 0) { m.vx -= 1.35 * vn * nx; m.vy -= 1.35 * vn * ny; }
      }
    }
    s.dist += Math.hypot(m.vx, m.vy) * dt;
    const dg = Math.hypot(m.x - mz.gx, m.y - mz.gy); s.prog = clamp(1 - dg / Math.hypot(mz.cols, mz.rows), 0, 1);
    if (dg < .4) {                                                   // reached the goal
      s.cleared++; s.level++; s.flash = now; s.lastClear = now - MZ.goAt; s.m = { x: .5, y: .5, vx: 0, vy: 0 }; s.trail = [];
      H.beep(784, 140, .12); setTimeout(() => H.beep(1046, 200, .12), 150); H.log(t, `cleared maze ${s.cleared}`);
    }
  }
  GAMES.maze = {
    id: 'maze', emoji: '🔮', title: 'Marble Maze', accent: '#38bdf8', mode: 'timed', defDur: 90, better: 'high', arenaH: 240,
    blurb: 'Tilt your phone to roll the marble out of the maze — each one is bigger.',
    how: 'Hold the phone flat in both hands. After the 3-2-1 it zeroes: tip it to roll the marble toward the glowing star. Walls stop the marble. Clear as many mazes as you can before time runs out.',
    settings: [],
    sens: tiltSens(20),
    reset(t) { t.s = { m: { x: .5, y: .5, vx: 0, vy: 0 }, level: 0, cleared: 0, prog: 0, dist: 0, flash: -1e9, lastClear: 0, trail: [], zeroed: false, last: null, gs: null, g0: null, sdeg: 0, ang: 0 }; },
    onBegin(now) { MZ = { seed: (Math.random() * 1e9) | 0, cache: {}, goAt: now + 3000 }; H.teams.forEach(t => { t.s.last = now; t.s.zeroed = false; }); },
    onFrame(t, f) { tiltFrame(t, f); },
    tick(now) { if (H.st === 'running') H.teams.forEach(t => stepMaze(t, now)); },
    rankKey: t => t.s.cleared * 1e6 - t.s.lastClear + t.s.prog * 1000,
    score: t => t.s.cleared * 1e6 - t.s.lastClear + t.s.prog * 1000, played: t => t.s.cleared > 0 || t.s.dist > 1,
    scoreText: t => String(t.s.cleared),
    sub: t => `Maze ${t.s.level + 1} · ${Math.round(t.s.prog * 100)}% of the way`,
    phone: (t, now) => ({ big: t.s.cleared, sub: `Mazes cleared · now on maze ${t.s.level + 1}`, meter: t.s.prog, bg: now - t.s.flash < 800 ? '#14301f' : null }),
    ...zeroBtn,
    draw(t, c, w, h, now, dt) {
      const s = t.s; stepMaze(t, now);
      const mz = genMaze(s.level), cs = Math.min((w - 14) / mz.cols, (h - 14) / mz.rows), ox = (w - cs * mz.cols) / 2, oy = (h - cs * mz.rows) / 2;
      bg(c, w, h, '#101521', '#090d15');
      c.fillStyle = '#161d2e'; c.fillRect(ox, oy, cs * mz.cols, cs * mz.rows);
      const pulse = 1 + .12 * Math.sin(now / 250), gx = ox + mz.gx * cs, gy = oy + mz.gy * cs;       // the goal
      const gr = c.createRadialGradient(gx, gy, 1, gx, gy, cs * .6); gr.addColorStop(0, 'rgba(255,214,102,.9)'); gr.addColorStop(1, 'rgba(255,214,102,0)');
      c.fillStyle = gr; c.beginPath(); c.arc(gx, gy, cs * .6 * pulse, 0, TAU); c.fill();
      c.fillStyle = '#ffd166'; starPath(c, gx, gy, cs * .26); c.fill();
      c.strokeStyle = '#8fa3c7'; c.lineWidth = Math.max(2, cs * .08); c.lineCap = 'round'; c.beginPath();
      for (const g of mz.segs) { c.moveTo(ox + g[0] * cs, oy + g[1] * cs); c.lineTo(ox + g[2] * cs, oy + g[3] * cs); }
      c.stroke();
      const m = s.m, mx = ox + m.x * cs, my = oy + m.y * cs;
      s.trail.push([mx, my]); if (s.trail.length > 14) s.trail.shift();
      s.trail.forEach((p, i) => { c.fillStyle = t.color; c.globalAlpha = i / s.trail.length * .25; c.beginPath(); c.arc(p[0], p[1], cs * .17 * i / s.trail.length, 0, TAU); c.fill(); });
      c.globalAlpha = 1; s.ang += (m.vx * dt) / .2;
      drawBall(c, mx, my, cs * .2, t.color, s.ang);
      txt(c, `Maze ${s.level + 1}`, 8, 16, 12, '#8a92a3', 'left');
      if (now - s.flash < 900) txt(c, 'CLEAR! ✨', w / 2, h / 2, 30, '#ffd166', 'center', 800);
      if (H.st === 'idle') txt(c, 'Ready — press Start', w / 2, h - 8, 13, '#cfd6e6');
      else if (H.st === 'running') countdown(c, w, h, now, MZ.goAt);
    }
  };

  /* ======================================================================
     10. CATCH THE STARS — slide the basket with your tilt; stars score, bombs hurt
     ====================================================================== */
  let ST = { items: [], goAt: 0 };
  function makeStars() {
    const r = rng((Math.random() * 1e9) | 0), items = []; let t = .6;
    while (t < 120) { const k = r(); items.push({ t, x: .08 + r() * .84, k: k < .07 ? 'g' : k < .3 ? 'b' : 's', v: .32 + .0032 * t }); t += .5 + r() * .4; }
    return items;
  }
  function stepStars(t, now) {
    const s = t.s; if (H.st !== 'running') return;
    if (s.last == null) s.last = now;
    let dt = (now - s.last) / 1000; if (dt <= 0) return; dt = Math.min(dt, .1); s.last = now;
    if (!s.zeroed && now >= ST.goAt) { zeroTilt(t); s.zeroed = true; }
    if (now < ST.goAt) return;
    const c = ctl(s, H.sv(t)), run = (now - ST.goAt) / 1000;
    if (now > s.stun) s.tx = .5 + .5 * clamp(c.st * 1.15, -1, 1);
    s.bx += (s.tx - s.bx) * Math.min(1, dt * 10);
    for (let i = s.lo; i < ST.items.length; i++) {
      const it = ST.items[i], y = (run - it.t) * it.v;
      if (y < 0) break;                                              // not fallen into view yet (items are in time order)
      if (s.done.has(i)) { if (i === s.lo) s.lo++; continue; }
      if (y > .82 && y < 1 && Math.abs(it.x - s.bx) < .115) {
        s.done.add(i);
        if (it.k === 'b') { s.pts = Math.max(0, s.pts - 3); s.stun = now + 800; s.bombT = now; H.beep(150, 220, .15, 'sawtooth'); s.pops.push({ x: it.x, txt: '−3', col: '#ff6b6b', a: 0 }); }
        else { const v = it.k === 'g' ? 3 : 1; s.pts += v; s.catchT = now; H.beep(it.k === 'g' ? 1100 : 760, 80, .1); s.pops.push({ x: it.x, txt: '+' + v, col: '#ffd166', a: 0 }); }
      } else if (y >= 1) { s.done.add(i); if (i === s.lo) s.lo++; }
    }
  }
  GAMES.stars = {
    id: 'stars', emoji: '⭐', title: 'Catch the Stars', accent: '#fbbf24', mode: 'timed', defDur: 45, better: 'high', arenaH: 230,
    blurb: 'Tilt to slide your basket under the falling stars — dodge the bombs!',
    how: 'Hold the phone like a wheel or flat. After the 3-2-1 it zeroes: tilt left and right to move the basket. Stars score 1 (golden stars 3). A bomb costs 3 points and freezes your basket for a moment.',
    settings: [],
    sens: tiltSens(25),
    reset(t) { t.s = { bx: .5, tx: .5, pts: 0, lo: 0, done: new Set(), pops: [], stun: 0, catchT: -1e9, bombT: -1e9, zeroed: false, last: null, gs: null, g0: null, sdeg: 0 }; },
    onBegin(now) { ST = { items: makeStars(), goAt: now + 3000 }; H.teams.forEach(t => { t.s.last = now; t.s.zeroed = false; }); },
    onFrame(t, f) { tiltFrame(t, f); },
    tick(now) { if (H.st === 'running') H.teams.forEach(t => stepStars(t, now)); },
    score: t => t.s.pts, scoreText: t => String(t.s.pts),
    sub: () => 'Stars +1 · golden +3 · bombs −3',
    phone: (t, now) => ({ big: t.s.pts, sub: 'Tilt left / right to move the basket', bg: now - t.s.bombT < 500 ? '#4a1620' : now - t.s.catchT < 200 ? '#14301f' : null }),
    ...zeroBtn,
    draw(t, c, w, h, now, dt) {
      const s = t.s; stepStars(t, now);
      bg(c, w, h, '#070b1f', '#1b1f4a');
      for (let i = 0; i < 30; i++) { c.fillStyle = `rgba(255,255,255,${.25 + .35 * Math.abs(Math.sin(now / 900 + i))})`; c.fillRect((i * 61) % w, (i * 37) % (h * .8), 1.5, 1.5); }
      c.fillStyle = '#0d1030'; c.fillRect(0, h - 14, w, 14);
      const run = (now - ST.goAt) / 1000;
      if (H.st === 'running' && now >= ST.goAt) for (let i = s.lo; i < ST.items.length; i++) {
        const it = ST.items[i], y = (run - it.t) * it.v; if (y < -.06) break; if (s.done.has(i) || y > 1.08) continue;
        const x = it.x * w, py = y * (h - 20);
        if (it.k === 'b') { c.fillStyle = '#23262f'; c.beginPath(); c.arc(x, py, 11, 0, TAU); c.fill(); c.strokeStyle = '#ffb547'; c.lineWidth = 2; c.beginPath(); c.moveTo(x + 4, py - 9); c.quadraticCurveTo(x + 10, py - 16, x + 6, py - 20); c.stroke(); c.fillStyle = '#ff6b6b'; c.beginPath(); c.arc(x + 6, py - 20, 2.5, 0, TAU); c.fill(); c.fillStyle = 'rgba(255,255,255,.35)'; c.beginPath(); c.arc(x - 4, py - 3, 3, 0, TAU); c.fill(); }
        else { c.fillStyle = it.k === 'g' ? '#ff9f1c' : '#ffd166'; c.shadowColor = '#ffd166'; c.shadowBlur = it.k === 'g' ? 14 : 8; starPath(c, x, py, it.k === 'g' ? 15 : 11); c.fill(); c.shadowBlur = 0; }
      }
      const bx = s.bx * w, by = h - 30, stunned = now < s.stun;
      c.fillStyle = stunned ? '#6b7280' : t.color;                    // the basket
      c.beginPath(); c.moveTo(bx - 28, by - 4); c.lineTo(bx + 28, by - 4); c.lineTo(bx + 20, by + 14); c.lineTo(bx - 20, by + 14); c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,255,255,.3)'; c.fillRect(bx - 26, by - 6, 52, 4);
      if (stunned) txt(c, '💫', bx, by - 12, 18, '#fff');
      s.pops = s.pops.filter(p => (p.a += dt) < .8);
      s.pops.forEach(p => { c.globalAlpha = 1 - p.a / .8; txt(c, p.txt, p.x * w, by - 14 - p.a * 40, 18, p.col, 'center', 800); c.globalAlpha = 1; });
      txt(c, `⭐ ${s.pts}`, 10, 18, 15, '#ffd166', 'left', 800);
      if (H.st === 'idle') txt(c, 'Ready — press Start', w / 2, h / 2, 16, '#fff');
      else if (H.st === 'running') countdown(c, w, h, now, ST.goAt);
    }
  };
  GAMES.racer.debug = () => RC; GAMES.maze.debug = () => ({ MZ, genMaze }); GAMES.stars.debug = () => ST;

  /* ======================================================================
     11. FLAPPY FLICK — flick the phone to flap a bird through the gaps
     ====================================================================== */
  // Everything is in pixels of a 200-px-tall field so the bird is the same size whatever the card width.
  const FLAP = { speed: 75, grav: 520, flapV: -190, gap: 36, gateEvery: 150, birdX: 70, ground: 180, r: 9, pipeHalf: 17 };
  let FL = { gates: [], goAt: 0 };
  function makeGates() { const r = rng((Math.random() * 1e9) | 0), g = []; for (let i = 0; i < 90; i++) g.push({ x: 260 + i * FLAP.gateEvery, c: 62 + r() * 68 }); return g; }
  function crashFlap(t, now) {
    const s = t.s; s.dead = true; s.deadAt = now; s.reviveAt = now + 1400; s.crashes++; s.vy = -120; H.beep(150, 220, .15, 'sawtooth');
  }
  function stepFlap(t, now) {
    const s = t.s; if (H.st !== 'running') return;
    if (s.last == null) s.last = now;
    let dt = (now - s.last) / 1000; if (dt <= 0) return; dt = Math.min(dt, .1); s.last = now;
    if (now < FL.goAt) return;
    if (s.dead) {                                                    // tumble, then come back after a moment
      s.vy += FLAP.grav * dt; s.y = Math.min(FLAP.ground - FLAP.r, s.y + s.vy * dt);
      if (now >= s.reviveAt) { s.dead = false; s.y = 100; s.vy = 0; s.inv = now + 1300; }
      return;
    }
    s.vy += FLAP.grav * dt; s.y += s.vy * dt; s.x += FLAP.speed * dt;
    const bx = s.x + FLAP.birdX, inv = now < s.inv;
    for (let i = Math.max(0, s.gi - 1); i < FL.gates.length; i++) {
      const gt = FL.gates[i]; if (gt.x - FLAP.pipeHalf - FLAP.r > bx) break;
      if (!inv && Math.abs(bx - gt.x) < FLAP.pipeHalf + FLAP.r - 2 && (s.y - FLAP.r < gt.c - FLAP.gap + 2 || s.y + FLAP.r > gt.c + FLAP.gap - 2)) { crashFlap(t, now); return; }
      if (i === s.gi && bx > gt.x + FLAP.pipeHalf) { s.gi++; s.score++; H.beep(880, 60, .08); }
    }
    if (s.y + FLAP.r > FLAP.ground) { if (!inv) { s.y = FLAP.ground - FLAP.r; crashFlap(t, now); } else { s.y = FLAP.ground - FLAP.r; s.vy = Math.min(0, s.vy); } }
    if (s.y - FLAP.r < 0) { s.y = FLAP.r; s.vy = Math.max(0, s.vy); }
  }
  GAMES.flap = {
    id: 'flap', emoji: '🐦', title: 'Flappy Flick', accent: '#4ade80', mode: 'timed', defDur: 60, better: 'high', arenaH: 200,
    blurb: 'Flick your phone to flap a bird through the gaps.',
    how: 'Give the phone a quick flick (up, down — any sharp jerk) and the bird flaps up. Let it fall between flicks and thread it through the green gaps. A crash costs you a moment, then you carry on. Most gaps passed wins.',
    settings: [{ k: 'gap', type: 'range', min: 80, max: 600, step: 20, val: 160, label: 'Shortest time between flaps: {v} ms' }],
    sens: {
      label: 'Flick strength to flap', unit: ' g', min: 1.3, max: 6, step: .1, def: 2, scale: 6,
      hint: 'Lower = more sensitive: a gentler flick flaps. Higher = it needs a proper flick.',
      signal: t => t.f ? t.f.gx : 1, apply: t => { t.thr = H.sv(t); }
    },
    onSetting(k) { if (k === 'gap') H.teams.forEach(H.pushCfg); },
    reset(t) { t.s = { y: 100, vy: 0, x: 0, gi: 0, score: 0, crashes: 0, dead: false, deadAt: 0, reviveAt: 0, inv: 0, flapT: -1e9, last: null }; },
    onBegin(now) { FL = { gates: makeGates(), goAt: now + 3000 }; H.teams.forEach(t => { t.s.last = now; }); },
    onHit(t, g, counted, now) { const s = t.s; if (H.st !== 'running' || !FL.goAt || now < FL.goAt || s.dead) return; s.vy = FLAP.flapV; s.flapT = now; },
    tick(now) { if (H.st === 'running') H.teams.forEach(t => stepFlap(t, now)); },
    score: t => t.s.score, scoreText: t => String(t.s.score),
    sub: t => `${t.s.crashes} crash${t.s.crashes === 1 ? '' : 'es'}`,
    phone: (t, now) => ({ big: t.s.score, sub: t.s.dead ? 'Crashed! Back in a moment…' : 'Flick the phone to flap!', bg: t.s.dead ? '#4a1620' : now - t.s.flapT < 150 ? '#14301f' : null }),
    draw(t, c, w, h, now, dt) {
      const s = t.s; stepFlap(t, now);
      bg(c, w, h, '#58b6ff', '#cfeeff');
      c.fillStyle = 'rgba(255,255,255,.85)';
      for (let i = 0; i < 5; i++) { const cx = ((i * 140 - s.x * .25) % (w + 120) + (w + 120)) % (w + 120) - 40, cy = 28 + (i * 37) % 80; c.beginPath(); c.ellipse(cx, cy, 26, 10, 0, 0, TAU); c.ellipse(cx + 16, cy - 6, 16, 9, 0, 0, TAU); c.fill(); }
      for (const gt of FL.gates) {
        const sx = gt.x - s.x; if (sx < -40) continue; if (sx > w + 40) break;
        c.fillStyle = '#3aa655'; c.fillRect(sx - FLAP.pipeHalf, 0, FLAP.pipeHalf * 2, gt.c - FLAP.gap); c.fillRect(sx - FLAP.pipeHalf, gt.c + FLAP.gap, FLAP.pipeHalf * 2, FLAP.ground - gt.c - FLAP.gap);
        c.fillStyle = '#2a8a42'; c.fillRect(sx - FLAP.pipeHalf - 3, gt.c - FLAP.gap - 10, FLAP.pipeHalf * 2 + 6, 10); c.fillRect(sx - FLAP.pipeHalf - 3, gt.c + FLAP.gap, FLAP.pipeHalf * 2 + 6, 10);
        c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(sx - FLAP.pipeHalf + 3, 0, 4, gt.c - FLAP.gap); c.fillRect(sx - FLAP.pipeHalf + 3, gt.c + FLAP.gap + 10, 4, FLAP.ground - gt.c - FLAP.gap - 10);
      }
      c.fillStyle = '#d9b36c'; c.fillRect(0, FLAP.ground, w, h - FLAP.ground);
      c.fillStyle = '#7cc04b'; c.fillRect(0, FLAP.ground, w, 6);
      c.fillStyle = 'rgba(0,0,0,.08)'; for (let x = -((s.x % 24) + 24); x < w; x += 24) c.fillRect(x, FLAP.ground + 6, 12, 14);
      // the bird
      const by = s.y, flapping = now - s.flapT < 180, inv = now < s.inv && !s.dead;
      c.save(); c.translate(FLAP.birdX, by); c.rotate(clamp(s.vy / 420, -.5, .9) + (s.dead ? (now - s.deadAt) / 120 : 0));
      if (inv && Math.floor(now / 120) % 2) c.globalAlpha = .45;
      c.fillStyle = t.color; c.beginPath(); c.arc(0, 0, FLAP.r + 2, 0, TAU); c.fill();
      c.fillStyle = 'rgba(0,0,0,.18)'; c.beginPath(); c.arc(0, 4, FLAP.r, 0, Math.PI); c.fill();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(4, -3, 4.2, 0, TAU); c.fill(); c.fillStyle = '#111'; c.beginPath(); c.arc(5.2, -3, 1.9, 0, TAU); c.fill();
      c.fillStyle = '#ffb020'; c.beginPath(); c.moveTo(9, 0); c.lineTo(17, 3); c.lineTo(9, 5); c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,255,255,.85)'; c.beginPath(); c.ellipse(-3, flapping ? -6 : 3, 7, flapping ? 4 : 6, flapping ? -.6 : .3, 0, TAU); c.fill();
      c.restore();
      txt(c, String(s.score), w / 2, 40, 34, '#fff', 'center', 800);
      if (s.dead) txt(c, '💥 crash!', w / 2, 100, 18, '#ff4d4d', 'center', 800);
      if (H.st === 'idle') txt(c, 'Ready — press Start', w / 2, 110, 16, '#1b4b6b');
      else if (H.st === 'running') countdown(c, w, h, now, FL.goAt);
    }
  };

  /* ======================================================================
     12. SHAKE ROCKET — shake the phone to power a rocket into space
     ====================================================================== */
  GAMES.shake = {
    id: 'shake', emoji: '🛸', title: 'Shake Rocket', accent: '#fb923c', mode: 'timed', defDur: 20, better: 'high', arenaH: 210,
    blurb: 'Shake the phone as hard as you can to blast a rocket into space.',
    how: 'Hold the phone firmly and shake it — the harder and faster, the more fuel you make. The rocket climbs as the shaking adds up. Most altitude when the time is up wins. (Hold on tight!)',
    settings: [],
    sens: {
      label: 'Ignore wiggles below', unit: ' g', min: 0, max: 1, step: .05, def: .15, scale: 1.5, dp: 2,
      hint: 'Lower = more sensitive: small shakes count. Higher = only proper shaking counts.',
      signal: t => t.s.rate
    },
    reset(t) { t.s = { e: 0, rate: 0, parts: [], stars: [], flash: -1e9, orbit: false }; },
    onFrame(t, f, d, dt) {
      const s = t.s, inst = dt > 0 ? d.wob / (dt / 1000) : 0;
      s.rate += (inst - s.rate) * .35;
      if (H.st === 'running' && inst > H.sv(t)) s.e += d.wob * 60;
    },
    score: t => t.s.e, scoreText: t => String(Math.round(t.s.e)), played: t => t.s.e > 0,
    sub: t => `Altitude ${(Math.min(t.s.e, 1500) / 8).toFixed(0)} km${t.s.e >= 800 ? ' · in orbit! 🌟' : ''}`,
    phone: t => ({ big: Math.round(t.s.e), sub: t.s.rate > .4 ? 'YES! Keep shaking!' : 'Shake it! Shake it!', meter: clamp(t.s.rate / 1.2, 0, 1), bg: t.s.rate > .6 ? '#4a2a10' : null }),
    draw(t, c, w, h, now, dt) {
      const s = t.s, alt = clamp(s.e / 800, 0, 1), over = s.e > 800;
      const sky = c.createLinearGradient(0, 0, 0, h);                // blue at the bottom fading to black space
      sky.addColorStop(0, '#02030a'); sky.addColorStop(.5 - alt * .3, `rgb(${20 + (1 - alt) * 20},${30 + (1 - alt) * 60},${70 + (1 - alt) * 120})`); sky.addColorStop(1, `rgb(${70 + (1 - alt) * 70},${140 + (1 - alt) * 60},${210})`);
      c.fillStyle = sky; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(255,255,255,${(.15 + alt * .7) * (.4 + .6 * Math.abs(Math.sin(now / 700 + i)))})`; c.fillRect((i * 73) % w, ((i * 41) + alt * 60) % (h - 30), 1.6, 1.6); }
      const gy = h - 22 + alt * 60;                                  // the launch pad slides away as you climb
      if (gy < h + 20) { c.fillStyle = '#2f6b3a'; c.fillRect(0, gy, w, 40); c.fillStyle = '#555c6b'; c.fillRect(w / 2 - 26, gy - 4, 52, 6); }
      const rx = w / 2 + Math.sin(now / 35) * Math.min(4, s.rate * 5), ry = h - 62 - alt * (h - 110);
      // exhaust
      const fl = 10 + s.rate * 60 + Math.random() * 6;
      s.parts.push({ x: rx + (Math.random() - .5) * 8, y: ry + 24, vx: (Math.random() - .5) * 30, vy: 40 + Math.random() * 60, a: 0 });
      s.parts = s.parts.filter(p => (p.a += dt) < .6 && p.y < h + 10);
      s.parts.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; c.fillStyle = `rgba(255,${180 - p.a * 200 | 0},60,${.8 - p.a * 1.3})`; c.beginPath(); c.arc(p.x, p.y, 5 * (1 - p.a), 0, TAU); c.fill(); });
      c.fillStyle = '#ffb020'; c.beginPath(); c.moveTo(rx - 7, ry + 22); c.lineTo(rx, ry + 22 + fl); c.lineTo(rx + 7, ry + 22); c.fill();
      c.fillStyle = '#ffe8a0'; c.beginPath(); c.moveTo(rx - 3.5, ry + 22); c.lineTo(rx, ry + 22 + fl * .6); c.lineTo(rx + 3.5, ry + 22); c.fill();
      // the rocket
      c.fillStyle = t.color; c.beginPath(); c.moveTo(rx - 11, ry + 22); c.lineTo(rx - 20, ry + 34); c.lineTo(rx - 11, ry + 14); c.closePath(); c.fill(); c.beginPath(); c.moveTo(rx + 11, ry + 22); c.lineTo(rx + 20, ry + 34); c.lineTo(rx + 11, ry + 14); c.closePath(); c.fill();
      c.fillStyle = '#e9edf5'; rr(c, rx - 11, ry - 22, 22, 46, 10); c.fill();
      c.fillStyle = t.color; c.beginPath(); c.moveTo(rx - 11, ry - 12); c.quadraticCurveTo(rx, ry - 42, rx + 11, ry - 12); c.closePath(); c.fill();
      c.fillStyle = '#7fd3ff'; c.beginPath(); c.arc(rx, ry - 2, 6, 0, TAU); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke();
      // progress + labels
      c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(w - 14, 10, 6, h - 20); c.fillStyle = over ? '#ffd166' : '#fb923c'; c.fillRect(w - 14, 10 + (h - 20) * (1 - alt), 6, (h - 20) * alt);
      txt(c, `${(Math.min(s.e, 1500) / 8).toFixed(0)} km`, 10, 20, 15, '#fff', 'left', 800);
      if (over) { txt(c, 'IN ORBIT! 🌟', w / 2, 30, 18, '#ffd166', 'center', 800); }
      if (H.st === 'idle') txt(c, 'Ready — press Start, then SHAKE!', w / 2, h / 2, 14, '#fff');
    }
  };

  /* ======================================================================
     13. SIMON SAYS — watch a run of tilt moves, then repeat it from memory
     ====================================================================== */
  const DIRS = [{ a: '▲', hz: 660, c: '#4cd37b', n: 'forward' }, { a: '▼', hz: 440, c: '#5aa8ff', n: 'back' }, { a: '◀', hz: 520, c: '#ffb547', n: 'left' }, { a: '▶', hz: 600, c: '#f472b6', n: 'right' }];
  const SIM = { phase: 'idle', round: 0, at: 0, len: 0, seq: [], beat: -1 };
  GAMES.simon = {
    id: 'simon', emoji: '🧠', title: 'Simon Says', accent: '#a78bfa', mode: 'rounds', better: 'high', arenaH: 170,
    blurb: 'Watch the run of tilt moves, then repeat it from memory.',
    how: 'Watch the screen: a run of arrows appears, one at a time. Then it is your turn — hold the phone flat, and tip it forward ▲, back ▼, left ◀ or right ▶ for each arrow, returning to level between moves. Get the whole run right to score. Each round adds one more move!',
    settings: [{ k: 'rounds', type: 'number', min: 1, max: 10, val: 6, label: 'Rounds' }],
    sens: { ...tiltSens(22), label: 'Tilt needed for a move', hint: 'Lower = more sensitive: a smaller tilt counts as a move.' },
    reset(t) { t.s = { pts: 0, inputs: [], out: false, done: false, armed: false, flash: -1e9, gain: 0, hist: [], gs: null, g0: null, sdeg: 0 }; SIM.phase = 'idle'; SIM.round = 0; },
    onStart() { SIM.round = 0; this.nextRound(performance.now()); },
    nextRound(now) {
      SIM.round++; const L = SIM.round + 2; SIM.seq = Array.from({ length: L }, () => (Math.random() * 4) | 0);
      SIM.phase = 'show'; SIM.at = now; SIM.len = 1200 + 800 * L; SIM.beat = -1;
      H.teams.forEach(t => { Object.assign(t.s, { inputs: [], out: false, done: false, armed: false, gain: 0 }); }); H.beep(700, 120); H.pushAll();
    },
    tick(now) {
      if (H.st !== 'running') return;
      const e = now - SIM.at, L = SIM.seq.length;
      if (SIM.phase === 'show') {
        const beat = Math.floor((e - 900) / 800); if (beat !== SIM.beat && beat >= 0 && beat < L) { SIM.beat = beat; H.beep(DIRS[SIM.seq[beat]].hz, 300, .15); }
        if (e >= SIM.len) { SIM.phase = 'input'; SIM.at = now; SIM.len = (6 + 1.3 * L) * 1000; H.teams.forEach(t => zeroTilt(t)); H.beep(880, 200, .15); H.pushAll(); }
      } else if (SIM.phase === 'input') {
        if (e >= SIM.len || H.teams.every(t => t.s.done || t.s.out)) {
          H.teams.forEach(t => { const s = t.s; s.gain = s.done ? L : 0; s.pts += s.gain; s.hist.push(s.done); if (s.done) H.log(t, `✓ round ${SIM.round} (+${L})`); else H.log(t, `✗ round ${SIM.round}`); });
          SIM.phase = 'result'; SIM.at = now; SIM.len = 2600; H.beep(520, 200); H.pushAll();
        }
      } else if (SIM.phase === 'result' && e >= SIM.len) {
        if (SIM.round >= H.set.rounds) { SIM.phase = 'done'; H.finish(false); } else this.nextRound(now);
      }
    },
    onFrame(t, f, d, dt, now) {
      tiltFrame(t, f); const s = t.s;
      if (H.st !== 'running' || SIM.phase !== 'input' || s.done || s.out) return;
      const c = ctl(s, H.sv(t)), ax = Math.abs(c.st), ay = Math.abs(c.th), m = Math.max(ax, ay);
      if (!s.armed) { if (m < .3) s.armed = true; return; }          // wait for the phone to come back to level between moves
      if (m > .75) {
        const dir = ax > ay ? (c.st < 0 ? 2 : 3) : (c.th > 0 ? 0 : 1);
        s.armed = false; s.inputs.push(dir); s.flash = now;
        if (dir !== SIM.seq[s.inputs.length - 1]) { s.out = true; H.beep(150, 250, .12, 'sawtooth'); }
        else if (s.inputs.length === SIM.seq.length) { s.done = true; H.beep(1000, 150, .12); }
      }
    },
    score: t => t.s.pts, scoreText: t => t.s.pts + ' pts',
    sub: t => t.s.hist.length ? 'Rounds: ' + t.s.hist.map(x => x ? '✓' : '✗').join(' ') : 'Remember the moves!',
    clock(now) {
      const L = SIM.seq.length, R = `Round ${SIM.round}/${H.set.rounds}`;
      if (H.st === 'finished') return { big: 'GAME OVER', sub: '', mood: '' };
      if (H.st !== 'running') return null;
      if (SIM.phase === 'show') return { big: 'WATCH!', sub: `${R} · ${L} moves`, mood: 'ice' };
      if (SIM.phase === 'input') return { big: 'YOUR TURN!', sub: `${R} · ${Math.max(0, Math.ceil((SIM.len - (now - SIM.at)) / 1000))} s left`, mood: 'go' };
      return { big: 'Results', sub: R, mood: '' };
    },
    phone(t) {
      const s = t.s, L = SIM.seq.length;
      if (SIM.phase === 'show') return { big: '👀', sub: 'Watch the screen…', bg: '#17213d' };
      if (SIM.phase === 'input') return s.out ? { big: '❌', sub: 'Not this time — wait for the next round', bg: '#4a1620' } : s.done ? { big: '✅', sub: 'You got it!', bg: '#14301f' } : { big: `${s.inputs.length}/${L}`, sub: 'Tilt to repeat the moves, level between each', meter: s.inputs.length / L };
      return { big: SIM.phase === 'result' ? (s.gain ? '+' + s.gain : '–') : '🧠', sub: `${s.pts} points`, bg: null };
    },
    ...zeroBtn,
    draw(t, c, w, h, now, dt) {
      const s = t.s, L = SIM.seq.length, e = now - SIM.at, show = SIM.phase === 'show', input = SIM.phase === 'input', result = SIM.phase === 'result';
      bg(c, w, h, '#1a1633', '#100e22');
      if (!L || SIM.phase === 'idle' || H.st === 'idle') { txt(c, 'Ready — press Start', w / 2, h / 2 + 5, 16, '#cfd6e6'); return; }
      const box = Math.min(34, (w - 24) / L - 6), gap = 6, rowW = L * (box + gap) - gap, x0 = (w - rowW) / 2;
      const beat = Math.floor((e - 900) / 800), lit = show && beat >= 0 && beat < L && ((e - 900) % 800) < 600;
      txt(c, show ? 'WATCH…' : input ? 'YOUR TURN' : 'RESULT', 10, 16, 12, show ? '#9bb4ff' : input ? '#4cd37b' : '#cfd6e6', 'left', 800);
      for (let i = 0; i < L; i++) {                                    // the run to remember
        const x = x0 + i * (box + gap), reveal = result || (show && i < beat) || (show && i === beat && lit);
        c.fillStyle = reveal ? DIRS[SIM.seq[i]].c : '#2a2650'; rr(c, x, 26, box, box, 7); c.fill();
        txt(c, reveal ? DIRS[SIM.seq[i]].a : '?', x + box / 2, 26 + box * .68, box * .55, reveal ? '#10121a' : '#6a64a8');
      }
      if (show && lit) txt(c, DIRS[SIM.seq[beat]].a, w / 2, 112, 62, DIRS[SIM.seq[beat]].c, 'center', 800);
      if (input || result) {
        for (let i = 0; i < L; i++) {                                  // what this player did
          const x = x0 + i * (box + gap), v = s.inputs[i], ok = v !== undefined && v === SIM.seq[i];
          c.strokeStyle = v === undefined ? '#3a3568' : ok ? '#4cd37b' : '#ff6b6b'; c.lineWidth = 2; rr(c, x, 130, box, box, 7); c.stroke();
          if (v !== undefined) txt(c, DIRS[v].a, x + box / 2, 130 + box * .68, box * .55, ok ? DIRS[v].c : '#ff6b6b');
        }
        if (input && now - s.flash < 250 && s.inputs.length) { const v = s.inputs[s.inputs.length - 1]; txt(c, DIRS[v].a, w / 2, 112, 54, DIRS[v].c, 'center', 800); }
        if (s.out) txt(c, '✗ not quite', w / 2, 118, 20, '#ff6b6b', 'center', 800);
        else if (s.done) txt(c, `✓ perfect${result ? ' +' + s.gain : ''}`, w / 2, 118, 20, '#4cd37b', 'center', 800);
      }
    }
  };

  /* ======================================================================
     14. POSE MATCH — copy the pose shown on the screen and hold still
     ====================================================================== */
  const POSES = [
    { id: 'up', short: 'Screen up', say: 'Lay it flat, screen facing the sky' },
    { id: 'down', short: 'Screen down', say: 'Lay it flat, screen facing the floor' },
    { id: 'top', short: 'Upright', say: 'Hold it upright, like making a call' },
    { id: 'inv', short: 'Upside down', say: 'Hold it upside down' },
    { id: 'sideL', short: 'Side ◀', say: 'On its side, top pointing left' },
    { id: 'sideR', short: 'Side ▶', say: 'On its side, top pointing right' }
  ];
  const poseOf = g => { const m = Math.hypot(g.x, g.y, g.z) || 1, ax = Math.abs(g.x) / m, ay = Math.abs(g.y) / m, az = Math.abs(g.z) / m; if (az > .8) return g.z > 0 ? 'up' : 'down'; if (ay > .8) return g.y > 0 ? 'top' : 'inv'; if (ax > .8) return g.x > 0 ? 'sideL' : 'sideR'; return null; };
  function phoneIcon(c, x, y, id, sz, col) {
    c.save(); c.translate(x, y);
    if (id === 'up' || id === 'down') {                              // lying flat: a squashed phone seen from the side
      c.fillStyle = id === 'up' ? '#1f6feb' : '#5a6270'; c.beginPath(); c.moveTo(-sz * .55, sz * .12); c.lineTo(sz * .55, sz * .12); c.lineTo(sz * .78, -sz * .2); c.lineTo(-sz * .32, -sz * .2); c.closePath(); c.fill();
      c.strokeStyle = col || '#dbe4f0'; c.lineWidth = 3; c.stroke();
      c.fillStyle = '#fff'; c.fillRect(-sz * .1, -sz * .13, sz * .3, 3);
      if (id === 'down') { c.fillStyle = '#222'; c.beginPath(); c.arc(sz * .45, -sz * .02, 3.5, 0, TAU); c.fill(); }
    } else {
      c.rotate(id === 'inv' ? Math.PI : id === 'sideL' ? -Math.PI / 2 : id === 'sideR' ? Math.PI / 2 : 0);
      c.fillStyle = '#1f6feb'; rr(c, -sz * .3, -sz * .55, sz * .6, sz * 1.1, sz * .1); c.fill(); c.strokeStyle = col || '#dbe4f0'; c.lineWidth = 3; c.stroke();
      c.fillStyle = '#fff'; c.fillRect(-sz * .09, -sz * .46, sz * .18, 3);
    }
    c.restore();
  }
  const PM = { phase: 'idle', round: 0, at: 0, len: 0, target: 'up', last: '' };
  GAMES.pose = {
    id: 'pose', emoji: '🗿', title: 'Pose Match', accent: '#2dd4bf', mode: 'rounds', better: 'high', arenaH: 170,
    blurb: 'Copy the pose on the screen with your phone — the fastest wins the round.',
    how: 'A pose appears on the screen: flat, upright, upside down, on its side… Move your phone into that pose and hold it still for a moment. The quicker you match it, the more points you get.',
    settings: [{ k: 'rounds', type: 'number', min: 1, max: 15, val: 8, label: 'Rounds' }],
    reset(t) { t.s = { pts: 0, done: false, since: 0, cur: null, gain: 0, hist: [], gs: null, g0: null, gx: 1 }; PM.phase = 'idle'; PM.round = 0; },
    onStart() { PM.round = 0; PM.last = ''; this.nextRound(performance.now()); },
    nextRound(now) {
      PM.round++; let id; do { id = POSES[(Math.random() * POSES.length) | 0].id; } while (id === PM.last); PM.last = PM.target = id;
      PM.phase = 'intro'; PM.at = now; PM.len = 1600; H.teams.forEach(t => { Object.assign(t.s, { done: false, since: 0, gain: 0 }); }); H.beep(700, 120); H.pushAll();
    },
    tick(now) {
      if (H.st !== 'running') return;
      const e = now - PM.at;
      if (PM.phase === 'intro' && e >= PM.len) { PM.phase = 'go'; PM.at = now; PM.len = 9000; H.beep(900, 200, .15); H.pushAll(); }
      else if (PM.phase === 'go' && (e >= PM.len || H.teams.every(t => t.s.done))) {
        H.teams.forEach(t => t.s.hist.push(t.s.gain)); PM.phase = 'result'; PM.at = now; PM.len = 2300; H.beep(520, 200); H.pushAll();
      } else if (PM.phase === 'result' && e >= PM.len) {
        if (PM.round >= H.set.rounds) { PM.phase = 'done'; H.finish(false); } else this.nextRound(now);
      }
    },
    onFrame(t, f, d, dt, now) {
      tiltFrame(t, f); const s = t.s; if (!s.gs) return;
      s.cur = poseOf(s.gs); s.gx = f.gx;
      if (H.st !== 'running' || PM.phase !== 'go' || s.done) return;
      const still = f.gx < 1.35 && f.gn > .7;
      if (s.cur === PM.target && still) {
        if (!s.since) s.since = now;
        else if (now - s.since >= 800) {                              // matched and held: quicker = more points
          s.done = true; s.gain = Math.max(1, Math.round(10 * (1 - (now - PM.at) / PM.len))); s.pts += s.gain; H.beep(1000, 150, .12); H.log(t, `✓ ${POSES.find(p => p.id === PM.target).short} (+${s.gain})`);
        }
      } else s.since = 0;
    },
    score: t => t.s.pts, scoreText: t => t.s.pts + ' pts',
    sub: t => t.s.hist.length ? 'Rounds: ' + t.s.hist.map(x => x || '✗').join(' · ') : 'Match the pose, then hold still',
    clock(now) {
      const R = `Round ${PM.round}/${H.set.rounds}`;
      if (H.st === 'finished') return { big: 'GAME OVER', sub: '', mood: '' };
      if (H.st !== 'running') return null;
      const p = POSES.find(x => x.id === PM.target);
      if (PM.phase === 'intro') return { big: 'GET READY…', sub: R, mood: 'ice' };
      if (PM.phase === 'go') return { big: p.short.toUpperCase(), sub: `${p.say} · ${Math.max(0, Math.ceil((PM.len - (now - PM.at)) / 1000))} s`, mood: 'go' };
      return { big: 'Results', sub: R, mood: '' };
    },
    phone(t) {
      const s = t.s, p = POSES.find(x => x.id === PM.target);
      if (PM.phase === 'go') return s.done ? { big: '✅', sub: `+${s.gain}`, bg: '#14301f' } : { big: p.short, sub: p.say, meter: s.since ? clamp((performance.now() - s.since) / 800, 0, 1) : 0 };
      if (PM.phase === 'intro') return { big: '👀', sub: 'Get ready…' };
      return { big: PM.phase === 'result' ? (s.gain ? '+' + s.gain : '–') : '🗿', sub: `${s.pts} points`, bg: null };
    },
    ...zeroBtn,
    draw(t, c, w, h, now, dt) {
      const s = t.s, p = POSES.find(x => x.id === PM.target), go = PM.phase === 'go';
      bg(c, w, h, '#0f2a2e', '#0a1618');
      if (H.st === 'idle' || PM.phase === 'idle') { txt(c, 'Ready — press Start', w / 2, h / 2 + 5, 16, '#cfd6e6'); return; }
      const lx = w * .27, rx = w * .73, cy = 86;
      txt(c, 'COPY THIS', lx, 22, 11, '#7fe3d4', 'center', 800); txt(c, 'YOU', rx, 22, 11, '#9fb3b6', 'center', 800);
      phoneIcon(c, lx, cy, PM.target, 56, '#7fe3d4'); txt(c, p.short, lx, 150, 15, '#fff');
      const match = s.cur === PM.target, col = s.done ? '#4cd37b' : match ? '#ffd166' : '#6b7a7d';
      phoneIcon(c, rx, cy, s.cur || 'up', 56, col);
      if (!s.cur) txt(c, '…', rx, cy + 10, 30, '#6b7a7d');
      if (go && !s.done && s.since) { const f = clamp((now - s.since) / 800, 0, 1); c.strokeStyle = '#ffd166'; c.lineWidth = 5; c.beginPath(); c.arc(rx, cy, 50, -Math.PI / 2, -Math.PI / 2 + TAU * f); c.stroke(); }
      if (s.done) { txt(c, `✓ +${s.gain}`, rx, 150, 20, '#4cd37b', 'center', 800); c.strokeStyle = '#4cd37b'; c.lineWidth = 5; c.beginPath(); c.arc(rx, cy, 50, 0, TAU); c.stroke(); }
      else if (PM.phase === 'result') txt(c, '✗ missed', rx, 150, 16, '#ff6b6b', 'center', 800);
      else txt(c, match ? 'hold still…' : s.cur ? 'not yet' : '', rx, 150, 14, col);
      if (PM.phase === 'intro') { c.fillStyle = 'rgba(0,0,0,.4)'; c.fillRect(0, 0, w, h); txt(c, 'GET READY', w / 2, h / 2 + 8, 28, '#fff', 'center', 800); }
    }
  };
  GAMES.flap.debug = () => FL; GAMES.simon.debug = () => SIM; GAMES.pose.debug = () => ({ PM, POSES, poseOf });

  window.GAMES = GAMES;
})();
