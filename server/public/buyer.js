(() => {
  "use strict";

  // run-once guard
  if (window.__ZENTR_BUYER_INIT__) return;
  window.__ZENTR_BUYER_INIT__ = true;

  const $ = (id) => document.getElementById(id);

  const CART_KEY = "zentr_cart_v1";
  const state = {
    sellerId: "demoSeller",
    catalog: [],
    productById: {},
    cart: { items: [] },
    query: ""
  };

  function toast(msg, ms = 2200) {
    const el = $("toast");
    if (!el) return alert(msg);
    el.textContent = msg;
    el.style.display = "block";
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (el.style.display = "none"), ms);
  }

  function showZoom(url) {
    const overlay = $("zoomOverlay");
    if (!overlay) return;
    const img = overlay.querySelector("img");
    img.src = url;
    overlay.style.display = "flex";
    overlay.onclick = () => { overlay.style.display = "none"; img.src = ""; };
  }

  function safeJsonParse(s, fallback) {
    try { return JSON.parse(s); } catch { return fallback; }
  }

  function money(n) {
    const x = Number(n || 0);
    return `₹${x.toFixed(0)}`;
  }

  function getSellerId() {
    const url = new URL(window.location.href);
    return url.searchParams.get("sellerId") || "demoSeller";
  }

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
    const pill = $("cartPill");
    if (pill) pill.textContent = `Cart: ${count}`;
  }

  function findCartItem(productId, variants) {
    const key = JSON.stringify({ productId, variants: variants || [] });
    return state.cart.items.find(it => JSON.stringify({ productId: it.productId, variants: it.variants || [] }) === key);
  }

  function variantSummary(variants) {
    if (!Array.isArray(variants) || variants.length === 0) return "";
    return variants.map(v => `${v.caption}: ${v.label}`).join(", ");
  }

  function buildImageUrl(pathOrUrl) {
    if (!pathOrUrl) return "";
    // if already absolute
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    // if starts with / then keep
    if (pathOrUrl.startsWith("/")) return pathOrUrl;
    // otherwise treat as relative to current origin
    return `/${pathOrUrl}`;
  }

  function renderProducts(list) {
    const grid = $("productGrid");
    if (!grid) throw new Error("Missing #productGrid in buyer.html");
    grid.innerHTML = "";

    const q = state.query.trim().toLowerCase();
    const filtered = !q ? list : list.filter(p => (p.name || "").toLowerCase().includes(q));

    if (filtered.length === 0) {
      grid.innerHTML = `<div style="color:rgba(255,255,255,.55);padding:12px 0">No products match your search.</div>`;
      return;
    }

    for (const p of filtered) {
      const card = document.createElement("div");
      card.className = "card";

      // image
      const imgbox = document.createElement("div");
      imgbox.className = "imgbox";

      const imgUrl = buildImageUrl((p.images && p.images[0]) || "");
      if (imgUrl) {
        const img = document.createElement("img");
        img.src = imgUrl;
        img.alt = p.name || "product";
        img.loading = "lazy";
        img.style.cursor = "zoom-in";
        img.addEventListener("click", () => showZoom(imgUrl));
        img.onerror = () => { imgbox.textContent = "No image"; };
        imgbox.appendChild(img);
      } else {
        imgbox.textContent = "No image";
      }

      // meta
      const meta = document.createElement("div");
      meta.className = "meta";

      const name = document.createElement("div");
      name.className = "name";
      name.textContent = p.name || "Unnamed Product";

      const price = document.createElement("div");
      price.className = "price";
      price.textContent = money(p.price);

      // variants area
      const vwrap = document.createElement("div");
      vwrap.className = "variants";

      const groups = Array.isArray(p.variants) ? p.variants : [];
      const selects = [];

      for (const g of groups) {
        const caption = g.label || "Variant"; // Use label, not caption
        const options = Array.isArray(g.options) ? g.options : [];

        const field = document.createElement("div");
        field.className = "field";

        const lab = document.createElement("label");
        lab.textContent = `${caption} *`;

        const sel = document.createElement("select");
        sel.dataset.caption = caption;

        const ph = document.createElement("option");
        ph.value = "";
        ph.textContent = `Select ${caption}`;
        sel.appendChild(ph);

        for (const opt of options) {
          const o = document.createElement("option");
          // CRITICAL: value MUST be opt.add (not id)
          o.value = String(opt.add);
          o.textContent = opt.label;
          sel.appendChild(o);
        }

        field.appendChild(lab);
        field.appendChild(sel);
        vwrap.appendChild(field);
        selects.push(sel);
      }

      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = "Add to cart";

      btn.addEventListener("click", () => {
        try {
          const picked = [];
          for (const sel of selects) {
            const caption = sel.dataset.caption || "Variant";
            if (!sel.value) throw new Error(`Select ${caption}`);
            const label = sel.options[sel.selectedIndex]?.textContent || "";
            // Store caption, optionId as index, and label
            picked.push({ caption, optionId: String(sel.selectedIndex - 1), label });
          }

          const existing = findCartItem(p.id, picked.map(v => ({ caption: v.caption, optionId: v.optionId })));
          if (existing) existing.qty += 1;
          else {
            state.cart.items.push({
              productId: p.id,
              name: p.name,
              price: Number(p.price || 0),
              qty: 1,
              variants: picked
            });
          }

          saveCart();
          renderCart();
          toast("Added to cart ✅");
        } catch (e) {
          toast(e?.message || "Unable to add to cart");
        }
      });

      meta.appendChild(name);
      meta.appendChild(price);
      if (groups.length) meta.appendChild(vwrap);
      meta.appendChild(btn);

      card.appendChild(imgbox);
      card.appendChild(meta);
      grid.appendChild(card);
    }
  }

  function renderCart() {
    const list = $("cartList");
    if (!list) throw new Error("Missing #cartList in buyer.html");
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
      const vtxt = variantSummary(it.variants);
      sub.textContent = vtxt ? `${vtxt}` : "No variants";

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
      qty.style.minWidth = "18px";
      qty.style.textAlign = "center";
      qty.textContent = String(it.qty || 1);

      const plus = document.createElement("button");
      plus.textContent = "+";
      plus.addEventListener("click", () => {
        it.qty = (it.qty || 1) + 1;
        saveCart();
        renderCart();
      });

      right.appendChild(minus);
      right.appendChild(qty);
      right.appendChild(plus);

      const price = document.createElement("div");
      price.style.minWidth = "64px";
      price.style.textAlign = "right";
      price.style.fontWeight = "700";
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
    const delivery = 0;
    const elSub = $("subTotal");
    const elDel = $("deliveryFee");
    const elGrand = $("grandTotal");
    if (elSub) elSub.textContent = money(sub);
    if (elDel) elDel.textContent = money(delivery);
    if (elGrand) elGrand.textContent = money(sub + delivery);
  }

  function bindUI() {
    $("sellerPill").textContent = `seller: ${state.sellerId}`;

    $("searchInput").addEventListener("input", (e) => {
      state.query = e.target.value || "";
      renderProducts(state.catalog);
    });

    $("clearCartBtn").addEventListener("click", () => {
      state.cart = { items: [] };
      saveCart();
      renderCart();
      toast("Cart cleared 🧹");
    });

    $("checkoutBtn").addEventListener("click", proceedToPay);
  }

  function buildCheckoutPayload() {
    const name = ($("buyerName").value || "").trim();
    const phone = ($("buyerPhone").value || "").trim();
    const address = ($("buyerAddress").value || "").trim();

    if (!state.cart.items.length) throw new Error("Cart is empty");

    const items = state.cart.items.map(it => {
      const product = state.productById[it.productId];
      if (!product) throw new Error(`Unknown product: ${it.productId}`);

      const groups = Array.isArray(product.variants) ? product.variants : [];
      const cleaned = [];

      for (const group of groups) {
        const caption = group.label || group.caption || "Variant";
        const picked = (it.variants || []).find(v =>
          String(v.caption).toLowerCase() === String(caption).toLowerCase()
        );

        if (!picked) throw new Error(`Missing ${caption} for ${product.name}`);
        cleaned.push({
          caption: caption,
          optionId: picked.optionId,
          label: picked.label
        });
      }

      return {
        productId: it.productId,
        qty: Number(it.qty || 1),
        variants: cleaned
      };
    });

    return {
      items,
      buyerName: name,
      buyerPhone: phone,
      buyerAddress: address,
      delivery: { name, phone, address }
    };
  }

  async function proceedToPay() {
    try {
      const payload = buildCheckoutPayload();
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
    }
  }

  async function loadCatalog() {
    const url = `/api/public/sellers/${encodeURIComponent(state.sellerId)}/products`;
    console.log("[buyer] loading products:", url);

    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    console.log("[buyer] products response:", data);

    if (!data.ok) throw new Error(data.error || "products fetch failed");

    state.catalog = Array.isArray(data.products) ? data.products : [];
    state.productById = Object.fromEntries(state.catalog.map(p => [p.id, p]));
  }

  // boot
  window.addEventListener("DOMContentLoaded", async () => {
    try {
      state.sellerId = getSellerId();
      loadCart();
      bindUI();
      await loadCatalog();
      renderProducts(state.catalog);
      renderCart();
      updateCartPill();
      toast("Catalog loaded ✅", 1400);
    } catch (e) {
      console.error("[buyer] failed", e);
      alert("Buyer page JS error: " + (e?.message || e));
    }
  });

})();