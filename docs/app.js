(() => {
  "use strict";

  const status = window.RUFFLE_MEMORY_STATUS;
  if (!status) {
    return;
  }

  document.querySelector("#current-version").textContent = `v${status.currentVersion}`;
  document.querySelector("#release-metric").textContent = status.currentVersion;
  document.querySelector("#release-name").textContent = status.currentName;
  document.querySelector("#release-state").textContent = status.state;
  requestAnimationFrame(() => {
    document.querySelector("#progress-fill").style.width = `${status.progress}%`;
  });

  const capabilityGrid = document.querySelector("#capability-grid");
  status.capabilities.forEach((capability, index) => {
    const article = document.createElement("article");
    article.className = "capability-card";
    const number = document.createElement("span");
    number.className = "capability-number";
    number.textContent = String(index + 1).padStart(2, "0");
    const title = document.createElement("h3");
    title.textContent = capability.title;
    const description = document.createElement("p");
    description.textContent = capability.description;
    article.append(number, title, description);
    capabilityGrid.append(article);
  });

  function renderList(selector, entries) {
    const list = document.querySelector(selector);
    entries.forEach((entry) => {
      const item = document.createElement("li");
      item.textContent = entry;
      list.append(item);
    });
  }

  renderList("#built-for-list", status.builtFor);
  renderList("#not-yet-list", status.notYet);

  const roadmap = document.querySelector("#roadmap-list");
  status.milestones.forEach((milestone) => {
    const article = document.createElement("article");
    article.className = `milestone ${milestone.state}`;
    const version = document.createElement("span");
    version.className = "milestone-version";
    version.textContent = `v${milestone.version}`;
    const body = document.createElement("div");
    body.className = "milestone-body";
    const title = document.createElement("h3");
    title.textContent = milestone.name;
    const description = document.createElement("p");
    description.textContent = milestone.description;
    const items = document.createElement("div");
    items.className = "milestone-items";
    milestone.items.forEach((entry) => {
      const chip = document.createElement("span");
      chip.textContent = entry;
      items.append(chip);
    });
    const milestoneStatus = document.createElement("span");
    milestoneStatus.className = "milestone-status";
    milestoneStatus.textContent = milestone.status;
    body.append(title, description, items);
    article.append(version, body, milestoneStatus);
    roadmap.append(article);
  });
})();
