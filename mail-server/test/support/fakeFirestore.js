// Minimal in-memory Firestore for route tests: get/set/update, equality
// queries and transactions whose writes apply only if the callback succeeds.
export const createFirestore = (seed = {}) => {
  const store = new Map(Object.entries(seed).map(([path, data]) => [path, { ...data }]));
  let autoId = 0;

  const snapshot = (id, data) => ({ exists: data !== undefined, id, data: () => (data === undefined ? undefined : { ...data }) });

  const ref = (collection, id) => ({
    id,
    path: `${collection}/${id}`,
    get: async () => snapshot(id, store.get(`${collection}/${id}`)),
    set: async data => { store.set(`${collection}/${id}`, { ...data }); },
    update: async data => {
      const current = store.get(`${collection}/${id}`);
      if (current === undefined) throw new Error(`missing ${collection}/${id}`);
      store.set(`${collection}/${id}`, { ...current, ...data });
    },
    delete: async () => { store.delete(`${collection}/${id}`); },
  });

  const queryOf = (collection, filters) => ({
    where: (field, operator, value) => {
      if (operator !== '==') throw new Error(`unsupported operator ${operator}`);
      return queryOf(collection, [...filters, [field, value]]);
    },
    get: async () => {
      const docs = [...store.entries()]
        .filter(([path]) => path.startsWith(`${collection}/`) && !path.slice(collection.length + 1).includes('/'))
        .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
        .map(([path, data]) => snapshot(path.slice(collection.length + 1), data));
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  });

  return {
    store,
    collection: name => ({ doc: id => ref(name, id ?? `auto${(autoId += 1)}`), ...queryOf(name, []) }),
    runTransaction: async callback => {
      const writes = [];
      const result = await callback({
        get: reference => reference.get(),
        set: (reference, data) => writes.push(() => reference.set(data)),
        update: (reference, data) => writes.push(() => reference.update(data)),
        delete: reference => writes.push(() => reference.delete()),
      });
      for (const write of writes) await write();
      return result;
    },
  };
};
