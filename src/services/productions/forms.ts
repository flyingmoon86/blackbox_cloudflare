export function selectedResourceIds(form: FormData): number[] | null {
  const ids = [...new Set(form.getAll("resource_ids").map(Number))];
  return ids.every((id) => Number.isInteger(id) && id > 0) ? ids : null;
}

export function hiddenValue(form: FormData): number | null {
  if (!form.has("is_hidden")) return null; // Old forms must not silently unhide a work.
  const values = form.getAll("is_hidden");
  if (values.length !== 1 || !["0", "1"].includes(String(values[0]))) return NaN;
  return Number(values[0]);
}
