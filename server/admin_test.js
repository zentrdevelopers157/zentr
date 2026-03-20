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
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function get(url, token) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  console.log("Testing Login...");
  const loginRes = await post('http://localhost:5050/admin/login', { username: 'admin', password: 'admin123' });
  console.log("Login Res:", loginRes.status, loginRes.body);
  
  if (loginRes.body.token) {
    console.log("\nTesting Stats...");
    const statsRes = await get('http://localhost:5050/admin/stats', loginRes.body.token);
    console.log("Stats Res:", statsRes.status, JSON.stringify(statsRes.body, null, 2));
  }
}
run();
