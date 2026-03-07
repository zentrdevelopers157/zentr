const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require('path');
const crypto = require("crypto");

// -------------------- CONFIG --------------------
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

app.get('/', (req, res) => res.redirect('/buyer'));

['buyer', 'confirm', 'track', 'receipt', 'seller'].forEach(page => {
  app.get(`/${page}`, (req, res) => {
    const file = resolvePublicFile(`${page}.html`, `${page}.html.html`);
    if (!file) return res.status(404).send(`${page} page not found`);
    res.sendFile(file);
  });
});

// -------------------- DATA STORAGE --------------------
const DATA_DIR = path.join(__dirname, "..", "data");
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

const DB = {
  ensureFiles() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(PRODUCTS_FILE)) fs.writeFileSync(PRODUCTS_FILE, JSON.stringify([], null, 2));
    if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, JSON.stringify({}, null, 2));
  },

  readJson(file, fallback = null) {
    this.ensureFiles();
    try {
      const raw = fs.readFileSync(file, "utf8");
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error(`Error reading ${file}:`, e);
      return fallback;
    }
  },

  writeJson(file, data) {
    this.ensureFiles();
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  },

  getProducts() {
    return this.readJson(PRODUCTS_FILE, []);
  },

  saveProducts(products) {
    this.writeJson(PRODUCTS_FILE, products);
  },

  getOrders() {
    const orders = this.readJson(ORDERS_FILE, {});
    return (orders && typeof orders === "object" && !Array.isArray(orders)) ? orders : {};
  },

  saveOrders(orders) {
    this.writeJson(ORDERS_FILE, orders);
  }
};

// -------------------- BUSINESS LOGIC --------------------
const OrderLogic = {
  makeOrderId() {
    return "ord_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  },

  calculateItemPrice(product, item) {
    let price = Number(product.price) || 0;
    if (product.variants && Array.isArray(product.variants) && Array.isArray(item.variants)) {
      item.variants.forEach(itVar => {
        const group = product.variants.find(g => (g.label || g.caption) === itVar.caption);
        if (group && group.options && Array.isArray(group.options)) {
          // match by label or find by index if optionId is an index (legacy)
          const opt = group.options.find(o => o.label === itVar.label) || group.options[parseInt(itVar.optionId)];
          if (opt && opt.add) price += Number(opt.add);
        }
      });
    }
    return price;
  },

  validateStock(products, items) {
    for (const item of items) {
      const product = products.find(p => p.id === item.productId);
      if (!product) continue; // Skip if not found, let business logic handle later
      const qty = Number(item.qty) || 0;
      const stock = (product.stock !== undefined) ? Number(product.stock) : 999;
      if (qty <= 0) return { ok: false, error: `Invalid quantity for ${product.name || item.productId}` };
      if (stock < qty) return { ok: false, error: `Out of stock: ${product.name || item.productId}. Available: ${stock}` };
    }
    return { ok: true };
  },

  decrementStock(products, items) {
    items.forEach(item => {
      const p = products.find(x => x.id === item.productId);
      if (p && p.stock !== undefined) {
        p.stock = Math.max(0, (Number(p.stock) || 0) - (Number(item.qty) || 0));
      }
    });
  },

  restoreStock(products, items) {
    items.forEach(item => {
      const p = products.find(x => x.id === item.productId);
      if (p && p.stock !== undefined) {
        p.stock = (Number(p.stock) || 0) + (Number(item.qty) || 0);
      }
    });
  }
};

const ReceiptLogic = {
  generatePayload(order) {
    return JSON.stringify({
      orderId: order.id,
      sellerId: order.sellerId,
      buyerName: order.buyerName,
      total: order.total,
      createdAt: order.createdAt,
      items: order.items.map(i => ({
        productId: i.productId,
        qty: i.qty,
        unitPrice: i.unitPrice
      }))
    });
  },

  sign(order) {
    return crypto.createHmac("sha256", RECEIPT_SECRET).update(this.generatePayload(order)).digest("hex");
  },

  verify(order, signature) {
    return this.sign(order) === signature;
  }
};

// -------------------- UTILS --------------------
const getIdempotencyKey = (req) => req.header("x-idempotency-key") || "";
const nowIso = () => new Date().toISOString();

// -------------------- AUTH --------------------
const SELLER_KEYS = { demoSeller: "demo123", urbanWear: "urban456" };

function requireSellerKey(req, res, next) {
  const { sellerId } = req.params;
  const key = req.header("x-seller-key");
  if (!SELLER_KEYS[sellerId]) return res.status(404).json({ ok: false, error: "seller not found" });
  if (!key || key !== SELLER_KEYS[sellerId]) return res.status(401).json({ ok: false, error: "unauthorized" });
  next();
}

// -------------------- PUBLIC ROUTES --------------------
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/public/sellers/:sellerId/products", (req, res) => {
  const { sellerId } = req.params;
  if (!SELLER_KEYS[sellerId]) return res.status(404).json({ ok: false, error: "seller not found" });
  const products = DB.getProducts().filter(p => p.sellerId === sellerId);
  res.json({ ok: true, products });
});

app.post("/api/public/sellers/:sellerId/checkout", (req, res) => {
  const { sellerId } = req.params;
  const { items, delivery, buyerName, buyerPhone, buyerAddress } = req.body || {};
  if (!SELLER_KEYS[sellerId]) return res.status(404).json({ ok: false, error: "seller not found" });

  const idemKey = getIdempotencyKey(req);
  const ordersDb = DB.getOrders();
  if (idemKey) {
    const existing = (ordersDb[sellerId] || []).find(o => o.idempotencyKey === idemKey);
    if (existing) return res.json({ ok: true, order: existing, orderId: existing.id, idempotent: true });
  }

  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ ok: false, error: "items required" });

  const products = DB.getProducts();
  const stockCheck = OrderLogic.validateStock(products, items);
  if (!stockCheck.ok) return res.status(400).json(stockCheck);

  let total = 0;
  const enrichedItems = items.map(it => {
    const p = products.find(x => x.id === it.productId);
    if (!p) throw new Error(`Product not found: ${it.productId}`);
    const unitPrice = OrderLogic.calculateItemPrice(p, it);
    const qty = Number(it.qty) || 1;
    total += unitPrice * qty;
    return {
      ...it,
      name: p.name,
      unitPrice,
      subtotal: unitPrice * qty
    };
  });

  OrderLogic.decrementStock(products, items);
  DB.saveProducts(products);

  const order = {
    id: OrderLogic.makeOrderId(),
    sellerId,
    buyerName: buyerName || delivery?.name || "Guest Buyer",
    buyerPhone: buyerPhone || delivery?.phone || "0000000000",
    buyerAddress: buyerAddress || delivery?.address || "N/A",
    items: enrichedItems,
    total,
    status: "pending",
    history: [{ status: "pending", at: nowIso() }],
    createdAt: nowIso(),
    idempotencyKey: idemKey || null
  };

  order.receiptSig = ReceiptLogic.sign(order);
  ordersDb[sellerId] = ordersDb[sellerId] || [];
  ordersDb[sellerId].unshift(order);
  DB.saveOrders(ordersDb);

  res.json({ ok: true, order, orderId: order.id });
});

app.get("/api/public/sellers/:sellerId/orders/:orderId", (req, res) => {
  const order = (DB.getOrders()[req.params.sellerId] || []).find(o => o.id === req.params.orderId);
  if (!order) return res.status(404).json({ ok: false, error: "order not found" });
  res.json({ ok: true, order });
});

app.get("/api/public/sellers/:sellerId/orders/:orderId/receipt", (req, res) => {
  const order = (DB.getOrders()[req.params.sellerId] || []).find(o => o.id === req.params.orderId);
  if (!order) return res.status(404).json({ ok: false, error: "order not found" });
  res.json({ ok: true, receipt: { receiptId: `rcpt_${order.id}`, sellerId: order.sellerId, issuedAt: nowIso(), order, signature: order.receiptSig } });
});

app.post("/api/receipt/verify", (req, res) => {
  const { receiptId, signature } = req.body;
  if (!receiptId || !signature) return res.status(400).json({ ok: false, error: "receiptId and signature required" });
  const id = receiptId.replace("rcpt_", "");
  const orders = DB.getOrders();
  let order = null;
  for (const list of Object.values(orders)) {
    order = list.find(o => o.id === id);
    if (order) break;
  }
  if (!order) return res.status(404).json({ ok: false, error: "order not found" });
  const valid = ReceiptLogic.verify(order, signature);
  res.json({ ok: true, valid, verified: valid });
});

// -------------------- SELLER ROUTES --------------------
app.get("/api/sellers/:sellerId/products", requireSellerKey, (req, res) => {
  const products = DB.getProducts().filter(p => p.sellerId === req.params.sellerId);
  res.json({ ok: true, products });
});

app.post("/api/sellers/:sellerId/products", requireSellerKey, (req, res) => {
  const { name, price, stock, category, sizes, variants, desc, images } = req.body;
  if (!name || isNaN(Number(price))) return res.status(400).json({ ok: false, error: "invalid data: name and price required" });

  const products = DB.getProducts();
  const product = {
    id: "prod_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5),
    sellerId: req.params.sellerId,
    name,
    category: category || "",
    price: Number(price),
    stock: stock === "" ? "" : (Number(stock) || 0),
    sizes: Array.isArray(sizes) ? sizes : [],
    variants: Array.isArray(variants) ? variants : [],
    desc: desc || "",
    images: Array.isArray(images) ? images : [],
    createdAt: nowIso()
  };

  products.push(product);
  DB.saveProducts(products);
  res.json({ ok: true, product });
});

app.patch("/api/sellers/:sellerId/products/:productId", requireSellerKey, (req, res) => {
  const products = DB.getProducts();
  const idx = products.findIndex(x => x.id === req.params.productId && x.sellerId === req.params.sellerId);
  if (idx === -1) return res.status(404).json({ ok: false, error: "not found" });

  const p = products[idx];
  const fields = ["name", "price", "stock", "category", "sizes", "variants", "desc", "images"];
  fields.forEach(f => {
    if (req.body[f] !== undefined) {
      if (f === "price") p[f] = Number(req.body[f]);
      else if (f === "stock") p[f] = req.body[f] === "" ? "" : Number(req.body[f]);
      else p[f] = req.body[f];
    }
  });

  p.updatedAt = nowIso();
  DB.saveProducts(products);
  res.json({ ok: true, product: p });
});

app.delete("/api/sellers/:sellerId/products/:productId", requireSellerKey, (req, res) => {
  const products = DB.getProducts();
  const initialLen = products.length;
  const filtered = products.filter(p => !(p.id === req.params.productId && p.sellerId === req.params.sellerId));

  if (filtered.length === initialLen) return res.status(404).json({ ok: false, error: "not found" });

  DB.saveProducts(filtered);
  res.json({ ok: true, message: "product deleted" });
});

app.get("/api/sellers/:sellerId/orders", requireSellerKey, (req, res) => {
  res.json({ ok: true, orders: DB.getOrders()[req.params.sellerId] || [] });
});

app.patch("/api/sellers/:sellerId/orders/:orderId", requireSellerKey, (req, res) => {
  const ordersDb = DB.getOrders();
  const order = (ordersDb[req.params.sellerId] || []).find(o => o.id === req.params.orderId);
  if (!order) return res.status(404).json({ ok: false, error: "not found" });

  const next = String(req.body.status).toLowerCase();
  const transitions = {
    pending: ["confirmed", "cancelled"],
    confirmed: ["packed", "cancelled"],
    packed: ["shipped"],
    shipped: ["delivered"],
    delivered: [],
    cancelled: []
  };

  if (!transitions[order.status]?.includes(next)) {
    return res.status(400).json({ ok: false, error: `invalid transition from ${order.status} to ${next}` });
  }

  if (next === "cancelled") {
    const products = DB.getProducts();
    OrderLogic.restoreStock(products, order.items);
    DB.saveProducts(products);
  }

  order.status = next;
  order.updatedAt = nowIso();
  if (!Array.isArray(order.history)) order.history = [];
  order.history.push({ status: next, at: order.updatedAt });
  DB.saveOrders(ordersDb);
  res.json({ ok: true, order });
});

app.use((req, res) => res.status(404).json({ ok: false, error: "not found" }));

const PORT = process.env.PORT || 5050;

app.listen(PORT, () => {
  console.log(`Zentr running on http://localhost:${PORT}`);
});
