import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import {tiff} from './tiff-fixture.mjs';
const c=vm.createContext({console});c.self=c;
for(const file of ['vendor/pako-inflate-1.0.11.min.js','vendor/UTIF-3.1.0.js','tiff_v1.29.0.js']){
 let code=await readFile(new URL('../'+file,import.meta.url),'utf8');
 if(file.startsWith('tiff_'))code=code.replace("const scriptUrl=document.currentScript.src;",'return;');
 vm.runInContext(code,c);
}
const decode=c.OmTiffCodec.decode;
const rgb=new Uint8Array([255,0,0,0,255,0,0,0,255,128,128,128]);
assert.deepEqual([...decode(tiff({data:rgb})).rgba],[255,0,0,255,0,255,0,255,0,0,255,255,128,128,128,255]);
assert.deepEqual([...decode(tiff({data:rgb,bigEndian:true})).rgba],[...decode(tiff({data:rgb})).rgba]);
assert.deepEqual([...decode(tiff({data:new Uint8Array(deflateSync(rgb)),compression:8})).rgba],[...decode(tiff({data:rgb})).rgba]);
for(const bigEndian of [false,true]){
 const data=new Uint8Array(8),view=new DataView(data.buffer);[0,16384,32768,65535].forEach((n,i)=>view.setUint16(i*2,n,!bigEndian));
 const r=decode(tiff({data,bits:16,photo:1,samples:1,bigEndian}));assert.deepEqual([...r.rgba].filter((_,i)=>i%4===0),[0,64,128,255]);
}
const thumb={width:1,height:1,bits:8,photo:2,samples:3,orientation:1,compression:1,data:new Uint8Array([0,0,0])};
const r=decode(tiff({data:rgb,pages:[thumb]}));assert.equal(r.width,2);assert.equal(r.thumbnails,1);assert.equal(r.fullPages,1);
assert.equal(decode(tiff({data:rgb,pages:[{...thumb,width:2,height:2,data:rgb}]})).fullPages,2);
assert.throws(()=>decode(new ArrayBuffer(2)),/Truncated/);
const loop=tiff();new DataView(loop).setUint32(8+2+12*12,8,true);assert.throws(()=>decode(loop),/directory chain/);
const truncated=tiff().slice(0,-3);assert.throws(()=>decode(truncated),/truncated TIFF pixel blocks/);
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');assert(html.includes('vendor/UTIF-3.1.0.js')&&html.includes('tiff_v1.29.0.js'));assert.equal(html,await readFile(new URL('../om_echem_video_web_v1.29.0.html',import.meta.url),'utf8'));
console.log('TIFF: RGB pixels, endian, Deflate, 16-bit fixed mapping, thumbnail/stack selection, malformed input and matching HTML passed.');
