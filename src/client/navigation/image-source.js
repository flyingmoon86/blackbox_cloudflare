const sameOrigin = (value, base) => {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return url.origin === location.origin ? url.href : null;
  } catch {
    return null;
  }
};
export const imageSource = (node, base) => {
  // Built-in stage pictures use one URL per media source. Select the same
  // source as the browser; warming img.src alone downloads the desktop pair
  // again on phones. Inert destination HTML has no currentSrc yet.
  const picture = node.parentElement?.tagName === "PICTURE" ? node.parentElement : null;
  const source =
    picture &&
    [...picture.querySelectorAll("source[media][srcset]")].find(
      (item) => matchMedia(item.getAttribute("media")).matches,
    );
  const candidate = source?.getAttribute("srcset")?.trim();
  const selected = candidate && !/[\s,]/.test(candidate) ? candidate : node.currentSrc || node.getAttribute("src");
  return sameOrigin(selected, base);
};
