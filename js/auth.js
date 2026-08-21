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
  const esLogin = window._AUTH_PAGINA_LOGIN === true;

  firebase.initializeApp(FIREBASE_CONFIG);
  const auth = firebase.auth();

  let usuario  = null;
  let resolver = null;
  const sesionLista = new Promise(res => { resolver = res; });

  auth.onAuthStateChanged(u => {
    usuario = u;
    if (resolver) {           // primer disparo: recién ahí se sabe si hay sesión
      resolver(u);
      resolver = null;
      alResolverSesion(u);
    } else if (!u && !esLogin) {
      irAlLogin();            // cerró sesión en otra pestaña
    }
  });

  /* ===== Gate visual =====
     Los <script> están al final del body, así que el contenido de la pantalla ya
     está parseado cuando corre esto. El overlay opaco lo tapa hasta saber si la
     sesión es válida. */
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
  if (!esLogin) overlay('Verificando acceso…');

  function alResolverSesion(u) {
    if (esLogin) return;                       // index.html se maneja solo
    if (!u) { irAlLogin(); return; }
    sacarOverlay();
    montarChip(u);
  }

  function irAlLogin() {
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
