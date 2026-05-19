// app.js
function showTab(tabName) {
  document.querySelectorAll(".tab-page").forEach(page => {
    page.classList.remove("active-page");
  });

  document.querySelectorAll("nav button").forEach(button => {
    button.classList.remove("active");
  });

  document.getElementById(tabName).classList.add("active-page");
  event.currentTarget.classList.add("active");
}

function saveKey() {
  const key = document.getElementById("apiKey").value.trim();
  localStorage.setItem("tornApiKey", key);
  document.getElementById("status").innerText = "API key saved locally.";
}

function updateClock() {
  const now = new Date();
  document.getElementById("clock").innerText = now.toLocaleTimeString();
  document.getElementById("date").innerText = now.toLocaleDateString();
}

updateClock();
setInterval(updateClock, 1000);
