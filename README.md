# Cloud Kitchen

A complete, fully functional cloud kitchen website with online ordering, a shopping cart, order tracking, and separate dashboards for the chef/admin and delivery partners.

Built with **Node.js**, **Express**, **EJS**, **SQLite** (via Node's built-in `node:sqlite` module), and vanilla CSS/JavaScript. No external database service is required.

---

## Quick start

Requires **Node.js 22.5+** (tested on Node 26).

```bash
npm install
npm start
```

Open **http://localhost:3000**.

The SQLite database is created automatically at `data/cloudkitchen.db` and seeded with categories, dishes, reviews, staff accounts and a few sample orders.

To reset everything back to the original demo data:

```bash
npm run reset-db
```

---

## Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| Chef / Admin | `chef@cloudplate.in` | `Chef@1234` |
| Delivery partner | `ravi@cloudplate.in` | `Ravi@1234` |
| Delivery partner | `suresh@cloudplate.in` | `Suresh@1234` |

- Chef / Admin sign in: **`/chef/login`**
- Delivery partner sign in: **`/delivery/login`**
- `/login` redirects to the admin sign-in page.

You can add more delivery partners from the chef dashboard under **Riders**.

---

## What's included

### Customer site

- **Home** — kitchen branding, welcome message, About section, category links and an *Order Now* call to action.
- **About Us** — the cloud kitchen story, chef profile, food-quality promises, cooking style and services.
- **Menu** — all available dishes with images, descriptions, prices, veg/non-veg labels, prep times, search, category filters and *Add to Cart*.
- **Cart & checkout** — slide-out cart with quantity controls, free-delivery threshold, customer details and cash/UPI-on-delivery checkout.
- **Contact Us** — phone, email, address, opening hours, map and a working contact form (messages are stored in the database).
- **Reviews** — a sliding customer-review carousel on the home page (moderation stays in the chef dashboard).
- **Track order** — enter order number + phone number to see live status and delivery details.

### Chef / Admin dashboard

- Secure login with hashed passwords and database-backed sessions.
- Overview statistics, recent orders and most-ordered dishes.
- Full menu management: add, edit, delete, set prices, upload images, mark popular/veg and toggle availability.
- Order management: accept, reject, assign riders, reassign/unassign and manually update status.
- Manage delivery partner accounts (create, activate, deactivate).
- Review moderation (approve, hide, delete).
- Contact message inbox.
- Edit public kitchen details shown across the site, plus change password.

### Delivery partner dashboard

- Secure login.
- See available unassigned orders and claim them.
- See only the orders assigned to you.
- Update status through **Picked Up → On the Way → Delivered**.
- View customer details, delivery address and Google Maps link.
- Update profile and password.

---

## Data model

The SQLite database stores:

- `settings` — editable kitchen details used site-wide
- `users` — chef and delivery accounts with salted scrypt password hashes
- `sessions` — database-backed login sessions
- `categories`, `menu_items` — menu catalog
- `customers`, `orders`, `order_items`, `order_status_history` — ordering and tracking
- `reviews` — customer feedback with moderation flag
- `contact_messages` — contact form submissions

---

## Project structure

```
.
├── server.js                  # Express app, session setup, routes, error handling
├── scripts/
│   ├── reset-db.js            # Recreate the seeded database
│   └── smoke-test.js          # Automated HTTP smoke test (creates one test order)
├── src/
│   ├── db.js                  # SQLite schema + seed data
│   ├── middleware.js          # Session store, auth guards, view locals/helpers
│   ├── security.js            # Password hashing, tokens, order numbers
│   ├── upload.js              # Image upload handling
│   ├── routes/                # public, auth, api, chef, delivery
│   └── views/                 # EJS templates (public + dashboards)
└── public/
    ├── css/style.css          # Full responsive design system
    ├── js/app.js              # Cart, checkout, drawer and modal logic
    └── uploads/               # Chef-uploaded dish images
```

---

## Verification

With the server running:

```bash
node scripts/smoke-test.js
```

This checks public pages, both logins, all dashboard pages, checkout and the tracking page. It adds one test order to the database; run `npm run reset-db` afterwards if you want a clean demo state.

---

## Production notes

- Set a strong `SESSION_SECRET` environment variable.
- Set `NODE_ENV=production` to enable secure cookies and static-asset caching (serve behind HTTPS).
- Set `PORT` to change the default `3000`.
- Uploaded images are stored in `public/uploads/`; back up that folder along with `data/cloudkitchen.db`.
