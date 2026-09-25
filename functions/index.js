const crypto = require('node:crypto');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, getFirestore, Timestamp } = require('firebase-admin/firestore');
const { logger } = require('firebase-functions');
const { HttpsError, onCall } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');

initializeApp();
const db = getFirestore();
const DAY_MS = 24 * 60 * 60 * 1000;

const safeId = value => value.replace(/[^a-zA-Z0-9_-]/g, '_');
const formatDate = date => date.toISOString().slice(0, 10);

const requireUser = async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Bạn chưa đăng nhập.');
  const userSnap = await db.collection('users').doc(request.auth.uid).get();
  if (!userSnap.exists || userSnap.data().status !== 'active') {
    throw new HttpsError('permission-denied', 'Tài khoản không hoạt động.');
  }
  return { uid: request.auth.uid, ...userSnap.data() };
};

const requireManager = async request => {
  const user = await requireUser(request);
  if (user.role !== 'manager') throw new HttpsError('permission-denied', 'Chỉ quản lý được phép thực hiện.');
  return user;
};

const callableOptions = { region: 'asia-southeast1' };

const normalizeEmail = value => String(value || '').trim().toLowerCase();
const normalizeLabel = (value, maxLength = 120) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
const inviteTokenHash = token => crypto.createHash('sha256').update(String(token || '')).digest('hex');
const trialDurationMs = 14 * DAY_MS;

const validateSignupInput = data => {
  const organizationName = normalizeLabel(data?.organizationName, 120);
  const fullName = normalizeLabel(data?.fullName, 100);
  const email = normalizeEmail(data?.email);
  if (organizationName.length < 2) throw new HttpsError('invalid-argument', 'Tên doanh nghiệp cần ít nhất 2 ký tự.');
  if (fullName.length < 2) throw new HttpsError('invalid-argument', 'Họ tên cần ít nhất 2 ký tự.');
  if (!email || !email.includes('@')) throw new HttpsError('invalid-argument', 'Email không hợp lệ.');
  return { organizationName, fullName, email };
};

exports.completeOrganizationSignup = onCall(callableOptions, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Bạn chưa đăng nhập.');
  const { organizationName, fullName, email } = validateSignupInput(request.data);
  const authEmail = normalizeEmail(request.auth.token.email);
  if (!authEmail || authEmail !== email) {
    throw new HttpsError('permission-denied', 'Email đăng ký không khớp với tài khoản xác thực.');
  }

  const userRef = db.collection('users').doc(request.auth.uid);
  const organizationId = safeId(`${organizationName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-')}-${crypto.randomBytes(4).toString('hex')}`);
  const organizationRef = db.collection('organizations').doc(organizationId);
  const trialEndsAt = Timestamp.fromMillis(Date.now() + trialDurationMs);

  await db.runTransaction(async transaction => {
    const existingUser = await transaction.get(userRef);
    if (existingUser.exists) {
      throw new HttpsError('already-exists', 'Tài khoản đã thuộc một tổ chức.');
    }
    transaction.set(organizationRef, {
      organizationId,
      name: organizationName,
      ownerId: request.auth.uid,
      ownerEmail: email,
      plan: 'trial',
      subscriptionStatus: 'trialing',
      trialEndsAt,
      limits: { branches: 2, employees: 30, managers: 3 },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(userRef, {
      uid: request.auth.uid,
      fullName,
      email,
      role: 'manager',
      isOrganizationOwner: true,
      organizationId,
      status: 'active',
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.set(db.collection('schedule_settings').doc(organizationId), {
      organizationId,
      registrationWeekday: 4,
      registrationCloseTime: '18:00',
      reminderEnabled: true,
      autoGenerate: false,
      minShiftsPerEmployee: 0,
      maxShiftsPerEmployee: 6,
      shiftTemplates: [],
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  logger.info('Organization created', { organizationId, ownerId: request.auth.uid });
  return { organizationId, organizationName, trialEndsAt: trialEndsAt.toDate().toISOString() };
});

exports.createEmployeeInvitation = onCall(callableOptions, async request => {
  const manager = await requireManager(request);
  const email = normalizeEmail(request.data?.email);
  const fullName = normalizeLabel(request.data?.fullName, 100);
  if (!email || !email.includes('@')) throw new HttpsError('invalid-argument', 'Email không hợp lệ.');

  const [organizationSnap, existingUsersSnap, pendingInvitesSnap] = await Promise.all([
    db.collection('organizations').doc(manager.organizationId).get(),
    db.collection('users').where('organizationId', '==', manager.organizationId).get(),
    db.collection('organization_invitations').where('organizationId', '==', manager.organizationId).get(),
  ]);
  if (!organizationSnap.exists) throw new HttpsError('failed-precondition', 'Không tìm thấy tổ chức.');
  const employeeLimit = Number(organizationSnap.data().limits?.employees) || 30;
  const activeEmployeeCount = existingUsersSnap.docs.filter(item => item.data().role === 'employee' && item.data().status === 'active').length;
  const pendingInvitationCount = pendingInvitesSnap.docs.filter(item => item.data().status === 'pending' && item.data().expiresAt?.toMillis() > Date.now()).length;
  if (activeEmployeeCount + pendingInvitationCount >= employeeLimit) {
    throw new HttpsError('resource-exhausted', `Gói hiện tại giới hạn ${employeeLimit} nhân viên. Hãy nâng cấp hoặc thu hồi lời mời chưa dùng.`);
  }
  if (existingUsersSnap.docs.some(item => normalizeEmail(item.data().email) === email && item.data().status === 'active')) {
    throw new HttpsError('already-exists', 'Email này đã là thành viên của tổ chức.');
  }

  const pending = pendingInvitesSnap.docs.find(item => {
    const invitation = item.data();
    return invitation.status === 'pending'
      && normalizeEmail(invitation.email) === email
      && invitation.expiresAt?.toMillis() > Date.now();
  });
  if (pending) {
    throw new HttpsError('already-exists', 'Email này đã có lời mời còn hiệu lực. Hãy thu hồi trước khi gửi lại.');
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const invitationRef = db.collection('organization_invitations').doc();
  const expiresAt = Timestamp.fromMillis(Date.now() + 7 * DAY_MS);
  await invitationRef.set({
    organizationId: manager.organizationId,
    organizationName: organizationSnap.data().name,
    email,
    fullName,
    role: 'employee',
    tokenHash: inviteTokenHash(token),
    status: 'pending',
    invitedBy: manager.uid,
    invitedByEmail: manager.email,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
  });
  return { invitationId: invitationRef.id, token, expiresAt: expiresAt.toDate().toISOString() };
});

exports.getInvitationPreview = onCall(callableOptions, async request => {
  const tokenHash = inviteTokenHash(request.data?.token);
  if (!request.data?.token || tokenHash.length !== 64) throw new HttpsError('invalid-argument', 'Lời mời không hợp lệ.');
  const snapshot = await db.collection('organization_invitations').where('tokenHash', '==', tokenHash).limit(1).get();
  if (snapshot.empty) throw new HttpsError('not-found', 'Không tìm thấy lời mời.');
  const invitation = snapshot.docs[0].data();
  if (invitation.status !== 'pending' || invitation.expiresAt?.toMillis() <= Date.now()) {
    throw new HttpsError('deadline-exceeded', 'Lời mời đã hết hạn hoặc không còn hiệu lực.');
  }
  return {
    email: invitation.email,
    fullName: invitation.fullName || '',
    organizationName: invitation.organizationName,
    expiresAt: invitation.expiresAt.toDate().toISOString(),
  };
});

exports.acceptEmployeeInvitation = onCall(callableOptions, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Bạn chưa đăng nhập.');
  const token = String(request.data?.token || '');
  const tokenHash = inviteTokenHash(token);
  const authEmail = normalizeEmail(request.auth.token.email);
  const fullNameInput = normalizeLabel(request.data?.fullName, 100);
  const invitationQuery = await db.collection('organization_invitations').where('tokenHash', '==', tokenHash).limit(1).get();
  if (invitationQuery.empty) throw new HttpsError('not-found', 'Không tìm thấy lời mời.');
  const invitationRef = invitationQuery.docs[0].ref;
  const userRef = db.collection('users').doc(request.auth.uid);
  const profileRef = db.collection('employee_profiles').doc(request.auth.uid);

  await db.runTransaction(async transaction => {
    const [invitationSnap, existingUser] = await Promise.all([
      transaction.get(invitationRef),
      transaction.get(userRef),
    ]);
    const invitation = invitationSnap.data();
    if (!invitation || invitation.status !== 'pending' || invitation.expiresAt?.toMillis() <= Date.now()) {
      throw new HttpsError('deadline-exceeded', 'Lời mời đã hết hạn hoặc không còn hiệu lực.');
    }
    if (normalizeEmail(invitation.email) !== authEmail) {
      throw new HttpsError('permission-denied', 'Bạn phải đăng ký bằng đúng email được mời.');
    }
    if (existingUser.exists) throw new HttpsError('already-exists', 'Tài khoản đã thuộc một tổ chức.');

    const fullName = fullNameInput || invitation.fullName || authEmail.split('@')[0];
    const createdAt = FieldValue.serverTimestamp();
    transaction.set(userRef, {
      uid: request.auth.uid,
      fullName,
      email: authEmail,
      role: 'employee',
      organizationId: invitation.organizationId,
      status: 'active',
      invitationId: invitationRef.id,
      createdAt,
    });
    transaction.set(profileRef, {
      userId: request.auth.uid,
      organizationId: invitation.organizationId,
      fullName,
      email: authEmail,
      employeeType: 'parttime',
      position: '',
      employmentStatus: 'active',
      startDate: formatDate(new Date()),
      salary: 0,
      hourlyRate: 0,
      standardWorkDays: 26,
      standardHoursPerDay: 8,
      freeOffDays: 2,
      overtimeRate: 1.5,
      workScheduleMode: 'rotating',
      standardStart: '',
      standardEnd: '',
      createdAt,
    });
    transaction.update(invitationRef, {
      status: 'accepted',
      acceptedBy: request.auth.uid,
      acceptedAt: createdAt,
    });
  });
  return { organizationId: invitationQuery.docs[0].data().organizationId };
});

exports.revokeEmployeeInvitation = onCall(callableOptions, async request => {
  const manager = await requireManager(request);
  const invitationId = String(request.data?.invitationId || '');
  if (!invitationId) throw new HttpsError('invalid-argument', 'Thiếu mã lời mời.');
  const invitationRef = db.collection('organization_invitations').doc(invitationId);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(invitationRef);
    if (!snapshot.exists || snapshot.data().organizationId !== manager.organizationId) {
      throw new HttpsError('not-found', 'Không tìm thấy lời mời.');
    }
    if (snapshot.data().status !== 'pending') {
      throw new HttpsError('failed-precondition', 'Chỉ có thể thu hồi lời mời đang chờ.');
    }
    transaction.update(invitationRef, {
      status: 'revoked',
      revokedBy: manager.uid,
      revokedAt: FieldValue.serverTimestamp(),
    });
  });
  return { success: true };
});

exports.setEmployeeAccountStatus = onCall(callableOptions, async request => {
  const manager = await requireManager(request);
  const employeeId = String(request.data?.employeeId || '');
  const status = String(request.data?.status || '');
  if (!employeeId || !['active', 'suspended', 'resigned'].includes(status)) {
    throw new HttpsError('invalid-argument', 'Trạng thái nhân viên không hợp lệ.');
  }
  const userRef = db.collection('users').doc(employeeId);
  const profileRef = db.collection('employee_profiles').doc(employeeId);
  const [userSnap, profileSnap, employeeIdSnap, userIdSnap] = await Promise.all([
    userRef.get(),
    profileRef.get(),
    db.collection('employees').where('employeeId', '==', employeeId).get(),
    db.collection('employees').where('userId', '==', employeeId).get(),
  ]);
  if (!userSnap.exists) throw new HttpsError('not-found', 'Không tìm thấy tài khoản nhân viên.');
  const target = userSnap.data();
  if (target.organizationId !== manager.organizationId || target.role !== 'employee') {
    throw new HttpsError('permission-denied', 'Không thể thay đổi tài khoản ngoài tổ chức hoặc tài khoản quản lý.');
  }

  const batch = db.batch();
  batch.update(userRef, {
    status,
    statusUpdatedBy: manager.uid,
    statusUpdatedAt: FieldValue.serverTimestamp(),
  });
  if (profileSnap.exists) {
    batch.update(profileRef, {
      employmentStatus: status,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  const employeeDocs = new Map();
  [...employeeIdSnap.docs, ...userIdSnap.docs]
    .filter(item => item.data().organizationId === manager.organizationId)
    .forEach(item => employeeDocs.set(item.id, item));
  employeeDocs.forEach(item => batch.update(item.ref, {
    employmentStatus: status,
    updatedAt: FieldValue.serverTimestamp(),
  }));
  const auth = getAuth();
  if (status === 'active') {
    // Re-enable Authentication before Firestore. If the Firestore batch fails,
    // security rules still see the previous inactive status and deny access.
    await auth.updateUser(employeeId, { disabled: false });
    await batch.commit();
  } else {
    // Revoke application access first, then disable future Auth sessions.
    await batch.commit();
    await auth.updateUser(employeeId, { disabled: true });
  }
  return { employeeId, status };
});

exports.renameEmployeeAccount = onCall(callableOptions, async request => {
  const manager = await requireManager(request);
  const employeeId = String(request.data?.employeeId || '');
  const fullName = normalizeLabel(request.data?.fullName, 100);
  if (!employeeId || fullName.length < 2) {
    throw new HttpsError('invalid-argument', 'Họ tên nhân viên cần ít nhất 2 ký tự.');
  }

  const userRef = db.collection('users').doc(employeeId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'Không tìm thấy tài khoản nhân viên.');
  const target = userSnap.data();
  if (target.organizationId !== manager.organizationId || target.role !== 'employee') {
    throw new HttpsError('permission-denied', 'Không thể đổi tên tài khoản ngoài tổ chức hoặc tài khoản quản lý.');
  }

  const employeeNameCollections = [
    'timesheets',
    'bonuses',
    'penalties',
    'schedules',
    'payrolls',
    'availability_submissions',
    'weekly_assignments',
    'attendance_exceptions',
    'employee_devices',
  ];
  const [profileSnap, employeeIdSnap, userIdSnap, ...relatedSnapshots] = await Promise.all([
    db.collection('employee_profiles').doc(employeeId).get(),
    db.collection('employees').where('employeeId', '==', employeeId).get(),
    db.collection('employees').where('userId', '==', employeeId).get(),
    ...employeeNameCollections.map(collectionName => db.collection(collectionName)
      .where('employeeId', '==', employeeId)
      .get()),
  ]);

  const writer = db.bulkWriter();
  const auditFields = {
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: manager.uid,
  };
  writer.update(userRef, { fullName, ...auditFields });
  if (profileSnap.exists) writer.update(profileSnap.ref, { fullName, ...auditFields });

  const employeeDocs = new Map();
  [...employeeIdSnap.docs, ...userIdSnap.docs]
    .filter(item => item.data().organizationId === manager.organizationId)
    .forEach(item => employeeDocs.set(item.ref.path, item));
  employeeDocs.forEach(item => writer.update(item.ref, { fullName, ...auditFields }));

  relatedSnapshots.forEach(snapshot => snapshot.docs
    .filter(item => item.data().organizationId === manager.organizationId)
    .forEach(item => writer.update(item.ref, { employeeName: fullName, ...auditFields })));

  const [fromSwapSnap, claimedSwapSnap, notificationSnap] = await Promise.all([
    db.collection('shift_swap_requests').where('fromEmployeeId', '==', employeeId).get(),
    db.collection('shift_swap_requests').where('claimedBy', '==', employeeId).get(),
    db.collection('notifications').where('recipientId', '==', employeeId).get(),
  ]);
  fromSwapSnap.docs
    .filter(item => item.data().organizationId === manager.organizationId)
    .forEach(item => writer.update(item.ref, { fromEmployeeName: fullName, ...auditFields }));
  claimedSwapSnap.docs
    .filter(item => item.data().organizationId === manager.organizationId)
    .forEach(item => writer.update(item.ref, { claimedByName: fullName, ...auditFields }));
  notificationSnap.docs
    .filter(item => item.data().organizationId === manager.organizationId)
    .forEach(item => writer.update(item.ref, { recipientName: fullName, ...auditFields }));

  await writer.close();
  return { employeeId, fullName };
});

const localNow = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return new Date(Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute),
  ));
};

const getNextWeekStart = now => {
  const date = new Date(now);
  const mondayIndex = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayIndex + 7);
  date.setUTCHours(0, 0, 0, 0);
  return formatDate(date);
};

const getDeadline = (weekStart, weekday, time) => {
  const deadline = new Date(`${weekStart}T00:00:00.000Z`);
  deadline.setTime(deadline.getTime() - (7 - Number(weekday)) * DAY_MS);
  const [hours, minutes] = (time || '18:00').split(':').map(Number);
  deadline.setUTCHours(hours, minutes, 0, 0);
  return deadline;
};

const buildSlots = (weekStart, templates = []) => {
  const monday = new Date(`${weekStart}T00:00:00.000Z`);
  return templates.flatMap(template => (template.days || []).map(day => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + Number(day));
    const dateString = formatDate(date);
    return {
      id: `${dateString}::${template.id}`,
      name: template.name,
      date: dateString,
      startTime: template.startTime,
      endTime: template.endTime,
      requiredEmployees: Math.max(1, Number(template.requiredEmployees) || 1),
      requiredSkill: String(template.requiredSkill || '').trim(),
    };
  }));
};

const minuteValue = value => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

const overlaps = (left, right) => {
  if (left.date !== right.date) return false;
  const leftStart = minuteValue(left.startTime);
  let leftEnd = minuteValue(left.endTime);
  const rightStart = minuteValue(right.startTime);
  let rightEnd = minuteValue(right.endTime);
  if (leftEnd <= leftStart) leftEnd += 24 * 60;
  if (rightEnd <= rightStart) rightEnd += 24 * 60;
  return leftStart < rightEnd && rightStart < leftEnd;
};

const generateAssignments = (slots, submissions, minShifts, maxShifts) => {
  const employees = new Map(submissions.map(item => [item.employeeId, {
    employeeId: item.employeeId,
    employeeName: item.employeeName,
    preferences: new Set(item.selectedSlotIds || []),
    skills: new Set((item.skills || [item.position]).filter(Boolean).map(value => String(value).trim().toLowerCase())),
    count: 0,
    slotIds: [],
  }]));
  const slotsById = new Map(slots.map(slot => [slot.id, slot]));
  const hasConflict = (employee, slot) => employee.slotIds
    .some(slotId => overlaps(slotsById.get(slotId), slot));
  const assignmentsBySlot = new Map();
  const ordered = [...slots].sort((left, right) => {
    const leftCount = submissions.filter(item => item.selectedSlotIds?.includes(left.id)).length;
    const rightCount = submissions.filter(item => item.selectedSlotIds?.includes(right.id)).length;
    return (leftCount / left.requiredEmployees) - (rightCount / right.requiredEmployees);
  });
  ordered.forEach(slot => {
    const selected = [...employees.values()]
      .filter(employee => employee.preferences.has(slot.id)
        && employee.count < maxShifts
        && (!slot.requiredSkill || employee.skills.has(slot.requiredSkill.toLowerCase()))
        && !hasConflict(employee, slot))
      .sort((left, right) => left.count - right.count || left.employeeName.localeCompare(right.employeeName, 'vi'))
      .slice(0, slot.requiredEmployees);
    selected.forEach(employee => {
      employee.count += 1;
      employee.slotIds.push(slot.id);
    });
    assignmentsBySlot.set(slot.id, selected.map(employee => employee.employeeId));
  });

  [...employees.values()].filter(employee => employee.count < minShifts).forEach(employee => {
    const preferred = ordered.filter(slot => employee.preferences.has(slot.id));
    preferred.forEach(slot => {
      if (employee.count >= minShifts || hasConflict(employee, slot)) return;
      if (slot.requiredSkill && !employee.skills.has(slot.requiredSkill.toLowerCase())) return;
      const assignedIds = assignmentsBySlot.get(slot.id);
      if (assignedIds.includes(employee.employeeId)) return;
      if (assignedIds.length < slot.requiredEmployees) {
        assignedIds.push(employee.employeeId);
        employee.count += 1;
        employee.slotIds.push(slot.id);
        return;
      }
      const replaceable = assignedIds
        .map(id => employees.get(id))
        .filter(candidate => candidate.count > minShifts)
        .sort((left, right) => right.count - left.count)[0];
      if (replaceable) {
        assignmentsBySlot.set(slot.id, assignedIds.map(id => id === replaceable.employeeId ? employee.employeeId : id));
        replaceable.count -= 1;
        replaceable.slotIds = replaceable.slotIds.filter(id => id !== slot.id);
        employee.count += 1;
        employee.slotIds.push(slot.id);
      }
    });
  });
  return { employees: [...employees.values()], assignmentsBySlot };
};

const sendReminders = async ({ organizationId, settings, weekStart, deadline }) => {
  if (settings.lastReminderWeek === weekStart) return;
  const [usersSnap, submissionsSnap] = await Promise.all([
    db.collection('users').where('organizationId', '==', organizationId).where('role', '==', 'employee').get(),
    db.collection('availability_submissions').where('organizationId', '==', organizationId).where('weekStart', '==', weekStart).get(),
  ]);
  const submittedIds = new Set(submissionsSnap.docs.map(item => item.data().employeeId));
  const batch = db.batch();
  usersSnap.docs.filter(item => !submittedIds.has(item.id)).forEach(item => {
    const employee = item.data();
    const id = safeId(`weekly_registration_${organizationId}_${weekStart}_${item.id}`);
    batch.set(db.collection('notifications').doc(id), {
      organizationId,
      recipientId: item.id,
      recipientName: employee.fullName || employee.email,
      senderId: 'system',
      senderEmail: 'system@weahr',
      type: 'weekly_registration_reminder',
      title: 'Nhắc đăng ký lịch làm tuần tới',
      message: `Vui lòng đăng ký ca trước ${deadline.toISOString()}.`,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  batch.set(db.collection('schedule_settings').doc(organizationId), {
    lastReminderWeek: weekStart,
    lastReminderAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();
};

const generateSchedule = async ({ organizationId, settings, weekStart }) => {
  if (!settings.autoGenerate || settings.lastGeneratedWeek === weekStart) return;
  const [submissionsSnap, oldAssignmentsSnap, oldSchedulesSnap] = await Promise.all([
    db.collection('availability_submissions').where('organizationId', '==', organizationId).where('weekStart', '==', weekStart).get(),
    db.collection('weekly_assignments').where('organizationId', '==', organizationId).where('weekStart', '==', weekStart).get(),
    db.collection('schedules').where('organizationId', '==', organizationId).where('weekStart', '==', weekStart).get(),
  ]);
  const submissions = submissionsSnap.docs.map(item => item.data());
  const slots = buildSlots(weekStart, settings.shiftTemplates);
  const result = generateAssignments(
    slots,
    submissions,
    Number(settings.minShiftsPerEmployee) || 0,
    Number(settings.maxShiftsPerEmployee) || 6,
  );
  const batch = db.batch();
  oldAssignmentsSnap.docs.forEach(item => batch.delete(item.ref));
  oldSchedulesSnap.docs.filter(item => item.data().scheduleType === 'auto_generated').forEach(item => batch.delete(item.ref));

  result.employees.forEach(employee => {
    const employeeSlots = slots.filter(slot => employee.slotIds.includes(slot.id));
    const assignmentId = `${organizationId}_${weekStart}_${employee.employeeId}`;
    batch.set(db.collection('weekly_assignments').doc(assignmentId), {
      organizationId,
      weekStart,
      employeeId: employee.employeeId,
      employeeName: employee.employeeName,
      shifts: employeeSlots,
      assignmentCount: employee.count,
      generatedAt: FieldValue.serverTimestamp(),
      generatedAutomatically: true,
    });
    employeeSlots.forEach(slot => {
      batch.set(db.collection('schedules').doc(safeId(`auto_${assignmentId}_${slot.id}`)), {
        organizationId,
        weekStart,
        employeeId: employee.employeeId,
        employeeName: employee.employeeName,
        workDate: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        shiftName: slot.name,
        requiredSkill: slot.requiredSkill || '',
        scheduleType: 'auto_generated',
        status: 'approved',
        approvedBy: 'system',
        approvedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    batch.set(db.collection('notifications').doc(safeId(`weekly_schedule_${assignmentId}`)), {
      organizationId,
      recipientId: employee.employeeId,
      recipientName: employee.employeeName,
      senderId: 'system',
      senderEmail: 'system@weahr',
      type: 'weekly_schedule_published',
      title: 'Lịch làm tuần mới đã được xếp',
      message: `Bạn được xếp ${employee.count} ca trong tuần bắt đầu ${weekStart}.`,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  batch.set(db.collection('schedule_settings').doc(organizationId), {
    lastGeneratedWeek: weekStart,
    lastGeneratedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();
};

exports.runWeeklyScheduleAutomation = onSchedule({
  schedule: 'every 60 minutes',
  timeZone: 'Asia/Ho_Chi_Minh',
  region: 'asia-southeast1',
  retryCount: 1,
}, async () => {
  const now = localNow();
  const weekStart = getNextWeekStart(now);
  const settingsSnap = await db.collection('schedule_settings').get();
  for (const settingsDoc of settingsSnap.docs) {
    const settings = settingsDoc.data();
    const organizationId = settings.organizationId || settingsDoc.id;
    const deadline = getDeadline(weekStart, settings.registrationWeekday, settings.registrationCloseTime);
    const reminderStart = new Date(deadline);
    reminderStart.setUTCHours(0, 0, 0, 0);
    try {
      if (now >= reminderStart) await sendReminders({ organizationId, settings, weekStart, deadline });
      if (now >= deadline) await generateSchedule({ organizationId, settings, weekStart });
    } catch (error) {
      logger.error('Weekly scheduling automation failed', { organizationId, error });
    }
  }
});
