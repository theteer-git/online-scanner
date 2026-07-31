import { warpPerspective } from "./perspective.js";
import { processCanvas } from "./core/scanner-engine.js";

const $=s=>document.querySelector(s);
const els={
  file:$("#fileInput"),camera:$("#cameraInput"),drop:$("#dropZone"),empty:$("#emptyState"),stage:$("#editorStage"),
  rail:$("#pageRail"),viewport:$("#stageViewport"),canvas:$("#editorCanvas"),thumbs:$("#thumbnailList"),
  adjust:$("#adjustPanel"),zoom:$("#zoomIndicator"),dialog:$("#exportDialog"),
  undo:$("#undoButton"),applyCrop:$("#applyCropButton"),nextActions:$("#nextActions")
};
const ctx=els.canvas.getContext("2d");
const state={
  pages:[],active:0,zoom:1,panX:0,panY:0,mode:"crop",
  dragCorner:-1,panning:false,lastPoint:null
};

function uid(){return crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`}
function activePage(){return state.pages[state.active]||null}
function defaultCorners(w,h){const x=w*.06,y=h*.06;return[{x,y},{x:w-x,y},{x:w-x,y:h-y},{x,y:h-y}]}
function cloneCanvas(source){
  const c=document.createElement("canvas");c.width=source.width;c.height=source.height;
  c.getContext("2d").drawImage(source,0,0);return c;
}
function imageToCanvas(img){
  const c=document.createElement("canvas");c.width=img.naturalWidth;c.height=img.naturalHeight;
  c.getContext("2d").drawImage(img,0,0);return c;
}
async function canvasToObject(canvas,name="scan"){
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("Unable to create image")),"image/png"));
  const url=URL.createObjectURL(blob),img=new Image();img.src=url;img.decoding="async";await img.decode();
  return {blob,url,img,name};
}
async function fileToPage(file){
  if(!file.type.startsWith("image/")) throw new Error("Only image files are supported.");
  const url=URL.createObjectURL(file),img=new Image();
  img.src=url;img.decoding="async";await img.decode();
  const base=imageToCanvas(img);
  return {
    id:uid(),name:file.name||"scan",url,img,base,history:[],
    corners:defaultCorners(base.width,base.height),
    effect:"original",brightness:0,contrast:0,sharpness:0,
    pendingAdjust:false
  };
}
async function addFiles(fileList){
  const files=[...fileList];
  for(const file of files){try{state.pages.push(await fileToPage(file))}catch(e){alert(e.message)}}
  if(state.pages.length){
    state.active=Math.max(0,state.pages.length-files.length);
    showEditor();
    state.mode="crop";
    els.nextActions.classList.add("hidden");
    els.viewport.classList.remove("view-mode");
    fitToScreen();
    renderAll();
  }
  els.file.value="";els.camera.value="";
}
function showEditor(){
  els.empty.classList.add("hidden");els.stage.classList.remove("hidden");els.rail.classList.remove("hidden");
}
function fitToScreen(){
  const page=activePage();if(!page)return;
  const rect=els.viewport.getBoundingClientRect();
  state.zoom=Math.min((rect.width-80)/page.base.width,(rect.height-80)/page.base.height,1.5);
  state.panX=0;state.panY=0;updateCanvasTransform();
}
function updateCanvasTransform(){
  els.canvas.style.transform=`translate(calc(-50% + ${state.panX}px),calc(-50% + ${state.panY}px)) scale(${state.zoom})`;
  els.zoom.textContent=`${Math.round(state.zoom*100)}%`;
}
function updateToolbar(){
  const p=activePage();
  els.undo.disabled=!(p&&p.history.length);
  els.applyCrop.disabled=!(p&&state.mode==="crop");
}
function enterViewMode(){
  state.mode="view";
  els.adjust.classList.add("hidden");
  els.nextActions.classList.remove("hidden");
  els.viewport.classList.add("view-mode");
  renderEditor();
}
function enterCropMode(){
  state.mode="crop";
  els.nextActions.classList.add("hidden");
  els.viewport.classList.remove("view-mode");
  renderEditor();
}
function enterEffectsMode(){
  state.mode="view";
  els.nextActions.classList.add("hidden");
  els.viewport.classList.add("view-mode");
  els.adjust.classList.remove("hidden");
  syncControlsFromPage();
  renderEditor();
}

function renderAll(){renderThumbs();renderEditor();updateToolbar()}
function renderThumbs(){
  els.thumbs.innerHTML="";
  state.pages.forEach((p,i)=>{
    const card=document.createElement("div");card.className=`thumbnail-card${i===state.active?" active":""}`;
    card.innerHTML=`<img src="${p.url}" alt=""><span class="thumbnail-index">${i+1}</span><button class="thumbnail-remove" type="button" aria-label="Remove page">×</button>`;
    card.addEventListener("click",()=>{
      state.active=i;
      state.mode="view";
      els.nextActions.classList.remove("hidden");
      els.viewport.classList.add("view-mode");
      fitToScreen();
      syncControlsFromPage();
      renderAll();
    });
    card.querySelector("button").addEventListener("click",e=>{e.stopPropagation();removePage(i)});
    els.thumbs.appendChild(card);
  });
}
function syncControlsFromPage(){
  const p=activePage();if(!p)return;
  document.querySelectorAll(".effect-option").forEach(button=>{
    button.classList.toggle("active",button.dataset.effect===p.effect);
  });
  $("#brightnessRange").value=p.brightness;
  $("#contrastRange").value=p.contrast;
  $("#sharpnessRange").value=p.sharpness;
}
function renderEditor(){
  const p=activePage();if(!p)return;
  const max=1400,displayScale=Math.min(1,max/Math.max(p.base.width,p.base.height));
  p.displayScale=displayScale;
  els.canvas.width=Math.max(1,Math.round(p.base.width*displayScale));
  els.canvas.height=Math.max(1,Math.round(p.base.height*displayScale));
  ctx.clearRect(0,0,els.canvas.width,els.canvas.height);
  ctx.drawImage(p.base,0,0,els.canvas.width,els.canvas.height);
  if(p.pendingAdjust) applyEnhancement(ctx,els.canvas.width,els.canvas.height,p);
  if(state.mode==="crop")drawCrop(p);
  updateCanvasTransform();updateToolbar();
}
function drawCrop(p){
  const pts=p.corners.map(c=>({x:c.x*p.displayScale,y:c.y*p.displayScale}));
  ctx.save();
  ctx.fillStyle="rgba(15,23,42,.48)";ctx.fillRect(0,0,els.canvas.width,els.canvas.height);
  ctx.globalCompositeOperation="destination-out";ctx.beginPath();
  pts.forEach((x,i)=>i?ctx.lineTo(x.x,x.y):ctx.moveTo(x.x,x.y));ctx.closePath();ctx.fill();
  ctx.globalCompositeOperation="source-over";
  ctx.strokeStyle="#1d9bf0";ctx.lineWidth=3;ctx.beginPath();
  pts.forEach((x,i)=>i?ctx.lineTo(x.x,x.y):ctx.moveTo(x.x,x.y));ctx.closePath();ctx.stroke();
  ctx.strokeStyle="rgba(255,255,255,.55)";ctx.lineWidth=1;
  for(const t of [1/3,2/3]){
    const top={x:pts[0].x+(pts[1].x-pts[0].x)*t,y:pts[0].y+(pts[1].y-pts[0].y)*t};
    const bottom={x:pts[3].x+(pts[2].x-pts[3].x)*t,y:pts[3].y+(pts[2].y-pts[3].y)*t};
    ctx.beginPath();ctx.moveTo(top.x,top.y);ctx.lineTo(bottom.x,bottom.y);ctx.stroke();
    const left={x:pts[0].x+(pts[3].x-pts[0].x)*t,y:pts[0].y+(pts[3].y-pts[0].y)*t};
    const right={x:pts[1].x+(pts[2].x-pts[1].x)*t,y:pts[1].y+(pts[2].y-pts[1].y)*t};
    ctx.beginPath();ctx.moveTo(left.x,left.y);ctx.lineTo(right.x,right.y);ctx.stroke();
  }
  pts.forEach(x=>{ctx.beginPath();ctx.arc(x.x,x.y,18,0,Math.PI*2);ctx.fillStyle="rgba(255,255,255,.3)";ctx.fill();ctx.lineWidth=3;ctx.strokeStyle="#1d9bf0";ctx.stroke();ctx.beginPath();ctx.arc(x.x,x.y,6,0,Math.PI*2);ctx.fillStyle="#1d9bf0";ctx.fill()});
  ctx.restore();
}
function canvasPoint(e){
  const rect=els.canvas.getBoundingClientRect();
  return {x:(e.clientX-rect.left)*(els.canvas.width/rect.width),y:(e.clientY-rect.top)*(els.canvas.height/rect.height)};
}
els.canvas.addEventListener("pointerdown",e=>{
  const p=canvasPoint(e),page=activePage();
  if(state.mode==="crop"){
    let best=-1,dist=Infinity;
    page.corners.forEach((c,i)=>{const dx=c.x*page.displayScale-p.x,dy=c.y*page.displayScale-p.y,d=Math.hypot(dx,dy);if(d<dist){dist=d;best=i}});
    if(dist<35/state.zoom){state.dragCorner=best;els.canvas.setPointerCapture(e.pointerId);return}
  }
  state.panning=true;state.lastPoint={x:e.clientX,y:e.clientY};els.viewport.classList.add("dragging");
});
els.canvas.addEventListener("pointermove",e=>{
  if(state.dragCorner>=0){
    const page=activePage(),p=canvasPoint(e);
    page.corners[state.dragCorner]={
      x:Math.max(0,Math.min(page.base.width,p.x/page.displayScale)),
      y:Math.max(0,Math.min(page.base.height,p.y/page.displayScale))
    };
    renderEditor();return;
  }
  if(state.panning&&state.lastPoint){
    state.panX+=e.clientX-state.lastPoint.x;state.panY+=e.clientY-state.lastPoint.y;
    state.lastPoint={x:e.clientX,y:e.clientY};updateCanvasTransform();
  }
});
["pointerup","pointercancel"].forEach(n=>els.canvas.addEventListener(n,()=>{state.dragCorner=-1;state.panning=false;state.lastPoint=null;els.viewport.classList.remove("dragging")}));
els.viewport.addEventListener("wheel",e=>{e.preventDefault();state.zoom=Math.max(.2,Math.min(5,state.zoom*(e.deltaY<0?1.1:.9)));updateCanvasTransform()},{passive:false});

function snapshotPage(page){
  page.history.push({
    base:cloneCanvas(page.base),
    filter:page.effect,brightness:page.brightness,contrast:page.contrast,sharpness:page.sharpness
  });
  if(page.history.length>10) page.history.shift();
}
async function refreshPageObject(page){
  const old=page.url;
  const obj=await canvasToObject(page.base,page.name);
  page.url=obj.url;page.img=obj.img;
  if(old) URL.revokeObjectURL(old);
}
async function commitCanvas(newCanvas){
  const page=activePage();if(!page)return;
  snapshotPage(page);
  page.base=cloneCanvas(newCanvas);
  page.corners=defaultCorners(page.base.width,page.base.height);
  page.effect="original";page.brightness=0;page.contrast=0;page.sharpness=0;page.pendingAdjust=false;
  await refreshPageObject(page);
  syncControlsFromPage();
  fitToScreen();
  state.mode="view";
  els.nextActions.classList.remove("hidden");
  els.viewport.classList.add("view-mode");
  renderAll();
}
async function applyCrop(){
  const p=activePage();if(!p)return;
  els.applyCrop.disabled=true;
  try{
    const cropped=warpPerspective(p.base,p.corners,2400);
    await commitCanvas(cropped);
  }catch(e){alert("Crop could not be applied. Adjust the corners and try again.");console.error(e)}
}
async function rotate(){
  const p=activePage();if(!p)return;
  snapshotPage(p);
  const c=document.createElement("canvas");c.width=p.base.height;c.height=p.base.width;
  const cctx=c.getContext("2d");cctx.translate(c.width/2,c.height/2);cctx.rotate(Math.PI/2);
  cctx.drawImage(p.base,-p.base.width/2,-p.base.height/2);
  p.base=c;p.corners=defaultCorners(c.width,c.height);
  p.effect="original";p.brightness=0;p.contrast=0;p.sharpness=0;p.pendingAdjust=false;
  await refreshPageObject(p);
  syncControlsFromPage();
  fitToScreen();
  state.mode="view";
  els.nextActions.classList.remove("hidden");
  els.viewport.classList.add("view-mode");
  renderAll();
}
async function applyAdjust(){
  const p=activePage();if(!p)return;
  const c=cloneCanvas(p.base),cctx=c.getContext("2d");
  applyEnhancement(cctx,c.width,c.height,p);
  await commitCanvas(c);
  els.adjust.classList.add("hidden");
  enterViewMode();
}
async function undo(){
  const p=activePage();if(!p||!p.history.length)return;
  const prev=p.history.pop();
  p.base=cloneCanvas(prev.base);
  p.effect=prev.effect;p.brightness=prev.brightness;p.contrast=prev.contrast;p.sharpness=prev.sharpness;
  p.pendingAdjust=false;p.corners=defaultCorners(p.base.width,p.base.height);
  await refreshPageObject(p);
  syncControlsFromPage();
  fitToScreen();
  state.mode="view";
  els.nextActions.classList.remove("hidden");
  els.viewport.classList.add("view-mode");
  renderAll();
}
function applyEnhancement(context,w,h,p){
  const source=document.createElement("canvas");
  source.width=w;
  source.height=h;
  source.getContext("2d").drawImage(context.canvas,0,0,w,h);

  const processed=processCanvas(source,{
    effect:p.effect,
    brightness:p.brightness,
    contrast:p.contrast,
    sharpness:p.sharpness
  });

  context.clearRect(0,0,w,h);
  context.drawImage(processed,0,0,w,h);
}
function markAdjustPending(){
  const p=activePage();if(!p)return;p.pendingAdjust=true;renderEditor();
}
function resetAdjust(){
  const p=activePage();if(!p)return;
  p.effect="original";p.brightness=0;p.contrast=0;p.sharpness=0;p.pendingAdjust=false;
  syncControlsFromPage();renderEditor();
}
function removePage(index){
  const p=state.pages[index];if(p)URL.revokeObjectURL(p.url);
  state.pages.splice(index,1);state.active=Math.max(0,Math.min(state.active,state.pages.length-1));
  if(!state.pages.length){els.stage.classList.add("hidden");els.rail.classList.add("hidden");els.empty.classList.remove("hidden")}
  else{syncControlsFromPage();fitToScreen();renderAll()}
}
function resetAll(){
  state.pages.forEach(p=>URL.revokeObjectURL(p.url));state.pages=[];state.active=0;
  els.stage.classList.add("hidden");
  els.rail.classList.add("hidden");
  els.empty.classList.remove("hidden");
  els.adjust.classList.add("hidden");
  els.nextActions.classList.add("hidden");
}
function buildExportCanvas(){
  const p=activePage();return cloneCanvas(p.base);
}
function exportCurrent(){
  const type=$("#exportType").value,q=Number($("#exportQuality").value)/100,out=buildExportCanvas(),mime=type==="png"?"image/png":"image/jpeg";
  out.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`scan-${state.active+1}.${type==="png"?"png":"jpg"}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);els.dialog.close()},mime,q)
}

[els.file,els.camera].forEach(input=>input.addEventListener("change",e=>addFiles(e.target.files)));
els.drop.addEventListener("click",()=>els.file.click());
els.drop.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();els.file.click()}});
["dragenter","dragover"].forEach(n=>els.drop.addEventListener(n,e=>{e.preventDefault();els.drop.classList.add("dragover")}));
["dragleave","drop"].forEach(n=>els.drop.addEventListener(n,e=>{e.preventDefault();els.drop.classList.remove("dragover")}));
els.drop.addEventListener("drop",e=>addFiles(e.dataTransfer.files));

$("#newDocumentButton").addEventListener("click",resetAll);
$("#backButton").addEventListener("click",()=>state.pages.length&&resetAll());
$("#undoButton").addEventListener("click",undo);
$("#rotateButton").addEventListener("click",rotate);
$("#adjustButton").addEventListener("click",enterEffectsMode);
$("#closeAdjustButton").addEventListener("click",()=>els.adjust.classList.add("hidden"));
$("#zoomOutButton").addEventListener("click",()=>{state.zoom=Math.max(.2,state.zoom-.2);updateCanvasTransform()});
$("#fitButton").addEventListener("click",fitToScreen);
$("#cropButton").addEventListener("click",enterCropMode);
$("#applyCropButton").addEventListener("click",applyCrop);
$("#downloadButton").addEventListener("click",()=>els.dialog.showModal());
$("#addPageButton").addEventListener("click",()=>els.file.click());
$("#confirmExportButton").addEventListener("click",exportCurrent);
$("#applyAdjustButton").addEventListener("click",applyAdjust);

document.querySelectorAll(".effect-option").forEach(button=>{
  button.addEventListener("click",()=>{
    const page=activePage();
    if(!page)return;
    page.effect=button.dataset.effect;
    document.querySelectorAll(".effect-option").forEach(item=>item.classList.toggle("active",item===button));
    markAdjustPending();
  });
});

$("#brightnessRange").addEventListener("input",e=>{activePage().brightness=Number(e.target.value);markAdjustPending()});
$("#contrastRange").addEventListener("input",e=>{activePage().contrast=Number(e.target.value);markAdjustPending()});
$("#sharpnessRange").addEventListener("input",e=>{activePage().sharpness=Number(e.target.value);markAdjustPending()});
$("#resetAdjustButton").addEventListener("click",resetAdjust);


$("#nextCropButton").addEventListener("click",enterCropMode);
$("#nextEffectsButton").addEventListener("click",enterEffectsMode);
$("#nextRotateButton").addEventListener("click",rotate);
$("#nextDownloadButton").addEventListener("click",()=>els.dialog.showModal());
$("#railToggle").addEventListener("click",()=>els.rail.classList.toggle("collapsed"));
window.addEventListener("resize",()=>state.pages.length&&fitToScreen());
window.addEventListener("beforeunload",()=>state.pages.forEach(p=>URL.revokeObjectURL(p.url)));
