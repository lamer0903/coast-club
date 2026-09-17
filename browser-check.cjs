// DOM과 Canvas 모형에서 키 입력·일시정지·완주·재시작 연결을 검증한다. 실행: node browser-check.cjs
const assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs");
const nodes = new Map(),
  events = {},
  context = new Proxy(
    { createLinearGradient: () => ({ addColorStop() {} }) },
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
const sandbox = {
  console,
  Math,
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
console.log(
  "PASS: canvas render calls, keyboard input, pause/resume, finish UI, restart",
);
