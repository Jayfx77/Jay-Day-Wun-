# Custom domain setup (Render)

This guide puts Ofie Accra on your own web address, for example `yourdomain.com` instead of `ofie-accra.onrender.com`. It takes about 15 minutes of work, plus up to a few hours for DNS changes to spread.

Throughout this guide, replace:
- `yourdomain.com` with your domain;
- `ofie-accra.onrender.com` with your service's Render address. It's shown at the top of the service page in Render.

---

## 1. Get a domain

Either kind works:

- **A Ghanaian domain** such as `.com.gh` or `.gh`. These are sold by accredited Ghanaian registrars (the `.gh` registry is run by NIC.GH). Some extensions ask for business registration documents, so check the registrar's requirements before you pay.
- **An international domain** such as `.com` or `.africa`, from any registrar: Namecheap, Cloudflare, GoDaddy and so on.

You'll need to log in to the registrar's **DNS settings** (sometimes called "DNS management", "zone editor" or "advanced DNS") in step 3.

## 2. Add the domain in Render

1. Open the **ofie-accra** service in the Render dashboard.
2. Go to **Settings → Custom Domains → + Add Custom Domain**.
3. Enter your main address, for example `yourdomain.com`, and save.
   - If you add the root domain (`yourdomain.com`), Render also adds `www.yourdomain.com` and redirects one to the other, so both work.
4. Render now lists the DNS records it needs. **Leave this page open.** Its values are the ones to use; the table below shows what they usually look like.

## 3. Create the DNS records at your registrar

| Type | Name / Host | Value / Points to | Purpose |
|---|---|---|---|
| `A` | `@` (the root domain) | `216.24.57.1` | `yourdomain.com` |
| `CNAME` | `www` | `ofie-accra.onrender.com` | `www.yourdomain.com` |

If your DNS provider supports **ALIAS**, **ANAME** or **CNAME flattening** for the root domain (Cloudflare, DNSimple and others do), you can point `@` at `ofie-accra.onrender.com` that way instead of using the `A` record.

**Also:**
- **Delete any old `A`, `AAAA` or `CNAME` records for `@` and `www`** that point elsewhere, such as the registrar's parking page. Leftover `AAAA` (IPv6) records are the most common reason verification fails.
- **Don't touch `MX` or `TXT` records.** They control your email.
- **If you use Cloudflare:** set both records to **DNS only** (grey cloud) until Render shows the domain as verified and the certificate as issued. If you turn the orange-cloud proxy on afterwards, set **SSL/TLS → Full (strict)**.
- **If you have `CAA` records** (most people don't), they must allow Render's certificate providers. Add `letsencrypt.org` and `pki.goog`.

## 4. Verify and get HTTPS

1. Back in Render, click **Verify** next to each domain.
2. Once DNS has spread (usually minutes, sometimes a few hours, at most 48 hours), Render marks the domain **Verified** and issues a free HTTPS certificate on its own. You don't need to buy one.
3. Open `https://yourdomain.com` in a browser. You should see the site with a padlock.

## 5. Tell the app about its new address

1. In Render, open **Environment** for the service.
2. Add `BASE_URL` = `https://yourdomain.com`. Use your main address exactly: `https://`, no trailing slash, with or without `www` as you chose in step 2.
3. Click **Save Changes**. Render redeploys automatically.

What changes:
- Links in SMS alerts and password-reset emails now use your domain.
- Anyone who visits the old `ofie-accra.onrender.com` address is redirected to the same page on your domain, so old links keep working and search engines see a single site.

## 6. Final checks

- [ ] `https://yourdomain.com` loads with a padlock.
- [ ] `https://www.yourdomain.com` goes to the same site.
- [ ] `https://ofie-accra.onrender.com/listings` redirects to `https://yourdomain.com/listings`.
- [ ] You can log in. If you were already logged in on the onrender.com address, log in again; logins don't carry across domains.
- [ ] "Forgot password" on your own account sends a text whose link starts with your domain.

---

## Optional: email on your domain

You can set `SUPPORT_EMAIL` to an address on your domain, such as `support@yourdomain.com`. You'll need an email provider (Google Workspace, Zoho Mail, Microsoft 365 and others). The provider gives you `MX` and `TXT` records to add in the same DNS settings, and they don't conflict with the website records above.

If you also turn on password-reset emails (`SMTP_HOST` and related settings), set `SMTP_FROM` to an address on your domain. Add the **SPF** and **DKIM** records your email provider gives you so these emails don't land in spam.

## Troubleshooting

| Problem | Fix |
|---|---|
| Render still says "DNS not verified" after an hour | Check the records with a public DNS checker (search "DNS propagation checker"). Make sure no old `AAAA`, `A` or `CNAME` records remain for `@` or `www`. |
| Browser warns "Not secure" or shows a certificate error | Render hasn't issued the certificate yet. Wait until the Custom Domains page shows it as issued. If you use Cloudflare, check it's set to **DNS only** or **Full (strict)**. |
| "Too many redirects" | Usually a Cloudflare **Flexible** SSL setting. Change it to **Full (strict)**. Also check `BASE_URL` starts with `https://`. |
| Site redirects to the wrong address | `BASE_URL` has a typo. Fix it under **Environment** and save. |
| Root domain works but `www` doesn't, or the other way round | Add the missing record from step 3 and check that both appear under Custom Domains in Render. |
| Email stopped working after DNS changes | An `MX` record was deleted or changed. Restore the records your email provider lists. |
