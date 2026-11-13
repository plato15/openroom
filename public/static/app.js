// Ask before destructive admin actions. Kept out of inline HTML so the page can forbid inline scripts.
document.addEventListener("submit", (e) => {
  const form = e.target;
  const msg = form instanceof HTMLFormElement ? form.dataset.confirm : null;
  if (msg && !window.confirm(msg)) e.preventDefault();
  // One tap only: stop double submits on slow networks.
  if (!e.defaultPrevented && form instanceof HTMLFormElement) {
    if (form.dataset.sent) e.preventDefault();
    else {
      form.dataset.sent = "1";
      setTimeout(() => delete form.dataset.sent, 8000);
    }
  }
});

// Edit menus close when you click anywhere else, and only one is open at a time.
document.addEventListener("click", (e) => {
  for (const menu of document.querySelectorAll("details.menu[open]")) {
    if (!menu.contains(e.target)) menu.removeAttribute("open");
  }
});
