const API = "https://api.torn.com/v2";

let apiKey =
  localStorage.getItem("tornApiKey") || "";

// PAGE TABS
function showPage(pageId, button) {

  document
    .querySelectorAll(".page")
    .forEach(page => {
      page.classList.remove("active-page");
    });

  document
    .querySelectorAll(".tab")
    .forEach(tab => {
      tab.classList.remove("active");
    });

  const page =
    document.getElementById(pageId);

  if (page) {
    page.classList.add("active-page");
  }

  if (button) {
    button.classList.add("active");
  }
}

// SAVE API KEY
function saveKey() {

  apiKey =
    document
      .getElementById("apiKey")
      .value
      .trim();

  localStorage.setItem(
    "tornApiKey",
    apiKey
  );

  setText(
    "status",
    "Loading data..."
  );

  loadAllData();
}

// TEXT HELPER
function setText(id, value) {

  const el =
    document.getElementById(id);

  if (el) {
    el.innerText = value;
  }
}

// FETCH JSON
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

// LOAD ALL
async function loadAllData() {

  if (!apiKey) {

    setText(
      "status",
      "Enter API key."
    );

    return;
  }

  try {

    // USER
    const user =
      await getData(
        `${API}/user?selections=profile,bars,personalstats&key=${apiKey}`
      );

    console.log("USER:", user);

    // FACTION
    const faction =
      await getData(
        `${API}/faction?selections=basic,members,chain&key=${apiKey}`
      );

    console.log("FACTION:", faction);

    loadUser(user);
    loadFaction(faction);

    setText(
      "status",
      "Connected successfully."
    );

  } catch (err) {

    console.error(err);

    setText(
      "status",
      "ERROR: " + err.message
    );
  }
}

// USER
function loadUser(user) {

  setText(
    "playerName",
    user.name || "Unknown"
  );

  setText(
    "playerId",
    `[${user.player_id || "?"}]`
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

  setText(
    "playerAge",
    `${Math.floor(age / 365)} years`
  );

  // LEVEL PER DAY
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
    user.honors_awarded || "-"
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

  // FORUM POSTS
  setText(
    "forumValue",
    user.forum_posts || "-"
  );

  // PROFILE IMAGE
  const pfp =
    document.getElementById("playerPfp");

  if (pfp) {

    pfp.src =
      `https://www.torn.com/images/profile/${user.player_id}.jpg`;

    pfp.onerror = () => {

      pfp.src =
        "https://i.gyazo.com/a5da16009ce26825695c7e165fb03aab.png";
    };
  }
}

// FACTION
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
    Object.keys(
      faction.members || {}
    ).length
  );

  const chain =
    faction.chain?.current ||
    faction.chain ||
    0;

  setText(
    "chainValue",
    chain
  );

  // ONLINE MEMBERS
  const members =
    Object.values(
      faction.members || {}
    );

  const online =
    members.filter(m =>
      String(
        m.last_action?.status || ""
      )
      .toLowerCase()
      .includes("online")
    );

  const onlineBox =
    document.getElementById(
      "onlineMembers"
    );

  if (onlineBox) {

    onlineBox.innerHTML =
      online.length
        ? online.map(m =>
            `<p>${m.name} - Online</p>`
          ).join("")
        : "<p>No members online.</p>";
  }
}

// CLOCK
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

// START
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