// 슈팅게임. 방향키로 비행기를 움직이면 총알은 저절로 나간다. 시간이 지날수록 적이 많아지고 탄이 빨라진다.
(function () {
  const W = 480, H = 640;
  // HIT_R는 비행기 가운데 빨간 점, BULLET_R은 적 탄의 반지름이다. 판정은 그려진 크기와 같다.
  const PLAYER_SPEED = 300, HIT_R = 3, BULLET_R = 5, PICK_R = 18, MARGIN = 16;
  const FIRE_INTERVAL = 0.11, SHOT_SPEED = 760, SHOT_W = 3, SHOT_H = 12;
  const SCORE_MAX = 9999999, RESTART_DELAY = 800;
  const LEVEL_TIME = 20;  // 이 초마다 단계가 오른다
  const BEST_KEY = "iba.best.shooter";
  const STAR_COLORS = ["rgba(232,238,252,0.25)", "rgba(232,238,252,0.5)", "rgba(232,238,252,0.75)"];

  // 화력 단계별 탄 배치. [가로 위치, 기울기(라디안)]
  const SHOTS = [
    [[0, 0]],
    [[-6, 0], [6, 0]],
    [[0, 0], [-10, -0.12], [10, 0.12]],
    [[-5, 0], [5, 0], [-12, -0.14], [12, 0.14]],
    [[0, 0], [-8, 0], [8, 0], [-14, -0.22], [14, 0.22]],
  ];

  // r은 충돌 반지름, drop은 격추했을 때 캡슐이 떨어질 확률이다.
  const ENEMIES = {
    scout: { r: 13, hp: 1, score: 100, color: "#ef6b6b", drop: 0.02 },
    weaver: { r: 14, hp: 3, score: 200, color: "#f2c94c", drop: 0.05 },
    gunner: { r: 17, hp: 7, score: 450, color: "#3ec7e0", drop: 0.12 },
    heavy: { r: 30, hp: 90, score: 2000, color: "#9b7cf0", drop: 1 },
  };

  const POWERS = {
    power: { label: "P", name: "화력", color: "#f29b4c" },
    shield: { label: "S", name: "보호막", color: "#4cc38a" },
  };

  const $ = (id) => document.getElementById(id);
  const cv = $("board"), ctx = cv.getContext("2d");
  const overlay = $("overlay");
  const stageBox = cv.parentElement;

  let player, shots, enemies, bullets, drops, particles, popups, stars;
  let score, level, elapsed, nextWave, fireCool, banner;
  let state = "ready", last = 0, overAt = 0, dpr = 0;
  const held = { left: false, right: false, up: false, down: false };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const near = (ax, ay, bx, by, r) => (ax - bx) ** 2 + (ay - by) ** 2 < r * r;
  const bulletSpeed = () => Math.min(190 + level * 18, 420);

  function readBest() { try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch (_) { return 0; } }
  function saveBest(v) { try { localStorage.setItem(BEST_KEY, String(v)); } catch (_) {} }

  // 고해상도 화면에서 흐려지지 않도록 캔버스 픽셀 수를 화면 배율에 맞춘다. 그리는 좌표는 그대로 480×640이다.
  // 화면(또는 미니게임 창)이 낮으면 게임 화면이 한눈에 들어오도록 보이는 크기를 비율 그대로 줄인다.
  function displayScale() {
    const embedded = window.parent !== window;
    const screenH = embedded ? window.parent.innerHeight - 16 * 2 - 36 : window.innerHeight;   // 창 위아래 여백과 제목줄
    const room = screenH - cv.getBoundingClientRect().top - window.scrollY - 24;
    return Math.max(360, Math.min(H, Math.floor(room))) / H;
  }
  function fitCanvas() {
    dpr = window.devicePixelRatio || 1;
    const s = displayScale();
    cv.width = Math.round(W * s * dpr);
    cv.height = Math.round(H * s * dpr);
    cv.style.width = Math.round(W * s) + "px";
    cv.style.height = Math.round(H * s) + "px";
    ctx.setTransform(dpr * s, 0, 0, dpr * s, 0, 0);
  }

  function makeStars() {
    stars = Array.from({ length: 90 }, (_, i) => ({ x: rand(0, W), y: rand(0, H), layer: i % 3 }));
  }

  // --- 적 등장 ----------------------------------------------------------------

  // delay초 뒤에 나타나는 적을 하나 만든다. move는 매 프레임 위치를 바꾸는 함수다.
  function spawn(type, x, y, delay, move, extra) {
    const def = ENEMIES[type];
    enemies.push({ type, x, y, x0: x, t: 0, delay, hp: def.hp, flash: 0, fireCool: rand(0.6, 1.4), move, ...extra });
  }

  const fallStraight = (vy) => (e, dt) => { e.y += vy * dt; };
  const fallWeave = (vy, amp, freq) => (e) => { e.x = e.x0 + Math.sin(e.t * freq + e.phase) * amp; e.y = -20 + e.t * vy; };
  // 정해진 높이까지 내려와 stay초 머문 다음 아래로 빠져나간다.
  const hover = (stopY, stay) => (e, dt) => {
    if (e.t < stay + 1) e.y += (stopY - e.y) * Math.min(1, dt * 2.2);
    else e.y += 90 * dt;
    e.x = e.x0 + Math.sin(e.t * 0.8) * 30;
  };

  const WAVES = [
    { min: 0, weight: 3, run() {  // 한 줄로 내려오는 정찰기
      const x = rand(60, W - 60), vy = 170 + level * 12;
      for (let i = 0; i < 5; i++) spawn("scout", x, -20, i * 0.28, fallStraight(vy));
    } },
    { min: 0, weight: 3, run() {  // V자 편대
      const cx = rand(120, W - 120), vy = 140 + level * 10;
      for (let i = -2; i <= 2; i++) spawn("scout", cx + i * 34, -20 - Math.abs(i) * 30, 0, fallStraight(vy));
    } },
    { min: 0, weight: 2, run() {  // 좌우로 흔들며 내려오는 줄
      const x = rand(110, W - 110), vy = 100 + level * 6;
      for (let i = 0; i < 4; i++) spawn("weaver", x, -20, i * 0.45, fallWeave(vy, 80, 2.2), { phase: 0 });
    } },
    { min: 2, weight: 2, run() {  // 멈춰서 조준 사격하는 포대. 화면을 n칸으로 나눠 한 칸에 하나씩 둔다.
      const n = level >= 7 ? 3 : level >= 4 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const x = clamp((W / n) * (i + rand(0.2, 0.8)), 70, W - 70);
        spawn("gunner", x, -24, i * 0.5, hover(rand(110, 200), 6));
      }
    } },
    { min: 3, weight: 1, run() {  // 대형기. 한 번에 한 대만 나온다.
      if (enemies.some((e) => e.type === "heavy")) return false;
      spawn("heavy", W / 2, -40, 0, hover(130, 13));
    } },
  ];

  function launchWave() {
    const open = WAVES.filter((w) => level >= w.min);
    let r = Math.random() * open.reduce((s, w) => s + w.weight, 0);
    const wave = open.find((w) => (r -= w.weight) < 0) || open[0];
    if (wave.run() === false) WAVES[0].run();
  }

  // --- 사격 -------------------------------------------------------------------

  function enemyShot(x, y, angle, speed) {
    bullets.push({ x, y, vx: Math.sin(angle) * speed, vy: Math.cos(angle) * speed });
  }

  // 플레이어를 겨눈 각도. 아래쪽이 0이고 오른쪽이 양수다.
  const aimAt = (e) => Math.atan2(player.x - e.x, player.y - e.y);

  function enemyFire(e, dt) {
    if (e.y < 10 || e.y > H * 0.7) return;
    e.fireCool -= dt;
    if (e.fireCool > 0) return;
    const s = bulletSpeed();
    if (e.type === "scout") {
      e.fireCool = Infinity;  // 정찰기는 한 발만 쏜다
      if (level >= 3 && Math.random() < 0.25) enemyShot(e.x, e.y, aimAt(e), s);
    } else if (e.type === "weaver") {
      e.fireCool = rand(2, 3.2);
      if (level >= 2) enemyShot(e.x, e.y, 0, s * 0.9);
    } else if (e.type === "gunner") {
      e.fireCool = Math.max(0.9, 1.6 - level * 0.08);
      const a = aimAt(e);
      for (const d of [-0.18, 0, 0.18]) enemyShot(e.x, e.y + 8, a + d, s);
    } else if (e.type === "heavy") {
      e.fireCool = 1.3;
      e.volley = (e.volley || 0) + 1;
      if (e.volley % 2) {
        // 둥근 고리. 쏠 때마다 조금씩 돌아가 틈의 위치가 바뀐다.
        const n = 14 + Math.min(level, 10), off = e.volley * 0.19;
        for (let i = 0; i < n; i++) enemyShot(e.x, e.y, off + (i / n) * Math.PI * 2, s * 0.75);
      } else {
        const a = aimAt(e);
        for (let i = -2; i <= 2; i++) enemyShot(e.x, e.y + 16, a + i * 0.16, s);
      }
    }
  }

  function playerFire() {
    for (const [dx, a] of SHOTS[player.power - 1]) {
      shots.push({ x: player.x + dx, y: player.y - 14, vx: Math.sin(a) * SHOT_SPEED, vy: -Math.cos(a) * SHOT_SPEED });
    }
  }

  // --- 맞았을 때 ----------------------------------------------------------------

  function hitEnemy(e, dmg) {
    e.hp -= dmg;
    e.flash = 0.06;
    if (e.hp > 0) return;
    const def = ENEMIES[e.type];
    e.dead = true;
    addScore(def.score);
    burst(e.x, e.y, def.color, e.type === "heavy" ? 60 : 16);
    popups.push({ x: e.x, y: e.y, text: `+${def.score}`, color: "#ffffff", life: 0.7 });
    if (Math.random() < def.drop) dropPower(e);
  }

  // 대형기는 늘 화력 캡슐을 떨어뜨린다. 화력이 가득 찬 뒤의 화력 캡슐은 점수로 바뀐다.
  function dropPower(e) {
    const type = e.type !== "heavy" && Math.random() < 0.3 ? "shield" : "power";
    drops.push({ x: e.x, y: e.y, t: 0, type });
  }

  function takePower(type) {
    const p = POWERS[type];
    let label = p.name;
    if (type === "power") {
      if (player.power < SHOTS.length) player.power += 1;
      else { addScore(500); label = "+500"; }
    } else {
      if (player.shield) { addScore(500); label = "+500"; }
      player.shield = true;
    }
    popups.push({ x: player.x, y: player.y - 26, text: label, color: p.color, life: 0.9 });
    updateStats();
  }

  function hitPlayer() {
    if (player.invuln > 0) return;
    burst(player.x, player.y, "#e8eefc", 14);
    // 맞으면 화면의 적 탄을 지워서 보호막이 깨지자마자 또 맞지 않게 한다. 보호막이 없으면 바로 끝난다.
    bullets = [];
    if (player.shield) {
      player.shield = false;
      player.invuln = 1;
      return;
    }
    burst(player.x, player.y, "#f29b4c", 30);
    gameOver();
  }

  function addScore(n) {
    score = Math.min(SCORE_MAX, score + n);
    updateStats();
  }

  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), v = rand(40, 260);
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.3, 0.7), color });
    }
    if (particles.length > 500) particles.splice(0, particles.length - 500);
  }

  // --- 움직임 -----------------------------------------------------------------

  function movePlayer(dt) {
    const kx = held.right - held.left, ky = held.down - held.up;
    const k = kx && ky ? Math.SQRT1_2 : 1;
    player.x += kx * k * PLAYER_SPEED * dt;
    player.y += ky * k * PLAYER_SPEED * dt;
    player.x = clamp(player.x, MARGIN, W - MARGIN);
    player.y = clamp(player.y, MARGIN + 60, H - MARGIN);
  }

  function step(dt) {
    elapsed += dt;
    const lv = Math.floor(elapsed / LEVEL_TIME) + 1;
    if (lv !== level) { level = lv; banner = 1.6; updateStats(); }
    banner = Math.max(0, banner - dt);

    for (const s of stars) {
      s.y += (30 + s.layer * 45) * dt;
      if (s.y > H) { s.y -= H; s.x = rand(0, W); }
    }

    movePlayer(dt);
    player.invuln = Math.max(0, player.invuln - dt);
    fireCool -= dt;
    if (fireCool <= 0) { playerFire(); fireCool += FIRE_INTERVAL; }

    nextWave -= dt;
    if (nextWave <= 0) {
      launchWave();
      nextWave = Math.max(0.5, 2.4 - level * 0.22) * rand(0.8, 1.2);
    }

    for (const s of shots) { s.x += s.vx * dt; s.y += s.vy * dt; }
    shots = shots.filter((s) => s.y > -SHOT_H && s.x > -10 && s.x < W + 10);

    for (const e of enemies) {
      if (e.delay > 0) { e.delay -= dt; continue; }
      e.t += dt;
      e.move(e, dt);
      e.flash = Math.max(0, e.flash - dt);
      enemyFire(e, dt);
      // 대형기는 날개가 몸통보다 넓게 그려지므로 가로 판정을 넓힌다. 화면 위로 아직 들어오지 않은 적은 맞지 않는다.
      const r = ENEMIES[e.type].r, rx = e.type === "heavy" ? r * 1.3 : r;
      if (e.y > 0) {
        for (const s of shots) {
          if (!s.hit && Math.abs(s.x - e.x) < rx + SHOT_W && Math.abs(s.y - e.y) < r + SHOT_H / 2) {
            s.hit = true;
            hitEnemy(e, 1);
            if (e.dead) break;
          }
        }
      }
      // 몸통끼리 부딪히면 플레이어가 맞고, 대형기가 아닌 적은 부서진다.
      if (!e.dead && near(e.x, e.y, player.x, player.y, r + HIT_R)) {
        if (player.invuln <= 0 && e.type !== "heavy") hitEnemy(e, e.hp);
        hitPlayer();
        if (state !== "playing") return;
      }
      if (e.y > H + 50 || (e.t > 1 && (e.x < -60 || e.x > W + 60))) e.gone = true;
    }
    enemies = enemies.filter((e) => !e.dead && !e.gone);
    shots = shots.filter((s) => !s.hit);

    // 무적일 때는 판정을 건너뛰어 모든 탄이 멈추지 않고 지나가게 한다. 맞으면 hitPlayer가 탄을 모두 지운다.
    for (const b of bullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
    if (player.invuln <= 0 && bullets.some((b) => near(b.x, b.y, player.x, player.y, HIT_R + BULLET_R))) {
      hitPlayer();
      if (state !== "playing") return;
    }
    bullets = bullets.filter((b) => b.x > -10 && b.x < W + 10 && b.y > -10 && b.y < H + 10);

    for (const d of drops) {
      d.t += dt;
      d.y += 80 * dt;
      d.x += Math.sin(d.t * 2.5) * 30 * dt;
      if (near(d.x, d.y, player.x, player.y, PICK_R + 10)) { d.got = true; takePower(d.type); }
    }
    drops = drops.filter((d) => !d.got && d.y < H + 20);

    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; p.life -= dt; }
    particles = particles.filter((p) => p.life > 0);
    for (const p of popups) { p.y -= 30 * dt; p.life -= dt; }
    popups = popups.filter((p) => p.life > 0);
  }

  // --- 그리기 -----------------------------------------------------------------

  function text(str, x, y, font, color, align) {
    ctx.font = `${font} "Noto Sans KR", sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = align || "center";
    ctx.textBaseline = "middle";
    ctx.fillText(str, x, y);
  }

  function poly(points, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
  }

  function drawPlayer() {
    // 무적 시간에는 깜빡인다
    if (player.invuln > 0 && Math.floor(player.invuln * 12) % 2) return;
    const { x, y } = player;
    const flame = 6 + Math.random() * 6;
    poly([[x - 4, y + 12], [x + 4, y + 12], [x, y + 12 + flame]], "#f29b4c");
    poly([[x, y - 16], [x + 5, y - 4], [x + 16, y + 6], [x + 16, y + 10], [x + 5, y + 8], [x + 4, y + 13],
      [x - 4, y + 13], [x - 5, y + 8], [x - 16, y + 10], [x - 16, y + 6], [x - 5, y - 4]], "#e8eefc");
    poly([[x, y - 9], [x + 3, y - 2], [x - 3, y - 2]], "#4f7df0");
    // 실제로 맞는 판정 범위는 가운데 작은 점이다
    ctx.fillStyle = "#ef6b6b";
    ctx.beginPath();
    ctx.arc(x, y, HIT_R, 0, Math.PI * 2);
    ctx.fill();
    if (player.shield) {
      ctx.strokeStyle = "rgba(76,195,138,0.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 24, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawEnemy(e) {
    const def = ENEMIES[e.type], { x, y } = e, r = def.r;
    const color = e.flash > 0 ? "#ffffff" : def.color;
    if (e.type === "scout") {
      poly([[x, y + r], [x + r, y - r * 0.6], [x + r * 0.35, y - r * 0.3], [x, y - r * 0.8], [x - r * 0.35, y - r * 0.3], [x - r, y - r * 0.6]], color);
    } else if (e.type === "weaver") {
      poly([[x, y - r], [x + r, y], [x, y + r], [x - r, y]], color);
      ctx.fillStyle = "#0b1a2e";
      ctx.fillRect(x - 3, y - 3, 6, 6);
    } else if (e.type === "gunner") {
      const pts = [];
      for (let i = 0; i < 6; i++) pts.push([x + Math.cos(i * Math.PI / 3) * r, y + Math.sin(i * Math.PI / 3) * r]);
      poly(pts, color);
      ctx.fillStyle = "#0b1a2e";
      ctx.beginPath();
      ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      poly([[x - r * 1.3, y - r * 0.2], [x - r * 0.5, y - r], [x + r * 0.5, y - r], [x + r * 1.3, y - r * 0.2],
        [x + r * 0.9, y + r * 0.6], [x + r * 0.3, y + r], [x - r * 0.3, y + r], [x - r * 0.9, y + r * 0.6]], color);
      ctx.fillStyle = "#0b1a2e";
      ctx.beginPath();
      ctx.arc(x, y, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
      // 대형기는 남은 체력 막대를 보여 준다
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fillRect(x - r, y - r - 12, r * 2, 4);
      ctx.fillStyle = def.color;
      ctx.fillRect(x - r, y - r - 12, r * 2 * (e.hp / def.hp), 4);
    }
  }

  function drawHud() {
    const barX = W - 16 - SHOTS.length * 12;
    text("화력", barX - 8, 22, "600 12px", "rgba(255,255,255,0.7)", "right");
    for (let i = 0; i < SHOTS.length; i++) {
      ctx.fillStyle = i < player.power ? "#f29b4c" : "rgba(255,255,255,0.15)";
      ctx.fillRect(barX + i * 12, 17, 9, 10);
    }
  }

  function draw() {
    ctx.fillStyle = "#0b1a2e";
    ctx.fillRect(0, 0, W, H);
    for (const s of stars) {
      ctx.fillStyle = STAR_COLORS[s.layer];
      ctx.fillRect(s.x, s.y, 1 + s.layer * 0.5, 1 + s.layer * 0.5);
    }

    ctx.fillStyle = "#f2c94c";
    for (const s of shots) ctx.fillRect(s.x - SHOT_W / 2, s.y - SHOT_H / 2, SHOT_W, SHOT_H);

    for (const e of enemies) if (e.delay <= 0) drawEnemy(e);

    for (const d of drops) {
      const p = POWERS[d.type];
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 11, 0, Math.PI * 2);
      ctx.fill();
      text(p.label, d.x, d.y + 1, "700 13px", "#0b1a2e");
    }

    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / 0.5, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;

    if (state !== "over") drawPlayer();

    // 적 탄은 다른 무엇보다 위에 그려 가려지지 않게 한다. 탄이 많아도 바깥 원과 속 원을 각각 한 번에 칠한다.
    for (const [color, radius] of [["#ff5a7a", BULLET_R], ["#ffffff", 2.2]]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (const b of bullets) {
        ctx.moveTo(b.x + radius, b.y);
        ctx.arc(b.x, b.y, radius, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    for (const p of popups) {
      ctx.globalAlpha = Math.min(1, p.life / 0.4);
      text(p.text, p.x, p.y, "700 12px", p.color);
    }
    ctx.globalAlpha = 1;

    drawHud();
    if (state === "playing" && banner > 0) text(`${level}단계`, W / 2, H / 2 - 40, "700 26px", "#ffffff");
  }

  // --- 진행 -------------------------------------------------------------------

  function updateStats() {
    $("score").textContent = score.toLocaleString("ko-KR");
    $("level").textContent = level;
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
    score = 0; level = 1; elapsed = 0; nextWave = 1; fireCool = 0; banner = 1.6;
    player = { x: W / 2, y: H - 70, power: 1, shield: false, invuln: 0 };
    shots = []; enemies = []; bullets = []; drops = []; particles = []; popups = [];
  }

  function start() {
    reset();
    setState("playing");
    overlay.hidden = true;
    updateStats();
    draw();
  }

  // 게임이 끝난 직후에 누르고 있던 키가 곧바로 새 게임을 시작하지 않게 잠시 막는다.
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
    showOverlay("게임 오버", `${score.toLocaleString("ko-KR")}점 · ${level}단계${score > best ? " · 최고 기록!" : ""}`, "다시 하기", restart);
    window.IBA.reportScore("shooter", score, overlay);
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

  const KEYS = {
    ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
    KeyA: "left", KeyD: "right", KeyW: "up", KeyS: "down",
  };
  document.addEventListener("keydown", (e) => {
    // 시작 전부터 누르고 있던 방향키도 게임이 시작되면 바로 먹히도록 상태와 상관없이 기록한다.
    if (KEYS[e.code]) held[KEYS[e.code]] = true;
    if (state === "ready" || state === "over") {
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        if (e.repeat) return;
        if (state === "ready") start(); else restart();
      }
      return;
    }
    if (KEYS[e.code]) { e.preventDefault(); return; }
    if (e.code === "Space") e.preventDefault();
    if (e.repeat) return;
    if (e.code === "KeyP") setPaused(state === "playing");
    else if (e.code === "KeyR") start();
    else if (e.code === "Space" && state === "paused") setPaused(false);
  });
  document.addEventListener("keyup", (e) => { if (KEYS[e.code]) held[KEYS[e.code]] = false; });

  document.addEventListener("visibilitychange", () => { if (document.hidden) setPaused(true); });
  // 창이 포커스를 잃으면 keyup이 오지 않으므로 눌린 키를 풀고 멈춘다.
  window.addEventListener("blur", () => {
    held.left = held.right = held.up = held.down = false;
    setPaused(true);
  });

  document.addEventListener("DOMContentLoaded", () => {
    fitCanvas();
    makeStars();
    reset();
    banner = 0;
    updateStats();
    draw();
    showOverlay("슈팅게임", "적기를 격추하고 탄을 피하세요. 한 번 맞으면 끝나고, 총알은 저절로 나갑니다.", "시작하기", start);
    window.IBA.gameBoard("shooter");
    requestAnimationFrame((t) => { last = t; frame(t); });
  });
})();
