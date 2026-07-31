
import { clamp8, imageDataToGray, integralImageGray, boxMean } from "../utils/image-data.js";

export function normalizeBackground(imageData, options={}){
  const {width,height,data}=imageData;
  const radius = Math.max(12, Math.round(Math.min(width,height) * (options.radiusRatio || 0.045)));
  const strength = options.strength ?? 0.78;
  const target = options.target ?? 238;

  const gray=imageDataToGray(imageData);
  const integral=integralImageGray(gray,width,height);

  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const p=y*width+x, i=p*4;
      const local=boxMean(integral,width,height,x,y,radius);
      const correction=(target-local)*strength;
      data[i]=clamp8(data[i]+correction);
      data[i+1]=clamp8(data[i+1]+correction);
      data[i+2]=clamp8(data[i+2]+correction);
    }
  }
  return imageData;
}

export function whitenPaper(imageData, options={}){
  const {data}=imageData;
  const floor=options.floor ?? 205;
  const strength=options.strength ?? 0.55;
  for(let i=0;i<data.length;i+=4){
    const lum=.299*data[i]+.587*data[i+1]+.114*data[i+2];
    if(lum>floor){
      const t=Math.min(1,(lum-floor)/(255-floor));
      const lift=(255-lum)*t*strength;
      data[i]=clamp8(data[i]+lift);
      data[i+1]=clamp8(data[i+1]+lift);
      data[i+2]=clamp8(data[i+2]+lift);
    }
  }
  return imageData;
}
