// Synthetic classic TIFF fixture, independent of the decoder under test.
export function tiff({width=2,height=2,bits=8,photo=2,samples=3,orientation=1,bigEndian=false,compression=1,data,pages=[]}={}){
 data=data||new Uint8Array(width*height*samples).fill(120);
 const specs=[{width,height,bits,photo,samples,orientation,compression,data},...pages];
 const blocks=[];let total=8;
 for(const s of specs){const entries=12,extra=s.samples>1?s.samples*2:0;const offset=total;total+=2+entries*12+4+extra+s.data.length;blocks.push({s,offset,entries,extra});}
 const buffer=new ArrayBuffer(total),v=new DataView(buffer),u=new Uint8Array(buffer),le=!bigEndian;
 u[0]=u[1]=le?73:77;v.setUint16(2,42,le);v.setUint32(4,8,le);
 blocks.forEach(({s,offset,entries,extra},index)=>{
 v.setUint16(offset,entries,le);const aux=offset+2+entries*12+4,pixels=aux+extra;
 const tags=[[256,4,1,s.width],[257,4,1,s.height],[258,3,s.samples,s.samples>1?aux:s.bits],[259,3,1,s.compression],[262,3,1,s.photo],[273,4,1,pixels],[274,3,1,s.orientation],[277,3,1,s.samples],[278,4,1,s.height],[279,4,1,s.data.length],[284,3,1,1],[339,3,1,1]];
 tags.forEach(([tag,type,count,value],i)=>{const o=offset+2+i*12;v.setUint16(o,tag,le);v.setUint16(o+2,type,le);v.setUint32(o+4,count,le);if(type===3&&count===1)v.setUint16(o+8,value,le);else v.setUint32(o+8,value,le);});
 if(s.samples>1)for(let c=0;c<s.samples;c++)v.setUint16(aux+c*2,s.bits,le);
 v.setUint32(offset+2+entries*12,blocks[index+1]?.offset||0,le);u.set(s.data,pixels);
 });return buffer;
}
