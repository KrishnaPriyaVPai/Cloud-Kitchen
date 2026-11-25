const express = require('express');
const { get, run, addHistory } = require('../db');
const { generateOrderNumber } = require('../security');

const router = express.Router();

router.post('/orders', (req, res) => {
  const { customer, items, notes, payment_method: paymentMethod } = req.body || {};

  if (!customer || !customer.name || !customer.phone || !customer.address) {
    return res.status(400).json({ ok: false, message: 'Name, phone and delivery address are required.' });
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 30) {
    return res.status(400).json({ ok: false, message: 'Your cart is empty.' });
  }

  const lines = [];
  for (const entry of items) {
    const id = Number(entry.id);
    const quantity = Number(entry.quantity);
    if (!Number.isInteger(id) || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      return res.status(400).json({ ok: false, message: 'Invalid item in cart.' });
    }
    const item = get('SELECT * FROM menu_items WHERE id = ?', id);
    if (!item || !item.is_available) {
      return res.status(400).json({
        ok: false,
        message: `${item ? item.name : 'An item'} is no longer available. Please refresh the menu.`
      });
    }
    lines.push({ item, quantity });
  }

  const total = lines.reduce((sum, line) => sum + line.item.price * line.quantity, 0);
  const prepTime = Math.max(...lines.map((line) => line.item.prep_minutes || 15));
  const orderNumber = generateOrderNumber();

  try {
    const db = require('../db').db;
    db.exec('BEGIN IMMEDIATE TRANSACTION');

    const customerResult = run(
      'INSERT INTO customers (name, phone, email, address) VALUES (?, ?, ?, ?)',
      String(customer.name).trim(),
      String(customer.phone).trim(),
      customer.email ? String(customer.email).trim() : null,
      String(customer.address).trim()
    );

    const orderResult = run(
      `INSERT INTO orders (order_number, customer_id, total, status, notes, payment_method)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
      orderNumber,
      customerResult.lastInsertRowid,
      total,
      notes ? String(notes).trim() : null,
      paymentMethod === 'upi' ? 'upi' : 'cod'
    );

    const orderId = orderResult.lastInsertRowid;
    for (const line of lines) {
      run(
        `INSERT INTO order_items (order_id, menu_item_id, name, price, quantity, image_url)
         VALUES (?, ?, ?, ?, ?, ?)`,
        orderId,
        line.item.id,
        line.item.name,
        line.item.price,
        line.quantity,
        line.item.image_url
      );
    }
    addHistory(orderId, 'pending', 'Order placed by customer', 'customer');

    db.exec('COMMIT');

    res.json({
      ok: true,
      orderNumber,
      total,
      estimatedMinutes: prepTime + 15,
      trackUrl: `/track?order=${encodeURIComponent(orderNumber)}&phone=${encodeURIComponent(customer.phone)}`
    });
  } catch (err) {
    try { require('../db').db.exec('ROLLBACK'); } catch { /* no active transaction */ }
    console.error('Checkout failed:', err);
    res.status(500).json({ ok: false, message: 'We could not place your order. Please try again.' });
  }
});

module.exports = router;
