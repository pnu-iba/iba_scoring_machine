// 화면 확인용 정적 서버에서만 사용한다. 다른 포트와 배포 환경에서는 실행하지 않는다.
(() => {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || location.port !== '8791') return;
  window.IBA_LOCAL_PREVIEW = true;
  const key = 'iba-local-preview-user';
  const originalFetch = window.fetch.bind(window);
  const reply = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  }));
  window.fetch = (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return originalFetch(input, options);
    // 이 모드의 API 요청은 네트워크로 전달하지 않는다. 비밀번호도 저장하지 않는다.
    if (url.pathname === '/api/me') {
      let user = null;
      try { user = JSON.parse(sessionStorage.getItem(key)); } catch (_) {}
      return reply(user);
    }
    if (url.pathname === '/api/logout') { sessionStorage.removeItem(key); return reply({ ok: true }); }
    if (['/api/signup', '/api/login'].includes(url.pathname)) {
      const body = JSON.parse(options.body || '{}');
      const username = String(body.username || 'guest');
      let previous = null;
      try { previous = JSON.parse(sessionStorage.getItem(key)); } catch (_) {}
      const user = previous?.username === username && url.pathname === '/api/login' ? previous : {
        username, nickname: String(body.nickname || username), team: String(body.team || 'test'),
      };
      sessionStorage.setItem(key, JSON.stringify(user));
      return reply(user);
    }
    return reply({ message: '로컬 화면 테스트에서는 실제 데이터 API를 사용하지 않습니다.' }, 503);
  };
})();
