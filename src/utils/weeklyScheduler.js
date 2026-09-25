const DAY_MS = 24 * 60 * 60 * 1000;

export const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

const toLocalDate = value => {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};

export const formatLocalDate = date => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getNextWeekStart = (now = new Date()) => {
  const date = toLocalDate(now);
  const mondayIndex = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayIndex + 7);
  return formatLocalDate(date);
};

export const getRegistrationDeadline = (weekStart, weekday, time = '18:00') => {
  const monday = toLocalDate(weekStart);
  const deadline = new Date(monday.getTime() - (7 - Number(weekday)) * DAY_MS);
  const [hours, minutes] = time.split(':').map(Number);
  deadline.setHours(hours || 0, minutes || 0, 0, 0);
  return deadline;
};

export const buildShiftSlots = (weekStart, templates = []) => {
  const monday = toLocalDate(weekStart);
  return templates.flatMap(template => (template.days || []).map(dayIndex => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + Number(dayIndex));
    const dateString = formatLocalDate(date);
    return {
      id: `${dateString}::${template.id}`,
      templateId: template.id,
      name: template.name,
      date: dateString,
      dayIndex: Number(dayIndex),
      startTime: template.startTime,
      endTime: template.endTime,
      requiredEmployees: Math.max(1, Number(template.requiredEmployees) || 1),
      requiredSkill: String(template.requiredSkill || '').trim(),
    };
  }));
};

const stableEmployeeSort = (left, right) => {
  const countDiff = left.assignmentCount - right.assignmentCount;
  if (countDiff !== 0) return countDiff;
  return left.employeeName.localeCompare(right.employeeName, 'vi');
};

const timeValue = value => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

export const shiftsOverlap = (left, right) => {
  if (left.date !== right.date) return false;
  const leftStart = timeValue(left.startTime);
  let leftEnd = timeValue(left.endTime);
  const rightStart = timeValue(right.startTime);
  let rightEnd = timeValue(right.endTime);
  if (leftEnd <= leftStart) leftEnd += 24 * 60;
  if (rightEnd <= rightStart) rightEnd += 24 * 60;
  return leftStart < rightEnd && rightStart < leftEnd;
};

export const shiftDurationHours = shift => {
  const start = timeValue(shift.startTime);
  let end = timeValue(shift.endTime);
  if (end <= start) end += 24 * 60;
  return (end - start) / 60;
};

export const generateWeeklyAssignments = ({
  slots,
  submissions,
  minShifts = 0,
  maxShifts = 6,
}) => {
  const employees = new Map(submissions.map(submission => [submission.employeeId, {
    employeeId: submission.employeeId,
    employeeName: submission.employeeName,
    selectedSlotIds: new Set(submission.selectedSlotIds || []),
    skills: new Set((submission.skills || [submission.position]).filter(Boolean).map(value => String(value).trim().toLowerCase())),
    hourlyRate: Math.max(0, Number(submission.hourlyRate) || 0),
    assignmentCount: 0,
    assignedSlotIds: new Set(),
  }]));
  const slotsById = new Map(slots.map(slot => [slot.id, slot]));
  const hasConflict = (employee, slot) => [...employee.assignedSlotIds]
    .some(slotId => shiftsOverlap(slotsById.get(slotId), slot));
  const hasRequiredSkill = (employee, slot) => !slot.requiredSkill
    || employee.skills.has(slot.requiredSkill.toLowerCase());

  const orderedSlots = [...slots].sort((left, right) => {
    const leftCandidates = submissions.filter(item => item.selectedSlotIds?.includes(left.id)).length;
    const rightCandidates = submissions.filter(item => item.selectedSlotIds?.includes(right.id)).length;
    const scarcityDifference = (leftCandidates / left.requiredEmployees) - (rightCandidates / right.requiredEmployees);
    return scarcityDifference || left.date.localeCompare(right.date) || left.startTime.localeCompare(right.startTime);
  });

  const slotAssignments = [];
  for (const slot of orderedSlots) {
    const candidates = [...employees.values()]
      .filter(employee => employee.selectedSlotIds.has(slot.id)
        && employee.assignmentCount < maxShifts
        && hasRequiredSkill(employee, slot)
        && !hasConflict(employee, slot))
      .sort(stableEmployeeSort);
    const selected = candidates.slice(0, slot.requiredEmployees);
    selected.forEach(employee => {
      employee.assignmentCount += 1;
      employee.assignedSlotIds.add(slot.id);
    });
    slotAssignments.push({
      ...slot,
      employeeIds: selected.map(employee => employee.employeeId),
      unfilled: Math.max(0, slot.requiredEmployees - selected.length),
    });
  }

  // Try to bring under-scheduled employees up to the configured minimum by
  // swapping them into a preferred slot occupied by someone with more shifts.
  const underScheduled = [...employees.values()].filter(employee => employee.assignmentCount < minShifts);
  for (const employee of underScheduled) {
    const preferredSlots = slotAssignments.filter(slot => employee.selectedSlotIds.has(slot.id));
    for (const slot of preferredSlots) {
      if (employee.assignmentCount >= minShifts) break;
      if (!hasRequiredSkill(employee, slot)) continue;
      if (slot.employeeIds.includes(employee.employeeId)) continue;
      if (hasConflict(employee, slot)) continue;
      if (slot.unfilled > 0) {
        slot.employeeIds.push(employee.employeeId);
        slot.unfilled -= 1;
        employee.assignmentCount += 1;
        employee.assignedSlotIds.add(slot.id);
        continue;
      }
      const replaceable = slot.employeeIds
        .map(id => employees.get(id))
        .filter(candidate => candidate.assignmentCount > minShifts)
        .sort((left, right) => right.assignmentCount - left.assignmentCount)[0];
      if (replaceable) {
        slot.employeeIds = slot.employeeIds.map(id => id === replaceable.employeeId ? employee.employeeId : id);
        replaceable.assignmentCount -= 1;
        replaceable.assignedSlotIds.delete(slot.id);
        employee.assignmentCount += 1;
        employee.assignedSlotIds.add(slot.id);
      }
    }
  }

  const assignments = [...employees.values()].map(employee => ({
    employeeId: employee.employeeId,
    employeeName: employee.employeeName,
    slotIds: [...employee.assignedSlotIds],
    assignmentCount: employee.assignmentCount,
    hourlyRate: employee.hourlyRate,
    estimatedCost: Number([...employee.assignedSlotIds]
      .reduce((sum, slotId) => sum + shiftDurationHours(slotsById.get(slotId)) * employee.hourlyRate, 0)
      .toFixed(0)),
  }));

  const totalRequired = slots.reduce((sum, slot) => sum + slot.requiredEmployees, 0);
  const totalAssigned = assignments.reduce((sum, employee) => sum + employee.assignmentCount, 0);
  const counts = assignments.map(employee => employee.assignmentCount);
  const mean = counts.length ? totalAssigned / counts.length : 0;
  const deviation = counts.length
    ? Math.sqrt(counts.reduce((sum, count) => sum + (count - mean) ** 2, 0) / counts.length)
    : 0;
  const coverageScore = totalRequired ? totalAssigned / totalRequired : 1;
  const fairnessScore = mean ? Math.max(0, 1 - deviation / Math.max(1, mean)) : 1;
  const minimumScore = minShifts > 0 && assignments.length
    ? assignments.filter(employee => employee.assignmentCount >= minShifts).length / assignments.length
    : 1;
  const scheduleScore = Math.round(Math.min(1, coverageScore) * 70 + fairnessScore * 20 + minimumScore * 10);

  return {
    assignments,
    slots: slotAssignments.sort((left, right) => left.date.localeCompare(right.date) || left.startTime.localeCompare(right.startTime)),
    totalRequired,
    totalAssigned,
    totalScheduledCost: assignments.reduce((sum, employee) => sum + employee.estimatedCost, 0),
    scheduleScore,
  };
};

// Re-applies manager-approved shift swaps to a freshly generated schedule so a
// regeneration never silently undoes them. Swaps whose shift or people no
// longer line up are returned in `skippedSwaps` for the manager to review.
export const applyApprovedSwaps = (result, swapRequests = []) => {
  const slots = result.slots.map(slot => ({ ...slot, employeeIds: [...slot.employeeIds] }));
  const slotsById = new Map(slots.map(slot => [slot.id, slot]));
  const assignments = new Map(result.assignments.map(item => [item.employeeId, { ...item, slotIds: [...item.slotIds] }]));
  const skippedSwaps = [];

  swapRequests.filter(swap => swap.status === 'approved').forEach(swap => {
    const slot = slotsById.get(swap.shift?.id);
    const from = assignments.get(swap.fromEmployeeId);
    const to = assignments.get(swap.claimedBy) || {
      employeeId: swap.claimedBy,
      employeeName: swap.claimedByName,
      slotIds: [],
      hourlyRate: 0,
    };
    const valid = slot && from && swap.claimedBy
      && from.slotIds.includes(slot.id)
      && !slot.employeeIds.includes(swap.claimedBy)
      && !to.slotIds.some(slotId => shiftsOverlap(slotsById.get(slotId), slot));
    if (!valid) {
      skippedSwaps.push(swap);
      return;
    }
    from.slotIds = from.slotIds.filter(slotId => slotId !== slot.id);
    to.slotIds.push(slot.id);
    slot.employeeIds = slot.employeeIds.map(id => (id === from.employeeId ? to.employeeId : id));
    assignments.set(to.employeeId, to);
  });

  const nextAssignments = [...assignments.values()].map(item => ({
    ...item,
    assignmentCount: item.slotIds.length,
    estimatedCost: Number(item.slotIds
      .reduce((sum, slotId) => sum + shiftDurationHours(slotsById.get(slotId)) * item.hourlyRate, 0)
      .toFixed(0)),
  }));
  return {
    ...result,
    slots,
    assignments: nextAssignments,
    totalScheduledCost: nextAssignments.reduce((sum, item) => sum + item.estimatedCost, 0),
    skippedSwaps,
  };
};
