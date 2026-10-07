// 좌상단 메뉴 버튼과 호버 사이드바. 랜딩은 마크업이 HTML에 있고, 본문 페이지는 app.js가 같은 마크업을 그린다.
(function () {
  // Chromium은 느린 탐색 등에서 네이티브 전환을 생략할 수 있다.
  // 준비된 새 화면에만 짧은 페이드를 적용하고, 네이티브 전환과 겹치지 않는다.
  window.addEventListener("pagereveal", (event) => {
    if (event.viewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement;
    root.classList.add("page-enter");
    const clear = () => root.classList.remove("page-enter");
    document.body.addEventListener("animationend", (event) => {
      if (event.animationName === "page-reveal") clear();
    }, { once: true });
    setTimeout(clear, 500);
  });

  function init() {
    const zone = document.getElementById("menuZone");
    if (!zone) return;
    const btn = document.getElementById("menuBtn");
    const sidebar = document.getElementById("sidebar");

    // 호버로 열리지만, 클릭하면 고정(핀)되어 커서를 빼도 닫히지 않는다.
    let pinned = false;
    let suspended = false;

    const isOpen = () => !suspended && (pinned || zone.matches(":hover, :focus-within"));
    const sync = () => {
      const open = isOpen();
      document.body.classList.toggle("menu-open", open);
      btn.setAttribute("aria-expanded", String(open));
      btn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    };

    const closeOnRestore = () => {
      pinned = false;
      suspended = true;
      // 복원된 화면에서는 닫힘 애니메이션 없이 즉시 닫는다.
      document.body.classList.add("menu-navigation");
      if (zone.contains(document.activeElement)) document.activeElement.blur();
      sync();
      // 즉시 닫힌 상태를 확정한 뒤 평소의 열고 닫기 모션을 복구한다.
      void sidebar.offsetWidth;
      document.body.classList.remove("menu-navigation");
    };
    // 떠나는 화면의 메뉴는 유지하고, 뒤로가기로 BFCache에서 복원될 때만 닫는다.
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) closeOnRestore();
    });
    zone.addEventListener("pointerenter", () => { suspended = false; sync(); });
    zone.addEventListener("pointerleave", sync);
    zone.addEventListener("focusin", () => { suspended = false; sync(); });
    zone.addEventListener("focusout", () => requestAnimationFrame(sync));

    btn.addEventListener("click", () => { suspended = false; pinned = !pinned; sync(); });

    // 고정된 상태에서 사이드바 밖을 누르면 바로 닫는다. 버튼에 남은 포커스도 함께 풀어야
    // :focus-within 때문에 열린 채로 남지 않는다.
    document.addEventListener("pointerdown", (e) => {
      if (zone.contains(e.target)) return;
      pinned = false;
      if (zone.contains(document.activeElement)) document.activeElement.blur();
      sync();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      pinned = false;
      btn.blur();
      if (sidebar.contains(document.activeElement)) btn.focus();
      sync();
    });

    sync();
  }

  // app.js가 DOMContentLoaded에서 메뉴를 그리므로, 아직 없으면 그 뒤에 붙는다.
  if (document.getElementById("menuZone")) init();
  else document.addEventListener("DOMContentLoaded", init);
})();
