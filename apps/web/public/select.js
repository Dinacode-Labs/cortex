// Progressive enhancement for the entry selection on a project's Memory screen. Without this
// script the form still works: the count is simply not shown and "Select all visible" reloads.
(() => {
  const form = document.querySelector("form[data-bulk-select]");
  if (!form) return;
  const boxes = [...form.querySelectorAll('input[name="ids"]')];
  const count = form.querySelector("[data-selected-count]");
  const toggle = form.querySelector("[data-select-toggle]");
  const submit = form.querySelector('button[type="submit"]');

  const refresh = () => {
    const selected = boxes.filter((b) => b.checked).length;
    count.textContent = `${selected} selected`;
    count.hidden = false;
    submit.disabled = selected === 0;
    toggle.textContent = selected === boxes.length ? "Clear selection" : "Select all visible";
  };

  toggle.addEventListener("click", (event) => {
    event.preventDefault();
    const tickAll = !boxes.every((b) => b.checked);
    for (const b of boxes) b.checked = tickAll;
    refresh();
  });
  form.addEventListener("change", refresh);
  refresh();
})();
