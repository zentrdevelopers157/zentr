const fs = require('fs');

// Read the current file
const currentContent = fs.readFileSync('c:/Users/lenovo/OneDrive/Desktop/zentr/server/index.js', 'utf8');

// Find and replace order creation patterns with correct structure
const updatedContent = currentContent
  // Replace private handler order creation
  .replace(
    /const total = enrichedItems\.reduce\(\(sum, it\) => sum \+ \(it\.finalUnitPrice \* it\.qty\), 0\);\s*\n\s*const order = \{\s*id: "ord_" \+ Date\(\),/g,
    `const total = enrichedItems.reduce((sum, it) => sum + (it.finalUnitPrice * it.qty), 0);\n\n  const newOrderId = "ord_" + Date.now();\n  const order = {\n    id: newOrderId,`
  )
  // Replace public handler order creation
  .replace(
    /const total = enrichedItems\.reduce\(\(sum, it\) => sum \+ \(it\.finalUnitPrice \* it\.qty\), 0\);\s*\n\s*const order = \{\s*id: "ord_" \+ Date\(\),/g,
    `const total = enrichedItems.reduce((sum, it) => sum + (it.finalUnitPrice * it.qty), 0);\n\n  const newOrderId = "ord_" + Date.now();\n  const order = {\n    id: newOrderId,`
  )
  // Fix idempotencyKey assignment
  .replace(/idempotencyKey: idemKey,/g, 'idempotencyKey: idemKey || null,');

// Write the updated content back
fs.writeFileSync('c:/Users/lenovo/OneDrive/Desktop/zentr/server/index.js', updatedContent);
console.log('Updated order creation structure in both handlers');
