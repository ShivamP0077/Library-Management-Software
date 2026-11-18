export const PLAN_LIMIT_TITLE = 'Plan Limit Exceeded';

/** Copy when a desk add would grow past the cap. Null when the add is allowed. */
export function deskLimitExceededCopy(currentCount, addCount, limit) {
  if (!(addCount > 0) || !(limit > 0)) return null;
  const next = currentCount + addCount;
  if (next > limit && next > currentCount) {
    return `${PLAN_LIMIT_TITLE}. Your plan allows up to ${limit} physical desks (${currentCount} in use). Upgrade the plan to add more.`;
  }
  return null;
}

/** Returns an error string when adding desks would pass the cap, otherwise null. */
export async function deskGrowthMessage(currentCount, addCount) {
  if (!(addCount > 0)) return null;
  let limit = null;
  try {
    const { api } = await import('./api');
    const sub = await api.subscription();
    limit = sub?.limits?.deskLimit;
  } catch {
    return null;
  }
  return deskLimitExceededCopy(currentCount, addCount, limit);
}
