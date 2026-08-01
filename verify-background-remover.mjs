const base=process.argv[2]||"https://online-scanner.pages.dev";
const checks=[
  [`${base}/background-remover?v=5.0.0`,[
    "Processed locally · V5",
    "app-v2.js?v=5.0.0",
    "Person + support",
    "second local AI model"
  ]],
  [`${base}/assets/js/background/app-v2.js?v=5.0.0`,[
    "Background Remover V5 semantic-support build loaded",
    "Xenova/segformer-b0-finetuned-ade-512-512",
    "createSemanticSupportMask",
    "V5 semantic support diagnostics",
    "SUPPORT_LABELS"
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
else console.log("Background Remover V5 deployment verified.");
