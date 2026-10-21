// Zonic portfolio regression guard.
//
// Every check below pins a defect that was fixed and verified. If one of them fails,
// something that used to work has broken again. Run: `node guard.mjs` (exit code 1 on failure).
// Optional: GUARD_ONLY=myyanga,rubba to run a subset.
import { chromium } from "playwright";

const SITES = {
  owanbe: "https://owanbex.netlify.app",
  rubba: "https://rubbax.netlify.app",
  myyanga: "https://myyangax.netlify.app",
  myafriart: "https://myafriartx.netlify.app",
  adspot: "https://adspotx.netlify.app",
  confirmahead: "https://confirmahead.netlify.app",
  zonicme: "https://zonicme.netlify.app",
  sydef: "https://mysydef.com",
};

const only = (process.env.GUARD_ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
const results = [];
const IGNORED_CONSOLE = [/favicon/i, /Failed to load resource.*(40[134]|net::ERR_BLOCKED)/i, /ResizeObserver/i];

function record(app, name, ok, detail = "") {
  results.push({ app, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  [${app}] ${name}${detail && !ok ? ` -> ${detail}` : ""}`);
}

async function check(app, name, fn) {
  try {
    const detail = await fn();
    if (detail === false) record(app, name, false, "returned false");
    else record(app, name, true);
  } catch (e) {
    record(app, name, false, String(e.message || e).slice(0, 300));
  }
}

function expect(cond, message) {
  if (!cond) throw new Error(message);
}

async function openPage(browser, url, { width = 1440, height = 900, waitMs = 2000, init, route } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  if (init) await context.addInitScript(init);
  if (route) await context.route(route.pattern, route.handler);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !IGNORED_CONSOLE.some((r) => r.test(m.text()))) errors.push(`console: ${m.text().slice(0, 160)}`);
  });
  const response = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(waitMs);
  return { page, context, errors, status: response?.status() ?? 0 };
}

async function overflowPx(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

// ---------------------------------------------------------------------------
// Universal: every app's home page loads, has no script errors, and does not
// scroll sideways on a phone (ConfirmAhead, Sydef regressions).
// ---------------------------------------------------------------------------
async function universal(browser, app, base) {
  await check(app, "home loads (HTTP 200, no script errors)", async () => {
    const { context, errors, status } = await openPage(browser, base + "/");
    await context.close();
    expect(status === 200, `HTTP ${status}`);
    expect(errors.length === 0, errors.join(" | "));
  });
  await check(app, "no sideways scroll on phone (390px)", async () => {
    const { page, context } = await openPage(browser, base + "/", { width: 390, height: 800 });
    const px = await overflowPx(page);
    await context.close();
    expect(px <= 1, `${px}px horizontal overflow`);
  });
}

// ---------------------------------------------------------------------------
// App specific checks
// ---------------------------------------------------------------------------
async function myyanga(browser, base) {
  const app = "myyanga";
  await check(app, "nav contains Explore and Premium", async () => {
    const { page, context } = await openPage(browser, base + "/");
    const text = (await page.locator("body").innerText()).toUpperCase();
    await context.close();
    expect(text.includes("EXPLORE"), "Explore missing from nav");
    expect(text.includes("PREMIUM"), "Premium missing from nav");
  });
  await check(app, "Make Up is promoted on the home page", async () => {
    const { page, context } = await openPage(browser, base + "/");
    const count = await page.getByText(/make up/i).count();
    await context.close();
    expect(count >= 2, `only ${count} Make Up mentions`);
  });
  await check(app, "Smart Search never shows a pay/unlock panel, even with a stale paid override", async () => {
    const { page, context } = await openPage(browser, base + "/?view=smart", {
      init: "localStorage.setItem('myyanga_feature_policy_v1', JSON.stringify({smart_search:{mode:'paid',price_ngn:5000,enabled:true,active:true}}))",
      waitMs: 3000,
    });
    const text = await page.locator("body").innerText();
    await context.close();
    expect(!/Unlock|Pay ₦/.test(text), "pay/unlock panel appeared");
    expect(/ask myyanga/i.test(text), "search form missing");
  });
  await check(app, "Brands page: cards have icons for WhatsApp/Instagram, no blank image cards", async () => {
    const { page, context } = await openPage(browser, base + "/?view=discover", { waitMs: 3000 });
    const cards = await page.locator(".bcard").count();
    const blanks = await page.locator(".bcard-ph").count();
    const textLinks = await page.locator(".bcard a.bcard-btn:not(.bcard-ico)").count();
    await context.close();
    expect(cards > 0, "no brand cards");
    expect(blanks === 0, `${blanks} cards without an image`);
    expect(textLinks === 0, "text-only WhatsApp/Instagram buttons are back");
  });
}

async function myafriart(browser, base) {
  const app = "myafriart";
  await check(app, "Stage a Room API is deployed (400 for empty body, never 404)", async () => {
    const res = await fetch(base + "/api/stage-room", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status === 400, `status ${res.status}`);
  });
  await check(app, "catalogue count is stable across two loads", async () => {
    const read = async () => {
      const { page, context } = await openPage(browser, base + "/", { waitMs: 3500 });
      const text = await page.locator("body").innerText();
      await context.close();
      const m = text.match(/(\d+) artists? · (\d+) pieces?/);
      expect(m, "count line not found");
      return `${m[1]}/${m[2]}`;
    };
    const first = await read();
    const second = await read();
    expect(first === second, `${first} then ${second}`);
  });
  await check(app, "sold works stay visible with a Sold badge", async () => {
    const { page, context } = await openPage(browser, base + "/", { waitMs: 3500 });
    const text = await page.locator("body").innerText();
    await context.close();
    expect(/sold/i.test(text), "no Sold badge on the page");
  });
  await check(app, "artwork enlarge viewer opens and closes", async () => {
    const home = await openPage(browser, base + "/", { waitMs: 3500 });
    const href = await home.page.locator('a[href*="/piece/"]').first().getAttribute("href");
    await home.context.close();
    expect(href, "no artwork link on the home page");
    const { page, context } = await openPage(browser, base + href);
    await page.locator('[aria-label*="nlarge"]').first().click();
    await page.waitForTimeout(500);
    const open = await page.locator('[role="dialog"][aria-label^="Enlarged"]').count();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const closed = await page.locator('[role="dialog"][aria-label^="Enlarged"]').count();
    await context.close();
    expect(open === 1, "viewer did not open");
    expect(closed === 0, "viewer did not close with Esc");
  });
  for (const path of ["/lounge", "/auction"]) {
    await check(app, `${path} shows the main navigation`, async () => {
      const { page, context } = await openPage(browser, base + path);
      const text = await page.locator("body").innerText();
      await context.close();
      expect(/Discover/.test(text) && /Art Lounge|Lounge/.test(text), "site navigation missing");
    });
  }
}

async function rubba(browser, base) {
  const app = "rubba";
  await check(app, "hero has a Start Your Plan button that opens sign-up for visitors", async () => {
    const { page, context } = await openPage(browser, base + "/");
    const count = await page.locator(".hero-cta").count();
    expect(count === 1, "hero button missing");
    await page.locator(".hero-cta").click();
    await page.waitForTimeout(800);
    const text = await page.locator("body").innerText();
    await context.close();
    expect(/Create your account/i.test(text), "sign-up did not open");
  });
  await check(app, "header is tight to the edges (logo within 80px of the left)", async () => {
    const { page, context } = await openPage(browser, base + "/", { width: 1300 });
    const left = await page.evaluate(() => document.querySelector(".head > a")?.getBoundingClientRect().left ?? 9999);
    await context.close();
    expect(left < 80, `logo starts ${Math.round(left)}px from the left`);
  });
  await check(app, "brand directory and brand studio routes render", async () => {
    const a = await openPage(browser, base + "/brands");
    const dir = await a.page.locator("body").innerText();
    await a.context.close();
    expect(/Brands on Rubba/.test(dir), "directory missing");
    const b = await openPage(browser, base + "/brand");
    const studio = await b.page.locator("body").innerText();
    await b.context.close();
    expect(/Brand studio/.test(studio), "studio missing");
  });
  await check(app, "navigation includes Brands", async () => {
    const { page, context } = await openPage(browser, base + "/");
    const links = await page.locator(".head-nav a").allInnerTexts();
    await context.close();
    expect(links.some((t) => /brands/i.test(t)), `nav: ${links.join(",")}`);
  });
}

async function confirmahead(browser, base) {
  const app = "confirmahead";
  for (const path of ["/login", "/signup"]) {
    await check(app, `${path} loads on phone without overflow`, async () => {
      const { page, context, status } = await openPage(browser, base + path, { width: 390, height: 800 });
      const px = await overflowPx(page);
      await context.close();
      expect(status === 200, `HTTP ${status}`);
      expect(px <= 1, `${px}px overflow`);
    });
  }
}

async function sydef(browser, base) {
  await check("sydef", "sign-in page loads", async () => {
    const { context, status } = await openPage(browser, base + "/auth");
    await context.close();
    expect(status === 200, `HTTP ${status}`);
  });
}

// AdSpot admin: replay an admin session against the live bundle with snake_case rows
// (the exact shape that crashed the dashboard).
async function adspot(browser, base) {
  const app = "adspot";
  const ref = "ukhdjvbzbidxoieauhpr";
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const uid = "11111111-1111-1111-1111-111111111111";
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const email = "oadeagbo@gmail.com";
  const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: uid, role: "authenticated", aud: "authenticated", exp, email })}.sig`;
  const user = { id: uid, aud: "authenticated", role: "authenticated", email, email_confirmed_at: "2026-01-01T00:00:00Z", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
  const session = { access_token: jwt, refresh_token: "r", expires_in: 86400, expires_at: exp, token_type: "bearer", user };
  const profile = { id: uid, email, username: "guard", role: "super_admin", suspended: false, approval_status: "approved", created_at: "2026-01-01T00:00:00Z" };
  const cors = { "access-control-allow-origin": "*", "content-type": "application/json" };
  const handler = (route) => {
    const url = route.request().url();
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { ...cors, "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (url.includes("/auth/v1/user")) return route.fulfill({ status: 200, headers: cors, body: JSON.stringify(user) });
    if (url.includes("adspot_profiles")) {
      const single = (route.request().headers().accept || "").includes("single");
      return route.fulfill({ status: 200, headers: cors, body: JSON.stringify(single ? profile : [profile]) });
    }
    if (url.includes("/rpc/")) return route.fulfill({ status: 200, headers: cors, body: JSON.stringify("approved") });
    if (url.includes("adspot_events_log")) {
      return route.fulfill({
        status: 200,
        headers: { ...cors, "content-range": "0-1/2" },
        body: JSON.stringify([
          { id: "e1", event_type: "admin.ad.create", actor_id: uid, payload: {}, created_at: "2026-10-01T00:00:00Z" },
          { id: "e2", event_type: "custom_thing", actor_id: null, payload: {}, created_at: "2026-10-02T00:00:00Z" },
        ]),
      });
    }
    if (url.includes("/rest/v1/")) return route.fulfill({ status: 200, headers: { ...cors, "content-range": "*/0" }, body: "[]" });
    return route.continue();
  };
  for (const path of ["/brands/admin/dashboard", "/brands/admin/events", "/brands/admin/financials"]) {
    await check(app, `admin ${path} renders without 'Something went wrong'`, async () => {
      const { page, context, errors } = await openPage(browser, base + path, {
        init: `localStorage.setItem('sb-${ref}-auth-token', ${JSON.stringify(JSON.stringify(session))})`,
        route: { pattern: "**/*.supabase.co/**", handler },
        waitMs: 5000,
      });
      const text = await page.locator("body").innerText();
      await context.close();
      expect(!/Something went wrong/i.test(text), "error boundary shown");
      expect(errors.filter((e) => /TypeError/.test(e)).length === 0, errors.join(" | "));
    });
  }
}

const APP_CHECKS = { myyanga, myafriart, rubba, confirmahead, sydef, adspot };

const browser = await chromium.launch();
for (const [app, base] of Object.entries(SITES)) {
  if (only.length && !only.includes(app)) continue;
  await universal(browser, app, base);
  if (APP_CHECKS[app]) await APP_CHECKS[app](browser, base);
}
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:\n" + failed.map((f) => `  [${f.app}] ${f.name}: ${f.detail}`).join("\n"));
  process.exit(1);
}
