(() => {
  const viewport = document.getElementById('thanksViewport');
  const world = document.getElementById('thanksWorld');
  if (!viewport || !world) return;

  const info = document.getElementById('thanksPerson');
  const nameLabel = document.getElementById('thanksName');
  const memberLabel = document.getElementById('thanksMember');
  const majorLabel = document.getElementById('thanksMajor');
  const people = {
    '01': ['JEON HYEONG JUN', '10th member', 'Business'],
    '02': ['OH JEONG RIN', '10th member', 'Economics'],
    '03': ['JEONG JAE YEONG', '10th member', 'Industrial Engineering'],
    '04': ['SIM SEONG CHUL', '10th member', 'Industrial Engineering'],
    '05': ['HAN GO EUN', '9th member', 'Business'],
    '06': ['AHN HYEON JUN', '10th member', 'Statistics'],
    '07': ['KIM JI WON', '10th member', 'Statistics'],
    '08': ['LEE JEONG SEO', '10th member', 'Business'],
    '09': ['NO YEONG HUN', '10th member', 'Economics'],
    '10': ['HWANG HYEON SEOK', '10th member', 'Industrial Engineering'],
  };
  const offsets = new Map();
  let plannedOffsets = new Map();
  let layoutFrame = 0;
  let layoutTime = 0;
  let cameraTransition = false;
  const stacked = () => viewport.clientWidth < 700;
  const infoWidth = () => Math.min(stacked() ? 320 : 360, viewport.clientWidth - 32);
  const gap = () => stacked() ? 24 : 32;
  const FOCAL = 900;
  const NEAR = 300;
  const THRESHOLD = 6;
  const HORIZONTAL_TURN = 0.0022;
  const VERTICAL_TURN = 0.0019;
  const ORBIT_MIN = 500;
  const ORBIT_MAX = 6000;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const slots = [...world.querySelectorAll('.thanks-slot')];
  const models = new Map(slots.map(slot => [slot, {
    x: parseFloat(slot.style.getPropertyValue('--x')) + slot.offsetWidth / 2 - 725,
    y: parseFloat(slot.style.getPropertyValue('--y')) + slot.offsetHeight / 2 - 500,
    z: Number(slot.dataset.z), width: slot.offsetWidth, height: slot.offsetHeight,
  }]));
  const pointers = new Map();
  const identity = () => ({ w: 1, x: 0, y: 0, z: 0 });
  const horizontalMidpoint = (cameraX, radius) => {
    let left = Infinity;
    let right = -Infinity;
    for (const item of models.values()) {
      const scale = FOCAL / (item.z - 550 + radius);
      left = Math.min(left, (item.x - cameraX - item.width / 2) * scale);
      right = Math.max(right, (item.x - cameraX + item.width / 2) * scale);
    }
    return (left + right) / 2;
  };
  const home = () => {
    const radius = viewport.clientWidth < 700 ? 2300 : 2050;
    let left = -2000;
    let right = 2000;
    for (let i = 0; i < 24; i += 1) {
      const middle = (left + right) / 2;
      if (horizontalMidpoint(middle, radius) > 0) left = middle;
      else right = middle;
    }
    const x = (left + right) / 2;
    return { position: { x, y: 0, z: 550 - radius }, orientation: identity(),
      center: { x, y: 0, z: 550 }, radius };
  };
  let camera = home();
  let selected = null;
  let gesture = null;
  let pinch = null;
  let animation = 0;
  let hoverFrame = 0;
  let hoverTime = 0;
  let hoverLast = null;
  let hoverTarget = null;
  let hoverFrozen = false;
  let gesturePinch = null;
  let suppressClick = false;
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const point = e => { const r = viewport.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const middle = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const snapshot = () => ({ position: { ...camera.position }, orientation: { ...camera.orientation },
    center: { ...camera.center }, radius: camera.radius });

  // Quaternion maps camera-local right/down/forward into fixed world coordinates.
  const mul = (a, b) => ({
    w: a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z,
    x: a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
    y: a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
    z: a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
  });
  const norm = q => { const n = Math.hypot(q.w, q.x, q.y, q.z); return { w:q.w/n, x:q.x/n, y:q.y/n, z:q.z/n }; };
  const axis = (v, a) => { const s = Math.sin(a/2); return { w:Math.cos(a/2), x:v.x*s, y:v.y*s, z:v.z*s }; };
  const rotate = (q, v) => {
    const tx = 2*(q.y*v.z - q.z*v.y), ty = 2*(q.z*v.x - q.x*v.z), tz = 2*(q.x*v.y - q.y*v.x);
    return { x:v.x + q.w*tx + q.y*tz - q.z*ty,
      y:v.y + q.w*ty + q.z*tx - q.x*tz,
      z:v.z + q.w*tz + q.x*ty - q.y*tx };
  };
  const inverse = (q, v) => rotate({ w:q.w, x:-q.x, y:-q.y, z:-q.z }, v);
  const local = (item, view = camera) => inverse(view.orientation, sub(item, view.position));
  const referenceDepth = () => camera.radius;
  // 사진 투영 중심을 위로 옮긴다. 핀치 역투영에도 같은 중심을 사용한다.
  const projectionCenterY = () => viewport.clientHeight / 2 - 36;
  const worldAt = (p, depth, view = camera) => add(view.position, rotate(view.orientation, {
    x:(p.x - viewport.clientWidth/2)*depth/FOCAL,
    y:(p.y - projectionCenterY())*depth/FOCAL, z:depth,
  }));
  function render() {
    if (layoutFrame) cancelAnimationFrame(layoutFrame);
    layoutFrame = 0;
    const now = performance.now();
    const blend = reducedMotion.matches ? 1 : 1 - Math.exp(-Math.min(now - layoutTime || 16, 50) / 140);
    layoutTime = now;
    const cx = viewport.clientWidth/2, cy = projectionCenterY();
    const projected = slots.map(slot => {
      const item = models.get(slot), v = local(item), depth = v.z;
      const scale = FOCAL / Math.max(depth, NEAR);
      return { slot, depth, scale, x:cx + v.x*scale - item.width*scale/2,
        y:cy + v.y*scale - item.height*scale/2, w:item.width*scale, h:item.height*scale };
    });
    const active = projected.find(p => p.slot === selected && p.depth > NEAR);
    if (selected && active) {
      info.hidden = false;
      info.style.width = `${infoWidth()}px`;
      const iw = info.offsetWidth, ih = info.offsetHeight;
      const ix = stacked() ? active.x + (active.w-iw)/2 : active.x + active.w + gap();
      const iy = stacked() ? active.y + active.h + gap() : active.y + (active.h-ih)/2;
      const shift = offsets.get(selected) || {x:0,y:0};
      info.style.transform = `translate3d(${ix+shift.x}px, ${iy+shift.y}px, 0)`;
    } else info.hidden = true;
    let settling = false;
    for (const p of projected) {
      const {slot,depth,scale,w,h} = p;
      let dx = 0, dy = 0;
      const planned = plannedOffsets.get(slot);
      if (selected && planned && slot !== selected) { dx = planned.x; dy = planned.y; }
      const old = offsets.get(slot) || {x:0,y:0};
      const offset = cameraTransition ? old : {x:old.x+(dx-old.x)*blend,y:old.y+(dy-old.y)*blend};
      if (!cameraTransition) {
        if (Math.hypot(dx-offset.x,dy-offset.y) > .2) settling = true;
        else { offset.x=dx; offset.y=dy; }
      }
      offsets.set(slot,offset);
      if (depth <= NEAR) {
        slot.style.opacity = '0'; slot.style.visibility = 'hidden';
        slot.style.pointerEvents = 'none'; slot.tabIndex = -1; continue;
      }
      const opacity = clamp((depth-NEAR)/220, 0, 1);
      slot.style.transform = `translate3d(${p.x+offset.x}px, ${p.y+offset.y}px, 0) scale(${scale})`;
      slot.style.zIndex = String(slot === selected ? 11000 : Math.round(10000-depth));
      slot.style.opacity = String(opacity);
      slot.style.pointerEvents = opacity > .15 ? 'auto' : 'none';
      slot.style.visibility = 'visible'; slot.tabIndex = 0;
    }
    if (settling) layoutFrame = requestAnimationFrame(render);
  }
  // 최종 구도에서 이동할 위치를 한 번 계산해, 카메라 이동 중 회피 방향이 바뀌지 않게 한다.
  const planBackground = view => {
    const result = new Map();
    if (!selected) return result;
    const project = slot => {
      const item=models.get(slot), v=local(item,view), scale=FOCAL/Math.max(v.z,NEAR);
      return {slot,depth:v.z,x:viewport.clientWidth/2+v.x*scale-item.width*scale/2,
        y:projectionCenterY()+v.y*scale-item.height*scale/2,w:item.width*scale,h:item.height*scale};
    };
    const active=project(selected), iw=info.offsetWidth, ih=info.offsetHeight;
    const ix=stacked()?active.x+(active.w-iw)/2:active.x+active.w+gap();
    const iy=stacked()?active.y+active.h+gap():active.y+(active.h-ih)/2;
    const safe={left:Math.min(active.x,ix)-20,top:Math.min(active.y,iy)-20,
      right:Math.max(active.x+active.w,ix+iw)+20,bottom:Math.max(active.y+active.h,iy+ih)+20};
    for (const slot of slots) {
      if (slot===selected) continue;
      const p=project(slot);
      if (p.depth<=NEAR || p.x>=safe.right || p.x+p.w<=safe.left || p.y>=safe.bottom || p.y+p.h<=safe.top) continue;
      const moves=[{x:safe.left-p.x-p.w,y:0},{x:safe.right-p.x,y:0},
        {x:0,y:safe.top-p.y-p.h},{x:0,y:safe.bottom-p.y}]
        .filter(m=>p.x+m.x>=8 && p.x+m.x+p.w<=viewport.clientWidth-8);
      result.set(slot,moves.sort((a,b)=>Math.hypot(a.x,a.y)-Math.hypot(b.x,b.y))[0] || {x:0,y:safe.bottom-p.y});
    }
    return result;
  };
  const stop = () => {
    if (animation) cancelAnimationFrame(animation);
    animation = 0;
    cameraTransition = false;
  };
  const stopHover = () => {
    if (hoverFrame) cancelAnimationFrame(hoverFrame);
    hoverFrame = 0;
    hoverTime = 0;
    hoverTarget = null;
  };
  const setCamera = view => {
    camera = { position:view.position, orientation:norm(view.orientation), center:view.center, radius:view.radius };
    render();
  };
  // An interrupted focus/reset animation can be stopped at any frame without
  // snapping the rendered camera onto its next orbit.
  const reconcileOrbit = () => {
    camera.center = add(camera.position, rotate(camera.orientation,{ x:0, y:0, z:camera.radius }));
  };
  const slerp = (a,b,t) => {
    let end = b, dot = a.w*b.w+a.x*b.x+a.y*b.y+a.z*b.z;
    if (dot < 0) { dot = -dot; end = { w:-b.w, x:-b.x, y:-b.y, z:-b.z }; }
    if (dot > .9995) return norm({ w:a.w+(end.w-a.w)*t, x:a.x+(end.x-a.x)*t, y:a.y+(end.y-a.y)*t, z:a.z+(end.z-a.z)*t });
    const angle = Math.acos(clamp(dot,-1,1)), sin = Math.sin(angle);
    const u = Math.sin((1-t)*angle)/sin, v = Math.sin(t*angle)/sin;
    return { w:a.w*u+end.w*v, x:a.x*u+end.x*v, y:a.y*u+end.y*v, z:a.z*u+end.z*v };
  };
  const animateTo = (target, duration = 700) => {
    stop();
    if (layoutFrame) cancelAnimationFrame(layoutFrame);
    layoutFrame = 0;
    const startOffsets = new Map(slots.map(slot => [slot, {...(offsets.get(slot) || {x:0,y:0})}]));
    const endOffsets = new Map(slots.map(slot => [slot, {...(plannedOffsets.get(slot) || {x:0,y:0})}]));
    const placeOffsets = progress => {
      for (const slot of slots) {
        const a = startOffsets.get(slot), b = endOffsets.get(slot);
        offsets.set(slot, {x:a.x+(b.x-a.x)*progress,y:a.y+(b.y-a.y)*progress});
      }
    };
    if (reducedMotion.matches || duration === 0) { placeOffsets(1); setCamera(target); return; }
    const start = snapshot(), begun = performance.now();
    cameraTransition = true;
    const frame = now => {
      // 카메라와 회피 보정을 하나의 타임라인으로 움직인다. 시작·끝의 속도는 0이다.
      const t = clamp((now-begun)/duration,0,1), e = t*t*t*(t*(t*6-15)+10);
      placeOffsets(e);
      setCamera({ position: {
        x:start.position.x+(target.position.x-start.position.x)*e,
        y:start.position.y+(target.position.y-start.position.y)*e,
        z:start.position.z+(target.position.z-start.position.z)*e,
      }, orientation:slerp(start.orientation,target.orientation,e), center: {
        x:start.center.x+(target.center.x-start.center.x)*e,
        y:start.center.y+(target.center.y-start.center.y)*e,
        z:start.center.z+(target.center.z-start.center.z)*e,
      }, radius:start.radius+(target.radius-start.radius)*e });
      if (t < 1) animation = requestAnimationFrame(frame);
      else { animation = 0; cameraTransition = false; }
    };
    animation = requestAnimationFrame(frame);
  };
  const select = slot => {
    selected = slot;
    if (slot) {
      const [name, member, major] = people[slot.dataset.person];
      nameLabel.textContent = name;
      memberLabel.textContent = member;
      majorLabel.textContent = major;
      info.hidden = false;
      nameLabel.style.fontSize = "";
      info.style.width = `${infoWidth()}px`;
      const size = parseFloat(getComputedStyle(nameLabel).fontSize);
      const available = info.clientWidth;
      if (nameLabel.scrollWidth > available) {
        nameLabel.style.fontSize = `${Math.max(20, size * available / nameLabel.scrollWidth)}px`;
      }
      info.hidden = false;
    } else { info.hidden = true; plannedOffsets = new Map(); }
    for (const item of slots) {
      item.classList.toggle('is-selected', item === slot);
      item.setAttribute('aria-pressed', String(item === slot));
    }
  };
  const reset = (duration = 700) => { stopHover(); select(null); animateTo(home(), duration); };
  const focus = (slot, duration = 800) => {
    stopHover();
    const item = models.get(slot);
    select(slot);
    info.style.width = `${infoWidth()}px`;
    const scale = Math.min(1.55,
      (stacked() ? viewport.clientWidth-40 : viewport.clientWidth-infoWidth()-gap()-64)/item.width,
      (stacked() ? viewport.clientHeight-info.offsetHeight-gap()-100 : viewport.clientHeight*.62)/item.height);
    const safeScale = Math.max(.4, scale);
    const radius = FOCAL/safeScale;
    const shift = stacked()
      ? {x:0,y:(info.offsetHeight+gap())/2/safeScale,z:0}
      : {x:(infoWidth()+gap())/2/safeScale,y:0,z:0};
    const center = add(item, rotate(camera.orientation,shift));
    const position = sub(center, rotate(camera.orientation,{ x:0, y:0, z:radius }));
    const target = { position, orientation:{ ...camera.orientation }, center, radius };
    plannedOffsets = planBackground(target);
    animateTo(target, duration);
  };

  // Rotate around the current scene center. Both axes are camera-local, so a
  // steep orbit cannot turn horizontal input into a world-axis pole reversal.
  const turned = (orientation, dx, dy) => {
    const turn = mul(axis({ x:0,y:1,z:0 }, dx*HORIZONTAL_TURN),
      axis({ x:1,y:0,z:0 }, -dy*VERTICAL_TURN));
    return norm(mul(orientation, turn));
  };
  const drag = (from, to) => {
    const dx = to.x-from.x, dy = to.y-from.y;
    if (!dx && !dy) return;
    const orientation = turned(camera.orientation, dx, dy);
    const position = sub(camera.center, rotate(orientation,{ x:0, y:0, z:camera.radius }));
    setCamera({ position, orientation, center:camera.center, radius:camera.radius });
  };
  const hoverStep = now => {
    const elapsed = hoverTime ? Math.min(now-hoverTime, 50) : 16;
    hoverTime = now;
    const blend = reducedMotion.matches ? 1 : 1-Math.exp(-elapsed/75);
    const orientation = slerp(camera.orientation,hoverTarget,blend);
    const position = sub(camera.center,rotate(orientation,{ x:0, y:0, z:camera.radius }));
    setCamera({ position, orientation, center:camera.center, radius:camera.radius });
    const dot = Math.abs(orientation.w*hoverTarget.w+orientation.x*hoverTarget.x+
      orientation.y*hoverTarget.y+orientation.z*hoverTarget.z);
    hoverFrame = 1-dot > 0.0000001 ? requestAnimationFrame(hoverStep) : 0;
    if (!hoverFrame) {
      const settled = sub(camera.center,rotate(hoverTarget,{ x:0, y:0, z:camera.radius }));
      setCamera({ position:settled, orientation:hoverTarget, center:camera.center, radius:camera.radius });
    }
  };
  const followMouse = (p, buttons) => {
    const previous = hoverLast;
    hoverLast = p;
    if (buttons || !previous) return;
    // Keep a focused photo still until the user returns to the full view.
    if (animation || selected) {
      hoverFrozen = true;
      stopHover();
      return;
    }
    if (hoverFrozen) { hoverFrozen = false; return; }
    const dx = p.x-previous.x, dy = p.y-previous.y;
    if (!dx && !dy) return;
    hoverTarget = turned(hoverTarget || camera.orientation,dx,dy);
    if (!hoverFrame) hoverFrame = requestAnimationFrame(hoverStep);
  };
  const coast = (vx, vy, from) => {
    if (reducedMotion.matches) return;
    const dx = clamp(vx*45,-32,32), dy = clamp(vy*45,-32,32);
    if (Math.hypot(dx,dy) < 1) return;
    const begun = performance.now(); let last = from;
    const frame = now => {
      const t = clamp((now-begun)/220,0,1), e = 1-Math.pow(1-t,3);
      const next = { x:from.x+dx*e, y:from.y+dy*e };
      drag(last,next); last = next;
      animation = t < 1 ? requestAnimationFrame(frame) : 0;
    };
    animation = requestAnimationFrame(frame);
  };
  const zoomAt = (p, depth, baseCamera, anchorPoint, anchorDepth) => {
    let nextDepth = clamp(depth,ORBIT_MIN,ORBIT_MAX);
    if (selected) {
      const item = models.get(selected);
      const maxScale = Math.max(.4, Math.min(1.55,
        (stacked() ? viewport.clientWidth-40 : viewport.clientWidth-infoWidth()-gap()-64)/item.width,
        (stacked() ? viewport.clientHeight-info.offsetHeight-gap()-100 : viewport.clientHeight*.62)/item.height));
      nextDepth = Math.max(nextDepth, baseCamera.radius + FOCAL/maxScale - local(item,baseCamera).z);
    }
    const anchor = worldAt(anchorPoint,anchorDepth,baseCamera);
    const offset = rotate(baseCamera.orientation, {
      x:(p.x-viewport.clientWidth/2)*nextDepth/FOCAL,
      y:(p.y-projectionCenterY())*nextDepth/FOCAL, z:nextDepth,
    });
    let position = sub(anchor,offset);
    if (selected) {
      // 핀치의 포인터 기준점을 유지하되 사진·정보가 화면 밖으로 나가지 않게 제한한다.
      const item = models.get(selected);
      const v = inverse(baseCamera.orientation,sub(item,position));
      const scale = FOCAL / v.z, w = item.width*scale, h = item.height*scale;
      const totalW = stacked() ? Math.max(w,infoWidth()) : w+gap()+infoWidth();
      const totalH = stacked() ? h+gap()+info.offsetHeight : Math.max(h,info.offsetHeight);
      const left = viewport.clientWidth/2+v.x*scale-(stacked() ? totalW/2 : w/2);
      const top = projectionCenterY()+v.y*scale-(stacked() ? h/2 : totalH/2);
      const dx = clamp(left,16,Math.max(16,viewport.clientWidth-totalW-16))-left;
      const dy = clamp(top,16,Math.max(16,viewport.clientHeight-totalH-16))-top;
      position = sub(position,rotate(baseCamera.orientation,{x:dx/scale,y:dy/scale,z:0}));
    }
    const center = add(position,rotate(baseCamera.orientation,{ x:0, y:0, z:nextDepth }));
    const target = { position, orientation:baseCamera.orientation, center, radius:nextDepth };
    plannedOffsets = planBackground(target);
    setCamera(target);
  };
  const startPinch = () => {
    const [a,b] = [...pointers.values()];
    pinch = { center:middle(a,b), distance:Math.max(distance(a,b),1), camera:snapshot(),
      depth:Math.max(referenceDepth(),NEAR+180) };
    gesture = null;
  };
  viewport.addEventListener('pointerenter', e => {
    if (e.pointerType === 'mouse') hoverLast = point(e);
  });
  viewport.addEventListener('pointerleave', e => {
    if (e.pointerType !== 'mouse') return;
    hoverLast = null;
    hoverFrozen = false;
    stopHover();
  });
  viewport.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'touch') gesturePinch = null;
    if (pointers.size === 0) suppressClick = false;
    stopHover();
    stop(); reconcileOrbit();
    const p = point(e); pointers.set(e.pointerId,p); viewport.setPointerCapture(e.pointerId);
    if (pointers.size === 1) gesture = { start:p, last:p, target:e.target.closest('.thanks-slot'),
      moved:false, mouse:e.pointerType === 'mouse', lastTime:performance.now(), vx:0, vy:0 };
    else if (pointers.size === 2) startPinch();
  });
  viewport.addEventListener('pointermove', e => {
    if (e.pointerType === 'mouse') {
      const p = point(e);
      if (pointers.has(e.pointerId)) {
        pointers.set(e.pointerId,p);
        if (gesture?.mouse && distance(p,gesture.start) >= THRESHOLD) gesture.moved = true;
      }
      followMouse(p,e.buttons || gesture?.mouse);
      return;
    }
    if (!pointers.has(e.pointerId)) return;
    const p = point(e); pointers.set(e.pointerId,p);
    if (pointers.size >= 2 && pinch) {
      const [a,b] = [...pointers.values()], mid = middle(a,b);
      const depth = clamp(pinch.depth/(distance(a,b)/pinch.distance),ORBIT_MIN,ORBIT_MAX);
      zoomAt(mid,depth,pinch.camera,pinch.center,pinch.depth);
      return;
    }
    if (!gesture) return;
    if (!gesture.moved && distance(p,gesture.start) < THRESHOLD) return;
    gesture.moved = true; viewport.classList.add('is-dragging');
    const now = performance.now(), elapsed = Math.max(now-gesture.lastTime,1);
    gesture.vx = (p.x-gesture.last.x)/elapsed; gesture.vy = (p.y-gesture.last.y)/elapsed;
    drag(gesture.last,p); gesture.last = p; gesture.lastTime = now;
  });
  const endPointer = (e,cancelled = false) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId); viewport.classList.remove('is-dragging');
    if (gesture?.mouse) {
      const moved = gesture.moved || distance(point(e),gesture.start) >= THRESHOLD;
      hoverLast = point(e);
      if (!cancelled && !moved) {
        if (gesture.target) focus(gesture.target);
        else reset();
      }
      suppressClick = moved;
      gesture = null;
      return;
    }
    if (pinch) {
      pinch = null; suppressClick = true;
      if (pointers.size === 1) {
        const p = [...pointers.values()][0];
        gesture = { start:p, last:p, target:null, moved:true, lastTime:performance.now(), vx:0, vy:0 };
      }
      return;
    }
    if (!gesture || cancelled) { gesture = null; return; }
    if (gesture.moved) {
      suppressClick = true;
      const fresh = performance.now()-gesture.lastTime < 80;
      coast(fresh ? gesture.vx : 0, fresh ? gesture.vy : 0, gesture.last);
    } else if (gesture.target) focus(gesture.target);
    else reset();
    gesture = null;
  };
  viewport.addEventListener('pointerup', e => endPointer(e));
  viewport.addEventListener('pointercancel', e => endPointer(e,true));
  viewport.addEventListener('click', e => {
    if (suppressClick) { e.preventDefault(); suppressClick = false; return; }
    if (e.detail !== 0) return;
    const slot = e.target.closest('.thanks-slot'); if (slot) focus(slot);
  });
  // Trackpad pinch is exposed as a ctrl-modified pixel wheel in Chromium.
  // Ordinary wheel/trackpad scrolling continues to scroll the page.
  viewport.addEventListener('wheel', e => {
    if (!e.ctrlKey || e.deltaMode !== 0 || gesturePinch) {
      // Page scrolling changes the viewport's screen position; discard that
      // displacement before interpreting the next actual mouse movement.
      requestAnimationFrame(() => { if (hoverLast) hoverLast = point(e); });
      return;
    }
    e.preventDefault();
    stopHover(); stop(); reconcileOrbit();
    const p = point(e);
    const base = snapshot();
    const depth = base.radius*Math.exp(clamp(e.deltaY,-120,120)*0.0025);
    zoomAt(p,depth,base,p,base.radius);
  }, { passive:false });
  // Safari exposes the same trackpad movement as gesture scale events.
  viewport.addEventListener('gesturestart', e => {
    if (pointers.size) return;
    e.preventDefault();
    stopHover(); stop(); reconcileOrbit();
    gesturePinch = { camera:snapshot(), point:point(e), scale:e.scale || 1 };
  }, { passive:false });
  viewport.addEventListener('gesturechange', e => {
    if (!gesturePinch) return;
    e.preventDefault();
    const scale = Math.max(e.scale/gesturePinch.scale,0.1);
    zoomAt(point(e),gesturePinch.camera.radius/scale,
      gesturePinch.camera,gesturePinch.point,gesturePinch.camera.radius);
  }, { passive:false });
  viewport.addEventListener('gestureend', e => {
    if (!gesturePinch) return;
    e.preventDefault();
    gesturePinch = null;
  }, { passive:false });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.body.classList.contains('menu-open')) {
      e.preventDefault(); reset();
    }
  });
  new ResizeObserver(() => {
    if (selected) focus(selected, 0);
    else render();
  }).observe(viewport);
  document.fonts.ready.then(render);
  select(null); render();
})();
