/* global FIREBASE_CONFIG, firebase */
/* Autenticación con Google (Firebase Auth).

   La base se sigue accediendo por REST, sin SDK (js/firebase.js). El SDK entra
   sólo acá, para las tres cosas que a mano salen mal: refrescar el idToken (vence
   cada hora), persistir la sesión entre pestañas y manejar el popup de Google.

   Contrato con el resto de la app: `_authToken()` no resuelve hasta que Firebase
   dijo si hay sesión o no. Como las pantallas llaman a `_fbGet` apenas cargan,
   quedan esperando solas — ninguna necesita saber que el login existe.

   index.html define `window._AUTH_PAGINA_LOGIN = true` antes de cargar este
   script: eso invierte el comportamiento (en vez de exigir sesión, manda a la app
   si ya la hay). */

(function () {
  const PAGINA_LOGIN = 'index.html';
  const PAGINA_APP   = 'app.html';
  const CLAVE_DESTINO = 'vimeco_auth_destino';
  const CLAVE_MOTIVO  = 'vimeco_auth_motivo';
  const CLAVE_SESION  = 'vimeco_auth_sesion';
  const esLogin = window._AUTH_PAGINA_LOGIN === true;

  firebase.initializeApp(FIREBASE_CONFIG);
  const auth = firebase.auth();

  let usuario  = null;
  let resolver = null;
  const sesionLista = new Promise(res => { resolver = res; });

  auth.onAuthStateChanged(u => {
    usuario = u;
    if (u) recordarSesion(u); else olvidarSesion();
    if (resolver) {           // primer disparo: recién ahí se sabe si hay sesión
      resolver(u);
      resolver = null;
      alResolverSesion(u);
    } else if (!u && !esLogin) {
      irAlLogin();            // cerró sesión en otra pestaña
    }
  });

  /* ===== Rastro de sesión =====
     Restaurar la sesión desde IndexedDB tarda un par de cientos de ms, y como cada
     pantalla es una navegación entera, eso pasa en cada click. Este rastro en
     localStorage dice "esta máquina ya estuvo adentro", lo justo para no tapar la
     pantalla mientras Firebase confirma. No es una credencial y no da acceso a
     nada: quien decide sigue siendo el token, y los datos igual esperan porque
     _authToken() no resuelve hasta que Firebase contesta. */
  function recordarSesion(u) {
    try {
      localStorage.setItem(CLAVE_SESION, JSON.stringify({
        email: u.email || '', displayName: u.displayName || '', photoURL: u.photoURL || ''
      }));
    } catch (e) { /* sin storage: se pierde el atajo, la app funciona igual */ }
  }
  function sesionRecordada() {
    try { return JSON.parse(localStorage.getItem(CLAVE_SESION) || 'null'); } catch (e) { return null; }
  }
  function olvidarSesion() {
    try { localStorage.removeItem(CLAVE_SESION); } catch (e) {}
  }

  /* ===== Gate visual =====
     Los <script> están al final del body, así que el contenido de la pantalla ya
     está parseado cuando corre esto.

     El overlay sólo aparece cuando de verdad no se sabe si hay sesión — típicamente
     al entrar de cero, donde tapa el instante previo al redirect al login. Si la
     máquina ya estuvo adentro, moverse entre pantallas no parpadea: se dibuja la
     pantalla normal (vacía, con sus propios "Cargando…") y el overlay queda como
     red de contención por si la confirmación tarda de más. */
  const DEMORA_OVERLAY = 700;
  const recordada = esLogin ? null : sesionRecordada();
  let resuelta = false;

  function overlay(texto) {
    let el = document.getElementById('auth-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'auth-overlay';
      el.className = 'auth-overlay';
      document.body.appendChild(el);
    }
    el.textContent = texto;
    return el;
  }
  function sacarOverlay() {
    const el = document.getElementById('auth-overlay');
    if (el) el.remove();
  }

  if (!esLogin) {
    if (recordada) {
      montarChip(recordada);   // el header queda completo desde el arranque, sin saltos
      setTimeout(() => { if (!resuelta) overlay('Verificando acceso…'); }, DEMORA_OVERLAY);
    } else {
      overlay('Verificando acceso…');
    }
  }

  function alResolverSesion(u) {
    resuelta = true;
    if (esLogin) return;                       // index.html se maneja solo
    if (!u) { irAlLogin(); return; }
    sacarOverlay();
    // Si venía del rastro, el chip ya está puesto; sólo se rehace si cambió la cuenta.
    if (!recordada || recordada.email !== u.email) montarChip(u);
  }

  function irAlLogin() {
    olvidarSesion();
    // Guardar a dónde se quería ir, para volver después de entrar (sirve cuando
    // alguien abre un link directo a una pantalla de obra).
    try {
      if (!esLogin) sessionStorage.setItem(CLAVE_DESTINO, location.pathname + location.search);
    } catch (e) { /* modo privado sin storage: se pierde el destino, nada más */ }
    location.replace(PAGINA_LOGIN);
  }

  /* ===== API para el resto de la app ===== */

  // Las keys de RTDB no admiten puntos: tecnica@vimeco.com.ar → tecnica@vimeco,com,ar
  // Las reglas de la base hacen lo mismo con auth.token.email.toLowerCase().replace('.', ',')
  window._mailKey = mail => String(mail || '').toLowerCase().replace(/\./g, ',');

  // Espejo de database.rules.json: entra quien tenga mail del dominio de la empresa o
  // esté cargado en la allowlist, y activo:false bloquea a cualquiera de los dos. Acá
  // se evalúa sólo para poder dar un mensaje claro en el login; quien manda de verdad
  // son las reglas de la base. Si cambia una, cambiar la otra.
  const DOMINIO_EMPRESA = '@vimeco.com.ar';
  window._authAutorizado = function (mail, datos) {
    const activo = datos && typeof datos.activo !== 'undefined' ? datos.activo : null;
    if (activo === false) return false;                                   // portazo explícito
    if (String(mail || '').toLowerCase().endsWith(DOMINIO_EMPRESA)) return true;
    return activo === true;
  };

  window._authToken = async function () {
    await sesionLista;
    if (!usuario) {
      irAlLogin();
      // Promesa que nunca resuelve, a propósito: deja la pantalla congelada bajo
      // el overlay mientras el navegador navega al login, en vez de que las 19
      // pantallas empiecen a tirar excepciones a mitad de camino.
      return new Promise(() => {});
    }
    return await usuario.getIdToken();
  };

  window._authUsuario = () => usuario
    ? { mail: usuario.email, nombre: usuario.displayName || '', foto: usuario.photoURL || '' }
    : null;

  // `motivo` (opcional) se muestra después en la pantalla de login: sirve para
  // explicar por qué se cayó la sesión en vez de patear al usuario sin decirle nada.
  window._authSalir = async function (motivo) {
    olvidarSesion();
    try {
      if (motivo) sessionStorage.setItem(CLAVE_MOTIVO, motivo);
      sessionStorage.removeItem(CLAVE_DESTINO);
    } catch (e) {}
    try { await auth.signOut(); } catch (e) { /* ya está afuera */ }
    location.replace(PAGINA_LOGIN);
  };

  // Lee y consume el motivo de la última salida forzada.
  window._authMotivo = function () {
    let m = null;
    try {
      m = sessionStorage.getItem(CLAVE_MOTIVO);
      sessionStorage.removeItem(CLAVE_MOTIVO);
    } catch (e) {}
    return m;
  };

  /* ===== Login (sólo lo usa index.html) ===== */

  window._authEntrarConGoogle = async function () {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      return await auth.signInWithPopup(provider);
    } catch (e) {
      // PWA instalada o popup bloqueado: caer a redirect. No devuelve nada —
      // la página se recarga y el resultado lo levanta _authResultadoRedirect().
      if (e.code === 'auth/popup-blocked' ||
          e.code === 'auth/operation-not-supported-in-this-environment') {
        await auth.signInWithRedirect(provider);
        return new Promise(() => {});
      }
      throw e;
    }
  };

  window._authResultadoRedirect = () => auth.getRedirectResult();
  window._authSesionLista       = () => sesionLista;

  window._authDestino = function () {
    let destino = null;
    try {
      destino = sessionStorage.getItem(CLAVE_DESTINO);
      sessionStorage.removeItem(CLAVE_DESTINO);
    } catch (e) {}
    return destino || PAGINA_APP;
  };

  /* ===== Chip de usuario en el header =====
     Las 17 pantallas de la app tienen el mismo #header-dolar en el header, así
     que se cuelga de ahí y no hay que tocar los 17 HTML ni js/ui.js. */
  function montarChip(u) {
    const dolar = document.getElementById('header-dolar');
    if (!dolar || !dolar.parentElement) return;
    const previo = dolar.parentElement.querySelector('.auth-chip');
    if (previo) previo.remove();   // remonte por cambio de cuenta

    const mail   = u.email || '';
    const inicial = (u.displayName || mail || '?').trim().charAt(0).toUpperCase();

    const cont = document.createElement('div');
    cont.className = 'auth-chip';

    const boton = document.createElement('button');
    boton.className = 'auth-avatar';
    boton.type  = 'button';
    boton.title = mail;
    boton.setAttribute('aria-label', 'Cuenta: ' + mail);
    if (u.photoURL) {
      const img = document.createElement('img');
      img.src = u.photoURL;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';   // sin esto Google devuelve 403 en la foto
      img.onerror = () => { img.remove(); boton.textContent = inicial; };
      boton.appendChild(img);
    } else {
      boton.textContent = inicial;
    }

    const menu = document.createElement('div');
    menu.className = 'auth-menu hidden';

    const linea = document.createElement('div');
    linea.className = 'auth-menu-mail';
    linea.textContent = mail;

    const salir = document.createElement('button');
    salir.className = 'auth-menu-salir';
    salir.type = 'button';
    salir.textContent = 'Cerrar sesión';
    salir.onclick = () => window._authSalir();

    menu.appendChild(linea);
    menu.appendChild(salir);
    cont.appendChild(boton);
    cont.appendChild(menu);

    boton.onclick = e => { e.stopPropagation(); menu.classList.toggle('hidden'); };
    document.addEventListener('click', () => menu.classList.add('hidden'));

    dolar.parentElement.insertBefore(cont, dolar);
  }
})();
