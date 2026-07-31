export function orderCorners(points){
  const pts=points.map(p=>({x:p.x,y:p.y}));
  const sums=pts.map(p=>p.x+p.y);
  const diffs=pts.map(p=>p.x-p.y);
  return [
    pts[sums.indexOf(Math.min(...sums))],
    pts[diffs.indexOf(Math.max(...diffs))],
    pts[sums.indexOf(Math.max(...sums))],
    pts[diffs.indexOf(Math.min(...diffs))]
  ];
}

function solve(A,b){
  const n=b.length;
  for(let i=0;i<n;i++){
    let mr=i;
    for(let r=i+1;r<n;r++) if(Math.abs(A[r][i])>Math.abs(A[mr][i])) mr=r;
    [A[i],A[mr]]=[A[mr],A[i]];
    [b[i],b[mr]]=[b[mr],b[i]];
    let p=A[i][i];
    if(Math.abs(p)<1e-12) throw new Error("Invalid crop geometry");
    for(let c=i;c<n;c++) A[i][c]/=p;
    b[i]/=p;
    for(let r=0;r<n;r++){
      if(r===i) continue;
      const f=A[r][i];
      for(let c=i;c<n;c++) A[r][c]-=f*A[i][c];
      b[r]-=f*b[i];
    }
  }
  return b;
}
function hMatrix(src,dst){
  const A=[],b=[];
  for(let i=0;i<4;i++){
    const {x,y}=src[i],u=dst[i].x,v=dst[i].y;
    A.push([x,y,1,0,0,0,-u*x,-u*y]); b.push(u);
    A.push([0,0,0,x,y,1,-v*x,-v*y]); b.push(v);
  }
  const h=solve(A,b);
  return [...h,1];
}
function invert(m){
  const [a,b,c,d,e,f,g,h,i]=m;
  const A=e*i-f*h,B=-(d*i-f*g),C=d*h-e*g,D=-(b*i-c*h),E=a*i-c*g,F=-(a*h-b*g),G=b*f-c*e,H=-(a*f-c*d),I=a*e-b*d;
  const det=a*A+b*B+c*C;
  return [A/det,D/det,G/det,B/det,E/det,H/det,C/det,F/det,I/det];
}
export function warpPerspective(sourceCanvas,corners,maxOutput=1800){
  const [tl,tr,br,bl]=orderCorners(corners);
  const width=Math.max(30,Math.round(Math.max(Math.hypot(tr.x-tl.x,tr.y-tl.y),Math.hypot(br.x-bl.x,br.y-bl.y))));
  const height=Math.max(30,Math.round(Math.max(Math.hypot(bl.x-tl.x,bl.y-tl.y),Math.hypot(br.x-tr.x,br.y-tr.y))));
  const scale=Math.min(1,maxOutput/Math.max(width,height));
  const ow=Math.max(30,Math.round(width*scale)),oh=Math.max(30,Math.round(height*scale));
  const inv=invert(hMatrix([tl,tr,br,bl],[{x:0,y:0},{x:ow-1,y:0},{x:ow-1,y:oh-1},{x:0,y:oh-1}]));
  const srcCtx=sourceCanvas.getContext("2d",{willReadFrequently:true});
  const src=srcCtx.getImageData(0,0,sourceCanvas.width,sourceCanvas.height);
  const out=document.createElement("canvas");out.width=ow;out.height=oh;
  const outCtx=out.getContext("2d"),img=outCtx.createImageData(ow,oh);
  const sw=sourceCanvas.width,sh=sourceCanvas.height;
  for(let y=0;y<oh;y++) for(let x=0;x<ow;x++){
    const den=inv[6]*x+inv[7]*y+inv[8],sx=(inv[0]*x+inv[1]*y+inv[2])/den,sy=(inv[3]*x+inv[4]*y+inv[5])/den;
    if(sx<0||sy<0||sx>=sw-1||sy>=sh-1) continue;
    const x0=sx|0,y0=sy|0,dx=sx-x0,dy=sy-y0,oi=(y*ow+x)*4;
    for(let c=0;c<4;c++){
      const p00=src.data[(y0*sw+x0)*4+c],p10=src.data[(y0*sw+x0+1)*4+c],p01=src.data[((y0+1)*sw+x0)*4+c],p11=src.data[((y0+1)*sw+x0+1)*4+c];
      img.data[oi+c]=p00*(1-dx)*(1-dy)+p10*dx*(1-dy)+p01*(1-dx)*dy+p11*dx*dy;
    }
  }
  outCtx.putImageData(img,0,0);
  return out;
}
