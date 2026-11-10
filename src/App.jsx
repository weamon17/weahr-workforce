import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { useTranslation } from 'react-i18next';
import { db, auth } from './firebase';
import { createDemoAdminSession } from './demo/demoAdmin';
import { buildEmployeeDirectory } from './utils/employee';
import { HISTORY_MONTHS, loadDatedDocuments, mergeById, monthStart } from './services/managerData';
import PwaStatus from './components/PwaStatus';
import AppShell from './components/brand/AppShell';
import { BrandMark } from './components/brand/BrandLogo';
import './App.css';

const Auth = lazy(() => import('./components/Auth'));
const Landing = lazy(() => import('./components/Landing'));
const TimesheetTab = lazy(() => import('./components/TimesheetTab'));
const PayrollTab = lazy(() => import('./components/PayrollTab'));
const EmployeeTab = lazy(() => import('./components/EmployeeTab'));
const DashboardTab = lazy(() => import('./components/manager/DashboardTab'));
const ScheduleTab = lazy(() => import('./components/manager/ScheduleTab'));
const BusinessInsightsTab = lazy(() => import('./components/manager/BusinessInsightsTab'));
const OrganizationSettingsTab = lazy(() => import('./components/manager/OrganizationSettingsTab'));
const TrialBanner = lazy(() => import('./components/manager/TrialBanner'));
const OnboardingChecklist = lazy(() => import('./components/manager/OnboardingChecklist'));
const EmployeePortal = lazy(() => import('./components/employee/EmployeePortal'));

// Tabs that stay on the mobile bottom bar; the rest live behind "More".
const MOBILE_PRIMARY_TABS = ['dashboard', 'timesheet', 'schedule', 'payroll'];

const RETURNING_USER_KEY = 'weahr:returning-user';

// Show the marketing landing page only to first-time visitors on the web.
const initialAuthView = () => {
  if (new URLSearchParams(window.location.search).get('invite')) return 'login';
  if (window.matchMedia?.('(display-mode: standalone)').matches) return 'login';
  try {
    if (window.localStorage.getItem(RETURNING_USER_KEY)) return 'login';
  } catch {
    // Storage can be unavailable (private mode); fall back to the landing page.
  }
  return null;
};

const initialManagerTab = () => {
  const view = new URLSearchParams(window.location.search).get('view');
  if (view === 'attendance') return 'timesheet';
  if (view === 'schedule') return 'schedule';
  return 'dashboard';
};

export default function App() {
  const { t, i18n } = useTranslation();

  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null); // Firestore users doc
  const [empProfile, setEmpProfile] = useState(null);   // Firestore employee_profiles doc
  const [activeTab, setActiveTab] = useState(initialManagerTab);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [demoMode, setDemoMode] = useState(false);
  const [demoSalesRecords, setDemoSalesRecords] = useState([]);

  const [records, setRecords] = useState([]);
  const [savedEmployees, setSavedEmployees] = useState({});
  const [appliedPenalties, setAppliedPenalties] = useState([]);
  const [appliedBonuses, setAppliedBonuses] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [organization, setOrganization] = useState(null);
  const [authView, setAuthView] = useState(initialAuthView);

  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const [confirmDialog, setConfirmDialog] = useState({ show: false, message: '', onConfirm: null });
  const toastTimer = useRef(null);
  // Earliest date whose timesheets/schedules are in memory, plus in-flight loads.
  const historyFromRef = useRef('');
  const historyLoadsRef = useRef(new Map());
  const initialLoadRef = useRef(null);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ show: true, message, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
  }, []);

  const handleDemoLogin = useCallback(email => {
    const demo = createDemoAdminSession(email);
    setDemoMode(true);
    setAuthError('');
    setCurrentUser(demo.currentUser);
    setUserProfile(demo.userProfile);
    setEmpProfile(null);
    setSavedEmployees(demo.employees);
    setRecords(demo.records);
    setAppliedPenalties(demo.penalties);
    setAppliedBonuses(demo.bonuses);
    setSchedules(demo.schedules);
    setDemoSalesRecords(demo.salesRecords);
    setOrganization(demo.organization);
    setActiveTab('dashboard');
  }, []);

  // Watch auth state + load user role
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setLoading(true);
      setAuthError('');
      setCurrentUser(user);
      if (user) {
        try { window.localStorage.setItem(RETURNING_USER_KEY, '1'); } catch { /* optional */ }
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            const profile = userDoc.data();
            if (profile.status !== 'active') {
              setUserProfile(null);
              setEmpProfile(null);
              setAuthError('app.account_inactive');
              setLoading(false);
              return;
            }
            setUserProfile(profile);
            if (profile.role === 'employee' && profile.status === 'active') {
              const empDoc = await getDoc(doc(db, 'employee_profiles', user.uid));
              if (empDoc.exists()) setEmpProfile(empDoc.data());
            }
          } else {
            // Missing profile: fail closed, never assume a role.
            setUserProfile(null);
            setAuthError('app.no_profile');
          }
        } catch (err) {
          console.error('Error loading user profile:', err);
          setUserProfile(null);
          setAuthError('app.verify_failed');
        }
      } else {
        setUserProfile(null);
        setEmpProfile(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Load manager data
  useEffect(() => {
    if (!currentUser || userProfile?.role !== 'manager' || demoMode) return;
    const fetchData = async () => {
      try {
        const organizationId = userProfile.organizationId;
        if (!organizationId) throw new Error('Manager profile is missing organizationId');
        const organizationQuery = collectionName => query(
          collection(db, collectionName),
          where('organizationId', '==', organizationId),
        );
        // Timesheets and schedules grow every day, so only recent months load up front.
        const from = monthStart(new Date(), HISTORY_MONTHS - 1);
        const [empSnap, timesheets, penSnap, bonusSnap, recentSchedules, profileSnap, organizationSnap] = await Promise.all([
          getDocs(organizationQuery('employees')),
          loadDatedDocuments(db, 'timesheets', organizationId, { from }),
          getDocs(organizationQuery('penalties')),
          getDocs(organizationQuery('bonuses')),
          loadDatedDocuments(db, 'schedules', organizationId, { from }),
          getDocs(organizationQuery('employee_profiles')),
          getDoc(doc(db, 'organizations', organizationId)),
        ]);
        const toEntries = snapshot => snapshot.docs.map(d => ({ id: d.id, data: d.data() }));
        historyFromRef.current = from;
        historyLoadsRef.current = new Map();
        setSavedEmployees(buildEmployeeDirectory(toEntries(empSnap), toEntries(profileSnap)));
        setRecords(timesheets);
        setAppliedPenalties(penSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setAppliedBonuses(bonusSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setSchedules(recentSchedules);
        setOrganization(organizationSnap.exists() ? organizationSnap.data() : null);
      } catch (err) {
        console.error(err);
        showToast(i18n.t('app.load_failed'), 'error');
      }
    };
    initialLoadRef.current = fetchData();
  }, [currentUser, userProfile, showToast, demoMode, i18n]);

  // Fetches an older month's timesheets and schedules when a screen needs it.
  const ensureMonthLoaded = useCallback(async month => {
    const organizationId = userProfile?.organizationId;
    if (demoMode || !organizationId || !/^\d{4}-\d{2}$/.test(month || '')) return;
    await initialLoadRef.current;
    const start = `${month}-01`;
    const loadedFrom = historyFromRef.current;
    if (!loadedFrom || start >= loadedFrom) return;
    if (historyLoadsRef.current.has(start)) return historyLoadsRef.current.get(start);
    const load = (async () => {
      try {
        const range = { from: start, before: loadedFrom };
        const [olderRecords, olderSchedules] = await Promise.all([
          loadDatedDocuments(db, 'timesheets', organizationId, range),
          loadDatedDocuments(db, 'schedules', organizationId, range),
        ]);
        setRecords(previous => mergeById(previous, olderRecords));
        setSchedules(previous => mergeById(previous, olderSchedules));
        if (start < historyFromRef.current) historyFromRef.current = start;
      } catch (err) {
        historyLoadsRef.current.delete(start);
        console.error(err);
        showToast(i18n.t('app.load_failed'), 'error');
      }
    })();
    historyLoadsRef.current.set(start, load);
    return load;
  }, [demoMode, userProfile?.organizationId, showToast, i18n]);

  const showConfirm = (message, onConfirm) => setConfirmDialog({ show: true, message, onConfirm });

  const handleConfirmAction = () => {
    const action = confirmDialog.onConfirm;
    setConfirmDialog({ show: false, message: '', onConfirm: null });
    if (action) setTimeout(() => action(), 50);
  };

  const handleCancelAction = () => setConfirmDialog({ show: false, message: '', onConfirm: null });

  const formatMoney = (amount) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);

  const handleMoneyInput = (value) => {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\D/g, '');
  };

  const handleLogout = async () => {
    if (demoMode) {
      setDemoMode(false);
      setCurrentUser(null);
      setUserProfile(null);
      setSavedEmployees({});
      setRecords([]);
      setAppliedPenalties([]);
      setAppliedBonuses([]);
      setSchedules([]);
      setDemoSalesRecords([]);
      setOrganization(null);
      return;
    }
    try { await signOut(auth); } catch { showToast(t('common.error'), 'danger'); }
  };

  const loadingScreen = (
    <div className="loading-screen">
      <div className="loading-brand">
        <BrandMark size={64} />
        <div className="spinner" />
      </div>
    </div>
  );

  if (loading) return loadingScreen;

  const isActive = currentUser && !authError && userProfile?.status === 'active';
  const pendingCount = schedules.filter(s => s.status === 'pending').length;
  const managerTabs = [
    { key: 'dashboard', icon: 'fas fa-mug-hot', label: t('nav.dashboard') },
    { key: 'timesheet', icon: 'fas fa-user-clock', label: t('nav.timesheet') },
    { key: 'schedule', icon: 'fas fa-calendar-week', label: t('nav.schedule'), badge: pendingCount },
    { key: 'payroll', icon: 'fas fa-wallet', label: t('nav.payroll') },
    { key: 'employee', icon: 'fas fa-users', label: t('nav.employees') },
    { key: 'insights', icon: 'fas fa-chart-line', label: t('nav.insights') },
    { key: 'organization', icon: 'fas fa-store', label: t('nav.organization') },
  ].filter(tab => !demoMode || tab.key !== 'organization');

  return (
    <Suspense fallback={loadingScreen}>
    <>
      {/* Auth screen — shown when not logged in */}
      {!currentUser && !authView && (
        <Landing onStart={() => setAuthView('owner')} onLogin={() => setAuthView('login')} />
      )}
      {!currentUser && authView && (
        <Auth
          key={authView}
          initialView={authView}
          onBack={() => setAuthView(null)}
          onLogin={setCurrentUser}
          onDemoLogin={handleDemoLogin}
          db={db}
          showToast={showToast}
        />
      )}

      {currentUser && authError && (
        <div className="loading-screen" style={{ flexDirection: 'column', gap: '16px', padding: '24px', textAlign: 'center' }}>
          <BrandMark size={56} />
          <p style={{ color: 'var(--danger)', fontWeight: 700, maxWidth: '420px' }}>{t(authError)}</p>
          <button className="btn-primary" onClick={handleLogout}>{t('nav.logout')}</button>
        </div>
      )}

      {/* Employee portal */}
      {isActive && userProfile?.role === 'employee' && (
        <EmployeePortal
          currentUser={currentUser}
          empProfile={empProfile}
          showToast={showToast}
        />
      )}

      {/* Manager portal */}
      {isActive && userProfile?.role === 'manager' && (
        <AppShell
          navItems={managerTabs}
          activeTab={activeTab}
          onNavigate={setActiveTab}
          primaryKeys={MOBILE_PRIMARY_TABS}
          shopName={organization?.name}
          userName={userProfile.fullName || currentUser.email}
          roleLabel={t('nav.role_manager')}
          onLogout={handleLogout}
        >
          {demoMode && (
            <div className="notice-banner" role="status">
              <i className="fas fa-flask" aria-hidden="true"></i> {t('app.demo_banner')}
            </div>
          )}
          {!demoMode && <TrialBanner organization={organization} />}
          {!demoMode && activeTab === 'dashboard' && (
            <OnboardingChecklist
              db={db}
              organizationId={userProfile.organizationId}
              records={records}
              savedEmployees={savedEmployees}
              onNavigate={setActiveTab}
            />
          )}
          {activeTab === 'dashboard' && (
            <DashboardTab
              records={records}
              savedEmployees={savedEmployees}
              schedules={schedules}
              appliedPenalties={appliedPenalties}
              appliedBonuses={appliedBonuses}
              formatMoney={formatMoney}
              shopName={organization?.name}
              userName={userProfile.fullName}
              onNavigate={setActiveTab}
            />
          )}
          {activeTab === 'timesheet' && (
            <TimesheetTab
              ensureMonthLoaded={ensureMonthLoaded}
              records={records} setRecords={setRecords}
              savedEmployees={savedEmployees} setSavedEmployees={setSavedEmployees}
              organizationId={userProfile.organizationId}
              demoMode={demoMode}
              db={db} showToast={showToast} showConfirm={showConfirm}
            />
          )}
          {activeTab === 'payroll' && (
            <div className="page-head" style={{ maxWidth: '1200px', margin: '0 auto 22px' }}>
              <div>
                <h2 className="page-title">{t('nav.payroll')}</h2>
                <p className="page-sub">{t('payroll.page_sub')}</p>
              </div>
            </div>
          )}
          {activeTab === 'payroll' && (
            <PayrollTab
              ensureMonthLoaded={ensureMonthLoaded}
              records={records} savedEmployees={savedEmployees}
              appliedPenalties={appliedPenalties} setAppliedPenalties={setAppliedPenalties}
              appliedBonuses={appliedBonuses} setAppliedBonuses={setAppliedBonuses}
              organizationId={userProfile.organizationId}
              demoMode={demoMode}
              formatMoney={formatMoney} db={db} showToast={showToast} showConfirm={showConfirm}
            />
          )}
          {activeTab === 'employee' && (
            <EmployeeTab
              savedEmployees={savedEmployees} setSavedEmployees={setSavedEmployees}
              records={records} setRecords={setRecords}
              appliedPenalties={appliedPenalties} setAppliedPenalties={setAppliedPenalties}
              organizationId={userProfile.organizationId}
              demoMode={demoMode}
              formatMoney={formatMoney} handleMoneyInput={handleMoneyInput} db={db} showToast={showToast} showConfirm={showConfirm}
            />
          )}
          {activeTab === 'schedule' && (
            <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
              <ScheduleTab
                schedules={schedules} setSchedules={setSchedules}
                organizationId={userProfile.organizationId} db={db} showToast={showToast}
                currentUser={currentUser}
                demoMode={demoMode}
              />
            </div>
          )}
          {activeTab === 'insights' && (
            <BusinessInsightsTab
              ensureMonthLoaded={ensureMonthLoaded}
              db={db}
              organizationId={userProfile.organizationId}
              records={records}
              savedEmployees={savedEmployees}
              schedules={schedules}
              demoMode={demoMode}
              demoSalesRecords={demoSalesRecords}
              showToast={showToast}
            />
          )}
          {activeTab === 'organization' && (
            <OrganizationSettingsTab
              db={db}
              organizationId={userProfile.organizationId}
              userProfile={userProfile}
              showToast={showToast}
            />
          )}
        </AppShell>
      )}

      {/* Toast — always rendered so it works on login screen too */}
      <div role="status" aria-live="polite" className={`toast-notification ${toast.type} ${toast.show ? 'show' : ''}`}>{toast.message}</div>
      <PwaStatus />

      {confirmDialog.show && (
        <div className="modal-overlay">
          <div className="confirm-modal" role="alertdialog" aria-modal="true">
            <h3><i className="fas fa-exclamation-triangle" aria-hidden="true"></i> {t('common.warning')}</h3>
            <p>{confirmDialog.message}</p>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={handleCancelAction}>{t('common.cancel')}</button>
              <button className="btn-confirm" onClick={handleConfirmAction}>{t('common.confirm')}</button>
            </div>
          </div>
        </div>
      )}
    </>
    </Suspense>
  );
}
