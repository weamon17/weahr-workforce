const DAY_MS = 24 * 60 * 60 * 1000;
export const TRIAL_WARNING_DAYS = 3;

const toDate = value => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

// Trial state for the manager banner. Expiry is advisory only: nothing is
// locked, because the product has no self-service upgrade path yet.
export const getTrialStatus = (organization, now = new Date()) => {
  if (!organization || organization.subscriptionStatus !== 'trialing') return null;
  const endsAt = toDate(organization.trialEndsAt);
  if (!endsAt) return null;
  const daysLeft = Math.ceil((endsAt.getTime() - now.getTime()) / DAY_MS);
  if (daysLeft <= 0) return { state: 'expired', daysLeft: 0, endsAt };
  return { state: daysLeft <= TRIAL_WARNING_DAYS ? 'ending' : 'trialing', daysLeft, endsAt };
};
