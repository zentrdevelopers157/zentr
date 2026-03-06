const fs = require('fs');

const filePath = 'c:/Users/lenovo/OneDrive/Desktop/zentr/server/index.js';
let content = fs.readFileSync(filePath, 'utf8');

// Fix the literal \r\n issue in both order creation handlers
content = content.replace(
  /createdAt: new Date\(\)\.toISOString\(\),\\r\\n    idempotencyKey: idemKey,/g,
  `createdAt: new Date().toISOString(),
    idempotencyKey: idemKey,`
);

fs.writeFileSync(filePath, content);
console.log('Fixed idempotencyKey field - replaced literal \\r\\n with actual newline');
