const base = process.argv[2] || "https://online-scanner.pages.dev";

const checks = [
  {
    url: `${base}/background-remover.html?v=2.1.1`,
    expect: ["Build V2.1.1", "app-v2.js?v=2.1.1"]
  },
  {
    url: `${base}/assets/js/background/app-v2.js?v=2.1.1`,
    expect: ['device:"wasm"', "Background Remover V2.1 compatibility build loaded"]
  }
];

let failed = 0;

for (const check of checks) {
  try {
    const response = await fetch(check.url, {
      cache: "no-store",
      redirect: "manual"
    });

    if (response.status >= 300 && response.status < 400) {
      failed++;
      console.error("FAIL redirect detected", check.url, {
        status: response.status,
        location: response.headers.get("location")
      });
      continue;
    }

    const text = await response.text();
    const missing = check.expect.filter(value => !text.includes(value));

    if (!response.ok || missing.length) {
      failed++;
      console.error("FAIL", check.url, {
        status: response.status,
        missing
      });
    } else {
      console.log("PASS", check.url, response.status);
    }
  } catch (error) {
    failed++;
    console.error("FAIL network error", check.url, error.message);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Background Remover V2.1 route and deployment verified.");
}
