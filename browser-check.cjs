// DOM과 Canvas 모형에서 키 입력·일시정지·완주·재시작 연결을 검증한다. 실행: node browser-check.cjs
const assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs");
const nodes = new Map(),
  events = {},
  context = new Proxy(
    {
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
    },
    { get: (o, k) => o[k] || (() => {}) },
  );
function node(id) {
  if (!nodes.has(id))
    nodes.set(id, {
      textContent: "",
      innerHTML: "",
      style: {},
      dataset: {},
      classList: { add() {}, remove() {} },
      querySelector: (selector) => node(id + selector),
      setAttribute() {},
      getBoundingClientRect: () => ({ width: 1200, height: 580 }),
      getContext: () => context,
    });
  return nodes.get(id);
}
let nextFrame;
// Web Audio 경계만 대체한다. 실제 soundFrame의 음량·주파수 출력과 상태 전환을 확인한다.
class AudioParam {
  value = 0;
  setValueAtTime(value) {
    assert(Number.isFinite(value));
    this.value = value;
  }
  setTargetAtTime(value) { this.setValueAtTime(value); }
  exponentialRampToValueAtTime(value) { this.setValueAtTime(value); }
}
class AudioNode {
  gain = new AudioParam();
  frequency = new AudioParam();
  Q = new AudioParam();
  connect() {}
  start() {}
  stop() {}
}
class AudioContext {
  currentTime = 0;
  sampleRate = 48000;
  destination = {};
  resume() {}
  createOscillator() { return new AudioNode(); }
  createGain() { return new AudioNode(); }
  createBiquadFilter() { return new AudioNode(); }
  createBufferSource() { return new AudioNode(); }
  createBuffer(channels, length) {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
}
const sandbox = {
  console,
  Math,
  Path2D: class {
    moveTo() {}
    quadraticCurveTo() {}
    bezierCurveTo() {}
    closePath() {}
    rect() {}
    ellipse() {}
  },
  devicePixelRatio: 1,
  Coast: require("./engine.js"),
  Track: require("./track.js"),
  localStorage: { getItem: () => null, setItem() {} },
  document: {
    querySelector: () => node("race"),
    getElementById: node,
    querySelectorAll: () => [],
  },
  window: {
    AudioContext,
    matchMedia: () => ({ matches: false }),
    addEventListener: (name, fn) => (events[name] = fn),
  },
  ResizeObserver: class {
    observe() {}
  },
  requestAnimationFrame: (fn) => (nextFrame = fn),
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname + "/game.js", "utf8"), sandbox);
node("start").onclick();
for (let t = 0; t < 3200; t += 50) nextFrame(t);
events.keydown({ key: "ArrowUp", preventDefault() {} });
for (let t = 3200; t < 8000; t += 50) nextFrame(t);
assert(Number(node("speed").textContent) > 0, "Browser input must accelerate.");
node("pause").onclick();
assert.equal(node("pause").textContent, "▶");
node("start").onclick();
assert.equal(node("pause").textContent, "Ⅱ");
events.keydown({ key: "ArrowUp", preventDefault() {} });
for (let t = 8000; t < 200000; t += 50) nextFrame(t);
assert.match(
  node("start").innerHTML,
  /RACE AGAIN/,
  "Finish must expose restart.",
);
node("start").onclick();
assert.equal(node("speed").textContent > 0, true);
nextFrame(200050);
assert.equal(Number(node("speed").textContent), 0, "Restart must reset speed.");
const run = (code) => vm.runInContext(code, sandbox);
node("sound").onclick();
run("mode = 'running'; state.rivals = []; state.speed = 200; Coast.step(state, {' ': true}, 1/60); render(); soundFrame();");
assert(run("boostGain.gain.value > 0"), "Boost must produce audible airflow");
node("sound").onclick();
assert.equal(run("boostGain.gain.value"), 0, "Mute silences boost immediately");
node("sound").onclick();
node("pause").onclick();
run("soundFrame()");
assert.equal(run("boostGain.gain.value"), 0, "Pause silences boost");
node("start").onclick();
run("soundFrame()");
assert(run("boostGain.gain.value > 0"), "Resume restores ongoing boost sound");
run("start(); render(); soundFrame()");
assert.equal(run("boostGain.gain.value"), 0, "Restart clears boost sound");
assert.equal(run("state.turboVisual + state.turboKick"), 0, "Restart clears visual effects");
sandbox.devicePixelRatio = 3;
node("race").getBoundingClientRect = () => ({ width: 320, height: 560 });
run("resize(); render()");
assert.equal(node("race").width, 960, "High-density small screens retain sharp canvas edges");
node("race").getBoundingClientRect = () => ({ width: 3840, height: 2160 });
run("resize(); render()");
assert(node("race").width * node("race").height <= 8000001,
  "Large high-density screens must stay inside the pixel budget");
console.log(
  "PASS: canvas render calls, keyboard input, pause/resume, finish UI, restart, boost audio/mute/reset, high-DPI budget",
);
