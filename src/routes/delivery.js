const express = require('express');
const { all, get, run, addHistory } = require('../db');
const { hashPassword, verifyPassword } = require('../security');
const { requireRole } = require('../middleware');

const router = express.Router();
router.use(requireRole('delivery'));

const ORDER_SELECT = `
  SELECT o.*, c.name AS customer_name, c.phone AS customer_phone, c.address,
         u.name AS delivery_name,
         (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  LEFT JOIN users u ON u.id = o.delivery_boy_id
`;

function assignedOrder(id, riderId) {
  return get(`${ORDER_SELECT} WHERE o.id = ? AND o.delivery_boy_id = ?`, id, riderId);
}

router.post('/orders/:id/accept', (req, res) => {
  const riderId = req.session.user.id;
  const order = get(`${ORDER_SELECT} WHERE o.id = ?`, req.params.id);
  if (!order) {
    req.flash('error', 'Order not found.');
    return res.redirect('/delivery');
  }
  if (order.delivery_boy_id || !['pending', 'accepted'].includes(order.status)) {
    req.flash('error', 'This order is no longer available to accept.');
    return res.redirect('/delivery');
  }
  run(
    `UPDATE orders SET delivery_boy_id = ?, status = 'assigned',
       accepted_at = COALESCE(accepted_at, datetime('now')), updated_at = datetime('now')
     WHERE id = ? AND status IN ('pending','accepted') AND delivery_boy_id IS NULL`,
    riderId,
    order.id
  );
  const claimed = assignedOrder(order.id, riderId);
  if (!claimed) {
    req.flash('error', 'Another delivery partner accepted this order first.');
    return res.redirect('/delivery');
  }
  if (order.status === 'pending') {
    addHistory(order.id, 'accepted', `Accepted by delivery partner ${req.session.user.name}`, 'delivery');
  }
  addHistory(order.id, 'assigned', `Accepted by ${req.session.user.name}`, 'delivery');
  req.flash('success', `You accepted order ${order.order_number}. Head to the kitchen for pickup.`);
  res.redirect(`/delivery/orders/${order.id}`);
});

router.get('/', (req, res) => {
  const riderId = req.session.user.id;
  const stats = {
    assigned: get("SELECT COUNT(*) AS count FROM orders WHERE delivery_boy_id = ? AND status = 'assigned'", riderId).count,
    picked: get("SELECT COUNT(*) AS count FROM orders WHERE delivery_boy_id = ? AND status = 'picked_up'", riderId).count,
    transit: get("SELECT COUNT(*) AS count FROM orders WHERE delivery_boy_id = ? AND status = 'on_the_way'", riderId).count,
    deliveredToday: get("SELECT COUNT(*) AS count FROM orders WHERE delivery_boy_id = ? AND status = 'delivered' AND date(delivered_at) = date('now')", riderId).count,
    earnings: get("SELECT COALESCE(SUM(total),0) AS total FROM orders WHERE delivery_boy_id = ? AND status = 'delivered' AND date(delivered_at) = date('now')", riderId).total
  };
  const activeOrders = all(
    `${ORDER_SELECT} WHERE o.delivery_boy_id = ? AND o.status IN ('assigned','picked_up','on_the_way') ORDER BY o.id DESC`,
    riderId
  );
  const availableOrders = all(
    `${ORDER_SELECT} WHERE o.delivery_boy_id IS NULL AND o.status IN ('pending','accepted') ORDER BY o.id DESC LIMIT 10`
  );
  const recentDelivered = all(
    `${ORDER_SELECT} WHERE o.delivery_boy_id = ? AND o.status = 'delivered' ORDER BY o.id DESC LIMIT 5`,
    riderId
  );

  res.render('delivery/dashboard', { title: 'Delivery Dashboard', active: 'delivery', stats, activeOrders, availableOrders, recentDelivered });
});

router.get('/orders', (req, res) => {
  const riderId = req.session.user.id;
  const status = String(req.query.status || '');
  const clauses = ['o.delivery_boy_id = ?'];
  const params = [riderId];
  if (status) {
    clauses.push('o.status = ?');
    params.push(status);
  }
  const orders = all(`${ORDER_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY o.id DESC`, ...params);
  res.render('delivery/orders', { title: 'My Deliveries', active: 'delivery-orders', orders, status });
});

router.get('/orders/:id', (req, res) => {
  const order = assignedOrder(req.params.id, req.session.user.id);
  if (!order) {
    req.flash('error', 'That order is not assigned to you.');
    return res.redirect('/delivery/orders');
  }
  const items = all('SELECT * FROM order_items WHERE order_id = ?', order.id);
  const history = all('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY id DESC', order.id);
  res.render('delivery/order-detail', { title: `Delivery ${order.order_number}`, active: 'delivery-orders', order, items, history });
});

router.post('/orders/:id/status', (req, res) => {
  const order = assignedOrder(req.params.id, req.session.user.id);
  if (!order) {
    req.flash('error', 'That order is not assigned to you.');
    return res.redirect('/delivery/orders');
  }
  const transitions = {
    assigned: { status: 'picked_up', note: 'Picked up from kitchen', actor: 'delivery' },
    picked_up: { status: 'on_the_way', note: 'On the way to customer', actor: 'delivery' },
    on_the_way: { status: 'delivered', note: 'Delivered to customer', actor: 'delivery' }
  };
  const next = transitions[order.status];
  if (!next) {
    req.flash('error', 'This order can no longer be updated.');
    return res.redirect(`/delivery/orders/${order.id}`);
  }
  run(
    'UPDATE orders SET status = ?, delivered_at = ?, updated_at = datetime(\'now\') WHERE id = ?',
    next.status,
    next.status === 'delivered' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : order.delivered_at,
    order.id
  );
  addHistory(order.id, next.status, next.note, next.actor);
  req.flash('success', `Order marked ${next.status.replace(/_/g, ' ')}.`);
  res.redirect(`/delivery/orders/${order.id}`);
});

router.get('/profile', (req, res) => {
  const me = get('SELECT * FROM users WHERE id = ?', req.session.user.id);
  res.render('delivery/profile', { title: 'My Profile', active: 'delivery-profile', me });
});

router.post('/profile', (req, res) => {
  const name = String(req.body.name || '').trim();
  const phone = String(req.body.phone || '').trim();
  const vehicle = String(req.body.vehicle || '').trim();
  if (!name) {
    req.flash('error', 'Name cannot be empty.');
    return res.redirect('/delivery/profile');
  }
  run('UPDATE users SET name = ?, phone = ?, vehicle = ? WHERE id = ?', name, phone || null, vehicle || null, req.session.user.id);
  req.session.user.name = name;
  req.flash('success', 'Profile updated.');
  res.redirect('/delivery/profile');
});

router.post('/password', (req, res) => {
  const current = String(req.body.current_password || '');
  const next = String(req.body.new_password || '');
  const me = get('SELECT * FROM users WHERE id = ?', req.session.user.id);
  if (!verifyPassword(current, me.password_hash)) {
    req.flash('error', 'Your current password is incorrect.');
  } else if (next.length < 8) {
    req.flash('error', 'New password must be at least 8 characters.');
  } else {
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), me.id);
    req.flash('success', 'Password changed successfully.');
  }
  res.redirect('/delivery/profile');
});

module.exports = router;
