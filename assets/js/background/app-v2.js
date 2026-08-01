const $=selector=>document.querySelector(selector);
console.info("Background Remover V8 person-anchored cleanup build loaded");

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


function maskToAlphaCanvas(mask,width,height){
  const canvas=document.createElement("canvas");
  canvas.width=width;
  canvas.height=height;
  const context=canvas.getContext("2d",{willReadFrequently:true});
  const image=context.createImageData(width,height);

  for(let i=0,p=3;i<mask.length;i++,p+=4){
    image.data[p]=mask[i];
  }

  context.putImageData(image,0,0);
  return canvas;
}

function alphaCanvasToMask(canvas){
  const context=canvas.getContext("2d",{willReadFrequently:true});
  const data=context.getImageData(0,0,canvas.width,canvas.height).data;
  const mask=new Uint8ClampedArray(canvas.width*canvas.height);

  for(let i=0,p=3;i<mask.length;i++,p+=4){
    mask[i]=data[p];
  }

  return mask;
}

function morphologyClose(mask,width,height,radius){
  if(radius<=0)return cloneMask(mask);

  const source=maskToAlphaCanvas(mask,width,height);
  const expanded=document.createElement("canvas");
  expanded.width=width;
  expanded.height=height;
  const expandedContext=expanded.getContext("2d");

  // Maximum-like expansion by drawing the mask around its original position.
  for(let y=-radius;y<=radius;y++){
    for(let x=-radius;x<=radius;x++){
      if(x*x+y*y>radius*radius)continue;
      expandedContext.drawImage(source,x,y);
    }
  }

  const expandedMask=alphaCanvasToMask(expanded);
  const result=new Uint8ClampedArray(expandedMask.length);

  // Erode the expanded result. A pixel remains only when the neighbourhood
  // is substantially occupied. This closes narrow gaps without broad growth.
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      let occupied=0,total=0,minimum=255;

      for(let dy=-radius;dy<=radius;dy++){
        const py=y+dy;
        if(py<0||py>=height)continue;

        for(let dx=-radius;dx<=radius;dx++){
          if(dx*dx+dy*dy>radius*radius)continue;
          const px=x+dx;
          if(px<0||px>=width)continue;

          const value=expandedMask[py*width+px];
          total++;
          if(value>18)occupied++;
          if(value<minimum)minimum=value;
        }
      }

      const index=y*width+x;
      result[index]=occupied>=Math.max(1,Math.round(total*.72))
        ? Math.max(mask[index],minimum)
        : mask[index];
    }
  }

  return result;
}

function componentFilterAnchoredToPerson(combinedMask,personMask,width,height){
  const binary=new Uint8Array(combinedMask.length);
  const personBinary=new Uint8Array(personMask.length);

  for(let i=0;i<binary.length;i++){
    binary[i]=combinedMask[i]>28?1:0;
    personBinary[i]=personMask[i]>55?1:0;
  }

  const visited=new Uint8Array(binary.length);
  const output=new Uint8ClampedArray(combinedMask.length);
  const queue=new Int32Array(binary.length);
  const component=[];
  const minimumArea=Math.max(20,Math.round(width*height*.000035));
  const generousArea=Math.max(minimumArea,Math.round(width*height*.004));

  let componentCount=0;
  let keptCount=0;
  let removedPixels=0;

  for(let start=0;start<binary.length;start++){
    if(!binary[start]||visited[start])continue;

    component.length=0;
    let head=0,tail=0;
    let personOverlap=0;
    let maxAlpha=0;

    queue[tail++]=start;
    visited[start]=1;

    while(head<tail){
      const current=queue[head++];
      component.push(current);
      if(personBinary[current])personOverlap++;
      if(combinedMask[current]>maxAlpha)maxAlpha=combinedMask[current];

      const x=current%width;
      const y=Math.floor(current/width);

      const neighbours=[
        [x-1,y],[x+1,y],[x,y-1],[x,y+1],
        [x-1,y-1],[x+1,y-1],[x-1,y+1],[x+1,y+1]
      ];

      for(const [nx,ny] of neighbours){
        if(nx<0||nx>=width||ny<0||ny>=height)continue;
        const next=ny*width+nx;
        if(!binary[next]||visited[next])continue;
        visited[next]=1;
        queue[tail++]=next;
      }
    }

    componentCount++;

    const area=component.length;
    const overlapRatio=personOverlap/Math.max(1,area);
    const anchored=personOverlap>0;
    const substantialSupport=area>=generousArea&&overlapRatio>.002;
    const keep=(anchored||substantialSupport)&&area>=minimumArea&&maxAlpha>35;

    if(keep){
      keptCount++;
      for(const index of component){
        output[index]=combinedMask[index];
      }
    }else{
      removedPixels+=area;
    }
  }

  console.info("V7 component cleanup diagnostics",{
    componentCount,
    keptCount,
    removedPixels,
    removedRatio:removedPixels/output.length
  });

  return output;
}

function fillSmallInternalHoles(mask,width,height){
  const solid=new Uint8Array(mask.length);
  for(let i=0;i<solid.length;i++)solid[i]=mask[i]>45?1:0;

  const exterior=new Uint8Array(mask.length);
  const queue=new Int32Array(mask.length);
  let head=0,tail=0;

  const enqueue=(index)=>{
    if(index<0||index>=solid.length||solid[index]||exterior[index])return;
    exterior[index]=1;
    queue[tail++]=index;
  };

  for(let x=0;x<width;x++){
    enqueue(x);
    enqueue((height-1)*width+x);
  }
  for(let y=0;y<height;y++){
    enqueue(y*width);
    enqueue(y*width+width-1);
  }

  while(head<tail){
    const current=queue[head++];
    const x=current%width;
    const y=Math.floor(current/width);

    if(x>0)enqueue(current-1);
    if(x<width-1)enqueue(current+1);
    if(y>0)enqueue(current-width);
    if(y<height-1)enqueue(current+width);
  }

  const visited=new Uint8Array(mask.length);
  const holeQueue=new Int32Array(mask.length);
  const hole=[];
  const maxHoleArea=Math.max(80,Math.round(width*height*.0014));
  let filledPixels=0;

  for(let start=0;start<mask.length;start++){
    if(solid[start]||exterior[start]||visited[start])continue;

    hole.length=0;
    let holeHead=0,holeTail=0;
    holeQueue[holeTail++]=start;
    visited[start]=1;

    while(holeHead<holeTail){
      const current=holeQueue[holeHead++];
      hole.push(current);
      const x=current%width;
      const y=Math.floor(current/width);

      const neighbours=[
        x>0?current-1:-1,
        x<width-1?current+1:-1,
        y>0?current-width:-1,
        y<height-1?current+width:-1
      ];

      for(const next of neighbours){
        if(next<0||solid[next]||exterior[next]||visited[next])continue;
        visited[next]=1;
        holeQueue[holeTail++]=next;
      }
    }

    if(hole.length<=maxHoleArea){
      for(const index of hole){
        mask[index]=255;
      }
      filledPixels+=hole.length;
    }
  }

  console.info("V7 hole repair diagnostics",{
    filledPixels,
    maximumHoleArea:maxHoleArea
  });

  return mask;
}

function featherMatte(mask,width,height){
  const source=maskToAlphaCanvas(mask,width,height);
  const blurred=document.createElement("canvas");
  blurred.width=width;
  blurred.height=height;
  const context=blurred.getContext("2d",{willReadFrequently:true});

  const radius=Math.max(.45,Math.min(1.25,Math.max(width,height)/1800));
  context.filter=`blur(${radius}px)`;
  context.drawImage(source,0,0);
  context.filter="none";

  const softened=alphaCanvasToMask(blurred);
  const result=new Uint8ClampedArray(mask.length);

  for(let i=0;i<result.length;i++){
    const original=mask[i];
    const soft=softened[i];

    // Preserve confident interiors and exteriors. Blend only the edge band.
    if(original>=242)result[i]=255;
    else if(original<=8&&soft<=8)result[i]=0;
    else result[i]=Math.round(original*.58+soft*.42);
  }

  return result;
}


function dilateBinaryMask(mask,width,height,radius,threshold=55){
  const output=new Uint8Array(mask.length);
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      let found=false;
      for(let dy=-radius;dy<=radius&&!found;dy++){
        const py=y+dy;if(py<0||py>=height)continue;
        for(let dx=-radius;dx<=radius;dx++){
          if(dx*dx+dy*dy>radius*radius)continue;
          const px=x+dx;if(px<0||px>=width)continue;
          if(mask[py*width+px]>threshold){found=true;break;}
        }
      }
      if(found)output[y*width+x]=1;
    }
  }
  return output;
}

function keepOnlyPersonAnchoredComponent(combinedMask,panopticPersonMask,width,height){
  const bridgeRadius=Math.max(2,Math.min(10,Math.round(Math.max(width,height)*.009)));
  const personSeed=dilateBinaryMask(panopticPersonMask,width,height,bridgeRadius,55);
  const bridged=morphologyClose(new Uint8ClampedArray(combinedMask),width,height,Math.max(1,Math.round(bridgeRadius*.45)));
  const candidate=new Uint8Array(bridged.length);
  for(let i=0;i<candidate.length;i++)candidate[i]=bridged[i]>18?1:0;
  const kept=new Uint8Array(candidate.length),queue=new Int32Array(candidate.length);
  let head=0,tail=0,seedPixels=0;
  for(let i=0;i<candidate.length;i++)if(candidate[i]&&personSeed[i]){kept[i]=1;queue[tail++]=i;seedPixels++;}
  if(!seedPixels)throw new Error('The selected person instance did not overlap the extracted matte.');
  while(head<tail){
    const current=queue[head++],x=current%width,y=Math.floor(current/width);
    const neighbours=[[x-1,y],[x+1,y],[x,y-1],[x,y+1],[x-1,y-1],[x+1,y-1],[x-1,y+1],[x+1,y+1]];
    for(const [nx,ny] of neighbours){
      if(nx<0||nx>=width||ny<0||ny>=height)continue;
      const next=ny*width+nx;if(!candidate[next]||kept[next])continue;
      kept[next]=1;queue[tail++]=next;
    }
  }
  const output=new Uint8ClampedArray(combinedMask.length);
  let keptPixels=0,removedPixels=0;
  for(let i=0;i<output.length;i++){
    if(kept[i]){output[i]=bridged[i];keptPixels++;}
    else if(combinedMask[i]>18)removedPixels++;
  }
  console.info('V8 person-anchored component diagnostics',{bridgeRadius,seedPixels,keptPixels,removedPixels,removedRatio:removedPixels/output.length});
  return output;
}

function removeTinyEdgeIslands(mask,personInstanceMask,width,height){
  const personBounds=maskBounds(personInstanceMask,width,height,55);if(!personBounds)return mask;
  const binary=new Uint8Array(mask.length);for(let i=0;i<binary.length;i++)binary[i]=mask[i]>18?1:0;
  const visited=new Uint8Array(binary.length),queue=new Int32Array(binary.length),result=new Uint8ClampedArray(mask.length);
  const minimumArea=Math.max(18,Math.round(width*height*.000025));let removedComponents=0,removedPixels=0;
  for(let start=0;start<binary.length;start++){
    if(!binary[start]||visited[start])continue;
    let head=0,tail=0;const component=[];let overlapsPersonBox=false;queue[tail++]=start;visited[start]=1;
    while(head<tail){
      const current=queue[head++];component.push(current);const x=current%width,y=Math.floor(current/width);
      if(x>=personBounds.minX&&x<=personBounds.maxX&&y>=personBounds.minY&&y<=personBounds.maxY)overlapsPersonBox=true;
      const neighbours=[x>0?current-1:-1,x<width-1?current+1:-1,y>0?current-width:-1,y<height-1?current+width:-1];
      for(const next of neighbours){if(next<0||!binary[next]||visited[next])continue;visited[next]=1;queue[tail++]=next;}
    }
    const keep=component.length>=minimumArea||overlapsPersonBox;
    if(keep)for(const index of component)result[index]=mask[index];
    else{removedComponents++;removedPixels+=component.length;}
  }
  console.info('V8 tiny-island diagnostics',{removedComponents,removedPixels,minimumArea});return result;
}

function refineProfessionalMatte(finePersonMask,combinedMask,panopticPersonMask,width,height){
  const anchored=keepOnlyPersonAnchoredComponent(combinedMask,panopticPersonMask,width,height);
  const retainedGate=dilateBinaryMask(anchored,width,height,Math.max(1,Math.round(Math.max(width,height)*.003)),12);
  for(let i=0;i<anchored.length;i++)if(retainedGate[i])anchored[i]=Math.max(anchored[i],finePersonMask[i]);
  const noIslands=removeTinyEdgeIslands(anchored,panopticPersonMask,width,height);
  const filled=fillSmallInternalHoles(noIslands,width,height);
  const feathered=featherMatte(filled,width,height);
  console.info('V8 matte refinement diagnostics',{width,height,anchor:'panoptic-person-instance'});
  return feathered;
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

  const professionalSmart=refineProfessionalMatte(
    refinedPerson,
    smart,
    selectedPerson.mask,
    width,
    height
  );

  // Person-only mode receives fragment cleanup and subtle feathering while
  // retaining MODNet's fine portrait detail.
  const professionalPerson=refineProfessionalMatte(
    refinedPerson,
    refinedPerson,
    selectedPerson.mask,
    width,
    height
  );

  console.info("V8 panoptic + person-anchored diagnostics",{
    personInstances:personCandidates.length,
    selectedPersonOverlap:selectedPerson.overlap,
    selectedPersonScore:selectedPerson.score,
    keptSupports,
    rejectedSupports,
    totalSegments:segments.length
  });

  return {
    personMask:professionalPerson,
    smartMask:professionalSmart,
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
