const fs = require('fs');

const filePath = 'c:/Users/lenovo/OneDrive/Desktop/zentr/server/index.js';
let content = fs.readFileSync(filePath, 'utf8');

// Update private order creation handler
content = content.replace(
  /const order = \{\s*id: "ord_" \+ Date\(\),/g,
  `const newOrderId = "ord_" + Date.now();\n  const order = {\n    id: newOrderId,`
);

// Update public order creation handler  
content = content.replace(
  /const order = \{\s*id: "ord_" \+ Date\(\),/g,
  `const newOrderId = "ord_" + Date.now();\n  const order = {\n    id: newOrderId,`
);

// Update idempotencyKey assignment to use null fallback
content = content.replace(
  /idempotencyKey: idemKey,/g,
  'idempotencyKey: idemKey || null,'
);

fs.writeFileSync(filePath, content);
console.log('Updated order object structure in both handlers');
