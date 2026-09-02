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

## Limits of the localStorage implementation

The hub has no server identity — sessions, users and the approval queue all live in
`localStorage`. That means:

- Accounts and approvals do **not** sync between devices or browsers.
- The pending queue is stored in the browser the request was made from, so the owner
  only sees requests raised on the same machine.
- Nothing is emailed. "Forgot password" rewrites the stored password on that device
  only, and refuses an email that has no account in that browser.

User-facing copy must state these limits rather than imply emailed resets, cross-device
accounts, or approval notifications. Anything stronger needs a real backend first.

## Module

`website/js/adminTesterApproval.js` · `website/js/auth.js`
