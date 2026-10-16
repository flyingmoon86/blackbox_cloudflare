const sameOrigin = (value, base) => {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return url.origin === location.origin ? url.href : null;
  } catch {
    return null;
  }
};
const allowedImage = (href) => {
  const url = new URL(href);
  return (
    /^\/assets\/[^/]+\.(?:png|jpe?g|webp|avif)$/.test(url.pathname) ||
    /^\/site\/stage-image\/(?:home|productions|members|thanks)\/(?:unlit|light)$/.test(url.pathname) ||
    (/^\/productions\/\d+\/cover$/.test(url.pathname) && url.searchParams.get("size") === "preview") ||
    (/^\/members\/\d+\/avatar$/.test(url.pathname) && !url.search) ||
    /^\/resources\/\d+\/preview$/.test(url.pathname) ||
    /^\/site\/(?:featured-cover|poster)$/.test(url.pathname)
  );
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
export const describe = (root, url) => {
  const present = new Set(
    [...document.querySelectorAll('link[rel="stylesheet"],script[src]')].map((node) => node.href || node.src),
  );
  const styles = [...root.querySelectorAll('link[rel="stylesheet"][href]')]
    .map((node) => sameOrigin(node.getAttribute("href"), url))
    .filter((href) => href && new URL(href).pathname.endsWith(".css") && !present.has(href));
  const scripts = [...root.querySelectorAll("script[src]")]
    .map((node) => sameOrigin(node.getAttribute("src"), url))
    .filter((href) => href && /^\/assets\/[^/]+\.js$/.test(new URL(href).pathname) && !present.has(href));
  const imageNodes = [
    ...root.querySelectorAll("img[data-theatre-base],img[data-theatre-light]"),
    ...[
      ...root.querySelectorAll(".production-stage-image,.production-cover,.member-card-media,.resource-card img"),
    ].slice(0, 4),
  ];
  if (new URL(url).pathname === "/") {
    imageNodes.push(...[...root.querySelectorAll(".recommendation-still")].slice(0, 3));
    imageNodes.push(...[...root.querySelectorAll(".playbill-art img")].slice(0, 1));
  }
  const images = imageNodes.map((node) => imageSource(node, url)).filter((href) => href && allowedImage(href));
  const text = [...root.querySelectorAll("h1,h2,.playbill-recommendation strong")]
    .map((node) => node.textContent)
    .join("")
    .slice(0, 256);
  return {
    styles: [...new Set(styles)].slice(0, 8),
    scripts: [...new Set(scripts)].slice(0, 8),
    images: [...new Set(images)].slice(0, 10),
    text,
  };
};
