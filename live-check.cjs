// 실제 브라우저 검증. 디버깅 포트 9225의 Edge와 게임 서버 8091이 필요하며, 테스트 브라우저 기록을 변경/삭제한다. 실행: node live-check.cjs
const fs = require("node:fs"),
  assert = require("node:assert/strict");
(async () => {
  const tabs = await fetch("http://localhost:9225/json/list").then((r) =>
    r.json(),
  );
  const tab = tabs.find((t) => t.type === "page" && t.url.includes("8091"));
  const ws = new WebSocket(tab.webSocketDebuggerUrl),
    pending = new Map(),
    errors = [];
  let id = 0;
  await new Promise((resolve) => ws.addEventListener("open", resolve));
  ws.addEventListener("message", (event) => {
    const m = JSON.parse(event.data);
    if (m.method === "Runtime.exceptionThrown")
      errors.push(m.params.exceptionDetails);
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(m.error) : p.resolve(m.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  try {
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send("Page.reload");
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.equal(await evaluate("typeof Track.project"), "function");
    const audioResult = await evaluate(`(async()=>{
      requestAnimationFrame=()=>0;start();mode='running';state.speed=160;keys.ArrowUp=true;
      if(muted)$('sound').click();soundFrame();await audio.resume();
      const analyser=audio.createAnalyser();analyser.fftSize=2048;audioMaster.connect(analyser);
      await new Promise(r=>setTimeout(r,250));
      const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);
      const rms=Math.sqrt(samples.reduce((sum,v)=>sum+v*v,0)/samples.length);
      Coast.step(state,{' ':true},1/60);soundFrame();
      await new Promise(r=>setTimeout(r,120));
      const boost=boostGain.gain.value;
      muted=true;soundFrame();await new Promise(r=>setTimeout(r,350));
      analyser.getFloatTimeDomainData(samples);
      const mutedRms=Math.sqrt(samples.reduce((sum,v)=>sum+v*v,0)/samples.length);
      analyser.disconnect();audioMaster.disconnect(analyser);
      return {context:audio.state,rms,mutedRms,boost};
    })()`);
    assert.equal(audioResult.context, "running");
    assert(audioResult.rms > 0.005, "Real Web Audio must produce an engine signal");
    assert(audioResult.boost > 0.05, "Boost must open its sustained jet audio layer");
    assert(audioResult.mutedRms < 0.001, "Mute must silence all continuous audio layers");
    console.log("PASS real Web Audio:", JSON.stringify(audioResult));
    await evaluate(
      "requestAnimationFrame=()=>0;start();mode='running';state.z=3800;state.speed=190;render();hud();",
    );
    const desktop = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      __dirname + "/desktop.png",
      Buffer.from(desktop.data, "base64"),
    );
    const result = await evaluate(
      `(()=>{pause();const paused=mode==='paused';pause();state.z=Coast.LENGTH*Coast.LAPS-1;state.lapTimes=[12,12];state.time=40;state.lapStarted=24;state.speed=200;last=performance.now();frame(last+20);return {paused,finished:mode==='finished',record:JSON.parse(localStorage.getItem('coast-club-records-v2')),text:$('overlay').querySelector('p').textContent};})()`,
    );
    assert(result.paused && result.finished && result.record.race > 0);
    await evaluate(
      "start();if(lastImpact!==-1||state.time!==0)throw Error('Restart did not reset state');",
    );
    await send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 5,
    });
    await send("Page.reload");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal(await evaluate("touchDevice"), true);
    const mobile = await evaluate(
      `(()=>{requestAnimationFrame=()=>0;start();mode='running';last=performance.now();frame(last+40);return {speed:state.speed,notice:getComputedStyle($('notice')).display,brake:!!document.querySelector('[data-key="ArrowDown"]'),overflow:document.documentElement.scrollWidth>innerWidth,record:records.race};})()`,
    );
    assert(
      mobile.speed > 0 &&
        mobile.notice !== "none" &&
        mobile.brake &&
        !mobile.overflow &&
        mobile.record === result.record.race,
    );
    await evaluate(
      "state.z=3800;state.speed=180;state.drift=.8;state.driftTier=1;render();hud();",
    );
    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      __dirname + "/mobile.png",
      Buffer.from(shot.data, "base64"),
    );
    assert.equal(errors.length, 0, JSON.stringify(errors));
    await evaluate("localStorage.removeItem('coast-club-records-v2')");
    console.log(
      "PASS real Edge: rendering, pause, finish, restart, storage reload, mobile automatic acceleration, visible drift hint, brake, no horizontal overflow.",
    );
    console.log(JSON.stringify({ result, mobile }));
  } finally {
    ws.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
