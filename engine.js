/* Shared simulation: browser and the dependency-free Node check. */
(function(root){
 const Track=typeof module!=='undefined'?require('./track.js'):root.Track;
 const LENGTH=Track.LENGTH,LAPS=3;
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 const curve=Track.curve;
 const driftTier=time=>time>=2.1?3:time>=1.3?2:time>=.65?1:0;
 function kart(z,x,mass,speed,targetSpeed,color,animal,skill){return {z,x,vx:0,angle:0,omega:0,mass,speed,targetSpeed,bump:0,impact:0,color,animal,skill};}
 function create(){return {z:0,x:0,vx:0,angle:0,omega:0,mass:1,speed:0,time:0,boost:35,turbo:0,turboTier:0,drift:0,driftTier:0,driftDirection:0,driftHeld:false,boostHeld:false,lapTimes:[],lapStarted:0,bump:0,impact:0,lap:1,done:false,rivals:[kart(140,-.52,1.15,0,205,'#e9b257','bear',.78),kart(280,.4,.9,0,212,'#9eb8ec','cat',.88),kart(420,-.1,1.05,0,218,'#a6cdb0','frog',.94)]};}
 function collide(a,b){
  const SCALE_X=Track.HALF_WIDTH,RADIUS=112,dx=(a.x-b.x)*SCALE_X,dz=a.z-b.z,dist=Math.hypot(dx,dz);
  if(dist>=RADIUS*2)return false;
  const nx=dist?dx/dist:1,nz=dist?dz/dist:0,invA=1/a.mass,invB=1/b.mass;
  const avx=a.vx*SCALE_X,avz=a.speed*6,bvx=b.vx*SCALE_X,bvz=b.speed*6,approach=(avx-bvx)*nx+(avz-bvz)*nz;
  if(approach<0){const impulse=-(1+.68)*approach/(invA+invB),side=impulse*nx;a.vx=(avx+impulse*invA*nx)/SCALE_X;b.vx=(bvx-impulse*invB*nx)/SCALE_X;a.speed=Math.max(0,(avz+impulse*invA*nz)/6);b.speed=Math.max(0,(bvz-impulse*invB*nz)/6);a.omega=clamp((a.omega||0)+side*invA*.0025,-3,3);b.omega=clamp((b.omega||0)-side*invB*.0025,-3,3);a.impact=b.impact=clamp(-approach/650,.15,1);}
  const correction=(RADIUS*2-dist)*.82/(invA+invB);a.x=clamp(a.x+correction*invA*nx/SCALE_X,-1.45,1.45);b.x=clamp(b.x-correction*invB*nx/SCALE_X,-1.45,1.45);a.z+=correction*invA*nz;b.z-=correction*invB*nz;a.bump=b.bump=.5;return true;
 }
 function aiTarget(s,r){let target=clamp(-curve(r.z+520)*.46,-.62,.62);for(const other of [s,...s.rivals.filter(o=>o!==r)]){const ahead=other.z-r.z;if(ahead>0&&ahead<520&&Math.abs(other.x-target)<.32)target+=other.x<=target?.42:-.42;}return clamp(target+Math.sin(r.z/1300+r.targetSpeed)*(.16*(1-r.skill)),-.82,.82);}
 function step(s,k,dt){
  if(s.done)return;dt=clamp(dt,0,.05);s.time+=dt;
  const previousZ=s.z,previousTime=s.time-dt;
  const steer=(k.ArrowRight||k.d?1:0)-(k.ArrowLeft||k.a?1:0);
  const onRoad=Math.abs(s.x)<=1.04,bend=curve(s.z),braking=!!(k.ArrowDown||k.s);
  const validDrift=onRoad&&s.speed>100&&!braking&&Math.abs(bend)>.15;
  if(k.Shift&&!s.driftHeld&&validDrift&&steer===Math.sign(bend))s.driftDirection=steer;
  if(s.driftDirection){
   if(!validDrift||(steer&&steer!==s.driftDirection)||Math.sign(bend)!==s.driftDirection){s.drift=s.driftTier=s.driftDirection=0;}
   else if(!k.Shift){const tier=driftTier(s.drift);if(tier){s.turboTier=Math.max(s.turboTier,tier);s.turbo=Math.max(s.turbo,[0,.9,1.4,2][tier]);}s.drift=s.driftTier=s.driftDirection=0;}
   else {s.drift+=dt;s.driftTier=driftTier(s.drift);}
  }
  s.driftHeld=!!k.Shift;
  const drifting=s.driftDirection!==0;
  if(k[' ']&&!s.boostHeld&&s.boost>=30&&s.turbo<=0){s.boost-=30;s.turbo=2;s.turboTier=3;}
  s.boostHeld=!!k[' '];
  s.turbo=Math.max(0,s.turbo-dt);if(!s.turbo)s.turboTier=0;s.bump=Math.max(0,s.bump-dt);
  const accelerating=k.ArrowUp||k.w,maxSpeed=s.turbo?[0,270,295,320][s.turboTier]:225;
  s.speed=clamp(s.speed+(accelerating?85:-35)*dt-((k.ArrowDown||k.s)?170*dt:0),0,maxSpeed);if(s.turbo)s.speed=clamp(s.speed+(110+s.turboTier*25)*dt,0,maxSpeed);
  const desiredVx=steer*(drifting?1.45:1.15)*s.speed/225;
  s.vx+=(desiredVx-s.vx)*Math.min(1,dt*9);
  s.x+=(s.vx-bend*(s.speed/225)**2*(drifting?.8:1.15))*dt;
  s.omega+=(steer*s.speed/225*.7-s.angle*2.2)*dt;s.omega*=Math.pow(.13,dt);s.angle=clamp(s.angle+s.omega*dt,-.32,.32);
  if(Math.abs(s.x)>1.45){s.x=clamp(s.x,-1.45,1.45);s.vx*=-.55;s.omega-=Math.sign(s.x)*1.3;s.speed*=.82;s.bump=.35;s.impact=.5;}
  if(Math.abs(s.x)>1.04){s.speed=Math.min(s.speed,Math.max(85,s.speed-230*dt));s.drift=s.driftTier=s.driftDirection=0;}
  s.z+=s.speed*dt*6;s.boost=clamp(s.boost+dt*2,0,100);
  for(const r of s.rivals){r.bump=Math.max(0,r.bump-dt);const cornerSpeed=r.targetSpeed-Math.abs(curve(r.z+350))*22;r.speed+=clamp(cornerSpeed-r.speed,-100*dt,75*dt);const target=aiTarget(s,r),desiredVx=clamp((target-r.x)*1.7,-.7,.7);r.vx+=(desiredVx-r.vx)*dt*(1.5+r.skill);r.x+=r.vx*dt;r.omega+=(r.vx*.5-r.angle*2)*dt;r.omega*=Math.pow(.18,dt);r.angle=clamp(r.angle+r.omega*dt,-.25,.25);if(Math.abs(r.x)>.94){r.x=clamp(r.x,-.94,.94);r.vx*=-.45;r.omega-=Math.sign(r.x);}r.z+=r.speed*dt*6;if(collide(s,r)){s.turbo=0;s.turboTier=0;s.drift=s.driftTier=s.driftDirection=0;}}
  for(let i=0;i<s.rivals.length;i++)for(let j=i+1;j<s.rivals.length;j++)collide(s.rivals[i],s.rivals[j]);
  const finish=(s.lapTimes.length+1)*LENGTH;
  if(previousZ<finish&&s.z>=finish){
   const crossing=previousTime+dt*clamp((finish-previousZ)/(s.z-previousZ),0,1);
   s.lapTimes.push(crossing-s.lapStarted);s.lapStarted=crossing;
   if(s.lapTimes.length===LAPS){s.done=true;s.time=crossing;s.z=finish;}
  }
  s.lap=Math.min(LAPS,s.lapTimes.length+1);
 }
 const api={LENGTH,LAPS,clamp,curve,driftTier,create,collide,step};if(typeof module!=='undefined')module.exports=api;else root.Coast=api;
})(globalThis);
