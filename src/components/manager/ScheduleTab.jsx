import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, addDoc, getDocs, query, where, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import WeeklySchedulerPanel from './WeeklySchedulerPanel';

export default function ScheduleTab({ schedules, setSchedules, organizationId, db, showToast, currentUser, demoMode = false }) {
  const { t } = useTranslation();
  const [filterStatus, setFilterStatus] = useState('pending');
  const [rejectReason, setRejectReason] = useState('');
  const [rejectingId, setRejectingId] = useState(null);

  // Notification send panel
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [employeeUsers, setEmployeeUsers] = useState([]);
  const [notifRecipient, setNotifRecipient] = useState('');
  const [notifTitle, setNotifTitle] = useState('');
  const [notifMessage, setNotifMessage] = useState('');
  const [notifSending, setNotifSending] = useState(false);

  // Load employee accounts from 'users' collection once
  useEffect(() => {
    if (demoMode) {
      const employees = [...new Map(schedules.map(item => [item.employeeId, {
        id: item.employeeId,
        fullName: item.employeeName,
        email: `${item.employeeId}@weahr.local`,
      }])).values()].filter(item => item.id);
      setEmployeeUsers(employees);
      return;
    }
    const fetchEmployees = async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'users'),
          where('role', '==', 'employee'),
          where('organizationId', '==', organizationId),
        ));
        setEmployeeUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.error('ScheduleTab: could not load employee users', e);
      }
    };
    fetchEmployees();
  }, [db, organizationId, demoMode, schedules]);

  // ── Helper: resolve recipientId even if the schedule doc lacks the field ──────
  // Old schedule docs may have been created before employeeId was saved.
  // Fall back to matching by fullName in the loaded employee users list.
  const getRecipientId = (schedule) => {
    if (schedule.employeeId) return schedule.employeeId;
    const match = employeeUsers.find(u => u.fullName === schedule.employeeName || u.email === schedule.employeeName);
    return match?.id || null;
  };

  // ── Helper: push a notification doc to Firestore ─────────────────────────────
  const pushNotification = async (recipientId, recipientName, type, title, message, relatedScheduleId = null) => {
    if (!recipientId) {
      console.warn('[pushNotification] no recipientId for', recipientName, '— notification skipped');
      return;
    }
    await addDoc(collection(db, 'notifications'), {
      organizationId,
      recipientId,
      recipientName,
      senderId: currentUser?.uid || '',
      senderEmail: currentUser?.email || 'manager',
      type,
      title,
      message,
      relatedScheduleId,
      read: false,
      createdAt: serverTimestamp(),
    });
  };

  // ── Approve ───────────────────────────────────────────────────────────────────
  const handleApprove = async (schedule) => {
    if (demoMode) return showToast(t('schedule.demo_no_approve'), 'warning');
    try {
      await updateDoc(doc(db, 'schedules', schedule.id), {
        status: 'approved',
        approvedBy: currentUser?.email || 'manager',
        approvedAt: serverTimestamp(),
      });
      setSchedules(prev => prev.map(s => s.id === schedule.id ? { ...s, status: 'approved', approvedBy: currentUser?.email } : s));
      showToast(t('schedule.approved_toast'), 'success');
    } catch {
      showToast(t('schedule.approve_failed'), 'error');
      return;
    }
    // Notification — separate try/catch so approve result is not affected
    try {
      const rid = getRecipientId(schedule);
      await pushNotification(
        rid,
        schedule.employeeName,
        'schedule_approved',
        '✅ Lịch làm đã được duyệt',
        `Ca làm ngày ${schedule.workDate}${schedule.startTime ? ` (${schedule.startTime} – ${schedule.endTime})` : ''} đã được quản lý duyệt.`,
        schedule.id,
      );
    } catch (e) {
      console.error('[handleApprove] notification failed:', e);
      showToast(t('schedule.notify_failed_note', { error: e.code || e.message }), 'warning');
    }
  };

  // ── Reject ────────────────────────────────────────────────────────────────────
  const handleReject = async (schedule) => {
    if (demoMode) return showToast(t('schedule.demo_no_reject'), 'warning');
    if (!rejectReason.trim()) return showToast(t('schedule.reject_reason_required'), 'warning');
    try {
      await updateDoc(doc(db, 'schedules', schedule.id), {
        status: 'rejected',
        rejectReason: rejectReason.trim(),
        approvedBy: currentUser?.email || 'manager',
        approvedAt: serverTimestamp(),
      });
      setSchedules(prev => prev.map(s => s.id === schedule.id ? { ...s, status: 'rejected', rejectReason: rejectReason.trim() } : s));
      setRejectingId(null);
      setRejectReason('');
      showToast(t('schedule.rejected_toast'), 'success');
    } catch {
      showToast(t('schedule.reject_failed'), 'error');
      return;
    }
    // Notification — separate try/catch
    try {
      const rid = getRecipientId(schedule);
      await pushNotification(
        rid,
        schedule.employeeName,
        'schedule_rejected',
        '❌ Yêu cầu lịch làm bị từ chối',
        `Ca làm ngày ${schedule.workDate} bị từ chối. Lý do: ${rejectReason.trim()}`,
        schedule.id,
      );
    } catch (e) {
      console.error('[handleReject] notification failed:', e);
      showToast(t('schedule.notify_failed_note', { error: e.code || e.message }), 'warning');
    }
  };

  // ── Send custom notification ───────────────────────────────────────────────
  const handleSendNotif = async (e) => {
    e.preventDefault();
    if (demoMode) return showToast(t('schedule.demo_no_notify'), 'warning');
    if (!notifRecipient || !notifTitle.trim() || !notifMessage.trim()) {
      return showToast(t('schedule.fill_all'), 'warning');
    }
    setNotifSending(true);
    try {
      const recipient = employeeUsers.find(u => u.id === notifRecipient);
      await pushNotification(
        notifRecipient,
        recipient?.fullName || recipient?.email || notifRecipient,
        'custom',
        notifTitle.trim(),
        notifMessage.trim(),
        null,
      );
      setNotifRecipient('');
      setNotifTitle('');
      setNotifMessage('');
      setShowNotifPanel(false);
      showToast(t('schedule.notify_sent'), 'success');
    } catch {
      showToast(t('schedule.notify_failed'), 'error');
    } finally {
      setNotifSending(false);
    }
  };

  const filtered = schedules.filter(s => filterStatus === 'all' ? true : s.status === filterStatus);
  const statusLabel = { pending: t('schedule.status_pending'), approved: t('schedule.status_approved'), rejected: t('schedule.status_rejected'), cancelled: t('schedule.status_cancelled') };
  const statusColor = { pending: '#f59e0b', approved: '#10b981', rejected: '#ef4444', cancelled: '#94a3b8' };
  const typeLabel = { shift_request: t('schedule.type_shift_request'), off_request: t('schedule.type_off_request'), auto_generated: t('schedule.type_auto') };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {!demoMode && <WeeklySchedulerPanel
        db={db}
        organizationId={organizationId}
        employeeUsers={employeeUsers}
        showToast={showToast}
      />}

      {/* ── Header row ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: '800' }}>{t('schedule.title')}</h2>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {['pending', 'approved', 'rejected', 'all'].map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              style={{
                padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border)',
                background: filterStatus === s ? 'var(--primary)' : 'white',
                color: filterStatus === s ? 'white' : 'var(--text-muted)',
                fontWeight: '600', cursor: 'pointer', fontSize: '0.85rem',
              }}
            >
              {s === 'all' ? t('schedule.filter_all') : statusLabel[s]}
              {s === 'pending' && schedules.filter(x => x.status === 'pending').length > 0 && (
                <span style={{ marginLeft: '6px', background: '#ef4444', color: 'white', borderRadius: '10px', padding: '1px 7px', fontSize: '0.75rem' }}>
                  {schedules.filter(x => x.status === 'pending').length}
                </span>
              )}
            </button>
          ))}

          {/* Notification send button */}
          <button
            onClick={() => setShowNotifPanel(v => !v)}
            style={{
              padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border)',
              background: showNotifPanel ? '#4f46e5' : 'white',
              color: showNotifPanel ? 'white' : '#4f46e5',
              fontWeight: '600', cursor: 'pointer', fontSize: '0.85rem',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}
          >
            <i className="fas fa-bell"></i> {t('schedule.send_notification')}
          </button>
        </div>
      </div>

      {/* ── Notification send panel ───────────────────────────────────────────── */}
      {showNotifPanel && (
        <div style={{ background: 'white', borderRadius: '16px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '2px solid #e0e7ff' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '1.05rem', fontWeight: '700', color: '#4f46e5' }}>
            <i className="fas fa-paper-plane" style={{ marginRight: '8px' }}></i>{t('schedule.notify_panel_title')}
          </h3>
          <form onSubmit={handleSendNotif} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="form-group">
              <label>{t('schedule.select_employee')}</label>
              <select value={notifRecipient} onChange={e => setNotifRecipient(e.target.value)} required>
                <option value="">{t('schedule.select_employee_placeholder')}</option>
                {employeeUsers.map(u => (
                  <option key={u.id} value={u.id}>{u.fullName || u.email}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>{t('schedule.notify_title_label')}</label>
              <input
                type="text"
                value={notifTitle}
                onChange={e => setNotifTitle(e.target.value)}
                placeholder={t('schedule.notify_title_placeholder')}
                required
              />
            </div>
            <div className="form-group">
              <label>{t('schedule.notify_body_label')}</label>
              <textarea
                value={notifMessage}
                onChange={e => setNotifMessage(e.target.value)}
                placeholder={t('schedule.notify_body_placeholder')}
                rows={3}
                required
                style={{ resize: 'vertical', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '0.95rem', width: '100%', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="submit" className="btn-primary" disabled={notifSending} style={{ flex: 1 }}>
                <i className="fas fa-paper-plane" style={{ marginRight: '6px' }}></i>
                {notifSending ? t('schedule.sending') : t('schedule.send_notification')}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setShowNotifPanel(false)}>{t('schedule.cancel')}</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Schedule request list ─────────────────────────────────────────────── */}
      <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
            <i className="fas fa-calendar-check" style={{ fontSize: '2.5rem', marginBottom: '12px', display: 'block', color: '#cbd5e1' }}></i>
            {t('schedule.no_requests')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {filtered
              .sort((a, b) => new Date(b.createdAt?.toDate?.() || b.createdAt) - new Date(a.createdAt?.toDate?.() || a.createdAt))
              .map(s => (
                <div key={s.id} style={{
                  border: '1px solid var(--border)', borderRadius: '12px', padding: '16px 20px',
                  borderLeft: `4px solid ${statusColor[s.status] || '#94a3b8'}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                        <span style={{ fontWeight: '700', fontSize: '1rem' }}>{s.employeeName}</span>
                        <span style={{
                          fontSize: '0.75rem', fontWeight: '600', padding: '2px 10px', borderRadius: '12px',
                          background: `${statusColor[s.status]}22`, color: statusColor[s.status],
                        }}>
                          {statusLabel[s.status] || s.status}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', background: '#f1f5f9', padding: '2px 10px', borderRadius: '12px' }}>
                          {typeLabel[s.scheduleType] || s.scheduleType}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                        <span><i className="fas fa-calendar" style={{ marginRight: '5px' }}></i>{s.workDate}</span>
                        {s.startTime && <span><i className="fas fa-clock" style={{ marginRight: '5px' }}></i>{s.startTime} – {s.endTime}</span>}
                        {s.note && <span><i className="fas fa-comment" style={{ marginRight: '5px' }}></i>{s.note}</span>}
                      </div>
                      {s.status === 'rejected' && s.rejectReason && (
                        <div style={{ marginTop: '8px', fontSize: '0.85rem', color: '#ef4444' }}>
                          <i className="fas fa-times-circle" style={{ marginRight: '5px' }}></i>{t('schedule.reject_reason_label', { reason: s.rejectReason })}
                        </div>
                      )}
                    </div>

                    {s.status === 'pending' && (
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                        {rejectingId === s.id ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '220px' }}>
                            <input
                              type="text"
                              placeholder={t('schedule.reject_reason_placeholder')}
                              value={rejectReason}
                              onChange={e => setRejectReason(e.target.value)}
                              style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.85rem' }}
                            />
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button className="btn-danger" style={{ flex: 1, padding: '7px', fontSize: '0.8rem' }} onClick={() => handleReject(s)}>
                                {t('schedule.confirm_reject')}
                              </button>
                              <button className="btn-secondary" style={{ padding: '7px 12px', fontSize: '0.8rem' }} onClick={() => { setRejectingId(null); setRejectReason(''); }}>
                                {t('schedule.cancel')}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <button className="btn-primary" style={{ padding: '8px 16px', fontSize: '0.85rem' }} onClick={() => handleApprove(s)}>
                              <i className="fas fa-check" style={{ marginRight: '5px' }}></i>{t('schedule.approve')}
                            </button>
                            <button className="btn-danger" style={{ padding: '8px 16px', fontSize: '0.85rem' }} onClick={() => { setRejectingId(s.id); setRejectReason(''); }}>
                              <i className="fas fa-times" style={{ marginRight: '5px' }}></i>{t('schedule.reject')}
                            </button>
                          </>
                        )}
                      </div>
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
