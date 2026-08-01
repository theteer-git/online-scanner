const base=process.argv[2]||"https://online-scanner.pages.dev";

const checks=[
  [`${base}/background-remover?v=10.1.0`,[
    "Processed locally · V10.1",
    "app-v2.js?v=10.1.0",
    "Person-only extraction"
  ]],
  [`${base}/assets/js/background/app-v2.js?v=10.1.0`,[
    "Background Remover V10.1 refinement build loaded",
    "warmupPrimaryModel",
    "keepLargestPersonComponent",
    "V10.1 person-only cleanup diagnostics",
    "support:\"skipped\"",
    "V10.1 MVANet alpha diagnostics"
  ]]
];

let failed=0;

for(const [url,expected] of checks){
  try{
    const response=await fetch(url,{cache:"no-store"});
    const text=await response.text();
    const missing=expected.filter(value=>!text.includes(value));

    if(!response.ok||missing.length){
      failed++;
      console.error("FAIL",url,{status:response.status,missing});
    }else{
      console.log("PASS",url,response.status);
    }
  }catch(error){
    failed++;
    console.error("FAIL",url,error.message);
  }
}

if(failed)process.exitCode=1;
else console.log("Background Remover V10.1 deployment verified.");
