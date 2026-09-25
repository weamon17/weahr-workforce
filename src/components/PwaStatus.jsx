import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { activatePwaUpdate } from '../pwa';

export default function PwaStatus() {
  const { t } = useTranslation();
  const [online, setOnline] = useState(() => navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [updateRegistration, setUpdateRegistration] = useState(null);
  const [installed, setInstalled] = useState(() =>
    window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    const handleInstallPrompt = event => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const handleInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    const handleUpdate = event => setUpdateRegistration(event.detail);
    let reloading = false;
    const handleControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    window.addEventListener('weahr:pwa-update', handleUpdate);
    navigator.serviceWorker?.addEventListener('controllerchange', handleControllerChange);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
      window.removeEventListener('weahr:pwa-update', handleUpdate);
      navigator.serviceWorker?.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') setInstallPrompt(null);
  };

  if (online && (!installPrompt || installed) && !updateRegistration) return null;

  return (
    <aside className={`pwa-status no-print ${online ? '' : 'is-offline'}`} aria-live="polite">
      <div className="pwa-status-icon">
        <i className={`fas ${online ? 'fa-mobile-alt' : 'fa-wifi'}`}></i>
      </div>
      <div className="pwa-status-copy">
        <strong>
          {!online
            ? t('pwa.offline_title')
            : updateRegistration
              ? t('pwa.update_title')
              : t('pwa.install_title')}
        </strong>
        <span>
          {!online
            ? t('pwa.offline_description')
            : updateRegistration
              ? t('pwa.update_description')
              : t('pwa.install_description')}
        </span>
      </div>
      {online && updateRegistration && (
        <button type="button" onClick={() => activatePwaUpdate(updateRegistration)}>
          {t('pwa.update_action')}
        </button>
      )}
      {online && !updateRegistration && installPrompt && !installed && (
        <button type="button" onClick={install}>{t('pwa.install_action')}</button>
      )}
    </aside>
  );
}
