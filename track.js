/* One track description for simulation, scenery and perspective. */
(function(root){
 const LENGTH=18000, HALF_WIDTH=520;
 const sections=[
  {start:0,end:2800,bend:0,name:'SUNSHINE STRAIGHT · 출발 직선'},
  {start:2800,end:6800,bend:.8,name:'PALM SWEEP · 오른쪽 코너'},
  {start:6800,end:8200,bend:0,name:'SURF BREAK · 짧은 직선'},
  {start:8200,end:12200,bend:-1.25,name:'LIGHTHOUSE TURN · 왼쪽 급커브'},
  {start:12200,end:14500,bend:.65,name:'COVE EXIT · 오른쪽 코너'},
  {start:14500,end:LENGTH,bend:0,name:'SUNSET SPRINT · 가속 구간'}
 ];
 const wrap=z=>((z%LENGTH)+LENGTH)%LENGTH;
 function section(z){return sections.find(s=>wrap(z)<s.end);}
 function curve(z){const s=section(z),p=(wrap(z)-s.start)/(s.end-s.start);return s.bend*Math.min(1,p*5,(1-p)*5);}
 function project(z,x,cameraZ,cameraX,width,height){
  const distance=z-cameraZ,scale=650/(650+Math.max(-250,distance));
  // Integrate the same curvature that produces lateral force in the simulation.
  let offset=0,heading=0;
  for(let d=0;d<distance;d+=80){const step=Math.min(80,distance-d);heading+=curve(cameraZ+d+step/2)*step/4000;offset+=heading*step;}
  const w=width*.36*scale;
  return {x:width*.5+(offset/HALF_WIDTH+x-cameraX*.75)*w,y:height*.38+height*.46*scale,w,scale};
 }
 const api={LENGTH,HALF_WIDTH,sections,wrap,section,curve,project};
 if(typeof module!=='undefined')module.exports=api;else root.Track=api;
})(globalThis);
