const API = "https://api.torn.com";
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

  if (button) {
    button.classList.add("active");
  }
}

function saveKey() {
  const input = document.getElementById("apiKey");
  apiKey = input.value.trim();

  localStorage.setItem("tornApiKey", apiKey);

  setText("status", "API key saved. Loading live data...");
  loadAllData();
}

async function tornFetch(type, selections) {
  const url = `${API}/${type}/?selections=${selections}&key=${apiKey}`;
  const response = await fetch(url);
  const data = await response.json();

  if (data.error) {
    throw new Error(data.error.error || data.error);
  }

  return data;
}

async function loadAllData() {
  if (!apiKey) {
    setText("status", "Go to Settings and enter your Torn API key.");
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
  const user = await tornFetch("user", "basic,profile,bars");

  setText("playerName", user.name || "Unknown");
  setText("playerId", `[${user.player_id || "?"}]`);
  setText("playerLevel", user.level || "-");
  setText("playerStatus", user.status?.description || user.status?.state || "-");
  setText("playerRank", user.rank || "Agent");

  const energy = user.energy
    ? `${user.energy.current} / ${user.energy.maximum}`
    : "-";

  setText("energyValue", energy);
  setText("energyAlert", energy);
}

async function loadFaction() {
  const faction = await tornFetch("faction", "basic,members,chain");

  setText("factionName", faction.name || "Unknown");
  setText("dashFaction", faction.name || "-");

  const respect = Number(faction.respect || 0).toLocaleString();
  setText("factionRespect", respect);
  setText("dashRespect", respect);

  const members = faction.members ? Object.values(faction.members) : [];

  setText("factionMembers", `${members.length} / ${faction.capacity || "?"}`);

  const chain = faction.chain?.current || faction.chain || 0;

  setText("chainValue", chain);
  setText("chainValue2", chain);
  setText("dashChain", chain);
  setText("chainAlert", chain);

  setText("factionRank", faction.rank || "#?");
  setText("factionPower", faction.best_chain || "-");

  loadHospital(members);
  loadOnlineMembers(members);
  loadMembers(members);
}

function loadHospital(members) {
  const count = members.filter(m => {
    const state = String(m.status?.state || "").toLowerCase();
    const desc = String(m.status?.description || "").toLowerCase();
    return state.includes("hospital") || desc.includes("hospital");
  }).length;

  setText("hospitalAlert", count);
  setText("hospitalAlert2", count);
}

function loadOnlineMembers(members) {
  const online = members.filter(m =>
    String(m.last_action?.status || "").toLowerCase() === "online"
  );

  const box = document.getElementById("onlineMembers");
  if (!box) return;

  box.innerHTML = online.length
    ? online.map(m => `<p>${m.name} - Online</p>`).join("")
    : "<p>No members online.</p>";
}

function loadMembers(members) {
  const box = document.getElementById("memberList");
  if (!box) return;

  box.innerHTML = members.length
    ? members.map(m => `<p>${m.name} - ${m.last_action?.status || "Unknown"}</p>`).join("")
    : "<p>No members found.</p>";
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerText = value;
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
