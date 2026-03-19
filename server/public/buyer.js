(() => {
  "use strict";

  if (window.__ZENTR_BUYER_INIT__) return;
  window.__ZENTR_BUYER_INIT__ = true;

  const $ = (id) => document.getElementById(id);

  const CART_KEY = "zentr_cart_v2";
  const state = {
    sellerId: "",
    storeName: "",
    catalog: [],
    productById: {},
    cart: { items: [] },
    query: "",
    paymentSettings: null
  };

  // ─── TOAST ───
  function toast(msg, ms = 2400) {
    const el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.style.display = "block";
    el.style.opacity = "1";
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.style.opacity = "0";
      setTimeout(() => { el.style.display = "none"; }, 300);
    }, ms);
  }

  // ─── ZOOM ───
  function showZoom(url) {
    const overlay = $("zoomOverlay");
    if (!overlay) return;
    const img = overlay.querySelector("img");
    img.src = url;
    overlay.style.display = "flex";
    overlay.onclick = () => { overlay.style.display = "none"; img.src = ""; };
  }

  // ─── UTILS ───
  function safeJsonParse(s, fallback) {
    try { return JSON.parse(s); } catch { return fallback; }
  }

  function money(n) {
    return `₹${Number(n || 0).toFixed(0)}`;
  }

  function getSellerId() {
    return new URL(window.location.href).searchParams.get("sellerId") || "";
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // ─── CART PERSISTENCE ───
  function loadCart() {
    const raw = localStorage.getItem(CART_KEY);
    const data = raw ? safeJsonParse(raw, null) : null;
    if (data && Array.isArray(data.items)) state.cart = data;
    else state.cart = { items: [] };
  }

  function saveCart() {
    localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
    updateCartPill();
  }

  function updateCartPill() {
    const count = state.cart.items.reduce((a, it) => a + (it.qty || 0), 0);
    const badge = $("cartCount");
    if (badge) badge.textContent = count;
  }

  function findCartItem(productId, selectedOptions) {
    const key = JSON.stringify({ productId, selectedOptions: (selectedOptions || []).sort((a, b) => a.name.localeCompare(b.name)) });
    return state.cart.items.find(it => {
      const itKey = JSON.stringify({ productId: it.productId, selectedOptions: (it.selectedOptions || []).sort((a, b) => a.name.localeCompare(b.name)) });
      return key === itKey;
    });
  }

  function optionSummary(selectedOptions) {
    if (!Array.isArray(selectedOptions) || selectedOptions.length === 0) return "";
    return selectedOptions.map(v => `${v.name}: ${v.value}`).join(", ");
  }

  // ─── PRODUCT RENDERING ───
  function renderProducts(list) {
    const grid = $("productGrid");
    if (!grid) return;
    grid.innerHTML = "";

    const q = state.query.trim().toLowerCase();
    const filtered = !q ? list : list.filter(p => (p.name || "").toLowerCase().includes(q));

    if (filtered.length === 0) {
      grid.innerHTML = `<div style="color:rgba(255,255,255,.55);padding:12px 0">No products${q ? " match your search" : " in this store yet"}.${!q ? " Check back soon!" : ""}</div>`;
      return;
    }

    for (const p of filtered) {
      const card = document.createElement("div");
      card.className = "card";

      // Image/Media Gallery
      const imgbox = document.createElement("div");
      imgbox.className = "imgbox";
      
      // Image/Media Gallery Migration: Prioritize image_url
      const pImageUrl = p.image_url || (Array.isArray(p.images) && p.images[0]) || "";
      const mediaItems = [];
      if (pImageUrl) mediaItems.push(pImageUrl);
      if (Array.isArray(p.images)) {
        p.images.forEach(img => {
          if (img !== pImageUrl) mediaItems.push(img);
        });
      }
      if (p.videoUrl) mediaItems.push({ type: 'video', url: p.videoUrl });

      if (mediaItems.length > 0) {
        const gallery = document.createElement("div");
        gallery.className = "gallery";
        
        const dotsWrap = document.createElement("div");
        dotsWrap.className = "gallery-dots";
        const dots = [];

        mediaItems.forEach((item, idx) => {
          const itemEl = document.createElement("div");
          itemEl.className = "gallery-item";
          
          const url = typeof item === 'string' ? item : item.url;
          const isVideo = typeof item === 'object' && item.type === 'video';

          if (isVideo) {
            if (url.includes("youtube.com") || url.includes("youtu.be")) {
              const vidId = url.split("v=")[1] || url.split("/").pop();
              itemEl.innerHTML = `<iframe src="https://www.youtube.com/embed/${vidId}" frameborder="0" allowfullscreen></iframe>`;
            } else {
              itemEl.innerHTML = `<video src="${url}" controls muted loop playsinline></video>`;
            }
          } else {
            const img = document.createElement("img");
            img.src = url;
            img.alt = p.name;
            img.loading = "lazy";
            img.onerror = () => {
              itemEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:42px;color:rgba(255,255,255,.2);background:rgba(0,0,0,0.2);">📦</div>`;
            };
            img.addEventListener("click", () => showZoom(url));
            itemEl.appendChild(img);
          }
          gallery.appendChild(itemEl);

          if (mediaItems.length > 1) {
            const dot = document.createElement("div");
            dot.className = `dot ${idx === 0 ? 'active' : ''}`;
            dotsWrap.appendChild(dot);
            dots.push(dot);
          }
        });

        if (mediaItems.length > 1) {
          gallery.addEventListener("scroll", () => {
            const scrollIndex = Math.round(gallery.scrollLeft / gallery.clientWidth);
            dots.forEach((d, i) => d.classList.toggle("active", i === scrollIndex));
          });
          imgbox.appendChild(dotsWrap);
        }

        imgbox.appendChild(gallery);
      } else {
        imgbox.innerHTML = `<div style="font-size:42px;color:rgba(255,255,255,.2)">📦</div>`;
      }

      const meta = document.createElement("div");
      meta.className = "meta";

      const nameEl = document.createElement("div");
      nameEl.className = "name";
      nameEl.textContent = p.name || "Unnamed Product";

      const priceEl = document.createElement("div");
      priceEl.className = "price";
      priceEl.textContent = money(p.price);


      // ─── OPTION GROUPS ───
      // New schema: p.options = [{name:"Size", values:["S","M","L"]}, ...]
      // Legacy schema: p.sizes=[] and p.variants=[]
      const optionGroups = buildOptionGroups(p);
      const vwrap = document.createElement("div");
      vwrap.className = "variants";
      const selects = []; // [{name, select}]

      for (const group of optionGroups) {
        const field = document.createElement("div");
        field.className = "field";

        const lab = document.createElement("label");
        lab.textContent = `${group.name} *`;

        const sel = document.createElement("select");
        sel.style.cssText = "background:#0d1f24;color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:10px;padding:8px 12px;width:100%;font-size:13px;cursor:pointer;";
        sel.dataset.groupName = group.name;

        const ph = document.createElement("option");
        ph.value = "";
        ph.textContent = `Select ${group.name}`;
        ph.style.color = "#aaa";
        sel.appendChild(ph);

        for (const val of group.values) {
          const o = document.createElement("option");
          o.value = val;
          o.textContent = val;
          o.style.background = "#0d1f24";
          sel.appendChild(o);
        }

        field.appendChild(lab);
        field.appendChild(sel);
        vwrap.appendChild(field);
        selects.push({ name: group.name, select: sel });
      }

      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = "Add to cart";

      btn.addEventListener("click", () => {
        try {
          const selectedOptions = [];
          for (const { name, select } of selects) {
            if (!select.value) throw new Error(`Please select ${name}`);
            selectedOptions.push({ name, value: select.value });
          }

          const existing = findCartItem(p.id, selectedOptions);
          if (existing) {
            existing.qty += 1;
          } else {
            state.cart.items.push({
              productId: p.id,
              name: p.name,
              price: Number(p.price || 0),
              qty: 1,
              selectedOptions
            });
          }

          saveCart();
          renderCart();
          toast("Added to cart ✅");
        } catch (e) {
          toast(e?.message || "Unable to add to cart");
        }
      });

      meta.appendChild(nameEl);
      meta.appendChild(priceEl);
      if (p.desc) {
        const descEl = document.createElement("div");
        descEl.style.cssText = "font-size:12px;color:rgba(255,255,255,.6);margin:4px 0 8px;line-height:1.5;border-left:2px solid rgba(39,240,213,.4);padding-left:8px;";
        descEl.textContent = p.desc;
        meta.appendChild(descEl);
      }
      if (optionGroups.length) meta.appendChild(vwrap);
      meta.appendChild(btn);

      card.appendChild(imgbox);
      card.appendChild(meta);
      grid.appendChild(card);
    }
  }

  // Build normalized option groups from both old and new schema
  function buildOptionGroups(p) {
    // New schema (preferred)
    if (p.options && Array.isArray(p.options) && p.options.length > 0) {
      return p.options.map(g => ({ name: g.name || "Option", values: Array.isArray(g.values) ? g.values : [] }));
    }
    // Legacy: sizes + variants
    const groups = [];
    if (p.sizes && p.sizes.length > 0) groups.push({ name: "Size", values: p.sizes });
    if (p.variants && p.variants.length > 0) groups.push({ name: "Color", values: typeof p.variants[0] === "string" ? p.variants : p.variants.map(v => v.label || v.name || String(v)) });
    return groups;
  }

  // ─── CART RENDERING ───
  function renderCart() {
    const list = $("cartList");
    if (!list) return;
    list.innerHTML = "";

    if (!state.cart.items.length) {
      list.innerHTML = `<div style="color:rgba(255,255,255,.55)">Cart is empty.</div>`;
      updateTotals();
      updateCartPill();
      return;
    }

    for (const it of state.cart.items) {
      const row = document.createElement("div");
      row.className = "cart-item";

      const left = document.createElement("div");
      const title = document.createElement("div");
      title.className = "ci-title";
      title.textContent = it.name || it.productId;

      const sub = document.createElement("div");
      sub.className = "ci-sub";
      const vtxt = optionSummary(it.selectedOptions);
      sub.textContent = vtxt || "No options";

      left.appendChild(title);
      left.appendChild(sub);

      const right = document.createElement("div");
      right.className = "qty";

      const minus = document.createElement("button");
      minus.textContent = "−";
      minus.addEventListener("click", () => {
        it.qty = Math.max(1, (it.qty || 1) - 1);
        saveCart();
        renderCart();
      });

      const qty = document.createElement("div");
      qty.style.cssText = "min-width:18px;text-align:center";
      qty.textContent = String(it.qty || 1);

      const plus = document.createElement("button");
      plus.textContent = "+";
      plus.addEventListener("click", () => {
        it.qty = (it.qty || 1) + 1;
        saveCart();
        renderCart();
      });

      const removeBtn = document.createElement("button");
      removeBtn.textContent = "×";
      removeBtn.style.cssText = "color:rgba(255,107,107,.8);font-size:16px;padding:0 4px;background:none;border:none;cursor:pointer;";
      removeBtn.addEventListener("click", () => {
        state.cart.items = state.cart.items.filter(x => x !== it);
        saveCart();
        renderCart();
      });

      right.appendChild(minus);
      right.appendChild(qty);
      right.appendChild(plus);
      right.appendChild(removeBtn);

      const price = document.createElement("div");
      price.style.cssText = "min-width:64px;text-align:right;font-weight:700";
      price.textContent = money((it.price || 0) * (it.qty || 1));

      row.appendChild(left);
      row.appendChild(right);
      row.appendChild(price);
      list.appendChild(row);
    }

    updateTotals();
    updateCartPill();
  }

  function updateTotals() {
    const sub = state.cart.items.reduce((a, it) => a + (Number(it.price || 0) * Number(it.qty || 0)), 0);
    const elSub = $("subTotal");
    const elDel = $("deliveryFee");
    const elGrand = $("grandTotal");
    if (elSub) elSub.textContent = money(sub);
    if (elDel) {
      elDel.textContent = "Free";
      elDel.style.color = "var(--ok)";
    }
    if (elGrand) elGrand.textContent = money(sub);
  }

  // ─── UI BINDING ───
  function bindUI() {
    const nm = $("storeNameText");
    if (nm && state.storeName) nm.textContent = state.storeName;

    const searchInput = $("searchInput");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        state.query = e.target.value || "";
        renderProducts(state.catalog);
      });
    }

    const clearBtn = $("clearCartBtn");
    if (clearBtn) clearBtn.addEventListener("click", () => {
      state.cart = { items: [] };
      saveCart();
      renderCart();
      toast("Cart cleared 🧹");
    });

    const checkoutBtn = $("checkoutBtn");
    if (checkoutBtn) checkoutBtn.addEventListener("click", proceedToPay);
  }

  // ─── CHECKOUT ───
  function buildCheckoutPayload() {
    const name = ($("buyerName")?.value || "").trim();
    const phone = ($("buyerPhone")?.value || "").trim();
    const address = ($("buyerAddress")?.value || "").trim();

    if (!state.cart.items.length) throw new Error("Cart is empty");

    // Validate Phone (exactly 10 digits)
    if (phone.replace(/\D/g, '').length !== 10) {
      throw new Error("Please enter a valid 10-digit Indian mobile number.");
    }

    // Get selected payment method
    let selectedMethod = "cod";
    const radio = document.querySelector('input[name="payMethod"]:checked');
    if (radio) selectedMethod = radio.value;
    else if (state.paymentSettings) {
      if (state.paymentSettings.codEnabled) selectedMethod = "cod";
      else if (state.paymentSettings.upiId) selectedMethod = "upi";
    }

    if (!name) throw new Error("Please enter your Full Name.");
    if (!address) throw new Error("Please enter your Delivery Address.");

    const items = state.cart.items.map(it => {
      const product = state.productById[it.productId];
      if (!product) throw new Error(`Unknown product: ${it.productId}`);
      return {
        productId: it.productId,
        qty: Number(it.qty || 1),
        // Store selected options as variants array for backend compatibility
        variants: (it.selectedOptions || []).map(opt => ({
          caption: opt.name,
          label: opt.value
        }))
      };
    });

    return {
      items,
      buyerName: name || "Guest Buyer",
      buyerPhone: phone || "0000000000",
      buyerAddress: address || "N/A",
      delivery: { name, phone, address },
      paymentMethod: selectedMethod
    };
  }

  async function proceedToPay() {
    const btn = $("checkoutBtn");
    try {
      const payload = buildCheckoutPayload();
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span style="display:inline-block;animation:spin 1s linear infinite;">⏳</span> Processing...`;
      }
      
      const res = await fetch(`/api/public/sellers/${state.sellerId}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || "Order create failed");
      }

      toast("Order created ✅ Redirecting...");
      state.cart = { items: [] };
      saveCart();
      renderCart();

      setTimeout(() => {
        const orderId = data.orderId || (data.order && data.order.id);
        window.location.href = `/confirm?sellerId=${encodeURIComponent(state.sellerId)}&orderId=${encodeURIComponent(orderId)}`;
      }, 800);

    } catch (e) {
      toast(e?.message || "Checkout failed");
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Place Order";
      }
    }
  }

  // ─── CATALOG LOADING ───
  async function loadCatalog() {
    const url = `/api/public/sellers/${encodeURIComponent(state.sellerId)}/products`;
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));

    if (!data.ok) throw new Error(data.error || "Failed to load products");

    state.catalog = Array.isArray(data.products) ? data.products : [];
    state.productById = Object.fromEntries(state.catalog.map(p => [p.id, p]));
  }

  async function loadStoreName() {
    try {
      const res = await fetch(`/api/public/sellers/${encodeURIComponent(state.sellerId)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (data.ok && data.storeName) {
        state.storeName = data.storeName;
        const nm = $("storeNameText");
        const cp = $("storeCatPill");
        
        if (nm) {
          nm.textContent = data.storeName;
          nm.classList.remove("skeleton");
        }
        
        if (cp && data.category && data.category !== "Other") {
          cp.textContent = data.category;
          cp.style.display = "inline-block";
        }
        // Also update page title
        if (data.storeName) document.title = `${data.storeName} | Zentr`;
      } else {
        const nm = $("storeNameText");
        if (nm) {
          nm.textContent = `Store ID: ${state.sellerId}`;
          nm.classList.remove("skeleton");
        }
      }
    } catch { /* non-critical */ }
  }

  async function loadPaymentSettings() {
    try {
      const res = await fetch(`/api/public/sellers/${encodeURIComponent(state.sellerId)}/payment`);
      const data = await res.json().catch(() => ({}));
      if (data.ok && data.payment) {
        state.paymentSettings = data.payment;
        renderPaymentOptions();
      }
    } catch { /* non-critical */ }
  }

  function renderPaymentOptions() {
    const pList = $("paymentList");
    const pSec = $("paymentSection");
    if (!pList || !pSec || !state.paymentSettings) return;

    const pm = state.paymentSettings;
    if (!pm.codEnabled && !pm.upiId) {
      pList.innerHTML = `<div style="color:var(--warn); font-size:12px">Seller has not enabled any payment methods. Cannot order.</div>`;
      pSec.style.display = "block";
      return;
    }

    let html = "";
    if (pm.codEnabled) {
      html += `
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; background:rgba(255,255,255,.05); padding:10px; border-radius:8px; border:1px solid var(--stroke)">
          <input type="radio" name="payMethod" value="cod" checked style="accent-color:var(--turq)">
          <div style="font-size:13px; font-weight:600">Cash on Delivery (COD)</div>
        </label>
      `;
    }
    if (pm.upiId) {
      html += `
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; background:rgba(255,255,255,.05); padding:10px; border-radius:8px; border:1px solid var(--stroke)">
          <input type="radio" name="payMethod" value="upi" ${!pm.codEnabled ? 'checked' : ''} style="accent-color:var(--turq)">
          <div style="font-size:13px">
            <div style="font-weight:600">UPI / QR Payment</div>
            <div style="color:var(--turq); font-family:monospace; margin-top:2px">${escapeHtml(pm.upiId)}</div>
          </div>
        </label>
      `;
    }

    // Payment notes if any
    if (pm.paymentNote) {
      html += `<div style="font-size:11px; color:var(--muted); margin-top:4px; padding:8px; background:rgba(0,0,0,.2); border-radius:6px; border-left:2px solid var(--turq)">${escapeHtml(pm.paymentNote)}</div>`;
    }

    pList.innerHTML = html;
    pSec.style.display = "block";
  }

  // ─── BOOT ───
  window.addEventListener("DOMContentLoaded", async () => {
    try {
      state.sellerId = getSellerId();
      if (!state.sellerId) {
        const grid = $("productGrid");
        if (grid) grid.innerHTML = `<div style="color:rgba(255,107,107,.8);padding:20px">⚠️ No seller ID provided in the URL. Please use the store link shared by the seller.</div>`;
        return;
      }

      // Check if current user is the owner
      try {
        const ownerData = JSON.parse(localStorage.getItem("zentr_store"));
        if (ownerData && ownerData.sellerId === state.sellerId) {
          const banner = document.createElement("div");
          banner.style.cssText = "background:var(--warn);color:#000;text-align:center;padding:12px;font-weight:700;font-size:14px;position:sticky;top:60px;z-index:15;box-shadow:0 4px 12px rgba(255, 204, 102, 0.4);";
          banner.innerHTML = "Preview Mode — Orders disabled.<br><span style='font-size:12px;opacity:0.8;font-weight:500'>Share this link with customers or open in another browser to place a test order.</span>";
          document.body.prepend(banner);
          
          const checkoutBtn = $("checkoutBtn");
          if (checkoutBtn) {
            checkoutBtn.disabled = true;
            checkoutBtn.style.opacity = "0.5";
            checkoutBtn.style.cursor = "not-allowed";
            checkoutBtn.title = "Checkout is disabled in owner preview mode.";
            checkoutBtn.textContent = "Disabled (Preview Mode)";
          }
        }
      } catch (e) { }

      loadCart();
      bindUI();

      // Fire BUYER_PAGE_OPEN event (best-effort, non-blocking)
      fetch(`/api/public/sellers/${encodeURIComponent(state.sellerId)}/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "BUYER_PAGE_OPEN" })
      }).catch(() => { });

      const grid = $("productGrid");
      if (grid) {
        grid.innerHTML = `
          <div class="card skeleton" style="height:150px;border:none"></div>
          <div class="card skeleton" style="height:150px;border:none"></div>
          <div class="card skeleton" style="height:150px;border:none"></div>
          <div class="card skeleton" style="height:150px;border:none"></div>
        `;
      }

      // Load in parallel
      await Promise.all([loadCatalog(), loadStoreName(), loadPaymentSettings()]);
      renderProducts(state.catalog);
      renderCart();
      updateCartPill();

      if (state.catalog.length === 0) {
        // Only toast if it's the first load and not a search
        if (!state.query) toast("Welcome! This store is currently setting up its catalog. Check back soon!", 4000);
      }
    } catch (e) {
      console.error("[buyer] boot error:", e);
      if (e && e.message && e.message.toLowerCase().includes("seller not found")) {
        document.body.innerHTML = `
          <div style="padding:60px 20px;text-align:center;color:#fff;font-family:var(--font-mono)">
            <h2 style="color:var(--bad)">⚠️ Store Not Found</h2>
            <p style="color:var(--muted);max-width:400px;margin:16px auto;line-height:1.5">
              This store link is invalid or the store no longer exists.
            </p>
            <a href="/" style="display:inline-block;margin-top:20px;padding:12px 24px;background:var(--turq);color:#000;text-decoration:none;border-radius:8px;font-weight:bold;">← Go to Zentr Welcome Page</a>
          </div>
        `;
      } else {
        const grid = $("productGrid");
        if (grid) grid.innerHTML = `<div style="color:rgba(255,107,107,.8);padding:20px">⚠️ Failed to load products: ${e?.message || e}</div>`;
      }
    }
  });

})();