const express = require('express');
const { listingCards } = require('../listingQueries');

module.exports = (db) => {
  const r = express.Router();
  const cards = listingCards(db);

  r.get('/', (req, res) => {
    const latest = cards.search({ sort: 'newest', limit: 8 }).rows;
    const stats = db.prepare(`SELECT
      (SELECT COUNT(*) FROM listings WHERE status = 'active') active,
      (SELECT COUNT(DISTINCT neighbourhood) FROM listings WHERE status = 'active') areas,
      (SELECT COUNT(*) FROM users WHERE role = 'landlord' AND verification_status = 'verified') verified`).get();
    const popular = db.prepare(`SELECT neighbourhood, COUNT(*) n, MIN(rent_ghs) from_ghs FROM listings
      WHERE status = 'active' GROUP BY neighbourhood ORDER BY n DESC LIMIT 8`).all();
    res.render('home', { title: null, latest, stats, popular });
  });

  r.get('/how-it-works', (req, res) => res.render('how', { title: 'How it works' }));
  r.get('/safety', (req, res) => res.render('safety', { title: 'Renting safely' }));
  r.get('/terms', (req, res) => res.render('terms', { title: 'Terms & privacy' }));

  r.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /admin\nDisallow: /messages\nDisallow: /dashboard\n'));

  return r;
};
