const API = "https://api.torn.com/v2";
let apiKey = localStorage.getItem("tornApiKey") || "";

function showTab(tabName, button) {
  document.querySelectorAll(".tab-page, .page").forEach(p => p.classList.remove("active-page"));
  document.querySelectorAll("nav button, .tab").forEach(t => t.classList.remove("active"));

  const page = document.getElementById(tabName);
  if (page) page.classList.add("active-page");
  if (button) button.classList.add("active");
}

function saveKey() {
  apiKey = document.getElementById("apiKey").value.trim();
  localStorage.setItem("tornApiKey", apiKey);
  setText(["status"], "API key saved. Loading...");
  loadAllData();
}

function setText(ids, value) {
  if (!Array.isArray(ids)) ids = [ids];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
  });
}

async function getJson(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.error || data.error.message || "API error");
  return data;
}

async function loadAllData() {
  if (!apiKey) {
    setText("status", "Enter API key in settings.");
    return;
  }

  try {
    const userData = await getJson(`${API}/user?selections=profile,bars&key=${apiKey}`);
    const factionData = await getJson(`${API}/faction?selections=basic,members,chain&key=${apiKey}`);

    const user = userData.profile || userData;
    const bars = userData.bars || userData;

    setText("playerName", user.name || "Unknown");
    setText("playerId", `[${user.id || user.player_id || "?"}]`);
    setText("playerLevel", user.level || "-");
    setText("playerStatus", user.status?.description || user.status?.state || "-");
    setText("playerRank", user.rank || "-");

    const energy = bars.energy || user.energy;
    setText(["energyValue", "energyAlert"], energy ? `${energy.current} / ${energy.maximum}` : "-");

    const img = document.getElementById("playerPfp");
    if (img && (user.image || user.profile_image)) img.src = user.image || user.profile_image;

    const faction = factionData.basic || factionData.faction || factionData;
    const membersObj = factionData.members || faction.members || {};
    const chainObj = factionData.chain || faction.chain || {};

    setText(["factionName", "dashFaction"], faction.name || "-");
    setText("factionRank", faction.rank ? `#${faction.rank}` : "-");
    setText(["factionRespect", "dashRespect"], Number(faction.respect || 0).toLocaleString());
    setText("factionMembers", `${Object.keys(membersObj).length} / ${faction.capacity || "?"}`);
    setText("factionPower", faction.power || faction.best_chain || "-");
    setText(["warStatus", "warStatus2"], "No active war");

    const chain = chainObj.current || chainObj.chain || chainObj.counter || chainObj.amount || 0;
    setText(["chainValue", "chainValue2", "dashChain", "chainTracker", "chainAlert"], chain);

    const members = Object.values(membersObj);

    const online = members.filter(m =>
      String(m.last_action?.status || "").toLowerCase().includes("online")
    );

    const hospital = members.filter(m =>
      String(m.status?.description || m.status?.state || "").toLowerCase().includes("hospital")
    );

    setText(["hospitalAlert", "hospitalAlert2", "hospitalCount"], hospital.length);
    setText(["territoryAlert", "territoryAlert2", "territoryStatus"], "No assault detected");
    setText(["warTimer", "warTimer2"], "No active war");

    const onlineBox = document.getElementById("onlineMembers");
    if (onlineBox) {
      onlineBox.innerHTML = online.length
        ? online.map(m => `<p>${m.name} - Online</p>`).join("")
        : "<p>No members online.</p>";
    }

    setText("status", "Live data loaded.");
  } catch (err) {
    console.error(err);
    setText("status", "ERROR: " + err.message);
  }
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
