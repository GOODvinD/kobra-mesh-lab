/* Kobra Mesh Lab 1.1 — stand-alone WebGL depth-tested mesh renderer.
   This file only draws local numeric arrays. No remote dependencies. */
'use strict';
class MeshSurfaceRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', {alpha:false, antialias:true, preserveDrawingBuffer:true});
    this.yaw = Math.PI / 4;
    this.elevation = 0.53;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.last = null;
    this.cachedData = null;
    this.activePointer = null;
    this.drag = null;
    this.onViewChange = null;
    if(this.gl) this.setupGL();
    canvas.addEventListener('pointerdown', ev => {
      if(!this.last) return;
      this.activePointer=ev.pointerId;
      this.drag={x:ev.clientX,y:ev.clientY,yaw:this.yaw,elevation:this.elevation,panX:this.panX,panY:this.panY,shift:ev.shiftKey};
      canvas.setPointerCapture(ev.pointerId);
      canvas.style.cursor='grabbing';
    });
    canvas.addEventListener('pointermove', ev => {
      if(this.activePointer!==ev.pointerId||!this.drag) return;
      const dx=ev.clientX-this.drag.x, dy=ev.clientY-this.drag.y;
      if(this.drag.shift) {
        this.panX=this.drag.panX+dx/canvas.clientWidth*2.7;
        this.panY=this.drag.panY-dy/canvas.clientHeight*2.7;
      } else {
        this.yaw=this.drag.yaw+dx*.008;
        this.elevation=Math.max(.14,Math.min(1.48,this.drag.elevation+dy*.006));
      }
      this.draw();
      this.onViewChange?.();
    });
    const end=ev=>{if(this.activePointer===ev.pointerId){this.drag=null;this.activePointer=null;canvas.style.cursor='grab';}};
    canvas.addEventListener('pointerup',end); canvas.addEventListener('pointercancel',end);
    canvas.addEventListener('wheel',ev=>{if(!this.last)return;ev.preventDefault();this.zoom=Math.max(.35,Math.min(4,this.zoom*Math.exp(-ev.deltaY*.001)));this.draw();this.onViewChange?.();},{passive:false});
    canvas.addEventListener('dblclick',()=>this.reset());
    canvas.style.cursor='grab';canvas.style.touchAction='none';
  }
  reset(){this.yaw=Math.PI/4;this.elevation=.53;this.zoom=1;this.panX=0;this.panY=0;this.draw();this.onViewChange?.();}
  setupGL(){
    const gl=this.gl;
    const vert='attribute vec3 aPos; attribute vec4 aCol; uniform float uYaw,uElev,uZoom,uAspect; uniform vec2 uPan; varying vec4 vCol; void main(){float s=sin(uYaw),c=cos(uYaw),se=sin(uElev),ce=cos(uElev);float h=aPos.x*c+aPos.y*s;float xx=aPos.x*s-aPos.y*c;float yy=aPos.z*ce-h*se;float depth=h*ce+aPos.z*se;gl_Position=vec4((xx*uZoom+uPan.x)/uAspect,(yy*uZoom+uPan.y),-depth*.012,1.0);gl_PointSize=7.0;vCol=aCol;}';
    const frag='precision mediump float; varying vec4 vCol; uniform float uPoint; void main(){if(uPoint>0.5){vec2 q=gl_PointCoord*2.0-1.0;if(dot(q,q)>1.0)discard;}gl_FragColor=vCol;}';
    const shader=(kind,src)=>{const s=gl.createShader(kind);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error('Mesh shader: '+gl.getShaderInfoLog(s));return s;};
    const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vert));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,frag));gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Mesh link: '+gl.getProgramInfoLog(program));
    this.program=program;this.attribPos=gl.getAttribLocation(program,'aPos');this.attribCol=gl.getAttribLocation(program,'aCol');
    this.uniforms=Object.fromEntries(['uYaw','uElev','uZoom','uAspect','uPan','uPoint'].map(n=>[n,gl.getUniformLocation(program,n)]));
    this.positionBuffer=gl.createBuffer();this.colorBuffer=gl.createBuffer();
    const texVert='attribute vec3 aPos;attribute vec2 aUV;uniform float uYaw,uElev,uZoom,uAspect;uniform vec2 uPan;varying vec2 vUV;void main(){float si=sin(uYaw),co=cos(uYaw),se=sin(uElev),ce=cos(uElev);float h=aPos.x*co+aPos.y*si;float xx=aPos.x*si-aPos.y*co;float yy=aPos.z*ce-h*se;float dep=h*ce+aPos.z*se;gl_Position=vec4((xx*uZoom+uPan.x)/uAspect,(yy*uZoom+uPan.y),-dep*.012,1.0);vUV=aUV;}';
    const texFrag='precision mediump float;varying vec2 vUV;uniform sampler2D uTex;uniform float uAlpha;void main(){gl_FragColor=texture2D(uTex,vUV)*uAlpha;}';
    const texProgram=gl.createProgram();gl.attachShader(texProgram,shader(gl.VERTEX_SHADER,texVert));gl.attachShader(texProgram,shader(gl.FRAGMENT_SHADER,texFrag));gl.linkProgram(texProgram);
    if(!gl.getProgramParameter(texProgram,gl.LINK_STATUS))throw Error('Plate shader: '+gl.getProgramInfoLog(texProgram));
    this.texProgram=texProgram;
    this.texPos=gl.getAttribLocation(texProgram,'aPos');this.texUV=gl.getAttribLocation(texProgram,'aUV');
    this.texUniforms=Object.fromEntries(['uYaw','uElev','uZoom','uAspect','uPan','uTex','uAlpha'].map(n=>[n,gl.getUniformLocation(texProgram,n)]));
    this.texPosBuffer=gl.createBuffer();this.texUVBuffer=gl.createBuffer();this.plateTextures={};
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
  }
  static heat(z,min,max){
    let t=(z-min)/(max-min||1);t=Math.max(0,Math.min(1,t));
    const lo=[34,115,158],mid=[223,237,231],hi=[234,108,82],a=t<.5?lo:mid,b=t<.5?mid:hi,f=t<.5?t*2:(t-.5)*2;
    return a.map((n,i)=>(n*(1-f)+b[i]*f)/255);
  }
  data(mesh,{scale=100,coarse=false,mask=false,showPoints=true,showPlate=true,baseA=null,baseB=null}={}) {
    if(!mesh?.region) return null;
    const r=mesh.region,plate=buildPlateRect(),frame=showPlate?unionRect(r,plate):r,span=Math.max(frame[2]-frame[0],frame[3]-frame[1]);
    const centerX=(frame[0]+frame[2])/2, centerY=(frame[1]+frame[3])/2;
    const nxf=x=>-((x-centerX)*2/span), nyf=y=>((y-centerY)*2/span);
    const nx=coarse ? (mesh.virtual?Math.max(baseA?.nx||2,baseB?.nx||2)*2-1:mesh.nx) : 61;
    const ny=coarse ? (mesh.virtual?Math.max(baseA?.ny||2,baseB?.ny||2)*2-1:mesh.ny) : 61;
    const zvals=mesh.rows.flat(), zref=mesh.virtual ? 0 : zvals.reduce((a,b)=>a+b,0)/zvals.length;
    const zmin=Math.min(...zvals),zmax=Math.max(...zvals);
    const colorLimit=mesh.virtual?Math.max(Math.abs(zmin),Math.abs(zmax),.000001):null;
    const colorMin=colorLimit===null?zmin:-colorLimit,colorMax=colorLimit===null?zmax:colorLimit;
    const v=[];let hits=0,valid=0;
    const confidence=(x,y)=>{
      if(!baseA||!baseB)return true;
      const near = m=>{
        let tx=(x-m.region[0])/(m.region[2]-m.region[0])*(m.nx-1);
        let ty=(y-m.region[1])/(m.region[3]-m.region[1])*(m.ny-1);
        return Math.hypot(tx-Math.round(tx),ty-Math.round(ty))<=.60;
      };
      return near(baseA)&&near(baseB);
    };
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
      const x=r[0]+(r[2]-r[0])*i/(nx-1),y=r[1]+(r[3]-r[1])*j/(ny-1),z=sample(mesh,x,y);
      const p={x:nxf(x),y:nyf(y),z:(z-zref)*2*scale/span,value:z,ok:confidence(x,y)};
      v.push(p);valid++;if(p.ok)hits++;
    }
    const triangles=[];
    for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){
      const ids=[j*nx+i,j*nx+i+1,(j+1)*nx+i,(j+1)*nx+i+1];
      for(const face of [[ids[0],ids[1],ids[3]],[ids[0],ids[3],ids[2]]]){
        if(mask&&face.some(k=>!v[k].ok))continue;
        triangles.push(...face);
      }
    }
    const positions=[],colors=[];
    for(const id of triangles){const p=v[id];positions.push(p.x,p.y,p.z);colors.push(...MeshSurfaceRenderer.heat(p.value,colorMin,colorMax),1);}
    const gridPos=[],gridCols=[];
    // Draw thin physical XY reference grid behind the surface, never as a filled plane.
    for(let i=0;i<=10;i++){
      const t=-1+2*i/10;
      for(const points of [[[t,-1,0],[t,1,0]],[[-1,t,0],[1,t,0]]]){
        for(const q of points){gridPos.push(...q);gridCols.push(.18,.29,.34,1);}
      }
    }
    const pointPos=[],pointCols=[];
    const addPoints=(m,color)=>{
      if(!m?.region) return;
      for(const p of pointsOf(m)){
        if(p.x<r[0]-1e-8||p.x>r[2]+1e-8||p.y<r[1]-1e-8||p.y>r[3]+1e-8)continue;
        const val=sample(mesh,p.x,p.y);
        pointPos.push(nxf(p.x),nyf(p.y),(val-zref)*2*scale/span+.003);
        pointCols.push(...color,1);
      }
    };
    const plateTexPos=[],plateTexUV=[];
    if(showPlate){
      const rect=KOBRA_PLATE.worldRect, z=-0.016;
      const point=(x,y)=>[nxf(x),nyf(y),z];
      const bl=point(rect[0],rect[1]),br=point(rect[2],rect[1]),tr=point(rect[2],rect[3]),tl=point(rect[0],rect[3]);
      plateTexPos.push(...bl,...br,...tr,...bl,...tr,...tl);
      plateTexUV.push(0,0, 1,0, 1,1, 0,0, 1,1, 0,1);
    }
    if(showPoints){
      if(mesh.virtual) {addPoints(baseA,[.13,.97,.85]);addPoints(baseB,[1,.65,.36]);}
      else addPoints(mesh,[1,1,1]);
    }
    return {positions,colors,gridPos,gridCols,pointPos,pointCols,plateTexPos,plateTexUV,range:zmax-zmin,confidenceFraction:hits/valid,triangles:triangles.length/3};
  }
  render(mesh,options={}){this.last={mesh,options};this.cachedData=mesh?this.data(mesh,options):null;this.draw();}
  drawPlateTexture(data,layer,alpha){
    const gl=this.gl;
    if(!data.plateTexPos?.length||!KOBRA_PLATE.isReady(layer))return;
    let tex=this.plateTextures[layer];
    if(!tex){
      tex=gl.createTexture();this.plateTextures[layer]=tex;
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,KOBRA_PLATE.images[layer]);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    }
    gl.useProgram(this.texProgram);const u=this.texUniforms;
    gl.uniform1f(u.uYaw,this.yaw);gl.uniform1f(u.uElev,this.elevation);gl.uniform1f(u.uZoom,this.zoom*.92);
    gl.uniform1f(u.uAspect,this.canvas.width/this.canvas.height);gl.uniform2f(u.uPan,this.panX,this.panY);
    gl.uniform1f(u.uAlpha,alpha);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex);gl.uniform1i(u.uTex,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.texPosBuffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data.plateTexPos),gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.texPos);gl.vertexAttribPointer(this.texPos,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.texUVBuffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data.plateTexUV),gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.texUV);gl.vertexAttribPointer(this.texUV,2,gl.FLOAT,false,0,0);
    gl.drawArrays(gl.TRIANGLES,0,6);
  }
  draw(){
    const {canvas,gl}=this,settings=this.last;
    if(!gl){this.fallback(settings?.mesh);return;}
    const data=this.cachedData;
    gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(.97,.98,.99,1);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    if(!data)return;
    const u=this.uniforms;gl.useProgram(this.program);
    gl.uniform1f(u.uYaw,this.yaw);gl.uniform1f(u.uElev,this.elevation);gl.uniform1f(u.uZoom,this.zoom*.92);gl.uniform1f(u.uAspect,canvas.width/canvas.height);gl.uniform2f(u.uPan,this.panX,this.panY);
    const draw=(pos,col,mode,points)=>{
      if(!pos.length)return;
      gl.bindBuffer(gl.ARRAY_BUFFER,this.positionBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(pos),gl.DYNAMIC_DRAW);gl.vertexAttribPointer(this.attribPos,3,gl.FLOAT,false,0,0);gl.enableVertexAttribArray(this.attribPos);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.colorBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(col),gl.DYNAMIC_DRAW);gl.vertexAttribPointer(this.attribCol,4,gl.FLOAT,false,0,0);gl.enableVertexAttribArray(this.attribCol);
      gl.uniform1f(u.uPoint,points?1:0);gl.drawArrays(mode,0,pos.length/3);
    };
    gl.disable(gl.DEPTH_TEST);gl.depthMask(false);
    this.drawPlateTexture(data,'base',0.25);
    gl.enable(gl.DEPTH_TEST);gl.depthMask(true);
    gl.useProgram(this.program);
    draw(data.gridPos,data.gridCols,gl.LINES,false);
    draw(data.positions,data.colors,gl.TRIANGLES,false);
    gl.disable(gl.DEPTH_TEST);gl.depthMask(false);
    this.drawPlateTexture(data,'marks',0.98);
    gl.useProgram(this.program);
    draw(data.pointPos,data.pointCols,gl.POINTS,true);
    gl.depthMask(true);gl.enable(gl.DEPTH_TEST);
  }
  fallback(mesh){
    const c=this.canvas.getContext('2d'),w=this.canvas.width,h=this.canvas.height;
    if(!c)return;
    c.fillStyle='#f7fafc';c.fillRect(0,0,w,h);
    if(!mesh||!this.cachedData){c.fillStyle='#91a8b3';c.textAlign='center';c.font='18px system-ui';c.fillText('Load a mesh to preview its surface',w/2,h/2);return;}
    const {positions,colors,pointPos,pointCols,gridPos,plateTexPos}=this.cachedData;
    const yaw=this.yaw,e=this.elevation,cy=Math.cos(yaw),sy=Math.sin(yaw),ce=Math.cos(e),se=Math.sin(e);
    const project=(x,y,z)=>{
      const along=x*cy+y*sy;
      const sx=x*sy-y*cy, yy=z*ce-along*se, depth=along*ce+z*se;
      return [w/2+(sx*this.zoom*.92+this.panX)*h/2,h/2-(yy*this.zoom*.92+this.panY)*h/2,depth];
    };
    const drawPlateImage= (layer,alpha)=>{
      if(!plateTexPos?.length||!KOBRA_PLATE.isReady(layer))return;
      const img=KOBRA_PLATE.images[layer], W=img.naturalWidth,H=img.naturalHeight;
      const bl=project(...plateTexPos.slice(0,3)),br=project(...plateTexPos.slice(3,6)),tr=project(...plateTexPos.slice(6,9)),tl=project(...plateTexPos.slice(15,18));
      c.save();c.globalAlpha=alpha;
      c.setTransform((tr[0]-tl[0])/W,(tr[1]-tl[1])/W,(bl[0]-tl[0])/H,(bl[1]-tl[1])/H,tl[0],tl[1]);
      c.drawImage(img,0,0);c.restore();
    };
    drawPlateImage('base',0.25);
    c.strokeStyle='#9aa9b3';c.lineWidth=1;
    for(let i=0;i<gridPos.length;i+=6){
      const a=project(...gridPos.slice(i,i+3)),b=project(...gridPos.slice(i+3,i+6));
      c.beginPath();c.moveTo(a[0],a[1]);c.lineTo(b[0],b[1]);c.stroke();
    }
    const faces=[];
    for(let i=0;i<positions.length;i+=9){
      const a=project(...positions.slice(i,i+3)),b=project(...positions.slice(i+3,i+6)),d=project(...positions.slice(i+6,i+9));
      const color=[0,1,2].map(k=>Math.round(255*(colors[(i/3)*4+k]+colors[(i/3+1)*4+k]+colors[(i/3+2)*4+k])/3));
      faces.push({a,b,d,depth:(a[2]+b[2]+d[2])/3,color});
    }
    faces.sort((a,b)=>a.depth-b.depth);
    // Painter-sort fallback for browsers without WebGL. WebGL uses the depth buffer.
    for(const t of faces){
      c.beginPath();c.moveTo(t.a[0],t.a[1]);c.lineTo(t.b[0],t.b[1]);c.lineTo(t.d[0],t.d[1]);c.closePath();
      c.fillStyle=`rgb(${t.color.join(',')})`;c.fill();
    }
    drawPlateImage('marks',0.98);
    for(let i=0;i<pointPos.length;i+=3){
      const p=project(...pointPos.slice(i,i+3));
      const col=pointCols.slice(i/3*4,i/3*4+3).map(x=>Math.round(x*255));
      c.beginPath();c.arc(p[0],p[1],3.1,0,Math.PI*2);c.fillStyle=`rgb(${col.join(',')})`;c.fill();c.strokeStyle='#10212a';c.lineWidth=1;c.stroke();
    }
  }

}

