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

// First-time setup. The pages work without this; it adds the small touches.
// Colours are set through the DOM, which the page's security policy allows (inline style attributes are not).

// The code box continues by itself once six digits are typed or pasted.
const codeBox = document.querySelector("input.code-input");
if (codeBox instanceof HTMLInputElement) {
  codeBox.addEventListener("input", () => {
    codeBox.value = codeBox.value.replace(/\D/g, "").slice(0, 6);
    if (codeBox.value.length === 6 && codeBox.form) codeBox.form.requestSubmit();
  });
}

// Show or hide a pasted key.
document.addEventListener("click", (e) => {
  const t = e.target instanceof Element ? e.target.closest("[data-reveal]") : null;
  if (!(t instanceof HTMLElement)) return;
  const input = document.getElementById(t.dataset.reveal || "");
  if (!(input instanceof HTMLInputElement)) return;
  input.type = input.type === "password" ? "text" : "password";
  t.textContent = input.type === "password" ? "Show" : "Hide";
});

// Colour swatches fill the colour box they belong to.
for (const s of document.querySelectorAll("[data-swatch]")) {
  if (!(s instanceof HTMLElement)) continue;
  s.style.background = s.dataset.swatch || "";
  s.hidden = false;
}
document.addEventListener("click", (e) => {
  const s = e.target instanceof Element ? e.target.closest("[data-swatch]") : null;
  if (!(s instanceof HTMLElement)) return;
  const input = document.querySelector(`input[name="${s.dataset.for}"]`);
  if (!(input instanceof HTMLInputElement)) return;
  input.value = (s.dataset.swatch || "").toLowerCase();
  input.dispatchEvent(new Event("input", { bubbles: true }));
});

// Live preview of the header and buttons while choosing the brand.
const preview = document.querySelector("[data-preview]");
const brandForm = preview ? preview.closest("form") : null;
if (preview && brandForm) {
  const $ = (sel) => preview.querySelector(sel);
  const field = (name) => brandForm.querySelector(`[name="${name}"]`);
  const update = () => {
    const name = (field("name")?.value || "").trim() || "Your company";
    const color = field("color")?.value;
    const dark = field("dark")?.value;
    $("[data-pv-name]").textContent = name;
    $("[data-pv-room]").textContent = `${name} data room`;
    if (dark) $("[data-pv-bar]").style.background = dark;
    if (color) {
      $("[data-pv-btn]").style.background = color;
      const finish = brandForm.querySelector(".brand-actions .btn");
      if (finish) finish.style.background = color;
    }
    for (const s of brandForm.querySelectorAll("[data-swatch]")) {
      const input = field(s.dataset.for);
      s.setAttribute("aria-pressed", String(!!input && input.value.toLowerCase() === (s.dataset.swatch || "").toLowerCase()));
    }
  };
  brandForm.addEventListener("input", update);
  const logo = field("logo");
  if (logo instanceof HTMLInputElement) {
    logo.addEventListener("change", () => {
      const file = logo.files && logo.files[0];
      const img = $("[data-pv-logo]");
      const label = brandForm.querySelector(".drop-text strong");
      if (!file || file.size > 512 * 1024) return;
      if (label) label.textContent = file.name;
      const reader = new FileReader();
      reader.onload = () => {
        img.src = String(reader.result);
        img.hidden = false;
        $("[data-pv-name]").hidden = true;
      };
      reader.readAsDataURL(file);
    });
  }
  update();
}

// "Upload your version" on a template placeholder: choosing the file is the whole action.
document.addEventListener("change", (e) => {
  const input = e.target;
  if (input instanceof HTMLInputElement && input.type === "file" && input.hasAttribute("data-autosubmit") && input.files?.length && input.form) {
    input.form.requestSubmit();
  }
});
