/**
 * 브라우저 화면과 사용자 액션을 연결하는 진입점.
 * 입력 → keys → frame() → Coast.step() → render()/hud()/soundFrame() 순서로 실행된다.
 * 게임 규칙은 engine.js, 코스와 원근 계산은 track.js를 참고한다.
 */

// 화면 요소와 눌린 키를 보관한다. $는 id로 DOM 요소를 찾는 짧은 도우미다.
const canvas = document.querySelector("#race"),
  ctx = canvas.getContext("2d");
const $ = (id) => document.getElementById(id),
  keys = {};

// mode: ready(대기) → countdown(출발) → running(주행) → finished(완주), paused는 일시정지.
let state = Coast.create(),
  mode = "ready",
  last = 0,
  width = 1200,
  height = 580,
  countdown = 0,
  muted = true,
  audio,
  engineTone,
  engineGain,
  engineFilter,
  roadFilter,
  roadGain,
  driftFilter,
  driftGain,
  boostSub,
  boostSubGain,
  audioMaster,
  boostNoise,
  boostFilter,
  boostGain,
  lastImpact = -1,
  lastTier = 0;
const touchDevice = window.matchMedia("(pointer: coarse)").matches;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// Local images load independently; fallback graphics keep the game playable.
const graphics = {};
let graphicsPending = 6, graphicsFailed = false;
for (const [name, file] of Object.entries({
  driver: "dva-kart.png", coast: "busan-coast.png", palm: "coastal-palm.png",
  tracer: "tracer-kart.png", genji: "genji-kart.png", reaper: "reaper-kart.png",
})) {
  const image = new Image();
  graphics[name] = image;
  const settled = (failed) => {
    graphicsFailed ||= failed;
    graphicsPending--;
    $("graphics-status").textContent = graphicsFailed
      ? "일부 그래픽을 불러오지 못했습니다. 기본 그래픽으로 플레이할 수 있습니다. 새로고침으로 다시 시도하세요."
      : graphicsPending ? "실사 그래픽 불러오는 중…" : "";
  };
  image.onload = () => settled(false);
  image.onerror = () => settled(true);
  image.src = `assets/${file}`;
}
const imageReady = (image) => image.complete && image.naturalWidth > 0;

// Sample the same curve as the road once. This is a schematic of one lap;
// the game's procedural course has separate start/end points, not a closed XY loop.
const minimapPoints = [{ x: 0, y: 0 }];
let mapHeading = 0;
for (let z = 0; z < Track.LENGTH; z += 100) {
  mapHeading += Track.curve(z + 50) * 100 / 4000;
  const previous = minimapPoints[minimapPoints.length - 1];
  minimapPoints.push({ x: previous.x + Math.cos(mapHeading) * 100,
    y: previous.y + Math.sin(mapHeading) * 100 });
}
const mapXs = minimapPoints.map(p => p.x), mapYs = minimapPoints.map(p => p.y);
const mapMinX = Math.min(...mapXs), mapMinY = Math.min(...mapYs);
const mapSpanX = Math.max(...mapXs) - mapMinX || 1;
const mapSpanY = Math.max(...mapYs) - mapMinY || 1;
for (const p of minimapPoints) {
  p.x = 14 + (p.x - mapMinX) / mapSpanX * 152;
  p.y = 16 + (p.y - mapMinY) / mapSpanY * 56;
}
$("minimap-route").setAttribute("points", minimapPoints.map(p => `${p.x},${p.y}`).join(" "));
const mapTransform = p => `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})`;
$("minimap-start").setAttribute("transform", mapTransform(minimapPoints[0]));
$("minimap-finish").setAttribute("transform", mapTransform(minimapPoints[minimapPoints.length - 1]));
function minimapPosition(z, finished = false, lane = 0) {
  if (finished) return minimapPoints[minimapPoints.length - 1];
  const index = Track.wrap(z) / 100, i = Math.floor(index), t = index - i;
  const a = minimapPoints[i], b = minimapPoints[i + 1];
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
  // A small lane offset separates racers driving side by side on the same segment.
  const offset = Math.max(-1.2, Math.min(1.2, lane)) * 9;
  return { x: a.x + dx * t - dy / length * offset,
    y: a.y + dy * t + dx / length * offset };
}

// 브라우저 최고 기록을 읽는다. 저장 차단·잘못된 데이터가 있어도 게임은 시작한다.
let records = {};
try {
  const saved = JSON.parse(
    localStorage.getItem("coast-club-records-v2") || "{}",
  );
  for (const key of ["race", "lap", "previous"])
    if (Number.isFinite(saved?.[key]) && saved[key] > 0)
      records[key] = saved[key];
} catch {}

// CSS 크기의 가로·세로 3배로 렌더링한다. 큰 화면은 1600만 픽셀로 제한한다.
function resize() {
  const rect = canvas.getBoundingClientRect();
  width = rect.width;
  height = rect.height;
  const dpr = Math.min(3,
    Math.sqrt(16000000 / Math.max(1, width * height)));
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
}
new ResizeObserver(resize).observe(canvas);

// 공통 그리기 도우미: 둥근 사각형. 좌표와 크기는 현재 Canvas 좌표계 기준이다.
function rounded(x, y, w, h, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

// 공통 그리기 도우미: 중심과 가로·세로 반지름으로 타원을 채운다.
function ellipse(x, y, rx, ry, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

// 공통 그리기 도우미: [x, y] 꼭짓점을 순서대로 연결해 다각형을 채운다.
function poly(points, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
}

// 야자수 외형. s는 원근 배율, lean은 줄기가 기우는 방향이다.
function palm(x, y, s, lean = 1) {
  if (imageReady(graphics.palm)) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s * lean, s);
    ellipse(24, 3, 44, 7, "#26372d30");
    ctx.drawImage(graphics.palm, -52, -172, 112, 172);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ellipse(20, 5, 48, 7, "#264d4330");
  ctx.strokeStyle = "#b68d65";
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(lean * 7, -44, lean * 14, -94);
  ctx.stroke();
  ctx.strokeStyle = "#f4d099";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-2, -3);
  ctx.quadraticCurveTo(lean * 7 - 2, -44, lean * 14 - 2, -94);
  ctx.stroke();
  ctx.strokeStyle = "#805c4455";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let ring = 1; ring < 8; ring++) {
    ctx.moveTo(lean * ring * 1.7 - 4, -ring * 11);
    ctx.lineTo(lean * ring * 1.7 + 4, -ring * 11 - 2);
  }
  ctx.stroke();
  const ribs = new Path2D();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    ctx.fillStyle = i % 2 ? "#44ae83" : "#168b74";
    ctx.beginPath();
    ctx.moveTo(lean * 14, -94);
    ctx.quadraticCurveTo(
      lean * 14 + Math.cos(a) * 30,
      -94 + Math.sin(a) * 15,
      lean * 14 + Math.cos(a) * 53,
      -80 + Math.sin(a) * 26,
    );
    ctx.quadraticCurveTo(
      lean * 14 + Math.cos(a) * 20,
      -106 + Math.sin(a) * 10,
      lean * 14,
      -94,
    );
    ctx.fill();
    ribs.moveTo(lean * 14, -94);
    ribs.quadraticCurveTo(lean * 14 + Math.cos(a) * 30, -94 + Math.sin(a) * 15,
      lean * 14 + Math.cos(a) * 53, -80 + Math.sin(a) * 26);
  }
  ctx.strokeStyle = "#b5e3a080";
  ctx.lineWidth = 1;
  ctx.stroke(ribs);
  ctx.restore();
}

// 카트와 동물 운전자를 그린다. turn은 차체 기울기, turbo는 뒤쪽 불꽃 표시 여부다.
function kart(x, y, s, color, animal, turn = 0, turbo = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.rotate(turn);
  ellipse(7, 12, 49, 13, "#183d4145");
  ellipse(0, 7, 43, 12, "#364d4430");
  if (turbo) {
    const flame = 44 + state.turboVisual * 20 + state.turboKick * 22 +
      Math.sin(state.time * 61) * 8;
    for (const nozzle of [-12, 12]) {
      poly([[nozzle - 11, 0], [nozzle - 6, flame * 0.65],
        [nozzle, flame], [nozzle + 9, flame * 0.4], [nozzle + 11, 0]], "#65def2b0");
      poly([[nozzle - 7, 0], [nozzle, flame * 0.8], [nozzle + 7, 0]], "#ffcd78");
      poly([[nozzle - 4, 0], [nozzle, flame * 0.5], [nozzle + 4, 0]], "#fff9df");
    }
  }
  const sprite = graphics[animal === "dva" ? "driver" : animal];
  if (sprite && imageReady(sprite)) {
    ctx.drawImage(sprite, -53, animal === "tracer" ? -92 : -86, 106, 106);
    if (animal !== "dva" && s > 0.6) {
      rounded(-24, -104, 48, 13, 3, "#0a202de6");
      ctx.fillStyle = "#f1f6f4";
      ctx.font = "600 8px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(animal.toUpperCase(), 0, -95);
    }
    ctx.restore();
    return;
  }
  rounded(-41, -28, 15, 34, 5, "#3e5055");
  rounded(26, -28, 15, 34, 5, "#3e5055");
  // 타이어의 회전 홈과 금속 허브, 낮은 차체 그림자.
  for (const side of [-1, 1]) {
    const tx = side < 0 ? -41 : 26;
    rounded(tx + 2, -26, 11, 30, 4, "#172b35");
    for (let tread = 0; tread < 6; tread++) {
      const ty = -25 + ((tread * 5 + state.z * 0.06) % 29);
      rounded(tx + 2, ty, 11, 1.3, 0.5, "#78909388");
    }
    rounded(tx + (side < 0 ? 0 : 10), -19, 5, 17, 2, "#c1d6ce");
  }
  rounded(-28, -17, 56, 27, 8, "#283d43");
  const paint = ctx.createLinearGradient(-32, -29, 28, 8);
  paint.addColorStop(0, "#fff3dc");
  paint.addColorStop(0.3, color);
  paint.addColorStop(1, "#b6647280");
  rounded(-32, -29, 64, 36, 12, color);
  rounded(-32, -29, 64, 36, 12, paint);
  rounded(-29, -24, 4, 17, 2, "#fff8e9a0");
  rounded(-38, -24, 5, 22, 2, "#8daba5");
  rounded(32, -24, 5, 22, 2, "#8daba5");
  rounded(-24, -34, 48, 14, 6, "#fff6e3");
  rounded(-36, -5, 72, 9, 4, color);
  rounded(-25, -3, 12, 5, 2, "#fff4cb");
  rounded(13, -3, 12, 5, 2, "#fff4cb");
  poly([[-6, -28], [3, -28], [10, 1], [1, 1]], "#fff5dfc0");
  rounded(-25, -10, 50, 5, 2, "#163c4655");
  for (let vent = 0; vent < 5; vent++)
    rounded(-16 + vent * 7, -9, 3, 4, 1, "#132e39");
  for (const nozzle of [-12, 12]) {
    ellipse(nozzle, 6, 6, 4, "#b1c5bf");
    ellipse(nozzle, 6, 4, 2.5, turbo ? "#eaffff" : "#1b3038");
  }
  // 날개와 두 지지대에 별도의 명암을 줘 평평한 실루엣을 분리한다.
  rounded(-25, -30, 4, 14, 1, "#334e54");
  rounded(21, -30, 4, 14, 1, "#334e54");
  rounded(-39, -34, 78, 7, 2, "#29434b");
  rounded(-38, -35, 76, 3, 1, "#e7ede0");
  // 머리·귀·표정만 75%로 줄인다. 목 부근을 기준으로 축소해 카트 위 위치를 유지한다.
  ctx.save();
  ctx.translate(0, -20);
  ctx.scale(0.75, 0.75);
  ctx.translate(0, 20);
  ellipse(0, -36, 19, 18, "#fff6e8");
  if (animal === "dva" || animal === "tracer") {
    ellipse(0, -43, 19, 24, "#3c2928");
    ellipse(0, -35, 12, 15, "#e7ba9d");
    ellipse(0, -51, 16, 11, "#45302c");
    rounded(-20, -43, 7, 16, 3, "#dd85ae");
    rounded(13, -43, 7, 16, 3, "#dd85ae");
  } else if (animal === "genji") {
    ellipse(0, -40, 19, 23, "#9daeb1");
    rounded(-16, -43, 32, 5, 2, "#b5f16d");
  } else {
    ellipse(0, -41, 21, 25, "#242832");
    ellipse(0, -35, 12, 16, "#c7c8c3");
  }
  ellipse(-6, -35, 2, 3, "#3e5055");
  ellipse(6, -35, 2, 3, "#3e5055");
  ellipse(-12, -29, 4, 2, "#f2b5b2");
  ellipse(12, -29, 4, 2, "#f2b5b2");
  ctx.strokeStyle = "#927a6c";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, -31, 3, 0, Math.PI);
  ctx.stroke();
  ctx.restore();
  rounded(-24, -19, 48, 6, 3, "#668d89");
  ctx.restore();
}

// 도로의 원근 좌표를 공유해 해안선·물결·모래가 도로와 함께 움직이게 한다.
function drawCoast(points) {
  // 같은 월드 좌표에서 같은 무늬를 그린다. 정지 중에도 모래가 반짝거리거나 미끄러지지 않는다.
  const shore = (p) => 1.82 + Math.sin(p.z / 850) * 0.1 + Math.sin(p.z / 310) * 0.035;
  const edge = points.map((p) => [p.x - p.w * shore(p), p.y]);
  const sand = ctx.createLinearGradient(0, height * 0.38, width * 0.7, height);
  sand.addColorStop(0, "#cbbda0");
  sand.addColorStop(0.5, "#d8c8a8");
  sand.addColorStop(1, "#bda780");
  poly([[edge[0][0], height * 0.38], ...edge,
    [width * 4, height * 2], [width * 4, height * 0.38]], sand);

  // 얕은 물 → 젖은 모래 → 여러 겹의 포말. 해안선의 굴곡을 그대로 따른다.
  for (const [outer, inner, color] of [
    [0.7, 0.25, "#31cfcb65"], [0.25, 0.05, "#9cebd7b0"],
    [0.05, -0.055, "#bbbd8790"],
  ]) {
    poly([...points.map((p) => [p.x - p.w * (shore(p) + outer), p.y]),
      ...points.slice().reverse().map((p) => [p.x - p.w * (shore(p) + inner), p.y])], color);
  }
  const motionTime = reducedMotion.matches ? 0 : state.time;
  for (let band = 0; band < 3; band++) {
    const waveEdge = (p) => shore(p) + 0.04 + band * 0.15 +
      Math.sin(p.z / 230 - motionTime * 1.4 + band) * 0.045 +
      Math.sin(p.z / 81 + band * 2 - motionTime * 0.6) * 0.014;
    poly([...points.map((p) => [p.x - p.w * waveEdge(p), p.y]),
      ...points.slice().reverse().map((p) => [p.x - p.w * (waveEdge(p) + 0.018 + band * 0.009), p.y])],
      ["#fffce6ee", "#eaffefaa", "#e1fff570"][band]);
  }

  // 같은 재질의 작은 무늬를 묶어서 제출한다. 수백 번의 개별 stroke 호출을 피한다.
  const waterPaths = Array.from({ length: 4 }, () => new Path2D());
  const swells = new Path2D(), foam = new Path2D();
  const sandPaths = [new Path2D(), new Path2D()];
  const sparkles = new Path2D(), grains = new Path2D();
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const spacing = a.scale < 0.18 ? 480 : a.scale < 0.4 ? 240 : width < 700 ? 180 : 120;
    if (Math.floor(a.z / spacing) === Math.floor(b.z / spacing)) continue;
    const phase = Math.floor(a.z / spacing);
    // 긴 물결 아래 어두운 면을 넣어 수면에 얕은 굴곡을 만든다.
    if (a.scale > 0.22) {
      const swellX = a.x - a.w * (shore(a) + 0.42);
      const swellY = a.y + Math.sin(phase + motionTime * 0.7) * a.scale * 2;
      swells.moveTo(swellX - a.w * 2.4, swellY);
      swells.bezierCurveTo(swellX - a.w * 1.6, swellY - a.scale * 6,
        swellX - a.w * 0.6, swellY + a.scale * 3, swellX, swellY);
      for (let spray = 0; spray < 4; spray++) {
        const fx = a.x - a.w * (shore(a) + 0.04 + sceneryRandom(phase * 4 + spray) * 0.13);
        const fy = a.y + sceneryRandom(phase * 7 + spray) * a.scale * 6;
        foam.moveTo(fx + a.scale * 1.8, fy);
        foam.ellipse(fx, fy, a.scale * 1.8, a.scale * 0.8, 0, 0, Math.PI * 2);
      }
    }
    // 가까운 물에는 굽은 잔물결, 먼 물에는 가늘고 조밀한 햇빛 반사.
    for (let col = 0; col < (width < 700 ? 7 : a.scale < 0.3 ? 9 : 13); col++) {
      const x = a.x - a.w * (shore(a) + 0.4 + col * 0.49 + Math.sin(phase * 3) * 0.08);
      if (x < -90 || x > width + 90) continue;
      const shimmer = Math.sin(phase * 2.3 + col * 3.1 + motionTime * 1.8);
      const span = a.w * (0.045 + (shimmer + 1) * 0.025);
      const path = waterPaths[(col % 3 ? 0 : 1) + (a.scale > 0.6 ? 2 : 0)];
      path.moveTo(x - span, a.y);
      path.quadraticCurveTo(x, a.y - a.scale * (2 + shimmer), x + span, a.y);
      if (shimmer > 0.92 && a.scale > 0.3) {
        sparkles.moveTo(x + a.scale * 1.5, a.y);
        sparkles.ellipse(x, a.y, a.scale * 1.5, a.scale * 3, 0, 0, Math.PI * 2);
      }
    }
    // 픽셀보다 작은 먼 모래 무늬는 생략해 수평선의 노이즈와 그리기 비용을 줄인다.
    if (a.scale < 0.18) continue;
    for (let col = 0; col < (width < 700 ? 5 : 9); col++) {
      const side = 1.18 + col * 0.36 + sceneryRandom(phase * 19 + col) * 0.12;
      const x = a.x + a.w * side;
      if (x > width + 90) continue;
      const ripple = Math.sin(phase * 0.8 + col) * a.scale * 4;
      const path = sandPaths[col % 2];
      path.moveTo(x, a.y);
      path.quadraticCurveTo(x + a.w * 0.08, a.y - a.scale * 4 + ripple,
        x + a.w * 0.19, a.y - a.scale * 2);
      const grainX = x + Math.sin(phase + col * 7) * a.w * 0.08;
      grains.moveTo(grainX + Math.max(0.4, a.scale * 1.3), a.y + a.scale * 3);
      grains.ellipse(grainX, a.y + a.scale * 3,
        Math.max(0.4, a.scale * 1.3), Math.max(0.3, a.scale * 0.7), 0, 0, Math.PI * 2);
    }
  }
  ctx.strokeStyle = "#07678222";
  ctx.lineWidth = 2.2;
  ctx.stroke(swells);
  ctx.fillStyle = "#fff8dfb0";
  ctx.fill(foam);
  waterPaths.forEach((path, i) => {
    ctx.strokeStyle = i % 2 ? "#fff3bfba" : "#cefff36b";
    ctx.lineWidth = i < 2 ? 0.7 : 1.6;
    ctx.stroke(path);
  });
  sandPaths.forEach((path, i) => {
    ctx.strokeStyle = i ? "#c28e5140" : "#fff2c77a";
    ctx.lineWidth = 0.8;
    ctx.stroke(path);
  });
  ctx.fillStyle = "#fff9d9d0";
  ctx.fill(sparkles);
  ctx.fillStyle = "#ab79484a";
  ctx.fill(grains);
}

// 코스마다 고정되는 난수. 카메라 이동·재시작 때 지형이 다시 섞이지 않는다.
function sceneryRandom(seed) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

// 일정 간격의 복제 지형 대신 빈 공간과 군집을 섞은, 한 바퀴 분량의 고정 지형.
const desertFeatures = [];
for (let z = 190, i = 0; z < Track.LENGTH; i++) {
  const spread = 0.75 + sceneryRandom(i * 11 + 2) * 1.1;
  desertFeatures.push({
    z, seed: i + 1, spread,
    x: 1.45 + spread * 0.89 + sceneryRandom(i * 11 + 3) * 2.7,
    lift: 32 + sceneryRandom(i * 11 + 4) * 68,
    crest: -75 + sceneryRandom(i * 11 + 5) * 130,
    shoulder: 0.25 + sceneryRandom(i * 11 + 6) * 0.5,
    plantX: 1.22 + sceneryRandom(i * 11 + 7) * 0.9,
    plantOffset: 80 + sceneryRandom(i * 11 + 8) * 320,
  });
  z += 330 + sceneryRandom(i * 11 + 9) * 1120;
}

// 비대칭의 부드러운 능선 안에 경사면의 명암·능선의 빛·바람결을 겹친다.
function dune(x, y, s, terrain) {
  if (x - 240 * s * terrain.spread > width || x + 250 * s * terrain.spread < 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s * terrain.spread, s);
  const { lift, crest, shoulder, seed } = terrain;
  ellipse(32, 4, 215, 10, "#a7713e16");
  const shape = new Path2D();
  shape.moveTo(-230, 6);
  shape.bezierCurveTo(-162, -4, crest - 90, -lift * 0.92, crest, -lift);
  shape.bezierCurveTo(crest + 54, -lift * 1.04, 54, -lift * shoulder, 118, -lift * shoulder);
  shape.bezierCurveTo(164, -lift * shoulder, 180, -9, 246, 6);
  shape.closePath();
  const sand = ctx.createLinearGradient(-90, -lift, 110, 12);
  sand.addColorStop(0, "#e2d4b5");
  sand.addColorStop(0.25, "#d5c49e");
  sand.addColorStop(0.58, "#beaa87");
  sand.addColorStop(1, "#a58e70");
  ctx.fillStyle = sand;
  ctx.fill(shape);
  ctx.save();
  ctx.clip(shape);
  const shade = ctx.createLinearGradient(crest - 20, -lift, 120, 16);
  shade.addColorStop(0, "#ad734e00");
  shade.addColorStop(0.3, "#b3794f12");
  shade.addColorStop(0.68, "#a469484d");
  shade.addColorStop(1, "#c7915510");
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.moveTo(crest, -lift);
  ctx.bezierCurveTo(crest + 52, -lift * 0.76, crest - 25, -lift * 0.15, 86, 12);
  ctx.lineTo(260, 12);
  ctx.lineTo(260, -lift - 15);
  ctx.closePath();
  ctx.fill();
  // 가까운 언덕에만 미세 바람결과 입자를 그리고, 먼 곳은 부드럽게 처리한다.
  if (s > 0.25) {
    const ripples = new Path2D(), specks = new Path2D();
    for (let j = 0; j < 18; j++) {
      const y0 = -lift + j * (lift / 17);
      ripples.moveTo(-220, y0 + 12);
      ripples.bezierCurveTo(-120, y0 - 6, crest - 18, y0 + 9,
        200, y0 + 20 + Math.sin(j * 0.6 + seed) * 6);
    }
    ctx.strokeStyle = "#fff1c438";
    ctx.lineWidth = 0.7;
    ctx.stroke(ripples);
    for (let j = 0; j < 90; j++) {
      const gx = -220 + sceneryRandom(seed * 200 + j) * 465;
      const gy = -lift + sceneryRandom(seed * 300 + j + 95) * (lift + 10);
      specks.rect(gx, gy, 0.8 + sceneryRandom(j + seed) * 1.2, 0.6);
    }
    ctx.fillStyle = "#986b3733";
    ctx.fill(specks);
  }
  ctx.restore();
  ctx.strokeStyle = "#fff3c6b0";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(-230, 6);
  ctx.bezierCurveTo(-162, -4, crest - 90, -lift * 0.92, crest, -lift);
  ctx.bezierCurveTo(crest + 54, -lift * 1.04, 54, -lift * shoulder, 118, -lift * shoulder);
  ctx.stroke();
  ctx.restore();
}

function desertPlant(x, y, s, variant) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ellipse(8, 3, 23, 5, "#92683435");
  poly([[-17, 0], [-13, -10], [0, -15], [14, -6], [19, 2]], "#b98b61");
  poly([[-13, -10], [0, -15], [7, -6], [-3, -3]], "#f3d3a0");
  if (variant % 2 === 0) {
    ctx.strokeStyle = "#698d6b";
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(19, 0);
      ctx.quadraticCurveTo(12 + i * 4, -14, 6 + i * 7, -19 - (i % 2) * 6);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// 코스 옆 랜드마크: 먼 곳에서도 다음 구간을 알아볼 수 있는 등대.
function lighthouse(x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ellipse(28, 4, 68, 12, "#345f5840");
  poly([[-47, 6], [-34, -11], [24, -14], [53, 6]], "#b39870");
  const wall = ctx.createLinearGradient(-23, 0, 25, 0);
  wall.addColorStop(0, "#fff9dd");
  wall.addColorStop(0.45, "#f1e9cf");
  wall.addColorStop(1, "#94b3af");
  poly([[-26, 0], [-17, -133], [17, -133], [26, 0]], wall);
  poly([[-21, -75], [-20, -96], [20, -96], [21, -75]], "#d57b66");
  rounded(-6, -24, 12, 24, 5, "#294e59");
  rounded(-4, -117, 8, 14, 3, "#376675");
  rounded(-24, -139, 48, 6, 2, "#365560");
  rounded(-16, -162, 32, 23, 2, "#84ced0");
  rounded(-3, -162, 5, 23, 0, "#f9d693");
  poly([[-26, -163], [0, -183], [26, -163]], "#c5705e");
  ctx.restore();
}

// 돛배와 물 위 그림자. 주행 시간으로 살짝 흔들며 원근 크기는 호출하는 쪽에서 결정한다.
function sailboat(x, y, size) {
  ctx.save();
  ctx.translate(x, y + Math.sin(state.time * 1.1 + x * 0.01) * size);
  ctx.scale(size, size);
  ellipse(0, 5, 25, 3, "#e6fff39c");
  poly(
    [
      [-20, 0],
      [20, 0],
      [12, 7],
      [-12, 7],
    ],
    "#c87f70",
  );
  ctx.fillStyle = "#776e60";
  ctx.fillRect(-1, -39, 2, 40);
  poly(
    [
      [-3, -38],
      [-3, -4],
      [-22, -4],
    ],
    "#fff5dd",
  );
  poly(
    [
      [3, -30],
      [20, -5],
      [3, -5],
    ],
    "#f0b9a3",
  );
  ctx.restore();
}

// 먼 배경 이동에 쓰는 누적 회전량과 이전 전진 위치. 정차하면 회전량도 늘지 않는다.
let sceneryHeading = 0,
  sceneryZ = 0;

// 한 프레임 그리기: 먼 배경 → 해안 → 도로 → 물체 → 효과 → 출발 숫자.
function render() {
  ctx.save();
  const kick = !reducedMotion.matches && state.turbo ? state.turboKick : 0,
    zoom = reducedMotion.matches ? 1.035 : 1.035 + (state.speed / 320) * 0.02 - state.turboVisual * 0.045,
    shake = reducedMotion.matches ? 0 : (state.bump ? state.impact * 7 : 0) + kick * 1.8;
  ctx.translate(
    width / 2 + Math.sin(state.time * 83) * shake,
    height / 2 + Math.cos(state.time * 71) * shake * 0.45,
  );
  ctx.scale(zoom, zoom);
  ctx.rotate(reducedMotion.matches ? 0 : -state.angle * 0.025);
  ctx.translate(-width / 2, -height / 2);

  // 이동한 거리와 코너 곡률로 배경 회전을 누적한다. 새 경기 시작 때 초기화한다.
  const travelled = state.z - sceneryZ;
  if (state.z === 0) sceneryHeading = 0;
  else
    sceneryHeading +=
      (Track.curve((state.z + sceneryZ) / 2) * travelled) / 4000;
  sceneryZ = state.z;
  const horizon = height * 0.38;

  // 먼 태양·구름·산은 서로 다른 속도로 움직인다. 화면 밖 배경은 반대쪽으로 반복한다.
  const backgroundX = (x, rate) =>
    ((((x - sceneryHeading * rate - state.x * rate * 0.06) % 1) + 1) % 1) *
    width;
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "#348fc5");
  sky.addColorStop(0.5, "#79d1e1");
  sky.addColorStop(1, "#f9e8bc");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
  const sunX = backgroundX(0.2, 0.025), sunY = height * 0.18;
  const sunlight = ctx.createRadialGradient(sunX, sunY, 8, sunX, sunY, 145);
  sunlight.addColorStop(0, "#fffceee6");
  sunlight.addColorStop(0.19, "#fff5c2cc");
  sunlight.addColorStop(0.3, "#ffe8aa4d");
  sunlight.addColorStop(1, "#fff3b800");
  ellipse(sunX, sunY, 145, 145, sunlight);
  ellipse(sunX, sunY, 29, 29, "#fffae4");
  for (const [x, y, s] of [
    [0.18, 0.19, 1],
    [0.47, 0.14, 0.65],
    [0.91, 0.3, 0.75],
  ])
    for (const tile of [-1, 0, 1]) {
      const cx = backgroundX(x, 0.09) + tile * width;
      const cloud = ctx.createLinearGradient(0, height * y - 29 * s, 0, height * y + 14 * s);
      cloud.addColorStop(0, "#fffdf3");
      cloud.addColorStop(0.55, "#f4f6e9ef");
      cloud.addColorStop(1, "#a7d0d4a0");
      const cloudShape = new Path2D();
      cloudShape.moveTo(cx - 68 * s, height * y + 4 * s);
      cloudShape.bezierCurveTo(cx - 57 * s, height * y - 12 * s, cx - 36 * s, height * y - 11 * s, cx - 26 * s, height * y - 9 * s);
      cloudShape.bezierCurveTo(cx - 15 * s, height * y - 39 * s, cx + 20 * s, height * y - 32 * s, cx + 29 * s, height * y - 14 * s);
      cloudShape.bezierCurveTo(cx + 57 * s, height * y - 19 * s, cx + 66 * s, height * y - 3 * s, cx + 73 * s, height * y + 5 * s);
      cloudShape.bezierCurveTo(cx + 52 * s, height * y + 19 * s, cx - 45 * s, height * y + 17 * s, cx - 68 * s, height * y + 4 * s);
      ctx.fillStyle = cloud;
      ctx.fill(cloudShape);
    }
  for (const tile of [-1, 0, 1]) {
    const x = backgroundX(0, 0.2) + tile * width;
    poly(
      [
        [x, horizon],
        [x, horizon - 17],
        [x + width * 0.09, horizon - 45],
        [x + width * 0.19, horizon - 20],
        [x + width * 0.33, horizon - 32],
        [x + width * 0.48, horizon],
      ],
      "#529b9e80",
    );
  }
  const ocean = ctx.createLinearGradient(0, horizon, 0, height);
  ocean.addColorStop(0, "#386378");
  ocean.addColorStop(0.22, "#3f7889");
  ocean.addColorStop(0.6, "#518f94");
  ocean.addColorStop(1, "#7aafa6");
  ctx.fillStyle = ocean;
  ctx.fillRect(0, horizon, width, height - horizon);
  if (imageReady(graphics.coast)) {
    const photo = graphics.coast;
    // Bounded panoramic pan avoids a visible wrap seam during long races.
    const cropWidth = photo.naturalWidth * 0.78;
    const cropX = (photo.naturalWidth - cropWidth) *
      (0.5 + Math.sin(sceneryHeading * 0.35 + state.x * 0.02) * 0.5);
    const waterline = Math.floor(photo.naturalHeight * 0.72);
    ctx.drawImage(photo, cropX, 0, cropWidth, waterline,
      0, 0, width, horizon + 1);
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.drawImage(photo, cropX, waterline, cropWidth, photo.naturalHeight - waterline,
      0, horizon, width, height - horizon);
    ctx.restore();
  }
  // 한낮의 강한 햇빛을 수면 위 여러 개의 작은 반사광으로 분산한다.
  for (let i = 0; i < (width < 700 ? 32 : 64); i++) {
    const depth = i / 64, y = horizon + 3 + depth * depth * height * 0.65;
    const glint = Math.sin(i * 13.7 + (reducedMotion.matches ? 0 : state.time));
    const scatter = Math.sin(i * 127.1 + 31.7) * 43758.5453;
    ellipse(sunX + ((scatter - Math.floor(scatter)) * 2 - 1) * (12 + depth * width * 0.13), y,
      2 + depth * 20 + glint, 0.5 + depth * 0.7, "#fff1c65a");
  }

  // 모든 도로·풍경·카트를 동일한 카메라 위치에서 투영한다.
  const project = (z, x = 0) =>
    Track.project(z, x, state.z, state.x, width, height);

  // 먼 곳부터 가까운 곳까지 도로 단면을 만들고, 같은 점들로 해안선을 그린다.
  const points = [];
  for (let z = Math.ceil((state.z + 6000) / 60) * 60; z >= state.z - 240; z -= 60)
    points.push({ ...project(z), z });
  drawCoast(points);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1],
      stripe = Math.floor(a.z / 150) % 2;
    poly(
      [
        [a.x - a.w * 1.09, a.y],
        [a.x + a.w * 1.09, a.y],
        [b.x + b.w * 1.09, b.y + 1],
        [b.x - b.w * 1.09, b.y + 1],
      ],
      stripe ? "#fff3d4" : "#eb866b",
    );
    poly(
      [
        [a.x - a.w, a.y],
        [a.x + a.w, a.y],
        [b.x + b.w, b.y + 1],
        [b.x - b.w, b.y + 1],
      ],
      stripe ? "#555c5e" : "#535a5c",
    );
    // 노면의 입자는 월드 좌표에 고정해 정차 중 반짝이거나 기어가지 않는다.
    if (a.y > horizon + 24 && a.y < height && b.y > a.y) {
      const asphalt = new Path2D();
      for (let grain = 0; grain < (width < 700 ? 8 : 22); grain++) {
        const seed = a.z * 0.13 + grain * 17;
        const lane = sceneryRandom(seed) * 1.94 - 0.97;
        const depth = sceneryRandom(seed + 8);
        const gx = a.x + (b.x - a.x) * depth + lane * (a.w + (b.w - a.w) * depth);
        const gy = a.y + (b.y - a.y) * depth;
        asphalt.rect(gx, gy, Math.max(0.6, a.scale * 2), Math.max(0.4, a.scale));
      }
      ctx.fillStyle = "#dbe2cd35";
      ctx.fill(asphalt);
    }
    for (const edge of [-0.95, 0.95])
      poly([[a.x + a.w * edge, a.y], [a.x + a.w * (edge + 0.012), a.y],
        [b.x + b.w * (edge + 0.012), b.y + 1], [b.x + b.w * edge, b.y + 1]], "#fff7dcbb");
    // 코너의 고무 자국: 도로 표면에 원근으로 붙어 있는 두 줄.
    if (Math.abs(Track.curve(a.z)) > 0.4)
      for (const lane of [-0.16, 0.02])
        poly([[a.x + a.w * lane, a.y], [a.x + a.w * (lane + 0.035), a.y],
          [b.x + b.w * (lane + 0.035), b.y + 1], [b.x + b.w * lane, b.y + 1]], "#213e4429");
    if (Math.floor(a.z / 110) % 3 === 0)
      for (const lane of [-0.33, 0.33])
        poly(
          [
            [a.x + a.w * (lane - 0.009), a.y],
            [a.x + a.w * (lane + 0.009), a.y],
            [b.x + b.w * (lane + 0.009), b.y + 1],
            [b.x + b.w * (lane - 0.009), b.y + 1],
          ],
          "#f5f2dc",
        );
    if (Math.floor(a.z / Track.LENGTH) !== Math.floor(b.z / Track.LENGTH))
      for (let tile = 0; tile < 16; tile++)
        poly(
          [
            [a.x - a.w + (tile * a.w) / 8, a.y],
            [a.x - a.w + ((tile + 1) * a.w) / 8, a.y],
            [b.x - b.w + ((tile + 1) * b.w) / 8, b.y + 1],
            [b.x - b.w + (tile * b.w) / 8, b.y + 1],
          ],
          tile % 2 ? "#fcf5df" : "#536c61",
        );
  }

  const haze = ctx.createLinearGradient(0, horizon - 2, 0, horizon + height * 0.12);
  haze.addColorStop(0, "#f4e8bd88");
  haze.addColorStop(1, "#f4e8bd00");
  ctx.fillStyle = haze;
  ctx.fillRect(0, horizon - 2, width, height * 0.12 + 2);

  // 돛배·야자수·표지판·카트는 깊이 정렬 후 그리기 위해 모아 둔다.
  const objects = [];
  for (let z = Math.ceil((state.z - 240) / 180) * 180; z < state.z + 5200; z += 180) {
    const a = project(z, -1.16), b = project(z + 180, -1.16);
    objects.push({ y: a.y, draw: () => {
      const lift = a.scale * 32, farLift = b.scale * 32;
      poly([[a.x, a.y - lift], [b.x, b.y - farLift],
        [b.x, b.y - farLift + b.scale * 7], [a.x, a.y - lift + a.scale * 7]], "#c5d8cc");
      poly([[a.x, a.y - lift + a.scale * 7], [b.x, b.y - farLift + b.scale * 7],
        [b.x, b.y - farLift + b.scale * 10], [a.x, a.y - lift + a.scale * 10]], "#496f74");
      rounded(a.x - a.scale * 2, a.y - lift, a.scale * 4, lift, a.scale, "#72938f");
      rounded(a.x - a.scale * 3, a.y - lift + a.scale * 2, a.scale * 6, a.scale * 3, a.scale, "#fff0bd");
    }});
  }
  for (const landmark of [1800, 9500, 15800]) {
    let z = Math.floor(state.z / Track.LENGTH) * Track.LENGTH + landmark;
    if (z < state.z - 240) z += Track.LENGTH;
    if (z - state.z < 6000) {
      const p = project(z, -2.15);
      objects.push({ y: p.y, draw: () => lighthouse(p.x, p.y, p.scale * 1.5) });
    }
  }
  for (const terrain of desertFeatures) {
    const lap = Math.floor(state.z / Track.LENGTH);
    for (let cycle = lap - 1; cycle <= lap + 1; cycle++) {
      const z = terrain.z + cycle * Track.LENGTH;
      if (z >= state.z - 240 && z <= state.z + 6000) {
        const hill = project(z, terrain.x);
        objects.push({ y: hill.y, draw: () => dune(hill.x, hill.y,
          hill.w / Track.HALF_WIDTH * 2.1, terrain) });
      }
      const plantZ = z + terrain.plantOffset;
      if (plantZ >= state.z - 240 && plantZ <= state.z + 6000) {
        const plant = project(plantZ, terrain.plantX);
        objects.push({ y: plant.y, draw: () => desertPlant(plant.x, plant.y,
          plant.w / Track.HALF_WIDTH * (1.1 + sceneryRandom(terrain.seed) * 0.9), terrain.seed) });
      }
    }
  }
  for (
    let z = Math.ceil((state.z - 240) / 2400) * 2400;
    z < state.z + 6000;
    z += 2400
  ) {
    const point = project(z, -3.1);
    objects.push({
      y: point.y,
      draw: () => sailboat(point.x, point.y, point.w / Track.HALF_WIDTH * 2.5),
    });
  }
  for (
    let z = Math.ceil((state.z - 240) / 500) * 500;
    z < state.z + 6000;
    z += 500
  ) {
    const point = project(z);
    objects.push({
      y: point.y,
      draw: () => {
        palm(point.x + point.w * 1.35, point.y, point.w / Track.HALF_WIDTH * 1.8, -1);
        palm(point.x - point.w * 1.35, point.y, point.w / Track.HALF_WIDTH * 1.8);
      },
    });
  }
  for (const section of Track.sections) {
    let z = Math.floor(state.z / Track.LENGTH) * Track.LENGTH + section.start;
    if (z < state.z) z += Track.LENGTH;
    if (z - state.z > 5500) continue;
    const point = project(z, 1.25);
    objects.push({
      y: point.y,
      draw: () => {
        ctx.save();
        ctx.translate(point.x, point.y);
        const signScale = point.w / Track.HALF_WIDTH;
        ctx.scale(signScale, signScale);
        ctx.fillStyle = "#536c61";
        ctx.fillRect(-3, -105, 6, 105);
        rounded(-80, -140, 160, 44, 8, "#fff6e2");
        ctx.fillStyle = "#25473e";
        ctx.font = "bold 16px sans-serif";
        ctx.textAlign = "center";
        ctx.font = "bold 12px sans-serif";
        ctx.fillText(section.name.split(" · ")[0], 0, -112, 146);
        ctx.restore();
      },
    });
  }
  for (const r of [
    ...state.rivals,
    { ...state, color: "#dd85ae", animal: "dva", player: true },
  ]) {
    const distance = r.z - state.z;
    if (distance < -240 || distance > 6000) continue;
    const point = project(r.z, r.x),
      size = (point.w / Track.HALF_WIDTH) * 2.5;
    objects.push({
      y: point.y,
      draw: () =>
        kart(
          point.x,
          point.y,
          size,
          r.color,
          r.animal,
          r.angle +
            (r.player && state.drift ? state.driftDirection * -0.12 : 0),
          r.player && state.turbo > 0,
        ),
    });
  }

  // 화면 아래쪽일수록 가까운 물체다. 가까운 물체를 나중에 그려 겹침을 표현한다.
  objects.sort((a, b) => a.y - b.y).forEach((o) => o.draw());

  // 플레이어 주변 드리프트 불꽃과 고속 주행선을 덧그린다.
  const player = project(state.z, state.x);
  if (state.drift > 0) {
    const color = ["#dffaff", "#62dffc", "#ffb64d", "#ff68bb"][state.driftTier];
    for (let i = 0; i < 18; i++) {
      const phase = (i / 18 + (reducedMotion.matches ? 0 : state.time * 1.8)) % 1;
      const side = i % 2 ? 1 : -1;
      ellipse(player.x + side * player.w * 0.18 + state.driftDirection * phase * 36,
        player.y + phase * 47, 4 + phase * 18, 2 + phase * 9,
        `rgba(224,234,219,${(1 - phase) * 0.25})`);
      ellipse(
        player.x + side * (player.w * 0.18 + phase * 12),
        player.y + phase * 26,
        1 + (1 - phase) * 2,
        1 + (1 - phase) * 2,
        color,
      );
    }
  }
  if (!reducedMotion.matches && (state.speed > 190 || state.turboVisual > 0.05))
    for (let i = 0; i < 10 + Math.floor(state.turboVisual * 22); i++) {
      // 외곽에서 바깥으로 뻗는 선으로 중앙 도로의 시야를 확보한다.
      const phase = (i * 0.618 + state.time * (0.6 + state.speed / 320)) % 1,
        side = i % 2 ? 1 : -1,
        x = width * (0.5 + side * (0.28 + phase * 0.24)),
        y = height * (0.14 + ((i * 0.317) % 0.8)),
        stretch = 0.035 + state.turboVisual * 0.15 + kick * 0.05;
      ctx.strokeStyle = `rgba(240,255,250,${Math.min(0.65,
        Math.max(0, (state.speed - 180) / 600) + state.turboVisual * 0.3) * (1 - phase * 0.6)})`;
      ctx.lineWidth = 1 + (i % 2) + state.turboVisual;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (x - width / 2) * stretch,
        y + (y - height * 0.38) * stretch);
      ctx.stroke();
    }
  ctx.restore();
  if (mode === "countdown") {
    ctx.textAlign = "center";
    ctx.font = '700 80px "Space Grotesk", sans-serif';
    ctx.fillStyle = "#fffaf0";
    ctx.strokeStyle = "#25473e";
    ctx.lineWidth = 4;
    const label = Math.ceil(countdown) || "GO!";
    ctx.strokeText(label, width / 2, height * 0.52);
    ctx.fillText(label, width / 2, height * 0.52);
  }
}

// 초 단위 기록을 분:초.밀리초 표시로 바꾼다.
function formatTime(t) {
  const ms = Math.round(t * 1000);
  return `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

// HUD(경기 정보): 순위·랩·시간·속도·부스터·최고 기록과 현재 액션 안내를 갱신한다.
function hud() {
  $("minimap-player").setAttribute("transform", mapTransform(minimapPosition(state.z, state.done, state.x)));
  for (const rival of state.rivals)
    $(`minimap-${rival.animal}`).setAttribute("transform", mapTransform(minimapPosition(rival.z, false, rival.x)));
  const position = 1 + state.rivals.filter((r) => r.z > state.z).length,
    tierNames = ["", "BLUE", "ORANGE", "PINK"];
  $("position").innerHTML = `${position}<span>/4</span>`;
  $("lap").innerHTML = `${state.lap}<span>/${Coast.LAPS}</span>`;
  $("time").textContent = formatTime(state.time);
  $("speed").textContent = Math.round(state.speed);
  $("boost").style.width = state.boost + "%";
  $("section-name").textContent = Track.section(state.z).name;
  $("record").textContent = records.race
    ? `BEST ${formatTime(records.race)}`
    : "첫 기록에 도전하세요";
  const bestLap = state.lapTimes.length
    ? Math.min(...state.lapTimes)
    : records.lap;
  $("lap-record").textContent = bestLap
    ? `BEST LAP ${formatTime(bestLap)}`
    : "코너 안쪽에서 드리프트 → 놓아서 터보";
  $("notice").textContent =
    Math.abs(state.x) > 1.04
      ? "모래 위! 도로로 돌아오세요"
      : state.bump > 0
        ? "✦ 충돌!"
        : state.turbo > 0
          ? `✦ ${tierNames[state.turboTier]} TURBO!`
          : state.driftTier
            ? `✦ ${tierNames[state.driftTier]} · 드리프트를 놓으세요`
            : state.drift
              ? "드리프트 충전 중…"
              : touchDevice
                ? "자동 가속 · 좌우 조향 · DRIFT"
                : "코너 방향 + SHIFT · 놓아서 터보";
}

// Three-second PCM loops: irregular combustion transients and separate noise beds.
// No sustained sine/periodic-wave voices: engine pitch comes from exhaust playback.
function soundBuffer(combustion = false) {
  const buffer = audio.createBuffer(1, audio.sampleRate * 3, audio.sampleRate);
  const data = buffer.getChannelData(0);
  let low = 0, age = 0, interval = 1 / 72, strength = 1;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    low = low * 0.94 + white * 0.06;
    age += 1 / audio.sampleRate;
    if (age >= interval) {
      age -= interval;
      interval = (0.86 + Math.random() * 0.28) / 72;
      strength = 0.7 + Math.random() * 0.3;
    }
    const pulse = Math.exp(-age * 310) * strength;
    const sample = combustion
      ? pulse * (Math.sin(age * 2 * Math.PI * 95) * 0.45 + white * 1.15) + low * 0.6
      : white * 0.7 + low * 0.3;
    // Taper the seam so looping and one-shot starts do not click.
    const edge = Math.min(1, i / 160, (data.length - 1 - i) / 160);
    data[i] = sample * edge * 0.7;
  }
  return buffer;
}

// Nodes and PCM are allocated once, never during a normal animation frame.
function soundFrame() {
  if (audio && !engineTone) {
    audioMaster = audio.createGain();
    audioMaster.gain.value = 0.65;
    const limiter = audio.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 12;
    limiter.ratio.value = 4;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.18;
    audioMaster.connect(limiter);
    limiter.connect(audio.destination);
    engineTone = audio.createBufferSource();
    engineTone.buffer = soundBuffer(true);
    engineTone.loop = true;
    engineGain = audio.createGain();
    const exhaustHighpass = audio.createBiquadFilter();
    exhaustHighpass.type = "highpass";
    exhaustHighpass.frequency.value = 45;
    exhaustHighpass.Q.value = 0.5;
    engineFilter = audio.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.Q.value = 0.45;
    engineGain.gain.value = 0;
    engineTone.connect(exhaustHighpass);
    exhaustHighpass.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(audioMaster);
    engineTone.start();
    // Boost: a broad air jet and a short low-frequency pressure hit, no pitch slide.
    boostNoise = audio.createBufferSource();
    boostNoise.buffer = soundBuffer();
    boostNoise.loop = true;
    boostFilter = audio.createBiquadFilter();
    boostFilter.type = "bandpass";
    boostFilter.Q.value = 0.45;
    boostGain = audio.createGain();
    boostGain.gain.value = 0;
    boostNoise.connect(boostFilter);
    boostFilter.connect(boostGain);
    boostGain.connect(audioMaster);
    boostNoise.start();
    roadFilter = audio.createBiquadFilter();
    roadFilter.type = "lowpass";
    roadFilter.Q.value = 0.45;
    roadGain = audio.createGain();
    roadGain.gain.value = 0;
    const roadNoise = audio.createBufferSource();
    roadNoise.buffer = soundBuffer();
    roadNoise.loop = true;
    roadNoise.connect(roadFilter);
    roadNoise.start();
    roadFilter.connect(roadGain);
    roadGain.connect(audioMaster);
    driftFilter = audio.createBiquadFilter();
    driftFilter.type = "bandpass";
    driftFilter.Q.value = 1.1;
    driftGain = audio.createGain();
    driftGain.gain.value = 0;
    const tireNoise = audio.createBufferSource();
    tireNoise.buffer = soundBuffer();
    tireNoise.loop = true;
    tireNoise.connect(driftFilter);
    driftFilter.connect(driftGain);
    driftGain.connect(audioMaster);
    tireNoise.start();
    boostSub = audio.createBiquadFilter();
    boostSub.type = "lowpass";
    boostSub.frequency.value = 180;
    boostSub.Q.value = 0.65;
    boostSubGain = audio.createGain();
    boostSubGain.gain.value = 0;
    boostNoise.connect(boostSub);
    boostSub.connect(boostSubGain);
    boostSubGain.connect(audioMaster);
  }
  if (engineTone) {
    const audible = !muted && mode === "running",
      throttle = !(keys.ArrowDown || keys.s) && (keys.ArrowUp || keys.w || touchDevice),
      speed = Math.max(0, state.speed),
      gear = Math.min(5, Math.floor(speed / 76)),
      rev = Math.min(1, (speed - gear * 76) / 76),
      rate = 0.8 + gear * 0.065 + rev * 0.85 + (throttle ? 0.12 : 0),
      kick = state.turbo ? state.turboKick : 0,
      now = audio.currentTime;
    audioMaster.gain.setTargetAtTime(muted || mode === "paused" ? 0 : 0.65, now, 0.01);
    engineTone.playbackRate.setTargetAtTime(rate, now, 0.09);
    engineFilter.frequency.setTargetAtTime(650 + rev * 550 + (throttle ? 600 : 0), now, 0.1);
    engineGain.gain.setTargetAtTime(
      audible ? 0.3 + (throttle ? 0.18 : 0) + rev * 0.06 : 0, now, 0.035,
    );
    roadFilter.frequency.setTargetAtTime(220 + speed * 2.4, now, 0.1);
    roadGain.gain.setTargetAtTime(audible ? Math.min(0.14, speed / 2200) : 0, now, 0.06);
    const slip = state.drift ? Math.min(1, speed / 150) : 0;
    driftFilter.frequency.setTargetAtTime(1500 + speed * 2 + Math.abs(state.angle) * 350, now, 0.09);
    driftGain.gain.setTargetAtTime(audible ? slip * (0.24 + Math.sin(state.time * 17) * 0.018) : 0, now, 0.035);
    boostFilter.frequency.setTargetAtTime(1100 + state.turboVisual * 600, now, 0.08);
    boostGain.gain.setTargetAtTime(
      audible ? state.turboVisual * 0.3 + kick * 0.16 : 0, now, 0.025,
    );
    boostSubGain.gain.setTargetAtTime(audible ? state.turboVisual * 0.12 + kick * 0.65 : 0, now, 0.02);
  }
  const tierChanged = state.driftTier > lastTier;
  lastTier = state.driftTier;
  if (mode === "running" && tierChanged) beep(320 + state.driftTier * 80);
}

// 완주 액션: 최고 기록을 저장하고 순위·이전 기록과의 차이·재시작 버튼을 표시한다.
function finish() {
  mode = "finished";
  beep(1000);
  const place = 1 + state.rivals.filter((r) => r.z > state.z).length,
    previous = records.previous,
    best = records.race;
  const lap = Math.min(...state.lapTimes),
    delta =
      previous == null
        ? "첫 완주 기록!"
        : `이전 대비 ${state.time <= previous ? "−" : "+"}${Math.abs(state.time - previous).toFixed(3)}초`;
  records = {
    race: Math.min(best ?? Infinity, state.time),
    lap: Math.min(records.lap ?? Infinity, lap),
    previous: state.time,
  };
  let saved = true;
  try {
    localStorage.setItem("coast-club-records-v2", JSON.stringify(records));
  } catch {
    saved = false;
  }
  $("overlay").classList.remove("hidden");
  $("overlay").querySelector("h2").textContent =
    place === 1 ? "우승! 햇살까지 내 편 ☀" : `${place}등으로 완주했어요! ♡`;
  $("overlay").querySelector("p").textContent =
    `${Coast.LAPS}바퀴 · ${formatTime(state.time)} · ${delta} · 베스트 랩 ${formatTime(lap)}${best == null || state.time < best ? " · NEW BEST!" : ""}${saved ? "" : " · 기록 저장 불가"}`;
  $("start").innerHTML = "RACE AGAIN <span>↗</span>";
}

// Dry mechanical transients for countdown, drift charge and impacts; no sine beeps.
function beep(frequency = 600) {
  if (muted) return;
  audio ??= new window.AudioContext();
  audio.resume();
  if (!engineTone) soundFrame();
  const source = audio.createBufferSource(), filter = audio.createBiquadFilter(),
    gain = audio.createGain(), now = audio.currentTime;
  source.buffer = boostNoise.buffer;
  filter.type = "bandpass";
  filter.frequency.value = frequency;
  filter.Q.value = 0.8;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.18, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(audioMaster);
  source.start(now, 0.1);
  source.stop(now + 0.09);
  source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
}

// 시작/재시작 액션: 경기·입력·효과음 상태를 초기화하고 3초 카운트다운으로 전환한다.
function start() {
  state = Coast.create();
  lastImpact = -1;
  lastTier = 0;
  Object.keys(keys).forEach((k) => delete keys[k]);
  mode = "countdown";
  countdown = 3;
  $("overlay").classList.add("hidden");
  $("pause").textContent = "Ⅱ";
  beep();
}
let resumeMode = "running";

// 일시정지/재개 액션. 멈추기 전 상태를 기억해 카운트다운 중 정지도 그대로 이어간다.
function pause() {
  if (mode === "running" || mode === "countdown") {
    resumeMode = mode;
    mode = "paused";
    $("overlay").classList.remove("hidden");
    $("overlay").querySelector("h2").textContent = "잠깐, 바다를 바라봐요.";
    $("overlay").querySelector("p").textContent =
      "준비되면 레이스를 이어가세요.";
    $("start").innerHTML = "CONTINUE <span>↗</span>";
    $("pause").textContent = "▶";
    Object.keys(keys).forEach((k) => delete keys[k]);
  } else if (mode === "paused") {
    mode = resumeMode;
    $("overlay").classList.add("hidden");
    $("pause").textContent = "Ⅱ";
  }
}

// 화면 버튼 연결: 시작·계속하기·일시정지·소리 켜기/끄기.
$("start").onclick = () => (mode === "paused" ? pause() : start());
$("pause").onclick = pause;
$("sound").onclick = () => {
  muted = !muted;
  $("sound").textContent = muted ? "♫ SOUND OFF" : "♫ SOUND ON";
  $("sound").setAttribute("aria-label", muted ? "소리 켜기" : "소리 끄기");
  beep();
  soundFrame();
};

// 키보드 액션: 방향키/WASD, Shift 드리프트, Space 부스터, Esc 일시정지. 게임 키의 페이지 스크롤을 막는다.
window.addEventListener("keydown", (e) => {
  if (
    ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "Shift"].includes(
      e.key,
    )
  )
    e.preventDefault();
  keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = true;
  if (e.key === "Escape" && !e.repeat) pause();
});
window.addEventListener("keyup", (e) => {
  delete keys[e.key.length === 1 ? e.key.toLowerCase() : e.key];
});

// 창에서 포커스를 잃으면 눌린 키를 비우고 경기를 멈춰 입력이 계속 남지 않게 한다.
window.addEventListener("blur", () => {
  Object.keys(keys).forEach((k) => delete keys[k]);
  if (mode === "running" || mode === "countdown") pause();
  soundFrame();
});

// 터치 액션을 키보드와 같은 keys에 연결한다. 손가락이 버튼 밖으로 나가도 놓는 이벤트를 받는다.
document.querySelectorAll("[data-key]").forEach((button) => {
  button.onpointerdown = (e) => {
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    keys[button.dataset.key] = true;
  };
  button.onpointerup = button.onpointercancel = () =>
    delete keys[button.dataset.key];
});

// 애니메이션 루프. 주행 상태일 때만 물리를 진행하며, 터치 기기는 자동 가속한다.
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (mode === "countdown") {
    const before = Math.ceil(countdown);
    countdown -= dt;
    if (Math.ceil(countdown) !== before) beep(750);
    if (countdown <= 0) mode = "running";
  }
  if (mode === "running") {
    Coast.step(state, touchDevice ? { ...keys, ArrowUp: true } : keys, dt);
    if (state.bump > 0.45 && state.time - lastImpact > 0.18) {
      beep(150 + state.impact * 90);
      lastImpact = state.time;
    }
    if (state.done) finish();
  }
  render();
  hud();
  soundFrame();
  requestAnimationFrame(frame);
}

// 최초 크기 측정 후 브라우저의 다음 화면 갱신 시점부터 루프를 시작한다.
resize();
requestAnimationFrame(frame);
