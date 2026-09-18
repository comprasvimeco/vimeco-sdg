/* global FIREBASE_CONFIG, firebase */
/* Firebase RTDB — lectura/escritura por REST, sin SDK (mismo patrón que vimeco-oc).

   El token de sesión lo aporta js/auth.js y se cuelga como ?auth= en cada
   request. Estas funciones son el único punto por el que la app habla con
   la base, así que autenticar acá autentica la app entera: ninguna pantalla
   necesita saber que existe el login.

   _authToken() no resuelve hasta que Firebase confirmó si hay sesión, así que
   una llamada disparada al cargar la página espera sola hasta tener con qué
   firmarse.

   _fbListen es la única excepción: usa el SDK de Database (no REST) para
   tiempo real, sobre la misma app que js/auth.js ya autenticó — sólo la
   cargan las pantallas que lo necesitan (item.html de momento). */

(function () {
  const _base = () => FIREBASE_CONFIG.databaseURL;

  // El path puede traer su propia query (`?shallow=true`, para listar las keys
  // de un nodo sin bajarlo entero — lo usa la lista de cierres, donde cada
  // hijo pesa lo que pesa una obra completa).
  async function _url(path) {
    const token = await window._authToken();
    return _base() + path + (path.includes('?') ? '&' : '?') + 'auth=' + encodeURIComponent(token);
  }

  let _saliendo = false;
  function _chequear(resp) {
    if (resp.ok) return;
    // 401: token vencido. 403: las reglas rechazaron la cuenta (la sacaron de la
    // allowlist). En los dos casos no hay nada que reintentar — al login.
    // El flag evita que 20 llamadas en paralelo disparen 20 signOut.
    if ((resp.status === 401 || resp.status === 403) && !_saliendo) {
      _saliendo = true;
      window._authSalir('Tu sesión expiró o esta cuenta ya no tiene acceso al sistema.');
    }
    throw new Error('HTTP ' + resp.status);
  }

  async function _get(path) {
    const resp = await fetch(await _url(path));
    _chequear(resp);
    return await resp.json();
  }
  /* Deshacer (js/undo.js, opcional): antes de cada escritura se le avisa qué se
     va a tocar, para que lea el estado previo y sepa cómo volver atrás. Devuelve
     una función que hay que llamar al terminar — así el undo sabe si todavía
     queda algo a mitad de camino. Si undo.js no está cargado, no pasa nada. */
  async function _anotarUndo(metodo, path, data) {
    if (!window._undoAnotar) return () => {};
    try { return await window._undoAnotar(metodo, path, data); } catch (_) { return () => {}; }
  }

  async function _put(path, data) {
    const listo = await _anotarUndo('put', path, data);
    try {
      const resp = await fetch(await _url(path), {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(data)
      });
      _chequear(resp);
    } finally { listo(); }
  }
  async function _patch(path, data) {
    const listo = await _anotarUndo('patch', path, data);
    try {
      const resp = await fetch(await _url(path), {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(data)
      });
      _chequear(resp);
    } finally { listo(); }
  }
  async function _del(path) {
    const listo = await _anotarUndo('del', path);
    try {
      const resp = await fetch(await _url(path), { method: 'DELETE' });
      _chequear(resp);
    } finally { listo(); }
  }

  // Suscripción en tiempo real (SDK de Database, no REST). Reusa la sesión que
  // js/auth.js ya dejó activa en firebase.auth() sobre la misma app — no hace
  // falta repetir el manejo de token. Devuelve una función para cortar la
  // suscripción; llamarla siempre al cambiar de path o al salir de la pantalla.
  function _listen(path, cb) {
    const ref = firebase.database().ref(path);
    const handler = snap => cb(snap.val());
    ref.on('value', handler);
    return () => ref.off('value', handler);
  }

  window._fbGet    = _get;
  window._fbPut    = _put;
  window._fbPatch  = _patch;
  window._fbDel    = _del;
  window._fbListen = _listen;
})();
