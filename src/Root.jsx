import React, { lazy, Suspense } from 'react';

const App = lazy(() => import('./App.jsx'));
const KioskScreen = lazy(() => import('./components/kiosk/KioskScreen.jsx'));

// A paired counter tablet shows only the attendance QR; sign-in, Firebase and
// the manager screens are never loaded on that device.
export default function Root({ kioskCredential }) {
  return (
    <Suspense fallback={null}>
      {kioskCredential ? <KioskScreen credential={kioskCredential} /> : <App />}
    </Suspense>
  );
}
