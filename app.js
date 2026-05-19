const API_V1 = "https://api.torn.com";

let apiKey = localStorage.getItem("tornApiKey") || "";

function showTab(tabName, button) {

  document
    .querySelectorAll(".tab-page, .page")
    .forEach(p => p.classList.remove("active-page"));

  document
    .querySelectorAll("nav button, .tab")
    .forEach(t => t.classList.remove("active"));

  const page = document.getElementById(tabName);

  if (page) {
    page.classList.add("active-page");
  }

  if (button) {
    button.classList.add("active");
  }
}

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
    "API key saved. Loading..."
  );

  loadAllData();
}

function setText(ids, value) {

  if (!Array.isArray(ids)) {
    ids = [ids];
  }

  ids.forEach(id => {

    const el =
      document.getElementById(id);

    if (el) {
      el.innerText = value;
    }
  });
}

async function getJson(url) {

  const res =
    await fetch(url);

  const data =
    await res.json();

  if (data.error) {

    throw new Error(
      data.error.error ||
      data.error.message ||
      "API error"
    );
  }

  return data;
}

async function loadAllData() {

  if (!apiKey) {

    setText(
      "status",
      "Enter API key in settings."
    );

    return;
  }

  try {

    const user =
      await getJson(
        `${API_V1}/user/?selections=profile,bars,personalstats&key=${apiKey}`
      );

    const faction =
      await getJson(
        `${API_V1}/faction/?selections=basic,members,chain&key=${apiKey}`
      );

    console.log("USER:", user);
    console.log("FACTION:", faction);

    loadUser(user);
    loadFaction(faction);

    setText(
      "status",
      "Live data loaded."
    );

  } catch (err) {

    console.error(err);

    setText(
      "status",
      "ERROR: " + err.message
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
    `[${user.player_id || user.id || "?"}]`
  );

  setText(
    "playerLevel",
    user.level || "-"
  );

  setText(
    "playerStatus",
    user.status?.description ||
    user.status?.state ||
    "-"
  );

  setText(
    "playerRank",
    user.rank || "-"
  );

  // ENERGY
  const energy =
    user.energy;

  setText(
    ["energyValue", "energyAlert"],
    energy
      ? `${energy.current} / ${energy.maximum}`
      : "-"
  );

  // AGE
  const ageDays =
    user.age || 0;

  const ageText =
    ageDays
      ? `${Math.floor(ageDays / 365)} years`
      : "-";

  setText(
    "playerAge",
    ageText
  );

  setText(
    "ageDays",
    ageDays
      ? `${ageDays} days`
      : ""
  );

  // LEVEL PER DAY
  const levelDay =
    ageDays && user.level
      ? (user.level / ageDays).toFixed(3)
      : "-";

  setText(
    "levelDay",
    levelDay
  );

  // FRENEMIES
  setText(
    "frenemiesValue",
    `+${user.friends || 0} 💀${user.enemies || 0}`
  );

  // HONOR
  setText(
    "honorValue",
    user.honors_awarded ||
    "-"
  );

  // AWARDS
  setText(
    "awardsValue",
    user.awards ||
    "-"
  );

  // KARMA
  setText(
    "karmaValue",
    user.karma ||
    "-"
  );

  // FORUM POSTS
  setText(
    "forumValue",
    user.forum_posts ||
    user.personalstats?.forum_posts ||
    "-"
  );

  // PROFILE IMAGE
  const img =
    document.getElementById("playerPfp");

  if (img) {

    img.src =
      `https://www.torn.com/images/profile/${user.player_id || user.id}.jpg`;

    img.onerror = () => {

      img.src =
        "https://i.gyazo.com/a5da16009ce26825695c7e165fb03aab.png";
    };
  }
}

function loadFaction(faction) {

  setText(
    ["factionName", "dashFaction"],
    faction.name || "-"
  );

  setText(
    "factionRank",
    faction.rank
      ? `#${faction.rank}`
      : "-"
  );

  setText(
    ["factionRespect", "dashRespect"],
    Number(
      faction.respect || 0
    ).toLocaleString()
  );

  setText(
    "factionMembers",
    `${Object.keys(faction.members || {}).length} / ${faction.capacity || "?"}`
  );

  setText(
    "factionPower",
    faction.best_chain ||
    "-"
  );

  setText(
    ["warStatus", "warStatus2"],
    "No active war"
  );

  // CHAIN
  const chain =
    faction.chain?.current ||
    faction.chain?.chain ||
    faction.chain ||
    0;

  setText(
    [
      "chainValue",
      "chainValue2",
      "dashChain",
      "chainTracker",
      "chainAlert"
    ],
    chain
  );

  // MEMBERS
  const members =
    Object.values(
      faction.members || {}
    );

  // ONLINE
  const online =
    members.filter(m =>
      String(
        m.last_action?.status || ""
      )
      .toLowerCase()
      .includes("online")
    );

  // HOSPITAL
  const hospital =
    members.filter(m =>
      String(
        m.status?.description ||
        m.status?.state ||
        ""
      )
      .toLowerCase()
      .includes("hospital")
    );

  setText(
    [
      "hospitalAlert",
      "hospitalAlert2",
      "hospitalCount"
    ],
    hospital.length
  );

  setText(
    [
      "territoryAlert",
      "territoryAlert2",
      "territoryStatus"
    ],
    "No assault detected"
  );

  setText(
    [
      "warTimer",
      "warTimer2"
    ],
    "No active war"
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
