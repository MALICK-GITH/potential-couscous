(function initGuideAccordion() {
  const mobile = window.matchMedia("(max-width: 700px)");
  const panels = Array.from(document.querySelectorAll(".panel"));

  function buildPanel(panel) {
    if (!mobile.matches) {
      panel.classList.remove("is-collapsible", "collapsed");
      const body = panel.querySelector(":scope > .panel-body");
      if (body) {
        while (body.firstChild) panel.appendChild(body.firstChild);
        body.remove();
      }
      return;
    }

    const h2 = panel.querySelector(":scope > h2");
    if (!h2) return;
    if (panel.querySelector(":scope > .panel-body")) return;

    panel.classList.add("is-collapsible");
    const body = document.createElement("div");
    body.className = "panel-body";
    while (h2.nextSibling) {
      body.appendChild(h2.nextSibling);
    }
    panel.appendChild(body);
  }

  function bindPanel(panel, index) {
    const h2 = panel.querySelector(":scope > h2");
    if (!h2 || h2.dataset.bindAccordion === "1") return;
    h2.dataset.bindAccordion = "1";
    if (mobile.matches && index > 0) panel.classList.add("collapsed");
    h2.addEventListener("click", () => {
      if (!mobile.matches) return;
      panel.classList.toggle("collapsed");
    });
  }

  function refresh() {
    panels.forEach((panel) => buildPanel(panel));
    panels.forEach((panel, idx) => bindPanel(panel, idx));
  }

  refresh();
  mobile.addEventListener("change", refresh);
})();

