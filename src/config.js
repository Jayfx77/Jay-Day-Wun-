const path = require('path');

const root = path.join(__dirname, '..');

module.exports = {
  port: Number(process.env.PORT) || 3000,
  env: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  siteName: process.env.SITE_NAME || 'Ofie Accra',
  // Render sets RENDER_EXTERNAL_URL automatically (e.g. https://ofie-accra.onrender.com).
  baseUrl: process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${Number(process.env.PORT) || 3000}`,
  // When BASE_URL is set (your own domain), visitors on any other host are redirected to it.
  canonicalHost: process.env.BASE_URL ? new URL(process.env.BASE_URL).host : null,
  dbFile: process.env.DB_FILE || path.join(root, 'data', 'ofie.db'),
  uploadDir: process.env.UPLOAD_DIR || path.join(root, 'uploads'),
  privateDir: process.env.PRIVATE_DIR || path.join(root, 'private'),
  sessionDays: 30,
  maxPhotos: 10,
  maxPhotoBytes: 6 * 1024 * 1024,
  // Rent Act, 1963 (Act 220) s.25: advance rent above six months is unlawful.
  legalAdvanceMonths: 6,
  supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
  // SMS: provider is 'arkesel', 'hubtel' or 'log' (prints to console; default when no keys are set).
  sms: {
    provider: process.env.SMS_PROVIDER || 'log',
    senderId: process.env.SMS_SENDER_ID || 'OfieAccra',
    arkeselApiKey: process.env.ARKESEL_API_KEY || '',
    hubtelClientId: process.env.HUBTEL_CLIENT_ID || '',
    hubtelClientSecret: process.env.HUBTEL_CLIENT_SECRET || '',
    // Don't text the same person about the same chat more than once in this window.
    messageCooldownMinutes: Number(process.env.SMS_MESSAGE_COOLDOWN_MINUTES) || 30,
    // Most saved-search texts one person can get in 24 hours (texts cost money; email has no limit).
    searchAlertsPerDay: Number(process.env.SMS_SEARCH_ALERTS_PER_DAY) || 3,
  },
  // Email (optional): password-reset links. Leave SMTP_HOST empty to send reset codes by SMS only.
  // Email alerts for new messages: at most one email per conversation in this window.
  emailMessageCooldownMinutes: Number(process.env.EMAIL_MESSAGE_COOLDOWN_MINUTES) || 15,
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SUPPORT_EMAIL || 'no-reply@example.com',
  },
  supportPhone: process.env.SUPPORT_PHONE || '',
};
