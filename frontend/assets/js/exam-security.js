(function initExamSecurity() {
  document.body.classList.add("exam-secure");

  function blockEvent(e) {
    e.preventDefault();
    return false;
  }

  ["copy", "cut", "paste", "contextmenu", "selectstart", "dragstart"].forEach((eventName) => {
    document.addEventListener(eventName, blockEvent);
  });

  document.addEventListener("keydown", (e) => {
    const key = (e.key || "").toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (["c", "x", "v", "a", "s", "p"].includes(key)) {
        blockEvent(e);
      }
    }
  });
})();
