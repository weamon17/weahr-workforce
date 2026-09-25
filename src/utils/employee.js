export const safeEmployeeDocumentPart = value => String(value || '')
  .replace(/[ĐÐ]/g, 'D')
  .replace(/đ/g, 'd')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9_-]/g, '_');

export const buildEmployeeDocumentId = (organizationId, identity) => {
  const tenant = safeEmployeeDocumentPart(organizationId);
  const employee = safeEmployeeDocumentPart(identity);
  if (!tenant || !employee) throw new Error('organizationId and employee identity are required');
  return `${tenant}_${employee}`;
};

const uniqueKey = (directory, name, hint) => {
  if (!directory[name]) return name;
  const base = `${name} (${hint})`;
  let key = base;
  for (let index = 2; directory[key]; index += 1) key = `${base} ${index}`;
  return key;
};

// Builds the manager's name-keyed employee map without letting two people who
// share a full name overwrite each other. HR records are linked to accounts by
// UID first; a name match is only used for records not yet linked to anyone.
export const buildEmployeeDirectory = (employeeDocs = [], profileDocs = []) => {
  const directory = {};
  employeeDocs.forEach(({ id, data }) => {
    const name = data.fullName || data.name || id;
    const key = uniqueKey(directory, name, data.employeeCode || id.slice(-6));
    directory[key] = { ...data, employeeDocumentId: id };
  });

  profileDocs.forEach(({ id, data: profile }) => {
    if (!profile.fullName) return;
    const linkedKey = Object.keys(directory).find(key => directory[key].employeeId === id)
      || (directory[profile.fullName] && !directory[profile.fullName].employeeId ? profile.fullName : null);
    const existing = linkedKey ? directory[linkedKey] : {};
    if (profile.employmentStatus === 'resigned' && !existing.employeeDocumentId) return;
    const key = linkedKey
      || uniqueKey(directory, profile.fullName, profile.employeeCode || id.slice(0, 6));
    directory[key] = {
      ...profile,
      ...existing,
      employeeId: id,
      userId: id,
      type: existing.type || profile.employeeType || 'parttime',
    };
  });
  return directory;
};
