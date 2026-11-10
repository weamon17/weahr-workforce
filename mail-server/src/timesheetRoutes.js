import express from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import {
  TimesheetInputError,
  describeChanges,
  normalizeManualRecord,
  normalizeReason,
  pickEditable,
} from './timesheetLogic.js';

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const bearerToken = request => String(request.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';
const RENAME_BATCH_SIZE = 400;

const route = handler => async (request, response) => {
  try {
    response.json({ ok: true, ...(await handler(request)) });
  } catch (error) {
    if (error instanceof TimesheetInputError) {
      return response.status(400).json({ ok: false, error: { code: error.code, message: error.message } });
    }
    const known = error instanceof ApiError;
    if (!known) console.error('timesheet route failed', { code: error?.code, message: error?.message });
    return response.status(known ? error.status : 500).json({
      ok: false,
      error: {
        code: known ? error.code : 'timesheet-api-error',
        message: known ? error.message : 'Không lưu được chấm công. Vui lòng thử lại.',
      },
    });
  }
};

// Manual attendance changes go through here so every create, edit and delete
// is written together with its audit entry, and nobody can skip the log.
export const createTimesheetRouter = ({ auth, firestore }) => {
  const router = express.Router();
  const timesheets = () => firestore.collection('timesheets');
  const auditLogs = () => firestore.collection('audit_logs');

  const requireManager = async request => {
    const token = bearerToken(request);
    if (!token) throw new ApiError(401, 'unauthenticated', 'Thiếu Firebase ID token.');
    let decoded;
    try {
      decoded = await auth.verifyIdToken(token, true);
    } catch {
      throw new ApiError(401, 'unauthenticated', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
    }
    const snapshot = await firestore.collection('users').doc(decoded.uid).get();
    const user = snapshot.data();
    if (!snapshot.exists || user?.status !== 'active' || user.role !== 'manager' || !user.organizationId) {
      throw new ApiError(403, 'manager-required', 'Chỉ quản lý được sửa chấm công.');
    }
    return { uid: decoded.uid, ...user };
  };

  // A linked account must belong to the manager's shop.
  const assertEmployeeInOrganization = async (employeeId, organizationId) => {
    if (!employeeId) return;
    const snapshot = await firestore.collection('users').doc(employeeId).get();
    if (!snapshot.exists || snapshot.data().organizationId !== organizationId) {
      throw new ApiError(400, 'employee-not-in-organization', 'Nhân viên không thuộc cửa hàng này.');
    }
  };

  const loadOwnRecord = async (transaction, reference, organizationId) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists || snapshot.data().organizationId !== organizationId) {
      throw new ApiError(404, 'timesheet-not-found', 'Không tìm thấy bản ghi chấm công.');
    }
    return snapshot.data();
  };

  const auditEntry = ({ manager, type, recordId, record, reason, before = null, after = null, changes = [] }) => ({
    organizationId: manager.organizationId,
    type,
    recordId,
    employeeId: record?.employeeId || null,
    employeeName: record?.employeeName || '',
    date: record?.date || '',
    reason,
    changes,
    before,
    after,
    actorId: manager.uid,
    actorName: manager.fullName || manager.email || '',
    at: FieldValue.serverTimestamp(),
  });

  router.post('/', route(async request => {
    const manager = await requireManager(request);
    const record = normalizeManualRecord(request.body?.record);
    const reason = normalizeReason(request.body?.reason, { required: false });
    await assertEmployeeInOrganization(record.employeeId, manager.organizationId);

    const reference = timesheets().doc();
    await firestore.runTransaction(async transaction => {
      transaction.set(reference, {
        ...record,
        organizationId: manager.organizationId,
        source: 'manual',
        createdBy: manager.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(auditLogs().doc(), auditEntry({
        manager, type: 'timesheet_create', recordId: reference.id, record, reason, after: record,
      }));
    });
    return { record: { id: reference.id, ...record, organizationId: manager.organizationId, source: 'manual' } };
  }));

  router.post('/:recordId/update', route(async request => {
    const manager = await requireManager(request);
    const record = normalizeManualRecord(request.body?.record);
    const reason = normalizeReason(request.body?.reason);

    const reference = timesheets().doc(String(request.params.recordId));
    const result = await firestore.runTransaction(async transaction => {
      const current = await loadOwnRecord(transaction, reference, manager.organizationId);
      await assertEmployeeInOrganization(record.employeeId, manager.organizationId);
      const before = pickEditable(current);
      const changes = describeChanges(before, record);
      if (changes.length === 0) return { unchanged: true };
      transaction.update(reference, {
        ...record,
        editedManually: true,
        lastEditedBy: manager.uid,
        lastEditedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(auditLogs().doc(), auditEntry({
        manager, type: 'timesheet_edit', recordId: reference.id, record, reason, before, after: record, changes,
      }));
      return { unchanged: false, changes };
    });
    return { record: { id: reference.id, ...record }, ...result };
  }));

  router.post('/:recordId/delete', route(async request => {
    const manager = await requireManager(request);
    const reason = normalizeReason(request.body?.reason);
    const reference = timesheets().doc(String(request.params.recordId));
    await firestore.runTransaction(async transaction => {
      const current = await loadOwnRecord(transaction, reference, manager.organizationId);
      transaction.delete(reference);
      transaction.set(auditLogs().doc(), auditEntry({
        manager, type: 'timesheet_delete', recordId: reference.id, record: current, reason, before: pickEditable(current),
      }));
    });
    return { recordId: reference.id, deleted: true };
  }));

  // Renames the display name on records of an employee without an account.
  // Linked accounts are renamed by the renameEmployeeAccount function instead.
  router.post('/rename', route(async request => {
    const manager = await requireManager(request);
    const fromName = String(request.body?.fromName || '').trim();
    const toName = String(request.body?.toName || '').trim().replace(/\s+/g, ' ');
    if (!fromName || toName.length < 2 || toName.length > 100) {
      throw new ApiError(400, 'invalid-employee', 'Tên nhân viên cần từ 2 đến 100 ký tự.');
    }
    const snapshot = await timesheets()
      .where('organizationId', '==', manager.organizationId)
      .where('employeeName', '==', fromName)
      .get();
    const targets = snapshot.docs.filter(item => !item.data().employeeId);
    for (let index = 0; index < targets.length; index += RENAME_BATCH_SIZE) {
      const chunk = targets.slice(index, index + RENAME_BATCH_SIZE);
      await firestore.runTransaction(async transaction => {
        for (const item of chunk) transaction.update(timesheets().doc(item.id), { employeeName: toName, updatedAt: FieldValue.serverTimestamp() });
      });
    }
    if (targets.length) {
      await auditLogs().doc().set(auditEntry({
        manager,
        type: 'timesheet_rename',
        recordId: '',
        record: { employeeName: toName },
        reason: `${fromName} → ${toName}`,
        changes: [{ field: 'employeeName', before: fromName, after: toName }],
      }));
    }
    return { updated: targets.length };
  }));

  return router;
};
