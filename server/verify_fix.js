const fetch = require('node-fetch');

const API = 'http://localhost:3000';
const SELLER_ID = 'test_seller_id'; // Replace with a real one if needed, or I'll create one
const SELLER_KEY = 'test_seller_key';

async function test() {
  console.log("Testing GET /api/sellers/:sellerId/products...");
  try {
    const res = await fetch(`${API}/api/sellers/${SELLER_ID}/products`, {
      headers: { 'x-seller-key': SELLER_KEY }
    });
    const data = await res.json();
    console.log("Status:", res.status);
    console.log("Data:", JSON.stringify(data, null, 2));
    
    if (res.status === 200 && data.ok) {
      console.log("✅ Success!");
    } else {
      console.log("❌ Failed!");
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
}

// Note: I need the server running to test this.
// I'll check if I can start the server in the background.
// But first, I'll just check the code logic and maybe use a mock test if needed.
// Actually, I can use run_command to start the server.
