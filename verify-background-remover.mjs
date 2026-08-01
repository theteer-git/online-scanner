const base=process.argv[2]||"https://online-scanner.pages.dev";
const targets=[
  [`${base}/background-remover?v=2.2.0`,["Processed locally · V2.2","app-v2.js?v=2.2.0"]],
  [`${base}/assets/js/background/app-v2.js?v=2.2.0`,["Background Remover V2.2 click-confirmed build loaded","Starting background removal"]]
];

let failed=0;
for(const [url,expected] of targets){
  try{
    const response=await fetch(url,{cache:"no-store"});
    const text=await response.text();
    const missing=expected.filter(item=>!text.includes(item));
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
else console.log("Background Remover V2.2 deployment verified.");
