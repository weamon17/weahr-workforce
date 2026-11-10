// Counter kiosk pairing. The pairing link carries `?kiosk=<id>.<secret>` once;
// the credential is then kept on the device and removed from the address bar.
export const KIOSK_STORAGE_KEY = 'weahr:kiosk-credential';
export const KIOSK_PARAM = 'kiosk';
const CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{6,40}\.[A-Za-z0-9_-]{20,80}$/;

export const isKioskCredential = value => CREDENTIAL_PATTERN.test(String(value || ''));

export const buildKioskLink = (origin, pathname, credential) =>
  `${origin}${pathname}?${KIOSK_PARAM}=${encodeURIComponent(credential)}`;

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const readKioskCredential = () => {
  const params = new URLSearchParams(window.location.search);
  const fromLink = params.get(KIOSK_PARAM);
  if (fromLink !== null) {
    params.delete(KIOSK_PARAM);
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    if (isKioskCredential(fromLink)) {
      storage()?.setItem(KIOSK_STORAGE_KEY, fromLink);
      return fromLink;
    }
  }
  const saved = storage()?.getItem(KIOSK_STORAGE_KEY);
  return isKioskCredential(saved) ? saved : '';
};

export const clearKioskCredential = () => storage()?.removeItem(KIOSK_STORAGE_KEY);
