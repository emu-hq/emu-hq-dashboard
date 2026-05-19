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

  apiKey =
    document.getElementById("apiKey").value.trim();

  localStorage.setItem("tornApiKey", apiKey);

  setText("status", "Loading...");

  loadAllData();
}

function setText(id, value) {

  const el =
    document.getElementById(id);

  if (el) {
    el.innerText = value;
  }
}

async function getData(url) {

  const response =
    await fetch(url);

  const data =
    await response.json();

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

    setText(
      "status",
      "Enter API key."
    );

    return;
  }

  try {

    const user =
      await getData(
        `${API}/user/basic?key=${apiKey}`
      );

    console.log(user);

    loadUser(user);

  } catch (err) {

    console.error(err);

    setText(
      "status",
      "USER ERROR: " + err.message
    );
  }

  try {

    const faction =
      await getData(
        `${API}/faction/basic?key=${apiKey}`
      );

    console.log(faction);

    loadFaction(faction);

    setText(
      "status",
      "Connected successfully."
    );

  } catch (err) {

    console.error(err);

    setText(
      "status",
      "FACTION ERROR: " + err.message
    );
  }
}

function loadUser(user) {

  setText(
    "playerName",
    user.name || "Unknown"
  );

  setText(
    "playerId",
    `[${user.id || "?"}]`
  );

  setText(
    "playerRank",
    user.rank || "-"
  );

  setText(
    "playerLevel",
    user.level || "-"
  );

  // AGE
  const age =
    user.age || 0;

  const years =
    Math.floor(age / 365);

  setText(
    "playerAge",
    `${years} years`
  );

  // LVL/DAY
  const lvlDay =
    age && user.level
      ? (user.level / age).toFixed(3)
      : "-";

  setText(
    "levelDay",
    lvlDay
  );

  // FRENEMIES
  setText(
    "frenemiesValue",
    `+${user.friends || 0} 💀${user.enemies || 0}`
  );

  // HONORS
  setText(
    "honorValue",
    user.honors || "-"
  );

  // AWARDS
  setText(
    "awardsValue",
    user.awards || "-"
  );

  // KARMA
  setText(
    "karmaValue",
    user.karma || "-"
  );

  // FORUM
  setText(
    "forumValue",
    user.forum_posts || "-"
  );

  // PROFILE IMAGE
  const pfp =
    document.getElementById("playerPfp");

  if (pfp && user.id) {

    pfp.src =
      `https://www.torn.com/images/profile/${user.id}.jpg`;

    pfp.onerror = () => {

      pfp.src =
        "https://i.gyazo.com/a5da16009ce26825695c7e165fb03aab.png";
    };
  }
}

function loadFaction(faction) {

  setText(
    "factionName",
    faction.name || "-"
  );

  setText(
    "factionRespect",
    Number(
      faction.respect || 0
    ).toLocaleString()
  );

  setText(
    "factionMembers",
    faction.members || "-"
  );

  setText(
    "chainValue",
    faction.chain || 0
  );
}

function updateClock() {

  const now =
    new Date();

  setText(
    "clock",
    now.toLocaleTimeString()
  );

  setText(
    "date",
    now.toLocaleDateString()
  );
}

updateClock();

setInterval(
  updateClock,
  1000
);

loadAllData();

setInterval(
  loadAllData,
  30000
);