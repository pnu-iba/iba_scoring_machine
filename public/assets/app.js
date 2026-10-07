// 공통 도우미: 틀(메뉴·페이지 제목·하단 바) 렌더링, 로그인 상태, 아이콘, 숫자 포맷, API 호출, 리더보드 행, 미니게임 팀 순위.
(function () {
  // 사이드바 메뉴. 랜딩(index.html)의 메뉴와 같은 항목·같은 이름이다. 홈은 워드마크(IBA)로 간다.
  const PAGES = [
    ["/submit.html", "Submit"],
    ["/leaderboard.html", "Leaderboard"],
    ["/minigame.html", "Minigame"],
    ["/mypage.html", "My page"],
  ];
  const FOOT_PAGES = [
    ["/about.html", "About us"],
    ["/thanks.html", "Special thanks to"],
  ];
  const AUTH_TITLES = { "/login.html": "Sign in" };
  // 관리자 계정에만 사이드바에 보인다(renderAuth).
  const ADMIN_PAGE = ["/admin.html", "Admin"];

  function icon(name) {
    const d = (window.ICON_PATHS || {})[name] || "";
    return `<svg class="icon" viewBox="0 0 14 14" aria-hidden="true"><path d="${d}"/></svg>`;
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // 페이지 마크업의 <i data-icon="이름"></i>를 SVG로 바꾼다.
  function hydrateIcons(root) {
    root.querySelectorAll("i[data-icon]").forEach((el) => { el.outerHTML = icon(el.dataset.icon); });
  }

  async function api(path, options) {
    const res = await fetch(path, options);
    let body = null;
    try { body = await res.json(); } catch (_) { /* 본문 없음 */ }
    return { ok: res.ok, status: res.status, body };
  }

  // 로그인한 사용자 {username, nickname, team, is_admin}. 로그인하지 않았으면 null.
  const me = api("/api/me").then((r) => (r.ok ? r.body : null), () => null);

  // 로그인·가입 뒤 돌아갈 주소. 같은 사이트 경로만 허용한다.
  function nextPath() {
    const next = new URLSearchParams(location.search).get("next") || "/";
    return next.startsWith("/") && !next.startsWith("//") ? next : "/";
  }
  // 가입은 로그인 화면의 가입 모드(#signup)에서 한다.
  function authLink(page) {
    const hash = page === "signup" ? "#signup" : "";
    return `/login.html?next=${encodeURIComponent(location.pathname)}${hash}`;
  }

  // 지금 페이지에 해당하는 메뉴 경로. 개별 게임 페이지(/games/...)는 미니게임 메뉴 아래에 있는 것으로 본다.
  const here = location.pathname.replace(/index\.html$/, "");
  const navPath = here.startsWith("/games/") ? "/minigame.html" : here;
  function link([href, label]) {
    const cur = href === navPath ? ' aria-current="page"' : "";
    return `<a href="${href}"${cur}><span>${label}</span></a>`;
  }

  function renderShell() {
    // ?embed=1: 미니게임 바탕화면의 창(iframe) 안에 들어갈 때. 메뉴·제목·하단 바 없이 본문만 둔다.
    if (new URLSearchParams(location.search).has("embed")) {
      document.body.classList.add("embed");
      hydrateIcons(document.body);
      return;
    }

    const current = [...PAGES, ...FOOT_PAGES, ADMIN_PAGE].find(([href]) => href === navPath);
    const title = current ? current[1] : AUTH_TITLES[here] || "";

    // 메뉴 버튼·사이드바·막은 랜딩과 같은 마크업. 여닫는 동작은 chrome.js가 붙인다.
    document.body.insertAdjacentHTML("afterbegin", `
      <div class="menu-zone" id="menuZone">
        <button class="menu-btn" id="menuBtn" type="button" aria-expanded="false" aria-controls="sidebar" aria-label="Open menu">
          <span class="bars" aria-hidden="true"><i></i><i></i><i></i></span>
        </button>
        <nav class="sidebar" id="sidebar" aria-label="Site menu">
          <a class="side-brand" href="/">IBA</a>
          <ul class="side-nav">${PAGES.map((p) => `<li>${link(p)}</li>`).join("")}</ul>
          <div class="side-foot">${FOOT_PAGES.map(link).join("")}</div>
        </nav>
      </div>
      <nav class="corner-links" id="cornerLinks" aria-label="Quick links"><a class="home-mark" href="/" aria-label="IBA 홈으로">IBA</a></nav>
      <div class="scrim" aria-hidden="true"></div>`);

    const main = document.querySelector("main");
    if (main) {
      main.classList.add("page");
      // 로그인·가입 화면은 가운데 좁은 카드라 제목도 가운데에 둔다.
      // 게임 화면은 캔버스가 한 화면에 들어오도록 제목을 줄인다.
      const variant = here in AUTH_TITLES ? " centered" : here.startsWith("/games/") ? " compact" : "";
      if (variant === " compact") main.classList.add("compact");
      if (here !== "/thanks.html" && here !== "/about.html") main.insertAdjacentHTML("afterbegin", `
        <header class="page-head${variant}">
          <p class="page-eyebrow">Regression Project Scoring Service</p>
          <h1 class="page-title">${title}</h1>
        </header>`);
    }

    document.body.insertAdjacentHTML("beforeend", `
      <footer class="site-foot">
        <p class="foot-legal">
          © 2026 PNU IBA
          <span class="sep">·</span>
          <a href="https://pnuiba.imweb.me/" target="_blank" rel="noopener">Webpage</a> |
          <a href="https://www.instagram.com/pnu_iba/" target="_blank" rel="noopener">Instagram</a> |
          <a href="https://linktr.ee/pnuiba" target="_blank" rel="noopener">Linktree</a>
          <span class="sep">·</span>
          The devil&rsquo;s in the details.
        </p>
      </footer>`);

    hydrateIcons(document.body);
    me.then(renderAuth);
  }

  // 본문 페이지의 우측 상단: 비로그인 시 가입 진입, 로그인 시 계정·로그아웃 두 줄.
  function renderAuth(user) {
    const corner = document.getElementById("cornerLinks");
    if (!user) {
      corner.insertAdjacentHTML("beforeend", `<a id="signIn" href="${authLink("login")}">Sign in</a>`);
      return;
    }
    if (user.is_admin) {
      document.querySelector("#sidebar .side-nav").insertAdjacentHTML("beforeend", `<li>${link(ADMIN_PAGE)}</li>`);
    }
    corner.insertAdjacentHTML("beforeend", `<a class="who" href="/mypage.html">[Team ${esc(user.team)}] ${esc(user.nickname)}</a><button type="button" id="logoutBtn">Sign out</button>`);
    document.getElementById("logoutBtn").addEventListener("click", async () => {
      await api("/api/logout", { method: "POST" });
      location.reload();
    });
  }

  const fmt = {
    rmse: (v) => v.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    r2: (v) => v.toFixed(4),
    int: (v) => v.toLocaleString("ko-KR"),
    time: (iso) => {
      const d = new Date(iso);
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getMonth() + 1}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    },
    // "방금 전", "12분 전", "3시간 전", "2일 전". 일주일이 넘으면 날짜로 쓴다.
    ago: (iso) => {
      const min = Math.floor((Date.now() - new Date(iso)) / 60000);
      if (min < 1) return "방금 전";
      if (min < 60) return `${min}분 전`;
      if (min < 60 * 24) return `${Math.floor(min / 60)}시간 전`;
      if (min < 60 * 24 * 7) return `${Math.floor(min / (60 * 24))}일 전`;
      return fmt.time(iso);
    },
  };

  // 리더보드 표의 <tr>들. myTeam과 같은 팀 행은 강조한다.
  // final이면 최종 점수 옆에 대회 중 public 점수와 순위를 함께 보여준다.
  function boardRows(rows, myTeam, final) {
    const teamIcon = icon("users");
    return rows.map((row) => {
      const mine = myTeam && row.team === myTeam;
      return `
      <tr${mine ? ' class="mine"' : ""}>
        <td><span class="rank-badge${row.rank === 1 ? " first" : ""}">${row.rank}</span></td>
        <td><div class="team"><span class="avatar">${teamIcon}</span><div><div class="name">${esc(row.team)}${mine ? ' <span class="tag">우리 팀</span>' : ""}</div><div class="sub">${esc(row.nickname)}</div></div></div></td>
        <td class="num score-main">${fmt.rmse(row.rmse)}</td>
        <td class="num soft">${fmt.r2(row.r2)}</td>
        ${final ? `<td class="num soft">${fmt.rmse(row.public_rmse)} <span class="faint">(${row.public_rank}위)</span></td>` : ""}
        <td class="num faint" title="${fmt.time(row.submitted_at)}">${fmt.ago(row.submitted_at)}</td>
      </tr>`;
    }).join("");
  }

  // 탭이 보이는 동안 ms마다 fn을 부른다. 숨겨졌던 탭으로 돌아오면 바로 한 번 부른다.
  function refreshEvery(fn, ms) {
    setInterval(() => { if (!document.hidden) fn(); }, ms);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) fn(); });
  }

  // --- 미니게임 팀 순위 --------------------------------------------------------
  // 게임 페이지의 #gameBoard 표를 채운다. 팀별 최고 점수, 점수 내림차순.
  async function loadGameBoard(game) {
    const [r, user] = await Promise.all([api(`/api/games/${game}/leaderboard`), me]);
    const table = document.getElementById("gameBoard");
    const emptyEl = document.getElementById("gameBoardEmpty");
    if (!r.ok) { emptyEl.textContent = `순위를 불러오지 못했습니다 (HTTP ${r.status})`; return; }
    const rows = r.body;
    table.hidden = rows.length === 0;
    emptyEl.hidden = rows.length > 0;
    emptyEl.textContent = "아직 기록이 없습니다. 첫 기록을 남겨 보세요.";
    const teamIcon = icon("users");
    table.querySelector("tbody").innerHTML = rows.map((row) => {
      const mine = user && row.team === user.team;
      return `
      <tr${mine ? ' class="mine"' : ""}>
        <td><span class="rank-badge${row.rank === 1 ? " first" : ""}">${row.rank}</span></td>
        <td><div class="team"><span class="avatar">${teamIcon}</span><div><div class="name">${esc(row.team)}${mine ? ' <span class="tag">우리 팀</span>' : ""}</div><div class="sub">${esc(row.nickname)}</div></div></div></td>
        <td class="num score-main">${fmt.int(row.score)}</td>
        <td class="num faint" title="${fmt.time(row.played_at)}">${fmt.ago(row.played_at)}</td>
      </tr>`;
    }).join("");
  }

  function gameBoard(game) {
    loadGameBoard(game);
    refreshEvery(() => loadGameBoard(game), 60000);
  }

  // 게임이 끝났을 때 점수를 팀 기록으로 올리고, 결과 문구를 overlay의 버튼 위에 붙인다.
  async function reportScore(game, score, overlay) {
    const note = document.createElement("div");
    note.className = "small";
    overlay.insertBefore(note, overlay.querySelector("button"));
    const user = await me;
    if (!user) { note.textContent = "로그인하면 팀 순위에 기록됩니다."; return; }
    if (score <= 0) return;
    const r = await api(`/api/games/${game}/score`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ score }),
    });
    if (!r.ok) { note.textContent = "점수를 기록하지 못했습니다."; return; }
    note.textContent = `${user.team} 팀 ${r.body.rank}위 · 팀 최고 ${fmt.int(r.body.team_best)}점`;
    loadGameBoard(game);
  }

  window.IBA = { icon, esc, fmt, api, me, nextPath, authLink, boardRows, refreshEvery, gameBoard, reportScore };
  // defer 스크립트는 파싱 완료 뒤 실행된다. 다음 DOMContentLoaded까지 미루면
  // Chromium이 셸 적용 전 화면을 페이지 전환용으로 캡처할 수 있다.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderShell, { once: true });
  else renderShell();
})();
