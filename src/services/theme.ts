export const DEFAULT_ACCENT = "#536c57";
export const validAccent = (value: string): boolean => /^#[0-9a-f]{6}$/i.test(value);
function luminance(hex: string): number {
  const rgb = hex
    .slice(1)
    .match(/../g)!
    .map((x) => parseInt(x, 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function mix(hex: string, target: number, amount = 0.1): string {
  return (
    "#" +
    hex
      .slice(1)
      .match(/../g)!
      .map((x) =>
        Math.round(parseInt(x, 16) * (1 - amount) + target * amount)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
export function themeCss(input: string): string {
  const accent = validAccent(input) ? input.toLowerCase() : DEFAULT_ACCENT;
  let dark = accent,
    light = accent;
  for (let i = 0; i < 40 && luminance(dark) > 0.14; i++) dark = mix(dark, 0);
  for (let i = 0; i < 40 && luminance(light) < 0.6; i++) light = mix(light, 255);
  const paper = mix(accent, 255, 0.88);
  const panel = mix(accent, 255, 0.97);
  const surface = mix(accent, 255, 0.8);
  const ink = mix(dark, 0, 0.55);
  const muted = mix(dark, 0, 0.12);
  const stage = mix(dark, 0, 0.76);
  const stagePanel = mix(dark, 0, 0.62);
  return `:root{--brand:${accent};--amber:${dark};--amber-dark:${mix(dark, 0)};--wine:${dark};--brand-light:${light};--paper:${paper};--panel:${panel};--ink:${ink};--muted:${muted};--line:${mix(accent, 255, 0.6)};--surface:${surface};--stage:${stage};--stage-panel:${stagePanel};--shadow:0 12px 36px ${stage}18}
 html,body{background:var(--paper);color:var(--ink)}
 body::after{background:linear-gradient(180deg,${paper}dc,${surface}c7)}
 .card,.card .card,.table-wrap,.guide-jumps,.section-tabs,.admin-command-group,.notification-card,dialog{background:var(--panel);border-color:var(--line);color:var(--ink)}
 input,textarea,select{background:var(--panel);border-color:var(--line);color:var(--ink);accent-color:var(--amber)}
 input:focus,textarea:focus,select:focus{border-color:var(--amber)}
 .button,button{background:var(--amber);color:#fff}
 .button:hover,button:hover{background:var(--amber-dark)}
 .secondary,.notification-more{background:var(--stage-panel);color:#fff}.secondary:hover{background:var(--stage)}
 .danger{background:#b42318}.danger:hover{background:#8f190f}
 .link-button,.link-button:hover{background:transparent;color:var(--wine)}
 .top{--nav-surface:var(--panel);--nav-text:var(--ink);--nav-muted:var(--muted);background:${panel}f2;color:var(--ink)}
 .top .brand,.top .desktop-nav>a,.top .nav-menu>summary{color:var(--nav-text)}
 .top .nav-panel,.top .desktop-nav.is-open{background:var(--nav-surface)}
 .top nav a:hover{color:var(--amber)}
 .top .menu-toggle,.top .menu-toggle:hover{background:transparent;color:var(--nav-text)}
 .admin-notification-menu>summary{color:var(--nav-text);border-color:var(--nav-muted)}
 .admin-notification-menu>summary>span:first-child{color:var(--amber)}
 .admin-notification-menu>summary strong{color:#fff}
 .guide-jumps a,.admin-guide-links a,.role-badge,.pending-roles span{background:var(--surface);color:var(--wine)}
 .section-tabs a,.choice-tabs a{color:var(--ink);border-color:var(--line)}
 .section-tabs a.active,.choice-tabs a.active{background:var(--amber);color:#fff}
 .admin-command-group.urgent{background:var(--stage);color:var(--panel)}
 .admin-command-group nav a:hover{background:var(--surface)}
 .admin-command-group.urgent nav a:hover{background:var(--stage-panel)}
 .resource-card{background:var(--stage-panel);border-color:var(--line)}
 .resource-card-shade{background:linear-gradient(0deg,${stage}f2,${stage}20 72%)}
 .resource-card-copy .eyebrow,.member-card-copy .eyebrow{color:var(--brand-light)}
 .resource-card-copy>span:last-child{color:var(--panel)}
 .member-card-art{background:radial-gradient(circle at 50% 32%,var(--amber),var(--stage) 68%)}
 .contributor-tag{color:var(--panel);background:var(--stage-panel);border-color:var(--brand-light)}
 .profile-detail .contributor-tag{color:var(--wine);background:var(--surface)}
 .mobile-nav,.mobile-more nav{background:${stage}f5;border-color:var(--stage-panel)}
 .mobile-nav a,.mobile-more nav a{color:var(--panel)}
 .mobile-nav a[aria-current=page]{background:var(--amber);color:#fff}
 body:has(.theatre-stage),.theatre-stage{background:var(--stage);color:var(--panel)}
 body:has(.theatre-stage) .top{--nav-surface:var(--stage-panel);--nav-text:var(--panel);--nav-muted:var(--brand-light);background:${stagePanel}f2}
 body.navigation-open .top{background:var(--nav-surface)}
 .stage-shade{background:linear-gradient(90deg,${stage}e8,${stage}38 75%),linear-gradient(0deg,${stage}c9,transparent 55%)}
 .stage-scene{color:var(--panel)}
 .stage-welcome,.stage-feature p,.about-columns p,.theatre-stage .edit-link,.stage-news span{color:var(--brand-light)}
 .stage-feature,.stage-contact{border-color:${light}66}
 .theatre-stage .top .brand,body:has(.theatre-stage) .brand,body:has(.theatre-stage) .desktop-nav>a,body:has(.theatre-stage) .nav-menu>summary{color:var(--nav-text)}
 body:has(.theatre-stage) .top nav a:hover{color:var(--brand-light)}
 .nav-scrim{background:${stage}2c}dialog::backdrop{background:${stage}99}
 a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid var(--amber);outline-offset:3px}
 .top .account-link{color:var(--amber)}
 body:has(.theatre-stage) .top .account-link,.theatre-stage .stage-explore,.theatre-stage .eyebrow{color:var(--brand-light)}
 .theatre-stage a:focus-visible,body:has(.theatre-stage) .top a:focus-visible,body:has(.theatre-stage) .top summary:focus-visible{outline-color:var(--brand-light)}
 .theme-sample{border-left:4px solid var(--brand);padding:16px;background:var(--panel)}`;
}
