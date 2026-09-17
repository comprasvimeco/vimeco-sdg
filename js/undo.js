/* VIMECO S.A. — Deshacer / rehacer (Ctrl+Z / Ctrl+Y)

   Las 111 escrituras de la app pasan por _fbPut/_fbPatch/_fbDel (js/firebase.js).
   Ahí está el único gancho que hace falta: antes de cada escritura se lee el
   estado previo del path y se apila cómo volver atrás. Ninguna pantalla necesita
   saber que el undo existe — igual que con el login en js/auth.js.

   Todo cambio se traduce a una forma única: "este path valía X y pasó a valer Y".
   Deshacer es escribir X, rehacer es escribir Y, y aplicar un valor es PUT si hay
   algo o DELETE si el valor es null. El PATCH es lo mismo pero por sub-path, y se
   restaura con PUT de cada sub-nodo entero, nunca con un PATCH inverso: un PATCH
   mergea, así que dejaría vivos los campos que el cambio original agregó adentro.

   Los snapshots son siempre del nodo completo, nunca campo por campo — un PUT
   borra los hijos anidados que no vengan en el body (incidente 2026-08-11), así
   que restaurar con media foto sería perder datos en el propio undo.

   La pila vive en memoria y en esta pestaña: al recargar o cambiar de pantalla
   arranca vacía. Es a propósito — nunca deshace algo de la sesión de ayer.  */

(function () {
  const MAX_PASOS       = 50;
  const MS_CIERRE_GRUPO = 500;   // sin escrituras nuevas, el gesto se da por terminado
  const MS_REPINTAR     = 2500;  // ventana en la que un listener sabe que el cambio es nuestro

  let pilaDeshacer = [];
  let pilaRehacer  = [];

  let grupo       = null;  // gesto en curso: { etiqueta, entradas: [] }
  let timerGrupo  = null;
  let aplicando   = false; // adentro de un undo/redo no se anota nada
  let omitiendo   = 0;     // undoOmitir(): migraciones y sembrados no son actos del usuario
  let explicito   = false; // adentro de undoAgrupar(): las escrituras sueltas no se anotan
  let enVuelo     = 0;     // escrituras a mitad de camino
  let ultimoUndo  = 0;     // timestamp del último undo/redo aplicado

  let recargarPantalla = null;

  /* ---------- comparación de valores tal como los devuelve la base ----------
     RTDB no guarda claves en null y devuelve arrays cuando las claves son
     enteros correlativos, así que comparar los objetos crudos da distinto
     aunque el contenido sea el mismo. _limpio() los lleva a una forma estable;
     se usa sólo para comparar, nunca para restaurar (para eso va el crudo). */
  function _limpio(v) {
    if (v === undefined || v === null) return null;
    if (typeof v !== 'object') return v;
    const fuente = Array.isArray(v)
      ? Object.fromEntries(v.map((x, i) => [String(i), x]))
      : v;
    const salida = {};
    Object.keys(fuente).sort().forEach(k => {
      const hijo = _limpio(fuente[k]);
      if (hijo !== null) salida[k] = hijo;
    });
    return Object.keys(salida).length ? salida : null;
  }
  function _iguales(a, b) {
    return JSON.stringify(_limpio(a)) === JSON.stringify(_limpio(b));
  }

  // Los paths de la app vienen con .json al final; un sub-path lo inserta antes.
  function subPath(path, clave) {
    return path.replace(/\.json$/, '') + '/' + clave + '.json';
  }

  function aplicarValor(path, valor) {
    return (valor === null || valor === undefined) ? _fbDel(path) : _fbPut(path, valor);
  }

  /* ---------- captura del estado previo ---------- */

  async function leerAntesDeUnPatch(path, claves) {
    // Pocas claves: una lectura por sub-path, en paralelo. Muchas (importar
    // conceptos, reordenar media lista): una sola del nodo padre.
    if (claves.length <= 8) {
      const valores = await Promise.all(claves.map(k => _fbGet(subPath(path, k)).catch(() => null)));
      return Object.fromEntries(claves.map((k, i) => [k, valores[i] ?? null]));
    }
    const padre = await _fbGet(path).catch(() => null);
    return Object.fromEntries(claves.map(k => {
      let nodo = padre;
      for (const parte of k.split('/')) {
        if (nodo === null || typeof nodo !== 'object') { nodo = null; break; }
        nodo = nodo[parte] ?? null;
      }
      return [k, nodo];
    }));
  }

  /* Lo que llama js/firebase.js antes de cada escritura. Devuelve la función que
     firebase.js invoca al terminar (en un finally), para saber cuándo no queda
     nada a mitad de camino. */
  async function anotar(metodo, path, datos) {
    if (aplicando || omitiendo > 0 || explicito) return () => {};

    enVuelo++;
    const listo = () => { enVuelo = Math.max(0, enVuelo - 1); };

    try {
      let entrada = null;

      if (metodo === 'patch') {
        const claves = Object.keys(datos || {});
        if (!claves.length) return listo;
        const antes = await leerAntesDeUnPatch(path, claves);
        const despues = Object.fromEntries(claves.map(k => [k, datos[k] ?? null]));
        // Un blur sin cambios guarda igual: si nada se movió, no ensucia la pila.
        const cambiadas = claves.filter(k => !_iguales(antes[k], despues[k]));
        if (!cambiadas.length) return listo;
        entrada = {
          tipo: 'campos', path,
          antes:   Object.fromEntries(cambiadas.map(k => [k, antes[k] ?? null])),
          despues: Object.fromEntries(cambiadas.map(k => [k, despues[k]])),
        };
      } else {
        const antes   = await _fbGet(path).catch(() => null);
        const despues = metodo === 'del' ? null : (datos ?? null);
        if (_iguales(antes, despues)) return listo;
        entrada = { tipo: 'nodo', path, antes: antes ?? null, despues };
      }

      apilar(entrada);
    } catch (_) {
      // Si no se pudo leer el estado previo, la escritura sigue igual: se pierde
      // la posibilidad de deshacer ese cambio, no el cambio.
    }
    return listo;
  }

  function apilar(entrada) {
    abrirGrupo();
    grupo.entradas.push(entrada);
    programarCierre();
    pilaRehacer = [];
    pintarBoton();
  }

  /* ---------- agrupar por gesto, no por escritura ----------
     Un solo acto del usuario escribe varias veces: borrar un rubro borra sus
     líneas, mover una línea repatcha órdenes, y una fórmula viva (js/refs.js)
     recalcula en cascada. Todo lo que cae en el mismo gesto es un solo Ctrl+Z.
     El gesto se cierra con el próximo evento del usuario, o solo por tiempo. */
  function abrirGrupo() {
    if (!grupo) grupo = { etiqueta: null, entradas: [] };
  }
  function programarCierre() {
    if (grupo && grupo.fijado) return; // lo cierra undoAgrupar, no el reloj
    clearTimeout(timerGrupo);
    timerGrupo = setTimeout(cerrarGrupo, MS_CIERRE_GRUPO);
  }
  function cerrarGrupo() {
    if (grupo && grupo.fijado) return;
    clearTimeout(timerGrupo);
    if (!grupo) return;
    if (grupo.entradas.length) {
      grupo.etiqueta = grupo.etiqueta || etiquetaDe(grupo.entradas);
      pilaDeshacer.push(grupo);
      if (pilaDeshacer.length > MAX_PASOS) pilaDeshacer.shift();
    }
    grupo = null;
    pintarBoton();
  }

  /* ---------- nombre legible del cambio ----------
     Sale del path, sin anotar ninguna de las 111 escrituras a mano. */
  const ENTIDADES = [
    [/\/auxiliares\//,     'un análisis auxiliar'],
    [/\/rubrosComputo\//,  'un rubro'],
    [/\/computo\//,        'una línea de cómputo'],
    [/\/cargaFija\//,      'la carga fija'],
    [/\/planAvance\//,     'el plan de avance'],
    [/\/cotizaciones\//,   'una cotización'],
    [/\/postits\//,        'una nota'],
    [/\/roles\//,          'un rol de mano de obra'],
    [/\/encabezado/,       'el encabezado de la obra'],
    [/\/export/,           'la configuración de exportación'],
    [/^\/items\//,         'un análisis de precio'],
    [/^\/materiales\//,    'un material'],
    [/^\/equipos\//,       'un equipo'],
    [/^\/rubros\//,        'un rubro de la biblioteca'],
    [/^\/obras\/[^/]+\.json$/, 'los datos de la obra'],
    [/^\/obras\//,         'la obra'],
  ];
  function entidadDe(path) {
    const hit = ENTIDADES.find(([re]) => re.test(path));
    return hit ? hit[1] : 'un dato';
  }
  function verboDe(entrada) {
    if (entrada.tipo === 'campos') return 'edición de';
    if (entrada.despues === null)  return 'eliminación de';
    if (entrada.antes   === null)  return 'creación de';
    return 'edición de';
  }
  function etiquetaDe(entradas) {
    const entidades = [...new Set(entradas.map(e => entidadDe(e.path)))];
    if (entidades.length > 1) return `${entradas.length} cambios`;
    return `${verboDe(entradas[0])} ${entidades[0]}`;
  }

  /* ---------- deshacer / rehacer ---------- */

  // Paths absolutos que toca una entrada, para saber qué cubre cada una.
  function pathsDe(entrada) {
    const base = entrada.path.replace(/\.json$/, '');
    return entrada.tipo === 'nodo' ? [base] : Object.keys(entrada.despues).map(k => base + '/' + k);
  }

  // Saca de un valor los sub-árboles que otra entrada del mismo paso va a tocar.
  function podar(valor, relativos) {
    if (!relativos.length || valor === null || typeof valor !== 'object') return valor;
    const copia = JSON.parse(JSON.stringify(valor));
    for (const rel of relativos) {
      const ps = rel.split('/');
      const ultima = ps.pop();
      let n = copia;
      for (const p of ps) { if (!n || typeof n !== 'object') { n = null; break; } n = n[p]; }
      if (n && typeof n === 'object') delete n[ultima];
    }
    return copia;
  }

  /* Son varios en la misma obra: si otro tocó el dato después, no se pisa.
     La comparación deja afuera lo que el propio gesto escribió más abajo del
     mismo nodo — un material creado y después su precio son dos escrituras, y
     el nodo del material quedó con un hijo que no estaba cuando se anotó. */
  async function estadoSigueSiendo(entrada, esperado, otrosPaths) {
    const relativos = base => (otrosPaths || [])
      .filter(p => p.startsWith(base + '/'))
      .map(p => p.slice(base.length + 1));

    if (entrada.tipo === 'nodo') {
      const base = entrada.path.replace(/\.json$/, '');
      const actual = await _fbGet(entrada.path);
      const fuera = relativos(base);
      return _iguales(podar(actual, fuera), podar(esperado, fuera));
    }
    const claves = Object.keys(esperado);
    const valores = await Promise.all(claves.map(k => _fbGet(subPath(entrada.path, k))));
    return claves.every((k, i) => {
      const fuera = relativos(entrada.path.replace(/\.json$/, '') + '/' + k);
      return _iguales(podar(valores[i], fuera), podar(esperado[k], fuera));
    });
  }

  async function escribirEstado(entrada, destino) {
    if (entrada.tipo === 'nodo') return aplicarValor(entrada.path, destino);

    // Escalares juntos en un PATCH; los sub-árboles, uno por uno con PUT/DELETE
    // para que reemplacen el nodo entero en vez de mergearse.
    const claves  = Object.keys(destino);
    const planos  = claves.filter(k => destino[k] === null || typeof destino[k] !== 'object');
    const arboles = claves.filter(k => !planos.includes(k));
    const tareas  = arboles.map(k => aplicarValor(subPath(entrada.path, k), destino[k]));
    if (planos.length) {
      tareas.push(_fbPatch(entrada.path, Object.fromEntries(planos.map(k => [k, destino[k]]))));
    }
    return Promise.all(tareas);
  }

  async function mover(desdePila, haciaPila, verbo) {
    if (window.guardBloqueoObra && window.guardBloqueoObra()) return;

    await confirmarEdicionPendiente();
    cerrarGrupo();

    if (!desdePila.length) {
      toast(verbo === 'deshizo' ? 'No hay nada más para deshacer.' : 'No hay nada para rehacer.', 'info');
      return;
    }

    const paso = desdePila.pop();
    const haciaAtras = verbo === 'deshizo';
    // Deshacer rehace el gesto al revés; rehacer lo repite en el orden original.
    const entradas = haciaAtras ? [...paso.entradas].reverse() : paso.entradas;
    pintarBoton();

    aplicando = true;
    try {
      // Primero se controla todo y recién después se escribe: si el conflicto
      // apareciera a mitad del gesto, el paso quedaría aplicado por la mitad.
      const dejado = e => (haciaAtras ? e.despues : e.antes);
      const sigue = await Promise.all(entradas.map(e => {
        const ajenos = entradas.filter(o => o !== e).flatMap(pathsDe);
        return estadoSigueSiendo(e, dejado(e), ajenos);
      }));
      if (sigue.some(ok => !ok)) {
        desdePila.push(paso);
        toast('Ese cambio ya lo modificó otra persona — no se tocó nada.', 'warning');
        return;
      }
      for (const entrada of entradas) {
        await escribirEstado(entrada, haciaAtras ? entrada.antes : entrada.despues);
      }
      haciaPila.push(paso);
      ultimoUndo = Date.now();
      showToast(`Se ${verbo}: ${paso.etiqueta}.`);
    } catch (_) {
      desdePila.push(paso);
      toast('No se pudo completar. Revisá la conexión.', 'error');
    } finally {
      aplicando = false;
      pintarBoton();
      if (recargarPantalla) { try { await recargarPantalla(); } catch (_) {} }
    }
  }

  const deshacer = () => mover(pilaDeshacer, pilaRehacer, 'deshizo');
  const rehacer  = () => mover(pilaRehacer, pilaDeshacer, 'rehízo');

  /* Ctrl+Z manda también adentro de un campo (criterio de una planilla, no de un
     formulario). Si había algo a medio tipear, primero se deja que ese campo
     guarde como cualquier edición y se deshace eso — si no, el blur posterior
     pisaría el undo con el valor a medias. */
  async function confirmarEdicionPendiente() {
    const el = document.activeElement;
    const editable = el && (el.isContentEditable ||
      ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !el.disabled && !el.readOnly));
    if (!editable) return;
    el.blur();
    await new Promise(r => setTimeout(r, 0));
    await esperarEscrituras();
    cerrarGrupo();
  }

  async function esperarEscrituras() {
    for (let i = 0; enVuelo > 0 && i < 200; i++) await new Promise(r => setTimeout(r, 25));
  }

  /* ---------- API para las pantallas ---------- */

  // Las pantallas sin tiempo real repintan con esto después de un undo.
  window.registrarRecargaUndo = fn => { recargarPantalla = fn; };

  // Las que sí escuchan (Cómputo, Carga Fija, Ítem) preguntan esto para saber
  // que el cambio entrante es el propio undo y pintarlo aunque haya foco en la
  // tabla — si no, el undo se aplica en la base y no se ve.
  window.undoRecienAplicado = () => aplicando || (Date.now() - ultimoUndo) < MS_REPINTAR;

  // Migraciones y sembrados: no son actos del usuario, no van a la pila.
  window.undoOmitir = async fn => {
    omitiendo++;
    try { return await fn(); } finally { omitiendo--; }
  };

  /* Una operación larga que escribe muchas veces, en un solo Ctrl+Z. Hay dos
     formas, y la diferencia importa:

     - Con `raices`: una foto de cada nodo antes y después, y deshacer es
       reponer la foto. Barato aunque sean cientos de escrituras, pero sólo
       sirve para nodos que son de esta obra y de esta operación (el cómputo
       recién armado por IA): reponer la foto de un nodo compartido borraría lo
       que otro haya agregado ahí mientras tanto.
     - Sin `raices`: cada escritura se anota una por una como siempre, y lo
       único que hace el envoltorio es no dejar que el gesto se corte por el
       camino. Es lo que va cuando la operación toca nodos globales, como el
       catálogo de materiales. */
  window.undoAgrupar = async (etiqueta, raices, fn) => {
    cerrarGrupo();

    if (!raices || !raices.length) {
      grupo = { etiqueta, entradas: [], fijado: true };
      try {
        return await fn();
      } finally {
        if (grupo) grupo.fijado = false;
        cerrarGrupo();
      }
    }

    const antes = await Promise.all(raices.map(p => _fbGet(p).catch(() => null)));
    explicito = true;
    let resultado;
    try {
      resultado = await fn();
    } finally {
      explicito = false;
    }
    const despues = await Promise.all(raices.map(p => _fbGet(p).catch(() => null)));
    const entradas = raices
      .map((path, i) => ({ tipo: 'nodo', path, antes: antes[i] ?? null, despues: despues[i] ?? null }))
      .filter(e => !_iguales(e.antes, e.despues));
    if (entradas.length) {
      pilaDeshacer.push({ etiqueta, entradas });
      if (pilaDeshacer.length > MAX_PASOS) pilaDeshacer.shift();
      pilaRehacer = [];
      pintarBoton();
    }
    return resultado;
  };

  window._undoAnotar = anotar;

  /* ---------- atajos y botón ---------- */

  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = (e.key || '').toLowerCase();
    if (k !== 'z' && k !== 'y') return;
    e.preventDefault();
    e.stopPropagation();
    if (k === 'y' || e.shiftKey) rehacer(); else deshacer();
  }, true);

  // Cualquier otro gesto del usuario da por terminado el anterior.
  ['pointerdown', 'keydown'].forEach(ev =>
    document.addEventListener(ev, e => {
      if (e.type === 'keydown' && (e.ctrlKey || e.metaKey)) return;
      if (grupo) cerrarGrupo();
    }, true)
  );

  let btn = null;
  function pintarBoton() {
    if (!btn) return;
    const hay = pilaDeshacer.length > 0 || (grupo && grupo.entradas.length > 0);
    btn.disabled = !hay;
    const ultimo = grupo && grupo.entradas.length
      ? etiquetaDe(grupo.entradas)
      : (pilaDeshacer.length ? pilaDeshacer[pilaDeshacer.length - 1].etiqueta : null);
    btn.title = hay ? `Deshacer ${ultimo} (Ctrl+Z)` : 'Nada para deshacer (Ctrl+Z)';
  }

  /* El botón va primero en el grupo de acciones del header. En las pantallas de
     obra ese grupo arranca con el candado de modo lectura (#header-modo); en los
     catálogos globales tiene sólo el botón de volver. */
  document.addEventListener('DOMContentLoaded', () => {
    const modo = document.getElementById('header-modo');
    const cont = modo ? modo.parentElement
                      : document.querySelector('.app-header .flex.items-center');
    if (!cont) return;
    btn = document.createElement('button');
    btn.className = 'btn btn-sm btn-outline btn-icon';
    btn.id = 'header-undo';
    btn.setAttribute('aria-label', 'Deshacer');
    btn.innerHTML = icSvg('undo');
    btn.addEventListener('click', deshacer);
    cont.insertBefore(btn, modo || cont.firstChild);
    pintarBoton();
  });
})();
