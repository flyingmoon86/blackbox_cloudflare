import { escapeHtml as e, layout } from "../views";
import type { UserSession } from "../types";
import { stageArt, stageAssets, stageAttributes } from "./stage-art";
import { assetUrl } from "./assets";

export type Contributor = {
  id: number;
  display_name: string;
  member_name: string;
  member_id: number | null;
  username: string | null;
};

export function thanksPage(
  special: string,
  troupe: string,
  contributors: Contributor[],
  user?: UserSession | null,
): string {
  const admin = user?.role === "admin";
  const cards = contributors
    .map(
      (person) =>
        `<article class="thanks-person"><h3>${
          person.member_id
            ? `<a href="/members/${person.member_id}">${e(person.member_name)}</a>`
            : e(person.username || person.display_name)
        }</h3>${person.member_id ? `<small>${e(person.username || person.display_name)}</small>` : ""}</article>`,
    )
    .join("");
  return layout(
    "鸣谢",
    stageAssets() +
      `<link rel="stylesheet" href="${assetUrl("/thanks.css")}"><div class="theatre-stage thanks-stage" ${stageAttributes("thanks")}>${stageArt("thanks")}<section class="stage-scene thanks-scene thanks-dedication" id="dedication" aria-labelledby="dedication-title"><div class="special-thanks"><span class="eyebrow">WITH LOVE</span><h1 id="dedication-title">特别致谢</h1>${special ? `<div class="thanks-letter">${e(special)}</div>` : ""}<p class="thanks-signature">${e(troupe)}</p>${admin ? '<a class="thanks-edit" href="/admin/site#special_thanks">编辑特别致谢 ↗</a>' : ""}</div><footer class="thanks-scene-footer"><span class="thanks-act" aria-hidden="true">01 / 02</span><a class="thanks-next" href="#contributors">向下浏览 · 网站贡献者 <span aria-hidden="true">↓</span></a></footer></section><section class="stage-scene thanks-scene thanks-contributors" id="contributors" aria-labelledby="contributors-title"><div class="thanks-contributors-inner"><header class="thanks-contributors-heading"><p class="eyebrow">BEHIND THE SCENES</p><h2 id="contributors-title">网站贡献者</h2><p>感谢一起完善黑匣子的你。</p><a href="/feedback">留下建议 ↗</a></header><div class="thanks-grid" data-paginate="12">${cards || '<p class="thanks-empty">等待第一份心意。</p>'}</div><footer class="thanks-scene-footer"><span class="thanks-act" aria-hidden="true">02 / 02</span><a href="#dedication">回到特别致谢 ↑</a></footer></div></section><nav class="scene-nav" aria-label="鸣谢场景"><a href="#dedication">特别致谢</a><span></span><a href="#contributors">贡献者</a></nav></div>`,
    Boolean(user),
    admin,
  );
}
