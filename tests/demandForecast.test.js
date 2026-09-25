import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLaborProfitability, forecastHourlyDemand, normalizeSalesRecord } from '../src/utils/demandForecast.js';

test('normalizes Vietnamese sales columns', () => {
  assert.deepEqual(normalizeSalesRecord({ 'Ngày': '2026-07-01', 'Giờ': '08:00', 'Doanh thu': '1.200.000đ', 'Số đơn': 30 }, 0), {
    sourceRow: 2, date: '2026-07-01', hour: 8, revenue: 1200000, orders: 30,
    branchId: 'default', promotion: false, weather: '',
  });
});

test('forecast converts orders to required staff and explains its baseline', () => {
  const records = [
    { date: '2026-07-06', hour: 8, orders: 30, revenue: 1000000 },
    { date: '2026-07-13', hour: 8, orders: 40, revenue: 1200000 },
  ];
  const result = forecastHourlyDemand(records, { startDate: '2026-07-20', days: 1, ordersPerEmployeeHour: 15 });
  assert.equal(result[0].predictedOrders, 35);
  assert.equal(result[0].staffRequired, 3);
  assert.match(result[0].explanation, /2 mẫu/);
});

test('labor profitability uses actual hours and employee rates', () => {
  const metrics = calculateLaborProfitability({
    salesRecords: [{ revenue: 1000000 }],
    timesheets: [{ employeeName: 'An', workHours: 8, otHours: 1 }],
    employees: { An: { type: 'parttime', salary: 25000 } },
  });
  assert.equal(metrics.laborHours, 8);
  assert.equal(metrics.laborCost, 212500);
  assert.equal(metrics.revenuePerLaborHour, 125000);
});

test('labor profitability prices full-time hours from the salary profile and matches by id', () => {
  const metrics = calculateLaborProfitability({
    salesRecords: [{ revenue: 1000000 }],
    timesheets: [{ employeeId: 'uid-2', employeeName: 'An', workHours: 8, otHours: 0 }],
    employees: {
      An: { employeeId: 'uid-1', type: 'parttime', salary: 25000 },
      'An (NV002)': { employeeId: 'uid-2', type: 'fulltime', salary: 8320000, standardWorkDays: 26, standardHoursPerDay: 8 },
    },
  });
  assert.equal(metrics.laborCost, 320000);
});
