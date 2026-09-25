// Positions double as schedulable skills. Values are stored in Firestore, so
// they must stay stable; labels come from the translation files.
export const POSITION_OPTIONS = [
  { value: 'Phục vụ', labelKey: 'employee_extra.pos_waiter' },
  { value: 'Pha chế', labelKey: 'employee_extra.pos_barista' },
  { value: 'Phụ bếp', labelKey: 'employee_extra.pos_kitchen' },
  { value: 'Thu ngân', labelKey: 'employee_extra.pos_cashier' },
  { value: 'Quản lý ca', labelKey: 'employee_extra.pos_shift_mgr' },
  { value: 'Khác', labelKey: 'employee_extra.pos_other' },
];

// The position is always one of the employee's skills; extra skills follow it.
export const normalizeSkills = (position, skills = []) => [...new Set(
  [position, ...skills].map(value => String(value || '').trim()).filter(Boolean),
)];

// Skills exactly as stored on the profile. Security rules compare submitted
// skills to this value, so it must not be reordered or rewritten here.
export const employeeSkills = profile => (Array.isArray(profile?.skills)
  ? profile.skills
  : [profile?.position].filter(Boolean));

export const hasSkill = (skills, requiredSkill) => {
  const required = String(requiredSkill || '').trim().toLowerCase();
  return !required || skills.some(skill => String(skill).trim().toLowerCase() === required);
};
