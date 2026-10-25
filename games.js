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
    how: 'Lay the phone flat on a tray. Start at 1000 points: wobbles and tilting drain them, and tipping past the spill angle (adjust it with the sensitivity sliders) is a spill (−50). Press Finished when a team completes the course. Highest score wins, fastest time breaks ties.',
    settings: [],
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
      { k: 'rounds', type: 'number', min: 1, max: 12, val: 5, label: 'Rounds' },
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
    settings: [{ k: 'rounds', type: 'number', min: 1, max: 10, val: 3, label: 'Rounds' }], sens: AIR_SENS,
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

  window.GAMES = GAMES;
})();
