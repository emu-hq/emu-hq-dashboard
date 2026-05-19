const API = "https://api.torn.com/v2";

let apiKey = localStorage.getItem("tornApiKey") || "";

function showPage(pageId, button) {
  document.querySelectorAll(".page").forEach(page => {
    page.classList.remove("active-page");
  });

  document.querySelectorAll(".tab").forEach(tab => {
    tab.classList.remove("active");
  });

  const page = document.getElementById(pageId);

  if (page) {
    page.classList.add("active-page");
  }

  if (button) {
    button.classList.add("active");
  }
}

function saveKey() {
  apiKey = document.getElementById("apiKey").value.trim();

  localStorage.setItem("tornApiKey", apiKey);

  setText("status", "Loading data...");

  loadAllData();
}

function setText(id, value) {
  const el = document.getElementById(id);

  if (el) {
    el.innerText = value;
  }
}

async function getData(url) {
  const res = await fetch(url);
  const data = await res.json();

  if (data.error) {
    throw new Error(data.error.error || data.error.message || "API Error");
  }

  return data;
}

async function loadAllData() {
  if (!apiKey) {
    setText("status", "Enter API key.");
    return;
  }

  try {
    const user = await getData(
      `${API}/user?selections=basic,bars&key=${apiKey}`
    );

    const faction = await getData(
      `${API}/faction?selections=basic,members,chain&key=${apiKey}`
    );

    loadUser(user);
    loadFaction(faction);

    setText("status", "Connected successfully.");
  } catch (err) {
    console.error(err);
    setText("status", "ERROR: " + err.message);
  }
}

function loadUser(data) {
  const user = data.user || data;

  setText("playerName", user.name || "Unknown");
  setText("playerId", `[${user.id || user.player_id || "?"}]`);
  setText("playerRank", user.rank || user.title || "-");
  setText("playerLevel", user.level || "-");

  const age = user.age || 0;

  setText(
    "playerAge",
    age ? `${Math.floor(age / 365)} years` : "-"
  );

  setText(
    "levelDay",
    age && user.level ? (user.level / age).toFixed(3) : "-"
  );

  setText(
    "frenemiesValue",
    `+${user.friends || 0} 💀${user.enemies || 0}`
  );

  setText("honorValue", user.honors_awarded || "-");
  setText("awardsValue", user.awards || "-");
  setText("karmaValue", user.karma || "-");
  setText("forumValue", user.forum_posts || "-");

  const pfp = document.getElementById("playerPfp");

  if (pfp) {
    const playerId = user.id || user.player_id;

    pfp.src = `https://www.torn.com/images/profile/${playerId}.jpg`;

    pfp.onerror = () => {
      pfp.src =
        "https://i.gyazo.com/a5da16009ce26825695c7e165fb03aab.png";
    };
  }
}

function loadFaction(data) {
  const faction = data.faction || data.basic || data;
  const membersObj = data.members || faction.members || {};
  const chainObj = data.chain || faction.chain || {};

  setText("factionName", faction.name || "-");

  setText(
    "factionRespect",
    Number(faction.respect || 0).toLocaleString()
  );

  setText("factionMembers", Object.keys(membersObj).length);

  const chain =
    chainObj.current ||
    chainObj.chain ||
    chainObj.counter ||
    0;

  setText("chainValue", chain);

  const online = Object.values(membersObj).filter(member =>
    String(member.last_action?.status || "")
      .toLowerCase()
      .includes("online")
  );

  const onlineBox = document.getElementById("onlineMembers");

  if (onlineBox) {
    onlineBox.innerHTML = online.length
      ? online
          .map(member => `<p>${member.name} - Online</p>`)
          .join("")
      : "<p>No members online.</p>";
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