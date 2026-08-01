const base=process.argv[2]||"https://online-scanner.pages.dev";

let failed=0;

const pageUrl=`${base}/background-remover?v=10.4.1`;
const scriptUrl=`${base}/assets/js/background/app-v2.js?v=10.4.1`;

const page=await fetch(pageUrl,{cache:"no-store"});
const pageText=await page.text();
const pageExpected=[
  "Processed locally · V10.4.1",
  "app-v2.js?v=10.4.1"
];
const pageMissing=pageExpected.filter(value=>!pageText.includes(value));

if(!page.ok||pageMissing.length){
  failed++;
  console.error("FAIL",pageUrl,{status:page.status,missing:pageMissing});
}else{
  console.log("PASS",pageUrl,page.status);
}

const script=await fetch(scriptUrl,{cache:"no-store"});
const scriptText=await script.text();
const scriptExpected=[
  "Background Remover V10.4.1 blob-script CSP build loaded",
  'dtype:"q8"',
  "V10.4 runtime diagnostics"
];
const scriptMissing=scriptExpected.filter(value=>!scriptText.includes(value));

if(!script.ok||scriptMissing.length){
  failed++;
  console.error("FAIL",scriptUrl,{status:script.status,missing:scriptMissing});
}else{
  console.log("PASS",scriptUrl,script.status);
}

const csp=page.headers.get("content-security-policy")||"";
const requiredCsp=[
  "script-src 'self' blob:",
  "script-src-elem 'self' blob:"
];
const missingCsp=requiredCsp.filter(value=>!csp.includes(value));

if(missingCsp.length){
  failed++;
  console.error("FAIL CSP blob scripts",{missing:missingCsp,csp});
}else{
  console.log("PASS CSP blob scripts");
}

const coop=page.headers.get("cross-origin-opener-policy");
const coep=page.headers.get("cross-origin-embedder-policy");

if(coop!=="same-origin"||!["credentialless","require-corp"].includes(coep)){
  failed++;
  console.error("FAIL isolation headers",{coop,coep});
}else{
  console.log("PASS isolation headers",{coop,coep});
}

if(failed)process.exitCode=1;
else console.log("Background Remover V10.4.1 deployment verified.");
