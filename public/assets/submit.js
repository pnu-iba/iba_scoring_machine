// Decorative text is independent of the uploaded data and the scoring service.
(function () {
  const el = (id) => document.getElementById(id);
  const form = el("form"), fileEl = el("file"), btn = el("submitBtn"), box = el("fileBox");
  const result = el("result"), announcement = el("submitAnnouncement");
  const viewport = el("sequenceViewport"), text = el("sequenceText");
  const idle = el("sequenceIdle"), caret = el("typingCaret");
  const node = document.createTextNode("");
  text.insertBefore(node, caret);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  // 프로젝트·동아리 이야기와 채점기의 속마음
  const base = [
    "a scoring machine is just a patient reader / it reads every row and never gets tired",
    "reading row one / reading row two / still reading / this is fine",
    "pnu iba :: people who like data a little more than they should / since the first meetup",
    "id and price / id and price / i like it when the columns behave",
    "the devil is in the details / so we count the details one by one",
    "i do not judge / i only subtract and square and take the mean",
    "rmse is honest / it does not care how late you stayed up / it only cares how close you got",
    "somewhere a teammate is refreshing the leaderboard / hello",
    "one csv / one guess at the future / one number that comes back",
    "thirty percent now / the rest after the deadline / patience is part of the game",
    "late nights in the club room / cold coffee / a notebook full of half finished ideas",
    "every file gets the same careful attention / even the ones sent at three am",
    "the leaderboard is not the point / the point is the next idea you try",
    "busan / blue sea / blue accent / a quiet place to make careful models",
    "every submission is a small letter to the test set / and the test set always answers",
    "counting / comparing / almost there / one more row",
    "we built this so the scoring could stay fair and the thinking could stay yours",
    "features / folds / seeds / patience :: the four seasons of a competition",
    "if it scored badly / good / now you know one more thing that does not work",
    "back to waiting for the next file / it is never long",
  ];
  // 끼워 넣을 글은 코드에 두지 않고 data/lyrics-*.txt에서 읽는다(한 줄씩, 빈 줄로 묶음 구분). 파일이 비면 그 자리는 건너뛴다.
  const inserts = { a: [], b: [], c: [] };
  const readInsert = (name) => fetch(`/data/lyrics-${name}.txt`).then((r) => (r.ok ? r.text() : "")).catch(() => "");
  const blocks = (t) => t.split(/\n\s*\n/).map((b) => b.split("\n").map((l) => l.trim()).filter(Boolean)).filter((b) => b.length);
  Promise.all([readInsert("wonderwall"), readInsert("morning-always-comes"), readInsert("set4")]).then(([a, b, c]) => {
    inserts.a = blocks(a).flat();
    inserts.b = blocks(b).flat();
    inserts.c = blocks(c);
  });
  // 세트마다 앞(head)과 끝(tail)에 둘 문장. 그 사이는 base를 섞은 문장으로 채운다.
  // 2·3번은 끼운 글이, 4번은 둘째 묶음이 영역 끝에서 한 문장 앞에 온다(4번 첫 묶음은 앞쪽).
  const sets = [
    () => ({ head: [], tail: [] }),
    () => ({ head: [], tail: inserts.a }),
    () => ({ head: [], tail: inserts.b }),
    () => {
      const [x = [], y = []] = inserts.c;
      return { head: [...base.slice(0, 3), ...x, ...base.slice(3, 7)], tail: y };
    },
  ];
  const mixed = (f) => Array.from({ length: 96 }, (_, k) => `${f[k % f.length]} :: ${f[(k + 3) % f.length]}`).join(" / ");
  let lastSet = -1;
  // 제출할 때마다 세트 하나를 고른다(직전과 같은 세트는 피한다).
  function pickSet() {
    let i = Math.floor(Math.random() * sets.length);
    if (i === lastSet) i = (i + 1) % sets.length;
    lastSet = i;
    return sets[i]();
  }
  // 끝에 둘 글이 있으면, 영역에 딱 들어가도록 가운데 채움 문장의 길이를 재서 끝 글이 마지막 줄에 오게 한다.
  function layoutScript({ head, tail }) {
    const filler = mixed(base);
    const front = head.length ? head.join(" / ") + " / " : "";
    if (!tail.length) return front + filler;
    const back = " / " + [...tail, ...base.slice(-1)].join(" / ");   // 끼운 글 뒤에 한 문장을 더 두어 끝에서 조금 앞에 오게
    const build = (n) => front + filler.slice(0, n).replace(/\s+\S*$/, "") + back;
    let lo = 0, hi = filler.length;
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; paint(build(mid)); if (fits()) lo = mid; else hi = mid; }
    paint("");
    return build(lo);
  }
  let script = "";
  let frame = 0, timer = 0, releaseWait = null;
  let serial = 0, busy = false, controller = null, currentText = "";

  function cancelMotion() {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    frame = timer = 0;
    if (releaseWait) { const release = releaseWait; releaseWait = null; release(); }
  }
  function paint(value) {
    // One stable text node, bounded to 16k characters.
    currentText = value.slice(-16000);
    node.data = currentText;
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
    el("sequenceWait").hidden = false;
    el("sequenceNotice").hidden = true;
  }
  // 글자는 영역에 들어가는 만큼만 찍는다(스크롤 없음). 마지막 한 줄은 success 몫으로 남긴다.
  let filled = Promise.resolve();
  function fits() {
    const line = parseFloat(getComputedStyle(text).lineHeight) || 15;
    return text.offsetHeight <= viewport.clientHeight - line;
  }
  function fillTo(count) {
    // 넘치면 넘치기 직전 길이로 되돌린다.
    paint(script.slice(0, count));
    if (fits()) return false;
    let lo = currentText.length - 40, hi = count;
    lo = Math.max(0, Math.min(lo, count));
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; paint(script.slice(0, mid)); if (fits()) lo = mid; else hi = mid; }
    paint(script.slice(0, lo));
    return true;
  }
  function startSequence(start, token) {
    resetSequence();
    idle.hidden = true;
    el("sequenceContent").hidden = false;
    script = layoutScript(pickSet());   // 영역이 보이는 상태에서 재야 하므로 위에서 먼저 연다
    if (reduced.matches) { fillTo(script.length); return; }
    caret.hidden = false;
    let count = 0, last = start, fraction = 0, perLine = 0, lineWait = 0;
    const lineHeight = parseFloat(getComputedStyle(text).lineHeight) || 15;
    filled = new Promise((done) => {
      const tick = (now) => {
        if (token !== serial) return done();
        if (reduced.matches) { fillTo(script.length); return done(); }
        const dt = Math.min(40, now - last);
        last = now;
        if (!perLine && text.offsetHeight >= viewport.clientHeight * 0.4) {
          // 영역의 40%까지 찼으면 지금까지 한 줄에 들어간 글자 수를 재고, 이후로는 한 줄씩 찍는다.
          perLine = Math.max(20, Math.round(count / Math.max(1, text.offsetHeight / lineHeight)));
        }
        let step;
        if (perLine) {
          lineWait += dt;
          if (lineWait < 110) { frame = requestAnimationFrame(tick); return; }
          lineWait = 0;
          step = perLine;
        } else {
          // 앞쪽 40%는 글자 단위로 천천히 찍는다(프레임이 밀려도 한 번에 건너뛰지 않게 제한).
          fraction += dt * 0.15;
          step = Math.min(4, Math.floor(fraction));
          fraction -= step;
        }
        count = Math.min(script.length, count + step);
        if (fillTo(count) || count >= script.length) return done();
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });
  }
  async function finishSequence(token) {
    // 채점이 일찍 끝나도 글자가 아래 끝까지 찬 뒤에 결과를 보여 준다.
    await Promise.race([filled, new Promise((r) => setTimeout(r, 60000))]);
    cancelMotion();
    if (token !== serial) return;
    // 실제 줄 높이가 계산값보다 조금 크면 남겨 둔 한 줄로는 모자라 success가 영역 밖으로 잘린다.
    // 그래서 "...success!"까지 넣고도 영역 안에 들어오도록 앞 글을 뒤에서부터 줄인다.
    let kept = currentText.replace(/\s+$/, "");
    const fitsWithEnding = (s) => { paint(s + "\n...success!"); return text.offsetHeight <= viewport.clientHeight; };
    if (!fitsWithEnding(kept)) {
      let lo = 0, hi = kept.length;
      while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (fitsWithEnding(kept.slice(0, mid))) lo = mid; else hi = mid; }
      kept = kept.slice(0, lo).replace(/\s+$/, "");
    }
    paint(kept);
    const base = kept + "\n";
    // 마지막 문구: 점 세 개는 한 글자씩 천천히, success는 한 번에, 잠시 뒤 !
    const steps = [[".", 520], ["..", 520], ["...", 760], ["...success", 620], ["...success!", 700]];   // ! 뒤 잠깐 쉬었다가 점수를 보여 준다
    if (!reduced.matches) {
      await wait(900);   // 글자가 다 찬 뒤 첫 점이 나오기 전 잠깐 멈춘다
      for (const [part, pause] of steps) {
        if (token !== serial) return;
        paint(base + part);
        if (pause) await wait(pause);
      }
    } else paint(base + "...success!");
    caret.hidden = true;
  }
  function updateButton() {
    const file = fileEl.files[0];
    // 첨부 전에는 아이콘만 둔다(글자 없음).
    const label = el("fileBoxLabel");
    label.textContent = busy ? "Scoring…" : "add file";
    label.hidden = Boolean(file) && !busy;
    box.classList.toggle("has-file", Boolean(file) && !busy);
    box.classList.toggle("scoring", busy);
    // 첨부 전에만 박스 전체가 버튼이다. 첨부 뒤에는 Submit·change file 버튼으로 넘긴다.
    const idle = !file && !busy;
    if (idle) { box.setAttribute("role", "button"); box.tabIndex = 0; box.setAttribute("aria-label", "add file"); }
    else { box.removeAttribute("role"); box.removeAttribute("tabindex"); box.removeAttribute("aria-label"); }
    box.setAttribute("aria-busy", String(busy));
    btn.hidden = !file || busy;
    btn.setAttribute("aria-label", file ? `Submit ${file.name}` : "Submit");
    el("fileBoxName").textContent = file ? file.name : "";
    el("fileBoxName").title = file ? file.name : "";
    el("fileBoxName").hidden = !file;
    el("changeFile").hidden = !file || busy;
  }
  el("changeFile").addEventListener("click", () => { if (!busy) fileEl.click(); });

  // 파일을 상자에 끌어다 놓기
  ["dragenter", "dragover"].forEach((type) => box.addEventListener(type, (e) => {
    if (busy || !e.dataTransfer || ![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    box.classList.add("dragging");
  }));
  ["dragleave", "dragend"].forEach((type) => box.addEventListener(type, () => box.classList.remove("dragging")));
  box.addEventListener("drop", (e) => {
    box.classList.remove("dragging");
    if (busy || !e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    const dt = new DataTransfer();
    dt.items.add(e.dataTransfer.files[0]);
    fileEl.files = dt.files;
    fileEl.dispatchEvent(new Event("change"));
  });
  // 첨부 전: 박스 어디를 눌러도(또는 Enter·Space) 파일 고르기. 첨부 뒤에는 박스 클릭은 아무 일도 하지 않는다.
  box.addEventListener("click", () => { if (!busy && !fileEl.files.length) fileEl.click(); });
  box.addEventListener("keydown", (e) => {
    if (e.target !== box || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    if (!busy && !fileEl.files.length) fileEl.click();
  });
  btn.addEventListener("click", () => { if (!busy && fileEl.files.length) form.requestSubmit(); });
  fileEl.addEventListener("change", () => {
    result.hidden = true;
    updateButton();
    if (fileEl.files[0]) announcement.textContent = `${fileEl.files[0].name} 선택됨. Submit 버튼을 눌러 채점을 시작하세요.`;
  });
  const esc = (s) => window.IBA.esc(s);
  // 오류도 오른쪽 결과 영역에 한 글자씩 찍는다. 제목과 설명 사이는 한 줄 띄운다.
  function showError(title, detail) {
    showNotice(detail ? [title, "", detail] : [title], [title, detail].filter(Boolean).join(" "));
  }
  // lines의 빈 문자열은 빈 줄.
  let noticeId = 0;
  function showNotice(lines, spoken) {
    resetSequence();
    fileEl.value = "";
    updateButton();
    result.hidden = true;
    announcement.textContent = spoken;
    const notice = el("sequenceNotice"), full = lines.join("\n");
    el("sequenceWait").hidden = true;
    notice.hidden = false;
    if (reduced.matches) { notice.textContent = full; return; }
    const token = serial, id = ++noticeId;
    let i = 0;
    const type = () => {
      if (token !== serial || id !== noticeId || notice.hidden) return;
      notice.textContent = full.slice(0, ++i);
      if (i < full.length) setTimeout(type, 22);
    };
    type();
  }
  function showScore(b) {
    const f = window.IBA.fmt;
    const score = `RMSE: ${f.rmse(b.rmse)}    R²: ${f.r2(b.r2)}`;
    el("sequenceScore").textContent = score;
    el("sequenceOutcome").hidden = false;
    result.hidden = true;
    result.textContent = "";
    fileEl.value = "";
    const remaining = b.unlimited ? "로컬 테스트: 제출 횟수 제한 없음." : `오늘 ${b.remaining_today}회 남음.`;
    announcement.textContent = `채점 완료. Public ${score}. 현재 팀 순위 ${b.rank ?? "-"}위. ${remaining}`;

  }

  // 로그인 전: 안내 문장 끝에서 오른쪽 위 Sign in까지 손으로 그은 듯한 점선 화살표
  function drawSigninArrow() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "signin-arrow");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = '<defs><mask id="signinReveal" maskUnits="userSpaceOnUse"><path class="reveal"/></mask></defs>' +
      '<path class="line" mask="url(#signinReveal)"/><path class="head" d="M0 0 L-10 -6 M0 0 L-10 6"/>';
    const line = svg.querySelector(".line"), reveal = svg.querySelector(".reveal"), head = svg.querySelector(".head");
    document.body.append(svg);
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const hover = matchMedia("(hover: hover) and (pointer: fine)");
    const DRAW = 1800, HOLD = 700, FADE = 350, CYCLE = DRAW + HOLD + FADE;
    const RADIUS = 48, MAX_SHIFT = 64, SAMPLES = 80;
    let raf = 0, active = false, dirty = true, started = 0, last = 0;
    let base = [], shown = [], baseD = "", total = 0, targetRect = null;
    const pointer = { x: 0, y: 0, inside: false, samples: [] };
    // A local displacement, always applied to the fixed baseline, never accumulated.
    const bend = { center: 0.5, targetCenter: 0.5, amount: 0, side: 0, engaged: false, pulseUntil: 0, pulse: 0 };
    const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    function measure() {
      const target = document.getElementById("signIn");
      if (!target) return false;
      const from = el("signinPromptText").getBoundingClientRect();
      targetRect = target.getBoundingClientRect();
      const a = { x: from.right + 14, y: from.top + from.height * 0.55 };
      const d = { x: targetRect.left - 10, y: targetRect.top + targetRect.height * 0.6 };
      const dx = d.x - a.x;
      const b = { x: a.x + dx * 0.45, y: a.y + 18 };
      const c = { x: a.x + dx * 0.5, y: d.y - 6 };
      baseD = `M${a.x} ${a.y} C${b.x} ${b.y}, ${c.x} ${c.y}, ${d.x} ${d.y}`;
      base = []; total = 0;
      for (let i = 0; i <= SAMPLES; i++) {
        const t = i / SAMPLES, u = 1 - t;
        const x = u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * d.x;
        const y = u ** 3 * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t ** 3 * d.y;
        const tx = 3 * u * u * (b.x - a.x) + 6 * u * t * (c.x - b.x) + 3 * t * t * (d.x - c.x);
        const ty = 3 * u * u * (b.y - a.y) + 6 * u * t * (c.y - b.y) + 3 * t * t * (d.y - c.y);
        const length = Math.hypot(tx, ty) || 1;
        if (i) total += Math.hypot(x - base[i - 1].x, y - base[i - 1].y);
        base.push({ x, y, nx: -ty / length, ny: tx / length, arc: total });
      }
      shown = base.map((p) => ({ x: p.x, y: p.y }));
      dirty = false;
      return true;
    }
    // Measure proximity to the revealed portion, not the full-screen SVG bounds.
    function nearest(points, progress, probe = pointer) {
      let best = { distance: Infinity, index: 0 };
      let walked = 0;
      const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
      const visibleLength = lengths.reduce((sum, n) => sum + n, 0) * progress;
      for (let i = 0; i < points.length - 1 && walked < visibleLength; i++) {
        const a = points[i], b = points[i + 1], length = lengths[i];
        const dx = b.x - a.x, dy = b.y - a.y;
        const cap = Math.min(1, (visibleLength - walked) / (length || 1));
        const t = Math.max(0, Math.min(cap, ((probe.x - a.x) * dx + (probe.y - a.y) * dy) / (length * length || 1)));
        const distance = Math.hypot(probe.x - a.x - t * dx, probe.y - a.y - t * dy);
        if (distance < best.distance) best = { distance, index: i, t, probe };
        walked += length;
      }
      return best;
    }
    function project(point, a, b) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      return { x: a.x + dx * t, y: a.y + dy * t, t };
    }
    function sweptNear(points, progress, samples) {
      let best = { distance: Infinity, index: 0 };
      if (samples.length < 2) return best;
      const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
      const visible = lengths.reduce((sum, n) => sum + n, 0) * progress;
      let walked = 0;
      for (let i = 0; i < lengths.length && walked < visible; i++) {
        const a = points[i], end = points[i + 1];
        const cap = Math.min(1, (visible - walked) / (lengths[i] || 1));
        const b = { x: a.x + (end.x - a.x) * cap, y: a.y + (end.y - a.y) * cap };
        for (let j = 1; j < samples.length; j++) {
          const u = samples[j - 1], v = samples[j];
          const dx = v.x - u.x, dy = v.y - u.y, ex = b.x - a.x, ey = b.y - a.y;
          const cross = dx * ey - dy * ex;
          if (Math.abs(cross) > 0.001) {
            const t = ((a.x - u.x) * ey - (a.y - u.y) * ex) / cross;
            const s = ((a.x - u.x) * dy - (a.y - u.y) * dx) / cross;
            if (t >= 0 && t <= 1 && s >= 0 && s <= 1) {
              // The approach side, rather than the final cursor position, decides
              // the avoidance direction when a whole crossing occurs in one frame.
              best = { distance: 0, index: i, t: s * cap, probe: u };
              continue;
            }
          }
          const candidates = [
            { cursor: u, path: project(u, a, b) }, { cursor: v, path: project(v, a, b) },
            { cursor: project(a, u, v), path: { ...a, t: 0 } },
            { cursor: project(b, u, v), path: { ...b, t: 1 } },
          ];
          for (const pair of candidates) {
            const distance = Math.hypot(pair.cursor.x - pair.path.x, pair.cursor.y - pair.path.y);
            if (distance < best.distance) best = { distance, index: i, t: pair.path.t * cap, probe: pair.cursor };
          }
        }
        walked += lengths[i];
      }
      return best;
    }
    function curvedPath(points) {
      // Cubic Hermite interpolation keeps the displaced sample chain smooth.
      let path = `M${points[0].x} ${points[0].y}`;
      for (let i = 0; i < points.length - 1; i++) {
        const p = points[i], q = points[i + 1];
        const before = points[Math.max(0, i - 1)], after = points[Math.min(points.length - 1, i + 2)];
        path += ` C${p.x + (q.x - before.x) / 6} ${p.y + (q.y - before.y) / 6}, ${q.x - (after.x - p.x) / 6} ${q.y - (after.y - p.y) / 6}, ${q.x} ${q.y}`;
      }
      return path;
    }
    function frame(now) {
      if (!active) return;
      if (dirty && !measure()) { raf = requestAnimationFrame(frame); return; }
      const dt = Math.min(50, Math.max(0, now - last)); last = now;
      const phase = (now - started) % CYCLE;
      const progress = motion.matches ? 1 : ease(Math.min(phase / DRAW, 1));
      const opacity = motion.matches || phase < DRAW + HOLD ? 1 : 1 - (phase - DRAW - HOLD) / FADE;
      let wanted = 0;
      const samples = pointer.samples.splice(0);
      const overLink = targetRect && pointer.x > targetRect.left - 16 && pointer.x < targetRect.right + 16 &&
        pointer.y > targetRect.top - 16 && pointer.y < targetRect.bottom + 16;
      if (!motion.matches && hover.matches && pointer.inside && !overLink) {
        const current = nearest(shown, progress);
        const swept = opacity > 0.2 ? sweptNear(shown, progress, samples) : { distance: Infinity };
        const near = swept.distance < current.distance ? swept : current;
        if (!bend.engaged && opacity > 0.2 && near.distance < RADIUS) {
          bend.engaged = true;
          const p = base[near.index];
          bend.targetCenter = (p.arc + (base[near.index + 1].arc - p.arc) * near.t) / (total || 1);
          // Re-entry must not teleport a still-visible bend to a new location.
          if (Math.abs(bend.amount) < 0.02) bend.center = bend.targetCenter;
          const side = (near.probe.x - p.x) * p.nx + (near.probe.y - p.y) * p.ny;
          bend.side = Math.abs(side) > 2 ? -Math.sign(side) : (bend.side || 1);
        }
        if (opacity > 0.2 && swept.distance < RADIUS) {
          const p = base[swept.index];
          bend.targetCenter = (p.arc + (base[swept.index + 1].arc - p.arc) * swept.t) / (total || 1);
          // Give a short crossing a visible, smoothly decaying response instead
          // of engaging and disengaging within the same frame.
          bend.pulseUntil = now + 160;
          bend.pulse = MAX_SHIFT * (1 - smooth(swept.distance / RADIUS));
        }
        if (bend.engaged) {
          // Keep the chosen side while passing through the line. Baseline
          // proximity retains the bend once the visible curve has moved away.
          const held = nearest(base, 1);
          if (held.distance > RADIUS + 24 && now >= bend.pulseUntil) bend.engaged = false;
          else {
            if (held.distance <= RADIUS + 24) {
              const p = base[held.index];
              bend.targetCenter = (p.arc + (base[held.index + 1].arc - p.arc) * held.t) / (total || 1);
            }
            wanted = Math.max(MAX_SHIFT * (1 - smooth(held.distance / (RADIUS + 24))), now < bend.pulseUntil ? bend.pulse : 0) * bend.side;
          }
        }
      } else { bend.engaged = false; bend.pulseUntil = 0; }
      bend.center += (bend.targetCenter - bend.center) * (1 - Math.exp(-dt / 150));
      if (motion.matches) bend.amount = 0;
      // Signed amplitude interpolates a direction change through zero instead
      // of instantly flipping the existing displacement to the opposite side.
      else bend.amount += (wanted - bend.amount) * (1 - Math.exp(-dt / (Math.abs(wanted) > Math.abs(bend.amount) ? 150 : 320)));
      if (Math.abs(bend.amount) < 0.02 && !wanted) bend.amount = 0;
      shown = base.map((p) => {
        const edge = smooth(p.arc / 72) * smooth((total - p.arc) / 72);
        const local = Math.exp(-(((p.arc - bend.center * total) / 95) ** 2));
        let offset = bend.amount * edge * local;
        // Fade the deformation near page edges / the fixed text endpoints.
        const room = Math.min(p.x, innerWidth - p.x, p.y, innerHeight - p.y);
        offset *= smooth(Math.max(0, room - 8) / 40);
        return { x: p.x + p.nx * offset, y: p.y + p.ny * offset };
      });
      const path = bend.amount ? curvedPath(shown) : baseD;
      line.setAttribute("d", path); reveal.setAttribute("d", path);
      const length = line.getTotalLength();
      const at = Math.max(progress * length, 0.01);
      reveal.style.strokeDasharray = `${length} ${length}`;
      reveal.style.strokeDashoffset = String(length - at);
      const pt = line.getPointAtLength(at), prev = line.getPointAtLength(Math.max(at - 2, 0));
      const angle = Math.atan2(pt.y - prev.y, pt.x - prev.x) * 180 / Math.PI;
      head.setAttribute("transform", `translate(${pt.x} ${pt.y}) rotate(${angle})`);
      svg.style.opacity = String(opacity);
      if (!motion.matches) raf = requestAnimationFrame(frame);
    }
    const invalidate = () => { dirty = true; if (active && motion.matches) raf = requestAnimationFrame(frame); };
    const move = (event) => {
      if (event.pointerType !== "mouse") return;
      if (!pointer.samples.length && pointer.inside) pointer.samples.push({ x: pointer.x, y: pointer.y });
      const coalesced = event.getCoalescedEvents?.() || [];
      for (const sample of coalesced.length ? coalesced : [event]) pointer.samples.push({ x: sample.clientX, y: sample.clientY });
      if (pointer.samples.length > 24) pointer.samples.splice(1, pointer.samples.length - 24);
      pointer.x = event.clientX; pointer.y = event.clientY; pointer.inside = true;
    };
    const leave = () => { pointer.inside = false; pointer.samples.length = 0; };
    const observer = new ResizeObserver(invalidate);
    const restartMotion = () => { cancelAnimationFrame(raf); if (active) { last = performance.now(); raf = requestAnimationFrame(frame); } };
    function start() {
      if (active) return;
      active = true; dirty = true; last = performance.now();
      if (!started) started = last;
      addEventListener("resize", invalidate);
      addEventListener("scroll", invalidate, { passive: true });
      addEventListener("pointermove", move, { passive: true });
      document.documentElement.addEventListener("pointerleave", leave);
      addEventListener("blur", leave);
      motion.addEventListener("change", restartMotion);
      observer.observe(el("signinPromptText"));
      const target = document.getElementById("signIn");
      if (target) observer.observe(target);
      raf = requestAnimationFrame(frame);
    }
    function stop() {
      active = false; cancelAnimationFrame(raf); observer.disconnect();
      removeEventListener("resize", invalidate); removeEventListener("scroll", invalidate);
      removeEventListener("pointermove", move); removeEventListener("blur", leave);
      document.documentElement.removeEventListener("pointerleave", leave);
      motion.removeEventListener("change", restartMotion);
      leave();
    }
    addEventListener("pagehide", stop);
    addEventListener("pageshow", (event) => { if (event.persisted) start(); });
    document.fonts?.ready.then(invalidate);
    start();
  }

  // 구경용 계정(iba_dev): 예시 제출 파일을 미리 첨부해 두어 Submit만 누르면 채점 결과를 볼 수 있게 한다.
  let demo = false;
  let demoFile = null;
  async function attachDemo() {
    if (!demo || busy || fileEl.files.length) return;
    try {
      if (!demoFile) {
        const res = await fetch("/data/demo_submission.csv");
        if (!res.ok) return;
        demoFile = new File([await res.blob()], "sample_data.csv", { type: "text/csv" });
      }
      if (busy || fileEl.files.length) return;
      const dt = new DataTransfer();
      dt.items.add(demoFile);
      fileEl.files = dt.files;
      fileEl.dispatchEvent(new Event("change"));
    } catch { /* 첨부하지 못하면 평소처럼 직접 고르면 된다 */ }
  }

  // 오늘 남은 제출 횟수. 관리자 계정은 제출할 수 없어 보여 주지 않는다.
  let dailyLimit = null;
  function showQuota(remaining, unlimited, resetsAt) {
    if (dailyLimit === null) return;
    const line = el("quotaLine");
    if (unlimited) line.textContent = "no daily limit";
    else if (remaining > 0) line.textContent = `${remaining} of ${dailyLimit} submissions left today`;
    else line.textContent = `no submissions left today, resets ${window.IBA.fmt.time(resetsAt)} KST`;
    line.hidden = false;
  }

  async function init() {
    const user = await window.IBA.me;
    if (!user) {
      el("needLogin").hidden = false;
      drawSigninArrow();
      return;
    }
    el("formCard").hidden = false;
    demo = !!user.demo;
    attachDemo();
    if (user.is_admin) return;
    const q = await window.IBA.api("/api/quota");
    if (!q.ok) return;
    dailyLimit = q.body.limit;
    showQuota(q.body.remaining_today, q.body.unlimited, q.body.resets_at);
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
        showQuota(r.body.remaining_today, r.body.unlimited, r.body.resets_at);
      } else if (r.status === 401) {
        showError("로그인이 풀렸습니다.", "다시 로그인한 뒤 제출하세요.");
      } else if (r.status === 503 && r.body && r.body.message) {
        showError("채점 준비 중입니다.", r.body.message);
      } else if (r.status === 403 && r.body && r.body.error_code === "contest_closed") {
        showError("대회가 마감되었습니다.", "최종 순위는 리더보드에서 확인하세요.");
      } else if (r.status === 429) {
        const limit = ((r.body && r.body.message) || "").match(/(\d+)회/);
        const used = limit ? ` (${limit[1]}/${limit[1]})` : "";
        const resets = window.IBA.fmt.time(r.body.resets_at);
        showQuota(0, false, r.body.resets_at);
        showNotice([`daily limit reached${used}`, "", `resets ${resets} KST`], (r.body && r.body.message) || "Daily limit reached.");
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
        attachDemo();   // 구경용 계정은 결과를 본 뒤에도 같은 파일로 바로 다시 제출할 수 있다
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
