function showTab(tabName) {
  document.querySelectorAll(".page").forEach(page => {
    page.classList.remove("active-page");
  });

  document.querySelectorAll(".tab").forEach(tab => {
    tab.classList.remove("active");
  });

  document.getElementById(tabName).classList.add("active-page");
  event.currentTarget.classList.add("active");

  const titles = {
    dashboard: "🏠 Dashboard",
    members: "👥 Members",
    war: "⚔️ War Terminal",
    chain: "⛓️ Chain Tracker",
    settings: "⚙️ Settings"
  };

  document.getElementById("pageTitle").innerText = titles[tabName];
}

function saveKey() {
  const key = document.getElementById("apiKey").value.trim();
  localStorage.setItem("tornApiKey", key);
  document.getElementById("status").innerText = "API key saved locally.";
}
