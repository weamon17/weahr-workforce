import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { calculateLaborProfitability, forecastHourlyDemand, normalizeSalesRecord } from '../../utils/demandForecast';
import { localMonthString } from '../../utils/time';

const safeId = value => value.replace(/[^a-zA-Z0-9_-]/g, '_');
const money = value => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(value || 0);

const parseCsv = text => {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some(value => value !== '')) rows.push(row);
      row = []; cell = '';
    } else cell += character;
  }
  row.push(cell);
  if (row.some(value => value !== '')) rows.push(row);
  const headers = rows.shift() || [];
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [String(header).trim(), values[index] ?? ''])));
};

const scheduledPeopleAt = (schedules, date, hour) => schedules.filter(item => {
  if (item.workDate !== date || item.status !== 'approved') return false;
  const start = Number(String(item.startTime || '0').split(':')[0]);
  const end = Number(String(item.endTime || '0').split(':')[0]);
  return end > start ? hour >= start && hour < end : hour >= start || hour < end;
}).length;

export default function BusinessInsightsTab({ db, organizationId, records, savedEmployees, schedules, showToast, demoMode = false, demoSalesRecords = [], ensureMonthLoaded }) {
  const { t } = useTranslation();
  const [salesRecords, setSalesRecords] = useState(demoMode ? demoSalesRecords : []);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [ordersPerEmployeeHour, setOrdersPerEmployeeHour] = useState(15);
  const [periodMonth, setPeriodMonth] = useState(localMonthString);
  useEffect(() => { ensureMonthLoaded?.(periodMonth); }, [ensureMonthLoaded, periodMonth]);

  useEffect(() => {
    if (demoMode) {
      setSalesRecords(demoSalesRecords);
      setLoading(false);
      return;
    }
    setLoading(true);
    getDocs(query(collection(db, 'sales_records'), where('organizationId', '==', organizationId)))
      .then(snapshot => setSalesRecords(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))))
      .catch(error => showToast(t('insights.sales_load_failed', { error: error.message }), 'error'))
      .finally(() => setLoading(false));
  }, [db, organizationId, showToast, demoMode, demoSalesRecords, t]);

  const periodSales = useMemo(() => salesRecords.filter(item => item.date?.startsWith(periodMonth)), [periodMonth, salesRecords]);
  const periodTimesheets = useMemo(() => records.filter(item => item.date?.startsWith(periodMonth)), [periodMonth, records]);
  const metrics = useMemo(() => calculateLaborProfitability({
    salesRecords: periodSales,
    timesheets: periodTimesheets,
    employees: savedEmployees,
  }), [periodSales, periodTimesheets, savedEmployees]);

  const forecasts = useMemo(() => forecastHourlyDemand(salesRecords, {
    days: 7,
    ordersPerEmployeeHour,
  }), [ordersPerEmployeeHour, salesRecords]);

  const staffingGap = useMemo(() => forecasts.reduce((summary, item) => {
    const gap = scheduledPeopleAt(schedules, item.date, item.hour) - item.staffRequired;
    if (gap < 0) summary.shortage += Math.abs(gap);
    if (gap > 0) summary.surplus += gap;
    return summary;
  }, { shortage: 0, surplus: 0 }), [forecasts, schedules]);

  const branchSummary = useMemo(() => Object.values(periodSales.reduce((groups, item) => {
    const key = item.branchId || 'default';
    groups[key] ||= { branchId: key, revenue: 0, orders: 0 };
    groups[key].revenue += Number(item.revenue) || 0;
    groups[key].orders += Number(item.orders) || 0;
    return groups;
  }, {})).sort((left, right) => right.revenue - left.revenue), [periodSales]);

  const importSales = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (demoMode) return showToast(t('insights.demo_no_import'), 'warning');
    setImporting(true);
    try {
      let rows;
      if (file.name.toLowerCase().endsWith('.csv')) {
        rows = parseCsv(await file.text());
      } else {
        const { default: readXlsxFile } = await import('read-excel-file/browser');
        const matrix = await readXlsxFile(file);
        const headers = (matrix.shift() || []).map(value => String(value || '').trim());
        rows = matrix.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
      }
      const normalized = rows.map(normalizeSalesRecord).filter(Boolean);
      if (!normalized.length) throw new Error(t('insights.no_valid_rows'));
      for (let offset = 0; offset < normalized.length; offset += 400) {
        const batch = writeBatch(db);
        normalized.slice(offset, offset + 400).forEach(item => {
          const id = safeId(`${organizationId}_${item.branchId}_${item.date}_${item.hour}`);
          batch.set(doc(db, 'sales_records', id), {
            ...item,
            organizationId,
            sourceFile: file.name,
            importedAt: serverTimestamp(),
          }, { merge: true });
        });
        await batch.commit();
      }
      const snapshot = await getDocs(query(collection(db, 'sales_records'), where('organizationId', '==', organizationId)));
      setSalesRecords(snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
      showToast(t('insights.imported', { count: normalized.length }), 'success');
    } catch (error) {
      showToast(t('insights.import_failed', { error: error.message }), 'error');
    } finally {
      setImporting(false);
    }
  };

  const kpis = [
    [t('insights.kpi_cost_ratio'), `${metrics.laborCostRatio}%`, '#4f46e5'],
    [t('insights.kpi_revenue_per_hour'), money(metrics.revenuePerLaborHour), '#0ea5e9'],
    [t('insights.kpi_avoidable_ot'), money(metrics.estimatedAvoidableOvertime), '#f97316'],
    [t('insights.kpi_gap'), `${staffingGap.shortage} / ${staffingGap.surplus}`, '#dc2626'],
    [t('insights.kpi_labor_cost'), money(metrics.laborCost), '#7c3aed'],
    [t('insights.kpi_savings'), money(metrics.estimatedAvoidableOvertime), '#059669'],
  ];

  if (loading) return <div className="card">{t('insights.loading')}</div>;
  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 20px' }}>
      <section className="card" style={{ padding: '22px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '14px', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0 }}>{t('insights.title')}</h2>
            <p style={{ color: 'var(--text-muted)', margin: '6px 0 0' }}>{t('insights.subtitle')}</p>
          </div>
          <div style={{ display: 'flex', gap: '9px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="month" value={periodMonth} onChange={event => setPeriodMonth(event.target.value)} aria-label={t('insights.aria_month')} style={{ padding: '9px', border: '1px solid #cbd5e1', borderRadius: '8px' }} />
            <label className="btn-primary" style={{ cursor: importing ? 'wait' : 'pointer' }}>
              {importing ? t('insights.importing') : t('insights.import')}
              <input type="file" accept=".xlsx,.csv" onChange={importSales} disabled={importing} hidden />
            </label>
          </div>
        </div>
        <p style={{ fontSize: '.85rem', color: '#64748b' }}>{t('insights.columns_help')}</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px', marginTop: '18px' }}>
          {kpis.map(([label, value, color]) => <div key={label} style={{ padding: '16px', borderRadius: '13px', background: '#f8fafc', borderTop: `3px solid ${color}` }}><small style={{ color: '#64748b' }}>{label}</small><div style={{ fontSize: '1.25rem', fontWeight: 800, color, marginTop: '5px' }}>{value}</div></div>)}
        </div>
      </section>

      <section className="card" style={{ padding: '22px', marginTop: '18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div><h3 style={{ margin: 0 }}>{t('insights.forecast_title')}</h3><p style={{ margin: '5px 0 0', color: '#64748b' }}>{t('insights.history_slots', { count: salesRecords.length })}</p></div>
          <label>{t('insights.target_productivity')} <input type="number" min="1" value={ordersPerEmployeeHour} onChange={event => setOrdersPerEmployeeHour(Math.max(1, Number(event.target.value)))} style={{ width: '75px', padding: '7px', marginLeft: '6px' }} /> {t('insights.orders_per_person_hour')}</label>
        </div>
        {salesRecords.length === 0 ? <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>{t('insights.need_history')}</div> : (
          <div className="table-responsive" style={{ marginTop: '14px', maxHeight: '520px', overflow: 'auto' }}>
            <table><thead><tr><th>{t('insights.col_slot')}</th><th>{t('insights.col_orders')}</th><th>{t('insights.col_staff')}</th><th>{t('insights.col_scheduled')}</th><th>{t('insights.col_confidence')}</th><th>{t('insights.col_reason')}</th></tr></thead><tbody>
              {forecasts.map(item => {
                const scheduled = scheduledPeopleAt(schedules, item.date, item.hour);
                return <tr key={`${item.date}_${item.hour}`}><td>{item.date} · {String(item.hour).padStart(2, '0')}:00</td><td><b>{item.predictedOrders}</b></td><td>{item.staffRequired}</td><td style={{ color: scheduled < item.staffRequired ? '#dc2626' : '#059669', fontWeight: 700 }}>{scheduled}</td><td>{t(`insights.confidence_${item.confidenceLevel}`)} ({Math.round(item.confidenceScore * 100)}%)</td><td style={{ minWidth: '280px', fontSize: '.85rem' }}>{t('insights.explanation', { count: item.sampleCount, average: item.averageOrders })}{item.trendPercent ? t(item.trendPercent > 0 ? 'insights.trend_up' : 'insights.trend_down', { percent: Math.abs(item.trendPercent) }) : ''}.</td></tr>;
              })}
            </tbody></table>
          </div>
        )}
      </section>

      {branchSummary.length > 0 && <section className="card" style={{ padding: '22px', marginTop: '18px' }}><h3>{t('insights.branch_title')}</h3><div className="table-responsive"><table><thead><tr><th>{t('insights.col_branch')}</th><th>{t('insights.col_revenue')}</th><th>{t('insights.col_order_count')}</th><th>{t('insights.col_avg_order')}</th></tr></thead><tbody>{branchSummary.map(item => <tr key={item.branchId}><td>{item.branchId}</td><td>{money(item.revenue)}</td><td>{item.orders}</td><td>{money(item.orders ? item.revenue / item.orders : 0)}</td></tr>)}</tbody></table></div></section>}
    </div>
  );
}
