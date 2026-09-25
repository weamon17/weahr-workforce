import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, addDoc, updateDoc, doc, deleteDoc, serverTimestamp, getDocs, query, where } from 'firebase/firestore';
import { downloadCsv } from '../utils/csv';
import { calculatePayroll } from '../utils/payroll';
import { localMonthString } from '../utils/time';

export default function PayrollTab({
  records, savedEmployees,
  appliedPenalties, setAppliedPenalties,
  appliedBonuses,   setAppliedBonuses,
  formatMoney, organizationId, demoMode = false, db, showToast, showConfirm, ensureMonthLoaded,
}) {
  const { t } = useTranslation();

  const PAYROLL_STATUS_MAP = useMemo(() => ({
    draft:     { label: t('payroll.status_draft'),     color: '#64748b', bg: '#f1f5f9', icon: 'fas fa-pencil-alt' },
    finalized: { label: t('payroll.status_finalized'), color: '#1d4ed8', bg: '#dbeafe', icon: 'fas fa-lock' },
    revised:   { label: t('payroll.status_revised'),   color: '#92400e', bg: '#fef3c7', icon: 'fas fa-redo' },
    paid:      { label: t('payroll.status_paid'),      color: '#166534', bg: '#dcfce7', icon: 'fas fa-check-circle' },
  }), [t]);

  const [reportMonth,    setReportMonth]    = useState(localMonthString);
  const [reportEmployee, setReportEmployee] = useState('');

  useEffect(() => { ensureMonthLoaded?.(reportMonth); }, [ensureMonthLoaded, reportMonth]);

  const [penaltyInput,      setPenaltyInput]      = useState('');
  const [reasonInput,       setReasonInput]        = useState('');
  const [isSavingPenalty,   setIsSavingPenalty]    = useState(false);
  const [editingPenaltyId,  setEditingPenaltyId]   = useState(null);

  const [bonusInput,      setBonusInput]      = useState('');
  const [bonusReasonInput,setBonusReasonInput] = useState('');
  const [isSavingBonus,   setIsSavingBonus]   = useState(false);
  const [editingBonusId,  setEditingBonusId]  = useState(null);

  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, type: null, id: null });

  const [payrollDocs,      setPayrollDocs]      = useState([]);
  const [isFinalizingSave, setIsFinalizingSave] = useState(false);
  const [showReviseModal,  setShowReviseModal]  = useState(false);
  const [reviseReason,     setReviseReason]     = useState('');

  const blockDemoWrite = () => {
    if (!demoMode) return false;
    showToast(t('demo.read_only'), 'warning');
    return true;
  };
  const selectedEmployeeId = savedEmployees[reportEmployee]?.employeeId
    || savedEmployees[reportEmployee]?.userId
    || null;

  useEffect(() => {
    setPenaltyInput(''); setReasonInput(''); setEditingPenaltyId(null);
    setBonusInput(''); setBonusReasonInput(''); setEditingBonusId(null);
  }, [reportEmployee, reportMonth]);

  useEffect(() => {
    if (demoMode || !reportEmployee || !reportMonth) { setPayrollDocs([]); return; }
    let active = true;
    setPayrollDocs([]);
    const load = async () => {
      try {
        const optimizedQuery = query(
          collection(db, 'payrolls'),
          where('organizationId', '==', organizationId),
          ...(selectedEmployeeId
            ? [where('employeeId', '==', selectedEmployeeId)]
            : [where('employeeName', '==', reportEmployee)]),
          where('month', '==', reportMonth),
        );
        let snap;
        try {
          snap = await getDocs(optimizedQuery);
        } catch (error) {
          if (error?.code !== 'failed-precondition') throw error;
          // Existing Firebase projects may not have the new employeeId index yet.
          // Fall back to one tenant query so payroll remains usable during rollout.
          snap = await getDocs(query(
            collection(db, 'payrolls'),
            where('organizationId', '==', organizationId),
          ));
        }
        const documents = snap.docs
          .map(item => ({ id: item.id, ...item.data() }))
          .filter(item => item.month === reportMonth
            && (selectedEmployeeId
              ? item.employeeId === selectedEmployeeId
              : item.employeeName === reportEmployee));
        if (active) setPayrollDocs(documents);
      } catch (e) {
        console.error('Load payrolls error:', e);
      }
    };
    load();
    return () => { active = false; };
  }, [reportEmployee, reportMonth, selectedEmployeeId, demoMode, db, organizationId]);

  const currentPayrollDoc = useMemo(() =>
    [...payrollDocs].sort((a, b) => (b.version || 1) - (a.version || 1))[0] || null,
  [payrollDocs]);

  // ─── SALARY CALCULATION ───────────────────────────────────────────────────
  const calcData = useMemo(() => {
    if (!reportEmployee) return null;
    return calculatePayroll({
      employee: savedEmployees[reportEmployee],
      employeeName: reportEmployee,
      employeeId: selectedEmployeeId,
      month: reportMonth,
      records,
      penalties: appliedPenalties,
      bonuses: appliedBonuses,
    });
  }, [reportEmployee, reportMonth, selectedEmployeeId, records, savedEmployees, appliedPenalties, appliedBonuses]);
  const automaticWorkDays = calcData?.automaticWorkDays || 0;

  // ─── PAYROLL FINALIZATION ─────────────────────────────────────────────────
  const handleFinalizePayroll = async () => {
    if (blockDemoWrite()) return;
    if (!calcData) return;
    setIsFinalizingSave(true);
    try {
      const snapshot = {
        organizationId,
        employeeId:          selectedEmployeeId,
        employeeName:        reportEmployee,
        month:               reportMonth,
        status:              'finalized',
        version:             (currentPayrollDoc?.version || 0) + 1,
        finalizedAt:         serverTimestamp(),
        netSalary:           calcData.finalSalary,
        baseGross:           calcData.baseGross,
        otBonus:             calcData.otBonusMoney,
        holidayExtra:        calcData.holidayExtraMoney,
        nightAllowance:      calcData.nightAllowanceMoney,
        totalNightHours:     calcData.totalNightHours,
        lateDeduction:       calcData.lateDeductionMoney,
        absenceDeduction:    calcData.absenceDeductionMoney,
        totalBonus:          calcData.totalBonusMoney,
        totalPenalty:        calcData.totalPenaltyMoney,
        totalWorkHours:      calcData.totalWorkHours,
        totalOtHours:        calcData.totalOtHours,
        totalLateHours:      calcData.totalLateHours,
        actualWorkDays:      calcData.actualWorkDays,
        employeeType:        calcData.isFT ? 'fulltime' : 'parttime',
        calculationMethod:   calcData.isFT ? 'fulltime_actual_hours_v2' : 'parttime_hourly_v2',
        derivedHourlyRate:   calcData.derivedHourlyRate,
        standardWorkDays:    calcData.standardWorkDays,
        standardHoursPerDay: calcData.standardHoursPerDay,
        workScheduleMode:    calcData.workScheduleMode,
      };

      if (currentPayrollDoc) {
        await updateDoc(doc(db, 'payrolls', currentPayrollDoc.id), { ...snapshot, status: 'revised' });
        setPayrollDocs(prev => prev.map(p =>
          p.id === currentPayrollDoc.id ? { ...snapshot, status: 'revised', id: p.id } : p
        ));
      } else {
        const ref = await addDoc(collection(db, 'payrolls'), snapshot);
        setPayrollDocs([{ ...snapshot, id: ref.id }]);
      }
      showToast(t('payroll.toast_finalized'), 'success');
    } catch {
      showToast(t('payroll.toast_finalize_error'), 'error');
    } finally {
      setIsFinalizingSave(false);
    }
  };

  const handleMarkPaid = async () => {
    if (blockDemoWrite()) return;
    if (!currentPayrollDoc) return;
    try {
      await updateDoc(doc(db, 'payrolls', currentPayrollDoc.id), { status: 'paid', paidAt: serverTimestamp() });
      setPayrollDocs(prev => prev.map(p =>
        p.id === currentPayrollDoc.id ? { ...p, status: 'paid' } : p
      ));
      showToast(t('payroll.toast_paid'), 'success');
    } catch {
      showToast(t('payroll.toast_status_error'), 'error');
    }
  };

  const handleRevise = async () => {
    if (blockDemoWrite()) return;
    if (!reviseReason.trim()) { showToast(t('payroll.toast_revise_reason_required'), 'warning'); return; }
    if (!currentPayrollDoc) return;
    try {
      await updateDoc(doc(db, 'payrolls', currentPayrollDoc.id), {
        status: 'draft',
        reviseReason: reviseReason.trim(),
        revisedAt: serverTimestamp(),
      });
      setPayrollDocs(prev => prev.map(p =>
        p.id === currentPayrollDoc.id ? { ...p, status: 'draft', reviseReason: reviseReason.trim() } : p
      ));
      setShowReviseModal(false);
      setReviseReason('');
      showToast(t('payroll.toast_revise_opened'), 'success');
    } catch {
      showToast(t('payroll.toast_revise_error'), 'error');
    }
  };

  // ─── PENALTY ─────────────────────────────────────────────────────────────
  const handleSavePenalty = async () => {
    if (blockDemoWrite()) return;
    if (!reportEmployee || !penaltyInput) { showToast(t('payroll.toast_amount_required'), 'warning'); return; }
    setIsSavingPenalty(true);
    try {
      const amount = Number(penaltyInput) || 0;
      const reason = reasonInput.trim();
      if (editingPenaltyId) {
        await updateDoc(doc(db, 'penalties', editingPenaltyId), { amount, reason });
        setAppliedPenalties(prev => prev.map(p => p.id === editingPenaltyId ? { ...p, amount, reason } : p));
        setEditingPenaltyId(null);
      } else {
        const newP = { organizationId, employeeId: selectedEmployeeId, employeeName: reportEmployee, month: reportMonth, amount, reason, createdAt: serverTimestamp() };
        const ref  = await addDoc(collection(db, 'penalties'), newP);
        setAppliedPenalties(prev => [...prev, { ...newP, id: ref.id }]);
      }
      setPenaltyInput(''); setReasonInput('');
      showToast(t('payroll.toast_saved'), 'success');
    } catch { showToast(t('common.error'), 'error'); }
    finally { setIsSavingPenalty(false); }
  };

  // ─── BONUS ───────────────────────────────────────────────────────────────
  const handleSaveBonus = async () => {
    if (blockDemoWrite()) return;
    if (!reportEmployee || !bonusInput) { showToast(t('payroll.toast_amount_required'), 'warning'); return; }
    setIsSavingBonus(true);
    try {
      const amount = Number(bonusInput) || 0;
      const reason = bonusReasonInput.trim();
      if (editingBonusId) {
        await updateDoc(doc(db, 'bonuses', editingBonusId), { amount, reason });
        setAppliedBonuses(prev => prev.map(b => b.id === editingBonusId ? { ...b, amount, reason } : b));
        setEditingBonusId(null);
      } else {
        const newB = { organizationId, employeeId: selectedEmployeeId, employeeName: reportEmployee, month: reportMonth, amount, reason, createdAt: serverTimestamp() };
        const ref  = await addDoc(collection(db, 'bonuses'), newB);
        setAppliedBonuses(prev => [...prev, { ...newB, id: ref.id }]);
      }
      setBonusInput(''); setBonusReasonInput('');
      showToast(t('payroll.toast_saved'), 'success');
    } catch { showToast(t('common.error'), 'error'); }
    finally { setIsSavingBonus(false); }
  };

  const requestDeletePenalty = (id) => setConfirmDialog({ isOpen: true, type: 'penalty', id });
  const requestDeleteBonus   = (id) => setConfirmDialog({ isOpen: true, type: 'bonus',   id });

  const executeDelete = async () => {
    if (blockDemoWrite()) {
      setConfirmDialog({ isOpen: false, type: null, id: null });
      return;
    }
    const { type, id } = confirmDialog;
    setConfirmDialog({ isOpen: false, type: null, id: null });
    try {
      if (type === 'penalty') {
        await deleteDoc(doc(db, 'penalties', id));
        setAppliedPenalties(prev => prev.filter(p => p.id !== id));
        if (editingPenaltyId === id) { setEditingPenaltyId(null); setPenaltyInput(''); setReasonInput(''); }
      } else {
        await deleteDoc(doc(db, 'bonuses', id));
        setAppliedBonuses(prev => prev.filter(b => b.id !== id));
        if (editingBonusId === id) { setEditingBonusId(null); setBonusInput(''); setBonusReasonInput(''); }
      }
      showToast(t('payroll.toast_deleted'), 'success');
    } catch { showToast(t('common.error'), 'error'); }
  };

  // ─── MONTHLY SUMMARY ─────────────────────────────────────────────────────
  const monthlySummaryData = useMemo(() => {
    return Object.entries(savedEmployees).map(([name, emp]) => {
      const result = calculatePayroll({
        employee: emp,
        employeeName: name,
        employeeId: emp.employeeId || emp.userId,
        month: reportMonth,
        records,
        penalties: appliedPenalties,
        bonuses: appliedBonuses,
      });
      return {
        name,
        type: result.isFT ? 'fulltime' : 'parttime',
        workDays: result.actualWorkDays,
        totalWorkHours: result.totalWorkHours,
        totalOtHours: result.totalOtHours,
        estimated: result.finalSalary,
        bonuses: result.totalBonusMoney,
        penalties: result.totalPenaltyMoney,
      };
    });
  }, [records, savedEmployees, appliedBonuses, appliedPenalties, reportMonth]);

  const exportMonthlySummaryToExcel = () => {
    const mm = reportMonth.split('-')[1];
    const yy = reportMonth.split('-')[0];
    const data = [
      [`${t('payroll.summary_title')} ${mm}/${yy}`],
      [],
      [t('payroll.col_employee'), t('payroll.col_type'), t('payroll.col_work_days'), t('payroll.col_total_hours'), 'OT (h)', t('payroll.col_bonus'), t('payroll.col_penalty'), t('payroll.col_estimated')],
      ...monthlySummaryData.map(r => [
        r.name,
        r.type === 'fulltime' ? 'Full-time' : 'Part-time',
        r.workDays,
        Number(r.totalWorkHours).toFixed(2),
        Number(r.totalOtHours).toFixed(2),
        r.bonuses,
        r.penalties,
        Math.round(r.estimated),
      ]),
      [],
      [t('common.total'), '', '', '', '',
        monthlySummaryData.reduce((s, r) => s + r.bonuses, 0),
        monthlySummaryData.reduce((s, r) => s + r.penalties, 0),
        Math.round(monthlySummaryData.reduce((s, r) => s + r.estimated, 0)),
      ],
    ];
    downloadCsv(data, `payroll-summary-${reportMonth}.csv`);
  };

  const renderMonthlySummary = () => {
    if (monthlySummaryData.length === 0) return null;
    const totalEstimated = monthlySummaryData.reduce((s, r) => s + r.estimated, 0);
    const mm = reportMonth.split('-')[1];
    const yy = reportMonth.split('-')[0];

    return (
      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
          <div>
            <h3 style={{ margin: 0, fontWeight: '700' }}>
              <i className="fas fa-table" style={{ marginRight: '8px', color: 'var(--primary)' }}></i>
              {t('payroll.summary_title')} {mm}/{yy}
            </h3>
            <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>{t('payroll.summary_note')}</p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ background: 'linear-gradient(135deg, var(--primary), #3730a3)', color: 'white', padding: '8px 16px', borderRadius: '10px', fontWeight: '800', fontSize: '0.9rem' }}>
              {t('payroll.total_row')} {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(totalEstimated)}
            </span>
            <button onClick={exportMonthlySummaryToExcel} style={{
              padding: '8px 14px', borderRadius: '8px', border: '1.5px solid #16a34a',
              color: '#16a34a', background: '#f0fdf4', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '700',
              display: 'flex', alignItems: 'center', gap: '5px',
            }}>
              <i className="fas fa-file-excel"></i> {t('payroll.export_excel')}
            </button>
          </div>
        </div>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>{t('payroll.col_employee')}</th>
                <th>{t('payroll.col_type')}</th>
                <th>{t('payroll.col_work_days')}</th>
                <th>{t('payroll.col_total_hours')}</th>
                <th>{t('payroll.col_ot')}</th>
                <th>{t('payroll.col_bonus')}</th>
                <th>{t('payroll.col_penalty')}</th>
                <th>{t('payroll.col_estimated')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {monthlySummaryData.map(row => (
                <tr
                  key={row.name}
                  onClick={() => setReportEmployee(row.name)}
                  style={{ cursor: 'pointer', background: reportEmployee === row.name ? '#eff6ff' : 'white' }}
                >
                  <td style={{ fontWeight: '600' }}>{row.name}</td>
                  <td>
                    <span className={`badge ${row.type === 'fulltime' ? 'badge-ft' : 'badge-pt'}`}>
                      {row.type === 'fulltime' ? 'FT' : 'PT'}
                    </span>
                  </td>
                  <td>{row.workDays > 0 ? `${row.workDays}` : <span style={{ color: '#94a3b8' }}>—</span>}</td>
                  <td>{row.totalWorkHours > 0 ? `${row.totalWorkHours.toFixed(1)}h` : <span style={{ color: '#94a3b8' }}>—</span>}</td>
                  <td style={{ color: row.totalOtHours > 0 ? '#f97316' : 'inherit', fontWeight: row.totalOtHours > 0 ? '700' : '400' }}>
                    {row.totalOtHours > 0 ? `${row.totalOtHours.toFixed(1)}h` : '—'}
                  </td>
                  <td style={{ color: '#16a34a', fontWeight: row.bonuses > 0 ? '700' : '400' }}>
                    {row.bonuses > 0 ? `+${new Intl.NumberFormat('vi-VN').format(row.bonuses)}` : '—'}
                  </td>
                  <td style={{ color: '#dc2626', fontWeight: row.penalties > 0 ? '700' : '400' }}>
                    {row.penalties > 0 ? `-${new Intl.NumberFormat('vi-VN').format(row.penalties)}` : '—'}
                  </td>
                  <td style={{ fontWeight: '800', color: 'var(--primary)' }}>
                    {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(row.estimated)}
                  </td>
                  <td>
                    <button style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--primary)', background: 'white', color: 'var(--primary)', fontSize: '0.78rem', fontWeight: '700', cursor: 'pointer' }}
                      onClick={(e) => { e.stopPropagation(); setReportEmployee(row.name); }}>
                      {t('payroll.view_btn')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ─── RENDER ───────────────────────────────────────────────────────────────
  const renderPayslip = () => {
    if (!reportEmployee) return (
      <div className="card" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
        <i className="fas fa-file-invoice-dollar" style={{ fontSize: '3rem', marginBottom: '12px', display: 'block', color: '#cbd5e1' }}></i>
        {t('payroll.select_hint')}
      </div>
    );
    if (!calcData) return (
      <div className="card"><p style={{ color: 'var(--text-muted)' }}>{t('payroll.no_profile')}</p></div>
    );

    const {
      empProfile, isFT, sortedRecords,
      totalWorkHours, totalLateHours, totalOtHours, standardWorkDays, standardHoursPerDay,
      actualWorkDays, derivedHourlyRate, workScheduleMode,
      currentPenaltyList, currentBonusList,
      baseGross, otBonusMoney, holidayExtraMoney, nightAllowanceMoney, totalNightHours,
      totalEarnings, totalDeductions, finalSalary,
    } = calcData;

    const status = currentPayrollDoc?.status || 'draft';
    const statusInfo = PAYROLL_STATUS_MAP[status] || PAYROLL_STATUS_MAP.draft;
    const isLocked = status === 'finalized' || status === 'revised' || status === 'paid';
    const mm = reportMonth.split('-')[1];
    const yy = reportMonth.split('-')[0];

    const exportPayslipToExcel = () => {
      const summaryData = [
        [t('payroll.payslip_month'), `${mm}/${yy}`],
        [t('payroll.col_employee'), reportEmployee],
        [t('payroll.col_type'), isFT ? 'Full-time' : 'Part-time'],
        ['Status', statusInfo.label],
        [],
        ['Item', 'Amount (VND)'],
        [isFT ? t('payroll.monthly_wage') : t('payroll.hourly_wage'), empProfile.salary || empProfile.hourlyRate || 0],
        ...(isFT ? [[t('payroll.derived_hourly_rate'), derivedHourlyRate]] : []),
        [t('payroll.total_hours_label'), totalWorkHours],
        [t('payroll.base_salary_label'), baseGross],
        ...(otBonusMoney > 0 ? [[t('payroll.overtime_premium_label'), otBonusMoney]] : []),
        ...(holidayExtraMoney > 0 ? [[t('payroll.holiday_allowance'), holidayExtraMoney]] : []),
        ...(nightAllowanceMoney > 0 ? [[t('payroll.night_allowance'), nightAllowanceMoney]] : []),
        [t('payroll.col_bonus'), calcData.totalBonusMoney],
        [t('payroll.col_penalty'), -calcData.totalPenaltyMoney],
        [],
        [t('payroll.net_pay_label'), finalSalary],
      ];

      const detailData = [
        [t('payroll.col_date'), t('payroll.col_status_short'), t('payroll.col_rate_short'), t('payroll.col_checkin'), t('payroll.col_checkout'), t('payroll.col_hours_short'), t('payroll.col_ot_short'), t('payroll.col_late_short')],
        ...sortedRecords.map(r => [
          r.date,
          r.status === 'off' ? t('payroll.status_off_tag') : t('payroll.status_work_tag'),
          r.dayRate || 1,
          r.checkIn || '',
          r.checkOut || '',
          r.workHours ? Number(r.workHours).toFixed(2) : 0,
          r.otHours || 0,
          r.lateHours ? Number(r.lateHours).toFixed(2) : 0,
        ]),
      ];

      downloadCsv([
        [t('payroll.payslip_month')],
        ...summaryData,
        [],
        [t('payroll.daily_details')],
        ...detailData,
      ], `payslip-${reportEmployee.replace(/\s+/g, '-')}-${reportMonth}.csv`);
    };

    const earningPct   = totalEarnings > 0 ? (totalEarnings / (totalEarnings + totalDeductions)) * 100 : 100;
    const deductionPct = 100 - earningPct;

    return (
      <div className="payslip-dashboard">
        {/* Summary cards */}
        <div className="summary-cards">
          <div className="summary-card sc-earnings">
            <span className="label"><i className="fas fa-arrow-up"></i> {t('payroll.earnings_label')}</span>
            <span className="value">{formatMoney(totalEarnings)}</span>
          </div>
          <div className="summary-card sc-deductions">
            <span className="label"><i className="fas fa-arrow-down"></i> {t('payroll.deductions_label')}</span>
            <span className="value">{formatMoney(totalDeductions)}</span>
          </div>
          <div className="summary-card sc-net">
            <span className="label"><i className="fas fa-wallet"></i> {t('payroll.net_pay_label')}</span>
            <span className="value">{formatMoney(finalSalary)}</span>
          </div>
        </div>

        {totalEarnings > 0 && (
          <div className="salary-visual-bar">
            <div className="bar-earnings" style={{ width: `${earningPct}%` }}></div>
            {totalDeductions > 0 && <div className="bar-deductions" style={{ width: `${deductionPct}%` }}></div>}
          </div>
        )}

        <div className="payslip-layout">
          {/* ─── OFFICIAL PAYSLIP ─── */}
          <div className="payslip-official">
            {/* Header row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px', marginBottom: '16px' }}>
              <div>
                <h2 style={{ margin: '0 0 6px 0', color: 'var(--primary)' }}>
                  {t('payroll.payslip_month')} {mm}/{yy}
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '1.1rem', fontWeight: '700' }}>{reportEmployee}</span>
                  <span className={`badge ${isFT ? 'badge-ft' : 'badge-pt'}`}>{isFT ? 'Full-time' : 'Part-time'}</span>
                  <span style={{
                    background: statusInfo.bg, color: statusInfo.color,
                    padding: '3px 12px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: '700',
                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                  }}>
                    <i className={statusInfo.icon}></i> {statusInfo.label}
                    {currentPayrollDoc?.version > 1 && ` v${currentPayrollDoc.version}`}
                  </span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="no-print" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button onClick={() => window.print()} style={{
                  padding: '8px 14px', borderRadius: '8px', border: '1.5px solid var(--primary)',
                  color: 'var(--primary)', background: 'white', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600',
                }}>
                  <i className="fas fa-print"></i> {t('payroll.print_btn')}
                </button>
                <button onClick={exportPayslipToExcel} style={{
                  padding: '8px 14px', borderRadius: '8px', border: '1.5px solid #16a34a',
                  color: '#16a34a', background: 'white', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600',
                  display: 'flex', alignItems: 'center', gap: '5px',
                }}>
                  <i className="fas fa-file-csv"></i> CSV
                </button>

                {status === 'draft' && (
                  <button
                    onClick={() => showConfirm(`${t('payroll.finalize_btn')} ${reportMonth} — ${reportEmployee}?`, handleFinalizePayroll)}
                    disabled={isFinalizingSave}
                    style={{
                      padding: '8px 16px', borderRadius: '8px', border: 'none',
                      background: '#1d4ed8', color: 'white', cursor: 'pointer', fontWeight: '700', fontSize: '0.85rem',
                    }}
                  >
                    <i className="fas fa-lock"></i> {isFinalizingSave ? t('payroll.finalizing') : t('payroll.finalize_btn')}
                  </button>
                )}

                {(status === 'finalized' || status === 'revised') && (
                  <>
                    <button
                      onClick={() => showConfirm(t('payroll.confirm_mark_paid'), handleMarkPaid)}
                      style={{
                        padding: '8px 16px', borderRadius: '8px', border: 'none',
                        background: '#16a34a', color: 'white', cursor: 'pointer', fontWeight: '700', fontSize: '0.85rem',
                      }}
                    >
                      <i className="fas fa-check-circle"></i> {t('payroll.mark_paid_btn')}
                    </button>
                    <button
                      onClick={() => { setReviseReason(''); setShowReviseModal(true); }}
                      style={{
                        padding: '8px 14px', borderRadius: '8px', border: '1.5px solid #d97706',
                        color: '#d97706', background: 'white', cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem',
                      }}
                    >
                      <i className="fas fa-redo"></i> {t('payroll.revise_btn')}
                    </button>
                  </>
                )}

                {status === 'paid' && (
                  <span style={{ color: '#166534', fontSize: '0.85rem', fontWeight: '600' }}>
                    <i className="fas fa-check-circle"></i> {t('payroll.completed_label')}
                  </span>
                )}
              </div>
            </div>

            {/* Revision reason note */}
            {currentPayrollDoc?.reviseReason && (
              <div style={{ background: '#fef3c7', borderLeft: '4px solid #d97706', padding: '10px 14px', borderRadius: '6px', marginBottom: '14px', fontSize: '0.85rem' }}>
                <strong>{t('payroll.revise_reason_label')}</strong> {currentPayrollDoc.reviseReason}
              </div>
            )}

            {/* Locked warning */}
            {isLocked && (
              <div style={{ background: '#dbeafe', borderLeft: '4px solid #1d4ed8', padding: '10px 14px', borderRadius: '6px', marginBottom: '14px', fontSize: '0.85rem', color: '#1d4ed8' }}>
                <i className="fas fa-lock"></i> {t('payroll.locked_notice')}
              </div>
            )}

            {/* Base salary section */}
            <div className="breakdown-title"><i className="fas fa-file-invoice"></i> {t('payroll.fixed_salary')}</div>
            <div className="payslip-row">
              <span className="payslip-label">{isFT ? t('payroll.monthly_wage') : t('payroll.hourly_wage')}:</span>
              <span className="payslip-value">{formatMoney(empProfile.salary || empProfile.hourlyRate || 0)}</span>
            </div>
            {isFT ? (
              <>
                <div className="payslip-row"><span className="payslip-label">{t('payroll.standard_days_label')}</span><span className="payslip-value">{standardWorkDays}</span></div>
                <div className="payslip-row"><span className="payslip-label">{t('payroll.standard_hours_per_day_label')}</span><span className="payslip-value">{standardHoursPerDay}h</span></div>
                <div className="payslip-row">
                  <span className="payslip-label">{t('payroll.schedule_mode_label')}</span>
                  <span className="payslip-value">
                    {workScheduleMode === 'rotating' ? t('payroll.schedule_mode_rotating') : t('payroll.schedule_mode_fixed')}
                  </span>
                </div>
                <div className="payslip-row">
                  <span className="payslip-label">{t('payroll.actual_days_label')}</span>
                  <span className="payslip-value" style={{ color: actualWorkDays === 0 ? '#dc2626' : 'inherit', fontWeight: '700' }}>
                    {actualWorkDays}
                  </span>
                </div>
                <div className="payslip-row"><span className="payslip-label">{t('payroll.derived_hourly_rate')}</span><span className="payslip-value">{formatMoney(derivedHourlyRate)}</span></div>
              </>
            ) : null}
            <div className="payslip-row"><span className="payslip-label">{t('payroll.total_hours_label')}</span><span className="payslip-value">{totalWorkHours.toFixed(2)}h</span></div>
            <div style={{ margin: '8px 0', padding: '9px 12px', borderRadius: '8px', background: '#eff6ff', color: '#1d4ed8', fontSize: '0.82rem' }}>
              <i className="fas fa-calculator" style={{ marginRight: '6px' }}></i>
              {isFT
                ? (workScheduleMode === 'rotating' ? t('payroll.ft_rotating_formula_note', { hours: standardHoursPerDay }) : t('payroll.ft_formula_note'))
                : t('payroll.pt_formula_note')}
            </div>
            <div className="payslip-row" style={{ borderTop: '1px solid #f1f5f9', paddingTop: '10px' }}>
              <span className="payslip-label">{t('payroll.base_salary_label')}</span>
              <span className="payslip-value">{formatMoney(baseGross)}</span>
            </div>

            {/* Adjustments */}
            <div className="breakdown-section">
              <div className="breakdown-title"><i className="fas fa-sliders-h"></i> {t('payroll.adjustments_section')}</div>

              {otBonusMoney > 0 && (
                  <div className="payslip-row">
                    <span className="payslip-label">{t('payroll.overtime_premium_label')} <span style={{ fontSize: '0.82rem' }}>({totalOtHours}h)</span></span>
                    <span className="payslip-value payslip-positive">+ {formatMoney(otBonusMoney)}</span>
                  </div>
              )}
              {holidayExtraMoney > 0 && (
                  <div className="payslip-row">
                    <span className="payslip-label" style={{ color: '#be185d' }}>
                      <i className="fas fa-star" style={{ marginRight: '4px' }}></i>
                      {t('payroll.holiday_allowance')}
                    </span>
                    <span className="payslip-value payslip-positive">+ {formatMoney(holidayExtraMoney)}</span>
                  </div>
              )}
              {nightAllowanceMoney > 0 && (
                  <div className="payslip-row">
                    <span className="payslip-label">
                      <i className="fas fa-moon" style={{ marginRight: '4px' }}></i>
                      {t('payroll.night_allowance')} <span style={{ fontSize: '0.82rem' }}>({totalNightHours}h)</span>
                    </span>
                    <span className="payslip-value payslip-positive">+ {formatMoney(nightAllowanceMoney)}</span>
                  </div>
              )}

              {calcData.currentBonusList.map(b => (
                <div className="payslip-row" key={`b-${b.id}`}>
                  <span className="payslip-label">{t('payroll.bonus_label')} {b.reason || 'N/A'}</span>
                  <span className="payslip-value payslip-positive">+ {formatMoney(b.amount)}</span>
                </div>
              ))}

              {calcData.currentPenaltyList.map(p => (
                <div className="payslip-row" key={`p-${p.id}`}>
                  <span className="payslip-label">{t('payroll.penalty_label')} {p.reason || 'N/A'}</span>
                  <span className="payslip-value payslip-negative">- {formatMoney(p.amount)}</span>
                </div>
              ))}
            </div>

            {/* Net pay */}
            <div className="net-pay-highlight" style={{ marginTop: '20px' }}>
              <span className="net-pay-label"><i className="fas fa-hand-holding-usd"></i> {t('payroll.net_pay_label')}</span>
              <span className="net-pay-value">{formatMoney(finalSalary)}</span>
            </div>

            {/* Print signatures */}
            <div className="print-signatures" style={{ marginBottom: '40px' }}>
              <div style={{ textAlign: 'center', flex: 1 }}>
                <p style={{ fontWeight: 'bold', margin: '0 0 5px 0' }}>{t('payroll.receiver')}</p>
                <p style={{ fontStyle: 'italic', fontSize: '0.9rem', margin: 0 }}>{t('payroll.sign_name')}</p>
                <div style={{ height: '80px' }}></div>
              </div>
              <div style={{ textAlign: 'center', flex: 1 }}>
                <p style={{ fontStyle: 'italic', fontSize: '0.9rem', margin: '0 0 5px 0' }}>{t('payroll.date_signature')}</p>
                <p style={{ fontWeight: 'bold', margin: '0 0 5px 0' }}>{t('payroll.manager')}</p>
                <p style={{ fontStyle: 'italic', fontSize: '0.9rem', margin: 0 }}>{t('payroll.sign_stamp')}</p>
                <div style={{ height: '80px' }}></div>
              </div>
            </div>

            {/* Daily detail table */}
            <div style={{ borderTop: '2px dashed var(--border)', paddingTop: '20px' }}>
              <h3 style={{ fontSize: '1.1rem', marginBottom: '12px', textAlign: 'center' }}>
                <i className="fas fa-calendar-alt"></i> {t('payroll.daily_details')}
              </h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-body)', borderBottom: '2px solid var(--border)' }}>
                    <th style={{ padding: '8px', textAlign: 'left' }}>{t('payroll.col_date')}</th>
                    <th style={{ padding: '8px', textAlign: 'center' }}>{t('payroll.col_status_short')}</th>
                    <th style={{ padding: '8px', textAlign: 'center' }}>{t('payroll.col_rate_short')}</th>
                    <th style={{ padding: '8px', textAlign: 'center' }}>{t('payroll.col_time')}</th>
                    <th style={{ padding: '8px', textAlign: 'center' }}>{t('payroll.col_hours_short')}</th>
                    <th style={{ padding: '8px', textAlign: 'center' }}>{t('payroll.col_ot_short')}</th>
                    <th style={{ padding: '8px', textAlign: 'center' }}>{t('payroll.col_late_short')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRecords.length > 0 ? sortedRecords.map((r, i) => {
                    const rate = r.dayRate || 1;
                    return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: rate > 1 ? '#fdf2f8' : 'white' }}>
                      <td style={{ padding: '8px', fontWeight: '500' }}>{new Date(r.date + 'T00:00:00').toLocaleDateString('vi-VN')}</td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>
                        {r.status === 'off'
                          ? <span style={{ color: 'var(--danger)', fontWeight: 'bold' }}>{t('payroll.status_off_tag')}</span>
                          : <span style={{ color: 'var(--success)' }}>{t('payroll.status_work_tag')}</span>}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>
                        {rate > 1
                          ? <span style={{ background: '#fce7f3', color: '#be185d', padding: '2px 8px', borderRadius: '6px', fontWeight: '800' }}>×{rate}</span>
                          : <span style={{ color: 'var(--text-muted)' }}>×1</span>}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>
                        {r.status === 'off' ? '—' : `${r.checkIn || '--:--'} - ${r.checkOut || '--:--'}`}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center', fontWeight: '600' }}>
                        {r.status === 'off' ? '—' : `${(r.workHours || 0).toFixed(2)}h`}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center', color: r.otHours > 0 ? 'var(--warning)' : 'inherit' }}>
                        {r.otHours > 0 ? `${Number(r.otHours).toFixed(2)}h` : '—'}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center', color: r.lateHours > 0 ? 'var(--danger)' : 'inherit' }}>
                        {r.lateHours > 0 ? `${Number(r.lateHours).toFixed(2)}h` : '—'}
                      </td>
                    </tr>
                  )}) : (
                    <tr><td colSpan="7" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>{t('payroll.no_data')}</td></tr>
                  )}
                  {sortedRecords.length > 0 && (
                    <tr style={{ backgroundColor: 'var(--bg-body)', borderTop: '2px solid var(--border)', fontWeight: '700' }}>
                      <td colSpan="4" style={{ padding: '10px 8px', textAlign: 'right' }}>{t('payroll.total_row')}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'center', color: 'var(--primary)' }}>{totalWorkHours.toFixed(2)}h</td>
                      <td style={{ padding: '10px 8px', textAlign: 'center', color: totalOtHours > 0 ? 'var(--warning)' : 'inherit' }}>
                        {totalOtHours > 0 ? `${totalOtHours.toFixed(2)}h` : '—'}
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'center', color: totalLateHours > 0 ? 'var(--danger)' : 'inherit' }}>
                        {totalLateHours > 0 ? `${totalLateHours.toFixed(2)}h` : '—'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ─── ACTION WIDGETS (no-print) ─── */}
          <div className="payslip-actions no-print">
            {isLocked && (
              <div style={{ background: '#fef3c7', borderRadius: '10px', padding: '14px 16px', marginBottom: '12px', fontSize: '0.88rem', color: '#92400e' }}>
                <i className="fas fa-lock"></i> {t('payroll.locked_widget_notice')}
              </div>
            )}

            {/* BONUS WIDGET */}
            <div className="payroll-sub-widget widget-bonus" style={{ background: 'white', opacity: isLocked ? 0.65 : 1, pointerEvents: isLocked ? 'none' : 'auto' }}>
              <h3 style={{ margin: '0 0 15px 0' }}><i className="fas fa-gift"></i> {t('payroll.bonus_widget')}</h3>
              <div className="form-group">
                <label>{t('payroll.amount_vnd')}</label>
                <input type="text" placeholder="0 ₫"
                  value={bonusInput ? new Intl.NumberFormat('vi-VN').format(bonusInput) : ''}
                  onChange={(e) => setBonusInput(e.target.value.replace(/\D/g, ''))} />
              </div>
              <div className="form-group">
                <label>{t('payroll.reason_label_input')}</label>
                <input type="text" placeholder={t('payroll.bonus_reason_ph')} value={bonusReasonInput} onChange={(e) => setBonusReasonInput(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button className="btn-primary" style={{ flex: 1, backgroundColor: '#16a34a' }} onClick={handleSaveBonus} disabled={isSavingBonus}>
                  {isSavingBonus ? '...' : (editingBonusId ? t('common.update') : t('payroll.add_bonus_btn'))}
                </button>
                {editingBonusId && <button className="btn-secondary" onClick={() => { setEditingBonusId(null); setBonusInput(''); setBonusReasonInput(''); }}>{t('common.cancel')}</button>}
              </div>
              {currentBonusList.length > 0 && (
                <div style={{ marginTop: '16px', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                  {currentBonusList.map(b => (
                    <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>{b.reason}</div>
                        <div style={{ fontWeight: '700', color: '#16a34a' }}>+{formatMoney(b.amount)}</div>
                      </div>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button className="btn-warning" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => { setBonusInput(String(b.amount)); setBonusReasonInput(b.reason || ''); setEditingBonusId(b.id); }}>{t('common.edit')}</button>
                        <button className="btn-danger" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => requestDeleteBonus(b.id)}>{t('common.delete')}</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* PENALTY WIDGET */}
            <div className="payroll-sub-widget widget-penalty" style={{ background: 'white', opacity: isLocked ? 0.65 : 1, pointerEvents: isLocked ? 'none' : 'auto' }}>
              <h3 style={{ margin: '0 0 15px 0' }}><i className="fas fa-exclamation-circle"></i> {t('payroll.penalty_widget')}</h3>
              <div className="form-group">
                <label>{t('payroll.amount_vnd')}</label>
                <input type="text" placeholder="0 ₫"
                  value={penaltyInput ? new Intl.NumberFormat('vi-VN').format(penaltyInput) : ''}
                  onChange={(e) => setPenaltyInput(e.target.value.replace(/\D/g, ''))} />
              </div>
              <div className="form-group">
                <label>{t('payroll.reason_label_input')}</label>
                <input type="text" placeholder={t('payroll.penalty_reason_ph')} value={reasonInput} onChange={(e) => setReasonInput(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button className="btn-danger" style={{ flex: 1 }} onClick={handleSavePenalty} disabled={isSavingPenalty}>
                  {isSavingPenalty ? '...' : (editingPenaltyId ? t('common.update') : t('payroll.add_penalty_btn'))}
                </button>
                {editingPenaltyId && <button className="btn-secondary" onClick={() => { setEditingPenaltyId(null); setPenaltyInput(''); setReasonInput(''); }}>{t('common.cancel')}</button>}
              </div>
              {currentPenaltyList.length > 0 && (
                <div style={{ marginTop: '16px', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                  {currentPenaltyList.map(p => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>{p.reason}</div>
                        <div style={{ fontWeight: '700', color: '#dc2626' }}>-{formatMoney(p.amount)}</div>
                      </div>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button className="btn-warning" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => { setPenaltyInput(String(p.amount)); setReasonInput(p.reason || ''); setEditingPenaltyId(p.id); }}>{t('common.edit')}</button>
                        <button className="btn-danger" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => requestDeletePenalty(p.id)}>{t('common.delete')}</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Filter bar */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ margin: 0, minWidth: '160px' }}>
            <label>{t('payroll.month_filter')}</label>
            <input type="month" value={reportMonth} onChange={e => setReportMonth(e.target.value)} />
          </div>
          <div className="form-group" style={{ margin: 0, flex: 1, minWidth: '200px' }}>
            <label>{t('payroll.select_employee')}</label>
            <select value={reportEmployee} onChange={e => setReportEmployee(e.target.value)}>
              <option value="" disabled>{t('payroll.select_employee_default')}</option>
              {Object.keys(savedEmployees).map((name, i) => <option key={i} value={name}>{name}</option>)}
            </select>
          </div>
          {reportEmployee && calcData && (
            <div className="form-group" style={{ margin: 0, minWidth: '210px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {t('payroll.attendance_summary_label')}
                <span style={{ background: '#dcfce7', color: '#166534', fontSize: '0.7rem', padding: '1px 6px', borderRadius: '4px', fontWeight: '700' }}>{t('payroll.auto_badge')}</span>
              </label>
              <div style={{
                border: '1.5px solid #10b981',
                borderRadius: '8px', padding: '10px 12px', fontSize: '0.95rem',
                fontWeight: '700', background: '#f0fdf4', color: '#166534',
              }}>
                {automaticWorkDays} {t('payroll.days_unit')} · {calcData.totalWorkHours.toFixed(2)}h
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '3px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                {t('payroll.attendance_source_hint')}
              </span>
            </div>
          )}
        </div>
      </div>

      {renderMonthlySummary()}
      {renderPayslip()}

      {/* ─── REVISE MODAL ─── */}
      {showReviseModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', padding: '28px', borderRadius: '14px', width: '400px', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 8px 0' }}><i className="fas fa-redo"></i> {t('payroll.revise_modal_title')}</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '16px', fontSize: '0.9rem' }}>
              {t('payroll.revise_modal_desc')}
            </p>
            <textarea
              rows={3}
              placeholder={t('payroll.revise_reason_ph')}
              value={reviseReason}
              onChange={(e) => setReviseReason(e.target.value)}
              style={{
                width: '100%', padding: '10px', borderRadius: '8px',
                border: reviseReason.trim() ? '1.5px solid #10b981' : '1.5px solid #dc2626',
                resize: 'vertical', fontFamily: 'inherit', fontSize: '0.9rem',
                marginBottom: '16px', boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: '10px' }}>
              <button style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1.5px solid var(--border)', background: 'white', cursor: 'pointer' }}
                onClick={() => { setShowReviseModal(false); setReviseReason(''); }}>
                {t('common.cancel')}
              </button>
              <button style={{ flex: 1, padding: '10px', borderRadius: '8px', border: 'none', background: '#d97706', color: 'white', fontWeight: '700', cursor: 'pointer' }}
                onClick={handleRevise}>
                {t('payroll.revise_confirm_btn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── DELETE CONFIRM MODAL ─── */}
      {confirmDialog.isOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', padding: '24px', borderRadius: '12px', width: '320px', textAlign: 'center', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 10px 0' }}>{t('payroll.confirm_delete_title')}</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>{t('payroll.confirm_delete_msg')}</p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="btn-secondary" style={{ flex: 1, padding: '10px' }} onClick={() => setConfirmDialog({ isOpen: false, type: null, id: null })}>{t('common.cancel')}</button>
              <button className="btn-danger" style={{ flex: 1, padding: '10px' }} onClick={executeDelete}>{t('common.delete')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
