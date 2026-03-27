

const API = 'http://localhost:5050';

async function runTest() {
  console.log("--- STARTING VERIFICATION ---");
  
  // 1. Create a test store
  console.log("1. Creating test store...");
  const onboardRes = await fetch(`${API}/api/onboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storeName: 'Test Fix Store',
      ownerName: 'QA Tester',
      phone: '9222222222',
      category: 'Electronics'
    })
  });
  const onboardData = await onboardRes.json();
  if (!onboardData.ok) {
    console.error("❌ Onboarding failed:", onboardData.error);
    return;
  }
  const { sellerId, sellerKey } = onboardData;
  console.log(`✅ Store created: ${sellerId}`);

  // 2. Add a product
  console.log("2. Adding test product...");
  const addRes = await fetch(`${API}/api/sellers/${sellerId}/products`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'x-seller-key': sellerKey
    },
    body: JSON.stringify({
      name: 'Test Product',
      price: 100,
      stock: 10,
      category: 'Test',
      images: ['https://example.com/test.jpg']
    })
  });
  const addData = await addRes.json();
  if (!addData.ok) {
    console.error("❌ Add product failed:", addData.error);
    return;
  }
  console.log("✅ Product added.");

  // 3. Verify the new GET endpoint
  console.log("3. Verifying GET /api/sellers/:sellerId/products...");
  const getRes = await fetch(`${API}/api/sellers/${sellerId}/products`, {
    headers: { 'x-seller-key': sellerKey }
  });
  const getData = await getRes.json();
  if (getRes.status === 200 && getData.ok && getData.products.length > 0) {
    console.log(`✅ Success! Found ${getData.products.length} product(s).`);
    console.log("Product Name:", getData.products[0].name);
  } else {
    console.error("❌ GET products failed:", getRes.status, getData);
  }

  // 4. Verify store info update
  console.log("4. Verifying PATCH /api/sellers/:sellerId...");
  const patchRes = await fetch(`${API}/api/sellers/${sellerId}`, {
    method: 'PATCH',
    headers: { 
      'Content-Type': 'application/json',
      'x-seller-key': sellerKey
    },
    body: JSON.stringify({
      storeName: 'Updated Store Name',
      ownerName: 'Updated Owner'
    })
  });
  const patchData = await patchRes.json();
  if (patchRes.status === 200 && patchData.ok) {
    console.log("✅ Store update success!");
    console.log("New Name:", patchData.seller.storeName);
  } else {
    console.error("❌ Store update failed:", patchRes.status, patchData);
  }

  console.log("--- VERIFICATION COMPLETE ---");
}

runTest();
