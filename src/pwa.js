const dispatchPwaEvent = (name, detail) => {
  window.dispatchEvent(new CustomEvent(name, { detail }));
};

export const registerPwa = () => {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      const notifyUpdate = () => dispatchPwaEvent('weahr:pwa-update', registration);

      if (registration.waiting && navigator.serviceWorker.controller) notifyUpdate();

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state !== 'installed') return;
          if (navigator.serviceWorker.controller) notifyUpdate();
          else dispatchPwaEvent('weahr:pwa-ready');
        });
      });

      setInterval(() => registration.update().catch(() => undefined), 60 * 60 * 1000);
    } catch (error) {
      console.warn('PWA registration failed:', error);
    }
  });
};

export const activatePwaUpdate = registration => {
  registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
};
