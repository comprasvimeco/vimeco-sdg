/* global FIREBASE_CONFIG */
/* Firebase RTDB — REST API, sin SDK (mismo patrón que vimeco-oc) */

(function () {
  const _base = () => FIREBASE_CONFIG.databaseURL;

  async function _get(path) {
    const resp = await fetch(_base() + path);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.json();
  }
  async function _put(path, data) {
    const resp = await fetch(_base() + path, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data)
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
  }
  async function _patch(path, data) {
    const resp = await fetch(_base() + path, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data)
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
  }
  async function _del(path) {
    const resp = await fetch(_base() + path, { method: 'DELETE' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
  }

  window._fbGet   = _get;
  window._fbPut   = _put;
  window._fbPatch = _patch;
  window._fbDel   = _del;
})();
