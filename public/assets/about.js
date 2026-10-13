// One reversible timeline per case. Front/back visibility follows the actual angle,
// including reversals, so controls never remain active on the hidden face.
(() => {
  const scene = document.querySelector('.cd-scene');
  if (!scene) return;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = matchMedia('(max-width: 700px)');
  const live = scene.querySelector('.cd-state-live');
  const states = [...scene.querySelectorAll('[data-cd]')].map(node => ({
    node,
    front: node.querySelector('.cd-front'),
    back: node.querySelector('.cd-back'),
    frontButton: node.querySelector('.cd-front-toggle'),
    backButton: node.querySelector('.cd-back-toggle'),
    direction: node.dataset.side === 'left' ? 1 : -1,
    progress: 0, from: 0, target: 0, started: 0, duration: 0,
    backVisible: false,
  }));
  let desired = null;
  let frame = 0;
  let suspended = false;
  let lastAnnouncement = '';
  const restAngle = () => mobile.matches ? 16 : 48;
  const angle = state => restAngle() * (1 - state.progress) + 180 * state.progress;
  const ease = t => (1 - Math.cos(Math.PI * t)) / 2;

  function sample(state, now) {
    if (state.progress === state.target) return;
    const t = state.duration ? Math.max(0, Math.min(1, (now - state.started) / state.duration)) : 1;
    state.progress = t === 1 ? state.target : state.from + (state.target - state.from) * ease(t);
  }

  function render(state) {
    const p = state.progress;
    // Keep the projected silhouette centered as its near and far edges change
    // size. This is derived from the current pose, never accumulated.
    const radians = state.direction * angle(state) * Math.PI / 180;
    const halfWidth = (state.caseWidth || 0) / 2;
    const distance = 2200 - 52 * p;
    const depth = halfWidth * Math.sin(radians) / distance;
    const centering = halfWidth * halfWidth * Math.cos(radians) * Math.sin(radians) / (distance * (1 - depth * depth));
    state.node.style.setProperty('--case-centering', `${centering}px`);
    state.node.style.setProperty('--pose-yaw', `${state.direction * restAngle() * (1 - p)}deg`);
    state.node.style.setProperty('--flip-yaw', `${state.direction * 180 * p}deg`);
    state.node.style.setProperty('--advance', `${52 * p}px`);
    state.node.classList.toggle('is-active', state === desired);
    state.node.classList.toggle('is-turning', p !== state.target || (p > 0 && p < 1));
    state.frontButton.setAttribute('aria-expanded', String(state === desired));
    state.backButton.setAttribute('aria-expanded', String(state === desired));
    const backVisible = angle(state) > 90;
    if (backVisible !== state.backVisible) {
      const previousFace = state.backVisible ? state.back : state.front;
      const moveFocus = previousFace.contains(document.activeElement);
      state.front.inert = backVisible;
      state.back.inert = !backVisible;
      state.front.setAttribute('aria-hidden', String(backVisible));
      state.back.setAttribute('aria-hidden', String(!backVisible));
      state.frontButton.tabIndex = backVisible ? -1 : 0;
      state.backButton.tabIndex = backVisible ? 0 : -1;
      state.backVisible = backVisible;
      if (moveFocus) (backVisible ? state.backButton : state.frontButton).focus({ preventScroll: true });
    }
  }

  function retarget(state, target, now) {
    if (state.target === target) return;
    sample(state, now);
    state.from = state.progress;
    state.target = target;
    state.started = now;
    state.duration = reduceMotion.matches ? 0 : Math.max(160, 680 * Math.abs(target - state.progress));
    if (!state.duration) state.progress = target;
  }

  function tick(now) {
    frame = 0;
    states.forEach(state => sample(state, now));
    // Wait only until the previous back has turned out of view. Its return can
    // finish alongside the next flip, without showing two biographies at once.
    if (desired && !states.some(state => state !== desired && angle(state) > 90)) {
      retarget(desired, 1, now);
    }
    states.forEach(render);
    const busy = states.some(state => state.progress !== state.target) || (desired && desired.target !== 1);
    if (busy) {
      if (!suspended) frame = requestAnimationFrame(tick);
    } else {
      const message = desired ? `${desired.node.dataset.cd} 뒷면 소개가 표시되었습니다.` : '';
      if (message !== lastAnnouncement) {
        live.textContent = message;
        lastAnnouncement = message;
      }
    }
  }

  function select(state) {
    const now = performance.now();
    states.forEach(item => sample(item, now));
    desired = desired === state ? null : state;
    states.forEach(item => { if (item !== desired) retarget(item, 0, now); });
    if (frame) cancelAnimationFrame(frame);
    tick(now);
  }

  function measure() {
    states.forEach(state => {
      const height = mobile.matches ? state.node.clientWidth * 420 / 480 : state.node.clientHeight * .95;
      state.caseWidth = height * 480 / 420;
      state.node.style.setProperty('--case-height', `${height}px`);
      state.node.style.setProperty('--case-width', `${state.caseWidth}px`);
      render(state);
    });
  }

  states.forEach(state => {
    state.frontButton.addEventListener('click', () => select(state));
    state.backButton.addEventListener('click', () => select(state));
    state.node.addEventListener('keydown', event => {
      if (event.key === 'Escape' && desired) {
        event.preventDefault();
        event.stopPropagation();
        select(desired);
      }
    });
  });
  const observer = new ResizeObserver(measure);
  states.forEach(state => observer.observe(state.node));
  mobile.addEventListener('change', measure);
  reduceMotion.addEventListener('change', () => {
    if (reduceMotion.matches) {
      states.forEach(state => { state.progress = state.from = state.target = state === desired ? 1 : 0; });
    }
    if (frame) cancelAnimationFrame(frame);
    tick(performance.now());
  });
  window.addEventListener('pagehide', () => {
    suspended = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    observer.disconnect();
  });
  window.addEventListener('pageshow', () => {
    suspended = false;
    states.forEach(state => observer.observe(state.node));
    measure();
    if (!frame) tick(performance.now());
  });
  measure();
})();
