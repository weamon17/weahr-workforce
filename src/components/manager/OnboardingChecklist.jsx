import React, { useEffect, useState } from 'react';
import { collection, doc, getCountFromServer, getDoc, query, where } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { buildOnboardingSteps } from '../../utils/onboarding';

const dismissKey = organizationId => `weahr:onboarding-dismissed:${organizationId}`;

const readDismissed = organizationId => {
  try {
    return window.localStorage.getItem(dismissKey(organizationId)) === '1';
  } catch {
    return false;
  }
};

export function OnboardingChecklistView({ progress, onNavigate, onDismiss }) {
  const { t } = useTranslation();
  const percent = Math.round((progress.completed / progress.total) * 100);

  return (
    <section className="onboarding-card" aria-labelledby="onboarding-title">
      <div className="onboarding-header">
        <div>
          <h3 id="onboarding-title">{t('onboarding.title')}</h3>
          <p>{t('onboarding.progress', { done: progress.completed, total: progress.total })}</p>
        </div>
        <button type="button" className="onboarding-dismiss" onClick={onDismiss}>{t('onboarding.dismiss')}</button>
      </div>
      <div className="onboarding-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <ol className="onboarding-steps">
        {progress.steps.map((step, index) => {
          const isNext = progress.nextStep?.key === step.key;
          return (
            <li key={step.key} className={`onboarding-step ${step.done ? 'done' : ''} ${isNext ? 'next' : ''}`}>
              <span className="onboarding-marker" aria-hidden="true">
                {step.done ? <i className="fas fa-check" /> : index + 1}
              </span>
              <div className="onboarding-text">
                <strong>
                  {t(`onboarding.step_${step.key}_title`)}
                  {!step.required && <small> · {t('onboarding.optional')}</small>}
                </strong>
                <span>{t(`onboarding.step_${step.key}_body`)}</span>
              </div>
              {!step.done && (
                <button type="button" className={isNext ? 'btn-primary' : 'btn-secondary'} onClick={() => onNavigate(step.tab)}>
                  {t('onboarding.do_it')}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default function OnboardingChecklist({ db, organizationId, records, savedEmployees, onNavigate }) {
  const [dismissed, setDismissed] = useState(() => readDismissed(organizationId));
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!organizationId || dismissed) return undefined;
    let active = true;
    const byOrganization = name => query(collection(db, name), where('organizationId', '==', organizationId));
    Promise.all([
      getDoc(doc(db, 'attendance_settings', organizationId)),
      getDoc(doc(db, 'schedule_settings', organizationId)),
      getCountFromServer(byOrganization('organization_invitations')),
      getCountFromServer(byOrganization('sales_records')),
    ]).then(([attendanceSnap, scheduleSnap, invitations, sales]) => {
      if (!active) return;
      setStatus({
        attendanceSettings: attendanceSnap.exists() ? attendanceSnap.data() : null,
        scheduleSettings: scheduleSnap.exists() ? scheduleSnap.data() : null,
        invitationCount: invitations.data().count,
        salesCount: sales.data().count,
      });
    }).catch(error => {
      // The checklist is a convenience; never block the dashboard on it.
      console.error('Onboarding status could not be loaded:', error);
    });
    return () => { active = false; };
  }, [db, dismissed, organizationId]);

  if (dismissed || !status) return null;
  const progress = buildOnboardingSteps({
    ...status,
    employeeCount: Object.values(savedEmployees || {}).filter(employee => employee.employeeId).length,
    records,
  });
  if (progress.allRequiredDone) return null;

  const dismiss = () => {
    try { window.localStorage.setItem(dismissKey(organizationId), '1'); } catch { /* optional */ }
    setDismissed(true);
  };

  return <OnboardingChecklistView progress={progress} onNavigate={onNavigate} onDismiss={dismiss} />;
}
