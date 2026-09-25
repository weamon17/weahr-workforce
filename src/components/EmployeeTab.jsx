import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { deleteDoc, doc, setDoc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { buildEmployeeDocumentId } from '../utils/employee';
import { localDateString, localMonthString } from '../utils/time';
import { employeeSkills, normalizeSkills, POSITION_OPTIONS } from '../utils/skills';

const emptyForm = {
  name: '',
  employeeCode: '',
  dateOfBirth: '',
  citizenId: '',
  address: '',
  phone: '',
  email: '',
  type: 'parttime',
  position: '',
  skills: [],
  employmentStatus: 'active',
  startDate: localDateString(),
  salary: '',
  monthlySalary: '',
  standardWorkDays: '26',
  standardHoursPerDay: '8',
  freeOffDays: '2',
  overtimeRate: '1.5',
  workScheduleMode: 'rotating',
  standardStart: '',
  standardEnd: '',
};

const generateEmployeeCode = (employees) => {
  const existing = Object.values(employees)
    .map(e => e.employeeCode)
    .filter(Boolean)
    .map(c => parseInt(c.replace('NV', ''), 10))
    .filter(n => !isNaN(n));
  const max = existing.length > 0 ? Math.max(...existing) : 0;
  return `NV${String(max + 1).padStart(3, '0')}`;
};

export default function EmployeeTab({
  savedEmployees, setSavedEmployees,
  records, setRecords,
  appliedPenalties, setAppliedPenalties,
  organizationId,
  demoMode = false,
  formatMoney, handleMoneyInput,
  db, showToast, showConfirm,
}) {
  const { t } = useTranslation();

  // Positions — stored value stays Vietnamese for backward compat, only label is translated
  const POSITIONS = useMemo(
    () => POSITION_OPTIONS.map(option => ({ value: option.value, label: t(option.labelKey) })),
    [t],
  );

  const STATUS_OPTIONS = useMemo(() => [
    { value: 'active',    label: t('employee_extra.status_active'),    color: '#10b981' },
    { value: 'suspended', label: t('employee_extra.status_suspended'), color: '#f59e0b' },
    { value: 'resigned',  label: t('employee_extra.status_resigned'),  color: '#ef4444' },
  ], [t]);

  const [form, setForm] = useState(emptyForm);
  const [editingName, setEditingName] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [view, setView] = useState('list');
  const [detailName, setDetailName] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState('all');

  const set = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const openAddForm = () => {
    setForm({ ...emptyForm, employeeCode: generateEmployeeCode(savedEmployees) });
    setEditingName(null);
    setView('form');
  };

  const openEditForm = (name, data) => {
    setForm({
      name,
      employeeCode: data.employeeCode || '',
      dateOfBirth: data.dateOfBirth || '',
      citizenId: data.citizenId || '',
      address: data.address || '',
      phone: data.phone || '',
      email: data.email || '',
      type: data.type || 'parttime',
      position: data.position || '',
      skills: employeeSkills(data).filter(skill => skill !== data.position),
      employmentStatus: data.employmentStatus || 'active',
      startDate: data.startDate || '',
      salary: data.type === 'parttime' ? (data.salary || '') : '',
      monthlySalary: data.type === 'fulltime' ? (data.salary || '') : '',
      standardWorkDays: data.standardWorkDays || '26',
      standardHoursPerDay: data.standardHoursPerDay || '8',
      freeOffDays: data.freeOffDays || '2',
      overtimeRate: data.overtimeRate || '1.5',
      workScheduleMode: data.workScheduleMode
        || (data.standardStart && data.standardEnd ? 'fixed' : 'rotating'),
      standardStart: data.standardStart || '',
      standardEnd: data.standardEnd || '',
    });
    setEditingName(name);
    setView('form');
  };

  const handleSave = async () => {
    if (demoMode) return showToast(t('demo.read_only'), 'warning');
    if (!form.name.trim()) return showToast(t('employee_extra.val_name_required'), 'warning');
    const normalizedName = form.name.trim();
    if (normalizedName !== editingName && savedEmployees[normalizedName]) {
      return showToast(t('employee_extra.val_name_exists'), 'warning');
    }
    if (form.type === 'parttime' && !form.salary) return showToast(t('employee_extra.val_hourly_required'), 'warning');
    if (form.type === 'fulltime' && !form.monthlySalary) return showToast(t('employee_extra.val_monthly_required'), 'warning');

    setIsSaving(true);
    try {
      const newName = normalizedName;
      const previousData = editingName ? savedEmployees[editingName] : null;
      const employeeDocumentId = previousData?.employeeDocumentId
        || buildEmployeeDocumentId(organizationId, form.employeeCode || globalThis.crypto?.randomUUID?.() || Date.now());
      const newData = {
        employeeId: previousData?.employeeId || previousData?.userId || null,
        employeeDocumentId,
        organizationId,
        fullName: newName,
        employeeCode: form.employeeCode,
        dateOfBirth: form.dateOfBirth,
        citizenId: form.citizenId,
        address: form.address,
        phone: form.phone,
        email: form.email,
        type: form.type,
        position: form.position,
        skills: normalizeSkills(form.position, form.skills),
        employmentStatus: form.employmentStatus,
        startDate: form.startDate,
        salary: form.type === 'parttime' ? Number(form.salary) : Number(form.monthlySalary),
        standardWorkDays: Number(form.standardWorkDays) || 26,
        standardHoursPerDay: Number(form.standardHoursPerDay) || 8,
        freeOffDays: Number(form.freeOffDays) || 2,
        overtimeRate: Number(form.overtimeRate) || 1.5,
        workScheduleMode: form.type === 'fulltime' ? form.workScheduleMode : null,
        standardStart: form.type === 'fulltime' && form.workScheduleMode === 'fixed' ? form.standardStart : '',
        standardEnd: form.type === 'fulltime' && form.workScheduleMode === 'fixed' ? form.standardEnd : '',
      };

      if (editingName && editingName !== newName) {
        if (newData.employeeId) {
          await httpsCallable(functions, 'renameEmployeeAccount')({
            employeeId: newData.employeeId,
            fullName: newName,
          });
        } else {
          const tsToUpdate = records.filter(r => r.employeeName === editingName);
          for (const r of tsToUpdate) {
            await updateDoc(doc(db, 'timesheets', r.id), { employeeName: newName });
          }
          const penToUpdate = (appliedPenalties || []).filter(p => p.employeeName === editingName);
          for (const p of penToUpdate) {
            await updateDoc(doc(db, 'penalties', p.id), { employeeName: newName });
          }
        }
        setRecords(records.map(r => r.employeeName === editingName ? { ...r, employeeName: newName } : r));
        if (setAppliedPenalties) {
          setAppliedPenalties(prev => prev.map(p => p.employeeName === editingName ? { ...p, employeeName: newName } : p));
        }
        setSavedEmployees(prev => {
          const n = { ...prev };
          delete n[editingName];
          n[newName] = newData;
          return n;
        });
      } else {
        setSavedEmployees(prev => ({ ...prev, [newName]: newData }));
      }

      await setDoc(doc(db, 'employees', employeeDocumentId), newData);
      if (newData.employeeId) {
        if (previousData?.employmentStatus && previousData.employmentStatus !== newData.employmentStatus) {
          await httpsCallable(functions, 'setEmployeeAccountStatus')({
            employeeId: newData.employeeId,
            status: newData.employmentStatus,
          });
        }
        await setDoc(doc(db, 'employee_profiles', newData.employeeId), {
          employeeType: newData.type,
          fullName: newName,
          position: newData.position,
          skills: newData.skills,
          employmentStatus: newData.employmentStatus,
          salary: newData.type === 'fulltime' ? newData.salary : 0,
          hourlyRate: newData.type === 'parttime' ? newData.salary : 0,
          standardWorkDays: newData.standardWorkDays,
          standardHoursPerDay: newData.standardHoursPerDay,
          freeOffDays: newData.freeOffDays,
          overtimeRate: newData.overtimeRate,
          workScheduleMode: newData.workScheduleMode,
          standardStart: newData.standardStart,
          standardEnd: newData.standardEnd,
        }, { merge: true });
      }
      showToast(editingName ? t('employee_extra.toast_updated') : t('employee_extra.toast_added'), 'success');
      setView('list');
      setEditingName(null);
    } catch (e) {
      console.error(e);
      showToast(t('employee_extra.toast_save_error'), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = (name) => {
    if (demoMode) return showToast(t('demo.no_delete'), 'warning');
    showConfirm(`${t('employee_extra.val_name_required').replace('!','')} "${name}"?`, async () => {
      try {
        const employee = savedEmployees[name];
        if (employee?.employeeId || employee?.userId) {
          await httpsCallable(functions, 'setEmployeeAccountStatus')({
            employeeId: employee.employeeId || employee.userId,
            status: 'resigned',
          });
        }
        await deleteDoc(doc(db, 'employees', employee?.employeeDocumentId || name));
        setSavedEmployees(prev => {
          const n = { ...prev };
          delete n[name];
          return n;
        });
        if (detailName === name) { setDetailName(null); setView('list'); }
        showToast(t('employee_extra.toast_deleted'), 'success');
      } catch {
        showToast(t('employee_extra.toast_delete_error'), 'error');
      }
    });
  };

  const handleToggleStatus = async (name, data) => {
    if (demoMode) return showToast(t('demo.no_status'), 'warning');
    const nextStatus = data.employmentStatus === 'active' ? 'suspended' : 'active';
    try {
      if (data.employeeId || data.userId) {
        await httpsCallable(functions, 'setEmployeeAccountStatus')({
          employeeId: data.employeeId || data.userId,
          status: nextStatus,
        });
      }
      await updateDoc(doc(db, 'employees', data.employeeDocumentId || name), { employmentStatus: nextStatus });
      setSavedEmployees(prev => ({ ...prev, [name]: { ...data, employmentStatus: nextStatus } }));
      showToast(nextStatus === 'active' ? t('employee_extra.toast_activated') : t('employee_extra.toast_suspended'), 'success');
    } catch {
      showToast(t('employee_extra.toast_status_error'), 'error');
    }
  };

  const filtered = useMemo(() => {
    return Object.entries(savedEmployees).filter(([name, data]) => {
      const q = searchText.toLowerCase();
      const matchSearch = !q || name.toLowerCase().includes(q)
        || (data.phone || '').includes(q)
        || (data.email || '').toLowerCase().includes(q)
        || (data.employeeCode || '').toLowerCase().includes(q);
      const matchStatus = filterStatus === 'all' || (data.employmentStatus || 'active') === filterStatus;
      const matchType = filterType === 'all' || data.type === filterType;
      return matchSearch && matchStatus && matchType;
    });
  }, [savedEmployees, searchText, filterStatus, filterType]);

  const detailData = detailName ? savedEmployees[detailName] : null;
  const statusInfo = (s) => STATUS_OPTIONS.find(o => o.value === (s || 'active')) || STATUS_OPTIONS[0];

  // Get translated position label (falls back to stored value)
  const positionLabel = (value) => {
    const found = POSITIONS.find(p => p.value === value);
    return found ? found.label : (value || '—');
  };

  // ─── DETAIL VIEW ────────────────────────────────────────────────────────────
  if (view === 'detail' && detailName && detailData) {
    const empRecords = records.filter(r => r.employeeName === detailName);
    const currentMonth = localMonthString();
    const monthWork = empRecords.filter(r => r.date?.startsWith(currentMonth) && r.status !== 'off');
    const totalHours = monthWork.reduce((s, r) => s + (r.workHours || 0), 0);
    const si = statusInfo(detailData.employmentStatus);
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <button className="btn-secondary" style={{ padding: '8px 14px', fontSize: '0.85rem' }} onClick={() => setView('list')}>
            <i className="fas fa-arrow-left" style={{ marginRight: '6px' }}></i>{t('employee_extra.back_list')}
          </button>
          <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: '800' }}>{t('employee_extra.detail_title')}</h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
          {/* Profile card */}
          <div className="card" style={{ margin: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
              <div style={{
                width: '60px', height: '60px', borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--primary), #3730a3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'white', fontSize: '1.5rem', fontWeight: '800', flexShrink: 0
              }}>
                {detailName.charAt(0).toUpperCase()}
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem' }}>{detailName}</h3>
                <div style={{ display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
                  <span className={`badge ${detailData.type === 'fulltime' ? 'badge-ft' : 'badge-pt'}`}>
                    {detailData.type === 'fulltime' ? 'Full-time' : 'Part-time'}
                  </span>
                  <span style={{ fontSize: '0.75rem', fontWeight: '600', padding: '3px 10px', borderRadius: '12px', background: `${si.color}22`, color: si.color }}>
                    {si.label}
                  </span>
                  {detailData.employeeCode && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '3px 10px', borderRadius: '12px', background: '#f1f5f9' }}>{detailData.employeeCode}</span>}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { icon: 'fa-briefcase',       label: t('employee_extra.detail_position'),  value: positionLabel(detailData.position) },
                { icon: 'fa-tools',           label: t('employee_extra.detail_skills'),    value: employeeSkills(detailData).map(positionLabel).join(', ') || '—' },
                { icon: 'fa-phone',            label: t('employee_extra.detail_phone'),     value: detailData.phone || '—' },
                { icon: 'fa-envelope',         label: t('employee_extra.detail_email'),     value: detailData.email || '—' },
                { icon: 'fa-id-card',          label: t('employee_extra.detail_citizen_id'),value: detailData.citizenId || '—' },
                { icon: 'fa-birthday-cake',    label: t('employee_extra.detail_dob'),       value: detailData.dateOfBirth || '—' },
                { icon: 'fa-map-marker-alt',   label: t('employee_extra.detail_address'),   value: detailData.address || '—' },
                { icon: 'fa-calendar-plus',    label: t('employee_extra.detail_start_date'),value: detailData.startDate || '—' },
              ].map(item => (
                <div key={item.label} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <i className={`fas ${item.icon}`} style={{ color: 'var(--primary)', width: '16px', marginTop: '2px', flexShrink: 0 }}></i>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', minWidth: '90px' }}>{item.label}</span>
                  <span style={{ fontSize: '0.9rem', fontWeight: '600' }}>{item.value}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '20px', flexWrap: 'wrap' }}>
              <button className="btn-warning" style={{ flex: 1 }} onClick={() => openEditForm(detailName, detailData)}>
                <i className="fas fa-edit" style={{ marginRight: '5px' }}></i>{t('employee_extra.edit_profile_btn')}
              </button>
              <button
                onClick={() => handleToggleStatus(detailName, detailData)}
                style={{ flex: 1, padding: '8px 14px', borderRadius: '8px', border: '1px solid', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600',
                  borderColor: detailData.employmentStatus === 'active' ? '#fcd34d' : '#86efac',
                  background: detailData.employmentStatus === 'active' ? '#fffbeb' : '#f0fdf4',
                  color: detailData.employmentStatus === 'active' ? '#d97706' : '#15803d' }}
              >
                {detailData.employmentStatus === 'active' ? `⏸ ${t('employee_extra.suspend_btn')}` : `▶ ${t('employee_extra.activate_btn')}`}
              </button>
              <button className="btn-danger" onClick={() => handleDelete(detailName)}>
                <i className="fas fa-trash"></i>
              </button>
            </div>
          </div>

          {/* Salary config */}
          <div className="card" style={{ margin: 0 }}>
            <h3 style={{ marginTop: 0, color: 'var(--primary)', fontSize: '1rem' }}>
              <i className="fas fa-money-bill-wave" style={{ marginRight: '8px' }}></i>{t('employee_extra.salary_config_title')}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {detailData.type === 'parttime' ? (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t('employee_extra.detail_hourly')}</span>
                  <span style={{ fontWeight: '700' }}>{formatMoney(detailData.salary)}</span>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t('employee_extra.detail_monthly')}</span>
                    <span style={{ fontWeight: '700' }}>{formatMoney(detailData.salary)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t('employee_extra.detail_std_days')}</span>
                    <span style={{ fontWeight: '700' }}>{detailData.standardWorkDays || 26}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t('employee_extra.detail_std_hours')}</span>
                    <span style={{ fontWeight: '700' }}>{detailData.standardHoursPerDay || 8}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t('employee_extra.detail_free_off')}</span>
                    <span style={{ fontWeight: '700' }}>{detailData.freeOffDays || 2}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t('employee_extra.detail_ot_rate')}</span>
                    <span style={{ fontWeight: '700' }}>{detailData.overtimeRate || 1.5}x</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t('employee_extra.detail_schedule_mode')}</span>
                    <span style={{ fontWeight: '700' }}>
                      {(detailData.workScheduleMode || (detailData.standardStart && detailData.standardEnd ? 'fixed' : 'rotating')) === 'rotating'
                        ? t('employee_extra.schedule_mode_rotating')
                        : t('employee_extra.schedule_mode_fixed')}
                    </span>
                  </div>
                  {detailData.standardStart && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t('employee_extra.detail_shift')}</span>
                      <span style={{ fontWeight: '700' }}>{detailData.standardStart} – {detailData.standardEnd}</span>
                    </div>
                  )}
                </>
              )}
            </div>

            <h3 style={{ color: 'var(--primary)', fontSize: '1rem', marginTop: '20px' }}>
              <i className="fas fa-chart-bar" style={{ marginRight: '8px' }}></i>{t('employee_extra.this_month')}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t('employee_extra.detail_work_days')}</span>
                <span style={{ fontWeight: '700' }}>{new Set(monthWork.map(r => r.date)).size}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t('employee_extra.detail_total_hours')}</span>
                <span style={{ fontWeight: '700' }}>{totalHours.toFixed(1)}h</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── FORM VIEW ───────────────────────────────────────────────────────────────
  if (view === 'form') {
    const isEdit = !!editingName;
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <button className="btn-secondary" style={{ padding: '8px 14px', fontSize: '0.85rem' }} onClick={() => setView('list')}>
            <i className="fas fa-arrow-left" style={{ marginRight: '6px' }}></i>{t('employee_extra.back_list')}
          </button>
          <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: '800' }}>
            {isEdit ? t('employee_extra.form_title_edit') : t('employee_extra.form_title_add')}
          </h2>
        </div>

        <div className="card" style={{ margin: 0 }}>
          {/* Basic info */}
          <h3 style={{ marginTop: 0, color: 'var(--primary)', fontSize: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
            <i className="fas fa-user" style={{ marginRight: '8px' }}></i>{t('employee_extra.form_basic_info')}
          </h3>
          <div className="grid-2">
            <div className="form-group">
              <label>{t('employee_extra.field_code')}</label>
              <input value={form.employeeCode} onChange={e => set('employeeCode', e.target.value)} placeholder="NV001" />
            </div>
            <div className="form-group">
              <label>{t('employee_extra.field_name')} *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} />
            </div>
            <div className="form-group">
              <label>{t('employee_extra.field_dob')}</label>
              <input type="date" value={form.dateOfBirth} onChange={e => set('dateOfBirth', e.target.value)} />
            </div>
            <div className="form-group">
              <label>{t('employee_extra.field_citizen_id')}</label>
              <input value={form.citizenId} onChange={e => set('citizenId', e.target.value)} placeholder="012345678901" />
            </div>
            <div className="form-group">
              <label>{t('employee_extra.field_phone')}</label>
              <input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="0901234567" />
            </div>
            <div className="form-group">
              <label>{t('employee_extra.field_email')}</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} />
            </div>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>{t('employee_extra.field_address')}</label>
              <input value={form.address} onChange={e => set('address', e.target.value)} />
            </div>
          </div>

          {/* Job info */}
          <h3 style={{ color: 'var(--primary)', fontSize: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '10px', marginTop: '8px' }}>
            <i className="fas fa-briefcase" style={{ marginRight: '8px' }}></i>{t('employee_extra.form_job_info')}
          </h3>
          <div className="grid-2">
            <div className="form-group">
              <label>{t('employee_extra.field_contract_type')} *</label>
              <select value={form.type} onChange={e => set('type', e.target.value)}>
                <option value="parttime">Part-time</option>
                <option value="fulltime">Full-time</option>
              </select>
            </div>
            <div className="form-group">
              <label>{t('employee_extra.field_position')}</label>
              <select value={form.position} onChange={e => set('position', e.target.value)}>
                <option value="">{t('employee_extra.select_position')}</option>
                {POSITIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>{t('employee_extra.field_extra_skills')}</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', paddingTop: '4px' }}>
                {POSITIONS.filter(p => p.value !== form.position && p.value !== 'Khác').map(p => (
                  <label key={p.value} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 500, textTransform: 'none', margin: 0 }}>
                    <input
                      type="checkbox"
                      style={{ width: 'auto', margin: 0 }}
                      checked={form.skills.includes(p.value)}
                      onChange={e => set('skills', e.target.checked
                        ? [...form.skills, p.value]
                        : form.skills.filter(skill => skill !== p.value))}
                    />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label>{t('employee_extra.field_status')}</label>
              <select value={form.employmentStatus} onChange={e => set('employmentStatus', e.target.value)}>
                {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>{t('employee_extra.field_start_date')}</label>
              <input type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} />
            </div>
          </div>

          {/* Salary config */}
          <h3 style={{ color: 'var(--primary)', fontSize: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '10px', marginTop: '8px' }}>
            <i className="fas fa-money-bill-wave" style={{ marginRight: '8px' }}></i>{t('employee_extra.form_salary_config')}
          </h3>

          {form.type === 'parttime' ? (
            <div className="grid-2">
              <div className="form-group">
                <label>{t('employee_extra.field_hourly_rate')} *</label>
                <input
                  type="text"
                  value={form.salary ? new Intl.NumberFormat('vi-VN').format(form.salary) : ''}
                  onChange={e => set('salary', handleMoneyInput(e.target.value))}
                  placeholder="25.000"
                />
              </div>
            </div>
          ) : (
            <div className="grid-2">
              <div className="form-group">
                <label>{t('employee_extra.field_monthly_salary')} *</label>
                <input
                  type="text"
                  value={form.monthlySalary ? new Intl.NumberFormat('vi-VN').format(form.monthlySalary) : ''}
                  onChange={e => set('monthlySalary', handleMoneyInput(e.target.value))}
                  placeholder="7.000.000"
                />
              </div>
              <div className="form-group">
                <label>{t('employee_extra.field_std_days')}</label>
                <input type="number" min="1" max="31" value={form.standardWorkDays} onChange={e => set('standardWorkDays', e.target.value)} />
              </div>
              <div className="form-group">
                <label>{t('employee_extra.field_std_hours')}</label>
                <input type="number" min="1" max="24" value={form.standardHoursPerDay} onChange={e => set('standardHoursPerDay', e.target.value)} />
              </div>
              <div className="form-group">
                <label>{t('employee_extra.field_free_off')}</label>
                <input type="number" min="0" max="31" value={form.freeOffDays} onChange={e => set('freeOffDays', e.target.value)} />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>{t('employee_extra.field_schedule_mode')}</label>
                <select value={form.workScheduleMode} onChange={e => set('workScheduleMode', e.target.value)}>
                  <option value="rotating">{t('employee_extra.schedule_mode_rotating')}</option>
                  <option value="fixed">{t('employee_extra.schedule_mode_fixed')}</option>
                </select>
                <small style={{ color: 'var(--text-muted)' }}>
                  {form.workScheduleMode === 'rotating'
                    ? t('employee_extra.rotating_ot_hint')
                    : t('employee_extra.fixed_ot_hint')}
                </small>
              </div>
              {form.workScheduleMode === 'fixed' && (
                <>
                  <div className="form-group">
                    <label>{t('employee_extra.field_ft_start')}</label>
                    <input type="time" value={form.standardStart} onChange={e => set('standardStart', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>{t('employee_extra.field_ft_end')}</label>
                    <input type="time" value={form.standardEnd} onChange={e => set('standardEnd', e.target.value)} />
                  </div>
                </>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <button className="btn-primary" onClick={handleSave} disabled={isSaving} style={{ flex: 1 }}>
              {isSaving ? t('employee_extra.saving') : isEdit ? t('employee_extra.update_btn') : t('employee_extra.save_btn')}
            </button>
            <button style={{ padding: '12px 20px', background: '#e2e8f0', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }} onClick={() => setView('list')}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── LIST VIEW ───────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header + actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: '800' }}>
          {t('employee_extra.tab_title')}
          <span style={{ marginLeft: '10px', fontSize: '1rem', fontWeight: '600', color: 'var(--text-muted)' }}>
            ({Object.keys(savedEmployees).length})
          </span>
        </h2>
        <button className="btn-primary" onClick={openAddForm}>
          <i className="fas fa-plus" style={{ marginRight: '6px' }}></i>{t('employee_extra.add_btn')}
        </button>
      </div>

      {/* Search + filter */}
      <div className="card" style={{ margin: '0 0 16px 0', padding: '16px 20px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: '200px', position: 'relative' }}>
            <i className="fas fa-search" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}></i>
            <input
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder={t('employee_extra.search_placeholder')}
              style={{ paddingLeft: '36px' }}
            />
          </div>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ minWidth: '160px', width: 'auto' }}>
            <option value="all">{t('employee_extra.filter_all_types')}</option>
            <option value="parttime">Part-time</option>
            <option value="fulltime">Full-time</option>
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ minWidth: '160px', width: 'auto' }}>
            <option value="all">{t('employee_extra.filter_all_status')}</option>
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* Employee list */}
      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px', margin: 0 }}>
          <i className="fas fa-users" style={{ fontSize: '2.5rem', color: '#cbd5e1', marginBottom: '12px', display: 'block' }}></i>
          <p style={{ color: 'var(--text-muted)' }}>
            {Object.keys(savedEmployees).length === 0 ? t('employee_extra.no_employees') : t('employee_extra.no_match')}
          </p>
        </div>
      ) : (
        <div className="card" style={{ margin: 0, padding: 0, overflow: 'hidden' }}>
          <div className="table-wrapper" style={{ border: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th>{t('employee_extra.col_code')}</th>
                  <th>{t('employee_extra.col_employee')}</th>
                  <th>{t('employee_extra.col_type')}</th>
                  <th>{t('employee_extra.col_position')}</th>
                  <th>{t('employee_extra.col_salary')}</th>
                  <th>{t('employee_extra.col_status')}</th>
                  <th style={{ textAlign: 'center' }}>{t('employee_extra.col_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(([name, data]) => {
                  const si = statusInfo(data.employmentStatus);
                  return (
                    <tr key={name} style={{ opacity: data.employmentStatus === 'resigned' ? 0.5 : 1 }}>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{data.employeeCode || '—'}</td>
                      <td>
                        <div style={{ fontWeight: '700' }}>{name}</div>
                        {data.phone && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{data.phone}</div>}
                      </td>
                      <td>
                        <span className={`badge ${data.type === 'fulltime' ? 'badge-ft' : 'badge-pt'}`}>
                          {data.type === 'fulltime' ? 'Full-time' : 'Part-time'}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.9rem' }}>{positionLabel(data.position)}</td>
                      <td style={{ fontWeight: '600' }}>
                        {formatMoney(data.salary)}
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '4px' }}>
                          {data.type === 'parttime' ? t('employee_extra.per_hour') : t('employee_extra.per_month')}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.8rem', fontWeight: '600', padding: '3px 10px', borderRadius: '12px', background: `${si.color}22`, color: si.color }}>
                          {si.label}
                        </span>
                      </td>
                      <td>
                        <div className="action-buttons" style={{ justifyContent: 'center' }}>
                          <button className="btn-warning" style={{ fontSize: '0.8rem', padding: '6px 12px' }} onClick={() => { setDetailName(name); setView('detail'); }}>
                            <i className="fas fa-eye"></i>
                          </button>
                          <button className="btn-warning" style={{ fontSize: '0.8rem', padding: '6px 12px' }} onClick={() => openEditForm(name, data)}>
                            <i className="fas fa-edit"></i>
                          </button>
                          <button className="btn-danger" style={{ fontSize: '0.8rem', padding: '6px 12px' }} onClick={() => handleDelete(name)}>
                            <i className="fas fa-trash"></i>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
