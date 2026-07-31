
import { clamp8, imageDataToGray } from "../utils/image-data.js";

export function autoLevels(imageData, lowPct=.01, highPct=.99){
  const gray=imageDataToGray(imageData);
  const hist=new Uint32Array(256);
  for(const value of gray) hist[Math.max(0,Math.min(255,Math.round(value)))]++;
  const total=gray.length, lowTarget=total*lowPct, highTarget=total*highPct;
  let acc=0,low=0,high=255;
  for(let i=0;i<256;i++){acc+=hist[i];if(acc>=lowTarget){low=i;break}}
  acc=0;
  for(let i=255;i>=0;i--){acc+=hist[i];if(acc>=total-highTarget){high=i;break}}
  if(high-low<24) return imageData;
  const scale=255/(high-low), d=imageData.data;
  for(let i=0;i<d.length;i+=4){
    d[i]=clamp8((d[i]-low)*scale);
    d[i+1]=clamp8((d[i+1]-low)*scale);
    d[i+2]=clamp8((d[i+2]-low)*scale);
  }
  return imageData;
}

export function contrast(imageData, amount=0){
  const d=imageData.data;
  const factor=(259*(amount+255))/(255*(259-amount));
  for(let i=0;i<d.length;i+=4){
    d[i]=clamp8(factor*(d[i]-128)+128);
    d[i+1]=clamp8(factor*(d[i+1]-128)+128);
    d[i+2]=clamp8(factor*(d[i+2]-128)+128);
  }
  return imageData;
}

export function saturation(imageData, amount=1){
  const d=imageData.data;
  for(let i=0;i<d.length;i+=4){
    const l=.299*d[i]+.587*d[i+1]+.114*d[i+2];
    d[i]=clamp8(l+(d[i]-l)*amount);
    d[i+1]=clamp8(l+(d[i+1]-l)*amount);
    d[i+2]=clamp8(l+(d[i+2]-l)*amount);
  }
  return imageData;
}

export function medianDenoiseGray(gray,width,height){
  const out=new Float32Array(gray.length);
  const values=new Float32Array(9);
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      let n=0;
      for(let yy=Math.max(0,y-1);yy<=Math.min(height-1,y+1);yy++){
        for(let xx=Math.max(0,x-1);xx<=Math.min(width-1,x+1);xx++){
          values[n++]=gray[yy*width+xx];
        }
      }
      const arr=Array.from(values.slice(0,n)).sort((a,b)=>a-b);
      out[y*width+x]=arr[Math.floor(arr.length/2)];
    }
  }
  return out;
}

export function unsharpMask(imageData, amount=.35){
  const {width,height,data}=imageData;
  const src=new Uint8ClampedArray(data);
  for(let y=1;y<height-1;y++){
    for(let x=1;x<width-1;x++){
      const i=(y*width+x)*4;
      for(let c=0;c<3;c++){
        const blur=(
          src[((y-1)*width+x)*4+c]+src[((y+1)*width+x)*4+c]+
          src[(y*width+x-1)*4+c]+src[(y*width+x+1)*4+c]+
          src[i+c]*4
        )/8;
        data[i+c]=clamp8(src[i+c]+(src[i+c]-blur)*amount);
      }
    }
  }
  return imageData;
}
