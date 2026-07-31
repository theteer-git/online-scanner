
export function clamp8(value){
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

export function luminance(r,g,b){
  return 0.299*r + 0.587*g + 0.114*b;
}

export function copyImageData(imageData){
  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
}

export function integralImageGray(gray,width,height){
  const stride = width + 1;
  const integral = new Float64Array((width + 1) * (height + 1));
  for(let y=1;y<=height;y++){
    let rowSum = 0;
    for(let x=1;x<=width;x++){
      rowSum += gray[(y-1)*width+(x-1)];
      integral[y*stride+x] = integral[(y-1)*stride+x] + rowSum;
    }
  }
  return integral;
}

export function boxMean(integral,width,height,x,y,radius){
  const stride=width+1;
  const x1=Math.max(0,x-radius), y1=Math.max(0,y-radius);
  const x2=Math.min(width-1,x+radius), y2=Math.min(height-1,y+radius);
  const A=integral[y1*stride+x1];
  const B=integral[y1*stride+(x2+1)];
  const C=integral[(y2+1)*stride+x1];
  const D=integral[(y2+1)*stride+(x2+1)];
  return (D-B-C+A)/((x2-x1+1)*(y2-y1+1));
}

export function imageDataToGray(imageData){
  const {data,width,height}=imageData;
  const gray=new Float32Array(width*height);
  for(let i=0,p=0;i<data.length;i+=4,p++){
    gray[p]=luminance(data[i],data[i+1],data[i+2]);
  }
  return gray;
}
