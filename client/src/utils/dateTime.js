export function toDatetimeLocalValue(value) {
  if (!value) return '';
  const str = String(value);
  // If already in datetime-local format (YYYY-MM-DDTHH:MM), return as-is
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(str)) return str;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return str.slice(0, 16);
  }
  // Only adjust timezone offset if value is in UTC (has Z or +/- offset)
  const isUTC = /Z|[+-]\d{2}:\d{2}$/.test(str);
  if (isUTC) {
    const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }
  // No timezone indicator - treat as local time, just format it
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  const h = String(parsed.getHours()).padStart(2, '0');
  const min = String(parsed.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}`;
}

export function formatDateTime(value, options = {}) {
  if (!value) return 'Not available';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...options,
  });
}

export function canMarkNoShow(scheduledAt) {
  if (!scheduledAt) return false;
  const parsed = new Date(scheduledAt);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() <= Date.now();
}
