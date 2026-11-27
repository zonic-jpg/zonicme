/**
 * ZonicMe apps config — seed from config/apps.json, editable via admin → localStorage.
 */
(function (global) {
  const STORAGE_KEY = "zonicme_apps_config_v2";
  const INGEST_KEY = "zonicme_ingest_url";
  const DEFAULT_CONFIG_URL = "./config/apps.json";

  const FALLBACK = {
    version: "1.0",
    mission:
      "ZonicMe builds apps that turn fashion, art, media and everyday planning into real opportunity across Africa and the diaspora.",
    ingest: {
      ZONICME_INGEST_URL:
        "https://YOUR-SUPABASE-PROJECT.supabase.co/functions/v1/zonic-hub-ingest",
    },
    apps: [
      {
        id: "myyanga",
        name: "MyYangaX",
        benefit: "Try a look before you buy it, and order straight from the creator who styled it.",
        brandBenefit: "Put your designs in front of fashion-forward shoppers who are ready to discover and buy.",
        summary:
          "African fashion discovery, styling and Runway.\nCreators and shoppers meet in one place.",
        detail:
          "MyYangaX is ZonicMe’s fashion platform. Browse looks, style them your way, and follow Runway drops from African designers and the diaspora. Discovery meets commerce so creators earn and audiences find style that feels like home.",
        features: [
          "Post your look, collect likes and wait for the reveal",
          "Designer Runway drops with lookbooks, fabric filters and save-to-wishlist",
          "A styling studio that lets you see a piece on you before you buy",
          "Creator storefronts with WhatsApp-ready ordering for shoppers",
          "Style reels and curated African fashion collections for diaspora + home",
          "Specials for his and hers, plus fashion events",
        ],
        url: "https://myyangax.netlify.app",
        thumbnail: "./assets/thumb-myyanga.jpg",
        orbit: "./orbit/myyangax.json",
        orbitLive: "https://myyangax.netlify.app/orbit-manifest.json",
        color: "#E85D04",
      },
      {
        id: "myafriart",
        name: "MyAfriArt",
        benefit: "Preview a piece on your own wall before you commit, and buy with real provenance.",
        brandBenefit: "Get your gallery and artists in front of collectors actively looking to buy African art.",
        summary:
          "African art marketplace: discover, stage, collect.\nGalleries and collectors in one place.",
        detail:
          "MyAfriArt connects artists, galleries, and collectors across Africa and the diaspora. Discover original work, stage digital exhibitions, and collect with confidence, on a marketplace built for the continent’s creative voice.",
        features: [
          "Artist and gallery storefronts with provenance-ready listings",
          "AI room / wall staging so collectors preview art in a real space",
          "Curated collections and digital exhibition staging for galleries",
          "Multi-currency checkout paths tuned for Africa and diaspora buyers",
          "Collector wishlists, shortlists and enquiry flows",
          "Gallery insights on pieces listed, stagings and collector interest",
        ],
        url: "https://myafriartx.netlify.app",
        thumbnail: "./assets/thumb-afriart.jpg",
        orbit: "./orbit/myafriart.json",
        orbitLive: "https://myafriartx.netlify.app/orbit-manifest.json",
        color: "#2F7D4F",
      },
      {
        id: "rubba",
        name: "Rubba",
        benefit: "Turn a vague goal into milestones you can actually track, week by week.",
        brandBenefit: "Reach people mid-plan for a big purchase (a move, a wedding, a business) while they're deciding.",
        summary:
          "Life-planning for goals, savings, milestones.\nTurn ambition into a clear next step.",
        detail:
          "Rubba helps people plan life with clarity: goals, savings targets, and milestones in one calm workspace. Built for everyday Africans who want structure without complexity, and progress they can see.",
        features: [
          "Goal categories with milestones you can track week by week",
          "Savings targets with progress bars and check-in reminders",
          "City-aware cost planning for African metros and diaspora moves",
          "Genie-assisted plans that turn a wish into a concrete next step",
          "Personal insights dashboard without overwhelming finance jargon",
          "A progress view of plans created, assists used and milestones hit",
        ],
        url: "https://rubbax.netlify.app",
        thumbnail: "./assets/thumb-rubba.jpg",
        orbit: "./orbit/rubba.json",
        orbitLive: "https://rubbax.netlify.app/orbit-manifest.json",
        color: "#C99A2E",
      },
      {
        id: "adspot",
        name: "AdSpot",
        benefit: "Get paid for the attention you already give, on your own terms.",
        brandBenefit: "Reach real, consented African audiences and pay only for attention that's genuine.",
        summary:
          "Media & partner ads with rewarded attention.\nBrands reach real people, audiences earn.",
        detail:
          "AdSpot is the orbit’s media and partner network. Rewarded attention means brands reach consented audiences while users earn value. Transparent, fair, and tuned for African markets and diaspora reach.",
        features: [
          "Rewarded video / ad feed with quizzes for engaged attention",
          "XP, leaderboards and weekly payouts for consented viewers",
          "Partner brand campaigns with transparent performance analytics",
          "Consent-first audience reach across African markets and diaspora",
          "Brand dashboards for watches, completion and campaign health",
          "Clear reporting on ad watches, campaign reach and viewer activity",
        ],
        url: "https://adspotx.netlify.app",
        thumbnail: "./assets/thumb-adspot.jpg",
        orbit: "./orbit/adspotx.json",
        orbitLive: "https://adspotx.netlify.app/orbit-manifest.json",
        color: "#1A6B5A",
      },
      {
        id: "owanbex",
        name: "Owanbe",
        benefit: "Plan a Nigerian celebration without spreadsheets: vendors, budget and guest list in one place.",
        brandBenefit: "Reach families actively budgeting and buying for real, dated celebrations.",
        summary:
          "Plan Nigerian celebrations end-to-end.\nVendors, budgets, aso ebi, guest lists.",
        detail:
          "Owanbe helps families and brands plan weddings, birthdays, and milestone events across Nigeria, with vetted vendors, live Naira budgets, aso ebi coordination, and brand analytics in one planner.",
        features: [
          "End-to-end event builder for weddings, birthdays and milestones",
          "Vetted vendor directory with shortlists and comparison notes",
          "Live Naira budgets that stay visible as plans change",
          "Aso ebi coordination for fabrics, colours and group orders",
          "Guest lists, RSVPs and day-of planning checklists",
          "Brand / sponsorship analytics for celebration partners",
        ],
        url: "https://myowanbe.com",
        thumbnail: "./assets/thumb-owanbe.jpg",
        orbit: "./orbit/owanbex.json",
        orbitLive: "https://myowanbe.com/orbit-manifest.json",
        color: "#9B2335",
      },
      {
        "id": "confirmahead",
        "name": "ConfirmAhead",
        "benefit": "Fewer no-shows: customers get a WhatsApp confirmation and reminder for every booking.",
        "brandBenefit": "Service businesses fill their diary and cut empty slots with automatic reminders and deposits.",
        "summary": "WhatsApp booking confirmations and reminders.\nBuilt for service businesses.",
        "detail": "ConfirmAhead helps salons, clinics, studios and other service businesses take bookings, confirm them on WhatsApp and remind customers before the appointment, so fewer slots go empty.",
        "features": [
          "Online booking page for services and staff",
          "Automatic WhatsApp confirmation and reminder messages",
          "Staff availability, time off and service lists",
          "Business dashboard with bookings and messages",
          "Plans for small and growing businesses"
        ],
        "url": "https://confirmahead.netlify.app",
        "color": "#2563EB"
      },
      {
        "id": "sydef",
        "name": "Sydef",
        "benefit": "Book self-defence classes near you and learn practical safety skills.",
        "brandBenefit": "Reach people actively investing in their personal safety and wellbeing.",
        "summary": "Self-defence class booking.\nSafety skills for everyday life.",
        "detail": "Sydef connects people with self-defence classes and instructors, with simple booking and a member portal.",
        "features": [
          "Browse and book self-defence classes",
          "Member portal with preferences",
          "Instructor and class listings"
        ],
        "url": "https://mysydef.com",
        "color": "#7C3AED"
      },
    ],
  };

  // How each app is shown on the website: its category, card colour and picture.
  // Kept here (not only in config) so a config saved from the admin page still gets them.
  const PRESENT = {
    myyanga: { kind: "Fashion", tone: "#d6246e", image: "./assets/app-myyanga.jpg" },
    myafriart: { kind: "Art", tone: "#0b6142", image: "./assets/app-myafriart.jpg" },
    rubba: { kind: "Life planning", tone: "#f5a800", image: "./assets/app-rubba.jpg" },
    adspot: { kind: "Media and rewards", tone: "#00777a", image: "./assets/app-adspot.jpg" },
    owanbex: { kind: "Celebrations", tone: "#5b21b6", image: "./assets/app-owanbex.jpg" },
    confirmahead: { kind: "Bookings", tone: "#1d4ed8", image: "./assets/app-confirmahead.jpg" },
    sydef: { kind: "Self-defence", tone: "#b91c1c", image: "./assets/app-sydef.jpg" },
  };

  function luminance(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return 0;
    const n = parseInt(m[1], 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  /** Colours, category and picture for one app card. Text colour is picked for contrast against the card. */
  function present(app) {
    const p = PRESENT[app && app.id] || {};
    const tone = /^#[0-9a-f]{6}$/i.test(p.tone || "") ? p.tone : /^#[0-9a-f]{6}$/i.test((app && app.color) || "") ? app.color : "#1d1d1f";
    const L = luminance(tone);
    const lightCard = 1.05 / (L + 0.05) < 4.5; // white text would be too faint
    const custom = app && app.thumbnail && !/\/assets\/thumb-[a-z]+\.jpg$/.test(app.thumbnail) ? app.thumbnail : "";
    return {
      kind: p.kind || "App",
      tone,
      on: lightCard ? "#1d1d1f" : "#ffffff",
      btn: lightCard ? "#1d1d1f" : "#ffffff",
      btnOn: lightCard ? "#ffffff" : "#1d1d1f",
      image: custom || p.image || (app && app.thumbnail) || "",
    };
  }

  function readLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function saveLocal(config) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    return config;
  }

  function clearLocal() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function getIngestUrl(config) {
    if (typeof global.ZONICME_INGEST_URL === "string" && global.ZONICME_INGEST_URL) {
      return global.ZONICME_INGEST_URL;
    }
    try {
      const stored = localStorage.getItem(INGEST_KEY);
      if (stored) return stored;
    } catch (_) {}
    return (
      config?.ingest?.ZONICME_INGEST_URL ||
      FALLBACK.ingest.ZONICME_INGEST_URL
    );
  }

  function setIngestUrl(url) {
    localStorage.setItem(INGEST_KEY, url);
  }

  async function loadConfig(url) {
    const local = readLocal();
    if (local && Array.isArray(local.apps) && local.apps.length) {
      return local;
    }
    try {
      const res = await fetch(url || DEFAULT_CONFIG_URL, { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        if (json && Array.isArray(json.apps)) return json;
      }
    } catch (_) {}
    return structuredClone(FALLBACK);
  }

  global.ZonicMeAppsStore = {
    STORAGE_KEY,
    INGEST_KEY,
    FALLBACK,
    present,
    loadConfig,
    readLocal,
    saveLocal,
    clearLocal,
    getIngestUrl,
    setIngestUrl,
  };
})(typeof window !== "undefined" ? window : globalThis);
