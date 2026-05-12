export function _savedUser() {
  try {
    return localStorage.getItem('heymingOS_username');
  } catch {
    return null;
  }
}
export function _savedHostname() {
  try {
    return localStorage.getItem('heymingOS_hostname');
  } catch {
    return null;
  }
}
export function _defaultUser() {
  return window.parent?.HeymingOS?.Config?.USER || _savedUser() || 'user';
}
export function _defaultHome() {
  const u = _defaultUser();
  return window.parent?.HeymingOS?.Config?.HOME || `/home/${u}`;
}
export function _defaultHostname() {
  return window.parent?.HeymingOS?.Config?.HOSTNAME || _savedHostname() || 'heyming-os';
}
