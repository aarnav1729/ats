/**
 * Haptic feedback utility for mobile devices.
 * Falls back to no-op on desktop or where vibration API is unavailable.
 */

const supported = typeof navigator !== 'undefined' && 'vibrate' in navigator;

export const haptic = {
  /** Light tap — button press, selection */
  light: () => supported && navigator.vibrate(10),
  /** Medium impact — modal open, action confirmed */
  medium: () => supported && navigator.vibrate(25),
  /** Heavy — error, destructive action */
  heavy: () => supported && navigator.vibrate([40, 10, 40]),
  /** Success pattern — form submit OK */
  success: () => supported && navigator.vibrate([10, 50, 10]),
  /** Warning — caution dialog */
  warning: () => supported && navigator.vibrate([20, 30, 20]),
  /** Error pattern */
  error: () => supported && navigator.vibrate([40, 20, 40, 20, 80]),
  /** Notification tick */
  notify: () => supported && navigator.vibrate(15),
};

export default haptic;
