if (typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile(); } catch { /* .env is optional in production */ }
}

const path = require('node:path');
const express = require('express');
const { session, SQLiteSessionStore, installAppLocals } = require('./src/middleware');
const { uploadsDir } = require('./src/db');

const app = express();
const port = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src', 'views'));
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use(
  session({
    name: 'cloudplate.sid',
    secret: process.env.SESSION_SECRET || 'cloudplate-dev-secret-change-me-in-production',
    store: new SQLiteSessionStore(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      maxAge: 1000 * 60 * 60 * 24
    }
  })
);

installAppLocals(app);

app.use('/uploads', express.static(uploadsDir, { maxAge: isProduction ? '1h' : 0 }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProduction ? '1h' : 0 }));

app.use('/', require('./src/routes/public'));
app.use('/', require('./src/routes/auth'));
app.use('/api', require('./src/routes/api'));
app.use('/chef', require('./src/routes/chef'));
app.use('/delivery', require('./src/routes/delivery'));

app.use((req, res) => {
  res.status(404).render('errors/404', { title: 'Page Not Found', active: '' });
});

app.use((err, req, res, _next) => {
  console.error(err);
  if (res.headersSent) return;
  if (err.code === 'LIMIT_FILE_SIZE' || /image/i.test(err.message || '')) {
    req.flash && req.flash('error', 'That image is too large or not a supported format.');
    if (req.originalUrl.startsWith('/chef/offers') || req.originalUrl.startsWith('/chef/offerspace')) return res.redirect('/chef/offers');
    if (req.originalUrl.startsWith('/chef/branding')) return res.redirect('/chef/settings');
    return res.redirect(req.originalUrl.startsWith('/chef/settings') ? '/chef/settings' : '/chef/menu');
  }
  res.status(500).render('errors/500', { title: 'Something Went Wrong', active: '' });
});

if (process.env.VERCEL !== '1') {
  app.listen(port, () => {
    console.log(`Cloud Kitchen is running at http://localhost:${port}`);
  });
}

module.exports = app;
