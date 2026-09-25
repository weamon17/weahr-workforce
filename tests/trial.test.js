import test from 'node:test';
import assert from 'node:assert/strict';
import { getTrialStatus } from '../src/utils/trial.js';

const now = new Date('2026-09-25T09:00:00+07:00');
const endingIn = days => ({ subscriptionStatus: 'trialing', trialEndsAt: new Date(now.getTime() + days * 86400000) });

test('trial banner counts down and warns in the last days', () => {
  assert.deepEqual(
    { state: getTrialStatus(endingIn(10), now).state, daysLeft: getTrialStatus(endingIn(10), now).daysLeft },
    { state: 'trialing', daysLeft: 10 },
  );
  assert.equal(getTrialStatus(endingIn(2.5), now).state, 'ending');
  assert.equal(getTrialStatus(endingIn(2.5), now).daysLeft, 3);
});

test('an expired trial is reported but paid or unknown plans show nothing', () => {
  assert.equal(getTrialStatus(endingIn(-1), now).state, 'expired');
  assert.equal(getTrialStatus({ subscriptionStatus: 'active', trialEndsAt: endingIn(-1).trialEndsAt }, now), null);
  assert.equal(getTrialStatus({ subscriptionStatus: 'trialing' }, now), null);
  assert.equal(getTrialStatus(null, now), null);
  // Firestore Timestamp-like values are supported.
  const timestampLike = { toDate: () => endingIn(5).trialEndsAt };
  assert.equal(getTrialStatus({ subscriptionStatus: 'trialing', trialEndsAt: timestampLike }, now).daysLeft, 5);
});
