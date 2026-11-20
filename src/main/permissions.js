// Folio — which browser permissions the app page may use. Narration needs the microphone; nothing else is needed.
/** @param {string} permission @param {boolean} isAppPage @param {string[]} mediaTypes what a media request asks for: 'audio', 'video' */
export function mayUse(permission, isAppPage, mediaTypes = []) {
  return permission === 'media' && !!isAppPage && !mediaTypes.includes('video');
}
