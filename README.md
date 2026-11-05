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

**SMS alerts and password reset**
- Users get a text when someone messages them (at most one text per chat every 30 minutes), when a viewing is requested, confirmed, declined or cancelled, and when an admin approves or rejects their listing or Ghana Card. Each user can turn alerts off on their account page.
- Forgot password: the user enters their email or phone number and gets a 6-digit code by SMS, plus a one-click link by email if SMTP is set up. Codes expire after 15 minutes. After 5 wrong tries the code stops working, and an account can request at most 3 codes per hour. A successful reset logs the account out on every device and sends a "password changed" text.

**Phone verification**
- New users get a 6-digit SMS code at sign-up. Until they enter it they can browse, but they can't see landlords' numbers, send messages, book viewings or post listings. A reminder banner shows on every page.
- Codes expire after 10 minutes and stop working after 5 wrong tries. Users can request a new code once a minute, up to 5 per hour.
- Each phone number can be verified on only one account, which makes fake or duplicate landlord accounts harder. Changing your number means verifying the new one.
- Users who signed up before this feature was added are asked to verify the next time they log in. Admins don't need to.

**Viewing reminders by SMS**
- For every confirmed viewing, the tenant and the landlord each get a reminder text **the evening before** (from 6pm) and **on the day**, 2 hours before the time window starts (not before 7am). The tenant's text has the date, time window, address, GhanaPost GPS address and the landlord's name and number; the landlord's has the tenant's name and number. Both include a link to cancel.
- Each reminder is sent once. None are sent for viewings that were cancelled or declined, for listings that are no longer live, or after the time window has passed. Reminders follow each user's SMS setting.

**Email notifications**
- When email is set up (see *Email setup*), users get an email for each new message, with a preview and a "Reply" button. Follow-ups in the same chat within 15 minutes don't trigger another email.
- Viewing emails: landlords get one when a tenant asks to view, showing the date, time window, tenant's phone number and note. When a viewing is confirmed, the tenant gets the address, GhanaPost GPS address, the landlord's phone number and a **calendar invite**. Declined or cancelled viewings email the other person, and tenants get a link to similar homes.
- Listing emails: landlords are emailed when an admin approves their listing ("Your listing is live"), rejects it (with the reason and an **Edit and resubmit** button), or takes it down (with the reason).
- Ghana Card emails: landlords are emailed when their Ghana Card is **verified** (with any listings that went live as a result, all in one email) or **not accepted** (with the reason, tips for a clearer upload, and an **Upload your Ghana Card again** button). The card number is never included in emails.
- Password-change emails: whenever a password is changed (from the account page, or with a reset code or link), the user gets a **security notice** by email and SMS saying when, how, the device and the IP address, with a **This wasn't me: secure my account** button. These are always sent, even if the user has turned other emails and texts off.
- **Saved searches:** on the search page, a logged-in user can tap **🔔 Save search** and choose to be emailed about new matching homes **right away** (checked every 10 minutes) or in a **daily summary** (sent from 7am GMT). Each email shows up to 10 homes with photo, rent, area and bedrooms. A home is never sent twice for the same search, even if it's relisted, and landlords aren't alerted about their own listings. Users manage their saved searches on the dashboard (change how often, turn off, delete; up to 10 each), and every alert email has a **Stop alerts for this search** link.
- **SMS for saved searches:** when saving a search (or later on the dashboard), users with a verified phone can tick **SMS** as well as, or instead of, **Email**. One new home gets a text with its rent, bedrooms, area and link; several get one summary text with the lowest rent and a link to all matches. Texts cost money, so each person gets at most 3 saved-search texts per 24 hours (`SMS_SEARCH_ALERTS_PER_DAY`). Over the limit, the email still goes out if ticked; for SMS-only searches, the homes wait and arrive together in the next text. Texts also follow the user's SMS setting on the account page.
- Every email has an unsubscribe link, and Gmail and Yahoo show their own "Unsubscribe" button for it. Users can also switch emails off on their account page. Password-reset emails are always sent.

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

## Deploy on Render
The repo includes a Render blueprint (`render.yaml`). It sets up a Node web service in Frankfurt (the closest Render region to Ghana), with a 5 GB persistent disk at `/var/data` for the database and photos, and health checks on `/healthz`.

1. Sign in at [render.com](https://render.com) with GitHub, and allow Render to access this repository.
2. In the Render dashboard, choose **New → Blueprint** and pick this repository. Render reads `render.yaml`.
3. Fill in the values Render asks for:
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD` (10+ characters), `ADMIN_NAME`, `ADMIN_PHONE`: your admin login. The account is created on the first start.
   - `SUPPORT_EMAIL`, `SUPPORT_PHONE`: shown to users.
   - `SMS_PROVIDER`: `arkesel` or `hubtel`, plus that provider's keys. Leave the other provider's keys empty. Use `log` only for a trial run: texts are then printed in Render's **Logs** tab instead of being sent.
4. Click **Apply**. The first deploy takes a few minutes. The site will be at `https://ofie-accra.onrender.com`, or similar if that name is taken.
5. Log in with your admin email and check `/admin`.

**Cost:** a persistent disk needs a paid instance (the *Starter* plan) plus disk storage. Check Render's pricing page for current prices. Without a disk, every deploy or restart would wipe the database and photos.

**Your own domain:** follow the step-by-step guide in [docs/custom-domain.md](docs/custom-domain.md). It covers buying a domain, adding the DNS records, HTTPS, setting `BASE_URL`, and troubleshooting. Once `BASE_URL` is set, visitors on the `onrender.com` address are redirected to your domain.

**Backups:** Render takes daily snapshots of persistent disks, which you can restore from the **Disks** page. For an extra copy, open the service's **Shell** and run `node -e "require('better-sqlite3')('/var/data/ofie.db').backup('/var/data/backup.db').then(() => console.log('done'))"`, then copy `backup.db` somewhere safe, or schedule your own off-site copies.

Each push to `main` redeploys the site automatically. Database updates run on startup.

## Deploy to production (other hosts)
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

## SMS setup
Texts go through **Arkesel** or **Hubtel**, two Ghanaian SMS providers.
1. Open an account with one of them and register a sender ID. `OfieAccra` is the default; sender IDs can be up to 11 characters, and Ghanaian networks must approve them first.
2. Set `SMS_PROVIDER=arkesel` and `ARKESEL_API_KEY`, or `SMS_PROVIDER=hubtel` with `HUBTEL_CLIENT_ID` and `HUBTEL_CLIENT_SECRET`.
3. Send yourself a test (for example, use "Forgot password" on your own account), then check `/admin` → *SMS alerts* for anything that failed.

Without a provider, `SMS_PROVIDER=log` prints texts to the server log instead of sending them. That's fine for local testing, but in production nobody could reset a password.

## Email setup
Email is optional. Without it, the site uses SMS only. To turn it on, set these in Render's **Environment** tab (or in `.env`):
- `SMTP_HOST`, `SMTP_PORT` (usually `587`), `SMTP_USER`, `SMTP_PASS`: from any SMTP email service, such as Brevo, Mailgun, Amazon SES, Postmark, or Zoho or Google Workspace.
- `SMTP_FROM`: the sender address, for example `no-reply@yourdomain.com`. Use an address on your own domain, and add the SPF and DKIM records your email service gives you so emails don't go to spam (see [docs/custom-domain.md](docs/custom-domain.md#optional-email-on-your-domain)).

Then check `/admin` → *Email* after sending yourself a message from a second account.

## Before public launch: checklist
- [ ] Have a Ghanaian lawyer review `/terms` (Rent Act, Act 220; Data Protection Act, Act 843). Register with the Data Protection Commission, since the platform stores Ghana Card data.
- [ ] Set a real `SUPPORT_EMAIL` and `SUPPORT_PHONE`.
- [ ] Set up a domain, HTTPS and daily backups.
- [ ] Set up an SMS provider and an approved sender ID (see *SMS setup*). Optionally add SMTP so reset links also go out by email.
