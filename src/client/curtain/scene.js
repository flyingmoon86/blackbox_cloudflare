// Decorative only. The local texture enhances the CSS fabric, but its request
// never participates in loading readiness or holds up the reveal.
export const createCurtainScene = (texture) => {
  const scene = document.createElement("div");
  scene.className = "curtain-scene";
  scene.setAttribute("aria-hidden", "true");
  for (const side of ["left", "right"]) {
    const wing = document.createElement("div");
    wing.className = `curtain-wing curtain-wing-${side}`;
    for (let index = 0; index < 8; index++) {
      const fold = document.createElement("span");
      fold.className = "curtain-fold";
      wing.append(fold);
    }
    if (texture) {
      const cloth = document.createElement("img");
      cloth.className = "curtain-cloth";
      cloth.alt = "";
      cloth.draggable = false;
      cloth.decoding = "async";
      cloth.fetchPriority = "high";
      cloth.addEventListener("error", () => cloth.remove(), { once: true });
      cloth.src = texture;
      wing.append(cloth);
    }
    scene.append(wing);
  }
  const shade = document.createElement("div");
  shade.className = "curtain-atmosphere";
  scene.append(shade);
  return scene;
};
