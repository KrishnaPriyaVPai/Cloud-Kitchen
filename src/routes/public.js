const express = require('express');
const { all, get, run, addHistory } = require('../db');

const router = express.Router();

function menuQuery(where = '', params = []) {
  return all(
    `SELECT mi.*, c.name AS category_name, c.slug AS category_slug, c.emoji AS category_emoji
     FROM menu_items mi
     JOIN categories c ON c.id = mi.category_id
     ${where}
     ORDER BY c.sort_order, mi.sort_order, mi.id`,
    ...params
  );
}

router.get('/', (_req, res) => {
  const categories = all('SELECT * FROM categories ORDER BY sort_order');
  const featuredReviews = all(
    'SELECT * FROM reviews WHERE is_approved = 1 ORDER BY created_at DESC LIMIT 12'
  );

  res.render('home', {
    title: res.locals.settings.kitchen_name,
    active: 'home',
    categories,
    featuredReviews
  });
});

router.get('/about', (_req, res) => {
  res.render('about', { title: 'About Us', active: 'about' });
});

router.get('/menu', (req, res) => {
  const { category, veg, nonveg, q } = req.query;
  const clauses = ['mi.is_available = 1'];
  const params = [];

  if (category && /^[a-z0-9-]+$/.test(String(category))) {
    clauses.push('c.slug = ?');
    params.push(String(category));
  }
  if (veg === '1' && nonveg !== '1') clauses.push('mi.is_veg = 1');
  if (nonveg === '1' && veg !== '1') clauses.push('mi.is_veg = 0');
  if (q && String(q).trim()) {
    clauses.push('(mi.name LIKE ? OR mi.description LIKE ?)');
    const term = `%${String(q).trim()}%`;
    params.push(term, term);
  }

  const items = menuQuery(`WHERE ${clauses.join(' AND ')}`, params);
  const categories = all('SELECT * FROM categories ORDER BY sort_order');

  res.render('menu', {
    title: 'Our Menu',
    active: 'menu',
    items,
    categories,
    filters: { category: category || '', veg: veg === '1', nonveg: nonveg === '1', q: q || '' }
  });
});

router.get('/contact', (_req, res) => {
  res.render('contact', { title: 'Contact Us', active: 'contact' });
});

router.post('/contact', (req, res) => {
  const { name, email, phone, subject, message } = req.body;
  if (!name || !email || !message || !/^\S+@\S+\.\S+$/.test(email)) {
    req.flash('error', 'Please fill in your name, a valid email and your message.');
    return res.redirect('/contact');
  }
  run(
    'INSERT INTO contact_messages (name, email, phone, subject, message) VALUES (?, ?, ?, ?, ?)',
    String(name).trim(),
    String(email).trim(),
    phone ? String(phone).trim() : null,
    subject ? String(subject).trim() : null,
    String(message).trim()
  );
  req.flash('success', 'Thanks for reaching out! We will get back to you shortly.');
  res.redirect('/contact');
});

router.get('/track', (req, res) => {
  const orderNumber = req.query.order ? String(req.query.order).trim() : '';
  const phone = req.query.phone ? String(req.query.phone).trim() : '';
  let order = null;
  let items = [];
  let history = [];
  let error = '';

  if (orderNumber && phone) {
    order = get(
      `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone, c.address,
              u.name AS delivery_name, u.phone AS delivery_phone
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       LEFT JOIN users u ON u.id = o.delivery_boy_id
       WHERE o.order_number = ?`,
      orderNumber
    );
    if (!order || order.customer_phone.replace(/\D/g, '') !== phone.replace(/\D/g, '')) {
      order = null;
      error = 'We could not find that order. Check the order number and the phone number used at checkout.';
    } else {
      items = all('SELECT * FROM order_items WHERE order_id = ?', order.id);
      history = all('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY id DESC', order.id);
    }
  }

  res.render('track', {
    title: 'Track Your Order',
    active: 'track',
    orderNumber,
    phone,
    order,
    items,
    history,
    error
  });
});

module.exports = router;
