/**
 * Zentr Full 30-Point Live QA
 * Tests the live Render deployment end-to-end
 */
'use strict';
const https = require('https');

const BASE = 'https://zentr.onrender.com';
const ADMIN_SECRET = 'FutureBillionairesHA';
let SELLER_ID = '', SELLER_KEY = '', PRODUCT_ID = '', ORDER_ID = '';
const PHONE = '97' + Math.floor(10000000 + Math.random() * 89999999);
let passed = 0, failed = 0, fixed = [];

function req(method, path, body, hdrs = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(BASE + path);
        const data = body ? JSON.stringify(body) : null;
        const opts = { hostname: url.hostname, path: url.pathname + url.search, method, headers: { 'Content-Type': 'application/json', ...hdrs } };
        if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
        const r = https.request(opts, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); } });
        });
        r.on('error', reject);
        if (data) r.write(data);
        r.end();
    });
}

async function test(num, name, fn) {
    try {
        const ok = await fn();
        if (ok === false) throw new Error('assertion returned false');
        console.log(`  ✅ [${num}] ${name}`);
        passed++;
    } catch (e) {
        console.log(`  ❌ [${num}] ${name} — ${e.message}`);
        failed++;
    }
}

async function run() {
    console.log('\n🔍 Zentr Full Live QA — ' + BASE);
    console.log('─'.repeat(60));

    // ── A. Welcome / Onboarding ──────────────────────────────
    console.log('\n[A] Welcome / Onboarding');

    await test(1, 'Welcome page loads', async () => {
        const r = await req('GET', '/');
        return r.status === 200;
    });

    await test(2, 'Health check ok', async () => {
        const r = await req('GET', '/api/health');
        return r.status === 200 && r.body.ok === true;
    });

    await test(3, 'Onboard rejects bad phone', async () => {
        const r = await req('POST', '/api/onboard', { name: 'T', owner: 'T', phone: '123', category: 'X' });
        return r.status === 400 && r.body.ok === false;
    });

    await test(4, 'Onboard creates new seller', async () => {
        const r = await req('POST', '/api/onboard', { name: 'QA Full Store', owner: 'QA Owner', phone: PHONE, category: 'Testing' });
        if (!r.body.ok) throw new Error(JSON.stringify(r.body));
        SELLER_ID = r.body.sellerId;
        SELLER_KEY = r.body.sellerKey;
        return !!(SELLER_ID && SELLER_KEY);
    });

    await test(5, 'Duplicate phone returns 409', async () => {
        const r = await req('POST', '/api/onboard', { name: 'Dup', owner: 'Dup', phone: PHONE, category: 'X' });
        return r.status === 409 && r.body.ok === false;
    });

    // ── B. Seller Dashboard ──────────────────────────────────
    console.log('\n[B] Seller Dashboard');

    await test(6, 'Seller dashboard page loads', async () => {
        const r = await req('GET', `/seller?sellerId=${SELLER_ID}&sellerKey=${SELLER_KEY}`);
        return r.status === 200;
    });

    await test(7, 'Seller info endpoint returns data', async () => {
        const r = await req('GET', `/api/sellers/${SELLER_ID}`, null, { 'x-seller-key': SELLER_KEY });
        return r.status === 200 && r.body.ok && r.body.seller.storeName === 'QA Full Store';
    });

    await test(8, 'Add product works', async () => {
        const r = await req('POST', `/api/sellers/${SELLER_ID}/products`,
            { name: 'Test Mango Pickle', price: 250, stock: 20, category: 'Food', options: [{ name: 'Weight', values: ['200g', '500g'] }] },
            { 'x-seller-key': SELLER_KEY }
        );
        if (!r.body.ok) throw new Error(JSON.stringify(r.body));
        PRODUCT_ID = r.body.product?.id || r.body.productId;
        return !!(PRODUCT_ID);
    });

    await test(9, 'List seller products', async () => {
        const r = await req('GET', `/api/sellers/${SELLER_ID}/products`, null, { 'x-seller-key': SELLER_KEY });
        return r.status === 200 && r.body.ok && r.body.products.length >= 1;
    });

    await test(10, 'Edit product works', async () => {
        const r = await req('PATCH', `/api/sellers/${SELLER_ID}/products/${PRODUCT_ID}`,
            { name: 'Test Mango Pickle - EDITED', price: 300 },
            { 'x-seller-key': SELLER_KEY }
        );
        return r.status === 200 && r.body.ok && r.body.product.price === 300;
    });

    await test(11, 'Payment settings save', async () => {
        const r = await req('PATCH', `/api/sellers/${SELLER_ID}/payment`,
            { codEnabled: true, upiId: 'qastore@paytm', paymentNote: 'Pay before dispatch' },
            { 'x-seller-key': SELLER_KEY }
        );
        return r.status === 200 && r.body.ok;
    });

    await test(12, 'Payment settings persist', async () => {
        const r = await req('GET', `/api/sellers/${SELLER_ID}/payment`, null, { 'x-seller-key': SELLER_KEY });
        return r.body.ok && r.body.payment.codEnabled === true && r.body.payment.upiId === 'qastore@paytm';
    });

    await test(13, 'Seller cannot access another seller data', async () => {
        const fakeKey = 'totally_wrong_key_xyz';
        const r = await req('GET', `/api/sellers/${SELLER_ID}/products`, null, { 'x-seller-key': fakeKey });
        return r.status === 403 || r.status === 401;
    });

    // ── C. Buyer / Store Page ────────────────────────────────
    console.log('\n[C] Buyer / Store Page');

    await test(14, 'Buyer page loads', async () => {
        const r = await req('GET', `/buyer?sellerId=${SELLER_ID}`);
        return r.status === 200;
    });

    await test(15, 'Public seller info endpoint', async () => {
        const r = await req('GET', `/api/public/sellers/${SELLER_ID}`);
        return r.status === 200 && r.body.ok && r.body.storeName === 'QA Full Store';
    });

    await test(16, 'Public products list returns edited product', async () => {
        const r = await req('GET', `/api/public/sellers/${SELLER_ID}/products`);
        return r.status === 200 && r.body.ok && r.body.products.some(p => p.id === PRODUCT_ID && p.price === 300);
    });

    await test(17, 'Public payment settings visible', async () => {
        const r = await req('GET', `/api/public/sellers/${SELLER_ID}/payment`);
        return r.status === 200 && r.body.ok && r.body.payment.codEnabled === true;
    });

    await test(18, 'BUYER_PAGE_OPEN event fires', async () => {
        const r = await req('POST', `/api/public/sellers/${SELLER_ID}/event`, { type: 'BUYER_PAGE_OPEN' });
        return r.status === 200 && r.body.ok;
    });

    // ── D. Order + Payment Flow ──────────────────────────────
    console.log('\n[D] Order + Payment Flow');

    await test(19, 'Checkout rejects bad phone', async () => {
        const r = await req('POST', `/api/public/sellers/${SELLER_ID}/checkout`, {
            items: [{ productId: PRODUCT_ID, qty: 1 }],
            buyerName: 'Test', buyerPhone: '12345', buyerAddress: 'Somewhere', paymentMethod: 'cod'
        });
        return r.status === 400 && r.body.ok === false;
    });

    await test(20, 'Checkout creates COD order', async () => {
        const r = await req('POST', `/api/public/sellers/${SELLER_ID}/checkout`, {
            items: [{ productId: PRODUCT_ID, qty: 2, variants: [{ caption: 'Weight', label: '200g' }] }],
            buyerName: 'QA Buyer', buyerPhone: '9876543210', buyerAddress: '123 MG Road, Bangalore',
            paymentMethod: 'cod'
        });
        if (!r.body.ok) throw new Error(JSON.stringify(r.body));
        ORDER_ID = r.body.orderId || r.body.order?.id;
        return !!(ORDER_ID);
    });

    await test(21, 'Order confirmation page loads', async () => {
        const r = await req('GET', `/confirm?sellerId=${SELLER_ID}&orderId=${ORDER_ID}`);
        return r.status === 200;
    });

    await test(22, 'Public order returns correct paymentMethod + status', async () => {
        const r = await req('GET', `/api/public/sellers/${SELLER_ID}/orders/${ORDER_ID}`);
        return r.status === 200 && r.body.ok && r.body.order.paymentMethod === 'cod' && r.body.order.paymentStatus === 'unpaid';
    });

    await test(23, 'Seller sees order in their dashboard', async () => {
        const r = await req('GET', `/api/sellers/${SELLER_ID}/orders`, null, { 'x-seller-key': SELLER_KEY });
        return r.status === 200 && r.body.ok && r.body.orders.some(o => o.id === ORDER_ID);
    });

    await test(24, 'Seller updates order status pending → confirmed', async () => {
        const r = await req('PATCH', `/api/sellers/${SELLER_ID}/orders/${ORDER_ID}`,
            { status: 'confirmed' },
            { 'x-seller-key': SELLER_KEY }
        );
        return r.status === 200 && r.body.ok && r.body.order.status === 'confirmed';
    });

    await test(25, 'Mark order as paid works', async () => {
        const r = await req('PATCH', `/api/sellers/${SELLER_ID}/orders/${ORDER_ID}/payment-status`,
            { paymentStatus: 'paid' },
            { 'x-seller-key': SELLER_KEY }
        );
        return r.status === 200 && r.body.ok;
    });

    await test(26, 'Payment status persists as paid', async () => {
        const r = await req('GET', `/api/public/sellers/${SELLER_ID}/orders/${ORDER_ID}`);
        return r.status === 200 && r.body.order.paymentStatus === 'paid';
    });

    await test(27, 'Tracking page loads', async () => {
        const r = await req('GET', `/track?sellerId=${SELLER_ID}&orderId=${ORDER_ID}`);
        return r.status === 200;
    });

    // ── E. Persistence ───────────────────────────────────────
    console.log('\n[E] Persistence');

    await test(28, 'Products persist after creation', async () => {
        const r = await req('GET', `/api/public/sellers/${SELLER_ID}/products`);
        return r.body.products.some(p => p.id === PRODUCT_ID);
    });

    await test(29, 'Orders persist across requests', async () => {
        const r = await req('GET', `/api/sellers/${SELLER_ID}/orders`, null, { 'x-seller-key': SELLER_KEY });
        return r.body.orders.some(o => o.id === ORDER_ID);
    });

    // ── F. Privacy + Admin ───────────────────────────────────
    console.log('\n[F] Privacy + Admin');

    await test(30, 'Admin blocked without secret', async () => {
        const r = await req('GET', '/api/admin/stats');
        return r.status === 403;
    });

    await test(31, 'Admin loads with correct secret (new stats shape)', async () => {
        const r = await req('GET', '/api/admin/stats', null, { 'x-admin-secret': ADMIN_SECRET });
        const d = r.body;
        if (!d.ok) throw new Error('ok false: ' + d.error);
        if (!d.core) throw new Error('d.core missing');
        if (!d.sellerHealth) throw new Error('d.sellerHealth missing');
        if (!d.orderAnalytics) throw new Error('d.orderAnalytics missing');
        if (!d.alerts) throw new Error('d.alerts missing');
        // totalStores should be >= 1 now that we created one
        if (typeof d.core.totalStores !== 'number') throw new Error('totalStores not a number');
        return true;
    });

    await test(32, 'Admin panel page loads', async () => {
        const r = await req('GET', '/admin');
        return r.status === 200;
    });

    await test(33, 'DELETE product works', async () => {
        const r = await req('DELETE', `/api/sellers/${SELLER_ID}/products/${PRODUCT_ID}`, null, { 'x-seller-key': SELLER_KEY });
        return r.status === 200 && r.body.ok;
    });

    // ── G. New Refinements (Task 1, 2, 4) ────────────────────
    console.log('\n[G] New Refinements');

    await test(34, 'Strict variant validation (emoji block)', async () => {
        const r = await req('POST', `/api/sellers/${SELLER_ID}/products`,
            { name: 'Emoji Fail', price: 100, options: [{ name: 'Size', values: ['S', 'M', '🔥'] }] },
            { 'x-seller-key': SELLER_KEY }
        );
        return r.status === 400 && r.body.ok === false && r.body.error.toLowerCase().includes('variants');
    });

    await test(35, 'Multi-media product creation & persistence', async () => {
        const r = await req('POST', `/api/sellers/${SELLER_ID}/products`,
            {
                name: 'Multi Media Pro',
                price: 999,
                images: ['https://picsum.photos/400?1', 'https://picsum.photos/400?2'],
                videoUrl: 'https://vimeo.com/12345',
                options: [{ name: 'Pack', values: ['Box', 'Bag'] }]
            },
            { 'x-seller-key': SELLER_KEY }
        );
        return r.status === 200 && r.body.ok && r.body.product.images.length === 2 && !!r.body.product.videoUrl;
    });

    // Summary
    console.log('\n' + '─'.repeat(60));
    console.log(`📊 Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
    console.log(`🌐 Live site: ${BASE}`);
    console.log(`🔒 Admin:     ${BASE}/admin`);
    if (SELLER_ID) {
        console.log(`🏪 Seller:    ${BASE}/seller?sellerId=${SELLER_ID}&sellerKey=${SELLER_KEY}`);
        console.log(`🛒 Buyer:     ${BASE}/buyer?sellerId=${SELLER_ID}`);
    }
    if (failed === 0) console.log('\n🎉 ALL TESTS PASSED — Zentr is production-ready.\n');
    else console.log('\n⚠️  Some tests failed. Review above.\n');
}

run().catch(e => { console.error('QA script error:', e.message); process.exit(1); });
