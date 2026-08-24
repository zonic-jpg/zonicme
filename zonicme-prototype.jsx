import React, { useMemo, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line, PieChart, Pie, Cell,
} from "recharts";
import { ChevronDown, ArrowRight, Check, X } from "lucide-react";

/* ---------- palette (editorial, no blue) ---------- */
const INK = "#16140F";
const CANVAS = "#F6F5F1";
const ACCENT = "#15734E";       // single deep-green accent
const MUTED = "#6B655C";
const BORDER = "#E4E1D9";
const CHART = ["#15734E", "#C4502E", "#C99A2E", "#3F3A33", "#2E5E4E", "#A8431F"];

const naira = (n) => "₦" + Number(n).toLocaleString("en-NG");

/* ---------- default editable content ---------- */
const DEFAULT_CONTENT = {
  eyebrow: "THE CONNECTED ECOSYSTEM",
  headline: "Everyday life, connected.",
  headlineAccent: "Real value for people, real insight for brands.",
  subhead:
    "ZonicMe links fashion, art, events, life-planning and rewarded attention into one Nigerian network — so people get more from every app they use, brands reach real audiences with real data, and the digital economy grows.",
};

const DEFAULT_APPS = [
  { id: "myyanga", name: "MyYanga", tag: "FASHION", url: "#",
    desc: "Shop Nigerian designers, aso-ebi and ready-to-wear — with virtual try-on and lookbooks made for the culture.",
    features: ["Designer & vendor marketplace", "Virtual try-on (AR)", "Style reels & lookbooks", "WhatsApp ordering"] },
  { id: "myafriart", name: "MyAfriart", tag: "ART", url: "#",
    desc: "Discover and collect original work from African artists — worldwide shipping and diaspora-friendly checkout.",
    features: ["Artist storefronts", "Curated collections", "Multi-currency payments", "Provenance & secure delivery"] },
  { id: "adspot", name: "AdSpot", tag: "ADVERTISING", url: "#",
    desc: "Watch gamified brand ads, answer quick quizzes, and earn XP plus weekly cash payouts for your attention.",
    features: ["Video ad feed + quizzes", "XP & leaderboard", "Weekly payouts", "Brand campaign analytics"] },
  { id: "rubba", name: "Rubba", tag: "LIFE-PLANNING", url: "#",
    desc: "Plan the life you want — goals and savings for everything from celebrations to retirement and legacy.",
    features: ["Goal categories", "Savings tracking", "Reminders & milestones", "Personal insights"] },
  { id: "owanbe", name: "Owanbe", tag: "EVENTS", url: "#",
    desc: "Plan your owambe end to end and pick the right vendors across 30+ categories with live budget tracking.",
    features: ["Event builder", "Vendor directory (30+)", "Shortlists & budgets", "Verified brands"] },
];

const DEFAULT_BRAND = {
  headline: "Reach real audiences. Decide with real data.",
  intro:
    "ZonicMe is a single window into millions of everyday moments across fashion, art, events, life-planning and rewarded attention — all consented and anonymized. One Brand ID works across every app in the network.",
  benefits: [
    "Cross-app audience insight: demography, location, interests and engagement in one place",
    "Build unlimited custom reports with the same filters our analysts use",
    "Run campaigns across the ecosystem, including AdSpot rewarded attention",
    "One Brand ID that works on ZonicMe and every app in the network",
    "Anonymized, NDPA/GDPR-aligned data you can rely on",
  ],
  plans: [
    { id: "starter", name: "Starter", price: 150000, period: "per month", highlighted: false,
      features: ["Standard reports", "One app's audience", "Up to 3 seats", "Monthly export"] },
    { id: "growth", name: "Growth", price: 450000, period: "per month", highlighted: true,
      features: ["Custom report builder", "All apps' audiences", "Up to 10 seats", "Campaign tools", "Weekly export"] },
    { id: "enterprise", name: "Enterprise", price: 1200000, period: "per month", highlighted: false,
      features: ["Everything in Growth", "Raw event API access", "Unlimited seats", "Dedicated analyst", "SLA & onboarding"] },
  ],
};

/* ---------- synthetic cross-app data (stands in for live spine) ---------- */
const STATES = ["Lagos", "FCT Abuja", "Rivers", "Oyo", "Kano", "Enugu", "Kaduna", "Delta", "Anambra", "Ogun"];
const AGES = ["18–24", "25–34", "35–44", "45–54", "55+"];
const GENDERS = ["Female", "Male", "Undisclosed"];
const TYPES = ["view", "search", "click", "save", "purchase", "ad_watch", "signup", "share"];
const APP_IDS = DEFAULT_APPS.map((a) => a.id);

function mulberry32(s){return function(){s|=0;s=(s+0x6D2B79F5)|0;let t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
const wpick=(r,a,w)=>{const t=w.reduce((x,y)=>x+y,0);let n=r()*t;for(let i=0;i<a.length;i++){n-=w[i];if(n<=0)return a[i];}return a[a.length-1];};
function buildData(){
  const r=mulberry32(20260607);const ev=[];const now=Date.now();
  for(let i=0;i<9000;i++){ev.push({u:Math.floor(r()*1500),app:wpick(r,APP_IDS,[26,14,30,12,18]),type:wpick(r,TYPES,[40,16,14,9,4,22,2,6]),age:wpick(r,AGES,[34,38,16,8,4]),gender:wpick(r,GENDERS,[52,44,4]),state:wpick(r,STATES,[40,18,9,8,7,5,4,3,3,3]),daysAgo:Math.floor(r()*90)});}
  return ev;
}

/* ---------- responsive image auto-sizing (#3) ---------- */
const DEVICE_PRESETS = [{ label: "Mobile", w: 480 }, { label: "Tablet", w: 1024 }, { label: "Desktop", w: 1600 }];
const loadImage = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
const readFile = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
async function resizeForDevices(file) {
  const dataUrl = await readFile(file);
  const img = await loadImage(dataUrl);
  return DEVICE_PRESETS.map(({ label, w }) => {
    const scale = Math.min(1, w / img.width);
    const cw = Math.max(1, Math.round(img.width * scale));
    const ch = Math.max(1, Math.round(img.height * scale));
    const c = document.createElement("canvas"); c.width = cw; c.height = ch;
    c.getContext("2d").drawImage(img, 0, 0, cw, ch);
    const url = c.toDataURL("image/jpeg", 0.82);
    return { label, width: cw, height: ch, url, kb: Math.round((url.length * 0.75) / 1024) };
  });
}

/* ---------- resource & cost sample data (#2) ---------- */
const CHART2 = ["#15734E", "#C4502E", "#C99A2E", "#2E5E4E", "#8B5E34", "#A8431F"];
const SITES = [
  { id: "myyanga", name: "MyYanga" }, { id: "myafriart", name: "MyAfriart" }, { id: "adspot", name: "AdSpot" },
  { id: "rubba", name: "Rubba" }, { id: "owanbe", name: "Owanbe" }, { id: "zonicme", name: "ZonicMe" },
];
const RESOURCES = {
  myyanga: { apiCalls: 128400, aiCalls: 4200, imgTransforms: 9800, emails: 6100, events: 412000, costNGN: 286000 },
  myafriart: { apiCalls: 74200, aiCalls: 2600, imgTransforms: 15200, emails: 3400, events: 228000, costNGN: 214000 },
  adspot: { apiCalls: 301500, aiCalls: 1800, imgTransforms: 3200, emails: 9700, events: 910000, costNGN: 498000 },
  rubba: { apiCalls: 52300, aiCalls: 3100, imgTransforms: 1400, emails: 4200, events: 142000, costNGN: 132000 },
  owanbe: { apiCalls: 96800, aiCalls: 5400, imgTransforms: 7300, emails: 5200, events: 268000, costNGN: 198000 },
  zonicme: { apiCalls: 64000, aiCalls: 900, imgTransforms: 600, emails: 1500, events: 1960000, costNGN: 176000 },
};
const TREND = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const COST_TREND = {
  myyanga: [210, 224, 240, 255, 270, 286], myafriart: [150, 162, 178, 190, 202, 214], adspot: [360, 402, 430, 455, 478, 498],
  rubba: [98, 108, 116, 122, 128, 132], owanbe: [150, 160, 172, 182, 190, 198], zonicme: [120, 134, 148, 158, 168, 176],
};

/* ---------- shared UI atoms (rectangular) ---------- */
function Btn({ children, onClick, variant = "primary", href, className = "", type, full }) {
  const base = "inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold tracking-tight transition-colors rounded-none " + (full ? "w-full " : "");
  const styles =
    variant === "primary" ? { background: INK, color: "#fff" }
    : variant === "accent" ? { background: ACCENT, color: "#fff" }
    : { background: "transparent", color: INK, border: `1px solid ${INK}` };
  const Comp = href ? "a" : "button";
  return <Comp href={href} target={href ? "_blank" : undefined} rel={href ? "noopener noreferrer" : undefined}
    onClick={onClick} type={type} className={base + className} style={styles}>{children}</Comp>;
}
function Chip({ label, active, onClick }) {
  return (
    <button onClick={onClick}
      className="px-3 py-2 text-sm font-medium rounded-none border transition-colors"
      style={active ? { background: INK, color: "#fff", borderColor: INK } : { background: "#fff", color: MUTED, borderColor: BORDER }}>
      {label}
    </button>
  );
}
function Field({ label, value, onChange, area, type = "text", placeholder }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: MUTED }}>{label}</span>
      {area
        ? <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} placeholder={placeholder}
            className="mt-1.5 w-full rounded-none border px-3 py-2.5 text-sm outline-none" style={{ borderColor: BORDER }} />
        : <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
            className="mt-1.5 w-full rounded-none border px-3 py-2.5 text-sm outline-none" style={{ borderColor: BORDER }} />}
    </label>
  );
}

export default function ZonicMe() {
  const [view, setView] = useState("site");        // site | brand | admin
  const [content, setContent] = useState(DEFAULT_CONTENT);
  const [apps, setApps] = useState(DEFAULT_APPS);
  const [brandCfg, setBrandCfg] = useState(DEFAULT_BRAND);
  const [brandSession, setBrandSession] = useState(null); // {name, id, planId}
  const [openCard, setOpenCard] = useState(null);
  const events = useMemo(buildData, []);

  const nav = (
    <header className="sticky top-0 z-40 border-b" style={{ background: CANVAS + "F0", borderColor: BORDER, backdropFilter: "blur(10px)" }}>
      <div className="mx-auto max-w-6xl px-5 h-16 flex items-center justify-between">
        <button onClick={() => setView("site")} className="font-bold text-xl tracking-tight flex items-center gap-2" style={{ color: INK }}>
          <span className="inline-block h-6 w-6" style={{ background: ACCENT }} />ZonicMe
        </button>
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium" style={{ color: MUTED }}>
          <button onClick={() => setView("site")}>Ecosystem</button>
          <button onClick={() => setView("brand")}>For brands</button>
          <button onClick={() => setView("admin")}>Admin</button>
        </nav>
        <Btn variant="primary" onClick={() => setView("brand")} className="!px-4 !py-2">Brand portal</Btn>
      </div>
    </header>
  );

  return (
    <div className="min-h-screen" style={{ background: CANVAS, color: INK, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" }}>
      {nav}
      {view === "site" && <Site content={content} apps={apps} brandCfg={brandCfg} openCard={openCard} setOpenCard={setOpenCard} goBrand={() => setView("brand")} />}
      {view === "brand" && <Brand brandCfg={brandCfg} session={brandSession} setSession={setBrandSession} events={events} />}
      {view === "admin" && <Admin content={content} setContent={setContent} apps={apps} setApps={setApps} brandCfg={brandCfg} setBrandCfg={setBrandCfg} events={events} />}
    </div>
  );
}

/* ===================== PUBLIC SITE ===================== */
function Site({ content, apps, brandCfg, openCard, setOpenCard, goBrand }) {
  return (
    <main>
      <section className="mx-auto max-w-6xl px-5 pt-16 pb-12">
        <p className="text-xs font-bold tracking-[0.24em]" style={{ color: MUTED }}>{content.eyebrow}</p>
        <h1 className="mt-4 text-5xl md:text-6xl font-bold tracking-tight leading-[1.02] max-w-3xl">
          {content.headline}<br /><span style={{ color: ACCENT }}>{content.headlineAccent}</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed" style={{ color: MUTED }}>{content.subhead}</p>
        <div className="mt-8 flex gap-3 flex-wrap">
          <Btn variant="primary">Create your account</Btn>
          <Btn variant="secondary" onClick={goBrand}>For brands <ArrowRight className="h-4 w-4" /></Btn>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-20">
        <div className="flex items-end justify-between mb-4 border-b pb-3" style={{ borderColor: BORDER }}>
          <h2 className="text-xs font-bold tracking-[0.2em]" style={{ color: MUTED }}>THE APPS</h2>
          <span className="text-sm" style={{ color: MUTED }}>Select a card to learn more</span>
        </div>
        <div className="flex gap-5 overflow-x-auto pb-4 -mx-5 px-5">
          {apps.map((app) => {
            const open = openCard === app.id;
            return (
              <div key={app.id} className="shrink-0 w-[300px]">
                <button onClick={() => setOpenCard(open ? null : app.id)} className="w-full text-left group">
                  {/* editorial tile (stand-in for real photography) */}
                  <div className="aspect-[4/3] relative flex flex-col justify-between p-5" style={{ background: INK }}>
                    <span className="text-[10px] font-bold tracking-[0.2em]" style={{ color: ACCENT }}>{app.tag}</span>
                    <span className="text-3xl font-bold tracking-tight text-white">{app.name}</span>
                    <span className="absolute bottom-5 right-5 h-px w-10" style={{ background: ACCENT }} />
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <h3 className="text-lg font-bold">{app.name}</h3>
                    <ChevronDown className={"h-5 w-5 transition-transform " + (open ? "rotate-180" : "")} style={{ color: MUTED }} />
                  </div>
                  <p className="text-sm leading-snug" style={{ color: MUTED }}>{app.desc}</p>
                </button>
                {open && (
                  <div className="mt-3 border p-4" style={{ borderColor: BORDER, background: "#fff" }}>
                    <ul className="space-y-1.5 mb-3">
                      {app.features.map((f, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0" style={{ background: ACCENT }} />{f}
                        </li>
                      ))}
                    </ul>
                    <Btn href={app.url} variant="primary" full>Open {app.name} <ArrowRight className="h-4 w-4" /></Btn>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* For brands teaser */}
      <section className="border-t" style={{ borderColor: BORDER, background: "#fff" }}>
        <div className="mx-auto max-w-6xl px-5 py-14">
          <p className="text-xs font-bold tracking-[0.24em]" style={{ color: ACCENT }}>FOR BRANDS</p>
          <h2 className="mt-3 text-3xl md:text-4xl font-bold tracking-tight max-w-2xl">{brandCfg.headline}</h2>
          <p className="mt-4 max-w-2xl" style={{ color: MUTED }}>{brandCfg.intro}</p>
          <div className="mt-6"><Btn variant="accent" onClick={goBrand}>See plans & become a partner <ArrowRight className="h-4 w-4" /></Btn></div>
        </div>
      </section>

      <footer className="py-8 text-center text-sm" style={{ color: MUTED }}>ZonicMe — a connected ecosystem by ZonicMe Limited · Prototype</footer>
    </main>
  );
}

/* ===================== BRAND (offer + register + pay + portal) ===================== */
function Brand({ brandCfg, session, setSession, events }) {
  const [step, setStep] = useState("offer");   // offer | register | checkout | portal
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [chosen, setChosen] = useState(null);
  const [brandId, setBrandId] = useState(null);

  if (session) {
    return <BrandPortal session={session} brandCfg={brandCfg} events={events} onLogout={() => setSession(null)} />;
  }

  return (
    <main className="mx-auto max-w-6xl px-5 py-12">
      {step === "offer" && (
        <>
          <p className="text-xs font-bold tracking-[0.24em]" style={{ color: ACCENT }}>FOR BRANDS</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight max-w-3xl">{brandCfg.headline}</h1>
          <p className="mt-4 max-w-2xl" style={{ color: MUTED }}>{brandCfg.intro}</p>

          <div className="mt-8 grid md:grid-cols-2 gap-x-10 gap-y-3 max-w-4xl">
            {brandCfg.benefits.map((b, i) => (
              <div key={i} className="flex items-start gap-3">
                <Check className="h-5 w-5 shrink-0 mt-0.5" style={{ color: ACCENT }} />
                <span>{b}</span>
              </div>
            ))}
          </div>

          <h2 className="mt-12 mb-4 text-xs font-bold tracking-[0.2em]" style={{ color: MUTED }}>PLANS</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {brandCfg.plans.map((p) => (
              <div key={p.id} className="border p-6 flex flex-col" style={{ borderColor: p.highlighted ? INK : BORDER, background: "#fff", borderWidth: p.highlighted ? 2 : 1 }}>
                {p.highlighted && <span className="self-start mb-3 text-[10px] font-bold tracking-widest px-2 py-1" style={{ background: ACCENT, color: "#fff" }}>MOST POPULAR</span>}
                <div className="text-lg font-bold">{p.name}</div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-bold tracking-tight">{naira(p.price)}</span>
                  <span className="text-sm" style={{ color: MUTED }}>{p.period}</span>
                </div>
                <ul className="mt-4 space-y-2 flex-1">
                  {p.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm"><Check className="h-4 w-4 shrink-0 mt-0.5" style={{ color: ACCENT }} />{f}</li>
                  ))}
                </ul>
                <div className="mt-6"><Btn variant={p.highlighted ? "primary" : "secondary"} full onClick={() => { setChosen(p); setStep("register"); }}>Choose {p.name}</Btn></div>
              </div>
            ))}
          </div>
        </>
      )}

      {step === "register" && (
        <div className="max-w-md">
          <h1 className="text-3xl font-bold tracking-tight">Create your brand account</h1>
          <p className="mt-2 text-sm" style={{ color: MUTED }}>
            One Brand ID works across ZonicMe and every app in the network. On ZonicMe it unlocks your analytics and campaign tools.
          </p>
          <div className="mt-6 space-y-4">
            <Field label="Business name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="e.g. Lagos Beauty Co." />
            <Field label="Work email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} placeholder="brand@company.com" />
            <Field label="Password" type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} />
            <div className="border p-3 text-sm" style={{ borderColor: BORDER, background: "#fff", color: MUTED }}>
              Selected plan: <strong style={{ color: INK }}>{chosen?.name}</strong> — {naira(chosen?.price)} {chosen?.period}
            </div>
            <Btn variant="primary" full onClick={() => { setBrandId("ZNM-" + Math.random().toString(36).slice(2, 7).toUpperCase()); setStep("checkout"); }}>
              Continue to payment <ArrowRight className="h-4 w-4" />
            </Btn>
            <button onClick={() => setStep("offer")} className="text-sm" style={{ color: MUTED }}>← Back to plans</button>
          </div>
        </div>
      )}

      {step === "checkout" && (
        <div className="max-w-md">
          <h1 className="text-3xl font-bold tracking-tight">Payment</h1>
          <div className="mt-4 border" style={{ borderColor: BORDER, background: "#fff" }}>
            <div className="p-4 border-b" style={{ borderColor: BORDER }}>
              <div className="text-xs font-bold tracking-widest" style={{ color: MUTED }}>YOUR BRAND ID</div>
              <div className="text-lg font-bold tracking-tight">{brandId}</div>
              <div className="text-xs" style={{ color: MUTED }}>Use this ID and your login on ZonicMe and every app in the network.</div>
            </div>
            <div className="p-4 flex items-center justify-between">
              <div>
                <div className="font-bold">{chosen?.name} plan</div>
                <div className="text-sm" style={{ color: MUTED }}>{chosen?.period}</div>
              </div>
              <div className="text-2xl font-bold tracking-tight">{naira(chosen?.price)}</div>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            <Btn variant="accent" full onClick={() => setSession({ name: form.name || "Demo Brand", id: brandId, plan: chosen })}>
              Pay {naira(chosen?.price)} securely
            </Btn>
            <p className="text-xs text-center" style={{ color: MUTED }}>
              Secured by Flutterwave (Paystack fallback). This prototype simulates the charge; the live payment module is already built.
            </p>
            <button onClick={() => setStep("register")} className="text-sm" style={{ color: MUTED }}>← Back</button>
          </div>
        </div>
      )}
    </main>
  );
}

function BrandPortal({ session, brandCfg, events, onLogout }) {
  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <div className="border p-4 mb-6 flex items-center justify-between flex-wrap gap-3" style={{ borderColor: BORDER, background: "#fff" }}>
        <div>
          <div className="text-xs font-bold tracking-widest" style={{ color: MUTED }}>BRAND PORTAL</div>
          <div className="text-lg font-bold">{session.name} <span className="font-normal" style={{ color: MUTED }}>· {session.id}</span></div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm px-3 py-1.5 font-semibold" style={{ background: ACCENT, color: "#fff" }}>{session.plan?.name} · active</span>
          <Btn variant="secondary" onClick={onLogout} className="!px-3 !py-1.5">Sign out</Btn>
        </div>
      </div>
      <h1 className="text-2xl font-bold tracking-tight mb-1">Custom report builder</h1>
      <p className="text-sm mb-5" style={{ color: MUTED }}>Build any report with the filters below. Every chart recomputes live.</p>
      <Analytics events={events} />
    </main>
  );
}

/* ===================== ADMIN ===================== */
function Admin({ content, setContent, apps, setApps, brandCfg, setBrandCfg, events }) {
  const [tab, setTab] = useState("studio");
  const tabs = [["studio", "Content Studio"], ["setup", "Site setup"], ["resources", "Resources"], ["analytics", "Analytics"]];
  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <div className="flex gap-2 mb-6 border-b" style={{ borderColor: BORDER }}>
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className="px-4 py-3 text-sm font-semibold rounded-none -mb-px border-b-2"
            style={{ color: tab === k ? INK : MUTED, borderColor: tab === k ? INK : "transparent" }}>
            {label}
          </button>
        ))}
      </div>
      {tab === "studio" && <ContentStudio content={content} setContent={setContent} apps={apps} setApps={setApps} brandCfg={brandCfg} setBrandCfg={setBrandCfg} />}
      {tab === "setup" && <AdminSetup brandCfg={brandCfg} setBrandCfg={setBrandCfg} />}
      {tab === "resources" && <Resources />}
      {tab === "analytics" && <Analytics events={events} />}
    </main>
  );
}

function AdminContent({ content, setContent, apps, setApps }) {
  const set = (k, v) => setContent({ ...content, [k]: v });
  const setApp = (i, k, v) => setApps(apps.map((a, idx) => idx === i ? { ...a, [k]: v } : a));
  return (
    <div className="space-y-6">
      <div className="border p-5" style={{ borderColor: BORDER, background: "#fff" }}>
        <h3 className="font-bold mb-4">Headline & hero</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Eyebrow" value={content.eyebrow} onChange={(v) => set("eyebrow", v)} />
          <Field label="Headline" value={content.headline} onChange={(v) => set("headline", v)} />
          <Field label="Accent line" value={content.headlineAccent} onChange={(v) => set("headlineAccent", v)} />
          <Field label="Subhead" value={content.subhead} onChange={(v) => set("subhead", v)} area />
        </div>
      </div>
      <div className="border p-5" style={{ borderColor: BORDER, background: "#fff" }}>
        <h3 className="font-bold mb-4">Apps (name, description, link)</h3>
        <div className="space-y-4">
          {apps.map((app, i) => (
            <div key={app.id} className="grid md:grid-cols-2 gap-3 border-b pb-4 last:border-0" style={{ borderColor: BORDER }}>
              <Field label="Name" value={app.name} onChange={(v) => setApp(i, "name", v)} />
              <Field label="Link (URL)" value={app.url} onChange={(v) => setApp(i, "url", v)} />
              <div className="md:col-span-2"><Field label="Two-line description" value={app.desc} onChange={(v) => setApp(i, "desc", v)} area /></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AdminSetup({ brandCfg, setBrandCfg }) {
  const set = (k, v) => setBrandCfg({ ...brandCfg, [k]: v });
  const setBenefit = (i, v) => set("benefits", brandCfg.benefits.map((b, idx) => idx === i ? v : b));
  const setPlan = (i, k, v) => set("plans", brandCfg.plans.map((p, idx) => idx === i ? { ...p, [k]: k === "price" ? Number(v) || 0 : v } : p));
  const setPlanFeatures = (i, v) => setPlan(i, "features", v.split("\n").filter(Boolean));
  return (
    <div className="space-y-6">
      <div className="border p-3 text-sm" style={{ borderColor: ACCENT, background: "#fff", color: INK }}>
        Everything brands see — the offer, the benefits and the pricing — is edited here and updates the For-brands page instantly.
      </div>
      <div className="border p-5" style={{ borderColor: BORDER, background: "#fff" }}>
        <h3 className="font-bold mb-4">Brand offer</h3>
        <div className="grid gap-4">
          <Field label="Brand headline" value={brandCfg.headline} onChange={(v) => set("headline", v)} />
          <Field label="Brand intro" value={brandCfg.intro} onChange={(v) => set("intro", v)} area />
        </div>
        <h4 className="font-semibold mt-5 mb-2 text-sm">What brands get</h4>
        <div className="space-y-2">
          {brandCfg.benefits.map((b, i) => (
            <input key={i} value={b} onChange={(e) => setBenefit(i, e.target.value)}
              className="w-full rounded-none border px-3 py-2 text-sm outline-none" style={{ borderColor: BORDER }} />
          ))}
        </div>
      </div>
      <div className="border p-5" style={{ borderColor: BORDER, background: "#fff" }}>
        <h3 className="font-bold mb-4">Plans & pricing</h3>
        <div className="grid md:grid-cols-3 gap-4">
          {brandCfg.plans.map((p, i) => (
            <div key={p.id} className="border p-4 space-y-3" style={{ borderColor: BORDER }}>
              <Field label="Plan name" value={p.name} onChange={(v) => setPlan(i, "name", v)} />
              <Field label="Price (₦)" type="number" value={p.price} onChange={(v) => setPlan(i, "price", v)} />
              <Field label="Period" value={p.period} onChange={(v) => setPlan(i, "period", v)} />
              <label className="block">
                <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: MUTED }}>Features (one per line)</span>
                <textarea rows={5} value={p.features.join("\n")} onChange={(e) => setPlanFeatures(i, e.target.value)}
                  className="mt-1.5 w-full rounded-none border px-3 py-2 text-sm outline-none" style={{ borderColor: BORDER }} />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={p.highlighted} onChange={(e) => setPlan(i, "highlighted", e.target.checked)} /> Highlight as most popular
              </label>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ===================== ANALYTICS (multi-select everything) ===================== */
function MultiChips({ label, options, sel, setSel, render }) {
  const toggle = (v) => setSel(sel.includes(v) ? sel.filter((x) => x !== v) : [...sel, v]);
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: MUTED }}>{label}</span>
        {sel.length > 0 && <button onClick={() => setSel([])} className="text-xs" style={{ color: ACCENT }}>Clear</button>}
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => <Chip key={o} label={render ? render(o) : o} active={sel.includes(o)} onClick={() => toggle(o)} />)}
      </div>
    </div>
  );
}

function Analytics({ events }) {
  const [selApps, setApps] = useState([]);
  const [selTypes, setTypes] = useState([]);
  const [selAges, setAges] = useState([]);
  const [selGenders, setGenders] = useState([]);
  const [selStates, setStates] = useState([]);
  const [selDays, setDays] = useState([90]);

  const days = selDays.length ? Math.max(...selDays) : 90;
  const inSet = (set, v) => set.length === 0 || set.includes(v);

  const filtered = useMemo(() => events.filter((e) =>
    inSet(selApps, e.app) && inSet(selTypes, e.type) && inSet(selAges, e.age) &&
    inSet(selGenders, e.gender) && inSet(selStates, e.state) && e.daysAgo <= days
  ), [events, selApps, selTypes, selAges, selGenders, selStates, days]);

  const nameOf = (id) => DEFAULT_APPS.find((a) => a.id === id)?.name || id;
  const kpis = useMemo(() => ({
    events: filtered.length,
    users: new Set(filtered.map((e) => e.u)).size,
    purchases: filtered.filter((e) => e.type === "purchase").length,
    adwatch: filtered.filter((e) => e.type === "ad_watch").length,
  }), [filtered]);
  const byApp = useMemo(() => APP_IDS.map((id) => ({ name: nameOf(id), events: filtered.filter((e) => e.app === id).length })), [filtered]);
  const byType = useMemo(() => TYPES.map((t) => ({ name: t, value: filtered.filter((e) => e.type === t).length })).filter((d) => d.value), [filtered]);
  const byAge = useMemo(() => AGES.map((b) => ({ name: b, users: new Set(filtered.filter((e) => e.age === b).map((e) => e.u)).size })), [filtered]);
  const byState = useMemo(() => STATES.map((s) => ({ name: s, events: filtered.filter((e) => e.state === s).length })).sort((a, b) => b.events - a.events).slice(0, 6), [filtered]);
  const overTime = useMemo(() => {
    const step = Math.max(1, Math.round(days / 12)); const out = [];
    for (let d = days; d >= 0; d -= step) out.push({ name: d + "d", events: filtered.filter((e) => Math.abs(e.daysAgo - d) < step / 2).length });
    return out.reverse();
  }, [filtered, days]);

  return (
    <div className="space-y-5">
      <div className="border p-5 space-y-4" style={{ borderColor: BORDER, background: "#fff" }}>
        <MultiChips label="Apps" options={APP_IDS} sel={selApps} setSel={setApps} render={nameOf} />
        <MultiChips label="Engagement type" options={TYPES} sel={selTypes} setSel={setTypes} />
        <div className="grid md:grid-cols-3 gap-4">
          <MultiChips label="Age band" options={AGES} sel={selAges} setSel={setAges} />
          <MultiChips label="Gender" options={GENDERS} sel={selGenders} setSel={setGenders} />
          <MultiChips label="Time range" options={[7, 30, 90]} sel={selDays} setSel={setDays} render={(d) => "Last " + d + "d"} />
        </div>
        <MultiChips label="Location (state)" options={STATES} sel={selStates} setSel={setStates} />
        <Btn variant="secondary" className="!px-4 !py-2">Export report (CSV / PDF)</Btn>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[["Engagements", kpis.events], ["Active users", kpis.users], ["Purchases", kpis.purchases], ["Ads watched", kpis.adwatch]].map(([l, v]) => (
          <div key={l} className="border p-4" style={{ borderColor: BORDER, background: "#fff" }}>
            <div className="text-xs uppercase tracking-wider" style={{ color: MUTED }}>{l}</div>
            <div className="text-2xl font-bold tracking-tight mt-1">{v.toLocaleString()}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="Engagement by app">
          <ResponsiveContainer width="100%" height={240}><BarChart data={byApp}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} /><Tooltip />
            <Bar dataKey="events" fill={ACCENT} />
          </BarChart></ResponsiveContainer>
        </Panel>
        <Panel title="Engagement over time">
          <ResponsiveContainer width="100%" height={240}><LineChart data={overTime}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} /><Tooltip />
            <Line type="monotone" dataKey="events" stroke={CHART[1]} strokeWidth={2.5} dot={false} />
          </LineChart></ResponsiveContainer>
        </Panel>
        <Panel title="Audience by age (active users)">
          <ResponsiveContainer width="100%" height={240}><BarChart data={byAge}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} /><Tooltip />
            <Bar dataKey="users" fill={CHART[2]} />
          </BarChart></ResponsiveContainer>
        </Panel>
        <Panel title="Engagement mix">
          <ResponsiveContainer width="100%" height={240}><PieChart>
            <Pie data={byType} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85} label={(d) => d.name}>
              {byType.map((_, i) => <Cell key={i} fill={CHART[i % CHART.length]} />)}
            </Pie><Tooltip />
          </PieChart></ResponsiveContainer>
        </Panel>
        <Panel title="Top locations" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={240}><BarChart data={byState} layout="vertical" margin={{ left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis type="number" tick={{ fontSize: 12 }} /><YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={90} /><Tooltip />
            <Bar dataKey="events" fill={CHART[0]} />
          </BarChart></ResponsiveContainer>
        </Panel>
      </div>
      <p className="text-xs" style={{ color: MUTED }}>Sample data for demonstration. In production these run on anonymized, consented events aggregated across all ZonicMe apps.</p>
    </div>
  );
}
function Panel({ title, children, className = "" }) {
  return (
    <div className={"border p-5 " + className} style={{ borderColor: BORDER, background: "#fff" }}>
      <h4 className="text-sm font-bold mb-3">{title}</h4>{children}
    </div>
  );
}

/* ===================== CONTENT STUDIO (#1 + #3) ===================== */
function ContentStudio({ content, setContent, apps, setApps, brandCfg, setBrandCfg }) {
  const [page, setPage] = useState("landing");
  const [draftC, setDraftC] = useState(content);
  const [draftA, setDraftA] = useState(apps);
  const [draftB, setDraftB] = useState(brandCfg);
  const [media, setMedia] = useState({ heroImage: null, heroVideo: "" });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const mark = () => { setDirty(true); setStatus(""); };
  const setC = (k, v) => { setDraftC({ ...draftC, [k]: v }); mark(); };
  const setApp = (i, k, v) => { setDraftA(draftA.map((a, idx) => idx === i ? { ...a, [k]: v } : a)); mark(); };
  const setB = (k, v) => { setDraftB({ ...draftB, [k]: v }); mark(); };

  const onPickImage = async (e) => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    setBusy(true);
    try { const sizes = await resizeForDevices(file); setMedia((m) => ({ ...m, heroImage: { sizes, url: sizes[sizes.length - 1].url } })); mark(); }
    finally { setBusy(false); }
  };

  const publish = () => { setContent(draftC); setApps(draftA); setBrandCfg(draftB); setDirty(false); setStatus("Published — your changes are live."); };
  const discard = () => { setDraftC(content); setDraftA(apps); setDraftB(brandCfg); setMedia({ heroImage: null, heroVideo: "" }); setDirty(false); setStatus("Changes discarded."); };

  return (
    <div className="space-y-5">
      <div className="border p-3 text-sm flex items-center justify-between flex-wrap gap-2" style={{ borderColor: ACCENT, background: "#fff" }}>
        <span>Editing pages is a <strong>super-admin-granted</strong> right. The super admin grants or revokes it per admin.</span>
        <span className="text-xs px-2 py-1 font-bold" style={{ background: ACCENT, color: "#fff" }}>EDITOR ACCESS · GRANTED</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {[["landing", "Landing"], ["brands", "For brands"]].map(([k, l]) => <Chip key={k} label={l} active={page === k} onClick={() => setPage(k)} />)}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* EDITOR */}
        <div className="space-y-4">
          {page === "landing" && (<>
            <div className="border p-4 space-y-3" style={{ borderColor: BORDER, background: "#fff" }}>
              <h4 className="font-bold text-sm">Text on this page</h4>
              <Field label="Eyebrow" value={draftC.eyebrow} onChange={(v) => setC("eyebrow", v)} />
              <Field label="Headline" value={draftC.headline} onChange={(v) => setC("headline", v)} />
              <Field label="Accent line" value={draftC.headlineAccent} onChange={(v) => setC("headlineAccent", v)} />
              <Field label="Subhead" value={draftC.subhead} onChange={(v) => setC("subhead", v)} area />
            </div>
            <div className="border p-4 space-y-3" style={{ borderColor: BORDER, background: "#fff" }}>
              <h4 className="font-bold text-sm">Hero media — auto-sized for every device</h4>
              {media.heroImage ? (
                <div className="space-y-2">
                  <div className="flex gap-3">
                    {media.heroImage.sizes.map((s, i) => (
                      <div key={i} className="text-center">
                        <img src={s.url} alt="" className="h-16 w-auto border" style={{ borderColor: BORDER }} />
                        <div className="text-[10px] mt-1" style={{ color: MUTED }}>{s.label}<br />{s.width}×{s.height} · {s.kb}KB</div>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => { setMedia((m) => ({ ...m, heroImage: null })); mark(); }} className="text-xs" style={{ color: "#C4502E" }}>Remove image</button>
                </div>
              ) : (
                <label className="block">
                  <span className="text-xs" style={{ color: MUTED }}>{busy ? "Generating Mobile / Tablet / Desktop sizes…" : "Add an image — Mobile, Tablet & Desktop versions are created automatically"}</span>
                  <input type="file" accept="image/*" onChange={onPickImage} className="mt-1 block text-sm" />
                </label>
              )}
              <div className="pt-3 border-t" style={{ borderColor: BORDER }}>
                {media.heroVideo ? (
                  <div className="flex items-center justify-between text-sm gap-3">
                    <span className="truncate">{media.heroVideo}</span>
                    <button onClick={() => { setMedia((m) => ({ ...m, heroVideo: "" })); mark(); }} className="text-xs shrink-0" style={{ color: "#C4502E" }}>Remove video</button>
                  </div>
                ) : (
                  <Field label="Add video (URL)" value="" onChange={(v) => { setMedia((m) => ({ ...m, heroVideo: v })); mark(); }} placeholder="https://…/clip.mp4" />
                )}
              </div>
            </div>
            <div className="border p-4 space-y-3" style={{ borderColor: BORDER, background: "#fff" }}>
              <h4 className="font-bold text-sm">App cards</h4>
              {draftA.map((a, i) => (
                <div key={a.id} className="grid grid-cols-2 gap-2 border-b pb-3 last:border-0" style={{ borderColor: BORDER }}>
                  <Field label="Name" value={a.name} onChange={(v) => setApp(i, "name", v)} />
                  <Field label="Link" value={a.url} onChange={(v) => setApp(i, "url", v)} />
                  <div className="col-span-2"><Field label="Description" value={a.desc} onChange={(v) => setApp(i, "desc", v)} area /></div>
                </div>
              ))}
            </div>
          </>)}
          {page === "brands" && (
            <div className="border p-4 space-y-3" style={{ borderColor: BORDER, background: "#fff" }}>
              <h4 className="font-bold text-sm">Text on this page</h4>
              <Field label="Brand headline" value={draftB.headline} onChange={(v) => setB("headline", v)} />
              <Field label="Brand intro" value={draftB.intro} onChange={(v) => setB("intro", v)} area />
              <p className="text-xs" style={{ color: MUTED }}>Plans &amp; pricing are managed in the Site setup tab.</p>
            </div>
          )}
        </div>

        {/* LIVE PREVIEW (visual representation of the page) */}
        <div className="border self-start" style={{ borderColor: BORDER, background: CANVAS }}>
          <div className="text-[10px] font-bold tracking-widest px-3 py-2 border-b" style={{ borderColor: BORDER, color: MUTED }}>
            LIVE PREVIEW · {page === "landing" ? "LANDING" : "FOR BRANDS"}
          </div>
          <div className="p-5">
            {page === "landing" ? (<>
              <p className="text-[10px] font-bold tracking-[0.2em]" style={{ color: MUTED }}>{draftC.eyebrow}</p>
              <h3 className="mt-1 text-2xl font-bold leading-tight">{draftC.headline} <span style={{ color: ACCENT }}>{draftC.headlineAccent}</span></h3>
              <p className="mt-2 text-sm" style={{ color: MUTED }}>{draftC.subhead}</p>
              {media.heroVideo
                ? <video src={media.heroVideo} className="mt-3 w-full border" style={{ borderColor: BORDER }} controls />
                : media.heroImage ? <img src={media.heroImage.url} alt="" className="mt-3 w-full border" style={{ borderColor: BORDER }} /> : null}
              <div className="mt-4 flex gap-2 overflow-x-auto">
                {draftA.map((a) => <div key={a.id} className="shrink-0 w-28 p-2 text-white text-xs font-bold" style={{ background: INK }}>{a.name}</div>)}
              </div>
            </>) : (<>
              <p className="text-[10px] font-bold tracking-[0.2em]" style={{ color: ACCENT }}>FOR BRANDS</p>
              <h3 className="mt-1 text-2xl font-bold leading-tight">{draftB.headline}</h3>
              <p className="mt-2 text-sm" style={{ color: MUTED }}>{draftB.intro}</p>
            </>)}
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 border p-3 flex items-center justify-between gap-3" style={{ borderColor: BORDER, background: "#fff" }}>
        <span className="text-sm" style={{ color: dirty ? INK : MUTED }}>{dirty ? "You have unpublished changes." : (status || "All changes published.")}</span>
        <div className="flex gap-2">
          <Btn variant="secondary" onClick={discard} className="!px-4 !py-2">Discard</Btn>
          <Btn variant="primary" onClick={publish} className="!px-4 !py-2">Publish changes</Btn>
        </div>
      </div>
    </div>
  );
}

/* ===================== RESOURCES & COST (#2) ===================== */
function Resources() {
  const [sel, setSel] = useState([]); // empty = all sites cumulated
  const scope = sel.length ? sel : SITES.map((s) => s.id);
  const num = (n) => n.toLocaleString();
  const rows = scope.map((id) => ({ id, name: SITES.find((s) => s.id === id).name, ...RESOURCES[id] }));
  const total = rows.reduce((t, r) => ({
    apiCalls: t.apiCalls + r.apiCalls, aiCalls: t.aiCalls + r.aiCalls, imgTransforms: t.imgTransforms + r.imgTransforms,
    emails: t.emails + r.emails, events: t.events + r.events, costNGN: t.costNGN + r.costNGN,
  }), { apiCalls: 0, aiCalls: 0, imgTransforms: 0, emails: 0, events: 0, costNGN: 0 });
  const toggle = (id) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  const costBySite = rows.map((r) => ({ name: r.name, cost: Math.round(r.costNGN / 1000) }));
  const mix = [["API calls", "apiCalls"], ["AI calls", "aiCalls"], ["Image transforms", "imgTransforms"], ["Emails", "emails"]].map(([name, k]) => ({ name, value: total[k] }));
  const trend = TREND.map((m, i) => ({ name: m, cost: scope.reduce((s, id) => s + COST_TREND[id][i], 0) }));
  const cell = { borderColor: BORDER };

  return (
    <div className="space-y-5">
      <div className="border p-3 text-sm" style={{ borderColor: ACCENT, background: "#fff" }}>
        Resource &amp; cost across the ecosystem. Pick one site, any combination, or leave blank for <strong>all sites cumulated</strong>.
      </div>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: MUTED }}>Sites in scope {sel.length ? "(" + sel.length + ")" : "(all)"}</span>
          {sel.length > 0 && <button onClick={() => setSel([])} className="text-xs" style={{ color: ACCENT }}>All sites</button>}
        </div>
        <div className="flex flex-wrap gap-2">{SITES.map((s) => <Chip key={s.id} label={s.name} active={sel.includes(s.id)} onClick={() => toggle(s.id)} />)}</div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[["Est. monthly cost", naira(total.costNGN)], ["API calls", num(total.apiCalls)], ["AI calls", num(total.aiCalls)], ["Events", num(total.events)]].map(([l, v]) => (
          <div key={l} className="border p-4" style={{ borderColor: BORDER, background: "#fff" }}>
            <div className="text-xs uppercase tracking-wider" style={{ color: MUTED }}>{l}</div>
            <div className="text-2xl font-bold tracking-tight mt-1">{v}</div>
          </div>
        ))}
      </div>

      <div className="border overflow-x-auto" style={{ borderColor: BORDER, background: "#fff" }}>
        <table className="w-full text-sm">
          <thead><tr className="text-left" style={{ color: MUTED }}>
            {["Site", "API calls", "AI calls", "Image transforms", "Emails", "Events", "Est. cost"].map((h) => (
              <th key={h} className="font-semibold uppercase tracking-wide text-xs px-4 py-3 border-b" style={cell}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3 border-b font-medium" style={cell}>{r.name}</td>
                <td className="px-4 py-3 border-b" style={cell}>{num(r.apiCalls)}</td>
                <td className="px-4 py-3 border-b" style={cell}>{num(r.aiCalls)}</td>
                <td className="px-4 py-3 border-b" style={cell}>{num(r.imgTransforms)}</td>
                <td className="px-4 py-3 border-b" style={cell}>{num(r.emails)}</td>
                <td className="px-4 py-3 border-b" style={cell}>{num(r.events)}</td>
                <td className="px-4 py-3 border-b" style={cell}>{naira(r.costNGN)}</td>
              </tr>
            ))}
            <tr style={{ background: CANVAS }}>
              <td className="px-4 py-3 font-bold">Cumulated</td>
              <td className="px-4 py-3 font-bold">{num(total.apiCalls)}</td>
              <td className="px-4 py-3 font-bold">{num(total.aiCalls)}</td>
              <td className="px-4 py-3 font-bold">{num(total.imgTransforms)}</td>
              <td className="px-4 py-3 font-bold">{num(total.emails)}</td>
              <td className="px-4 py-3 font-bold">{num(total.events)}</td>
              <td className="px-4 py-3 font-bold">{naira(total.costNGN)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="Cost by site (₦ thousands)">
          <ResponsiveContainer width="100%" height={240}><BarChart data={costBySite}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} /><Tooltip />
            <Bar dataKey="cost">{costBySite.map((_, i) => <Cell key={i} fill={CHART2[i % CHART2.length]} />)}</Bar>
          </BarChart></ResponsiveContainer>
        </Panel>
        <Panel title="Resource mix">
          <ResponsiveContainer width="100%" height={240}><PieChart>
            <Pie data={mix} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85} label={(d) => d.name}>
              {mix.map((_, i) => <Cell key={i} fill={CHART2[i % CHART2.length]} />)}
            </Pie><Tooltip />
          </PieChart></ResponsiveContainer>
        </Panel>
        <Panel title="Cost over time (₦ thousands)" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={240}><LineChart data={trend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} /><Tooltip />
            <Line type="monotone" dataKey="cost" stroke={ACCENT} strokeWidth={2.5} dot={false} />
          </LineChart></ResponsiveContainer>
        </Panel>
      </div>
      <p className="text-xs" style={{ color: MUTED }}>Sample figures for demonstration. In production these read from each app's metered usage (API calls, AI/image processing, emails, events) and the cost model.</p>
    </div>
  );
}
