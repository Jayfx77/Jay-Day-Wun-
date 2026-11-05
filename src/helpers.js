const { PROPERTY_TYPES, FURNISHING, AMENITIES, NEIGHBOURHOODS, REPORT_REASONS } = require('./constants');
const config = require('./config');

const cedis = (n) => `GH₵ ${Number(n).toLocaleString('en-GH', { maximumFractionDigits: 0 })}`;

function timeAgo(sqlDate) {
  const d = new Date(String(sqlDate).replace(' ', 'T') + (String(sqlDate).endsWith('Z') ? '' : 'Z'));
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Normalise a Ghanaian phone number to international digits, e.g. 0241234567 -> 233241234567.
function normalisePhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('0')) digits = '233' + digits.slice(1);
  if (digits.length === 9) digits = '233' + digits;
  return /^233[235]\d{8}$/.test(digits) ? digits : null;
}

const prettyPhone = (intl) => (intl ? `0${intl.slice(3, 5)} ${intl.slice(5, 8)} ${intl.slice(8)}` : '');

// Ghana Card: GHA-123456789-0
const validGhanaCard = (s) => /^GHA-\d{9}-\d$/.test(String(s || '').trim().toUpperCase());
// GhanaPost GPS digital address, e.g. GA-123-4567 or GA-1234-5678
const validGps = (s) => /^[A-Z]{2}-\d{3,4}-\d{3,4}$/.test(String(s || '').trim().toUpperCase());

// Rough, human-readable device description from a User-Agent string, e.g. "Chrome on Android".
function describeDevice(ua = '') {
  const s = String(ua);
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /SamsungBrowser/.test(s) ? 'Samsung Internet'
    : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : null;
  const os = /Android/.test(s) ? 'Android' : /iPhone|iPad|iPod/.test(s) ? 'iPhone/iPad' : /Windows/.test(s) ? 'Windows'
    : /Mac OS X|Macintosh/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || 'Unknown device';
}

// "Thursday 5 November 2026 at 13:45 GMT" (Ghana is GMT all year).
const accraTime = (d = new Date()) => `${d.toLocaleDateString('en-GB', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
}).replace(',', '')} at ${d.toISOString().slice(11, 16)} GMT`;

const totalUpfront = (l) => l.rent_ghs * l.advance_months;

function locals(app) {
  Object.assign(app.locals, {
    cedis, timeAgo, prettyPhone, totalUpfront,
    PROPERTY_TYPES, FURNISHING, AMENITIES, NEIGHBOURHOODS, REPORT_REASONS,
    siteName: config.siteName,
    legalAdvanceMonths: config.legalAdvanceMonths,
    supportEmail: config.supportEmail,
    supportPhone: config.supportPhone,
    smsSearchAlertsPerDay: config.sms.searchAlertsPerDay,
  });
}

module.exports = { describeDevice, accraTime, cedis, timeAgo, normalisePhone, prettyPhone, validGhanaCard, validGps, totalUpfront, locals };
