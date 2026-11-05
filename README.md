# Ofie Accra: rent direct from landlords, no agents

Ofie Accra is a web platform where tenants in Accra find homes and deal **directly with landlords**. Nobody pays agent commission, viewing fees or "form fees".

## Features

**Tenants**
- Search across 55+ Greater Accra neighbourhoods by budget, bedrooms, type, furnishing and amenities (borehole, own ECG prepaid meter, security, generator and more).
- See the true cost up front: monthly rent, months of advance, and the **total move-in amount**.
- Filter for listings that follow the Rent Act (advance of 6 months or less) and for verified landlords.
- See the landlord's phone and WhatsApp link once logged in, and chat with them in-app.
- Book viewings, save favourites, and report suspicious listings.

**Landlords**
- List properties for free, with up to 10 photos and a GhanaPost GPS address.
- **Ghana Card verification**: verified landlords publish instantly and get a trust badge. Unverified listings are reviewed first.
- A dashboard to manage enquiries, confirm or decline viewings, and mark a property rented or relist it.

**Admins** (`/admin`)
- Approve or reject listings, verify Ghana Cards (stored privately and never public), handle reports, take down listings, and suspend users.

**Security**
- Passwords hashed with scrypt; sessions stored server-side in http-only cookies.
- CSRF protection on every form, plus rate-limited login and sign-up.
- Strict Content-Security-Policy via Helmet.
- Uploads are checked by their file bytes (JPG/PNG/WebP/PDF only) and saved under random names.
- All SQL is parameterised and every template escapes its output.

## Tech
Node.js 20+, Express 5, EJS (server-rendered, works without JavaScript), SQLite via better-sqlite3. There is no separate database server to run.

## Run locally
```bash
npm install
npm run seed     # optional demo data; password for all demo users: demo-password
npm run dev      # http://localhost:3000
npm test
```
Demo logins after seeding: `admin@demo.local`, `ama@demo.local` (landlord), `esi@demo.local` (tenant).

## Deploy to production
1. Copy `.env.example` and set your values, including `ADMIN_EMAIL` and `ADMIN_PASSWORD`. The admin account is created on first start.
2. Put the database and uploads on **persistent storage** (`DB_FILE`, `UPLOAD_DIR`, `PRIVATE_DIR`).
3. Run it behind HTTPS. With `NODE_ENV=production`, cookies are marked `secure`.

With Docker:
```bash
docker build -t ofie-accra .
docker run -d -p 3000:3000 -v ofie-data:/data --env-file .env ofie-accra
```
The app also runs on Render, Railway or Fly.io as a Node service with an attached disk mounted at `/data`. Health check: `GET /healthz`.

Back up `/data` daily. The whole database is the single file `ofie.db`.

You can create or reset an admin at any time:
```bash
npm run create-admin -- "Full Name" admin@example.com 0241234567 'long-password'
```

## Before public launch: checklist
- [ ] Have a Ghanaian lawyer review `/terms` (Rent Act, Act 220; Data Protection Act, Act 843). Register with the Data Protection Commission, since the platform stores Ghana Card data.
- [ ] Set a real `SUPPORT_EMAIL` and `SUPPORT_PHONE`.
- [ ] Set up a domain, HTTPS and daily backups.
- [ ] Recommended next steps: email/SMS notifications for new messages and viewings (e.g. Hubtel or Arkesel SMS), password reset by email, and phone OTP verification.
