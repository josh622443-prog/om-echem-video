import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../om-video_v1.28.0.js',import.meta.url),'utf8');
const start=source.indexOf('  function coverageRowAt('),end=source.indexOf('\n  function drawMainLabels(',start);
assert.ok(start>=0&&end>start,'Coverage label functions are available');
const context={coverageResults:{
  rows:[{time:0,values:[4,12,21,33]},{time:10,values:[8,15,25,40]}],
  series:[{color:'#00e5ff'}]
},bi:(zh,en)=>en,Number};
vm.createContext(context);
vm.runInContext(source.slice(start,end),context);
assert.equal(context.mainCoverageLabelAt(9).text,'Local coverage = 8.0%');
assert.equal(context.roiCoverageAt(9,0),15);
assert.equal(context.roiCoverageAt(9,1),25);
assert.equal(context.roiCoverageAt(9,2),40);
assert.equal(context.roiCoverageAt(9,3),null);
assert.equal(context.roiCoverageAt(0,2),33);
context.coverageResults=null;
assert.equal(context.mainCoverageLabelAt(9),null);
assert.equal(context.roiCoverageAt(9,0),null);
console.log('Coverage labels passed: main and each ROI use their own time-aligned value.');
