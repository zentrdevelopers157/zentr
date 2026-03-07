const fs = require('fs');

const filePath = 'c:/Users/lenovo/OneDrive/Desktop/zentr/server/index.js';
let content = fs.readFileSync(filePath, 'utf8');

// Fix the literal \n issue in both order creation handlers
content = content.replace(
  /createdAt: new Date\(\)\.toISOString\(\),\\n    idempotencyKey: idemKey,/g,
  'createdAt: new Date().toISOString(),\n    idempotencyKey: idemKey,'
);

fs.writeFileSync(filePath, content);
console.log('Fixed idempotencyKey field');
