// Generated from src/client/credit-forms.js by npm run assets:build. Do not edit this output.
"use strict";
(() => {
  // src/client/credit-forms.js
  for (const form of document.querySelectorAll(".batch-credit-form")) {
    const rows = form.querySelector("[data-credit-rows]");
    const initialize = (row) => {
      const select = row.querySelector('[name="member_id"]'), input = row.querySelector("[data-member-search]");
      const options = [...select.options].map((o) => o.cloneNode(true));
      input.addEventListener("input", () => {
        const value = select.value, q = input.value.trim().toLocaleLowerCase();
        select.replaceChildren(
          ...options.filter((o) => !o.value || o.textContent.toLocaleLowerCase().includes(q)).map((o) => o.cloneNode(true))
        );
        select.value = [...select.options].some((o) => o.value === value) ? value : "";
      });
      row.querySelector("[data-remove-credit]").addEventListener("click", () => {
        if (rows.children.length > 1) row.remove();
      });
    };
    rows.querySelectorAll("[data-credit-row]").forEach(initialize);
    form.querySelector("[data-add-credit]").addEventListener("click", () => {
      if (rows.children.length >= 50) return;
      const row = form.querySelector("template").content.firstElementChild.cloneNode(true);
      rows.append(row);
      initialize(row);
      row.querySelector("input").focus();
    });
  }
})();
