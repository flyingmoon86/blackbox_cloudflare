export const connection = navigator.connection;
export const limited = () =>
  navigator.onLine === false || connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || "");
export const previewURL = (value) => {
  try {
    const url = new URL(value, location.href);
    if (
      url.origin !== location.origin ||
      !/^\/productions\/\d+\/cover$/.test(url.pathname) ||
      url.searchParams.get("size") !== "preview" ||
      url.searchParams.get("previewOnly") !== "1" ||
      !/^\d+$/.test(url.searchParams.get("v") || "")
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
};
