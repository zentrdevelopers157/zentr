const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://fpgtpjuvoothnrxomktq.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_publishable_Oc9ON1qM9b043yPeND2Pxw_vfmUW7I-";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// -------------------- CONFIG --------------------
const RECEIPT_SECRET = process.env.RECEIPT_SECRET || "dev_only_change_me";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "FutureBillionairesHA";

if (RECEIPT_SECRET === "dev_only_change_me") {
  console.warn("⚠️  RECEIPT_SECRET is using a dev default. Set an env var for production.");
}
if (ADMIN_SECRET === "admin_secret_dev_only") {
  console.warn("⚠️  ADMIN_SECRET is using a dev default. Set an env var for production.");
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// -------------------- STATIC ROUTES --------------------
function resolvePublicFile(...names) {
  for (const n of names) {
    const p = path.join(__dirname, "public", n);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Root goes to the welcome page
app.get("/", (req, res) => {
  const file = resolvePublicFile("index.html");
  if (file) return res.sendFile(file);
  res.redirect("/buyer");
});

["buyer", "confirm", "track", "receipt", "seller", "create-store", "admin"].forEach((page) => {
  app.get(`/${page}`, (req, res) => {
    const file = resolvePublicFile(`${page}.html`);
    if (!file) return res.status(404).send(`${page} page not found`);
    res.sendFile(file);
  });
});

// ── Multer Storage Configuration ──
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "tmp", "uploads");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = Date.now() + "-" + Math.round(Math.random() * 1e9) + ext;
    cb(null, uniqueName);
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only images are allowed"));
  }
});

// ── Upload Endpoint (Supabase Migration) ──
app.post("/api/upload", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "No file uploaded" });

  try {
    const file = req.file;
    const sellerId = req.body.sellerId || "default_seller";
    const timestamp = Date.now();
    const sanitizedName = file.originalname.replace(/[^a-z0-0.]/gi, "_").toLowerCase();
    const filePath = `${sellerId}/${timestamp}-${sanitizedName}`;

    const { data, error } = await supabase.storage
      .from("product-images")
      .upload(filePath, fs.readFileSync(file.path), {
        contentType: file.mimetype,
        upsert: true
      });

    // Clean up local temp file
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);

    if (error) {
      console.error("[supabase-upload] error:", error.message);
      return res.status(500).json({ ok: false, error: "Supabase upload failed: " + error.message });
    }

    // Get Public URL
    const { data: { publicUrl } } = supabase.storage
      .from("product-images")
      .getPublicUrl(filePath);

    res.json({ ok: true, url: publicUrl });
  } catch (err) {
    console.error("[api-upload] crash:", err);
    res.status(500).json({ ok: false, error: "Internal server error during upload" });
  }
});

// -------------------- DATA STORAGE --------------------
// PRIMARY: MongoDB Atlas (set MONGODB_URI env var on Render)
// FALLBACK: JSON files (local dev only — NOT persistent on Render free tier)

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "..", "data");

const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const SELLERS_FILE = path.join(DATA_DIR, "sellers.json");
const EVENTS_FILE = path.join(DATA_DIR, "events.json");

// ── In-memory cache (populated from MongoDB on startup) ──
const MEM = {
  sellers: {},
  products: [],
  orders: {},
  events: []
};

// ── MongoDB client ────────────────────────────────────────
let _mdbStore = null; // reference to MongoDB 'store' collection

async function connectMongo() {
  const MONGO_URI = process.env.MONGODB_URI;
  if (!MONGO_URI) {
    console.log("ℹ️  MONGODB_URI not set — using JSON file fallback (local dev only).");
    return false;
  }
  try {
    const { MongoClient } = require("mongodb");
    const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
    await client.connect();
    const database = client.db("zentr");
    _mdbStore = database.collection("store");

    // Load all data from MongoDB into MEM cache
    const docs = await _mdbStore.find({}).toArray();
    docs.forEach(doc => {
      if (doc._id === "sellers" && doc.data) MEM.sellers = doc.data;
      if (doc._id === "products" && doc.data) MEM.products = doc.data;
      if (doc._id === "orders" && doc.data) MEM.orders = doc.data;
      if (doc._id === "events" && doc.data) MEM.events = doc.data;
    });

    console.log(`✅ MongoDB connected. Loaded: ${Object.keys(MEM.sellers).length} sellers, ${MEM.products.length} products, ${Object.keys(MEM.orders).length} order keys, ${MEM.events.length} events.`);
    return true;
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    console.warn("⚠️  Falling back to JSON files (data will be lost on Render restart).");
    return false;
  }
}

function mdbSave(key, data) {
  if (!_mdbStore) return;
  _mdbStore.replaceOne({ _id: key }, { _id: key, data }, { upsert: true })
    .catch(err => console.error(`[mongo] save ${key} failed:`, err.message));
}

// ── JSON fallback helpers ─────────────────────────────────
const FileDB = {
  ensure() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(PRODUCTS_FILE)) fs.writeFileSync(PRODUCTS_FILE, "[]");
    if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, "{}");
    if (!fs.existsSync(SELLERS_FILE)) fs.writeFileSync(SELLERS_FILE, "{}");
    if (!fs.existsSync(EVENTS_FILE)) fs.writeFileSync(EVENTS_FILE, "[]");
  },
  read(file, fallback) {
    this.ensure();
    try { const r = fs.readFileSync(file, "utf8").trim(); return r ? JSON.parse(r) : fallback; }
    catch (e) { console.error(`readJson ${file}:`, e.message); return fallback; }
  },
  write(file, data) { this.ensure(); fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
};

// ── Unified DB interface (same as before — all callers unchanged) ──
const DB = {
  getSellers() {
    if (_mdbStore) return { ...MEM.sellers };
    const d = FileDB.read(SELLERS_FILE, {});
    return (d && typeof d === "object" && !Array.isArray(d)) ? d : {};
  },
  saveSellers(s) {
    if (_mdbStore) { MEM.sellers = s; mdbSave("sellers", s); }
    else FileDB.write(SELLERS_FILE, s);
  },

  getProducts() {
    if (_mdbStore) return [...MEM.products];
    const d = FileDB.read(PRODUCTS_FILE, []);
    return Array.isArray(d) ? d : [];
  },
  saveProducts(p) {
    if (_mdbStore) { MEM.products = p; mdbSave("products", p); }
    else FileDB.write(PRODUCTS_FILE, p);
  },

  getOrders() {
    if (_mdbStore) return { ...MEM.orders };
    const d = FileDB.read(ORDERS_FILE, {});
    return (d && typeof d === "object" && !Array.isArray(d)) ? d : {};
  },
  saveOrders(o) {
    if (_mdbStore) { MEM.orders = o; mdbSave("orders", o); }
    else FileDB.write(ORDERS_FILE, o);
  },

  getEvents() {
    if (_mdbStore) return [...MEM.events];
    const d = FileDB.read(EVENTS_FILE, []);
    return Array.isArray(d) ? d : [];
  },
  saveEvents(e) {
    if (_mdbStore) { MEM.events = e; mdbSave("events", e); }
    else FileDB.write(EVENTS_FILE, e);
  },

  // Legacy — kept for any migration callsite
  ensureFiles() { FileDB.ensure(); }
};

// -------------------- BUSINESS LOGIC --------------------
const OrderLogic = {
  makeOrderId() {
    return "ord_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  },

  calculateItemPrice(product) {
    return Number(product.price) || 0;
  },

  validateStock(products, items) {
    for (const item of items) {
      const product = products.find((p) => p.id === item.productId);
      if (!product) continue;
      const qty = Number(item.qty) || 0;
      const stock = product.stock === "" ? Infinity : (Number(product.stock) ?? 999);
      if (qty <= 0) return { ok: false, error: `Invalid quantity for ${product.name}` };
      if (stock < qty) return { ok: false, error: `Out of stock: ${product.name}. Available: ${stock}` };
    }
    return { ok: true };
  },

  decrementStock(products, items) {
    items.forEach((item) => {
      const p = products.find((x) => x.id === item.productId);
      if (p && p.stock !== "" && p.stock !== undefined) {
        p.stock = Math.max(0, (Number(p.stock) || 0) - (Number(item.qty) || 0));
      }
    });
  },

  restoreStock(products, items) {
    items.forEach((item) => {
      const p = products.find((x) => x.id === item.productId);
      if (p && p.stock !== "" && p.stock !== undefined) {
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
      items: order.items.map((i) => ({ productId: i.productId, qty: i.qty, unitPrice: i.unitPrice }))
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
// Only accept exactly 10 digits for Indian mobile
const normalizePhone = (p) => {
  const digits = String(p || "").replace(/\D/g, "");
  return digits.length === 10 ? digits : null;
};
const isValidUpi = (upi) => {
  const s = String(upi || "").trim();
  // Standard UPI format: name@bank, allows dots, hyphens, underscores
  return /^[\w.-]+@[\w.-]+$/.test(s);
};
const tString = (val, maxLen) => String(val || "").trim().slice(0, maxLen);

// -------------------- EVENT TRACKING --------------------
const Analytics = {
  track(type, metadata = {}) {
    try {
      const events = DB.getEvents();
      events.push({
        id: "evt_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        type,
        timestamp: nowIso(),
        ...metadata
      });
      DB.saveEvents(events);
    } catch (err) {
      console.error("[analytics] failed to track:", err.message);
    }
  }
};

// -------------------- AUTH --------------------
function requireSellerKey(req, res, next) {
  const { sellerId } = req.params;
  const key = req.header("x-seller-key");

  if (!sellerId || !key) {
    return res.status(401).json({ ok: false, error: "sellerId and x-seller-key header are required" });
  }

  const sellers = DB.getSellers();
  const seller = sellers[sellerId];

  if (!seller) {
    return res.status(404).json({ ok: false, error: "seller not found" });
  }

  if (key !== seller.sellerKey) {
    return res.status(401).json({ ok: false, error: "invalid seller key" });
  }

  req.seller = seller;
  next();
}

function requireAdmin(req, res, next) {
  const key = req.header("x-admin-secret");
  if (!key || key !== ADMIN_SECRET) {
    return res.status(403).json({ ok: false, error: "forbidden: invalid admin secret" });
  }
  next();
}

// -------------------- HEALTH CHECK --------------------
// Health check for Cloudflare/Render
app.get("/health", (req, res) => res.json({ status: "ok", timestamp: nowIso() }));
app.get("/api/health", (req, res) => res.json({ ok: true, time: nowIso() }));

// -------------------- ONBOARDING --------------------
app.post("/api/onboard", (req, res) => {
  try {
    const { name, owner, phone, category } = req.body || {};

    const storeName = tString(name, 50);
    const ownerName = tString(owner, 50);
    const cat = tString(category, 50);
    const norm = normalizePhone(phone);

    if (!storeName || !ownerName || !norm) {
      return res.status(400).json({ ok: false, error: "Valid 10-digit Indian phone (e.g. 9876543210), store name, and owner name are required." });
    }
    
    if (storeName.length < 3 || ownerName.length < 3) {
      return res.status(400).json({ ok: false, error: "Store and owner names must be at least 3 characters long." });
    }

    const sellers = DB.getSellers();

    // Duplicate prevention: check normalized phone
    const existing = Object.values(sellers).find(s => s.phone === norm);
    if (existing) {
      return res.status(409).json({
        ok: false,
        error: "This phone number already has a store. Please open your existing dashboard instead."
      });
    }

    const sellerId = "s_" + Math.random().toString(36).slice(2, 10);
    const sellerKey = crypto.randomBytes(20).toString("hex");

    sellers[sellerId] = {
      sellerId,
      sellerKey,
      storeName,
      ownerName,
      phone: norm,
      category: tString(category, 50) || "Other",
      createdAt: nowIso(),
      // Payment info (v1) - COD enabled by default
      payment: {
        codEnabled: true,
        upiId: "",
        paymentNote: ""
      }
    };
    DB.saveSellers(sellers);
    Analytics.track("STORE_CREATED", { sellerId, storeName: name });

    console.log(`[onboard] new seller created: ${sellerId} (${storeName})`);
    res.json({ ok: true, sellerId, sellerKey, storeName });
  } catch (err) {
    console.error("[onboard] error:", err);
    res.status(500).json({ ok: false, error: "server error during onboarding" });
  }
});

// -------------------- PUBLIC ROUTES --------------------

// Get seller info (for buyer storefront header)
app.get("/api/public/sellers/:sellerId", (req, res) => {
  const sellers = DB.getSellers();
  const seller = sellers[req.params.sellerId];
  if (!seller) return res.status(404).json({ ok: false, error: "seller not found" });
  // Return only public info
  res.json({
    ok: true,
    storeName: seller.storeName,
    category: seller.category,
    phone: seller.phone,
    isMongoConnected: !!_mdbStore
  });
});

// Get public payment info (for confirm/receipt pages — no seller key required)
app.get("/api/public/sellers/:sellerId/payment", (req, res) => {
  const sellers = DB.getSellers();
  const seller = sellers[req.params.sellerId];
  if (!seller) return res.status(404).json({ ok: false, error: "seller not found" });
  const payment = seller.payment || { codEnabled: false, upiId: "", paymentNote: "" };
  res.json({ ok: true, payment });
});

// Public event tracking (buyer-side, no auth)
const ALLOWED_PUBLIC_EVENTS = new Set(["BUYER_PAGE_OPEN", "CART_STARTED", "STORE_VIEWED"]);
app.post("/api/public/sellers/:sellerId/event", (req, res) => {
  try {
    const { sellerId } = req.params;
    const type = String(req.body.type || "").toUpperCase();
    if (!ALLOWED_PUBLIC_EVENTS.has(type)) {
      return res.status(400).json({ ok: false, error: "unsupported event type" });
    }
    const sellers = DB.getSellers();
    if (!sellers[sellerId]) return res.status(404).json({ ok: false, error: "seller not found" });
    Analytics.track(type, { sellerId });
    res.json({ ok: true });
  } catch (err) {
    console.error("[public event] error:", err);
    res.status(500).json({ ok: false, error: "server error" });
  }
});

app.get("/api/public/sellers/:sellerId/products", (req, res) => {
  try {
    const { sellerId } = req.params;
    const sellers = DB.getSellers();
    if (!sellers[sellerId]) {
      return res.status(404).json({ ok: false, error: "seller not found" });
    }
    const products = DB.getProducts().filter((p) => p.sellerId === sellerId);
    Analytics.track("STORE_VIEWED", { sellerId });
    res.json({ ok: true, products });
  } catch (err) {
    console.error("[public products] error:", err);
    res.status(500).json({ ok: false, error: "server error" });
  }
});

app.post("/api/public/sellers/:sellerId/checkout", (req, res) => {
  try {
    const { sellerId } = req.params;
    const { items, delivery, buyerName, buyerPhone, buyerAddress, paymentMethod } = req.body || {};

    const sellers = DB.getSellers();
    if (!sellers[sellerId]) return res.status(404).json({ ok: false, error: "seller not found" });

    const idemKey = getIdempotencyKey(req);
    const ordersDb = DB.getOrders();

    if (idemKey) {
      const existing = (ordersDb[sellerId] || []).find((o) => o.idempotencyKey === idemKey);
      if (existing) return res.json({ ok: true, order: existing, orderId: existing.id, idempotent: true });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: "items array is required" });
    }

    // Validate 10-digit Indian phone for buyer
    const bPhone = normalizePhone(buyerPhone || delivery?.phone);
    if (!bPhone) {
      return res.status(400).json({ ok: false, error: "Valid 10-digit Indian mobile number is required" });
    }

    // Validate payment method matches seller settings
    const pm = String(paymentMethod || "").toLowerCase();
    const sPay = sellers[sellerId].payment || {};
    if (pm === "cod" && !sPay.codEnabled) return res.status(400).json({ ok: false, error: "COD is not available for this seller" });
    if (pm === "upi" && !sPay.upiId) return res.status(400).json({ ok: false, error: "UPI is not available for this seller" });
    if (pm !== "cod" && pm !== "upi") return res.status(400).json({ ok: false, error: "Invalid payment method. Choose COD or UPI." });

    const products = DB.getProducts();
    const stockCheck = OrderLogic.validateStock(products, items);
    if (!stockCheck.ok) return res.status(400).json(stockCheck);

    let total = 0;
    const enrichedItems = items.map((it) => {
      const p = products.find((x) => x.id === it.productId);
      if (!p) throw new Error(`Product not found: ${it.productId}`);
      
      // Zentr Rule: No Variant, No Order
      // If product has options/sizes/variants, ensure buyer selected them
      const hasOpts = (p.options && p.options.length > 0) || (p.sizes && p.sizes.length > 0) || (p.variants && p.variants.length > 0);
      const selectedOpts = Array.isArray(it.selectedOptions) ? it.selectedOptions : (Array.isArray(it.variants) ? it.variants : []);
      
      if (hasOpts && selectedOpts.length === 0) {
        throw new Error(`Please select variants for "${p.name}" before checking out.`);
      }

      const unitPrice = OrderLogic.calculateItemPrice(p);
      const qty = Number(it.qty) || 1;
      total += unitPrice * qty;
      return {
        ...it,
        name: p.name,
        unitPrice,
        subtotal: unitPrice * qty,
        selectedOptions: selectedOpts.map(v => ({ 
          name: v.caption || v.name || "Option", 
          value: v.label || v.value || String(v) 
        })),
        variants: selectedOpts.map(v => ({ 
          caption: v.caption || v.name || "Option", 
          label: v.label || v.value || String(v) 
        }))
      };
    });

    OrderLogic.decrementStock(products, items);
    DB.saveProducts(products);

    const order = {
      id: OrderLogic.makeOrderId(),
      sellerId,
      buyerName: tString(buyerName || delivery?.name || "Guest Buyer", 50),
      buyerPhone: bPhone,
      buyerAddress: tString(buyerAddress || delivery?.address || "N/A", 250),
      items: enrichedItems,
      total,
      paymentMethod: pm,
      paymentStatus: "unpaid",
      status: "pending",
      history: [{ status: "pending", at: nowIso() }],
      createdAt: nowIso(),
      idempotencyKey: idemKey || null
    };

    order.receiptSig = ReceiptLogic.sign(order);
    ordersDb[sellerId] = ordersDb[sellerId] || [];
    ordersDb[sellerId].unshift(order);
    DB.saveOrders(ordersDb);
    Analytics.track("ORDER_PLACED", { sellerId, orderId: order.id, total, itemsCount: items.length });

    res.json({ ok: true, order, orderId: order.id });
  } catch (err) {
    console.error("[checkout] error:", err);
    res.status(500).json({ ok: false, error: err.message || "server error" });
  }
});

app.get("/api/public/sellers/:sellerId/orders/:orderId", (req, res) => {
  const order = (DB.getOrders()[req.params.sellerId] || []).find((o) => o.id === req.params.orderId);
  if (!order) return res.status(404).json({ ok: false, error: "order not found" });
  
  // Security: Return ONLY tracking info, hide PII (Phone/Address) from public links
  const publicOrder = {
    id: order.id,
    sellerId: order.sellerId,
    buyerName: order.buyerName,
    buyerPhone: order.buyerPhone,
    buyerAddress: order.buyerAddress,
    items: order.items,
    total: order.total,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    history: order.history,
    createdAt: order.createdAt
  };
  res.json({ ok: true, order: publicOrder });
});

app.get("/api/public/sellers/:sellerId/orders/:orderId/receipt", (req, res) => {
  const order = (DB.getOrders()[req.params.sellerId] || []).find((o) => o.id === req.params.orderId);
  if (!order) return res.status(404).json({ ok: false, error: "order not found" });
  res.json({
    ok: true,
    receipt: {
      receiptId: `rcpt_${order.id}`,
      sellerId: order.sellerId,
      issuedAt: nowIso(),
      order,
      signature: order.receiptSig
    }
  });
});

app.post("/api/receipt/verify", (req, res) => {
  const { receiptId, signature } = req.body;
  if (!receiptId || !signature) return res.status(400).json({ ok: false, error: "receiptId and signature required" });
  const id = receiptId.replace("rcpt_", "");
  const orders = DB.getOrders();
  let order = null;
  for (const list of Object.values(orders)) {
    order = list.find((o) => o.id === id);
    if (order) break;
  }
  if (!order) return res.status(404).json({ ok: false, error: "order not found" });
  const valid = ReceiptLogic.verify(order, signature);
  res.json({ ok: true, valid, verified: valid });
});

// -------------------- SELLER PROTECTED ROUTES --------------------

app.get("/api/sellers/:sellerId/info", requireSellerKey, (req, res) => {
  res.json({ ok: true, seller: req.seller, isMongoConnected: !!_mdbStore });
});

// Get seller info (seller-authenticated)
app.get("/api/sellers/:sellerId", requireSellerKey, (req, res) => {
  const s = req.seller;
  res.json({ ok: true, seller: { sellerId: s.sellerId, storeName: s.storeName, ownerName: s.ownerName, category: s.category, createdAt: s.createdAt } });
});

// Update store info (seller-authenticated)
app.patch("/api/sellers/:sellerId", requireSellerKey, (req, res) => {
  try {
    const sellers = DB.getSellers();
    const seller = sellers[req.params.sellerId];
    if (!seller) return res.status(404).json({ ok: false, error: "seller not found" });

    const { storeName, ownerName, category } = req.body || {};

    if (storeName !== undefined) {
      const val = tString(storeName, 50);
      if (val.length >= 3) seller.storeName = val;
      else return res.status(400).json({ ok: false, error: "Store name must be at least 3 characters" });
    }
    if (ownerName !== undefined) {
      const val = tString(ownerName, 50);
      if (val.length >= 3) seller.ownerName = val;
      else return res.status(400).json({ ok: false, error: "Owner name must be at least 3 characters" });
    }
    if (category !== undefined) {
      seller.category = tString(category, 50);
    }

    seller.updatedAt = nowIso();
    DB.saveSellers(sellers);
    res.json({ ok: true, seller: { storeName: seller.storeName, ownerName: seller.ownerName, category: seller.category } });
  } catch (err) {
    console.error("[seller PATCH] error:", err);
    res.status(500).json({ ok: false, error: "server error" });
  }
});

// Get payment settings (seller-authenticated)
app.get("/api/sellers/:sellerId/payment", requireSellerKey, (req, res) => {
  const payment = req.seller.payment || { codEnabled: false, upiId: "", paymentNote: "" };
  res.json({ ok: true, payment });
});

// Save payment settings (seller-authenticated)
app.patch("/api/sellers/:sellerId/payment", requireSellerKey, (req, res) => {
  try {
    const sellers = DB.getSellers();
    const seller = sellers[req.params.sellerId];
    if (!seller) return res.status(404).json({ ok: false, error: "seller not found" });

    const { codEnabled, upiId, paymentNote } = req.body || {};

    // Validate UPI ID
    const upiStr = String(upiId || "").trim();
    if (upiStr && !isValidUpi(upiStr)) {
      return res.status(400).json({ ok: false, error: "Invalid UPI ID format. Ensure it follows format like name@upi" });
    }

    if (!seller.payment) seller.payment = { codEnabled: false, upiId: "", paymentNote: "" };

    if (codEnabled !== undefined) seller.payment.codEnabled = !!codEnabled;
    if (upiId !== undefined) seller.payment.upiId = tString(upiStr, 100);
    if (paymentNote !== undefined) seller.payment.paymentNote = tString(paymentNote, 250);
    seller.payment.updatedAt = nowIso();

    DB.saveSellers(sellers);
    res.json({ ok: true, payment: seller.payment });
  } catch (err) {
    console.error("[seller payment PATCH] error:", err);
    res.status(500).json({ ok: false, error: "server error" });
  }
});

app.get("/api/sellers/:sellerId/products", requireSellerKey, (req, res) => {
  try {
    const products = DB.getProducts().filter((p) => p.sellerId === req.params.sellerId);
    res.json({ ok: true, products });
  } catch (err) {
    console.error("[seller products GET] error:", err);
    res.status(500).json({ ok: false, error: "server error" });
  }
});

app.post("/api/sellers/:sellerId/products", requireSellerKey, (req, res) => {
  try {
    const { name, price, stock, category, options, desc, images, image_url, videoUrl } = req.body;
    
    // Task 4: Product name validation (3-80 chars)
    const pName = tString(name, 80);
    if (pName.length < 3) {
      return res.status(400).json({ ok: false, error: "Product name must be between 3 and 80 characters." });
    }

    // Task 4: Price validation (> 0)
    const pPrice = Number(price);
    if (isNaN(pPrice) || pPrice <= 0) {
      return res.status(400).json({ ok: false, error: "Price must be a number greater than 0." });
    }

    const pStock = stock === "" ? "" : Math.max(0, Number(stock) || 0);

    // Task 4: Variant/Options validation
    const rawOptions = Array.isArray(options) ? options : [];
    if (rawOptions.length > 10) {
      return res.status(400).json({ ok: false, error: "Maximum 10 variant groups allowed per product." });
    }

    const cleanOpts = [];
    for (const g of rawOptions) {
      const gName = tString(g.name, 50).trim();
      const re = /^[a-zA-Z0-9\s-]+$/;
      if (!re.test(gName)) {
        return res.status(400).json({ ok: false, error: "Variant group names can only contain letters, numbers, spaces, and hyphens." });
      }
      
      const gVals = [];
      const rawVals = Array.isArray(g.values) ? g.values : [];
      for (const v of rawVals) {
        const val = tString(v, 20).trim();
        if (!val) continue;
        if (!re.test(val)) {
          return res.status(400).json({ ok: false, error: `Invalid characters in variant value: "${val}". Only letters, numbers, spaces, and hyphens allowed.` });
        }
        gVals.push(val);
      }
      if (gVals.length > 0) cleanOpts.push({ name: gName, values: gVals });
    }
    if (cleanOpts.length === 0 && rawOptions.length > 0) {
       return res.status(400).json({ ok: false, error: "Valid variant options are required if the variant section is used." });
    }

    // Image Persistence Migration: Use image_url primarily
    const pImageUrl = typeof image_url === 'string' ? image_url : (Array.isArray(images) && images[0] ? images[0] : "");
    const pImages = (Array.isArray(images) ? images : []).filter(url => url && typeof url === 'string').slice(0, 5);
    
    if (!pImageUrl && pImages.length === 0) {
      return res.status(400).json({ ok: false, error: "At least one product image is required." });
    }
    const pVideo = typeof videoUrl === 'string' ? tString(videoUrl, 500) : "";

    const products = DB.getProducts();
    const product = {
      id: "prod_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      sellerId: req.params.sellerId,
      name: pName,
      category: tString(category, 50),
      price: pPrice,
      stock: pStock,
      options: cleanOpts,
      desc: tString(desc, 1200),
      image_url: pImageUrl,
      images: pImages.length > 0 ? pImages : (pImageUrl ? [pImageUrl] : []),
      videoUrl: pVideo,
      createdAt: nowIso()
    };

    products.push(product);
    DB.saveProducts(products);
    Analytics.track("PRODUCT_ADDED", { sellerId: req.params.sellerId, productId: product.id });
    res.json({ ok: true, product });
  } catch (err) {
    console.error("[seller products POST] error:", err);
    res.status(500).json({ ok: false, error: "server error" });
  }
});

app.patch("/api/sellers/:sellerId/products/:productId", requireSellerKey, (req, res) => {
  try {
    const products = DB.getProducts();
    const idx = products.findIndex(
      (x) => x.id === req.params.productId && x.sellerId === req.params.sellerId
    );
    if (idx === -1) return res.status(404).json({ ok: false, error: "product not found" });

    const p = products[idx];
    const fields = ["name", "price", "stock", "category", "options", "desc", "images", "image_url", "videoUrl"];
    
    for (const f of fields) {
      if (req.body[f] === undefined) continue;

      if (f === "name") {
        const val = tString(req.body[f], 80);
        if (val.length >= 3) p.name = val;
      }
      else if (f === "price") {
        const val = Number(req.body[f]);
        if (!isNaN(val) && val > 0) p.price = val;
      }
      else if (f === "stock") {
        p.stock = req.body[f] === "" ? "" : Math.max(0, Number(req.body[f]) || 0);
      }
      else if (f === "options") {
        const raw = Array.isArray(req.body[f]) ? req.body[f].slice(0, 10) : [];
        const cleanOpts = [];
        const re = /^[a-zA-Z0-9\s-]+$/;
        for (const g of raw) {
          const gName = tString(g.name, 50).trim();
          if (!re.test(gName)) return res.status(400).json({ ok: false, error: "Variant group names can only contain letters, numbers, spaces, and hyphens." });
          
          const gVals = [];
          const rawVals = Array.isArray(g.values) ? g.values : [];
          for (const v of rawVals) {
            const val = tString(v, 20).trim();
            if (!val) continue;
            if (!re.test(val)) return res.status(400).json({ ok: false, error: `Invalid characters in variant value: "${val}". Only letters, numbers, spaces, and hyphens allowed.` });
            gVals.push(val);
          }
          if (gVals.length > 0) cleanOpts.push({ name: gName, values: gVals });
        }
        p.options = cleanOpts;
      }
      else if (f === "image_url") {
        if (typeof req.body[f] === 'string') {
          p.image_url = req.body[f];
          // Keep images array in sync if it's the first image
          if (!p.images || p.images.length === 0) p.images = [p.image_url];
          else p.images[0] = p.image_url;
        }
      }
      else if (f === "images") {
        const imgArr = (Array.isArray(req.body[f]) ? req.body[f] : []).filter(url => url && typeof url === 'string').slice(0, 5);
        if (imgArr.length > 0) {
          p.images = imgArr;
          p.image_url = imgArr[0]; // Sync primary image_url
        }
      }
      else if (f === "videoUrl") {
        p.videoUrl = typeof req.body[f] === 'string' ? tString(req.body[f], 500) : "";
      }
      else {
        p[f] = req.body[f];
      }
    }

    p.updatedAt = nowIso();
    DB.saveProducts(products);
    res.json({ ok: true, product: p });
  } catch (err) {
    console.error("[seller products PATCH] error:", err);
    res.status(500).json({ ok: false, error: "server error" });
  }
});

app.delete("/api/sellers/:sellerId/products/:productId", requireSellerKey, (req, res) => {
  try {
    const products = DB.getProducts();
    const filtered = products.filter(
      (p) => !(p.id === req.params.productId && p.sellerId === req.params.sellerId)
    );
    if (filtered.length === products.length) return res.status(404).json({ ok: false, error: "product not found" });
    DB.saveProducts(filtered);
    res.json({ ok: true });
  } catch (err) {
    console.error("[seller products DELETE] error:", err);
    res.status(500).json({ ok: false, error: "server error" });
  }
});

app.get("/api/sellers/:sellerId/orders", requireSellerKey, (req, res) => {
  try {
    const orders = DB.getOrders()[req.params.sellerId] || [];
    res.json({ ok: true, orders });
  } catch (err) {
    console.error("[seller orders GET] error:", err);
    res.status(500).json({ ok: false, error: "server error" });
  }
});

app.patch("/api/sellers/:sellerId/orders/:orderId", requireSellerKey, (req, res) => {
  try {
    const ordersDb = DB.getOrders();
    const sellerOrders = ordersDb[req.params.sellerId] || [];
    const order = sellerOrders.find((o) => o.id === req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: "order not found" });

    const next = String(req.body.status || "").toLowerCase();
    const transitions = {
      pending: ["confirmed", "cancelled"],
      confirmed: ["packed", "cancelled"],
      packed: ["shipped"],
      shipped: ["delivered"],
      delivered: [],
      cancelled: []
    };

    if (!transitions[order.status]?.includes(next)) {
      return res.status(400).json({
        ok: false,
        error: `invalid transition: ${order.status} → ${next}`
      });
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

    if (next === "delivered") Analytics.track("ORDER_DELIVERED", { orderId: order.id, sellerId: req.params.sellerId, total: order.total });

    DB.saveOrders(ordersDb);
    res.json({ ok: true, order });
  } catch (err) {
    console.error("[seller orders PATCH] error:", err);
    res.status(500).json({ ok: false, error: "server error" });
  }
});

// Update payment status ("unpaid" -> "paid")
app.patch("/api/sellers/:sellerId/orders/:orderId/payment-status", requireSellerKey, (req, res) => {
  try {
    const ordersDb = DB.getOrders();
    const sellerOrders = ordersDb[req.params.sellerId] || [];
    const order = sellerOrders.find((o) => o.id === req.params.orderId);
    if (!order) return res.status(404).json({ ok: false, error: "order not found" });

    const next = String(req.body.paymentStatus || "").toLowerCase();
    if (next !== "paid" && next !== "unpaid" && next !== "refunded") {
      return res.status(400).json({ ok: false, error: "invalid payment status. Allowed: unpaid, paid, refunded" });
    }

    order.paymentStatus = next;
    order.updatedAt = nowIso();

    if (next === "paid") Analytics.track("ORDER_PAID", { orderId: order.id, sellerId: req.params.sellerId, total: order.total });

    DB.saveOrders(ordersDb);
    res.json({ ok: true, order });
  } catch (err) {
    console.error("[seller payment-status PATCH] error:", err);
    res.status(500).json({ ok: false, error: "server error" });
  }
});

// -------------------- ADMIN PROTECTED ROUTES --------------------

function buildAdminStats() {
  const sellers = DB.getSellers();
  const products = DB.getProducts();
  const ordersDb = DB.getOrders();
  const events = DB.getEvents();

  const now = Date.now();
  const DAY = 86400000;
  const WEEK = 7 * DAY;
  const MONTH = 30 * DAY;
  const UNPAID_AGE = 2 * DAY;
  const STUCK_AGE = 3 * DAY;

  // Flatten all orders
  const allOrders = [];
  Object.entries(ordersDb).forEach(([sid, ords]) => {
    (Array.isArray(ords) ? ords : []).forEach(o => allOrders.push({ ...o, sellerId: o.sellerId || sid }));
  });

  const sellerList = Object.values(sellers);
  const totalStores = sellerList.length;

  // Products per seller
  const prodBySeller = {};
  products.forEach(p => { prodBySeller[p.sellerId] = (prodBySeller[p.sellerId] || 0) + 1; });

  // Orders per seller
  const ordBySeller = {};
  allOrders.forEach(o => { ordBySeller[o.sellerId] = (ordBySeller[o.sellerId] || 0) + 1; });

  // Last activity per seller
  const lastEvt = {};
  events.forEach(e => {
    if (e.sellerId) {
      const t = new Date(e.timestamp).getTime();
      if (!lastEvt[e.sellerId] || t > lastEvt[e.sellerId]) lastEvt[e.sellerId] = t;
    }
  });
  allOrders.forEach(o => {
    const t = new Date(o.createdAt).getTime();
    if (!lastEvt[o.sellerId] || t > lastEvt[o.sellerId]) lastEvt[o.sellerId] = t;
  });

  const storesWithProduct = sellerList.filter(s => (prodBySeller[s.sellerId] || 0) >= 1).length;
  const storesWithOrder = sellerList.filter(s => (ordBySeller[s.sellerId] || 0) >= 1).length;
  const storesActiveWeek = sellerList.filter(s => lastEvt[s.sellerId] && (now - lastEvt[s.sellerId]) < WEEK).length;
  const storesZeroProd = sellerList.filter(s => (prodBySeller[s.sellerId] || 0) === 0).length;
  const avgProductsPerStore = totalStores > 0 ? (products.length / totalStores).toFixed(1) : 0;

  // Order analytics
  const totalOrders = allOrders.length;
  let totalRevenue = 0, paidOrders = 0, deliveredOrders = 0;
  const byStatus = {}, byPayStat = {}, byPayMeth = {};
  let ordToday = 0, ordWeek = 0, ordMonth = 0;

  allOrders.forEach(o => {
    const age = now - new Date(o.createdAt).getTime();
    if (o.status !== "cancelled" && o.status !== "failed") totalRevenue += Number(o.total) || 0;
    if (o.paymentStatus === "paid") paidOrders++;
    if (o.status === "delivered") deliveredOrders++;

    byStatus[o.status] = (byStatus[o.status] || 0) + 1;
    byPayStat[o.paymentStatus || "unpaid"] = (byPayStat[o.paymentStatus || "unpaid"] || 0) + 1;
    byPayMeth[(o.paymentMethod || "unknown").toUpperCase()] = (byPayMeth[(o.paymentMethod || "unknown").toUpperCase()] || 0) + 1;

    if (age < DAY) ordToday++;
    if (age < WEEK) ordWeek++;
    if (age < MONTH) ordMonth++;
  });

  const avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

  // Event counters
  const storeVisits = events.filter(e => e.type === "STORE_VIEWED").length;
  const totalCarts = events.filter(e => e.type === "CART_STARTED").length;

  // Operational alerts
  const alertsCreatedNoProd = sellerList.filter(s => (prodBySeller[s.sellerId] || 0) === 0)
    .map(s => ({ sellerId: s.sellerId, storeName: s.storeName, createdAt: s.createdAt }));

  const alertsProdNoOrder = sellerList.filter(s => (prodBySeller[s.sellerId] || 0) >= 1 && (ordBySeller[s.sellerId] || 0) === 0)
    .map(s => ({ sellerId: s.sellerId, storeName: s.storeName }));

  const alertsUnpaidOld = allOrders.filter(o =>
    o.paymentStatus !== "paid" && o.status !== "cancelled" &&
    (now - new Date(o.createdAt).getTime()) > UNPAID_AGE
  ).map(o => ({ orderId: o.id, sellerId: o.sellerId, total: o.total, createdAt: o.createdAt, status: o.status }));

  const alertsStuckPending = allOrders.filter(o =>
    o.status === "pending" && (now - new Date(o.createdAt).getTime()) > STUCK_AGE
  ).map(o => ({ orderId: o.id, sellerId: o.sellerId, createdAt: o.createdAt }));

  const alertsMissingPayment = sellerList.filter(s => { const pm = s.payment || {}; return !pm.codEnabled && !pm.upiId; })
    .map(s => ({ sellerId: s.sellerId, storeName: s.storeName }));

  return {
    generatedAt: new Date().toISOString(),
    core: { totalStores, totalProducts: products.length, totalStoreVisits: storeVisits, totalCartsStarted: totalCarts, totalOrders, paidOrders, deliveredOrders, grossRevenue: Math.round(totalRevenue), avgOrderValue },
    sellerHealth: { storesWithProduct, storesWithOrder, storesActiveWeek, storesZeroProducts: storesZeroProd, avgProductsPerStore: Number(avgProductsPerStore) },
    orderAnalytics: { byStatus, byPaymentStatus: byPayStat, byPaymentMethod: byPayMeth, ordToday, ordWeek, ordMonth },
    alerts: { createdNoProduct: alertsCreatedNoProd, productButNoOrder: alertsProdNoOrder, unpaidOld: alertsUnpaidOld, stuckPending: alertsStuckPending, missingPaymentSetup: alertsMissingPayment },
    recentEvents: events.slice(-200).reverse()
  };
}

app.get("/api/admin/stats", requireAdmin, (req, res) => {
  try {
    res.json({ ok: true, isMongoConnected: !!_mdbStore, ...buildAdminStats() });
  } catch (err) {
    console.error("[admin stats GET] error:", err);
    res.status(500).json({ ok: false, error: "server error generating stats" });
  }
});

// -------------------- FALLBACK --------------------
app.use((req, res) => res.status(404).json({ ok: false, error: "not found" }));

// -------------------- START --------------------
const PORT = process.env.PORT || 5050;

async function startServer() {
  // Connect to MongoDB and pre-load data before serving any requests
  await connectMongo();

  // Ensure local fallback files exist (no-op if MongoDB is active)
  try { FileDB.ensure(); } catch (_) { }

  // Migrate existing sellers that are missing the payment field
  try {
    const sellers = DB.getSellers();
    let migrated = false;
    Object.values(sellers).forEach(s => {
      if (!s.payment) {
        s.payment = { codEnabled: false, upiId: "", paymentNote: "" };
        migrated = true;
      }
    });
    if (migrated) {
      DB.saveSellers(sellers);
      console.log("[startup] migrated sellers: added missing payment field");
    }
  } catch (e) {
    console.warn("[startup] migration failed:", e.message);
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n🚀 Zentr v1 Server running on http://0.0.0.0:${PORT}`);
    if (_mdbStore) {
      console.log("🗄️  Storage: MongoDB Atlas (Permanent)");
    } else {
      console.warn("\n⚠️  CRITICAL PERSISTENCE WARNING:");
      console.warn("   MONGODB_URI is not set. Storage: JSON files (Ephemeral on Render)");
      console.warn("   ALL DATA WILL BE WIPED on every deploy/restart unless MONGODB_URI is provided.\n");
    }
  });

  // Graceful Shutdown
  const shutdown = (signal) => {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);
    server.close(() => {
      console.log("Process terminated.");
      process.exit(0);
    });
    // Force exit after 10s if close hangs
    setTimeout(() => {
      console.error("Could not close connections in time, forcefully shutting down");
      process.exit(1);
    }, 10000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// -------------------- CRASH PROTECTION --------------------
process.on("uncaughtException", (err) => {
  console.error("FATAL: Uncaught Exception:", err);
  // Optionally tracker error here
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("FATAL: Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

startServer().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
