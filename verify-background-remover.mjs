const base=process.argv[2]||"https://online-scanner.pages.dev";

const checks=[
  [`${base}/background-remover?v=9.0.0`,[
    "Processed locally · V9",
    "app-v2.js?v=9.0.0",
    "BiRefNet Portrait"
  ]],
  [`${base}/assets/js/background/app-v2.js?v=9.0.0`,[
    "Background Remover V9 BiRefNet professional build loaded",
    "onnx-community/BiRefNet-portrait-ONNX",
    "buildProfessionalOrFallbackMask",
    "V9 BiRefNet alpha diagnostics",
    "device:\"webgpu\"",
    "dtype:\"fp16\""
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
else console.log("Background Remover V9 deployment verified.");
