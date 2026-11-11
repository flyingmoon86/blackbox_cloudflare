// Public snapshots stay immutable. Unsubmitted filters belong to one history
// entry, and live only in this document; history.state stores an opaque key.
export function createHistoryDrafts() {
  const key = "blackboxNavigationEntry";
  const prefix = String(performance.timeOrigin);
  const entries = new Map();
  let sequence = 0;
  let active;
  const nextKey = () => `${prefix}:${++sequence}`;
  const identify = () => {
    const id = nextKey();
    try {
      history.replaceState({ ...history.state, [key]: id }, "");
    } catch {
      // History tagging is an enhancement; native navigation still works.
    }
    return id;
  };
  const controls = (root) =>
    [...root.querySelectorAll("form[data-navigation-draft]")]
      .filter((form) => form.method === "get")
      .flatMap((form) =>
        [...form.elements]
          .filter(
            (field) => field.name && !field.disabled && ["text", "search", "number", "select-one"].includes(field.type),
          )
          .map((field) => ({ form: form.dataset.navigationDraft, field })),
      );
  active = identify();
  return {
    isCurrent: () => history.state?.[key] === active,
    capture(root, path) {
      const values = controls(root)
        .filter(({ field }) => field.value.length <= 4096)
        .map(({ form, field }) => ({ form, name: field.name, value: field.value }));
      entries.delete(active);
      entries.set(active, { path, values });
      // Bound memory even in a long-lived tab. Older entries keep native defaults.
      if (entries.size > 50) entries.delete(entries.keys().next().value);
    },
    push(url) {
      const id = nextKey();
      history.pushState({ [key]: id }, "", url);
      active = id;
    },
    restore(root, path) {
      active = history.state?.[key] || identify();
      const saved = entries.get(active);
      if (saved?.path !== path) return;
      for (const { form, field } of controls(root)) {
        const value = saved.values.find((value) => value.form === form && value.name === field.name);
        if (value) field.value = value.value;
      }
    },
    clear: () => entries.clear(),
  };
}
