const USER_API = "https://api.torn.com";
const FACTION_API = "https://api.torn.com/v2";

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

  setText("status", "Connecting...");

  loadAllData();
}

function setText(id, value) {
  const el = document.getElementById(id);

  if (el) {
    el.innerText = value;
  }
}

async function getData(url) {
  const response = await fetch(url);
  const data = await response.json();

  if (data.error) {
    throw new Error(
      data.error.error ||
      data.error.message ||
      "API Error"
    );
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
      `${USER_API}/user/?selections=profile&key=${apiKey}`
    );

    console.log("USER:", user);

    loadUser(user);
  } catch (err) {
    console.error(err);
    setText("status", "USER ERROR: " + err.message);
  }

  try {
    const faction = await getData(
      `${FACTION_API}/faction?selections=basic,members,chain&key=${apiKey}`
    );

    console.log("FACTION:", faction);

    loadFaction(faction);

    setText("status", "Connected successfully.");
  } catch (err) {
    console.error(err);
    setText("status", "FACTION ERROR: " + err.message);
  }
}

function loadUser(user) {
  setText("playerName", user.name || "Unknown");

  setText(
    "playerId",
    `[${user.player_id || "?"}]`
  );

  setText("playerRank", user.rank || "-");
  setText("playerLevel", user.level || "-");

  const age = user.age || 0;

  setText(
    "playerAge",
    `${Math.floor(age / 365)} years`
  );

  const lvlDay =
    age && user.level
      ? (user.level / age).toFixed(3)
      : "-";

  setText("levelDay", lvlDay);

  setText(
    "frenemiesValue",
    `+${user.friends || 0} 💀${user.enemies || 0}`
  );

  setText("honorValue", user.honor || "-");
  setText("awardsValue", user.awards || "-");
  setText("karmaValue", user.karma || "-");
  setText("forumValue", user.forum_posts || "-");

  const pfp = document.getElementById("playerPfp");

  if (pfp) {
    pfp.src =
      user.profile_image ||
      "https://i.gyazo.com/a5da16009ce26825695c7e165fb03aab.png";

    pfp.onerror = function () {
      pfp.src =
        "https://i.gyazo.com/a5da16009ce26825695c7e165fb03aab.png";
    };
  }
}

function loadFaction(data) {
  const faction = data.basic || data;
  const members = data.members || {};
  const chain = data.chain || {};

  setText("factionName", faction.name || "-");

  setText(
    "factionRespect",
    Number(faction.respect || 0).toLocaleString()
  );

  setText(
    "factionMembers",
    `${Object.keys(members).length}`
  );

  setText(
    "chainValue",
    chain.current || 0
  );

  const onlineMembers = Object.values(members).filter(member => {
    return String(member.last_action?.status || "")
      .toLowerCase()
      .includes("online");
  });

  const onlineBox = document.getElementById("onlineMembers");

  if (onlineBox) {
    onlineBox.innerHTML =
      onlineMembers.length
        ? onlineMembers
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