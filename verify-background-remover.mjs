const base=process.argv[2]||"https://online-scanner.pages.dev";
const checks=[
  [`${base}/background-remover?v=4.0.0`,[
    "Processed locally · V4",
    "app-v2.js?v=4.0.0",
    "Smart subject"
  ]],
  [`${base}/assets/js/background/app-v2.js?v=4.0.0`,[
    "Background Remover V4 smart-subject build loaded",
    "createSmartSubjectMask",
    "Smart subject diagnostics",
    "data-subject-mode"
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
else console.log("Background Remover V4 deployment verified.");
