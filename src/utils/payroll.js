import { calculateNightHours } from './time.js';

// Vietnam Labour Code 2019 minimums (Art. 97-98): night work is paid at least
// 30% extra; overtime on a normal day at least 150%.
export const DEFAULT_NIGHT_SHIFT_RATE = 0.3;
export const DEFAULT_OVERTIME_RATE = 1.5;

const asNumber = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const employeeIdentifier = value => value?.employeeId || value?.userId || '';

const belongsToEmployee = (item, employeeId, employeeName) => {
  const itemEmployeeId = employeeIdentifier(item);
  if (employeeId && itemEmployeeId) return itemEmployeeId === employeeId;
  return item?.employeeName === employeeName;
};

export const calculatePayroll = ({
  employee,
  employeeName,
  employeeId,
  month,
  records = [],
  penalties = [],
  bonuses = [],
}) => {
  if (!employee || !employeeName || !month) return null;

  const resolvedEmployeeId = employeeId || employeeIdentifier(employee);
  const monthRecords = records.filter(record =>
    typeof record.date === 'string'
    && record.date.startsWith(month)
    && belongsToEmployee(record, resolvedEmployeeId, employeeName));
  const workRecords = monthRecords.filter(record => record.status !== 'off');
  const sortedRecords = [...monthRecords].sort((left, right) => left.date.localeCompare(right.date));
  const isFT = (employee.type || employee.employeeType) === 'fulltime';

  const totalWorkHours = workRecords.reduce((sum, record) => sum + asNumber(record.workHours), 0);
  const totalLateHours = workRecords.reduce((sum, record) => sum + asNumber(record.lateHours), 0);
  const automaticWorkDays = new Set(workRecords.map(record => record.date)).size;
  const actualWorkDays = automaticWorkDays;

  const currentPenaltyList = penalties.filter(item =>
    item.month === month && belongsToEmployee(item, resolvedEmployeeId, employeeName));
  const totalPenaltyMoney = currentPenaltyList.reduce((sum, item) => sum + asNumber(item.amount), 0);
  const currentBonusList = bonuses.filter(item =>
    item.month === month && belongsToEmployee(item, resolvedEmployeeId, employeeName));
  const totalBonusMoney = currentBonusList.reduce((sum, item) => sum + asNumber(item.amount), 0);

  const standardWorkDays = Math.min(31, Math.max(1, asNumber(employee.standardWorkDays) || 26));
  const standardHoursPerDay = Math.max(1, asNumber(employee.standardHoursPerDay) || 8);
  const workScheduleMode = employee.workScheduleMode
    || (employee.standardStart && employee.standardEnd ? 'fixed' : 'rotating');
  const recordOtHours = record => {
    if (isFT && workScheduleMode === 'rotating') {
      return Math.max(0, asNumber(record.workHours) - standardHoursPerDay);
    }
    if (isFT) return asNumber(record.otHours);
    // Part-time hours are only overtime beyond the statutory daily standard,
    // not merely past the end of a short shift.
    return Math.max(0, asNumber(record.workHours) - standardHoursPerDay);
  };
  const isHolidayRecord = record => Math.max(1, asNumber(record.dayRate) || 1) > 1;
  const totalOtHours = workRecords.reduce((sum, record) => sum + recordOtHours(record), 0);
  // Holiday hours are already paid at the holiday multiplier (e.g. 300%), which
  // covers overtime on that day, so the overtime premium applies to other days.
  const premiumOtHours = workRecords
    .filter(record => !isHolidayRecord(record))
    .reduce((sum, record) => sum + recordOtHours(record), 0);
  const totalNightHours = workRecords.reduce(
    (sum, record) => sum + calculateNightHours(record.checkIn, record.checkOut),
    0,
  );
  const monthlySalary = Math.max(0, asNumber(employee.salary));
  const hourlyRate = Math.max(0, asNumber(employee.hourlyRate) || monthlySalary);
  const overtimeRate = Math.max(1, asNumber(employee.overtimeRate) || DEFAULT_OVERTIME_RATE);
  const nightShiftRate = Math.min(1, Math.max(0, employee.nightShiftRate ?? DEFAULT_NIGHT_SHIFT_RATE));
  const derivedHourlyRate = isFT
    ? monthlySalary / standardWorkDays / standardHoursPerDay
    : hourlyRate;

  const baseGross = totalWorkHours * derivedHourlyRate;
  const holidayExtraMoney = workRecords.reduce((sum, record) => {
    const rate = Math.max(1, asNumber(record.dayRate) || 1);
    return sum + asNumber(record.workHours) * derivedHourlyRate * (rate - 1);
  }, 0);
  const lateDeductionMoney = 0;
  const absenceDeductionMoney = 0;
  const daysOff = Math.max(0, standardWorkDays - actualWorkDays);

  // workHours already includes overtime, so only add the premium portion.
  // Example: 1.5x overtime => normal 1.0x is in baseGross, add another 0.5x.
  const otBonusMoney = premiumOtHours * derivedHourlyRate * (overtimeRate - 1);
  const nightAllowanceMoney = totalNightHours * derivedHourlyRate * nightShiftRate;

  const totalEarnings = baseGross + otBonusMoney + holidayExtraMoney + nightAllowanceMoney + totalBonusMoney;
  const totalDeductions = lateDeductionMoney + absenceDeductionMoney + totalPenaltyMoney;
  const finalSalary = Math.max(0, totalEarnings - totalDeductions);

  return {
    empProfile: employee,
    isFT,
    monthRecords,
    workRecords,
    sortedRecords,
    standardWorkDays,
    standardHoursPerDay,
    workScheduleMode,
    automaticWorkDays,
    actualWorkDays,
    daysOff,
    totalWorkHours,
    totalLateHours,
    totalOtHours,
    totalNightHours: Number(totalNightHours.toFixed(2)),
    derivedHourlyRate,
    overtimeRate,
    nightShiftRate,
    currentPenaltyList,
    totalPenaltyMoney,
    currentBonusList,
    totalBonusMoney,
    baseGross,
    otBonusMoney,
    holidayExtraMoney,
    nightAllowanceMoney,
    lateDeductionMoney,
    absenceDeductionMoney,
    totalEarnings,
    totalDeductions,
    finalSalary,
  };
};

// Cost of one working hour, used for schedule cost estimates. Full-time staff
// are paid monthly, so their salary is spread over the standard month.
export const hourlyLaborCost = (profile = {}) => {
  const isFullTime = (profile.employeeType || profile.type) === 'fulltime';
  if (!isFullTime) return Math.max(0, asNumber(profile.hourlyRate) || asNumber(profile.salary));
  const standardWorkDays = Math.min(31, Math.max(1, asNumber(profile.standardWorkDays) || 26));
  const standardHoursPerDay = Math.max(1, asNumber(profile.standardHoursPerDay) || 8);
  return Math.max(0, asNumber(profile.salary)) / standardWorkDays / standardHoursPerDay;
};
