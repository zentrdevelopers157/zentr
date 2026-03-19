const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function createProduct() {
  const sellerId = 's_cu3cvpzb'; // from previous state
  const sellerKey = 'b38cc367a87710bebc7e30d1aa5cf6eb69b8205f0a0d9b4b036573c7ed6bd7cc'; // Wait, let's login or just read sellers.json locally? No, I need the key.
  // Wait, I can just create a test seller and then test it.
}
createProduct();
