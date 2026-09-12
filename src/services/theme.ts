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
function mix(hex: string, target: number): string {
  return (
    "#" +
    hex
      .slice(1)
      .match(/../g)!
      .map((x) =>
        Math.round(parseInt(x, 16) * 0.9 + target * 0.1)
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
  return `:root{--brand:${accent};--amber:${dark};--amber-dark:${mix(dark, 0)};--wine:${dark};--brand-light:${light}}
 .button,button{color:#fff}
 a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid var(--amber);outline-offset:3px}
 .top .account-link{color:var(--amber)}
 body:has(.theatre-stage) .top .account-link,.theatre-stage .stage-explore,.theatre-stage .eyebrow{color:var(--brand-light)}
 .theatre-stage a:focus-visible,body:has(.theatre-stage) .top a:focus-visible,body:has(.theatre-stage) .top summary:focus-visible{outline-color:var(--brand-light)}
 .section-tabs a.active{background:var(--amber);color:white}
 .theme-sample{border-left:4px solid var(--brand);padding:16px;background:var(--panel)}`;
}
