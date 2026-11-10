// Setup steps a new shop goes through before WeaHR is useful day to day.
// `tab` is the manager tab that completes the step.
export const ONBOARDING_STEPS = [
  { key: 'location', tab: 'timesheet', required: true },
  { key: 'shifts', tab: 'schedule', required: true },
  { key: 'invite', tab: 'organization', required: true },
  { key: 'first_checkin', tab: 'timesheet', required: true },
  { key: 'sales', tab: 'insights', required: false },
];

const hasCoordinate = value => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value));

export const buildOnboardingSteps = ({
  attendanceSettings = null,
  scheduleSettings = null,
  invitationCount = 0,
  employeeCount = 0,
  records = [],
  salesCount = 0,
} = {}) => {
  const done = {
    location: hasCoordinate(attendanceSettings?.latitude) && hasCoordinate(attendanceSettings?.longitude),
    shifts: (scheduleSettings?.shiftTemplates || []).length > 0,
    invite: invitationCount > 0 || employeeCount > 0,
    first_checkin: records.some(record => record.secureAttendance),
    sales: salesCount > 0,
  };
  const steps = ONBOARDING_STEPS.map(step => ({ ...step, done: done[step.key] }));
  const required = steps.filter(step => step.required);
  return {
    steps,
    completed: required.filter(step => step.done).length,
    total: required.length,
    allRequiredDone: required.every(step => step.done),
    nextStep: steps.find(step => !step.done) || null,
  };
};
