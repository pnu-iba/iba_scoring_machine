// Decorative text is independent of the uploaded data and the scoring service.
(function () {
  const el = (id) => document.getElementById(id);
  const form = el("form"), fileEl = el("file"), btn = el("submitBtn");
  const result = el("result"), announcement = el("submitAnnouncement");
  const viewport = el("sequenceViewport"), text = el("sequenceText");
  const idle = el("sequenceIdle"), caret = el("typingCaret");
  const node = document.createTextNode("");
  text.insertBefore(node, caret);
  // Keep the ending visible when responsive line wrapping changes the text height.
  new ResizeObserver(() => { viewport.scrollTop = viewport.scrollHeight; }).observe(viewport);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const fragments = [
    "paper moons / quiet corners / a small blue afternoon / again and again",
    "abcdefghijklmnop :: 0123456789 :: ( ) [ ] { } :: on the other side",
    "the quick brown fox meets a slow silver cloud / nothing in particular",
    "north east south west / little letters in long lines / dot dash dot",
    "violet window amber morning / a sentence without a destination",
    "+=+= 00 11 22 33 44 55 66 77 88 99 / the space between two words",
    "one more line / another imagined postcard / somewhere near the sea",
    "round and round / distant bells / soft pencils / end of the alphabet",
  ];
  const script = Array.from({ length: 64 }, (_, i) =>
    `${fragments[i % fragments.length]} :: ${fragments[(i + 3) % fragments.length]}`
  ).join("\n");
  let frame = 0, timer = 0, releaseWait = null;
  let serial = 0, busy = false, controller = null, currentText = "";

  function cancelMotion() {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    frame = timer = 0;
    if (releaseWait) { const release = releaseWait; releaseWait = null; release(); }
  }
  function paint(value) {
    // One stable text node, bounded to 8k characters / at most 64 source lines.
    currentText = value.slice(-8000);
    node.data = currentText;
    viewport.scrollTop = viewport.scrollHeight;
  }
  function wait(ms) {
    return new Promise((resolve) => {
      releaseWait = resolve;
      timer = setTimeout(() => { timer = 0; releaseWait = null; resolve(); }, ms);
    });
  }
  function resetSequence() {
    cancelMotion();
    paint("");
    idle.hidden = false;
    caret.hidden = true;
    el("sequenceContent").hidden = true;
    el("sequenceOutcome").hidden = true;
    el("sequenceScore").textContent = "";
  }
  function startSequence(start, token) {
    resetSequence();
    idle.hidden = true;
    el("sequenceContent").hidden = false;
    if (reduced.matches) { paint(fragments.join("\n")); return; }
    caret.hidden = false;
    let count = 0, last = start, fraction = 0;
    const tick = (now) => {
      if (token !== serial) return;
      if (reduced.matches) { caret.hidden = true; paint(fragments.join("\n")); return; }
      // Short character batches reveal the current line instead of adding a whole
      // line per frame. Cap each update so delayed frames cannot jump ahead.
      fraction += Math.min(40, now - last) * 0.48;
      last = now;
      const step = Math.min(12, Math.floor(fraction));
      fraction -= step;
      count = Math.min(script.length, count + step);
      paint(script.slice(0, count));
      if (count < script.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }
  async function finishSequence(token) {
    cancelMotion();
    const base = currentText.replace(/\s+$/, "") + "\n";
    const ending = "...success!";
    if (!reduced.matches) {
      for (let i = 1; i <= ending.length; i++) {
        if (token !== serial) return;
        paint(base + ending.slice(0, i));
        await wait(18);
      }
    } else paint(base + ending);
    caret.hidden = true;
  }
  function updateButton() {
    const file = fileEl.files[0];
    el("fileBoxLabel").textContent = busy ? "Scoring…" : file ? "Submit" : "add file";
    btn.classList.toggle("has-file", Boolean(file) && !busy);
    btn.setAttribute("aria-label", busy ? "Scoring" : file ? `Submit ${file.name}` : "add file");
  }

  // 파일을 상자에 끌어다 놓기
  ["dragenter", "dragover"].forEach((type) => btn.addEventListener(type, (e) => {
    if (busy || !e.dataTransfer || ![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    btn.classList.add("dragging");
  }));
  ["dragleave", "dragend"].forEach((type) => btn.addEventListener(type, () => btn.classList.remove("dragging")));
  btn.addEventListener("drop", (e) => {
    btn.classList.remove("dragging");
    if (busy || !e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    const dt = new DataTransfer();
    dt.items.add(e.dataTransfer.files[0]);
    fileEl.files = dt.files;
    fileEl.dispatchEvent(new Event("change"));
  });
  btn.addEventListener("click", () => {
    if (busy) return;
    if (fileEl.files.length) form.requestSubmit();
    else fileEl.click();
  });
  fileEl.addEventListener("change", () => {
    result.hidden = true;
    updateButton();
    if (fileEl.files[0]) announcement.textContent = `${fileEl.files[0].name} 선택됨. 박스를 다시 눌러 채점을 시작하세요.`;
  });
  const esc = (s) => window.IBA.esc(s);
  function showError(title, detail) {
    resetSequence();
    fileEl.value = "";
    updateButton();
    result.hidden = false;
    result.innerHTML = `<p class="msg-error"><strong>${esc(title)}</strong></p>${detail ? `<p>${esc(detail)}</p>` : ""}`;
    announcement.textContent = [title, detail].filter(Boolean).join(" ");
  }
  function showScore(b) {
    const f = window.IBA.fmt;
    const score = `RMSE: ${f.rmse(b.rmse)}    R²: ${f.r2(b.r2)}`;
    el("sequenceScore").textContent = score;
    el("sequenceOutcome").hidden = false;
    result.hidden = true;
    result.textContent = "";
    fileEl.value = "";
    announcement.textContent = `채점 완료. Public ${score}. 현재 팀 순위 ${b.rank ?? "-"}위. 오늘 ${b.remaining_today}회 남음.`;

  }

  // 로그인 전: 안내 문장 끝에서 오른쪽 위 Sign in까지 손으로 그은 듯한 점선 화살표
  function drawSigninArrow() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "signin-arrow");
    svg.setAttribute("aria-hidden", "true");
    // 점선은 마스크로 앞에서부터 드러내고, 점선 화살촉이 그 끝을 따라간다.
    svg.innerHTML = '<defs><mask id="signinReveal" maskUnits="userSpaceOnUse"><path class="reveal"/></mask></defs>' +
      '<path class="line" mask="url(#signinReveal)"/><path class="head" d="M0 0 L-10 -6 M0 0 L-10 6"/>';
    const line = svg.querySelector(".line"), reveal = svg.querySelector(".reveal"), head = svg.querySelector(".head");
    document.body.append(svg);
    const draw = () => {
      const from = el("signinPromptText").getBoundingClientRect();
      const target = document.getElementById("signIn");
      if (!target) return;
      const to = target.getBoundingClientRect();
      const x1 = from.right + 14, y1 = from.top + from.height * 0.55;   // 문장 끝 조금 뒤
      const x2 = to.left - 10, y2 = to.top + to.height * 0.6;           // Sign in 바로 왼쪽
      const dx = x2 - x1, dy = y2 - y1;
      // 살짝 휘었다가 위로 올라가는 곡선(직선보다 손그림 느낌)
      const d = `M${x1} ${y1} C${x1 + dx * 0.45} ${y1 + 18}, ${x1 + dx * 0.5} ${y2 - 6}, ${x2} ${y2}`;
      line.setAttribute("d", d);
      reveal.setAttribute("d", d);
    };
    // 그리기 1.8초 → 잠깐 머문 뒤 사라지고 처음부터 반복
    const DRAW = 1800, HOLD = 700, FADE = 350, CYCLE = DRAW + HOLD + FADE;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const frame = (now) => {
      const len = line.getTotalLength();
      if (len) {
        const t = now % CYCLE;
        const p = still ? 1 : ease(Math.min(t / DRAW, 1));
        const at = Math.max(p * len, 0.01);
        reveal.style.strokeDasharray = `${len} ${len}`;
        reveal.style.strokeDashoffset = String(len - at);
        const pt = line.getPointAtLength(at), prev = line.getPointAtLength(Math.max(at - 2, 0));
        const ang = Math.atan2(pt.y - prev.y, pt.x - prev.x) * 180 / Math.PI;
        head.setAttribute("transform", `translate(${pt.x} ${pt.y}) rotate(${ang})`);
        svg.style.opacity = still || t < DRAW + HOLD ? "1" : String(1 - (t - DRAW - HOLD) / FADE);
      }
      if (!still) requestAnimationFrame(frame);
    };
    draw();
    addEventListener("resize", draw);
    addEventListener("scroll", draw, { passive: true });
    document.fonts && document.fonts.ready.then(draw);
    new MutationObserver(draw).observe(document.body, { childList: true, subtree: true });
    requestAnimationFrame(frame);
  }

  async function init() {
    const user = await window.IBA.me;
    if (!user) {
      el("needLogin").hidden = false;
      drawSigninArrow();
      return;
    }
    el("formCard").hidden = false;
  }
  init();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    const file = fileEl.files[0];
    if (!file) return showError("제출 파일을 선택하세요.");
    if (file.size > 2 * 1024 * 1024) return showError("파일이 2 MB를 넘습니다.", "정상 제출은 약 0.5 MB입니다.");
    const token = ++serial;
    const start = performance.now();
    busy = true;
    controller = new AbortController();
    btn.disabled = fileEl.disabled = true;
    updateButton();
    result.hidden = true;
    announcement.textContent = "채점 중입니다.";
    startSequence(start, token);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await window.IBA.api("/api/submit", { method: "POST", body: fd, signal: controller.signal });
      if (token !== serial) return;
      if (r.ok) {
        await wait(reduced.matches ? 0 : Math.max(0, 1800 - (performance.now() - start)));
        if (token !== serial) return;
        await finishSequence(token);
        if (token !== serial) return;
        showScore(r.body);
      } else if (r.status === 401) {
        showError("로그인이 풀렸습니다.", "다시 로그인한 뒤 제출하세요.");
      } else if (r.status === 503 && r.body && r.body.message) {
        showError("채점 준비 중입니다.", r.body.message);
      } else if (r.status === 403 && r.body && r.body.error_code === "contest_closed") {
        showError("대회가 마감되었습니다.", "최종 순위는 리더보드에서 확인하세요.");
      } else if (r.status === 429) {
        showError(r.body.message, "초기화: " + window.IBA.fmt.time(r.body.resets_at) + " (KST)");
      } else if (r.body && r.body.message) {
        showError("제출이 거부되었습니다" + (r.body.row ? ` (${r.body.row}행)` : ""), r.body.message);
      } else showError("서버 오류가 났습니다.", `HTTP ${r.status}`);
    } catch (err) {
      if (token === serial) showError("네트워크 오류가 났습니다.", "연결을 확인하고 다시 제출하세요.");
    } finally {
      if (token === serial) {
        cancelMotion();
        busy = false; controller = null;
        btn.disabled = fileEl.disabled = false;
        updateButton();
      }
    }
  });
  window.addEventListener("pagehide", () => {
    ++serial;
    controller?.abort();
    resetSequence();
    busy = false;
    btn.disabled = fileEl.disabled = false;
    updateButton();
    announcement.textContent = "";
  });
})();
