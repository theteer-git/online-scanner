const base=process.argv[2]||"https://online-scanner.pages.dev";
const checks=[
  [`${base}/background-remover?v=6.0.0`,[
    "Processed locally · V6",
    "app-v2.js?v=6.0.0",
    "panoptic instance segmentation"
  ]],
  [`${base}/assets/js/background/app-v2.js?v=6.0.0`,[
    "Background Remover V6 panoptic-instance build loaded",
    "Xenova/detr-resnet-50-panoptic",
    "createPanopticSubjectMasks",
    "V6 panoptic diagnostics",
    "constrainFinePersonMask"
  ]]
];
let failed=0;
for(const [url,expected] of checks){
  const response=await fetch(url,{cache:"no-store"});
  const text=await response.text();
  const missing=expected.filter(value=>!text.includes(value));
  if(!response.ok||missing.length){
    failed++;
    console.error("FAIL",url,{status:response.status,missing});
  }else console.log("PASS",url,response.status);
}
if(failed)process.exitCode=1;
else console.log("Background Remover V6 deployment verified.");
