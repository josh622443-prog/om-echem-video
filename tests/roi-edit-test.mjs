import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../om-video_v1.28.0.js',import.meta.url),'utf8');
const start=source.indexOf('  function adjustedRegion(');
const end=source.indexOf('\n  async function beginZoomRoiPicking',start);
assert.ok(start>=0&&end>start,'ROI geometry function is available');
const adjust=vm.runInNewContext(`${source.slice(start,end)}\nadjustedRegion`);
const round=region=>Object.fromEntries(['x','y','w','h'].map(key=>[key,Number(region[key].toFixed(3))]));
const roi={x:.2,y:.3,w:.4,h:.2,shape:'circle'};

assert.deepEqual(round(adjust(roi,{x:.3,y:.4},{x:.4,y:.5},'move')),{x:.3,y:.4,w:.4,h:.2});
assert.deepEqual(round(adjust(roi,{x:.3,y:.4},{x:2,y:-1},'move')),{x:.6,y:0,w:.4,h:.2});
assert.deepEqual(round(adjust(roi,{x:.2,y:.3},{x:.1,y:.1},'nw')),{x:.1,y:.1,w:.5,h:.4});
assert.deepEqual(round(adjust(roi,{x:.6,y:.5},{x:2,y:2},'se')),{x:.2,y:.3,w:.8,h:.7});
assert.deepEqual(round(adjust(roi,{x:.6,y:.3},{x:-1,y:2},'ne')),{x:.2,y:.48,w:.02,h:.02});
assert.equal(adjust(roi,{x:.3,y:.4},{x:.4,y:.5},'move').shape,'circle');
console.log('ROI editing geometry passed: move, resize, bounds, minimum size, ellipse preservation.');
