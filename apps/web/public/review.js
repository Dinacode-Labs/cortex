/* Only an enhancement (ADR-0042): the key hints stay hidden until this runs. */
(() => {
  const decisions = { k: "keep", d: "discard", m: "merge", s: "skip" };
  for (const hint of document.querySelectorAll("[data-key-hint]")) hint.hidden = false;
  document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]")) return;
    const key = event.key.toLowerCase();
    if (key === "r") {
      const rewrite = document.querySelector("[data-rewrite]");
      if (!rewrite) return;
      event.preventDefault();
      rewrite.open = true;
      rewrite.querySelector("textarea")?.focus();
      return;
    }
    const form = decisions[key] && document.querySelector(`form[data-decision="${decisions[key]}"]`);
    if (!form) return;
    event.preventDefault();
    form.requestSubmit();
  });
})();
