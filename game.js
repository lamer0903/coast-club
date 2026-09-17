const canvas=document.querySelector('#race'), ctx=canvas.getContext('2d');
const $=id=>document.getElementById(id), keys={};
let state=Coast.create(), mode='ready', last=0, width=1200,height=580,countdown=0, muted=true,audio,engineTone,engineGain,lastImpact=-1,lastTier=0;
const touchDevice=window.matchMedia("(pointer: coarse)").matches;
let records={};
try {const saved=JSON.parse(localStorage.getItem("coast-club-records-v2")||"{}");for(const key of ["race","lap","previous"])if(Number.isFinite(saved?.[key])&&saved[key]>0)records[key]=saved[key];}catch{}
function resize(){const rect=canvas.getBoundingClientRect();width=rect.width;height=rect.height;const dpr=Math.min(devicePixelRatio||1,2);canvas.width=width*dpr;canvas.height=height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);}
new ResizeObserver(resize).observe(canvas);
function rounded(x,y,w,h,r,color){ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
function ellipse(x,y,rx,ry,color){ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();}
function poly(points,color){ctx.fillStyle=color;ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();}
function palm(x,y,s,lean=1){ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.strokeStyle='#b68d65';ctx.lineWidth=9;ctx.beginPath();ctx.moveTo(0,0);ctx.quadraticCurveTo(lean*7,-44,lean*14,-94);ctx.stroke();for(let i=0;i<6;i++){const a=i*Math.PI/3;ctx.fillStyle=i%2?'#609f88':'#458671';ctx.beginPath();ctx.moveTo(lean*14,-94);ctx.quadraticCurveTo(lean*14+Math.cos(a)*30,-94+Math.sin(a)*15,lean*14+Math.cos(a)*53,-80+Math.sin(a)*26);ctx.quadraticCurveTo(lean*14+Math.cos(a)*20,-106+Math.sin(a)*10,lean*14,-94);ctx.fill();}ctx.restore();}
function kart(x,y,s,color,animal,turn=0,turbo=false){ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.rotate(turn);ellipse(0,7,43,12,'#364d4430');if(turbo){poly([[-20,0],[-12,48],[-4,0]],'#f7b553');poly([[4,0],[12,48],[20,0]],'#f7b553');poly([[-16,0],[-12,30],[-8,0]],'#fff4c1');}rounded(-41,-28,15,34,5,'#3e5055');rounded(26,-28,15,34,5,'#3e5055');rounded(-32,-29,64,36,12,color);rounded(-24,-34,48,14,6,'#fff6e3');rounded(-36,-5,72,9,4,color);rounded(-25,-3,12,5,2,'#fff4cb');rounded(13,-3,12,5,2,'#fff4cb');ctx.save();ctx.translate(0,-20);ctx.scale(.75,.75);ctx.translate(0,20);ellipse(0,-36,19,18,'#fff6e8');if(animal==='bunny'){ellipse(-10,-63,6,21,'#fff6e8');ellipse(10,-63,6,21,'#fff6e8');ellipse(-10,-65,2.5,12,'#f2b5b2');ellipse(10,-65,2.5,12,'#f2b5b2');}else if(animal==='cat'){poly([[-18,-43],[-17,-63],[-4,-50]],'#fff6e8');poly([[18,-43],[17,-63],[4,-50]],'#fff6e8');}else if(animal==='bear'){ellipse(-14,-51,9,9,'#f0d7ae');ellipse(14,-51,9,9,'#f0d7ae');}else {ellipse(-12,-49,8,8,'#b5d9a2');ellipse(12,-49,8,8,'#b5d9a2');}ellipse(-6,-35,2,3,'#3e5055');ellipse(6,-35,2,3,'#3e5055');ellipse(-12,-29,4,2,'#f2b5b2');ellipse(12,-29,4,2,'#f2b5b2');ctx.strokeStyle='#927a6c';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(0,-31,3,0,Math.PI);ctx.stroke();ctx.restore();rounded(-24,-19,48,6,3,'#668d89');ctx.restore();}
function drawCoast(points){
 const edge=points.map(p=>[p.x-p.w*1.7,p.y]);
 poly([[edge[0][0],height*.38],...edge,[width*4,height*2],[width*4,height*.38]],'#edcf94');
 poly([...points.map(p=>[p.x-p.w*1.79,p.y]),...edge.slice().reverse()],'#b0e0cc');
 poly([...points.map(p=>[p.x-p.w*1.725,p.y]),...edge.slice().reverse()],'#fff8dddb');
 for(let i=0;i<points.length-1;i++){
  const a=points[i],b=points[i+1];
  // World-space rows approach the camera at the same rate as the road markings.
  if(Math.floor(a.z/180)===Math.floor(b.z/180))continue;
  const phase=Math.floor(a.z/180);
  for(let col=0;col<12;col++){
   const x=a.x-a.w*(2+col*.85+(phase%3)*.16),span=a.w*.18;
   const ripple=Math.sin(state.time*1.2+phase+col)*a.scale*2;
   ctx.strokeStyle=col%3?'#e2fff17a':'#fff6dba8';ctx.lineWidth=Math.max(.5,a.scale*1.7);
   ctx.beginPath();ctx.moveTo(x-span,a.y);ctx.quadraticCurveTo(x,a.y-a.scale*3+ripple,x+span,a.y);ctx.stroke();
  }
  for(const side of [-1.4,1.3,1.9,2.7,3.6])ellipse(a.x+a.w*(side+Math.sin(phase*7)*.07),a.y,Math.max(.5,a.scale*2),Math.max(.3,a.scale),'#9f794545');
 }
}
function sailboat(x,y,size){
 ctx.save();ctx.translate(x,y+Math.sin(state.time*1.1+x*.01)*size);ctx.scale(size,size);
 ellipse(0,5,25,3,'#e6fff39c');poly([[-20,0],[20,0],[12,7],[-12,7]],'#c87f70');
 ctx.fillStyle='#776e60';ctx.fillRect(-1,-39,2,40);poly([[-3,-38],[-3,-4],[-22,-4]],'#fff5dd');poly([[3,-30],[20,-5],[3,-5]],'#f0b9a3');ctx.restore();
}
let sceneryHeading=0,sceneryZ=0;
function render(){
 ctx.save();const zoom=1+state.speed/320*.035,shake=state.bump?state.impact*7:0;ctx.translate(width/2+(Math.sin(state.time*83)*shake),height/2+(Math.cos(state.time*71)*shake*.45));ctx.scale(zoom,zoom);ctx.translate(-width/2,-height/2);
 const travelled=state.z-sceneryZ;
 if(state.z===0)sceneryHeading=0;
 else sceneryHeading+=Track.curve((state.z+sceneryZ)/2)*travelled/4000;
 sceneryZ=state.z;
 const horizon=height*.38;
 const backgroundX=(x,rate)=>(((x-sceneryHeading*rate-state.x*rate*.06)%1+1)%1)*width;
 const sky=ctx.createLinearGradient(0,0,0,horizon);sky.addColorStop(0,'#84c9df');sky.addColorStop(.72,'#c8e4df');sky.addColorStop(1,'#f4ddb6');ctx.fillStyle=sky;ctx.fillRect(0,0,width,height);
 ellipse(backgroundX(.77,.025),height*.2,35,35,'#fff1ba');
 for(const [x,y,s] of [[.18,.19,1],[.47,.14,.65],[.91,.3,.75]])for(const tile of [-1,0,1]){const cx=backgroundX(x,.09)+tile*width;ellipse(cx,height*y,40*s,10*s,'#ffffff9c');ellipse(cx+20*s,height*y-7*s,23*s,14*s,'#ffffff9c');}
 for(const tile of [-1,0,1]){const x=backgroundX(0,.2)+tile*width;poly([[x,horizon],[x,horizon-17],[x+width*.09,horizon-45],[x+width*.19,horizon-20],[x+width*.33,horizon-32],[x+width*.48,horizon]],'#93b9a4');}
 const ocean=ctx.createLinearGradient(0,horizon,0,height);ocean.addColorStop(0,'#3c9fb1');ocean.addColorStop(.42,'#58bdc4');ocean.addColorStop(1,'#99d8ce');ctx.fillStyle=ocean;ctx.fillRect(0,horizon,width,height-horizon);
 const project=(z,x=0)=>Track.project(z,x,state.z,state.x,width,height);
 const points=[];
 for(let distance=6000;distance>=-240;distance-=60)points.push({...project(state.z+distance),z:state.z+distance});
 drawCoast(points);
 for(let i=0;i<points.length-1;i++){
  const a=points[i],b=points[i+1],stripe=Math.floor(a.z/150)%2;
  poly([[a.x-a.w*1.09,a.y],[a.x+a.w*1.09,a.y],[b.x+b.w*1.09,b.y],[b.x-b.w*1.09,b.y]],stripe?'#fff6e2':'#e6a796');
  poly([[a.x-a.w,a.y],[a.x+a.w,a.y],[b.x+b.w,b.y],[b.x-b.w,b.y]],stripe?'#abb8b4':'#a8b5b1');
  if(Math.floor(a.z/110)%3===0)for(const lane of [-.33,.33])poly([[a.x+a.w*(lane-.009),a.y],[a.x+a.w*(lane+.009),a.y],[b.x+b.w*(lane+.009),b.y],[b.x+b.w*(lane-.009),b.y]],'#f5f2dc');
  if(Math.floor(a.z/Track.LENGTH)!==Math.floor(b.z/Track.LENGTH))for(let tile=0;tile<16;tile++)poly([[a.x-a.w+tile*a.w/8,a.y],[a.x-a.w+(tile+1)*a.w/8,a.y],[b.x-b.w+(tile+1)*b.w/8,b.y],[b.x-b.w+tile*b.w/8,b.y]],tile%2?'#fcf5df':'#536c61');
 }
 const objects=[];
 for(let z=Math.ceil((state.z-240)/2400)*2400;z<state.z+6000;z+=2400){
  const point=project(z,-3.1);objects.push({y:point.y,draw:()=>sailboat(point.x,point.y,point.scale*2)});
 }
 for(let z=Math.ceil((state.z-240)/500)*500;z<state.z+6000;z+=500){
  const point=project(z);objects.push({y:point.y,draw:()=>{palm(point.x+point.w*1.35,point.y,point.scale*1.4,-1);palm(point.x-point.w*1.35,point.y,point.scale*1.4);}});
 }
 for(const section of Track.sections){
  let z=Math.floor(state.z/Track.LENGTH)*Track.LENGTH+section.start;if(z<state.z)z+=Track.LENGTH;
  if(z-state.z>5500)continue;
  const point=project(z,1.25);objects.push({y:point.y,draw:()=>{ctx.save();ctx.translate(point.x,point.y);ctx.scale(point.scale,point.scale);ctx.fillStyle='#536c61';ctx.fillRect(-3,-105,6,105);rounded(-80,-140,160,44,8,'#fff6e2');ctx.fillStyle='#25473e';ctx.font='bold 16px sans-serif';ctx.textAlign='center';ctx.fillText(section.name.split(' ? ')[0],0,-112);ctx.restore();}});
 }
 for(const r of [...state.rivals,{...state,color:'#ed9d9e',animal:'bunny',player:true}]){
  const distance=r.z-state.z;if(distance< -240||distance>6000)continue;
  const point=project(r.z,r.x),size=point.w/Track.HALF_WIDTH*2.5;
  objects.push({y:point.y,draw:()=>kart(point.x,point.y,size,r.color,r.animal,r.angle+(r.player&&state.drift?state.driftDirection*-.12:0),r.player&&state.turbo>0)});
 }
 objects.sort((a,b)=>a.y-b.y).forEach(o=>o.draw());
 const player=project(state.z,state.x);
 if(state.drift>0){const color=['#dffaff','#62dffc','#ffb64d','#ff68bb'][state.driftTier];for(let i=0;i<8;i++)ellipse(player.x+(i%2?1:-1)*player.w*.18,player.y+Math.random()*16,3,3,color);}
 if(state.speed>190)for(let i=0;i<10;i++){const x=(i*137+state.time*400)%width,y=height*.45+(i*71%Math.floor(height*.5));ctx.strokeStyle=`rgba(255,255,240,${(state.speed-180)/500})`;ctx.lineWidth=1+i%2;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+(x-width/2)*.035,y+20+state.speed*.08);ctx.stroke();}
 ctx.restore();
 if(mode==='countdown'){ctx.textAlign='center';ctx.font='700 80px "Space Grotesk", sans-serif';ctx.fillStyle='#fffaf0';ctx.strokeStyle='#25473e';ctx.lineWidth=4;const label=Math.ceil(countdown)||'GO!';ctx.strokeText(label,width/2,height*.52);ctx.fillText(label,width/2,height*.52);}
}
function formatTime(t){const ms=Math.round(t*1000);return `${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;}
function hud(){
 const position=1+state.rivals.filter(r=>r.z>state.z).length,tierNames=['','BLUE','ORANGE','PINK'];
 $('position').innerHTML=`${position}<span>/4</span>`;$('lap').innerHTML=`${state.lap}<span>/${Coast.LAPS}</span>`;
 $('time').textContent=formatTime(state.time);$('speed').textContent=Math.round(state.speed);$('boost').style.width=state.boost+'%';
 $('section-name').textContent=Track.section(state.z).name;
 $('record').textContent=records.race?`BEST ${formatTime(records.race)}`:'첫 기록에 도전하세요';
 const bestLap=state.lapTimes.length?Math.min(...state.lapTimes):records.lap;
 $('lap-record').textContent=bestLap?`BEST LAP ${formatTime(bestLap)}`:'코너 안쪽에서 드리프트 → 놓아서 터보';
 $('notice').textContent=Math.abs(state.x)>1.04?'모래 위! 도로로 돌아오세요':state.bump>0?'✦ 충돌!':state.turbo>0?`✦ ${tierNames[state.turboTier]} TURBO!`:state.driftTier?`✦ ${tierNames[state.driftTier]} · 드리프트를 놓으세요`:state.drift?'드리프트 충전 중…':touchDevice?'자동 가속 · 좌우 조향 · DRIFT':'코너 방향 + SHIFT · 놓아서 터보';
}
function soundFrame(){
 if(audio&&!engineTone){engineTone=audio.createOscillator();engineGain=audio.createGain();engineTone.type='triangle';engineGain.gain.value=0;engineTone.connect(engineGain);engineGain.connect(audio.destination);engineTone.start();}
 if(engineTone){engineTone.frequency.setTargetAtTime(45+state.speed*.65+(state.turbo?35:0),audio.currentTime,.08);engineGain.gain.setTargetAtTime(!muted&&mode==='running'?.025:0,audio.currentTime,.03);}
 if(state.driftTier>lastTier)beep(450+state.driftTier*220);lastTier=state.driftTier;
}
function finish(){
 mode='finished';beep(1000);
 const place=1+state.rivals.filter(r=>r.z>state.z).length,previous=records.previous,best=records.race;
 const lap=Math.min(...state.lapTimes),delta=previous==null?'첫 완주 기록!':`이전 대비 ${state.time<=previous?'−':'+'}${Math.abs(state.time-previous).toFixed(3)}초`;
 records={race:Math.min(best??Infinity,state.time),lap:Math.min(records.lap??Infinity,lap),previous:state.time};
 let saved=true;try{localStorage.setItem('coast-club-records-v2',JSON.stringify(records));}catch{saved=false;}
 $('overlay').classList.remove('hidden');
 $('overlay').querySelector('h2').textContent=place===1?'우승! 햇살까지 내 편 ☀':`${place}등으로 완주했어요! ♡`;
 $('overlay').querySelector('p').textContent=`${Coast.LAPS}바퀴 · ${formatTime(state.time)} · ${delta} · 베스트 랩 ${formatTime(lap)}${best==null||state.time<best?' · NEW BEST!':''}${saved?'':' · 기록 저장 불가'}`;
 $('start').innerHTML='RACE AGAIN <span>↗</span>';
}
function beep(frequency=600){if(muted)return;audio??=new window.AudioContext();audio.resume();const osc=audio.createOscillator(),gain=audio.createGain();osc.frequency.value=frequency;osc.type='sine';gain.gain.setValueAtTime(.07,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.15);osc.connect(gain);gain.connect(audio.destination);osc.start();osc.stop(audio.currentTime+.16);}
function start(){state=Coast.create();lastImpact=-1;lastTier=0;Object.keys(keys).forEach(k=>delete keys[k]);mode='countdown';countdown=3;$('overlay').classList.add('hidden');$('pause').textContent='Ⅱ';beep();}
let resumeMode='running';
function pause(){if(mode==='running'||mode==='countdown'){resumeMode=mode;mode='paused';$('overlay').classList.remove('hidden');$('overlay').querySelector('h2').textContent='잠깐, 바다를 바라봐요.';$('overlay').querySelector('p').textContent='준비되면 레이스를 이어가세요.';$('start').innerHTML='CONTINUE <span>↗</span>';$('pause').textContent='▶';Object.keys(keys).forEach(k=>delete keys[k]);}else if(mode==='paused'){mode=resumeMode;$('overlay').classList.add('hidden');$('pause').textContent='Ⅱ';}}
$('start').onclick=()=>mode==='paused'?pause():start();$('pause').onclick=pause;
$('sound').onclick=()=>{muted=!muted;$('sound').textContent=muted?'♫ SOUND OFF':'♫ SOUND ON';$('sound').setAttribute('aria-label',muted?'소리 켜기':'소리 끄기');beep();soundFrame();};
window.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' ','Shift'].includes(e.key))e.preventDefault();keys[e.key.length===1?e.key.toLowerCase():e.key]=true;if(e.key==='Escape'&&!e.repeat)pause();});
window.addEventListener('keyup',e=>{delete keys[e.key.length===1?e.key.toLowerCase():e.key];});
window.addEventListener('blur',()=>{Object.keys(keys).forEach(k=>delete keys[k]);if(mode==='running'||mode==='countdown')pause();soundFrame();});
document.querySelectorAll('[data-key]').forEach(button=>{button.onpointerdown=e=>{e.preventDefault();button.setPointerCapture(e.pointerId);keys[button.dataset.key]=true;};button.onpointerup=button.onpointercancel=()=>delete keys[button.dataset.key];});
function frame(now){const dt=Math.min((now-last)/1000,.05);last=now;if(mode==='countdown'){const before=Math.ceil(countdown);countdown-=dt;if(Math.ceil(countdown)!==before)beep(750);if(countdown<=0)mode='running';}if(mode==='running'){Coast.step(state,touchDevice?{...keys,ArrowUp:true}:keys,dt);if(state.bump>.45&&state.time-lastImpact>.18){beep(150+state.impact*90);lastImpact=state.time;}if(state.done)finish();}render();hud();soundFrame();requestAnimationFrame(frame);}
resize();requestAnimationFrame(frame);
