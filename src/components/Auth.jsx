import React, { useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { useTranslation } from 'react-i18next';
import { auth, functions } from '../firebase';
import { requestPasswordResetEmail, sendVerificationEmail } from '../services/authEmail';

const blankForm = {
  organizationName: '',
  fullName: '',
  email: '',
  password: '',
  confirmPassword: '',
};

// `internal`/`unavailable` also cover an undeployed or unreachable backend, so
// they must not be reported as a problem with what the user entered.
const callableMessage = (t, error, fallback) => {
  if (['functions/internal', 'functions/unavailable'].includes(error?.code)
    && !error?.details) {
    return t('authui.service_unavailable');
  }
  const message = error?.message?.replace(/^FirebaseError:\s*/i, '').trim();
  if (!message || message === 'internal' || message === 'functions/internal') return fallback;
  return message || fallback;
};

const loginErrorMessage = (t, error) => {
  if (error?.code === 'auth/network-request-failed') return t('authui.network');
  if (error?.code === 'auth/too-many-requests') return t('authui.too_many');
  if (error?.code === 'auth/user-disabled') return t('authui.disabled');
  return t('authui.wrong_credentials');
};

export default function Auth({ onLogin, onDemoLogin, showToast, initialView = 'login', onBack }) {
  const { t } = useTranslation();
  const inviteToken = new URLSearchParams(window.location.search).get('invite') || '';
  const [view, setView] = useState(inviteToken ? 'invite' : initialView);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [resetSent, setResetSent] = useState(false);
  const [invitation, setInvitation] = useState(null);
  const [inviteError, setInviteError] = useState('');
  const demoEmail = import.meta.env.DEV ? String(import.meta.env.VITE_DEMO_ADMIN_EMAIL || '').trim().toLowerCase() : '';
  const demoPassword = import.meta.env.DEV ? String(import.meta.env.VITE_DEMO_ADMIN_PASSWORD || '') : '';

  useEffect(() => {
    if (!inviteToken) return;
    let active = true;
    setLoading(true);
    httpsCallable(functions, 'getInvitationPreview')({ token: inviteToken })
      .then(response => {
        if (!active) return;
        setInvitation(response.data);
        setForm(previous => ({
          ...previous,
          email: response.data.email || '',
          fullName: response.data.fullName || '',
        }));
      })
      .catch(error => {
        if (active) setInviteError(callableMessage(t, error, t('authui.invite_invalid')));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [inviteToken, t]);

  const set = (field, value) => setForm(previous => ({ ...previous, [field]: value }));
  const changeView = next => {
    setForm(blankForm);
    setResetSent(false);
    setView(next);
  };

  const validatePasswords = () => {
    if (form.password.length < 8) {
      showToast(t('authui.password_short'), 'warning');
      return false;
    }
    if (form.password !== form.confirmPassword) {
      showToast(t('authui.password_mismatch'), 'warning');
      return false;
    }
    return true;
  };

  const handleLogin = async event => {
    event.preventDefault();
    if (demoEmail && demoPassword && form.email.trim().toLowerCase() === demoEmail && form.password === demoPassword) {
      onDemoLogin(demoEmail);
      return;
    }
    setLoading(true);
    try {
      const credential = await signInWithEmailAndPassword(auth, form.email.trim(), form.password);
      if (!credential.user.emailVerified) {
        let sent = false;
        try {
          await sendVerificationEmail(credential.user);
          sent = true;
        } catch (error) {
          console.error('Không thể gửi lại email xác thực:', error?.code || error?.message);
        }
        await signOut(auth);
        showToast(
          sent
            ? t('authui.unverified_resent')
            : t('authui.unverified_not_resent'),
          sent ? 'warning' : 'error',
        );
        return;
      }
      onLogin(credential.user);
    } catch (error) {
      showToast(loginErrorMessage(t, error), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleOwnerSignup = async event => {
    event.preventDefault();
    if (!validatePasswords()) return;
    setLoading(true);
    let credential;
    let workspaceCreated = false;
    try {
      const email = form.email.trim().toLowerCase();
      credential = await createUserWithEmailAndPassword(auth, email, form.password);
      await httpsCallable(functions, 'completeOrganizationSignup')({
        organizationName: form.organizationName.trim(),
        fullName: form.fullName.trim(),
        email,
      });
      workspaceCreated = true;
      let verificationSent = false;
      try {
        await sendVerificationEmail(credential.user);
        verificationSent = true;
      } catch (error) {
        console.error('Không thể gửi email xác thực workspace:', error?.code || error?.message);
      }
      await signOut(auth);
      showToast(
        verificationSent
          ? t('authui.workspace_created')
          : t('authui.workspace_created_no_email'),
        verificationSent ? 'success' : 'warning',
      );
      changeView('login');
    } catch (error) {
      if (credential?.user && !workspaceCreated) {
        try { await deleteUser(credential.user); } catch { await signOut(auth); }
      } else if (credential?.user) {
        await signOut(auth);
      }
      const fallback = error.code === 'auth/email-already-in-use'
        ? t('authui.email_in_use')
        : t('authui.workspace_failed');
      showToast(callableMessage(t, error, fallback), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleInvitationSignup = async event => {
    event.preventDefault();
    if (!validatePasswords() || !inviteToken || !invitation) return;
    setLoading(true);
    let credential;
    let invitationAccepted = false;
    try {
      credential = await createUserWithEmailAndPassword(auth, invitation.email, form.password);
      await httpsCallable(functions, 'acceptEmployeeInvitation')({
        token: inviteToken,
        fullName: form.fullName.trim(),
      });
      invitationAccepted = true;
      let verificationSent = false;
      try {
        await sendVerificationEmail(credential.user);
        verificationSent = true;
      } catch (error) {
        console.error('Không thể gửi email xác thực nhân viên:', error?.code || error?.message);
      }
      await signOut(auth);
      window.history.replaceState({}, '', window.location.pathname);
      showToast(
        verificationSent
          ? t('authui.joined')
          : t('authui.joined_no_email'),
        verificationSent ? 'success' : 'warning',
      );
      changeView('login');
    } catch (error) {
      if (credential?.user && !invitationAccepted) {
        try { await deleteUser(credential.user); } catch { await signOut(auth); }
      } else if (credential?.user) {
        await signOut(auth);
      }
      const fallback = error.code === 'auth/email-already-in-use'
        ? t('authui.invite_email_in_use')
        : t('authui.invite_accept_failed');
      showToast(callableMessage(t, error, fallback), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async event => {
    event.preventDefault();
    setLoading(true);
    try {
      await requestPasswordResetEmail(form.email);
      setResetSent(true);
    } catch {
      showToast(t('authui.reset_failed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const field = (label, name, type = 'text', extra = {}) => {
    const inputId = `auth-${view}-${name}`;
    return (
    <div className="form-group">
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        name={name}
        type={type}
        value={form[name]}
        onChange={event => set(name, event.target.value)}
        required={extra.required !== false}
        {...extra}
      />
    </div>
    );
  };

  return (
    <div className="auth-page-wrapper">
      <div className="auth-glass-container">
        <div className="auth-branding">
          <h1 style={{ fontSize: '2.5rem', marginBottom: '10px' }}>
            <i className="fas fa-layer-group" /> WeaHR
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '1.05rem', lineHeight: '1.6' }}>
            {t('authui.tagline')}
          </p>
          <div className="auth-value-list">
            <span><i className="fas fa-check-circle" /> {t('authui.value_trial')}</span>
            <span><i className="fas fa-check-circle" /> {t('authui.value_card')}</span>
            <span><i className="fas fa-check-circle" /> {t('authui.value_isolated')}</span>
          </div>

        </div>

        <div className="auth-form-section">
          {onBack && view !== 'invite' && (
            <button className="auth-link" type="button" onClick={onBack} style={{ alignSelf: 'flex-start', marginBottom: '14px' }}>
              {t('landing.back_home')}
            </button>
          )}
          {view === 'login' && (
            <div className="form-fade-in">
              <h2 className="auth-title">{t('authui.login_title')}</h2>
              <form onSubmit={handleLogin} className="modern-form">
                {field(t('authui.field_email'), 'email', 'email', { autoComplete: 'email' })}
                {field(t('authui.field_password'), 'password', 'password', { autoComplete: 'current-password' })}
                <button type="submit" className="btn-glow" disabled={loading}>
                  {loading ? t('authui.processing') : t('authui.login_title')}
                </button>
              </form>
              <p className="auth-secondary-actions">
                <button className="auth-link" type="button" onClick={() => changeView('forgot')}>{t('authui.forgot_link')}</button>
                <span> · </span>
                <button className="auth-link" type="button" onClick={() => changeView('owner')}>{t('authui.create_workspace_link')}</button>
              </p>
              <p className="auth-helper">{t('authui.employee_invite_only')}</p>
              {demoEmail && (
                <p className="auth-helper" style={{ color: '#a5b4fc' }}>
                  Demo local: <b>{demoEmail}</b> · {t('authui.demo_hint')}
                </p>
              )}
            </div>
          )}

          {view === 'owner' && (
            <div className="form-fade-in">
              <h2 className="auth-title">{t('authui.owner_title')}</h2>
              <p className="auth-lead">{t('authui.owner_lead')}</p>
              <form onSubmit={handleOwnerSignup} className="modern-form">
                {field(t('authui.field_business'), 'organizationName', 'text', { minLength: 2, maxLength: 120 })}
                {field(t('authui.field_full_name'), 'fullName', 'text', { minLength: 2, maxLength: 100 })}
                {field(t('authui.field_work_email'), 'email', 'email', { autoComplete: 'email' })}
                <div className="auth-field-row">
                  {field(t('authui.field_password'), 'password', 'password', { minLength: 8, autoComplete: 'new-password' })}
                  {field(t('authui.field_confirm'), 'confirmPassword', 'password', { minLength: 8, autoComplete: 'new-password' })}
                </div>
                <button type="submit" className="btn-glow" disabled={loading}>
                  {loading ? t('authui.creating_workspace') : t('authui.start_trial')}
                </button>
              </form>
              <button className="auth-link" type="button" onClick={() => changeView('login')}>{t('authui.back_to_login')}</button>
            </div>
          )}

          {view === 'invite' && (
            <div className="form-fade-in">
              <h2 className="auth-title">{t('authui.join_title')}</h2>
              {loading && !invitation && <p className="auth-lead">{t('authui.checking_invite')}</p>}
              {inviteError && (
                <div className="auth-invite-error">
                  <i className="fas fa-exclamation-triangle" /> {inviteError}
                </div>
              )}
              {invitation && (
                <>
                  <div className="auth-invite-card">
                    <span>{t('authui.invite_from')}</span>
                    <strong>{invitation.organizationName}</strong>
                    <small>{invitation.email}</small>
                  </div>
                  <form onSubmit={handleInvitationSignup} className="modern-form">
                    {field(t('authui.field_full_name'), 'fullName', 'text', { minLength: 2, maxLength: 100 })}
                    {field(t('authui.field_invited_email'), 'email', 'email', { disabled: true })}
                    <div className="auth-field-row">
                      {field(t('authui.field_password'), 'password', 'password', { minLength: 8, autoComplete: 'new-password' })}
                      {field(t('authui.field_confirm'), 'confirmPassword', 'password', { minLength: 8, autoComplete: 'new-password' })}
                    </div>
                    <button type="submit" className="btn-glow" disabled={loading}>
                      {loading ? t('authui.joining') : t('authui.create_employee_account')}
                    </button>
                  </form>
                </>
              )}
              <button className="auth-link" type="button" onClick={() => changeView('login')}>{t('authui.back_to_login')}</button>
            </div>
          )}

          {view === 'forgot' && (
            <div className="form-fade-in">
              <h2 className="auth-title">{t('authui.forgot_title')}</h2>
              {resetSent ? (
                <p className="auth-lead">{t('authui.reset_sent')}</p>
              ) : (
                <form onSubmit={handleResetPassword} className="modern-form">
                  {field(t('authui.field_email'), 'email', 'email')}
                  <button type="submit" className="btn-glow" disabled={loading}>
                    {loading ? t('authui.sending') : t('authui.send_reset')}
                  </button>
                </form>
              )}
              <button className="auth-link" type="button" onClick={() => changeView('login')}>{t('authui.back_to_login')}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
