const $=selector=>document.querySelector(selector);
console.info("Background Remover V6 panoptic-instance build loaded");

const els={
  input:$("#imageInput"),drop:$("#dropZone"),welcome:$("#welcomeView"),workspace:$("#workspaceView"),
  canvas:$("#resultCanvas"),viewport:$("#canvasViewport"),status:$("#statusText"),progress:$("#modelProgress"),
  remove:$("#removeButton"),download:$("#downloadButton"),compare:$("#compareButton"),
  undo:$("#undoButton"),redo:$("#redoButton"),processing:$("#processingCover"),processingText:$("#processingText"),
  brushCursor:$("#brushCursor"),bgInput:$("#backgroundImageInput"),bgColour:$("#backgroundColour"),
  blur:$("#blurAmount"),brushSize:$("#brushSize"),softness:$("#edgeSoftness"),cleanup:$("#edgeCleanup"),
  scale:$("#subjectScale"),downloadDialog:$("#downloadDialog"),errorDialog:$("#errorDialog")
};

const ctx=els.canvas.getContext("2d");
const state={
  sourceFile:null,sourceBitmap:null,mask:null,personMask:null,smartMask:null,subjectMode:"smart",model:null,processor:null,RawImage:null,pipelineFactory:null,panopticSegmenter:null,semanticLabels:[],bgBitmap:null,
  background:"transparent",mode:"move",subjectX:0,subjectY:0,subjectScale:1,
  dragging:false,lastPointer:null,painting:false,history:[],future:[],busy:false,showOriginal:false
};

function setStatus(text){els.status.textContent=text}
function withTimeout(promise, milliseconds, label){
  let timer;
  return Promise.race([
    promise.finally(()=>clearTimeout(timer)),
    new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error(`${label} timed out. Check the browser console and network connection.`)),milliseconds);
    })
  ]);
}
function setBusy(busy,text=""){
  state.busy=busy;
  els.remove.disabled=busy||!state.sourceBitmap;
  els.download.disabled=busy||!state.mask;
  if(text)setStatus(text);
  els.processing.classList.toggle("hidden",!busy);
  if(text)els.processingText.textContent=text;
}
function showError(error){
  console.error(error);
  $("#errorMessage").textContent=error?.message||String(error);
  els.errorDialog.showModal();
}
function cloneMask(mask){return mask?new Uint8ClampedArray(mask):null}
function saveHistory(){
  if(!state.mask)return;
  state.history.push(cloneMask(state.mask));
  if(state.history.length>20)state.history.shift();
  state.future.length=0;
  updateHistoryButtons();
}
function updateHistoryButtons(){
  els.undo.disabled=!state.history.length;
  els.redo.disabled=!state.future.length;
}
async function loadImage(file){
  if(!file||!file.type.startsWith("image/"))throw new Error("Choose a JPG, PNG or WEBP image.");
  state.sourceBitmap?.close?.();
  state.sourceFile=file;
  state.sourceBitmap=await createImageBitmap(file);
  state.mask=null;state.personMask=null;state.smartMask=null;state.semanticLabels=[];state.history=[];state.future=[];
  state.subjectX=0;state.subjectY=0;state.subjectScale=1;els.scale.value=100;
  els.welcome.classList.add("hidden");els.workspace.classList.remove("hidden");
  resizeOutput(state.sourceBitmap.width,state.sourceBitmap.height);
  render();
  els.download.disabled=true;els.compare.disabled=true;updateHistoryButtons();
  setStatus("Image ready");
}
function resizeOutput(w,h){els.canvas.width=w;els.canvas.height=h}
async function ensureModel(){
  if(state.model&&state.processor&&state.RawImage){
    return {model:state.model,processor:state.processor,RawImage:state.RawImage};
  }

  els.progress.classList.remove("hidden");
  els.progress.removeAttribute("value");
  setBusy(true,"Preparing portrait model…");
  els.remove.textContent="Preparing model…";

  const transformers=await withTimeout(
    import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1"),
    30000,
    "Transformers.js download"
  );

  const {AutoModel,AutoProcessor,RawImage,pipeline,env}=transformers;
  state.pipelineFactory=pipeline;
  env.allowLocalModels=false;
  env.useBrowserCache=true;

  const progress_callback=event=>{
    if(event?.progress!=null){
      const progress=Math.max(1,Math.min(99,Math.round(event.progress)));
      els.progress.value=progress;
      setStatus(`Downloading portrait model… ${progress}%`);
    }else if(event?.status){
      setStatus(`Model: ${event.status}`);
    }
  };

  state.processor=await withTimeout(
    AutoProcessor.from_pretrained("Xenova/modnet",{progress_callback}),
    180000,
    "Portrait processor download"
  );

  state.model=await withTimeout(
    AutoModel.from_pretrained("Xenova/modnet",{
      dtype:"fp32",
      device:"wasm",
      progress_callback
    }),
    240000,
    "Portrait model download"
  );

  state.RawImage=RawImage;
  els.progress.value=100;
  setStatus("Model ready");
  els.remove.textContent="Remove background";
  setTimeout(()=>els.progress.classList.add("hidden"),600);

  return {model:state.model,processor:state.processor,RawImage:state.RawImage};
}

async function buildAlphaMask(sourceUrl){
  const {model,processor,RawImage}=await ensureModel();

  setStatus("Reading image…");
  const image=await withTimeout(RawImage.fromURL(sourceUrl),30000,"Image decoding");

  setStatus("Preparing image for AI…");
  const inputs=await withTimeout(processor(image),30000,"Image preprocessing");

  setStatus("Detecting the subject…");
  const prediction=await withTimeout(
    model({input:inputs.pixel_values}),
    240000,
    "Subject detection"
  );

  if(!prediction?.output)throw new Error("MODNet returned no alpha matte.");

  setStatus("Building full-resolution mask…");
  const rawMask=await RawImage.fromTensor(
    prediction.output[0].mul(255).to("uint8")
  );
  const resizedMask=await rawMask.resize(
    state.sourceBitmap.width,
    state.sourceBitmap.height
  );

  const expected=state.sourceBitmap.width*state.sourceBitmap.height;
  if(!resizedMask?.data||resizedMask.data.length<expected){
    throw new Error("The generated alpha mask is incomplete.");
  }

  const mask=new Uint8ClampedArray(expected);
  const channels=Math.max(1,Math.round(resizedMask.data.length/expected));
  for(let i=0;i<expected;i++)mask[i]=resizedMask.data[i*channels];

  let minimum=255,maximum=0,nonZero=0;
  for(const alpha of mask){
    if(alpha<minimum)minimum=alpha;
    if(alpha>maximum)maximum=alpha;
    if(alpha>8)nonZero++;
  }

  console.info("MODNet alpha diagnostics",{
    width:state.sourceBitmap.width,
    height:state.sourceBitmap.height,
    minimum,
    maximum,
    foregroundRatio:nonZero/mask.length
  });

  if(maximum<20)throw new Error("The model produced an empty foreground mask.");
  if(minimum>235)throw new Error("The model treated the entire image as foreground.");

  return mask;
}




const SUPPORT_LABELS=new Set([
  "chair",
  "armchair",
  "swivel chair",
  "stool",
  "seat",
  "bench",
  "sofa",
  "couch"
]);

function normalizeLabel(label){
  return String(label||"")
    .toLowerCase()
    .replace(/[_-]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}

async function ensurePanopticSegmenter(){
  if(state.panopticSegmenter)return state.panopticSegmenter;

  if(!state.pipelineFactory){
    await ensureModel();
  }

  setStatus("Loading panoptic instance model…");
  els.progress.classList.remove("hidden");
  els.progress.removeAttribute("value");

  const progress_callback=event=>{
    if(event?.progress!=null){
      const progress=Math.max(1,Math.min(99,Math.round(event.progress)));
      els.progress.value=progress;
      setStatus(`Downloading panoptic model… ${progress}%`);
    }else if(event?.status){
      setStatus(`Panoptic model: ${event.status}`);
    }
  };

  state.panopticSegmenter=await withTimeout(
    state.pipelineFactory(
      "image-segmentation",
      "Xenova/detr-resnet-50-panoptic",
      {
        device:"wasm",
        dtype:"q8",
        progress_callback
      }
    ),
    420000,
    "Panoptic model download"
  );

  return state.panopticSegmenter;
}

async function rawMaskToFullResolution(rawMask,width,height){
  if(!rawMask?.resize||!rawMask?.data){
    throw new Error("The panoptic model returned an unsupported mask.");
  }

  const resized=await rawMask.resize(width,height);
  const expected=width*height;
  const channels=Math.max(1,Math.round(resized.data.length/expected));
  const output=new Uint8ClampedArray(expected);

  for(let i=0;i<expected;i++){
    output[i]=resized.data[i*channels];
  }
  return output;
}

function maskBounds(mask,width,height,threshold=80){
  let minX=width,minY=height,maxX=-1,maxY=-1,count=0;
  for(let y=0;y<height;y++){
    const row=y*width;
    for(let x=0;x<width;x++){
      if(mask[row+x]<threshold)continue;
      if(x<minX)minX=x;
      if(x>maxX)maxX=x;
      if(y<minY)minY=y;
      if(y>maxY)maxY=y;
      count++;
    }
  }
  return count?{minX,minY,maxX,maxY,count}:null;
}

function intersectionScore(a,b){
  let intersection=0,aCount=0,bCount=0;
  const length=Math.min(a.length,b.length);
  for(let i=0;i<length;i++){
    const av=a[i]>70;
    const bv=b[i]>70;
    if(av)aCount++;
    if(bv)bCount++;
    if(av&&bv)intersection++;
  }
  if(!intersection)return 0;
  return intersection/Math.max(1,Math.min(aCount,bCount));
}

function boxesNear(a,b,padding){
  if(!a||!b)return false;
  return !(
    a.maxX+padding<b.minX ||
    b.maxX+padding<a.minX ||
    a.maxY+padding<b.minY ||
    b.maxY+padding<a.minY
  );
}

function constrainFinePersonMask(modnetMask,instanceMask){
  const width=state.sourceBitmap.width;
  const height=state.sourceBitmap.height;

  // Dilate the coarse person instance slightly so MODNet hair/fingers survive.
  const coarseCanvas=document.createElement("canvas");
  coarseCanvas.width=width;
  coarseCanvas.height=height;
  const coarseCtx=coarseCanvas.getContext("2d");
  const coarseImage=coarseCtx.createImageData(width,height);
  for(let i=0,p=3;i<instanceMask.length;i++,p+=4){
    coarseImage.data[p]=instanceMask[i];
  }
  coarseCtx.putImageData(coarseImage,0,0);

  const gateCanvas=document.createElement("canvas");
  gateCanvas.width=width;
  gateCanvas.height=height;
  const gateCtx=gateCanvas.getContext("2d",{willReadFrequently:true});
  gateCtx.filter=`blur(${Math.max(2,Math.round(Math.max(width,height)*.006))}px)`;
  gateCtx.drawImage(coarseCanvas,0,0);
  gateCtx.filter="none";
  const gateData=gateCtx.getImageData(0,0,width,height).data;

  const refined=new Uint8ClampedArray(modnetMask.length);
  let removed=0;

  for(let i=0,p=3;i<refined.length;i++,p+=4){
    const gate=gateData[p];
    refined[i]=gate>3?modnetMask[i]:0;
    if(modnetMask[i]>20&&refined[i]===0)removed++;
  }

  console.info("V6 person constraint diagnostics",{
    removedDetachedPixels:removed,
    removedRatio:removed/refined.length
  });

  return refined;
}

function supportTouchesSelectedPerson(supportMask,personMask,width,height){
  const personBox=maskBounds(personMask,width,height,70);
  const supportBox=maskBounds(supportMask,width,height,70);
  if(!personBox||!supportBox)return false;

  const padding=Math.round(Math.max(width,height)*.045);
  if(!boxesNear(personBox,supportBox,padding))return false;

  let supportPixels=0,nearPixels=0;
  const radius=Math.max(2,Math.round(Math.max(width,height)*.012));
  const personBinary=new Uint8Array(personMask.length);
  for(let i=0;i<personMask.length;i++)personBinary[i]=personMask[i]>50?1:0;

  for(let y=supportBox.minY;y<=supportBox.maxY;y++){
    for(let x=supportBox.minX;x<=supportBox.maxX;x++){
      const index=y*width+x;
      if(supportMask[index]<70)continue;
      supportPixels++;

      let found=false;
      for(let dy=-radius;dy<=radius&&!found;dy+=Math.max(1,Math.floor(radius/3))){
        const py=y+dy;
        if(py<0||py>=height)continue;
        for(let dx=-radius;dx<=radius;dx+=Math.max(1,Math.floor(radius/3))){
          const px=x+dx;
          if(px<0||px>=width)continue;
          if(personBinary[py*width+px]){
            found=true;
            break;
          }
        }
      }
      if(found)nearPixels++;
    }
  }

  const contactRatio=nearPixels/Math.max(1,supportPixels);
  const verticalOverlap=Math.min(personBox.maxY,supportBox.maxY)-
    Math.max(personBox.minY,supportBox.minY);
  const plausibleVertical=verticalOverlap>0;

  return contactRatio>.012&&plausibleVertical;
}

async function createPanopticSubjectMasks(modnetMask,sourceUrl){
  const segmenter=await ensurePanopticSegmenter();

  setStatus("Detecting individual foreground objects…");
  const segments=await withTimeout(
    segmenter(sourceUrl),
    300000,
    "Panoptic instance segmentation"
  );

  if(!Array.isArray(segments)||!segments.length){
    throw new Error("The panoptic model returned no object instances.");
  }

  const width=state.sourceBitmap.width;
  const height=state.sourceBitmap.height;
  const personCandidates=[];
  const supportCandidates=[];

  for(const segment of segments){
    const label=normalizeLabel(segment?.label);
    if(!label||!segment?.mask)continue;

    if(label==="person"){
      personCandidates.push({
        label,
        score:Number(segment.score||0),
        mask:await rawMaskToFullResolution(segment.mask,width,height)
      });
    }else if(SUPPORT_LABELS.has(label)){
      supportCandidates.push({
        label,
        score:Number(segment.score||0),
        mask:await rawMaskToFullResolution(segment.mask,width,height)
      });
    }
  }

  if(!personCandidates.length){
    throw new Error("No person instance was found by the panoptic model.");
  }

  // Select the person instance that overlaps the MODNet portrait matte most.
  for(const candidate of personCandidates){
    candidate.overlap=intersectionScore(modnetMask,candidate.mask);
  }
  personCandidates.sort((a,b)=>
    (b.overlap-a.overlap)||
    (b.score-a.score)
  );

  const selectedPerson=personCandidates[0];
  const refinedPerson=constrainFinePersonMask(modnetMask,selectedPerson.mask);
  const smart=cloneMask(refinedPerson);
  const keptSupports=[];
  const rejectedSupports=[];

  for(const support of supportCandidates){
    const keep=supportTouchesSelectedPerson(
      support.mask,
      selectedPerson.mask,
      width,
      height
    );

    if(!keep){
      rejectedSupports.push(support.label);
      continue;
    }

    keptSupports.push(support.label);
    for(let i=0;i<smart.length;i++){
      if(support.mask[i]>smart[i]){
        smart[i]=support.mask[i];
      }
    }
  }

  console.info("V6 panoptic diagnostics",{
    personInstances:personCandidates.length,
    selectedPersonOverlap:selectedPerson.overlap,
    selectedPersonScore:selectedPerson.score,
    keptSupports,
    rejectedSupports,
    totalSegments:segments.length
  });

  return {
    personMask:refinedPerson,
    smartMask:smart,
    keptSupports
  };
}

async function applySubjectMode(mode){
  state.subjectMode=mode;

  document.querySelectorAll("[data-subject-mode]").forEach(button=>{
    button.classList.toggle("active",button.dataset.subjectMode===mode);
  });

  if(mode==="smart"&&!state.smartMask&&state.personMask&&state.sourceFile){
    try{
      setBusy(true,"Detecting individual support objects…");
      const url=URL.createObjectURL(state.sourceFile);
      try{
        const result=await createPanopticSubjectMasks(state.personMask,url);
        state.personMask=result.personMask;
        state.smartMask=result.smartMask;
        state.semanticLabels=result.keptSupports;
      }finally{
        URL.revokeObjectURL(url);
      }
      setBusy(false,"Person + support selected");
    }catch(error){
      setBusy(false,"Panoptic detection failed");
      showError(error);
      state.subjectMode="person";
    }
  }

  state.mask=state.subjectMode==="person"
    ? cloneMask(state.personMask)
    : cloneMask(state.smartMask||state.personMask);

  state.history=[];
  state.future=[];
  updateHistoryButtons();
  render();
  setStatus(
    state.subjectMode==="smart"
      ? `Person + support selected${state.semanticLabels.length?`: ${state.semanticLabels.join(", ")}`:""}`
      : "Person only selected"
  );
}

async function removeBackground(){
  if(!state.sourceFile){
    setStatus("Choose an image first");
    return;
  }
  if(state.busy)return;

  els.remove.textContent="Starting…";
  setStatus("Starting background removal…");
  els.progress.classList.remove("hidden");
  els.progress.removeAttribute("value");

  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));

  try{
    setBusy(true,"Preparing local AI…");
    const url=URL.createObjectURL(state.sourceFile);
    try{
      const rawModnetMask=await buildAlphaMask(url);
      setStatus("Selecting the real person instance…");
      const panoptic=await createPanopticSubjectMasks(rawModnetMask,url);

      state.personMask=panoptic.personMask;
      state.smartMask=panoptic.smartMask;
      state.semanticLabels=panoptic.keptSupports;
      state.mask=state.subjectMode==="smart"
        ? cloneMask(state.smartMask)
        : cloneMask(state.personMask);
    }finally{
      URL.revokeObjectURL(url);
    }

    state.history=[];
    state.future=[];
    resizeOutput(state.sourceBitmap.width,state.sourceBitmap.height);
    els.compare.disabled=false;
    els.download.disabled=false;
    updateHistoryButtons();
    render();

    els.progress.value=100;
    els.remove.textContent="Background removed";
    setBusy(false,"Background removed");

    setTimeout(()=>{
      els.remove.textContent="Remove again";
      els.progress.classList.add("hidden");
    },900);
  }catch(error){
    setBusy(false,"Removal failed");
    els.remove.textContent="Try again";
    els.progress.classList.add("hidden");
    showError(error);
  }
}

function adjustedMask(){
  if(!state.mask)return null;
  const w=els.canvas.width,h=els.canvas.height;
  const out=new Uint8ClampedArray(state.mask);
  const cleanup=Number(els.cleanup.value),soft=Number(els.softness.value);
  for(let i=0;i<out.length;i++){
    let a=out[i]+cleanup*5;
    a=Math.max(0,Math.min(255,a));
    if(soft>0){
      const n=a/255;
      a=Math.round((n*n*(3-2*n)*(1-soft*.018)+n*soft*.018)*255);
    }
    out[i]=a;
  }
  return out;
}
function subjectCanvas(){
  const w=els.canvas.width,h=els.canvas.height;
  const c=document.createElement("canvas");c.width=w;c.height=h;
  if(!state.mask||!state.sourceBitmap)return c;
  const x=c.getContext("2d",{willReadFrequently:true});
  const imageCanvas=document.createElement("canvas");imageCanvas.width=w;imageCanvas.height=h;
  const ix=imageCanvas.getContext("2d");
  ix.drawImage(state.sourceBitmap,0,0,w,h);
  const image=ix.getImageData(0,0,w,h);
  const mask=adjustedMask();
  for(let p=0,i=3;p<mask.length;p++,i+=4)image.data[i]=mask[p];
  ix.putImageData(image,0,0);

  const scale=state.subjectScale;
  const dw=w*scale,dh=h*scale;
  x.drawImage(imageCanvas,(w-dw)/2+state.subjectX,(h-dh)/2+state.subjectY,dw,dh);
  return c;
}
function drawCover(context,image,w,h,extra=1){
  const scale=Math.max(w/image.width,h/image.height)*extra;
  const dw=image.width*scale,dh=image.height*scale;
  context.drawImage(image,(w-dw)/2,(h-dh)/2,dw,dh);
}
function render(){
  if(!state.sourceBitmap)return;
  const w=els.canvas.width,h=els.canvas.height;
  ctx.clearRect(0,0,w,h);
  if(state.showOriginal||!state.mask){ctx.drawImage(state.sourceBitmap,0,0,w,h);return}
  if(state.background==="white"){ctx.fillStyle="#fff";ctx.fillRect(0,0,w,h)}
  else if(state.background==="black"){ctx.fillStyle="#111";ctx.fillRect(0,0,w,h)}
  else if(state.background==="colour"){ctx.fillStyle=els.bgColour.value;ctx.fillRect(0,0,w,h)}
  else if(state.background==="image"&&state.bgBitmap)drawCover(ctx,state.bgBitmap,w,h)
  else if(state.background==="blur"){
    ctx.save();ctx.filter=`blur(${Number(els.blur.value)}px)`;drawCover(ctx,state.sourceBitmap,w,h,1.08);ctx.restore()
  }
  ctx.drawImage(subjectCanvas(),0,0);
}
function canvasPoint(event){
  const rect=els.canvas.getBoundingClientRect();
  return {x:(event.clientX-rect.left)*(els.canvas.width/rect.width),y:(event.clientY-rect.top)*(els.canvas.height/rect.height)};
}
function paintMask(event){
  if(!state.mask||!state.painting)return;
  const p=canvasPoint(event),radius=Number(els.brushSize.value)/2;
  const w=els.canvas.width,h=els.canvas.height;
  const inverseScale=1/state.subjectScale;
  const cx=(p.x-state.subjectX-w/2)*inverseScale+w/2;
  const cy=(p.y-state.subjectY-h/2)*inverseScale+h/2;
  const r=radius*inverseScale;
  const minX=Math.max(0,Math.floor(cx-r)),maxX=Math.min(w-1,Math.ceil(cx+r));
  const minY=Math.max(0,Math.floor(cy-r)),maxY=Math.min(h-1,Math.ceil(cy+r));
  const target=state.mode==="erase"?0:255;
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
    const distance=Math.hypot(x-cx,y-cy);
    if(distance>r)continue;
    const strength=1-distance/r;
    const index=y*w+x,current=state.mask[index];
    state.mask[index]=Math.round(current+(target-current)*Math.min(1,strength*.8+.2));
  }
  render();
}
function setMode(mode){
  state.mode=mode;
  document.querySelectorAll(".mode-button").forEach(button=>button.classList.toggle("active",button.dataset.mode===mode));
  els.brushCursor.classList.toggle("hidden",mode==="move");
}
function setBackground(mode){
  state.background=mode;
  document.querySelectorAll(".background-choice").forEach(button=>button.classList.toggle("active",button.dataset.background===mode));
  $("#colourField").classList.toggle("hidden",mode!=="colour");
  $("#backgroundImageField").classList.toggle("hidden",mode!=="image");
  $("#blurField").classList.toggle("hidden",mode!=="blur");
  render();
}
async function loadBackground(file){
  if(!file||!file.type.startsWith("image/"))return;
  state.bgBitmap?.close?.();state.bgBitmap=await createImageBitmap(file);
  setBackground("image");
}
function undo(){
  if(!state.history.length||!state.mask)return;
  state.future.push(cloneMask(state.mask));
  state.mask=state.history.pop();updateHistoryButtons();render();
}
function redo(){
  if(!state.future.length||!state.mask)return;
  state.history.push(cloneMask(state.mask));
  state.mask=state.future.pop();updateHistoryButtons();render();
}
function resetSubject(){
  state.subjectX=0;state.subjectY=0;state.subjectScale=1;els.scale.value=100;render();
}
function resetApp(){
  state.sourceBitmap?.close?.();state.bgBitmap?.close?.();
  Object.assign(state,{sourceFile:null,sourceBitmap:null,rawCutout:null,mask:null,personMask:null,smartMask:null,bgBitmap:null,history:[],future:[],subjectX:0,subjectY:0,subjectScale:1});
  els.input.value="";els.workspace.classList.add("hidden");els.welcome.classList.remove("hidden");
}
function download(){
  const format=$("#exportFormat").value,quality=Number($("#exportQuality").value)/100;
  const mime=format==="jpeg"?"image/jpeg":format==="webp"?"image/webp":"image/png";
  if(format==="jpeg"&&state.background==="transparent"){
    const temp=document.createElement("canvas");temp.width=els.canvas.width;temp.height=els.canvas.height;
    const t=temp.getContext("2d");t.fillStyle="#fff";t.fillRect(0,0,temp.width,temp.height);t.drawImage(els.canvas,0,0);
    saveCanvas(temp,mime,quality,format);
  }else saveCanvas(els.canvas,mime,quality,format);
}
function saveCanvas(canvas,mime,quality,extension){
  canvas.toBlob(blob=>{
    if(!blob)return;
    const url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download=`background-removed.${extension==="jpeg"?"jpg":extension}`;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1200);els.downloadDialog.close();
  },mime,quality);
}

els.input.addEventListener("change",event=>loadImage(event.target.files[0]).catch(showError));
els.drop.addEventListener("click",()=>els.input.click());
els.drop.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();els.input.click()}});
["dragenter","dragover"].forEach(name=>els.drop.addEventListener(name,event=>{event.preventDefault();els.drop.classList.add("dragover")}));
["dragleave","drop"].forEach(name=>els.drop.addEventListener(name,event=>{event.preventDefault();els.drop.classList.remove("dragover")}));
els.drop.addEventListener("drop",event=>loadImage(event.dataTransfer.files[0]).catch(showError));
els.remove.addEventListener("click",event=>{
  event.preventDefault();
  console.info("V3 remove background clicked", {
    hasFile:Boolean(state.sourceFile),
    busy:state.busy
  });
  removeBackground();
});
$("#newImageButton").addEventListener("click",resetApp);
els.download.addEventListener("click",()=>els.downloadDialog.showModal());
$("#confirmDownloadButton").addEventListener("click",download);
els.undo.addEventListener("click",undo);els.redo.addEventListener("click",redo);
document.querySelectorAll(".background-choice").forEach(button=>button.addEventListener("click",()=>{
  const mode=button.dataset.background;
  if(mode==="image"&&!state.bgBitmap){$("#backgroundImageInput").click();return}
  setBackground(mode);
}));
els.bgInput.addEventListener("change",event=>loadBackground(event.target.files[0]).catch(showError));
[els.bgColour,els.blur,els.softness,els.cleanup].forEach(input=>input.addEventListener("input",render));
document.querySelectorAll(".mode-button[data-mode]").forEach(button=>button.addEventListener("click",()=>setMode(button.dataset.mode)));
document.querySelectorAll("[data-subject-mode]").forEach(button=>button.addEventListener("click",()=>{
  if(!state.personMask)return;
  applySubjectMode(button.dataset.subjectMode).catch(showError);
}));
els.scale.addEventListener("input",()=>{state.subjectScale=Number(els.scale.value)/100;render()});
$("#resetSubjectButton").addEventListener("click",resetSubject);
els.compare.addEventListener("pointerdown",()=>{state.showOriginal=true;render()});
["pointerup","pointerleave","pointercancel"].forEach(name=>els.compare.addEventListener(name,()=>{state.showOriginal=false;render()}));
els.viewport.addEventListener("pointermove",event=>{
  if(state.mode!=="move"){els.brushCursor.style.left=`${event.clientX}px`;els.brushCursor.style.top=`${event.clientY}px`;const size=Number(els.brushSize.value)*els.canvas.getBoundingClientRect().width/els.canvas.width;els.brushCursor.style.width=`${size}px`;els.brushCursor.style.height=`${size}px`}
  if(state.painting)paintMask(event);
  else if(state.dragging&&state.lastPointer){
    state.subjectX+=event.clientX-state.lastPointer.x;state.subjectY+=event.clientY-state.lastPointer.y;
    state.lastPointer={x:event.clientX,y:event.clientY};render();
  }
});
els.viewport.addEventListener("pointerdown",event=>{
  if(!state.mask)return;
  if(state.mode==="move"){state.dragging=true;state.lastPointer={x:event.clientX,y:event.clientY}}
  else{saveHistory();state.painting=true;paintMask(event)}
  els.viewport.setPointerCapture(event.pointerId);
});
["pointerup","pointercancel"].forEach(name=>els.viewport.addEventListener(name,event=>{state.dragging=false;state.painting=false;state.lastPointer=null;try{els.viewport.releasePointerCapture(event.pointerId)}catch{}}));
els.viewport.addEventListener("pointerleave",()=>els.brushCursor.classList.add("hidden"));
els.viewport.addEventListener("pointerenter",()=>{if(state.mode!=="move")els.brushCursor.classList.remove("hidden")});
window.addEventListener("beforeunload",()=>{state.sourceBitmap?.close?.();state.bgBitmap?.close?.()});
