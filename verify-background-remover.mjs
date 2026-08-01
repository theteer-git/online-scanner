const base=process.argv[2]||"https://online-scanner.pages.dev";
const checks=[
  [`${base}/background-remover?v=7.0.0`,[
    "Processed locally · V7",
    "app-v2.js?v=7.0.0",
    "professional matte cleanup"
  ]],
  [`${base}/assets/js/background/app-v2.js?v=7.0.0`,[
    "Background Remover V7 matte-refinement build loaded",
    "refineProfessionalMatte",
    "componentFilterAnchoredToPerson",
    "fillSmallInternalHoles",
    "V7 matte refinement diagnostics"
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
  }else{
    console.log("PASS",url,response.status);
  }
}
if(failed)process.exitCode=1;
else console.log("Background Remover V7 deployment verified.");
