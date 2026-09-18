/* VIMECO S.A. — Modo versión: la obra entera, parada en una foto guardada.

   Con `?version=<key>` en la URL (`?cierre=` también, que es como salió en
   v188), cualquier pantalla de la obra muestra los datos tal como estaban
   cuando se guardó esa versión: los A.P. con su receta de entonces, la ficha
   de cada máquina, los precios, los roles, el Cómputo, la Carga Fija, el Plan.
   Sirve para el uso real del sistema: los análisis se arman con los costos
   reales y después se retocan para llegar a un precio final — guardar una
   versión antes de retocarlos permite volver a mirarlos.

   **Ninguna pantalla sabe que esto existe.** Las once leen la base por las
   mismas funciones de js/firebase.js, que son el único camino a la RTDB, así
   que alcanza con contestarles desde la foto en vez de la red — el mismo
   argumento con el que el login (js/auth.js) y el deshacer (js/undo.js) cubren
   toda la app desde un solo lugar.

   Se carga después de js/firebase.js (a quien le pisa las funciones) y antes
   del JS de la pantalla. En una URL sin versión no hace absolutamente nada.

   El nodo sigue llamándose /obras/{obraKey}/cierres: así nació en v188 y ya
   hay versiones guardadas con ese nombre. "Versión" es cómo se lo nombra en
   pantalla. */

(function () {
  const params = new URLSearchParams(window.location.search);
  const versionKey = params.get('version') || params.get('cierre');
  const obraKey = params.get('obra');
  if (!versionKey || !obraKey) return;

  const getReal   = window._fbGet;
  const putReal   = window._fbPut;
  const patchReal = window._fbPatch;
  const delReal   = window._fbDel;

  /* La pantalla de Versiones tiene que seguir andando mientras se mira una
     versión: todo lo que cuelga de /obras/{k}/cierres pasa de largo a la base
     real. Si no, una versión no podría ni listarse a sí misma. */
  const ES_CIERRES = new RegExp('^/obras/[^/]+/cierres(\\.json|/|$)');

  let foto = null;   // { obras: {…}, items, materiales, equipos, rubros }
  let meta = null;

  // La foto, pedida una sola vez. Las lecturas esperan a esta promesa igual que
  // _authToken espera a que Firebase confirme la sesión: las pantallas piden
  // datos apenas cargan y quedan esperando solas, sin saber por qué.
  const listo = (async () => {
    const cierre = await getReal(`/obras/${obraKey}/cierres/${versionKey}.json`);
    if (!cierre || !cierre.datos) {
      // Sin foto no se puede fingir nada: mejor decirlo que mostrar datos vivos
      // haciéndolos pasar por guardados.
      document.addEventListener('DOMContentLoaded', () => {
        document.body.innerHTML = '<p style="padding:2rem;">No se encontró esta versión de la obra.</p>';
      });
      return new Promise(() => {});   // nunca resuelve: nada se pinta con datos vivos
    }
    const d = cierre.datos;
    meta = cierre.meta || {};
    window._versionResultado = cierre.resultado || null;
    foto = {
      obras:      { [obraKey]: d.obra || {} },
      items:      d.items || null,
      materiales: d.materiales || null,
      equipos:    d.equipos || null,
      // Catálogo de rubros de Biblioteca: las versiones anteriores a que se
      // guardara no lo tienen, y se comportan como una base sin rubros.
      rubros:     d.rubros || null,
    };
  })();

  /* Semántica de RTDB, que es lo que las pantallas esperan: un nodo vacío no
     existe (null), y las claves nulas no están. Sin esto, un `{}` donde debería
     haber `null` hace que una pantalla crea que hay datos y pinte una lista
     vacía en vez de su cartel de "todavía no hay nada". */
  function limpiar(v) {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'object') return v;
    const o = {};
    for (const k of Object.keys(v)) { const h = limpiar(v[k]); if (h !== null) o[k] = h; }
    return Object.keys(o).length ? o : null;
  }

  function leerDeFoto(path) {
    let n = foto;
    for (const p of path.replace(/\.json.*$/, '').split('/').filter(Boolean)) {
      if (n === null || typeof n !== 'object') return null;
      n = n[p] === undefined ? null : n[p];
    }
    return limpiar(n);
  }

  window._fbGet = async function (path) {
    if (ES_CIERRES.test(path)) return getReal(path);
    await listo;
    return leerDeFoto(path);
  };

  /* Una versión no se edita, ni por accidente. Los controles ya quedan
     deshabilitados por window._soloLectura (js/ui.js), así que acá casi no
     llega nada; lo que sí llega es alguna escritura automática de arranque (un
     sembrado, una migración), y ésas son justamente las que no se pueden dejar
     pasar. No se lanza error a propósito: la pantalla tiene que verse, no
     comportarse como si hubiera fallado al guardar. */
  function bloquear(metodo) {
    return async function (path) {
      console.warn(`[versión] ${metodo} ignorado sobre ${path}: se está mirando una versión guardada.`);
    };
  }
  window._fbPut   = bloquear('PUT');
  window._fbPatch = bloquear('PATCH');
  window._fbDel   = bloquear('DELETE');

  // Tiempo real: una foto no cambia. Se emite una vez y no se suscribe nada.
  window._fbListen = function (path, cb) {
    listo.then(() => cb(leerDeFoto(path + '.json')));
    return () => {};
  };

  window._versionActiva = versionKey;
  window.versionMeta = () => meta;
  window.versionListo = () => listo;

  /* Restaurar necesita las funciones de verdad (js/cierres.js corre en una
     pantalla sin ?version=, pero esto deja la puerta abierta por si algún día
     se restaura desde adentro de la versión). */
  window._fbReal = { get: getReal, put: putReal, patch: patchReal, del: delReal };
})();
