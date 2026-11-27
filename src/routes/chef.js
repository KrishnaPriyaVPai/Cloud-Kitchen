const express = require('express');
const { all, get, run, addHistory, allSettings } = require('../db');
const upload = require('../upload');
const { hashPassword, verifyPassword } = require('../security');
const { requireRole } = require('../middleware');

const router = express.Router();
router.use(requireRole('chef'));

const ORDER_SELECT = `
  SELECT o.*, c.name AS customer_name, c.phone AS customer_phone, c.address,
         u.name AS delivery_name, u.phone AS delivery_phone,
         (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  LEFT JOIN users u ON u.id = o.delivery_boy_id
`;

function getOrder(id) {
  return get(`${ORDER_SELECT} WHERE o.id = ?`, id);
}

function orderLines(id) {
  return all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', id);
}

function orderHistory(id) {
  return all('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY id DESC', id);
}

function deliveryBoys() {
  return all("SELECT id, name, email, phone, vehicle, is_active FROM users WHERE role = 'delivery' ORDER BY name");
}

function redirectBack(res, url) {
  res.redirect(url);
}

function safeOfferLink(value) {
  const link = String(value || '').trim();
  return /^(https?:\/\/|\/)/i.test(link) ? link : '/menu';
}

function safeAssetUrl(value, fallback = '') {
  const url = String(value || '').trim();
  return /^(https?:\/\/|\/)/i.test(url) ? url : fallback;
}

function offerPayload(body, file, existing = null) {
  return {
    title: String(body.title || '').trim(),
    text: String(body.text || '').trim(),
    background_image_url: file
      ? `/uploads/${file.filename}`
      : safeAssetUrl(body.background_image_url, existing ? existing.background_image_url : ''),
    link: body.link === undefined && existing ? existing.link : safeOfferLink(body.link),
    is_active: body.is_active ? 1 : 0,
    sort_order: Number(body.sort_order) || 0
  };
}

function validateOffer(payload) {
  if (!payload.title) return 'Please enter an offer title.';
  if (!payload.background_image_url) return 'Please provide a background image URL or upload an image.';
  return null;
}

router.get('/', (_req, res) => {
  const stats = {
    pending: get("SELECT COUNT(*) AS count FROM orders WHERE status = 'pending'").count,
    active: get("SELECT COUNT(*) AS count FROM orders WHERE status IN ('accepted','assigned','picked_up','on_the_way')").count,
    today: get("SELECT COUNT(*) AS count FROM orders WHERE date(created_at) = date('now')").count,
    revenue: get("SELECT COALESCE(SUM(total),0) AS total FROM orders WHERE date(created_at) = date('now') AND status != 'rejected'").total,
    menu: get('SELECT COUNT(*) AS count FROM menu_items').count,
    available: get('SELECT COUNT(*) AS count FROM menu_items WHERE is_available = 1').count,
    reviews: get('SELECT COUNT(*) AS count FROM reviews WHERE is_approved = 0').count,
    messages: get('SELECT COUNT(*) AS count FROM contact_messages WHERE is_read = 0').count,
    riders: get("SELECT COUNT(*) AS count FROM users WHERE role = 'delivery' AND is_active = 1").count
  };

  const recentOrders = all(`${ORDER_SELECT} ORDER BY o.id DESC LIMIT 6`);
  const topItems = all(
    `SELECT mi.name, mi.image_url, COUNT(oi.id) AS times_ordered
     FROM order_items oi JOIN menu_items mi ON mi.id = oi.menu_item_id
     GROUP BY mi.id ORDER BY times_ordered DESC, mi.id LIMIT 5`
  );

  res.render('chef/dashboard', { title: 'Kitchen Dashboard', active: 'chef', stats, recentOrders, topItems });
});

router.get('/menu', (_req, res) => {
  const items = all(
    `SELECT mi.*, c.name AS category_name
     FROM menu_items mi JOIN categories c ON c.id = mi.category_id
     ORDER BY c.sort_order, mi.sort_order, mi.id`
  );
  res.render('chef/menu', { title: 'Manage Menu', active: 'chef-menu', items });
});

router.get('/menu/new', (_req, res) => {
  const categories = all('SELECT * FROM categories ORDER BY sort_order');
  res.render('chef/menu-form', {
    title: 'Add Menu Item',
    active: 'chef-menu',
    item: null,
    categories,
    action: '/chef/menu'
  });
});

router.get('/menu/:id/edit', (req, res) => {
  const item = get('SELECT * FROM menu_items WHERE id = ?', req.params.id);
  if (!item) {
    req.flash('error', 'Menu item not found.');
    return res.redirect('/chef/menu');
  }
  const categories = all('SELECT * FROM categories ORDER BY sort_order');
  res.render('chef/menu-form', {
    title: `Edit ${item.name}`,
    active: 'chef-menu',
    item,
    categories,
    action: `/chef/menu/${item.id}`
  });
});

function menuPayload(body, file) {
  return {
    category_id: Number(body.category_id),
    name: String(body.name || '').trim(),
    description: String(body.description || '').trim(),
    price: Number(body.price),
    image_url: file ? `/uploads/${file.filename}` : String(body.image_url || '').trim(),
    is_veg: body.is_veg ? 1 : 0,
    is_popular: body.is_popular ? 1 : 0,
    is_available: body.is_available ? 1 : 0,
    spice_level: Number(body.spice_level),
    prep_minutes: Number(body.prep_minutes),
    sort_order: Number(body.sort_order) || 0
  };
}

function validateMenu(payload) {
  if (!payload.name || !payload.description || !Number.isInteger(payload.price) || payload.price < 0) {
    return 'Please enter a name, description and a valid whole-number price.';
  }
  if (!get('SELECT id FROM categories WHERE id = ?', payload.category_id)) {
    return 'Please choose a valid category.';
  }
  if (!payload.image_url) return 'Please provide an image URL or upload an image.';
  if (!Number.isInteger(payload.prep_minutes) || payload.prep_minutes < 1) {
    return 'Preparation time must be at least 1 minute.';
  }
  return null;
}

router.post('/menu', upload.single('image'), (req, res) => {
  const payload = menuPayload(req.body, req.file);
  const error = validateMenu(payload);
  if (error) {
    req.flash('error', error);
    return redirectBack(res, '/chef/menu/new');
  }
  run(
    `INSERT INTO menu_items
      (category_id, name, description, price, image_url, is_veg, is_popular, is_available, spice_level, prep_minutes, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    payload.category_id, payload.name, payload.description, payload.price, payload.image_url,
    payload.is_veg, payload.is_popular, payload.is_available, payload.spice_level, payload.prep_minutes, payload.sort_order
  );
  req.flash('success', `${payload.name} added to the menu.`);
  res.redirect('/chef/menu');
});

router.post('/menu/:id', upload.single('image'), (req, res) => {
  const existing = get('SELECT * FROM menu_items WHERE id = ?', req.params.id);
  if (!existing) {
    req.flash('error', 'Menu item not found.');
    return res.redirect('/chef/menu');
  }
  const payload = menuPayload(req.body, req.file);
  const error = validateMenu(payload);
  if (error) {
    req.flash('error', error);
    return res.redirect(`/chef/menu/${existing.id}/edit`);
  }
  run(
    `UPDATE menu_items SET
      category_id = ?, name = ?, description = ?, price = ?, image_url = ?, is_veg = ?,
      is_popular = ?, is_available = ?, spice_level = ?, prep_minutes = ?, sort_order = ?,
      updated_at = datetime('now')
     WHERE id = ?`,
    payload.category_id, payload.name, payload.description, payload.price, payload.image_url,
    payload.is_veg, payload.is_popular, payload.is_available, payload.spice_level,
    payload.prep_minutes, payload.sort_order, existing.id
  );
  req.flash('success', `${payload.name} updated.`);
  res.redirect('/chef/menu');
});

router.post('/menu/:id/toggle', (req, res) => {
  const item = get('SELECT id, name, is_available FROM menu_items WHERE id = ?', req.params.id);
  if (!item) return res.redirect('/chef/menu');
  run('UPDATE menu_items SET is_available = ?, updated_at = datetime(\'now\') WHERE id = ?', item.is_available ? 0 : 1, item.id);
  req.flash('success', `${item.name} marked ${item.is_available ? 'unavailable' : 'available'}.`);
  res.redirect('/chef/menu');
});

router.post('/menu/:id/delete', (req, res) => {
  const item = get('SELECT id, name FROM menu_items WHERE id = ?', req.params.id);
  if (!item) return res.redirect('/chef/menu');
  run('DELETE FROM menu_items WHERE id = ?', item.id);
  req.flash('success', `${item.name} removed from the menu.`);
  res.redirect('/chef/menu');
});

router.get('/orders', (req, res) => {
  const status = String(req.query.status || '');
  const q = String(req.query.q || '').trim();
  const clauses = [];
  const params = [];
  if (status) {
    clauses.push('o.status = ?');
    params.push(status);
  }
  if (q) {
    clauses.push('(o.order_number LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)');
    const term = `%${q}%`;
    params.push(term, term, term);
  }
  const orders = all(
    `${ORDER_SELECT} ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY o.id DESC`,
    ...params
  );
  const counts = Object.fromEntries(
    all('SELECT status, COUNT(*) AS count FROM orders GROUP BY status').map((r) => [r.status, r.count])
  );
  res.render('chef/orders', {
    title: 'Customer Orders',
    active: 'chef-orders',
    orders,
    counts,
    status,
    q
  });
});

router.get('/orders/:id', (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) {
    req.flash('error', 'Order not found.');
    return res.redirect('/chef/orders');
  }
  res.render('chef/order-detail', {
    title: `Order ${order.order_number}`,
    active: 'chef-orders',
    order,
    items: orderLines(order.id),
    history: orderHistory(order.id),
    riders: deliveryBoys()
  });
});

function setStatus(order, status, actor, note) {
  run('UPDATE orders SET status = ?, updated_at = datetime(\'now\') WHERE id = ?', status, order.id);
  addHistory(order.id, status, note, actor);
}

router.post('/orders/:id/accept', (req, res) => {
  const order = getOrder(req.params.id);
  if (!order || order.status !== 'pending') {
    req.flash('error', 'Only pending orders can be accepted.');
    return res.redirect('/chef/orders');
  }
  run(
    'UPDATE orders SET status = \'accepted\', accepted_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?',
    order.id
  );
  addHistory(order.id, 'accepted', 'Order accepted by chef', 'chef');
  req.flash('success', `Order ${order.order_number} accepted. Assign a delivery partner now.`);
  res.redirect(`/chef/orders/${order.id}`);
});

router.post('/orders/:id/reject', (req, res) => {
  const order = getOrder(req.params.id);
  if (!order || !['pending', 'accepted'].includes(order.status)) {
    req.flash('error', 'This order can no longer be rejected.');
    return res.redirect('/chef/orders');
  }
  setStatus(order, 'rejected', 'chef', req.body.reason ? `Rejected: ${req.body.reason}` : 'Order rejected by chef');
  req.flash('success', `Order ${order.order_number} rejected.`);
  res.redirect(`/chef/orders/${order.id}`);
});

router.post('/orders/:id/assign', (req, res) => {
  const order = getOrder(req.params.id);
  if (!order || !['accepted', 'assigned'].includes(order.status)) {
    req.flash('error', 'Only accepted orders can be assigned.');
    return res.redirect('/chef/orders');
  }
  const riderId = Number(req.body.delivery_boy_id);
  if (!riderId || !get("SELECT id FROM users WHERE id = ? AND role = 'delivery' AND is_active = 1", riderId)) {
    req.flash('error', 'Please choose an active delivery partner.');
    return res.redirect(`/chef/orders/${order.id}`);
  }
  run('UPDATE orders SET delivery_boy_id = ?, status = \'assigned\', updated_at = datetime(\'now\') WHERE id = ?', riderId, order.id);
  addHistory(order.id, 'assigned', 'Delivery partner assigned by chef', 'chef');
  req.flash('success', 'Delivery partner assigned. They can see this order now.');
  res.redirect(`/chef/orders/${order.id}`);
});

router.post('/orders/:id/unassign', (req, res) => {
  const order = getOrder(req.params.id);
  if (!order || order.status !== 'assigned') return res.redirect('/chef/orders');
  run('UPDATE orders SET delivery_boy_id = NULL, status = \'accepted\', updated_at = datetime(\'now\') WHERE id = ?', order.id);
  addHistory(order.id, 'accepted', 'Delivery assignment removed', 'chef');
  req.flash('success', 'Delivery partner removed from this order.');
  res.redirect(`/chef/orders/${order.id}`);
});

router.post('/orders/:id/status', (req, res) => {
  const order = getOrder(req.params.id);
  const allowed = ['accepted', 'assigned', 'picked_up', 'on_the_way', 'delivered', 'cancelled'];
  const status = String(req.body.status || '');
  if (!order || !allowed.includes(status)) {
    req.flash('error', 'Invalid status update.');
    return res.redirect('/chef/orders');
  }
  if (status === 'assigned' && !order.delivery_boy_id) {
    req.flash('error', 'Assign a delivery partner before marking this as assigned.');
    return res.redirect(`/chef/orders/${order.id}`);
  }
  run(
    'UPDATE orders SET status = ?, delivered_at = ?, updated_at = datetime(\'now\') WHERE id = ?',
    status,
    status === 'delivered' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : order.delivered_at,
    order.id
  );
  addHistory(order.id, status, req.body.note ? `Chef note: ${req.body.note}` : 'Status updated by chef', 'chef');
  req.flash('success', `Order status updated to ${status.replace(/_/g, ' ')}.`);
  res.redirect(`/chef/orders/${order.id}`);
});

router.get('/reviews', (_req, res) => {
  const reviews = all('SELECT * FROM reviews ORDER BY is_approved, created_at DESC');
  res.render('chef/reviews', { title: 'Review Moderation', active: 'chef-reviews', reviews });
});

router.post('/reviews/:id/toggle', (req, res) => {
  const review = get('SELECT id, is_approved FROM reviews WHERE id = ?', req.params.id);
  if (review) {
    run('UPDATE reviews SET is_approved = ? WHERE id = ?', review.is_approved ? 0 : 1, review.id);
    req.flash('success', review.is_approved ? 'Review hidden from the website.' : 'Review approved and published.');
  }
  res.redirect('/chef/reviews');
});

router.post('/reviews/:id/delete', (req, res) => {
  run('DELETE FROM reviews WHERE id = ?', req.params.id);
  req.flash('success', 'Review deleted.');
  res.redirect('/chef/reviews');
});

router.get('/staff', (_req, res) => {
  const staff = all("SELECT * FROM users ORDER BY role, name");
  res.render('chef/staff', { title: 'Delivery Partners', active: 'chef-staff', staff });
});

router.post('/staff', (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const phone = String(req.body.phone || '').trim();
  const vehicle = String(req.body.vehicle || '').trim();

  if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
    req.flash('error', 'Enter a name, valid email and a password of at least 8 characters.');
    return res.redirect('/chef/staff');
  }
  if (get('SELECT id FROM users WHERE email = ?', email)) {
    req.flash('error', 'An account with that email already exists.');
    return res.redirect('/chef/staff');
  }
  run(
    "INSERT INTO users (name, email, password_hash, role, phone, vehicle) VALUES (?, ?, ?, 'delivery', ?, ?)",
    name, email, hashPassword(password), phone || null, vehicle || null
  );
  req.flash('success', `${name} can now sign in as a delivery partner.`);
  res.redirect('/chef/staff');
});

router.post('/staff/:id/toggle', (req, res) => {
  const user = get("SELECT * FROM users WHERE id = ? AND role = 'delivery'", req.params.id);
  if (user) {
    run('UPDATE users SET is_active = ? WHERE id = ?', user.is_active ? 0 : 1, user.id);
    req.flash('success', `${user.name} ${user.is_active ? 'deactivated' : 'activated'}.`);
  }
  res.redirect('/chef/staff');
});

router.get('/messages', (_req, res) => {
  const messages = all('SELECT * FROM contact_messages ORDER BY is_read, id DESC');
  res.render('chef/messages', { title: 'Contact Messages', active: 'chef-messages', messages });
});

router.post('/messages/:id/read', (req, res) => {
  run('UPDATE contact_messages SET is_read = 1 WHERE id = ?', req.params.id);
  res.redirect('/chef/messages');
});

router.post('/messages/:id/delete', (req, res) => {
  run('DELETE FROM contact_messages WHERE id = ?', req.params.id);
  req.flash('success', 'Message deleted.');
  res.redirect('/chef/messages');
});

router.get('/settings', (_req, res) => {
  res.render('chef/settings', { title: 'Kitchen Settings', active: 'chef-settings' });
});

router.post('/settings', (req, res) => {
  const allowed = [
    'kitchen_name', 'short_name', 'tagline', 'phone', 'email', 'address',
    'opening_hours', 'chef_name', 'chef_bio', 'about_story', 'instagram', 'map_query'
  ];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        key,
        String(req.body[key]).trim()
      );
    }
  }
  req.flash('success', 'Kitchen details updated.');
  res.redirect('/chef/settings');
});

router.post(
  '/branding',
  upload.fields([{ name: 'logo_file', maxCount: 1 }, { name: 'favicon_file', maxCount: 1 }]),
  (req, res) => {
    const current = allSettings();
    const logoFile = req.files && req.files.logo_file && req.files.logo_file[0];
    const faviconFile = req.files && req.files.favicon_file && req.files.favicon_file[0];
    const logoValue = logoFile
      ? `/uploads/${logoFile.filename}`
      : safeAssetUrl(req.body.logo_url, current.logo_url || '/cloudkitchen-icon.png');
    const faviconInput = String(req.body.favicon_url || '').trim();
    const faviconValue = faviconFile
      ? `/uploads/${faviconFile.filename}`
      : faviconInput
        ? safeAssetUrl(faviconInput, current.favicon_url || logoValue)
        : logoValue;

    const values = [
      ['meta_title', String(req.body.meta_title || '').trim() || current.meta_title || 'Cloud Kitchen'],
      ['meta_description', String(req.body.meta_description || '').trim() || current.meta_description || ''],
      ['logo_url', logoValue],
      ['favicon_url', faviconValue]
    ];
    for (const [key, value] of values) {
      run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        key,
        value
      );
    }
    req.flash('success', 'Title, description, logo and favicon updated.');
    res.redirect('/chef/settings');
  }
);

router.get('/offers', (_req, res) => {
  const offers = all('SELECT * FROM offers ORDER BY sort_order, id');
  res.render('chef/offers', { title: 'Offer Space', active: 'chef-offers', offers });
});

router.get('/offers/new', (_req, res) => {
  res.render('chef/offer-form', {
    title: 'Add Offer',
    active: 'chef-offers',
    offer: null,
    action: '/chef/offers'
  });
});

router.get('/offers/:id/edit', (req, res) => {
  const offer = get('SELECT * FROM offers WHERE id = ?', req.params.id);
  if (!offer) {
    req.flash('error', 'Offer not found.');
    return res.redirect('/chef/offers');
  }
  res.render('chef/offer-form', {
    title: `Edit ${offer.title}`,
    active: 'chef-offers',
    offer,
    action: `/chef/offers/${offer.id}`
  });
});

router.post('/offers', upload.single('background_image'), (req, res) => {
  const payload = offerPayload(req.body, req.file);
  const error = validateOffer(payload);
  if (error) {
    req.flash('error', error);
    return res.redirect('/chef/offers/new');
  }
  run(
    `INSERT INTO offers (title, text, background_image_url, link, is_active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
    payload.title, payload.text, payload.background_image_url,
    payload.link, payload.is_active, payload.sort_order
  );
  req.flash('success', `${payload.title} added to the offer space.`);
  res.redirect('/chef/offers');
});

router.post('/offers/:id', upload.single('background_image'), (req, res) => {
  const existing = get('SELECT * FROM offers WHERE id = ?', req.params.id);
  if (!existing) {
    req.flash('error', 'Offer not found.');
    return res.redirect('/chef/offers');
  }
  const payload = offerPayload(req.body, req.file, existing);
  const error = validateOffer(payload);
  if (error) {
    req.flash('error', error);
    return res.redirect(`/chef/offers/${existing.id}/edit`);
  }
  run(
    `UPDATE offers SET title = ?, text = ?, background_image_url = ?, link = ?,
      is_active = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?`,
    payload.title, payload.text, payload.background_image_url, payload.link,
    payload.is_active, payload.sort_order, existing.id
  );
  req.flash('success', `${payload.title} updated.`);
  res.redirect('/chef/offers');
});

router.post('/offers/:id/toggle', (req, res) => {
  const offer = get('SELECT id, title, is_active FROM offers WHERE id = ?', req.params.id);
  if (!offer) return res.redirect('/chef/offers');
  run('UPDATE offers SET is_active = ?, updated_at = datetime(\'now\') WHERE id = ?', offer.is_active ? 0 : 1, offer.id);
  req.flash('success', `${offer.title} ${offer.is_active ? 'hidden' : 'shown'} on the website.`);
  res.redirect('/chef/offers');
});

router.post('/offers/:id/delete', (req, res) => {
  const offer = get('SELECT id, title FROM offers WHERE id = ?', req.params.id);
  if (!offer) return res.redirect('/chef/offers');
  run('DELETE FROM offers WHERE id = ?', offer.id);
  req.flash('success', `${offer.title} removed from the offer space.`);
  res.redirect('/chef/offers');
});

router.post('/offerspace', upload.single('offerspace_bg_image'), (req, res) => {
  const requestedPerView = String(req.body.offers_per_view || '1');
  const perView = ['1', '2', '3', '4', 'all'].includes(requestedPerView) ? requestedPerView : '1';
  const background = req.file
    ? `/uploads/${req.file.filename}`
    : safeAssetUrl(req.body.offerspace_bg_image_url, '');

  const values = [
    ['offerspace_enabled', req.body.offerspace_enabled ? '1' : '0'],
    ['offers_per_view', perView],
    ['offerspace_bg_image_url', background]
  ];
  for (const [key, value] of values) {
    run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value
    );
  }
  req.flash('success', 'Offer space settings updated.');
  res.redirect('/chef/offers');
});

router.post('/password', (req, res) => {
  const current = String(req.body.current_password || '');
  const next = String(req.body.new_password || '');
  const user = get('SELECT * FROM users WHERE id = ?', req.session.user.id);
  if (!verifyPassword(current, user.password_hash)) {
    req.flash('error', 'Your current password is incorrect.');
  } else if (next.length < 8) {
    req.flash('error', 'New password must be at least 8 characters.');
  } else {
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), user.id);
    req.flash('success', 'Password changed successfully.');
  }
  res.redirect('/chef/settings');
});

module.exports = router;
