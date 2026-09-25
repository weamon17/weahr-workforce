import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useTranslation } from 'react-i18next';
import { functions } from '../../firebase';

const formatDate = (value, locale) => {
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

const statusMeta = {
  pending: { labelKey: 'org.status_pending', color: '#d97706', background: '#fffbeb' },
  accepted: { labelKey: 'org.status_accepted', color: '#059669', background: '#ecfdf5' },
  revoked: { labelKey: 'org.status_revoked', color: '#64748b', background: '#f1f5f9' },
};

export default function OrganizationSettingsTab({ db, organizationId, userProfile, showToast }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'vi' ? 'vi-VN' : 'en-US';
  const [organization, setOrganization] = useState(null);
  const [invitations, setInvitations] = useState([]);
  const [form, setForm] = useState({ fullName: '', email: '' });
  const [createdLink, setCreatedLink] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const [organizationSnap, invitationSnap] = await Promise.all([
        getDoc(doc(db, 'organizations', organizationId)),
        getDocs(query(collection(db, 'organization_invitations'), where('organizationId', '==', organizationId))),
      ]);
      setOrganization(organizationSnap.exists() ? organizationSnap.data() : null);
      setInvitations(invitationSnap.docs
        .map(item => ({ id: item.id, ...item.data() }))
        .sort((left, right) => (right.createdAt?.seconds || 0) - (left.createdAt?.seconds || 0)));
    } catch (error) {
      console.error(error);
      showToast(t('org.load_failed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [db, organizationId, showToast, t]);

  useEffect(() => { loadData(); }, [loadData]);

  const trialDaysLeft = useMemo(() => {
    const end = organization?.trialEndsAt?.toDate?.();
    if (!end) return null;
    return Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000));
  }, [organization]);

  const createInvitation = async event => {
    event.preventDefault();
    setSubmitting(true);
    setCreatedLink('');
    try {
      const response = await httpsCallable(functions, 'createEmployeeInvitation')({
        fullName: form.fullName.trim(),
        email: form.email.trim().toLowerCase(),
      });
      const link = `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(response.data.token)}`;
      setCreatedLink(link);
      setForm({ fullName: '', email: '' });
      showToast(t('org.invite_created'));
      await loadData();
    } catch (error) {
      console.error(error);
      showToast(error?.message?.replace(/^FirebaseError:\s*/i, '') || t('org.invite_failed'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(createdLink);
      showToast(t('org.link_copied'));
    } catch {
      showToast(t('org.copy_failed'), 'warning');
    }
  };

  const revokeInvitation = async invitationId => {
    try {
      await httpsCallable(functions, 'revokeEmployeeInvitation')({ invitationId });
      showToast(t('org.revoked_toast'));
      await loadData();
    } catch (error) {
      console.error(error);
      showToast(t('org.revoke_failed'), 'error');
    }
  };

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '0 20px' }}>
      <div className="section-header" style={{ marginBottom: '22px' }}>
        <div>
          <p style={{ margin: '0 0 6px', color: '#4f46e5', fontWeight: 800, fontSize: '0.78rem', letterSpacing: '0.08em' }}>SAAS WORKSPACE</p>
          <h2 style={{ margin: 0 }}>{t('org.title')}</h2>
          <p style={{ color: '#64748b', margin: '8px 0 0' }}>{t('org.subtitle')}</p>
        </div>
      </div>

      <div className="grid-3" style={{ marginBottom: '22px' }}>
        <div className="card">
          <div style={{ color: '#64748b', fontSize: '0.82rem', fontWeight: 700 }}>{t('org.business')}</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, marginTop: '8px' }}>{organization?.name || organizationId}</div>
          <div style={{ color: '#64748b', marginTop: '6px', fontSize: '0.86rem' }}>{t('org.owner', { name: userProfile?.fullName || userProfile?.email })}</div>
        </div>
        <div className="card">
          <div style={{ color: '#64748b', fontSize: '0.82rem', fontWeight: 700 }}>{t('org.current_plan')}</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, marginTop: '8px', color: '#4f46e5' }}>{organization?.plan === 'trial' ? t('org.plan_trial') : organization?.plan || t('org.plan_unset')}</div>
          <div style={{ color: '#64748b', marginTop: '6px', fontSize: '0.86rem' }}>{trialDaysLeft === null ? t('org.no_end_date') : t('org.days_left', { count: trialDaysLeft })}</div>
        </div>
        <div className="card">
          <div style={{ color: '#64748b', fontSize: '0.82rem', fontWeight: 700 }}>{t('org.pilot_limits')}</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, marginTop: '8px' }}>{t('org.limit_employees', { count: organization?.limits?.employees || 30 })}</div>
          <div style={{ color: '#64748b', marginTop: '6px', fontSize: '0.86rem' }}>{t('org.limit_branches_managers', { branches: organization?.limits?.branches || 2, managers: organization?.limits?.managers || 3 })}</div>
        </div>
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}><i className="fas fa-user-plus" style={{ color: '#4f46e5', marginRight: '8px' }} />{t('org.invite_title')}</h3>
          <p style={{ color: '#64748b', lineHeight: 1.55 }}>{t('org.invite_help')}</p>
          <form onSubmit={createInvitation}>
            <div className="form-group">
              <label>{t('org.field_full_name')}</label>
              <input value={form.fullName} onChange={event => setForm(previous => ({ ...previous, fullName: event.target.value }))} placeholder="Nguyễn Văn A" maxLength={100} />
            </div>
            <div className="form-group">
              <label>{t('org.field_email')}</label>
              <input type="email" required value={form.email} onChange={event => setForm(previous => ({ ...previous, email: event.target.value }))} placeholder="nhanvien@doanhnghiep.vn" />
            </div>
            <button className="btn-primary" type="submit" disabled={submitting} style={{ width: '100%' }}>
              {submitting ? t('org.creating') : t('org.create_link')}
            </button>
          </form>

          {createdLink && (
            <div style={{ marginTop: '18px', padding: '14px', borderRadius: '12px', background: '#eef2ff', border: '1px solid #c7d2fe' }}>
              <div style={{ fontWeight: 800, color: '#3730a3', marginBottom: '8px' }}>{t('org.new_link')}</div>
              <input readOnly value={createdLink} onFocus={event => event.target.select()} style={{ width: '100%', fontSize: '0.8rem' }} />
              <button type="button" className="btn-secondary" onClick={copyLink} style={{ width: '100%', marginTop: '8px' }}>
                <i className="fas fa-copy" /> {t('org.copy_link')}
              </button>
            </div>
          )}
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ margin: 0 }}><i className="fas fa-envelope-open-text" style={{ color: '#0f9f75', marginRight: '8px' }} />{t('org.history_title')}</h3>
            <button type="button" className="btn-secondary" onClick={loadData} style={{ padding: '8px 10px' }}><i className="fas fa-sync-alt" /></button>
          </div>
          {invitations.length === 0 ? (
            <p style={{ color: '#64748b' }}>{t('org.no_invitations')}</p>
          ) : (
            <div style={{ display: 'grid', gap: '10px' }}>
              {invitations.map(invitation => {
                const meta = statusMeta[invitation.status] || statusMeta.revoked;
                const expired = invitation.status === 'pending' && invitation.expiresAt?.toMillis?.() <= Date.now();
                return (
                  <div key={invitation.id} style={{ padding: '12px', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'start' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis' }}>{invitation.fullName || invitation.email}</div>
                        <div style={{ color: '#64748b', fontSize: '0.84rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{invitation.email}</div>
                      </div>
                      <span style={{ color: expired ? '#dc2626' : meta.color, background: expired ? '#fef2f2' : meta.background, borderRadius: '999px', padding: '4px 8px', fontSize: '0.72rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
                        {expired ? t('org.expired') : t(meta.labelKey)}
                      </span>
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: '0.76rem', marginTop: '8px' }}>{t('org.expires_at', { date: formatDate(invitation.expiresAt, locale) })}</div>
                    {invitation.status === 'pending' && !expired && (
                      <button type="button" className="auth-link" onClick={() => revokeInvitation(invitation.id)} style={{ color: '#dc2626', paddingBottom: 0, fontSize: '0.8rem' }}>{t('org.revoke')}</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
