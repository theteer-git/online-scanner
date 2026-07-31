
import { applyProfile } from "./profiles.js";
import { contrast as applyContrast, unsharpMask } from "./enhance.js";
import { clamp8 } from "../utils/image-data.js";

export function processCanvas(sourceCanvas, settings={}){
  const out=document.createElement("canvas");
  out.width=sourceCanvas.width;
  out.height=sourceCanvas.height;
  const ctx=out.getContext("2d",{willReadFrequently:true});
  ctx.drawImage(sourceCanvas,0,0);

  const image=ctx.getImageData(0,0,out.width,out.height);
  applyProfile(image,settings.effect||"original");

  const brightness=Number(settings.brightness||0);
  if(brightness){
    for(let i=0;i<image.data.length;i+=4){
      image.data[i]=clamp8(image.data[i]+brightness);
      image.data[i+1]=clamp8(image.data[i+1]+brightness);
      image.data[i+2]=clamp8(image.data[i+2]+brightness);
    }
  }

  const contrast=Number(settings.contrast||0);
  if(contrast) applyContrast(image,contrast);

  ctx.putImageData(image,0,0);

  const sharpness=Number(settings.sharpness||0);
  if(sharpness>0){
    const sharpened=ctx.getImageData(0,0,out.width,out.height);
    unsharpMask(sharpened,Math.min(.75,sharpness*.18));
    ctx.putImageData(sharpened,0,0);
  }

  return out;
}
