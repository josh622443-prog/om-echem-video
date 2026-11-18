/* OM TIFF codec v1.29.1. Local classic TIFF decoding, no network requests. */
(function(root){
'use strict';
const workerScope=typeof document==='undefined'&&typeof importScripts==='function';
if(workerScope) importScripts('vendor/pako-inflate-1.0.11.min.js','vendor/UTIF-3.1.0.js');
function decode(buffer){
 const bytes=new Uint8Array(buffer);
 if(bytes.length<8)throw Error('Truncated TIFF header');
 const le=bytes[0]===73&&bytes[1]===73, be=bytes[0]===77&&bytes[1]===77;
 if(!le&&!be)throw Error('Not a TIFF file');
 const magic=new DataView(buffer).getUint16(2,le);
 if(magic===43)throw Error('BigTIFF is not supported; export as classic TIFF or PNG');
 if(magic!==42)throw Error('Invalid TIFF header');
 const view=new DataView(buffer),seen=new Set();let directory=view.getUint32(4,le);
 while(directory){
  if(seen.has(directory)||seen.size>=128||directory<8||directory+2>bytes.length)throw Error('Invalid TIFF directory chain');
  seen.add(directory);const count=view.getUint16(directory,le),next=directory+2+count*12;
  if(next+4>bytes.length)throw Error('Truncated TIFF directory');directory=view.getUint32(next,le);
 }
 const ifds=root.UTIF.decode(buffer);
 const pages=ifds.filter(p=>p.t256?.[0]>0&&p.t257?.[0]>0&&!((p.t254?.[0]||0)&4));
 if(!pages.length)throw Error('No image directory found');
 // Ignore reduced thumbnails; use the first largest image, never treat a thumbnail as a timepoint.
 const page=pages.reduce((a,b)=>b.t256[0]*b.t257[0]>a.t256[0]*a.t257[0]?b:a);
 const width=page.t256[0],height=page.t257[0], bits=page.t258||[1], bps=bits[0], photo=page.t262?.[0]??1;
 if(!Number.isSafeInteger(width*height)||width*height>40000000)throw Error('TIFF exceeds the 40 megapixel display limit');
 if((page.t284?.[0]||1)!==1)throw Error('Planar TIFF is not supported; export interleaved RGB or PNG');
 if((page.t339||[1]).some(v=>v!==1))throw Error('Signed / floating-point TIFF is not supported; export unsigned TIFF or PNG');
 if(bits.some(b=>b!==bps))throw Error('Mixed channel bit depths are not supported');
 const samples=page.t277?.[0]||bits.length;
 if(!((photo<=1&&samples===1&&[1,2,4,8,16].includes(bps))||(photo===2&&[3,4].includes(samples)&&[8,16].includes(bps))||(photo===3&&samples===1&&bps===8)))throw Error('Unsupported TIFF color / bit-depth layout');
 const compression=page.t259?.[0]||1;
 if(![1,3,4,5,6,7,8,32773].includes(compression))throw Error('Unsupported TIFF compression '+compression);
 const offsets=page.t273||page.t324,counts=page.t279||page.t325;
 if(!offsets||!counts||offsets.length!==counts.length||offsets.some((v,i)=>v<8||counts[i]<=0||v+counts[i]>buffer.byteLength))throw Error('Invalid or truncated TIFF pixel blocks');
 root.UTIF.decodeImage(buffer,page,ifds);
 let rgba;
 if(photo<=1){
  // Fixed unsigned full-range mapping across frames; no per-frame auto normalization.
  const data=page.data,rowBytes=Math.ceil(width*bps/8),max=2**bps-1;rgba=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   let v;if(bps===16){const o=y*rowBytes+x*2;v=data[o]|data[o+1]<<8;}
   else if(bps===8)v=data[y*rowBytes+x];
   else {const bit=x*bps;v=(data[y*rowBytes+(bit>>3)]>>(8-bps-(bit&7)))&max;}
   let value=Math.round(v/max*255);if(photo===0)value=255-value;const o=(y*width+x)*4;rgba[o]=rgba[o+1]=rgba[o+2]=value;rgba[o+3]=255;
  }
 }else rgba=root.UTIF.toRGBA8(page);
 if(rgba.length!==width*height*4)throw Error('Incorrect decoded TIFF size');
 const fullPages=pages.filter(p=>p.t256[0]===width&&p.t257[0]===height).length;
 return {width,height,rgba,orientation:page.t274?.[0]||1,bits:bps,fullPages,thumbnails:pages.length-fullPages};
}
root.OmTiffCodec={decode};
if(workerScope){root.onmessage=async e=>{try{const result=decode(await e.data.arrayBuffer());root.postMessage({ok:true,result},[result.rgba.buffer]);}catch(error){root.postMessage({ok:false,error:error.message});}};return;}
const scriptUrl=document.currentScript.src;
let queue=Promise.resolve(),worker=null,workerDisabled=location.protocol==='file:';
function mainDecode(file){return new Promise(resolve=>setTimeout(resolve,0)).then(()=>file.arrayBuffer()).then(decode);}
async function run(file){
 if(workerDisabled)return mainDecode(file);
 try{if(!worker)worker=new Worker(scriptUrl);}catch{workerDisabled=true;return mainDecode(file);}
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{worker.terminate();worker=null;reject(Error('TIFF decode timed out'));},60000);
  worker.onmessage=e=>{clearTimeout(timer);e.data.ok?resolve(e.data.result):reject(Error(e.data.error));};
  worker.onerror=()=>{clearTimeout(timer);worker.terminate();worker=null;workerDisabled=true;mainDecode(file).then(resolve,reject);};
  worker.postMessage(file);
 });
}
function toCanvas(result){
 const {width:w,height:h,rgba,orientation:o}=result;
 if(o<1||o>8)throw Error('Invalid TIFF orientation');
 const source=document.createElement('canvas');source.width=w;source.height=h;
 source.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer,rgba.byteOffset,rgba.byteLength),w,h),0,0);
 if(o===1){source.tiffInfo=result;delete result.rgba;return source;}
 const output=document.createElement('canvas');output.width=o>=5?h:w;output.height=o>=5?w:h;
 const matrices={2:[-1,0,0,1,w,0],3:[-1,0,0,-1,w,h],4:[1,0,0,-1,0,h],5:[0,1,1,0,0,0],6:[0,1,-1,0,h,0],7:[0,-1,-1,0,h,w],8:[0,-1,1,0,0,w]};
 const ctx=output.getContext('2d');ctx.setTransform(...matrices[o]);ctx.drawImage(source,0,0);source.width=source.height=0;
 output.tiffInfo=result;delete result.rgba;return output;
}
root.OmTiffImages={decode(file){const job=queue.then(()=>run(file)).then(toCanvas);queue=job.catch(()=>{});return job;}};
})(globalThis);
