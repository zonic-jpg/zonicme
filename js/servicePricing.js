/** ZonicMe orbit — per-service Free | Freemium | Paid (localStorage draft + activate). */
const ACTIVE_KEY = "zonicme_service_pricing_v1";
const DRAFT_KEY = "zonicme_service_pricing_draft_v1";

export const ZONICME_SERVICES = [
  { id: "hub_access", label: "Hub access", mode: "free", priceNgn: 0, guestAllowance: 0 },
  { id: "analytics", label: "Cross-app analytics", mode: "free", priceNgn: 0, guestAllowance: 0 },
  { id: "sso_premium", label: "Premium SSO seats", mode: "free", priceNgn: 10000, guestAllowance: 0 },
  { id: "orbit_admin", label: "Orbit admin console", mode: "free", priceNgn: 0, guestAllowance: 0 },
];

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}") || {};
  } catch {
    return {};
  }
}

function write(key, all) {
  localStorage.setItem(key, JSON.stringify(all));
}

function defaults() {
  return Object.fromEntries(ZONICME_SERVICES.map((s) => [s.id, { ...s, active: true }]));
}

export function listActiveServicePricing() {
  const base = defaults();
  const active = { ...base, ...read(ACTIVE_KEY) };
  return ZONICME_SERVICES.map((s) => ({ ...base[s.id], ...active[s.id], active: active[s.id]?.active !== false }));
}

export function getServiceDraft(id) {
  const active = listActiveServicePricing().find((s) => s.id === id);
  const draft = read(DRAFT_KEY)[id];
  return { ...(active || defaults()[id]), ...draft, id };
}

export function saveServiceDraft(id, patch) {
  const draft = read(DRAFT_KEY);
  const prev = getServiceDraft(id);
  draft[id] = { ...prev, ...patch, id, active: false };
  write(DRAFT_KEY, draft);
  return draft[id];
}

export function activateServicePricing(id) {
  const draft = read(DRAFT_KEY);
  const row = { ...getServiceDraft(id), ...(draft[id] || {}), active: true };
  const active = { ...defaults(), ...read(ACTIVE_KEY), [id]: row };
  write(ACTIVE_KEY, active);
  delete draft[id];
  write(DRAFT_KEY, draft);
  return row;
}

export function isServicePricingVisible(row) {
  return row.mode !== "free";
}

export function renderServicePricingPanel(container) {
  if (!container) return;
  const live = listActiveServicePricing();
  container.innerHTML = ZONICME_SERVICES.map((cat) => {
    const draft = getServiceDraft(cat.id);
    const showPrice = isServicePricingVisible(draft) && draft.mode === "paid";
    const showAllow = draft.mode === "freemium";
    return `
      <div class="panel" data-svc="${cat.id}">
        <div class="app-head"><h2>${cat.label}</h2>
          <span class="badge">${draft.active === false ? "DRAFT" : (draft.mode || "free").toUpperCase()}</span></div>
        <label>Mode</label>
        <select data-field="mode">
          <option value="free" ${draft.mode === "free" ? "selected" : ""}>Free</option>
          <option value="freemium" ${draft.mode === "freemium" ? "selected" : ""}>Freemium</option>
          <option value="paid" ${draft.mode === "paid" ? "selected" : ""}>Paid</option>
        </select>
        ${showAllow ? `<label>Guest allowance</label><input type="number" min="0" data-field="guestAllowance" value="${draft.guestAllowance || 0}" />` : ""}
        ${showPrice ? `<label>Price (₦)</label><input type="number" min="0" data-field="priceNgn" value="${draft.priceNgn || 0}" />` : ""}
        <div class="actions">
          <button type="button" class="secondary" data-action="save">Save</button>
          <button type="button" data-action="activate">Activate</button>
        </div>
        <p class="hint">Live: ${(live.find((s) => s.id === cat.id)?.mode || "free").toUpperCase()}</p>
      </div>`;
  }).join("");

  container.querySelectorAll("[data-svc]").forEach((panel) => {
    const id = panel.getAttribute("data-svc");
    panel.querySelector('[data-action="save"]')?.addEventListener("click", () => {
      const patch = readPanelPatch(panel);
      saveServiceDraft(id, patch);
      renderServicePricingPanel(container);
      window.__zToast?.("Draft saved");
    });
    panel.querySelector('[data-action="activate"]')?.addEventListener("click", () => {
      const patch = readPanelPatch(panel);
      saveServiceDraft(id, patch);
      activateServicePricing(id);
      renderServicePricingPanel(container);
      window.__zToast?.("Activated");
    });
    panel.querySelector('[data-field="mode"]')?.addEventListener("change", () => {
      saveServiceDraft(id, readPanelPatch(panel));
      renderServicePricingPanel(container);
    });
  });
}

function readPanelPatch(panel) {
  const mode = panel.querySelector('[data-field="mode"]')?.value || "free";
  const guestAllowance = +(panel.querySelector('[data-field="guestAllowance"]')?.value || 0);
  const priceNgn = +(panel.querySelector('[data-field="priceNgn"]')?.value || 0);
  return { mode, guestAllowance, priceNgn };
}
