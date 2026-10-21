# Zonic portfolio guard

`guard.mjs` is a regression suite that runs against the live apps (Owanbe, Rubba, MyYanga, MyAfriArt,
AdSpot, ConfirmAhead, ZonicMe, Sydef). Each check pins a defect that was already fixed and verified,
so a fix cannot silently come undone.

Runs automatically every 4 hours as the scheduled task "Zonic portfolio guard", which pushes a phone
notification on any failure. Run it yourself with `npm i playwright && node guard.mjs`
(`GUARD_ONLY=rubba,myyanga node guard.mjs` for a subset).

When you fix a bug in any app, add a check for it here in the same change.

Deploy notes: ConfirmAhead is deployed by upload (pushing to GitHub does not publish it). The other apps deploy
from GitHub. myafriart.netlify.app is a stale, separate site; the live app is myafriartx.netlify.app.
