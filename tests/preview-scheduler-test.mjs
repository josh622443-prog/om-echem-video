import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../om-video_v1.29.1.js',import.meta.url),'utf8');
const start=source.indexOf('  function createLatestPreviewScheduler('),end=source.indexOf('  const previewWork =',start);
const create=vm.runInNewContext(source.slice(start,end)+';createLatestPreviewScheduler',{setTimeout,clearTimeout});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let release,active=0,maxActive=0;const started=[];
const scheduler=create(async id=>{started.push(id);active++;maxActive=Math.max(maxActive,active);if(id===1)await new Promise(r=>release=r);active--;},5);
scheduler.request(1);await wait(15);for(let i=2;i<=100;i++)scheduler.request(i);await wait(15);assert.deepEqual(started,[1]);release();await wait(20);assert.deepEqual(started,[1,100]);assert.equal(maxActive,1);
scheduler.request(101);scheduler.cancel();await wait(15);assert.deepEqual(started,[1,100]);
const a=source.indexOf('  function alignmentScore('),b=source.indexOf('  async function getAlignmentShift(',a);
let tick=0;const context={performance:{now:()=>tick+=20},setTimeout,DOMException};
const {bestOffset}=vm.runInNewContext(source.slice(a,b)+';({bestOffset,alignmentScore})',context);
const w=48,h=48,gray=new Float32Array(w*h);let seed=12;for(let i=0;i<gray.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;gray[i]=seed%256;}
const shifted=new Float32Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){if(x>=2&&y+1<h)shifted[y*w+x]=gray[(y+1)*w+x-2];}
const ref={gray,width:w,height:h},cur={gray:shifted,width:w,height:h},roi={x:.2,y:.2,w:.6,h:.6};
let heartbeats=0;const timer=setInterval(()=>heartbeats++,0);const found=await bestOffset(ref,cur,roi,0,0,4,4,1);clearInterval(timer);assert.equal(found.dx,2);assert.equal(found.dy,-1);assert(found.score>.9999);assert(heartbeats>0);
await assert.rejects(bestOffset(ref,cur,roi,0,0,4,4,1,()=>true),e=>e.name==='AbortError');
const preA=source.indexOf('  function preloadAround('),preB=source.indexOf('\n  }',preA)+4;
const loads=[];const scope={imageEntries:[{file:{name:'a0.png',size:20e6}},{file:{name:'a1.png',size:20e6}},{file:{name:'a2.png',size:20e6}}],loadImage:f=>{loads.push(f.name);return Promise.resolve();}};
vm.runInNewContext(source.slice(preA,preB)+';preloadAround(1)',scope);assert.deepEqual(loads,['a1.png']);
console.log('Preview: newest of 100 requests, single active render, cancel, large PNG preload bounds, alignment yield/cancel and exact offset passed.');
