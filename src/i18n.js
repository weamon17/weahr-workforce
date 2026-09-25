import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enTranslation from './locales/en.json';
import viTranslation from './locales/vi.json';

const resources = {
  en: { translation: enTranslation },
  vi: { translation: viTranslation }
};

i18n
  .use(initReactI18next) // Truyền i18n vào react-i18next
  .init({
    resources,
    lng: 'vi', // Ngôn ngữ mặc định khi vừa mở web lên là Tiếng Việt
    fallbackLng: 'en', // Nếu lỗi không tìm thấy chữ tiếng Việt, tự lùi về tiếng Anh
    interpolation: {
      escapeValue: false // React đã tự động bảo mật chống XSS nên không cần escape
    }
  });

export default i18n;