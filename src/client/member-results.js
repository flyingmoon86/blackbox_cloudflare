import { installListReturn } from "./shared/list-return.js";

window.blackboxPages.register("member-results", (root, scope) => {
  installListReturn(root, scope, {
    storageKey: "blackbox-member-return:v1",
    listPath: "/members",
    cardSelector: ".member-card-link",
    returnSelector: "[data-member-return]",
    detailPath: /^\/members\/\d+$/,
    listKey(url) {
      const params = new URLSearchParams(url.search);
      if (!params.get("page")) params.set("page", "1");
      for (const name of ["q", "year"]) if (!params.get(name)) params.delete(name);
      params.sort();
      return url.pathname + "?" + params + url.hash;
    },
  });
});
