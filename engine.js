/**
 * 게임 규칙과 물리 계산. DOM이나 Canvas에 접근하지 않아 Node에서도 검증할 수 있다.
 * create()로 상태 생성 → 매 프레임 step(상태, 눌린 키, 경과 초)으로 상태 변경.
 * z/x: 전진·좌우 위치, vx: 좌우 속도, angle/omega: 차체 회전 각도·각속도.
 * speed는 게임 속도이며, 전진 거리에는 초당 speed * 6을 적용한다.
 */
(function (root) {
  const Track =
    typeof module !== "undefined" ? require("./track.js") : root.Track;

  // 경기 길이: 한 바퀴 코스와 총 3바퀴. clamp는 값을 허용 범위 안으로 제한한다.
  const LENGTH = Track.LENGTH,
    LAPS = 3;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const curve = Track.curve;

  // 드리프트 충전 시간(초)에 따른 터보 단계: 0.65 / 1.3 / 2.1초.
  const driftTier = (time) =>
    time >= 2.1 ? 3 : time >= 1.3 ? 2 : time >= 0.65 ? 1 : 0;

  // 라이벌 카트의 초기 위치·질량·목표 속도·외형·운전 숙련도를 정의한다.
  function kart(z, x, mass, speed, targetSpeed, color, animal, skill) {
    return {
      z,
      x,
      vx: 0,
      angle: 0,
      omega: 0,
      mass,
      speed,
      targetSpeed,
      bump: 0,
      impact: 0,
      color,
      animal,
      skill,
    };
  }

  // 새 경기 상태. boost는 잔량(0~100), turbo는 남은 초, lapTimes는 완주한 바퀴별 기록이다.
  function create() {
    return {
      z: 0,
      x: 0,
      vx: 0,
      angle: 0,
      omega: 0,
      mass: 1,
      speed: 0,
      time: 0,
      boost: 35,
      turbo: 0,
      turboTier: 0,
      drift: 0,
      driftTier: 0,
      driftDirection: 0,
      driftHeld: false,
      boostHeld: false,
      lapTimes: [],
      lapStarted: 0,
      bump: 0,
      impact: 0,
      lap: 1,
      done: false,
      rivals: [
        kart(140, -0.52, 1.15, 0, 205, "#e9b257", "bear", 0.78),
        kart(280, 0.4, 0.9, 0, 212, "#9eb8ec", "cat", 0.88),
        kart(420, -0.1, 1.05, 0, 218, "#a6cdb0", "frog", 0.94),
      ],
    };
  }

  // 두 카트가 겹치면 질량과 접근 속도로 충격을 나누고, 겹침을 해소한다. 충돌 여부를 반환한다.
  function collide(a, b) {
    const SCALE_X = Track.HALF_WIDTH,
      RADIUS = 112,
      dx = (a.x - b.x) * SCALE_X,
      dz = a.z - b.z,
      dist = Math.hypot(dx, dz);
    if (dist >= RADIUS * 2) return false;
    const nx = dist ? dx / dist : 1,
      nz = dist ? dz / dist : 0,
      invA = 1 / a.mass,
      invB = 1 / b.mass;
    const avx = a.vx * SCALE_X,
      avz = a.speed * 6,
      bvx = b.vx * SCALE_X,
      bvz = b.speed * 6,
      approach = (avx - bvx) * nx + (avz - bvz) * nz;

    // 서로 접근할 때만 충격을 전달한다. 이미 떨어지는 중이면 추가로 튕기지 않는다.
    if (approach < 0) {
      const impulse = (-(1 + 0.68) * approach) / (invA + invB),
        side = impulse * nx;
      a.vx = (avx + impulse * invA * nx) / SCALE_X;
      b.vx = (bvx - impulse * invB * nx) / SCALE_X;
      a.speed = Math.max(0, (avz + impulse * invA * nz) / 6);
      b.speed = Math.max(0, (bvz - impulse * invB * nz) / 6);
      a.omega = clamp((a.omega || 0) + side * invA * 0.0025, -3, 3);
      b.omega = clamp((b.omega || 0) - side * invB * 0.0025, -3, 3);
      a.impact = b.impact = clamp(-approach / 650, 0.15, 1);
    }

    // 침투한 거리를 나눠 밀어내고 화면 흔들림에 쓸 충돌 상태를 남긴다.
    const correction = ((RADIUS * 2 - dist) * 0.82) / (invA + invB);
    a.x = clamp(a.x + (correction * invA * nx) / SCALE_X, -1.45, 1.45);
    b.x = clamp(b.x - (correction * invB * nx) / SCALE_X, -1.45, 1.45);
    a.z += correction * invA * nz;
    b.z -= correction * invB * nz;
    a.bump = b.bump = 0.5;
    return true;
  }

  // 라이벌의 목표 차선: 코너 안쪽을 지향하고 앞차가 가까우면 옆으로 피한다.
  function aiTarget(s, r) {
    let target = clamp(-curve(r.z + 520) * 0.46, -0.62, 0.62);
    for (const other of [s, ...s.rivals.filter((o) => o !== r)]) {
      const ahead = other.z - r.z;
      if (ahead > 0 && ahead < 520 && Math.abs(other.x - target) < 0.32)
        target += other.x <= target ? 0.42 : -0.42;
    }
    return clamp(
      target + Math.sin(r.z / 1300 + r.targetSpeed) * (0.16 * (1 - r.skill)),
      -0.82,
      0.82,
    );
  }

  // 한 프레임의 액션 처리. dt는 초 단위이며 긴 지연 뒤에도 최대 0.05초만 진행한다.
  function step(s, k, dt) {
    if (s.done) return;
    dt = clamp(dt, 0, 0.05);
    s.time += dt;
    const previousZ = s.z,
      previousTime = s.time - dt;
    const steer = (k.ArrowRight || k.d ? 1 : 0) - (k.ArrowLeft || k.a ? 1 : 0);
    const onRoad = Math.abs(s.x) <= 1.04,
      bend = curve(s.z),
      braking = !!(k.ArrowDown || k.s);

    // 드리프트 시작 조건: 도로 위, 속도 100 초과, 브레이크 없음, 충분한 코너와 같은 방향 조향.
    const validDrift =
      onRoad && s.speed > 100 && !braking && Math.abs(bend) > 0.15;
    if (k.Shift && !s.driftHeld && validDrift && steer === Math.sign(bend))
      s.driftDirection = steer;

    // 충전 중 반대 조향·도로 이탈·감속 등은 취소, Shift를 놓으면 충전 단계에 맞는 터보를 발동한다.
    if (s.driftDirection) {
      if (
        !validDrift ||
        (steer && steer !== s.driftDirection) ||
        Math.sign(bend) !== s.driftDirection
      ) {
        s.drift = s.driftTier = s.driftDirection = 0;
      } else if (!k.Shift) {
        const tier = driftTier(s.drift);
        if (tier) {
          s.turboTier = Math.max(s.turboTier, tier);
          s.turbo = Math.max(s.turbo, [0, 0.9, 1.4, 2][tier]);
        }
        s.drift = s.driftTier = s.driftDirection = 0;
      } else {
        s.drift += dt;
        s.driftTier = driftTier(s.drift);
      }
    }
    s.driftHeld = !!k.Shift;
    const drifting = s.driftDirection !== 0;

    // Space는 새로 누른 순간에만 부스터 30을 소모한다. 누르고 있어도 연속 사용하지 않는다.
    if (k[" "] && !s.boostHeld && s.boost >= 30 && s.turbo <= 0) {
      s.boost -= 30;
      s.turbo = 2;
      s.turboTier = 3;
    }
    s.boostHeld = !!k[" "];
    s.turbo = Math.max(0, s.turbo - dt);
    if (!s.turbo) s.turboTier = 0;
    s.bump = Math.max(0, s.bump - dt);

    // 가속·브레이크·터보를 반영해 속도를 갱신한다. 터보 단계마다 최고 속도가 다르다.
    const accelerating = k.ArrowUp || k.w,
      maxSpeed = s.turbo ? [0, 270, 295, 320][s.turboTier] : 225;
    s.speed = clamp(
      s.speed +
        (accelerating ? 85 : -35) * dt -
        (k.ArrowDown || k.s ? 170 * dt : 0),
      0,
      maxSpeed,
    );
    if (s.turbo)
      s.speed = clamp(s.speed + (110 + s.turboTier * 25) * dt, 0, maxSpeed);

    // 조향에 따른 좌우 이동과 코너 바깥쪽으로 밀리는 힘을 합친다. 차체 회전은 별도로 완만하게 반응한다.
    const desiredVx = (steer * (drifting ? 1.45 : 1.15) * s.speed) / 225;
    s.vx += (desiredVx - s.vx) * Math.min(1, dt * 9);
    s.x += (s.vx - bend * (s.speed / 225) ** 2 * (drifting ? 0.8 : 1.15)) * dt;
    s.omega += (((steer * s.speed) / 225) * 0.7 - s.angle * 2.2) * dt;
    s.omega *= Math.pow(0.13, dt);
    s.angle = clamp(s.angle + s.omega * dt, -0.32, 0.32);

    // 바깥 경계에서는 튕기고, 도로 밖 모래에서는 감속하며 드리프트를 취소한다.
    if (Math.abs(s.x) > 1.45) {
      s.x = clamp(s.x, -1.45, 1.45);
      s.vx *= -0.55;
      s.omega -= Math.sign(s.x) * 1.3;
      s.speed *= 0.82;
      s.bump = 0.35;
      s.impact = 0.5;
    }
    if (Math.abs(s.x) > 1.04) {
      s.speed = Math.min(s.speed, Math.max(85, s.speed - 230 * dt));
      s.drift = s.driftTier = s.driftDirection = 0;
    }

    // 전진 거리를 누적하고 부스터를 초당 2씩 회복한다.
    s.z += s.speed * dt * 6;
    s.boost = clamp(s.boost + dt * 2, 0, 100);

    // 라이벌 가속·차선 선택·회전과 플레이어 충돌을 계산한 뒤, 라이벌끼리의 충돌도 처리한다.
    for (const r of s.rivals) {
      r.bump = Math.max(0, r.bump - dt);
      const cornerSpeed = r.targetSpeed - Math.abs(curve(r.z + 350)) * 22;
      r.speed += clamp(cornerSpeed - r.speed, -100 * dt, 75 * dt);
      const target = aiTarget(s, r),
        desiredVx = clamp((target - r.x) * 1.7, -0.7, 0.7);
      r.vx += (desiredVx - r.vx) * dt * (1.5 + r.skill);
      r.x += r.vx * dt;
      r.omega += (r.vx * 0.5 - r.angle * 2) * dt;
      r.omega *= Math.pow(0.18, dt);
      r.angle = clamp(r.angle + r.omega * dt, -0.25, 0.25);
      if (Math.abs(r.x) > 0.94) {
        r.x = clamp(r.x, -0.94, 0.94);
        r.vx *= -0.45;
        r.omega -= Math.sign(r.x);
      }
      r.z += r.speed * dt * 6;
      if (collide(s, r)) {
        s.turbo = 0;
        s.turboTier = 0;
        s.drift = s.driftTier = s.driftDirection = 0;
      }
    }
    for (let i = 0; i < s.rivals.length; i++)
      for (let j = i + 1; j < s.rivals.length; j++)
        collide(s.rivals[i], s.rivals[j]);

    // 결승선 통과 시점을 프레임 안에서 보간해 랩 시간을 기록한다. 3바퀴가 끝나면 상태를 고정한다.
    const finish = (s.lapTimes.length + 1) * LENGTH;
    if (previousZ < finish && s.z >= finish) {
      const crossing =
        previousTime +
        dt * clamp((finish - previousZ) / (s.z - previousZ), 0, 1);
      s.lapTimes.push(crossing - s.lapStarted);
      s.lapStarted = crossing;
      if (s.lapTimes.length === LAPS) {
        s.done = true;
        s.time = crossing;
        s.z = finish;
      }
    }
    s.lap = Math.min(LAPS, s.lapTimes.length + 1);
  }

  // 브라우저와 Node 검증에서 같은 규칙을 실행하도록 공개한다.
  const api = { LENGTH, LAPS, clamp, curve, driftTier, create, collide, step };
  if (typeof module !== "undefined") module.exports = api;
  else root.Coast = api;
})(globalThis);
