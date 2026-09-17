/**
 * 코스 정의와 원근 좌표 계산. 도로·풍경·카트가 같은 좌표계를 사용한다.
 * z: 누적 전진 거리(게임 단위), x: 도로 중심 기준 좌우 위치(-1/1이 양쪽 경계).
 * 화면에 그릴 좌표는 project()에서 픽셀로 변환한다.
 */
(function (root) {
  // 한 바퀴 길이와 도로 반폭. 실제 미터 단위가 아닌 시뮬레이션 기준값이다.
  const LENGTH = 18000,
    HALF_WIDTH = 520;

  // 구간 시작/끝, 휘어지는 방향과 세기, 화면 표시 이름. bend는 양수면 오른쪽, 음수면 왼쪽이다.
  const sections = [
    { start: 0, end: 2800, bend: 0, name: "SUNSHINE STRAIGHT · 출발 직선" },
    { start: 2800, end: 6800, bend: 0.8, name: "PALM SWEEP · 오른쪽 코너" },
    { start: 6800, end: 8200, bend: 0, name: "SURF BREAK · 짧은 직선" },
    {
      start: 8200,
      end: 12200,
      bend: -1.25,
      name: "LIGHTHOUSE TURN · 왼쪽 급커브",
    },
    { start: 12200, end: 14500, bend: 0.65, name: "COVE EXIT · 오른쪽 코너" },
    { start: 14500, end: LENGTH, bend: 0, name: "SUNSET SPRINT · 가속 구간" },
  ];

  // 여러 바퀴를 달린 누적 거리를 현재 바퀴 안의 위치로 환산한다.
  const wrap = (z) => ((z % LENGTH) + LENGTH) % LENGTH;

  // 현재 위치가 속한 구간을 찾는다.
  function section(z) {
    return sections.find((s) => wrap(z) < s.end);
  }

  // 코너 진입·탈출의 곡률을 완만하게 바꿔 급격히 꺾이지 않게 한다.
  function curve(z) {
    const s = section(z),
      p = (wrap(z) - s.start) / (s.end - s.start);
    return s.bend * Math.min(1, p * 5, (1 - p) * 5);
  }

  // 카메라와의 거리로 크기를 줄이고 코너 휘어짐을 반영한다. 반환값 x/y/w는 화면 픽셀, scale은 배율이다.
  function project(z, x, cameraZ, cameraX, width, height) {
    const distance = z - cameraZ,
      scale = 650 / (650 + Math.max(-250, distance));
    // 물리 계산과 같은 곡률을 거리마다 누적해 도로가 휘어진 화면 위치를 구한다.
    let offset = 0,
      heading = 0;
    for (let d = 0; d < distance; d += 80) {
      const step = Math.min(80, distance - d);
      heading += (curve(cameraZ + d + step / 2) * step) / 4000;
      offset += heading * step;
    }
    const w = width * 0.36 * scale;
    return {
      x: width * 0.5 + (offset / HALF_WIDTH + x - cameraX * 0.75) * w,
      y: height * 0.38 + height * 0.46 * scale,
      w,
      scale,
    };
  }

  // 브라우저에서는 Track, Node 검증에서는 module.exports로 동일한 계산을 사용한다.
  const api = { LENGTH, HALF_WIDTH, sections, wrap, section, curve, project };
  if (typeof module !== "undefined") module.exports = api;
  else root.Track = api;
})(globalThis);
