const base=process.argv[2]||"https://online-scanner.pages.dev";

const checks=[
  [`${base}/background-remover?v=10.4.0`,[
    "Processed locally · V10.4",
    "app-v2.js?v=10.4.0",
    "6.63 MB quantized MODNet"
  ]],
  [`${base}/assets/js/background/app-v2.js?v=10.4.0`,[
    "Background Remover V10.4 quantized multithread build loaded",
    "dtype:\"q8\"",
    "V10.4 runtime diagnostics",
    "V10.4 q8 MODNet alpha diagnostics",
    "MODNet q8 fast"
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

const page=await fetch(`${base}/background-remover?v=10.4.0`,{
  cache:"no-store",
  redirect:"manual"
});

const coop=page.headers.get("cross-origin-opener-policy");
const coep=page.headers.get("cross-origin-embedder-policy");

if(coop!=="same-origin"||!["credentialless","require-corp"].includes(coep)){
  failed++;
  console.error("FAIL isolation headers",{coop,coep});
}else{
  console.log("PASS isolation headers",{coop,coep});
}

if(failed)process.exitCode=1;
else console.log("Background Remover V10.4 deployment verified.");
