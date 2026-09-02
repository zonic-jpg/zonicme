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
      "ZonicMe empowers Africans through the creative economy — building apps that turn fashion, art, media and everyday planning into real opportunity across the continent and diaspora.",
    ingest: {
      ZONICME_INGEST_URL:
        "https://YOUR-SUPABASE-PROJECT.supabase.co/functions/v1/zonic-hub-ingest",
    },
    apps: [
      {
        id: "myyanga",
        name: "MyYangaX",
        summary:
          "African fashion discovery, styling and Runway.\nCreators and shoppers meet in one place.",
        detail:
          "MyYangaX is ZonicMe’s fashion platform — browse looks, style them your way, and follow Runway drops from African designers and the diaspora. Discovery meets commerce so creators earn and audiences find style that feels like home.",
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
        summary:
          "African art marketplace — discover, stage, collect.\nGalleries and collectors in one place.",
        detail:
          "MyAfriArt connects artists, galleries, and collectors across Africa and the diaspora. Discover original work, stage digital exhibitions, and collect with confidence — a marketplace built for the continent’s creative voice.",
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
        summary:
          "Life-planning for goals, savings, milestones.\nTurn ambition into a clear next step.",
        detail:
          "Rubba helps people plan life with clarity — goals, savings targets, and milestones in one calm workspace. Built for everyday Africans who want structure without complexity, and progress they can see.",
        features: [
          "Goal categories with milestones you can track week by week",
          "Savings targets with progress bars and check-in reminders",
          "City-aware cost planning for African metros and diaspora moves",
          "Genie-assisted plans — turn a wish into a concrete next step",
          "Personal insights dashboard without overwhelming finance jargon",
          "A progress view of plans created, assists used and milestones hit",
        ],
        url: "https://rubba.netlify.app",
        thumbnail: "./assets/thumb-rubba.jpg",
        orbit: "./orbit/rubba.json",
        orbitLive: "https://rubba.netlify.app/orbit-manifest.json",
        color: "#C99A2E",
      },
      {
        id: "adspot",
        name: "AdSpot",
        summary:
          "Media & partner ads with rewarded attention.\nBrands reach real people, audiences earn.",
        detail:
          "AdSpot is the orbit’s media and partner network. Rewarded attention means brands reach consented audiences while users earn value — transparent, fair, and tuned for African markets and diaspora reach.",
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
        summary:
          "Plan Nigerian celebrations end-to-end.\nVendors, budgets, aso ebi, guest lists.",
        detail:
          "Owanbe helps families and brands plan weddings, birthdays, and milestone events across Nigeria — vetted vendors, live Naira budgets, aso ebi coordination, and brand analytics in one planner.",
        features: [
          "End-to-end event builder for weddings, birthdays and milestones",
          "Vetted vendor directory with shortlists and comparison notes",
          "Live Naira budgets that stay visible as plans change",
          "Aso ebi coordination for fabrics, colours and group orders",
          "Guest lists, RSVPs and day-of planning checklists",
          "Brand / sponsorship analytics for celebration partners",
        ],
        url: "https://owanbex.netlify.app",
        thumbnail: "./assets/thumb-owanbe.jpg",
        orbit: "./orbit/owanbex.json",
        orbitLive: "https://owanbex.netlify.app/orbit-manifest.json",
        color: "#9B2335",
      },
    ],
  };

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
    loadConfig,
    readLocal,
    saveLocal,
    clearLocal,
    getIngestUrl,
    setIngestUrl,
  };
})(typeof window !== "undefined" ? window : globalThis);
