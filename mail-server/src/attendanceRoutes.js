import crypto from 'node:crypto';
import express from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  calculateAttendanceHours,
  distanceMeters,
  isCheckInWithinWindow,
  isValidCoordinate,
  previousDate,
  vietnamDateAndTime,
} from './attendanceLogic.js';

const safeId = value => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 1200);
const bearerToken = request => String(request.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';

class ApiError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const route = handler => async (request, response) => {
  try {
    const data = await handler(request);
    response.json({ ok: true, ...data });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const code = error instanceof ApiError ? error.code : 'attendance-api-error';
    const message = error instanceof ApiError ? error.message : 'Dịch vụ chấm công không phản hồi.';
    if (!(error instanceof ApiError)) {
      console.error('attendance route failed', { code: error?.code, message: error?.message });
    }
    response.status(status).json({
      ok: false,
      error: { code, message, ...(error?.details ? { details: error.details } : {}) },
    });
  }
};

const secureTokenEquals = (left, right) => {
  const leftHash = crypto.createHash('sha256').update(String(left || '')).digest();
  const rightHash = crypto.createHash('sha256').update(String(right || '')).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
};

export const createAttendanceRouter = ({ auth, firestore }) => {
  const router = express.Router();

  const requireUser = async request => {
    const token = bearerToken(request);
    if (!token) throw new ApiError(401, 'unauthenticated', 'Thiếu Firebase ID token.');
    let decoded;
    try {
      decoded = await auth.verifyIdToken(token, true);
    } catch {
      throw new ApiError(401, 'unauthenticated', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
    }
    const snapshot = await firestore.collection('users').doc(decoded.uid).get();
    const data = snapshot.data();
    if (!snapshot.exists || data?.status !== 'active') {
      throw new ApiError(403, 'account-inactive', 'Tài khoản không hoạt động.');
    }
    return { uid: decoded.uid, ...data };
  };

  const requireManager = async request => {
    const user = await requireUser(request);
    if (user.role !== 'manager') throw new ApiError(403, 'manager-required', 'Chỉ quản lý được phép tạo QR.');
    return user;
  };

  const verifyQr = async (organizationId, qrPayload) => {
    let payload;
    try {
      payload = JSON.parse(String(qrPayload || ''));
    } catch {
      throw new ApiError(400, 'invalid-qr', 'Mã QR không hợp lệ.');
    }
    if (payload?.version !== 1 || payload.organizationId !== organizationId || !payload.token) {
      throw new ApiError(403, 'wrong-organization-qr', 'Mã QR không thuộc cửa hàng này.');
    }
    const snapshot = await firestore.collection('attendance_qr').doc(organizationId).get();
    const qr = snapshot.data();
    if (!snapshot.exists || !secureTokenEquals(qr?.token, payload.token)) {
      throw new ApiError(409, 'expired-qr', 'Mã QR đã hết hạn.');
    }
    if ((qr.expiresAt?.toMillis?.() || 0) <= Date.now()) {
      throw new ApiError(409, 'expired-qr', 'Mã QR đã hết hạn, hãy quét mã mới.');
    }
  };

  const loadSchedule = async (user, scheduleId, action, local, settings) => {
    if (!scheduleId) throw new ApiError(409, 'no-approved-schedule', 'Bạn không có ca được duyệt phù hợp.');
    const snapshot = await firestore.collection('schedules').doc(scheduleId).get();
    const schedule = snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
    const acceptedDates = [local.date, previousDate(local.date)];
    if (!schedule
      || schedule.organizationId !== user.organizationId
      || schedule.employeeId !== user.uid
      || schedule.status !== 'approved'
      || !acceptedDates.includes(schedule.workDate)) {
      throw new ApiError(409, 'no-approved-schedule', 'Bạn không có ca được duyệt phù hợp.');
    }
    if (action === 'check_in') {
      const early = Math.min(180, Math.max(0, Number(settings.earlyCheckInMinutes) || 30));
      const late = Math.min(360, Math.max(0, Number(settings.lateCheckInMinutes) || 120));
      if (!isCheckInWithinWindow({
        scheduleDate: schedule.workDate,
        startTime: schedule.startTime,
        attemptedDate: local.date,
        attemptedTime: local.time,
        earlyMinutes: early,
        lateMinutes: late,
      })) {
        throw new ApiError(409, 'outside-shift-window', `Chỉ được check-in từ ${early} phút trước đến ${late} phút sau giờ bắt đầu ca.`);
      }
    }
    return schedule;
  };

  const createException = async ({ user, action, reason, body, schedule, distance }) => {
    const local = vietnamDateAndTime();
    const reference = firestore.collection('attendance_exceptions').doc();
    await reference.set({
      organizationId: user.organizationId,
      employeeId: user.uid,
      employeeName: user.fullName || user.email,
      action,
      reason,
      status: 'pending',
      attemptedAt: FieldValue.serverTimestamp(),
      attemptedTime: local.time,
      date: schedule?.workDate || local.date,
      scheduleId: schedule?.id || '',
      shiftName: schedule?.shiftName || '',
      scheduleStartTime: schedule?.startTime || '',
      scheduleEndTime: schedule?.endTime || '',
      latitude: Number(body.latitude) || null,
      longitude: Number(body.longitude) || null,
      accuracy: Number(body.accuracy) || null,
      distance: Number.isFinite(distance) ? Math.round(distance) : null,
      deviceId: String(body.deviceId || '').slice(0, 200),
      createdAt: FieldValue.serverTimestamp(),
    });
    return reference.id;
  };

  const validateLocationAndDevice = async ({ user, action, body, settings, schedule }) => {
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    const accuracy = Number(body.accuracy);
    if (!isValidCoordinate(latitude, longitude)) {
      const exceptionId = await createException({ user, action, reason: 'missing_location', body, schedule });
      throw new ApiError(409, 'missing-location', 'Cần bật vị trí để chấm công.', { exceptionId });
    }
    const maximumAccuracy = Math.min(200, Math.max(20, Number(settings.maxGpsAccuracyMeters) || 80));
    if (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > maximumAccuracy) {
      const exceptionId = await createException({ user, action, reason: 'poor_location_accuracy', body, schedule });
      throw new ApiError(409, 'poor-location-accuracy', `GPS chưa đủ chính xác (yêu cầu ≤ ${maximumAccuracy}m).`, { exceptionId });
    }
    const distance = distanceMeters(latitude, longitude, Number(settings.latitude), Number(settings.longitude));
    const allowedDistance = (Number(settings.radiusMeters) || 100) + Math.min(accuracy, 30);
    if (distance > allowedDistance) {
      const exceptionId = await createException({ user, action, reason: 'outside_geofence', body, schedule, distance });
      throw new ApiError(409, 'outside-geofence', `Bạn đang cách cửa hàng khoảng ${Math.round(distance)}m.`, { exceptionId });
    }

    const deviceId = String(body.deviceId || '').trim().slice(0, 200);
    if (!deviceId) {
      const exceptionId = await createException({ user, action, reason: 'missing_device', body, schedule, distance });
      throw new ApiError(409, 'missing-device', 'Không xác định được thiết bị.', { exceptionId });
    }
    const deviceRef = firestore.collection('employee_devices').doc(safeId(`${user.uid}_${deviceId}`));
    const deviceSnap = await deviceRef.get();
    if (!deviceSnap.exists) {
      const [ownDevices, sharedDevices] = await Promise.all([
        firestore.collection('employee_devices').where('employeeId', '==', user.uid).get(),
        firestore.collection('employee_devices').where('deviceId', '==', deviceId).get(),
      ]);
      const usedByAnotherEmployee = sharedDevices.docs.some(item => item.data().employeeId !== user.uid);
      const exceedsLimit = ownDevices.size >= (Number(settings.maxDevicesPerEmployee) || 1);
      if (usedByAnotherEmployee || exceedsLimit) {
        const reason = usedByAnotherEmployee ? 'shared_device' : 'new_device_over_limit';
        const exceptionId = await createException({ user, action, reason, body, schedule, distance });
        throw new ApiError(409, reason, 'Thiết bị cần quản lý phê duyệt.', { exceptionId });
      }
      await deviceRef.set({
        organizationId: user.organizationId,
        employeeId: user.uid,
        employeeName: user.fullName || user.email,
        deviceId,
        firstSeenAt: FieldValue.serverTimestamp(),
        lastSeenAt: FieldValue.serverTimestamp(),
      });
    } else {
      await deviceRef.update({ lastSeenAt: FieldValue.serverTimestamp() });
    }
    return { distance, deviceId };
  };

  router.post('/qr', route(async request => {
    const manager = await requireManager(request);
    const settingsSnap = await firestore.collection('attendance_settings').doc(manager.organizationId).get();
    if (!settingsSnap.exists) {
      throw new ApiError(409, 'settings-required', 'Cửa hàng chưa cấu hình chấm công.');
    }
    const ttlSeconds = Math.min(60, Math.max(30, Number(settingsSnap.data().qrTtlSeconds) || 45));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const token = crypto.randomBytes(24).toString('base64url');
    await firestore.collection('attendance_qr').doc(manager.organizationId).set({
      organizationId: manager.organizationId,
      token,
      issuedBy: manager.uid,
      issuedAt: Timestamp.fromDate(now),
      expiresAt: Timestamp.fromDate(expiresAt),
    });
    return {
      qrPayload: JSON.stringify({ version: 1, organizationId: manager.organizationId, token }),
      expiresAt: expiresAt.getTime(),
      ttlSeconds,
    };
  }));

  const attendanceAction = action => route(async request => {
    const user = await requireUser(request);
    if (user.role !== 'employee') throw new ApiError(403, 'employee-required', 'Chỉ nhân viên được chấm công.');
    const body = request.body || {};
    await verifyQr(user.organizationId, body.qrPayload);
    const settingsSnap = await firestore.collection('attendance_settings').doc(user.organizationId).get();
    if (!settingsSnap.exists) throw new ApiError(409, 'settings-required', 'Cửa hàng chưa cấu hình chấm công.');
    const settings = settingsSnap.data();
    const local = vietnamDateAndTime();
    const schedule = await loadSchedule(user, String(body.scheduleId || ''), action, local, settings);
    const { distance, deviceId } = await validateLocationAndDevice({ user, action, body, settings, schedule });
    const timesheetRef = firestore.collection('timesheets')
      .doc(safeId(`${user.organizationId}_${user.uid}_${schedule.id}`));
    const now = new Date();

    if (action === 'check_in') {
      await firestore.runTransaction(async transaction => {
        const snapshot = await transaction.get(timesheetRef);
        if (snapshot.exists && snapshot.data().checkInAt) {
          throw new ApiError(409, 'already-checked-in', 'Bạn đã check-in cho ca này.');
        }
        transaction.set(timesheetRef, {
          organizationId: user.organizationId,
          employeeId: user.uid,
          employeeName: user.fullName || user.email,
          date: schedule.workDate,
          type: 'Đi làm',
          status: 'work',
          checkIn: local.time,
          checkInAt: Timestamp.fromDate(now),
          checkInLatitude: Number(body.latitude),
          checkInLongitude: Number(body.longitude),
          checkInAccuracy: Number(body.accuracy) || null,
          checkInDistanceMeters: Math.round(distance),
          checkInDeviceId: deviceId,
          scheduleId: schedule.id,
          shiftName: schedule.shiftName || '',
          scheduleStartTime: schedule.startTime || '',
          scheduleEndTime: schedule.endTime || '',
          secureAttendance: true,
          workHours: 0,
          lateHours: 0,
          otHours: 0,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });
      return { id: timesheetRef.id, date: schedule.workDate, scheduleId: schedule.id, checkIn: local.time };
    }

    const profileSnap = await firestore.collection('employee_profiles').doc(user.uid).get();
    let result;
    await firestore.runTransaction(async transaction => {
      const snapshot = await transaction.get(timesheetRef);
      if (!snapshot.exists || !snapshot.data().checkInAt) {
        throw new ApiError(409, 'not-checked-in', 'Bạn chưa check-in cho ca này.');
      }
      if (snapshot.data().checkOutAt) throw new ApiError(409, 'already-checked-out', 'Bạn đã check-out cho ca này.');
      result = calculateAttendanceHours({
        checkInAt: snapshot.data().checkInAt.toDate(),
        checkOutAt: now,
        schedule,
        employeeProfile: profileSnap.data() || {},
      });
      transaction.update(timesheetRef, {
        checkOut: local.time,
        checkOutAt: Timestamp.fromDate(now),
        checkOutLatitude: Number(body.latitude),
        checkOutLongitude: Number(body.longitude),
        checkOutAccuracy: Number(body.accuracy) || null,
        checkOutDistanceMeters: Math.round(distance),
        checkOutDeviceId: deviceId,
        ...result,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return { id: timesheetRef.id, date: schedule.workDate, scheduleId: schedule.id, checkOut: local.time, ...result };
  });

  router.post('/check-in', attendanceAction('check_in'));
  router.post('/check-out', attendanceAction('check_out'));

  router.post('/exceptions/:exceptionId/resolve', route(async request => {
    const manager = await requireManager(request);
    const decision = request.body?.decision;
    if (!['approved', 'rejected'].includes(decision)) {
      throw new ApiError(400, 'invalid-decision', 'Quyết định duyệt ngoại lệ không hợp lệ.');
    }
    const reference = firestore.collection('attendance_exceptions').doc(request.params.exceptionId);
    const snapshot = await reference.get();
    const exception = snapshot.data();
    if (!snapshot.exists || exception.organizationId !== manager.organizationId) {
      throw new ApiError(404, 'exception-not-found', 'Không tìm thấy yêu cầu ngoại lệ.');
    }
    if (exception.status !== 'pending') {
      throw new ApiError(409, 'exception-resolved', 'Yêu cầu này đã được xử lý.');
    }
    const timesheetIdentity = exception.scheduleId || exception.date;
    const timesheetRef = firestore.collection('timesheets')
      .doc(safeId(`${manager.organizationId}_${exception.employeeId}_${timesheetIdentity}`));
    const profileSnap = decision === 'approved'
      ? await firestore.collection('employee_profiles').doc(exception.employeeId).get()
      : null;

    await firestore.runTransaction(async transaction => {
      const currentExceptionSnap = await transaction.get(reference);
      if (!currentExceptionSnap.exists || currentExceptionSnap.data().status !== 'pending') {
        throw new ApiError(409, 'exception-resolved', 'Yêu cầu này đã được xử lý.');
      }
      let timesheetSnap = null;
      if (decision === 'approved' && exception.action === 'check_out') {
        timesheetSnap = await transaction.get(timesheetRef);
        if (!timesheetSnap.exists || !timesheetSnap.data().checkInAt) {
          throw new ApiError(409, 'not-checked-in', 'Không thể duyệt check-out khi chưa có check-in.');
        }
      }

      if (decision === 'approved') {
        const attemptedAt = exception.attemptedAt || Timestamp.now();
        if (exception.action === 'check_in') {
          transaction.set(timesheetRef, {
            organizationId: manager.organizationId,
            employeeId: exception.employeeId,
            employeeName: exception.employeeName,
            date: exception.date,
            type: 'Đi làm',
            status: 'work',
            checkIn: exception.attemptedTime,
            checkInAt: attemptedAt,
            checkInLatitude: exception.latitude,
            checkInLongitude: exception.longitude,
            checkInAccuracy: exception.accuracy,
            checkInDistanceMeters: exception.distance,
            checkInDeviceId: exception.deviceId,
            scheduleId: exception.scheduleId,
            shiftName: exception.shiftName || '',
            scheduleStartTime: exception.scheduleStartTime || '',
            scheduleEndTime: exception.scheduleEndTime || '',
            secureAttendance: true,
            approvedExceptionId: reference.id,
            workHours: 0,
            lateHours: 0,
            otHours: 0,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        } else {
          const hours = calculateAttendanceHours({
            checkInAt: timesheetSnap.data().checkInAt.toDate(),
            checkOutAt: attemptedAt.toDate(),
            schedule: {
              startTime: timesheetSnap.data().scheduleStartTime || exception.scheduleStartTime,
              endTime: timesheetSnap.data().scheduleEndTime || exception.scheduleEndTime,
            },
            employeeProfile: profileSnap?.data() || {},
          });
          transaction.update(timesheetRef, {
            checkOut: exception.attemptedTime,
            checkOutAt: attemptedAt,
            checkOutLatitude: exception.latitude,
            checkOutLongitude: exception.longitude,
            checkOutAccuracy: exception.accuracy,
            checkOutDistanceMeters: exception.distance,
            checkOutDeviceId: exception.deviceId,
            ...hours,
            approvedExceptionId: reference.id,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }
      transaction.update(reference, {
        status: decision,
        managerNote: String(request.body?.note || '').slice(0, 500),
        resolvedBy: manager.uid,
        resolvedAt: FieldValue.serverTimestamp(),
      });
    });
    return { exceptionId: reference.id, status: decision };
  }));

  return router;
};
