const API_BASE = "https://api.torn.com/v2";

function saveKey() {
  const key = document.getElementById("apiKey").value.trim();

  localStorage.setItem("tornApiKey", key);

  document.getElementById("status").innerText =
    "API key saved.";
}

async function loadFaction() {

  const key = localStorage.getItem("tornApiKey");

  if (!key) {
    alert("No API key saved.");
    return;
  }

  document.getElementById("status").innerText =
    "Loading faction data...";

  try {

    const response = await fetch(
      `${API_BASE}/faction/members?key=${key}`
    );

    const data = await response.json();

    console.log(data);

    document.getElementById("members").innerHTML =
      `<pre>${JSON.stringify(data, null, 2)}</pre>`;

    document.getElementById("status").innerText =
      "Faction loaded.";

  } catch (err) {

    console.error(err);

    document.getElementById("status").innerText =
      "Error loading faction.";

  }
}
