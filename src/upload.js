const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const { uploadsDir } = require('./db');

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadsDir),
  filename: (_req, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    callback(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!allowedTypes.has(file.mimetype)) {
      return callback(new Error('Please upload a JPG, PNG, WEBP, GIF or AVIF image.'));
    }
    callback(null, true);
  }
});

module.exports = upload;
