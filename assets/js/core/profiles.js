
import { normalizeBackground, whitenPaper } from "./background.js";
import { autoLevels, contrast, saturation, unsharpMask } from "./enhance.js";
import { adaptiveBlackWhite } from "./threshold.js";

export const PROFILE_LABELS={
  original:"Original",
  better:"Better",
  super:"Super",
  simple:"Simple",
  bw:"B & W"
};

export function applyProfile(imageData, profile){
  if(profile==="original") return imageData;

  if(profile==="better"){
    autoLevels(imageData,.008,.992);
    normalizeBackground(imageData,{strength:.45,target:232,radiusRatio:.05});
    whitenPaper(imageData,{floor:210,strength:.42});
    saturation(imageData,1.04);
    contrast(imageData,12);
    unsharpMask(imageData,.24);
    return imageData;
  }

  if(profile==="super"){
    autoLevels(imageData,.006,.994);
    normalizeBackground(imageData,{strength:.82,target:242,radiusRatio:.055});
    whitenPaper(imageData,{floor:190,strength:.72});
    saturation(imageData,.92);
    contrast(imageData,24);
    unsharpMask(imageData,.42);
    return imageData;
  }

  if(profile==="simple"){
    autoLevels(imageData,.01,.99);
    normalizeBackground(imageData,{strength:.68,target:239,radiusRatio:.06});
    whitenPaper(imageData,{floor:198,strength:.62});
    saturation(imageData,.18);
    contrast(imageData,10);
    unsharpMask(imageData,.18);
    return imageData;
  }

  if(profile==="bw"){
    autoLevels(imageData,.006,.994);
    normalizeBackground(imageData,{strength:.9,target:246,radiusRatio:.06});
    adaptiveBlackWhite(imageData,{
      radiusRatio:.022,
      bias:10,
      denoise:true,
      preserveMidtones:true
    });
    contrast(imageData,18);
    unsharpMask(imageData,.22);
    return imageData;
  }

  return imageData;
}
