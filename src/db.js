const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('./security');

const rootDir = path.join(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const uploadsDir = path.join(rootDir, 'public', 'uploads');

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'cloudkitchen.db'));

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    expires INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('chef', 'delivery')),
    phone TEXT,
    vehicle TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    emoji TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    price INTEGER NOT NULL CHECK (price >= 0),
    image_url TEXT NOT NULL,
    is_veg INTEGER NOT NULL DEFAULT 0,
    is_popular INTEGER NOT NULL DEFAULT 0,
    is_available INTEGER NOT NULL DEFAULT 1,
    spice_level INTEGER NOT NULL DEFAULT 1 CHECK (spice_level BETWEEN 0 AND 3),
    prep_minutes INTEGER NOT NULL DEFAULT 20,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    address TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT NOT NULL UNIQUE,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    total INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    delivery_boy_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT,
    payment_method TEXT NOT NULL DEFAULT 'cod',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    accepted_at TEXT,
    delivered_at TEXT
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    image_url TEXT
  );

  CREATE TABLE IF NOT EXISTS order_status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    note TEXT,
    actor TEXT NOT NULL DEFAULT 'system',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    title TEXT,
    comment TEXT NOT NULL,
    is_approved INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    subject TEXT,
    message TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_delivery ON orders(delivery_boy_id);
  CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
  CREATE INDEX IF NOT EXISTS idx_history_order ON order_status_history(order_id);
  CREATE INDEX IF NOT EXISTS idx_menu_category ON menu_items(category_id);
`);

function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}

function get(sql, ...params) {
  return db.prepare(sql).get(...params);
}

function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}

function setting(key, fallback = '') {
  const row = get('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : fallback;
}

function allSettings() {
  return Object.fromEntries(all('SELECT key, value FROM settings').map((r) => [r.key, r.value]));
}

function addHistory(orderId, status, note, actor) {
  run(
    'INSERT INTO order_status_history (order_id, status, note, actor) VALUES (?, ?, ?, ?)',
    orderId,
    status,
    note || null,
    actor || 'system'
  );
}

function sqlAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

function seed() {
  const userCount = get('SELECT COUNT(*) AS count FROM users').count;
  if (userCount > 0) return;

  const defaults = {
    kitchen_name: 'Cloud Kitchen',
    short_name: 'Cloud Kitchen',
    tagline: 'Freshly cooked. Delivered warm.',
    phone: '+91 98450 12345',
    email: 'hello@cloudplate.in',
    address: '42, 2nd Cross, Indiranagar, Bengaluru, Karnataka 560038',
    opening_hours: 'Open daily · 11:00 AM – 11:00 PM',
    chef_name: 'Chef Arjun Rao',
    chef_bio:
      'Chef Arjun started CloudPlate with one simple idea: restaurant-quality food should reach your doorstep hot, honest and made with care. With 14 years across busy hotel kitchens, he still tastes every batch before it leaves ours.',
    about_story:
      'We are a delivery-first kitchen built around a compact, obsessive team. No noisy dining room, no long waits — just a clean kitchen, fresh ingredients and food cooked to order. Every dish is packed the moment it is ready so it arrives the way it was meant to be eaten.',
    instagram: 'https://instagram.com',
    map_query: 'Indiranagar, Bengaluru, Karnataka 560038'
  };

  for (const [key, value] of Object.entries(defaults)) {
    run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', key, value);
  }

  const categories = [
    ['Biryani & Rice', 'biryani', '🍚', 1],
    ['Pizzas', 'pizzas', '🍕', 2],
    ['Burgers', 'burgers', '🍔', 3],
    ['Mains', 'mains', '🍝', 4],
    ['Healthy Bowls', 'bowls', '🥗', 5],
    ['Sides', 'sides', '🍟', 6],
    ['Desserts', 'desserts', '🍰', 7],
    ['Drinks', 'drinks', '🥤', 8]
  ];
  for (const [name, slug, emoji, sort] of categories) {
    run('INSERT OR IGNORE INTO categories (name, slug, emoji, sort_order) VALUES (?, ?, ?, ?)', name, slug, emoji, sort);
  }

  run(
    `INSERT INTO users (name, email, password_hash, role, phone) VALUES (?, ?, ?, 'chef', ?)`,
    'Chef Arjun Rao',
    'chef@cloudplate.in',
    hashPassword('Chef@1234'),
    '+91 98450 12345'
  );
  run(
    `INSERT INTO users (name, email, password_hash, role, phone, vehicle) VALUES (?, ?, ?, 'delivery', ?, ?)`,
    'Ravi Kumar',
    'ravi@cloudplate.in',
    hashPassword('Ravi@1234'),
    '+91 98765 11111',
    'Honda Activa · KA 03 AB 1234'
  );
  run(
    `INSERT INTO users (name, email, password_hash, role, phone, vehicle) VALUES (?, ?, ?, 'delivery', ?, ?)`,
    'Suresh B.',
    'suresh@cloudplate.in',
    hashPassword('Suresh@1234'),
    '+91 98765 22222',
    'Bajaj Pulsar · KA 03 CD 5678'
  );

  const img = (id) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=900&q=80`;

  const items = [
    [1, 'Hyderabadi Chicken Biryani', 'Long-grain basmati layered with tender chicken, saffron and our secret blend of spices. Served with raita.', 349, img('1563379091339-03b21ab4a4f8'), 0, 1, 1, 2, 30, 1],
    [1, 'Paneer Tikka Biryani', 'Char-grilled paneer tikka folded into fragrant rice with mint, coriander and a hint of smoke.', 319, img('1606491956689-2ea866880c84'), 1, 1, 1, 1, 28, 2],
    [1, 'Veg Dum Biryani', 'Seasonal vegetables, herbs and slow-cooked masala sealed under a dough lid for that classic dum aroma.', 279, img('1563379091339-03b21ab4a4f8'), 1, 0, 1, 1, 25, 3],
    [2, 'Margherita Pizza', 'Hand-stretched sourdough base, San Marzano tomato, fresh mozzarella and torn basil. Baked stone-hot.', 329, img('1574071318508-1cdbab80d002'), 1, 1, 1, 0, 22, 4],
    [2, 'Chicken Pepperoni Pizza', 'A generous layer of pepperoni, mozzarella and our smoky tomato sauce on a crisp thin crust.', 399, img('1628840042765-356cda07504e'), 0, 1, 1, 2, 25, 5],
    [3, 'Classic Chicken Burger', 'Juicy grilled chicken, crunchy lettuce, tomato and house mayo in a toasted brioche bun.', 259, img('1568901346375-23c9450c58cd'), 0, 1, 1, 1, 18, 6],
    [3, 'Crispy Veg Burger', 'Golden potato and corn patty with cheese, pickles and tangy sauce. A proper comfort bite.', 229, img('1586190848861-99aa4a171e90'), 1, 0, 1, 1, 18, 7],
    [4, 'Creamy Alfredo Pasta', 'Penne tossed in a silky parmesan cream sauce with garlic, black pepper and fresh herbs.', 299, img('1473093295043-cdd812d0e601'), 1, 1, 1, 0, 20, 8],
    [4, 'Butter Chicken', 'Tandoori chicken simmered in a velvety tomato-butter gravy. Best with rice or warm naan.', 369, img('1603894584373-5ac82b2ae398'), 0, 1, 1, 1, 28, 9],
    [5, 'Rainbow Protein Bowl', 'Quinoa, roasted veggies, chickpeas, avocado and lemon-tahini dressing. Light but properly filling.', 329, img('1546069901-ba9599a7e63c'), 1, 1, 1, 0, 15, 10],
    [5, 'Garden Fresh Salad', 'Crisp greens, cherry tomato, cucumber, feta and a bright vinaigrette made in house.', 249, img('1512621776951-a57141f2eefd'), 1, 0, 1, 0, 12, 11],
    [6, 'Truffle Cheese Fries', 'Hand-cut fries tossed with truffle oil, parmesan and parsley. Addictively good.', 189, img('1573080496219-bb080dd4f877'), 1, 1, 1, 0, 12, 12],
    [7, 'Fudge Brownie', 'Dense dark chocolate brownie with a warm gooey centre. Served with a scoop of vanilla.', 179, img('1606313564200-e75d5e30476c'), 1, 1, 1, 0, 10, 13],
    [7, 'New York Cheesecake', 'Baked to a silky finish with a buttery biscuit base and a glossy berry topping.', 199, img('1533134242443-d4fd215305ad'), 1, 0, 1, 0, 10, 14],
    [8, 'House Lemonade', 'Fresh lemon, mint and just enough sweetness. Chilled and poured over ice.', 99, img('1497534446932-c925b458314e'), 1, 1, 1, 0, 5, 15],
    [8, 'Cold Brew Coffee', 'Slow-steeped for 18 hours, smooth and low on acidity. Served over ice.', 129, img('1509042239860-f550ce710b93'), 1, 0, 1, 0, 5, 16]
  ];

  for (const item of items) {
    run(
      `INSERT INTO menu_items
        (category_id, name, description, price, image_url, is_veg, is_popular, is_available, spice_level, prep_minutes, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ...item
    );
  }

  const reviews = [
    ['Ananya M.', 5, 'Finally, biryani that travels well!', 'The Hyderabadi biryani arrived hot and the raita was still cool. You can tell they actually care about packing. Ordered twice this week already.', 1, 48 * 60],
    ['Vikram S.', 5, 'Consistently excellent', 'The margherita pizza has a proper sourdough base and the cheesecake is genuinely good. Delivery was quicker than the estimate too.', 1, 96 * 60],
    ['Meera K.', 4, 'Great vegetarian options', 'Loved the paneer tikka biryani and the rainbow bowl. slightly generous spice for me but full of flavour. Will order again.', 1, 144 * 60],
    ['Rahul D.', 5, 'My new go-to lunch spot', 'Ordered the butter chicken and fries for a team lunch. Everyone asked where it came from. Packaging was neat and leak-proof.', 1, 216 * 60]
  ];
  for (const [name, rating, title, comment, approved, minutesAgo] of reviews) {
    run(
      `INSERT INTO reviews (name, rating, title, comment, is_approved, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      name, rating, title, comment, approved, sqlAgo(minutesAgo)
    );
  }

  // A few sample orders so the dashboards are useful on first run.
  const sampleOrders = [
    {
      customer: ['Divya Nair', '+91 99000 11111', 'divya@example.com', '18, 5th Main, Indiranagar, Bengaluru'],
      status: 'pending',
      items: [[1, 1], [15, 2]],
      ago: 35
    },
    {
      customer: ['Karan Mehta', '+91 99000 22222', 'karan@example.com', '7, 100 Feet Road, Koramangala, Bengaluru'],
      status: 'assigned',
      delivery: 2,
      items: [[4, 1], [11, 1], [13, 2]],
      ago: 120
    },
    {
      customer: ['Priya Shah', '+91 99000 33333', 'priya@example.com', '22, Church Street, Bengaluru'],
      status: 'delivered',
      delivery: 2,
      items: [[9, 2], [12, 1]],
      ago: 300
    }
  ];

  for (const sample of sampleOrders) {
    const [name, phone, email, address] = sample.customer;
    const createdAt = sqlAgo(sample.ago);
    const cust = run(
      'INSERT INTO customers (name, phone, email, address, created_at) VALUES (?, ?, ?, ?, ?)',
      name, phone, email, address, createdAt
    );
    let total = 0;
    const lines = sample.items.map(([itemId, qty]) => {
      const item = get('SELECT * FROM menu_items WHERE id = ?', itemId);
      total += item.price * qty;
      return [itemId, item.name, item.price, qty, item.image_url];
    });
    const number = `CK-DEMO-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const order = run(
      `INSERT INTO orders
        (order_number, customer_id, total, status, delivery_boy_id, notes, created_at, updated_at, accepted_at, delivered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      number,
      cust.lastInsertRowid,
      total,
      sample.status,
      sample.delivery || null,
      'Sample order for dashboard preview',
      createdAt,
      createdAt,
      sample.status === 'pending' ? null : new Date().toISOString().slice(0, 19).replace('T', ' '),
      sample.status === 'delivered' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null
    );
    for (const line of lines) {
      run(
        'INSERT INTO order_items (order_id, menu_item_id, name, price, quantity, image_url) VALUES (?, ?, ?, ?, ?, ?)',
        order.lastInsertRowid, ...line
      );
    }
    addHistory(order.lastInsertRowid, 'pending', 'Order placed', 'customer');
    if (sample.status !== 'pending') addHistory(order.lastInsertRowid, 'accepted', 'Order accepted by chef', 'chef');
    if (sample.delivery) addHistory(order.lastInsertRowid, 'assigned', 'Assigned to delivery partner', 'chef');
    if (sample.status === 'delivered') {
      addHistory(order.lastInsertRowid, 'picked_up', 'Picked up from kitchen', 'delivery');
      addHistory(order.lastInsertRowid, 'on_the_way', 'On the way', 'delivery');
      addHistory(order.lastInsertRowid, 'delivered', 'Delivered to customer', 'delivery');
    }
  }
}

seed();

module.exports = {
  db,
  all,
  get,
  run,
  setting,
  allSettings,
  addHistory,
  dataDir,
  uploadsDir
};
