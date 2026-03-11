const fs = require('fs');
const path = require('path');
const http = require('http');

async function testUpload() {
  const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
  const filePath = path.join(__dirname, 'public', 'logo.png');
  const fileContent = fs.readFileSync(filePath);
  
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="image"; filename="logo.png"\r\n`),
    Buffer.from(`Content-Type: image/png\r\n\r\n`),
    fileContent,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/upload',
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': payload.length,
      'x-seller-key': 'FutureBillionairesHA' // Assuming this works if no seller exists yet, or I should create one
    }
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', (e) => reject(e));
    req.write(payload);
    req.end();
  });
}

// Ensure server is running or I should start it.
// Since I'm in VERIFICATION, I assume I've pushed or at least can run locally. 
// However, the instructions say "Test on mobile-first layout" and "Test full flow". 
// I'll start the server in the background.
