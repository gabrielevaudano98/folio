// Folio — which browser permissions the app page may use. Narration needs the microphone; nothing else is needed.
/** @param {string} permission @param {boolean} isAppPage @param {string[]} mediaTypes what a media request asks for: 'audio', 'video' or 'unknown' */
export function mayUse(permission, isAppPage, mediaTypes = []) {
  return permission === 'media' && !!isAppPage && mediaTypes.length === 1 && mediaTypes[0] === 'audio'; // exactly the microphone; unknown or mixed requests are refused
}
