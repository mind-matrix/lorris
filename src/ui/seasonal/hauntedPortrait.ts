// @ts-nocheck -- ported pixel-art animation code; the exported function below is typed.
//
// "The Portrait of Giggles Mortimer": a haunted clown portrait that tears open and laughs.
// Played over the table when the Joker is played during Halloween week. Everything is drawn
// by hand into a 144x192 canvas (scaled up with crisp pixels) and the sound is synthesized
// with the Web Audio API, so there are no image or sound files to load.

import { audioContext } from '../audio';

/** Overall loudness of the laugh and sting (0..1). */
const VOLUME = .7;
/** With reduced motion: one still frame of the laughing clown, shown this long. */
export const REDUCED_MOTION_MS = 2600;

/* ---------- timeline ---------- */
const T_TEAR=1.0, LAUGH0=1.12;
const PATTERN=[[210,.16],[240,.15],[270,.14],[300,.13],[330,.12],[315,.12],[300,.12],[285,.12],[270,.12],[255,.13],[240,.13],[225,.14],[210,.15],[190,.18],[170,.32]];
const EVENTS=[]; { let t=LAUGH0; PATTERN.forEach(([p,d],i)=>{ EVENTS.push({t,p,d}); t+=d+(i<4?.06:.035); }); }
const LAUGH_END=EVENTS[EVENTS.length-1].t+EVENTS[EVENTS.length-1].d;
const RET=LAUGH_END+.15, RET_D=.8, REST0=RET+RET_D, REST_D=.6, END=REST0+REST_D+.1;
const S0=.30, S1=.95, A0=[72,78], A1=[72,102];


/** Length of the full animation. Keep HALLOWEEN_JOKER_MS (src/seasonal/halloween.ts) in step. */
export const ANIMATION_SECONDS = END;

/**
 * Plays the animation into `canvas` (144x192). Calls `onDone` when it finishes.
 * Returns a function that stops it early (no `onDone` call then).
 * With `reducedMotion`, nothing moves or shakes: one still frame shows briefly, with the sound.
 */
export function playHauntedPortrait(
  canvas: HTMLCanvasElement,
  opts: { reducedMotion: boolean; onDone: () => void },
): () => void {
const W=144,H=192;
const cv=canvas, g=cv.getContext('2d');
const img=g.createImageData(W,H);
const col=new Float32Array(W*H*3), em=new Float32Array(W*H), lb=new Float32Array(W*H), mask=new Uint8Array(W*H);
const base=new Float32Array(W*H*3);
const reduce=opts.reducedMotion;

const hash=(x,y)=>{const s=Math.sin(x*12.9898+y*78.233)*43758.5453;return s-Math.floor(s)};
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const lerp=(a,b,t)=>a+(b-a)*t;
const ease=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
const spring=(t,k,w)=>t<=0?0:1-Math.exp(-k*t)*(Math.cos(w*t)+(k/w)*Math.sin(w*t));
const BAYER=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5].map(v=>(v+.5)/16);

/* ---------- static scene ---------- */
const OX0=34,OY0=22,OX1=110,OY1=124, IX0=41,IY0=29,IX1=103,IY1=117;
function setB(x,y,c){ if(x<0||y<0||x>=W||y>=H)return; const i=(y*W+x)*3; base[i]=c[0];base[i+1]=c[1];base[i+2]=c[2]; }
function getB(x,y){ const i=(y*W+x)*3; return [base[i],base[i+1],base[i+2]]; }
function lineB(x0,y0,x1,y1,c){ const n=Math.max(Math.abs(x1-x0),Math.abs(y1-y0)); for(let i=0;i<=n;i++){ setB(Math.round(lerp(x0,x1,i/n)),Math.round(lerp(y0,y1,i/n)),c);} }

function buildBase(){
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const n=(hash(x,y)-.5)*8; let c;
    if(y<146){
      c=[74,46,58];
      if(x%12<2) c=[60,37,47];
      const lx=x%12-6, ly=((y+(Math.floor(x/12)%2)*8)%16)-8, md=Math.abs(lx)+Math.abs(ly);
      if(md<=3&&md>=2) c=[94,62,72];
      // grime toward the top
      const k=1-0.25*(1-y/146); c=c.map(v=>v*k);
    } else if(y<150){
      c = y===146?[150,104,60]: y===149?[60,36,20]:[112,72,40];
    } else {
      c=[58,36,24]; const px=x%36;
      if(px>=3&&px<=32&&y>=154&&y<=186){
        if(px===3||y===154) c=[78,50,32]; else if(px===32||y===186) c=[40,24,16];
      }
    }
    setB(x,y,c.map(v=>v+n));
  }
  // frame shadow
  for(let y=OY0+3;y<OY1+4;y++)for(let x=OX0+3;x<OX1+4;x++){
    if(x>=OX0&&x<OX1&&y>=OY0&&y<OY1) continue; const c=getB(x,y); setB(x,y,c.map(v=>v*.5));
  }
  // wire & nail
  lineB(72,12,36,22,[120,110,98]); lineB(72,12,108,22,[120,110,98]);
  setB(71,11,[70,60,50]);setB(72,11,[90,80,70]);setB(71,12,[60,50,40]);setB(72,12,[70,60,50]);
  // gilt frame
  const ring=[[70,44,16],[196,156,78],[236,200,116],[168,122,48],[118,82,28],[200,154,72],[84,56,20]];
  for(let y=OY0;y<OY1;y++)for(let x=OX0;x<OX1;x++){
    if(x>=IX0&&x<IX1&&y>=IY0&&y<IY1) continue;
    const dl=x-OX0, dr=OX1-1-x, dt=y-OY0, db=OY1-1-y, d=Math.min(dl,dr,dt,db);
    let c=ring[Math.min(6,d)].slice();
    const lit = (d===dl||d===dt) ? 1.12 : .8;
    c=c.map(v=>v*lit);
    if(d===3 && ((x+y)%3===0)) c=c.map(v=>v*1.25);
    setB(x,y,c);
  }
  [[OX0+3,OY0+3],[OX1-4,OY0+3],[OX0+3,OY1-4],[OX1-4,OY1-4]].forEach(([cx,cy])=>{
    for(let y=-3;y<=3;y++)for(let x=-3;x<=3;x++){const r=x*x+y*y; if(r<=9) setB(cx+x,cy+y, r<=2?[250,222,140]: r<=5?[200,150,60]:[110,76,24]);}
  });
  // oil-painting background
  for(let y=IY0;y<IY1;y++)for(let x=IX0;x<IX1;x++){
    const d=Math.hypot(x-72,(y-62)*.9), t=clamp(d/46,0,1);
    const br=(hash(Math.floor(x/3),y)-.5)*16;
    const c=[lerp(132,30,t)+br, lerp(106,22,t)+br*.8, lerp(66,16,t)+br*.5];
    // vignette inside the frame
    const e=Math.min(x-IX0,IX1-1-x,y-IY0,IY1-1-y); const k=e<3?.6+e*.13:1;
    setB(x,y,c.map(v=>v*k));
  }
  // painted balloon
  for(let y=-7;y<=7;y++)for(let x=-6;x<=6;x++){
    const q=(x*x)/30+(y*y)/42; if(q<=1){ const s=1-.35*q+.15*(-x-y)/6; setB(94+x,46+y,[200*s,158*s,52*s]); }
  }
  setB(94,54,[120,90,30]);
  for(let i=0;i<26;i++){ const u=i/25; setB(Math.round(94-6*u+Math.sin(u*5)*1.5), 55+i, [40,28,18]); }
  // table
  for(let x=2;x<=44;x++){ setB(x,158,[150,100,58]); setB(x,159,[110,70,40]); setB(x,160,[96,60,34]); for(let y=161;y<=164;y++) setB(x,y,[78,48,26]); }
  for(let y=165;y<H;y++){ for(const x of [5,6,7,39,40,41]) setB(x,y, x===5||x===39?[96,60,34]:[66,40,22]); }
  // candlestick
  for(let x=15;x<=27;x++){ setB(x,155,[224,184,100]); setB(x,156,[176,134,62]); setB(x,157,[120,88,36]); }
  for(let y=142;y<=154;y++){ setB(20,y,[220,180,96]); setB(21,y,[176,134,62]); setB(22,y,[120,88,36]); }
  for(let x=17;x<=25;x++){ setB(x,140,[224,184,100]); setB(x,141,[150,110,48]); }
  for(let y=128;y<=139;y++)for(let x=19;x<=23;x++) setB(x,y, x===19?[240,232,206]: x===23?[180,168,140]:[222,212,182]);
  for(let y=129;y<=133;y++) setB(24,y,[206,196,166]);
  setB(21,127,[40,30,20]);
}

/* ---------- the tear ---------- */
const HC={x:72,y:70}, holePts=[];
for(let i=0;i<24;i++){ const a=i/24*Math.PI*2, k=(i%2?.72:1)*(.85+.3*hash(i,7)); holePts.push([HC.x+Math.cos(a)*23*k, HC.y+Math.sin(a)*31*k]); }
function inPoly(x,y,p){ let ins=false; for(let i=0,j=p.length-1;i<p.length;j=i++){ const xi=p[i][0],yi=p[i][1],xj=p[j][0],yj=p[j][1]; if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi)) ins=!ins; } return ins; }
const holeMask=new Uint8Array(W*H);
for(let y=IY0;y<IY1;y++)for(let x=IX0;x<IX1;x++) if(inPoly(x+.5,y+.5,holePts)) holeMask[y*W+x]=1;

/* ---------- raster helpers ---------- */
const I3=[1,0,0,1,0,0];
const mul=(A,B)=>[A[0]*B[0]+A[2]*B[1],A[1]*B[0]+A[3]*B[1],A[0]*B[2]+A[2]*B[3],A[1]*B[2]+A[3]*B[3],A[0]*B[4]+A[2]*B[5]+A[4],A[1]*B[4]+A[3]*B[5]+A[5]];
const inv=M=>{const d=M[0]*M[3]-M[1]*M[2];return[M[3]/d,-M[1]/d,-M[2]/d,M[0]/d,(M[2]*M[5]-M[3]*M[4])/d,(M[1]*M[4]-M[0]*M[5])/d]};
const T=(x,y)=>[1,0,0,1,x,y], S=s=>[s,0,0,s,0,0], R=a=>[Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0];
const about=(x,y,a)=>mul(T(x,y),mul(R(a),T(-x,-y)));
const ap=(M,x,y)=>[M[0]*x+M[2]*y+M[4],M[1]*x+M[3]*y+M[5]];

let CLIP=null, DEF={};
function fill(M,bb,test,c,o){
  o=o||DEF;
  const cs=[ap(M,bb[0],bb[1]),ap(M,bb[2],bb[1]),ap(M,bb[0],bb[3]),ap(M,bb[2],bb[3])];
  let x0=Math.floor(Math.min(...cs.map(p=>p[0]))), x1=Math.ceil(Math.max(...cs.map(p=>p[0])));
  let y0=Math.floor(Math.min(...cs.map(p=>p[1]))), y1=Math.ceil(Math.max(...cs.map(p=>p[1])));
  const cl=o.clip===undefined?CLIP:o.clip;
  x0=Math.max(x0,cl?cl[0]:0); y0=Math.max(y0,cl?cl[1]:0); x1=Math.min(x1,cl?cl[2]:W); y1=Math.min(y1,cl?cl[3]:H);
  const Iv=inv(M), a=o.a===undefined?1:o.a;
  for(let py=y0;py<y1;py++)for(let px=x0;px<x1;px++){
    const sx=px+.5, sy=py+.5, lx=Iv[0]*sx+Iv[2]*sy+Iv[4], ly=Iv[1]*sx+Iv[3]*sy+Iv[5];
    const r=test(lx,ly); if(r===false) continue;
    const sh=r===true?1:r, i=py*W+px, j=i*3;
    if(a<1){ col[j]=lerp(col[j],c[0]*sh,a); col[j+1]=lerp(col[j+1],c[1]*sh,a); col[j+2]=lerp(col[j+2],c[2]*sh,a); em[i]=Math.max(em[i],o.em||0); continue; }
    col[j]=c[0]*sh; col[j+1]=c[1]*sh; col[j+2]=c[2]*sh;
    em[i]=o.em||0; if(o.lb!==undefined) lb[i]=o.lb; if(o.mask) mask[i]=1;
  }
}
function E(M,cx,cy,rx,ry,c,o){
  const shd=o&&o.sh;
  fill(M,[cx-rx,cy-ry,cx+rx,cy+ry],(x,y)=>{ const nx=(x-cx)/rx, ny=(y-cy)/ry, q=nx*nx+ny*ny; if(q>1) return false;
    if(!shd) return true; const f=1-.32*q+.16*(-nx*.6-ny*.8); return Math.round(f*5)/5; },c,o);
}
function C(M,ax,ay,bx,by,r,c,o){
  const dx=bx-ax, dy=by-ay, L=dx*dx+dy*dy||1;
  fill(M,[Math.min(ax,bx)-r,Math.min(ay,by)-r,Math.max(ax,bx)+r,Math.max(ay,by)+r],(x,y)=>{
    const t=clamp(((x-ax)*dx+(y-ay)*dy)/L,0,1), ex=x-ax-dx*t, ey=y-ay-dy*t, q=(ex*ex+ey*ey)/(r*r);
    if(q>1) return false; return o&&o.sh? Math.round((1-.25*q+.12*(-ex-ey)/r)*5)/5 : true; },c,o);
}
function P(M,pts,c,o){
  let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9; const p=[];
  for(let i=0;i<pts.length;i+=2){ p.push([pts[i],pts[i+1]]); x0=Math.min(x0,pts[i]);x1=Math.max(x1,pts[i]);y0=Math.min(y0,pts[i+1]);y1=Math.max(y1,pts[i+1]); }
  fill(M,[x0,y0,x1,y1],(x,y)=>inPoly(x,y,p),c,o);
}
const qb=(a,b,c,u)=>[(1-u)*(1-u)*a[0]+2*(1-u)*u*b[0]+u*u*c[0],(1-u)*(1-u)*a[1]+2*(1-u)*u*b[1]+u*u*c[1]];

/* ---------- the clown (original character) ---------- */
const K={
  skin:[234,226,206], tuft:[47,110,104], hat:[60,46,34], brim:[40,30,22], band:[110,64,96], gold:[204,164,60],
  dia:[26,20,24], white:[238,230,204], iris:[214,172,58], pupil:[8,6,6], nose:[66,146,134], lip:[46,66,112],
  mouth:[22,10,14], tongue:[120,44,58], teeth:[236,226,198], plum:[78,48,82], teal:[62,124,118], patch:[112,64,98],
  ruff:[232,222,196], ruff2:[196,184,154], glove:[230,224,204], dark:[20,12,16]
};
function drawClown(st){
  const G=mul(T(st.ax,st.ay),mul(R(st.rot),mul(S(st.s),T(-100,-130))));
  const B=mul(G,T(0,st.bodyDy));
  const Hm=mul(G,mul(T(0,st.headDy),about(100,182,st.headRot)));
  const o={mask:1,lb:st.lb,sh:1}, of={mask:1,lb:st.lb};
  // torso
  P(B,[22,262, 34,214, 62,194, 100,190, 138,194, 166,214, 178,262],K.plum,of);
  P(B,[62,202,100,190,100,262,54,262],K.teal,of);
  P(B,[138,202,100,190,100,262,146,262],K.patch,of);
  E(B,100,228,5,5,K.gold,o); E(B,100,246,5,5,K.gold,o);
  // arms
  const r=st.reach, arms=[];
  for(const side of [-1,1]){
    const sx=100+side*38, sy=204;
    let hx=lerp(100+side*48,100+side*96,r), hy=lerp(258,124,r);
    let exx=lerp(100+side*56,100+side*86,r), exy=lerp(232,196,r);
    hy+=Math.sin(st.t*38+side)*6*st.bob; hx+=side*Math.sin(st.t*29)*3*st.bob;
    arms.push({side,sx,sy,hx,hy,exx,exy});
    const sleeve=side<0?K.teal:K.patch;
    C(B,sx,sy,exx,exy,14,sleeve,o); C(B,exx,exy,hx,hy,12.5,sleeve,o);
  }
  // ruff
  for(let i=0;i<9;i++){ const x=40+i*15, y=196+(i%2?4:-2); E(B,x,y,12,10,i%2?K.ruff2:K.ruff,o); }
  // head
  const H=Hm, m=st.m;
  for(const [x,y,rr] of [[38,98,12],[32,112,10],[42,84,9],[162,98,12],[168,112,10],[158,84,9]]) E(H,x,y,rr,rr,K.tuft,o);
  E(H,48,122,8,13,K.skin,o); E(H,152,122,8,13,K.skin,o);
  E(H,100,118,52,62,K.skin,o);
  E(H,100,158+m*16,36,22+m*4,K.skin,o);
  // bowler hat, dented
  E(H,100,64,64,10,K.brim,o);
  P(H,[58,64,58,40,66,25,84,16,100,16,112,20,107,27,124,22,138,30,142,44,142,64],K.hat,of);
  P(H,[58,52,142,52,142,60,58,60],K.band,of);
  P(H,[128,52,138,36,140,53],K.gold,of);
  // diamonds and brows
  const ang=st.glow;
  P(H,[76,80,87,104,76,130,65,104],K.dia,of); P(H,[124,80,135,104,124,130,113,104],K.dia,of);
  C(H,62,80,90,82+ang*6,2.6,K.dia,of); C(H,110,82+ang*6,138,80,2.6,K.dia,of);
  // eyes
  for(const ex of [76,124]){
    E(H,ex,104,9,7,K.white,{mask:1,lb:st.lb,em:st.glow*.25});
    E(H,ex+1+st.pupil,105,4.4,4.4,K.iris,{mask:1,lb:st.lb,em:st.glow});
    E(H,ex+1+st.pupil,105,1.9,1.9,K.pupil,of);
    if(st.glow>0) E(H,ex,104,13,11,[240,180,40],{a:.3*st.glow,em:st.glow*.5});
  }
  // nose
  E(H,100,127,10,10,K.nose,o);
  // mouth
  const U0=[66,143],U1=[100,152],U2=[134,143];
  if(m<.05){
    for(let i=0;i<10;i++){ const p=qb([70,146],[100,166],[130,146],i/10), q=qb([70,146],[100,166],[130,146],(i+1)/10); C(H,p[0],p[1],q[0],q[1],2.2,K.lip,of); }
    for(const [x,y] of [[78,149],[90,154],[110,154],[122,149]]) C(H,x,y-3,x-.5,y+4,1.1,K.lip,of);
  } else {
    const L1=[100,152+44*m], pts=[];
    for(let i=0;i<=10;i++){ const p=qb(U0,U1,U2,i/10); pts.push(p[0],p[1]); }
    for(let i=0;i<=10;i++){ const p=qb(U2,L1,U0,i/10); pts.push(p[0],p[1]); }
    P(H,pts,K.mouth,of);
    E(H,100,145+18*m,10+8*m,2+4*m,K.tongue,of);
    const tu=Math.min(1,m*3), tl=Math.min(1,m*2);
    for(const u of [.2,.32,.44,.56,.68,.8]){ const p=qb(U0,U1,U2,u); P(H,[p[0]-3.3,p[1]-1,p[0]+3.3,p[1]-1,p[0],p[1]+6*tu],K.teeth,of); }
    for(const u of [.25,.4,.6,.75]){ const p=qb(U2,L1,U0,u); P(H,[p[0]-3,p[1]+1,p[0]+3,p[1]+1,p[0],p[1]-5*tl],K.teeth,of); }
    for(let i=0;i<10;i++){
      let p=qb(U0,U1,U2,i/10), q=qb(U0,U1,U2,(i+1)/10); C(H,p[0],p[1],q[0],q[1],2.4,K.lip,of);
      p=qb(U2,L1,U0,i/10); q=qb(U2,L1,U0,(i+1)/10); C(H,p[0],p[1],q[0],q[1],2.6,K.lip,of);
    }
  }
  // hands (closest to viewer, drawn last)
  for(const a of arms){
    const dx=a.hx-a.exx, dy=a.hy-a.exy, d=Math.hypot(dx,dy)||1, ux=dx/d, uy=dy/d;
    const hr=11+6*r, curl=.25*Math.sin(st.t*20)*st.bob;
    E(B,a.hx-ux*hr*.9,a.hy-uy*hr*.9,hr*.85,hr*.85,K.gold,o);
    const base=Math.atan2(uy,ux);
    const fl=13+8*r, fr=4.2+1.8*r;
    for(const s of [-.62,-.2,.2,.6]){
      const an=base+s*(.6+.5*r)*a.side*-1+curl*a.side;
      C(B,a.hx,a.hy,a.hx+Math.cos(an)*(hr+fl*.6),a.hy+Math.sin(an)*(hr+fl*.6),fr,K.glove,o);
    }
    const ta=base+a.side*1.35;
    C(B,a.hx,a.hy,a.hx+Math.cos(ta)*(hr+5),a.hy+Math.sin(ta)*(hr+5),fr,K.glove,o);
    E(B,a.hx,a.hy,hr,hr*.92,K.glove,o);
  }
}

function laughAt(t){
  let env=0;
  for(const e of EVENTS){ const u=(t-e.t)/e.d; if(u>=0&&u<=1){ env=Math.pow(Math.sin(Math.PI*u),.7); break; } }
  return env;
}
function stateAt(t){
  const st={ax:A0[0],ay:A0[1],s:S0,rot:0,headRot:0,headDy:0,bodyDy:0,m:0,reach:0,pupil:-2.6,glow:0,lb:.05,clip:[IX0,IY0,IX1,IY1],bob:0,t,out:false,hole:0,crack:0};
  if(t<T_TEAR){
    const an=clamp((t-.72)/(T_TEAR-.72),0,1);
    st.pupil = t<.42 ? -2.6 : lerp(-2.6,0,ease(clamp((t-.42)/.12,0,1)));
    st.glow=an; st.m=an*.18; st.s=S0*(1+.06*ease(an)); st.ay=A0[1]-an*2; st.crack=an;
    return st;
  }
  if(t<RET){
    const u=t-T_TEAR, sp=spring(u,7,12.5);
    st.out=true; st.clip=null; st.lb=.34; st.hole=1; st.pupil=0; st.glow=1;
    st.s=lerp(S0,S1,sp); st.ax=lerp(A0[0],A1[0],sp); st.ay=lerp(A0[1],A1[1],sp);
    st.reach=spring(Math.max(0,u-.05),6,10.5);
    st.rot=.05*Math.sin(u*2.4)+(1-Math.min(1,sp))*.12;
    if(t<LAUGH0) st.m=.95*Math.min(1,u/.07);
    else { const env=laughAt(t); st.bob=env; st.m= t<LAUGH_END ? .3+.65*env : .3; }
    st.headRot=-.11*st.bob+.02*Math.sin(t*3.1); st.headDy=-6*st.bob; st.bodyDy=2.5*st.bob+Math.sin(t*2.2)*1.2;
    return st;
  }
  if(t<REST0){
    const v=ease(clamp((t-RET)/RET_D,0,1));
    st.out=v<.98; st.clip=st.out?null:st.clip; st.lb=lerp(.34,.05,v); st.hole=1; st.pupil=0; st.glow=1-v;
    st.s=lerp(S1,S0,v); st.ax=lerp(A1[0],A0[0],v); st.ay=lerp(A1[1],A0[1],v);
    st.reach=1-ease(clamp(v*1.6,0,1)); st.m=lerp(.3,0,v); st.rot=.06*(1-v)*Math.sin(t*4);
    return st;
  }
  st.pupil=0; st.hole=1-clamp((t-REST0)/REST_D,0,1);
  return st;
}

/* ---------- shards ---------- */
let shards=[], spawned=false;
function spawnShards(){
  shards=[];
  for(let i=0;i<90;i++){
    let x,y; do{ x=IX0+Math.random()*(IX1-IX0); y=IY0+Math.random()*(IY1-IY0); }while(!holeMask[(y|0)*W+(x|0)]);
    const c=getB(x|0,y|0), a=Math.atan2(y-HC.y,x-HC.x), sp=40+Math.random()*90;
    shards.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-40,z:1,vz:1.5+Math.random()*3,c:c.map(v=>v*(.8+Math.random()*.4)),life:1.1+Math.random()*.6,age:0});
  }
}

/* ---------- render ---------- */
let playing=false, start=0, last=performance.now(), alive=true, raf=0;
const STILL_T=LAUGH0+.3;

function render(now){
  if(!alive) return;
  const dt=Math.min(.05,(now-last)/1000); last=now;
  const t=reduce?STILL_T:(playing?(now-start)/1000:.2);
  const real=now/1000;
  col.set(base); em.fill(0); lb.fill(0); mask.fill(0);
  const st=stateAt(t);

  // torn canvas
  if(st.hole>0){
    for(let y=IY0;y<IY1;y++)for(let x=IX0;x<IX1;x++){
      const i=y*W+x; if(!holeMask[i]) continue;
      if(st.hole<1 && hash(x*3.1,y*1.7)>st.hole) continue;
      const edge=!holeMask[i-1]||!holeMask[i+1]||!holeMask[i-W]||!holeMask[i+W];
      const j=i*3, c= edge?[150,128,92]:[10+(hash(x,y)*6),6,8];
      col[j]=c[0];col[j+1]=c[1];col[j+2]=c[2];
    }
  }
  // cracks spreading just before the tear
  if(st.crack>0){
    for(const [px,py] of holePts){ const n=40; for(let k=0;k<n*st.crack;k++){ const u=k/n; const x=Math.round(lerp(HC.x,px,u)+Math.sin(u*9+px)*1.2), y=Math.round(lerp(HC.y,py,u)); if(x>=IX0&&x<IX1&&y>=IY0&&y<IY1){ const j=(y*W+x)*3; col[j]=30;col[j+1]=18;col[j+2]=12; } } }
  }

  // clown
  CLIP=st.clip; drawClown(st); const clip=CLIP; CLIP=null;
  // pixel outline around the clown
  for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){
    const i=y*W+x; if(mask[i]) continue;
    if(mask[i-1]||mask[i+1]||mask[i-W]||mask[i+W]){
      if(clip&&(x<clip[0]||x>=clip[2]||y<clip[1]||y>=clip[3])) continue;
      const j=i*3; col[j]=K.dark[0];col[j+1]=K.dark[1];col[j+2]=K.dark[2]; lb[i]=st.lb; em[i]=0;
    }
  }

  // shards
  if(!reduce&&playing&&t>=T_TEAR&&!spawned){ spawnShards(); spawned=true; }
  for(const s of shards){
    s.age+=dt; if(s.age>s.life) continue;
    s.vy+=240*dt; s.x+=s.vx*dt; s.y+=s.vy*dt; s.z+=s.vz*dt;
    const sz=Math.max(1,Math.round(s.z));
    for(let y=0;y<sz;y++)for(let x=0;x<sz;x++){ const px=(s.x|0)+x, py=(s.y|0)+y; if(px<0||py<0||px>=W||py>=H)continue; const i=py*W+px,j=i*3; col[j]=s.c[0];col[j+1]=s.c[1];col[j+2]=s.c[2]; lb[i]=.3; em[i]=0; }
  }

  // candle flame
  const scare=!reduce&&playing&&t>=T_TEAR&&t<REST0;
  let flick=.9+.07*Math.sin(real*13)+.05*Math.sin(real*31.7)+.03*Math.sin(real*57);
  if(scare) flick=.45+.55*hash(Math.floor(real*22),3);
  const lean=scare?Math.sin(real*40)*1.2:Math.sin(real*3)*.3;
  E(I3,21+lean*.5,124-flick,1.8,2.6+flick*1.4,[240,150,40],{em:1,clip:null});
  E(I3,21+lean*.3,125,0.9,1.4+flick*.6,[255,240,190],{em:1,clip:null});

  // lighting: candle + ambient, posterized with ordered dither
  const LX=21, LY=123;
  let flash=0; if(!reduce&&playing&&t>=T_TEAR) flash=Math.max(0,1-(t-T_TEAR)/.16)*.9;
  const d=img.data;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const i=y*W+x, j=i*3, k=i*4;
    const dist=Math.hypot(x-LX,(y-LY)*1.1);
    const cand=1.05*flick*Math.exp(-dist/48);
    let L=.2+cand+lb[i]+flash;
    L=Math.floor(L*7+BAYER[(y&3)*4+(x&3)])/7;
    L=clamp(L,0,1.35);
    const warm=clamp(cand,0,1), e=em[i];
    const r=col[j]*L*(1+.16*warm), gg=col[j+1]*L*(1+.03*warm), b=col[j+2]*L*(1-.18*warm);
    d[k]=r*(1-e)+col[j]*e*1.15; d[k+1]=gg*(1-e)+col[j+1]*e*1.1; d[k+2]=b*(1-e)+col[j+2]*e; d[k+3]=255;
  }
  // camera shake
  let sx=0, sy=0;
  if(!reduce&&playing){
    if(t>=T_TEAR&&t<T_TEAR+.55){ const a=3.5*(1-(t-T_TEAR)/.55); sx=Math.round((Math.random()-.5)*2*a); sy=Math.round((Math.random()-.5)*2*a); }
    else if(st.out&&st.bob>.75&&Math.random()<.5){ sy=Math.random()<.5?-1:1; }
  }
  g.fillStyle='#000'; g.fillRect(0,0,W,H);
  g.putImageData(img,sx,sy);

  if(!reduce&&playing&&t>END){ finish(); return; }
  raf=requestAnimationFrame(render);
}

/* ---------- sound ---------- */
let master=null;
function echoBus(a){
  master=a.createGain(); master.gain.value=VOLUME; master.connect(a.destination);
  const out=a.createGain(); out.gain.value=.9;
  const dl=a.createDelay(1); dl.delayTime.value=.23; const fb=a.createGain(); fb.gain.value=.36;
  const lp=a.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=2200;
  out.connect(master); out.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(master);
  return out;
}
function noise(a,dur,shape){ const len=Math.floor(a.sampleRate*dur), buf=a.createBuffer(1,len,a.sampleRate), ch=buf.getChannelData(0); for(let i=0;i<len;i++) ch[i]=(Math.random()*2-1)*shape(i/len); const n=a.createBufferSource(); n.buffer=buf; return n; }
function creak(a,bus,t){
  const o=a.createOscillator(), gn=a.createGain(), bp=a.createBiquadFilter();
  o.type='sawtooth'; o.frequency.setValueAtTime(38,t); o.frequency.linearRampToValueAtTime(52,t+.28);
  bp.type='bandpass'; bp.frequency.value=420; bp.Q.value=4;
  gn.gain.setValueAtTime(0,t); gn.gain.linearRampToValueAtTime(.35,t+.05); gn.gain.exponentialRampToValueAtTime(.001,t+.3);
  o.connect(bp); bp.connect(gn); gn.connect(bus); o.start(t); o.stop(t+.32);
}
function sting(a,bus,t){
  [92,131,138,196].forEach((f,i)=>{ const o=a.createOscillator(), gn=a.createGain(); o.type=i%2?'sawtooth':'square';
    o.frequency.setValueAtTime(f*2,t); o.frequency.exponentialRampToValueAtTime(f,t+.6);
    gn.gain.setValueAtTime(0,t); gn.gain.linearRampToValueAtTime(.085,t+.01); gn.gain.exponentialRampToValueAtTime(.0001,t+1.1);
    o.connect(gn); gn.connect(bus); o.start(t); o.stop(t+1.2); });
  const n=noise(a,.35,u=>Math.pow(1-u,2)), bp=a.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1800; bp.Q.value=.7;
  const ng=a.createGain(); ng.gain.value=.5; n.connect(bp); bp.connect(ng); ng.connect(bus); n.start(t);
}
function ha(a,bus,t,pitch,dur,vol){
  const o=a.createOscillator(); o.type='sawtooth';
  o.frequency.setValueAtTime(pitch*1.15,t); o.frequency.exponentialRampToValueAtTime(pitch*.8,t+dur);
  const vib=a.createOscillator(), vg=a.createGain(); vib.frequency.value=7; vg.gain.value=pitch*.04; vib.connect(vg); vg.connect(o.frequency);
  const mix=a.createGain(), env=a.createGain();
  env.gain.setValueAtTime(0,t); env.gain.linearRampToValueAtTime(vol,t+.025); env.gain.setValueAtTime(vol,t+dur*.45); env.gain.exponentialRampToValueAtTime(.0001,t+dur);
  const h=noise(a,.06,u=>(1-u)*.5);
  o.connect(mix); h.connect(mix);
  [[780,6,.9],[1250,8,.55],[2600,10,.2]].forEach(([f,q,gv])=>{ const bp=a.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=f; bp.Q.value=q; const gg=a.createGain(); gg.gain.value=gv; mix.connect(bp); bp.connect(gg); gg.connect(env); });
  env.connect(bus);
  o.start(t); vib.start(t); h.start(t); o.stop(t+dur+.05); vib.stop(t+dur+.05);
}
function scheduleSound(){
  const a=audioContext(); if(!a) return; const bus=echoBus(a), t0=a.currentTime+.02;
  creak(a,bus,t0+.72);
  sting(a,bus,t0+T_TEAR);
  for(const e of EVENTS){ ha(a,bus,t0+e.t,e.p,e.d,1); ha(a,bus,t0+e.t+.015,e.p/2,e.d,.8); }
}

let vibrateTimer=0, stillTimer=0;
function finish(){
  if(!alive) return;
  stop();
  opts.onDone();
}
function stop(){
  alive=false; playing=false; shards=[];
  cancelAnimationFrame(raf); clearTimeout(vibrateTimer); clearTimeout(stillTimer);
  if(master){
    try{ const a=master.context; master.gain.setTargetAtTime(0,a.currentTime,.03); const m=master; setTimeout(()=>m.disconnect(),200); }catch(e){}
    master=null;
  }
}

buildBase();
scheduleSound();
start=performance.now()+20; playing=true;
vibrateTimer=setTimeout(()=>{ if(navigator.vibrate) try{navigator.vibrate([80,40,160])}catch(e){} }, reduce?0:T_TEAR*1000);
if(reduce) stillTimer=setTimeout(finish, REDUCED_MOTION_MS);
raf=requestAnimationFrame(render);
return stop;
}
