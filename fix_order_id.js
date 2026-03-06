const fs = require('fs');

const filePath = 'c:/Users/lenovo/OneDrive/Desktop/zentr/server/index.js';
let content = fs.readFileSync(filePath, 'utf8');

// Fix private handler - add newOrderId variable and update order object
content = content.replace(
  /const total = enrichedItems\.reduce\(\(sum, it\) => sum \+ \(it\.finalUnitPrice \* it\.qty\), 0\);\s*\n\s*const order = \{\s*id: "ord_" \+ Date\(\),/g,
  `const total = enrichedItems.reduce((sum, it) => sum + (it.finalUnitPrice * it.qty), 0);\n\n  const newOrderId = "ord_" + Date.now();\n  const order = {\n    id: newOrderId,`
);

// Fix public handler similarly
content = content.replace(
  /const total = enrichedItems\.reduce\(\(sum, it\) => sum \+ \(it\.finalUnitPrice \* it\.qty\), 0\);\s*\n\s*const order = \{\s*id: "ord_" \+ Date\(\),/g,
  `const total = enrichedItems.reduce((sum, it) => sum + (it.finalUnitPrice * it.qty), 0);\n\n  const newOrderId = "ord_" + Date.now();\n  const order = {\n    id: newOrderId,`
);

fs.writeFileSync(filePath, content);
console.log('Fixed order ID generation in both handlers');
