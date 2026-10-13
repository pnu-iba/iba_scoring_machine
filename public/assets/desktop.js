// 미니게임 화면. 바탕의 게임 아이콘은 한 번 누르면 선택, 두 번 누르면 그 게임 페이지를 창(iframe)에 담아
// 아이콘 자리에서 연다. 끌면 옮겨진다. 아래 Dock의 앱 아이콘은 장식으로, macOS처럼 커서 가까운 것일수록 커진다.
// 창은 제목 줄을 끌어 옮기고, 누른 창이 맨 앞으로 오며, 빨간 버튼으로 닫는다(닫으면 게임도 멈춘다).
(function () {
  const DRAG_START = 4;   // 이만큼(px) 움직여야 끌기로 본다. 그보다 적으면 클릭
  const GAP = 16;         // 창이 화면 가장자리와 띄우는 최소 여백

  let desktop, dock, layer;
  let top = 10;           // 창 겹침 순서. 앞으로 올 때마다 하나씩 올린다
  let cascade = 0;        // 새 창을 조금씩 비켜 여는 계단
  const open = new Map(); // game → 창 요소

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

  // 포인터로 요소를 끄는 공통 동작. 움직임이 DRAG_START를 넘으면 onMove를 부르고,
  // 끝나면 onEnd(끌었는지)를 부른다. 끄는 동안에는 iframe이 포인터를 가로채지 않게 막는다.
  // 단추(창 닫기) 위에서 누른 것은 끌기로 잡지 않는다. 잡으면 click이 단추에 닿지 않는다.
  function draggable(handle, { onStart, onMove, onEnd }) {
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || (e.target !== handle && e.target.closest("button"))) return;
      const sx = e.clientX, sy = e.clientY;
      let dragging = false;
      onStart && onStart(e);
      handle.setPointerCapture(e.pointerId);

      const move = (ev) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!dragging && Math.hypot(dx, dy) < DRAG_START) return;
        if (!dragging) { dragging = true; document.body.classList.add("desk-dragging"); }
        onMove(dx, dy);
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        document.body.classList.remove("desk-dragging");
        onEnd && onEnd(dragging);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
  }

  // --- 게임 아이콘 ---------------------------------------------------------------

  function select(icon) {
    desktop.querySelectorAll(".desk-icon.selected").forEach((el) => el.classList.remove("selected"));
    if (icon) icon.classList.add("selected");
  }

  function setupIcon(icon) {
    let ox = 0, oy = 0, moved = false;
    draggable(icon, {
      onStart: () => {
        // 처음 끌 때 %로 놓인 자리를 px로 바꿔 둔다
        ox = icon.offsetLeft; oy = icon.offsetTop;
        select(icon);
      },
      onMove: (dx, dy) => {
        // 화면 안에서만, Dock 위까지만 움직인다(left는 아이콘 가운데 기준 — CSS에서 -50% 옮겨 둠)
        icon.style.left = clamp(ox + dx, icon.offsetWidth / 2, desktop.clientWidth - icon.offsetWidth / 2) + "px";
        icon.style.top = clamp(oy + dy, 0, dock.offsetTop - icon.offsetHeight - 8) + "px";
      },
      onEnd: (dragged) => { moved = dragged; },
    });
    const launch = () => openGame(icon.dataset.game, icon.dataset.title, Number(icon.dataset.w) || 640, icon);
    // 한 번 누르면 선택만 하고, 두 번 누르면 연다(macOS 바탕화면과 같게). 끌고 난 뒤의 click은 무시한다.
    // 키보드 Enter·Space로 누른 click은 detail이 0이라, 그때는 바로 연다.
    icon.addEventListener("click", (e) => {
      if (moved) { moved = false; return; }
      select(icon);
      if (e.detail === 0) launch();
    });
    icon.addEventListener("dblclick", launch);
  }

  // --- Dock(장식) ----------------------------------------------------------------

  const MAGNIFY = 1.6;    // 커서 바로 아래 아이콘의 최대 배율
  const REACH = 150;      // 커서에서 이만큼(px) 떨어진 아이콘까지 함께 커진다

  // 커서와 아이콘 중심의 가로 거리가 가까울수록 크게(가운데가 가장 크고 양옆으로 부드럽게 줄어든다)
  function magnify(x) {
    dock.querySelectorAll(".dock-item").forEach((item) => {
      const r = item.getBoundingClientRect();
      const d = Math.abs(x - (r.left + r.width / 2)) / REACH;
      const s = d >= 1 ? 1 : 1 + (MAGNIFY - 1) * Math.cos((d * Math.PI) / 2);
      item.style.setProperty("--s", s.toFixed(3));
    });
  }

  function setupDock() {
    dock.addEventListener("pointermove", (e) => magnify(e.clientX));
    dock.addEventListener("pointerleave", () => {
      dock.querySelectorAll(".dock-item").forEach((item) => item.style.setProperty("--s", "1"));
    });
  }

  // --- 창 ----------------------------------------------------------------------

  function front(win) {
    if (win.style.zIndex == top) return;
    win.style.zIndex = ++top;
    layer.querySelectorAll(".win").forEach((w) => w.classList.toggle("inactive", w !== win));
  }

  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  const iconOf = new WeakMap();   // 창 → 그 창을 연 아이콘

  // 여닫는 움직임(macOS 창처럼). 열 때는 아이콘 자리에서 작게 시작해 살짝 넘쳤다가 제 크기로 자리 잡고,
  // 닫을 때는 같은 기준점(아이콘)으로 곧장 줄어들며 빨려 들어간다.
  // 닫기는 여는 움직임을 그냥 거꾸로 돌리면 처음에 멈칫하므로(넘침 구간 + 느린 출발), 누르는 즉시 움직이는 곡선을 따로 쓴다.
  const OPEN_FRAMES = [
    { opacity: 0, transform: "scale(0.05)" },
    { opacity: 1, transform: "scale(1.012)", offset: 0.78 },
    { opacity: 1, transform: "scale(1)" },
  ];
  const OPEN = { duration: 900, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" };
  // 닫기는 여는 것과 같은 속도로 느껴지도록 짧게 두고, 끝으로 갈수록 빨라져 아이콘 속으로 쏙 들어간다.
  // (끝이 느려지는 곡선이면 작아진 창이 아이콘 근처에서 머뭇거려 여는 것보다 굼떠 보인다.)
  const CLOSE_FRAMES = [
    { opacity: 1, transform: "scale(1)" },
    { opacity: 1, transform: "scale(0.35)", offset: 0.6 },   // 거의 아이콘 크기가 될 때까지는 또렷하게
    { opacity: 0, transform: "scale(0.05)" },
  ];
  const CLOSE = { duration: 220, easing: "cubic-bezier(0.35, 0.2, 0.8, 0.6)" };

  // 기준점: 게임 아이콘 그림의 한가운데(창 기준 좌표). 아이콘을 옮겼으면 지금 자리를 쓴다.
  function aimAtIcon(win) {
    const icon = iconOf.get(win);
    if (!icon) { win.style.transformOrigin = "50% 50%"; return; }
    const r = icon.querySelector("svg").getBoundingClientRect();
    win.style.transformOrigin = `${r.left + r.width / 2 - win.offsetLeft}px ${r.top + r.height / 2 - win.offsetTop}px`;
  }

  // 닫기: 아이콘 자리로 줄어들며 사라진다. 끝나면 요소를 지운다(게임도 멈춘다).
  function close(game) {
    const win = open.get(game);
    if (!win) return;
    open.delete(game);
    win.classList.add("closing");   // 사라지는 동안 누르지 못하게
    const done = () => win.remove();
    if (calm.matches) done();
    else {
      aimAtIcon(win);
      win.animate(CLOSE_FRAMES, CLOSE).finished.then(done, done);
    }
    const rest = [...layer.querySelectorAll(".win:not(.closing)")].sort((a, b) => b.style.zIndex - a.style.zIndex);
    if (rest[0]) { rest[0].classList.remove("inactive"); rest[0].querySelector("iframe").focus(); }
  }

  // 열기: 게임 페이지를 다 불러온 뒤, 두 번 누른 아이콘 자리에서 창이 커져 나와 화면 가운데에 자리 잡는다
  // (macOS에서 바탕화면 아이콘을 열 때처럼). 크기는 이때 한 번 정하고 고정한다.
  function openGame(game, title, width, icon) {
    if (open.has(game)) { const w = open.get(game); front(w); w.querySelector("iframe").focus(); return; }

    const win = document.createElement("div");
    win.className = "win";
    win.setAttribute("role", "dialog");
    win.setAttribute("aria-label", title);
    win.innerHTML = `
      <div class="win-bar">
        <span class="win-lights">
          <button class="win-close" type="button" aria-label="${title} 창 닫기"></button>
          <i aria-hidden="true"></i><i aria-hidden="true"></i>
        </span>
        <span class="win-title">${title}</span>
      </div>
      <iframe src="/games/${game}.html?embed=1&t=${Date.now()}" title="${title}"></iframe>`;

    const w = Math.min(width, innerWidth - GAP * 2);
    if (open.size === 0) cascade = 0;   // 열린 창이 없으면 다시 정가운데부터
    const step = cascade * 28;   // 여러 개를 열면 조금씩 비켜 겹친다
    cascade = (cascade + 1) % 5;
    win.style.width = w + "px";
    win.style.visibility = "hidden";   // 내용을 다 불러와 크기가 정해질 때까지 숨겨 둔다
    layer.append(win);
    open.set(game, win);
    if (icon) iconOf.set(win, icon);
    front(win);

    // 주소 끝의 t=는 창을 열 때마다 바뀌어, 브라우저가 예전에 받아 둔 게임 페이지를 다시 쓰지 않게 한다.
    // (창 안의 페이지는 바깥 페이지를 새로고침해도 함께 새로 받아지지 않는다.)
    const frame = win.querySelector("iframe");
    frame.addEventListener("load", () => {
      if (!win.isConnected) return;   // 불러오는 사이에 닫혔다
      // 높이: 게임 페이지 내용만큼, 화면을 넘으면 창 안에서 스크롤. 자리: 화면 가운데(+계단).
      const bar = win.querySelector(".win-bar").offsetHeight;
      // 문서 높이(scrollHeight)는 iframe의 기본 높이(480px)보다 작아지지 않으므로, 본문(body)의 실제 높이를 잰다
      const content = frame.contentDocument ? Math.ceil(frame.contentDocument.body.getBoundingClientRect().height) : 480;
      const h = Math.min(content + bar, innerHeight - GAP * 2);
      frame.style.height = (h - bar) + "px";
      const left = clamp((innerWidth - w) / 2 + step, GAP, innerWidth - w - GAP);
      const topPx = clamp((innerHeight - h) / 2 + step, GAP, innerHeight - h - GAP);
      win.style.left = left + "px";
      win.style.top = topPx + "px";
      win.style.visibility = "";

      if (!calm.matches) { aimAtIcon(win); win.animate(OPEN_FRAMES, OPEN); }
      frame.focus();   // 창을 열자마자 키보드가 게임으로 가도록
    }, { once: true });

    win.querySelector(".win-close").addEventListener("click", () => close(game));
    win.addEventListener("pointerdown", () => front(win));

    let ox = 0, oy = 0;
    draggable(win.querySelector(".win-bar"), {
      onStart: () => { ox = win.offsetLeft; oy = win.offsetTop; },
      onMove: (dx, dy) => {
        win.style.left = clamp(ox + dx, GAP - win.offsetWidth + 80, innerWidth - 80) + "px";
        win.style.top = clamp(oy + dy, 0, innerHeight - 40) + "px";
      },
    });
  }

  function init() {
    desktop = document.getElementById("desktop");
    dock = document.getElementById("dock");
    if (!desktop || !dock) return;
    layer = document.createElement("div");
    layer.className = "win-layer";
    document.body.append(layer);

    desktop.querySelectorAll(".desk-icon").forEach(setupIcon);
    setupDock();
    // 빈 바탕을 누르면 선택을 푼다
    desktop.addEventListener("pointerdown", (e) => { if (e.target === desktop) select(null); });

    // iframe 안을 누르면 부모 문서에는 pointerdown이 오지 않는다. 대신 부모 창이 포커스를 잃으므로
    // 그때 포커스가 간 iframe의 창을 앞으로 올린다.
    window.addEventListener("blur", () => {
      requestAnimationFrame(() => {
        const el = document.activeElement;
        if (el && el.tagName === "IFRAME") front(el.closest(".win"));
      });
    });
  }

  document.addEventListener("DOMContentLoaded", init);

  // 뒤로·앞으로 가기로 BFCache에서 복원되면 CSS 애니메이션이 이미 끝난 상태로 남는다.
  // 화면이 켜지는 모션(검은 막 → 아이콘·Dock)을 처음부터 다시 재생한다.
  const ENTRANCE = new Set(["screen-on", "screen-content-in"]);
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    document.getAnimations().forEach((a) => {
      if (ENTRANCE.has(a.animationName)) { a.cancel(); a.play(); }
    });
  });
})();
