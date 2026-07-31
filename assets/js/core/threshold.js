
import { imageDataToGray, integralImageGray, boxMean } from "../utils/image-data.js";
import { medianDenoiseGray } from "./enhance.js";

export function adaptiveBlackWhite(imageData, options={}){
  const {width,height,data}=imageData;
  let gray=imageDataToGray(imageData);
  if(options.denoise !== false) gray=medianDenoiseGray(gray,width,height);

  const integral=integralImageGray(gray,width,height);
  const radius=Math.max(8,Math.round(Math.min(width,height)*(options.radiusRatio||0.018)));
  const bias=options.bias ?? 11;
  const preserveMidtones=options.preserveMidtones ?? true;

  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const p=y*width+x, i=p*4;
      const local=boxMean(integral,width,height,x,y,radius);
      const value=gray[p];
      let out;
      if(preserveMidtones){
        const delta=value-(local-bias);
        if(delta>18) out=255;
        else if(delta<-18) out=0;
        else out=Math.round(((delta+18)/36)*255);
      }else{
        out=value<local-bias?0:255;
      }
      data[i]=data[i+1]=data[i+2]=out;
    }
  }
  return imageData;
}
