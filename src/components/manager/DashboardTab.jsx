import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { calculatePayroll } from '../../utils/payroll';
import { localDateString, localMonthString } from '../../utils/time';

function StatCard({ icon, label, value, sub, color }) {
  return (
    <div className="stat-card" style={{
      background: 'white', borderRadius: '16px', padding: '20px 22px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)', borderLeft: `4px solid ${color}`,
      display: 'flex', flexDirection: 'column', gap: '4px', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: 0, right: 0, width: '80px', height: '80px', background: color, opacity: 0.06, borderRadius: '0 0 0 80px' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
        <i className={icon} style={{ color, fontSize: '0.85rem', flexShrink: 0 }} />
        <span className="stat-label" style={{ fontSize: '0.72rem', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1.2 }}>{label}</span>
      </div>
      <span className="stat-value" style={{ fontSize: '2rem', fontWeight: '800', color, lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: '0.76rem', color: '#94a3b8', marginTop: '2px' }}>{sub}</span>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', fontSize: '0.83rem' }}>
      <p style={{ margin: '0 0 6px', fontWeight: '700', color: '#0f172a' }}>{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ margin: '2px 0', color: p.color, fontWeight: '600' }}>
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  );
};

export default function DashboardTab({ records, savedEmployees, schedules, appliedPenalties, appliedBonuses, formatMoney }) {
  const { t, i18n } = useTranslation();
  const today = localDateString();
  const currentMonth = localMonthString();
  const [chartPeriod, setChartPeriod] = useState(14);

  const stats = useMemo(() => {
    const totalEmployees = Object.keys(savedEmployees).length;
    const todayRecords = records.filter(r => r.date === today);
    const workedToday = new Set(todayRecords.filter(r => r.status === 'work').map(r => r.employeeName)).size;
    const checkedIn = todayRecords.filter(r => r.checkIn && !r.checkOut && r.status === 'work').length;
    const lateToday = todayRecords.filter(r => r.lateHours > 0).length;
    const pendingSchedules = (schedules || []).filter(s => s.status === 'pending').length;

    const estimatedPayroll = Object.entries(savedEmployees).reduce((sum, [name, emp]) => {
      const result = calculatePayroll({
        employee: emp,
        employeeName: name,
        employeeId: emp.employeeId || emp.userId,
        month: currentMonth,
        records,
        penalties: appliedPenalties,
        bonuses: appliedBonuses,
      });
      return sum + (result?.finalSalary || 0);
    }, 0);

    return { totalEmployees, workedToday, checkedIn, lateToday, pendingSchedules, estimatedPayroll };
  }, [records, savedEmployees, schedules, appliedPenalties, appliedBonuses, today, currentMonth]);

  // --- Chart data ---
  const attendanceTrendData = useMemo(() => {
    const days = [];
    for (let i = chartPeriod - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = localDateString(d);
      const dayRecords = records.filter(r => r.date === dateStr);
      const label = `${d.getDate()}/${d.getMonth() + 1}`;
      days.push({
        date: label,
        working: dayRecords.filter(r => r.status === 'work' && !r.lateHours).length,
        late: dayRecords.filter(r => r.lateHours > 0).length,
        off: dayRecords.filter(r => r.status === 'off').length,
        ot: dayRecords.filter(r => r.otHours > 0).length,
      });
    }
    return days;
  }, [records, chartPeriod]);

  const employeeTypeData = useMemo(() => {
    const ft = Object.values(savedEmployees).filter(e => e.type === 'fulltime').length;
    const pt = Object.values(savedEmployees).filter(e => e.type === 'parttime').length;
    return [
      { name: 'Full-time', value: ft, color: '#4f46e5' },
      { name: 'Part-time', value: pt, color: '#f59e0b' },
    ];
  }, [savedEmployees]);

  const employeePayrollData = useMemo(() => {
    return Object.entries(savedEmployees).map(([name, emp]) => {
      const result = calculatePayroll({
        employee: emp,
        employeeName: name,
        employeeId: emp.employeeId || emp.userId,
        month: currentMonth,
        records,
        penalties: appliedPenalties,
        bonuses: appliedBonuses,
      });
      return { name: name.split(' ').pop(), fullName: name, pay: Math.round((result?.finalSalary || 0) / 1000) };
    }).sort((a, b) => b.pay - a.pay).slice(0, 8);
  }, [records, savedEmployees, appliedPenalties, appliedBonuses, currentMonth]);

  const todayRecords = records.filter(r => r.date === today);
  const todayStatusData = useMemo(() => [
    { name: t('dashboard.status_on_time'), value: todayRecords.filter(r => r.status === 'work' && !r.lateHours).length, color: '#10b981' },
    { name: t('dashboard.status_late'), value: todayRecords.filter(r => r.lateHours > 0).length, color: '#f59e0b' },
    { name: t('dashboard.status_off'), value: todayRecords.filter(r => r.status === 'off').length, color: '#ef4444' },
    { name: t('dashboard.status_ot'), value: todayRecords.filter(r => r.otHours > 0 && !r.lateHours).length, color: '#8b5cf6' },
  ].filter(d => d.value > 0), [todayRecords, t]);

  const sectionHead = (icon, title, sub) => (
    <div style={{ marginBottom: '16px' }}>
      <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <i className={icon} style={{ color: 'var(--primary)' }} /> {title}
      </h3>
      {sub && <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: '0.82rem' }}>{sub}</p>}
    </div>
  );

  const dateLocale = i18n.language === 'vi' ? 'vi-VN' : 'en-US';
  const monthYear = `${new Date().getMonth() + 1}/${new Date().getFullYear()}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '32px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.7rem', fontWeight: '800', textAlign: 'left', letterSpacing: '-0.5px' }}>
            Dashboard
          </h2>
          <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: '0.9rem' }}>
            <i className="fas fa-calendar-day" style={{ marginRight: '6px' }} />
            {new Date().toLocaleDateString(dateLocale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div style={{ background: 'white', borderRadius: '10px', padding: '6px 12px', border: '1px solid #e2e8f0', fontSize: '0.82rem', color: '#64748b', fontWeight: '600' }}>
          <i className="fas fa-sync-alt" style={{ marginRight: '6px', color: '#10b981' }} />
          Live
        </div>
      </div>

      {/* Stats Grid */}
      <div className="stat-grid">
        <StatCard icon="fas fa-users" label={t('dashboard.stat_total_employees')} value={stats.totalEmployees} sub={t('dashboard.stat_in_system')} color="#4f46e5" />
        <StatCard icon="fas fa-user-check" label={t('dashboard.stat_working_today')} value={stats.workedToday} sub={t('dashboard.stat_has_timesheet')} color="#10b981" />
        <StatCard icon="fas fa-business-time" label={t('dashboard.stat_currently_working')} value={stats.checkedIn} sub={t('dashboard.stat_not_checked_out')} color="#f59e0b" />
        <StatCard icon="fas fa-user-clock" label={t('dashboard.stat_late_today')} value={stats.lateToday} sub={t('dashboard.stat_late_count')} color="#ef4444" />
        <StatCard icon="fas fa-bell" label={t('dashboard.stat_pending_shifts')} value={stats.pendingSchedules} sub={t('dashboard.stat_pending_requests')} color="#8b5cf6" />
        <StatCard icon="fas fa-coins" label={t('dashboard.stat_estimated_payroll')} value={formatMoney(stats.estimatedPayroll)} sub={monthYear} color="#0ea5e9" />
      </div>

      {/* Charts Row 1 */}
      <div className="charts-row">

        {/* Attendance Trend */}
        <div style={{ background: 'white', borderRadius: '16px', padding: '24px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
            {sectionHead('fas fa-chart-bar', t('dashboard.trend_title'), null)}
            <div style={{ display: 'flex', gap: '6px' }}>
              {[7, 14, 30].map(d => (
                <button key={d} onClick={() => setChartPeriod(d)} style={{
                  padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '700',
                  background: chartPeriod === d ? 'var(--primary)' : '#f1f5f9',
                  color: chartPeriod === d ? 'white' : '#64748b', border: 'none', cursor: 'pointer',
                }}>
                  {d}{t('dashboard.day_suffix')}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={attendanceTrendData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barSize={10}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '12px' }} />
              <Bar dataKey="working" name={t('dashboard.bar_working')} fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="late" name={t('dashboard.bar_late')} fill="#f59e0b" radius={[4, 4, 0, 0]} />
              <Bar dataKey="off" name={t('dashboard.bar_off')} fill="#ef4444" radius={[4, 4, 0, 0]} />
              <Bar dataKey="ot" name={t('dashboard.bar_ot')} fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Today breakdown donut + employee type */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Today status */}
          <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', flex: 1 }}>
            {sectionHead('fas fa-chart-pie', t('dashboard.today_title'), t('dashboard.today_subtitle'))}
            {todayStatusData.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#94a3b8', padding: '20px 0', fontSize: '0.85rem' }}>
                <i className="fas fa-inbox" style={{ fontSize: '2rem', marginBottom: '8px', display: 'block' }} />
                {t('dashboard.no_data_label')}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={140}>
                <PieChart>
                  <Pie data={todayStatusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={55} innerRadius={30} paddingAngle={3}>
                    {todayStatusData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [v + ' ' + t('dashboard.unit_people'), n]} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* FT vs PT */}
          <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', flex: 1 }}>
            {sectionHead('fas fa-user-tie', t('dashboard.contract_type'), null)}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <ResponsiveContainer width={100} height={100}>
                <PieChart>
                  <Pie data={employeeTypeData} dataKey="value" cx="50%" cy="50%" outerRadius={44} innerRadius={24} paddingAngle={4}>
                    {employeeTypeData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {employeeTypeData.map(d => (
                  <div key={d.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: d.color, display: 'block' }} />
                      <span style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: '600' }}>{d.name}</span>
                    </div>
                    <span style={{ fontSize: '1.1rem', fontWeight: '800', color: d.color }}>{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Payroll by employee chart */}
      {employeePayrollData.length > 0 && (
        <div style={{ background: 'white', borderRadius: '16px', padding: '24px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
          {sectionHead('fas fa-money-bill-wave', t('dashboard.payroll_by_emp'), `${monthYear} (${t('dashboard.payroll_thousands')})`)}
          <ResponsiveContainer width="100%" height={Math.max(180, employeePayrollData.length * 42)}>
            <BarChart layout="vertical" data={employeePayrollData} margin={{ top: 0, right: 16, left: 8, bottom: 0 }} barSize={16}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} unit="k" />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#334155', fontWeight: 600 }} tickLine={false} axisLine={false} width={60} />
              <Tooltip formatter={(v) => [new Intl.NumberFormat(i18n.language === 'vi' ? 'vi-VN' : 'en-US').format(v * 1000) + ' đ', t('dashboard.stat_estimated_payroll')]} labelFormatter={(l, payload) => payload?.[0]?.payload?.fullName || l} />
              <Bar dataKey="pay" fill="#4f46e5" radius={[0, 6, 6, 0]}>
                {employeePayrollData.map((_, i) => <Cell key={i} fill={`hsl(${240 - i * 18}, 65%, ${55 + i * 3}%)`} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Today's attendance table */}
      <div style={{ background: 'white', borderRadius: '16px', padding: '24px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
        {sectionHead('fas fa-clock', t('dashboard.attendance_today'), today)}
        {todayRecords.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px', color: '#94a3b8' }}>
            <i className="fas fa-calendar-times" style={{ fontSize: '2.5rem', display: 'block', marginBottom: '10px' }} />
            <p style={{ margin: 0, fontSize: '0.9rem' }}>{t('dashboard.no_data_today')}</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>{t('dashboard.col_employee')}</th>
                  <th>{t('dashboard.col_type')}</th>
                  <th>Check-in</th>
                  <th>Check-out</th>
                  <th>{t('dashboard.col_hours')}</th>
                  <th>{t('dashboard.col_status')}</th>
                </tr>
              </thead>
              <tbody>
                {todayRecords.map(r => {
                  const empType = (savedEmployees[r.employeeName]?.type || r.type);
                  return (
                    <tr key={r.id}>
                      <td style={{ fontWeight: '600' }}>{r.employeeName}</td>
                      <td>
                        <span className={`badge ${empType === 'fulltime' ? 'badge-ft' : 'badge-pt'}`}>
                          {empType === 'fulltime' ? 'FT' : 'PT'}
                        </span>
                      </td>
                      <td>{r.checkIn || '—'}</td>
                      <td>{r.checkOut || '—'}</td>
                      <td>{r.status === 'off' ? '—' : `${(r.workHours || 0).toFixed(2)}h`}</td>
                      <td>
                        {r.status === 'off' && <span style={{ color: '#ef4444', fontWeight: '600' }}>{t('dashboard.status_tag_off')}</span>}
                        {r.status === 'work' && r.lateHours > 0 && <span style={{ color: '#f59e0b', fontWeight: '600' }}>{t('dashboard.status_tag_late')} {r.lateHours.toFixed(2)}h</span>}
                        {r.status === 'work' && (r.otHours || 0) > 0 && !r.lateHours && <span style={{ color: '#8b5cf6', fontWeight: '600' }}>OT +{r.otHours}h</span>}
                        {r.status === 'work' && !r.lateHours && !(r.otHours > 0) && <span style={{ color: '#10b981', fontWeight: '600' }}>{t('dashboard.status_tag_on_time')}</span>}
                        {r.status === 'missing_checkout' && <span style={{ color: '#64748b', fontWeight: '600' }}>{t('dashboard.status_tag_missing_co')}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Not checked in today */}
      <div style={{ background: 'white', borderRadius: '16px', padding: '24px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
        {sectionHead('fas fa-user-times', t('dashboard.no_data_section'), null)}
        {(() => {
          const workedNames = new Set(todayRecords.map(r => r.employeeName));
          const notWorked = Object.entries(savedEmployees).filter(([n]) => !workedNames.has(n));
          if (notWorked.length === 0) return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', fontWeight: '600' }}>
              <i className="fas fa-check-circle" /> {t('dashboard.all_data_present')}
            </div>
          );
          return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {notWorked.map(([name, emp]) => (
                <span key={name} style={{
                  background: '#fee2e2', color: '#991b1b',
                  padding: '6px 14px', borderRadius: '20px', fontSize: '0.84rem', fontWeight: '600',
                  display: 'flex', alignItems: 'center', gap: '6px',
                }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
                  {name}
                  <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>{emp.type === 'fulltime' ? 'FT' : 'PT'}</span>
                </span>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
