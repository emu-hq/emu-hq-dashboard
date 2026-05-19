const API = "https://api.torn.com/v2";

let apiKey = localStorage.getItem("tornApiKey") || "";

function saveKey() {
  apiKey = document.getElementById("apiKey").value.trim();
  localStorage.setItem("tornApiKey", apiKey);
  document.getElementById("status").innerText = "API key saved. Loading data...";
  loadAllData();
}

async function tornFetch(path) {
  const res = await fetch(`${API}${path}?key=${apiKey}`);
  const data = await res.json();

  if (data.error) {
    throw new Error(data.error.error || data.error);
  }

  return data;
}

async function loadAllData() {
  if (!apiKey) return;

  try {
    await loadUser();
    await loadFaction();
    document.getElementById("status").innerText = "Live data loaded.";
  } catch (err) {
    console.error(err);
    document.getElementById("status").innerText = "API error: " + err.message;
  }
}

async function loadUser() {
  const user = await tornFetch("/user?selections=basic,profile,bars");

  setText("playerName", user.name || "Unknown");
  setText("playerId", `[${user.player_id || user.id || "?"}]`);
  setText("playerLevel", user.level || "-");
  setText("playerStatus", user.status?.description || user.status?.state || "-");

  setText("energyValue", `${user.energy?.current || 0} / ${user.energy?.maximum || 0}`);

  if (user.profile_image) {
    document.getElementById("playerPfp").src = user.profile_image;
  }
}

async function loadFaction() {
  const faction = await tornFetch("/faction?selections=basic,members,chain,wars,territory");

  setText("factionName", faction.name || "Unknown");
  setText("factionRespect", Number(faction.respect || 0).toLocaleString());
  setText("factionMembers", `${Object.keys(faction.members || {}).length} / ${faction.capacity || "?"}`);

  setText("chainValue", faction.chain?.current || faction.chain || 0);

  const members = Object.values(faction.members || {});

  const hospitalCount = members.filter(m =>
    String(m.status?.state || "").toLowerCase().includes("hospital") ||
    String(m.status?.description || "").toLowerCase().includes("hospital")
  ).length;

  setText("hospitalAlert", hospitalCount);

  const online = members.filter(m =>
    String(m.last_action?.status || "").toLowerCase() === "online"
  );

  const onlineBox = document.getElementById("onlineMembers");
  onlineBox.innerHTML = online.length
    ? online.map(m => `<p>${m.name} - Online</p>`).join("")
    : "<p>No members online</p>";

  loadWarTimer(faction);
  loadTerritoryAlert(faction);
}

function loadWarTimer(faction) {
  let startTime = null;

  const wars = faction.wars || faction.ranked_wars || [];

  if (Array.isArray(wars) && wars.length) {
    startTime = wars[0]?.start || wars[0]?.start_time;
  }

  if (!startTime) {
    setText("warTimer", "No upcoming war");
    return;
  }

  const warStartMs = startTime * 1000;

  function tick() {
    const diff = warStartMs - Date.now();

    if (diff <= 0) {
      setText("warTimer", "WAR LIVE");
      return;
    }

    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);

    setText("warTimer", `${d}d ${h}h ${m}m ${s}s`);
  }

  tick();
  setInterval(tick, 1000);
}

function loadTerritoryAlert(faction) {
  const territory = faction.territory || {};
  const underAttack = Object.values(territory).some(tile =>
    tile.war || tile.assault || tile.attacking_faction
  );

  setText("territoryAlert", underAttack ? "UNDER ATTACK" : "Clear");
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerText = value;
}

setInterval(loadAllData, 30000);
loadAllData();
