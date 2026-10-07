// 관리자 페이지. 관리자 계정으로 로그인했을 때만 내용을 보여 주고, 모든 작업은 /api/admin/*로 한다.
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const { api, esc, fmt } = window.IBA;
  const STATUS = { ready: "준비 (시작 전)", open: "진행 중", final: "결과 공개 (마감)" };
  const DAY = 86400000;

  const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  function errMsg(r) {
    const b = r.body || {};
    if (b.message) return b.message;
    if (typeof b.detail === "string") return b.detail;
    if (r.status === 422) return "입력값이 올바르지 않습니다.";
    return `HTTP ${r.status}`;
  }
  // 한국 시간 기준 오늘 날짜(YYYY-MM-DD)
  const todayKst = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  // 마지막 날 다음 날 0시(KST)
  const finalAt = (end) => new Date(new Date(end + "T00:00:00+09:00").getTime() + DAY);
  const rmse = (v) => fmt.rmse(v);

  let contest = null;  // /api/contest 응답

  // --- 탭 ---------------------------------------------------------------------
  const loaders = {};
  function showTab() {
    const id = (location.hash || "#overview").slice(1);
    const name = loaders[id] ? id : "overview";
    document.querySelectorAll(".admin-panel").forEach((p) => { p.hidden = p.id !== "tab-" + name; });
    document.querySelectorAll(".admin-tabs a").forEach((a) => {
      if (a.getAttribute("href") === "#" + name) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    });
    loaders[name]();
  }

  async function loadContest() {
    const r = await api("/api/contest");
    if (r.ok) contest = r.body;
    return contest;
  }

  // --- 현황 -------------------------------------------------------------------
  loaders.overview = async () => {
    const r = await api("/api/admin/overview");
    const list = $("#overviewList");
    if (!r.ok) { list.innerHTML = `<li class="msg-error">${esc(errMsg(r))}</li>`; return; }
    const o = r.body;
    const now = Date.now();
    const until = (iso) => {
      const days = Math.ceil((new Date(iso) - now) / DAY);
      return days > 0 ? ` (${days}일 남음)` : "";
    };
    const item = (k, v) => `<li><span class="k">${k}</span><span class="v">${v}</span></li>`;
    list.innerHTML = [
      item("상태", STATUS[o.status]),
      item("시작", fmt.time(o.start_at) + (o.status === "ready" ? until(o.start_at) : "")),
      item("마감", fmt.time(o.final_at) + (o.status !== "final" ? until(o.final_at) : "")),
      item("하루 제출 횟수", `${o.daily_limit}회`),
      item("정답", `${fmt.int(o.answer_rows)}행 · public ${fmt.int(o.public_rows)}행`),
      item("제출", `오늘 ${fmt.int(o.submissions_today)}건 · 전체 ${fmt.int(o.submissions_total)}건 · ${o.submitting_teams}팀`),
      item("가입자", `${fmt.int(o.users)}명 · ${o.teams}팀 (관리자 제외)`),
    ].join("");
    $("#overviewWarn").innerHTML = o.answer_rows === 0
      ? '<p class="msg-warn">정답이 적재되지 않아 채점할 수 없습니다. README의 배포 절차대로 load_answers.py를 실행하세요.</p>' : "";
  };

  // --- 대회 설정과 공지 -----------------------------------------------------------
  loaders.contest = async () => {
    const c = await loadContest();
    if (!c) return;
    const f = $("#contestForm");
    f.start.value = c.start;
    f.end.value = c.end;
    f.daily_limit.value = c.daily_limit;
    $("#noticeForm").date.value = todayKst();
    renderNotices();
  };

  // 저장하기 전에 바뀌는 영향을 문장으로 모은다.
  async function contestImpact(start, end, limit) {
    const now = Date.now();
    const notes = [];
    const nowFinal = now >= finalAt(contest.end).getTime();
    const willFinal = now >= finalAt(end).getTime();
    const willReady = now < new Date(start + "T00:00:00+09:00").getTime();
    if (willFinal && !nowFinal) notes.push("마지막 날이 이미 지나 저장하는 즉시 제출이 막히고 최종 순위가 공개됩니다.");
    if (nowFinal && !willFinal) notes.push("제출이 다시 열리고 리더보드가 public 순위로 돌아갑니다.");
    if (willReady && contest.status === "open") notes.push("시작일이 미래라서 저장하는 즉시 제출이 막힙니다.");
    if (limit < contest.daily_limit) {
      const r = await api("/api/admin/submissions?include_deleted=false");
      if (r.ok) {
        const today = todayKst();
        const perTeam = {};
        r.body.filter((s) => s.submitted_at.slice(0, 10) === today).forEach((s) => { perTeam[s.team] = (perTeam[s.team] || 0) + 1; });
        const over = Object.values(perTeam).filter((n) => n > limit).length;
        if (over > 0) notes.push(`오늘 이미 ${limit}회를 넘겨 제출한 팀이 ${over}팀 있습니다. 이미 낸 제출은 지우지 않습니다.`);
      }
    }
    return notes;
  }

  $("#contestForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = { start: f.start.value, end: f.end.value, daily_limit: Number(f.daily_limit.value) };
    const notes = await contestImpact(body.start, body.end, body.daily_limit);
    if (notes.length && !confirm(notes.join("\n\n") + "\n\n저장할까요?")) return;
    const r = await api("/api/admin/contest", json("PUT", body));
    $("#contestMsg").className = r.ok ? "small msg-ok" : "small msg-error";
    $("#contestMsg").textContent = r.ok ? "저장했습니다." : errMsg(r);
    if (r.ok) await loadContest();
  });

  function renderNotices() {
    const rows = contest.notices;
    $("#noticeEmpty").hidden = rows.length > 0;
    $("#noticeTable").hidden = rows.length === 0;
    $("#noticeTable tbody").innerHTML = rows.map((n) => `
      <tr data-id="${n.id}">
        <td>${n.date}</td>
        <td class="wrap">${esc(n.title)}</td>
        <td><button class="sm" type="button" data-act="edit">수정</button><button class="sm" type="button" data-act="del">삭제</button></td>
      </tr>`).join("");
  }

  $("#noticeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const r = await api("/api/admin/notices", json("POST", { title: f.title.value, date: f.date.value }));
    if (!r.ok) return alert(errMsg(r));
    f.title.value = "";
    await loadContest();
    renderNotices();
  });

  $("#noticeTable").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const id = Number(btn.closest("tr").dataset.id);
    const n = contest.notices.find((x) => x.id === id);
    let r;
    if (btn.dataset.act === "del") {
      if (!confirm(`공지를 지울까요?\n\n${n.title}`)) return;
      r = await api(`/api/admin/notices/${id}`, { method: "DELETE" });
    } else {
      const title = prompt("공지 내용", n.title);
      if (title === null) return;
      const date = prompt("날짜 (YYYY-MM-DD)", n.date);
      if (date === null) return;
      r = await api(`/api/admin/notices/${id}`, json("PUT", { title, date }));
    }
    if (!r.ok) return alert(errMsg(r));
    await loadContest();
    renderNotices();
  });

  // --- 제출 -------------------------------------------------------------------
  loaders.submissions = async () => {
    const f = $("#subFilter");
    const q = new URLSearchParams({ include_deleted: f.include_deleted.checked });
    if (f.team.value.trim()) q.set("team", f.team.value.trim());
    const r = await api(`/api/admin/submissions?${q}`);
    const foot = $("#subFoot");
    if (!r.ok) { foot.textContent = errMsg(r); return; }
    const rows = r.body;
    $("#subEmpty").hidden = rows.length > 0;
    $("#subTable").hidden = rows.length === 0;
    $("#subTable tbody").innerHTML = rows.map((s) => `
      <tr data-id="${s.id}"${s.deleted_at ? ' class="deleted"' : ""}>
        <td class="num">${s.id}</td>
        <td>${esc(s.team)}</td>
        <td>${esc(s.nickname)}</td>
        <td class="num">${rmse(s.public_rmse)}</td>
        <td class="num">${rmse(s.rmse)}</td>
        <td class="num">${fmt.r2(s.r2)}</td>
        <td class="num">${s.negative_clipped ? fmt.int(s.negative_clipped) : ""}</td>
        <td>${fmt.time(s.submitted_at)}</td>
        <td>${s.deleted_at
          ? `<button class="sm" type="button" data-act="restore">복구</button>`
          : `<button class="sm" type="button" data-act="del">삭제</button>`}</td>
      </tr>`).join("");
    const deleted = rows.filter((s) => s.deleted_at).length;
    foot.textContent = `${rows.length}건${deleted ? ` (삭제 ${deleted}건)` : ""} · 최신순. 삭제하면 리더보드와 그날 제출 횟수에서 빠지고, 복구하면 다시 들어갑니다.`;
  };

  $("#subFilter").addEventListener("submit", (e) => { e.preventDefault(); loaders.submissions(); });
  $("#subFilter").include_deleted.addEventListener("change", () => loaders.submissions());

  $("#subTable").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const tr = btn.closest("tr");
    const id = tr.dataset.id;
    let r;
    if (btn.dataset.act === "del") {
      const cells = tr.querySelectorAll("td");
      if (!confirm(`${cells[1].textContent}팀 ${cells[2].textContent}의 제출 #${id}를 삭제할까요?`)) return;
      r = await api(`/api/admin/submissions/${id}`, { method: "DELETE" });
    } else {
      r = await api(`/api/admin/submissions/${id}/restore`, { method: "POST" });
    }
    if (!r.ok) alert(errMsg(r));
    loaders.submissions();
  });

  // --- 사용자 -------------------------------------------------------------------
  let myUsername = null;

  loaders.users = async () => {
    const f = $("#userFilter");
    const q = f.team.value.trim() ? `?team=${encodeURIComponent(f.team.value.trim())}` : "";
    const r = await api(`/api/admin/users${q}`);
    if (!r.ok) { $("#userEmpty").hidden = false; $("#userEmpty").textContent = errMsg(r); return; }
    const rows = r.body;
    $("#userEmpty").hidden = rows.length > 0;
    $("#userTable").hidden = rows.length === 0;
    $("#userTable tbody").innerHTML = rows.map((u) => `
      <tr data-id="${u.id}" data-username="${esc(u.username)}" data-team="${esc(u.team)}">
        <td>${esc(u.username)}${u.is_admin ? ' <span class="tag">관리자</span>' : ""}</td>
        <td>${esc(u.nickname)}</td>
        <td>${esc(u.team)}</td>
        <td>${fmt.time(u.created_at)}</td>
        <td>
          <button class="sm" type="button" data-act="team">팀 변경</button>
          <button class="sm" type="button" data-act="password">임시 비밀번호</button>
          ${u.username === myUsername ? "" : `<button class="sm" type="button" data-act="admin" data-value="${!u.is_admin}">${u.is_admin ? "관리자 해제" : "관리자 지정"}</button>`}
        </td>
      </tr>`).join("");
  };

  $("#userFilter").addEventListener("submit", (e) => { e.preventDefault(); loaders.users(); });

  $("#userTable").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const { id, username, team } = btn.closest("tr").dataset;
    let r;
    if (btn.dataset.act === "team") {
      const next = prompt(`${username}의 새 팀 번호 (지금 ${team}팀)`, team);
      if (next === null || next.trim() === team) return;
      r = await api(`/api/admin/users/${id}`, json("PATCH", { team: next }));
    } else if (btn.dataset.act === "password") {
      if (!confirm(`${username}의 비밀번호를 임시 비밀번호로 바꿀까요? 지금 비밀번호로는 더 이상 로그인할 수 없습니다.`)) return;
      r = await api(`/api/admin/users/${id}/reset-password`, { method: "POST" });
      if (r.ok) prompt(`${username}의 임시 비밀번호입니다. 지금 복사해 전달하세요. 다시 볼 수 없습니다.`, r.body.password);
    } else {
      const grant = btn.dataset.value === "true";
      if (!confirm(grant ? `${username}을(를) 관리자로 지정할까요? 관리자 계정은 대회에 제출할 수 없습니다.` : `${username}의 관리자 권한을 해제할까요?`)) return;
      r = await api(`/api/admin/users/${id}`, json("PATCH", { is_admin: grant }));
    }
    if (!r.ok) alert(errMsg(r));
    loaders.users();
  });

  // --- 채점 확인과 초기화 ------------------------------------------------------------
  let exported = false;

  loaders.tools = async () => {
    const c = await loadContest();
    if (!c) return;
    const phrase = `${c.end} 대회 초기화`;
    $("#resetHint").textContent = `'${phrase}'를 그대로 입력하세요.`;
    $("#resetForm").confirm.placeholder = phrase;
    syncReset();
  };

  $("#checkForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const out = $("#checkResult");
    out.innerHTML = '<p class="small">채점 중…</p>';
    const r = await api("/api/admin/score-check", { method: "POST", body: fd });
    if (!r.ok) {
      const row = r.body && r.body.row ? ` (${r.body.row}행)` : "";
      out.innerHTML = `<p class="msg-error check-result"><strong>거부${row}</strong>: ${esc(errMsg(r))}</p>`;
      return;
    }
    const b = r.body;
    out.innerHTML = `
      <div class="score check-result">
        <div><div class="label">Public RMSE</div><div class="value">${rmse(b.public_rmse)}</div></div>
        <div><div class="label">Public R²</div><div class="value sub">${fmt.r2(b.public_r2)}</div></div>
        <div><div class="label">전체 RMSE</div><div class="value">${rmse(b.rmse)}</div></div>
        <div><div class="label">전체 R²</div><div class="value sub">${fmt.r2(b.r2)}</div></div>
      </div>
      ${b.negative_clipped ? `<p class="msg-warn">음수 예측 ${fmt.int(b.negative_clipped)}건을 0으로 바꿔 채점했습니다.</p>` : ""}`;
  });

  $("#exportBtn").addEventListener("click", () => { exported = true; syncReset(); });

  function syncReset() {
    const f = $("#resetForm");
    const phrase = contest ? `${contest.end} 대회 초기화` : null;
    f.confirm.disabled = !exported;
    $("#resetNote").hidden = exported;
    f.querySelector("button").disabled = !(exported && phrase && f.confirm.value.trim() === phrase);
  }
  $("#resetForm").confirm.addEventListener("input", syncReset);

  $("#resetForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = { confirm: f.confirm.value, delete_games: f.delete_games.checked, delete_users: f.delete_users.checked };
    if (!confirm("정말 초기화할까요? 되돌릴 수 없습니다.")) return;
    const r = await api("/api/admin/reset", json("POST", body));
    const msg = $("#resetMsg");
    if (!r.ok) { msg.className = "small msg-error"; msg.textContent = errMsg(r); return; }
    const d = r.body.deleted;
    msg.className = "small msg-ok";
    msg.textContent = `제출 ${d.submissions}건, 미니게임 점수 ${d.game_scores}건, 사용자 ${d.users}명을 지웠습니다. 대회 설정 탭에서 다음 기수 날짜를 정하세요.`;
    f.confirm.value = "";
    exported = false;
    syncReset();
  });

  // --- 시작 -------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", async () => {
    const user = await window.IBA.me;
    if (!user) { location.replace(window.IBA.authLink("login")); return; }
    if (!user.is_admin) { $("#denied").hidden = false; return; }
    myUsername = user.username;
    $("#admin").hidden = false;
    document.querySelectorAll("[data-reload]").forEach((b) => b.addEventListener("click", () => loaders[b.dataset.reload]()));
    window.addEventListener("hashchange", showTab);
    await loadContest();
    showTab();
  });
})();
