// Rules for manager-entered attendance. The server normalizes every manual
// record, computes worked hours itself and describes each edit for the audit log.

export const EDITABLE_FIELDS = Object.freeze([
  'employeeId',
  'employeeName',
  'type',
  'date',
  'status',
  'dayRate',
  'checkIn',
  'checkOut',
  'workHours',
  'otHours',
  'otCalculationMode',
  'lateHours',
]);

export const MIN_REASON_LENGTH = 5;

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class TimesheetInputError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const fail = (code, message) => { throw new TimesheetInputError(code, message); };

const boundedNumber = (value, minimum, maximum, label) => {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    fail('invalid-number', `${label} phải từ ${minimum} đến ${maximum}.`);
  }
  return Math.round(number * 100) / 100;
};

// Worked hours between two HH:MM times; a shift ending earlier than it began
// crossed midnight.
export const hoursBetween = (start, end) => {
  if (!TIME_PATTERN.test(start || '') || !TIME_PATTERN.test(end || '')) return 0;
  const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  let difference = minutes(end) - minutes(start);
  if (difference < 0) difference += 1440;
  return Math.round((difference / 60) * 100) / 100;
};

const validDate = value => {
  if (!DATE_PATTERN.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export const normalizeManualRecord = input => {
  const source = input || {};
  const employeeName = String(source.employeeName || '').trim().replace(/\s+/g, ' ');
  if (employeeName.length < 2 || employeeName.length > 100) fail('invalid-employee', 'Tên nhân viên cần từ 2 đến 100 ký tự.');
  const employeeId = source.employeeId ? String(source.employeeId).trim().slice(0, 128) : null;
  if (!validDate(source.date)) fail('invalid-date', 'Ngày làm việc không hợp lệ.');
  const status = source.status === 'off' ? 'off' : 'work';
  if (!['work', 'off'].includes(source.status || 'work')) fail('invalid-status', 'Trạng thái không hợp lệ.');
  const type = source.type === 'fulltime' ? 'fulltime' : 'parttime';
  const otCalculationMode = ['hourly', 'fixed', 'rotating'].includes(source.otCalculationMode)
    ? source.otCalculationMode
    : (type === 'fulltime' ? 'rotating' : 'hourly');

  if (status === 'off') {
    return {
      employeeId, employeeName, type, date: source.date, status, dayRate: 1,
      checkIn: '', checkOut: '', workHours: 0, otHours: 0, otCalculationMode, lateHours: 0,
    };
  }

  const checkIn = String(source.checkIn || '');
  const checkOut = String(source.checkOut || '');
  if ((checkIn && !TIME_PATTERN.test(checkIn)) || (checkOut && !TIME_PATTERN.test(checkOut))) {
    fail('invalid-time', 'Giờ vào/ra phải có dạng HH:MM.');
  }
  if (type === 'parttime' && (!checkIn || !checkOut)) fail('missing-time', 'Nhân viên part-time cần đủ giờ vào và giờ ra.');

  return {
    employeeId,
    employeeName,
    type,
    date: source.date,
    status,
    dayRate: boundedNumber(source.dayRate || 1, 1, 10, 'Hệ số ngày'),
    checkIn,
    checkOut,
    workHours: hoursBetween(checkIn, checkOut),
    otHours: boundedNumber(source.otHours, 0, 24, 'Giờ tăng ca'),
    otCalculationMode,
    lateHours: boundedNumber(source.lateHours, 0, 24, 'Giờ đi trễ'),
  };
};

export const normalizeReason = (value, { required = true } = {}) => {
  const reason = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 500);
  if (required && reason.length < MIN_REASON_LENGTH) {
    fail('reason-required', `Cần ghi lý do (ít nhất ${MIN_REASON_LENGTH} ký tự).`);
  }
  return reason;
};

const comparable = value => (value === undefined || value === null ? '' : value);

// Field-by-field description of an edit, kept in the audit log.
export const describeChanges = (before = {}, after = {}) => EDITABLE_FIELDS
  .filter(field => comparable(before[field]) !== comparable(after[field]))
  .map(field => ({ field, before: before[field] ?? null, after: after[field] ?? null }));

export const pickEditable = record => Object.fromEntries(
  EDITABLE_FIELDS.map(field => [field, record?.[field] ?? null]),
);
