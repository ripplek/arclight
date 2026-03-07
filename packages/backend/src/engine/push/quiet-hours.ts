/**
 * Check if current time is within quiet hours.
 * @param quietHoursStr Format: "23:00-07:00" (cross-midnight) or "01:00-06:00"
 * @param timezone User timezone
 */
export function isQuietHours(quietHoursStr: string | undefined, timezone: string = 'UTC'): boolean {
  if (!quietHoursStr) return false;

  const match = quietHoursStr.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
  if (!match) return false;

  const [, startH, startM, endH, endM] = match;
  const startMinutes = Number(startH) * 60 + Number(startM);
  const endMinutes = Number(endH) * 60 + Number(endM);

  const now = new Date();
  const userTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const currentMinutes = userTime.getHours() * 60 + userTime.getMinutes();

  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

export const DEFAULT_QUIET_HOURS = '23:00-07:00';
