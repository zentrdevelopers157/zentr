const fetch = require('node-fetch');

async function test() {
  const phone = "9988776655";
  
  console.log("1. Sending OTP...");
  const res1 = await fetch('http://localhost:5050/api/otp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone })
  });
  console.log("Send OTP Status:", res1.status);

  // Wait for the server to log the code
  await new Promise(r => setTimeout(r, 2000));
}
test();
