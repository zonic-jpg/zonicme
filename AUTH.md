# ZonicMe hub — local auth notes

## Admin URL (hidden — not in public nav)

Open: `http://localhost:8766/admin.html`

## Shared admin sign-in

- Username: **any** (email or bare name)
- Password: `admin123`
- Role: **admin** (full access to Apps & ingest on `admin.html`)

## Owner sign-in

- Email: `oadeagbo@gmail.com`
- Password: `password123`
- Roles: **owner** + **super_admin** (can grant roles in **Users & roles**)

## Google OAuth (production)

1. Create a Google Cloud OAuth **Web** client.
2. Add Authorized JavaScript origins for your deploy host (and `http://localhost:8766` for local).
3. Set client id via:
   - Admin field **GOOGLE_CLIENT_ID**, or
   - `localStorage zonicme_google_client_id`, or
   - `window.ZONICME_GOOGLE_CLIENT_ID = "….apps.googleusercontent.com"`
4. Invalid / missing origins soft-fail (button hides); email/password still works — same pattern as AdSpot.

## Roles

| Role | Access |
|------|--------|
| owner | Full + grant roles |
| super_admin | Full + grant roles |
| admin | Apps / ingest tools |
| viewer | Sign-in only (no write) |

Session: signed-ish token in `localStorage` (`zonicme_admin_session_v1`). Demo-only signing — replace with real backend JWT for production.
