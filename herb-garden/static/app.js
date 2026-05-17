// Herb Garden SPA. Polls /api/state once per second. Vanilla JS, no build step.

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const METRIC_DEFS = [
  { key: "moisture_pct",    label: "Soil moisture", unit: "%"   },
  { key: "temperature_c",   label: "Temperature",   unit: "°C"  },
  { key: "humidity_pct",    label: "Humidity",      unit: "%"   },
  { key: "ph",              label: "pH",            unit: ""    },
  { key: "light_lux",       label: "Light",         unit: " lx" },
  { key: "reservoir_level", label: "Reservoir",     unit: "%"   },
];

// --- Tabs ---------------------------------------------------------------
$$(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".tab").forEach((b) => b.classList.remove("active"));
    $$(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $("#tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "history" || btn.dataset.tab === "alerts") {
      renderHistory();
    }
  });
});

// --- Plant images (inline SVG so we don't ship binaries) ----------------
const PLANT_SVGS = {
  basil: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <g fill="#3a7d44">
      <path d="M50 90 C 50 60, 30 50, 28 35 C 26 22, 38 22, 50 30
               C 62 22, 74 22, 72 35 C 70 50, 50 60, 50 90 Z"/>
      <ellipse cx="35" cy="40" rx="9" ry="6" transform="rotate(-25 35 40)"
               fill="#4a8f5a"/>
      <ellipse cx="65" cy="40" rx="9" ry="6" transform="rotate(25 65 40)"
               fill="#4a8f5a"/>
      <ellipse cx="50" cy="55" rx="10" ry="7" fill="#2b5e34"/>
    </g>
    <rect x="38" y="86" width="24" height="10" rx="2" fill="#8a5a3b"/>
  </svg>`,
};

// --- Format helpers -----------------------------------------------------
function fmtVal(key, v) {
  if (v == null) return null;
  if (key === "light_lux") return Math.round(v).toLocaleString();
  if (key === "ph") return v.toFixed(2);
  return Number(v).toFixed(1);
}

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString();
}

function fmtAgo(iso) {
  if (!iso) return "Never";
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

// --- Gauge --------------------------------------------------------------
function setGauge(score) {
  // Path total length: half-circle radius 80 -> ~251 px
  const path = $("#gauge-fill");
  if (!path.getAttribute("d")) {
    path.setAttribute("d", "M20,110 A80,80 0 0,1 180,110");
  }
  const len = path.getTotalLength();
  const pct = Math.max(1, Math.min(100, score)) / 100;
  path.style.strokeDasharray = `${len}`;
  path.style.strokeDashoffset = `${len * (1 - pct)}`;

  let color = "#4a8f5a";          // good
  if (score < 70) color = "#c8a23a"; // warn
  if (score < 40) color = "#b5413a"; // bad
  path.style.stroke = color;
  $("#gauge-value").textContent = score;
}

// --- Live cards ---------------------------------------------------------
function bucket(plant, key, value) {
  if (value == null) return "missing";
  const cfg = plant.ranges[key];
  if (!cfg) return "good";
  if (value >= cfg.ideal[0] && value <= cfg.ideal[1]) return "good";
  if (value >= cfg.ok[0] && value <= cfg.ok[1]) return "warn";
  return "bad";
}

function renderLive(state) {
  const container = $("#live-cards");
  const plant = state.plant;
  const reading = state.reading || {};
  const ts = reading.timestamp;
  container.innerHTML = METRIC_DEFS.map((def) => {
    const v = reading[def.key];
    const formatted = fmtVal(def.key, v);
    let cls = "metric";
    if (def.key !== "reservoir_level") {
      const b = bucket(plant, def.key, v);
      if (b !== "missing") cls += " " + b;
    } else if (v != null) {
      cls += v < state.settings.low_reservoir_pct ? " bad" : " good";
    }
    const valueHtml = formatted == null
      ? `<div class="value missing">— no data —</div>`
      : `<div class="value">${formatted}${def.unit}</div>`;
    return `<div class="${cls}">
      <div class="label">${def.label}</div>
      ${valueHtml}
      <div class="ts">${ts ? fmtTime(ts) : ""}</div>
    </div>`;
  }).join("");
  $("#live-ts").textContent = ts
    ? `Last sensor update: ${fmtTime(ts)} (${fmtAgo(ts)})`
    : "";
}

// --- Profile ------------------------------------------------------------
function renderProfile(state) {
  const p = state.plant;
  $("#prof-name").textContent = p.common_name;
  $("#prof-sci").textContent = p.scientific_name;
  $("#prof-notes").textContent = p.notes;
  const rows = Object.entries(p.ranges).map(([key, r]) => {
    const w = p.weights[key];
    const label = METRIC_DEFS.find((d) => d.key === key)?.label || key;
    return `<tr>
      <td>${label}</td>
      <td>${r.ideal[0]} – ${r.ideal[1]}</td>
      <td>${r.ok[0]} – ${r.ok[1]}</td>
      <td>${w != null ? (w * 100).toFixed(0) + "%" : ""}</td>
    </tr>`;
  }).join("") + `<tr>
      <td>Reservoir</td><td>≥ 30%</td><td>≥ 0%</td>
      <td>${(p.weights.reservoir * 100).toFixed(0)}%</td>
    </tr>`;
  $("#ranges-body").innerHTML = rows;
}

// --- Home ---------------------------------------------------------------
function renderHome(state) {
  const p = state.plant;
  $("#plant-name").textContent = p.common_name;
  $("#plant-sci").textContent = p.scientific_name;
  $("#plant-image").innerHTML = PLANT_SVGS[p.image] || PLANT_SVGS.basil;
  const lw = state.last_watered;
  $("#last-watered").textContent = lw
    ? `Last watered: ${fmtTime(lw.timestamp)} (${fmtAgo(lw.timestamp)})`
    : "Last watered: never";

  setGauge(state.health.score);
  $("#gauge-explanation").textContent = state.health.explanation;

  const res = state.reading?.reservoir_level;
  const low = state.settings.low_reservoir_pct;
  $("#reservoir-warning").hidden = !(res != null && res < low);
}

// --- Connection badge ---------------------------------------------------
function renderConn(state) {
  const c = state.connection;
  const badge = $("#conn-badge");
  if (c.connected && !c.stale) {
    badge.className = "badge connected";
    badge.textContent = `Connected · ${c.source_label}`;
  } else if (c.stale) {
    badge.className = "badge disconnected";
    badge.textContent = "Stale data";
  } else {
    badge.className = "badge disconnected";
    badge.textContent = "Disconnected";
  }
  $("#demo-badge").hidden = !c.is_demo;
}

// --- History ------------------------------------------------------------
async function renderHistory() {
  const water = await fetch("/api/events?kind=watering&limit=20").then((r) => r.json());
  const alerts = await fetch("/api/events?kind=alert&limit=20").then((r) => r.json());
  const all = await fetch("/api/events?limit=50").then((r) => r.json());
  $("#hist-water").innerHTML = water.length
    ? water.map(eventLi).join("")
    : `<li class="empty">No watering events yet</li>`;
  $("#hist-alerts").innerHTML = alerts.length
    ? alerts.map(eventLi).join("")
    : `<li class="empty">No alerts</li>`;
  $("#all-alerts").innerHTML = all.length
    ? all.map(eventLi).join("")
    : `<li class="empty">No events yet</li>`;
}
function eventLi(ev) {
  return `<li>
    <span><span class="kind ${ev.kind}">${ev.kind}</span>${ev.message}</span>
    <span class="ts">${fmtTime(ev.timestamp)}</span>
  </li>`;
}

// --- Settings form ------------------------------------------------------
async function loadSettings() {
  const [settings, plants] = await Promise.all([
    fetch("/api/settings").then((r) => r.json()),
    fetch("/api/plants").then((r) => r.json()),
  ]);
  const sel = $("#plant-select");
  sel.innerHTML = plants.map((p) =>
    `<option value="${p.id}">${p.common_name}</option>`
  ).join("");
  const form = $("#settings-form");
  for (const [k, v] of Object.entries(settings)) {
    const el = form.elements[k];
    if (!el) continue;
    if (el.type === "checkbox") el.checked = !!v;
    else el.value = v;
  }
}

$("#settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const patch = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") patch[el.name] = el.checked;
    else if (el.type === "number") patch[el.name] = Number(el.value);
    else patch[el.name] = el.value;
  }
  await fetch("/api/settings", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  $("#save-status").textContent = "Saved.";
  setTimeout(() => $("#save-status").textContent = "", 2000);
});

$("#manual-water").addEventListener("click", async () => {
  await fetch("/api/water", { method: "POST" });
});

// --- Poll loop ----------------------------------------------------------
async function tick() {
  try {
    const state = await fetch("/api/state").then((r) => r.json());
    renderConn(state);
    renderHome(state);
    renderLive(state);
    renderProfile(state);
  } catch (e) {
    $("#conn-badge").className = "badge disconnected";
    $("#conn-badge").textContent = "Server unreachable";
  }
}

loadSettings();
tick();
setInterval(tick, 1000);
