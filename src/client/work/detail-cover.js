import { limited, previewURL } from "./policy.js";
export function enhanceDetailCover() {
  // Keep the browser's native full-cover request and no-JS rendering intact.
  // A cached low-resolution cover occupies the same fixed frame while it loads.
  document.querySelectorAll(".work-cover-frame[data-work-preview]").forEach((frame) => {
    const full = frame.querySelector(".work-cover-full");
    const url = previewURL(frame.dataset.workPreview);
    if (!full || !url || limited() || (full.complete && full.naturalWidth)) return;
    const preview = new Image();
    let fullReady = false;
    preview.className = "work-cover-preview";
    preview.alt = "";
    preview.setAttribute("aria-hidden", "true");
    preview.decoding = "async";
    preview.fetchPriority = "low";
    const revealFull = () => {
      fullReady = true;
      frame.classList.remove("is-previewing");
      preview.remove();
    };
    full.addEventListener("load", revealFull, { once: true });
    preview.addEventListener(
      "load",
      () => {
        if (fullReady || (full.complete && full.naturalWidth)) return revealFull();
        if (preview.naturalWidth) frame.classList.add("is-previewing");
      },
      { once: true },
    );
    preview.addEventListener("error", () => preview.remove(), { once: true });
    frame.append(preview);
    preview.src = url;
    if (full.complete && full.naturalWidth) revealFull();
  });
}
