// 부스트 전환과 조향 응답의 회귀 검증. 실행: node handling-check.cjs
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { create, step } = require("./engine.js");

function straight(speed = 200) {
  return Object.assign(create(), { speed, rivals: [] });
}
function drive(s, keys, seconds, hz = 60) {
  for (let i = 0; i < Math.round(seconds * hz); i++) step(s, keys, 1 / hz);
}

test("boost delivers a strong launch within the first 100 ms", () => {
  const s = straight(180);
  drive(s, { ArrowUp: true, " ": true }, 0.1);
  assert(s.speed > 220, "Launch should be felt immediately, before top speed");
  assert(s.boost < 6, "One press spends one charge");
});

test("turbo expiry preserves momentum then settles to cruising speed", () => {
  const s = straight(320);
  s.turbo = 0.01;
  s.turboTier = 3;
  step(s, { ArrowUp: true }, 1 / 60);
  assert(s.speed > 310 && s.speed < 320, "No one-frame speed cliff");
  drive(s, { ArrowUp: true }, 1);
  assert.equal(s.speed, 225, "Residual boost must not last indefinitely");
});

test("braking still slows the kart during turbo and its exit", () => {
  for (const turbo of [0, 1]) {
    const s = straight(300);
    s.turbo = turbo;
    s.turboTier = turbo ? 3 : 0;
    drive(s, { ArrowUp: true, ArrowDown: true }, 0.1);
    assert(s.speed < 290, "Brake must win over accelerator and turbo");
  }
});

test("steering bites quickly, countersteers promptly, and grips after release", () => {
  const s = straight(225);
  drive(s, { ArrowUp: true, ArrowRight: true }, 0.05);
  assert(s.vx > 0.6, "Short taps must move the kart decisively");
  drive(s, { ArrowUp: true, ArrowLeft: true }, 0.05);
  assert(s.vx < -0.3, "Countersteering should catch the slide promptly");
  const x = s.x;
  step(s, { ArrowUp: true }, 1 / 60);
  assert(s.x < x && s.vx < 0, "Release retains a brief tail of momentum");
  drive(s, { ArrowUp: true }, 0.3);
  assert(Math.abs(s.vx) < 0.025, "Release should regain grip quickly");
});

test("boost adds steering weight without removing directional control", () => {
  const normal = straight(225), boosted = straight(225);
  boosted.turbo = 1;
  boosted.turboTier = 3;
  drive(normal, { ArrowRight: true }, 0.1);
  drive(boosted, { ArrowRight: true }, 0.1);
  assert(boosted.vx > 0.5 && boosted.vx < normal.vx);
});

test("handling remains consistent at 30, 60 and 120 Hz", () => {
  const runs = [30, 60, 120].map((hz) => {
    const s = straight(180);
    drive(s, { ArrowUp: true, ArrowRight: true, " ": true }, 0.2, hz);
    drive(s, { ArrowUp: true, ArrowLeft: true }, 0.2, hz);
    drive(s, { ArrowUp: true }, 0.3, hz);
    return s;
  });
  for (const s of runs) {
    assert(Math.abs(s.x - runs[1].x) < 0.035);
    assert(Math.abs(s.speed - runs[1].speed) < 3);
  }
});

test("holding boost never retriggers and restart clears boost effects", () => {
  const s = straight();
  s.boost = 100;
  drive(s, { " ": true }, 2.2);
  assert.equal(s.turbo, 0);
  assert(s.boost > 74 && s.boost < 75);
  step(s, {}, 1 / 60);
  step(s, { " ": true }, 1 / 60);
  assert(s.turbo > 0);
  const fresh = create();
  assert.equal(fresh.turbo, 0);
  assert.equal(fresh.speed, 0);
});
