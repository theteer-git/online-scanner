const base=process.argv[2]||"https://online-scanner.pages.dev";

const checks=[
  [`${base}/background-remover?v=10.2.0`,[
    "Processed locally · V10.2",
    "app-v2.js?v=10.2.0",
    "targeted chair recovery"
  ]],
  [`${base}/assets/js/background/app-v2.js?v=10.2.0`,[
    "Background Remover V10.2 geometry refinement build loaded",
    "refineV102PersonMask",
    "refineV102SupportMask",
    "V10.2 chair bridge diagnostics",
    "V10.2 floor residue diagnostics",
    "V10.2 support geometry diagnostics"
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
else console.log("Background Remover V10.2 deployment verified.");
