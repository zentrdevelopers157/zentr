const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require( 'path' );
const crypto = require("crypto");

const RECEIPT_SECRET = process.env.RECEIPT_SECRET || "dev_only_change_me";
if (RECEIPT_SECRET === "dev_only_change_me") {
  console.warn("⚠️ RECEIPT_SECRET is using a dev default. Set an env var for real use.");
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// -------------------- STATIC HTML ROUTES --------------------
function resolvePublicFile(...names) {
  for (const n of names) {
    const p = path.join(__dirname, 'public', n);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

app.get('/buyer', (req, res) => {
  const file = resolvePublicFile('buyer.html', 'buyer.html.html');
  if (!file) return res.status(404).send('buyer page not found');
  res.sendFile(file);
});

app.get('/seller', (req, res) => {
  const file = resolvePublicFile('seller.html', 'seller.html.html');
  if (!file) return res.status(404).send('seller page not found');
  res.sendFile(file);
});

// -------------------- DATA STORAGE --------------------
const DATA_DIR = path.join(__dirname, "..", "data");
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

function ensureFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PRODUCTS_FILE)) fs.writeFileSync(PRODUCTS_FILE, JSON.stringify([], null, 2));
  if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, JSON.stringify({}, null, 2));
}

function readJson(file, fallback = null) {
  ensureFiles();
  const raw = fs.readFileSync(file, "utf8");
  return raw ? JSON.parse(raw) : fallback;
}

function writeJson(file, data) {
  ensureFiles();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function normalizeOrderFingerprint(items, paymentStatus) {
  const sorted = [...items].map(i => ({
    productId: String(i.productId || ""),
    qty: Number(i.qty || 0),
    size: String(i.size || ""),
    variant: String(i.variant || "")
  }))
  .sort((a,b) =>
    (a.productId+a.size+a.variant).localeCompare(b.productId+b.size+b.variant)
  );

  return JSON.stringify({ items: sorted, paymentStatus: String(paymentStatus || "") });
}

function getIdempotencyKey(req) {
  return req.header("x-idempotency-key") || "";
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

// -------------------- SELLER AUTH (PRIVATE) --------------------
const SELLER_KEYS = {
  demoSeller: "demo123",
  urbanWear: "urban456",
  // add more sellers here later
};

function requireSellerKey(req, res, next) {
  const { sellerId } = req.params;
  const key = req.header("x-seller-key");

  if (!SELLER_KEYS[sellerId]) {
    return res.status(404).json({ ok: false, error: "seller not found" });
  }
  if (!key || key !== SELLER_KEYS[sellerId]) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
}

// -------------------- BASIC --------------------
app.get("/", (req, res) => {
  res.send("Zentr Multi-Seller API Running 🚀");
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// ===== ORDERS (PRIVATE) =====

function readOrders() {
  try {
    const raw = fs.readFileSync(ORDERS_FILE, "utf8");
    const parsed = raw ? JSON.parse(raw) : {};
    // if file accidentally has [] then reset to {}
    return (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    return {}; // { [sellerId]: [orders...] }
  }
}

function writeOrders(data) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(data, null, 2));
}

function readProducts() {
  return readJson(PRODUCTS_FILE, []);
}

function writeProducts(data) {
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(data, null, 2));
}

function signReceipt(receipt) {
  const receiptPayload = JSON.stringify({
    receiptId: receipt.receiptId,
    sellerId: receipt.sellerId,
    issuedAt: receipt.issuedAt,
    order: receipt.order
  });

  return crypto
    .createHmac("sha256", RECEIPT_SECRET)
    .update(receiptPayload)
    .digest("hex");
}

// Create order (PRIVATE)
app.post("/api/sellers/:sellerId/orders", requireSellerKey, (req, res) => {
  const { sellerId } = req.params;
  const { items, paymentStatus } = req.body || {};

  const idemKey = getIdempotencyKey(req);
  const orders = readOrders();
  if (idemKey) {
    const existing = orders[sellerId]?.find(o => o.idempotencyKey === idemKey);
    if (existing) {
      return res.json({ ok: true, order: existing, idempotent: true });
    }
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, error: "items required" });
  }

  const products = readJson(PRODUCTS_FILE);

  let computedTotal = 0;

  for (const item of items) {
    const product = products.find(p => p.id === item.productId);

    if (!product) {
      return res.status(400).json({ ok: false, error: "invalid productId" });
    }

    if (!item.qty || item.qty <= 0) {
      return res.status(400).json({ ok: false, error: "invalid qty" });
    }

    // Validate variant if exists
    if (product.variants && product.variants.length > 0) {
      let validVariant = false;

      for (const variantGroup of product.variants) {
        for (const option of variantGroup.options || []) {
          if (option.label === item.variant) {
            validVariant = true;
            break;
          }
        }
      }

      if (!validVariant) {
        return res.status(400).json({ ok: false, error: "invalid variant" });
      }
    }

    // Validate size if exists
    if (product.sizes && product.sizes.length > 0) {
      if (!product.sizes.includes(item.size)) {
        return res.status(400).json({ ok: false, error: "invalid size" });
      }
    }

    let price = product.price;

    if (product.variants && product.variants.length > 0) {
      for (const variantGroup of product.variants) {
        for (const option of variantGroup.options || []) {
          if (option.label === item.variant) {
            price += option.add || 0;
          }
        }
      }
    }

    computedTotal += price * item.qty;
  }

  // 1) Validate stock before placing order
  const byId = new Map(products.map(p => [p.id, p]));

  for (const it of items) {
    const p = byId.get(it.productId);
    if (!p) return res.status(400).json({ ok:false, error:`Product not found: ${it.productId}` });

    const qty = Number(it.qty || 0);
    if (qty <= 0) return res.status(400).json({ ok:false, error:`Invalid qty for ${it.productId}` });

    const stock = Number(p.stock ?? 0);
    if (stock < qty) {
      return res.status(400).json({ ok:false, error:`Out of stock: ${p.name}. Available=${stock}, requested=${qty}` });
    }
  }

  // 2) Decrement stock
  for (const it of items) {
    const p = byId.get(it.productId);
    p.stock = Number(p.stock ?? 0) - Number(it.qty);
  }

  // 3) Persist products immediately
  writeJson(PRODUCTS_FILE, products);

  // Transform items to include finalUnitPrice
  const enrichedItems = items.map((it) => {
    const p = products.find(x => x.id === it.productId && x.sellerId === sellerId);
    if (!p) throw new Error(`invalid productId`);

    // (optional) validate size/variant exists using your p.variants structure

    const unitPrice = Number(p.price) || 0;

    // If you have variant add-on logic, compute it here.
    // For now, assuming your variant add is 0:
    const addOn = 0;

    const finalUnitPrice = unitPrice + addOn;

    return {
      productId: p.id,
      name: p.name,                // snapshot
      unitPrice,                   // snapshot
      finalUnitPrice,              // snapshot
      qty: Number(it.qty) || 1,
      size: it.size || null,
      variant: it.variant || null,
      addOn                        // snapshot (optional but useful)
    };
  });

  const total = enrichedItems.reduce((sum, it) => sum + (it.finalUnitPrice * it.qty), 0);

  const order = {
    id: "ord_" + Date.now(),
    sellerId,
    items: enrichedItems,
    total,
    paymentStatus: paymentStatus || "unpaid",
    status: "pending",
    history: [
      {
        status: "pending",
        at: new Date().toISOString()
      }
    ],
    createdAt: new Date().toISOString(),
    idempotencyKey: idemKey || null,
  };

  const receiptBase = `${order.id}|${order.total}|${order.createdAt}`;
  order.receiptHash = crypto
    .createHash("sha256")
    .update(receiptBase)
    .digest("hex");


  const receiptPayload = JSON.stringify({
    orderId: order.id,
    sellerId: order.sellerId,
    createdAt: order.createdAt,
    total: order.total,
    items: (order.items || []).map(i => ({
      productId: i.productId,
      qty: i.qty,
      size: i.size || null,
      variant: i.variant || null
    }))
  });

  order.receiptSig = crypto
    .createHmac("sha256", RECEIPT_SECRET)
    .update(receiptPayload)
    .digest("hex");
  orders[sellerId] = orders[sellerId] || [];
  orders[sellerId].unshift(order);
  writeOrders(orders);

  return res.json({ ok: true, order });
});

// List orders (PRIVATE)
app.get("/api/sellers/:sellerId/orders", requireSellerKey, (req, res) => {
  const { sellerId } = req.params;
  const orders = readOrders();
  return res.json({ ok: true, orders: orders[sellerId] || [] });
});

// Update order status (PRIVATE)
app.patch("/api/sellers/:sellerId/orders/:orderId", requireSellerKey, (req, res) => {
  const { sellerId, orderId } = req.params;
  const { status } = req.body;

  if ("total" in req.body || "items" in req.body) {
    return res.status(400).json({
      ok: false,
      error: "financial fields cannot be modified after order creation"
    });
  }

  const orders = readOrders();
  const sellerOrders = orders[sellerId] || [];
  const order = sellerOrders.find(o => o.id === orderId);
  
  if (!order) {
    return res.status(404).json({ ok: false, error: "order not found" });
  }

  const allowedTransitions = {
    pending: ["confirmed", "cancelled"],
    confirmed: ["packed", "cancelled"],
    packed: ["shipped"],
    shipped: ["delivered"],
    delivered: [],
    cancelled: []
  };

  const prev = String(order.status || "pending").toLowerCase();
  const next = String(req.body?.status || "").toLowerCase();

  if (!next) {
    return res.status(400).json({ ok: false, error: "status required" });
  }

  if (!allowedTransitions[prev]?.includes(next)) {
    return res.status(400).json({
      ok: false,
      error: `invalid status transition: ${prev} -> ${next}` 
    });
  }

  const isCancelling = next === "cancelled" && prev !== "cancelled";
  if (isCancelling) {
    // restore stock logic here
    const products = readJson(PRODUCTS_FILE);
    const byId = new Map(products.map(p => [p.id, p]));

    for (const it of order.items || []) {
      const p = byId.get(it.productId);
      if (p) p.stock = Number(p.stock ?? 0) + Number(it.qty || 0);
    }

    writeProducts(products);
  }

  if (req.body.status) {
    order.status = req.body.status;
    order.updatedAt = new Date().toISOString();

    if (!order.history) order.history = [];
    order.history.push({
      status: req.body.status,
      at: order.updatedAt
    });

    order.timeline = Array.isArray(order.timeline) ? order.timeline : [];
    order.timeline.push({ at: new Date().toISOString(), status: next });
  }
  
  writeOrders(orders);
  res.json({ ok: true, order });
});

// -------------------- PUBLIC CATALOG (BUYER SIDE) --------------------
// View products for a seller (PUBLIC)
app.get("/api/catalog/:sellerId/products", (req, res) => {
  const { sellerId } = req.params;

  if (!SELLER_KEYS[sellerId]) {
    return res.status(404).json({ ok: false, error: "seller not found" });
  }

  const products = readJson(PRODUCTS_FILE).filter((p) => p.sellerId === sellerId);
  res.json({ ok: true, products });
});

// Create order (PUBLIC) — buyer checkout (no seller key)
app.post("/api/public/sellers/:sellerId/orders", (req, res) => {
  const { sellerId } = req.params;
  const { items, paymentStatus } = req.body || {};

  const idemKey = getIdempotencyKey(req);
  const orders = readOrders();
  if (idemKey) {
    const existing = orders[sellerId]?.find(o => o.idempotencyKey === idemKey);
    if (existing) {
      return res.json({ ok: true, order: existing, idempotent: true });
    }
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, error: "items required" });
  }

  // Load products and validate items against seller catalog
  const products = readJson(PRODUCTS_FILE);
  const catalog = Array.isArray(products) ? products.filter(p => p.sellerId === sellerId) : [];

  // Helper: find product
  const findProduct = (pid) => catalog.find(p => p.id === pid && p.sellerId === sellerId);

  // Validate + compute total server-side
  const enrichedItems = [];

  for (const it of items) {
    const productId = it.productId;
    const qty = Number(it.qty || 0);
    const size = it.size;
    const variant = it.variant;

    if (!productId || !Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ ok: false, error: "invalid item qty/productId" });
    }

    const p = findProduct(productId);
    if (!p) return res.status(400).json({ ok: false, error: "product not found" });

    // Size validation (if your product has sizes)
    if (Array.isArray(p.sizes) && p.sizes.length > 0) {
      if (!p.sizes.includes(size)) return res.status(400).json({ ok: false, error: "invalid size" });
    }

    // Variant validation (based on your current schema: variants: [{label, options:[{label, add}]}])
    if (Array.isArray(p.variants) && p.variants.length > 0) {
      // If you have only one variant group like Color
      const group = p.variants[0];
      const opt = group?.options?.find(o => o.label === variant);
      if (!opt) return res.status(400).json({ ok: false, error: "invalid variant" });

      const base = Number(p.price || 0);
      const add = Number(opt.add || 0);
      total += (base + add) * qty;
    } else {
      total += Number(p.price || 0) * qty;
    }

    const unitPrice = Number(p.price) || 0;

    // If you have variant add-on logic, compute it here.
    // For now, assuming your variant add is 0:
    const addOn = 0;

    const finalUnitPrice = unitPrice + addOn;

    enrichedItems.push({
      productId: p.id,
      name: p.name,                // snapshot
      unitPrice,                   // snapshot
      finalUnitPrice,              // snapshot
      qty: Number(it.qty) || 1,
      size: size || null,
      variant: variant || null,
      addOn                        // snapshot (optional but useful)
    });
  }

  const total = enrichedItems.reduce((sum, it) => sum + (it.finalUnitPrice * it.qty), 0);

  // 1) Validate stock before placing order
  for (const it of enrichedItems) {
    const p = products.find(x => x.id === it.productId && x.sellerId === sellerId);
    if (!p) throw new Error("invalid productId");
    if ((p.stock || 0) < it.qty) {
      throw new Error(`Out of stock: ${p.name}. Available=${p.stock || 0}, requested=${it.qty}`);
    }
  }

  // 2) Decrement stock
  for (const it of enrichedItems) {
    const p = products.find(x => x.id === it.productId && x.sellerId === sellerId);
    p.stock = Number(p.stock ?? 0) - Number(it.qty);
  }

  // 3) Persist products immediately
  writeJson(PRODUCTS_FILE, products);

  const order = {
    id: "ord_" + Date.now(),
    sellerId,
    items: enrichedItems,
    total,
    paymentStatus: paymentStatus || "unpaid",
    status: "pending",
    history: [
      {
        status: "pending",
        at: new Date().toISOString()
      }
    ],
    createdAt: new Date().toISOString(),
    idempotencyKey: idemKey || null,
  };

  const receiptBase = `${order.id}|${order.total}|${order.createdAt}`;
  order.receiptHash = crypto
    .createHash("sha256")
    .update(receiptBase)
    .digest("hex");

  orders[sellerId] = orders[sellerId] || [];
  orders[sellerId].unshift(order);
  writeOrders(orders);

  return res.json({ ok: true, order });
});

// Track order status (PUBLIC)
app.get("/api/public/sellers/:sellerId/orders/:orderId", (req, res) => {
  const { sellerId, orderId } = req.params;
  const orders = readOrders();
  const list = orders[sellerId] || [];
  const order = list.find(o => o.id === orderId);
  if (!order) return res.status(404).json({ ok: false, error: "order not found" });

  // public-safe fields
  return res.json({
    ok: true,
    order: {
      id: order.id,
      status: order.status,
      paymentStatus: order.paymentStatus,
      total: order.total,
      createdAt: order.createdAt,
      items: order.items
    }
  });
});

// Receipt / Invoice (PUBLIC)
app.get("/api/public/sellers/:sellerId/orders/:orderId/receipt", (req, res) => {
  const { sellerId, orderId } = req.params;

  const ordersData = readOrders();
  const orders = ordersData[sellerId] || [];
  const products = readProducts().filter(p => p.sellerId === sellerId);

  const order = orders.find(o => o.id === orderId);

  if (!order) {
    return res.json({ ok: false, error: "order not found" });
  }

  const receiptId = "rcpt_" + order.id;

  const receipt = {
    receiptId,
    sellerId,
    issuedAt: new Date().toISOString(),
    order: {
      id: order.id,
      total: order.total,
      paymentStatus: order.paymentStatus,
      status: order.status,
      items: order.items.map(item => {
        const product = products.find(p => p.id === item.productId);
        return {
          productId: item.productId,
          name: product?.name || "Unknown",
          unitPrice: item.unitPrice || 0,
          finalUnitPrice: item.finalUnitPrice || item.unitPrice || 0,
          qty: item.qty,
          size: item.size,
          variant: item.variant
        };
      })
    }
  };

  const signature = signReceipt(receipt); // whatever your signing fn is
  receipt.signature = signature;

  res.json({ ok: true, receipt });
});

// Verify Receipt Integrity
// GET /api/public/sellers/:sellerId/orders/:orderId/verify
app.get("/api/public/sellers/:sellerId/orders/:orderId/verify", (req, res) => {
  try {
    const { sellerId, orderId } = req.params;

    const ordersDb = readOrders();
    const list = ordersDb[sellerId] || [];
    const o = list.find(x => x.id === orderId);

    if (!o) return res.status(404).json({ ok: false, error: "order not found" });
    if (!o.receiptSig) return res.status(400).json({ ok: false, error: "receipt signature missing" });

    const receiptPayload = JSON.stringify({
      receiptId: `rcpt_${o.id}`,
      sellerId: o.sellerId,
      issuedAt: new Date().toISOString(),
      order: {
        orderId: o.id,
        total: o.total,
        paymentStatus: o.paymentStatus,
        status: o.status,
        items: (o.items || []).map(i => ({
          productId: i.productId,
          name: i.name || "Unknown",
          unitPrice: i.unitPrice || 0,
          finalUnitPrice: i.finalUnitPrice || i.unitPrice || 0,
          qty: i.qty,
          size: i.size || null,
          variant: i.variant || null
        }))
      }
    });

    const expected = crypto
      .createHmac("sha256", RECEIPT_SECRET)
      .update(receiptPayload)
      .digest("hex");

    return res.json({
      ok: true,
      valid: expected === o.receiptSig,
      receiptSig: o.receiptSig
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------- SELLER PRODUCTS (PRIVATE) --------------------
// List products (PRIVATE)
app.get("/api/sellers/:sellerId/products", requireSellerKey, (req, res) => {
  const { sellerId } = req.params;
  const products = readJson(PRODUCTS_FILE).filter((p) => p.sellerId === sellerId);
  res.json({ ok: true, products });
});

// Create product (PRIVATE)
app.post("/api/sellers/:sellerId/products", requireSellerKey, (req, res) => {
  const { sellerId } = req.params;
  const { name, price, images, variants } = req.body || {};

  // variants example: [{ label:"Size", options:["S","M"] }]
  if (!name || typeof name !== "string") {
    return res.status(400).json({ ok: false, error: "name required" });
  }
  if (Number.isNaN(Number(price))) {
    return res.status(400).json({ ok: false, error: "valid price required" });
  }
  if (!Array.isArray(images)) {
    return res.status(400).json({ ok: false, error: "images must be array" });
  }
  if (!Array.isArray(variants)) {
    return res.status(400).json({ ok: false, error: "variants must be array" });
  }
  for (const v of variants) {
    if (!v || typeof v !== "object") {
      return res.status(400).json({ ok: false, error: "variants must be objects" });
    }
    if (!v.label || !Array.isArray(v.options) || v.options.length === 0) {
      return res.status(400).json({ ok: false, error: "variants must have label + options[]" });
    }
  }

  const products = readJson(PRODUCTS_FILE);

  const product = {
    id: makeId("prod"),
    sellerId,
    name,
    price: Number(price),
    images,
    variants,
    createdAt: nowIso(),
  };

  products.push(product);
  writeProducts(products);

  res.json({ ok: true, product });
});

// Delete product (PRIVATE)
app.delete("/api/sellers/:sellerId/products/:productId", requireSellerKey, (req, res) => {
  const { sellerId, productId } = req.params;

  const products = readJson(PRODUCTS_FILE);
  const index = products.findIndex(p => p.id === productId && p.sellerId === sellerId);

  if (index === -1) {
    return res.status(404).json({ ok: false, error: "product not found" });
  }

  products.splice(index, 1);
  writeProducts(products);

  res.json({ ok: true });
});

// Update product (PRIVATE) - price/name/images/variants/stock
app.patch("/api/sellers/:sellerId/products/:productId", requireSellerKey, (req, res) => {
  const { sellerId, productId } = req.params;

  const products = readJson(PRODUCTS_FILE);   // MUST be fresh here
  const product = products.find(p => p.id === productId && p.sellerId === sellerId);
  if (!product) return res.status(400).json({ ok:false, error:"invalid productId" });

  // allow partial updates
  const { name, price, images, variants, stock } = req.body;

  if (name !== undefined) product.name = String(name);

  if (price !== undefined) {
    const n = Number(price);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ ok:false, error:"invalid price" });
    product.price = n;
  }

  if (images !== undefined) {
    if (!Array.isArray(images)) return res.status(400).json({ ok:false, error:"images must be array" });
    product.images = images;
  }

  if (variants !== undefined) {
    if (!Array.isArray(variants)) return res.status(400).json({ ok:false, error:"variants must be array" });
    product.variants = variants;
  }

  if (stock !== undefined) {
    const n = Number(stock);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ ok:false, error:"invalid stock" });
    product.stock = n;
  }

  // Update the product in the array
  const idx = products.findIndex(p => p.id === productId && p.sellerId === sellerId);
  products[idx] = product;
  writeProducts(products);

  return res.json({ ok: true, product });
});

// -------------------- 404 --------------------
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "route not found" });
});

// -------------------- START --------------------
const PORT = 5050;
app.listen(PORT, () => {
  console.log(`Zentr running on http://localhost:${PORT}`);
})


