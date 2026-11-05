const path = require('path');
const express = require('express');
const helmet = require('helmet');
const config = require('./config');
const { sessionMiddleware } = require('./auth');
const helpers = require('./helpers');
const { createSms } = require('./sms');
const { createNotifier } = require('./notify');
const { createMailer } = require('./mailer');
const { createPhoneVerification } = require('./phoneVerification');

function createApp(db, opts = {}) {
  const app = express();
  const sms = opts.sms || createSms(db);
  const ctx = {
    sms, notify: createNotifier(db, sms), mailer: opts.mailer || createMailer(), phone: createPhoneVerification(db, sms),
  };
  app.locals.ctx = ctx;
  app.locals.emailEnabled = ctx.mailer.enabled;
  app.locals.smsProvider = sms.provider;
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  helpers.locals(app);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  // Send visitors on the default onrender.com address (or any other host) to the custom domain.
  if (config.canonicalHost) {
    app.use((req, res, next) => {
      if (req.get('host') === config.canonicalHost || req.path === '/healthz' || !['GET', 'HEAD'].includes(req.method)) return next();
      res.redirect(301, `${config.baseUrl.replace(/\/$/, '')}${req.originalUrl}`);
    });
  }

  app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: config.isProd ? '7d' : 0 }));
  app.use('/uploads', express.static(config.uploadDir, { maxAge: '30d', fallthrough: true }));
  app.use(express.urlencoded({ extended: false, limit: '200kb' }));
  app.use(sessionMiddleware(db));

  const unread = db.prepare(`
    SELECT COUNT(*) n FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE m.read_at IS NULL AND m.sender_id != @id AND (c.tenant_id = @id OR c.landlord_id = @id)`);
  app.use((req, res, next) => {
    res.locals.unreadCount = req.user ? unread.get({ id: req.user.id }).n : 0;
    res.locals.path = req.path;
    res.locals.query = req.query;
    res.locals.flash = req.query.ok ? String(req.query.ok).slice(0, 200) : null;
    next();
  });

  app.use(require('./routes/public')(db));
  app.use(require('./routes/auth')(db, ctx));
  app.use(require('./routes/listings')(db, ctx));
  app.use(require('./routes/dashboard')(db, ctx));
  app.use(require('./routes/messages')(db, ctx));
  app.use('/admin', require('./routes/admin')(db, ctx));

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  app.use((req, res) => res.status(404).render('error', {
    title: 'Page not found', message: 'We could not find that page. It may have been removed.',
  }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).render('error', { title: 'Something went wrong', message: 'Please try again in a moment.' });
  });

  return app;
}

module.exports = { createApp };
