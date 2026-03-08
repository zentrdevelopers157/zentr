const assert = require("assert");

const BASE_URL = "https://zentr.onrender.com";

async function run() {
    console.log("Starting API QA for Zentr Production Hardening...");
    try {
        // 1. Health check
        const health = await fetch(`${BASE_URL}/api/health`).then(r => r.json());
        assert(health.ok, "Health check failed");
        console.log("✅ Health check passed");

        // 2. Onboard new seller
        const phone = "99" + Math.floor(Math.random() * 100000000); // random phone
        const onboardRes = await fetch(`${BASE_URL}/api/onboard`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "QA Store", owner: "QA User", phone, category: "Test" })
        }).then(r => r.json());
        assert(onboardRes.ok && onboardRes.sellerId, "Onboarding failed");
        console.log(`✅ Onboarded new seller: ${onboardRes.sellerId}`);

        // 3. Duplicate prevention check
        const dupRes = await fetch(`${BASE_URL}/api/onboard`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "QA Store 2", owner: "QA User 2", phone, category: "Test" })
        });
        assert(dupRes.status === 409, "Duplicate prevention failed (expected 409)");
        console.log("✅ Duplicate store prevention works (409 returned)");

        // 4. Add product
        const prodRes = await fetch(`${BASE_URL}/api/sellers/${onboardRes.sellerId}/products`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-seller-key": onboardRes.sellerKey
            },
            body: JSON.stringify({ name: "QA API Shirt", price: 500, stock: 10, desc: "Testing" })
        }).then(r => r.json());
        assert(prodRes.ok && prodRes.product.id, "Product creation failed");
        console.log("✅ Product creation passed");

        // 5. Public fetch products
        const pubProdRes = await fetch(`${BASE_URL}/api/public/sellers/${onboardRes.sellerId}/products`).then(r => r.json());
        assert(pubProdRes.ok && pubProdRes.products.length === 1, "Public products fetch failed");
        console.log("✅ Public products fetch passed");

        // 6. Checkout
        const checkoutRes = await fetch(`${BASE_URL}/api/public/sellers/${onboardRes.sellerId}/checkout`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                items: [{ productId: prodRes.product.id, qty: 1 }],
                buyerName: "API Buyer",
                buyerPhone: "1122334455"
            })
        }).then(r => r.json());
        assert(checkoutRes.ok && checkoutRes.orderId, "Checkout failed");
        console.log("✅ Checkout passed");

        console.log("🎉 ALL API E2E TESTS PASSED!");
    } catch (err) {
        console.error("❌ E2E QA FAILED:", err);
        process.exit(1);
    }
}

run();
