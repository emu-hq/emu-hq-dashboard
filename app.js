const API = "https://api.torn.com/v2";
let apiKey = localStorage.getItem("tornApiKey") || "";
let warInterval = null;

function showTab(tabName, button) {
  document.querySelectorAll(".tab-page").forEach(page => {
    page.classList.remove("active-page");
  });

  document.querySelectorAll("nav button").forEach(btn => {
    btn.classList.remove("active");
  });

  document.getElementById(tabName).classList.add("active-page");
  button.classList.add("active");
}

function saveKey() {
  apiKey = document.getElementById("apiKey").value.trim();
  localStorage.setItem("tornApiKey", apiKey);
  setText("status", "API key saved. Loading live data...");
  loadAllData();
}

async function tornFetch(path) {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`${API}${path}${separator}key=${apiKey}`);
  const data = await response.json();

  if (data.error) {
    throw new Error(data.error.error || data.error.message || JSON.stringify(data.error));
  }

  return data;
}

async function loadAllData() {
  if (!apiKey) {
    setText("status", "Enter API key in Settings.");
    return;
  }

  try {
    await loadUser();
    await loadFaction();

    setText("status", "Live data loaded.");
  } catch (error) {
    console.error(error);
    setText("status", "API error: " + error.message);
  }
}

async function loadUser() {
  const user = await tornFetch("/user?selections=basic,profile,bars");

  const name = user.name || "Unknown";
  const id = user.player_id || user.id || "?";
  const level = user.level || "-";
  const status = user.status?.description || user.status?.state || "-";
  const rank = user.rank || user.role || "Agent";

  setText("playerName", name);
  setText("playerId", `[${id}]`);
  setText("playerLevel", level);
  setText("playerStatus", status);
  setText("playerRank", rank);

  const energy = user.energy
    ? `${user.energy.current} / ${user.energy.maximum}`
    : "-";

  setText("energyValue", energy);
  setText("energyAlert", energy);

  if (user.profile_image) {
    const img = document.getElementById("playerPfp");
    if (img) img.src = user.profile_image;
  }
}

async function loadFaction() {
  const faction = await tornFetch("/faction?selections=basic,members,chain,wars,territory");

  const name = faction.name || "Unknown";
  const respect = Number(faction.respect || 0).toLocaleString();
  const capacity = faction.capacity || "?";

  const membersRaw = faction.members || {};
  const members = Array.isArray(membersRaw)
    ? membersRaw
    : Object.values(membersRaw);

  const memberCount = members.length;

  const chain =
    faction.chain?.current ||
    faction.chain?.counter ||
    faction.chain ||
    0;

  setText("factionName", name);
  setText("dashFaction", name);
  setText("factionRespect", respect);
  setText("dashRespect", respect);
  setText("factionMembers", `${memberCount} / ${capacity}`);
  setText("chainValue", chain);
  setText("chainValue2", chain);
  setText("dashChain", chain);
  setText("chainAlert", chain);

  setText("factionRank", faction.rank || "#?");
  setText("factionPower", faction.power || faction.best_chain || "-");

  loadMembers(members);
  loadOnlineMembers(members);
  loadHospital(members);
  loadWar(faction);
  loadTerritory(faction);
}

function loadMembers(members) {
  const box = document.getElementById("memberList");
  if (!box) return;

  if (!members.length) {
    box.innerHTML = "<p>No members found.</p>";
    return;
  }

  box.innerHTML = members
    .slice(0, 40)
    .map(member => {
      const name = member.name || "Unknown";
      const status = member.status?.description || member.status?.state || "-";
      const online = member.last_action?.status || "-";

      return `<p>${name} - ${online} - ${status}</p>`;
    })
    .join("");
}

function loadOnlineMembers(members) {
  const online = members.filter(member =>
    String(member.last_action?.status || "").toLowerCase() === "online"
  );

  const box = document.getElementById("onlineMembers");
  if (!box) return;

  box.innerHTML = online.length
    ? online.map(member => `<p>${member.name} - Online</p>`).join("")
    : "<p>No members online.</p>";
}

function loadHospital(members) {
  const hospitalCount = members.filter(member => {
    const state = String(member.status?.state || "").toLowerCase();
    const desc = String(member.status?.description || "").toLowerCase();

    return state.includes("hospital") || desc.includes("hospital");
  }).length;

  setText("hospitalAlert", hospitalCount);
  setText("hospitalAlert2", hospitalCount);
}

function loadWar(faction) {
  let warStatus = "No active war";
  let startTime = null;

  const wars = faction.wars || faction.ranked_wars || faction.territory_wars || [];

  if (Array.isArray(wars) && wars.length) {
    const war = wars[0];

    warStatus = war.status || war.state || "War found";
    startTime = war.start || war.start_time || war.startTime || null;
  }

  setText("warStatus", warStatus);
  setText("warStatus2", warStatus);

  if (!startTime) {
    setText("warStart", "No upcoming war");
    setText("warTimer", "No upcoming war");
    setText("warTimer2", "No upcoming war");
    return;
  }

  const startMs = Number(startTime) * 1000;
  const startDate = new Date(startMs);

  setText("warStart", startDate.toLocaleString());

  if (warInterval) clearInterval(warInterval);

  function tick() {
    const diff = startMs - Date.now();

    if (diff <= 0) {
      setText("warTimer", "WAR LIVE");
      setText("warTimer2", "WAR LIVE");
      return;
    }

    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);

    const text = `${d}d ${h}h ${m}m ${s}s`;

    setText("warTimer", text);
    setText("warTimer2", text);
  }

  tick();
  warInterval = setInterval(tick, 1000);
}

function loadTerritory(faction) {
  const territory = faction.territory || {};
  const tiles = Array.isArray(territory) ? territory : Object.values(territory);

  const underAttack = tiles.some(tile =>
    tile.war ||
    tile.assault ||
    tile.attacking_faction ||
    tile.defending_faction
  );

  const text = underAttack ? "UNDER ATTACK" : "Clear";

  setText("territoryAlert", text);
  setText("territoryAlert2", text);
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.innerText = value;
}

function updateClock() {
  const now = new Date();

  setText("clock", now.toLocaleTimeString());
  setText("date", now.toLocaleDateString());
}

updateClock();
setInterval(updateClock, 1000);

loadAllData();
setInterval(loadAllData, 30000);
