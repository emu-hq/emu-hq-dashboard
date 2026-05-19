const API = "https://api.torn.com/v2";

let apiKey =
  localStorage.getItem("tornApiKey") || "";

function showTab(tabName, button) {

  document.querySelectorAll(".page")
    .forEach(page => {
      page.classList.remove("active-page");
    });

  document.querySelectorAll(".tab")
    .forEach(tab => {
      tab.classList.remove("active");
    });

  document
    .getElementById(tabName)
    .classList.add("active-page");

  button.classList.add("active");
}

function saveKey() {

  apiKey =
    document.getElementById("apiKey")
    .value
    .trim();

  localStorage.setItem(
    "tornApiKey",
    apiKey
  );

  setText(
    "status",
    "API key saved."
  );

  loadAllData();
}

function setText(id, value) {

  const el =
    document.getElementById(id);

  if (el) {
    el.innerText = value;
  }
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
      await fetch(
        `${API}/user?selections=profile,bars&key=${apiKey}`
      ).then(r => r.json());

    const faction =
      await fetch(
        `${API}/faction?selections=basic,members,chain&key=${apiKey}`
      ).then(r => r.json());

    console.log("USER:", user);
    console.log("FACTION:", faction);

    if (user.error) {
      throw new Error(user.error.error);
    }

    if (faction.error) {
      throw new Error(faction.error.error);
    }

    // USER
    setText(
      "playerName",
      user.name || "Unknown"
    );

    setText(
      "playerId",
      `[${user.player_id || "?"}]`
    );

    setText(
      "playerLevel",
      user.level || "-"
    );

    setText(
      "playerStatus",
      user.status?.description || "-"
    );

    setText(
      "playerRank",
      user.rank || "-"
    );

    setText(
      "energyValue",
      `${user.energy?.current || 0}/${user.energy?.maximum || 0}`
    );

    // PROFILE IMAGE
    if (user.profile_image) {

      const img =
        document.getElementById("playerPfp");

      if (img) {
        img.src = user.profile_image;
      }
    }

    // FACTION
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

    const chain =
      faction.chain?.current ||
      faction.chain ||
      0;

    setText(
      "chainValue",
      chain
    );

    setText(
      "chainTracker",
      chain
    );

    // MEMBERS
    const members =
      Object.values(
        faction.members || {}
      );

    // ONLINE
    const online =
      members.filter(member => {

        const status =
          String(
            member.last_action?.status || ""
          ).toLowerCase();

        return status.includes("online");

      });

    // HOSPITAL
    const hospital =
      members.filter(member => {

        const desc =
          String(
            member.status?.description || ""
          ).toLowerCase();

        return desc.includes("hospital");

      });

    // ONLINE BOX
    const onlineBox =
      document.getElementById(
        "onlineMembers"
      );

    onlineBox.innerHTML =
      online.length
      ? online.map(member =>
          `<p>${member.name} - Online</p>`
        ).join("")
      : "<p>No members online.</p>";

    // HOSPITAL COUNT
    setText(
      "hospitalCount",
      hospital.length
    );

    // TERRITORY
    setText(
      "territoryStatus",
      "No assault detected"
    );

    // WAR
    setText(
      "warTimer",
      "No active war"
    );

    // SUCCESS
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

loadAllData();

setInterval(
  loadAllData,
  30000
);
