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
const TARGET_BATCH_ATTEMPT_LIMIT = 30;
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
    dataLoadInFlight = false;
    return;
  }

  const warnings = [];
  let factionState = null;
  let connected = false;

  if (userResult.status === "fulfilled") {
    loadUser(userResult.value, null);
    loadOwnBattleStats();
    connected = true;
  } else {
    warnings.push(`user: ${userResult.reason.message}`);
  }

  if (factionResult.status === "fulfilled") {
    factionState = loadFaction(factionResult.value);
    connected = true;

    if (factionState?.factionId) {
      try {
        const memberData = await loadTrackedFactionMembers(factionState.factionId);
        const endpointMembers = normalizeMembers(memberData.members || memberData);

        if (endpointMembers.length) {
          factionState.members = endpointMembers;
          renderFactionMembers(endpointMembers);
        }
      } catch (err) {
        warnings.push(`members: ${err.message}`);
      }
    }
  } else {
    warnings.push(`faction: ${factionResult.reason.message}`);
  setHtml("onlineMembers", emptyMessage("Faction members unavailable."));
  setHtml("onlineMembersSide", emptyMessage("Faction members unavailable."));
  setHtml("inactiveMembers", emptyMessage("Faction members unavailable."));
  setHtml("hospitalMembers", emptyMessage("Faction hospital unavailable."));
  }

  if (warsResult.status === "fulfilled") {
    handleWars(warsResult.value, factionState?.factionId);
  } else {
    warnings.push(`wars: ${warsResult.reason.message}`);
    setText("warStatus", "War data unavailable");
    setText("warTimer", "Unavailable");
    setHtml("warOverview", emptyMessage("Ranked war data unavailable for this key."));
  }

  if (attacksResult.status === "fulfilled") {
    renderAttacks(attacksResult.value, factionState?.factionId);
  } else {
    warnings.push(`attacks: ${attacksResult.reason.message}`);
    setHtml("recentAttacks", emptyMessage("Faction attack data unavailable for this key."));
    latestRetalTargets = [];
    renderQuickStrikeTargets();
  }

  setText(
    "status",
    connected
      ? warnings.length ? `Connected with limits: ${warnings.join(" | ")}` : "Connected successfully."
      : formatConnectionFailure(warnings)
  );

  syncAccessState();

  if (connected && document.getElementById("settings")?.classList.contains("active-page")) {
    const dashboardButton = document.querySelector(".link-btn");
    showPage("dashboard", dashboardButton);
  }

  if (connected) {
    loadDashboardExtras(sequence);
  }

  dataLoadInFlight = false;
}

async function loadUserData() {
  try {
    return await getData(tornUrl(2, "/user", { selections: "profile,bars", key: getTornApiKey() }));
  } catch (err) {
    if (isRateLimitError(err)) throw err;
    return getData(tornUrl(1, "/user/", { selections: "profile,bars", key: getTornApiKey() }));
  }
}

async function loadUserHonorsData() {
  try {
    return await getData(tornUrl(2, "/user/honors", { key: getTornApiKey() }));
  } catch (err) {
    try {
      return await getData(tornUrl(2, "/user", { selections: "honors", key: getTornApiKey() }));
    } catch (fallbackErr) {
      return getData(tornUrl(1, "/user/", { selections: "honors", key: getTornApiKey() }));
    }
  }
}

function loadUserJobPointsData() {
  return getData(tornUrl(2, "/user/jobpoints", { key: getTornApiKey() }));
}

async function loadOwnUsageInsights() {
  const now = Math.floor(Date.now() / 1000);
  const monthAgo = now - 30 * 86400;
  const yearAgo = now - 365 * 86400;
  const [current, month, year] = await Promise.all([
    getOwnHistoricStats(),
    getOwnHistoricStats(monthAgo),
    getOwnHistoricStats(yearAgo)
  ]);

  return {
    monthXanax: statDelta(current, month, "xantaken"),
    yearXanax: statDelta(current, year, "xantaken"),
    monthRefills: statDelta(current, month, "refills"),
    yearRefills: statDelta(current, year, "refills")
  };
}

function getOwnHistoricStats(timestamp) {
  return getData(tornUrl(2, "/user/personalstats", {
    stat: "xantaken,refills",
    ...(timestamp ? { timestamp } : {}),
    key: getTornApiKey()
  })).then(normalizeHistoricStats);
}

async function loadOwnBattleStats() {
  if (!hasTornApiKey() || ownBattleStats) return ownBattleStats;

  try {
    const data = await getData(tornUrl(1, "/user/", { selections: "battlestats", key: getTornApiKey() }));
    const stats = {
      strength: Number(data.strength || 0),
      defense: Number(data.defense || data.defence || 0),
      speed: Number(data.speed || 0),
      dexterity: Number(data.dexterity || 0)
    };
    stats.total = stats.strength + stats.defense + stats.speed + stats.dexterity;
    stats.score = Math.floor(Math.sqrt(stats.strength) + Math.sqrt(stats.defense) + Math.sqrt(stats.speed) + Math.sqrt(stats.dexterity));
    ownBattleStats = stats.total ? stats : null;
  } catch (err) {
    ownBattleStats = null;
  }

  return ownBattleStats;
}

async function loadFactionData() {
  try {
    return await getData(tornUrl(2, "/faction", { selections: "basic,members,chain", key: getTornApiKey() }));
  } catch (err) {
    if (isRateLimitError(err)) throw err;
    return getData(tornUrl(2, "/faction/basic", { key: getTornApiKey() }));
  }
}

async function loadDashboardExtras(sequence) {
  const [honorsResult, jobPointsResult, usageResult] = await Promise.allSettled([
    loadUserHonorsData(),
    loadUserJobPointsData(),
    loadOwnUsageInsights()
  ]);

  if (sequence !== loadSequence) return;

  if (honorsResult.status === "fulfilled") {
    loadUserHonors(honorsResult.value);
  }

  if (jobPointsResult.status === "fulfilled") {
    renderJobPoints(jobPointsResult.value);
  } else {
    setHtml("jobPointsPanel", emptyMessage("Job points unavailable for this key."));
  }

  if (usageResult.status === "fulfilled") {
    renderDashboardUsage(usageResult.value);
  } else {
    setHtml("dashboardUsagePanel", emptyMessage("Xanax and refill averages unavailable for this key."));
  }
}

function loadUserHonors(data) {
  const honors = extractHonorCount(data);
  if (honors !== null) setText("honorValue", formatNumber(honors));
}

function isRateLimitError(err) {
  return /too many requests/i.test(String(err?.message || err || ""));
}

function formatConnectionFailure(warnings) {
  if (warnings.some(isRateLimitError)) {
    return "Torn rate limit reached. Wait about a minute, then connect again.";
  }

  return `Connection failed: ${warnings.join(" | ")}`;
}

function loadFactionAttacksData() {
  return getData(tornUrl(2, "/faction/attacks", {
    limit: "20",
    sort: "DESC",
    key: getTornApiKey()
  }));
}

function renderNoKeyState() {
  setText("factionName", "Enter API key");
  setText("factionRank", "-");
  setText("factionRespect", "-");
  setText("factionMembers", "-");
  setText("warStatus", "Enter API key");
  setText("warTimer", "No active war");
  setText("warLastChecked", "-");
  setText("chainValue", "-");
  setText("chainAlert", "Enter API key");
  setHtml("onlineMembers", emptyMessage("Enter API key in Settings."));
  setHtml("onlineMembersSide", emptyMessage("Enter API key in Settings."));
  setHtml("inactiveMembers", emptyMessage("Enter API key in Settings."));
  setHtml("hospitalMembers", emptyMessage("Enter API key in Settings."));
  setHtml("factionFlights", emptyMessage("Enter API key in Settings."));
  setHtml("hospitalTable", emptyTableRow("Enter API key in Settings.", 6));
  setHtml("warOverview", emptyMessage("Enter API key in Settings."));
  setHtml("enemyHospitalList", emptyMessage("Enter API key in Settings."));
  setHtml("warTargetsTable", emptyTableRow("Enter API key in Settings.", 6));
  setHtml("recentAttacks", emptyMessage("Enter API key in Settings."));
  setHtml("quickStrikeTargets", emptyMessage("Enter API key in Settings."));
  setHtml("chainPanel", emptyMessage("Enter API key in Settings."));
  setHtml("targetResults", emptyTableRow("Enter API key in Settings.", 6));
  setHtml("recruiterResults", emptyTableRow("Enter API key in Settings.", 6));
  setHtml("playerDashboardCard", "");
  setHtml("playerViewSummary", "");
  setHtml("playerRelationPanel", emptyMessage("Enter API key in Settings."));
  setHtml("playerHistoryTable", emptyTableRow("Enter API key in Settings.", 4));
  setHtml("playerFlightsTable", emptyTableRow("Enter API key in Settings.", 5));
  setHtml("factionScoutSummary", "");
  setHtml("factionActivitySummary", "");
  setHtml("factionScoutMembers", emptyTableRow("Enter API key in Settings.", 7));
  setHtml("activeWarsTable", emptyTableRow("Enter API key in Settings.", 6));
  setHtml("activeTerritoryTable", emptyTableRow("Enter API key in Settings.", 5));
  setHtml("liveChainsTable", emptyTableRow("Enter API key in Settings.", 5));
  setHtml("jobPointsPanel", emptyMessage("Enter API key in Settings."));
  setHtml("dashboardUsagePanel", emptyMessage("Enter API key in Settings."));
}

function loadUser(user, honorsData) {
  const profile = user.profile || user.basic || user;
  const legacyProfile = user.legacyProfile?.profile || user.legacyProfile || {};
  const bars = user.bars || profile.bars || {};
  activePlayerId = profile.player_id ?? profile.id ?? user.player_id ?? user.id ?? activePlayerId;

  setText("playerName", profile.name ?? "Unknown");
  setText("playerId", `[${activePlayerId ?? "?"}]`);
  setText("playerRank", profile.rank ?? user.rank ?? "-");
  setText("playerLevel", profile.level ?? user.level ?? "-");

  const age = Number(profile.age || user.age || 0);
  setText("playerAge", age ? `${Math.floor(age / 365)} years` : "-");
  setText("playerAgeDays", age ? `${formatNumber(age)} days` : "- days");

  const level = Number(profile.level || user.level || 0);
  const lvlDay = age && level
    ? (level / age).toFixed(3)
    : "-";

  setText("levelDay", lvlDay);
  setText("frenemiesValue", `+${profile.friends ?? user.friends ?? 0} / ${profile.enemies ?? user.enemies ?? 0}`);
  setText("honorValue", formatNumber(legacyProfile.honor_id ?? legacyProfile.honor ?? profile.honor_id ?? user.honor_id ?? profile.honor ?? user.honor ?? extractHonorCount(honorsData) ?? profile.honors ?? user.honors ?? "-"));
  setText("awardsValue", profile.awards ?? user.awards ?? "-");
  setText("karmaValue", profile.karma ?? user.karma ?? "-");
  setText("forumValue", profile.forum_posts ?? user.forum_posts ?? "-");
  setText("spouseValue", formatProfileSpouse(profile.spouse || user.spouse));
  setText("propertyValue", profile.property?.name || user.property?.name || profile.property || user.property || "-");

  const energy = bars.energy || user.energy || profile.energy;
  const nerve = bars.nerve || user.nerve || profile.nerve;

  setText("energyValue", formatBar(energy));
  setText("nerveValue", formatBar(nerve));

  const pfp = document.getElementById("playerPfp");
  if (pfp) {
    pfp.src = profile.image || profile.profile_image || user.profile_image || user.image || PLACEHOLDER_PFP;
    pfp.onerror = function () {
      pfp.src = PLACEHOLDER_PFP;
    };
  }
}

function extractHonorCount(data) {
  if (!data) return null;

  const direct = data.honors_count ?? data.honor_count ?? data.total_honors ?? data.total;
  if (Number.isFinite(Number(direct))) return Number(direct);

  const honors = data.honors ?? data.honor;
  if (Number.isFinite(Number(honors))) return Number(honors);
  if (Array.isArray(honors)) return honors.length;

  if (honors && typeof honors === "object") {
    const values = Object.values(honors);
    const achieved = values.filter(item => {
      if (!item || typeof item !== "object") return true;
      if ("achieved" in item) return Boolean(item.achieved);
      if ("unlocked" in item) return Boolean(item.unlocked);
      if ("awarded" in item) return Boolean(item.awarded);
      if ("timestamp" in item) return Boolean(item.timestamp);
      return true;
    });
    return achieved.length;
  }

  return null;
}

function formatBar(bar) {
  if (!bar || typeof bar !== "object") return "-";

  const current = bar.current ?? bar.value ?? 0;
  const maximum = bar.maximum ?? bar.max ?? 0;

  if (maximum) return `${current}/${maximum}`;
  return String(current || "-");
}

function loadFaction(data) {
  const faction = data.basic || data.faction || data;
  const members = normalizeMembers(data.members || data.faction?.members || {});
  const chain = data.chain || data.faction?.chain || {};
  const factionId = faction.id || faction.ID || data.ID || data.faction_id || activeFactionId;

  activeFactionId = factionId || activeFactionId;
  latestFactionChain = chain && typeof chain === "object" ? chain : null;

  setText("factionName", faction.name ?? "-");
  setText("playerFactionValue", formatFactionDashboardLabel(faction));
  setText("factionRank", formatFactionRank(faction));
  setText("factionRespect", formatNumber(faction.respect));
  setText("factionMembers", `${members.length || faction.members || "-"}`);

  const chainCurrent = chain.current ?? chain.chain ?? 0;
  setText("chainValue", formatNumber(chainCurrent));
  setText("chainAlert", chainCurrent ? `${formatNumber(chainCurrent)} active` : "No active chain");
  renderChainPanel(chain);

  renderFactionMembers(members);

  return { faction, factionId: activeFactionId, members, chain };
}

function loadFactionMembers(factionId) {
  return getData(tornUrl(2, `/faction/${encodeURIComponent(factionId)}/members`, { key: getTornApiKey() }));
}

function renderFactionMembers(members) {
  syncMemberStatusTracking(members);
  latestFactionMembers = members;
  setText("factionMembers", `${members.length || "-"}`);
  renderOnlineMembers(members);
  renderInactiveMembers(members);
  renderOwnHospital(members);
  renderFactionFlights(members);
}

function formatFactionDashboardLabel(faction) {
  const name = faction?.name || "-";
  const tag = faction?.tag ? ` [${faction.tag}]` : "";
  return `${name}${tag}`;
}

function formatProfileSpouse(spouse) {
  if (!spouse || typeof spouse !== "object") return "-";
  const days = Number(spouse.days_married || 0);
  const age = days ? ` - ${formatNumber(days)} days` : spouse.status ? ` - ${spouse.status}` : "";
  return `${spouse.name || "Unknown"}${age}`;
}

function renderJobPoints(data) {
  const jobpoints = data.jobpoints || {};
  const jobs = Object.entries(jobpoints.jobs || {});
  const companies = (jobpoints.companies || []).map(entry => [
    entry.company?.name || entry.company_name || entry.name || "Company",
    entry.points ?? entry.jobpoints ?? entry.value ?? 0
  ]);

  setHtml("jobPointsPanel", `
    <div class="jobpoints-grid">
      ${jobPointsTable("PRIVATE COMPANIES", companies)}
      ${jobPointsTable("TORN CITY JOBS", jobs.map(([name, points]) => [titleCase(name), points]))}
    </div>
  `);
}

function jobPointsTable(title, rows) {
  return `
    <div class="data-table-wrap">
      <table class="data-table compact-table">
        <thead><tr><th>${escapeHtml(title)}</th><th>Points</th></tr></thead>
        <tbody>${rows.length ? rows.map(([name, points]) => `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(formatNumber(points))}</td></tr>`).join("") : `<tr><td colspan="2" class="muted">None returned.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function renderDashboardUsage(usage) {
  renderToolCards("dashboardUsagePanel", [
    ["XANAX 30D", formatUsageRate(usage.monthXanax, 30)],
    ["XANAX 1Y", formatUsageRate(usage.yearXanax, 365)],
    ["REFILLS 30D", formatUsageRate(usage.monthRefills, 30)],
    ["REFILLS 1Y", formatUsageRate(usage.yearRefills, 365)]
  ]);
}

function formatRankPosition(faction) {
  const rank = faction.rank || faction.ranked_wars || {};
  const position = rank.position ?? rank.rank ?? faction.position ?? faction.rank_position;
  return position ? `#${formatNumber(position)}` : "-";
}

function formatFactionRank(faction) {
  const rank = faction.rank || {};

  if (typeof rank === "string") {
    return titleCase(rank);
  }

  const name = rank.name ?? rank.title ?? faction.rank_name ?? "";
  const division = rank.division ?? rank.tier ?? faction.division ?? faction.rank_division;
  const visibleDivision = Number(division) > 0 ? division : "";

  if (!name && division === undefined) return "-";

  return [titleCase(name), visibleDivision].filter(value => value !== undefined && value !== null && value !== "").join(" ");
}

function titleCase(value) {
  return String(value ?? "")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function normalizeMembers(rawMembers) {
  if (Array.isArray(rawMembers)) {
    return rawMembers.map((member, index) => normalizeMember(member, member?.id || member?.player_id || index));
  }

  if (!rawMembers || typeof rawMembers !== "object") return [];

  return Object.entries(rawMembers)
    .filter(([, member]) => member && typeof member === "object")
    .map(([id, member]) => normalizeMember(member, id));
}

function normalizeMember(member, fallbackId) {
  return {
    ...member,
    id: member.id || member.player_id || member.ID || fallbackId,
    name: member.name || member.player_name || `Player ${fallbackId}`
  };
}

function loadMemberStatusCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MEMBER_STATUS_CACHE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    return {};
  }
}

function saveMemberStatusCache() {
  try {
    localStorage.setItem(MEMBER_STATUS_CACHE_KEY, JSON.stringify(memberStatusCache));
  } catch (err) {
    console.warn("Member status cache write failed", err);
  }
}

function syncMemberStatusTracking(members) {
  const now = Date.now();
  let changed = false;

  for (const member of members) {
    const id = getPlayerId(member);
    if (!/^\d+$/.test(String(id))) continue;

    const status = getMemberStatus(member);
    const signature = `${status.state}|${status.description}|${status.details}`;
    const previous = memberStatusCache[id];
    const sameStatus = previous?.signature === signature;
    const travelling = isTravelling(member);
    const hospital = isHospital(member);
    const leftHospital = previous && isTrackedHospitalSignature(previous.signature) && !hospital;

    memberStatusCache[id] = {
      signature,
      since: sameStatus ? previous.since : now,
      travelSince: travelling ? (sameStatus ? previous.travelSince || now : now) : null,
      hospitalExitAt: hospital ? null : leftHospital ? now : previous?.hospitalExitAt || null,
      lastSeen: now
    };
    changed = true;
  }

  for (const [id, cached] of Object.entries(memberStatusCache)) {
    if (!cached?.lastSeen || now - cached.lastSeen > MEMBER_STATUS_CACHE_MAX_AGE_MS) {
      delete memberStatusCache[id];
      changed = true;
    }
  }

  if (changed) saveMemberStatusCache();
}

function isTrackedHospitalSignature(signature) {
  return String(signature || "").toLowerCase().includes("hospital");
}

function getMemberStatusTracking(member) {
  const id = getPlayerId(member);
  return id ? memberStatusCache[id] : null;
}

function getMemberStatus(member) {
  const status = member.status && typeof member.status === "object" ? member.status : {};
  const description =
    status.description ||
    status.details ||
    member.status_description ||
    (typeof member.status === "string" ? member.status : "") ||
    "";
  const details = status.details || member.status_details || "";
  const state = status.state || status.type || member.state || "";
  const until = Number(status.until || status.until_timestamp || status.ends || member.until || 0);

  return { description, details, state, until };
}

function getLastAction(member) {
  const action = member.last_action || member.lastAction || {};
  return {
    status: action.status || member.online_status || "",
    relative: action.relative || action.time || "",
    timestamp: Number(action.timestamp || 0)
  };
}

function isOnline(member) {
  return getLastAction(member).status.toLowerCase() === "online";
}

function isHospital(member) {
  const status = getMemberStatus(member);
  const text = `${status.state} ${status.description}`.toLowerCase();
  return text.includes("hospital");
}

function isTravelling(member) {
  const status = getMemberStatus(member);
  const text = `${status.state} ${status.description}`.toLowerCase();
  return text.includes("travel") || text.includes("flying") || text.includes("abroad") || text.includes("overseas") || text.includes("returning");
}

function getTravelInfo(member) {
  const status = getMemberStatus(member);
  const text = normalizeTravelText(status.description || status.state || "");
  const route = extractTravelRoute(text);
  const tracking = getMemberStatusTracking(member);

  if (route) {
    const destination = route.to === "Torn" ? route.from : route.to;
    const times = getTravelTimes(destination);
    const travelSince = Number(member.emu_travel_since || tracking?.travelSince || tracking?.since || Date.now());
    const estimates = times
      ? {
          standard: Math.floor((travelSince + times.standard * 60 * 1000) / 1000),
          airstrip: Math.floor((travelSince + times.airstrip * 60 * 1000) / 1000)
        }
      : null;

    return {
      state: "traveling",
      from: route.from,
      to: route.to,
      destination: times?.name || destination,
      direction: route.to === "Torn" ? "returning" : route.from === "Torn" ? "outbound" : "traveling",
      estimates
    };
  }

  const abroad = extractAbroadLocation(text);
  if (abroad) {
    const times = getTravelTimes(abroad);
    return {
      state: "abroad",
      from: abroad,
      to: "Torn",
      destination: times?.name || abroad,
      direction: "abroad",
      estimates: null
    };
  }

  if (String(status.state || "").toLowerCase() === "abroad") {
    return {
      state: "abroad",
      from: "Overseas",
      to: "Torn",
      destination: "Overseas",
      direction: "abroad",
      estimates: null
    };
  }

  return null;
}

function normalizeTravelText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\.$/, "")
    .trim();
}

function extractTravelRoute(description) {
  const fromTo = /^Traveling from (.+?) to (.+)$/i.exec(description);
  if (fromTo) return { from: cleanTravelLocation(fromTo[1]), to: cleanTravelLocation(fromTo[2]) };

  const to = /^Traveling to (.+)$/i.exec(description);
  if (to) return { from: "Torn", to: cleanTravelLocation(to[1]) };

  const returning = /^(?:Returning from|Traveling back from) (.+)$/i.exec(description);
  if (returning) return { from: cleanTravelLocation(returning[1]), to: "Torn" };

  return null;
}

function extractAbroadLocation(description) {
  const abroad = /^(?:In|Overseas in|Abroad in)(?: the)? (.+)$/i.exec(description);
  return abroad ? cleanTravelLocation(abroad[1]) : null;
}

function cleanTravelLocation(value) {
  return String(value || "")
    .replace(/^the\s+/i, "")
    .replace(/\s*\(.*?\)\s*/g, "")
    .trim();
}

function getTravelTimes(location) {
  const key = cleanTravelLocation(location).toLowerCase();
  return TRAVEL_TIMES[key] || null;
}

function renderOnlineMembers(members) {
  const online = members
    .filter(isOnline)
    .sort((a, b) => a.name.localeCompare(b.name));

  const fullList = online.length
    ? online.map(member => memberRow(member, "Online", "good")).join("")
    : emptyMessage("No members online.");

  const sideList = online.length
    ? online.slice(0, 8).map(member => memberRow(member, "Online", "good")).join("")
    : emptyMessage("No members online.");

  setHtml("onlineMembers", fullList);
  setHtml("onlineMembersSide", sideList);
}

function renderInactiveMembers(members) {
  const inactive = members
    .map(member => ({ member, age: getLastActionAgeSeconds(member) }))
    .filter(entry => Number.isFinite(entry.age) && entry.age >= 86400)
    .sort((a, b) => b.age - a.age || String(a.member.name).localeCompare(String(b.member.name)));

  setHtml(
    "inactiveMembers",
    inactive.length
      ? inactive.map(({ member, age }) => inactiveMemberRow(member, age)).join("")
      : emptyMessage("No faction members inactive for 1 day or more.")
  );
}

function inactiveMemberRow(member, ageSeconds) {
  const action = getLastAction(member);
  const status = getMemberStatus(member);
  const days = Math.max(1, Math.floor(ageSeconds / 86400));
  const hours = Math.floor((ageSeconds % 86400) / 3600);
  const since = action.relative || `${formatNumber(days)} day${days === 1 ? "" : "s"} ago`;
  const detail = status.description || status.state || "No current status";

  return `
    <div class="intel-row">
      <span>
        ${memberLink(member)}
        <small>${escapeHtml(`${since} - ${detail}`)}</small>
      </span>
      <span class="badge warning">${escapeHtml(`${formatNumber(days)}d ${hours}h`)}</span>
    </div>
  `;
}

function setMemberView(mode) {
  memberView = ["status", "inactive"].includes(mode) ? mode : "status";
  localStorage.setItem("memberView", memberView);

  document.querySelectorAll("[data-member-view]").forEach(button => {
    button.classList.toggle("active-tool", button.dataset.memberView === memberView);
  });

  document.querySelectorAll("[data-member-panel]").forEach(panel => {
    panel.hidden = panel.dataset.memberPanel !== memberView;
  });
}

function renderOwnHospital(members) {
  const hospital = sortByUntil(members.filter(isHospital));

  renderHospitalTable(hospital);
  setHtml(
    "hospitalMembers",
    hospital.length
      ? hospital.map(member => hospitalRow(member)).join("")
      : emptyMessage("No faction members in hospital.")
  );
}

function renderFactionFlights(members) {
  const travelling = members
    .filter(isTravelling)
    .sort((a, b) => String(getMemberStatus(a).description).localeCompare(String(getMemberStatus(b).description)));

  setHtml(
    "factionFlights",
    travelling.length
      ? travelling.map(member => {
        const status = getMemberStatus(member);
        return `
          <div class="intel-row">
            <span>
              ${tableMemberLink(member)}
              <small>${escapeHtml(status.description || status.details || "Travelling")}</small>
            </span>
            <span class="badge">${escapeHtml(status.state || "Travel")}</span>
          </div>
        `;
      }).join("")
      : emptyMessage("No faction members travelling.")
  );
}

function renderHospitalTable(hospital) {
  setHtml(
    "hospitalTable",
    hospital.length
      ? hospital.map(member => hospitalTableRow(member)).join("")
      : emptyTableRow("No faction members in hospital.", 6)
  );
}

function hospitalTableRow(member) {
  const status = getMemberStatus(member);
  const description = status.description || status.state || "Hospital";
  const details = status.details && status.details !== description ? status.details : "";

  return `
    <tr>
      <td>${tableMemberLink(member)}</td>
      <td>${escapeHtml(member.level ?? "-")}</td>
      <td><span class="status-pill status-hosp">${escapeHtml(status.state || "Hospital")}</span></td>
      <td>${escapeHtml(details || description)}</td>
      <td>${etaHtml(status.until, "danger")}</td>
      <td>${profileActionLink(member, "OPEN")}</td>
    </tr>
  `;
}

function hospitalRow(member) {
  const status = getMemberStatus(member);
  const description = status.description || status.state || "Hospital";
  const details = status.details && status.details !== description
    ? ` - ${status.details}`
    : "";
  const countdown = status.until
    ? `<span class="countdown danger" data-countdown-until="${status.until}">${formatCountdown(status.until)}</span>`
    : `<span class="muted">No ETA</span>`;

  return `
    <div class="intel-row">
      <span>
        ${memberLink(member)}
        <small>${escapeHtml(description + details)}</small>
      </span>
      ${countdown}
    </div>
  `;
}

function memberRow(member, label, className) {
  const action = getLastAction(member);
  const status = getMemberStatus(member);
  const subline = action.relative || status.description || status.state || "";

  return `
    <div class="intel-row">
      <span>
        ${memberLink(member)}
        ${subline ? `<small>${escapeHtml(subline)}</small>` : ""}
      </span>
      <span class="badge ${className || ""}">${escapeHtml(label)}</span>
    </div>
  `;
}

function memberLink(member) {
  const id = getPlayerId(member);
  const label = `${member.name || "Unknown"}${id ? ` [${id}]` : ""}`;

  if (!id || String(id).startsWith("stealth")) {
    return escapeHtml(label);
  }

  return `<a href="https://www.torn.com/profiles.php?XID=${encodeURIComponent(id)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
}

function getPlayerId(player) {
  return player?.id || player?.player_id || player?.ID || player?.playerId || "";
}

function tableMemberLink(member) {
  const id = getPlayerId(member);
  const label = member.name || member.player_name || (id ? `Player ${id}` : "Unknown");

  if (!id || String(id).startsWith("stealth")) return escapeHtml(label);

  return `<a href="${profileUrl(id)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
}

function profileUrl(id) {
  return `https://www.torn.com/profiles.php?XID=${encodeURIComponent(id)}`;
}

function attackUrl(id) {
  return `https://www.torn.com/page.php?sid=attack&user2ID=${encodeURIComponent(id)}`;
}

function profileActionLink(member, label) {
  const id = getPlayerId(member);
  if (!id || String(id).startsWith("stealth")) return `<span class="muted">-</span>`;
  return `<a class="hit-link" href="${profileUrl(id)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
}

function attackActionLink(member) {
  const id = getPlayerId(member);
  if (!id || String(id).startsWith("stealth")) return `<span class="muted">-</span>`;
  return `<a class="hit-link danger-hit" href="${attackUrl(id)}" target="_blank" rel="noopener">ATTACK</a>`;
}

function etaHtml(until, className) {
  return until
    ? `<span class="countdown ${className || ""}" data-countdown-until="${until}">${formatCountdown(until)}</span>`
    : `<span class="muted">-</span>`;
}

function handleWars(data, factionId) {
  const wars = normalizeWars(data, factionId || activeFactionId);
  const now = Math.floor(Date.now() / 1000);
  const active = wars.find(war => war.start <= now && (!war.end || war.end > now) && !war.finished);
  const upcoming = wars.find(war => war.start > now);
  const selected = active || upcoming || wars[0];

  if (!selected) {
    activeEnemyId = null;
    setText("warStatus", "No active ranked war");
    setText("warTimer", "No active war");
    setText("warLastChecked", new Date().toLocaleTimeString());
    setHtml("warOverview", emptyMessage("No ranked war found."));
    setHtml("enemyHospitalList", emptyMessage("No enemy faction selected."));
    setHtml("warTargetsTable", emptyTableRow("No enemy faction selected.", 6));
    return;
  }

  const enemy = selected.enemy;
  activeEnemyId = enemy?.id || null;

  if (active) {
    setText("warStatus", `Fighting ${enemy?.name || "unknown faction"}`);
    setText("warTimer", selected.end ? formatCountdown(selected.end) : `Target ${formatNumber(selected.target)}`);
  } else if (upcoming) {
    setText("warStatus", `Matched vs ${enemy?.name || "unknown faction"}`);
    setText("warTimer", formatCountdown(selected.start));
  } else {
    setText("warStatus", `Last war vs ${enemy?.name || "unknown faction"}`);
    setText("warTimer", "No active war");
  }

  renderWarOverview(selected, active, upcoming);

  if (activeEnemyId && (active || upcoming)) {
    loadEnemyFaction(activeEnemyId);
  } else {
    setHtml("enemyHospitalList", emptyMessage("No active or matched enemy faction."));
    setHtml("warTargetsTable", emptyTableRow("No active or matched enemy faction.", 6));
  }
}

function normalizeWars(data, factionId) {
  const raw = data.rankedwars || data.ranked_wars || data.wars || data;
  const entries = Array.isArray(raw) ? raw.map((war, index) => [war.id || index, war]) : Object.entries(raw || {});

  return entries
    .filter(([, war]) => war && typeof war === "object")
    .map(([id, war]) => normalizeWar(id, war, factionId))
    .filter(Boolean)
    .sort((a, b) => (b.start || 0) - (a.start || 0));
}

function normalizeWar(id, war, factionId) {
  const factionsRaw = war.factions || war.faction || {};
  const factionEntries = Array.isArray(factionsRaw)
    ? factionsRaw.map((faction, index) => [faction.id || index, faction])
    : Object.entries(factionsRaw);

  const factions = factionEntries
    .filter(([, faction]) => faction && typeof faction === "object")
    .map(([factionEntryId, faction]) => ({
      ...faction,
      id: faction.id || faction.ID || faction.faction_id || factionEntryId,
      name: faction.name || faction.faction_name || `Faction ${factionEntryId}`,
      score: Number(faction.score || faction.points || faction.chain || 0)
    }));

  const own = factions.find(faction => String(faction.id) === String(factionId)) || factions[0];
  const enemy = factions.find(faction => String(faction.id) !== String(own?.id)) || factions[1];

  return {
    id,
    start: Number(war.start || war.start_time || 0),
    end: Number(war.end || war.end_time || 0),
    target: Number(war.target || war.war_target || 0),
    winner: war.winner || war.winner_id || null,
    finished: Boolean(war.winner || war.winner_id || (war.end && Number(war.end) < Date.now() / 1000)),
    own,
    enemy
  };
}

function renderWarOverview(war, active, upcoming) {
  const enemyLink = war.enemy?.id
    ? `<a href="https://www.torn.com/factions.php?step=profile&ID=${encodeURIComponent(war.enemy.id)}" target="_blank" rel="noopener">${escapeHtml(war.enemy.name)} [${escapeHtml(war.enemy.id)}]</a>`
    : escapeHtml(war.enemy?.name || "Unknown faction");

  const status = active ? "ACTIVE" : upcoming ? "MATCHED" : "LATEST";
  const timeLine = upcoming
    ? `Starts ${formatDateTime(war.start)}`
    : active && war.end
      ? `Ends ${formatDateTime(war.end)}`
      : war.start ? `Started ${formatDateTime(war.start)}` : "Time unavailable";
  const scoreLine = `${escapeHtml(war.own?.name || "Us")}: ${formatNumber(war.own?.score)} | ${escapeHtml(war.enemy?.name || "Enemy")}: ${formatNumber(war.enemy?.score)}`;

  setHtml("warOverview", `
    <div class="intel-row">
      <span>
        ${enemyLink}
        <small>${escapeHtml(timeLine)}</small>
      </span>
      <span class="badge ${active ? "danger" : "warning"}">${status}</span>
    </div>
    <div class="intel-row">
      <span>
        Score
        <small>${scoreLine}</small>
      </span>
      <span class="badge">Target ${formatNumber(war.target)}</span>
    </div>
  `);
}

async function loadEnemyFaction(enemyId) {
  try {
    const data = await loadTrackedFactionMembers(enemyId);

    if (String(enemyId) !== String(activeEnemyId)) return;

    const members = normalizeMembers(data.members || data.faction?.members || data);
    syncMemberStatusTracking(members);
    latestEnemyMembers = members;
    setText("warLastChecked", new Date().toLocaleTimeString());
    renderWarTargetTable(members);
    renderEnemyHospital(members);
    renderEnemyMedOuts(members);
    enrichEnemyStats(members);
  } catch (err) {
    setHtml("enemyHospitalList", emptyMessage(`Enemy status unavailable: ${err.message}`));
    setHtml("warTargetsTable", emptyTableRow(`Enemy status unavailable: ${err.message}`, 6));
  }
}

async function loadTrackedFactionMembers(factionId) {
  try {
    const params = new URLSearchParams();
    if (activeFactionId) params.set("viewerFactionId", activeFactionId);
    const query = params.toString() ? `?${params.toString()}` : "";
    return await getData(`${EMU_WORKER_API}/api/travel/faction/${encodeURIComponent(factionId)}${query}`);
  } catch (err) {
    return loadFactionMembers(factionId);
  }
}

async function enrichEnemyStats(members) {
  if (!hasTornApiKey() || !members.length) return;

  const ids = members
    .map(getPlayerId)
    .filter(id => /^\d+$/.test(String(id)))
    .slice(0, 205);

  if (!ids.length) return;

  let enrichedMembers = members;

  try {
    const data = await getEmuBsData("/get-stats", {
      key: getTornApiKey(),
      targets: ids.join(",")
    });
    const stats = normalizeArray(data);
    const statsById = new Map(stats.map(entry => [String(entry.player_id || entry.id), entry]));

    enrichedMembers = members.map(member => ({
      ...member,
      emubs: statsById.get(String(getPlayerId(member))) || null
    }));
  } catch (err) {
    console.warn("Official estimate source unavailable", err);
  }

  latestEnemyMembers = await enrichMembersWithBSP(enrichedMembers, 100);
  renderWarTargetTable(latestEnemyMembers);
  renderEnemyMedOuts(latestEnemyMembers);
}

function renderWarTargetTable(members) {
  latestEnemyMembers = members;
  const sorted = sortEnemyTargets(members);
  const visible = filterWarViewMembers(sorted);
  const rows = visible.map(member => warTargetRow(member)).join("");

  setHtml(
    "warTargetsTable",
    rows
      ? rows
      : emptyTableRow(getWarViewEmptyMessage(), 6)
  );
}

function sortEnemyTargets(members) {
  return [...members].sort((a, b) => {
    if (warView === "flights") {
      const aTravel = getTravelInfo(a);
      const bTravel = getTravelInfo(b);
      const aEta = getFlightSortTime(aTravel);
      const bEta = getFlightSortTime(bTravel);
      const aTravelling = aTravel ? 0 : 1;
      const bTravelling = bTravel ? 0 : 1;

      return aTravelling - bTravelling || aEta - bEta || String(a.name).localeCompare(String(b.name));
    }

    if (warView === "okay") {
      const aHospital = isHospital(a);
      const bHospital = isHospital(b);
      if (aHospital !== bHospital) return aHospital ? -1 : 1;
      if (aHospital && bHospital) {
        return getTargetSortTime(a) - getTargetSortTime(b) || String(a.name).localeCompare(String(b.name));
      }
    }

    if (warSortMode === "level") {
      return Number(b.level || 0) - Number(a.level || 0) || targetStatusRank(a) - targetStatusRank(b);
    }

    if (warSortMode === "stats") {
      return getMemberEstimateValue(b) - getMemberEstimateValue(a) || Number(b.level || 0) - Number(a.level || 0);
    }

    const aStatus = targetStatusRank(a);
    const bStatus = targetStatusRank(b);
    const aUntil = getTargetSortTime(a);
    const bUntil = getTargetSortTime(b);

    return aStatus - bStatus || aUntil - bUntil || String(a.name).localeCompare(String(b.name));
  });
}

function filterWarViewMembers(members) {
  if (warView === "all") return members;
  if (warView === "overseas") return members.filter(member => {
    if (isHospital(member)) return isOverseasHospital(member);
    return getTravelInfo(member)?.direction === "abroad";
  });
  if (warView === "flights") return members.filter(member => {
    const travel = getTravelInfo(member);
    return travel && travel.direction !== "abroad";
  });

  return members.filter(member => isHospital(member) || getWarTargetGroup(member) === "okay");
}

function isOverseasHospital(member) {
  const status = getMemberStatus(member);
  const text = `${status.state} ${status.description} ${status.details}`.toLowerCase();
  return Object.keys(TRAVEL_TIMES).some(location => text.includes(location));
}

function getFlightSortTime(travel) {
  if (!travel) return Number.MAX_SAFE_INTEGER;
  if (travel.direction === "abroad") return Number.MAX_SAFE_INTEGER - 1;
  return travel.estimates?.airstrip || travel.estimates?.standard || Number.MAX_SAFE_INTEGER - 2;
}

function setWarSortMode(mode) {
  warSortMode = ["status", "level", "stats"].includes(mode) ? mode : "status";
  localStorage.setItem("warSortMode", warSortMode);

  if (latestEnemyMembers.length) renderWarTargetTable(latestEnemyMembers);
}

function setWarView(mode) {
  warView = ["all", "okay", "overseas", "flights"].includes(mode) ? mode : "all";
  localStorage.setItem("warView", warView);

  document.querySelectorAll("[data-war-view]").forEach(button => {
    button.classList.toggle("active-tool", button.dataset.warView === warView);
  });

  if (latestEnemyMembers.length) renderWarTargetTable(latestEnemyMembers);
}

function getWarViewEmptyMessage() {
  if (warView === "overseas") return "No enemy members overseas.";
  if (warView === "flights") return "No enemy members currently flying.";
  if (warView === "all") return "No enemy members loaded.";
  return "No hospital or attackable enemy members loaded.";
}

function getTargetSortTime(member) {
  const status = getMemberStatus(member);
  if (status.until) return status.until;

  const travel = getTravelInfo(member);
  return travel?.estimates?.airstrip || Number.MAX_SAFE_INTEGER;
}

function targetStatusRank(member) {
  if (isHospital(member)) return 0;
  const travel = getTravelInfo(member);
  if (travel?.direction === "returning") return 1;
  if (travel?.direction === "abroad") return 2;
  if (travel?.direction === "outbound") return 3;
  if (travel) return 4;
  if (isOnline(member)) return 5;
  return 6;
}

function getWarTargetGroup(member) {
  if (isHospital(member)) return "hospital";
  if (isTravelling(member)) return "travel";

  const status = getMemberStatus(member);
  const state = String(status.state || status.description || "").toLowerCase();

  if (state.includes("okay") || isOnline(member)) return "okay";
  return "other";
}

function warTargetRow(member) {
  const status = getMemberStatus(member);
  const statusLabel = getTargetStatusLabel(member);
  const statusClass = isHospital(member) ? "status-hosp" : isTravelling(member) ? "status-travel" : "status-okay";
  const stats = formatMemberEstimate(member);
  const details = formatTargetStatusDetails(member, status);
  const attackable = !isHospital(member) && !isTravelling(member);
  const flightLine = attackable ? formatAttackableFlightLine(member) : "";

  return `
    <tr>
      <td>${tableMemberLink(member)}${flightLine}</td>
      <td>${escapeHtml(member.level ?? "-")}</td>
      <td>${stats !== "-" ? `<span class="stat-pill">${escapeHtml(stats)}</span>` : `<span class="muted">-</span>`}</td>
      <td><span class="status-pill ${statusClass}">${escapeHtml(statusLabel)}</span>${details}</td>
      <td>${targetEtaHtml(member)}</td>
      <td>${attackActionLink(member)}</td>
    </tr>
  `;
}

function formatAttackableFlightLine(member) {
  const status = getMemberStatus(member);
  const description = status.description || status.state || "Okay";
  return `<small class="flight-line">Attackable now | ${escapeHtml(description)}</small>`;
}

function getTargetStatusLabel(member) {
  const status = getMemberStatus(member);
  const description = status.description || status.state || "Okay";
  const travel = getTravelInfo(member);

  if (isHospital(member)) return "Hosp";
  if (travel?.direction === "returning") return `Back from ${travel.destination}`;
  if (travel?.direction === "outbound") return `To ${travel.destination}`;
  if (travel?.direction === "abroad") return `In ${travel.destination}`;
  if (travel) return "Traveling";
  return status.state || description || "Okay";
}

function formatTargetStatusDetails(member, status) {
  if (!isHospital(member) && !isTravelling(member)) return "";

  const reason = status.details && status.details !== status.description ? status.details : status.description;
  return reason
    ? `<small>${escapeHtml(reason)}</small>`
    : "";
}

function targetEtaHtml(member) {
  const status = getMemberStatus(member);

  if (isHospital(member)) {
    return etaHtml(status.until, "danger");
  }

  const travel = getTravelInfo(member);
  if (!travel) {
    return etaHtml(status.until, "warning");
  }

  if (status.until) {
    return etaHtml(status.until, "warning");
  }

  if (travel.direction === "abroad") {
    return `<span class="muted">Overseas</span>`;
  }

  if (!travel.estimates) {
    return `<span class="muted">ETA unknown</span>`;
  }

  return `
    <span class="travel-eta" data-pi-until="${travel.estimates.airstrip}" data-standard-until="${travel.estimates.standard}">
      ${formatTravelEta(travel.estimates)}
    </span>
  `;
}

function renderEnemyHospital(members) {
  const hospital = sortByUntil(members.filter(isHospital));

  setHtml(
    "enemyHospitalList",
    hospital.length
      ? hospital.map(member => hospitalRow(member)).join("")
      : emptyMessage("No enemy members in hospital.")
  );
}

function sortByUntil(members) {
  return [...members].sort((a, b) => {
    const aUntil = getMemberStatus(a).until || Number.MAX_SAFE_INTEGER;
    const bUntil = getMemberStatus(b).until || Number.MAX_SAFE_INTEGER;
    return aUntil - bUntil || a.name.localeCompare(b.name);
  });
}

function renderAttacks(data, factionId) {
  const attacks = normalizeAttacks(data)
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
  const recent = attacks.slice(0, 10);

  setHtml(
    "recentAttacks",
    recent.length
      ? recent.map(attack => attackRow(attack, factionId || activeFactionId)).join("")
      : emptyMessage("No recent attacks found.")
  );

  loadRetalTargets(attacks, factionId || activeFactionId);
}

async function loadRetalTargets(attacks, factionId) {
  const now = Math.floor(Date.now() / 1000);
  const byAttacker = new Map();

  attacks.forEach(attack => {
    const incoming = String(attack.defender.factionId) === String(factionId);
    const outsideAttacker = String(attack.attacker.factionId) !== String(factionId);
    const id = getPlayerId(attack.attacker);
    const retalUntil = Number(attack.timestamp || 0) + 300;
    if (!incoming || !outsideAttacker || !/^\d+$/.test(String(id)) || !attack.timestamp || retalUntil <= now) return;

    const previous = byAttacker.get(String(id));
    if (!previous || Number(attack.timestamp || 0) > Number(previous.lastAttack || 0)) {
      byAttacker.set(String(id), {
        ...attack.attacker,
        lastAttack: attack.timestamp,
        retalUntil,
        victim: attack.defender
      });
    }
  });

  latestRetalTargets = [...byAttacker.values()]
    .sort((a, b) => Number(b.lastAttack || 0) - Number(a.lastAttack || 0))
    .slice(0, 10);
  renderQuickStrikeTargets();

  if (!latestRetalTargets.length) return;

  latestRetalTargets = await enrichMembersWithBSP(latestRetalTargets, 10);
  renderQuickStrikeTargets();
}

function renderEnemyMedOuts(members) {
  const now = Date.now();
  latestMedOutTargets = members
    .filter(member => {
      const tracked = getMemberStatusTracking(member);
      return tracked?.hospitalExitAt &&
        now - tracked.hospitalExitAt <= MED_OUT_WINDOW_MS &&
        isOnline(member) &&
        !isHospital(member) &&
        !isTravelling(member);
    })
    .sort((a, b) => Number(getMemberStatusTracking(b)?.hospitalExitAt || 0) - Number(getMemberStatusTracking(a)?.hospitalExitAt || 0))
    .slice(0, 10);

  renderQuickStrikeTargets();
}

function setQuickStrikeView(mode) {
  quickStrikeView = ["retals", "medouts"].includes(mode) ? mode : "retals";
  localStorage.setItem("quickStrikeView", quickStrikeView);

  document.querySelectorAll("[data-strike-view]").forEach(button => {
    button.classList.toggle("active-tool", button.dataset.strikeView === quickStrikeView);
  });

  renderQuickStrikeTargets();
}

function renderQuickStrikeTargets() {
  const rows = quickStrikeView === "medouts"
    ? latestMedOutTargets.map(medOutStrikeRow)
    : latestRetalTargets.map(retalStrikeRow);

  const empty = quickStrikeView === "medouts"
    ? "No tracked enemy med outs online right now."
    : "No incoming faction attackers in the recent attack feed.";

  setHtml("quickStrikeTargets", rows.length ? rows.join("") : emptyMessage(empty));
}

function retalStrikeRow(member) {
  const victim = member.victim?.name ? `Hit ${member.victim.name}` : "Incoming faction attack";
  const timer = member.retalUntil
    ? `<small>Retal window: <span class="countdown warning" data-countdown-until="${member.retalUntil}">${formatCountdown(member.retalUntil)}</span></small>`
    : "";
  return quickStrikeRow(member, `${victim} - ${member.lastAttack ? formatDateTime(member.lastAttack) : "Recent"}`, timer);
}

function medOutStrikeRow(member) {
  const tracked = getMemberStatusTracking(member);
  return quickStrikeRow(member, `Online after hospital - ${formatElapsed(Date.now() - Number(tracked?.hospitalExitAt || Date.now()))} ago`);
}

function quickStrikeRow(member, detail, extraHtml = "") {
  const estimate = formatMemberEstimate(member);
  return `
    <div class="intel-row strike-row">
      <span>
        ${tableMemberLink(member)}
        <small>${escapeHtml(detail)}</small>
        ${extraHtml}
        <small>BSP: ${escapeHtml(estimate || "-")}</small>
      </span>
      ${attackActionLink(member)}
    </div>
  `;
}

function normalizeAttacks(data) {
  const raw = data.attacks || data.faction_attacks || data;
  const entries = Array.isArray(raw) ? raw.map((attack, index) => [attack.id || index, attack]) : Object.entries(raw || {});

  return entries
    .filter(([, attack]) => attack && typeof attack === "object")
    .map(([id, attack]) => {
      const attacker = normalizeAttackPlayer(attack.attacker, "attacker", attack);
      const defender = normalizeAttackPlayer(attack.defender, "defender", attack);

      return {
        id,
        attacker,
        defender,
        result: attack.result || attack.outcome || attack.status || "-",
        timestamp: Number(attack.timestamp_ended || attack.ended || attack.timestamp || attack.started || 0)
      };
    });
}

function normalizeAttackPlayer(player, prefix, attack) {
  const fallbackId = attack[`${prefix}_id`] || attack[`${prefix}ID`] || `${prefix}-stealth`;
  const fallbackName = attack[`${prefix}_name`] || attack[`${prefix}Name`] || "Stealthed";
  const factionId = attack[`${prefix}_faction`] || attack[`${prefix}_faction_id`] || player?.faction_id || player?.faction?.id;

  return {
    id: player?.id || player?.player_id || fallbackId,
    name: player?.name || fallbackName,
    factionId
  };
}

function attackRow(attack, factionId) {
  const direction = String(attack.attacker.factionId) === String(factionId)
    ? "OUT"
    : String(attack.defender.factionId) === String(factionId)
      ? "IN"
      : "LOG";
  const directionClass = direction === "IN" ? "danger" : direction === "OUT" ? "good" : "";

  return `
    <div class="intel-row">
      <span>
        ${attackPlayerLink(attack.attacker)} &gt; ${attackPlayerLink(attack.defender)}
        <small>${escapeHtml(attack.result)}${attack.timestamp ? ` - ${formatDateTime(attack.timestamp)}` : ""}</small>
      </span>
      <span class="badge ${directionClass}">${direction}</span>
    </div>
  `;
}

function attackPlayerLink(player) {
  if (!player.id || String(player.id).includes("stealth")) return escapeHtml(player.name || "Stealthed");
  return `<a href="https://www.torn.com/profiles.php?XID=${encodeURIComponent(player.id)}" target="_blank" rel="noopener">${escapeHtml(player.name || "Unknown")} [${escapeHtml(player.id)}]</a>`;
}

async function refreshWarTools() {
  setText("warLastChecked", "Refreshing...");

  if (activeEnemyId) {
    await loadEnemyFaction(activeEnemyId);
    return;
  }

  await loadAllData();
}

async function getEmuBsData(endpoint, params) {
  const search = new URLSearchParams(params);
  const response = await fetch(`${EMUBS_API}${endpoint}?${search.toString()}`, { cache: "no-store" });
  let data;

  try {
    data = await response.json();
  } catch (err) {
    throw new Error(`EMU BS Tracker HTTP ${response.status}`);
  }

  if (!response.ok || data?.error) {
    throw new Error(formatTrackerError(data?.error || data?.message || `EMU BS Tracker HTTP ${response.status}`));
  }

  return data;
}

async function getTargetFeed(params) {
  return getWorkerTargetFeed(params);
}

async function getWorkerTargetFeed(params) {
  const search = new URLSearchParams(params);
  return getData(`${EMU_WORKER_API}/api/targets/search?${search.toString()}`);
}

function formatTrackerError(message) {
  const text = String(message || "EMU BS Tracker unavailable.");

  if (/sign up at .*\.com|invalid api key/i.test(text)) {
    return "Target feed unavailable. Torn profile fallback is still active.";
  }

  return text.replaceAll("emubs", "EMU BS Tracker");
}

async function getBSPData(playerId, forceRefresh) {
  if (!playerId || !/^\d+$/.test(String(playerId))) {
    throw new Error("Private predictor target must be a player ID.");
  }

  const cached = forceRefresh ? null : getCachedBSPPrediction(playerId);
  if (cached) return cached;

  const data = await fetchBSPPrediction(playerId);
  const prediction = normalizeBSPPrediction(data, playerId);

  if (prediction && prediction.result !== 0 && prediction.result !== 4) {
    setCachedBSPPrediction(playerId, prediction);
  }

  return prediction;
}

async function fetchBSPPrediction(playerId) {
  return fetchBSPJson(`${EMU_WORKER_API}/api/bsp/prediction/${encodeURIComponent(playerId)}`);
}

async function fetchBSPUserStatus() {
  return fetchBSPJson(`${EMU_WORKER_API}/api/bsp/status`);
}

async function fetchBSPJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  const raw = await response.json();
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Private predictor HTTP ${response.status}`);
  }
  return data;
}

function normalizeBSPPrediction(data, playerId) {
  const result = Number(data?.Result ?? data?.result ?? 0);
  const tbs = parseNumberish(data?.TBS_Raw ?? data?.TBS_Balanced ?? data?.TBS ?? data?.tbs);
  const score = parseNumberish(data?.Score ?? data?.score);
  const label = getBSPResultLabel(result);
  const fairFight = ownBattleStats?.score && score
    ? Math.max(1, Math.min(3, 1 + (8 / 3) * (score / ownBattleStats.score))).toFixed(2)
    : null;

  return {
    player_id: playerId,
    result,
    label,
    reason: data?.Reason || data?.reason || label,
    tbs,
    score,
    tbs_human: tbs ? formatBattleStats(tbs) : "-",
    score_human: score ? formatBattleStats(score) : "-",
    fair_fight: fairFight,
    source: label,
    fetched_at: Date.now()
  };
}

function getBSPResultLabel(result) {
  switch (Number(result)) {
    case 1: return "Private predictor";
    case 2: return "Too weak";
    case 3: return "Too strong";
    case 4: return "Model error";
    case 5: return "HOF";
    case 6: return "FF attacks";
    default: return "No estimate";
  }
}

function getCachedBSPPrediction(playerId) {
  const raw = localStorage.getItem(`bspPrediction.${playerId}`);
  if (!raw) return null;

  try {
    const prediction = JSON.parse(raw);
    const maxAge = BSP_CACHE_DAYS * 24 * 60 * 60 * 1000;
    if (!prediction.fetched_at || Date.now() - prediction.fetched_at > maxAge) {
      localStorage.removeItem(`bspPrediction.${playerId}`);
      return null;
    }
    return prediction;
  } catch (err) {
    localStorage.removeItem(`bspPrediction.${playerId}`);
    return null;
  }
}

function setCachedBSPPrediction(playerId, prediction) {
  try {
    localStorage.setItem(`bspPrediction.${playerId}`, JSON.stringify(prediction));
  } catch (err) {
    console.warn("BSP cache write failed", err);
  }
}

function setTargetPreset(preset) {
  targetPreset = preset;

  document.querySelectorAll("[data-target-preset]").forEach(button => {
    button.classList.toggle("active-tool", button.dataset.targetPreset === preset);
  });

  const filterGrid = document.getElementById("targetFilterGrid");
  const manualGrid = document.getElementById("manualTargetGrid");
  const showManual = preset === "manual";
  const showFilters = preset === "custom";

  if (filterGrid) filterGrid.classList.toggle("hidden", !showFilters);
  if (manualGrid) manualGrid.classList.toggle("active-manual", showManual);

  if (preset === "respect") {
    setText("targetStatus", "Respect preset: inactive targets with FF 2.00-3.00.");
  } else if (preset === "level") {
    setText("targetStatus", "Level preset: high-level targets with FF up to 3.00.");
  } else if (preset === "manual") {
    setText("targetStatus", "Manual mode: paste player IDs to check FF and stats.");
  } else {
    setText("targetStatus", "Custom filter mode.");
  }

  syncTargetSearchModes();
}

async function searchTargets() {
  if (!hasTornApiKey()) {
    setText("targetStatus", "Enter Torn API key in Settings first.");
    return;
  }

  setText("targetStatus", "Searching targets...");

  try {
    await loadOwnBattleStats();
    targetPageIndex = 0;
    targetBatchIndex = 0;
    targetSearchSeenIds = new Set();

    if (targetPreset === "manual") {
      targetResultPool = await loadTargetFinderBatch();
    } else {
      targetResultPool = [];
      await ensureTargetPoolSize(getTargetPageSize());
    }

    renderTargetPage();
    setText("targetStatus", `${targetResultPool.length} matching target${targetResultPool.length === 1 ? "" : "s"} ready.`);
  } catch (err) {
    targetResultPool = [];
    latestTargetResults = [];
    setHtml("targetResults", emptyTableRow(err.message || "Target lookup failed.", 6));
    updateTargetPager();
    setText("targetStatus", err.message || "Target lookup failed.");
  }
}

async function loadTargetFinderBatch() {
  const data = targetPreset === "manual"
    ? await searchManualTargets()
    : await searchFilteredTargets(targetBatchIndex++);
  const verified = await filterSearchTargets(normalizeTargetResults(data));
  const withBsp = await enrichTargetsWithBSP(verified);
  return filterTargetsByViewerFairFight(withBsp);
}

function appendUniqueTargets(targets) {
  targets.forEach(target => {
    const id = String(target.player_id || target.id || target.target || "");
    if (!id || targetSearchSeenIds.has(id)) return;
    targetSearchSeenIds.add(id);
    targetResultPool.push(target);
  });
}

async function changeTargetPage(direction) {
  if (!hasTornApiKey() || targetPreset === "manual") return;

  const pageSize = getTargetPageSize();
  const nextPage = Math.max(0, targetPageIndex + direction);
  const needsMoreTargets = direction > 0 && nextPage * pageSize >= targetResultPool.length;

  if (needsMoreTargets) {
    setText("targetStatus", "Loading more targets...");
    const before = targetResultPool.length;
    const currentPageEnd = (targetPageIndex + 1) * pageSize;

    try {
      await ensureTargetPoolSize((nextPage + 1) * pageSize);
    } catch (err) {
      setText("targetStatus", err.message || "Target lookup failed.");
      return;
    }

    if (targetResultPool.length === before) {
      setText("targetStatus", "No new matching targets in the next batch. Try again or widen filters.");
      updateTargetPager();
      return;
    }

    if (before < currentPageEnd) {
      renderTargetPage();
      setText("targetStatus", "Added more matches to the current page.");
      return;
    }
  }

  if (nextPage * pageSize >= targetResultPool.length) {
    updateTargetPager();
    return;
  }

  targetPageIndex = nextPage;
  renderTargetPage();
  setText("targetStatus", `Showing target page ${targetPageIndex + 1}.`);
}

async function ensureTargetPoolSize(minCount) {
  let attempts = 0;
  let stagnant = 0;

  while (targetResultPool.length < minCount && attempts < TARGET_BATCH_ATTEMPT_LIMIT && stagnant < 10) {
    const before = targetResultPool.length;
    appendUniqueTargets(await loadTargetFinderBatch());
    attempts++;

    if (targetResultPool.length === before) {
      stagnant++;
    } else {
      stagnant = 0;
    }
  }

  return targetResultPool.length;
}

async function filterSearchTargets(targets) {
  if (targetPreset !== "custom") return targets;

  const inactiveOnly = document.getElementById("targetInactive")?.value === "1";
  const factionlessOnly = document.getElementById("targetFactionless")?.value === "1";
  let filtered = targets;

  if (inactiveOnly) {
    filtered = filtered.filter(target => {
      const age = getLastActionAgeSeconds(target);
      return age !== null && age >= 200 * 86400;
    });
  }

  return factionlessOnly ? verifyFactionlessTargets(filtered) : filtered;
}

async function enrichTargetsWithBSP(targets) {
  const enriched = [...targets];
  const capped = enriched.slice(0, 50);
  const concurrency = 4;
  let cursor = 0;

  async function worker() {
    while (cursor < capped.length) {
      const index = cursor++;
      const target = capped[index];
      const id = target.player_id || target.id || target.target;
      if (!/^\d+$/.test(String(id))) continue;

      try {
        const bsp = await getBSPData(id);
        enriched[index] = { ...target, bsp };
      } catch (err) {
        enriched[index] = { ...target, bsp_error: err.message };
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return enriched;
}

async function searchFilteredTargets(batchIndex = 0) {
  const limit = clampNumber(inputValue("targetLimit", 20), 1, 50);
  const params = {
    limit: targetPreset === "custom" ? 50 : limit
  };

  try {
    if (targetPreset === "respect") {
      params.preset = "respect";
      return await getTargetFeed(params);
    }

    if (targetPreset === "level") {
      params.preset = "level";
      return await getTargetFeed(params);
    }

    params.minlevel = clampNumber(inputValue("targetMinLevel", 1), 1, 100);
    params.maxlevel = clampNumber(inputValue("targetMaxLevel", 100), 1, 100);
    const sourceFfRange = getTargetSourceFairFightRange(batchIndex);
    params.minff = sourceFfRange.min;
    params.maxff = sourceFfRange.max;
    params.inactiveonly = document.getElementById("targetInactive")?.value || "1";
    params.factionless = document.getElementById("targetFactionless")?.value || "0";

    return await getTargetFeed(params);
  } catch (err) {
    throw new Error(formatTargetFeedError(err, "Target Finder"));
  }
}

function filterTargetsByViewerFairFight(targets) {
  if (targetPreset === "manual") return targets;

  const [minFF, maxFF] = getViewerFairFightRange();
  const [minStats, maxStats] = getTargetStatsRange();
  const useFF = isTargetFFEnabled();
  const useStats = isTargetStatsEnabled() && (minStats > 0 || maxStats > 0);

  return targets.filter(target => {
    const fairFight = Number(target.bsp?.fair_fight);
    const stats = getTargetEstimateValue(target);
    const ffMatches = !useFF || (Number.isFinite(fairFight) && fairFight >= minFF && fairFight <= maxFF);
    const statMatches = !useStats || (
      stats > 0 &&
      (!minStats || stats >= minStats) &&
      (!maxStats || stats <= maxStats)
    );
    return ffMatches && statMatches;
  });
}

function getViewerFairFightRange() {
  if (targetPreset === "respect") return [2, 3];
  if (targetPreset === "level") return [1, 3];

  const min = Math.max(1, Number(inputValue("targetMinFF", 1)) || 1);
  const max = Math.max(min, Number(inputValue("targetMaxFF", 3)) || 3);
  return [min, max];
}

function isTargetFFEnabled() {
  return targetPreset !== "custom" || Boolean(document.getElementById("targetUseFF")?.checked);
}

function isTargetStatsEnabled() {
  return targetPreset === "custom" && Boolean(document.getElementById("targetUseStats")?.checked);
}

function syncTargetSearchModes() {
  const useFF = isTargetFFEnabled();
  const useStats = isTargetStatsEnabled();

  document.getElementById("targetStatsControls")?.classList.toggle("filter-disabled", !useStats);

  ["targetStatsPreset", "targetMinStats", "targetMaxStats"].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.disabled = !useStats;
  });
}

function setTargetStatsPreset(value) {
  const maxInput = document.getElementById("targetMaxStats");
  const toggle = document.getElementById("targetUseStats");
  if (toggle && value && value !== "any") toggle.checked = true;
  if (maxInput && value && value !== "custom") maxInput.value = value;
  if (maxInput && value === "any") maxInput.value = "";
  syncTargetSearchModes();
}

function getTargetStatsRange() {
  if (!isTargetStatsEnabled()) return [0, 0];
  const min = parseNumberish(inputValue("targetMinStats", ""));
  const max = parseNumberish(inputValue("targetMaxStats", ""));
  return [Math.max(0, min), max > 0 ? Math.max(min || 0, max) : 0];
}

function getTargetSourceFairFightRange(batchIndex = 0) {
  const [manualMinStats, manualMaxStats] = getTargetStatsRange();
  const minStats = manualMinStats;
  const maxStats = manualMaxStats || (!manualMinStats && isTargetFFEnabled() ? getAutoTargetStatCeiling() : 0);
  let min;
  let max;

  if (!minStats && !maxStats) {
    min = 1.01;
    max = isTargetFFEnabled()
      ? Math.max(min + 0.01, Number(inputValue("targetMaxFF", 3)) || 3)
      : 3;
  } else {
    const sourceMinStats = minStats || Math.max(1, maxStats / 80);
    const sourceMaxStats = maxStats || Math.max(sourceMinStats * 4, TARGET_FEED_STAT_BASE * 4);
    min = Math.max(1.01, statsToTargetFeedFairFight(sourceMinStats));
    max = Math.max(min + 0.01, statsToTargetFeedFairFight(sourceMaxStats));
  }

  const width = Math.max(0.01, max - min);
  const slices = Math.max(12, TARGET_BATCH_ATTEMPT_LIMIT);
  const step = Math.max(0.01, width / slices);
  const cycle = Math.max(0, batchIndex % slices);
  const bandMax = Math.max(min + 0.01, max - step * cycle);
  const bandMin = Math.max(min, bandMax - step);
  return { min: formatTargetSourceFf(bandMin), max: formatTargetSourceFf(bandMax) };
}

function getAutoTargetStatCeiling() {
  const ownTotal = Number(ownBattleStats?.total || 0);
  if (!ownTotal) return 0;

  const maxFF = getViewerFairFightRange()[1];
  const scoreRatio = Math.max(0.04, ((maxFF - 1) * 3) / 8);
  return Math.max(1000, ownTotal * scoreRatio * scoreRatio * 2);
}

function statsToTargetFeedFairFight(stats) {
  return 1 + Math.sqrt(Math.max(1, Number(stats) || 1) / TARGET_FEED_STAT_BASE);
}

function formatTargetSourceFf(value) {
  return Math.max(1.01, Number(value) || 1.01).toFixed(3);
}

function getTargetEstimateValue(target) {
  return parseNumberish(target.bsp?.tbs || target.bs_estimate || target.bss_public);
}

function getTargetEstimateValues(target) {
  return [
    parseNumberish(target.bsp?.tbs),
    parseNumberish(target.bs_estimate),
    parseNumberish(target.bss_public)
  ].filter(value => value > 0);
}

function getTargetPageSize() {
  return clampNumber(inputValue("targetLimit", 20), 1, 50);
}

async function searchManualTargets() {
  const ids = parseTargetIds(document.getElementById("manualTargetIds")?.value || "");

  if (!ids.length) {
    throw new Error("Paste at least one player ID.");
  }

  try {
    return await getEmuBsData("/get-stats", {
      key: getTornApiKey(),
      targets: ids.slice(0, 205).join(",")
    });
  } catch (err) {
    const fallback = await Promise.allSettled(ids.slice(0, 50).map(loadPublicPlayerProfile));
    const targets = fallback
      .map((result, index) => result.status === "fulfilled"
        ? profileToManualTarget(normalizePlayerProfile(result.value, ids[index]))
        : null)
      .filter(Boolean);

    if (!targets.length) throw err;
    setText("targetStatus", `Loaded ${targets.length} Torn profile${targets.length === 1 ? "" : "s"}.`);
    return targets;
  }
}

function profileToManualTarget(profile) {
  return {
    player_id: profile.id,
    name: profile.name,
    level: profile.level,
    last_action_relative: profile.lastAction,
    source: "torn-profile"
  };
}

function parseTargetIds(value) {
  return [...new Set(String(value).match(/\d+/g) || [])];
}

function normalizeTargetResults(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.targets)) return data.targets;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function renderTargetResults(targets) {
  setHtml(
    "targetResults",
    targets.length
      ? targets.map(target => targetRow(target)).join("")
      : emptyTableRow("No targets found.", 6)
  );
}

function renderTargetPage() {
  const pageSize = getTargetPageSize();
  const start = targetPageIndex * pageSize;
  latestTargetResults = targetResultPool.slice(start, start + pageSize);
  renderTargetResults(latestTargetResults);
  updateTargetPager();
}

function updateTargetPager() {
  const pageSize = getTargetPageSize();
  const current = targetResultPool.length ? targetPageIndex + 1 : 0;
  const pages = Math.max(1, Math.ceil(targetResultPool.length / pageSize));
  const prev = document.getElementById("targetPrevPage");

  if (prev) prev.disabled = targetPreset === "manual" || targetPageIndex <= 0;
  setText("targetPageStatus", targetPreset === "manual"
    ? "Manual list"
    : `PAGE ${current || 1} / ${pages}`);
}

function targetRow(target) {
  const id = target.player_id || target.id || target.target;
  const name = target.name || (id ? `Player ${id}` : "Unknown");
  const stats = target.bsp?.tbs_human || target.bs_estimate_human || compactNumber(target.bs_estimate || target.bss_public);
  const fairFight = target.bsp?.fair_fight ?? target.fair_fight ?? target.ff ?? "-";
  const lastAction = formatTargetLastAction(target);

  return `
    <tr>
      <td>${id ? `<a href="${profileUrl(id)}" target="_blank" rel="noopener">${escapeHtml(name)} [${escapeHtml(id)}]</a>` : escapeHtml(name)}</td>
      <td>${id ? `<a class="hit-link danger-hit" href="${attackUrl(id)}" target="_blank" rel="noopener">ATTACK</a>` : `<span class="muted">-</span>`}</td>
      <td>${escapeHtml(target.level ?? "-")}</td>
      <td>${escapeHtml(fairFight)}</td>
      <td>${stats !== "-" ? `<span class="stat-pill">${escapeHtml(stats)}</span>` : `<span class="muted">-</span>`}</td>
      <td>${escapeHtml(lastAction)}</td>
    </tr>
  `;
}

function formatTargetLastAction(target) {
  const raw = target.last_action || target.lastAction;

  if (typeof raw === "object" && raw !== null) {
    return raw.timestamp ? formatAgeFromUnix(raw.timestamp) : raw.relative || raw.status || "-";
  }

  if (Number(raw) > 1000000000) return formatAgeFromUnix(raw);
  return target.last_action_relative || target.lastActionRelative || raw || "-";
}

async function copyTargetIds() {
  const ids = latestTargetResults
    .map(target => target.player_id || target.id || target.target)
    .filter(Boolean)
    .join(",");

  if (!ids) {
    setText("targetStatus", "No target IDs to copy.");
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(ids);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = ids;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setText("targetStatus", "Target IDs copied.");
  } catch (err) {
    setText("targetStatus", "Copy failed. Select the IDs manually.");
  }
}

async function searchRecruiter() {
  if (!hasTornApiKey()) {
    setText("recruiterStatus", "Enter Torn API key in Settings first.");
    return;
  }

  setText("recruiterStatus", "Searching factionless players...");

  try {
    const recruits = await loadRecruiterCandidates();
    latestRecruiterResults = recruits;
    renderRecruiterResults(recruits);
    setText("recruiterStatus", `${recruits.length} recruit${recruits.length === 1 ? "" : "s"} loaded.`);
  } catch (err) {
    latestRecruiterResults = [];
    setHtml("recruiterResults", emptyTableRow(err.message || "Recruit search failed.", 6));
    setText("recruiterStatus", err.message || "Recruit search failed.");
  }
}

async function loadRecruiterCandidates() {
  const limit = clampNumber(inputValue("recruitLimit", 20), 1, 50);
  const minLevel = clampNumber(inputValue("recruitMinLevel", 1), 1, 100);
  const maxLevel = clampNumber(inputValue("recruitMaxLevel", 100), 1, 100);
  const minStats = parseNumberish(inputValue("recruitMinStats", ""));
  const maxStats = parseNumberish(inputValue("recruitMaxStats", ""));
  const [minActive, maxActive] = parseRange(document.getElementById("recruitActivity")?.value || "0-86400");
  const params = {
    limit: 50,
    minlevel: minLevel,
    maxlevel: maxLevel,
    ...getRecruiterSourceFairFightParams(minStats, maxStats),
    factionless: "1",
    inactiveonly: "0"
  };

  let targets = [];

  try {
    const data = await getTargetFeed(params);
    targets = normalizeTargetResults(data);
  } catch (err) {
    throw new Error(formatTargetFeedError(err, "Faction Recruiter"));
  }

  const filtered = targets
    .filter(target => Number(target.level || 0) >= minLevel && Number(target.level || 0) <= maxLevel)
    .filter(isFactionlessCandidate)
    .slice(0, 50);

  const factionless = await verifyFactionlessTargets(filtered);
  const active = factionless
    .filter(target => {
      const age = getLastActionAgeSeconds(target);
      return age !== null && age >= minActive && age <= maxActive;
    })
    .sort((a, b) => (getLastActionAgeSeconds(a) ?? Infinity) - (getLastActionAgeSeconds(b) ?? Infinity))
    .slice(0, 50);

  const enriched = await enrichTargetsWithBSP(active);
  return enriched
    .filter(target => {
      const stats = getRecruiterEstimateValue(target);
      if (!minStats && !maxStats) return true;
      return stats > 0 &&
        (!minStats || stats >= minStats) &&
        (!maxStats || stats <= Math.max(minStats || 0, maxStats));
    })
    .slice(0, limit);
}

function getRecruiterEstimateValue(target) {
  return parseNumberish(target.bsp?.tbs || target.bs_estimate || target.bss_public);
}

function getRecruiterSourceFairFightParams(minStats, maxStats) {
  if (!minStats && !maxStats) {
    return { minff: "1.010", maxff: "2.500" };
  }

  const sourceMinStats = minStats || Math.max(1, maxStats / 80);
  const sourceMaxStats = maxStats || Math.max(sourceMinStats * 4, TARGET_FEED_STAT_BASE * 4);
  const minff = Math.max(1.01, statsToTargetFeedFairFight(sourceMinStats));
  const maxff = Math.max(minff + 0.01, statsToTargetFeedFairFight(sourceMaxStats));
  return {
    minff: formatTargetSourceFf(minff),
    maxff: formatTargetSourceFf(maxff)
  };
}

function parseRange(value) {
  const [min, max] = String(value || "").split("-").map(part => Number(part));
  return [Number.isFinite(min) ? min : 0, Number.isFinite(max) ? max : 900];
}

function formatTargetFeedError(err, toolName) {
  const message = String(err?.message || err || "");

  if (/target_feed_api_key|route not found|secret is missing/i.test(message)) {
    return `${toolName} Worker target feed is not deployed or its secret is missing.`;
  }

  return `${toolName} target feed unavailable. ${message || "Try again."}`;
}

function isFactionlessCandidate(target) {
  const faction = target.faction || target.faction_id || target.factionId || target.faction_name || target.factionName;
  if (faction === undefined || faction === null || faction === "" || faction === 0 || faction === "0") return true;
  if (typeof faction === "object") return !(faction.id || faction.ID || faction.name);
  return ["none", "n/a", "null"].includes(String(faction).toLowerCase());
}

async function verifyFactionlessTargets(targets) {
  const verified = [];
  const capped = targets.slice(0, 50);
  let cursor = 0;

  async function worker() {
    while (cursor < capped.length) {
      const target = capped[cursor++];
      const id = target.player_id || target.id || target.target;
      if (!/^\d+$/.test(String(id))) continue;

      try {
        const profile = normalizePlayerProfile(await loadPublicPlayerProfile(id), id);
        if (isFactionlessCandidate(profile)) {
          verified.push({
            ...target,
            name: profile.name || target.name,
            level: profile.level ?? target.level,
            status: profile.status || target.status,
            faction: profile.faction,
            faction_id: profile.factionId,
            last_action: profile.lastActionTimestamp
              ? {
                  timestamp: profile.lastActionTimestamp,
                  relative: profile.lastAction,
                  status: profile.lastActionStatus
                }
              : target.last_action
          });
        }
      } catch (err) {
        // A factionless search should not show players we could not verify.
      }
    }
  }

  await Promise.all(Array.from({ length: 4 }, worker));
  return verified;
}

function getLastActionAgeSeconds(target) {
  const raw = target.last_action || target.lastAction || target.last_action_timestamp || target.lastActionTimestamp;

  if (typeof raw === "object" && raw !== null) {
    if (raw.timestamp) return Math.max(0, Math.floor(Date.now() / 1000) - Number(raw.timestamp));
    if (raw.relative) return parseRelativeSeconds(raw.relative);
    if (raw.status && String(raw.status).toLowerCase() === "online") return 0;
  }

  if (Number(raw) > 1000000000) {
    return Math.max(0, Math.floor(Date.now() / 1000) - Number(raw));
  }

  return parseRelativeSeconds(target.last_action_relative || target.lastActionRelative || target.last_seen || target.lastSeen);
}

function parseRelativeSeconds(value) {
  const text = String(value || "").toLowerCase();
  if (!text || text === "-") return null;
  if (text.includes("online") || text.includes("now") || text.includes("just")) return 0;

  const match = /(\d+(?:\.\d+)?)\s*(second|sec|minute|min|hour|hr|day)/i.exec(text);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith("sec")) return amount;
  if (unit.startsWith("min")) return amount * 60;
  if (unit.startsWith("hour") || unit.startsWith("hr")) return amount * 3600;
  if (unit.startsWith("day")) return amount * 86400;
  return null;
}

function renderRecruiterResults(recruits) {
  setHtml(
    "recruiterResults",
    recruits.length
      ? recruits.map(recruitRow).join("")
      : emptyTableRow("No verified factionless players in that activity range. Try 0-24 hours or Open Torn Search for live subscriber search.", 6)
  );
}

function recruitRow(target) {
  const id = target.player_id || target.id || target.target;
  const name = target.name || (id ? `Player ${id}` : "Unknown");
  const stats = target.bsp?.tbs_human || target.bs_estimate_human || compactNumber(target.bs_estimate || target.bss_public);
  const status = target.status?.description || target.status || target.last_action?.status || "Factionless";
  const lastAction = formatTargetLastAction(target);

  return `
    <tr>
      <td>${id ? `<a href="${profileUrl(id)}" target="_blank" rel="noopener">${escapeHtml(name)} [${escapeHtml(id)}]</a>` : escapeHtml(name)}</td>
      <td>${escapeHtml(target.level ?? "-")}</td>
      <td>${stats !== "-" ? `<span class="stat-pill">${escapeHtml(stats)}</span>` : `<span class="muted">-</span>`}</td>
      <td>${escapeHtml(lastAction)}</td>
      <td><span class="status-pill status-okay">${escapeHtml(status)}</span></td>
      <td>${id ? `<a class="hit-link" href="${profileUrl(id)}" target="_blank" rel="noopener">OPEN</a>` : `<span class="muted">-</span>`}</td>
    </tr>
  `;
}

async function copyRecruitIds() {
  const ids = latestRecruiterResults
    .map(target => target.player_id || target.id || target.target)
    .filter(Boolean)
    .join(",");

  if (!ids) {
    setText("recruiterStatus", "No recruit IDs to copy.");
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(ids);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = ids;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setText("recruiterStatus", "Recruit IDs copied.");
  } catch (err) {
    setText("recruiterStatus", "Copy failed. Select the IDs manually.");
  }
}

async function loadPlayerView() {
  if (!hasTornApiKey()) {
    setText("playerViewStatus", "Enter Torn API key in Settings first.");
    return;
  }

  const playerId = parseTargetIds(document.getElementById("playerLookupId")?.value || "")[0];

  if (!playerId) {
    setText("playerViewStatus", "Enter a player ID or Torn profile URL.");
    return;
  }

  setText("playerViewStatus", "Loading player...");
  setHtml("playerDashboardCard", "");
  setHtml("playerViewSummary", "");
  setHtml("playerUsageSummary", "");
  setHtml("playerRelationPanel", emptyMessage("Loading attack history..."));
  setHtml("playerFlightsTable", emptyTableRow("Checking flights...", 5));

  const [profileResult, statsResult, flightsResult, bspResult, attacksResult, usageResult] = await Promise.allSettled([
    loadPublicPlayerProfile(playerId),
    getEmuBsData("/get-stats", { key: getTornApiKey(), targets: playerId }),
    getEmuBsData("/player-flights", { key: getTornApiKey(), target: playerId }),
    getBSPData(playerId),
    loadFactionAttacksData(),
    loadPlayerUsageInsights(playerId)
  ]);

  let profile = profileResult.status === "fulfilled" ? normalizePlayerProfile(profileResult.value, playerId) : null;
  profile = await enrichPlayerFactionName(profile);
  const stats = statsResult.status === "fulfilled" ? normalizeTargetResults(statsResult.value)[0] : null;
  const flights = flightsResult.status === "fulfilled" ? flightsResult.value : null;
  const attacks = attacksResult.status === "fulfilled" ? normalizeAttacks(attacksResult.value) : [];
  const warnings = [...new Set([profileResult, flightsResult, bspResult, attacksResult, usageResult]
    .filter(result => result.status === "rejected")
    .map(result => result.reason.message))];

  renderPlayerDashboardCard(playerId, profile, stats, bspResult.status === "fulfilled" ? bspResult.value : null, flights);
  renderPlayerViewSummary(playerId, profile, stats, bspResult.status === "fulfilled" ? bspResult.value : null, flightsResult);
  renderPlayerUsageSummary(usageResult.status === "fulfilled" ? usageResult.value : null);
  renderPlayerRelations(playerId, attacks);
  renderPlayerFlights(flights, flightsResult);
  setText("playerViewStatus", warnings.length ? `Loaded with limits: ${warnings.join(" | ")}` : "Player loaded.");
}

function loadSelfPlayerView() {
  const id = activePlayerId || String(document.getElementById("playerId")?.innerText || "").match(/\d+/)?.[0];
  if (!id) {
    setText("playerViewStatus", "Your player ID is not loaded yet.");
    return;
  }

  const input = document.getElementById("playerLookupId");
  if (input) input.value = id;
  loadPlayerView();
}

function openPlayerProfile() {
  const playerId = parseTargetIds(document.getElementById("playerLookupId")?.value || "")[0] || activePlayerId;
  if (playerId) openExternalTool(profileUrl(playerId));
}

async function loadPublicPlayerProfile(playerId) {
  try {
    return await getData(tornUrl(2, "/user", {
      selections: "profile",
      id: playerId,
      key: getTornApiKey()
    }));
  } catch (err) {
    try {
      return await getData(tornUrl(2, `/user/${encodeURIComponent(playerId)}`, {
        selections: "profile",
        key: getTornApiKey()
      }));
    } catch (fallbackErr) {
      return getData(tornUrl(1, `/user/${encodeURIComponent(playerId)}`, {
        selections: "profile",
        key: getTornApiKey()
      }));
    }
  }
}

async function loadPlayerUsageInsights(playerId) {
  const now = Math.floor(Date.now() / 1000);
  const monthAgo = now - 30 * 86400;
  const yearAgo = now - 365 * 86400;
  const [current, month, year] = await Promise.all([
    getPlayerHistoricStats(playerId),
    getPlayerHistoricStats(playerId, monthAgo),
    getPlayerHistoricStats(playerId, yearAgo)
  ]);

  return {
    monthXanax: statDelta(current, month, "xantaken"),
    yearXanax: statDelta(current, year, "xantaken"),
    monthRefills: statDelta(current, month, "refills"),
    yearRefills: statDelta(current, year, "refills")
  };
}

function getPlayerHistoricStats(playerId, timestamp) {
  return getData(tornUrl(2, `/user/${encodeURIComponent(playerId)}/personalstats`, {
    stat: "xantaken,refills",
    ...(timestamp ? { timestamp } : {}),
    key: getTornApiKey()
  })).then(normalizeHistoricStats);
}

function normalizeHistoricStats(data) {
  const stats = data?.personalstats;

  if (Array.isArray(stats)) {
    return Object.fromEntries(stats.map(row => [row.name, Number(row.value || 0)]));
  }

  if (!stats || typeof stats !== "object") return {};

  const flattened = {};
  collectPersonalStatValues(stats, flattened);
  return flattened;
}

function collectPersonalStatValues(value, stats) {
  if (!value || typeof value !== "object") return;

  Object.entries(value).forEach(([key, entry]) => {
    if (Number.isFinite(Number(entry))) {
      stats[key] = Number(entry);
      return;
    }

    if (entry && typeof entry === "object" && Number.isFinite(Number(entry.value))) {
      stats[entry.name || key] = Number(entry.value);
      return;
    }

    collectPersonalStatValues(entry, stats);
  });
}

function statDelta(current, prior, name) {
  if (!Number.isFinite(current?.[name]) || !Number.isFinite(prior?.[name])) return null;
  return Math.max(0, current[name] - prior[name]);
}

async function enrichPlayerFactionName(profile) {
  if (!profile?.factionId) return profile;
  if (profile.faction && profile.faction !== "N/A" && !/^Faction\s+\d+$/i.test(profile.faction)) return profile;

  try {
    const data = await getData(tornUrl(2, `/faction/${encodeURIComponent(profile.factionId)}/basic`, { key: getTornApiKey() }));
    const faction = data.basic || data.faction || data;
    return {
      ...profile,
      faction: faction.name || profile.faction
    };
  } catch (err) {
    return profile;
  }
}

function normalizePlayerProfile(data, playerId) {
  const profile = data.profile || data.basic || data;
  const faction = profile.faction && typeof profile.faction === "object" ? profile.faction : {};
  const status = profile.status && typeof profile.status === "object" ? profile.status : {};
  const lastAction = profile.last_action && typeof profile.last_action === "object" ? profile.last_action : {};

  return {
    id: profile.player_id || profile.id || playerId,
    name: profile.name || `Player ${playerId}`,
    image: profile.image || profile.profile_image || profile.avatar || PLACEHOLDER_PFP,
    level: profile.level ?? "-",
    rank: profile.rank || "-",
    age: profile.age || 0,
    awards: profile.awards ?? "-",
    karma: profile.karma ?? "-",
    forumPosts: profile.forum_posts ?? profile.forum_posts_count ?? "-",
    friends: profile.friends ?? 0,
    enemies: profile.enemies ?? 0,
    faction: faction.name || profile.faction_name || faction.faction_name || "N/A",
    factionId: faction.id || faction.faction_id || profile.faction_id || null,
    lastAction: lastAction.relative || lastAction.status || profile.last_action || "-",
    lastActionTimestamp: Number(lastAction.timestamp || profile.last_action_timestamp || 0),
    lastActionStatus: lastAction.status || "",
    status: status.description || status.state || (typeof profile.status === "string" ? profile.status : "-"),
    statusState: status.state || "",
    statusUntil: Number(status.until || 0),
    job: profile.job?.company_name || profile.job?.position || (typeof profile.job === "string" ? profile.job : "-"),
    property: profile.property?.name || (typeof profile.property === "string" ? profile.property : "-")
  };
}

function renderPlayerDashboardCard(playerId, profile, stats, bsp, flights) {
  const estimate = bsp?.tbs_human || stats?.bs_estimate_human || compactNumber(stats?.bs_estimate || stats?.bss_public);
  const profileUrlHtml = `<a href="${profileUrl(playerId)}" target="_blank" rel="noopener">${escapeHtml(profile?.name || `Player ${playerId}`)} [${escapeHtml(playerId)}]</a>`;
  const factionLabel = profile?.faction && profile.faction !== "N/A"
    ? profile.faction
    : profile?.factionId ? `Faction ${profile.factionId}` : "N/A";
  const factionText = profile?.factionId
    ? `<a href="https://www.torn.com/factions.php?step=profile&ID=${encodeURIComponent(profile.factionId)}" target="_blank" rel="noopener">${escapeHtml(factionLabel)} [${escapeHtml(profile.factionId)}]</a>`
    : escapeHtml(factionLabel);
  const currentFlight = flights?.current;
  const flightText = currentFlight?.status_description || "No active flight";

  setHtml("playerDashboardCard", `
    <section class="api-window lookup-dashboard">
      <div class="api-header">
        <span>&gt; EMU PLAYER SCAN</span>
        <div class="window-buttons"><span>-</span><span>x</span></div>
      </div>
      <div class="profile-wrap lookup-profile-wrap">
        <img class="pfp" src="${escapeHtml(profile?.image || PLACEHOLDER_PFP)}" alt="Player profile" onerror="this.src='${PLACEHOLDER_PFP}'" />
        <h2>${profileUrlHtml}</h2>
        <div class="rank-tag">${escapeHtml(profile?.rank || "-")}</div>
        <div class="stats-grid lookup-stats-grid">
          <div class="stat"><span>LEVEL</span><strong>${escapeHtml(profile?.level ?? "-")}</strong></div>
          <div class="stat"><span>AGE</span><strong>${escapeHtml(profile?.age ? `${Math.floor(Number(profile.age) / 365)} years` : "-")}</strong></div>
          <div class="stat"><span>FACTION</span><strong>${factionText}</strong></div>
          <div class="stat"><span>STATUS</span><strong>${escapeHtml(profile?.status || "-")}</strong></div>
          <div class="stat"><span>LAST ACTION</span><strong>${escapeHtml(profile?.lastAction || "-")}</strong></div>
          <div class="stat"><span>FAIR FIGHT</span><strong>${escapeHtml(bsp?.fair_fight ?? stats?.fair_fight ?? "-")}</strong></div>
          <div class="stat"><span>BS ESTIMATE</span><strong>${escapeHtml(estimate)}</strong></div>
          <div class="stat"><span>BSS PUBLIC</span><strong>${escapeHtml(formatNumber(stats?.bss_public))}</strong></div>
          <div class="stat"><span>AWARDS</span><strong>${escapeHtml(profile?.awards ?? "-")}</strong></div>
          <div class="stat"><span>KARMA</span><strong>${escapeHtml(profile?.karma ?? "-")}</strong></div>
          <div class="stat"><span>FORUM</span><strong>${escapeHtml(profile?.forumPosts ?? "-")}</strong></div>
          <div class="stat"><span>FLIGHT</span><strong>${escapeHtml(flightText)}</strong></div>
        </div>
      </div>
    </section>
  `);
}

function renderPlayerViewSummary(playerId, profile, stats, bsp, flightsResult) {
  const latestEstimate = bsp?.tbs_human || stats?.bs_estimate_human || compactNumber(stats?.bs_estimate || stats?.bss_public);
  const factionLabel = profile?.faction && profile.faction !== "N/A"
    ? profile.faction
    : profile?.factionId ? `Faction ${profile.factionId}` : "N/A";
  const cards = [
    ["PLAYER", `${profile?.name || `Player ${playerId}`} [${playerId}]`],
    ["LEVEL", profile?.level ?? "-"],
    ["FACTION", factionLabel],
    ["FAIR FIGHT", bsp?.fair_fight ?? stats?.fair_fight ?? "-"],
    ["LATEST ESTIMATE", latestEstimate],
    ["BSS PUBLIC", formatNumber(stats?.bss_public)],
    ["FALLBACK ESTIMATE", bsp?.tbs_human || "-"],
    ["FALLBACK SCORE", bsp?.score_human || "-"],
    ["PREDICTOR", bsp?.source || "-"],
    ["LAST UPDATED", stats?.last_updated ? formatDateTime(stats.last_updated) : "-"],
    ["FLIGHTS", flightsResult.status === "fulfilled" ? "Loaded" : "Unavailable / Premium"]
  ];

  renderToolCards("playerViewSummary", cards);
}

function renderPlayerUsageSummary(usage) {
  if (!usage) {
    setHtml("playerUsageSummary", emptyMessage("Xanax and refill history unavailable for this profile/key."));
    return;
  }

  renderToolCards("playerUsageSummary", [
    ["XANAX 30D", formatUsageRate(usage.monthXanax, 30)],
    ["XANAX 1Y", formatUsageRate(usage.yearXanax, 365)],
    ["REFILLS 30D", formatUsageRate(usage.monthRefills, 30)],
    ["REFILLS 1Y", formatUsageRate(usage.yearRefills, 365)]
  ]);
}

function formatUsageRate(amount, days) {
  if (!Number.isFinite(amount)) return "Unavailable";
  return `${formatNumber(amount)} | ${(amount / days).toFixed(2)}/day`;
}

function renderPlayerRelations(playerId, attacks) {
  const related = attacks
    .filter(attack => String(attack.attacker.id) === String(playerId) || String(attack.defender.id) === String(playerId))
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, 8);

  const rows = related.map(attack => {
    const theyAttacked = String(attack.attacker.id) === String(playerId);
    const label = theyAttacked ? "THEY ATTACKED" : "WE ATTACKED";
    const other = theyAttacked ? attack.defender : attack.attacker;
    return `
      <div class="intel-row">
        <span>
          ${escapeHtml(label)}: ${attackPlayerLink(other)}
          <small>${escapeHtml(attack.result)}${attack.timestamp ? ` - ${formatDateTime(attack.timestamp)}` : ""}</small>
        </span>
        <span class="badge ${theyAttacked ? "danger" : "good"}">${escapeHtml(label)}</span>
      </div>
    `;
  });

  rows.push(`
    <div class="intel-row">
      <span>
        Mail history
        <small>Torn does not expose arbitrary private mail history through this profile scan.</small>
      </span>
      <span class="badge">LOCKED</span>
    </div>
  `);

  setHtml("playerRelationPanel", rows.join(""));
}

function renderPlayerHistory(historyData) {
  const rows = Array.isArray(historyData?.history) ? historyData.history : [];

  setHtml(
    "playerHistoryTable",
    rows.length
      ? rows.map(entry => `
        <tr>
          <td>${escapeHtml(formatDateTime(entry.timestamp))}</td>
          <td>${escapeHtml(entry.bs_estimate_human || compactNumber(entry.bs_estimate))}</td>
          <td>${escapeHtml(formatNumber(entry.bss_public))}</td>
          <td>${escapeHtml(entry.source || "-")}</td>
        </tr>
      `).join("")
      : emptyTableRow("No history returned.", 4)
  );
}

function renderPlayerFlights(flights, flightsResult) {
  if (flightsResult?.status === "rejected") {
    setHtml("playerFlightsTable", emptyTableRow(flightsResult.reason.message || "Flight data unavailable.", 5));
    return;
  }

  const rows = [];
  if (flights?.current) rows.push({ ...flights.current, trip: "Current" });
  (flights?.recent_flights || []).forEach((flight, index) => rows.push({ ...flight, trip: `Recent ${index + 1}` }));

  setHtml(
    "playerFlightsTable",
    rows.length
      ? rows.map(flight => `
        <tr>
          <td>${escapeHtml(flight.trip)}</td>
          <td>${escapeHtml(flight.travel_method || "-")}</td>
          <td>${escapeHtml(formatDateTime(flight.earliest_arrival_time))}</td>
          <td>${escapeHtml(formatDateTime(flight.latest_arrival_time || flight.approx_landing_time))}</td>
          <td>${escapeHtml(flight.status_description || (flight.book_likely_being_used ? "Book likely active" : "-"))}</td>
        </tr>
      `).join("")
      : emptyTableRow("No flight data returned.", 5)
  );
}

async function loadFactionScout() {
  if (!hasTornApiKey()) {
    setText("factionScoutStatus", "Enter Torn API key in Settings first.");
    return;
  }

  const factionId = parseTargetIds(document.getElementById("scoutFactionId")?.value || "")[0];
  const limit = clampNumber(inputValue("scoutMemberLimit", 100), 1, 100);

  if (!factionId) {
    setText("factionScoutStatus", "Enter a faction ID.");
    return;
  }

  setText("factionScoutStatus", "Loading faction...");
  setHtml("factionScoutSummary", "");
  setHtml("factionActivitySummary", "");
  setHtml("factionScoutMembers", emptyTableRow("Loading members...", 7));

  try {
    const data = await loadFactionScoutData(factionId);
    const faction = data.basic || data.faction || data;
    const members = normalizeMembers(data.members || data.faction?.members || {}).slice(0, limit);
    const withemubs = await enrichMembersWithEmuBs(members);
    const enriched = await enrichMembersWithBSP(withemubs, limit);

    renderFactionScoutSummary(factionId, faction, enriched);
    renderFactionActivitySummary(enriched);
    renderFactionScoutMembers(enriched);
    setText("factionScoutStatus", `${enriched.length} members loaded.`);
  } catch (err) {
    setText("factionScoutStatus", err.message || "Faction scout failed.");
    setHtml("factionScoutMembers", emptyTableRow(err.message || "Faction scout failed.", 7));
  }
}

function loadCurrentFactionScout() {
  if (!activeFactionId) {
    setText("factionScoutStatus", "Current faction ID is not loaded yet.");
    return;
  }

  const input = document.getElementById("scoutFactionId");
  if (input) input.value = activeFactionId;
  loadFactionScout();
}

function loadEnemyFactionScout() {
  if (!activeEnemyId) {
    setText("factionScoutStatus", "No current enemy faction loaded.");
    return;
  }

  const input = document.getElementById("scoutFactionId");
  if (input) input.value = activeEnemyId;
  loadFactionScout();
}

function openFactionProfile() {
  const factionId = parseTargetIds(document.getElementById("scoutFactionId")?.value || "")[0] || activeFactionId;
  if (factionId) openExternalTool(`https://www.torn.com/factions.php?step=profile&ID=${encodeURIComponent(factionId)}`);
}

async function loadFactionScoutData(factionId) {
  const [basicResult, membersResult] = await Promise.allSettled([
    getData(tornUrl(2, `/faction/${encodeURIComponent(factionId)}/basic`, { key: getTornApiKey() })),
    loadFactionMembers(factionId)
  ]);

  if (basicResult.status === "rejected" && membersResult.status === "rejected") {
    throw basicResult.reason;
  }

  const basicData = basicResult.status === "fulfilled" ? basicResult.value : {};
  const membersData = membersResult.status === "fulfilled" ? membersResult.value : {};

  return {
    ...basicData,
    members: membersData.members || membersData.faction?.members || basicData.members || {}
  };
}

async function enrichMembersWithEmuBs(members) {
  const ids = members
    .map(getPlayerId)
    .filter(id => /^\d+$/.test(String(id)))
    .slice(0, 205);

  if (!ids.length) return members;

  try {
    const data = await getEmuBsData("/get-stats", {
      key: getTornApiKey(),
      targets: ids.join(",")
    });
    const statsById = new Map(normalizeArray(data).map(entry => [String(entry.player_id || entry.id), entry]));
    return members.map(member => ({ ...member, emubs: statsById.get(String(getPlayerId(member))) || null }));
  } catch (err) {
    setText("factionScoutStatus", "Faction loaded. Pulling predictor estimates...");
    return members;
  }
}

async function enrichMembersWithBSP(members, limit) {
  const capped = members.slice(0, limit || members.length);
  const enriched = [...members];
  const concurrency = 4;
  let cursor = 0;

  async function worker() {
    while (cursor < capped.length) {
      const index = cursor++;
      const member = capped[index];
      const id = getPlayerId(member);

      if (!/^\d+$/.test(String(id))) continue;

      try {
        const bsp = await getBSPData(id);
        enriched[index] = { ...member, bsp };
      } catch (err) {
        enriched[index] = { ...member, bsp_error: err.message };
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return enriched;
}

function formatMemberEstimate(member) {
  return member.emubs?.bs_estimate_human ||
    member.bsp?.tbs_human ||
    compactNumber(member.emubs?.bs_estimate || member.emubs?.bss_public);
}

function getMemberEstimateValue(member) {
  return parseNumberish(member.emubs?.bs_estimate || member.bsp?.tbs || member.emubs?.bss_public);
}

function renderFactionScoutSummary(factionId, faction, members) {
  const rank = formatFactionRank(faction);
  const knownStats = members
    .map(getMemberEstimateValue)
    .filter(value => value > 0);
  const totalKnown = knownStats.reduce((sum, value) => sum + value, 0);

  renderToolCards("factionScoutSummary", [
    ["FACTION", `${faction.name || `Faction ${factionId}`} [${factionId}]`],
    ["RANK", rank],
    ["RESPECT", formatNumber(faction.respect)],
    ["MEMBERS LOADED", members.length],
    ["KNOWN TOTAL", compactNumber(totalKnown)],
    ["AVG KNOWN", knownStats.length ? compactNumber(totalKnown / knownStats.length) : "-"]
  ]);
}

function renderFactionActivitySummary(members) {
  const now = Math.floor(Date.now() / 1000);
  const buckets = {
    online: members.filter(isOnline).length,
    fifteen: members.filter(member => now - getLastAction(member).timestamp <= 900).length,
    hour: members.filter(member => now - getLastAction(member).timestamp <= 3600).length,
    day: members.filter(member => now - getLastAction(member).timestamp <= 86400).length,
    hospital: members.filter(isHospital).length,
    travelling: members.filter(isTravelling).length
  };

  renderToolCards("factionActivitySummary", [
    ["ONLINE", buckets.online],
    ["15 MIN", buckets.fifteen],
    ["1 HOUR", buckets.hour],
    ["24 HOUR", buckets.day],
    ["HOSPITAL", buckets.hospital],
    ["TRAVEL", buckets.travelling]
  ]);
}

function renderFactionScoutMembers(members) {
  const rows = [...members].sort((a, b) => {
    const aStats = getMemberEstimateValue(a);
    const bStats = getMemberEstimateValue(b);
    return bStats - aStats || Number(b.level || 0) - Number(a.level || 0);
  });

  setHtml(
    "factionScoutMembers",
    rows.length
      ? rows.map(member => {
        const status = getMemberStatus(member);
        const action = getLastAction(member);
        const stats = formatMemberEstimate(member);
        const fairFight = member.emubs?.fair_fight ?? member.bsp?.fair_fight ?? "-";
        return `
          <tr>
            <td>${tableMemberLink(member)}</td>
            <td>${escapeHtml(member.level ?? "-")}</td>
            <td>${escapeHtml(status.state || status.description || action.status || "-")}</td>
            <td>${escapeHtml(fairFight)}</td>
            <td>${stats !== "-" ? `<span class="stat-pill">${escapeHtml(stats)}</span>` : `<span class="muted">-</span>`}</td>
            <td>${escapeHtml(action.relative || (action.timestamp ? formatDateTime(action.timestamp) : "-"))}</td>
            <td>${attackActionLink(member)}</td>
          </tr>
        `;
      }).join("")
      : emptyTableRow("No faction members loaded.", 7)
  );
}

async function loadActiveWars() {
  if (!hasTornApiKey()) {
    setText("activeWarsStatus", "Enter Torn API key in Settings first.");
    return;
  }

  setText("activeWarsStatus", "Loading warfare...");

  const [warsResult, warfareResult] = await Promise.allSettled([
    loadRankedWarsData(),
    loadFactionWarfareData()
  ]);

  if (warsResult.status === "fulfilled") {
    const wars = normalizePublicRankedWars(warsResult.value);
    renderActiveWars(wars);
  } else {
    setHtml("activeWarsTable", emptyTableRow(warsResult.reason.message || "Ranked wars unavailable.", 6));
  }

  if (warfareResult.status === "fulfilled") {
    renderTerritoryAssaults(warfareResult.value);
    renderLiveChains(warfareResult.value);
  } else {
    const message = formatWarfareLimitMessage(warfareResult.reason);
    setHtml("activeTerritoryTable", emptyTableRow(message, 5));
    renderLiveChains({ chain: latestFactionChain, fallbackName: "EMU HQ" });
  }

  const warningCount = [warsResult, warfareResult].filter(result => result.status === "rejected").length;
  setText("activeWarsStatus", warningCount ? "Loaded with dashboard fallback where possible." : "Warfare loaded.");
}

async function loadRankedWarsData() {
  try {
    return await getData(tornUrl(2, "/torn/rankedwars", { key: getTornApiKey() }));
  } catch (err) {
    return getData(tornUrl(1, "/torn/", {
      selections: "rankedwars",
      key: getTornApiKey()
    }));
  }
}

async function loadFactionWarfareData() {
  const [territoryResult, chainsResult, ownChainResult] = await Promise.allSettled([
    getData(tornUrl(2, "/faction/warfare", { cat: "territory", key: getTornApiKey() })),
    getData(tornUrl(2, "/faction/warfare", { cat: "chain", key: getTornApiKey() })),
    getData(tornUrl(2, "/faction", { selections: "chain", key: getTornApiKey() }))
  ]);

  if (territoryResult.status === "rejected" && chainsResult.status === "rejected" && ownChainResult.status === "rejected") {
    throw territoryResult.reason;
  }

  return {
    territorywars: territoryResult.status === "fulfilled" ? territoryResult.value.warfare || [] : [],
    chains: chainsResult.status === "fulfilled" ? chainsResult.value.warfare || [] : [],
    chain: ownChainResult.status === "fulfilled" ? ownChainResult.value.chain || latestFactionChain : latestFactionChain
  };
}

function formatWarfareLimitMessage(reason) {
  const text = String(reason?.message || reason || "Warfare data unavailable.");
  if (/access|permission|key|level|scope/i.test(text)) {
    return "This key cannot read live territory assaults. Ranked wars and dashboard chain fallback are still shown.";
  }
  return text;
}

function normalizePublicRankedWars(data) {
  const raw = data.rankedwars || data.ranked_wars || data.wars || data;
  const entries = Array.isArray(raw) ? raw.map((war, index) => [war.id || index, war]) : Object.entries(raw || {});
  const now = Math.floor(Date.now() / 1000);

  return entries
    .filter(([, war]) => war && typeof war === "object")
    .map(([id, war]) => normalizeWar(id, war, activeFactionId))
    .filter(Boolean)
    .filter(war => !war.finished || war.end >= now - 86400)
    .sort((a, b) => (a.finished - b.finished) || (b.start || 0) - (a.start || 0))
    .slice(0, 50);
}

function renderActiveWars(wars) {
  setHtml(
    "activeWarsTable",
    wars.length
      ? wars.map(war => {
        const now = Math.floor(Date.now() / 1000);
        const status = war.start > now ? "Upcoming" : war.finished ? "Completed" : "Ongoing";
        return `
          <tr>
            <td>${factionProfileLink(war.own)}</td>
            <td>${escapeHtml(formatNumber(war.own?.score))}</td>
            <td>${factionProfileLink(war.enemy)}</td>
            <td>${escapeHtml(formatNumber(war.enemy?.score))}</td>
            <td><span class="status-pill ${status === "Ongoing" ? "status-hosp" : "status-okay"}">${escapeHtml(status)}</span></td>
            <td>${escapeHtml(formatDateTime(war.start))}</td>
          </tr>
        `;
      }).join("")
      : emptyTableRow("No active ranked wars returned.", 6)
  );
}

function renderTerritoryAssaults(data) {
  const wars = normalizeArray(data.warfare?.territory || data.territorywars || data.territory_wars || data.warfare || [])
    .filter(war => war && typeof war === "object")
    .filter(war => !war.result || String(war.result).toLowerCase() === "in_progress")
    .slice(0, 25);

  setHtml(
    "activeTerritoryTable",
    wars.length
      ? wars.map(war => {
        const factions = war.aggressor || war.defender
          ? [normalizeWarFaction(war.aggressor, war.aggressor?.id), normalizeWarFaction(war.defender, war.defender?.id)]
          : normalizeWarFactions(war.factions || war.faction || {});
        return `
          <tr>
            <td>${escapeHtml(war.territory || war.territory_id || war.id || "-")}</td>
            <td>${factionProfileLink(factions[0])}</td>
            <td>${factionProfileLink(factions[1])}</td>
            <td><span class="status-pill status-hosp">${escapeHtml(war.status || war.state || war.result || "Ongoing")}</span></td>
            <td>${escapeHtml(formatDateTime(war.start || war.started || war.timestamp))}</td>
          </tr>
        `;
      }).join("")
      : emptyTableRow("No active territory assaults returned for this key.", 5)
  );
}

function renderLiveChains(data) {
  const rawChains = data.warfare?.chain || data.warfare?.chains || data.chains || data.chain || [];
  const chains = normalizeArray(Array.isArray(rawChains) ? rawChains : [rawChains])
    .filter(chain => chain && typeof chain === "object")
    .slice(0, 25);

  setHtml(
    "liveChainsTable",
    chains.length
      ? chains.map(chain => {
        const faction = chain.faction || chain.faction_id || chain.factionId
          ? { id: chain.faction?.id || chain.faction_id || chain.factionId, name: chain.faction?.name || chain.faction_name || chain.name }
          : activeFactionId ? { id: activeFactionId, name: data.fallbackName || "Our faction" } : null;
        return `
          <tr>
            <td>${faction ? factionProfileLink(faction) : escapeHtml(chain.name || "Our faction")}</td>
            <td>${escapeHtml(formatNumber(chain.current || chain.chain || chain.count || 0))}</td>
            <td>${chain.timeout || chain.cooldown || chain.end ? etaHtml(chain.timeout || chain.cooldown || chain.end, "warning") : `<span class="muted">-</span>`}</td>
            <td>${escapeHtml(formatDateTime(chain.start || chain.started || chain.timestamp))}</td>
            <td><span class="status-pill status-okay">${escapeHtml(chain.state || chain.status || "Live")}</span></td>
          </tr>
        `;
      }).join("")
      : emptyTableRow("No live chains returned for this key.", 5)
  );
}

function normalizeWarFactions(rawFactions) {
  if (Array.isArray(rawFactions)) return rawFactions.map((faction, index) => normalizeWarFaction(faction, index));
  return Object.entries(rawFactions || {}).map(([id, faction]) => normalizeWarFaction(faction, id));
}

function normalizeWarFaction(faction, fallbackId) {
  if (!faction || typeof faction !== "object") return { id: fallbackId, name: `Faction ${fallbackId}` };
  return {
    id: faction.id || faction.ID || faction.faction_id || fallbackId,
    name: faction.name || faction.faction_name || `Faction ${fallbackId}`,
    score: faction.score || faction.points || 0
  };
}

function factionProfileLink(faction) {
  if (!faction?.id) return escapeHtml(faction?.name || "Unknown");
  return `<a href="https://www.torn.com/factions.php?step=profile&ID=${encodeURIComponent(faction.id)}" target="_blank" rel="noopener">${escapeHtml(faction.name || `Faction ${faction.id}`)} [${escapeHtml(faction.id)}]</a>`;
}

function renderToolCards(targetId, cards) {
  setHtml(
    targetId,
    `<div class="tool-card-grid">${cards.map(([label, value]) => `
      <div class="tool-card">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value ?? "-")}</strong>
      </div>
    `).join("")}</div>`
  );
}

function openExternalTool(url) {
  window.open(url, "_blank", "noopener");
}

function normalizeArray(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.targets)) return data.targets;
  if (data && typeof data === "object") return Object.values(data).filter(value => value && typeof value === "object");
  return [];
}

function inputValue(id, fallback) {
  const value = document.getElementById(id)?.value;
  return value === undefined || value === "" ? fallback : value;
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function parseNumberish(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;

  const match = value.trim().replaceAll(",", "").match(/^([\d.]+)\s*([kmbt])?$/i);
  if (!match) return 0;

  const multipliers = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };
  return Number(match[1]) * (multipliers[match[2]?.toLowerCase()] || 1);
}

function renderChainPanel(chain) {
  const current = chain.current ?? chain.chain ?? 0;
  const max = chain.max ?? chain.maximum ?? chain.best ?? "-";
  const timeout = chain.timeout || chain.cooldown || 0;

  setHtml("chainPanel", `
    <p>CURRENT: <span>${formatNumber(current)}</span></p>
    <p>MAX: <span>${formatNumber(max)}</span></p>
    <p>TIMEOUT: <span>${timeout ? formatCountdown(timeout) : "-"}</span></p>
  `);
}

function formatNumber(value) {
  if (value === undefined || value === null || value === "") return "-";
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : String(value);
}

function compactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";

  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2
  }).format(number);
}

function formatBattleStats(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "-";

  const parts = Math.floor(number).toLocaleString("en-US").split(",");
  let prefix = parts[0];

  if (number < 1000) return String(number);
  if (Number(prefix) < 10 && parts[1]?.[0] && parts[1][0] !== "0") {
    prefix += `.${parts[1][0]}`;
  }

  const suffixes = ["", "k", "m", "b", "t", "q"];
  return `${prefix}${suffixes[parts.length - 1] || ""}`;
}

function formatCountdown(unixSeconds) {
  const seconds = Math.max(0, Number(unixSeconds) - Math.floor(Date.now() / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (!seconds) return "Back now";
  if (days) return `${days}d ${hours}h ${minutes}m`;
  return `${hours}h ${minutes}m ${secs}s`;
}

function formatTravelEta(estimates) {
  if (!estimates?.airstrip || !estimates?.standard) return "-";

  return `PI ${formatCountdown(estimates.airstrip)} / Std ${formatCountdown(estimates.standard)}`;
}

function updateCountdowns() {
  document.querySelectorAll("[data-countdown-until]").forEach(el => {
    el.innerText = formatCountdown(el.dataset.countdownUntil);
  });
  document.querySelectorAll("[data-pi-until][data-standard-until]").forEach(el => {
    el.innerText = formatTravelEta({
      airstrip: Number(el.dataset.piUntil),
      standard: Number(el.dataset.standardUntil)
    });
  });
}

function formatDateTime(unixSeconds) {
  if (!unixSeconds) return "-";
  return new Date(Number(unixSeconds) * 1000).toLocaleString();
}

function formatAgeFromUnix(unixSeconds) {
  const timestamp = Number(unixSeconds);
  if (!timestamp) return "-";

  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - timestamp));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days >= 1) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (hours >= 1) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  if (minutes >= 1) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  return "just now";
}

function formatElapsed(milliseconds) {
  const seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours) return `${hours}h ${minutes % 60}m`;
  if (minutes) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function emptyMessage(message) {
  return `<p class="muted">${escapeHtml(message)}</p>`;
}

function emptyTableRow(message, colspan) {
  return `<tr><td colspan="${colspan || 1}" class="muted">${escapeHtml(message)}</td></tr>`;
}

function updateClock() {
  const now = new Date();
  setText("clock", now.toLocaleTimeString());
  setText("date", now.toLocaleDateString());
}

function init() {
  window.EMU_TERMINAL_BUILD = BUILD_VERSION;

  const keyInput = document.getElementById("apiKey");
  if (keyInput && apiKey) keyInput.value = apiKey;
  keyInput?.addEventListener("keydown", event => {
    if (event.key === "Enter") saveKey();
  });
  document.getElementById("targetUseFF")?.addEventListener("change", syncTargetSearchModes);
  document.getElementById("targetUseStats")?.addEventListener("change", syncTargetSearchModes);

  updateClock();
  updateCountdowns();
  setTargetPreset(targetPreset);
  setWarSortMode(warSortMode);
  setWarView(warView);
  setMemberView(memberView);
  setQuickStrikeView(quickStrikeView);
  syncAccessState();

  if (!hasTornApiKey()) {
    showPage("settings");
    setText("status", "Enter Torn API key to unlock terminal.");
  } else {
    showPage("dashboard", document.querySelector(".link-btn"));
  }

  loadAllData();

  setInterval(updateClock, 1000);
  setInterval(updateCountdowns, 1000);
  setInterval(loadAllData, POLL_INTERVAL_MS);
}

Object.assign(window, {
  showPage,
  saveKey,
  setTargetPreset,
  setTargetStatsPreset,
  syncTargetSearchModes,
  changeTargetPage,
  setWarSortMode,
  setWarView,
  setMemberView,
  setQuickStrikeView,
  searchTargets,
  copyTargetIds,
  searchRecruiter,
  copyRecruitIds,
  loadPlayerView,
  loadSelfPlayerView,
  openPlayerProfile,
  loadFactionScout,
  loadCurrentFactionScout,
  loadEnemyFactionScout,
  openFactionProfile,
  loadActiveWars,
  openExternalTool,
  refreshWarTools
});

init();


