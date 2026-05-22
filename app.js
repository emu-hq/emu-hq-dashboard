const TORN_API_V1 = "https://api.torn.com";
const TORN_API_V2 = "https://api.torn.com/v2";
const EMUBS_API = ["https://", "ff", "scouter", ".com", "/api/v1"].join("");
const DEFAULT_TORN_API_KEY = "";
const EMU_WORKER_API = "https://emu-hq-api.joshiefeher.workers.dev";
const BSP_SCRIPT_VERSION = "9.4.3";
const BSP_CACHE_DAYS = 5;
const BUILD_VERSION = "2026-05-20-native-tools-9";
const POLL_INTERVAL_MS = 60000;
const TARGET_FEED_STAT_BASE = 42565126;
const PLACEHOLDER_PFP = "https://i.gyazo.com/a5da16009ce26825695c7e165fb03aab.png";
const MEMBER_STATUS_CACHE_KEY = "emu.memberStatusCache.v1";
const MEMBER_STATUS_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const MED_OUT_WINDOW_MS = 15 * 60 * 1000;
const TRAVEL_TIMES = {
  "mexico": { name: "Mexico", standard: 26, airstrip: 18 },
  "cayman islands": { name: "Cayman Islands", standard: 35, airstrip: 25 },
  "cayman": { name: "Cayman Islands", standard: 35, airstrip: 25 },
  "canada": { name: "Canada", standard: 41, airstrip: 29 },
  "hawaii": { name: "Hawaii", standard: 134, airstrip: 94 },
  "united kingdom": { name: "United Kingdom", standard: 159, airstrip: 111 },
  "uk": { name: "United Kingdom", standard: 159, airstrip: 111 },
  "argentina": { name: "Argentina", standard: 167, airstrip: 117 },
  "switzerland": { name: "Switzerland", standard: 175, airstrip: 123 },
  "japan": { name: "Japan", standard: 225, airstrip: 158 },
  "china": { name: "China", standard: 242, airstrip: 169 },
  "united arab emirates": { name: "United Arab Emirates", standard: 271, airstrip: 190 },
  "uae": { name: "United Arab Emirates", standard: 271, airstrip: 190 },
  "south africa": { name: "South Africa", standard: 297, airstrip: 208 }
};
let apiKey = localStorage.getItem("tornApiKeyOverride") || DEFAULT_TORN_API_KEY;
let loadSequence = 0;
let dataLoadInFlight = false;
let activeFactionId = null;
let activeEnemyId = null;
let activePlayerId = null;
let latestFactionMembers = [];
let latestEnemyMembers = [];
let latestTargetResults = [];
let targetResultPool = [];
let targetPageIndex = 0;
let targetBatchIndex = 0;
let targetSearchSeenIds = new Set();
let latestRecruiterResults = [];
let latestFactionChain = null;
let targetPreset = "custom";
let warSortMode = localStorage.getItem("warSortMode") || "status";
let warView = localStorage.getItem("warView") || "all";
let memberView = localStorage.getItem("memberView") || "status";
let quickStrikeView = localStorage.getItem("quickStrikeView") || "retals";
let ownBattleStats = null;
let memberStatusCache = loadMemberStatusCache();
let latestRetalTargets = [];
let latestMedOutTargets = [];
function getTornApiKey() {
  return apiKey;
}
function hasTornApiKey() {
  return Boolean(getTornApiKey());
}
function showPage(pageId, button) {
  if (!hasTornApiKey() && pageId !== "settings") {
    pageId = "settings";
    const quickLinks = document.querySelectorAll(".link-btn");
    button = quickLinks[quickLinks.length - 1] || button;
    setText("status", "Enter Torn API key to unlock terminal.");
  }
  document.querySelectorAll(".page").forEach(page => page.classList.remove("active-page"));
  document.querySelectorAll(".link-btn").forEach(tab => tab.classList.remove("active"));
  document.getElementById(pageId)?.classList.add("active-page");
  button?.classList.add("active");
}
function saveKey() {
  apiKey = document.getElementById("apiKey")?.value.trim() || "";
  if (!apiKey) {
    setText("status", "Paste a Full Access Torn API key first.");
    showPage("settings");
    syncAccessState();
    return;
  }
  localStorage.setItem("tornApiKeyOverride", apiKey);
  localStorage.removeItem("tornApiKey");
  localStorage.removeItem("bspApiKey");
  ownBattleStats = null;
  dataLoadInFlight = false;
  loadSequence++;
  setText("status", "Connecting...");
  syncAccessState();
  loadAllData();
}
function syncAccessState() {
  const locked = !hasTornApiKey();
  document.body.classList.toggle("locked", locked);
  document.querySelectorAll(".link-btn").forEach(button => {
    const target = button.getAttribute("onclick") || "";
    const isSettings = target.includes("'settings'") || target.includes('"settings"');
    if (isSettings) {
      button.classList.toggle("active", locked && document.getElementById("settings")?.classList.contains("active-page"));
      return;
    }
    button.disabled = locked;
    button.classList.toggle("locked-link", locked);
  });
}
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerText = value;
}
function setHtml(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = value;
}
function escapeHtml(value) {
  return decodeHtmlEntities(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function decodeHtmlEntities(value) {
  const text = String(value ?? "");
  const textarea = document.createElement("textarea");
  textarea.innerHTML = text;
  return textarea.value;
}
function tornUrl(version, path, params) {
  const base = version === 1 ? TORN_API_V1 : TORN_API_V2;
  const search = new URLSearchParams(params);
  return `${base}${path}?${search.toString()}`;
}
async function getData(url) {
  const response = await fetch(url, { cache: "no-store" });
  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error(`HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(formatApiError(data) || `HTTP ${response.status}`);
  }
  if (data?.error) {
    throw new Error(formatApiError(data));
  }
  return data;
}
function formatApiError(data) {
  const error = data?.error || data;
  return error?.error || error?.message || error?.reason || "API error";
}
async function loadAllData() {
  if (dataLoadInFlight) return;
  dataLoadInFlight = true;
  const sequence = ++loadSequence;
  if (!hasTornApiKey()) {
    setText("status", "Enter API key.");
    renderNoKeyState();
    showPage("settings");
    syncAccessState();
    dataLoadInFlight = false;
    return;
  }
  setText("status", "Connecting...");
  const [userResult, factionResult, warsResult, attacksResult] = await Promise.allSettled([
    loadUserData(),
    loadFactionData(),
    getData(tornUrl(2, "/faction", { selections: "rankedwars", key: getTornApiKey() })),
    loadFactionAttacksData()
  ]);
  if (sequence !== loadSequence) {
