import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, setDoc } from 'firebase/firestore';
import { calculateHours, calculateLateHours, calculateOvertimeHours, localDateString } from '../utils/time';
import AttendanceSecurityPanel from './manager/AttendanceSecurityPanel';
import AuditLogPanel from './manager/AuditLogPanel';
import { buildEmployeeDocumentId } from '../utils/employee';
import { downloadCsv } from '../utils/csv';
import { createTimesheet, deleteTimesheet, updateTimesheet } from '../services/timesheetApi';

// An open record from an earlier day means the employee forgot to check out;
// today's open record simply means they are still on shift.
const isForgottenCheckout = (record, today) => record.status === 'work' && !record.checkOut && record.date < today;
const isStillWorking = (record, today) => record.status === 'work' && !record.checkOut && record.date >= today;

export default function TimesheetTab({ records, setRecords, savedEmployees, setSavedEmployees, organizationId, demoMode = false, db, showToast, showConfirm, ensureMonthLoaded }) {
  const { t, i18n } = useTranslation();

  const STATUS_FILTERS = useMemo(() => [
    { value: 'all',              label: t('timesheet_extra.filter_status_all'),     color: '#75665b' },
    { value: 'work',             label: t('timesheet_extra.filter_status_work'),    color: '#2e9e6a' },
    { value: 'late',             label: t('timesheet_extra.filter_status_late'),    color: '#eab308' },
    { value: 'ot',               label: t('timesheet_extra.filter_status_ot'),      color: '#f97316' },
    { value: 'off',              label: t('timesheet_extra.filter_status_off'),     color: '#d64533' },
    { value: 'missing_checkout', label: t('timesheet_extra.filter_status_missing'), color: '#2f6f8f' },
  ], [t]);

  const DAY_HEADERS = useMemo(() => [
    t('timesheet_extra.day_mon'), t('timesheet_extra.day_tue'), t('timesheet_extra.day_wed'),
    t('timesheet_extra.day_thu'), t('timesheet_extra.day_fri'), t('timesheet_extra.day_sat'),
    t('timesheet_extra.day_sun'),
  ], [t]);

  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [showManualForm, setShowManualForm] = useState(false);
  const [editReason, setEditReason] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const [employeeName, setEmployeeName] = useState('');
  const [employeeType, setEmployeeType] = useState('parttime');
  const [hourlyRate, setHourlyRate] = useState(25000);
  const [ftStandardStart, setFtStandardStart] = useState('16:00');
  const [ftStandardEnd, setFtStandardEnd] = useState('23:00');
  const [ftWorkScheduleMode, setFtWorkScheduleMode] = useState('rotating');
  const [ftStandardHoursPerDay, setFtStandardHoursPerDay] = useState(8);
  const [monthlySalary, setMonthlySalary] = useState(7000000);

  const [recordStatus, setRecordStatus] = useState('work');
  const [isHoliday, setIsHoliday] = useState(false);
  // Vietnam Labour Code: work on public holidays is paid at least 300%.
  const [dayRate, setDayRate] = useState(3);
  const [workDate, setWorkDate] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [otHours, setOtHours] = useState('');
  const [lateHours, setLateHours] = useState('');

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);

  const [filterMonth, setFilterMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [filterType, setFilterType] = useState('all');
  const calendarMonth = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
  useEffect(() => {
    ensureMonthLoaded?.(filterMonth);
    ensureMonthLoaded?.(calendarMonth);
  }, [calendarMonth, ensureMonthLoaded, filterMonth]);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterEmployee, setFilterEmployee] = useState('');

  useEffect(() => {
    if (recordStatus === 'work' && employeeType === 'fulltime') {
      if (ftWorkScheduleMode === 'rotating') {
        setLateHours('');
        const workHours = checkIn && checkOut ? calculateHours(checkIn, checkOut) : 0;
        const ot = Math.max(0, workHours - ftStandardHoursPerDay);
        setOtHours(ot > 0 ? ot.toFixed(2) : '');
      } else {
        if (checkIn && ftStandardStart) {
          const late = calculateLateHours(ftStandardStart, checkIn);
          setLateHours(late > 0 ? late.toFixed(2) : '');
        } else { setLateHours(''); }
        if (checkIn && checkOut && ftStandardStart && ftStandardEnd) {
          const ot = calculateOvertimeHours(ftStandardStart, ftStandardEnd, checkIn, checkOut);
          setOtHours(ot > 0 ? ot.toFixed(2) : '');
        } else { setOtHours(''); }
      }
    } else if (employeeType === 'parttime') {
      setLateHours('');
    }
  }, [checkIn, checkOut, ftStandardStart, ftStandardEnd, ftWorkScheduleMode, ftStandardHoursPerDay, employeeType, recordStatus]);

  const resetForm = () => {
    setEditingId(null);
    setEditReason('');
    setCheckIn('');
    setCheckOut('');
    setOtHours('');
    setLateHours('');
    setRecordStatus('work');
    setIsHoliday(false);
    setDayRate(3);
    setWorkDate('');
  };

  const handleSave = async () => {
    if (demoMode) return showToast(t('demo.read_only'), 'warning');
    if (!employeeName.trim() || !workDate) {
      showToast(t('timesheet.calendar_hint'), 'warning');
      return;
    }
    if (editingId && editReason.trim().length < 5) {
      showToast(t('audit.reason_too_short'), 'warning');
      return;
    }

    let workHours = 0;
    if (recordStatus === 'work') {
      if (employeeType === 'parttime') {
        if (!checkIn || !checkOut) { showToast(t('timesheet.check_in') + '/' + t('timesheet.check_out'), 'warning'); return; }
        workHours = calculateHours(checkIn, checkOut);
      } else {
        workHours = checkIn && checkOut ? calculateHours(checkIn, checkOut) : 0;
      }
    }

    const newRecord = {
      organizationId,
      employeeId: savedEmployees[employeeName.trim()]?.employeeId
        || savedEmployees[employeeName.trim()]?.userId
        || null,
      employeeName: employeeName.trim(),
      type: employeeType,
      date: workDate,
      status: recordStatus,
      dayRate: (recordStatus === 'off' || !isHoliday) ? 1 : (Number(dayRate) || 3),
      checkIn: recordStatus === 'off' ? '' : checkIn,
      checkOut: recordStatus === 'off' ? '' : checkOut,
      workHours: recordStatus === 'off' ? 0 : workHours,
      otHours: recordStatus === 'off' ? 0 : (Number(otHours) || 0),
      otCalculationMode: employeeType === 'fulltime' ? ftWorkScheduleMode : 'hourly',
      lateHours: recordStatus === 'off' ? 0 : (Number(lateHours) || 0),
    };

    setIsSaving(true);
    try {
      if (!savedEmployees[employeeName.trim()]) {
        const employeeDocumentId = buildEmployeeDocumentId(
          organizationId,
          globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`,
        );
        const empData = employeeType === 'parttime'
          ? { organizationId, employeeDocumentId, fullName: employeeName.trim(), type: 'parttime', salary: hourlyRate }
          : {
            organizationId,
            employeeDocumentId,
            fullName: employeeName.trim(),
            type: 'fulltime',
            salary: monthlySalary,
            standardHoursPerDay: ftStandardHoursPerDay,
            workScheduleMode: ftWorkScheduleMode,
            standardStart: ftWorkScheduleMode === 'fixed' ? ftStandardStart : '',
            standardEnd: ftWorkScheduleMode === 'fixed' ? ftStandardEnd : '',
          };
        await setDoc(doc(db, 'employees', employeeDocumentId), empData);
        setSavedEmployees(prev => ({ ...prev, [employeeName.trim()]: empData }));
      }

      // The backend recomputes worked hours and writes the audit log with the change.
      if (editingId) {
        const { record, unchanged } = await updateTimesheet(editingId, newRecord, editReason.trim());
        setRecords(previous => previous.map(r => (r.id === editingId ? { ...r, ...record, editedManually: !unchanged || r.editedManually } : r)));
        resetForm();
        showToast(unchanged ? t('audit.no_changes') : t('audit.saved_with_log'), 'success');
      } else {
        const { record } = await createTimesheet(newRecord);
        setRecords(previous => [...previous, record]);
        setCheckIn(''); setCheckOut(''); setOtHours(''); setLateHours(''); setRecordStatus('work');
        showToast(t('common.success'), 'success');
      }
    } catch (error) {
      showToast(error.message || t('common.error'), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditClick = (record) => {
    setEditingId(record.id);
    setShowManualForm(true);
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
    setEditReason('');
    setEmployeeName(record.employeeName);
    const empData = savedEmployees[record.employeeName];
    if (empData) {
      setEmployeeType(empData.type || 'parttime');
      if (empData.type === 'parttime') setHourlyRate(empData.salary || 25000);
      else {
        setMonthlySalary(empData.salary || 7000000);
        setFtWorkScheduleMode(empData.workScheduleMode
          || (empData.standardStart && empData.standardEnd ? 'fixed' : 'rotating'));
        setFtStandardHoursPerDay(Number(empData.standardHoursPerDay) || 8);
        setFtStandardStart(empData.standardStart || '16:00');
        setFtStandardEnd(empData.standardEnd || '23:00');
      }
    }
    setWorkDate(record.date);
    setRecordStatus(record.status || 'work');
    const savedRate = record.dayRate || 1;
    setIsHoliday(savedRate > 1);
    setDayRate(savedRate > 1 ? savedRate : 3);
    setCheckIn(record.checkIn || '');
    setCheckOut(record.checkOut || '');
    setOtHours(record.otHours || '');
    setLateHours(record.lateHours || '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Deleting needs a reason, which is kept with a copy of the record in the audit log.
  const handleDelete = (id) => {
    if (demoMode) return showToast(t('demo.no_delete'), 'warning');
    setDeleteReason('');
    setDeleteTarget(records.find(r => r.id === id) || null);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    if (deleteReason.trim().length < 5) {
      showToast(t('audit.reason_too_short'), 'warning');
      return;
    }
    setIsDeleting(true);
    try {
      await deleteTimesheet(deleteTarget.id, deleteReason.trim());
      setRecords(previous => previous.filter(r => r.id !== deleteTarget.id));
      if (editingId === deleteTarget.id) resetForm();
      setDeleteTarget(null);
      showToast(t('audit.deleted_with_log'), 'success');
    } catch (error) {
      showToast(error.message || t('common.error'), 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  // Calendar data
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysCount = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const blanks = Array(firstDay === 0 ? 6 : firstDay - 1).fill(null);
  const days = Array.from({ length: daysCount }, (_, i) => i + 1);

  const filterRecordsByDate = (dateStr) => {
    if (!employeeName.trim()) return [];
    return records.filter(r => r.date === dateStr && r.employeeName === employeeName.trim());
  };

  const selectedDateRecords = (selectedDate && employeeName.trim())
    ? records.filter(r => r.date === selectedDate && r.employeeName === employeeName.trim())
    : [];

  const filteredAllRecords = useMemo(() => {
    let result = records.filter(r => r.date && r.date.startsWith(filterMonth));

    if (filterType !== 'all') {
      result = result.filter(r => {
        const emp = savedEmployees[r.employeeName];
        return emp ? emp.type === filterType : filterType === 'parttime';
      });
    }

    if (filterStatus !== 'all') {
      switch (filterStatus) {
        case 'work':
          result = result.filter(r => r.status === 'work' && !(r.lateHours > 0) && !(r.otHours > 0) && r.checkOut);
          break;
        case 'late':
          result = result.filter(r => r.status === 'work' && r.lateHours > 0);
          break;
        case 'ot':
          result = result.filter(r => r.status === 'work' && r.otHours > 0);
          break;
        case 'off':
          result = result.filter(r => r.status === 'off');
          break;
        case 'missing_checkout':
          result = result.filter(r => isForgottenCheckout(r, localDateString()));
          break;
      }
    }

    if (filterEmployee.trim()) {
      result = result.filter(r =>
        r.employeeName.toLowerCase().includes(filterEmployee.toLowerCase())
      );
    }

    return result.sort((a, b) => {
      if (b.date !== a.date) return b.date.localeCompare(a.date);
      return (a.employeeName || '').localeCompare(b.employeeName || '');
    });
  }, [records, filterMonth, filterType, filterStatus, filterEmployee, savedEmployees]);

  const monthStats = useMemo(() => {
    const base = records.filter(r => r.date && r.date.startsWith(filterMonth));
    return {
      total: base.length,
      work: base.filter(r => r.status === 'work' && r.checkOut).length,
      off: base.filter(r => r.status === 'off').length,
      late: base.filter(r => r.status === 'work' && r.lateHours > 0).length,
      ot: base.filter(r => r.status === 'work' && r.otHours > 0).length,
      missing: base.filter(r => isForgottenCheckout(r, localDateString())).length,
    };
  }, [records, filterMonth]);

  const tagStyle = (bg, color) => ({ background: bg, color, padding: '3px 10px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 'bold' });
  const chipStyle = (bg, color) => ({ background: bg, color, padding: '2px 8px', borderRadius: '10px', fontSize: '0.72rem', fontWeight: '700', whiteSpace: 'nowrap' });

  const renderFormStatusTag = () => {
    if (recordStatus === 'off') return <span style={tagStyle('#fee2e2', '#9a2a20')}>{t('timesheet_extra.tag_off')}</span>;
    if (Number(lateHours) > 0) return <span style={tagStyle('#fef08a', '#a16207')}>{t('timesheet_extra.tag_late')}</span>;
    if (Number(otHours) > 0) return <span style={tagStyle('#ffedd5', '#c2410c')}>{t('timesheet_extra.tag_ot')}</span>;
    return <span style={tagStyle('#dcfce7', '#1f6b44')}>{t('timesheet_extra.filter_status_work')}</span>;
  };

  const renderRowTag = (r) => {
    const rate = r.dayRate || 1;
    const holidayBadge = rate > 1
      ? <span style={chipStyle('#fce7f3', '#be185d')}>×{rate} {t('timesheet_extra.tag_holiday')}</span>
      : null;
    let statusBadge;
    if (r.status === 'off') statusBadge = <span style={chipStyle('#fee2e2', '#9a2a20')}>{t('timesheet_extra.tag_off')}</span>;
    else if (isStillWorking(r, localDateString())) statusBadge = <span style={chipStyle('#e4f3ea', '#23854f')}>{t('home.status_working')}</span>;
    else if (isForgottenCheckout(r, localDateString())) statusBadge = <span style={chipStyle('#fbe9e6', '#c0362a')}>{t('timesheet_extra.tag_missing_co')}</span>;
    else if (r.lateHours > 0) statusBadge = <span style={chipStyle('#fef08a', '#a16207')}>{t('timesheet_extra.tag_late')}</span>;
    else if (r.otHours > 0) statusBadge = <span style={chipStyle('#ffedd5', '#c2410c')}>{t('timesheet_extra.tag_ot')}</span>;
    else statusBadge = <span style={chipStyle('#dcfce7', '#1f6b44')}>{t('timesheet_extra.tag_ok')}</span>;
    const editedBadge = r.editedManually
      ? <span style={chipStyle('#f6ece2', '#6b3a1f')} title={t('audit.edited_hint')}><i className="fas fa-pen" aria-hidden="true"></i> {t('audit.edited_badge')}</span>
      : null;
    return <span style={{ display: 'inline-flex', gap: '4px', flexWrap: 'wrap' }}>{holidayBadge}{statusBadge}{editedBadge}</span>;
  };

  const typeLabel = (name) => {
    const emp = savedEmployees[name];
    if (!emp) return null;
    return emp.type === 'fulltime'
      ? <span style={chipStyle('#e3eff4', '#2f6f8f')}>{t('timesheet_extra.filter_fulltime')}</span>
      : <span style={chipStyle('#fbead6', '#6b3a1f')}>{t('timesheet_extra.filter_parttime')}</span>;
  };

  const exportToExcel = () => {
    const statusLabel = (r) => {
      if (r.status === 'off') return t('timesheet_extra.tag_off');
      if (isStillWorking(r, localDateString())) return t('home.status_working');
      if (!r.checkOut) return t('timesheet_extra.tag_missing_co');
      if (r.lateHours > 0) return t('timesheet_extra.tag_late');
      if (r.otHours > 0) return t('timesheet_extra.tag_ot');
      return t('timesheet_extra.filter_status_work');
    };
    const data = filteredAllRecords.map(r => ({
      [t('timesheet_extra.col_date')]: r.date,
      [t('timesheet_extra.col_employee')]: r.employeeName,
      [t('timesheet_extra.col_type')]: (savedEmployees[r.employeeName]?.type === 'fulltime') ? 'Full-time' : 'Part-time',
      [t('timesheet_extra.col_rate')]: r.dayRate || 1,
      [t('timesheet_extra.col_checkin')]: r.checkIn || '',
      [t('timesheet_extra.col_checkout')]: r.checkOut || '',
      [t('timesheet_extra.col_hours')]: r.workHours ? Number(r.workHours).toFixed(2) : 0,
      [t('timesheet_extra.col_ot')]: r.otHours || 0,
      [t('timesheet_extra.col_late')]: r.lateHours ? Number(r.lateHours).toFixed(2) : 0,
      [t('timesheet_extra.col_status')]: statusLabel(r),
    }));
    const headers = Object.keys(data[0] || {});
    downloadCsv([headers, ...data.map(row => headers.map(header => row[header]))], `timesheet-${filterMonth}.csv`);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h2 className="page-title">{t('timesheet_extra.page_title')}</h2>
          <p className="page-sub">{t('timesheet_extra.page_sub')}</p>
        </div>
        {!editingId && (
          <button type="button" className={showManualForm ? 'btn-secondary' : 'btn-primary'} onClick={() => setShowManualForm(open => !open)}>
            <i className={showManualForm ? 'fas fa-times' : 'fas fa-plus'} aria-hidden="true"></i>
            {showManualForm ? t('timesheet_extra.manual_close') : t('timesheet_extra.manual_add')}
          </button>
        )}
      </div>
      {/* ─── FORM + CALENDAR (manual entry, opened on demand) ─── */}
      {(showManualForm || editingId) && (
      <div className="card grid-2">
        <div className="form-section">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '15px', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
            <h3 style={{ margin: 0, color: 'var(--primary)' }}>
              {editingId ? `✏️ ${t('timesheet_extra.form_title_edit')}` : `✨ ${t('timesheet_extra.form_title_add')}`}
            </h3>
            {employeeName.trim() && renderFormStatusTag()}
          </div>

          <div className="form-group">
            <label>{t('employee.name')}</label>
            <input
              type="text"
              list="employee-suggestions"
              placeholder={t('timesheet_extra.name_placeholder')}
              value={employeeName}
              onChange={(e) => {
                const name = e.target.value;
                setEmployeeName(name);
                if (savedEmployees[name]) {
                  const emp = savedEmployees[name];
                  setEmployeeType(emp.type || 'parttime');
                  if (emp.type === 'parttime') setHourlyRate(emp.salary || 25000);
                  else {
                    setMonthlySalary(emp.salary || 7000000);
                    setFtWorkScheduleMode(emp.workScheduleMode
                      || (emp.standardStart && emp.standardEnd ? 'fixed' : 'rotating'));
                    setFtStandardHoursPerDay(Number(emp.standardHoursPerDay) || 8);
                    setFtStandardStart(emp.standardStart || '16:00');
                    setFtStandardEnd(emp.standardEnd || '23:00');
                  }
                }
              }}
            />
            <datalist id="employee-suggestions">
              {Object.keys(savedEmployees).map((name, idx) => <option key={idx} value={name} />)}
            </datalist>
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label>{t('employee.type')}</label>
              <div style={{ display: 'flex', gap: '15px' }}>
                <label><input type="radio" checked={employeeType === 'parttime'} onChange={() => setEmployeeType('parttime')} /> {t('timesheet_extra.filter_parttime')}</label>
                <label><input type="radio" checked={employeeType === 'fulltime'} onChange={() => setEmployeeType('fulltime')} /> {t('timesheet_extra.filter_fulltime')}</label>
              </div>
            </div>
            <div className="form-group">
              <label>{t('timesheet_extra.record_status')}</label>
              <div style={{ display: 'flex', gap: '15px' }}>
                <label><input type="radio" checked={recordStatus === 'work'} onChange={() => setRecordStatus('work')} /> <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>{t('timesheet_extra.status_work')}</span></label>
                <label><input type="radio" checked={recordStatus === 'off'} onChange={() => setRecordStatus('off')} /> <span style={{ color: 'var(--danger)', fontWeight: 'bold' }}>{t('timesheet_extra.status_off_label')}</span></label>
              </div>
            </div>
          </div>

          {employeeType === 'parttime' ? (
            <div className="form-group">
              <label>{t('employee.hourly_rate')}</label>
              <input type="text" value={new Intl.NumberFormat('vi-VN').format(hourlyRate)} onChange={(e) => {
                const raw = e.target.value.replace(/\D/g, '');
                setHourlyRate(Number(raw) || 0);
              }} />
            </div>
          ) : (
            <div className="form-group">
              <label>{t('employee.monthly_salary')}</label>
              <input type="text" value={new Intl.NumberFormat('vi-VN').format(monthlySalary)} onChange={(e) => {
                const raw = e.target.value.replace(/\D/g, '');
                setMonthlySalary(Number(raw) || 0);
              }} />
            </div>
          )}

          <div className="form-group">
            <label>{t('timesheet.work_date')}</label>
            <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
          </div>

          {recordStatus === 'work' && (
            <div className="form-group">
              <label
                style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => setIsHoliday(v => !v)}
              >
                <span style={{
                  width: '20px', height: '20px', borderRadius: '5px', flexShrink: 0,
                  border: `2px solid ${isHoliday ? '#be185d' : 'var(--border)'}`,
                  background: isHoliday ? '#be185d' : 'white',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isHoliday && <i className="fas fa-check" style={{ color: 'white', fontSize: '11px' }}></i>}
                </span>
                <span style={{ color: isHoliday ? '#be185d' : 'var(--text-main)', fontWeight: isHoliday ? '700' : '400' }}>
                  {t('timesheet_extra.holiday_label')}
                </span>
              </label>

              {isHoliday && (
                <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px', background: '#fdf2f8', padding: '10px 14px', borderRadius: '8px', border: '1.5px solid #f9a8d4' }}>
                  <span style={{ color: '#be185d', fontWeight: '600', whiteSpace: 'nowrap' }}>{t('timesheet_extra.salary_multiplier')}</span>
                  <input
                    type="number"
                    min="1.5"
                    max="10"
                    step="0.5"
                    value={dayRate}
                    onChange={e => setDayRate(Number(e.target.value) || 3)}
                    style={{
                      width: '80px', padding: '6px 10px', borderRadius: '6px',
                      border: '1.5px solid #f9a8d4', fontSize: '1.1rem', fontWeight: '800',
                      color: '#be185d', textAlign: 'center',
                    }}
                  />
                  <span style={{ color: '#be185d', fontSize: '0.9rem' }}>×{dayRate}</span>
                </div>
              )}
            </div>
          )}

          {recordStatus === 'work' && (
            <>
              <div className="grid-2">
                <div className="form-group"><label>{t('timesheet_extra.checkin_time')}</label><input type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} /></div>
                <div className="form-group"><label>{t('timesheet_extra.checkout_time')}</label><input type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} /></div>
              </div>
              {employeeType === 'fulltime' ? (
                <div className="grid-2">
                  <div className="form-group">
                    <label>{t('timesheet_extra.late_hours_short')}</label>
                    <input type="number" step="0.25" min="0" placeholder={t('timesheet_extra.auto_calc_ph')} value={lateHours} onChange={(e) => setLateHours(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>{t('timesheet_extra.ot_hours_short')}</label>
                    <input
                      type="number"
                      step="0.25"
                      min="0"
                      placeholder={t('timesheet_extra.auto_calc_ph')}
                      value={otHours}
                      readOnly={ftWorkScheduleMode === 'rotating'}
                      onChange={(e) => setOtHours(e.target.value)}
                      title={ftWorkScheduleMode === 'rotating'
                        ? t('timesheet_extra.rotating_ot_title', { hours: ftStandardHoursPerDay })
                        : undefined}
                    />
                    {ftWorkScheduleMode === 'rotating' && (
                      <small style={{ color: 'var(--text-muted)' }}>
                        {t('timesheet_extra.rotating_ot_title', { hours: ftStandardHoursPerDay })}
                      </small>
                    )}
                  </div>
                </div>
              ) : (
                <div className="form-group">
                  <label>{t('timesheet_extra.ot_hours_short')}</label>
                  <input type="number" step="0.25" min="0" value={otHours} onChange={(e) => setOtHours(e.target.value)} />
                </div>
              )}
            </>
          )}

          {/* Mandatory edit reason */}
          {editingId && (
            <div className="form-group" style={{ marginTop: '10px' }}>
              <label style={{ color: '#c0362a', fontWeight: '700' }}>
                <i className="fas fa-exclamation-circle" style={{ marginRight: '5px' }}></i>
                {t('timesheet_extra.edit_reason_label')} <span style={{ color: '#c0362a' }}>*</span>
              </label>
              <textarea
                rows={2}
                placeholder={t('timesheet_extra.edit_reason_placeholder')}
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                style={{
                  width: '100%', padding: '10px', borderRadius: '8px',
                  border: editReason.trim() ? '1.5px solid #2e9e6a' : '1.5px solid #c0362a',
                  resize: 'vertical', fontFamily: 'inherit', fontSize: '0.9rem',
                  background: '#fff8f8', outline: 'none',
                }}
              />
              {!editReason.trim() && (
                <span style={{ fontSize: '0.78rem', color: '#c0362a' }}>{t('timesheet_extra.edit_reason_required')}</span>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
            <button
              className="btn-primary"
              style={{ flex: 1, backgroundColor: recordStatus === 'off' ? 'var(--danger)' : 'var(--primary)' }}
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? '...' : (editingId ? t('common.update') : t('common.save'))}
            </button>
            {editingId && (
              <button style={{ padding: '12px 16px', background: '#ece2d6', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }} onClick={resetForm}>
                {t('common.cancel')}
              </button>
            )}
          </div>
        </div>

        {/* Calendar */}
        <div className="calendar-section">
          {!employeeName.trim() ? (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px dashed var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '1rem', lineHeight: '1.8' }}>
                <i className="fas fa-calendar-alt" style={{ fontSize: '2rem', marginBottom: '10px', color: '#dccdbe', display: 'block' }}></i>
                {t('timesheet_extra.filter_employee')}
              </p>
            </div>
          ) : (
            <>
              <div className="calendar-header">
                <button onClick={() => setCurrentMonth(new Date(year, month - 1, 1))}><i className="fas fa-chevron-left"></i></button>
                <h3 style={{ margin: 0, textTransform: 'capitalize' }}>
                  {currentMonth.toLocaleString(i18n.language === 'vi' ? 'vi-VN' : 'en-US', { month: 'long', year: 'numeric' })}
                </h3>
                <button onClick={() => setCurrentMonth(new Date(year, month + 1, 1))}><i className="fas fa-chevron-right"></i></button>
              </div>
              <div className="calendar-grid">
                {DAY_HEADERS.map(d => <div key={d} className="calendar-day-header">{d}</div>)}
                {blanks.map((_, i) => <div key={`b${i}`} className="calendar-day empty"></div>)}
                {days.map(day => {
                  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const dayRecs = filterRecordsByDate(dateStr);
                  const isSelected = selectedDate === dateStr;
                  const hasOff = dayRecs.some(r => r.status === 'off');
                  const hasLate = dayRecs.some(r => r.lateHours > 0);
                  const hasOT = dayRecs.some(r => r.otHours > 0);
                  const hasWork = dayRecs.some(r => r.status === 'work');
                  let bgClass = '';
                  if (hasOff) bgClass = 'bg-off';
                  else if (hasLate) bgClass = 'bg-late';
                  else if (hasOT) bgClass = 'bg-ot';
                  else if (hasWork) bgClass = 'bg-work';
                  return (
                    <div
                      key={day}
                      className={`calendar-day ${isSelected ? 'selected' : ''} ${bgClass}`}
                      onClick={() => {
                        if (isSelected) { setSelectedDate(null); setWorkDate(''); }
                        else { setSelectedDate(dateStr); setWorkDate(dateStr); }
                      }}
                    >
                      <span className="day-number" style={{ fontWeight: hasWork || hasOff ? 'bold' : 'normal' }}>{day}</span>
                      <div className="status-dots">
                        {hasOff && <span className="dot-status off"></span>}
                        {hasLate && <span className="dot-status late"></span>}
                        {hasOT && <span className="dot-status ot"></span>}
                        {hasWork && !hasOT && !hasLate && <span className="dot-status work"></span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
      )}

      {!demoMode && <AttendanceSecurityPanel organizationId={organizationId} db={db} showToast={showToast} showConfirm={showConfirm} />}

      {/* ─── DAY DETAIL PANEL ─── */}
      {employeeName.trim() && selectedDate && (
        <div className="card" style={{ marginTop: '20px' }}>
          <h3 style={{ marginTop: 0, color: 'var(--primary)', borderBottom: '2px solid var(--border)', paddingBottom: '10px' }}>
            {t('timesheet_extra.day_detail_title')} {selectedDate} — {employeeName}
          </h3>
          {selectedDateRecords.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>{t('timesheet_extra.no_records_day')}</p>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>{t('timesheet_extra.col_employee')}</th>
                    <th>{t('timesheet_extra.col_checkin')}</th>
                    <th>{t('timesheet_extra.col_checkout')}</th>
                    <th>{t('timesheet_extra.col_hours')}</th>
                    <th>{t('timesheet_extra.col_ot')}</th>
                    <th>{t('timesheet_extra.col_late')}</th>
                    <th style={{ textAlign: 'center' }}>{t('timesheet_extra.col_actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedDateRecords.map(record => (
                    <tr key={record.id} style={editingId === record.id ? { backgroundColor: '#fffbeb', boxShadow: 'inset 4px 0 0 0 var(--warning)' } : {}}>
                      <td style={{ fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {record.employeeName} {renderRowTag(record)}
                      </td>
                      <td>{record.status === 'off' ? '—' : record.checkIn}</td>
                      <td>{record.status === 'off' ? '—' : (record.checkOut || <span style={{ color: '#2f6f8f', fontWeight: '600' }}>{t('timesheet_extra.not_checked_out')}</span>)}</td>
                      <td>{record.status === 'off' ? '—' : `${(record.workHours || 0).toFixed(2)}h`}</td>
                      <td style={{ color: record.otHours > 0 ? 'var(--warning)' : 'inherit', fontWeight: record.otHours > 0 ? '600' : 'normal' }}>
                        {record.status === 'off' ? '—' : (record.otHours > 0 ? `${record.otHours}h` : '—')}
                      </td>
                      <td style={{ color: record.lateHours > 0 ? '#c0362a' : 'inherit' }}>
                        {record.status === 'off' ? '—' : (record.lateHours > 0 ? `${Number(record.lateHours).toFixed(2)}h` : '—')}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <div className="action-buttons">
                          <button className="btn-warning" onClick={() => handleEditClick(record)}>{t('common.edit')}</button>
                          <button className="btn-danger" onClick={() => handleDelete(record.id)}>{t('common.delete')}</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── ALL RECORDS TABLE WITH FILTERS ─── */}
      <div className="card" style={{ marginTop: '24px' }}>
        <div style={{ borderBottom: '2px solid var(--border)', paddingBottom: '12px', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <h3 style={{ margin: 0, color: 'var(--primary)' }}>
            <i className="fas fa-table" style={{ marginRight: '8px' }}></i>
            {t('timesheet_extra.table_title')}
          </h3>
          <button
            onClick={exportToExcel}
            disabled={filteredAllRecords.length === 0}
            style={{
              padding: '8px 16px', borderRadius: '8px', border: '1.5px solid #23854f',
              background: filteredAllRecords.length === 0 ? '#f5eee6' : '#f0fdf4',
              color: filteredAllRecords.length === 0 ? '#a39486' : '#23854f',
              fontWeight: '700', fontSize: '0.85rem', cursor: filteredAllRecords.length === 0 ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}
          >
            <i className="fas fa-file-excel" />
            {t('timesheet_extra.export_excel')} ({filteredAllRecords.length})
          </button>
        </div>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
          {[
            { label: t('timesheet_extra.stat_total'),      value: monthStats.total,   bg: '#f5eee6', color: '#4a3b32' },
            { label: t('timesheet_extra.stat_on_time'),    value: monthStats.work,    bg: '#dcfce7', color: '#1f6b44' },
            { label: t('timesheet_extra.stat_late'),       value: monthStats.late,    bg: '#fef9c3', color: '#854d0e' },
            { label: t('timesheet_extra.stat_ot'),         value: monthStats.ot,      bg: '#ffedd5', color: '#9a3412' },
            { label: t('timesheet_extra.stat_off'),        value: monthStats.off,     bg: '#fee2e2', color: '#8a251c' },
            { label: t('timesheet_extra.stat_missing_co'), value: monthStats.missing, bg: '#f6ece2', color: '#5b21b6' },
          ].map(s => (
            <div key={s.label} style={{ background: s.bg, color: s.color, borderRadius: '8px', padding: '8px 14px', fontSize: '0.85rem', fontWeight: '700', display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '70px' }}>
              <span style={{ fontSize: '1.3rem', fontWeight: '800' }}>{s.value}</span>
              <span>{s.label}</span>
            </div>
          ))}
        </div>

        {/* Filter row */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ margin: 0, minWidth: '160px' }}>
            <label style={{ fontSize: '0.8rem', marginBottom: '4px', display: 'block' }}>{t('timesheet_extra.filter_month')}</label>
            <input
              type="month"
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
              style={{ padding: '8px 10px', borderRadius: '8px', border: '1.5px solid var(--border)', fontSize: '0.9rem' }}
            />
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '0.8rem', marginBottom: '4px', display: 'block' }}>{t('timesheet_extra.filter_type')}</label>
            <div style={{ display: 'flex', gap: '4px' }}>
              {[
                { v: 'all',      l: t('timesheet_extra.filter_all') },
                { v: 'parttime', l: t('timesheet_extra.filter_parttime') },
                { v: 'fulltime', l: t('timesheet_extra.filter_fulltime') },
              ].map(o => (
                <button key={o.v} onClick={() => setFilterType(o.v)} style={{
                  padding: '7px 12px', borderRadius: '7px', border: '1.5px solid',
                  borderColor: filterType === o.v ? 'var(--primary)' : 'var(--border)',
                  background: filterType === o.v ? 'var(--primary)' : 'white',
                  color: filterType === o.v ? 'white' : 'var(--text-main)',
                  fontWeight: filterType === o.v ? '700' : '400',
                  cursor: 'pointer', fontSize: '0.85rem',
                }}>{o.l}</button>
              ))}
            </div>
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '0.8rem', marginBottom: '4px', display: 'block' }}>{t('timesheet_extra.filter_status_label')}</label>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {STATUS_FILTERS.map(o => (
                <button key={o.value} onClick={() => setFilterStatus(o.value)} style={{
                  padding: '7px 10px', borderRadius: '7px', border: '1.5px solid',
                  borderColor: filterStatus === o.value ? o.color : 'var(--border)',
                  background: filterStatus === o.value ? o.color : 'white',
                  color: filterStatus === o.value ? 'white' : 'var(--text-main)',
                  fontWeight: filterStatus === o.value ? '700' : '400',
                  cursor: 'pointer', fontSize: '0.82rem',
                }}>{o.label}</button>
              ))}
            </div>
          </div>

          <div className="form-group" style={{ margin: 0, flex: 1, minWidth: '180px' }}>
            <label style={{ fontSize: '0.8rem', marginBottom: '4px', display: 'block' }}>{t('timesheet_extra.filter_employee')}</label>
            <input
              type="text"
              placeholder={t('timesheet_extra.filter_employee_ph')}
              value={filterEmployee}
              onChange={(e) => setFilterEmployee(e.target.value)}
              style={{ padding: '8px 10px', borderRadius: '8px', border: '1.5px solid var(--border)', fontSize: '0.9rem', width: '100%' }}
            />
          </div>
        </div>

        {/* Records table */}
        {filteredAllRecords.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
            <i className="fas fa-search" style={{ fontSize: '2rem', marginBottom: '10px', display: 'block', color: '#dccdbe' }}></i>
            {t('timesheet_extra.no_records_found')}
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>{t('timesheet_extra.col_date')}</th>
                  <th>{t('timesheet_extra.col_employee')}</th>
                  <th>{t('timesheet_extra.col_type')}</th>
                  <th>{t('timesheet_extra.col_rate')}</th>
                  <th>{t('timesheet_extra.col_checkin')}</th>
                  <th>{t('timesheet_extra.col_checkout')}</th>
                  <th>{t('timesheet_extra.col_hours')}</th>
                  <th>{t('timesheet_extra.col_ot')}</th>
                  <th>{t('timesheet_extra.col_late')}</th>
                  <th>{t('timesheet_extra.col_status')}</th>
                  <th style={{ textAlign: 'center' }}>{t('timesheet_extra.col_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredAllRecords.map(record => (
                  <tr
                    key={record.id}
                    style={editingId === record.id ? { backgroundColor: '#fffbeb', boxShadow: 'inset 4px 0 0 0 var(--warning)' } : {}}
                  >
                    <td style={{ fontWeight: '500', whiteSpace: 'nowrap' }}>{record.date}</td>
                    <td style={{ fontWeight: '600' }}>{record.employeeName}</td>
                    <td>{typeLabel(record.employeeName)}</td>
                    <td>
                      {(record.dayRate || 1) > 1
                        ? <span style={{ background: '#fce7f3', color: '#be185d', padding: '2px 8px', borderRadius: '8px', fontWeight: '800', fontSize: '0.8rem' }}>×{record.dayRate}</span>
                        : <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>×1</span>}
                    </td>
                    <td>{record.status === 'off' ? '—' : (record.checkIn || '—')}</td>
                    <td>
                      {record.status === 'off' ? '—' : (
                        record.checkOut
                          ? record.checkOut
                          : <span style={{ color: '#2f6f8f', fontWeight: '600', fontSize: '0.8rem' }}>{t('timesheet_extra.not_checked_out')}</span>
                      )}
                    </td>
                    <td style={{ fontWeight: '500' }}>
                      {record.status === 'off' ? '—' : `${(record.workHours || 0).toFixed(1)}h`}
                    </td>
                    <td style={{ color: record.otHours > 0 ? '#f97316' : 'inherit', fontWeight: record.otHours > 0 ? '700' : '400' }}>
                      {record.otHours > 0 ? `${record.otHours}h` : '—'}
                    </td>
                    <td style={{ color: record.lateHours > 0 ? '#c0362a' : 'inherit', fontWeight: record.lateHours > 0 ? '700' : '400' }}>
                      {record.lateHours > 0 ? `${Number(record.lateHours).toFixed(2)}h` : '—'}
                    </td>
                    <td>{renderRowTag(record)}</td>
                    <td style={{ textAlign: 'center' }}>
                      <div className="action-buttons">
                        <button className="btn-warning" onClick={() => handleEditClick(record)}>{t('common.edit')}</button>
                        <button className="btn-danger" onClick={() => handleDelete(record.id)}>{t('common.delete')}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ textAlign: 'right', marginTop: '10px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              {t('timesheet_extra.showing_records', { count: filteredAllRecords.length })}
            </div>
          </div>
        )}
      </div>

      {!demoMode && <AuditLogPanel db={db} organizationId={organizationId} />}

      {deleteTarget && (
        <div className="modal-overlay">
          <div className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-record-title">
            <h3 id="delete-record-title"><i className="fas fa-trash" aria-hidden="true"></i> {t('audit.delete_title')}</h3>
            <p>{t('audit.delete_body', { name: deleteTarget.employeeName, date: deleteTarget.date })}</p>
            <label htmlFor="delete-reason" style={{ textAlign: 'left' }}>{t('audit.reason_label')}</label>
            <textarea
              id="delete-reason"
              rows={3}
              value={deleteReason}
              onChange={event => setDeleteReason(event.target.value)}
              placeholder={t('audit.delete_placeholder')}
              style={{ marginBottom: '16px', resize: 'vertical' }}
              autoFocus
            />
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setDeleteTarget(null)} disabled={isDeleting}>{t('common.cancel')}</button>
              <button type="button" className="btn-confirm" onClick={confirmDelete} disabled={isDeleting || deleteReason.trim().length < 5}>
                {isDeleting ? t('authui.processing') : t('audit.delete_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
