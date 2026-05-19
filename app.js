const TORN_API_V1 = "https://api.torn.com";
const TORN_API_V2 = "https://api.torn.com/v2";
const TORNSTATS_API = "https://www.tornstats.com/api/v2";
const POLL_INTERVAL_MS = 30000;
const TORNSTATS_INTERVAL_MS = 120000;
const PLACEHOLDER_PFP = "https://i.gyazo.com/a5da16009ce26825695c7e165fb03aab.png";

let apiKey = localStorage.getItem("tornApiKey") || "";
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
  localStorage.setItem("tornApiKey", apiKey);
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

function formatApiError(data) {
  const error = data?.error || data;
  return error?.error || error?.message || error?.reason || "API error";
}

async function loadAllData() {
  const sequence = ++loadSequence;

  if (!apiKey) {
    setText("status", "Enter API key.");
    setText("factionBattleStats", "TornStats pending");
    return;
  }

  setText("status", "Connecting...");

  const requests = [
    getData(tornUrl(1, "/user/", { selections: "profile,bars", key: apiKey })),
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
    setText("factionAvgBattleStats", "-");
    setText("battleStatsCoverage", tornStatsResult.reason.message);
  }

  setText(
    "status",
    connected
      ? warnings.length ? `Connected with limits: ${warnings.join(" | ")}` : "Connected successfully."
      : `Connection failed: ${warnings.join(" | ")}`
  );
}

function loadUser(user) {
  setText("playerName", user.name ?? "Unknown");
  setText("playerId", `[${user.player_id ?? user.id ?? "?"}]`);
  setText("playerRank", user.rank ?? "-");
  setText("playerLevel", user.level ?? "-");

  const age = Number(user.age || 0);
  setText("playerAge", age ? `${Math.floor(age / 365)} years` : "-");

  const lvlDay = age && user.level
    ? (Number(user.level) / age).toFixed(3)
    : "-";

  setText("levelDay", lvlDay);
  setText("frenemiesValue", `+${user.friends ?? 0} / ${user.enemies ?? 0}`);
  setText("honorValue", user.honor ?? "-");
  setText("awardsValue", user.awards ?? "-");
  setText("karmaValue", user.karma ?? "-");
  setText("forumValue", user.forum_posts ?? "-");

  const energy = user.energy || user.bars?.energy;
  const nerve = user.nerve || user.bars?.nerve;

  setText("energyValue", formatBar(energy));
  setText("nerveValue", formatBar(nerve));
  setText("energyAlert", formatEnergyAlert(energy));

  const pfp = document.getElementById("playerPfp");
  if (pfp) {
    pfp.src = user.profile_image || PLACEHOLDER_PFP;
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

function formatEnergyAlert(energy) {
  if (!energy || typeof energy !== "object") return "Unavailable";

  const current = Number(energy.current ?? energy.value ?? 0);
  const maximum = Number(energy.maximum ?? energy.max ?? 0);

  if (!maximum) return "Unavailable";
  if (current >= maximum) return "Full";

  return `${current}/${maximum}`;
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
  setText("factionPower", formatFactionRank(faction));

  const chainCurrent = chain.current ?? chain.chain ?? 0;
  setText("chainValue", formatNumber(chainCurrent));
  setText("chainAlert", chainCurrent ? `${formatNumber(chainCurrent)} active` : "No active chain");
  renderChainPanel(chain);

  renderOnlineMembers(members);
  renderOwnHospital(members);

  return { faction, factionId: activeFactionId, members, chain };
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

  const name = rank.name || rank.title || rank.level || faction.rank_name || faction.rank;
  const division = rank.division || rank.tier || faction.division || faction.rank_division;

  if (!name && !division) return "-";

  return [titleCase(name), division].filter(Boolean).join(" ");
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
  const state = status.state || status.type || member.state || "";
  const until = Number(status.until || status.until_timestamp || status.ends || member.until || 0);

  return { description, state, until };
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
  const countdown = status.until
    ? `<span class="countdown danger" data-countdown-until="${status.until}">${formatCountdown(status.until)}</span>`
    : `<span class="muted">No ETA</span>`;

  return `
    <div class="intel-row">
      <span>
        ${memberLink(member)}
        <small>${escapeHtml(description)}</small>
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

  if (activeEnemyId) {
    loadEnemyFaction(activeEnemyId);
  } else {
    setHtml("enemyHospitalList", emptyMessage("Enemy faction id unavailable."));
    setHtml("enemyTravelList", emptyMessage("Enemy faction id unavailable."));
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
    const data = await getData(tornUrl(2, "/faction", {
      selections: "basic,members",
      id: enemyId,
      key: apiKey
    }));

    if (String(enemyId) !== String(activeEnemyId)) return;

    const members = normalizeMembers(data.members || data.faction?.members || {});
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
  const eta = status.until
    ? `<span class="countdown warning" data-countdown-until="${status.until}">${formatCountdown(status.until)}</span>`
    : `<span class="muted">No ETA</span>`;

  return `
    <div class="intel-row">
      <span>
        ${memberLink(member)}
        <small>${escapeHtml(description)}</small>
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

async function loadTornStatsRoster() {
  if (Date.now() - lastTornStatsFetch < TORNSTATS_INTERVAL_MS) return null;

  lastTornStatsFetch = Date.now();
  return getData(`${TORNSTATS_API}/${encodeURIComponent(apiKey)}/faction/roster`);
}

function renderTornStats(data, factionMembers) {
  const roster = findRosterMembers(data);
  const totals = roster
    .map(member => battleStatsTotal(member))
    .filter(total => total > 0);
  const factionMemberCount = factionMembers.length || roster.length;

  if (!totals.length) {
    setText("factionBattleStats", "No TornStats data");
    setText("factionAvgBattleStats", "-");
    setText("battleStatsCoverage", `0/${factionMemberCount || 0}`);
    return;
  }

  const sum = totals.reduce((total, value) => total + value, 0);
  const average = Math.round(sum / totals.length);

  setText("factionBattleStats", compactNumber(sum));
  setText("factionAvgBattleStats", compactNumber(average));
  setText("battleStatsCoverage", `${totals.length}/${factionMemberCount || totals.length}`);
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
  const keyInput = document.getElementById("apiKey");
  if (keyInput && apiKey) keyInput.value = apiKey;

  updateClock();
  updateCountdowns();
  loadAllData();

  setInterval(updateClock, 1000);
  setInterval(updateCountdowns, 1000);
  setInterval(loadAllData, POLL_INTERVAL_MS);
}

init();
