import React, { useEffect, useState } from 'react';
import { collection, addDoc, getDocs, query, where, updateDoc, doc, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { useTranslation } from 'react-i18next';
import { db, auth } from '../../firebase';
import WeeklyAvailabilityPanel from './WeeklyAvailabilityPanel';
import SecureAttendanceButton from './SecureAttendanceButton';
import { calculatePayroll } from '../../utils/payroll';
import { localDateString } from '../../utils/time';

export default function EmployeePortal({ currentUser, empProfile, showToast }) {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState(() => {
    const view = new URLSearchParams(window.location.search).get('view');
    if (view === 'attendance') return 'checkin';
    if (view === 'schedule') return 'schedule';
    return 'home';
  });

  const [mySchedules, setMySchedules] = useState([]);
  const [myAttendance, setMyAttendance] = useState([]);
  const [myPayrolls, setMyPayrolls] = useState([]);
  const [myBonusPenalties, setMyBonusPenalties] = useState([]);
  // Salary/type config from the manager-managed 'employees' collection
  // (employee_profiles created at registration has salary: 0 defaults)
  const [myNotifications, setMyNotifications] = useState([]);
  const [notifListenerError, setNotifListenerError] = useState(null);
  const [loading, setLoading] = useState(true);

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
  const currentMonth = today.slice(0, 7);

  useEffect(() => {
    if (!currentUser || !empProfile) return;
    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch schedules (by uid — manager saves employeeId when creating schedule)
        const schSnap = await getDocs(query(collection(db, 'schedules'), where('employeeId', '==', currentUser.uid)));
        setMySchedules(schSnap.docs.map(d => ({ id: d.id, ...d.data() })));

        // Fetch attendance (manager saves employeeName string, not uid)
        const attSnap = await getDocs(query(collection(db, 'timesheets'), where('employeeId', '==', currentUser.uid)));
        setMyAttendance(attSnap.docs.map(d => ({ id: d.id, ...d.data() })));

        // Fetch bonuses + penalties from their SEPARATE collections (same structure manager uses)
        // Both use { employeeName, month: "YYYY-MM", amount, reason }
        // We add a `type` field and alias `month` → `appliedDate` so existing views work
        const [bonusSnap, penaltySnap] = await Promise.all([
          getDocs(query(collection(db, 'bonuses'),   where('employeeId', '==', currentUser.uid))),
          getDocs(query(collection(db, 'penalties'), where('employeeId', '==', currentUser.uid))),
        ]);
        const bonuses   = bonusSnap.docs.map(d   => ({ id: d.id, type: 'bonus',   appliedDate: d.data().month, ...d.data() }));
        const penalties = penaltySnap.docs.map(d => ({ id: d.id, type: 'penalty', appliedDate: d.data().month, ...d.data() }));
        setMyBonusPenalties([...bonuses, ...penalties]);

        // Fetch payrolls (manager saves by employeeName + month:"YYYY-MM", no employeeId)
        const paySnap = await getDocs(query(collection(db, 'payrolls'), where('employeeId', '==', currentUser.uid)));
        setMyPayrolls(paySnap.docs.map(d => ({ id: d.id, ...d.data() })));

        // Fetch actual salary config from manager-managed 'employees' collection
        // employee_profiles has salary:0 defaults; the real config is keyed by name
        // Note: the 'employees' doc does NOT store fullName — the doc ID is the name.
        // We inject fullName manually so child components (ScheduleView, etc.) can rely on it.
      } catch (e) {
        console.error('EmployeePortal fetchData error:', e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [currentUser, empProfile]);

  // Real-time listener for notifications — updates immediately when manager sends one
  useEffect(() => {
    if (!currentUser) return;
    const q = query(collection(db, 'notifications'), where('recipientId', '==', currentUser.uid));
    const unsub = onSnapshot(q, (snap) => {
      const notifs = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const ta = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
          const tb = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
          return tb - ta;
        });
      setMyNotifications(notifs);
      setNotifListenerError(null);
    }, (err) => {
      console.error('[NotifListener] error:', err);
      setNotifListenerError(err.code || err.message);
      showToast(t('portal.notif_connection_error', { error: err.code || err.message }), 'error');
    });
    return () => unsub();
  }, [currentUser, showToast, t]);

  const priorDate = (() => {
    const date = new Date(`${today}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  })();
  const openAttendance = myAttendance.find(record => record.checkIn && !record.checkOut
    && [today, priorDate].includes(record.date));
  const completedScheduleIds = new Set(myAttendance.filter(record => record.checkOut).map(record => record.scheduleId).filter(Boolean));
  const approvedTodaySchedules = mySchedules
    .filter(schedule => schedule.workDate === today && schedule.status === 'approved')
    .sort((left, right) => (left.startTime || '').localeCompare(right.startTime || ''));
  const todaySchedule = (openAttendance
    ? mySchedules.find(schedule => schedule.id === openAttendance.scheduleId)
    : approvedTodaySchedules.find(schedule => !completedScheduleIds.has(schedule.id)))
    || approvedTodaySchedules[0]
    || null;
  const todayAttendance = openAttendance
    || myAttendance.find(record => record.scheduleId && record.scheduleId === todaySchedule?.id)
    || myAttendance.find(record => record.date === today && !record.scheduleId)
    || null;
  const monthAttendance = myAttendance.filter(r => r.date?.startsWith(currentMonth) && r.status !== 'off');
  const totalMonthHours = monthAttendance.reduce((s, r) => s + (r.workHours || 0), 0);

  const formatMoney = (n) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n || 0);

  const unreadCount = myNotifications.filter(n => !n.read).length;

  const navItems = [
    { key: 'home', icon: 'fas fa-home', label: t('nav.emp_home') },
    { key: 'checkin', icon: 'fas fa-fingerprint', label: t('nav.emp_checkin') },
    { key: 'schedule', icon: 'fas fa-calendar-alt', label: t('nav.emp_schedule') },
    { key: 'timesheet', icon: 'fas fa-calendar-check', label: t('nav.emp_timesheet') },
    { key: 'payroll', icon: 'fas fa-wallet', label: t('nav.emp_payroll') },
    { key: 'notifications', icon: 'fas fa-bell', label: t('nav.emp_notifications'), badge: unreadCount },
  ];

  return (
    <div className="app-container">
      <header className="app-header no-print">
        <div className="header-container">
          <div className="header-brand">
            <img src="/wea-hr-icon.svg" alt="WeaHR" style={{ width: '38px', height: '38px', borderRadius: '10px', flexShrink: 0 }} />
            <h1>WeaHR</h1>
          </div>
          <nav className="desktop-nav desktop-only">
            {navItems.map(item => (
              <button key={item.key} className={`nav-item ${activeTab === item.key ? 'active' : ''}`}
                onClick={() => setActiveTab(item.key)} style={{ position: 'relative' }}>
                <i className={item.icon}></i> {item.label}
                {item.badge > 0 && (
                  <span style={{ position: 'absolute', top: '4px', right: '4px', background: '#ef4444', color: 'white', borderRadius: '10px', padding: '1px 6px', fontSize: '0.65rem', fontWeight: '700', lineHeight: 1.4 }}>
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <div className="header-actions desktop-only">
            <button className="action-btn" onClick={() => i18n.changeLanguage(i18n.language === 'vi' ? 'en' : 'vi')} title="Switch language">
              <i className="fas fa-globe"></i> <span>{i18n.language === 'vi' ? 'EN' : 'VI'}</span>
            </button>
            <div className="user-profile">
              <div className="avatar" style={{ background: '#10b981' }}>{(empProfile?.fullName || currentUser?.email || 'E').charAt(0).toUpperCase()}</div>
              <div className="user-info-text">
                <span className="user-role">{t('nav.role_employee')}</span>
                <span className="user-email">{empProfile?.fullName || currentUser?.email}</span>
              </div>
            </div>
            <button className="logout-btn" onClick={() => signOut(auth)} title={t('nav.logout')}>
              <i className="fas fa-sign-out-alt"></i>
            </button>
          </div>
          {/* Mobile: compact actions thay cho hamburger */}
          <div className="mobile-only" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button className="action-btn" onClick={() => i18n.changeLanguage(i18n.language === 'vi' ? 'en' : 'vi')} style={{ padding: '6px 10px', fontSize: '0.8rem' }}>
              <i className="fas fa-globe"></i> {i18n.language === 'vi' ? 'EN' : 'VI'}
            </button>
            <button className="logout-btn" onClick={() => signOut(auth)}>
              <i className="fas fa-sign-out-alt"></i>
            </button>
          </div>
        </div>
      </header>

      <div className="app-main" style={{ maxWidth: '900px', margin: '0 auto', width: '100%', padding: '20px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
            <i className="fas fa-spinner fa-spin" style={{ fontSize: '2rem' }}></i>
          </div>
        ) : (
          <>
            {activeTab === 'home' && <HomeView empProfile={empProfile} todaySchedule={todaySchedule} todayAttendance={todayAttendance} myAttendance={myAttendance} totalMonthHours={totalMonthHours} myBonusPenalties={myBonusPenalties} currentMonth={currentMonth} formatMoney={formatMoney} setActiveTab={setActiveTab} />}
            {activeTab === 'checkin' && <CheckinView empProfile={empProfile} currentUser={currentUser} todaySchedule={todaySchedule} todayAttendance={todayAttendance} setTodayAttendance={(record) => setMyAttendance(previous => { const index = previous.findIndex(item => item.id === record.id); if (index >= 0) { const next = [...previous]; next[index] = { ...next[index], ...record }; return next; } return [...previous, record]; })} setMyAttendance={setMyAttendance} db={db} showToast={showToast} today={today} />}
            {activeTab === 'schedule' && <ScheduleView empProfile={empProfile} currentUser={currentUser} mySchedules={mySchedules} setMySchedules={setMySchedules} db={db} showToast={showToast} />}
            {activeTab === 'timesheet' && <TimesheetView myAttendance={myAttendance} currentMonth={currentMonth} />}
            {activeTab === 'payroll' && <PayrollView empProfile={empProfile} myAttendance={myAttendance} myBonusPenalties={myBonusPenalties} myPayrolls={myPayrolls} currentMonth={currentMonth} formatMoney={formatMoney} />}
            {activeTab === 'notifications' && <NotificationsView myNotifications={myNotifications} setMyNotifications={setMyNotifications} db={db} listenerError={notifListenerError} />}
          </>
        )}
      </div>

      <footer className="app-footer no-print">
        &copy; {new Date().getFullYear()} WeaHR. {t('nav.all_rights')}.
      </footer>

      {/* Bottom Navigation — mobile employee */}
      <nav className="bottom-nav no-print">
        {navItems.map(item => (
          <button
            key={item.key}
            className={`bottom-nav-item ${activeTab === item.key ? 'active' : ''}`}
            onClick={() => setActiveTab(item.key)}
          >
            {item.badge > 0 && (
              <span className="bottom-nav-badge">{item.badge > 9 ? '9+' : item.badge}</span>
            )}
            <i className={item.icon}></i>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ─── HOME ───────────────────────────────────────────────────────────────────
function HomeView({ empProfile, todaySchedule, todayAttendance, myAttendance, totalMonthHours, myBonusPenalties, currentMonth, formatMoney, setActiveTab }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'vi' ? 'vi-VN' : 'en-US';

  const monthAttendance = myAttendance.filter(record => record.date?.startsWith(currentMonth));
  const employeeName = monthAttendance[0]?.employeeName || empProfile?.fullName || 'Employee';
  const employeeId = monthAttendance[0]?.employeeId || empProfile?.employeeId || empProfile?.userId;
  const bonuses = myBonusPenalties
    .filter(item => item.type === 'bonus')
    .map(item => ({ ...item, month: item.month || item.appliedDate }));
  const penalties = myBonusPenalties
    .filter(item => item.type === 'penalty')
    .map(item => ({ ...item, month: item.month || item.appliedDate }));
  const homePayroll = calculatePayroll({
    employee: empProfile,
    employeeName,
    employeeId,
    month: currentMonth,
    records: myAttendance,
    bonuses,
    penalties,
  });
  const estimatedPay = homePayroll?.finalSalary || 0;
  const monthBonus = homePayroll?.totalBonusMoney || 0;
  const monthPenalty = homePayroll?.totalPenaltyMoney || 0;

  const checkedIn = todayAttendance?.checkIn && !todayAttendance?.checkOut;
  const checkedOut = todayAttendance?.checkIn && todayAttendance?.checkOut;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: '800', textAlign: 'left' }}>
          {t('portal.greeting')} {empProfile?.fullName?.split(' ').pop() || '...'} 👋
        </h2>
        <p style={{ margin: '4px 0 0', color: 'var(--text-muted)' }}>
          {new Date().toLocaleDateString(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Check-in status card */}
      <div style={{
        background: checkedOut ? '#f0fdf4' : checkedIn ? '#fffbeb' : '#f8fafc',
        border: `2px solid ${checkedOut ? '#10b981' : checkedIn ? '#f59e0b' : '#e2e8f0'}`,
        borderRadius: '16px', padding: '20px 24px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
          <div>
            <p style={{ margin: 0, fontWeight: '700', fontSize: '1rem', color: checkedOut ? '#10b981' : checkedIn ? '#f59e0b' : 'var(--text-muted)' }}>
              {checkedOut ? `✅ ${t('portal.status_done')}` : checkedIn ? `🟡 ${t('portal.status_working')}` : `⏳ ${t('portal.status_pending')}`}
            </p>
            {todaySchedule ? (
              <p style={{ margin: '6px 0 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                {t('portal.today_shift')} {todaySchedule.startTime} – {todaySchedule.endTime}
              </p>
            ) : (
              <p style={{ margin: '6px 0 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>{t('portal.no_approved_shift')}</p>
            )}
            {todayAttendance?.checkIn && (
              <p style={{ margin: '4px 0 0', fontSize: '0.9rem' }}>
                Check-in: <b>{todayAttendance.checkIn}</b>
                {todayAttendance.checkOut ? ` · Check-out: ${todayAttendance.checkOut}` : ''}
              </p>
            )}
          </div>
          <button className="btn-primary" style={{ whiteSpace: 'nowrap', flexShrink: 0 }} onClick={() => setActiveTab('checkin')}>
            <i className="fas fa-fingerprint" style={{ marginRight: '6px' }}></i>{t('portal.go_checkin')}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '14px' }}>
        {[
          { label: t('portal.stat_hours'), value: `${totalMonthHours.toFixed(1)}h`, color: '#4f46e5' },
          { label: t('portal.stat_bonus'), value: formatMoney(monthBonus), color: '#10b981' },
          { label: t('portal.stat_penalty'), value: formatMoney(monthPenalty), color: '#ef4444' },
          { label: t('portal.stat_estimated'), value: formatMoney(estimatedPay), color: '#0ea5e9' },
        ].map(item => (
          <div key={item.label} style={{ background: 'white', borderRadius: '14px', padding: '16px 18px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', borderTop: `3px solid ${item.color}` }}>
            <p style={{ margin: '0 0 6px', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: '600' }}>{item.label}</p>
            <p style={{ margin: 0, fontSize: '1.2rem', fontWeight: '800', color: item.color }}>{item.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── CHECK-IN / CHECK-OUT ────────────────────────────────────────────────────
function CheckinView({ todaySchedule, todayAttendance, setTodayAttendance, showToast }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'vi' ? 'vi-VN' : 'en-US';
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const checkInDone = !!todayAttendance?.checkIn;
  const checkOutDone = !!todayAttendance?.checkOut;

  const handleSecureResult = data => setTodayAttendance({
    ...(todayAttendance || {}),
    id: data.id,
    date: data.date,
    scheduleId: data.scheduleId || todayAttendance?.scheduleId || todaySchedule?.id,
    status: 'work',
    checkIn: data.checkIn || todayAttendance?.checkIn,
    checkOut: data.checkOut || todayAttendance?.checkOut || '',
    workHours: data.workHours ?? todayAttendance?.workHours ?? 0,
    lateHours: data.lateHours ?? todayAttendance?.lateHours ?? 0,
    otHours: data.otHours ?? todayAttendance?.otHours ?? 0,
    secureAttendance: true,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center' }}>
      <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: '800' }}>{t('portal.checkin_title')}</h2>

      {/* Clock */}
      <div style={{ textAlign: 'center', background: 'white', borderRadius: '20px', padding: '32px 48px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', width: '100%', maxWidth: '400px' }}>
        <div style={{ fontSize: '3.5rem', fontWeight: '800', letterSpacing: '-2px', color: 'var(--primary)', lineHeight: 1 }}>
          {now.toTimeString().slice(0, 8)}
        </div>
        <div style={{ marginTop: '8px', color: 'var(--text-muted)', fontSize: '0.95rem' }}>
          {now.toLocaleDateString(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
      </div>

      {/* Today's schedule info */}
      {todaySchedule ? (
        <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '12px', padding: '14px 20px', width: '100%', maxWidth: '400px' }}>
          <p style={{ margin: 0, fontWeight: '700', color: '#0369a1' }}>{t('portal.shift_approved')}</p>
          <p style={{ margin: '4px 0 0', color: '#0369a1', fontSize: '0.9rem' }}>
            {todaySchedule.startTime} – {todaySchedule.endTime}
          </p>
        </div>
      ) : (
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '12px', padding: '14px 20px', width: '100%', maxWidth: '400px' }}>
          <p style={{ margin: 0, color: '#9a3412', fontSize: '0.9rem' }}>
            <i className="fas fa-exclamation-triangle" style={{ marginRight: '6px' }}></i>
            {t('portal.no_shift')}
          </p>
        </div>
      )}

      {/* Attendance status */}
      {todayAttendance && (
        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '12px', padding: '14px 20px', width: '100%', maxWidth: '400px' }}>
          <p style={{ margin: 0, color: '#15803d', fontWeight: '600' }}>Check-in: {todayAttendance.checkIn}</p>
          {todayAttendance.checkOut && <p style={{ margin: '4px 0 0', color: '#15803d', fontWeight: '600' }}>Check-out: {todayAttendance.checkOut}</p>}
          {todayAttendance.workHours > 0 && <p style={{ margin: '4px 0 0', color: '#15803d', fontSize: '0.9rem' }}>{t('portal.total_hours_info')} {todayAttendance.workHours.toFixed(2)}h</p>}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%', maxWidth: '400px' }}>
        <SecureAttendanceButton
          action="check_in"
          scheduleId={todaySchedule?.id}
          disabled={checkInDone || !todaySchedule}
          label={t('portal.scan_checkin')}
          completedLabel={`${t('portal.checked_in_at')} ${todayAttendance?.checkIn || ''}`}
          onSuccess={handleSecureResult}
          showToast={showToast}
        />
        <SecureAttendanceButton
          action="check_out"
          scheduleId={todaySchedule?.id}
          disabled={!checkInDone || checkOutDone || !todaySchedule}
          label={t('portal.scan_checkout')}
          completedLabel={checkOutDone ? `${t('portal.checked_out_at')} ${todayAttendance?.checkOut || ''}` : ''}
          onSuccess={handleSecureResult}
          showToast={showToast}
        />
      </div>
    </div>
  );
}

// ─── MY SCHEDULE ─────────────────────────────────────────────────────────────
function ScheduleView({ empProfile, currentUser, mySchedules, setMySchedules, db, showToast }) {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [workDate, setWorkDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  const isParttime = (empProfile?.employeeType || 'parttime') === 'parttime';
  const statusLabel = {
    pending: t('portal.status_pending_label'),
    approved: t('portal.status_approved_label'),
    rejected: t('portal.status_rejected_label'),
    cancelled: t('portal.status_cancelled_label'),
  };
  const statusColor = { pending: '#f59e0b', approved: '#10b981', rejected: '#ef4444', cancelled: '#94a3b8' };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!workDate) return showToast(t('portal.pick_date'), 'warning');
    if (isParttime && (!startTime || !endTime)) return showToast(t('portal.pick_times'), 'warning');
    if (!empProfile?.fullName) return showToast(t('portal.profile_missing'), 'error');
    setLoading(true);
    try {
      const scheduleType = isParttime ? 'shift_request' : 'off_request';
      const newSchedule = {
        organizationId: empProfile.organizationId,
        employeeId: currentUser.uid,
        employeeName: empProfile.fullName,
        workDate,
        startTime: isParttime ? startTime : '',
        endTime: isParttime ? endTime : '',
        note,
        scheduleType,
        status: 'pending',
        createdAt: serverTimestamp()
      };
      const docRef = await addDoc(collection(db, 'schedules'), newSchedule);
      setMySchedules(prev => [...prev, { ...newSchedule, id: docRef.id }]);
      setShowForm(false); setWorkDate(''); setStartTime(''); setEndTime(''); setNote('');
      showToast(t('portal.request_sent'), 'success');
    } catch (e) {
      showToast(t('portal.request_failed', { error: e.message }), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (schedule) => {
    if (schedule.status !== 'pending') return showToast(t('portal.cancel_only_pending'), 'warning');
    try {
      await updateDoc(doc(db, 'schedules', schedule.id), { status: 'cancelled' });
      setMySchedules(prev => prev.map(s => s.id === schedule.id ? { ...s, status: 'cancelled' } : s));
      showToast(t('portal.request_cancelled'), 'success');
    } catch {
      showToast(t('portal.cancel_failed'), 'error');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <WeeklyAvailabilityPanel
        currentUser={currentUser}
        empProfile={empProfile}
        db={db}
        showToast={showToast}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: '800' }}>
          {isParttime ? t('portal.schedule_pt_title') : t('portal.schedule_ft_title')}
        </h2>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
          <i className={`fas ${showForm ? 'fa-times' : 'fa-plus'}`} style={{ marginRight: '6px' }}></i>
          {showForm ? t('portal.close') : isParttime ? t('portal.register_shift') : t('portal.request_off')}
        </button>
      </div>

      {showForm && (
        <div style={{ background: 'white', borderRadius: '16px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="form-group">
              <label>{isParttime ? t('portal.date_to_work') : t('portal.date_to_off')}</label>
              <input type="date" value={workDate} onChange={e => setWorkDate(e.target.value)} required min={localDateString()} />
            </div>
            {isParttime && (
              <div style={{ display: 'flex', gap: '12px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>{t('portal.start_time')}</label>
                  <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} required />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>{t('portal.end_time')}</label>
                  <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} required />
                </div>
              </div>
            )}
            <div className="form-group">
              <label>{t('portal.note_optional')}</label>
              <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder={t('portal.note_placeholder')} />
            </div>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? t('portal.sending') : t('portal.submit_request')}
            </button>
          </form>
        </div>
      )}

      <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        {mySchedules.length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px 0' }}>{t('portal.no_requests')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {[...mySchedules].sort((a, b) => b.workDate?.localeCompare(a.workDate)).map(s => (
              <div key={s.id} style={{ border: '1px solid var(--border)', borderRadius: '10px', padding: '14px 16px', borderLeft: `4px solid ${statusColor[s.status] || '#94a3b8'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <span style={{ fontWeight: '700', marginRight: '10px' }}>{s.workDate}</span>
                    {s.startTime && <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{s.startTime} – {s.endTime}</span>}
                    <div style={{ marginTop: '4px' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: '600', padding: '2px 10px', borderRadius: '10px', background: `${statusColor[s.status]}22`, color: statusColor[s.status] }}>
                        {statusLabel[s.status] || s.status}
                      </span>
                    </div>
                    {s.status === 'rejected' && s.rejectReason && (
                      <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: '#ef4444' }}>{t('portal.reject_reason')} {s.rejectReason}</p>
                    )}
                  </div>
                  {s.status === 'pending' && (
                    <button className="btn-danger" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => handleCancel(s)}>
                      {t('portal.cancel_request')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MY TIMESHEET ─────────────────────────────────────────────────────────────
function TimesheetView({ myAttendance, currentMonth }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'vi' ? 'vi-VN' : 'en-US';
  const [viewMonth, setViewMonth] = useState(currentMonth);
  const monthRecords = [...myAttendance].filter(r => r.date?.startsWith(viewMonth)).sort((a, b) => b.date?.localeCompare(a.date));
  const totalHours = monthRecords.filter(r => r.status !== 'off').reduce((s, r) => s + (r.workHours || 0), 0);
  const totalOT = monthRecords.reduce((s, r) => s + (r.otHours || 0), 0);
  const totalLate = monthRecords.reduce((s, r) => s + (r.lateHours || 0), 0);

  const statusTag = (r) => {
    if (r.status === 'off') return { label: t('portal.tag_off'), color: '#ef4444' };
    if (r.status === 'missing_checkout') return { label: t('portal.tag_missing_checkout'), color: '#ef4444' };
    if (r.lateHours > 0) return { label: `${t('portal.tag_late')} ${r.lateHours.toFixed(2)}h`, color: '#f59e0b' };
    if (r.otHours > 0) return { label: `OT ${r.otHours}h`, color: '#8b5cf6' };
    return { label: t('portal.tag_on_time'), color: '#10b981' };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: '800' }}>{t('portal.timesheet_title')}</h2>
        <input type="month" value={viewMonth} onChange={e => setViewMonth(e.target.value)} style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.95rem' }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
        {[
          { label: t('portal.work_days'), value: monthRecords.filter(r => r.status !== 'off').length },
          { label: t('portal.total_hours_label'), value: `${totalHours.toFixed(1)}h` },
          { label: t('portal.ot_hours_label'), value: `${totalOT.toFixed(1)}h`, color: '#8b5cf6' },
          { label: t('portal.late_hours_label'), value: `${totalLate.toFixed(1)}h`, color: '#ef4444' },
        ].map(item => (
          <div key={item.label} style={{ background: 'white', borderRadius: '12px', padding: '14px 16px', boxShadow: '0 2px 6px rgba(0,0,0,0.05)' }}>
            <p style={{ margin: '0 0 4px', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: '600' }}>{item.label}</p>
            <p style={{ margin: 0, fontSize: '1.4rem', fontWeight: '800', color: item.color || 'var(--primary)' }}>{item.value}</p>
          </div>
        ))}
      </div>

      <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        {monthRecords.length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px 0' }}>{t('portal.no_timesheet')}</p>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>{t('portal.col_date')}</th>
                  <th>{t('portal.col_checkin')}</th>
                  <th>{t('portal.col_checkout')}</th>
                  <th>{t('portal.col_hours')}</th>
                  <th>{t('portal.col_status')}</th>
                </tr>
              </thead>
              <tbody>
                {monthRecords.map(r => {
                  const tag = statusTag(r);
                  return (
                    <tr key={r.id}>
                      <td style={{ fontWeight: '600' }}>{new Date(r.date + 'T00:00:00').toLocaleDateString(locale)}</td>
                      <td>{r.status === 'off' ? '-' : (r.checkIn || '-')}</td>
                      <td>{r.status === 'off' ? '-' : (r.checkOut || '-')}</td>
                      <td>{r.status === 'off' ? '-' : `${(r.workHours || 0).toFixed(2)}h`}</td>
                      <td><span style={{ color: tag.color, fontWeight: '600', fontSize: '0.85rem' }}>{tag.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── NOTIFICATIONS ───────────────────────────────────────────────────────────
function NotificationsView({ myNotifications, setMyNotifications, db, listenerError }) {
  const { t, i18n } = useTranslation();

  const handleMarkRead = async (notif) => {
    if (notif.read) return;
    try {
      await updateDoc(doc(db, 'notifications', notif.id), { read: true });
      setMyNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n));
    } catch (e) { console.error(e); }
  };

  const handleMarkAllRead = async () => {
    const unread = myNotifications.filter(n => !n.read);
    if (!unread.length) return;
    try {
      await Promise.all(unread.map(n => updateDoc(doc(db, 'notifications', n.id), { read: true })));
      setMyNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch (e) { console.error(e); }
  };

  const typeIcon = { schedule_approved: '✅', schedule_rejected: '❌', custom: '🔔' };
  const typeAccent = { schedule_approved: '#10b981', schedule_rejected: '#ef4444', custom: '#4f46e5' };

  const formatTime = (ts) => {
    if (!ts) return '';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    const locale = i18n.language === 'vi' ? 'vi-VN' : 'en-US';
    return date.toLocaleString(locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: '800' }}>{t('portal.notif_title')}</h2>
        {myNotifications.some(n => !n.read) && (
          <button className="btn-secondary" onClick={handleMarkAllRead} style={{ fontSize: '0.85rem' }}>
            <i className="fas fa-check-double" style={{ marginRight: '6px' }}></i>
            {t('portal.notif_mark_all_read')}
          </button>
        )}
      </div>

      {listenerError && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '12px', padding: '14px 18px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          <i className="fas fa-exclamation-circle" style={{ color: '#ef4444', marginTop: '2px', flexShrink: 0 }}></i>
          <div>
            <p style={{ margin: 0, fontWeight: '700', color: '#dc2626', fontSize: '0.9rem' }}>{t('portal.notif_load_failed')}</p>
            <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#ef4444' }}>{t('portal.error_code')} <code>{listenerError}</code></p>
            <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#7f1d1d' }}>
              {t('portal.notif_load_help')}
            </p>
          </div>
        </div>
      )}

      <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        {myNotifications.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
            <i className="fas fa-bell" style={{ fontSize: '2.5rem', marginBottom: '12px', display: 'block', color: '#cbd5e1' }}></i>
            <p style={{ margin: 0 }}>{t('portal.notif_empty')}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {myNotifications.map(notif => (
              <div
                key={notif.id}
                onClick={() => handleMarkRead(notif)}
                style={{
                  padding: '14px 16px', borderRadius: '12px',
                  cursor: notif.read ? 'default' : 'pointer',
                  background: notif.read ? 'white' : '#f0f4ff',
                  border: `1px solid ${notif.read ? 'var(--border)' : '#c7d2fe'}`,
                  borderLeft: `4px solid ${typeAccent[notif.type] || '#4f46e5'}`,
                  transition: 'background 0.15s',
                }}
              >
                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: '1.4rem', flexShrink: 0, lineHeight: 1.3 }}>
                    {typeIcon[notif.type] || '🔔'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                      <p style={{ margin: 0, fontWeight: notif.read ? '600' : '700', fontSize: '0.95rem', wordBreak: 'break-word' }}>
                        {notif.title}
                      </p>
                      {!notif.read && (
                        <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#4f46e5', flexShrink: 0, marginTop: '5px' }}></span>
                      )}
                    </div>
                    <p style={{ margin: '5px 0 8px', fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.55, wordBreak: 'break-word' }}>
                      {notif.message}
                    </p>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      {notif.senderEmail && (
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          <i className="fas fa-user-tie" style={{ marginRight: '4px' }}></i>
                          {t('portal.notif_from')} {notif.senderEmail}
                        </span>
                      )}
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        <i className="fas fa-clock" style={{ marginRight: '4px' }}></i>
                        {formatTime(notif.createdAt)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MY PAYROLL ────────────────────────────────────────────────────────────────
function PayrollView({ empProfile, myAttendance, myBonusPenalties, myPayrolls, currentMonth, formatMoney }) {
  const { t } = useTranslation();
  const [viewMonth, setViewMonth] = useState(currentMonth);

  const monthAttendance = myAttendance.filter(r => r.date?.startsWith(viewMonth) && r.status !== 'off');
  const employeeName = monthAttendance[0]?.employeeName || empProfile?.fullName || 'Employee';
  const employeeId = monthAttendance[0]?.employeeId || empProfile?.employeeId || empProfile?.userId;
  const bonuses = myBonusPenalties
    .filter(item => item.type === 'bonus')
    .map(item => ({ ...item, month: item.month || item.appliedDate }));
  const penalties = myBonusPenalties
    .filter(item => item.type === 'penalty')
    .map(item => ({ ...item, month: item.month || item.appliedDate }));
  const payroll = calculatePayroll({
    employee: empProfile,
    employeeName,
    employeeId,
    month: viewMonth,
    records: myAttendance,
    bonuses,
    penalties,
  });
  const {
    isFT,
    totalWorkHours,
    totalOtHours,
    actualWorkDays,
    derivedHourlyRate,
    standardHoursPerDay,
    workScheduleMode,
    baseGross,
    otBonusMoney,
    holidayExtraMoney,
    nightAllowanceMoney,
    totalNightHours,
    totalBonusMoney,
    totalPenaltyMoney,
    finalSalary: netSalary,
  } = payroll;
  const isParttime = !isFT;

  // Manager saves month as full "YYYY-MM" string (e.g. "2025-01"), no separate year field
  const finalizedPayroll = myPayrolls.find(p =>
    p.month === viewMonth && (p.status === 'finalized' || p.status === 'paid')
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: '800' }}>{t('portal.payroll_title')}</h2>
        <input type="month" value={viewMonth} onChange={e => setViewMonth(e.target.value)} style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.95rem' }} />
      </div>

      {finalizedPayroll && (
        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '12px', padding: '14px 20px' }}>
          <p style={{ margin: 0, color: '#15803d', fontWeight: '700' }}>
            <i className="fas fa-check-circle" style={{ marginRight: '8px' }}></i>
            {t('portal.finalized_msg')} {formatMoney(finalizedPayroll.netSalary)}
          </p>
        </div>
      )}

      <div style={{ background: 'white', borderRadius: '16px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '1rem', fontWeight: '700' }}>
          {t('portal.month_label')} {viewMonth.split('-')[1]}/{viewMonth.split('-')[0]}
          <span style={{ marginLeft: '10px', fontSize: '0.75rem', fontWeight: '600', padding: '3px 10px', borderRadius: '10px', background: '#fef3c7', color: '#d97706' }}>
            {finalizedPayroll ? t('portal.finalized_badge') : t('portal.estimated_badge')}
          </span>
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[ 
            { label: isParttime ? t('portal.row_hourly') : t('portal.row_base'), value: formatMoney(isParttime ? (empProfile?.hourlyRate || empProfile?.salary || 0) : (empProfile?.salary || 0)), positive: true },
            !isParttime && { label: t('portal.row_derived_hourly'), value: formatMoney(derivedHourlyRate), positive: true },
            { label: `${t('portal.row_total_hours')} (${totalWorkHours.toFixed(2)}h · ${actualWorkDays} ${t('payroll.days_unit')})`, value: formatMoney(baseGross), positive: true },
            otBonusMoney > 0 && { label: `${t('portal.row_ot_premium')} (${totalOtHours.toFixed(2)}h)`, value: formatMoney(otBonusMoney), positive: true },
            holidayExtraMoney > 0 && { label: t('portal.row_holiday_extra'), value: formatMoney(holidayExtraMoney), positive: true },
            nightAllowanceMoney > 0 && { label: `${t('payroll.night_allowance')} (${totalNightHours.toFixed(2)}h)`, value: formatMoney(nightAllowanceMoney), positive: true },
            totalBonusMoney > 0 && { label: t('portal.row_bonus'), value: formatMoney(totalBonusMoney), positive: true },
            totalPenaltyMoney > 0 && { label: t('portal.row_penalty'), value: formatMoney(totalPenaltyMoney), positive: false },
          ].filter(Boolean).map((row, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{row.label}</span>
              <span style={{ fontWeight: '700', color: row.positive ? '#10b981' : '#ef4444' }}>
                {row.positive ? '+' : '-'} {row.value}
              </span>
            </div>
          ))}
        </div>
        <p style={{ margin: '12px 0 0', padding: '10px 12px', background: '#eff6ff', color: '#1d4ed8', borderRadius: '8px', fontSize: '0.82rem' }}>
          <i className="fas fa-calculator" style={{ marginRight: '6px' }}></i>
          {isParttime
            ? t('payroll.pt_formula_note')
            : (workScheduleMode === 'rotating'
              ? t('payroll.ft_rotating_formula_note', { hours: standardHoursPerDay })
              : t('payroll.ft_formula_note'))}
        </p>

        <div style={{ marginTop: '16px', padding: '16px', background: 'var(--primary)', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'white', fontWeight: '700', fontSize: '1rem' }}>{t('portal.net_pay')}</span>
          <span style={{ color: 'white', fontWeight: '800', fontSize: '1.4rem' }}>{formatMoney(netSalary)}</span>
        </div>
      </div>

      {myBonusPenalties.filter(b => b.appliedDate?.startsWith(viewMonth)).length > 0 && (
        <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '1rem', fontWeight: '700' }}>{t('portal.bonus_penalty_month')}</h3>
          {myBonusPenalties.filter(b => b.appliedDate?.startsWith(viewMonth)).map(item => (
            <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: '0.9rem' }}>{item.type === 'bonus' ? '🎁' : '⚠️'} {item.reason || t('portal.no_reason')}</span>
              <span style={{ fontWeight: '700', color: item.type === 'bonus' ? '#10b981' : '#ef4444' }}>
                {item.type === 'bonus' ? '+' : '-'}{formatMoney(item.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
