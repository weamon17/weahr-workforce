const localDate = offset => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(date);
};

export const createDemoAdminSession = email => {
  const today = localDate(0);
  const yesterday = localDate(-1);
  const tomorrow = localDate(1);
  const month = today.slice(0, 7);
  const employees = {
    'Nguyễn An': {
      employeeId: 'demo-employee-an', employeeDocumentId: 'demo-org_demo-employee-an', organizationId: 'demo-org',
      employeeCode: 'NV001', fullName: 'Nguyễn An', type: 'parttime', salary: 32000,
      position: 'Pha chế', employmentStatus: 'active', phone: '0900000001', startDate: `${month}-01`,
    },
    'Trần Bình': {
      employeeId: 'demo-employee-binh', employeeDocumentId: 'demo-org_demo-employee-binh', organizationId: 'demo-org',
      employeeCode: 'NV002', fullName: 'Trần Bình', type: 'fulltime', salary: 9000000,
      position: 'Quản lý ca', employmentStatus: 'active', standardWorkDays: 26, standardHoursPerDay: 8,
      freeOffDays: 2, standardStart: '08:00', standardEnd: '17:00', phone: '0900000002', startDate: `${month}-01`,
    },
  };
  const records = [
    { id: 'demo-ts-1', organizationId: 'demo-org', employeeId: 'demo-employee-an', employeeName: 'Nguyễn An', type: 'parttime', date: yesterday, status: 'work', checkIn: '08:02', checkOut: '14:05', workHours: 6.05, lateHours: 0, otHours: 0, dayRate: 1 },
    { id: 'demo-ts-2', organizationId: 'demo-org', employeeId: 'demo-employee-binh', employeeName: 'Trần Bình', type: 'fulltime', date: yesterday, status: 'late', checkIn: '08:18', checkOut: '17:20', workHours: 9.03, lateHours: 0.3, otHours: 0.33, dayRate: 1 },
    { id: 'demo-ts-3', organizationId: 'demo-org', employeeId: 'demo-employee-an', employeeName: 'Nguyễn An', type: 'parttime', date: today, status: 'work', checkIn: '07:58', checkOut: '14:00', workHours: 6.03, lateHours: 0, otHours: 0, dayRate: 1 },
  ];
  const schedules = [
    { id: 'demo-schedule-1', organizationId: 'demo-org', employeeId: 'demo-employee-an', employeeName: 'Nguyễn An', workDate: today, startTime: '08:00', endTime: '14:00', status: 'approved', scheduleType: 'shift_request' },
    { id: 'demo-schedule-2', organizationId: 'demo-org', employeeId: 'demo-employee-binh', employeeName: 'Trần Bình', workDate: tomorrow, startTime: '08:00', endTime: '17:00', status: 'pending', scheduleType: 'shift_request' },
  ];
  const salesRecords = Array.from({ length: 28 }, (_, index) => {
    const date = localDate(-(27 - index));
    const hour = [8, 12, 18][index % 3];
    const orders = 24 + (index % 7) * 3 + (hour === 18 ? 12 : 0);
    return { id: `demo-sales-${index}`, organizationId: 'demo-org', branchId: index % 5 === 0 ? 'Chi nhánh 2' : 'Chi nhánh 1', date, hour, orders, revenue: orders * 52000, promotion: index % 6 === 0 ? 'Combo demo' : '', weather: index % 4 === 0 ? 'Mưa' : 'Nắng' };
  });
  return {
    currentUser: { uid: 'demo-admin-local', email, emailVerified: true },
    userProfile: { uid: 'demo-admin-local', email, fullName: 'Admin Demo', role: 'manager', status: 'active', isOrganizationOwner: true, organizationId: 'demo-org' },
    employees,
    records,
    schedules,
    penalties: [{ id: 'demo-penalty-1', organizationId: 'demo-org', employeeId: 'demo-employee-binh', employeeName: 'Trần Bình', month, amount: 50000, reason: 'Đi muộn (dữ liệu demo)' }],
    bonuses: [{ id: 'demo-bonus-1', organizationId: 'demo-org', employeeId: 'demo-employee-an', employeeName: 'Nguyễn An', month, amount: 150000, reason: 'Hiệu suất tốt (dữ liệu demo)' }],
    salesRecords,
  };
};
