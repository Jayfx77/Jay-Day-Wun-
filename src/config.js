const path = require('path');

const root = path.join(__dirname, '..');

module.exports = {
  port: Number(process.env.PORT) || 3000,
  env: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  siteName: process.env.SITE_NAME || 'Ofie Accra',
  baseUrl: process.env.BASE_URL || `http://localhost:${Number(process.env.PORT) || 3000}`,
  dbFile: process.env.DB_FILE || path.join(root, 'data', 'ofie.db'),
  uploadDir: process.env.UPLOAD_DIR || path.join(root, 'uploads'),
  privateDir: process.env.PRIVATE_DIR || path.join(root, 'private'),
  sessionDays: 30,
  maxPhotos: 10,
  maxPhotoBytes: 6 * 1024 * 1024,
  // Rent Act, 1963 (Act 220) s.25: advance rent above six months is unlawful.
  legalAdvanceMonths: 6,
  supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
  supportPhone: process.env.SUPPORT_PHONE || '',
};
