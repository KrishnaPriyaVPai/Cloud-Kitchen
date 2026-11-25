const express = require('express');
const { get, run } = require('../db');
const { verifyPassword, hashPassword } = require('../security');
const { redirectIfAuthenticated } = require('../middleware');

const router = express.Router();

const PORTALS = {
  chef: {
    title: 'Admin Sign In',
    eyebrow: 'Kitchen admin access',
    heading: 'Admin sign in',
    description: 'Sign in to manage orders, the menu and delivery partners.',
    action: '/chef/login',
    demoLabel: 'Admin',
    demoEmail: 'chef@cloudplate.in',
    demoPassword: 'Chef@1234',
    allowRegister: false,
    other: { label: 'Delivery partner', href: '/delivery/login' }
  },
  delivery: {
    title: 'Delivery Partner Sign In',
    eyebrow: 'Delivery partner access',
    heading: 'Partner sign in',
    description: 'Sign in to accept orders and track your deliveries.',
    action: '/delivery/login',
    demoLabel: 'Delivery partner',
    demoEmail: 'ravi@cloudplate.in',
    demoPassword: 'Ravi@1234',
    allowRegister: true,
    other: { label: 'Admin', href: '/chef/login' }
  }
};

function renderAuth(req, res, portal, options = {}) {
  const config = PORTALS[portal] || PORTALS.chef;
  res.render('login', {
    title: options.title || config.title,
    active: 'login',
    portal,
    ...config,
    next: options.next || req.query.next || '',
    mode: options.mode || (req.query.mode === 'register' && portal === 'delivery' ? 'register' : 'login'),
    form: options.form || {}
  });
}

function loginRedirect(req, res, role) {
  const prefix = role === 'chef' ? '/chef' : '/delivery';
  const requested = String(req.body.next || '');
  const target = requested === prefix || requested.startsWith(`${prefix}/`) ? requested : prefix;
  res.redirect(target);
}

function authFormFromQuery(req) {
  return {
    loginEmail: String(req.query.email || ''),
    regName: String(req.query.regName || ''),
    regEmail: String(req.query.regEmail || ''),
    regPhone: String(req.query.regPhone || ''),
    regVehicle: String(req.query.regVehicle || '')
  };
}

function redirectWithAuthError(req, res, portal, message, options = {}) {
  req.flash('error', message);
  const query = new URLSearchParams();
  if (options.mode) query.set('mode', options.mode);
  if (options.next) query.set('next', options.next);
  if (options.email) query.set('email', options.email);
  if (options.form) {
    Object.entries(options.form).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
  }
  const suffix = query.toString();
  return res.redirect(`/${portal}/login${suffix ? `?${suffix}` : ''}`);
}

function failLogin(req, res, portal, email, message) {
  return redirectWithAuthError(req, res, portal, message, {
    email,
    next: req.body.next || ''
  });
}

function authenticate(req, res, portal, expectedRole) {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = get('SELECT * FROM users WHERE email = ?', email);

  if (!user || !verifyPassword(password, user.password_hash)) {
    return failLogin(req, res, portal, email, 'Invalid email or password.');
  }
  if (user.role !== expectedRole) {
    const message = expectedRole === 'chef'
      ? 'That account is not an admin account. Use the delivery partner sign-in page.'
      : 'That account is not a delivery partner account. Use the admin sign-in page.';
    return failLogin(req, res, portal, email, message);
  }
  if (!user.is_active) {
    return failLogin(req, res, portal, email, 'This account has been deactivated. Please contact the kitchen manager.');
  }

  req.session.regenerate((err) => {
    if (err) {
      return failLogin(req, res, portal, email, 'Could not start a session. Please try again.');
    }
    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    req.flash('success', `Welcome back, ${user.name.split(' ')[0]}!`);
    loginRedirect(req, res, user.role);
  });
}

router.get('/login', redirectIfAuthenticated, (req, res) => {
  const query = new URLSearchParams();
  if (req.query.next) query.set('next', String(req.query.next));
  const suffix = query.toString();
  res.redirect(`/chef/login${suffix ? `?${suffix}` : ''}`);
});

router.post('/login', (req, res) => res.redirect(307, '/chef/login'));

router.get('/chef/login', redirectIfAuthenticated, (req, res) => {
  renderAuth(req, res, 'chef', { form: authFormFromQuery(req) });
});

router.post('/chef/login', (req, res) => authenticate(req, res, 'chef', 'chef'));

router.get('/delivery/login', redirectIfAuthenticated, (req, res) => {
  renderAuth(req, res, 'delivery', { form: authFormFromQuery(req) });
});

router.post('/delivery/login', (req, res) => authenticate(req, res, 'delivery', 'delivery'));

router.get('/delivery/register', redirectIfAuthenticated, (_req, res) => {
  res.redirect('/delivery/login?mode=register');
});

router.post('/register', (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim();
  const vehicle = String(req.body.vehicle || '').trim();
  const password = String(req.body.password || '');
  const confirm = String(req.body.confirm_password || '');
  const form = { regName: name, regEmail: email, regPhone: phone, regVehicle: vehicle };

  if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
    return redirectWithAuthError(req, res, 'delivery', 'Enter your name, a valid email, and a password of at least 8 characters.', {
      mode: 'register',
      form
    });
  }
  if (password !== confirm) {
    return redirectWithAuthError(req, res, 'delivery', 'Passwords do not match.', {
      mode: 'register',
      form
    });
  }
  if (get('SELECT id FROM users WHERE email = ?', email)) {
    return redirectWithAuthError(req, res, 'delivery', 'An account with that email already exists. Please sign in.', {
      mode: 'register',
      form
    });
  }

  const result = run(
    "INSERT INTO users (name, email, password_hash, role, phone, vehicle, is_active) VALUES (?, ?, ?, 'delivery', ?, ?, 1)",
    name,
    email,
    hashPassword(password),
    phone || null,
    vehicle || null
  );

  req.session.regenerate((err) => {
    if (err) {
      req.flash('success', 'Account created. Please sign in.');
      return res.redirect('/delivery/login');
    }
    req.session.user = { id: result.lastInsertRowid, name, email, role: 'delivery' };
    req.flash('success', `Welcome, ${name.split(' ')[0]}! Your delivery account is ready.`);
    res.redirect('/delivery');
  });
});

router.post('/delivery/register', (req, res) => res.redirect(307, '/register'));

function forgotHref(portal) {
  return `/forgot-password?portal=${encodeURIComponent(portal)}`;
}

router.get('/forgot-password', redirectIfAuthenticated, (req, res) => {
  const portal = req.query.portal === 'delivery' ? 'delivery' : 'chef';
  res.render('forgot-password', {
    title: 'Reset Password',
    active: 'login',
    portal,
    backHref: `/${portal}/login`
  });
});

router.post('/forgot-password', (req, res) => {
  const portal = req.body.portal === 'delivery' ? 'delivery' : 'chef';
  const fail = (message) => {
    req.flash('error', message);
    return res.redirect(forgotHref(portal));
  };
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const confirm = String(req.body.confirm_password || '');
  const user = get('SELECT id, is_active FROM users WHERE email = ?', email);

  if (!user) return fail('No account found with that email address.');
  if (!user.is_active) return fail('This account is deactivated. Please contact the kitchen manager.');
  if (password.length < 8) return fail('New password must be at least 8 characters.');
  if (password !== confirm) return fail('Passwords do not match.');

  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), user.id);
  req.flash('success', 'Password updated. Please sign in with your new password.');
  res.redirect(`/${portal}/login`);
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('cloudplate.sid');
    res.redirect('/');
  });
});

module.exports = router;
