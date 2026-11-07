import { browser } from './compat.js';
import { isWorthNotifying } from './update-check.js';

const STORAGE_KEY = 'welcomeNotice';

export async function maybeWriteWelcomeNotice({ reason, previousVersion, currentVersion }) {
  if (reason !== 'update') return false;
  if (!previousVersion) return false;
  if (!isWorthNotifying(currentVersion, previousVersion)) return false;

  await browser.storage.local.set({
    [STORAGE_KEY]: {
      version: currentVersion,
      fromVersion: previousVersion,
      dismissed: false,
      lastNoticeShownDate: null,
    },
  });
  return true;
}

export function shouldShowWelcomeNotice(welcomeNotice, currentVersion) {
  if (!welcomeNotice || !welcomeNotice.version) {
    return { show: false, removeStale: false };
  }
  const parseNum = (s) => parseInt(s, 10) || 0;
  const noticeParts = String(welcomeNotice.version).split('.').map(parseNum);
  const currentParts = String(currentVersion).split('.').map(parseNum);
  const sameMinor = noticeParts[0] === currentParts[0] && noticeParts[1] === currentParts[1];
  if (!sameMinor) {
    return { show: false, removeStale: true };
  }
  return { show: welcomeNotice.dismissed !== true, removeStale: false };
}
