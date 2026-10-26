/* Kobra Mesh Lab — offline-only, no networking, no external runtime dependencies.
   Diagnostic archive is a traditional ZipCrypto encrypted ZIP containing avata_main*.log.
   Coordinate interpretation matches the log exporter: rows = ascending Y, columns = ascending X.
*/
'use strict';
const MAX_LOG_BYTES = 18 * 1024 * 1024;
const MAX_TOTAL_LOG_BYTES = 64 * 1024 * 1024;
const MAX_CSV_BYTES = 2 * 1024 * 1024;
const MAX_LOG_ENTRIES = 50;
const PACK_PASSWORD = '2YLVrATRvUEnMeXk6Vtc7qxfzYM4TJzrLnEBma8zpUKeGtseGWqp4LXs7e8KeU2u';
const $ = id => document.getElementById(id);
const state = { A: [], B: [], selectedA: null, selectedB: null, difference: null, demo: false };
const mapRenderCache = new Map();
const PNG_EXPORT_SCALE = 2;
const BUILD_PLATE_SIZE = 265;
function buildPlateRect(size=BUILD_PLATE_SIZE){ return [0,0,size,size]; }
function unionRect(a,b){ return [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[2],b[2]),Math.max(a[3],b[3])]; }
function mapXYToCanvas(rect,x0,y0,plotW,plotH,x,y){ return [x0+(x-rect[0])/(rect[2]-rect[0])*plotW, y0+plotH-(y-rect[1])/(rect[3]-rect[1])*plotH]; }
/* Both the 2D and 3D plate layers originate from assets/pei-kobra-x.svg.
   The physical 0..265 square maps to SVG coordinates [81.2,67.3]..[1172.3,1155.2].
   The lower-right tab extends beyond that square for orientation only. */
function drawPlateArt2D(ctx,viewRect,x0,y0,plotW,plotH,layer){
  if(typeof KOBRA_PLATE==='undefined'||!KOBRA_PLATE.isReady(layer)) return;
  const rect=KOBRA_PLATE.worldRect;
  const [left,top]=mapXYToCanvas(viewRect,x0,y0,plotW,plotH,rect[0],rect[3]);
  const [right,bottom]=mapXYToCanvas(viewRect,x0,y0,plotW,plotH,rect[2],rect[1]);
  ctx.save();
  ctx.globalAlpha=layer==='base'?0.24:0.95;
  if(layer==='marks'){
    ctx.shadowColor='rgba(35,45,53,.7)';ctx.shadowBlur=1.8;
  }
  ctx.drawImage(KOBRA_PLATE.images[layer],left,top,right-left,bottom-top);
  ctx.restore();
}
const decoder = new TextDecoder('utf-8', { fatal: false });
const encoder = new TextEncoder();
const number = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
const RE_REGION = new RegExp('The adaptive Bed region:\\s*\\(\\[\\s*('+number+')\\s*,\\s*('+number+')\\s*\\],\\[\\s*('+number+')\\s*,\\s*('+number+')\\s*\\]\\)');
const RE_POINTS = /The adaptive Bed points:\s*\((\d+)\s*,\s*(\d+)\)/;
const RE_STAMP = /^\[(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/;
const RE_MROW = new RegExp('^\\s*\\[((?:\\s*'+number+'\\s*,)*\\s*'+number+'\\s*)\\]\\s*$');
function setStatus(message, level = '') { $('status').textContent = message; $('status').className = 'status ' + level; }
const u16 = (d,p) => d.getUint16(p,true), u32=(d,p)=>d.getUint32(p,true);
const crcTable = new Uint32Array(256);
for (let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);crcTable[i]=c>>>0;}
const crcStep=(c,b)=>(crcTable[(c^b)&255]^(c>>>8))>>>0;
function crc32(bytes){let c=0xffffffff;for(let i=0;i<bytes.length;i++)c=crcStep(c,bytes[i]);return (c^0xffffffff)>>>0;}
function zipDecrypt(input, password, expected, verifyTime, usesDescriptor){
  let k0=0x12345678,k1=0x23456789,k2=0x34567890;
  function advance(b){k0=crcStep(k0,b);k1=(Math.imul(((k1+(k0&255))>>>0),134775813)+1)>>>0;k2=crcStep(k2,k1>>>24);}
  for(const b of encoder.encode(password))advance(b);
  const out = new Uint8Array(input.length);
  for(let i=0;i<input.length;i++){
    const t=(k2|2)>>>0;
    const decrypt = (Math.imul(t,(t^1))>>>8)&255;
    const plain=input[i]^decrypt;
    out[i]=plain;
    advance(plain);
  }
  if(out.length<12)throw Error('Incomplete ZIP encryption header');
  const check=usesDescriptor?((verifyTime>>>8)&255):((expected>>>24)&255);
  if(out[11]!==check)throw Error('Incorrect archive password or corrupted encrypted header');
  return out.subarray(12);
}
function zipEntries(buffer){
  const dv=new DataView(buffer), bytes=new Uint8Array(buffer);const end=Math.max(0,bytes.length-65557);
  let eocd=-1;for(let i=bytes.length-22;i>=end;i--){if(dv.getUint32(i,true)===0x06054b50){eocd=i;break;}}
  if(eocd<0)throw Error('Not a ZIP-based AC_LOG archive');
  const count=u16(dv,eocd+10), centralStart=u32(dv,eocd+16);
  if(count>1000||centralStart>=bytes.length)throw Error('Unsupported ZIP directory');
  const entries=[];let cur=centralStart;
  for(let i=0;i<count;i++){
    if(cur+46>bytes.length||u32(dv,cur)!==0x02014b50)throw Error('Invalid ZIP central directory');
    const flag=u16(dv,cur+8),method=u16(dv,cur+10),time=u16(dv,cur+12);
    const crc=u32(dv,cur+16),size=u32(dv,cur+20),plainSize=u32(dv,cur+24);
    const nameLen=u16(dv,cur+28),extra=u16(dv,cur+30),comment=u16(dv,cur+32),off=u32(dv,cur+42);
    if(cur+46+nameLen+extra+comment>bytes.length)throw Error('ZIP directory is truncated');
    const name=decoder.decode(bytes.subarray(cur+46,cur+46+nameLen));
    entries.push({name,flag,method,time,crc,size,plainSize,off});
    cur+=46+nameLen+extra+comment;
  }
  return { dv,bytes,entries };
}
// Limit actual decompressed output: ZIP metadata alone is not a safe zip-bomb guard.
function inflateRawLimited(payload, expected){
  const inflater=new window.pako.Inflate({raw:true});
  const chunks=[];
  let total=0;
  inflater.onData=chunk=>{
    total+=chunk.length;
    if(total>MAX_LOG_BYTES || total>expected)throw Error('Decompressed log exceeds safety limit or declared ZIP size');
    chunks.push(chunk);
  };
  inflater.push(payload,true);
  if(inflater.err||!inflater.ended)throw Error('Corrupted DEFLATE stream');
  const out=new Uint8Array(total);let offset=0;
  for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}
  return out;
}
function getArchiveEntry(zip, e){
  const {dv,bytes}=zip;
  if(e.plainSize>MAX_LOG_BYTES||e.size>MAX_LOG_BYTES)throw Error(`Oversized log (${e.name})`);
  if(e.off+30>bytes.length||u32(dv,e.off)!==0x04034b50)throw Error('Invalid local ZIP header');
  const pos=e.off+30+u16(dv,e.off+26)+u16(dv,e.off+28);
  if(pos+e.size>bytes.length)throw Error('Truncated ZIP entry');
  let payload=bytes.subarray(pos,pos+e.size);
  if(e.flag&1)payload=zipDecrypt(payload,PACK_PASSWORD,e.crc,e.time,!!(e.flag&8));
  let clear;
  if(e.method===0)clear=payload;
  else if(e.method===8)clear=inflateRawLimited(payload,e.plainSize);
  else throw Error(`Unsupported ZIP compression method ${e.method}`);
  if(clear.length!==e.plainSize||crc32(clear)!==e.crc)throw Error(`Invalid checksum for ${e.name}`);
  return clear;
}
function parseLog(text, source){
  const lines=text.split(/\r?\n/), meshes=[];
  let region=null, dims=null, regionTime=null, mode='unknown', probeWarnings=[];
  // Non-adaptive Kobra X probing omits "The adaptive Bed region".
  // Keep each probing run separate to avoid attaching old print regions to a full-bed grid.
  const probeStart=/script:LEVIQ_PROBE(?:\s+ADAPTIVE=(\d+))?\b/;
  const warningCoord=/\(\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)\s*\)Sampled data exceeds the threshold/;
  const evenlySpaced=values => values.length>1 && values.every((v,i)=>i===0||Math.abs((v-values[0])/(i)-(values[1]-values[0]))<0.05);
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    const begin=probeStart.exec(line);
    if(begin){
      mode=begin[1]==='0'?'full':'adaptive';
      region=null;dims=null;regionTime=null;probeWarnings=[];
    }
    const r=RE_REGION.exec(line);
    if(r){region=r.slice(1).map(Number);regionTime=RE_STAMP.exec(line)?.slice(1).join(' ')||null;mode='adaptive';}
    const p=RE_POINTS.exec(line);if(p)dims=p.slice(1).map(Number);
    if(mode==='full'){
      const xy=warningCoord.exec(line);
      if(xy)probeWarnings.push([Number(xy[1]),Number(xy[2])]);
    }
    if(!line.includes('Bed Leveling: Regions:'))continue;
    const rows=[];
    for(let j=i+1;j<lines.length;j++){
      const m=RE_MROW.exec(lines[j]);if(!m)break;
      const values=m[1].split(',').map(Number);
      if(values.every(Number.isFinite))rows.push(values);else break;
      if(rows.length>300)break;
    }
    if(rows.length<2||rows[0].length<2||rows.length*rows[0].length>5000||rows.some(x=>x.length!==rows[0].length))continue;
    const stamp=RE_STAMP.exec(line),date=stamp?.[1]||'Unknown date',time=stamp?.[2]||'Unknown time';
    const nx=rows[0].length,ny=rows.length;
    let validRegion=region&&region.every(Number.isFinite)&&region[2]>region[0]&&region[3]>region[1];
    if(validRegion&&regionTime&&stamp){
      const t1=Date.parse(regionTime.replace(' ','T')),t2=Date.parse(date+'T'+time);
      if(Number.isFinite(t1)&&Number.isFinite(t2)&&Math.abs(t2-t1)>30*60*1000)validRegion=false;
    }
    // Only trust coordinates independently recovered from this full-bed probing run.
    // Warnings are incidental; if they don't cover all rows/columns, leave XY unknown.
    let inferredRegion=null;
    if(mode==='full'){
      const xs=[...new Set(probeWarnings.map(pair=>pair[0]))].sort((a,b)=>a-b);
      const ys=[...new Set(probeWarnings.map(pair=>pair[1]))].sort((a,b)=>a-b);
      if(xs.length===nx&&ys.length===ny&&evenlySpaced(xs)&&evenlySpaced(ys)){
        inferredRegion=[xs[0],ys[0],xs.at(-1),ys.at(-1)];
      }
    }
    const gridRegion=mode==='full'?inferredRegion:(validRegion&&(!dims||(dims[0]===nx&&dims[1]===ny))?[...region]:null);
    const mesh={rows,region:gridRegion,date,time,source,dims:[nx,ny],nx,ny,mode:mode==='full'?'full':mode==='adaptive'?'adaptive':'unknown',
      regionSource:mode==='full'&&inferredRegion?'probe retry coordinates':gridRegion?'firmware region':'unavailable'};
    meshes.push(mesh);
    // End of run: prevent accidental reuse of a previously detected area.
    region=null;dims=null;regionTime=null;mode='unknown';probeWarnings=[];
  }
  return meshes;
}
async function parseFile(file){
  if(file.size>80*1024*1024)throw Error('File is larger than the 80 MB safety limit.');
  const buffer=await file.arrayBuffer();
  if(file.name.toLowerCase().endsWith('.csv')){if(file.size>MAX_CSV_BYTES)throw Error('CSV is larger than the 2 MB safety limit.');return [parseCSV(decoder.decode(buffer),file.name)];}
  const zip=zipEntries(buffer);
  const targets=zip.entries.filter(e=>/^avata_main(?:\.\d+)?\.log$/i.test(e.name.split('/').pop()));
  if(!targets.length)throw Error('Archive has no avata_main*.log entries. Is it the printer’s AC_LOG export?');
  if(targets.length>MAX_LOG_ENTRIES||targets.reduce((sum,e)=>sum+e.plainSize,0)>MAX_TOTAL_LOG_BYTES)throw Error('Archive exceeds the log entry count or total expanded size safety limit.');
  const result=[];let errors=[];
  for(const entry of targets){
    try { const data=getArchiveEntry(zip,entry); result.push(...parseLog(decoder.decode(data),entry.name)); }
    catch(e) { errors.push(entry.name+': '+e.message); }
  }
  if(!result.length)throw Error(errors.length?`No mesh recovered. ${errors[0]}`:'No "Bed Leveling: Regions" matrix found. Export logs after calibration.');
  const unique=new Map();for(const m of result)unique.set([m.date,m.time,m.region?.join(','),m.rows.flat().join(',')].join('|'),m);
  return [...unique.values()].sort((a,b)=>(a.date+' '+a.time).localeCompare(b.date+' '+b.time));
}
function parseCSV(raw,name){
  const lines=raw.trim().split(/\r?\n/).filter(Boolean);
  if(lines.length>5001)throw Error('CSV has too many rows (max 5,000 measurements).');
  if(lines.length<5||lines[0].replace(/^\uFEFF/,'').trim()!=='x_mm,y_mm,z_mm,column,row')throw Error('CSV columns must be x_mm,y_mm,z_mm,column,row (as exported by Mesh Lab).');
  const vals=[];
  for(const line of lines.slice(1)){
    const c=line.split(',').map(Number);if(c.length!==5||c.some(v=>!Number.isFinite(v)))throw Error('Invalid numeric CSV row');
    vals.push(c);
  }
  const nx=Math.max(...vals.map(v=>v[3]))+1, ny=Math.max(...vals.map(v=>v[4]))+1;
  if(nx<2||ny<2||nx*ny!==vals.length||nx*ny>5000)throw Error('CSV must contain one complete rectangular grid');
  const rows=Array.from({length:ny},()=>Array(nx).fill(null));
  for(const [x,y,z,col,row] of vals){if(!Number.isInteger(col)||!Number.isInteger(row)||row<0||col<0||row>=ny||col>=nx||rows[row][col]!==null)throw Error('Duplicate or invalid grid coordinates in CSV');rows[row][col]=z;}
  if(rows.some(r=>r.some(z=>z===null)))throw Error('Incomplete CSV grid');
  const r=[Math.min(...vals.map(v=>v[0])),Math.min(...vals.map(v=>v[1])),Math.max(...vals.map(v=>v[0])),Math.max(...vals.map(v=>v[1]))];
  if(r[0]===r[2]||r[1]===r[3])throw Error('CSV must have distinct XY coordinates');
  const dt=/\d{4}-\d{2}-\d{2}/.exec(name),tm=/\d{2}-\d{2}-\d{2}/.exec(name);
  return {rows,region:r,date:dt?.[0]||'CSV import',time:tm?.[0]?.replace(/-/g,':')||'',source:name,nx,ny};
}
function flatten(m){return m.rows.flat();}
function minMax(m){const a=flatten(m);return {min:Math.min(...a),max:Math.max(...a),range:Math.max(...a)-Math.min(...a)};}
function sample(m,x,y){
  if(!m?.region)return NaN;
  const [x0,y0,x1,y1]=m.region,eps=1e-8;
  if(x<x0-eps||x>x1+eps||y<y0-eps||y>y1+eps)return NaN;
  const fx=Math.min(m.nx-1,Math.max(0,(x-x0)/(x1-x0)*(m.nx-1))),fy=Math.min(m.ny-1,Math.max(0,(y-y0)/(y1-y0)*(m.ny-1)));
  const i=Math.min(m.nx-2,Math.floor(fx)),j=Math.min(m.ny-2,Math.floor(fy)),a=fx-i,b=fy-j;
  const z=m.rows;return z[j][i]*(1-a)*(1-b)+z[j][i+1]*a*(1-b)+z[j+1][i]*(1-a)*b+z[j+1][i+1]*a*b;
}
function pointsOf(m){
  if(!m?.region)return [];
  const [xmin,ymin,xmax,ymax]=m.region,p=[];
  for(let j=0;j<m.ny;j++)for(let i=0;i<m.nx;i++)p.push({x:xmin+(xmax-xmin)*i/(m.nx-1),y:ymin+(ymax-ymin)*j/(m.ny-1),z:m.rows[j][i]});
  return p;
}
function solve3(A,b){let m=A.map((row,i)=>[...row,b[i]]);for(let k=0;k<3;k++){let best=k;for(let i=k+1;i<3;i++)if(Math.abs(m[i][k])>Math.abs(m[best][k]))best=i;if(Math.abs(m[best][k])<1e-12)return null;[m[k],m[best]]=[m[best],m[k]];const pivot=m[k][k];for(let j=k;j<4;j++)m[k][j]/=pivot;for(let i=0;i<3;i++)if(i!==k){const factor=m[i][k];for(let j=k;j<4;j++)m[i][j]-=factor*m[k][j];}}return m.map(x=>x[3]);}
function fitPlane(pts){
  const n=pts.length;if(n<4)return null;const cx=pts.reduce((s,p)=>s+p.x,0)/n,cy=pts.reduce((s,p)=>s+p.y,0)/n;
  let sxx=0,sxy=0,syy=0,sx=0,sy=0,sz=0,sxz=0,syz=0;
  for(const p of pts){let x=p.x-cx,y=p.y-cy;sxx+=x*x;sxy+=x*y;syy+=y*y;sx+=x;sy+=y;sz+=p.z;sxz+=x*p.z;syz+=y*p.z;}
  const q=solve3([[n,sx,sy],[sx,sxx,sxy],[sy,sxy,syy]],[sz,sxz,syz]);
  if(!q)return null;
  const predicted=(x,y)=>q[0]+q[1]*(x-cx)+q[2]*(y-cy);
  let sq=0;for(const p of pts)sq+=(p.z-predicted(p.x,p.y))**2;
  return {a:q[0],dx:q[1],dy:q[2],cx,cy,rms:Math.sqrt(sq/n), predicted};
}
function makeDifference(a,b,mode){
  if(!a.region||!b.region)return {issue:'One mesh lacks XY bounds, so coordinate-based comparison is unavailable.'};
  const r=[Math.max(a.region[0],b.region[0]),Math.max(a.region[1],b.region[1]),Math.min(a.region[2],b.region[2]),Math.min(a.region[3],b.region[3])];
  if(r[2]-r[0]<1||r[3]-r[1]<1)return {issue:'The two adaptive probing regions do not overlap enough to compare.'};
  const nx=51,ny=51,rows=[],p=[];
  for(let j=0;j<ny;j++){let row=[];for(let i=0;i<nx;i++){const x=r[0]+(r[2]-r[0])*i/(nx-1),y=r[1]+(r[3]-r[1])*j/(ny-1),z=sample(b,x,y)-sample(a,x,y);row.push(z);p.push({x,y,z});}rows.push(row);}
  const rawMean=p.reduce((s,q)=>s+q.z,0)/p.length,plane=fitPlane(p);
  if(mode==='centered')for(const row of rows)for(let i=0;i<row.length;i++)row[i]-=rawMean;
  if(mode==='detrended'&&plane)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const x=r[0]+(r[2]-r[0])*i/(nx-1),y=r[1]+(r[3]-r[1])*j/(ny-1);rows[j][i]-=plane.predicted(x,y);}
  const w=flatten({rows});const rms=Math.sqrt(w.reduce((s,z)=>s+z*z,0)/w.length);
  return {mesh:{rows,region:r,nx,ny,date:'Difference',time:'',source:'B − A',virtual:true},rawMean,plane,rms,issue:null};
}
const lerp=(a,b,t)=>a+(b-a)*t;
function heatRGB(z,min,max){
  let t=(z-min)/(max-min||1);t=Math.max(0,Math.min(1,t));
  const low=[34,115,158],mid=[223,237,231],high=[234,108,82];let v=t<.5?t*2:(t-.5)*2,c0=t<.5?low:mid,c1=t<.5?mid:high;
  return [0,1,2].map(k=>Math.round(lerp(c0[k],c1[k],v)));
}
function paintEmpty(canvas,text){const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);ctx.fillStyle='#f7fafc';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#cfd8df';ctx.setLineDash([6,8]);ctx.strokeRect(54,23,w-74,h-75);ctx.setLineDash([]);ctx.fillStyle='#667788';ctx.font='16px system-ui';ctx.textAlign='center';ctx.fillText(text,w/2,h/2);ctx.textAlign='start';}
function paintMap(canvas,m,scale,showDots=true,showPlate=false,opts={}){
  if(!m){paintEmpty(canvas,'No calibration loaded');return;}
  if(canvas.id)mapRenderCache.set(canvas.id,{m,scale,showDots,showPlate,opts});
  const exportScale=opts.exportScale||1;
  const ctx=canvas.getContext('2d');
  ctx.setTransform(exportScale,0,0,exportScale,0,0);
  const w=canvas.width/exportScale,h=canvas.height/exportScale;
  const showValues=!!opts.showValues;
  const valueGrid=opts.valueGrid||null;
  ctx.fillStyle='#f7fafc';ctx.fillRect(0,0,w,h);
  const left=52,top=19,bottom=42,right=17,availW=w-left-right,availH=h-top-bottom;
  const region=m.region||[0,0,m.nx-1,m.ny-1];
  const plate=buildPlateRect();
  const viewRect=showPlate?unionRect(region,plate):region;
  const ratio=(viewRect[2]-viewRect[0])/(viewRect[3]-viewRect[1]);
  let plotW=availW,plotH=availH;if(availW/availH>ratio)plotW=availH*ratio;else plotH=availW/ratio;
  const x0=left+(availW-plotW)/2,y0=top+(availH-plotH)/2;
  if(showPlate)drawPlateArt2D(ctx,viewRect,x0,y0,plotW,plotH,'base');
  const px=180*exportScale,py=Math.max(60*exportScale,Math.round(px/ratio)),buf=document.createElement('canvas');buf.width=px;buf.height=py;
  const bctx=buf.getContext('2d'),image=bctx.createImageData(px,py);
  for(let j=0;j<py;j++)for(let i=0;i<px;i++){
    const x=region[0]+(region[2]-region[0])*(i+.5)/px,y=region[3]-(region[3]-region[1])*(j+.5)/py;
    const z=m.region?sample(m,x,y):sample({...m,region},x,y);
    const color=heatRGB(z,scale.min,scale.max),ind=(j*px+i)*4;
    image.data[ind]=color[0];image.data[ind+1]=color[1];image.data[ind+2]=color[2];image.data[ind+3]=255;
  }
  bctx.putImageData(image,0,0);
  ctx.imageSmoothingEnabled=true;
  const [hx0,hy1]=mapXYToCanvas(viewRect,x0,y0,plotW,plotH,region[0],region[1]);
  const [hx1,hy0]=mapXYToCanvas(viewRect,x0,y0,plotW,plotH,region[2],region[3]);
  ctx.drawImage(buf,hx0,hy0,hx1-hx0,hy1-hy0);
  if(showPlate)drawPlateArt2D(ctx,viewRect,x0,y0,plotW,plotH,'marks');
  ctx.strokeStyle='rgba(84,102,120,.42)';ctx.lineWidth=1;ctx.strokeRect(hx0,hy0,hx1-hx0,hy1-hy0);
  ctx.strokeStyle='rgba(120,138,152,.28)';
  for(let t=1;t<5;t++){
    let x=x0+t*plotW/5,y=y0+t*plotH/5;ctx.beginPath();ctx.moveTo(x,y0);ctx.lineTo(x,y0+plotH);ctx.moveTo(x0,y);ctx.lineTo(x0+plotW,y);ctx.stroke();
  }
  const drawValueLabel=(x,y,z)=>{
    const cellColor=heatRGB(z,scale.min,scale.max);
    const luminance=(0.2126*cellColor[0]+0.7152*cellColor[1]+0.0722*cellColor[2])/255;
    const label=(z>0?'+':'')+z.toFixed(2).replace('-', '−');
    ctx.font='bold 11px ui-monospace,monospace';
    ctx.textAlign='center';
    ctx.lineWidth=3.2;
    ctx.strokeStyle=luminance>0.72?'rgba(255,255,255,0.98)':'rgba(248,250,252,0.94)';
    ctx.fillStyle=luminance>0.72?'#24313a':'#13202a';
    ctx.strokeText(label,x,y-6);
    ctx.fillText(label,x,y-6);
  };
  if(showDots&&!m.virtual&&m.nx*m.ny<=70){
    for(let j=0;j<m.ny;j++)for(let i=0;i<m.nx;i++){
      const dataX=region[0]+(region[2]-region[0])*i/(m.nx-1),dataY=region[1]+(region[3]-region[1])*j/(m.ny-1),z=m.rows[j][i];
      const [x,y]=mapXYToCanvas(viewRect,x0,y0,plotW,plotH,dataX,dataY);
      ctx.beginPath();ctx.fillStyle='#fefefe';ctx.strokeStyle='#3a4652';ctx.lineWidth=1.5;ctx.arc(x,y,3.5,0,Math.PI*2);ctx.fill();ctx.stroke();
      if((hx1-hx0)/(m.nx-1)>55&&(hy1-hy0)/(m.ny-1)>40)drawValueLabel(x,y,z);
    }
  }
  if(showValues&&valueGrid){
    const cols=Math.max(2,Math.round(valueGrid.cols||valueGrid[0]||5));
    const rows=Math.max(2,Math.round(valueGrid.rows||valueGrid[1]||5));
    if((hx1-hx0)/(cols-1)>44&&(hy1-hy0)/(rows-1)>34){
      for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
        const dataX=region[0]+(region[2]-region[0])*i/(cols-1),dataY=region[1]+(region[3]-region[1])*j/(rows-1),z=sample(m,dataX,dataY);
        const [x,y]=mapXYToCanvas(viewRect,x0,y0,plotW,plotH,dataX,dataY);
        ctx.beginPath();ctx.fillStyle='rgba(247,250,252,0.88)';ctx.strokeStyle='rgba(58,70,82,0.82)';ctx.lineWidth=1.1;ctx.arc(x,y,2.5,0,Math.PI*2);ctx.fill();ctx.stroke();
        drawValueLabel(x,y,z);
      }
    }
  }
  ctx.textAlign='center';ctx.fillStyle='#5e6d79';ctx.font='12px ui-monospace,monospace';
  ctx.fillText(`${viewRect[0].toFixed(1)} → ${viewRect[2].toFixed(1)} mm  ·  X`,x0+plotW/2,h-11);
  ctx.save();ctx.translate(15,y0+plotH/2);ctx.rotate(-Math.PI/2);ctx.fillText(`${viewRect[1].toFixed(1)} → ${viewRect[3].toFixed(1)} mm  ·  Y`,0,0);ctx.restore();
}
function fmt(x,precision=3){return Number.isFinite(x)?(x<0?'−':'')+Math.abs(x).toFixed(precision):'—';}
let surfaceRenderer=null;
let zScaleAuto=true;
function recommendedZScale(mesh) {
  if(!mesh?.region)return 100;
  const r=mesh.region, span=Math.max(r[2]-r[0],r[3]-r[1]);
  const delta=minMax(mesh).range;
  return Math.min(1000,Math.max(1,Math.round(.55*span/(2*Math.max(delta,.002)))));
}
function showSurface(mesh,chosen,a,b) {
  if(!surfaceRenderer)surfaceRenderer=new MeshSurfaceRenderer($('surfaceCanvas'));
  const slider=$('zScale');
  if(zScaleAuto && mesh)slider.value=String(recommendedZScale(mesh));
  const z=Number(slider.value);
  $('zValue').textContent=(zScaleAuto?'Auto · ':'')+z+'×';
  $('maskEstimates').disabled=!(mesh?.virtual && a?.region && b?.region);
  const mask=mesh?.virtual && $('maskEstimates').checked;
  const renderOpts={scale:z,coarse:$('coarseMesh').checked,mask,showPoints:$('showPoints').checked,showPlate:$('showPlate3D').checked,baseA:a,baseB:b};
  surfaceRenderer.render(mesh,renderOpts);
  const d=surfaceRenderer.cachedData;
  $('surfaceCaption').textContent=mesh?`${chosen} · ${d?.triangles||0} triangles · ${z}× Z`:'No map selected';
  $('surfaceInfo').textContent=mesh?.virtual ? `A and B probe positions shown on estimated difference surface. ${$('showPlate3D').checked?'The visual build plate follows the real Kobra X orientation; X0 / Y0 is the true outer lower-left plate corner and the plate spans 0.0–265.0 mm. ':''}${mask?'Distant estimates masked; ':''}Coverage heuristic: ${Math.round(100*(d?.confidenceFraction||0))}% near points in both grids.` : `A single source mesh: bright dots are measured locations.${$('showPlate3D').checked?' The visual build plate follows the real Kobra X orientation; X0 / Y0 is the true outer lower-left plate corner and the plate spans 0.0–265.0 mm.':''}`;
  $('surfaceTopNote').textContent=mesh?.virtual?'B − A · interpolated on shared XY area':mesh?'Measured mesh · relative Z heights':'';
}
function paintCoverage(a,b){
  const canvas=$('coverageCanvas'),c=canvas.getContext('2d'),W=canvas.width,H=canvas.height;
  c.fillStyle='#121b22';c.fillRect(0,0,W,H);
  if(!a?.region||!b?.region)return;
  const union=[Math.min(a.region[0],b.region[0]),Math.min(a.region[1],b.region[1]),Math.max(a.region[2],b.region[2]),Math.max(a.region[3],b.region[3])];
  const pad=26,uw=union[2]-union[0],uh=union[3]-union[1],factor=Math.min((W-pad*2)/uw,(H-pad*2)/uh);
  const left=(W-uw*factor)/2,top=(H-uh*factor)/2;
  const rect =r=>[left+(r[0]-union[0])*factor,top+(union[3]-r[3])*factor,(r[2]-r[0])*factor,(r[3]-r[1])*factor];
  const drawRect=(r,color)=>{const [x,y,w,h]=rect(r);c.strokeStyle=color;c.lineWidth=2;c.strokeRect(x,y,w,h);};
  c.fillStyle='#132b31';c.fillRect(...rect(a.region));
  c.fillStyle='#2d2723';c.fillRect(...rect(b.region));
  const overlap=[Math.max(a.region[0],b.region[0]),Math.max(a.region[1],b.region[1]),Math.min(a.region[2],b.region[2]),Math.min(a.region[3],b.region[3])];
  if(overlap[2]>overlap[0]&&overlap[3]>overlap[1]){c.fillStyle='#69828a';c.fillRect(...rect(overlap));}
  drawRect(a.region,'#55dbd1');drawRect(b.region,'#fba76c');
  c.fillStyle='#a6b8c1';c.font='10px monospace';c.fillText('X →',W-40,H-9);c.fillText('Y ↑',11,18);
  c.fillStyle='#55dbd1';c.fillText('A',9,H-29);c.fillStyle='#fba76c';c.fillText('B',9,H-13);
}
function meshCSV(m){const rows=[['x_mm','y_mm','z_mm','column','row'].join(',')];const r=m.region||[0,0,m.nx-1,m.ny-1];for(let j=0;j<m.ny;j++)for(let i=0;i<m.nx;i++){const x=r[0]+(r[2]-r[0])*i/(m.nx-1),y=r[1]+(r[3]-r[1])*j/(m.ny-1);rows.push(`${x.toFixed(4)},${y.toFixed(4)},${m.rows[j][i].toFixed(6)},${i},${j}`);}return rows.join('\r\n')+'\r\n';}
function comparisonCSV(a,b,d){const r=d.mesh.region,rows=['x_mm,y_mm,baseline_z_mm,comparison_z_mm,displayed_delta_mm,raw_delta_mm'];for(let j=0;j<d.mesh.ny;j++)for(let i=0;i<d.mesh.nx;i++){const x=r[0]+(r[2]-r[0])*i/(d.mesh.nx-1),y=r[1]+(r[3]-r[1])*j/(d.mesh.ny-1),aa=sample(a,x,y),bb=sample(b,x,y);rows.push([x,y,aa,bb,d.mesh.rows[j][i],bb-aa].map(z=>z.toFixed(6)).join(','));}return rows.join('\r\n')+'\r\n';}
function download(name,content,mime){const b=content instanceof Blob?content:new Blob([content],{type:mime});const u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),3000);}

function exportMapPng(canvasId,filename){
  const params=mapRenderCache.get(canvasId);
  if(!params||!params.m)return;
  const original=$(canvasId);
  const canvas=document.createElement('canvas');
  canvas.width=original.width*PNG_EXPORT_SCALE;
  canvas.height=original.height*PNG_EXPORT_SCALE;
  paintMap(canvas,params.m,params.scale,params.showDots,params.showPlate,{...params.opts,exportScale:PNG_EXPORT_SCALE});
  canvas.toBlob(blob=>blob&&download(filename,blob,'image/png'),'image/png');
}

function updateSelections(side){const selector=$('mesh'+side),data=state[side];selector.innerHTML='';for(let i=0;i<data.length;i++){const m=data[i],option=document.createElement('option');option.value=String(i);option.textContent=`${m.date} ${m.time} · ${m.mode==='full'?'Full bed':m.mode==='adaptive'?'Adaptive':'Calibration'} · ${m.nx}×${m.ny}`;selector.append(option);}selector.disabled=!data.length;if(data.length)selector.value=String(data.length-1);state['selected'+side]=data.at(-1)||null;}
async function load(side,file){if(!file)return;setStatus(`Reading ${file.name} locally…`);await new Promise(resolve=>requestAnimationFrame(resolve));try{const parsed=await parseFile(file);if(state.demo){const other=side==='A'?'B':'A';state[other]=[];updateSelections(other);$('label'+other).textContent=other==='A'?'Drop your log here':'Drop your second log';}state[side]=parsed;state.demo=false;updateSelections(side);$('label'+side).textContent=file.name;setStatus(`Loaded ${parsed.length} calibration snapshot${parsed.length===1?'':'s'} from ${file.name}. Nothing was uploaded.`,'success');render();}catch(err){setStatus(err.message,'error');console.error(err);}}
function render(){
 const a=state.selectedA,b=state.selectedB;
 $('results').hidden=!(a||b);if(!(a||b))return;
 const aStat=a?minMax(a):null,bStat=b?minMax(b):null;
 $('rangeA').textContent=aStat?fmt(aStat.range)+' mm':'—';$('rangeB').textContent=bStat?fmt(bStat.range)+' mm':'—';
 $('subA').textContent=a?`${a.nx}×${a.ny} points · ${a.date}`:'No baseline loaded';$('subB').textContent=b?`${b.nx}×${b.ny} points · ${b.date}`:'Load a second calibration';
 $('infoA').textContent=a?`${a.nx}×${a.ny} pts`:'—';$('infoB').textContent=b?`${b.nx}×${b.ny} pts`:'—';
 const min=Math.min(...[aStat?.min,bStat?.min].filter(Number.isFinite)),max=Math.max(...[aStat?.max,bStat?.max].filter(Number.isFinite));
 for(const s of ['A','B']){$('scale'+s+'min').textContent=Number.isFinite(min)?fmt(min,2):'−';$('scale'+s+'max').textContent=Number.isFinite(max)?fmt(max,2):'+';}
 const plateOverlay=$('showPlate2D').checked;
 paintMap($('canvasA'),a,{min,max},true,plateOverlay);paintMap($('canvasB'),b,{min,max},true,plateOverlay);
 $('footerA').textContent=a?(a.region?`${fmt(aStat.min)} to ${fmt(aStat.max)} mm · X ${fmt(a.region[0],1)}–${fmt(a.region[2],1)}`:'XY region unavailable; grid shown by indices'):'No data';
 $('footerB').textContent=b?(b.region?`${fmt(bStat.min)} to ${fmt(bStat.max)} mm · X ${fmt(b.region[0],1)}–${fmt(b.region[2],1)}`:'XY region unavailable; grid shown by indices'):'No data';
 let d=a&&b?makeDifference(a,b,$('deltaMode').value):null;
 state.difference=d?.mesh?d:null;
 const note=$('compareWarning');note.hidden=true;
 if(d?.issue){note.textContent=d.issue;note.hidden=false;}
 else if(d?.mesh){
  const origA=(a.region[2]-a.region[0])*(a.region[3]-a.region[1]),origB=(b.region[2]-b.region[0])*(b.region[3]-b.region[1]);
  const shared=(d.mesh.region[2]-d.mesh.region[0])*(d.mesh.region[3]-d.mesh.region[1]);
  const sameGrid=a.nx===b.nx&&a.ny===b.ny&&a.region.every((v,i)=>Math.abs(v-b.region[i])<1e-7);
  if(!sameGrid){
    note.textContent=`Adaptive meshes have different sampling grids or XY bounds. ${Math.round(100*shared/Math.min(origA,origB))}% of the smaller area overlaps. Change values are bilinearly interpolated estimates, not paired measurements. Probe markers show where samples were actually taken.`;
    note.hidden=false;
  }

 }
 if(state.difference){const dd=state.difference,m=dd.mesh,s=minMax(m),smax=Math.max(Math.abs(s.min),Math.abs(s.max),.0001);
  const diffLabelGrid={cols:Math.min(7,Math.max(a?.nx||5,b?.nx||5,5)),rows:Math.min(7,Math.max(a?.ny||5,b?.ny||5,5))};
  paintMap($('canvasD'),m,{min:-smax,max:smax},false,plateOverlay,{showValues:true,valueGrid:diffLabelGrid});
  $('scaleDmin').textContent=fmt(-smax,3);$('scaleDmax').textContent='+'+fmt(smax,3);
  $('deltaMetric').textContent=fmt(s.range)+' mm';$('subD').textContent=`Difference range · RMS ${fmt(dd.rms)} mm`;
  $('footerD').textContent=`Interpolated shared XY: ${fmt(m.region[2]-m.region[0],1)} × ${fmt(m.region[3]-m.region[1],1)} mm · ${$('deltaMode').selectedOptions[0].text}`;
 }else{paintEmpty($('canvasD'),d?.issue?'No shared XY area':'Load two calibrations');$('scaleDmin').textContent='−';$('scaleDmax').textContent='+';$('footerD').textContent=d?.issue||'Load two measurements to calculate B − A';$('deltaMetric').textContent='—';$('subD').textContent='Requires overlapping XY areas';}
 $('downloadA').disabled=!a||!a.region;$('downloadAPng').disabled=!a;$('downloadB').disabled=!b||!b.region;$('downloadBPng').disabled=!b;$('downloadD').disabled=!state.difference;$('downloadPng').disabled=!state.difference;
 const chosen=$('surfaceSelect').value,surface=chosen==='A'?a:chosen==='B'?b:state.difference?.mesh;
 showSurface(surface,chosen,a,b);
 $('coverageBox').hidden=!(a?.region&&b?.region);
 if(a?.region&&b?.region){paintCoverage(a,b);$('coverageDescription').textContent=`A: X ${fmt(a.region[0],1)}–${fmt(a.region[2],1)}, Y ${fmt(a.region[1],1)}–${fmt(a.region[3],1)} mm. B: X ${fmt(b.region[0],1)}–${fmt(b.region[2],1)}, Y ${fmt(b.region[1],1)}–${fmt(b.region[3],1)} mm. Shaded overlap is the only region used for difference calculations.`;}
 const box=$('tiltBox');box.innerHTML='';
 for(const [key,m] of [['A',a],['B',b]]){
  if(!m)continue;const pl=fitPlane(pointsOf(m)),card=document.createElement('div');card.className='insight';
  const heading=document.createElement('h3');heading.textContent=`${key} · Estimated global tilt`;
  const p=document.createElement('p');
  p.textContent=pl?`Slope along X: ${fmt(pl.dx*100)} mm / 100 mm. Along Y: ${fmt(pl.dy*100)} mm / 100 mm. Local residual RMS after removing a fitted plane: ${fmt(pl.rms)} mm. This is a regression on the measured region, not a screw-turn instruction.`:'Cannot fit a physical XY plane: probe bounds are missing.';
  card.append(heading,p);box.append(card);
 }
}
for(const side of ['A','B']){
 const drop=$('drop'+side),input=$('file'+side);
 drop.querySelector('.drop-content').addEventListener('click',()=>input.click());
 drop.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target===drop){e.preventDefault();input.click();}});
 drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragover');});
 drop.addEventListener('dragleave',()=>drop.classList.remove('dragover'));
 drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragover');load(side,e.dataTransfer.files[0]);});
 input.addEventListener('change',()=>load(side,input.files[0]));
 $('mesh'+side).addEventListener('change',e=>{state['selected'+side]=state[side][Number(e.target.value)]||null;render();});
}
$('deltaMode').addEventListener('change',render);$('surfaceSelect').addEventListener('change',render);
$('zScale').addEventListener('input',()=>{zScaleAuto=false;render();});
$('autoZ').addEventListener('click',()=>{zScaleAuto=true;render();});
$('resetView').addEventListener('click',()=>{surfaceRenderer?.reset();});
for(const id of ['showPoints','showPlate2D','showPlate3D','coarseMesh','maskEstimates'])$(id).addEventListener('change',render);
$('downloadA').addEventListener('click',()=>state.selectedA&&download('kobrax_baseline.csv',meshCSV(state.selectedA),'text/csv;charset=utf-8'));
$('downloadB').addEventListener('click',()=>state.selectedB&&download('kobrax_comparison.csv',meshCSV(state.selectedB),'text/csv;charset=utf-8'));
$('downloadAPng').addEventListener('click',()=>state.selectedA&&exportMapPng('canvasA','kobrax_baseline.png'));
$('downloadBPng').addEventListener('click',()=>state.selectedB&&exportMapPng('canvasB','kobrax_comparison.png'));
$('downloadD').addEventListener('click',()=>state.difference&&download('kobrax_difference_'+$('deltaMode').value+'.csv',comparisonCSV(state.selectedA,state.selectedB,state.difference),'text/csv;charset=utf-8'));
$('downloadPng').addEventListener('click',()=>state.difference&&exportMapPng('canvasD','kobrax_difference.png'));
$('demoBtn').addEventListener('click',()=>{
 const make=(dx,dy,offset,region,date)=>{const nx=5,ny=7,rows=[];for(let j=0;j<ny;j++){const row=[];for(let i=0;i<nx;i++){const x=i/(nx-1),y=j/(ny-1);row.push((x-.5)*dx+(y-.5)*dy+.10*Math.sin(2.8*x+1.7*y)+.05*Math.cos(7*y+3*x)+offset);}rows.push(row);}return{rows,region,nx,ny,date,time:'12:00:00',source:'Simulation (not printer data)'};};
 state.A=[make(-.70,.45,.05,[40,20,220,240],'Demo before')];state.B=[make(-.34,.25,-.02,[55,30,235,250],'Demo after')];
 updateSelections('A');updateSelections('B');$('labelA').textContent='Simulated baseline';$('labelB').textContent='Simulated comparison';state.demo=true;setStatus('SIMULATED DEMO — not real printer data. Drop actual logs to replace either dataset.','success');render();$('results').scrollIntoView({behavior:'smooth',block:'start'});
});


window.addEventListener('kobra-plate-ready',()=>{
  if(state.selectedA||state.selectedB)render();
  else surfaceRenderer?.draw();
});
const runtimeNotice = document.getElementById('runtimeNotice');
if(runtimeNotice) runtimeNotice.hidden = true;
document.documentElement.dataset.kobraReady = 'true';
