(() => {
  const fine = matchMedia("(hover: hover) and (pointer: fine)");
  const inline = matchMedia("(max-width: 900px)");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  document.querySelectorAll(".playbill-recommendation").forEach((row) => {
    const image = row.querySelector(".recommendation-still");
    if (!image) return;
    let frame = 0,
      active = false,
      x = 0,
      y = 0,
      targetX = 0,
      targetY = 0,
      lastTime = 0;
    const paint = () => {
      image.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-50%)`;
    };
    const tick = (time) => {
      frame = 0;
      const dt = Math.min(40, lastTime ? time - lastTime : 16);
      lastTime = time;
      const ease = 1 - Math.exp(-dt / 85);
      x += (targetX - x) * ease;
      y += (targetY - y) * ease;
      paint();
      if (active && Math.hypot(targetX - x, targetY - y) > 0.25) frame = requestAnimationFrame(tick);
    };
    const move = (event) => {
      const bounds = row.getBoundingClientRect();
      const ratio = image.naturalWidth / image.naturalHeight || 1.6;
      const preferredWidth = Math.max(280, Math.min(440, innerWidth * 0.31));
      const width = Math.min(preferredWidth, innerWidth - 32, innerHeight * 0.55 * ratio);
      image.style.setProperty("--preview-width", `${width}px`);
      // The pointer is the image centre on both axes. Do not constrain it to a row corridor.
      targetX = (event?.clientX ?? bounds.left + bounds.width / 2) - bounds.left;
      targetY = (event?.clientY ?? bounds.top + bounds.height / 2) - bounds.top;
      if (!active || reduced.matches) {
        x = targetX;
        y = targetY;
        paint();
      }
      active = true;
      row.classList.add("is-previewing");
      if (!reduced.matches && !frame) {
        lastTime = 0;
        frame = requestAnimationFrame(tick);
      }
    };
    const hide = () => {
      active = false;
      cancelAnimationFrame(frame);
      frame = 0;
      row.classList.remove("is-previewing");
    };
    row.addEventListener("pointerenter", (event) => {
      if (fine.matches && !inline.matches && event.pointerType !== "touch") move(event);
    });
    row.addEventListener("pointermove", (event) => {
      if (fine.matches && !inline.matches && event.pointerType !== "touch") move(event);
    });
    row.addEventListener("pointerleave", hide);
    row.addEventListener("pointercancel", hide);
    row.addEventListener("focusin", () => {
      if (fine.matches && !inline.matches) move();
    });
    row.addEventListener("focusout", hide);
    image.addEventListener("error", () => {
      hide();
      image.hidden = true;
    });
    if (image.complete && !image.naturalWidth) image.hidden = true;
    fine.addEventListener("change", hide);
    inline.addEventListener("change", hide);
    reduced.addEventListener("change", hide);
    window.addEventListener("blur", hide);
    window.addEventListener("resize", hide);
    document.querySelector("#playbill")?.addEventListener("scroll", hide, { passive: true });
    new MutationObserver(() => {
      if (row.closest(".stage-scene").hidden) hide();
    }).observe(row.closest(".stage-scene"), { attributes: true, attributeFilter: ["hidden"] });
  });
})();
