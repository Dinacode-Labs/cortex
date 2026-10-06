(() => {
  const form = document.querySelector("form[data-bulk-select]");
  if (!form) return;
  const boxes = [...form.querySelectorAll('input[name="ids"]')];
  const blockBoxes = [...form.querySelectorAll('input[name="blocks"]')];
  const count = form.querySelector("[data-selected-count]");
  const toggle = form.querySelector("[data-select-toggle]");
  const submit = form.querySelector("[data-purge-selected]");
  const cardsIn = (block) => [...block.closest("section").querySelectorAll('input[name="ids"]')];
  const blockOf = (card) => card.closest("section")?.querySelector('input[name="blocks"]');

  const refresh = () => {
    const selected = boxes.filter((b) => b.checked).length;
    const wholeBlocks = blockBoxes.filter((b) => b.checked);
    const pastThePage = wholeBlocks.some((b) => b.hasAttribute("data-truncated"));
    count.textContent = pastThePage ? `${selected} selected, and the rest of a block past this page` : `${selected} selected`;
    count.hidden = false;
    submit.disabled = selected === 0 && wholeBlocks.length === 0;
    toggle.textContent = selected === boxes.length ? "Clear selection" : "Select all visible";
  };

  toggle.addEventListener("click", (event) => {
    event.preventDefault();
    const tickAll = !boxes.every((b) => b.checked);
    for (const b of boxes) b.checked = tickAll;
    if (!tickAll) for (const b of blockBoxes) b.checked = false;
    refresh();
  });
  form.addEventListener("change", (event) => {
    const box = event.target;
    if (box.name === "blocks") for (const card of cardsIn(box)) card.checked = box.checked;
    // A ticked block means all of it, past the page too; leaving one card out makes that untrue.
    if (box.name === "ids" && !box.checked) {
      const block = blockOf(box);
      if (block) block.checked = false;
    }
    refresh();
  });
  refresh();
})();
