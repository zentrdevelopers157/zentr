const fs = require('fs');
const path = require('path');
const http = require('http');

const BASE_URL = 'http://localhost:3000';
const SELLER_ID = 'demoSeller';

async function testHealth() {
    return new Promise((resolve) => {
        http.get(`${BASE_URL}/api/health`, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                const json = JSON.parse(data);
                console.log('Health Check:', json.ok ? '✅ OK' : '❌ FAILED');
                resolve(json.ok);
            });
        }).on('error', (err) => {
            console.error('Health Check: ❌ SERVER DOWN', err.message);
            resolve(false);
        });
    });
}

async function testCheckout() {
    const payload = JSON.stringify({
        items: [{ productId: 'P1', qty: 2, variants: [{ caption: 'Size', optionId: '1', label: 'L' }] }],
        buyerName: 'QA Tester',
        buyerPhone: '1234567890',
        buyerAddress: 'QA Lab'
    });

    return new Promise((resolve) => {
        const req = http.request(`${BASE_URL}/api/public/sellers/${SELLER_ID}/checkout`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': payload.length
            }
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                const json = JSON.parse(data);
                console.log('Checkout API:', json.ok && json.orderId ? '✅ OK' : '❌ FAILED', json.error || '');
                resolve(json.ok ? json.orderId : null);
            });
        });
        req.on('error', (err) => {
            console.error('Checkout API: ❌ FAILED', err.message);
            resolve(null);
        });
        req.write(payload);
        req.end();
    });
}

async function run() {
    console.log('--- ZENTR V1 VERIFICATION ---');
    const health = await testHealth();
    if (!health) {
        console.log('Please start the server first: node server/index.js');
        return;
    }

    const orderId = await testCheckout();
    if (orderId) {
        console.log(`Test Order ID: ${orderId}`);
        // Add more tests if needed
    }

    console.log('-----------------------------');
    console.log('VERIFICATION COMPLETE.');
}

run();
