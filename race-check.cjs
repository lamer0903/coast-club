// 주행 정책 비교 검증: 조향/드리프트의 효과, 프레임 속도 차이, 충전 취소, 원근 좌표. 실행: node race-check.cjs
const assert = require("node:assert/strict");
const E = require("./engine.js"),
  T = require("./track.js");
function race(policy, dt = 1 / 60) {
  const s = E.create();
  let off = 0;
  for (let i = 0; i < 240 / dt && !s.done; i++) {
    const bend = E.curve(s.z),
      need =
        bend * (s.speed / 225) ** 2 * 1.15 +
        (bend * 0.2 - s.x) * 3 -
        s.vx * 0.15;
    const dir = need > 0.12 ? 1 : need < -0.12 ? -1 : 0;
    E.step(
      s,
      {
        ArrowUp: true,
        ArrowRight: policy !== "idle" && dir === 1,
        ArrowLeft: policy !== "idle" && dir === -1,
        Shift: policy === "drift" && Math.abs(bend) > 0.2 && s.drift < 1.35,
      },
      dt,
    );
    if (Math.abs(s.x) > 1.04) off += dt;
  }
  assert(s.done, "Race must be completable");
  assert.equal(s.lapTimes.length, E.LAPS);
  assert(Math.abs(s.lapTimes.reduce((a, b) => a + b, 0) - s.time) < 1e-8);
  return {
    time: s.time,
    place: 1 + s.rivals.filter((r) => r.z > s.z).length,
    off,
  };
}
const idle = race("idle"),
  steer = race("steer"),
  drift = race("drift");
assert(idle.place > 1 && idle.off > 0, "Acceleration alone must not win");
assert(
  steer.time < idle.time * 0.8,
  "Steering must materially improve lap times",
);
assert(
  drift.time < steer.time - 0.5,
  "Corner exit turbos must reward practiced driving",
);
assert(
  Math.abs(race("steer", 1 / 30).time - steer.time) < 1,
  "30 and 60 Hz driving should remain comparable",
);
let s = E.create();
s.rivals = [];
s.z = 3800;
s.speed = 200;
for (let i = 0; i < 48; i++)
  E.step(s, { ArrowUp: true, ArrowRight: true, Shift: true }, 1 / 60);
E.step(s, { ArrowUp: true, ArrowLeft: true, Shift: true }, 1 / 60);
assert.equal(s.drift, 0, "Reversing drift direction cancels charge");
assert.equal(s.turbo, 0);
s = E.create();
s.rivals = [];
s.speed = 200;
s.z = 3800;
s.x = 1.2;
E.step(s, { ArrowUp: true, ArrowRight: true, Shift: true }, 1 / 60);
assert.equal(s.drift, 0, "No offroad charging");
s = E.create();
s.rivals = [];
s.speed = 200;
E.step(s, { ArrowUp: true, ArrowRight: true, Shift: true }, 1 / 60);
assert.equal(s.drift, 0, "No straight-line charging");
for (const width of [390, 1200]) {
  const center = T.project(4000, 0, 4000, 0.3, width, 580),
    edge = T.project(4000, 1, 4000, 0.3, width, 580);
  assert(
    Math.abs(edge.x - center.x - center.w) < 1e-8,
    "Track edge and kart use the same lateral scale",
  );
  assert(Math.abs(center.y - 580 * 0.84) < 1e-8);
}
assert.equal(T.curve(3800), T.curve(3800 + T.LENGTH));
console.log(
  "PASS: balance, drift cancellation, lap timing, shared projection, frame rates",
);
console.table({ idle, steer, drift });
