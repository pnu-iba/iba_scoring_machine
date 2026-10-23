// 스네이크. 방향키로 뱀을 움직여 먹이를 먹는다. 먹을수록 길어지고 빨라진다.
(function () {
  const COLS = 24, ROWS = 24, CELL = 20;
  const W = COLS * CELL, H = ROWS * CELL;
  const START_LEN = 3, FOODS_PER_LEVEL = 5;
  // 한 칸 움직이는 시간(ms). 먹이 하나마다 STEP_DEC씩 줄어 STEP_MIN에서 멈춘다.
  const STEP_START = 115, STEP_DEC = 3, STEP_MIN = 45;
  const QUEUE_MAX = 3, SCORE_MAX = 999999, RESTART_DELAY = 800;
  const BEST_KEY = "iba.best.snake";

  const $ = (id) => document.getElementById(id);
  const cv = $("board"), ctx = cv.getContext("2d");
  const overlay = $("overlay");
  const stageBox = cv.parentElement;

  let snake, dir, queue, food, eaten, score, level, acc, popups, banner;
  let state = "ready", last = 0, overAt = 0, dpr = 0;

  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };

  function readBest() { try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch (_) { return 0; } }
  function saveBest(v) { try { localStorage.setItem(BEST_KEY, String(v)); } catch (_) {} }

  // 고해상도 화면에서 흐려지지 않도록 캔버스 픽셀 수를 화면 배율에 맞춘다. 그리는 좌표는 그대로 480×480이다.
  function fitCanvas() {
    dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.width = W + "px";
    cv.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const stepMs = () => Math.max(STEP_MIN, STEP_START - eaten * STEP_DEC);

  // 뱀이 없는 칸 가운데 하나에 먹이를 놓는다. 빈칸이 없으면 null이다.
  function placeFood() {
    const taken = new Set(snake.map((p) => p.x + p.y * COLS));
    const free = [];
    for (let i = 0; i < COLS * ROWS; i++) if (!taken.has(i)) free.push(i);
    if (!free.length) return null;
    const i = free[Math.floor(Math.random() * free.length)];
    return { x: i % COLS, y: Math.floor(i / COLS) };
  }

  // --- 진행 -------------------------------------------------------------------

  // 한 칸 움직인다. 꼬리는 이번에 비워지므로 머리가 꼬리 자리로 가는 것은 부딪힌 것이 아니다.
  function step() {
    while (queue.length) {
      const next = queue.shift();
      if (next !== dir && next !== OPPOSITE[dir]) { dir = next; break; }
    }
    const [dx, dy] = DIRS[dir];
    const head = { x: snake[0].x + dx, y: snake[0].y + dy };
    const grows = head.x === food.x && head.y === food.y;
    const body = grows ? snake : snake.slice(0, -1);
    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS || body.some((p) => p.x === head.x && p.y === head.y)) {
      gameOver(false);
      return;
    }
    snake = [head, ...body];
    if (!grows) return;

    eaten += 1;
    const gained = level * 10;
    score = Math.min(SCORE_MAX, score + gained);
    popups.push({ x: head.x * CELL + CELL / 2, y: head.y * CELL, text: `+${gained}`, life: 0.7 });
    const lv = Math.floor(eaten / FOODS_PER_LEVEL) + 1;
    if (lv !== level) { level = lv; banner = 1.2; }
    updateStats();
    food = placeFood();
    if (!food) gameOver(true);
  }

  function update(dt) {
    acc += dt * 1000;
    while (state === "playing" && acc >= stepMs()) {
      acc -= stepMs();
      step();
    }
    for (const p of popups) { p.y -= 30 * dt; p.life -= dt; }
    popups = popups.filter((p) => p.life > 0);
    if (banner > 0) banner -= dt;
  }

  // --- 그리기 -----------------------------------------------------------------

  function text(str, x, y, font, color) {
    ctx.font = `${font} "Noto Sans KR", sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(str, x, y);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
    ctx.fill();
  }

  function draw() {
    ctx.fillStyle = "#0b1a2e";
    ctx.fillRect(0, 0, W, H);
    // 칸이 보이도록 체크무늬를 옅게 깐다.
    ctx.fillStyle = "rgba(255,255,255,0.025)";
    for (let y = 0; y < ROWS; y++) {
      for (let x = (y % 2); x < COLS; x += 2) ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }

    if (food) {
      ctx.fillStyle = "#ef6b6b";
      ctx.beginPath();
      ctx.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, CELL / 2 - 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // 머리에서 꼬리로 갈수록 색을 조금씩 어둡게 한다.
    snake.forEach((p, i) => {
      const t = snake.length > 1 ? i / (snake.length - 1) : 0;
      ctx.fillStyle = i === 0 ? (state === "over" ? "#e5484d" : "#7ee2ad") : `hsl(152, ${55 - t * 20}%, ${52 - t * 22}%)`;
      roundRect(p.x * CELL + 1, p.y * CELL + 1, CELL - 2, CELL - 2, i === 0 ? 6 : 4);
    });

    for (const p of popups) {
      ctx.globalAlpha = Math.min(1, p.life / 0.35);
      text(p.text, p.x, p.y, "700 13px", "#f2c94c");
    }
    ctx.globalAlpha = 1;

    if (state === "playing" && banner > 0) text(`${level}단계`, W / 2, H / 2 - 40, "700 26px", "#ffffff");
  }

  function updateStats() {
    $("score").textContent = score.toLocaleString("ko-KR");
    $("length").textContent = snake.length;
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
    const y = Math.floor(ROWS / 2), x = Math.floor(COLS / 2) - 4;
    snake = Array.from({ length: START_LEN }, (_, i) => ({ x: x - i, y }));
    dir = "right"; queue = []; eaten = 0; score = 0; level = 1; acc = 0; popups = []; banner = 0;
    food = placeFood();
  }

  function start() {
    reset();
    banner = 1.2;
    setState("playing");
    overlay.hidden = true;
    updateStats();
    draw();
  }

  // 게임이 끝난 직후에 누르고 있던 키가 곧바로 새 게임을 시작하지 않게 잠시 막는다.
  function restart() {
    if (performance.now() - overAt > RESTART_DELAY) start();
  }

  function gameOver(cleared) {
    setState("over");
    overAt = performance.now();
    const best = readBest();
    if (score > best) saveBest(score);
    updateStats();
    draw();
    showOverlay(cleared ? "판을 다 채웠습니다" : "게임 오버", `${score.toLocaleString("ko-KR")}점 · 길이 ${snake.length}${score > best ? " · 최고 기록!" : ""}`, "다시 하기", restart);
    window.IBA.reportScore("snake", score, overlay);
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
    // 탭 전환 뒤 여러 칸이 한꺼번에 움직이지 않게 경과 시간에 상한을 둔다.
    const dt = Math.min(0.1, Math.max(0, (t - last) / 1000));
    last = t;
    if (state !== "playing") return;
    update(dt);
    draw();
  }

  const KEYS = {
    ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
    KeyA: "left", KeyD: "right", KeyW: "up", KeyS: "down",
  };
  document.addEventListener("keydown", (e) => {
    if (state === "ready" || state === "over") {
      if (e.code === "Space" || e.code === "Enter" || (state === "over" && e.code === "KeyR")) {
        e.preventDefault();
        if (e.repeat) return;
        if (state === "ready") start(); else restart();
      }
      return;
    }
    const d = KEYS[e.code];
    if (d) {
      e.preventDefault();
      // 한 칸 움직이기 전에 여러 번 눌러도 순서대로 꺾이도록 쌓아 둔다. 같은 방향과 반대 방향은 버린다.
      const prev = queue.length ? queue[queue.length - 1] : dir;
      if (state === "playing" && !e.repeat && d !== prev && d !== OPPOSITE[prev] && queue.length < QUEUE_MAX) queue.push(d);
      return;
    }
    if (e.code === "Space") e.preventDefault();
    if (e.repeat) return;
    if (e.code === "KeyP") setPaused(state === "playing");
    else if (e.code === "KeyR") start();
    else if (e.code === "Space" && state === "paused") setPaused(false);
  });

  document.addEventListener("visibilitychange", () => { if (document.hidden) setPaused(true); });
  window.addEventListener("blur", () => setPaused(true));

  document.addEventListener("DOMContentLoaded", () => {
    fitCanvas();
    reset();
    updateStats();
    draw();
    showOverlay("스네이크", "먹이를 먹으며 뱀을 키우세요. 벽이나 자기 몸에 부딪히면 끝납니다.", "시작하기", start);
    window.IBA.gameBoard("snake");
    requestAnimationFrame((t) => { last = t; frame(t); });
  });
})();
