import { warmWorkPreviews } from "./work/warm-previews.js";
import { enhanceDetailCover } from "./work/detail-cover.js";
import { restoreWorkReturn } from "./work/return-position.js";
window.blackboxPages?.register("work-browse", (root, scope) => {
  const cards = [...document.querySelectorAll("[data-work-card]")];
  warmWorkPreviews(cards, scope);
  enhanceDetailCover();
  restoreWorkReturn(cards, scope);
});
