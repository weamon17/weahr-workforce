import React, { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';

const PAGE_SIZES = [10, 50];
const TYPE_META = {
  timesheet_create: { icon: 'fas fa-plus', tone: 'success' },
  timesheet_edit: { icon: 'fas fa-pen', tone: 'warning' },
  timesheet_delete: { icon: 'fas fa-trash', tone: 'danger' },
  timesheet_rename: { icon: 'fas fa-signature', tone: 'info' },
};

const displayValue = (field, value, t) => {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'status') return value === 'off' ? t('timesheet_extra.tag_off') : t('timesheet_extra.status_work');
  if (field === 'type') return value === 'fulltime' ? 'Full-time' : 'Part-time';
  if (['workHours', 'otHours', 'lateHours'].includes(field)) return `${Number(value).toFixed(2)}h`;
  if (field === 'dayRate') return `×${value}`;
  return String(value);
};

// Read-only history of manual attendance changes, written only by the backend.
export default function AuditLogPanel({ db, organizationId }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'vi' ? 'vi-VN' : 'en-US';
  const [entries, setEntries] = useState([]);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [error, setError] = useState('');

  useEffect(() => onSnapshot(
    query(
      collection(db, 'audit_logs'),
      where('organizationId', '==', organizationId),
      orderBy('at', 'desc'),
      limit(pageSize),
    ),
    snapshot => {
      setEntries(snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
      setError('');
    },
    failure => setError(failure.message),
  ), [db, organizationId, pageSize]);

  return (
    <section className="card audit-panel" aria-labelledby="audit-title">
      <div className="audit-head">
        <div>
          <h3 id="audit-title"><i className="fas fa-clock-rotate-left" aria-hidden="true"></i> {t('audit.title')}</h3>
          <p>{t('audit.subtitle')}</p>
        </div>
      </div>

      {error && <p className="audit-empty">{t('audit.load_failed')}</p>}
      {!error && entries.length === 0 && <p className="audit-empty">{t('audit.empty')}</p>}

      <ol className="audit-list">
        {entries.map(entry => {
          const meta = TYPE_META[entry.type] || TYPE_META.timesheet_edit;
          const when = entry.at?.toDate?.();
          return (
            <li key={entry.id} className={`audit-item tone-${meta.tone}`}>
              <span className="audit-icon"><i className={meta.icon} aria-hidden="true"></i></span>
              <div className="audit-body">
                <p className="audit-summary">
                  {t(`audit.summary_${entry.type}`, {
                    actor: entry.actorName || t('audit.unknown_actor'),
                    employee: entry.employeeName || '—',
                    date: entry.date || '',
                    defaultValue: entry.type,
                  })}
                </p>
                {entry.reason && entry.type !== 'timesheet_rename' && <p className="audit-reason">“{entry.reason}”</p>}
                {entry.changes?.length > 0 && (
                  <ul className="audit-changes">
                    {entry.changes.map(change => (
                      <li key={change.field}>
                        <span>{t(`audit.field_${change.field}`, { defaultValue: change.field })}</span>
                        <s>{displayValue(change.field, change.before, t)}</s>
                        <i className="fas fa-arrow-right" aria-hidden="true"></i>
                        <b>{displayValue(change.field, change.after, t)}</b>
                      </li>
                    ))}
                  </ul>
                )}
                <time dateTime={when?.toISOString()}>{when ? when.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : t('audit.just_now')}</time>
              </div>
            </li>
          );
        })}
      </ol>

      {entries.length >= pageSize && pageSize < PAGE_SIZES[PAGE_SIZES.length - 1] && (
        <button type="button" className="btn-secondary" onClick={() => setPageSize(PAGE_SIZES[PAGE_SIZES.length - 1])}>
          {t('audit.show_more')}
        </button>
      )}
    </section>
  );
}
