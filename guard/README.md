# Zonic portfolio guard

`guard.mjs` is a regression suite that runs against the live apps (Owanbe, Rubba, MyYanga, MyAfriArt,
AdSpot, ConfirmAhead, ZonicMe, Sydef). Each check pins a defect that was already fixed and verified,
so a fix cannot silently come undone.

Runs automatically every 3 hours and on every push to this repo (GitHub Actions: `Zonic portfolio guard`).
A failure emails the repo owner. Run it yourself with `npm i playwright && node guard.mjs`
(`GUARD_ONLY=rubba,myyanga node guard.mjs` for a subset).

When you fix a bug in any app, add a check for it here in the same change.
