const toHours = value => {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  if (hours > 23 || minutes > 59) return null;
  return hours + minutes / 60;
};

export const calculateHours = (start, end) => {
  const startValue = toHours(start);
  let endValue = toHours(end);
  if (startValue === null || endValue === null) return 0;
  if (endValue < startValue) endValue += 24;
  return endValue - startValue;
};

export const calculateLateHours = (standardStart, actualStart) => {
  const standard = toHours(standardStart);
  const actual = toHours(actualStart);
  if (standard === null || actual === null) return 0;

  let difference = actual - standard;
  if (difference < -12) difference += 24;
  if (difference > 12) difference -= 24;
  return Math.max(0, difference);
};

export const calculateOvertimeHours = (standardStart, standardEnd, actualStart, actualEnd) => {
  const standardStartValue = toHours(standardStart);
  let standardEndValue = toHours(standardEnd);
  const actualStartValue = toHours(actualStart);
  let actualEndValue = toHours(actualEnd);

  if ([standardStartValue, standardEndValue, actualStartValue, actualEndValue].includes(null)) return 0;
  if (standardEndValue <= standardStartValue) standardEndValue += 24;
  if (actualEndValue <= actualStartValue) actualEndValue += 24;

  const early = Math.max(0, standardStartValue - actualStartValue);
  const late = Math.max(0, actualEndValue - standardEndValue);
  return early + late;
};

// Calendar date in the device's time zone. `toISOString()` is UTC, which in
// Vietnam (UTC+7) reports yesterday's date until 07:00.
export const localDateString = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const localMonthString = (date = new Date()) => localDateString(date).slice(0, 7);

// Hours worked inside the statutory night window (22:00–06:00 in Vietnam's
// Labour Code), for a shift given as HH:MM strings that may cross midnight.
export const calculateNightHours = (start, end, nightStartHour = 22, nightEndHour = 6) => {
  const startValue = toHours(start);
  let endValue = toHours(end);
  if (startValue === null || endValue === null) return 0;
  if (endValue < startValue) endValue += 24;
  const windows = [
    [0, nightEndHour],
    [nightStartHour, 24 + nightEndHour],
    [24 + nightStartHour, 48],
  ];
  const hours = windows.reduce(
    (sum, [from, to]) => sum + Math.max(0, Math.min(endValue, to) - Math.max(startValue, from)),
    0,
  );
  return Number(hours.toFixed(2));
};
