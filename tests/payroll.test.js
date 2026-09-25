import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePayroll, hourlyLaborCost } from '../src/utils/payroll.js';

const fullTimeEmployee = {
  employeeId: 'employee-a',
  type: 'fulltime',
  salary: 26_000_000,
  standardWorkDays: 26,
  standardHoursPerDay: 8,
  workScheduleMode: 'fixed',
  freeOffDays: 2,
  overtimeRate: 1.5,
};

const workRecords = Array.from({ length: 24 }, (_, index) => ({
  employeeId: 'employee-a',
  employeeName: 'Nguyễn A',
  date: `2026-07-${String(index + 1).padStart(2, '0')}`,
  status: 'work',
  workHours: '8',
  otHours: index === 0 ? '2' : 0,
  lateHours: index === 1 ? '1' : 0,
}));

test('full-time payroll automatically derives work days and profile standard days', () => {
  const result = calculatePayroll({
    employee: fullTimeEmployee,
    employeeId: 'employee-a',
    employeeName: 'Nguyễn A',
    month: '2026-07',
    records: [
      ...workRecords,
      {
        employeeId: 'employee-b',
        employeeName: 'Nguyễn A',
        date: '2026-07-25',
        status: 'work',
        workHours: 8,
      },
    ],
  });

  assert.equal(result.standardWorkDays, 26);
  assert.equal(result.automaticWorkDays, 24);
  assert.equal(result.actualWorkDays, 24);
  assert.equal(result.totalWorkHours, 192);
  assert.equal(result.derivedHourlyRate, 125_000);
  assert.equal(result.baseGross, 24_000_000);
  assert.equal(result.absenceDeductionMoney, 0);
  assert.equal(result.otBonusMoney, 125_000);
  assert.equal(result.lateDeductionMoney, 0);
  assert.equal(result.finalSalary, 24_125_000);
});

test('full-time payroll pays actual hours and adds only the overtime premium', () => {
  const result = calculatePayroll({
    employee: fullTimeEmployee,
    employeeId: 'employee-a',
    employeeName: 'Nguyễn A',
    month: '2026-07',
    records: [{
      employeeId: 'employee-a',
      employeeName: 'Nguyễn A',
      date: '2026-07-01',
      status: 'work',
      workHours: 10,
      otHours: 2,
      lateHours: 1,
    }],
  });

  assert.equal(result.baseGross, 1_250_000);
  assert.equal(result.otBonusMoney, 125_000);
  assert.equal(result.lateDeductionMoney, 0);
  assert.equal(result.absenceDeductionMoney, 0);
  assert.equal(result.finalSalary, 1_375_000);
});

test('rotating full-time payroll derives overtime from hours above the daily standard', () => {
  const result = calculatePayroll({
    employee: { ...fullTimeEmployee, workScheduleMode: 'rotating' },
    employeeId: 'employee-a',
    employeeName: 'Nguyễn A',
    month: '2026-07',
    records: [
      { employeeId: 'employee-a', employeeName: 'Nguyễn A', date: '2026-07-01', status: 'work', workHours: 7, otHours: 3 },
      { employeeId: 'employee-a', employeeName: 'Nguyễn A', date: '2026-07-02', status: 'work', workHours: 10, otHours: 0 },
    ],
  });

  assert.equal(result.workScheduleMode, 'rotating');
  assert.equal(result.totalWorkHours, 17);
  assert.equal(result.totalOtHours, 2);
  assert.equal(result.otBonusMoney, 125_000);
  assert.equal(result.finalSalary, 2_250_000);
});

test('part-time payroll reacts to attendance, bonuses and penalties by employee id', () => {
  const result = calculatePayroll({
    employee: { employeeId: 'part-time-a', type: 'parttime', hourlyRate: 50_000 },
    employeeId: 'part-time-a',
    employeeName: 'Trần B',
    month: '2026-07',
    records: [
      { employeeId: 'part-time-a', employeeName: 'Trần B', date: '2026-07-01', workHours: '4', dayRate: 1 },
      { employeeId: 'part-time-a', employeeName: 'Trần B', date: '2026-07-02', workHours: '4', dayRate: 2 },
    ],
    bonuses: [{ employeeId: 'part-time-a', employeeName: 'Tên cũ', month: '2026-07', amount: '100000' }],
    penalties: [{ employeeId: 'part-time-a', employeeName: 'Tên cũ', month: '2026-07', amount: '50000' }],
  });

  assert.equal(result.automaticWorkDays, 2);
  assert.equal(result.baseGross, 400_000);
  assert.equal(result.holidayExtraMoney, 200_000);
  assert.equal(result.otBonusMoney, 0);
  assert.equal(result.finalSalary, 650_000);
});

test('hourly labor cost spreads a full-time salary over the standard month', () => {
  assert.equal(hourlyLaborCost({ employeeType: 'fulltime', salary: 8320000, standardWorkDays: 26, standardHoursPerDay: 8 }), 40000);
  assert.equal(hourlyLaborCost({ type: 'fulltime', salary: 8320000 }), 40000);
  assert.equal(hourlyLaborCost({ employeeType: 'parttime', hourlyRate: 28000 }), 28000);
  assert.equal(hourlyLaborCost({ type: 'parttime', salary: 25000 }), 25000);
  assert.equal(hourlyLaborCost({}), 0);
});

const partTimeEmployee = { employeeId: 'pt-1', type: 'parttime', salary: 30_000 };
const ptRecord = overrides => ({ employeeId: 'pt-1', employeeName: 'Lê C', date: '2026-07-01', status: 'work', ...overrides });
const partTimePayroll = records => calculatePayroll({
  employee: partTimeEmployee, employeeId: 'pt-1', employeeName: 'Lê C', month: '2026-07', records,
});

test('part-time overtime premium only applies beyond eight hours a day', () => {
  const shortShift = partTimePayroll([ptRecord({ workHours: 5, otHours: 0.5 })]);
  assert.equal(shortShift.totalOtHours, 0);
  assert.equal(shortShift.otBonusMoney, 0);
  const longDay = partTimePayroll([ptRecord({ workHours: 10 })]);
  assert.equal(longDay.totalOtHours, 2);
  assert.equal(longDay.otBonusMoney, 30_000); // 2h x 30,000 x 50%
  assert.equal(longDay.finalSalary, 330_000);
});

test('holiday hours are paid at the holiday rate without a second overtime premium', () => {
  const result = partTimePayroll([ptRecord({ workHours: 10, dayRate: 3 })]);
  assert.equal(result.holidayExtraMoney, 600_000); // 10h x 30,000 x (3 - 1)
  assert.equal(result.otBonusMoney, 0);
  assert.equal(result.finalSalary, 900_000); // 300% of 10h
});

test('night work between 22:00 and 06:00 earns a 30% allowance', () => {
  const result = partTimePayroll([ptRecord({ checkIn: '18:00', checkOut: '23:30', workHours: 5.5 })]);
  assert.equal(result.totalNightHours, 1.5);
  assert.equal(result.nightAllowanceMoney, 13_500); // 1.5h x 30,000 x 30%
  assert.equal(result.finalSalary, 178_500);
});
