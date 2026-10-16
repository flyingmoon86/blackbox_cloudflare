import { warmWorkPreviews } from "./work/warm-previews.js";
import { enhanceDetailCover } from "./work/detail-cover.js";
import { restoreWorkReturn } from "./work/return-position.js";
const cards = [...document.querySelectorAll("[data-work-card]")];
warmWorkPreviews(cards);
enhanceDetailCover();
restoreWorkReturn(cards);
