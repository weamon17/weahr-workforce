import { collection, getDocs, query, where } from 'firebase/firestore';

// Months of timesheets and schedules loaded when a manager opens the app.
// Older months are fetched on demand when a screen asks for them.
export const HISTORY_MONTHS = 3;

// First day (YYYY-MM-DD) of the month `monthsBack` months before `date`.
export const monthStart = (date = new Date(), monthsBack = 0) => {
  const first = new Date(date.getFullYear(), date.getMonth() - monthsBack, 1);
  return `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-01`;
};

const DATE_FIELDS = { timesheets: 'date', schedules: 'workDate' };

const withinRange = (value, from, before) => {
  const text = String(value || '');
  return (!from || text >= from) && (!before || text < before);
};

// Loads a tenant's dated documents in [from, before). If the composite index
// has not been deployed yet, falls back to an unfiltered read so the app keeps
// working during a rollout.
export const loadDatedDocuments = async (db, collectionName, organizationId, { from, before } = {}) => {
  const field = DATE_FIELDS[collectionName];
  const tenant = where('organizationId', '==', organizationId);
  const constraints = [
    tenant,
    ...(from ? [where(field, '>=', from)] : []),
    ...(before ? [where(field, '<', before)] : []),
  ];
  try {
    const snapshot = await getDocs(query(collection(db, collectionName), ...constraints));
    return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  } catch (error) {
    if (error?.code !== 'failed-precondition') throw error;
    console.warn(`Missing Firestore index for ${collectionName}.${field}; loading without a date filter.`);
    const snapshot = await getDocs(query(collection(db, collectionName), tenant));
    return snapshot.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .filter(item => withinRange(item[field], from, before));
  }
};

// Adds newly loaded documents without overwriting ones already in memory,
// which may carry unsaved local edits.
export const mergeById = (current, incoming) => {
  const byId = new Map(current.map(item => [item.id, item]));
  incoming.forEach(item => {
    if (!byId.has(item.id)) byId.set(item.id, item);
  });
  return [...byId.values()];
};
