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
    throw new Error(data.error.error);
  }

  return data;
}

async function loadAllData() {

  if (!apiKey) return;

  try {

    // PLAYER
    const user = await getData(
      `${USER_API}/user/?selections=profile&key=${apiKey}`
    );

    console.log("USER", user);

    setText("playerName", user.name);
    setText("playerId", `[${user.player_id}]`);
    setText("playerRank", user.rank);
    setText("playerLevel", user.level);

    const years =
      Math.floor((user.age || 0) / 365);

    setText(
      "playerAge",
      `${years} years`
    );

    setText(
      "levelDay",
      (user.level / user.age).toFixed(3)
    );

    setText(
      "frenemiesValue",
      `+${user.friends || 0} 💀${user.enemies || 0}`
    );

    setText(
      "honorValue",
      user.honors_awarded || 0
    );

    setText(
      "awardsValue",
      user.awards || 0
    );

    setText(
      "karmaValue",
      user.karma || 0
    );

    setText(
      "forumValue",
      user.forum_posts || 0
    );

    // FACTION
    const faction = await getData(
      `${FACTION_API}/faction?selections=basic,members,chain&key=${apiKey}`
    );

    console.log("FACTION", faction);

    const factionData =
      faction.basic || faction;

    setText(
      "factionName",
      factionData.name
    );

    setText(
      "factionRespect",
      Number(
        factionData.respect
      ).toLocaleString()
    );

    const members =
      faction.members || {};

    setText(
      "factionMembers",
      Object.keys(members).length
    );

    const chain =
      faction.chain?.current || 0;

    setText(
      "chainValue",
      chain
    );

    const online =
      Object.values(members)
        .filter(member =>
          String(
            member.last_action?.status || ""
          )
          .includes("Online")
        );

    const onlineBox =
      document.getElementById(
        "onlineMembers"
      );

    if (onlineBox) {

      onlineBox.innerHTML =
        online.map(member =>
          `<p>${member.name} - Online</p>`
        ).join("");
    }

    // PFP
    const pfp =
      document.getElementById("playerPfp");

    if (pfp) {

      pfp.src =
        "https://i.gyazo.com/a5da16009ce26825695c7e165fb03aab.png";
    }

    setText(
      "status",
      "Connected successfully."
    );

  } catch (err) {

    console.error(err);

    setText(
      "status",
      err.message
    );
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