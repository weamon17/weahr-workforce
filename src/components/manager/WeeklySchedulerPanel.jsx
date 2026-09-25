import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  buildShiftSlots,
  generateWeeklyAssignments,
  getNextWeekStart,
  getRegistrationDeadline,
  applyApprovedSwaps,
  shiftsOverlap,
  WEEKDAY_LABELS,
} from '../../utils/weeklyScheduler';
import { hourlyLaborCost } from '../../utils/payroll';
import { POSITION_OPTIONS } from '../../utils/skills';

const createDefaultSettings = organizationId => ({
  organizationId,
  registrationWeekday: 4,
  registrationCloseTime: '18:00',
  minShiftsPerEmployee: 1,
  maxShiftsPerEmployee: 6,
  autoGenerate: true,
  shiftTemplates: [
    { id: 'morning', name: 'Ca sáng', startTime: '07:00', endTime: '12:00', requiredEmployees: 2, requiredSkill: '', days: [0, 1, 2, 3, 4, 5, 6] },
    { id: 'afternoon', name: 'Ca chiều', startTime: '12:00', endTime: '17:00', requiredEmployees: 2, requiredSkill: '', days: [0, 1, 2, 3, 4, 5, 6] },
    { id: 'evening', name: 'Ca tối', startTime: '17:00', endTime: '22:00', requiredEmployees: 2, requiredSkill: '', days: [0, 1, 2, 3, 4, 5, 6] },
  ],
});

const notificationId = value => value.replace(/[^a-zA-Z0-9_-]/g, '_');

export default function WeeklySchedulerPanel({ db, organizationId, employeeUsers, showToast }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'vi' ? 'vi-VN' : 'en-US';
  const weekStart = useMemo(() => getNextWeekStart(), []);
  const [settings, setSettings] = useState(() => createDefaultSettings(organizationId));
  const [submissions, setSubmissions] = useState([]);
  const [assignmentDocs, setAssignmentDocs] = useState([]);
  const [swapRequests, setSwapRequests] = useState([]);
  const [laborCosts, setLaborCosts] = useState(() => new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const slots = useMemo(
    () => buildShiftSlots(weekStart, settings.shiftTemplates),
    [settings.shiftTemplates, weekStart],
  );
  const deadline = useMemo(
    () => getRegistrationDeadline(weekStart, settings.registrationWeekday, settings.registrationCloseTime),
    [settings.registrationCloseTime, settings.registrationWeekday, weekStart],
  );
  // Submissions carry only the employee-visible rate; estimate cost from the
  // manager-only salary profile so full-time staff are not counted as free.
  const costedSubmissions = useMemo(() => submissions.map(item => (
    laborCosts.has(item.employeeId) ? { ...item, hourlyRate: laborCosts.get(item.employeeId) } : item
  )), [laborCosts, submissions]);
  const schedulePreview = useMemo(() => generateWeeklyAssignments({
    slots,
    submissions: costedSubmissions,
    minShifts: Number(settings.minShiftsPerEmployee) || 0,
    maxShifts: Number(settings.maxShiftsPerEmployee) || 6,
  }), [settings.maxShiftsPerEmployee, settings.minShiftsPerEmployee, slots, costedSubmissions]);

  const loadWeek = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const settingsRef = doc(db, 'schedule_settings', organizationId);
      const [settingsSnap, submissionSnap, assignmentSnap, swapSnap, profileSnap] = await Promise.all([
        getDoc(settingsRef),
        getDocs(query(
          collection(db, 'availability_submissions'),
          where('organizationId', '==', organizationId),
          where('weekStart', '==', weekStart),
        )),
        getDocs(query(
          collection(db, 'weekly_assignments'),
          where('organizationId', '==', organizationId),
          where('weekStart', '==', weekStart),
        )),
        getDocs(query(
          collection(db, 'shift_swap_requests'),
          where('organizationId', '==', organizationId),
          where('weekStart', '==', weekStart),
        )),
        getDocs(query(collection(db, 'employee_profiles'), where('organizationId', '==', organizationId))),
      ]);
      setLaborCosts(new Map(profileSnap.docs.map(item => [item.id, hourlyLaborCost(item.data())])));
      if (settingsSnap.exists()) {
        setSettings({ ...createDefaultSettings(organizationId), ...settingsSnap.data() });
      }
      setSubmissions(submissionSnap.docs.map(item => ({ id: item.id, ...item.data() })));
      setAssignmentDocs(assignmentSnap.docs.map(item => ({ id: item.id, ...item.data() })));
      setSwapRequests(swapSnap.docs.map(item => ({ id: item.id, ...item.data() })));
    } catch (error) {
      console.error('Weekly scheduler load failed:', error);
      showToast(t('scheduler.load_failed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [db, organizationId, showToast, t, weekStart]);

  useEffect(() => {
    loadWeek();
  }, [loadWeek]);

  const saveSettings = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, 'schedule_settings', organizationId), {
        ...settings,
        organizationId,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      showToast(t('scheduler.settings_saved'), 'success');
    } catch (error) {
      console.error(error);
      showToast(t('scheduler.settings_save_failed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const runGeneration = useCallback(async (automatic = false) => {
    if (running || !organizationId) return;
    setRunning(true);
    try {
      const [existingSnap, existingScheduleSnap, swapSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'weekly_assignments'),
          where('organizationId', '==', organizationId),
          where('weekStart', '==', weekStart),
        )),
        getDocs(query(
          collection(db, 'schedules'),
          where('organizationId', '==', organizationId),
          where('weekStart', '==', weekStart),
        )),
        getDocs(query(
          collection(db, 'shift_swap_requests'),
          where('organizationId', '==', organizationId),
          where('weekStart', '==', weekStart),
        )),
      ]);
      const weekSwaps = swapSnap.docs.map(item => ({ id: item.id, ...item.data() }));
      const result = applyApprovedSwaps(generateWeeklyAssignments({
        slots,
        submissions: costedSubmissions,
        minShifts: Number(settings.minShiftsPerEmployee) || 0,
        maxShifts: Number(settings.maxShiftsPerEmployee) || 6,
      }), weekSwaps);
      const batch = writeBatch(db);
      const writtenIds = new Set();

      const nextDocs = result.assignments.map(assignment => {
        const shifts = result.slots.filter(slot => assignment.slotIds.includes(slot.id));
        const id = `${organizationId}_${weekStart}_${assignment.employeeId}`;
        const data = {
          organizationId,
          weekStart,
          employeeId: assignment.employeeId,
          employeeName: assignment.employeeName,
          shifts,
          assignmentCount: assignment.assignmentCount,
          generatedAt: serverTimestamp(),
          generatedAutomatically: automatic,
          scheduleScore: result.scheduleScore,
          estimatedCost: assignment.estimatedCost,
        };
        batch.set(doc(db, 'weekly_assignments', id), data);
        writtenIds.add(`weekly_assignments/${id}`);
        shifts.forEach(shift => {
          const scheduleId = notificationId(`auto_${id}_${shift.id}`);
          writtenIds.add(`schedules/${scheduleId}`);
          batch.set(doc(db, 'schedules', scheduleId), {
            organizationId,
            weekStart,
            employeeId: assignment.employeeId,
            employeeName: assignment.employeeName,
            workDate: shift.date,
            startTime: shift.startTime,
            endTime: shift.endTime,
            shiftName: shift.name,
            requiredSkill: shift.requiredSkill || '',
            scheduleType: 'auto_generated',
            status: 'approved',
            approvedBy: 'system',
            approvedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
          });
        });
        batch.set(doc(db, 'notifications', notificationId(`weekly_schedule_${id}`)), {
          organizationId,
          recipientId: assignment.employeeId,
          recipientName: assignment.employeeName,
          senderId: 'system',
          senderEmail: 'system@weahr',
          type: 'weekly_schedule_published',
          title: 'Lịch làm tuần mới đã được xếp',
          message: `Bạn được xếp ${assignment.assignmentCount} ca trong tuần bắt đầu ${weekStart}.`,
          read: false,
          createdAt: serverTimestamp(),
        }, { merge: true });
        return { id, ...data };
      });
      // Remove only documents the new schedule no longer contains; a document is
      // never deleted and re-written in the same batch.
      existingSnap.docs
        .filter(item => !writtenIds.has(`weekly_assignments/${item.id}`))
        .forEach(item => batch.delete(item.ref));
      existingScheduleSnap.docs
        .filter(item => item.data().scheduleType === 'auto_generated' && !writtenIds.has(`schedules/${item.id}`))
        .forEach(item => batch.delete(item.ref));

      // Pending offers for shifts the offering employee no longer holds are void.
      const assignedSlotIds = new Map(result.assignments.map(item => [item.employeeId, new Set(item.slotIds)]));
      const staleSwaps = weekSwaps.filter(swap => ['open', 'claimed'].includes(swap.status)
        && !assignedSlotIds.get(swap.fromEmployeeId)?.has(swap.shift?.id));
      staleSwaps.forEach(swap => batch.set(doc(db, 'shift_swap_requests', swap.id), {
        status: 'cancelled',
        cancelReason: 'schedule_regenerated',
        resolvedAt: serverTimestamp(),
      }, { merge: true }));

      batch.set(doc(db, 'schedule_settings', organizationId), {
        lastGeneratedWeek: weekStart,
        lastGeneratedAt: serverTimestamp(),
      }, { merge: true });
      await batch.commit();
      setAssignmentDocs(nextDocs);
      const staleIds = new Set(staleSwaps.map(swap => swap.id));
      setSwapRequests(weekSwaps.map(swap => (staleIds.has(swap.id) ? { ...swap, status: 'cancelled' } : swap)));
      setSettings(previous => ({ ...previous, lastGeneratedWeek: weekStart }));
      const missing = result.slots.reduce((sum, slot) => sum + slot.unfilled, 0);
      const notes = [
        missing > 0 ? t('scheduler.note_missing', { count: missing }) : '',
        result.skippedSwaps.length > 0 ? t('scheduler.note_skipped_swaps', { count: result.skippedSwaps.length }) : '',
      ].filter(Boolean);
      showToast(
        notes.length > 0 ? t('scheduler.generated_with_notes', { notes: notes.join('; ') }) : t('scheduler.generated_full'),
        notes.length > 0 ? 'warning' : 'success',
      );
    } catch (error) {
      console.error('Automatic scheduling failed:', error);
      showToast(t('scheduler.generate_failed'), 'error');
    } finally {
      setRunning(false);
    }
  }, [db, organizationId, running, settings.maxShiftsPerEmployee, settings.minShiftsPerEmployee, showToast, slots, costedSubmissions, t, weekStart]);

  const sendRegistrationReminders = useCallback(async (automatic = false) => {
    if (!organizationId || employeeUsers.length === 0) return;
    try {
      const submittedIds = new Set(submissions.map(item => item.employeeId));
      const recipients = employeeUsers.filter(employee => !submittedIds.has(employee.id));
      const batch = writeBatch(db);
      recipients.forEach(employee => {
        const id = notificationId(`weekly_registration_${organizationId}_${weekStart}_${employee.id}`);
        batch.set(doc(db, 'notifications', id), {
          organizationId,
          recipientId: employee.id,
          recipientName: employee.fullName || employee.email,
          senderId: 'system',
          senderEmail: 'system@weahr',
          type: 'weekly_registration_reminder',
          title: 'Nhắc đăng ký lịch làm tuần tới',
          message: `Vui lòng đăng ký ca trước ${deadline.toLocaleString('vi-VN')}.`,
          read: false,
          createdAt: serverTimestamp(),
        }, { merge: true });
      });
      batch.set(doc(db, 'schedule_settings', organizationId), {
        lastReminderWeek: weekStart,
        lastReminderAt: serverTimestamp(),
      }, { merge: true });
      await batch.commit();
      setSettings(previous => ({ ...previous, lastReminderWeek: weekStart }));
      if (!automatic) showToast(t('scheduler.reminders_sent', { count: recipients.length }), 'success');
    } catch (error) {
      console.error('Registration reminder failed:', error);
      if (!automatic) showToast(t('scheduler.reminders_failed'), 'error');
    }
  }, [db, deadline, employeeUsers, organizationId, showToast, submissions, t, weekStart]);

  useEffect(() => {
    if (loading) return;
    const now = new Date();
    const reminderStart = new Date(deadline);
    reminderStart.setHours(0, 0, 0, 0);
    if (now >= reminderStart && settings.lastReminderWeek !== weekStart) {
      sendRegistrationReminders(true);
    }
    if (settings.autoGenerate && now >= deadline && settings.lastGeneratedWeek !== weekStart) {
      runGeneration(true);
    }
  }, [deadline, loading, runGeneration, sendRegistrationReminders, settings.autoGenerate, settings.lastGeneratedWeek, settings.lastReminderWeek, weekStart]);

  const updateTemplate = (id, field, value) => {
    setSettings(previous => ({
      ...previous,
      shiftTemplates: previous.shiftTemplates.map(template => template.id === id
        ? { ...template, [field]: value }
        : template),
    }));
  };

  const toggleTemplateDay = (id, day) => {
    setSettings(previous => ({
      ...previous,
      shiftTemplates: previous.shiftTemplates.map(template => {
        if (template.id !== id) return template;
        const days = template.days.includes(day)
          ? template.days.filter(value => value !== day)
          : [...template.days, day].sort();
        return { ...template, days };
      }),
    }));
  };

  const addTemplate = () => {
    setSettings(previous => ({
      ...previous,
      shiftTemplates: [...previous.shiftTemplates, {
        id: `shift_${Date.now()}`,
        name: 'Ca mới',
        startTime: '08:00',
        endTime: '12:00',
        requiredEmployees: 1,
        requiredSkill: '',
        days: [0, 1, 2, 3, 4, 5, 6],
      }],
    }));
  };

  const removeTemplate = id => {
    setSettings(previous => ({
      ...previous,
      shiftTemplates: previous.shiftTemplates.filter(template => template.id !== id),
    }));
  };

  const resolveSwap = async (request, approved) => {
    try {
      const requestRef = doc(db, 'shift_swap_requests', request.id);
      if (!approved) {
        const batch = writeBatch(db);
        batch.set(requestRef, { status: 'rejected', resolvedAt: serverTimestamp() }, { merge: true });
        await batch.commit();
        setSwapRequests(previous => previous.map(item => item.id === request.id ? { ...item, status: 'rejected' } : item));
        showToast(t('scheduler.swap_rejected'), 'success');
        return;
      }
      if (!request.claimedBy) return showToast(t('scheduler.swap_no_claimer'), 'warning');
      const sourceId = `${organizationId}_${weekStart}_${request.fromEmployeeId}`;
      const targetId = `${organizationId}_${weekStart}_${request.claimedBy}`;
      const [sourceSnap, targetSnap, scheduleSnap] = await Promise.all([
        getDoc(doc(db, 'weekly_assignments', sourceId)),
        getDoc(doc(db, 'weekly_assignments', targetId)),
        getDocs(query(collection(db, 'schedules'), where('organizationId', '==', organizationId), where('weekStart', '==', weekStart))),
      ]);
      if (!sourceSnap.exists()) throw new Error(t('scheduler.swap_source_missing'));
      const source = sourceSnap.data();
      const target = targetSnap.exists() ? targetSnap.data() : {
        organizationId, weekStart, employeeId: request.claimedBy, employeeName: request.claimedByName, shifts: [], assignmentCount: 0,
      };
      // The request document is employee-written, so trust only the published assignment.
      const offeredShift = (source.shifts || []).find(shift => shift.id === request.shift?.id);
      if (!offeredShift) throw new Error(t('scheduler.swap_shift_gone'));
      if ((target.shifts || []).some(shift => shift.id !== offeredShift.id && shiftsOverlap(shift, offeredShift))) {
        throw new Error(t('scheduler.swap_overlap'));
      }
      const sourceShifts = (source.shifts || []).filter(shift => shift.id !== offeredShift.id);
      const targetShifts = [...(target.shifts || []).filter(shift => shift.id !== offeredShift.id), offeredShift];
      const scheduleDocument = scheduleSnap.docs.find(item => {
        const schedule = item.data();
        return schedule.employeeId === request.fromEmployeeId
          && schedule.workDate === offeredShift.date
          && schedule.startTime === offeredShift.startTime;
      });
      if (!scheduleDocument) throw new Error(t('scheduler.swap_schedule_missing'));
      const batch = writeBatch(db);
      batch.set(doc(db, 'weekly_assignments', sourceId), { ...source, shifts: sourceShifts, assignmentCount: sourceShifts.length, updatedAt: serverTimestamp() });
      batch.set(doc(db, 'weekly_assignments', targetId), { ...target, employeeId: request.claimedBy, employeeName: request.claimedByName, shifts: targetShifts, assignmentCount: targetShifts.length, updatedAt: serverTimestamp() });
      batch.set(scheduleDocument.ref, { employeeId: request.claimedBy, employeeName: request.claimedByName, replacementFor: request.fromEmployeeId, updatedAt: serverTimestamp() }, { merge: true });
      batch.set(requestRef, { status: 'approved', resolvedAt: serverTimestamp() }, { merge: true });
      [request.fromEmployeeId, request.claimedBy].forEach(employeeId => batch.set(doc(db, 'notifications', notificationId(`swap_${request.id}_${employeeId}`)), {
        organizationId, recipientId: employeeId, senderId: 'system', senderEmail: 'system@weahr', type: 'shift_swap_resolved',
        title: 'Đổi ca đã được duyệt', message: `Ca ${offeredShift.date} ${offeredShift.startTime}–${offeredShift.endTime} đã được chuyển.`, read: false, createdAt: serverTimestamp(),
      }));
      await batch.commit();
      setAssignmentDocs(previous => previous.map(item => item.id === sourceId ? { ...item, shifts: sourceShifts, assignmentCount: sourceShifts.length } : item).filter(item => item.id !== targetId).concat({ id: targetId, ...target, shifts: targetShifts, assignmentCount: targetShifts.length }));
      setSwapRequests(previous => previous.map(item => item.id === request.id ? { ...item, status: 'approved' } : item));
      showToast(t('scheduler.swap_approved'), 'success');
    } catch (error) {
      showToast(t('scheduler.swap_failed', { error: error.message }), 'error');
    }
  };

  if (loading) return <div className="card">{t('scheduler.loading')}</div>;

  const submittedCount = submissions.length;
  const unsubmittedCount = Math.max(0, employeeUsers.length - submittedCount);

  return (
    <section className="card" style={{ border: '2px solid #e0e7ff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>{t('scheduler.title')}</h2>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
            {t('scheduler.week_and_deadline', { week: weekStart, deadline: deadline.toLocaleString(locale) })}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <span className="badge badge-success">{t('scheduler.badge_submitted', { count: submittedCount })}</span>
          <span className="badge badge-warning">{t('scheduler.badge_unsubmitted', { count: unsubmittedCount })}</span>
          <span className="badge">{t('scheduler.badge_assigned', { count: assignmentDocs.length })}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', marginTop: '18px' }}>
        <div style={{ padding: '14px', borderRadius: '12px', background: schedulePreview.scheduleScore >= 80 ? '#ecfdf5' : '#fffbeb' }}><small>Schedule Score</small><div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{schedulePreview.scheduleScore}/100</div></div>
        <div style={{ padding: '14px', borderRadius: '12px', background: '#eff6ff' }}><small>{t('scheduler.coverage')}</small><div style={{ fontSize: '1.3rem', fontWeight: 800 }}>{schedulePreview.totalAssigned}/{schedulePreview.totalRequired}</div></div>
        <div style={{ padding: '14px', borderRadius: '12px', background: '#f5f3ff' }}><small>{t('scheduler.estimated_cost')}</small><div style={{ fontSize: '1.3rem', fontWeight: 800 }}>{Math.round(schedulePreview.totalScheduledCost).toLocaleString('vi-VN')}đ</div></div>
      </div>

      <div className="form-grid" style={{ marginTop: '20px' }}>
        <div className="form-group">
          <label>{t('scheduler.field_deadline_day')}</label>
          <select value={settings.registrationWeekday} onChange={event => setSettings(previous => ({ ...previous, registrationWeekday: Number(event.target.value) }))}>
            {WEEKDAY_LABELS.map((label, index) => <option key={label} value={index}>{t(`weekday.${index}`)}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>{t('scheduler.field_deadline_time')}</label>
          <input type="time" value={settings.registrationCloseTime} onChange={event => setSettings(previous => ({ ...previous, registrationCloseTime: event.target.value }))} />
        </div>
        <div className="form-group">
          <label>{t('scheduler.field_min_shifts')}</label>
          <input type="number" min="0" value={settings.minShiftsPerEmployee} onChange={event => setSettings(previous => ({ ...previous, minShiftsPerEmployee: Number(event.target.value) }))} />
        </div>
        <div className="form-group">
          <label>{t('scheduler.field_max_shifts')}</label>
          <input type="number" min="1" value={settings.maxShiftsPerEmployee} onChange={event => setSettings(previous => ({ ...previous, maxShiftsPerEmployee: Number(event.target.value) }))} />
        </div>
      </div>

      <label style={{ display: 'flex', gap: '8px', alignItems: 'center', margin: '12px 0 20px' }}>
        <input type="checkbox" checked={settings.autoGenerate} onChange={event => setSettings(previous => ({ ...previous, autoGenerate: event.target.checked }))} />
        {t('scheduler.auto_generate')}
      </label>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
        <h3>{t('scheduler.templates_title')}</h3>
        <button type="button" className="btn-secondary" onClick={addTemplate}>{t('scheduler.add_shift')}</button>
      </div>
      <div style={{ display: 'grid', gap: '12px' }}>
        {settings.shiftTemplates.map(template => (
          <div key={template.id} style={{ padding: '14px', border: '1px solid var(--border)', borderRadius: '12px' }}>
            <div className="form-grid">
              <input value={template.name} onChange={event => updateTemplate(template.id, 'name', event.target.value)} aria-label={t('scheduler.aria_shift_name')} />
              <input type="time" value={template.startTime} onChange={event => updateTemplate(template.id, 'startTime', event.target.value)} aria-label={t('scheduler.aria_start')} />
              <input type="time" value={template.endTime} onChange={event => updateTemplate(template.id, 'endTime', event.target.value)} aria-label={t('scheduler.aria_end')} />
              <input type="number" min="1" value={template.requiredEmployees} onChange={event => updateTemplate(template.id, 'requiredEmployees', Number(event.target.value))} aria-label={t('scheduler.aria_headcount')} />
              <select value={template.requiredSkill || ''} onChange={event => updateTemplate(template.id, 'requiredSkill', event.target.value)} aria-label={t('scheduler.aria_skill')}>
                <option value="">{t('scheduler.no_skill')}</option>
                {POSITION_OPTIONS.filter(option => option.value !== 'Khác').map(option => (
                  <option key={option.value} value={option.value}>{t(option.labelKey)}</option>
                ))}
                {template.requiredSkill && !POSITION_OPTIONS.some(option => option.value === template.requiredSkill) && (
                  <option value={template.requiredSkill}>{template.requiredSkill}</option>
                )}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' }}>
              {WEEKDAY_LABELS.map((label, day) => (
                <button
                  type="button"
                  key={label}
                  className={template.days.includes(day) ? 'btn-primary' : 'btn-secondary'}
                  style={{ padding: '6px 10px' }}
                  onClick={() => toggleTemplateDay(template.id, day)}
                >{t(`weekday.${day}`)}</button>
              ))}
              <button type="button" className="btn-danger" style={{ marginLeft: 'auto', padding: '6px 10px' }} onClick={() => removeTemplate(template.id)}>{t('scheduler.remove_shift')}</button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '20px' }}>
        <button className="btn-primary" onClick={saveSettings} disabled={saving}>{saving ? t('scheduler.saving') : t('scheduler.save_settings')}</button>
        <button className="btn-secondary" onClick={() => sendRegistrationReminders(false)}>{t('scheduler.send_reminders')}</button>
        <button className="btn-primary" onClick={() => runGeneration(false)} disabled={running || submissions.length === 0}>
          {running ? t('scheduler.running') : t('scheduler.run_now')}
        </button>
      </div>

      {assignmentDocs.length > 0 && (
        <div style={{ marginTop: '20px' }}>
          <h3>{t('scheduler.results_title', { week: weekStart })}</h3>
          <div className="table-responsive">
            <table>
              <thead><tr><th>{t('scheduler.col_employee')}</th><th>{t('scheduler.col_shift_count')}</th><th>{t('scheduler.col_assigned')}</th></tr></thead>
              <tbody>
                {[...assignmentDocs].sort((left, right) => left.employeeName.localeCompare(right.employeeName, 'vi')).map(item => (
                  <tr key={item.id}>
                    <td>{item.employeeName}</td>
                    <td>{item.assignmentCount}</td>
                    <td>{(item.shifts || []).map(shift => `${shift.date} ${shift.startTime}-${shift.endTime}`).join(', ') || t('scheduler.no_matching_shift')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {swapRequests.some(item => ['open', 'claimed'].includes(item.status)) && (
        <div style={{ marginTop: '20px' }}>
          <h3>{t('scheduler.swaps_title')}</h3>
          {swapRequests.filter(item => ['open', 'claimed'].includes(item.status)).map(item => (
            <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', padding: '12px 0', borderTop: '1px solid #e2e8f0', flexWrap: 'wrap' }}>
              <span>{t('scheduler.swap_needs_cover', { name: item.fromEmployeeName, date: item.shift.date, start: item.shift.startTime, end: item.shift.endTime })}<br /><small>{item.claimedByName ? t('scheduler.swap_proposed', { name: item.claimedByName }) : t('scheduler.swap_waiting')}</small></span>
              {item.claimedByName && <div style={{ display: 'flex', gap: '8px' }}><button className="btn-secondary" onClick={() => resolveSwap(item, false)}>{t('scheduler.reject')}</button><button className="btn-primary" onClick={() => resolveSwap(item, true)}>{t('scheduler.approve_swap')}</button></div>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
