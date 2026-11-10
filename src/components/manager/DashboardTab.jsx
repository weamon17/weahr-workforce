import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { calculatePayroll } from '../../utils/payroll';
import { localDateString, localMonthString } from '../../utils/time';

const COLORS = { onTime: '#2e9e6a', late: '#e0a11b', off: '#d64533', grid: '#f5eee6', axis: '#a39486' };
const MISSING_CHECKOUT_LOOKBACK_DAYS = 31;

const personKey = item => item.employeeId || item.employeeName;
const initialOf = name => (name || '?').trim().split(/\s+/).pop().charAt(0).toUpperCase();
const nowTime = () => {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
};
const greetingKey = () => {
  const hour = new Date().getHours();
  if (hour < 11) return 'home.greeting_morning';
  if (hour < 18) return 'home.greeting_afternoon';
  return 'home.greeting_evening';
};

function PulseTile({ tone, icon, label, value, hint, onClick }) {
  return (
    <button type="button" className={`pulse-tile tone-${tone} ${value === 0 ? 'is-zero' : ''}`} onClick={onClick}>
      <span className="pulse-icon"><i className={icon} aria-hidden="true"></i></span>
      <span className="pulse-label">{label}</span>
      <span className="pulse-value">{value}</span>
      <span className="pulse-hint">{hint}</span>
    </button>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: '12px', padding: '10px 14px', boxShadow: 'var(--shadow-md)', fontSize: '0.88rem' }}>
      <p style={{ margin: '0 0 6px', fontWeight: 700 }}>{label}</p>
      {payload.map(entry => (
        <p key={entry.dataKey} style={{ margin: '2px 0', color: entry.color, fontWeight: 600 }}>{entry.name}: {entry.value}</p>
      ))}
    </div>
  );
}

export default function DashboardTab({
  records, savedEmployees, schedules, appliedPenalties, appliedBonuses, formatMoney, shopName, onNavigate,
}) {
  const { t, i18n } = useTranslation();
  const today = localDateString();
  const currentMonth = localMonthString();
  const [chartDays, setChartDays] = useState(7);
  const go = tab => onNavigate?.(tab);

  const overview = useMemo(() => {
    const todayRecords = records.filter(record => record.date === today);
    const checkedIn = todayRecords.filter(record => record.checkIn && record.status !== 'off');
    const working = checkedIn.filter(record => !record.checkOut);
    const late = todayRecords.filter(record => Number(record.lateHours) > 0);
    const present = new Set(todayRecords.map(personKey));

    const currentTime = nowTime();
    const notArrived = [];
    const seen = new Set();
    for (const schedule of schedules || []) {
      const key = personKey(schedule);
      if (schedule.workDate !== today || schedule.status !== 'approved' || schedule.scheduleType === 'off_request') continue;
      if (present.has(key) || seen.has(key) || (schedule.startTime || '00:00') > currentTime) continue;
      seen.add(key);
      notArrived.push(schedule);
    }

    const lookback = new Date();
    lookback.setDate(lookback.getDate() - MISSING_CHECKOUT_LOOKBACK_DAYS);
    const lookbackDate = localDateString(lookback);
    const missingCheckout = records.filter(record => record.date < today && record.date >= lookbackDate
      && (record.status === 'missing_checkout' || (record.checkIn && !record.checkOut && record.status !== 'off')));

    const pending = (schedules || []).filter(schedule => schedule.status === 'pending').length;

    const people = [...todayRecords].sort((left, right) => (left.checkIn || '99').localeCompare(right.checkIn || '99'));

    return {
      people,
      notArrived,
      missingCheckout,
      pending,
      checkedInCount: new Set(checkedIn.map(personKey)).size,
      workingCount: new Set(working.map(personKey)).size,
      lateCount: new Set(late.map(personKey)).size,
    };
  }, [records, schedules, today]);

  const payroll = useMemo(() => {
    const entries = Object.entries(savedEmployees);
    const total = entries.reduce((sum, [name, employee]) => sum + (calculatePayroll({
      employee,
      employeeName: name,
      employeeId: employee.employeeId || employee.userId,
      month: currentMonth,
      records,
      penalties: appliedPenalties,
      bonuses: appliedBonuses,
    })?.finalSalary || 0), 0);
    return { total, count: entries.length };
  }, [records, savedEmployees, appliedPenalties, appliedBonuses, currentMonth]);

  const chartData = useMemo(() => {
    const days = [];
    for (let offset = chartDays - 1; offset >= 0; offset -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - offset);
      const dateString = localDateString(date);
      const dayRecords = records.filter(record => record.date === dateString);
      days.push({
        date: `${date.getDate()}/${date.getMonth() + 1}`,
        onTime: dayRecords.filter(record => record.status !== 'off' && !(Number(record.lateHours) > 0)).length,
        late: dayRecords.filter(record => Number(record.lateHours) > 0).length,
        off: dayRecords.filter(record => record.status === 'off').length,
      });
    }
    return days;
  }, [records, chartDays]);

  const locale = i18n.language === 'vi' ? 'vi-VN' : 'en-US';
  const todayLabel = new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const monthLabel = new Date().toLocaleDateString(locale, { month: 'numeric', year: 'numeric' });

  const todos = [
    overview.pending > 0 && {
      key: 'pending', tone: 'primary', icon: 'fas fa-calendar-check',
      text: t('home.todo_pending', { count: overview.pending }), action: t('home.todo_pending_action'), tab: 'schedule',
    },
    overview.notArrived.length > 0 && {
      key: 'absent', tone: 'danger', icon: 'fas fa-user-slash',
      text: t('home.todo_absent', { count: overview.notArrived.length }), action: t('home.todo_absent_action'), tab: 'schedule',
    },
    overview.missingCheckout.length > 0 && {
      key: 'checkout', tone: 'warning', icon: 'fas fa-door-open',
      text: t('home.todo_missing_out', { count: overview.missingCheckout.length }), action: t('home.todo_missing_out_action'), tab: 'timesheet',
    },
  ].filter(Boolean);

  const statusOf = record => {
    if (record.status === 'off') return { tone: 'danger', label: t('home.status_off') };
    if (record.status === 'missing_checkout') return { tone: 'danger', label: t('home.status_missing_out') };
    if (record.checkIn && !record.checkOut) return { tone: 'working', label: t('home.status_working') };
    return { tone: 'done', label: t('home.status_done') };
  };

  return (
    <div className="home">
      <section className="home-hero">
        <span className="home-hero-date">
          <i className="fas fa-mug-hot" aria-hidden="true"></i> {t(greetingKey())}
        </span>
        <h2>{shopName || t('brand.shop_fallback')}</h2>
        <p>{todayLabel} · {t('home.subtitle')}</p>
      </section>

      <section aria-labelledby="home-pulse">
        <h3 id="home-pulse" className="home-section-title"><i className="fas fa-store" aria-hidden="true"></i> {t('home.pulse_title')}</h3>
        <div className="pulse-grid">
          <PulseTile tone="working" icon="fas fa-user-check" label={t('home.pulse_working')} value={overview.workingCount} hint={t('home.pulse_working_hint')} onClick={() => go('timesheet')} />
          <PulseTile tone="done" icon="fas fa-fingerprint" label={t('home.pulse_done')} value={overview.checkedInCount} hint={t('home.pulse_done_hint')} onClick={() => go('timesheet')} />
          <PulseTile tone="late" icon="fas fa-clock" label={t('home.pulse_late')} value={overview.lateCount} hint={t('home.pulse_late_hint')} onClick={() => go('timesheet')} />
          <PulseTile tone="missing" icon="fas fa-user-slash" label={t('home.pulse_missing')} value={overview.notArrived.length} hint={t('home.pulse_missing_hint')} onClick={() => go('schedule')} />
        </div>
      </section>

      <div className="home-grid">
        <div className="home-col">
          <section className="home-card" aria-labelledby="home-todo">
            <h3 id="home-todo" className="home-section-title"><i className="fas fa-clipboard-list" aria-hidden="true"></i> {t('home.todo_title')}</h3>
            {todos.length === 0 ? (
              <div className="todo-empty"><i className="fas fa-check-circle" aria-hidden="true"></i> {t('home.todo_empty')}</div>
            ) : (
              <ul className="todo-list">
                {todos.map(todo => (
                  <li key={todo.key} className={`todo-item tone-${todo.tone}`}>
                    <span className="todo-icon"><i className={todo.icon} aria-hidden="true"></i></span>
                    <span className="todo-text">{todo.text}</span>
                    <button type="button" className="btn-primary" onClick={() => go(todo.tab)}>{todo.action}</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="home-card" aria-labelledby="home-people">
            <h3 id="home-people" className="home-section-title"><i className="fas fa-users" aria-hidden="true"></i> {t('home.people_title')}</h3>
            {overview.people.length === 0 && overview.notArrived.length === 0 ? (
              <div className="home-empty"><i className="fas fa-mug-hot" aria-hidden="true"></i>{t('home.people_empty')}</div>
            ) : (
              <ul className="people-list">
                {overview.people.map(record => {
                  const status = statusOf(record);
                  const lateMinutes = Math.round((Number(record.lateHours) || 0) * 60);
                  const position = savedEmployees[record.employeeName]?.position;
                  const times = [
                    record.checkIn && t('home.time_in', { time: record.checkIn }),
                    record.checkOut && t('home.time_out', { time: record.checkOut }),
                  ].filter(Boolean).join(' · ');
                  return (
                    <li key={record.id} className="person-row">
                      <span className="person-avatar" aria-hidden="true">{initialOf(record.employeeName)}</span>
                      <span className="person-main">
                        <strong>{record.employeeName}</strong>
                        <span>{[position, times].filter(Boolean).join(' · ')}</span>
                      </span>
                      {lateMinutes > 0 && <span className="status-chip tone-late">{t('home.status_late', { minutes: lateMinutes })}</span>}
                      <span className={`status-chip tone-${status.tone}`}>{status.label}</span>
                    </li>
                  );
                })}
                {overview.notArrived.map(schedule => (
                  <li key={`absent-${schedule.id}`} className="person-row">
                    <span className="person-avatar" aria-hidden="true">{initialOf(schedule.employeeName)}</span>
                    <span className="person-main">
                      <strong>{schedule.employeeName}</strong>
                      <span>{t('home.shift_at', { start: schedule.startTime, end: schedule.endTime })}</span>
                    </span>
                    <span className="status-chip tone-danger">{t('home.status_not_arrived')}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="home-col">
          <section className="pay-card" aria-labelledby="home-pay">
            <small id="home-pay">{t('home.pay_title', { month: monthLabel })}</small>
            <strong>{formatMoney(payroll.total)}</strong>
            <p>{t('home.pay_hint', { count: payroll.count })}</p>
            <button type="button" onClick={() => go('payroll')}>
              {t('home.pay_action')} <i className="fas fa-arrow-right" aria-hidden="true"></i>
            </button>
          </section>

          <section className="home-card" aria-labelledby="home-week">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
              <h3 id="home-week" className="home-section-title" style={{ margin: 0 }}><i className="fas fa-chart-column" aria-hidden="true"></i> {t('home.week_title')}</h3>
              <div className="segmented" role="group">
                {[7, 30].map(days => (
                  <button key={days} type="button" className={chartDays === days ? 'active' : ''} aria-pressed={chartDays === days} onClick={() => setChartDays(days)}>
                    {t('home.days', { count: days })}
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barSize={chartDays > 7 ? 7 : 18}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: COLORS.axis }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 12, fill: COLORS.axis }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(227, 154, 75, 0.08)' }} />
                <Bar dataKey="onTime" stackId="day" name={t('home.legend_on_time')} fill={COLORS.onTime} />
                <Bar dataKey="late" stackId="day" name={t('home.legend_late')} fill={COLORS.late} />
                <Bar dataKey="off" stackId="day" name={t('home.legend_off')} fill={COLORS.off} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '8px', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
              {[['onTime', 'home.legend_on_time'], ['late', 'home.legend_late'], ['off', 'home.legend_off']].map(([key, label]) => (
                <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: COLORS[key] }} /> {t(label)}
                </span>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
