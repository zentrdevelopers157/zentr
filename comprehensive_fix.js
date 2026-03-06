const fs = require('fs');

const filePath = 'c:/Users/lenovo/OneDrive/Desktop/zentr/server/index.js';
let content = fs.readFileSync(filePath, 'utf8');

// Fix 1: Add newOrderId variable and update order object in private handler
content = content.replace(
  /const total = enrichedItems\.reduce\(\(sum, it\) => sum \+ \(it\.finalUnitPrice \* it\.qty\), 0\);\s*\n\s*const order = \{\s*id: "ord_" \+ Date\(\),/g,
  `const total = enrichedItems.reduce((sum, it) => sum + (it.finalUnitPrice * it.qty), 0);\n\n  const newOrderId = "ord_" + Date.now();\n  const order = {\n    id: newOrderId,`
);

// Fix 2: Same for public handler  
content = content.replace(
  /const total = enrichedItems\.reduce\(\(sum, it\) => sum \+ \(it\.finalUnitPrice \* it\.qty\), 0\);\s*\n\s*const order = \{\s*id: "ord_" \+ Date\(\),/g,
  `const total = enrichedItems.reduce((sum, it) => sum + (it.finalUnitPrice * it.qty), 0);\n\n  const newOrderId = "ord_" + Date.now();\n  const order = {\n    id: newOrderId,`
);

// Fix 3: Update idempotencyKey assignment to use null fallback
content = content.replace(
  /idempotencyKey: idemKey,/g,
  'idempotencyKey: idemKey || null,'
);

fs.writeFileSync(filePath, content);
console.log('Applied comprehensive order structure fixes');
