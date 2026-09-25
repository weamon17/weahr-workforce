// Pure attendance rules shared by the attendance routes and unit tests.

export const vietnamDateAndTime = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${String(Number(parts.hour) % 24).padStart(2, '0')}:${parts.minute}`,
  };
};

export const previousDate = dateString => {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};

export const parseMinutes = value => {
  const [hours, minutes] = String(value || '00:00').split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
};

export const checkInDeltaMinutes = ({ scheduleDate, startTime, attemptedDate, attemptedTime }) => {
  const scheduled = new Date(`${scheduleDate}T${startTime || '00:00'}:00.000Z`);
  const attempted = new Date(`${attemptedDate}T${attemptedTime}:00.000Z`);
  return (attempted.getTime() - scheduled.getTime()) / 60000;
};

export const isCheckInWithinWindow = ({
  scheduleDate,
  startTime,
  attemptedDate,
  attemptedTime,
  earlyMinutes = 30,
  lateMinutes = 120,
}) => {
  const delta = checkInDeltaMinutes({ scheduleDate, startTime, attemptedDate, attemptedTime });
  return Number.isFinite(delta) && delta >= -earlyMinutes && delta <= lateMinutes;
};

export const isValidCoordinate = (latitude, longitude) => Number.isFinite(latitude)
  && Number.isFinite(longitude)
  && latitude >= -90 && latitude <= 90
  && longitude >= -180 && longitude <= 180;

export const distanceMeters = (lat1, lon1, lat2, lon2) => {
  const toRadians = value => value * Math.PI / 180;
  const radius = 6371000;
  const latDelta = toRadians(lat2 - lat1);
  const lonDelta = toRadians(lon2 - lon1);
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(lonDelta / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const deriveOvertimeHours = ({
  workHours,
  employeeType,
  workScheduleMode,
  standardHoursPerDay = 8,
  fixedOvertimeHours = 0,
}) => {
  const hours = Math.max(0, Number(workHours) || 0);
  const standardHours = Math.max(1, Number(standardHoursPerDay) || 8);
  if (employeeType === 'fulltime' && workScheduleMode === 'rotating') {
    return Math.max(0, hours - standardHours);
  }
  return Math.max(0, Number(fixedOvertimeHours) || 0);
};

export const calculateAttendanceHours = ({ checkInAt, checkOutAt, schedule, employeeProfile = {} }) => {
  const workHours = Math.max(0, (checkOutAt.getTime() - checkInAt.getTime()) / 3600000);
  const localCheckIn = vietnamDateAndTime(checkInAt);
  const localCheckOut = vietnamDateAndTime(checkOutAt);
  const scheduledStart = parseMinutes(schedule?.startTime);
  let scheduledEnd = parseMinutes(schedule?.endTime);
  const actualStart = parseMinutes(localCheckIn.time);
  let actualEnd = parseMinutes(localCheckOut.time);
  if (scheduledEnd <= scheduledStart) scheduledEnd += 1440;
  if (actualEnd <= actualStart || localCheckOut.date !== localCheckIn.date) actualEnd += 1440;
  const scheduleMode = employeeProfile.workScheduleMode
    || (employeeProfile.standardStart && employeeProfile.standardEnd ? 'fixed' : 'rotating');
  const overtime = deriveOvertimeHours({
    workHours,
    employeeType: employeeProfile.employeeType,
    workScheduleMode: scheduleMode,
    standardHoursPerDay: employeeProfile.standardHoursPerDay,
    fixedOvertimeHours: Math.max(0, actualEnd - scheduledEnd) / 60,
  });
  return {
    workHours: Number(workHours.toFixed(2)),
    lateHours: Number((Math.max(0, actualStart - scheduledStart) / 60).toFixed(2)),
    otHours: Number(overtime.toFixed(2)),
    otCalculationMode: employeeProfile.employeeType === 'fulltime' ? scheduleMode : 'hourly',
  };
};
