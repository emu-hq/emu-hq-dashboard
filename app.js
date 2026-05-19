const TORN_API_V1 = "https://api.torn.com";
const TORN_API_V2 = "https://api.torn.com/v2";
const TORNSTATS_API = "https://www.tornstats.com/api/v2";
const DEFAULT_TORNSTATS_API_KEY = "TS_xadoL6TlERDZo35O";
const BUILD_VERSION = "2026-05-19-github-pages-1";
const POLL_INTERVAL_MS = 30000;
const TORNSTATS_INTERVAL_MS = 120000;
const PLACEHOLDER_PFP = "https://i.gyazo.com/a5da16009ce26825695c7e165fb03aab.png";

let apiKey = localStorage.getItem("tornApiKey") || "";
let tornStatsApiKey = getStoredTornStatsKey();
let loadSequence = 0;
let activeFactionId = null;
let activeEnemyId = null;
let lastTornStatsFetch = 0;

function getStoredTornStatsKey() {
  const storedKey = localStorage.getItem("tornStatsApiKey") || "";
  return storedKey.startsWith("TS_") ? storedKey : DEFAULT_TORNSTATS_API_KEY;
}

function showPage(pageId, button) {
  if (!apiKey && pageId !== "settings") {
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
  apiKey = document.getElementById("apiKey").value.trim();
  tornStatsApiKey = document.getElementById("tornStatsApiKey")?.value.trim() || DEFAULT_TORNSTATS_API_KEY;
  localStorage.setItem("tornApiKey", apiKey);
  localStorage.setItem("tornStatsApiKey", tornStatsApiKey);
  lastTornStatsFetch = 0;
  setText("factionBattleStats", "Loading...");
  setText("status", "Connecting...");
  syncAccessState();
  loadAllData();
}

function syncAccessState() {
  const locked = !apiKey;
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
    showPage("settings");
    syncAccessState();
    return;
  }

  setText("status", "Connecting...");

  const requests = [
    loadUserData(),
    loadFactionData(),
    getData(tornUrl(2, "/faction", { selections: "rankedwars", key: apiKey })),
    loadFactionAttacksData()
  ];

  const [userResult, factionResult, warsResult, attacksResult] =
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

  await loadAndRenderTornStats(factionState);

  setText(
    "status",
    connected
      ? warnings.length ? `Connected with limits: ${warnings.join(" | ")}` : "Connected successfully."
      : `Connection failed: ${warnings.join(" | ")}`
  );

  syncAccessState();

  if (connected && document.getElementById("settings")?.classList.contains("active-page")) {
    const dashboardButton = document.querySelector(".link-btn");
    showPage("dashboard", dashboardButton);
  }
}

async function loadUserData() {
  try {
    return await getData(tornUrl(2, "/user", { selections: "profile,bars", key: apiKey }));
  } catch (err) {
    return getData(tornUrl(1, "/user/", { selections: "profile,bars", key: apiKey }));
  }
}

async function loadFactionData() {
  const [combinedResult, basicResult] = await Promise.allSettled([
    getData(tornUrl(2, "/faction", { selections: "basic,members,chain", key: apiKey })),
    getData(tornUrl(2, "/faction/basic", { key: apiKey }))
  ]);

  if (combinedResult.status === "rejected" && basicResult.status === "rejected") {
    throw combinedResult.reason;
  }

  const combined = combinedResult.status === "fulfilled" ? combinedResult.value : {};
  const basic = basicResult.status === "fulfilled" ? basicResult.value.basic : combined.basic;

  return {
    ...combined,
    basic: basic || combined.basic
  };
}

function loadFactionAttacksData() {
  return getData(tornUrl(2, "/faction/attacks", {
    limit: "20",
    sort: "DESC",
    key: apiKey
  }));
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
    pfp.src = profile.image || profile.profile_image || user.profile_image || user.image || PLACEHOLDER_PFP;
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
  const id = member.id || member.player_id || member.ID;
  const label = `${member.name || "Unknown"}${id ? ` [${id}]` : ""}`;

  if (!id || String(id).startsWith("stealth")) {
    return escapeHtml(label);
  }

  return `<a href="https://www.torn.com/profiles.php?XID=${encodeURIComponent(id)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
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
    setHtml("warOverview", emptyMessage("No ranked war found."));
    setHtml("enemyHospitalList", emptyMessage("No enemy faction selected."));
    setHtml("enemyTravelList", emptyMessage("No enemy faction selected."));
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
    setHtml("enemyTravelList", emptyMessage("No active or matched enemy faction."));
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
    const data = await loadFactionMembers(enemyId);

    if (String(enemyId) !== String(activeEnemyId)) return;

    const members = normalizeMembers(data.members || data.faction?.members || data);
    renderEnemyHospital(members);
    renderEnemyTravel(members);
  } catch (err) {
    setHtml("enemyHospitalList", emptyMessage(`Enemy status unavailable: ${err.message}`));
    setHtml("enemyTravelList", emptyMessage(`Enemy travel unavailable: ${err.message}`));
  }
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

function renderEnemyTravel(members) {
  const travellers = sortByUntil(members.filter(isTravelling));

  setHtml(
    "enemyTravelList",
    travellers.length
      ? travellers.map(member => travelRow(member)).join("")
      : emptyMessage("No enemy members travelling.")
  );
}

function travelRow(member) {
  const status = getMemberStatus(member);
  const description = status.description || status.state || "Travelling";
  const details = status.details && status.details !== description
    ? ` - ${status.details}`
    : "";
  const eta = status.until
    ? `<span class="countdown warning" data-countdown-until="${status.until}">${formatCountdown(status.until)}</span>`
    : `<span class="muted">No ETA</span>`;

  return `
    <div class="intel-row">
      <span>
        ${memberLink(member)}
        <small>${escapeHtml(description + details)}</small>
      </span>
      ${eta}
    </div>
  `;
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
    .slice(0, 10);

  setHtml(
    "recentAttacks",
    attacks.length
      ? attacks.map(attack => attackRow(attack, factionId || activeFactionId)).join("")
      : emptyMessage("No recent attacks found.")
  );
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

async function loadAndRenderTornStats(factionState) {
  if (Date.now() - lastTornStatsFetch < TORNSTATS_INTERVAL_MS) return;

  const key = tornStatsApiKey || DEFAULT_TORNSTATS_API_KEY;
  const factionId = factionState?.factionId || activeFactionId;

  if (!key) {
    setText("factionBattleStats", "Add TornStats key");
    return;
  }

  lastTornStatsFetch = Date.now();

  try {
    const roster = await loadTornStatsRoster(key);
    renderTornStats(roster, factionState?.members || []);
    return;
  } catch (rosterErr) {
    if (!factionId) {
      setText("factionBattleStats", "No faction ID");
      return;
    }

    try {
      const factionSpy = await loadTornStatsFactionSpy(key, factionId);
      renderTornStats(factionSpy, factionState?.members || []);
    } catch (spyErr) {
      setText("factionBattleStats", "TornStats unavailable");
      console.warn("TornStats failed", rosterErr, spyErr);
    }
  }
}

function loadTornStatsRoster(key) {
  return getTornStatsData(`${TORNSTATS_API}/${encodeURIComponent(key)}/faction/roster`);
}

function loadTornStatsFactionSpy(key, factionId) {
  return getTornStatsData(`${TORNSTATS_API}/${encodeURIComponent(key)}/spy/faction/${encodeURIComponent(factionId)}`);
}

function renderTornStats(data, factionMembers) {
  const roster = findRosterMembers(data);
  const totals = roster
    .map(member => battleStatsTotal(member))
    .filter(total => total > 0);
  const factionMemberCount = factionMembers.length || roster.length;

  if (!totals.length) {
    setText("factionBattleStats", "No TornStats data");
    return;
  }

  const sum = totals.reduce((total, value) => total + value, 0);
  setText("factionBattleStats", compactNumber(sum));
}

function findRosterMembers(data) {
  const candidates = [
    data?.faction?.members,
    data?.faction?.roster,
    data?.members,
    data?.roster,
    data?.data?.members,
    data?.data?.roster
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === "object") return Object.values(candidate);
  }

  return [];
}

function battleStatsTotal(member) {
  const direct = [
    member.total,
    member.total_battlestats,
    member.total_battle_stats,
    member.battlestats,
    member.battle_stats_total,
    member.spy?.total,
    member.stats?.total
  ].map(parseNumberish).find(value => value > 0);

  if (direct) return direct;

  const stats = member.battle_stats || member.battlestats_data || member.stats || {};
  const totalFromParts = ["strength", "defense", "speed", "dexterity", "defence"]
    .map(key => parseNumberish(stats[key]))
    .reduce((total, value) => total + value, 0);

  return totalFromParts;
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

function updateCountdowns() {
  document.querySelectorAll("[data-countdown-until]").forEach(el => {
    el.innerText = formatCountdown(el.dataset.countdownUntil);
  });
}

function formatDateTime(unixSeconds) {
  if (!unixSeconds) return "-";
  return new Date(Number(unixSeconds) * 1000).toLocaleString();
}

function emptyMessage(message) {
  return `<p class="muted">${escapeHtml(message)}</p>`;
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
  const tornStatsKeyInput = document.getElementById("tornStatsApiKey");
  if (tornStatsKeyInput && tornStatsApiKey) tornStatsKeyInput.value = tornStatsApiKey;

  updateClock();
  updateCountdowns();
  syncAccessState();

  if (!apiKey) {
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

init();
