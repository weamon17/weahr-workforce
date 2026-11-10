import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BrandLogo, BrandMark } from './BrandLogo';

const initialOf = value => (value || 'W').trim().charAt(0).toUpperCase();

// Shared WeaHR frame for every signed-in screen: espresso sidebar on desktop,
// compact top bar + bottom navigation on phones and tablets.
export default function AppShell({
  navItems,
  activeTab,
  onNavigate,
  primaryKeys,
  shopName,
  userName,
  roleLabel,
  onLogout,
  children,
}) {
  const { t, i18n } = useTranslation();
  const [moreOpen, setMoreOpen] = useState(false);
  const toggleLanguage = () => i18n.changeLanguage(i18n.language === 'vi' ? 'en' : 'vi');
  const nextLanguage = i18n.language === 'vi' ? 'EN' : 'VI';

  const primary = primaryKeys ? navItems.filter(item => primaryKeys.includes(item.key)) : navItems;
  const secondary = primaryKeys ? navItems.filter(item => !primaryKeys.includes(item.key)) : [];
  const secondaryBadge = secondary.reduce((sum, item) => sum + (item.badge || 0), 0);
  const go = key => { onNavigate(key); setMoreOpen(false); window.scrollTo?.({ top: 0 }); };

  return (
    <div className="app-shell">
      <aside className="app-sidebar desktop-only no-print" aria-label={t('nav.app_title')}>
        <div className="sidebar-brand">
          <BrandLogo size={42} tone="light" tagline={t('brand.tagline')} />
        </div>
        <div className="sidebar-shop">
          <small>{t('brand.shop_label')}</small>
          <strong title={shopName}>{shopName || t('brand.shop_fallback')}</strong>
        </div>
        <nav className="sidebar-nav">
          {navItems.map(item => (
            <button
              key={item.key}
              type="button"
              className={`sidebar-link ${activeTab === item.key ? 'active' : ''}`}
              aria-current={activeTab === item.key ? 'page' : undefined}
              onClick={() => go(item.key)}
            >
              <i className={item.icon} aria-hidden="true"></i>
              <span>{item.label}</span>
              {item.badge > 0 && <span className="sidebar-badge">{item.badge > 99 ? '99+' : item.badge}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="avatar">{initialOf(userName)}</div>
            <div className="sidebar-user-text">
              <small>{roleLabel}</small>
              <span title={userName}>{userName}</span>
            </div>
          </div>
          <div className="sidebar-actions">
            <button type="button" className="sidebar-action" onClick={toggleLanguage} title={t('nav.change_language')}>
              <i className="fas fa-globe" aria-hidden="true"></i> {nextLanguage}
            </button>
            <button type="button" className="sidebar-action" onClick={onLogout}>
              <i className="fas fa-sign-out-alt" aria-hidden="true"></i> {t('nav.logout')}
            </button>
          </div>
          <div className="sidebar-signature">
            <span className="wea-beans" aria-hidden="true"><span></span><span></span><span></span></span>
            © {new Date().getFullYear()} WeaHR
          </div>
        </div>
      </aside>

      <div className="app-content">
        <header className="app-topbar mobile-only no-print">
          <BrandLogo size={34} tone="light" />
          <div className="topbar-actions">
            <button type="button" className="topbar-btn" onClick={toggleLanguage} title={t('nav.change_language')}>
              <i className="fas fa-globe" aria-hidden="true"></i> {nextLanguage}
            </button>
            <button type="button" className="topbar-btn" onClick={onLogout} title={t('nav.logout')} aria-label={t('nav.logout')}>
              <i className="fas fa-sign-out-alt" aria-hidden="true"></i>
            </button>
          </div>
        </header>

        <main className="app-main">{children}</main>

        <footer className="app-footer no-print">
          <BrandMark size={22} />
          <span><strong>WeaHR</strong> · {t('nav.powered_by')}</span>
          <span>© {new Date().getFullYear()} WeaHR. {t('brand.copyright')}</span>
        </footer>
      </div>

      {moreOpen && secondary.length > 0 && (
        <div className="more-sheet-overlay no-print" onClick={() => setMoreOpen(false)}>
          <div className="more-sheet" role="menu" aria-label={t('nav.more')} onClick={event => event.stopPropagation()}>
            {secondary.map(item => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className={`more-sheet-item ${activeTab === item.key ? 'active' : ''}`}
                onClick={() => go(item.key)}
              >
                <i className={item.icon} aria-hidden="true"></i>
                <span>{item.label}</span>
                {item.badge > 0 && <span className="sidebar-badge">{item.badge}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <nav className="bottom-nav no-print" aria-label={t('nav.app_title')}>
        {primary.map(item => (
          <button
            key={item.key}
            type="button"
            className={`bottom-nav-item ${activeTab === item.key ? 'active' : ''}`}
            aria-current={activeTab === item.key ? 'page' : undefined}
            onClick={() => go(item.key)}
          >
            {item.badge > 0 && <span className="bottom-nav-badge">{item.badge > 9 ? '9+' : item.badge}</span>}
            <i className={item.icon} aria-hidden="true"></i>
            <span>{item.label}</span>
          </button>
        ))}
        {secondary.length > 0 && (
          <button
            type="button"
            className={`bottom-nav-item ${moreOpen || secondary.some(item => item.key === activeTab) ? 'active' : ''}`}
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(open => !open)}
          >
            {secondaryBadge > 0 && <span className="bottom-nav-badge">{secondaryBadge > 9 ? '9+' : secondaryBadge}</span>}
            <i className="fas fa-ellipsis-h" aria-hidden="true"></i>
            <span>{t('nav.more')}</span>
          </button>
        )}
      </nav>
    </div>
  );
}
