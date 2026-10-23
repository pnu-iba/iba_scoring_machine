// 블록깨기. 방향키로 패들을 움직이고, 블록을 모두 깨면 공이 빨라진 다음 스테이지로 넘어간다.
(function () {
  const W = 640, H = 480;
  const COLS = 10, PAD = 24, GAP = 6, TOP = 64, BRICK_H = 18;
  const BRICK_W = (W - PAD * 2 - GAP * (COLS - 1)) / COLS;
  const ROW_COLORS = ["#ef6b6b", "#f29b4c", "#f2c94c", "#4cc38a", "#3ec7e0", "#4f7df0", "#9b7cf0"];
  const PADDLE_W = 80, PADDLE_WIDE = 128, PADDLE_H = 12, PADDLE_Y = H - 36, PADDLE_SPEED = 400;
  const BALL_R = 7, START_SPEED = 400, SPEED_UP = 1.18, MAX_SPEED = 800;
  // 패들에 맞은 공이 세로축에서 기우는 각도의 최대·최소. 최소가 있어 공이 수직으로만 오가지 않는다.
  const MAX_BOUNCE = Math.PI / 3, MIN_BOUNCE = 0.12;
  const MAX_BALLS = 8, SCORE_MAX = 999999, RESTART_DELAY = 800;
  const BEST_KEY = "iba.best.blocks";

  // 스테이지 배치. 숫자는 깨는 데 필요한 타격 수, 점은 빈칸이다. 차례로 돌아가며 쓴다.
  const LAYOUTS = [
    ["2222222222", "1111111111", "1111111111", "1111111111", "1111111111", "1111111111"],
    ["....33....", "...2222...", "..111111..", ".11111111.", "1111111111", "1111111111"],
    ["2.2.2.2.2.", ".2.2.2.2.2", "1.1.1.1.1.", ".1.1.1.1.1", "1.1.1.1.1.", ".1.1.1.1.1"],
    ["....11....", "...1221...", "..123321..", ".12333321.", "..123321..", "...1221...", "....11...."],
    ["3333333333", "2........2", "2.111111.2", "2.1....1.2", "2.111111.2", "2........2", "1111111111"],
  ];

  // 블록이 깨질 때 가끔 캡슐이 떨어지고, 패들로 받으면 효과가 난다. time은 효과가 이어지는 초.
  const POWERS = {
    wide: { label: "넓게", color: "#4cc38a", time: 12 },
    multi: { label: "공 ×3", color: "#f2c94c" },
    slow: { label: "느리게", color: "#3ec7e0", time: 10 },
  };
  const POWER_TYPES = Object.keys(POWERS);
  const DROP_CHANCE = 0.08, DROP_SPEED = 150, DROP_W = 48, DROP_H = 16;

  const $ = (id) => document.getElementById(id);
  const cv = $("board"), ctx = cv.getContext("2d");
  const overlay = $("overlay");
  const stageBox = cv.parentElement;

  let bricks, balls, drops, particles, popups, effects;
  let paddleX, paddleW, speed, stage, score, combo, banner;
  let state = "ready", last = 0, overAt = 0, dpr = 0;
  const held = { left: false, right: false };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const comboMult = () => Math.min(4, 1 + Math.floor(combo / 4));

  function readBest() { try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch (_) { return 0; } }
  function saveBest(v) { try { localStorage.setItem(BEST_KEY, String(v)); } catch (_) {} }

  // 고해상도 화면에서 흐려지지 않도록 캔버스 픽셀 수를 화면 배율에 맞춘다. 그리는 좌표는 그대로 640×480이다.
  function fitCanvas() {
    dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.width = W + "px";
    cv.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function buildBricks() {
    bricks = [];
    LAYOUTS[(stage - 1) % LAYOUTS.length].forEach((line, r) => {
      [...line].forEach((ch, c) => {
        const hp = Number(ch);
        if (hp) bricks.push({ x: PAD + c * (BRICK_W + GAP), y: TOP + r * (BRICK_H + GAP), row: r, hp, maxHp: hp, flash: 0 });
      });
    });
  }

  // 공 하나를 패들 위에 올려 두고 떨어지던 캡슐과 효과를 지운다. 스테이지를 시작할 때 부른다.
  function serve() {
    balls = [{ x: paddleX, y: PADDLE_Y - BALL_R, dx: 0, dy: -1, stuck: true }];
    drops = [];
    effects = { wide: 0, slow: 0 };
    combo = 0;
  }

  // angle은 세로축에서 기운 각도, sy는 위(-1)·아래(1) 방향이다. dx, dy는 길이 1인 방향 벡터다.
  function aim(b, angle, sy) {
    b.dx = Math.sin(angle);
    b.dy = sy * Math.cos(angle);
  }

  function launch() {
    if (state !== "playing") return;
    const b = balls.find((ball) => ball.stuck);
    if (!b) return;
    aim(b, (Math.random() < 0.5 ? -1 : 1) * (0.15 + Math.random() * 0.3), -1);
    b.stuck = false;
    banner = 0;
  }

  // 원과 사각형이 겹치는지
  function overlaps(b, x, y, w, h) {
    const cx = clamp(b.x, x, x + w);
    const cy = clamp(b.y, y, y + h);
    return (b.x - cx) ** 2 + (b.y - cy) ** 2 <= BALL_R ** 2;
  }

  // 공과 겹친 블록 중 가장 가까운 하나를 친다. 틈새에 걸쳐 맞아도 한 번에 하나만 깨진다.
  function hitBrick(b) {
    let hit = null, best = Infinity;
    for (const k of bricks) {
      if (!overlaps(b, k.x, k.y, BRICK_W, BRICK_H)) continue;
      const d = Math.abs(k.x + BRICK_W / 2 - b.x) + Math.abs(k.y + BRICK_H / 2 - b.y);
      if (d < best) { best = d; hit = k; }
    }
    if (hit) damage(hit);
    return hit;
  }

  function damage(k) {
    k.hp -= 1;
    k.flash = 0.12;
    if (k.hp > 0) return;
    bricks.splice(bricks.indexOf(k), 1);
    combo += 1;
    // 위쪽 줄일수록, 여러 번 맞혀야 하는 블록일수록, 패들에 닿지 않고 이어 깰수록 점수가 크다.
    const gained = (8 - k.row) * 10 * k.maxHp * comboMult();
    addScore(gained);
    burst(k);
    popups.push({ x: k.x + BRICK_W / 2, y: k.y + BRICK_H / 2, text: `+${gained}`, color: "#ffffff", life: 0.7 });
    if (Math.random() < DROP_CHANCE) {
      drops.push({ x: k.x + BRICK_W / 2, y: k.y + BRICK_H / 2, type: POWER_TYPES[Math.floor(Math.random() * POWER_TYPES.length)] });
    }
  }

  function addScore(n) {
    score = Math.min(SCORE_MAX, score + n);
    updateStats();
  }

  function burst(k) {
    const color = ROW_COLORS[k.row % ROW_COLORS.length];
    for (let i = 0; i < 12; i++) {
      particles.push({
        x: k.x + Math.random() * BRICK_W, y: k.y + Math.random() * BRICK_H,
        vx: (Math.random() - 0.5) * 240, vy: (Math.random() - 0.7) * 200, life: 0.6, color,
      });
    }
    if (particles.length > 400) particles.splice(0, particles.length - 400);
  }

  function power(type) {
    const p = POWERS[type];
    popups.push({ x: paddleX, y: PADDLE_Y - 18, text: p.label, color: p.color, life: 0.9 });
    if (p.time) { effects[type] = p.time; return; }
    // 공 ×3: 움직이는 공마다 양옆으로 기운 공 두 개를 더한다.
    const extra = [];
    for (const b of balls) {
      if (b.stuck) continue;
      const a = Math.atan2(b.dx, Math.abs(b.dy)), sy = b.dy < 0 ? -1 : 1;
      for (const d of [-0.4, 0.4]) {
        if (balls.length + extra.length >= MAX_BALLS) break;
        const nb = { x: b.x, y: b.y, stuck: false };
        aim(nb, clamp(a + d, -MAX_BOUNCE, MAX_BOUNCE), sy);
        extra.push(nb);
      }
    }
    balls.push(...extra);
  }

  // --- 움직임 -----------------------------------------------------------------

  function step(dt) {
    if (held.left) paddleX -= PADDLE_SPEED * dt;
    if (held.right) paddleX += PADDLE_SPEED * dt;
    const target = effects.wide > 0 ? PADDLE_WIDE : PADDLE_W;
    paddleW += clamp(target - paddleW, -240 * dt, 240 * dt);
    paddleX = clamp(paddleX, paddleW / 2, W - paddleW / 2);
    effects.wide = Math.max(0, effects.wide - dt);
    effects.slow = Math.max(0, effects.slow - dt);
    banner = Math.max(0, banner - dt);

    // 한 프레임을 4px 이하 조각으로 나눠 움직여 빠른 공도 블록을 뚫고 지나가지 않게 한다.
    const dist = speed * (effects.slow > 0 ? 0.7 : 1) * dt;
    const n = Math.max(1, Math.ceil(dist / 4));
    for (const b of balls) {
      if (b.stuck) { b.x = paddleX; b.y = PADDLE_Y - BALL_R; continue; }
      for (let i = 0; i < n && !b.out; i++) moveBall(b, dist / n);
    }
    balls = balls.filter((b) => !b.out);

    for (const d of drops) {
      d.y += DROP_SPEED * dt;
      if (d.y + DROP_H / 2 >= PADDLE_Y && d.y - DROP_H / 2 <= PADDLE_Y + PADDLE_H
          && Math.abs(d.x - paddleX) <= (paddleW + DROP_W) / 2) {
        d.got = true;
        power(d.type);
      }
    }
    drops = drops.filter((d) => !d.got && d.y < H + DROP_H);

    for (const k of bricks) k.flash = Math.max(0, k.flash - dt);
    for (const p of particles) { p.vy += 500 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    particles = particles.filter((p) => p.life > 0);
    for (const p of popups) { p.y -= 30 * dt; p.life -= dt; }
    popups = popups.filter((p) => p.life > 0);

    // 마지막 블록을 깬 프레임에 공이 떨어져도 스테이지를 깬 것으로 본다. 공을 모두 놓치면 바로 끝난다.
    if (!bricks.length) nextStage();
    else if (!balls.length) gameOver();
  }

  // 가로와 세로를 따로 움직여 부딪힌 면을 가린다. 모서리에 맞으면 두 방향이 모두 꺾인다.
  // 부딪히면 그 축의 이동을 되돌리므로 공은 조각이 끝날 때마다 블록 밖에 있다.
  function moveBall(b, d) {
    b.x += b.dx * d;
    if (b.x < BALL_R) { b.x = BALL_R; b.dx = Math.abs(b.dx); }
    else if (b.x > W - BALL_R) { b.x = W - BALL_R; b.dx = -Math.abs(b.dx); }
    else if (hitBrick(b)) { b.x -= b.dx * d; b.dx = -b.dx; }

    b.y += b.dy * d;
    if (b.y < BALL_R) { b.y = BALL_R; b.dy = Math.abs(b.dy); }
    else if (hitBrick(b)) { b.y -= b.dy * d; b.dy = -b.dy; }

    // 패들 윗면에 맞았을 때만 튕긴다. 공 중심이 이미 패들 가운데보다 내려갔으면 옆으로 흘려보낸다.
    const left = paddleX - paddleW / 2;
    if (b.dy > 0 && b.y <= PADDLE_Y + PADDLE_H / 2 && overlaps(b, left, PADDLE_Y, paddleW, PADDLE_H)) {
      let angle = clamp((b.x - paddleX) / (paddleW / 2), -1, 1) * MAX_BOUNCE;
      if (Math.abs(angle) < MIN_BOUNCE) angle = (angle < 0 ? -1 : 1) * MIN_BOUNCE;
      aim(b, angle, -1);
      b.y = PADDLE_Y - BALL_R;
      combo = 0;
    }

    if (b.y > H + BALL_R) b.out = true;
  }

  function nextStage() {
    addScore(300 * stage);
    stage += 1;
    speed = Math.min(speed * SPEED_UP, MAX_SPEED);
    buildBricks();
    serve();
    banner = 1.6;
    updateStats();
  }

  // --- 그리기 -----------------------------------------------------------------

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
    ctx.fill();
  }

  function text(str, x, y, font, color, align) {
    ctx.font = `${font} "Noto Sans KR", sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = align || "center";
    ctx.textBaseline = "middle";
    ctx.fillText(str, x, y);
  }

  function drawBrick(k) {
    ctx.fillStyle = ROW_COLORS[k.row % ROW_COLORS.length];
    roundRect(k.x, k.y, BRICK_W, BRICK_H, 4);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(k.x + 2, k.y + 2, BRICK_W - 4, 4);
    // 여러 번 맞혀야 하는 블록은 남은 타격 수만큼 점을 찍는다.
    if (k.hp > 1) {
      ctx.fillStyle = "rgba(11,26,46,0.75)";
      for (let i = 0; i < k.hp; i++) {
        ctx.beginPath();
        ctx.arc(k.x + BRICK_W / 2 + (i - (k.hp - 1) / 2) * 9, k.y + BRICK_H / 2 + 1, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (k.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${(k.flash / 0.12) * 0.7})`;
      roundRect(k.x, k.y, BRICK_W, BRICK_H, 4);
    }
  }

  function drawHud() {
    if (comboMult() > 1) text(`콤보 ×${comboMult()}`, W / 2, 30, "700 13px", "#f2c94c");
    // 이어지는 효과는 오른쪽 위에 남은 시간 막대로 보여 준다.
    let x = W - PAD;
    for (const type of ["slow", "wide"]) {
      if (effects[type] <= 0) continue;
      const p = POWERS[type];
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(x - 56, 26, 56, 8);
      ctx.fillStyle = p.color;
      ctx.fillRect(x - 56, 26, 56 * (effects[type] / p.time), 8);
      text(p.label, x - 62, 30, "600 12px", p.color, "right");
      x -= 62 + ctx.measureText(p.label).width + 16;
    }
  }

  function draw() {
    ctx.fillStyle = "#0b1a2e";
    ctx.fillRect(0, 0, W, H);
    drawHud();
    bricks.forEach(drawBrick);

    for (const d of drops) {
      const p = POWERS[d.type];
      ctx.fillStyle = p.color;
      roundRect(d.x - DROP_W / 2, d.y - DROP_H / 2, DROP_W, DROP_H, DROP_H / 2);
      text(p.label, d.x, d.y + 1, "700 11px", "#0b1a2e");
    }

    for (const p of particles) {
      ctx.globalAlpha = p.life / 0.6;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = effects.wide > 0 ? "#bff0d8" : "#e8eefc";
    roundRect(paddleX - paddleW / 2, PADDLE_Y, paddleW, PADDLE_H, 6);

    ctx.fillStyle = effects.slow > 0 ? "#bfefff" : "#ffffff";
    for (const b of balls) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const p of popups) {
      ctx.globalAlpha = Math.min(1, p.life / 0.4);
      text(p.text, p.x, p.y, "700 12px", p.color);
    }
    ctx.globalAlpha = 1;

    if (state === "playing" && banner > 0) text(`스테이지 ${stage}`, W / 2, H / 2 + 4, "700 26px", "#ffffff");
    if (state === "playing" && balls.some((b) => b.stuck)) {
      text("스페이스로 공을 쏘세요", W / 2, H / 2 + 40, "600 14px", "rgba(255,255,255,0.7)");
    }
  }

  // --- 진행 -------------------------------------------------------------------

  function updateStats() {
    $("score").textContent = score.toLocaleString("ko-KR");
    $("stage").textContent = stage;
    $("best").textContent = Math.max(readBest(), score).toLocaleString("ko-KR");
  }

  function setState(s) {
    state = s;
    stageBox.classList.toggle("playing", s === "playing");
  }

  function showOverlay(title, body, button, onClick) {
    overlay.innerHTML = `<div class="big">${title}</div><div class="small">${body}</div>${button ? `<button type="button" class="primary" id="startBtn">${button}</button>` : ""}`;
    overlay.hidden = false;
    const btn = $("startBtn");
    if (btn) btn.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  }

  function reset() {
    score = 0; stage = 1; speed = START_SPEED;
    paddleX = W / 2; paddleW = PADDLE_W;
    particles = []; popups = [];
    buildBricks();
    serve();
    banner = 1.6;
  }

  function start() {
    reset();
    setState("playing");
    overlay.hidden = true;
    updateStats();
    draw();
  }

  // 게임이 끝난 직전에 공을 쏘려고 누른 스페이스가 곧바로 새 게임을 시작하지 않게 잠시 막는다.
  function restart() {
    if (performance.now() - overAt > RESTART_DELAY) start();
  }

  function gameOver() {
    setState("over");
    overAt = performance.now();
    const best = readBest();
    if (score > best) saveBest(score);
    updateStats();
    draw();
    showOverlay("게임 오버", `${score.toLocaleString("ko-KR")}점 · ${stage}스테이지${score > best ? " · 최고 기록!" : ""}`, "다시 하기", restart);
    window.IBA.reportScore("blocks", score, overlay);
  }

  function setPaused(paused) {
    if (paused && state === "playing") {
      setState("paused");
      showOverlay("일시정지", "P 키나 스페이스를 누르면 이어서 합니다.", "이어 하기", () => setPaused(false));
    } else if (!paused && state === "paused") {
      setState("playing");
      overlay.hidden = true;
    }
  }

  // 화면이 멈춰 있어도 루프는 하나만 계속 돈다. 시작·재개를 여러 번 눌러도 루프가 겹치지 않는다.
  function frame(t) {
    requestAnimationFrame(frame);
    if (dpr !== (window.devicePixelRatio || 1)) { fitCanvas(); draw(); }
    // 주사율과 상관없이 같은 속도로 움직이도록 경과 시간으로 계산한다. 탭 전환 뒤 한꺼번에 튀지 않게 상한을 둔다.
    const dt = clamp((t - last) / 1000, 0, 1 / 30);
    last = t;
    if (state !== "playing") return;
    step(dt);
    if (state === "playing") draw();
  }

  const KEYS = { ArrowLeft: "left", ArrowRight: "right" };
  document.addEventListener("keydown", (e) => {
    if (state === "ready" || state === "over") {
      if (e.code === "Space" || e.code === "Enter" || (state === "over" && e.code === "KeyR")) {
        e.preventDefault();
        if (e.repeat) return;
        if (state === "ready") start(); else restart();
      }
      return;
    }
    if (KEYS[e.code]) { e.preventDefault(); held[KEYS[e.code]] = true; return; }
    if (e.code === "Space") e.preventDefault();
    if (e.repeat) return;
    if (e.code === "KeyP") setPaused(state === "playing");
    else if (e.code === "KeyR") start();
    else if (e.code === "Space") { if (state === "paused") setPaused(false); else launch(); }
  });
  document.addEventListener("keyup", (e) => { if (KEYS[e.code]) held[KEYS[e.code]] = false; });

  document.addEventListener("visibilitychange", () => { if (document.hidden) setPaused(true); });
  // 창이 포커스를 잃으면 keyup이 오지 않으므로 눌린 키를 풀고 멈춘다.
  window.addEventListener("blur", () => {
    held.left = held.right = false;
    setPaused(true);
  });

  document.addEventListener("DOMContentLoaded", () => {
    fitCanvas();
    reset();
    banner = 0;
    updateStats();
    draw();
    showOverlay("블록깨기", "공을 튕겨 블록을 모두 깨세요. 공을 놓치면 바로 끝납니다.", "시작하기", start);
    window.IBA.gameBoard("blocks");
    requestAnimationFrame((t) => { last = t; frame(t); });
  });
})();
