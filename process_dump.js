const fs = require('fs');
const dump = JSON.parse(fs.readFileSync('detailed_usage_dump.json', 'utf8'));

const sellers = dump.sellers || {};
const products = Array.isArray(dump.products) ? dump.products : Object.values(dump.products || {});
const rawOrders = dump.orders || {};
const orders = [];
Object.entries(rawOrders).forEach(([sid, ords]) => {
    (Array.isArray(ords) ? ords : []).forEach(o => orders.push({ ...o, sellerId: o.sellerId || sid }));
});

let report = '# 🚀 Zentr Platform usage Audit Report\n\n';
report += `*Audit Period: Launch to ${new Date().toLocaleDateString()}*\n\n`;

report += '## 📈 Executive Summary\n\n';
report += '| Metric | Value |\n';
report += '| :--- | :--- |\n';
report += `| **Active Stores** | ${Object.keys(sellers).length} |\n`;
report += `| **Total Products** | ${products.length} |\n`;
report += `| **Total Orders** | ${orders.length} |\n`;
const totalRev = orders.filter(o => o.paymentStatus === 'paid').reduce((sum, o) => sum + (o.total || 0), 0);
report += `| **Gross Revenue** | ₹${totalRev.toLocaleString()} |\n`;
report += `| **Avg. Ticket Size** | ₹${orders.length > 0 ? Math.round(totalRev / orders.length).toLocaleString() : 0} |\n\n`;

report += '## 🏪 Store & Owner Directory\n\n';
report += '| Store Name | ID | Owner | Mobile | Category | Joined |\n';
report += '| :--- | :--- | :--- | :--- | :--- | :--- |\n';

Object.values(sellers).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).forEach(s => {
    const date = s.createdAt ? new Date(s.createdAt).toLocaleDateString() : 'N/A';
    report += `| **${s.storeName || 'Unnamed'}** | \`${s.sellerId}\` | ${s.ownerName || 'Unknown'} | \`${s.phone || 'N/A'}\` | ${s.category || 'General'} | ${date} |\n`;
});

report += '\n## 📦 Complete Order Ledger\n\n';
report += '| ID | Buyer Name | Store | Contact | Amount | Items | Status | Date |\n';
report += '| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n';

orders.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0)).forEach(o => {
    const s = sellers[o.sellerId] || { storeName: 'Unknown' };
    const date = o.timestamp ? new Date(o.timestamp).toLocaleDateString() : 'N/A';
    const shortId = (o.id && typeof o.id === 'string') ? o.id.split('_').pop() : 'N/A';
    report += `| \`${shortId}\` | ${o.buyerName || 'N/A'} | ${s.storeName} | \`${o.buyerPhone || 'N/A'}\` | ₹${o.total || 0} | ${o.itemsCount || 0} | ${o.paymentStatus.toUpperCase()} | ${date} |\n`;
});

report += '\n## 🛒 Product Catalog (By Store)\n\n';
Object.values(sellers).forEach(s => {
    const sProds = products.filter(p => p.sellerId === s.sellerId);
    if (sProds.length === 0) return;
    report += `### ${s.storeName} (\`${s.sellerId}\`)\n`;
    report += '| Product Name | Price | Stock | Category |\n';
    report += '| :--- | :--- | :--- | :--- |\n';
    sProds.forEach(p => {
        report += `| ${p.name} | ₹${p.price} | ${p.stock} | ${p.category} |\n`;
    });
    report += '\n';
});

fs.writeFileSync('usage_report.md', report);
console.log('Final detailed report generated.');
