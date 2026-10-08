# ZonicMe auth — portfolio sign-up / login rules

Backed by Supabase (project `zonicme`). No shared password exists anywhere (code, config, DB, tests, docs).

1. **Owner** — `oadeagbo@gmail.com` is the owner / super admin, recognised on the server by a **verified** email
   (trigger `on_auth_user_owner_roles`). The owner signs up once and confirms the email.
2. **Anyone can sign up** as a visitor or ask for admin / tester access at `admin.html` ("Create an account").
3. **Testers** — the owner grants admin access with one click on the *Users & roles* tab (Access requests).
4. **Default is open login.** The owner can switch **Require approval for admin / tester sign-ups** on; it holds
   only admin/tester sign-ups, never ordinary visitors. Turning it off releases anyone held.
5. **Owner email** — when someone asks for access, `notify-owner-approval` emails the owner a link to
   `admin.html#approvals` (sent with Resend when `RESEND_API_KEY` is set, otherwise through the shared relay).

Roles can only be changed by the verified owner (`profiles_guard_roles`). Modules: `js/auth.js`,
`js/adminTesterApproval.js`. Server: `supabase/migrations/20261004120000_signup_approvals.sql`.
