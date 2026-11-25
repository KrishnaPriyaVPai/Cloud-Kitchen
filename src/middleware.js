const session = require('express-session');
const { run, get, all, allSettings } = require('./db');

const SESSION_TTL_MS = 1000 * 60 * 60 * 24;

class SQLiteSessionStore extends session.Store {
  get(sid, callback) {
    try {
      const row = get('SELECT data, expires FROM sessions WHERE sid = ?', sid);
      if (!row) return callback(null, null);
      if (row.expires <= Date.now()) {
        run('DELETE FROM sessions WHERE sid = ?', sid);
        return callback(null, null);
      }
      callback(null, JSON.parse(row.data));
    } catch (err) {
      callback(err);
    }
  }

  set(sid, sessionData, callback) {
    try {
      const expires = sessionData.cookie && sessionData.cookie.expires
        ? new Date(sessionData.cookie.expires).getTime()
        : Date.now() + SESSION_TTL_MS;
      run(
        `INSERT INTO sessions (sid, data, expires) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires = excluded.expires`,
        sid,
        JSON.stringify(sessionData),
        Number.isFinite(expires) ? expires : Date.now() + SESSION_TTL_MS
      );
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  destroy(sid, callback) {
    try {
      run('DELETE FROM sessions WHERE sid = ?', sid);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  touch(sid, sessionData, callback) {
    try {
      const expires = sessionData.cookie && sessionData.cookie.expires
        ? new Date(sessionData.cookie.expires).getTime()
        : Date.now() + SESSION_TTL_MS;
      run('UPDATE sessions SET expires = ? WHERE sid = ?', expires, sid);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }
}

function installAppLocals(app) {
  app.use((req, res, next) => {
    req.flash = (type, message) => {
      if (!req.session) return;
      req.session.flash = req.session.flash || [];
      req.session.flash.push({ type, message });
    };

    const flashes = req.session ? req.session.flash || [] : [];
    if (req.session) delete req.session.flash;

    res.locals.settings = { ...allSettings() };
    res.locals.user = req.session && req.session.user ? req.session.user : null;
    res.locals.flash = flashes;
    res.locals.currentYear = new Date().getFullYear();
    res.locals.money = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;
    res.locals.statusMeta = statusMeta;
    res.locals.timeAgo = timeAgo;
    res.locals.formatDate = formatDate;
    res.locals.query = req.query;
    next();
  });
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  req.flash('error', 'Please sign in to continue.');
  return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      req.flash('error', 'Please sign in to continue.');
      const login = roles.includes('chef') ? '/chef/login' : '/delivery/login';
      return res.redirect(`${login}?next=${encodeURIComponent(req.originalUrl)}`);
    }
    if (!roles.includes(req.session.user.role)) {
      req.flash('error', 'You do not have access to that page.');
      const home = req.session.user.role === 'chef' ? '/chef' : '/delivery';
      return res.redirect(home);
    }
    next();
  };
}

function redirectIfAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    return res.redirect(req.session.user.role === 'chef' ? '/chef' : '/delivery');
  }
  next();
}

const STATUS_META = {
  pending: { label: 'Pending', cls: 'amber', icon: '◷' },
  accepted: { label: 'Accepted', cls: 'blue', icon: '✓' },
  rejected: { label: 'Rejected', cls: 'red', icon: '✕' },
  assigned: { label: 'Assigned', cls: 'violet', icon: '↗' },
  picked_up: { label: 'Picked up', cls: 'indigo', icon: '📦' },
  on_the_way: { label: 'On the way', cls: 'cyan', icon: '🚴' },
  delivered: { label: 'Delivered', cls: 'green', icon: '✓' },
  cancelled: { label: 'Cancelled', cls: 'gray', icon: '—' }
};

function statusMeta(status) {
  return STATUS_META[status] || { label: status, cls: 'gray', icon: '•' };
}

function parseDbDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const normalized = String(value).replace(' ', 'T');
  return new Date(/z$/i.test(normalized) ? normalized : `${normalized}Z`);
}

function timeAgo(value) {
  const date = parseDbDate(value);
  if (!date || Number.isNaN(date.getTime())) return '';
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(value);
}

function formatDate(value) {
  const date = parseDbDate(value);
  if (!date || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata'
  }).format(date);
}

module.exports = {
  session,
  SQLiteSessionStore,
  installAppLocals,
  requireAuth,
  requireRole,
  redirectIfAuthenticated,
  statusMeta
};
