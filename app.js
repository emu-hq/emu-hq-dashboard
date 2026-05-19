const TORN_API_V1 = "https://api.torn.com";
const TORN_API_V2 = "https://api.torn.com/v2";
const TORNSTATS_API = "https://www.tornstats.com/api/v2";
const POLL_INTERVAL_MS = 30000;
const TORNSTATS_INTERVAL_MS = 120000;
const PLACEHOLDER_PFP = "https://i.gyazo.com/a5da16009ce26825695c7e165fb03aab.png";

let apiKey = localStorage.getItem("tornApiKey") || "";
let tornStatsApiKey = localStorage.getItem("tornStatsApiKey") || "";
let loadSequence = 0;
let activeFactionId = null;
let activeEnemyId = null;
let lastTornStatsFetch = 0;

function showPage(pageId, button) {
  document.querySelectorAll(".page").forEach(page => page.classList.remove("active-page"));
  document.querySelectorAll(".link-btn").forEach(tab => tab.classList.remove("active"));

  document.getElementById(pageId)?.classList.add("active-page");
  button?.classList.add("active");
}

function saveKey() {
  apiKey = document.getElementById("apiKey").value.trim();
  tornStatsApiKey = document.getElementById("tornStatsApiKey")?.value.trim() || "";
  localStorage.setItem("tornApiKey", apiKey);
  localStorage.setItem("tornStatsApiKey", tornStatsApiKey);
  lastTornStatsFetch = 0;
  setText("factionBattleStats", "Loading...");
  setText("status", "Connecting...");
  loadAllData();
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
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function tornUrl(version, path, params) {
  const base = version === 1 ? TORN_API_V1 : TORN_API_V2;
  const search = new URLSearchParams(params);
  return `${base}${path}?${search.toString()}`;
}

async function getData(url) {
  const response = await fetch(url);
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

async function getTornStatsData(url) {
  const data = await getData(url);

  if (data?.status === false) {
    throw new Error(data.message || "TornStats request failed");
  }

  return data;
}

function formatApiError(data) {
  const error = data?.error || data;
  return error?.error || error?.message || error?.reason || "API error";
}

async function loadAllData() {
  const sequence = ++loadSequence;

  if (!apiKey) {
    setText("status", "Enter API key.");
    renderNoKeyState();
    return;
  }

  setText("status", "Connecting...");

  const requests = [
    loadUserData(),
    getData(tornUrl(2, "/faction", { selections: "basic,members,chain", key: apiKey })),
    getData(tornUrl(2, "/faction", { selections: "rankedwars", key: apiKey })),
    getData(tornUrl(2, "/faction", { selections: "attacks", limit: "20", sort: "DESC", key: apiKey })),
    loadTornStatsRoster()
  ];

  const [userResult, factionResult, warsResult, attacksResult, tornStatsResult] =
    await Promise.allSettled(requests);

  if (sequence !== loadSequence) return;

  const warnings = [];
  let factionState = null;
  let connected = false;

  if (userResult.status === "fulfilled") {
    loadUser(userResult.value);
    connected = true;
  } else {
    warnings.push(`user: ${userResult.reason.message}`);
  }

  if (factionResult.status === "fulfilled") {
    factionState = loadFaction(factionResult.value);
    connected = true;

    if (factionState?.factionId) {
      try {
        const memberData = await loadFactionMembers(factionState.factionId);
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
  }

  if (tornStatsResult.status === "fulfilled" && tornStatsResult.value) {
    renderTornStats(tornStatsResult.value, factionState?.members || []);
  } else if (tornStatsResult.status === "rejected") {
    setText("factionBattleStats", "TornStats unavailable");
  }

  setText(
    "status",
    connected
      ? warnings.length ? `Connected with limits: ${warnings.join(" | ")}` : "Connected successfully."
      : `Connection failed: ${warnings.join(" | ")}`
  );
}

async function loadUserData() {
  try {
    return await getData(tornUrl(2, "/user", { selections: "profile,bars", key: apiKey }));
  } catch (err) {
    return getData(tornUrl(1, "/user/", { selections: "profile,bars", key: apiKey }));
  }
}

function renderNoKeyState() {
  setText("factionName", "Enter API key");
  setText("factionRank", "-");
  setText("factionRespect", "-");
  setText("factionMembers", "-");
  setText("factionBattleStats", "Add TornStats key");
  setText("warStatus", "Enter API key");
  setText("warTimer", "No active war");
  setText("chainValue", "-");
  setText("chainAlert", "Enter API key");
  setHtml("onlineMembers", emptyMessage("Enter API key in Settings."));
  setHtml("onlineMembersSide", emptyMessage("Enter API key in Settings."));
  setHtml("hospitalMembers", emptyMessage("Enter API key in Settings."));
  setHtml("warOverview", emptyMessage("Enter API key in Settings."));
  setHtml("enemyHospitalList", emptyMessage("Enter API key in Settings."));
  setHtml("enemyTravelList", emptyMessage("Enter API key in Settings."));
  setHtml("recentAttacks", emptyMessage("Enter API key in Settings."));
  setHtml("chainPanel", emptyMessage("Enter API key in Settings."));
}

function loadUser(user) {
  const profile = user.profile || user.basic || user;
  const bars = user.bars || profile.bars || {};

  setText("playerName", profile.name ?? "Unknown");
  setText("playerId", `[${profile.player_id ?? profile.id ?? user.player_id ?? user.id ?? "?"}]`);
  setText("playerRank", profile.rank ?? user.rank ?? "-");
  setText("playerLevel", profile.level ?? user.level ?? "-");

  const age = Number(profile.age || user.age || 0);
  setText("playerAge", age ? `${Math.floor(age / 365)} years` : "-");

  const level = Number(profile.level || user.level || 0);
  const lvlDay = age && level
    ? (level / age).toFixed(3)
    : "-";

  setText("levelDay", lvlDay);
  setText("frenemiesValue", `+${profile.friends ?? user.friends ?? 0} / ${profile.enemies ?? user.enemies ?? 0}`);
  setText("honorValue", profile.honor ?? user.honor ?? "-");
  setText("awardsValue", profile.awards ?? user.awards ?? "-");
  setText("karmaValue", profile.karma ?? user.karma ?? "-");
  setText("forumValue", profile.forum_posts ?? user.forum_posts ?? "-");

  const energy = bars.energy || user.energy || profile.energy;
  const nerve = bars.nerve || user.nerve || profile.nerve;

  setText("energyValue", formatBar(energy));
  setText("nerveValue", formatBar(nerve));

  const pfp = document.getElementById("playerPfp");
  if (pfp) {
    pfp.src = profile.profile_image || user.profile_image || PLACEHOLDER_PFP;
    pfp.onerror = function () {
      pfp.src = PLACEHOLDER_PFP;
    };
  }
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

  setText("factionName", faction.name ?? "-");
  setText("factionRank", formatRankPosition(faction));
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
  return getData(tornUrl(2, `/faction/${encodeURIComponent(factionId)}/members`, { key: apiKey }));
}

function renderFactionMembers(members) {
  setText("factionMembers", `${members.length || "-"}`);
  renderOnlineMembers(members);
  renderOwnHospital(members);
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

  if (!name && division === undefined) return "-";

  return [titleCase(name), division].filter(value => value !== undefined && value !== null && value !== "").join(" ");
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

function renderOwnHospital(members) {
  const hospital = sortByUntil(members.filter(isHospital));

  setText("hospitalCount", `${hospital.length}`);
  setHtml(
    "hospitalMembers",
    hospital.length
      ? hospital.map(member => hospitalRow(member)).join("")
      : emptyMessage("No faction members in hospital.")
  );
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
  const sub
