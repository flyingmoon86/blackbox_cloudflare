import { warmWorkPreviews } from "./work/warm-previews.js";
import { enhanceDetailCover } from "./work/detail-cover.js";
import { installListReturn } from "./shared/list-return.js";
window.blackboxPages?.register("work-browse", (root, scope) => {
  const cards = [...document.querySelectorAll("[data-work-card]")];
  warmWorkPreviews(cards, scope);
  enhanceDetailCover();
  installListReturn(root || document, scope, {
    storageKey: "blackbox-work-return:v1",
    listPath: "/productions",
    cardSelector: "[data-work-card]",
    returnSelector: "[data-work-return]",
    detailPath: /^\/productions\/\d+$/,
    restoreHref: true,
  });
});
