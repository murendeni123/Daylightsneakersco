require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3000;
const SITE_URL = process.env.SITE_URL || `http://localhost:${PORT}`;
const WA = process.env.WHATSAPP_NUMBER || '27659662508';

// --------------- Stripe (lazy — works without keys for WhatsApp-only flow) ---------------
let stripe = null;
if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY !== 'sk_test_REPLACE_ME') {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

// --------------- Database ---------------
const DB_PATH = process.env.VERCEL ? '/tmp/daylight.db' : path.join(__dirname, 'daylight.db');
const db = new Database(DB_PATH);
if (!process.env.VERCEL) db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand TEXT NOT NULL,
      model TEXT NOT NULL,
      colorway TEXT NOT NULL,
      price INTEGER NOT NULL,
      was_price INTEGER,
      tag TEXT DEFAULT 'Just in',
      gender TEXT DEFAULT 'Unisex',
      fit TEXT DEFAULT 'contain',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS product_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      filename TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      uk_size INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      UNIQUE(product_id, uk_size)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT,
      city TEXT,
      postcode TEXT,
      note TEXT,
      delivery_method TEXT DEFAULT 'courier',
      payment_method TEXT DEFAULT 'whatsapp',
      subtotal INTEGER NOT NULL,
      delivery_cost INTEGER DEFAULT 0,
      total INTEGER NOT NULL,
      status TEXT DEFAULT 'received',
      stripe_session_id TEXT,
      paid INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      email TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      product_id INTEGER NOT NULL,
      brand TEXT NOT NULL,
      model TEXT NOT NULL,
      colorway TEXT NOT NULL,
      uk_size INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      price_at_time INTEGER NOT NULL
    );
  `);

  const count = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
  if (count === 0) seedProducts();
}

function seedProducts() {
  const products = [
    {brand:"Nike",model:"P-6000",colorway:"Dark Grey",price:2799,tag:"Just in",gender:"Unisex",fit:"contain",photos:["637cd05f-0f1b-450e-984d-3cbfc6d27002.JPG"],sizes:[4,5,6,7,8,9,10,11]},
    {brand:"Nike",model:"P-6000",colorway:"White Pink",price:2799,tag:"Just in",gender:"Women",fit:"contain",photos:["5fd8e632-84ec-4042-91f0-529b569bd5a5.JPG"],sizes:[4,5,6,7,8,9,10]},
    {brand:"Nike",model:"Air Force 1",colorway:"Triple White",price:2199,tag:"Just in",gender:"Unisex",fit:"contain",photos:["cd0246f8-ff10-4f2d-bb2a-e970871d1915.JPG","41797f25-5090-4239-886e-1a11576f7f12.JPG"],sizes:[4,5,6,7,8,9,10,11,12]},
    {brand:"Nike",model:"Air Force 1",colorway:"Triple Black",price:2199,tag:"Just in",gender:"Unisex",fit:"contain",photos:["b9894cca-2d74-4eed-b0df-c56e8bcb358e.JPG"],sizes:[4,5,6,7,8,9,10,11,12]},
    {brand:"Nike",model:"Air Force 1",colorway:"Love Letter",price:2499,tag:"Just in",gender:"Women",fit:"contain",photos:["9a620886-82dc-4cff-99b4-1a09e8629b8d.JPG"],sizes:[4,5,6,7,8,9,10]},
    {brand:"Nike",model:"Air Force 1",colorway:"Pink Hearts",price:2499,tag:"Just in",gender:"Women",fit:"contain",photos:["8e83c8c3-c2ee-492e-80ed-d4dc65aa0d5e.JPG"],sizes:[4,5,6,7,8,9]},
    {brand:"Nike",model:"Air Force 1",colorway:"Black Red",price:2199,tag:"Just in",gender:"Men",fit:"contain",photos:["96c48813-c599-48bd-af47-25c269512d37.JPG"],sizes:[6,7,8,9,10,11,12]},
    {brand:"Nike",model:"Air Force 1",colorway:"Cream Gold Gum",price:2499,tag:"Just in",gender:"Women",fit:"contain",photos:["0254ca82-b551-4cbf-9c41-53a27dbac02e.JPG"],sizes:[4,5,6,7,8,9,10]},
    {brand:"Nike",model:"Jordan 4",colorway:"Black Cat",price:3599,tag:"Just in",gender:"Men",fit:"contain",photos:["54dcd405-1251-463d-a76e-24413e89f9f4.JPG"],sizes:[6,7,8,9,10,11,12]},
    {brand:"Nike",model:"Jordan 1 Low",colorway:"Bred Toe",price:2499,tag:"Just in",gender:"Unisex",fit:"contain",photos:["45cef18c-18cd-48ad-a127-d92cc496285b.JPG"],sizes:[4,5,6,7,8,9,10,11]},
    {brand:"Nike",model:"Jordan 1 Mid",colorway:"Light Smoke Grey",price:2799,tag:"Just in",gender:"Men",fit:"contain",photos:["74e15e49-6492-49f8-9d01-ad976cf402d6.JPG"],sizes:[6,7,8,9,10,11,12]},
    {brand:"Nike",model:"Dunk Low",colorway:"Purple Marble",price:2499,tag:"Just in",gender:"Women",fit:"contain",photos:["251d17df-3c2f-47cf-8606-7a46f506fcec.JPG"],sizes:[4,5,6,7,8,9,10]},
    {brand:"Nike",model:"Dunk Low SB",colorway:"Grey Fog",price:2299,tag:"Just in",gender:"Unisex",fit:"contain",photos:["a7bbed38-c8fb-4162-8d15-c1292621a324.JPG"],sizes:[5,6,7,8,9,10,11]},
    {brand:"Nike",model:"Dunk Low",colorway:"Industrial Blue Denim",price:2499,tag:"Just in",gender:"Unisex",fit:"contain",photos:["1a4166cd-e6b8-4799-b36b-f0be991d8176.JPG"],sizes:[5,6,7,8,9,10,11]},
    {brand:"Nike",model:"Air Max 90",colorway:"Pink Grey",price:2699,tag:"Just in",gender:"Women",fit:"contain",photos:["b3471d73-3b0c-4e93-a703-a64703309efc.JPG"],sizes:[4,5,6,7,8,9]},
    {brand:"Nike",model:"Air Max 90",colorway:"Wolf Grey",price:2699,tag:"Just in",gender:"Men",fit:"contain",photos:["5947b3e0-4c09-4fe0-86b9-6c70bc55c136.JPG","2f31e2ff-1fe5-425f-83ac-34b235b6c86f.JPG"],sizes:[6,7,8,9,10,11,12]},
    {brand:"Nike",model:"Air Max 90",colorway:"Triple White",price:2699,tag:"Just in",gender:"Unisex",fit:"contain",photos:["68f1e03c-5b7b-4a49-b09e-d05c1d1f5ad2.JPG"],sizes:[4,5,6,7,8,9,10,11,12]},
    {brand:"Nike",model:"Air Max Plus",colorway:"White Volt",price:3299,tag:"Just in",gender:"Men",fit:"contain",photos:["2b758f0e-b13f-4181-aae1-ed0f382079d8.JPG"],sizes:[6,7,8,9,10,11,12]},
    {brand:"Nike",model:"Air Max Plus III",colorway:"White Navy",price:3299,tag:"Just in",gender:"Men",fit:"contain",photos:["171ffb9a-0c3d-42f8-a50d-5d965e85b42e.JPG"],sizes:[6,7,8,9,10,11,12]},
    {brand:"Nike",model:"Air Max Plus",colorway:"Black Pink",price:3299,tag:"Just in",gender:"Women",fit:"contain",photos:["f8b3a647-8fa9-49f6-9362-62196dacbebc.JPG"],sizes:[4,5,6,7,8,9,10]},
    {brand:"Nike",model:"Air Max Plus",colorway:"White Black",price:3299,tag:"Just in",gender:"Men",fit:"contain",photos:["abb3f0b2-41bb-47e0-8ad8-0c70375aca72.JPG"],sizes:[6,7,8,9,10,11,12]},
    {brand:"Nike",model:"Air Max 97",colorway:"Pink Burgundy",price:3199,tag:"Just in",gender:"Women",fit:"contain",photos:["0f549c21-a59a-4105-88e0-970528d12bae.JPG"],sizes:[4,5,6,7,8,9,10]},
    {brand:"Nike",model:"Air Max 97",colorway:"Rose Coral",price:3199,tag:"Just in",gender:"Women",fit:"contain",photos:["8713d139-4045-42aa-918a-d13004b4843c.JPG"],sizes:[4,5,6,7,8,9,10]},
    {brand:"Nike",model:"Air Max 95",colorway:"Wolf Grey",price:3299,tag:"Just in",gender:"Men",fit:"contain",photos:["a1d28987-f86b-4756-af4b-8fd5f967ccf9.JPG"],sizes:[6,7,8,9,10,11,12]},
    {brand:"Nike",model:"Air Max 1",colorway:"Grey Black",price:2999,tag:"Just in",gender:"Men",fit:"contain",photos:["a0c8f4be-d8f6-4062-82a0-39bab4fab3cd.JPG"],sizes:[6,7,8,9,10,11]},
    {brand:"Nike",model:"Air Max Dn",colorway:"Pink Mauve",price:3499,tag:"Just in",gender:"Women",fit:"contain",photos:["42cd1844-fdd2-4d50-b861-2eca66ad8902.JPG"],sizes:[4,5,6,7,8,9,10]},
    {brand:"Nike",model:"Shox TL",colorway:"White Silver",price:3599,tag:"Just in",gender:"Men",fit:"contain",photos:["07df58bf-e774-4157-927c-e5e83a0ad5c6.JPG"],sizes:[6,7,8,9,10,11,12]},
    {brand:"Nike",model:"Shox TL",colorway:"Sunrise",price:3599,tag:"Just in",gender:"Men",fit:"contain",photos:["2ac12a6f-5afe-4932-a54e-df55c5e4bc2f.JPG"],sizes:[6,7,8,9,10,11,12]},
    {brand:"Nike",model:"Shox TL",colorway:"Mauve Burgundy",price:3599,tag:"Just in",gender:"Women",fit:"contain",photos:["01be1cac-f8cc-4cb5-94ba-c1f1549b849f.JPG"],sizes:[4,5,6,7,8,9,10]},
    {brand:"Nike",model:"NOCTA Hot Step",colorway:"Black White",price:3499,tag:"Just in",gender:"Men",fit:"contain",photos:["efb9c333-ae16-485b-93c1-5488acc61388.JPG"],sizes:[6,7,8,9,10,11,12]},
    {brand:"Nike",model:"Vomero 5",colorway:"Silver Black",price:3299,tag:"Just in",gender:"Unisex",fit:"contain",photos:["44164576-d67f-4bfe-b0d5-7bd1e36046ad.JPG"],sizes:[5,6,7,8,9,10,11]},
    {brand:"Nike",model:"ZoomX Streakfly",colorway:"White Turquoise",price:3499,tag:"Just in",gender:"Unisex",fit:"contain",photos:["86073d88-04c9-41a5-8427-d769ae34993a.JPG"],sizes:[5,6,7,8,9,10,11]},
    {brand:"New Balance",model:"9060",colorway:"Crystal Pink",price:3299,tag:"Just in",gender:"Women",fit:"contain",photos:["9170e196-58bd-4366-b15d-01284b08ec92.JPG"],sizes:[4,5,6,7,8,9,10]},
    {brand:"New Balance",model:"9060",colorway:"Burgundy Brown",price:3299,tag:"Just in",gender:"Unisex",fit:"contain",photos:["f137f44c-b0ec-47b1-8646-fe1828b423be.JPG"],sizes:[5,6,7,8,9,10,11]},
    {brand:"New Balance",model:"9060",colorway:"Mushroom Beige",price:3299,tag:"Just in",gender:"Unisex",fit:"contain",photos:["076d8bee-7773-44eb-9afd-afde8ea4ff3b.JPG"],sizes:[5,6,7,8,9,10,11]},
    {brand:"New Balance",model:"9060",colorway:"Olive Cream",price:3299,tag:"Just in",gender:"Men",fit:"contain",photos:["00851e21-3302-4292-aadd-4aed339078db.JPG"],sizes:[6,7,8,9,10,11,12]},
    {brand:"adidas",model:"Campus 00s",colorway:"Navy White Gum",price:2299,tag:"Just in",gender:"Unisex",fit:"contain",photos:["5aad5f92-f9d8-4bb3-b3f1-bd4b90ce25fa.JPG"],sizes:[4,5,6,7,8,9,10,11]},
    {brand:"adidas",model:"Campus 00s",colorway:"Olive Beige",price:2299,tag:"Just in",gender:"Unisex",fit:"contain",photos:["5b4c5376-3d64-4555-ab04-183c9e1037b1.JPG"],sizes:[5,6,7,8,9,10,11]},
    {brand:"adidas",model:"Adizero",colorway:"Rasta Black",price:3499,tag:"Just in",gender:"Men",fit:"contain",photos:["0223eefe-6d93-4fc0-a3f7-7c28544fcf3f.JPG"],sizes:[6,7,8,9,10,11,12]},
    {brand:"adidas",model:"Adizero",colorway:"Solar Yellow",price:3499,tag:"Just in",gender:"Men",fit:"contain",photos:["a359f803-3fef-4b51-91d9-283e72be7aa5.JPG"],sizes:[6,7,8,9,10,11,12]},
    {brand:"adidas",model:"Spezial",colorway:"Cream Pink Gum",price:2299,tag:"Just in",gender:"Women",fit:"contain",photos:["4d69c77f-91e0-4159-ba98-0b2f3997c927.JPG"],sizes:[4,5,6,7,8,9,10]},
    {brand:"adidas",model:"Samba",colorway:"Loafer Black Gum",price:2499,tag:"Just in",gender:"Unisex",fit:"contain",photos:["ab9466bf-b370-4265-9c9d-aa6317d95a64.JPG"],sizes:[5,6,7,8,9,10,11]},
    {brand:"adidas",model:"Samba",colorway:"White Black",price:2199,tag:"Just in",gender:"Unisex",fit:"contain",photos:["7d0b5dad-4db5-492e-acdd-8a4b54e56ddb.JPG"],sizes:[4,5,6,7,8,9,10,11,12]},
    {brand:"adidas",model:"Gazelle Bold",colorway:"White Green Gum",price:2499,tag:"Just in",gender:"Women",fit:"contain",photos:["0e89209b-65ef-448b-84c9-08141c8cdad8.JPG"],sizes:[4,5,6,7,8,9,10]},
    {brand:"adidas",model:"Drop Step",colorway:"Black Grey Orange",price:2299,tag:"Just in",gender:"Men",fit:"contain",photos:["022412a8-dd40-4e1a-a29d-4b2b0a961088.JPG"],sizes:[6,7,8,9,10,11,12]},
    {brand:"adidas",model:"Court Revival",colorway:"Off White",price:1999,tag:"Just in",gender:"Women",fit:"contain",photos:["843c91bd-7258-4ad6-9d8e-4c4b29139863.JPG"],sizes:[4,5,6,7,8,9,10]},
    {brand:"adidas",model:"Drop Step",colorway:"White Green Yellow",price:2299,tag:"Just in",gender:"Unisex",fit:"contain",photos:["f83c4ee7-16e3-4b1a-b3e7-9f15f97e734f.JPG"],sizes:[5,6,7,8,9,10,11]},
    {brand:"Puma",model:"Suede XL",colorway:"Navy White",price:1999,tag:"Just in",gender:"Unisex",fit:"contain",photos:["730a7209-e996-4499-b17c-b1d0b5cd9e26.JPG"],sizes:[5,6,7,8,9,10,11]},
    {brand:"Nike",model:"Air Max 95",colorway:"Fresh Mint",price:3299,was:null,tag:"Just in",gender:"Women",fit:"contain",photos:["0e89209b-65ef-448b-84c9-08141c8cdad8.JPG"],sizes:[5,6,7,8,9,10,11]},
  ];

  // Remove last duplicate entry (was a leftover)
  products.pop();

  const insertProduct = db.prepare(`
    INSERT INTO products (brand, model, colorway, price, was_price, tag, gender, fit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertImage = db.prepare(`
    INSERT INTO product_images (product_id, filename, sort_order) VALUES (?, ?, ?)
  `);
  const insertStock = db.prepare(`
    INSERT INTO stock (product_id, uk_size, quantity) VALUES (?, ?, ?)
  `);

  const seed = db.transaction(() => {
    for (const p of products) {
      const { lastInsertRowid: pid } = insertProduct.run(
        p.brand, p.model, p.colorway, p.price, p.was || null, p.tag, p.gender, p.fit
      );
      for (let i = 0; i < p.photos.length; i++) {
        insertImage.run(pid, p.photos[i], i);
      }
      for (const size of (p.sizes || [6,7,8,9,10,11])) {
        insertStock.run(pid, size, 2);
      }
    }
  });
  seed();
  console.log(`Seeded ${products.length} products`);
}

initDB();

// --------------- Prepared statements ---------------
const stmts = {
  allProducts: db.prepare(`
    SELECT p.*,
      (SELECT filename FROM product_images WHERE product_id = p.id ORDER BY sort_order LIMIT 1) as image,
      (SELECT GROUP_CONCAT(DISTINCT uk_size) FROM stock WHERE product_id = p.id AND quantity > 0) as sizes_csv
    FROM products p WHERE p.active = 1 ORDER BY p.id DESC
  `),
  productById: db.prepare(`
    SELECT * FROM products WHERE id = ? AND active = 1
  `),
  productImages: db.prepare(`
    SELECT filename FROM product_images WHERE product_id = ? ORDER BY sort_order
  `),
  productStock: db.prepare(`
    SELECT uk_size, quantity FROM stock WHERE product_id = ? AND quantity > 0 ORDER BY uk_size
  `),
  insertOrder: db.prepare(`
    INSERT INTO orders (ref, customer_name, phone, address, city, postcode, note,
      delivery_method, payment_method, subtotal, delivery_cost, total)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  insertOrderItem: db.prepare(`
    INSERT INTO order_items (order_id, product_id, brand, model, colorway, uk_size, quantity, price_at_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  orderByRef: db.prepare(`
    SELECT * FROM orders WHERE ref = ?
  `),
  orderItems: db.prepare(`
    SELECT * FROM order_items WHERE order_id = ?
  `),
  updateOrderStripe: db.prepare(`
    UPDATE orders SET stripe_session_id = ? WHERE id = ?
  `),
  markPaid: db.prepare(`
    UPDATE orders SET paid = 1, status = 'confirmed' WHERE stripe_session_id = ?
  `),
  updateStatus: db.prepare(`
    UPDATE orders SET status = ? WHERE ref = ?
  `),
};

// --------------- Middleware ---------------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
    }
  }
}));

// Stripe webhook needs raw body
app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe) return res.status(400).json({ error: 'Stripe not configured' });
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    stmts.markPaid.run(session.id);
  }
  res.json({ received: true });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/logo', express.static(path.join(__dirname, 'logo')));

// --------------- Image optimization endpoint ---------------
const PHOTO_DIR = path.join(__dirname, 'photos');
const CACHE_DIR = process.env.VERCEL ? '/tmp/img-cache' : path.join(__dirname, 'img-cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

app.get('/img/:size/:filename', async (req, res) => {
  const { size, filename } = req.params;
  const widths = { thumb: 500, medium: 1000, full: 1800 };
  const w = widths[size] || 500;

  const staticFile = path.join(__dirname, 'public', 'img', size, filename);
  if (fs.existsSync(staticFile)) {
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    return res.sendFile(staticFile);
  }

  const srcFile = path.join(PHOTO_DIR, filename);
  if (!fs.existsSync(srcFile)) {
    res.set('Content-Type', 'image/svg+xml');
    return res.send('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500" viewBox="0 0 500 500"><rect fill="#f5f5f5" width="500" height="500"/><text x="250" y="250" text-anchor="middle" fill="#ccc" font-size="14" font-family="sans-serif">Photo coming soon</text></svg>');
  }

  const cacheKey = `${size}_${filename.replace(/\.[^.]+$/, '')}.webp`;
  const cachePath = path.join(CACHE_DIR, cacheKey);

  if (fs.existsSync(cachePath)) {
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.type('webp');
    return res.sendFile(cachePath);
  }

  try {
    const buffer = await sharp(srcFile)
      .resize(w, null, { withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    fs.writeFileSync(cachePath, buffer);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.type('webp');
    res.send(buffer);
  } catch (err) {
    console.error('Image error:', err.message);
    res.status(500).send('Image processing failed');
  }
});

// --------------- API Routes ---------------
const FREE_OVER = 2500;
const COURIER = 120;

app.get('/api/products', (req, res) => {
  const rows = stmts.allProducts.all();
  const products = rows.map(r => ({
    id: r.id,
    brand: r.brand,
    model: r.model,
    colorway: r.colorway,
    price: r.price,
    was: r.was_price,
    tag: r.tag,
    gender: r.gender,
    fit: r.fit,
    image: r.image,
    sizes: r.sizes_csv ? r.sizes_csv.split(',').map(Number).sort((a, b) => a - b) : []
  }));
  res.json(products);
});

app.get('/api/products/:id', (req, res) => {
  const p = stmts.productById.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const images = stmts.productImages.all(p.id).map(r => r.filename);
  const stock = stmts.productStock.all(p.id).map(r => ({ size: r.uk_size, qty: r.quantity }));
  res.json({
    id: p.id, brand: p.brand, model: p.model, colorway: p.colorway,
    price: p.price, was: p.was_price, tag: p.tag, gender: p.gender, fit: p.fit,
    images, stock,
    sizes: stock.map(s => s.size)
  });
});

app.post('/api/orders', (req, res) => {
  const { name, phone, address, city, postcode, note, delivery, payment, items } = req.body;
  if (!name || !phone || !items || !items.length) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (delivery === 'courier' && (!address || !city)) {
    return res.status(400).json({ error: 'Address required for courier delivery' });
  }

  const ref = 'DL-' + (4000 + Math.floor(Math.random() * 5999));

  let subtotal = 0;
  const resolved = [];
  for (const item of items) {
    const p = stmts.productById.get(item.productId);
    if (!p) return res.status(400).json({ error: `Product ${item.productId} not found` });
    subtotal += p.price * item.qty;
    resolved.push({ ...item, product: p });
  }

  const deliveryCost = subtotal >= FREE_OVER ? 0 : COURIER;
  const total = subtotal + deliveryCost;

  const createOrder = db.transaction(() => {
    const { lastInsertRowid: orderId } = stmts.insertOrder.run(
      ref, name, phone, address || '', city || '', postcode || '', note || '',
      delivery || 'courier', payment || 'whatsapp', subtotal, deliveryCost, total
    );
    for (const item of resolved) {
      stmts.insertOrderItem.run(
        orderId, item.product.id, item.product.brand, item.product.model,
        item.product.colorway, item.size, item.qty, item.product.price
      );
    }
    return orderId;
  });

  const orderId = createOrder();

  const orderItems = stmts.orderItems.all(orderId);
  const lines = orderItems.map(i =>
    `• ${i.brand} ${i.model} — ${i.colorway}\n  UK ${i.uk_size} ×${i.quantity}  R${i.price_at_time.toLocaleString()}`
  ).join('\n');

  const waMsg = encodeURIComponent(
    `Hi Daylight! I'd like to order:\n\n${lines}\n\n` +
    `Subtotal: R${subtotal.toLocaleString()}\n` +
    `Courier: ${deliveryCost ? 'R' + deliveryCost : 'Free'}\n` +
    `Total: R${total.toLocaleString()}\n\n` +
    `${name} · ${phone}\nRef: ${ref}`
  );

  const waUrl = `https://wa.me/${WA}?text=${waMsg}`;

  res.json({ ref, total, subtotal, deliveryCost, waUrl, orderId });
});

app.get('/api/orders/:ref', (req, res) => {
  const order = stmts.orderByRef.get(req.params.ref.toUpperCase());
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const items = stmts.orderItems.all(order.id);
  res.json({
    ref: order.ref,
    status: order.status,
    paid: !!order.paid,
    customer: order.customer_name,
    phone: order.phone,
    delivery: order.delivery_method,
    payment: order.payment_method,
    subtotal: order.subtotal,
    deliveryCost: order.delivery_cost,
    total: order.total,
    items: items.map(i => ({
      brand: i.brand, model: i.model, colorway: i.colorway,
      size: i.uk_size, qty: i.quantity, price: i.price_at_time
    })),
    createdAt: order.created_at
  });
});

// Stripe checkout session
app.post('/api/checkout/stripe', async (req, res) => {
  if (!stripe) return res.status(400).json({ error: 'Stripe not configured. Use WhatsApp checkout.' });
  const { orderRef } = req.body;
  const order = stmts.orderByRef.get(orderRef);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const items = stmts.orderItems.all(order.id);
  const line_items = items.map(i => ({
    price_data: {
      currency: 'zar',
      product_data: { name: `${i.brand} ${i.model} — ${i.colorway} (UK ${i.uk_size})` },
      unit_amount: i.price_at_time * 100,
    },
    quantity: i.quantity,
  }));

  if (order.delivery_cost > 0) {
    line_items.push({
      price_data: {
        currency: 'zar',
        product_data: { name: 'Courier delivery' },
        unit_amount: order.delivery_cost * 100,
      },
      quantity: 1,
    });
  }

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items,
    mode: 'payment',
    success_url: `${SITE_URL}/#confirm/${orderRef}`,
    cancel_url: `${SITE_URL}/#checkout`,
    metadata: { order_ref: orderRef },
  });

  stmts.updateOrderStripe.run(session.id, order.id);
  res.json({ url: session.url });
});

app.post('/api/members', (req, res) => {
  const { name, phone, email, action } = req.body;
  if (!phone || !/[0-9]{9,}/.test(phone.replace(/\D/g, ''))) {
    return res.status(400).json({ error: 'Valid phone number required' });
  }

  if (action === 'join') {
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
    try {
      db.prepare('INSERT INTO members (name, phone, email) VALUES (?, ?, ?)').run(name.trim(), phone.trim(), email ? email.trim() : null);
    } catch (err) {
      if (err.message.includes('UNIQUE')) {
        return res.status(400).json({ error: 'This number is already a member. Try signing in instead.' });
      }
      throw err;
    }
  } else {
    const member = db.prepare('SELECT * FROM members WHERE phone = ?').get(phone.trim());
    if (!member) return res.status(404).json({ error: 'No membership found with that number. Join first?' });
  }

  const firstName = (name || '').trim().split(' ')[0] || 'there';
  const waMsg = action === 'join'
    ? encodeURIComponent(`Hi Daylight! I just joined as a member. My name is ${name.trim()}, phone: ${phone.trim()}. Looking forward to early access on drops!`)
    : encodeURIComponent(`Hi Daylight! I'm signing in as a member. My number is ${phone.trim()}.`);
  const waUrl = `https://wa.me/${WA}?text=${waMsg}`;

  res.json({ ok: true, waUrl });
});

app.get('/api/config', (req, res) => {
  res.json({
    freeOver: FREE_OVER,
    courier: COURIER,
    waNumber: WA,
    stripeEnabled: !!stripe,
  });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Daylight Sneakers running at http://localhost:${PORT}`);
    if (!stripe) console.log('Stripe not configured — WhatsApp checkout only');
  });
}

module.exports = app;
