import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import {
  buildShiftSlots,
  getNextWeekStart,
  getRegistrationDeadline,
  shiftsOverlap,
} from '../../utils/weeklyScheduler';
import { employeeSkills, hasSkill } from '../../utils/skills';

export default function WeeklyAvailabilityPanel({ currentUser, empProfile, db, showToast }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'vi' ? 'vi-VN' : 'en-US';
  const weekStart = useMemo(() => getNextWeekStart(), []);
  const organizationId = empProfile?.organizationId;
  const [settings, setSettings] = useState(null);
  const [selectedSlotIds, setSelectedSlotIds] = useState([]);
  const [assignment, setAssignment] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [swapRequests, setSwapRequests] = useState([]);

  const submissionId = organizationId && currentUser
    ? `${organizationId}_${weekStart}_${currentUser.uid}`
    : '';

  useEffect(() => {
    if (!organizationId || !currentUser) return;
    const load = async () => {
      setLoading(true);
      try {
        const [settingsSnap, submissionSnap, assignmentSnap, swapSnap] = await Promise.all([
          getDoc(doc(db, 'schedule_settings', organizationId)),
          getDoc(doc(db, 'availability_submissions', submissionId)),
          getDoc(doc(db, 'weekly_assignments', submissionId)),
          getDocs(query(collection(db, 'shift_swap_requests'), where('organizationId', '==', organizationId), where('weekStart', '==', weekStart))),
        ]);
        if (settingsSnap.exists()) setSettings(settingsSnap.data());
        if (submissionSnap.exists()) {
          setSelectedSlotIds(submissionSnap.data().selectedSlotIds || []);
          setSubmitted(true);
        }
        if (assignmentSnap.exists()) setAssignment(assignmentSnap.data());
        setSwapRequests(swapSnap.docs.map(item => ({ id: item.id, ...item.data() })));
      } catch (error) {
        console.error('Weekly availability load failed:', error);
        showToast(t('availability.load_failed'), 'error');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [currentUser, db, organizationId, showToast, submissionId, t, weekStart]);

  const slots = useMemo(
    () => buildShiftSlots(weekStart, settings?.shiftTemplates || []),
    [settings?.shiftTemplates, weekStart],
  );
  const deadline = settings
    ? getRegistrationDeadline(weekStart, settings.registrationWeekday, settings.registrationCloseTime)
    : null;
  const deadlinePassed = deadline ? new Date() >= deadline : false;

  const toggleSlot = slotId => {
    setSelectedSlotIds(previous => previous.includes(slotId)
      ? previous.filter(id => id !== slotId)
      : [...previous, slotId]);
  };

  const submitAvailability = async event => {
    event.preventDefault();
    if (deadlinePassed) return showToast(t('availability.deadline_passed_toast'), 'warning');
    if (selectedSlotIds.length === 0) return showToast(t('availability.pick_one'), 'warning');
    setSaving(true);
    try {
      await setDoc(doc(db, 'availability_submissions', submissionId), {
        organizationId,
        weekStart,
        employeeId: currentUser.uid,
        employeeName: empProfile.fullName,
        position: empProfile.position || '',
        skills: employeeSkills(empProfile),
        // Must equal the profile value exactly (enforced by security rules); a
        // full-time monthly salary is not an hourly rate.
        hourlyRate: Number(empProfile.hourlyRate) || 0,
        selectedSlotIds,
        submittedAt: serverTimestamp(),
        status: 'submitted',
      });
      setSubmitted(true);
      showToast(t('availability.submitted_toast'), 'success');
    } catch (error) {
      console.error(error);
      showToast(t('availability.submit_failed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const offerShift = async shift => {
    const id = `swap_${organizationId}_${weekStart}_${currentUser.uid}_${shift.id}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    try {
      const request = {
        organizationId, weekStart, shift,
        fromEmployeeId: currentUser.uid,
        fromEmployeeName: empProfile.fullName,
        status: 'open',
        createdAt: serverTimestamp(),
      };
      await setDoc(doc(db, 'shift_swap_requests', id), request);
      setSwapRequests(previous => [...previous.filter(item => item.id !== id), { id, ...request }]);
      showToast(t('availability.offer_opened'), 'success');
    } catch (error) {
      showToast(t('availability.offer_failed', { error: error.message }), 'error');
    }
  };

  const claimShift = async request => {
    try {
      await updateDoc(doc(db, 'shift_swap_requests', request.id), {
        status: 'claimed',
        claimedBy: currentUser.uid,
        claimedByName: empProfile.fullName,
        claimedAt: serverTimestamp(),
      });
      setSwapRequests(previous => previous.map(item => item.id === request.id ? { ...item, status: 'claimed', claimedBy: currentUser.uid, claimedByName: empProfile.fullName } : item));
      showToast(t('availability.claimed_toast'), 'success');
    } catch (error) {
      showToast(t('availability.claim_failed', { error: error.message }), 'error');
    }
  };

  if (loading) return <div className="card">{t('availability.loading')}</div>;
  if (!settings) return (
    <div className="card" style={{ borderLeft: '4px solid #f59e0b' }}>
      {t('availability.not_configured')}
    </div>
  );

  const groupedSlots = slots.reduce((groups, slot) => {
    groups[slot.date] = [...(groups[slot.date] || []), slot];
    return groups;
  }, {});

  return (
    <section className="card" style={{ border: `2px solid ${submitted ? '#86efac' : '#fbbf24'}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0 }}>{t('availability.title')}</h2>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>{t('availability.week_of', { week: weekStart })}</p>
        </div>
        <span className={submitted ? 'badge badge-success' : 'badge badge-warning'}>
          {submitted ? t('availability.registered') : t('availability.needs_registration')}
        </span>
      </div>

      <div style={{ margin: '16px 0', padding: '12px 14px', borderRadius: '10px', background: deadlinePassed ? '#fee2e2' : '#fffbeb', color: deadlinePassed ? '#991b1b' : '#92400e' }}>
        <strong>{deadlinePassed ? t('availability.deadline_passed') : t('availability.reminder')}</strong>{' '}
        {t('availability.auto_after_deadline', { deadline: deadline?.toLocaleString(locale) })}
      </div>

      {assignment && (
        <div style={{ marginBottom: '18px', padding: '14px', borderRadius: '12px', background: '#ecfdf5', color: '#065f46' }}>
          <strong>{t('availability.assigned_title')}</strong>
          <ul style={{ marginBottom: 0 }}>
            {(assignment.shifts || []).map(shift => {
              const offer = swapRequests.find(item => item.fromEmployeeId === currentUser.uid
                && item.shift?.id === shift.id && ['open', 'claimed'].includes(item.status));
              return (
                <li key={shift.id} style={{ marginBottom: '7px' }}>{shift.date} · {shift.name} · {shift.startTime}–{shift.endTime}{' '}
                  {offer
                    ? <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{offer.status === 'claimed' ? t('availability.offer_claimed', { name: offer.claimedByName }) : t('availability.offer_open')}</span>
                    : <button type="button" className="btn-secondary" style={{ padding: '3px 8px' }} onClick={() => offerShift(shift)}>{t('availability.need_cover')}</button>}
                </li>
              );
            })}
            {(assignment.shifts || []).length === 0 && <li>{t('availability.no_match')}</li>}
          </ul>
        </div>
      )}

      {swapRequests.some(item => item.status === 'open' && item.fromEmployeeId !== currentUser.uid) && (
        <div style={{ marginBottom: '18px', padding: '14px', borderRadius: '12px', background: '#eff6ff' }}>
          <strong>{t('availability.open_shifts')}</strong>
          {swapRequests.filter(item => item.status === 'open' && item.fromEmployeeId !== currentUser.uid).map(item => {
            const hasAvailability = selectedSlotIds.includes(item.shift.id);
            const skillMatches = hasSkill(employeeSkills(empProfile), item.shift.requiredSkill);
            const conflict = (assignment?.shifts || []).some(shift => shiftsOverlap(shift, item.shift));
            const eligible = hasAvailability && skillMatches && !conflict;
            return <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '9px', alignItems: 'center' }}><span>{item.shift.date} · {item.shift.name} · {t('availability.from_employee', { name: item.fromEmployeeName })}</span><button type="button" className="btn-primary" disabled={!eligible} title={!eligible ? t('availability.not_eligible') : ''} onClick={() => claimShift(item)}>{t('availability.claim')}</button></div>;
          })}
        </div>
      )}

      <form onSubmit={submitAvailability}>
        <div style={{ display: 'grid', gap: '12px' }}>
          {Object.entries(groupedSlots).map(([date, daySlots]) => (
            <div key={date} style={{ border: '1px solid var(--border)', borderRadius: '12px', padding: '14px' }}>
              <strong>{t(`weekday.${daySlots[0].dayIndex}`)} · {date}</strong>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
                {daySlots.map(slot => {
                  const selected = selectedSlotIds.includes(slot.id);
                  return (
                    <button
                      key={slot.id}
                      type="button"
                      disabled={deadlinePassed}
                      onClick={() => toggleSlot(slot.id)}
                      className={selected ? 'btn-primary' : 'btn-secondary'}
                      style={{ padding: '9px 12px' }}
                    >
                      {selected ? '✓ ' : ''}{slot.name} {slot.startTime}–{slot.endTime}{slot.requiredSkill ? ` · ${slot.requiredSkill}` : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <button className="btn-primary" type="submit" disabled={saving || deadlinePassed} style={{ marginTop: '16px', width: '100%' }}>
          {saving ? t('availability.sending') : submitted ? t('availability.update') : t('availability.submit')}
        </button>
      </form>
    </section>
  );
}
