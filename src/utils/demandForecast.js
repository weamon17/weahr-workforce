import { hourlyLaborCost } from './payroll.js';

const dateOnly = value => new Date(`${value}T00:00:00`);
const dateString = date => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const normalizeSalesRecord = (row, index = 0) => {
  const pick = (...keys) => keys.map(key => row[key]).find(value => value !== undefined && value !== '');
  const rawDate = pick('date', 'Date', 'Ngày', 'ngay');
  let date = rawDate;
  if (rawDate instanceof Date) date = dateString(rawDate);
  if (typeof rawDate === 'number') {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    excelEpoch.setUTCDate(excelEpoch.getUTCDate() + rawDate);
    date = excelEpoch.toISOString().slice(0, 10);
  }
  date = String(date || '').slice(0, 10);
  const hour = Number(String(pick('hour', 'Hour', 'Giờ', 'gio') ?? '0').split(':')[0]);
  const revenue = Number(String(pick('revenue', 'Revenue', 'Doanh thu', 'doanh_thu') ?? '0').replace(/[,.\s₫đ]/g, '')) || 0;
  const orders = Number(pick('orders', 'Orders', 'Số đơn', 'so_don')) || 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || hour < 0 || hour > 23 || revenue < 0 || orders < 0) return null;
  return {
    sourceRow: index + 2,
    date,
    hour,
    revenue,
    orders,
    branchId: String(pick('branchId', 'Branch', 'Chi nhánh', 'chi_nhanh') || 'default').trim(),
    promotion: Boolean(pick('promotion', 'Promotion', 'Khuyến mãi', 'khuyen_mai')),
    weather: String(pick('weather', 'Weather', 'Thời tiết', 'thoi_tiet') || '').trim(),
  };
};

export const forecastHourlyDemand = (records, options = {}) => {
  const days = Math.max(1, Number(options.days) || 7);
  const capacity = Math.max(1, Number(options.ordersPerEmployeeHour) || 15);
  const start = options.startDate ? dateOnly(options.startDate) : new Date();
  start.setHours(0, 0, 0, 0);
  const clean = records.filter(item => item?.date && Number.isFinite(Number(item.hour)));
  const hours = [...new Set(clean.map(item => Number(item.hour)))].sort((a, b) => a - b);
  const activeHours = hours.length ? hours : Array.from({ length: 16 }, (_, index) => index + 7);
  const recentBoundary = new Date(start); recentBoundary.setDate(recentBoundary.getDate() - 28);
  const previousBoundary = new Date(start); previousBoundary.setDate(previousBoundary.getDate() - 56);
  const recentOrders = clean.filter(item => dateOnly(item.date) >= recentBoundary).map(item => Number(item.orders) || 0);
  const previousOrders = clean.filter(item => dateOnly(item.date) >= previousBoundary && dateOnly(item.date) < recentBoundary).map(item => Number(item.orders) || 0);
  const trend = previousOrders.length && mean(previousOrders) > 0
    ? clamp(mean(recentOrders) / mean(previousOrders), 0.75, 1.35)
    : 1;

  const forecasts = [];
  for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
    const target = new Date(start);
    target.setDate(start.getDate() + dayOffset);
    const targetDate = dateString(target);
    for (const hour of activeHours) {
      const samples = clean.filter(item => dateOnly(item.date).getDay() === target.getDay() && Number(item.hour) === hour);
      const fallback = clean.filter(item => Number(item.hour) === hour);
      const usable = samples.length ? samples : fallback;
      const orderValues = usable.map(item => Number(item.orders) || 0);
      const revenueValues = usable.map(item => Number(item.revenue) || 0);
      const baseOrders = mean(orderValues);
      const predictedOrders = Math.max(0, Math.round(baseOrders * trend));
      const predictedRevenue = Math.max(0, Math.round(mean(revenueValues) * trend));
      const standardDeviation = orderValues.length
        ? Math.sqrt(orderValues.reduce((sum, value) => sum + (value - baseOrders) ** 2, 0) / orderValues.length)
        : 0;
      const variation = baseOrders ? standardDeviation / baseOrders : 1;
      const confidenceScore = clamp((usable.length / 8) * (1 - Math.min(variation, 1) * 0.5), 0.1, 0.95);
      const confidenceLevel = confidenceScore >= 0.72 ? 'high' : confidenceScore >= 0.45 ? 'medium' : 'low';
      const confidence = { high: 'Cao', medium: 'Trung bình', low: 'Thấp' }[confidenceLevel];
      const trendPercent = Math.round((trend - 1) * 100);
      forecasts.push({
        date: targetDate,
        hour,
        predictedOrders,
        predictedRevenue,
        staffRequired: Math.max(predictedOrders > 0 ? 1 : 0, Math.ceil(predictedOrders / capacity)),
        sampleCount: usable.length,
        confidence,
        confidenceLevel,
        confidenceScore: Number(confidenceScore.toFixed(2)),
        averageOrders: Number(baseOrders.toFixed(1)),
        trendPercent,
        explanation: `${usable.length} mẫu cùng khung giờ, trung bình ${baseOrders.toFixed(1)} đơn/giờ${trend !== 1 ? `; xu hướng 4 tuần ${trend > 1 ? 'tăng' : 'giảm'} ${Math.abs((trend - 1) * 100).toFixed(0)}%` : ''}.`,
      });
    }
  }
  return forecasts;
};

export const calculateLaborProfitability = ({ salesRecords = [], timesheets = [], employees = {} }) => {
  const revenue = salesRecords.reduce((sum, item) => sum + (Number(item.revenue) || 0), 0);
  let laborHours = 0;
  let laborCost = 0;
  let overtimeCost = 0;
  const byEmployeeId = new Map(Object.values(employees)
    .filter(employee => employee.employeeId)
    .map(employee => [employee.employeeId, employee]));
  timesheets.forEach(record => {
    const employee = byEmployeeId.get(record.employeeId) || employees[record.employeeName] || {};
    const hourlyRate = hourlyLaborCost(employee);
    const hours = Number(record.workHours) || 0;
    const overtime = Number(record.otHours) || 0;
    laborHours += hours;
    laborCost += hours * hourlyRate + overtime * hourlyRate * 0.5;
    overtimeCost += overtime * hourlyRate * 1.5;
  });
  return {
    revenue,
    laborHours: Number(laborHours.toFixed(2)),
    laborCost: Math.round(laborCost),
    laborCostRatio: revenue ? Number((laborCost / revenue * 100).toFixed(1)) : 0,
    revenuePerLaborHour: laborHours ? Math.round(revenue / laborHours) : 0,
    overtimeCost: Math.round(overtimeCost),
    estimatedAvoidableOvertime: Math.round(overtimeCost * 0.7),
  };
};
