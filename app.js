const API = "https://api.torn.com/v2";

let apiKey = localStorage.getItem("tornApiKey") || "";

function showPage(pageId, button) {
  document.querySelectorAll(".page").forEach(page => {
    page.classList.remove("active-page");
  });

  document.querySelectorAll(".tab").forEach(tab => {
    tab.classList.remove("active");
  });

  document.getElementById(pageId)?.classList.add("active-page");
  button?.classList.add("active");
}

function saveKey() {
  apiKey = document.getElementById("apiKey").value.trim();
  localStorage.setItem("tornApiKey", apiKey);
  setText("status", "Loading...");
  loadAllData();
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerText = value;
}

async function getData(url) {
  const response = await fetch(url);
  const data = await response.json();

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

    console.log("USER DATA:", user);

    loadUser(user);
  } catch (err) {
    console.error(err);
    setText("status", "USER ERROR: " + err.message);
  }

  try {
    const faction = await getData(
      `${API}/faction/basic?key=${apiKey}`
    );

    console.log("FACTION DATA:", faction);

    loadFaction(faction);

    setText("status", "Connected successfully.");
  } catch (err) {
    console.error(err);
    setText("status", "FACTION ERROR: " + err.message);
  }
}

function loadUser(data) {
  const user = data.user || data.basic || data;

  setText("playerName", user.name || "Unknown");
  setText("playerId", `[${user.id || user.player_id || "?"}]`);
  setText("playerRank", user.rank || user.title || "-");
  setText("playerLevel", user.level || "-");

  const age = user.age || 0;
  setText("playerAge", age ? `${Math.floor(age / 365)} years` : "-");

  const lvlDay =
    age && user.level
      ? (user.level / age).toFixed(3)
      : "-";

  setText("levelDay", lvlDay);

  setText("frenemiesValue", `+${user.friends || 0} 💀${user.enemies || 0}`);

  setText("honorValue", user.honors || user.honors_awarded || "-");
  setText("awardsValue", user.awards || "-");
  setText("karmaValue", user.karma || "-");
  setText("forumValue", user.forum_posts || "-");

  const pfp = document.getElementById("playerPfp");
  const id = user.id || user.player_id;

  if (pfp && id) {
    pfp.src = `https://www.torn.com/images/profile/${id}.jpg`;
    pfp.onerror = () => {
      pfp.src = "https://i.gyazo.com/a5da16009ce26825695c7e165fb03aab.png";
    };
  }
}

function loadFaction(faction) {
  setText("factionName", faction.name || "-");

  setText(
    "factionRespect",
    Number(faction.respect || 0).toLocaleString()
  );

  setText("factionMembers", faction.members || "-");
  setText("chainValue", faction.chain || 0);
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