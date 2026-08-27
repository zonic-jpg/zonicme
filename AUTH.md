# ZonicMe auth — Zonic orbit standard (5 rules)

See MyYangaX `AUTH.md` for the full orbit standard.

## Rule 1 — Owner always in

`oadeagbo@gmail.com` → owner + super_admin immediately on `admin.html`.

## Rule 2 — ADMINTESTER queue

Any other username/email + admin password → **PENDING** (awaiting-approval message).

## Rule 3 — Owner queue on login

Owner login → **Users & roles** tab → ADMINTESTER approvals (`#admintester-queue`).

## Rule 4 — Approved = full access

Approved testers get super_admin on admin console (apps, ingest, all panels).

## Rule 5 — Owner allocates rights

Owner grants roles/privileges via Users & roles UI.

## Module

`website/js/adminTesterApproval.js` · `website/js/auth.js`
