import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../om-video_v1.28.0.js',import.meta.url),'utf8');
const moveStart=source.indexOf('  function moveRegionBySourcePixels(');
const moveEnd=source.indexOf('  function nudgeSelectedRoi(',moveStart);
assert.ok(moveStart>=0&&moveEnd>moveStart);
const move=vm.runInNewContext(source.slice(moveStart,moveEnd)+';moveRegionBySourcePixels');
const roi={x:.25,y:.5,w:.2,h:.2,sourceWidth:1000,sourceHeight:500,shape:'circle'};
const one=move(roi,1,-1);
assert.ok(Math.abs((one.x-roi.x)*1000-1)<1e-9);
assert.ok(Math.abs((one.y-roi.y)*500+1)<1e-9);
assert.equal(one.shape,'circle');
const fast=move(roi,10,10);
assert.ok(Math.abs((fast.x-roi.x)*1000-10)<1e-9);
assert.ok(Math.abs((fast.y-roi.y)*500-10)<1e-9);
assert.equal(move({...roi,x:0},-1,0).x,0);
assert.equal(move({...roi,x:.8},10,0).x,.8);

const indexStart=source.indexOf('  function stepPreviewIndex(');
const indexEnd=source.indexOf('  document.addEventListener("keydown"',indexStart);
const step=vm.runInNewContext(source.slice(indexStart,indexEnd)+';stepPreviewIndex');
assert.equal(step(5,-1,20),4);
assert.equal(step(5,1,20),6);
assert.equal(step(0,-1,20),0);
assert.equal(step(19,1,20),19);
console.log('Keyboard ROI and preview steps passed: pixel movement, bounds and frame navigation.');
