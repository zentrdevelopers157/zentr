const fs = require('fs');

const filePath = 'c:/Users/lenovo/OneDrive/Desktop/zentr/server/index.js';
let content = fs.readFileSync(filePath, 'utf8');

// Simple string replacements
content = content.replace(
  'id: "ord_" + Date.now(),',
  'id: newOrderId,'
);

content = content.replace(
  'const total = enrichedItems.reduce((sum, it) => sum + (it.finalUnitPrice * it.qty), 0);',
  'const total = enrichedItems.reduce((sum, it) => sum + (it.finalUnitPrice * it.qty), 0);\n  const newOrderId = "ord_" + Date.now();'
);

content = content.replace(
  'idempotencyKey: idemKey,',
  'idempotencyKey: idemKey || null,'
);

fs.writeFileSync(filePath, content);
console.log('Applied final order structure fixes');
