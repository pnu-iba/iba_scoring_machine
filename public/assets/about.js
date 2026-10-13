// 가운데 두 케이스: 누르면 그 자리에 소개 카드가 나타나고, ↶ 버튼이나 Esc로 닫는다.
(() => {
  const spots = [...document.querySelectorAll("[data-cd]")];
  function toggle(spot, open, focus = true) {
    const button = spot.querySelector(".cd-open"), card = spot.querySelector(".cd-card");
    card.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    button.tabIndex = open ? -1 : 0;
    if (focus) (open ? spot.querySelector(".cd-return") : button).focus({ preventScroll: true });
  }
  spots.forEach((spot) => {
    spot.querySelector(".cd-open").addEventListener("click", () => toggle(spot, true));
    spot.querySelector(".cd-return").addEventListener("click", () => toggle(spot, false));
    spot.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !spot.querySelector(".cd-card").hidden) { e.stopPropagation(); toggle(spot, false); }
    });
  });
})();
