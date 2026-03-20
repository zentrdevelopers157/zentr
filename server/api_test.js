const http = require('http');

async function post(url, data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': postData.length
      }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function verify() {
  try {
    console.log("Testing /api/otp/send...");
    const r1 = await post('http://localhost:5050/api/otp/send', { phone: '9988776655' });
    console.log("OTP Send Status:", r1.status, r1.body);

    console.log("\nTesting /api/onboard...");
    const r2 = await post('http://localhost:5050/api/onboard', { 
      storeName: 'Final Verified Store', 
      ownerName: 'Owner X', 
      phone: '9988776655', 
      otp: '111111',
      category: 'Electronics'
    });
    console.log("Onboard Status:", r2.status, r2.body);
  } catch (e) {
    console.error("Test failed:", e.message);
  }
}

verify();
