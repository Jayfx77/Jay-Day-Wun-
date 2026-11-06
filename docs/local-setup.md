# Run Ofie Accra on your laptop with VS Code

This guide takes you from a fresh laptop to the full site running on your machine: pages, server and database together. Allow about 20–30 minutes the first time. It works on Windows and Mac.

## How the project fits together

Ofie Accra is **one project** that you start with **one command**. You don't run a separate frontend, backend or database server.

| Part | What it is | Where it lives |
|---|---|---|
| Frontend (the pages people see) | HTML templates (EJS), CSS and a little JavaScript, rendered by the server | `views/` and `public/` |
| Backend (the logic) | A Node.js server using Express | `server.js` and `src/` |
| Database | SQLite: a single file, created automatically the first time you start the site | `data/ofie.db` |
| Uploaded photos | Listing photos (public) and Ghana Card images (private) | `uploads/` and `private/` |

When you run `npm run dev`, the server starts, creates or updates the database, and serves the pages at **http://localhost:3000**.

---

## Step 1: Install the tools (one time)

Install these three programs, accepting the default options:

1. **Node.js 22 LTS**: <https://nodejs.org>. Choose the version marked **LTS**.
   - Use version 22. Much newer or older versions may fail to install the database package (see *Troubleshooting*).
2. **Git**: <https://git-scm.com/downloads>. On Windows this is "Git for Windows". On a Mac, if a box pops up asking to install developer tools, accept it.
3. **Visual Studio Code**: <https://code.visualstudio.com>.

**Restart your laptop** after installing, so VS Code can find Node and Git.

Then check they work. Open VS Code, choose **Terminal → New Terminal**, and type:

```
node -v
npm -v
git --version
```

You should see version numbers, for example `v22.x.x`. If you see "not recognized" or "command not found", see *Troubleshooting*.

## Step 2: Get the code

1. In VS Code, open the **Source Control** panel (the branch icon on the left, or `Ctrl+Shift+G`; on a Mac, `Cmd+Shift+G`).
2. Click **Clone Repository** and paste:
   ```
   https://github.com/Jayfx77/Jay-Day-Wun-.git
   ```
3. Choose a folder, for example `Documents/Projects`. When asked, sign in to GitHub. This is needed if the repository is private.
4. Click **Open** when VS Code offers to open the cloned project.
5. If VS Code asks "Do you trust the authors of the files in this folder?", click **Yes, I trust the authors**.

Prefer the terminal? `git clone https://github.com/Jayfx77/Jay-Day-Wun-.git`, then **File → Open Folder…** and choose `Jay-Day-Wun-`.

## Step 3: Install the recommended VS Code extensions

VS Code shows a pop-up: *"This workspace has extension recommendations."* Click **Install**. You get:

- **EJS language support**: colours and highlighting for the page templates in `views/`.
- **SQLite Viewer**: lets you look inside the database file (see Step 10).

If you missed the pop-up, open the **Extensions** panel (`Ctrl+Shift+X`), type `@recommended` and install both.

## Step 4: Install the project's packages

In the VS Code terminal (**Terminal → New Terminal**), make sure you're in the project folder; the prompt should end in `Jay-Day-Wun-`. Then run:

```
npm install
```

This downloads everything the project needs into a `node_modules` folder. It takes a minute or two. A few "warn" lines are normal; an "ERR!" is not (see *Troubleshooting*).

## Step 5: Create your local settings file

The site reads its settings from a file called `.env`. A template for laptops is included. Copy it:

- **Windows (PowerShell, the default VS Code terminal):**
  ```
  Copy-Item .env.local.example .env
  ```
- **Mac:**
  ```
  cp .env.local.example .env
  ```

Open `.env` in VS Code if you want to change anything. The defaults work:
- **Admin login on your laptop:** `admin@local.test` / `local-admin-password`.
- `SMS_PROVIDER=log` means **texts are not really sent**. They're printed in the VS Code terminal instead, which is where you'll find phone verification and password-reset codes while testing.

> ⚠️ Don't copy `.env.example` for local use. That one is for the live server and contains `NODE_ENV=production`, which turns on secure cookies. On `http://localhost` that makes logins silently fail.

`.env` is listed in `.gitignore`, so it's never uploaded to GitHub.

## Step 6: Add demo data (optional but recommended)

```
npm run seed
```

This creates the database file `data/ofie.db` with 8 sample listings (with simple drawn house photos) and these accounts, all with the password **`demo-password`**:

| Email | Role |
|---|---|
| `admin@demo.local` | Admin |
| `ama@demo.local` | Landlord (verified) |
| `kofi@demo.local` | Landlord (verified) |
| `yaw@demo.local` | Landlord (not verified, has a listing waiting for review) |
| `esi@demo.local` | Tenant |

Skip this step if you want an empty site; the database is created anyway when the server starts.

## Step 7: Start the site

```
npm run dev
```

You should see:

```
Admin account ready: admin@local.test
Ofie Accra running on http://localhost:3000 (development)
```

Hold `Ctrl` (or `Cmd` on a Mac) and click the link, or open **http://localhost:3000** in your browser. 🎉 That's the whole site (pages, server and database) running on your laptop.

- **Leave this terminal open** while you use the site. To stop the server, click in the terminal and press `Ctrl+C`.
- **Editing code:**
  - Server code (`server.js`, `src/`): the server restarts by itself when you save.
  - Pages, styles and scripts (`views/`, `public/`): just refresh the browser.

## Step 8: Try it out

1. Log in as **`esi@demo.local`** (tenant), open a listing, message the landlord and request a viewing.
2. Open a **private/incognito window** and log in as **`ama@demo.local`** (landlord). You'll see the message and the viewing request on the dashboard. Using two windows lets you be tenant and landlord at the same time.
3. Log in as **`admin@demo.local`** and open **/admin** to review Yaw's waiting listing.
4. **Sign up a new account.** After signing up you're asked for a 6-digit code. Look in the VS Code terminal for a line like:
   ```
   [sms → +233241234567] 482913 is your Ofie Accra verification code. ...
   ```
   Type that code into the page. Password-reset codes appear the same way.

## Step 9: Find your way around the code

| You want to change… | Look in… |
|---|---|
| Wording or layout of a page | `views/` (e.g. `views/home.ejs`, `views/listing.ejs`) |
| The header and footer on every page | `views/partials/head.ejs`, `views/partials/foot.ejs` |
| Colours, fonts and spacing | `public/css/style.css` (colours are at the top) |
| What happens when a form is submitted | `src/routes/` (e.g. `listings.js`, `auth.js`) |
| Search filters | `src/listingQueries.js` |
| Neighbourhoods, property types and amenities | `src/constants.js` |
| Email and SMS wording | `src/emails.js`, `src/notify.js` |
| Database tables | `src/db.js` (each change is a new numbered "migration" added at the end) |
| Site settings | `src/config.js` (values come from `.env`) |

Tip: press `Ctrl+P` (`Cmd+P` on a Mac) and type part of a file name to jump to it.

## Step 10: Look inside the database

With the SQLite Viewer extension installed, click **`data/ofie.db`** in the file explorer. You can browse every table: `users`, `listings`, `messages`, `viewings`, `sms_log` and the rest.

The viewer is read-only, which is safe. To change data, use the website itself (for example the admin page), or start fresh (Step 13).

## Step 11: Run the tests

```
npm test
```

All tests should pass (`# fail 0` at the end). They use a temporary in-memory database, so they never touch your local data or your `.env`. Run them before pushing changes.

## Step 12: Debug with breakpoints (optional)

1. Stop `npm run dev` first (`Ctrl+C`); only one copy can use port 3000.
2. Open the **Run and Debug** panel (`Ctrl+Shift+D`).
3. Pick **Start Ofie Accra** and press the green ▶.
4. Click to the left of a line number in any file under `src/` to add a red breakpoint dot. When you use that part of the site, VS Code pauses there so you can inspect values.

**Run all tests** is also in that menu.

## Step 13: Start fresh

To wipe your local database and uploaded photos:

```
npm run reset
npm run seed
```

`npm run reset` only works on your laptop; it refuses to run when `NODE_ENV=production`.

## Step 14: Save your changes to GitHub

Every change merged into **`main`** is deployed to the live site on Render automatically. So work on a separate branch:

1. In the bottom-left corner of VS Code, click the branch name (`main`), then **Create new branch…**, and name it, for example `update-homepage-text`.
2. Make your changes, then run `npm test`.
3. In **Source Control** (`Ctrl+Shift+G`), type a short message such as "Update homepage text", click **Commit**, then **Publish Branch** (or **Sync**).
4. On GitHub, open a **Pull Request** from your branch into `main`, check it, and merge. Render then updates the live site.

Your `.env`, database (`data/`) and uploads are never committed, because they're in `.gitignore`.

## Optional: test real texts or emails from your laptop

Put the real provider settings into your `.env` (see the README's *SMS setup* and *Email setup*), for example `SMS_PROVIDER=arkesel` and `ARKESEL_API_KEY=…`, then restart `npm run dev`.

⚠️ This sends **real texts that cost money** to the phone numbers in your local database, including the demo ones. Use your own number, and switch back to `SMS_PROVIDER=log` when you're done.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `node`, `npm` or `git` is "not recognized" / "command not found" | Restart VS Code (or the laptop) after installing. On Windows, re-run the Node installer and make sure "Add to PATH" is ticked. |
| PowerShell says **"running scripts is disabled on this system"** when you run `npm` | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once and answer `Y`. Or switch the terminal to **Command Prompt** using the **˅** next to the **+** in the terminal panel. |
| `npm install` fails with errors about **better-sqlite3**, **node-gyp** or **Python** | Use **Node 22 LTS**, which has a ready-made download for this package. Uninstall other Node versions, delete the `node_modules` folder, and run `npm install` again. If it still fails on Windows, install **Visual Studio Build Tools** with the "Desktop development with C++" option and try again. |
| **`EADDRINUSE: address already in use :::3000`** | The site (or something else) is already running. Stop the other terminal with `Ctrl+C`, or set `PORT=3001` in `.env` and use http://localhost:3001. |
| You log in but end up logged out again | Your `.env` contains `NODE_ENV=production` or a `BASE_URL`. Remove those lines and restart. |
| "Session expired" when submitting a form | The page was open from before a restart or reset. Refresh it and try again. |
| Where's my verification or reset code? | In the terminal running `npm run dev`: look for a `[sms → …]` line. |
| Listing photos are missing | You ran `npm run reset` without `npm run seed`, or the uploads folder was deleted. Run `npm run seed`, or upload new photos. |
| Something else | Stop the server, run `npm test` to see if anything is broken, and check the error message in the terminal. It usually names the file and line. |
