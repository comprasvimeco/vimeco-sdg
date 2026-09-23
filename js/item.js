/* VIMECO S.A. — Sistema de Gestión — Ítem: Rendimientos
   Un ítem no tiene receta propia en la raíz — vive en una o más obras
   (/items/{key}/versionesObra/{obraKey}), cada una con su propia receta
   completa y su propio rendimiento (no comparten líneas entre obras). La
   versión de una obra se crea sola la primera vez que se edita algo estando
   parado en esa obra (arranca vacía). El costo de cada versión se calcula en
   vivo con calcCostoUnitarioItem (js/calcCostos.js), con el dólar/roles
   propios de esa obra. */

const $ = id => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const itemKey = params.get('key');
const obraParam = params.get('obra');
const lineaParam = params.get('linea');
// Mismo mecanismo para un análisis auxiliar (?aux=), que vive en otro nodo:
// /obras/{obra}/auxiliares en vez de /obras/{obra}/computo.
const auxParam = params.get('aux');
const nodoLinea = auxParam ? 'auxiliares' : 'computo';
const keyLinea = auxParam || lineaParam;
const modoVincular = !itemKey && !!keyLinea && !!obraParam;
// Entrada genérica desde el menú ("Análisis de Precio" en las sub-pestañas
// de la obra, sin venir de una línea puntual del Cómputo): aterriza en el
// primer A.P. del Cómputo de esa obra — ver irAlPrimerAP().
const modoDefault = !itemKey && !keyLinea && !!obraParam;

let item = null;
let versionesObra = {};    // { obraKey: { rendimiento, rendimientoFormula, lineas } }
let obrasMap = {};
let obrasFull = {};        // { obraKey: obra } — para leer paramsEquipos/dolar propios de cada obra
let activeVersion = null;
let versionExisteEnServidor = true;

let lineas = {};       // { lineaKey: { tipo, refKey, cantidad } } — de la versión activa
let rendimientoActivo = null;
let rendimientoFormulaActiva = null;
let sinSeguridadCapatazActivo = false;   // excluye el adicional de Seguridad y Capataz en ESTE AP puntual
let baseUsadaActiva = null;   // { itemNombre, obraNombre, copiadoEn } — de qué AP se copió esta receta
let detallePorLineaActivo = {};   // { lineaKey: { costoUnitario, costoTotal } } — sólo en pestañas de obra

let materiales = [];
let equipos = [];
let roles = [];
let auxiliaresDeObra = [];     // auxiliares de la obra activa, elegibles como insumo — ver activarVersion
let auxiliaresPorObra = {};    // caché { obraKey: [{key, itemKey, nombre, unidad, ...}] }, ver cargarAuxiliaresObra
// Un A.P. usa una sola familia de Mano de Obra a la vez (Arquitectura o
// Vial) — ver window.ROLES_FIJOS_MO en calcCostos.js. Determina qué roles
// se listan/aceptan en la sección de Mano de Obra de este A.P.
let familiaMOActiva = 'arquitectura';
let rubros = [];
let rubrosMap = {};
const DEFAULT_PARAMS_EQUIPOS = { tasaInteresPct: 10, reparacionesPct: 75, lubricantesPct: 50, precioCombustibleLitro: 0 };
const DEFAULT_PARAMS_MO = { asistenciaPct: 20, cargasPct: 100, diasMes: 22, jornadaHoras: 8 };
let paramsEquipos = { ...DEFAULT_PARAMS_EQUIPOS };   // se refresca por obra en activarVersion()
let paramsMO = { ...DEFAULT_PARAMS_MO };             // se refresca por obra en activarVersion()
let dolarObraActivo = null;   // dólar propio de la obra de la pestaña activa (/obras/{obraKey}/dolar)

// -- Precio Unitario: Subtotal × Coeficiente K de Carga Fija de la obra ----
// Misma fórmula que presupuesto.js — el AP muestra a título informativo
// cuánto sale este ítem YA con Carga Fija de la obra activa aplicada, sin
// tocar el Presupuesto (que sigue siendo la fuente de verdad, K no se
// cachea acá tampoco). Se cachea por obra dentro de esta carga de página
// nomás (kPorObra), con fetch propio porque item.js no trae el Cómputo
// completo de la obra (sólo lo necesita para la numeración de esta línea).
let kPorObra = {};   // { obraKey: number|null } — null = no se pudo calcular (obra sin costo de Cómputo todavía)

// Equipos que ya aparecen en alguna línea de CUALQUIER ítem/auxiliar de esta
// obra (recorre allItemsFull, que ya trae la versión de cada ítem para esta
// obra) — para destacarlos arriba del todo en el selector, ver renderLineasSeccion.
let equiposUsadosEnObra = new Set();

function calcularEquiposUsadosEnObra() {
  const set = new Set();
  if (!obraParam) return set;
  Object.values(allItemsFull).forEach(it => {
    const version = it.versionesObra && it.versionesObra[obraParam];
    if (!version || !version.lineas) return;
    Object.values(version.lineas).forEach(l => {
      if (l.tipo === 'equipo' && l.refKey) set.add(l.refKey);
    });
  });
  return set;
}

function costoComputoDeObra(obraKeyX, computoDataX, auxiliaresDataX) {
  const obraFullX = obrasFull[obraKeyX] || {};
  const paramsEq = { ...DEFAULT_PARAMS_EQUIPOS, ...(obraFullX.paramsEquipos || {}) };
  const paramsMoX = { ...DEFAULT_PARAMS_MO, ...(obraFullX.paramsMO || {}) };
  const dolarX = obraFullX.dolar ? obraFullX.dolar.valor : null;
  const rolesX = Object.entries(obraFullX.roles || {}).map(([k, r]) => ({ key: k, ...r }));
  const preciosObraX = window.resolverPreciosObra(materiales, obraKeyX);
  const auxiliaresX = Object.entries(auxiliaresDataX || {}).map(([k, a]) => ({ key: k, ...a }));
  const itemsX = Object.entries(allItemsFull).map(([k, it]) => ({ key: k, ...it }));
  const catalogos = { materiales, equipos, roles: rolesX, auxiliares: auxiliaresX, items: itemsX, obraKey: obraKeyX };
  return Object.values(computoDataX || {}).reduce((acc, l) => {
    if (!l.itemKey) return acc;
    const it = allItemsFull[l.itemKey];
    if (!it) return acc;
    const version = (it.versionesObra && it.versionesObra[obraKeyX]) || it;
    if (!version.lineas || !Object.keys(version.lineas).length) return acc;
    const r = window.calcCostoUnitarioItem(version, version.lineas, catalogos, paramsEq, paramsMoX, preciosObraX, dolarX,
      { preciosCongelados: true }); // este costoComputo alimenta el propio K de la obra — ver calcCostos.js
    const cantidad = l.cantidad != null && !isNaN(l.cantidad) ? l.cantidad : 0;
    return acc + r.costoUnitario * cantidad;
  }, 0);
}

async function calcularKObra(obraKeyX) {
  if (kPorObra[obraKeyX] !== undefined) return kPorObra[obraKeyX];
  const [computoDataX, cargaFijaLineasX, cargaFijaConfigX, auxiliaresDataX] = await Promise.all([
    _fbGet(`/obras/${obraKeyX}/computo.json`),
    _fbGet(`/obras/${obraKeyX}/cargaFija/lineas.json`),
    _fbGet(`/obras/${obraKeyX}/cargaFija/config.json`),
    _fbGet(`/obras/${obraKeyX}/auxiliares.json`),
  ]);
  const costoComputo = costoComputoDeObra(obraKeyX, computoDataX, auxiliaresDataX);
  const config = { ...(cargaFijaConfigX || {}) };
  // El K vive en calcCostos.js (calcCargaFija), compartido con Carga Fija,
  // Presupuesto y Plan de Avance. Los gastos fijos no se suman por separado:
  // los que se calculan sobre el presupuesto propio salen del mismo despeje.
  const k = window.calcCargaFija(config, cargaFijaLineasX || {}, costoComputo,
    (obrasFull[obraKeyX] || {}).presupuestoOficial).k;
  kPorObra[obraKeyX] = k;
  return k;
}

// K de la obra abierta (?obra=), en vivo: escucha Carga Fija de ESA obra
// (mismos dos nodos que carga-fija.js) y recalcula "k" cada vez que cambia,
// sin esperar a recargar la pantalla. calcularKObra() ya cachea por obra
// (kPorObra) — acá se fuerza a tirar ese caché para traer el número de hoy.
async function actualizarKObraEnVivo(obraKeyX) {
  delete kPorObra[obraKeyX];
  try {
    const k = await calcularKObra(obraKeyX);
    window.setRefK(k);
    refrescarFormulasVivas();
    // refrescarFormulasVivas() sólo redibuja si alguna CANTIDAD usaba "k"; un
    // material con PRECIO en "k" (ver precioUnitarioMaterial en calcCostos.js)
    // no pasa por ahí, así que se redibuja aparte para que el costo unitario
    // en pantalla quede al día igual.
    renderTodasLasLineas();
  } catch (_) { /* sin red: se queda con el último K conocido */ }
}

function escucharKObraEnVivo(obraKeyX) {
  window._fbListen(`/obras/${obraKeyX}/cargaFija/lineas`, () => actualizarKObraEnVivo(obraKeyX));
  window._fbListen(`/obras/${obraKeyX}/cargaFija/config`, () => actualizarKObraEnVivo(obraKeyX));
}

/* ===== Unidad de la vista: horas o jornadas (Equipos y Mano de Obra) =====

   El dato guardado es SIEMPRE en jornadas: `cantidad: 1` es un equipo (o un
   oficial) trabajando la jornada completa, que es lo que el motor multiplica
   por el costo diario / el jornal (ver calcCostoUnitarioItem en calcCostos.js).
   Esto sólo elige en qué unidad se LEE y se escribe esa cantidad en pantalla,
   igual que el toggle $/US$ del header no toca ningún importe guardado.

   Como el costo unitario se divide por la misma jornada por la que se
   multiplica la cantidad, el Costo total de cada línea —y con él los
   subtotales A y B y el Subtotal del A.P.— da exactamente igual en los dos
   modos: lo único que cambia es cómo se lee. */

const KEY_UNIDAD_AP = 'vimeco-ap-unidad';
let unidadCache = null;

function unidadAP() {
  if (unidadCache == null) {
    let guardado = null;
    try { guardado = localStorage.getItem(KEY_UNIDAD_AP); } catch (_) {}
    unidadCache = guardado === 'hs' ? 'hs' : 'jornada';
  }
  return unidadCache;
}

function setUnidadAP(u) {
  const v = u === 'hs' ? 'hs' : 'jornada';
  if (v === unidadAP()) return;
  unidadCache = v;
  try { localStorage.setItem(KEY_UNIDAD_AP, v); } catch (_) {}
  renderTodasLasLineas();
}

// Jornada de la obra de la pestaña activa (paramsMO se refresca por obra en
// activarVersion). Nunca 0: sería dividir por cero en toda la conversión.
function jornadaHorasActiva() {
  const jh = paramsMO && paramsMO.jornadaHoras;
  return jh && !isNaN(jh) && jh > 0 ? jh : DEFAULT_PARAMS_MO.jornadaHoras;
}

// Jornadas (el dato) -> lo que se muestra, y la vuelta. `unidad` fuerza una
// unidad puntual (una celda con fórmula se edita en la unidad de SU fórmula,
// no en la del switch — ver renderLineasSeccion).
// roundLimpio saca el ruido binario del producto/cociente (0.1+0.2), sin
// tocar la precisión real: sin él, convertir de ida y vuelta podría dejar un
// épsilon de diferencia y hacer que una celda que nadie tocó se re-guarde.
function aVista(cantidad, unidad) {
  if (cantidad == null || isNaN(cantidad)) return cantidad;
  return (unidad || unidadAP()) === 'hs' ? window.roundLimpio(cantidad * jornadaHorasActiva()) : cantidad;
}

function aDato(cantidad, unidad) {
  if (cantidad == null || isNaN(cantidad)) return cantidad;
  return (unidad || unidadAP()) === 'hs' ? window.roundLimpio(cantidad / jornadaHorasActiva()) : cantidad;
}

// Costo diario (equipo) o jornal (rol) -> costo por hora cuando la vista está
// en horas. Para Mano de Obra se divide el JORNAL completo, no el costoHorario
// del desglose: el jornal lleva además la comida del día sin prorratear
// (ver calcCostoManoDeObra), y sacarla acá haría que cantidad × costo unitario
// ya no diera el costo total de la línea.
function costoVista(costoDiario, unidad) {
  if (costoDiario == null || isNaN(costoDiario)) return costoDiario;
  return (unidad || unidadAP()) === 'hs' ? costoDiario / jornadaHorasActiva() : costoDiario;
}

// Encabezado de la columna de cantidad de Equipos y Mano de Obra: la unidad
// sola, que con "Costo unitario" y "Costo total" al lado se lee igual de bien
// que "Cantidad" y entra en el ancho de la columna.
const UNIDAD_LABEL = () => (unidadAP() === 'hs' ? 'Horas' : 'Jornadas');

// La unidad en la que se escribió la fórmula de una cantidad (cantidadUnidad,
// mismo criterio que precioFormulaMoneda en materiales). Sin fórmula no hay
// nada que anclar: el número se lee en la unidad del switch.
function unidadFormulaDe(linea) {
  if (linea && linea.cantidadFormula) return linea.cantidadUnidad === 'hs' ? 'hs' : 'jornada';
  return unidadAP();
}

// La unidad sólo se guarda si quedó una fórmula que la necesite: sin fórmula,
// la cantidad es un número en jornadas y punto (y así siguen todas las líneas
// cargadas hasta hoy, que no tienen el campo).
function unidadFormulaAGuardar(formula, unidadCelda) {
  return formula && unidadCelda === 'hs' ? 'hs' : null;
}

/* ===== Qué mide cada celda referenciable, para convertir una fórmula =====

   Una fórmula no se lee igual en las dos unidades, pero tampoco alcanza con
   multiplicarla entera por la jornada: hay términos que ya se convierten
   solos. js/unidadFormula.js hace la conversión término a término y necesita
   saber qué mide cada celda referenciada — acá está esa tabla, que es lo único
   de todo esto que sabe de A.P.

   +1 = una cantidad de tiempo (se lee 2 en jornadas y 16 en horas).
   -1 = algo POR unidad de tiempo (un costo diario pasa a costo por hora).
    0 = no depende del switch: el rendimiento (que siempre es por jornada), un
        costo total, los subtotales, y cualquier celda de otra pantalla. */
function gradoDeTiempoRef(id) {
  if (/^ap:(linea|mo):.+:cantidad$/.test(id)) return 1;
  if (/^ap:(linea|mo):.+:costoUnit$/.test(id)) return -1;
  if (id === 'ap:costoDiarioEquipos' || id === 'ap:costoDiarioMO') return -1;
  return 0;
}

// Cómo se muestra y se edita la cantidad de UNA línea con el switch donde
// está hoy: la fórmula reescrita en la unidad de la vista, y la unidad en la
// que finalmente quedó esa celda.
//
// Si la fórmula no se puede convertir (ver unidadFormula.js: no parsea, o no
// es una cantidad de tiempo, como "=[A · Cantidad]*[B · Cantidad]") la celda
// queda anclada a su unidad original y se avisa, que es preferible a
// convertirla mal en silencio.
function vistaDeCantidad(linea) {
  const uFormula = unidadFormulaDe(linea);
  const destino = unidadAP();
  const formula = linea && linea.cantidadFormula;
  if (!formula || uFormula === destino) return { formula: formula || null, unidad: destino, anclada: false };
  const convertida = window.convertirFormulaUnidad
    ? window.convertirFormulaUnidad(formula, jornadaHorasActiva(), destino === 'hs', gradoDeTiempoRef)
    : null;
  if (convertida == null) return { formula, unidad: uFormula, anclada: true };
  return { formula: convertida, unidad: destino, anclada: false };
}

function avisoOtraUnidad(unidadCelda) {
  if (unidadCelda === unidadAP()) return '';
  return unidadCelda === 'hs'
    ? `Esta fórmula no se puede reescribir en jornadas, así que se sigue leyendo y editando en horas.`
    : `Esta fórmula no se puede reescribir en horas, así que se sigue leyendo y editando en jornadas.`;
}


function labelFor(tipo, entidad) {
  if (tipo === 'material' || tipo === 'auxiliar') return entidad.nombre;
  if (tipo === 'equipo') return `${entidad.tipo || ''}${entidad.potencia ? ` ${entidad.potencia} HP` : ''}`.trim();
  return entidad.nombre;
}

function catalogoFor(tipo) {
  if (tipo === 'material') return materiales;
  if (tipo === 'equipo') return equipos;
  if (tipo === 'auxiliar') return auxiliaresDeObra;
  // El precio directo no sale de ningún catálogo: el número está en la propia
  // línea y el nombre/unidad son los del ítem (ver js/apDirecto.js).
  if (tipo === 'directo') return [];
  return roles;
}

/* Este A.P. tiene el costo cargado a mano desde el Cómputo. Mientras lo tenga
   no se le pueden agregar insumos: un ítem se costea de una forma o de la
   otra, y sumar las dos sería contar dos veces lo mismo. Se destraba borrando
   la línea con la "x". */
function hayPrecioDirecto() {
  return !!window.lineaDirectaDe(lineas);
}

function bloqueadoParaInsumos() {
  return !!window._soloLectura || hayPrecioDirecto();
}

// Auxiliares elegibles para una línea 'auxiliar' de ESTE A.P.: si el A.P. que
// se está editando es a su vez un auxiliar (esAuxiliar()), se excluyen los que
// —siguiendo su propia cadena de auxiliares-insumo— ya dependen de él, porque
// elegirlos cerraría un ciclo (A usa B, B ya usa A). `refKeyActual` (el
// elegido hoy en esta línea, si había uno) siempre queda en la lista aunque
// igualmente dependa de algo raro, para no hacer desaparecer una selección
// ya guardada.
function auxiliarDependeDe(auxKey, objetivoKey, visitados) {
  if (auxKey === objetivoKey) return true;
  if (visitados.has(auxKey)) return false;
  visitados.add(auxKey);
  const aux = auxiliaresDeObra.find(a => a.key === auxKey);
  if (!aux) return false;
  const it = allItemsFull[aux.itemKey];
  const version = it && it.versionesObra && it.versionesObra[activeVersion];
  if (!version || !version.lineas) return false;
  return Object.values(version.lineas).some(l =>
    l.tipo === 'auxiliar' && l.refKey && auxiliarDependeDe(l.refKey, objetivoKey, visitados));
}

function auxiliaresSeleccionables(refKeyActual) {
  if (!esAuxiliar()) return auxiliaresDeObra;
  // La key propia sale de `lineaVinculada` (la entrada real en
  // /obras/{obra}/auxiliares), no del parámetro `?aux=` de la URL: al navegar
  // entre A.P. con las flechas, `hrefParaLinea` ya prefiere `?key=` (el
  // itemKey) en cuanto el auxiliar tiene ítem creado — `keyLinea` quedaría
  // vacío en ese caso.
  const propiaKey = lineaVinculada && lineaVinculada.key;
  if (!propiaKey) return auxiliaresDeObra;
  return auxiliaresDeObra.filter(a =>
    a.key === refKeyActual || (a.key !== propiaKey && !auxiliarDependeDe(a.key, propiaKey, new Set())));
}

// Auxiliares de todas las obras salvo la activa, para poder traer uno como
// insumo (se copia a la obra activa, ver copiarAuxiliarDesdeObra). Sin fetch
// propio: `obrasFull` ya viene de /obras.json completo (loadAll), que trae
// cada obra con TODO su árbol anidado — auxiliares incluido — así que ya está
// en memoria.
function auxiliaresDeOtrasObras() {
  const lista = [];
  Object.entries(obrasFull).forEach(([obraK, o]) => {
    if (obraK === activeVersion) return;
    Object.entries(o.auxiliares || {}).forEach(([auxKey, a]) => {
      lista.push({ obraKey: obraK, auxKey, nombre: a.nombre || '(sin nombre)', unidad: a.unidad || '', itemKey: a.itemKey || null });
    });
  });
  return lista;
}

// Opciones listas para el buscador de una línea de auxiliar: las de la obra
// activa (con el filtro de ciclos de auxiliaresSeleccionables) + las de todas
// las demás obras, codificadas como "otraObra::{obraKey}::{auxKey}" — el
// onChange de la línea (renderLineasSeccion) detecta ese prefijo y copia el
// auxiliar antes de asignarlo, ver copiarAuxiliarDesdeObra.
function opcionesAuxiliar(refKeyActual) {
  const locales = auxiliaresSeleccionables(refKeyActual).map(a => ({
    value: a.key, label: a.nombre || '(sin nombre)', sublabel: a.unidad || '',
  }));
  const foraneas = auxiliaresDeOtrasObras().map(a => ({
    value: `otraObra::${a.obraKey}::${a.auxKey}`,
    label: a.nombre,
    sublabel: `${obrasMap[a.obraKey] || a.obraKey}${a.unidad ? ' · ' + a.unidad : ''}`,
  }));
  return locales.concat(foraneas);
}

// Cómo se lee una referencia a esta línea dentro de una fórmula (js/refs.js):
// el nombre de lo que tiene elegido, que es como la reconoce el usuario.
function etiquetaLinea(lineaKey) {
  const l = lineas[lineaKey];
  if (!l) return 'Línea';
  if (l.tipo === 'directo') return (item && item.nombre) || 'Ítem';
  const entidad = catalogoFor(l.tipo).find(c => c.key === l.refKey);
  return entidad ? labelFor(l.tipo, entidad) : 'Línea sin elegir';
}

// -- Auto-alta de ítem (línea de Cómputo sin itemKey todavía) --------------
// Ya no se busca/crea a mano: el AP de una línea se crea solo, con el
// nombre/unidad que tenga la línea en ese momento (pueden estar vacíos
// todavía, se completan después en el Cómputo). Mismo mecanismo que antes
// tenía vincularItem(), sin paso intermedio de búsqueda.

async function autoCrearYVincular() {
  // Si la línea ya tiene A.P., se va a ese y no se crea nada. Sin esto, un
  // link viejo o armado sin mirar el itemKey le crea un A.P. vacío y lo
  // repunta a él — la receta anterior queda huérfana en /items y la línea se
  // ve en blanco (pasó con el costo de un auxiliar usado como insumo).
  const lineaPrevia = await _fbGet(`/obras/${obraParam}/${nodoLinea}/${keyLinea}.json`);
  if (lineaPrevia && lineaPrevia.itemKey) {
    window.location.replace(`item.html?key=${encodeURIComponent(lineaPrevia.itemKey)}&obra=${encodeURIComponent(obraParam)}`);
    return;
  }
  const obraDataX = await _fbGet(`/obras/${obraParam}.json`);
  if (obraDataX && window.obraEsSoloLectura(obraDataX)) {
    document.body.innerHTML = `<p style="padding:2rem;">Esta obra está en modo lectura — no se puede crear un Análisis de Precio nuevo. Volvé al <a href="computo.html?obra=${encodeURIComponent(obraParam)}">Cómputo</a> y activá "Modo Edición" si necesitás editar.</p>`;
    return;
  }
  try {
    // El alta del ítem es la misma que hace la celda de costo del Cómputo al
    // cargar un precio directo — vive en js/apDirecto.js para que la key del
    // ítem no se genere de dos formas distintas.
    const key = await window.asegurarItemDeLinea(obraParam, nodoLinea, keyLinea);
    if (!key) throw new Error('la línea ya no existe');
    window.location.href = `item.html?key=${encodeURIComponent(key)}&obra=${encodeURIComponent(obraParam)}`;
  } catch (_) {
    document.body.innerHTML = '<p style="padding:2rem;">Error al crear el Análisis de Precio. Volvé al Cómputo e intentá de nuevo.</p>';
  }
}

// Sin línea de origen (se entró desde "Análisis de Precio" del menú): busca
// el primer A.P. del Cómputo de la obra, en el mismo orden que Cómputo, y
// redirige ahí — mismo mecanismo de "resolver e ir" que autoCrearYVincular.
async function irAlPrimerAP() {
  try {
    const [computoData, rubrosComputoData, auxiliaresData, obra] = await Promise.all([
      _fbGet(`/obras/${obraParam}/computo.json`),
      _fbGet(`/obras/${obraParam}/rubrosComputo.json`),
      _fbGet(`/obras/${obraParam}/auxiliares.json`),
      _fbGet(`/obras/${obraParam}.json`),
    ]);
    const ordenadas = window.numerarComputo(obra, rubrosComputoData, computoData).lineasEnOrden
      .concat(window.numerarAuxiliares(auxiliaresData).map(a => ({ ...a, aux: true })));
    if (!ordenadas.length) {
      document.body.innerHTML = `<p style="padding:2rem;">Este Cómputo todavía no tiene ítems cargados. <a href="computo.html?obra=${encodeURIComponent(obraParam)}">Ir a Cómputo</a>.</p>`;
      return;
    }
    window.location.replace(hrefParaLinea(ordenadas[0]));
  } catch (_) {
    document.body.innerHTML = '<p style="padding:2rem;">Error al buscar el primer Análisis de Precio. Volvé al Cómputo e intentá de nuevo.</p>';
  }
}

// -- Encabezado: nombre/unidad/numeración en vivo desde la línea de Cómputo -

// Si este AP tiene una línea propia en el Cómputo de esta obra (itemKey
// coincide), esa línea manda sobre nombre/unidad/numeración — no se editan
// más acá. Ítems legados sin línea propia (abiertos desde Biblioteca, o
// huérfanos) caen al comportamiento anterior (nombre/unidad del ítem,
// editables con "Editar datos").
let lineaVinculada = null;
let numeracionActiva = null;

// -- Navegación entre AP: recorre todas las líneas del Cómputo de esta obra
// en orden (cruzando de un rubro al siguiente), igual al orden que se ve en
// computo.html. Se arma junto con la numeración de esta línea. -------------
let lineasOrdenadas = [];   // [{ key, itemKey, numeracion }] — todas las líneas del Cómputo, en orden
let apNavIndex = -1;        // índice de esta línea dentro de lineasOrdenadas (-1 si no está)

// La numeración sale de js/numeracion.js, la misma que muestra el Cómputo.
function ubicarLineaYNumeracion(computoData, rubrosComputoData, auxiliaresData) {
  const todasLineas = Object.entries(computoData || {}).map(([key, l]) => ({ key, ...l }))
    .concat(Object.entries(auxiliaresData || {}).map(([key, l]) => ({ key, ...l, aux: true })));

  // Los análisis auxiliares van al final, numerados A1, A2… — no están en el
  // pliego, pero se recorren con las flechas igual que cualquier otro AP.
  lineasOrdenadas = window.numerarComputo(obrasFull[obraParam], rubrosComputoData, computoData)
    .lineasEnOrden
    .concat(window.numerarAuxiliares(auxiliaresData).map(a => ({ ...a, aux: true })))
    .map(l => ({ key: l.key, itemKey: l.itemKey || null, numeracion: l.codigo, nombre: l.nombre || '', aux: !!l.aux }));
  apNavIndex = lineasOrdenadas.findIndex(l => l.itemKey === itemKey);

  const entry = todasLineas.find(l => l.itemKey === itemKey);
  if (!entry) return;
  lineaVinculada = entry;
  numeracionActiva = apNavIndex !== -1 ? lineasOrdenadas[apNavIndex].numeracion : null;
}

// Este AP es el de un análisis auxiliar (vive en /obras/{obra}/auxiliares, no
// en el Cómputo): no es parte de la obra y no lleva Carga Fija.
function esAuxiliar() {
  return !!(lineaVinculada && lineaVinculada.aux);
}

// Vecina sin AP vinculado todavía: navega igual, a item.html?linea=...&obra=...
// (mismo modo que el ícono "Análisis de Precio" de una línea nueva en
// computo.html), que crea/vincula el ítem en el momento.
function hrefParaLinea(l) {
  return l.itemKey
    ? `item.html?key=${encodeURIComponent(l.itemKey)}&obra=${encodeURIComponent(obraParam)}`
    : `item.html?${l.aux ? 'aux' : 'linea'}=${encodeURIComponent(l.key)}&obra=${encodeURIComponent(obraParam)}`;
}

function renderApNav() {
  const prev = $('btn-ap-prev');
  const next = $('btn-ap-next');
  const mostrar = apNavIndex !== -1 && lineasOrdenadas.length > 1;
  prev.classList.toggle('hidden', !mostrar);
  next.classList.toggle('hidden', !mostrar);
  if (!mostrar) return;
  prev.disabled = apNavIndex <= 0;
  next.disabled = apNavIndex >= lineasOrdenadas.length - 1;
}

function irAApVecino(dir) {
  const destino = lineasOrdenadas[apNavIndex + dir];
  if (!destino) return;
  window.location.href = hrefParaLinea(destino);
}

// Menú terciario: tira de números de A.P. de toda la obra (mismo orden y
// mismos vecinos que las flechas de renderApNav), para saltar directo a
// cualquiera sin ir línea por línea.
function renderApTerciario() {
  const bar = $('ap-terciario-bar');
  const chips = $('ap-terciario-chips');
  if (lineasOrdenadas.length <= 1) {
    bar.classList.add('hidden');
    chips.innerHTML = '';
    return;
  }
  bar.classList.remove('hidden');
  chips.innerHTML = lineasOrdenadas.map((l, i) =>
    `<a class="ap-terciario-chip${i === apNavIndex ? ' active' : ''}" href="${hrefParaLinea(l)}" title="${escHtml(l.nombre || '(sin nombre)')}">${escHtml(l.numeracion || '—')}</a>`
  ).join('');
  const activo = chips.querySelector('.ap-terciario-chip.active');
  if (activo) activo.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function renderDatos() {
  if (lineaVinculada) {
    const nombre = lineaVinculada.nombre || '(sin nombre)';
    const unidad = lineaVinculada.unidad || '';
    const prefijo = numeracionActiva ? `<span class="ap-titulo-numero">${escHtml(numeracionActiva)}</span>` : '';
    $('header-item-nombre').textContent = (numeracionActiva ? numeracionActiva + '  ' : '') + nombre;
    $('item-titulo-card').innerHTML = prefijo + escHtml(nombre);
    $('item-datos-resumen').innerHTML = unidad ? `<span class="item-card-meta">Unidad: ${escHtml(unidad)}</span>` : '';
    $('btn-editar-datos').classList.add('hidden');
  } else {
    $('header-item-nombre').textContent = item.nombre;
    $('item-titulo-card').textContent = item.nombre;
    const rubroNombre = item.rubroKey && rubrosMap[item.rubroKey] ? rubrosMap[item.rubroKey] : 'Sin rubro';
    $('item-datos-resumen').innerHTML =
      `<span class="item-card-meta">${escHtml(rubroNombre)} · Unidad: ${escHtml(item.unidad)}</span>`;
    $('btn-editar-datos').classList.remove('hidden');
  }
}

// -- "Usar otro AP como base" — copia receta+rendimiento de otra obra ------

// allItemsFull: /items.json completo (todos los ítems, con sus
// versionesObra) — sólo para armar la lista de búsqueda de este modal.
let allItemsFull = {};

function opcionesUsarComoBase() {
  const opciones = [];
  Object.entries(allItemsFull).forEach(([key, it]) => {
    Object.entries(it.versionesObra || {}).forEach(([obraK, v]) => {
      if (key === itemKey && obraK === activeVersion) return; // no copiarse a sí mismo
      if (!v.lineas || !Object.keys(v.lineas).length) return; // nada para copiar
      opciones.push({ value: `${key}::${obraK}`, label: it.nombre || '(sin nombre)', sublabel: obrasMap[obraK] || obraK, unidad: it.unidad, version: v });
    });
  });
  return opciones.sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

// Botón + nota de procedencia de la receta. Se redibuja entero (y con él sus
// listeners) porque cambia al copiar una base y al saltar de versión de obra.
function renderUsarBase() {
  const wrap = $('ap-usar-base-wrap');
  const b = baseUsadaActiva;
  const ro = window._soloLectura ? 'disabled' : '';
  wrap.innerHTML = b
    ? `<div class="ap-base-nota">
         ${icSvg('copy')}
         <span class="ap-base-nota-texto">Se usó <strong>${escHtml(b.itemNombre || '(sin nombre)')}</strong>${b.unidad ? ` (unidad: ${escHtml(b.unidad)})` : ''}${b.obraNombre ? ` de <strong>${escHtml(b.obraNombre)}</strong>` : ''} como base${b.copiadoEn ? ` · ${fmtFechaCorta(b.copiadoEn)}` : ''}</span>
         <button class="btn btn-sm btn-outline" id="btn-usar-como-base" ${ro}>Cambiar</button>
         <button class="ap-base-nota-del" id="btn-quitar-base-nota" title="Quitar esta nota" ${ro}>${icSvg('x')}</button>
       </div>`
    : `<button class="btn btn-sm btn-outline" id="btn-usar-como-base" ${ro}>Usar otro AP como base</button>`;

  $('btn-usar-como-base').addEventListener('click', openUsarComoBaseModal);
  const del = $('btn-quitar-base-nota');
  if (del) del.addEventListener('click', quitarNotaBase);
}

// El catálogo de Mano de Obra de una obra cualquiera como array — es el
// formato que esperan las helpers de calcCostos.js, pero en obrasFull los
// roles vienen como mapa.
function rolesDeObra(obraK) {
  return Object.entries((obrasFull[obraK] || {}).roles || {})
    .map(([key, r]) => ({ key, ...r }));
}

// Familia de Mano de Obra que tiene decidida una versión de obra del A.P., o
// null si no la tiene decidida por ningún lado (A.P. sin Mano de Obra). El
// criterio es el del motor —guardada, o la de sus propias líneas— para que la
// pantalla muestre exactamente las líneas que el cálculo cuestea.
function familiaMOExplicita(v, obraK) {
  return window.familiaMOVigente(v, rolesDeObra(obraK));
}

// La familia con la que se muestra la sección de Mano de Obra. Un A.P. todavía
// vacío de Mano de Obra arranca en la familia elegida en la pantalla Mano de
// Obra de la obra (obra.familiaMO, ver mano-de-obra-obra.js): si la obra es
// vial, sus A.P. nuevos ya abren en Vial sin tener que tocar el switch.
function familiaMODeVersion(v, obraK) {
  return familiaMOExplicita(v, obraK)
    || (((obrasFull[obraK] || {}).familiaMO === 'vial') ? 'vial' : 'arquitectura');
}

// Switch Arquitectura/Vial de la sección Mano de Obra de este A.P. Mismo
// look que las pestañas de versión de obra (btn-primary = activa) para que
// se note a simple vista cuál está elegida.
// El switch hs / jornadas, uno solo para todo el A.P., al lado del
// rendimiento: Equipos y Mano de Obra se leen siempre en la misma unidad, así
// que tenerlo repetido en los dos encabezados era decir dos veces lo mismo.
// No se deshabilita en modo lectura: es una forma de leer, no una edición.
function renderUnidadSwitch() {
  const wrap = $('ap-unidad-switch');
  if (!wrap) return;
  const modo = unidadAP();
  const jh = fmtNum(jornadaHorasActiva());
  wrap.title = `Unidad con la que se cargan y se leen Equipos y Mano de Obra (jornada de ${jh} hs). No cambia ningún dato: todo se guarda en jornadas, y las fórmulas se reescriben para la unidad elegida.`;
  wrap.innerHTML = `<span>Equipos y M.O. en</span><span class="ap-unidad-seg">`
    + [['hs', 'Horas'], ['jornada', 'Jornadas']]
      .map(([u, label]) => `<button type="button" class="btn-unidad-ap${u === modo ? ' activa' : ''}" data-unidad="${u}">${label}</button>`)
      .join('')
    + `</span>`;
  wrap.querySelectorAll('.btn-unidad-ap').forEach(btn => {
    btn.addEventListener('click', () => setUnidadAP(btn.dataset.unidad));
  });
}

function renderFamiliaMOSwitch() {
  const wrap = $('mo-familia-switch-ap');
  if (!wrap) return;
  wrap.innerHTML = ['arquitectura', 'vial'].map(f => `
    <button class="btn btn-sm ${f === familiaMOActiva ? 'btn-primary' : 'btn-outline'} btn-familia-mo-ap" data-familia="${f}" ${window._soloLectura ? 'disabled' : ''}>${f === 'arquitectura' ? 'Arquitectura' : 'Vial'}</button>`).join('');
  wrap.querySelectorAll('.btn-familia-mo-ap').forEach(btn => {
    btn.addEventListener('click', () => cambiarFamiliaMO(btn.dataset.familia));
  });
}

// Un A.P. usa una sola familia a la vez: calcCostoUnitarioItem (calcCostos.js)
// no filtra por familia, así que si quedaran líneas de las dos se sumarían
// los dos costos de mano de obra juntos. Cambiar de familia con líneas
// cargadas de la otra las borra, con confirmación (mismo patrón que "Usar
// otro AP como base").
async function cambiarFamiliaMO(nueva) {
  if (guardBloqueoObra()) return;
  const rolesObra = (obrasFull[activeVersion] && obrasFull[activeVersion].roles) || {};
  // Las líneas de la otra familia, estén a la vista o no. No se mira
  // familiaMOActiva para juntarlas: un A.P. que quedó con las dos familias
  // cargadas tiene que poder limpiarse volviendo a elegir la que ya muestra.
  // Las de un rol que ya no existe en la obra se dejan como están — el motor
  // no las cuestea (ver lineasSinMOAjena), así que no inflan nada.
  const keysAPerder = Object.entries(lineas)
    .filter(([, l]) => l.tipo === 'manoDeObra' && l.refKey && rolesObra[l.refKey] &&
                       (rolesObra[l.refKey].familia || 'arquitectura') !== nueva)
    .map(([k]) => k);
  if (nueva === familiaMOActiva && !keysAPerder.length) return;

  if (keysAPerder.length) {
    const nombreOtra = nueva === 'vial' ? 'Arquitectura' : 'Vial';
    const nombreNueva = nueva === 'vial' ? 'Vial' : 'Arquitectura';
    const ok = await showConfirm('Cambiar de familia',
      `Este Análisis de Precio tiene ${keysAPerder.length} línea(s) de Mano de Obra de ${nombreOtra}. Un A.P. usa una sola familia a la vez: dejarlo en ${nombreNueva} las borra. ¿Continuar?`);
    if (!ok) return;
  }

  // Primero se borran las líneas de la otra familia y RECIÉN DESPUÉS se guarda
  // la familia nueva. Al revés —como estaba— un corte entre los dos pasos
  // dejaba el A.P. con la familia nueva guardada y las líneas viejas vivas:
  // invisibles en pantalla, porque sólo se listan las categorías de la familia
  // activa, y sumando igual en el costo. Si falla el borrado no se guarda
  // nada: el A.P. queda en su familia vieja, con todo a la vista, y volver a
  // intentar lo arregla.
  const lineasPrevias = lineas;
  const lineasLimpias = { ...lineas };
  keysAPerder.forEach(k => delete lineasLimpias[k]);
  lineas = lineasLimpias;
  try {
    await window.undoAgrupar('Cambiar familia de Mano de Obra', null, async () => {
      const recienCreada = await ensureVersionExists();
      if (!recienCreada) {
        if (!versionExisteEnServidor) throw new Error('no se pudo crear la versión de esta obra');
        if (keysAPerder.length) await _fbPut(`${basePath()}/lineas.json`, lineas);
      }
      await _fbPatch(`${basePath()}.json`, { familiaMO: nueva });
    });
    familiaMOActiva = nueva;
    versionesObra[activeVersion] = { ...(versionesObra[activeVersion] || {}), familiaMO: nueva, lineas };
  } catch (_) {
    lineas = lineasPrevias;
    showToast('No se pudo cambiar de familia. Volvé a intentar.', 'error');
  }
  renderFamiliaMOSwitch();
  renderTodasLasLineas();
}

function fmtFechaCorta(ts) {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

async function quitarNotaBase() {
  if (guardBloqueoObra()) return;
  const ok = await showConfirm('Quitar nota', '¿Quitar la nota de qué AP se usó como base? La receta copiada no se toca.');
  if (!ok) return;
  baseUsadaActiva = null;
  if (versionesObra[activeVersion]) delete versionesObra[activeVersion].baseUsada;
  renderUsarBase();
  try {
    await _fbPatch(`${basePath()}.json`, { baseUsada: null });
  } catch (_) {
    showToast('No se pudo quitar la nota. Intentá de nuevo.', 'error');
  }
}

function openUsarComoBaseModal() {
  const opciones = opcionesUsarComoBase();
  createSearchableSelect($('usar-base-select'), {
    options: opciones,
    value: null,
    placeholder: 'Buscar por análisis o por obra…',
    // Los nombres de AP son largos ("EJECUCION DE BOCACALLES DE Hº SIMPLE…") y
    // el sublabel es la obra: con el layout inline el nombre quedaba en una
    // columna de una palabra por renglón, ilegible.
    optionLayout: 'stacked',
    minWidth: 460,
    onChange: v => seleccionarUsarComoBase(v, opciones),
  });
  $('modal-usar-base').classList.remove('hidden');
}

// Al copiar mano de obra de OTRA obra, el refKey de cada línea apunta a la
// key de rol de la obra de origen — casi nunca existe en la obra destino
// (cada obra genera su propia key para las categorías que agrega por su
// cuenta, ver keyDeRol en mano-de-obra-obra.js). Las 6 categorías fijas
// (window.ROLES_FIJOS_MO, calcCostos.js) comparten key en cualquier obra, así
// que ésas calzan solas; para el resto se remapea por nombre — mismo
// criterio que ya usa "Importar de otra obra" en mano-de-obra-obra.js — y si
// no hay ninguna con ese nombre en el destino, se crea clonando el costo de
// origen. Devuelve cuántos roles nuevos tuvo que crear (para el toast).
async function remapearManoDeObra(lineasCopiadas, obraOrigenKey) {
  const rolesOrigen = (obrasFull[obraOrigenKey] && obrasFull[obraOrigenKey].roles) || {};
  const rolesDestino = { ...((obrasFull[activeVersion] && obrasFull[activeVersion].roles) || {}) };
  let creados = 0;

  for (const linea of Object.values(lineasCopiadas)) {
    if (linea.tipo !== 'manoDeObra') continue;
    const rolOrigen = rolesOrigen[linea.refKey];
    if (!rolOrigen) continue;              // dato inconsistente en origen: se deja como está
    if (rolesDestino[linea.refKey]) continue;   // misma key ya existe acá (típico en las 6 fijas)

    const matchKey = Object.keys(rolesDestino).find(k =>
      window.normNombreMO(rolesDestino[k].nombre) === window.normNombreMO(rolOrigen.nombre));
    if (matchKey) { linea.refKey = matchKey; continue; }

    const fijo = window.ROLES_FIJOS_MO.find(f => f.key === linea.refKey);
    const nuevaKey = fijo ? fijo.key
      : rolOrigen.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
          .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40) + '_' + Date.now() + '_' + creados;
    const nuevoRol = {
      nombre: rolOrigen.nombre,
      familia: rolOrigen.familia || 'arquitectura',
      basico: rolOrigen.basico ?? null,
      extraPct: rolOrigen.extraPct ?? 0,
      noRemunerativoMensual: rolOrigen.noRemunerativoMensual ?? null,
      fecha: rolOrigen.fecha || null,
      basicoFormula: rolOrigen.basicoFormula ?? null,
      extraPctFormula: rolOrigen.extraPctFormula ?? null,
      noRemunerativoMensualFormula: rolOrigen.noRemunerativoMensualFormula ?? null,
      creadoEn: Date.now(),
      // Último de la lista de esta obra. Sin `orden` cae al final igual, pero
      // ordenado alfabéticamente entre los otros que tampoco lo tengan (ver
      // window.rolesOrdenados): con el orden puesto queda donde se lo espera,
      // abajo de todo, y las flechas de la pantalla Mano de Obra lo mueven.
      orden: Object.values(rolesDestino).reduce((max, r) => (r.orden != null && r.orden > max ? r.orden : max), 0) + 1,
    };
    await _fbPut(`/obras/${activeVersion}/roles/${nuevaKey}.json`, nuevoRol);
    rolesDestino[nuevaKey] = nuevoRol;
    linea.refKey = nuevaKey;
    creados++;
  }

  obrasFull[activeVersion] = { ...(obrasFull[activeVersion] || {}), roles: rolesDestino };
  roles = window.rolesOrdenados(Object.entries(rolesDestino).map(([k, r]) => ({ key: k, ...r })));
  return creados;
}

// Trae un auxiliar de OTRA obra como insumo: como un auxiliar es una entidad
// propia de cada obra (ver memoria del proyecto), "traerlo" es copiarlo acá —
// se crea de cero en /obras/{activeVersion}/auxiliares, con su propio ítem
// fantasma, y por eso mismo pasa a listarse solo en la card "Análisis
// auxiliares" del Cómputo de esta obra. Si a su vez usa OTRO auxiliar como
// insumo, se copia también, recursivamente (confirmado con el dueño del
// proyecto: no se deja nada sin resolver).
//
// No hace falta pegarle a Firebase para LEER nada: `obrasFull` (loadAll) ya
// trae cada obra con su árbol completo —auxiliares incluidos— y
// `allItemsFull` ya trae todos los ítems con sus versionesObra. Sólo hacen
// falta los PUT de lo nuevo.
//
// `cache` (obraOrigen::auxKeyOrigen -> keyNuevaAcá) evita duplicar si el mismo
// auxiliar anidado aparece más de una vez en la cadena. `enCadena` es la pila
// de la copia en curso: si un auxiliar de origen ya estaba en camino, hay un
// ciclo en los DATOS de la obra de origen (no debería poder pasar — la propia
// obra de origen ya impide crear uno — pero es una red de seguridad para no
// colgarse); esa línea queda sin refKey en vez de recursar infinito.
async function copiarAuxiliarDesdeObra(obraOrigenKey, auxKeyOrigen, cache, enCadena) {
  const cacheKey = `${obraOrigenKey}::${auxKeyOrigen}`;
  if (cache[cacheKey]) return cache[cacheKey];
  if (enCadena.has(cacheKey)) return null;
  enCadena.add(cacheKey);

  const auxOrigen = ((obrasFull[obraOrigenKey] || {}).auxiliares || {})[auxKeyOrigen];
  if (!auxOrigen) return null;

  let nuevoItemKey = null;
  if (auxOrigen.itemKey) {
    const itemOrigen = allItemsFull[auxOrigen.itemKey];
    const versionOrigen = itemOrigen && itemOrigen.versionesObra && itemOrigen.versionesObra[obraOrigenKey];
    if (versionOrigen && versionOrigen.lineas && Object.keys(versionOrigen.lineas).length) {
      // Copia profunda: versionOrigen viene del caché en memoria (allItemsFull),
      // sin clonar se mutaría en vivo el objeto cacheado de la obra de origen.
      const lineasCopiadas = JSON.parse(JSON.stringify(versionOrigen.lineas));
      if (obraOrigenKey !== activeVersion) await remapearManoDeObra(lineasCopiadas, obraOrigenKey);

      for (const linea of Object.values(lineasCopiadas)) {
        if (linea.tipo === 'auxiliar' && linea.refKey) {
          linea.refKey = await copiarAuxiliarDesdeObra(obraOrigenKey, linea.refKey, cache, enCadena);
        }
      }

      const base = (itemOrigen.nombre || auxOrigen.nombre || 'aux').toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40);
      nuevoItemKey = base + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      const itemNuevo = {
        nombre: itemOrigen.nombre || auxOrigen.nombre || '',
        unidad: itemOrigen.unidad || auxOrigen.unidad || '',
        creadoEn: Date.now(),
      };
      const versionNueva = {
        rendimiento: versionOrigen.rendimiento || 1,
        rendimientoFormula: versionOrigen.rendimientoFormula || null,
        lineas: lineasCopiadas,
        familiaMO: familiaMOExplicita(versionOrigen, obraOrigenKey),
      };
      await _fbPut(`/items/${nuevoItemKey}.json`, itemNuevo);
      await _fbPut(`/items/${nuevoItemKey}/versionesObra/${activeVersion}.json`, versionNueva);
      // También al caché en memoria: el costo de una línea de auxiliar sale de
      // recalcular la receta de SU ítem (costoUnitarioAuxiliar, calcCostos.js),
      // que se busca en `allItemsFull`. Sin esto el auxiliar recién copiado se
      // ve con nombre y unidad pero sin costo, y recién aparece al recargar.
      allItemsFull[nuevoItemKey] = { ...itemNuevo, versionesObra: { [activeVersion]: versionNueva } };
    }
  }
  // Sin itemKey en origen (nunca se le cargó AP) o sin receta: se copia igual
  // el nombre/unidad, nuevoItemKey queda null — mismo estado "sin AP cargado"
  // que ya maneja la pantalla.

  const ordenes = auxiliaresDeObra.map(a => a.orden || 0);
  const nuevaKey = 'aux_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const nuevoAuxiliar = {
    nombre: auxOrigen.nombre || '',
    unidad: auxOrigen.unidad || '',
    cantidad: null,
    itemKey: nuevoItemKey,
    orden: ordenes.length ? Math.max(...ordenes) + 1 : 1,
    creadoEn: Date.now(),
    // Sólo dato de procedencia (mismo espíritu que `baseUsada` en la receta de
    // un ítem) — no condiciona ningún cálculo, no tiene UI propia todavía.
    copiadoDe: { obraNombre: obrasMap[obraOrigenKey] || obraOrigenKey, auxNombre: auxOrigen.nombre || '', copiadoEn: Date.now() },
  };
  await _fbPut(`/obras/${activeVersion}/auxiliares/${nuevaKey}.json`, nuevoAuxiliar);

  cache[cacheKey] = nuevaKey;
  auxiliaresDeObra = auxiliaresDeObra.concat([{ key: nuevaKey, ...nuevoAuxiliar }]);
  auxiliaresPorObra[activeVersion] = auxiliaresDeObra;
  return nuevaKey;
}

// Las líneas de tipo auxiliar de una receta que se copió de OTRA obra apuntan
// a una key de /obras/{origen}/auxiliares, que acá no existe: sin esto la
// línea queda señalando al vacío —sin nombre y sin costo— y el A.P. copiado
// sale más barato que el original sin avisar. Como un auxiliar es una entidad
// propia de cada obra, traer la receta es traerse también sus auxiliares, con
// su propia receta y sus anidados, igual que cuando se elige uno de otra obra
// a mano (traerAuxiliarDeOtraObra). Devuelve cuántos se crearon acá, contando
// los anidados, y muta `lineasCopiadas` repuntando cada refKey al nuevo.
async function copiarAuxiliaresDeLineas(lineasCopiadas, obraOrigenKey) {
  // Un solo cache/pila para todas las líneas: si dos líneas usan el mismo
  // auxiliar de origen —o dos auxiliares distintos comparten uno anidado— se
  // copia una sola vez y las dos apuntan a esa copia.
  const cache = {};
  const enCadena = new Set();
  for (const linea of Object.values(lineasCopiadas)) {
    if (linea.tipo !== 'auxiliar' || !linea.refKey) continue;
    linea.refKey = await copiarAuxiliarDesdeObra(obraOrigenKey, linea.refKey, cache, enCadena);
  }
  return Object.keys(cache).length;
}

// Dispara la copia desde el onChange de una línea de auxiliar que eligió una
// opción "otraObra::obraKey::auxKey" (ver opcionesAuxiliar/renderLineasSeccion).
async function traerAuxiliarDeOtraObra(lineaKey, obraOrigenKey, auxKeyOrigen) {
  if (guardBloqueoObra()) return;
  const nombreObra = obrasMap[obraOrigenKey] || obraOrigenKey;
  showToast(`Trayendo auxiliar de ${nombreObra}…`);
  try {
    const nuevaKey = await copiarAuxiliarDesdeObra(obraOrigenKey, auxKeyOrigen, {}, new Set());
    if (!nuevaKey) {
      showToast('No se pudo traer ese auxiliar.', 'error');
      renderTodasLasLineas();
      return;
    }
    updateLinea(lineaKey, { refKey: nuevaKey });
    showToast(`Auxiliar copiado desde ${nombreObra}.`);
  } catch (_) {
    showToast('Error al traer el auxiliar de otra obra.', 'error');
    renderTodasLasLineas();
  }
}

async function seleccionarUsarComoBase(value, opciones) {
  if (guardBloqueoObra()) return;
  const opt = opciones.find(o => o.value === value);
  if (!opt) return;
  $('modal-usar-base').classList.add('hidden');

  const cantidadPropia = Object.keys(lineas).length;
  if (cantidadPropia) {
    const ok = await showConfirm('Usar como base', `Esto reemplaza las ${cantidadPropia} línea(s) cargadas en este Análisis de Precio por la receta de "${opt.label}" (${opt.sublabel}). ¿Continuar?`);
    if (!ok) return;
  }

  const src = opt.version;
  const obraOrigenKey = opt.value.split('::')[1];
  // Copia profunda: lineas acá abajo viene del caché de /items.json en
  // memoria (allItemsFull) — sin clonar, editar esta versión mutaría en
  // vivo el objeto cacheado de la versión de origen.
  const lineasCopiadas = JSON.parse(JSON.stringify(src.lineas || {}));
  let rolesCreados = 0;
  let auxCopiados = 0;
  try {
    // Traer la receta de otra obra puede escribir bastante más que la receta:
    // las categorías de Mano de Obra que falten y los auxiliares que use, con
    // sus propios A.P. Un acto del usuario es un Ctrl+Z, así que todo eso va
    // agrupado. Raíces null: se toca /items, que es compartido entre obras
    // (ver CLAUDE.md), y reponer su foto pisaría lo que otro haya agregado.
    await window.undoAgrupar('Usar otro AP como base', null, async () => {
      if (obraOrigenKey !== activeVersion) {
        showToast(`Copiando la receta desde ${opt.sublabel}…`);
        rolesCreados = await remapearManoDeObra(lineasCopiadas, obraOrigenKey);
        auxCopiados = await copiarAuxiliaresDeLineas(lineasCopiadas, obraOrigenKey);
      }
      const data = {
        rendimiento: src.rendimiento || 1,
        rendimientoFormula: src.rendimientoFormula || null,
        lineas: lineasCopiadas,
        familiaMO: familiaMOExplicita(src, obraOrigenKey),
        // Queda registrado de dónde salió la receta: se muestra como nota en la
        // pantalla y sobrevive a la recarga. No condiciona ningún cálculo.
        baseUsada: { itemNombre: opt.label, obraNombre: opt.sublabel, unidad: opt.unidad || null, copiadoEn: Date.now() },
      };
      // PATCH y no PUT: `lineas` se reemplaza entero igual (es un hijo nombrado)
      // pero no se pierden los campos de la versión que no se están copiando,
      // como sinSeguridadCapataz.
      await _fbPatch(`${basePath()}.json`, data);
      versionesObra[activeVersion] = { ...(versionesObra[activeVersion] || {}), ...data };
      versionExisteEnServidor = true;
      lineas = data.lineas;
      rendimientoActivo = data.rendimiento;
      rendimientoFormulaActiva = data.rendimientoFormula;
      baseUsadaActiva = data.baseUsada;
      familiaMOActiva = familiaMODeVersion(versionesObra[activeVersion], activeVersion);
    });
    renderVersionTabs();
    renderVersionRendimiento();
    renderUsarBase();
    renderFamiliaMOSwitch();
    renderTodasLasLineas();
    showToast(`Receta copiada desde "${opt.label}" (${opt.sublabel}).`
      + (rolesCreados ? ` Se crearon ${rolesCreados} categoría${rolesCreados === 1 ? '' : 's'} de Mano de Obra en esta obra.` : '')
      + (auxCopiados ? ` Se copiaron ${auxCopiados} análisis auxiliar${auxCopiados === 1 ? '' : 'es'} a esta obra.` : ''));
  } catch (_) {
    showToast('Error al copiar la receta. Intentá de nuevo.', 'error');
  }
}

// -- Versiones de obra ------------------------------------------------------

function basePath() {
  return `/items/${itemKey}/versionesObra/${activeVersion}`;
}

// Sin ?obra= en la URL, entra a la versión de la obra más reciente que
// tenga este ítem (proxy: fecha de creación de la obra, las versiones no
// tienen fecha propia). Devuelve null si el ítem no tiene ninguna todavía.
function resolverVersionInicial() {
  if (obraParam) return obraParam;
  const keys = Object.keys(versionesObra);
  if (!keys.length) return null;
  return keys.reduce((mejor, k) => {
    const creadaK = (obrasFull[k] && obrasFull[k].creadaEn) || 0;
    const creadaMejor = (obrasFull[mejor] && obrasFull[mejor].creadaEn) || 0;
    return creadaK > creadaMejor ? k : mejor;
  }, keys[0]);
}

// Tiempo real: un listener sobre el nodo completo de la versión activa
// (basePath()), para que otra persona editando el mismo AP desde otra
// pestaña/dispositivo se vea reflejada sin recargar. `detenerListenerVersion`
// corta la suscripción anterior antes de abrir la de la versión recién
// activada — sin esto quedarían escuchando obras viejas al cambiar de pestaña.
let detenerListenerVersion = null;

function seccionDeElemento(el) {
  if (!el || !el.closest) return null;
  if (el.closest('#lineas-material')) return 'material';
  if (el.closest('#lineas-equipo')) return 'equipo';
  if (el.closest('#lineas-manoDeObra')) return 'manoDeObra';
  return null;
}

// Mezcla lo que llega del listener con el estado local sin pisar lo que se
// está escribiendo en este mismo momento: si hay foco en un input de una
// sección de líneas, esa sección se deja como está (se actualiza sola en el
// próximo blur, que ya dispara su propio render); si hay foco en el input de
// rendimiento, se deja ese campo como está. El resto sí se actualiza en vivo.
function aplicarSnapshotRemoto(dataCruda) {
  const data = dataCruda || {};
  const foco = document.activeElement;
  // Si el cambio lo produjo el propio Ctrl+Z (js/undo.js), no se preserva nada
  // de lo que esté en foco: lo que hay que mostrar es el valor que volvió.
  const undo = !!(window.undoRecienAplicado && window.undoRecienAplicado());
  const seccionEnEdicion = undo ? null : seccionDeElemento(foco);
  const editandoRendimiento = !undo && foco && foco.id === 'rend-obra-input';

  if (!editandoRendimiento) {
    rendimientoActivo = data.rendimiento ?? 1;
    rendimientoFormulaActiva = data.rendimientoFormula || null;
  }
  sinSeguridadCapatazActivo = !!data.sinSeguridadCapataz;
  baseUsadaActiva = data.baseUsada || null;
  familiaMOActiva = familiaMODeVersion(data, activeVersion);

  const lineasRemotas = data.lineas || {};
  if (seccionEnEdicion) {
    // La sección "material" en pantalla incluye también las líneas tipo
    // 'auxiliar' (ver renderLineasSeccion) — sin esto, editar un auxiliar
    // mientras llega un snapshot remoto lo pisaría con la versión vieja.
    const esDeLaSeccion = l => l.tipo === seccionEnEdicion ||
      (seccionEnEdicion === 'material' && (l.tipo === 'auxiliar' || l.tipo === 'directo'));
    const propias = Object.fromEntries(Object.entries(lineas).filter(([, l]) => esDeLaSeccion(l)));
    const ajenas = Object.fromEntries(Object.entries(lineasRemotas).filter(([, l]) => !esDeLaSeccion(l)));
    lineas = { ...ajenas, ...propias };
  } else {
    lineas = lineasRemotas;
  }

  versionesObra[activeVersion] = { ...(versionesObra[activeVersion] || {}), ...data };
  // Si el nodo todavía no existe en el servidor (dataCruda === null), no se toca
  // versionExisteEnServidor: sigue en false hasta que ensureVersionExists() lo
  // cree entero con el primer guardado (rendimiento + lineas juntos).
  if (dataCruda) versionExisteEnServidor = true;

  renderVersionTabs();
  if (!editandoRendimiento) renderVersionRendimiento();
  renderUsarBase();
  renderFamiliaMOSwitch();
  renderTodasLasLineas(seccionEnEdicion ? [seccionEnEdicion] : []);
}

// Auxiliares de una obra puntual, cacheados por obraKey (mismo criterio que
// kPorObra): item.html normalmente sólo tiene una obra activa (llega ya
// cargada desde loadAll), esto sólo pega un fetch extra en el caso legado de
// un ítem con versión en más de una obra (ver renderVersionTabs).
async function cargarAuxiliaresObra(key) {
  if (auxiliaresPorObra[key]) return auxiliaresPorObra[key];
  const data = await _fbGet(`/obras/${key}/auxiliares.json`);
  const arr = Object.entries(data || {}).map(([k, a]) => ({ key: k, ...a }));
  auxiliaresPorObra[key] = arr;
  return arr;
}

function activarVersion(key) {
  if (detenerListenerVersion) { detenerListenerVersion(); detenerListenerVersion = null; }
  activeVersion = key;
  const obraActiva = obrasFull[key];
  paramsEquipos = { ...DEFAULT_PARAMS_EQUIPOS, ...((obraActiva && obraActiva.paramsEquipos) || {}) };
  paramsMO = { ...DEFAULT_PARAMS_MO, ...((obraActiva && obraActiva.paramsMO) || {}) };
  dolarObraActivo = (obraActiva && obraActiva.dolar) ? obraActiva.dolar.valor : null;
  window.setCotizacionObra(dolarObraActivo);
  roles = window.rolesOrdenados(Object.entries((obraActiva && obraActiva.roles) || {}).map(([k, r]) => ({ key: k, ...r })));
  auxiliaresDeObra = auxiliaresPorObra[key] || [];
  if (!auxiliaresPorObra[key]) {
    cargarAuxiliaresObra(key).then(arr => {
      if (activeVersion === key) { auxiliaresDeObra = arr; renderTodasLasLineas(); }
    });
  }
  const v = versionesObra[key];
  if (v) {
    lineas = v.lineas || {};
    rendimientoActivo = v.rendimiento;
    rendimientoFormulaActiva = v.rendimientoFormula;
    sinSeguridadCapatazActivo = !!v.sinSeguridadCapataz;
    baseUsadaActiva = v.baseUsada || null;
    familiaMOActiva = familiaMODeVersion(v, key);
    versionExisteEnServidor = true;
  } else {
    // No existe todavía para esta obra: arranca vacía, con 1 como punto de
    // partida editable (mismo default que se usa al crear un ítem nuevo).
    lineas = {};
    rendimientoActivo = 1;
    rendimientoFormulaActiva = null;
    sinSeguridadCapatazActivo = false;
    baseUsadaActiva = null;
    familiaMOActiva = familiaMODeVersion(null, key);
    versionExisteEnServidor = false;
  }
  renderVersionTabs();
  renderVersionRendimiento();
  renderUsarBase();
  renderFamiliaMOSwitch();
  renderTodasLasLineas();
  calcularKObra(key).then(() => { if (activeVersion === key) renderTodasLasLineas(); });
  // Notas del AP: módulo aparte (js/postits.js), no toca lineas/rendimiento ni
  // el motor de cálculo. Se reinicia cada vez que cambia la obra activa.
  if (window._postitsInit) window._postitsInit($('postits-grid'), { itemKey, basePath: basePath() });
  detenerListenerVersion = window._fbListen(basePath(), snap => {
    if (activeVersion !== key) return;
    aplicarSnapshotRemoto(snap);
  });
}

// Sólo se muestran pestañas cuando el ítem tiene versión en más de una obra
// (caso legado, ver memoria) — el caso normal de acá en más es 1 AP por
// línea, con una única versión, sin nada que elegir.
function renderVersionTabs() {
  const tabs = Object.keys(versionesObra).map(k => ({ key: k, label: obrasMap[k] || k }));
  if (obraParam && !versionesObra[obraParam]) tabs.push({ key: obraParam, label: (obrasMap[obraParam] || obraParam) + ' (nueva)' });

  const tabsEl = $('version-tabs');
  if (tabs.length <= 1) {
    tabsEl.innerHTML = '';
    tabsEl.classList.add('hidden');
  } else {
    tabsEl.classList.remove('hidden');
    tabsEl.innerHTML = tabs.map(t => `
      <button class="btn btn-sm ${t.key === activeVersion ? 'btn-primary' : 'btn-outline'} version-tab" data-version="${escHtml(t.key)}">${escHtml(t.label)}</button>`).join('');
    tabsEl.querySelectorAll('.version-tab').forEach(btn => {
      btn.addEventListener('click', () => activarVersion(btn.dataset.version));
    });
  }

  const aviso = $('version-aviso');
  if (!versionExisteEnServidor) {
    aviso.textContent = 'Esta obra todavía no tiene una versión propia — se crea en cuanto edites algo.';
    aviso.classList.remove('hidden');
  } else {
    aviso.classList.add('hidden');
  }
}

// Unidad del ítem, para leer el rendimiento como "m³/jornada" en vez de un
// "uds." que no dice nada. Un A.P. abierto desde una línea de Cómputo (o
// desde un auxiliar) tiene su unidad en la línea; uno abierto desde la
// Biblioteca, en el ítem. Mismo par que usa renderDatos.
function unidadItem() {
  const u = (lineaVinculada && lineaVinculada.unidad) || (item && item.unidad) || '';
  return u.trim() || 'uds.';
}

function renderVersionRendimiento() {
  const wrap = $('version-rendimiento');
  wrap.classList.remove('hidden');
  wrap.innerHTML = `<span>Rendimiento en esta obra:</span>
    <input type="text" class="form-control" id="rend-obra-input" style="max-width:140px;"${calcAttrs(rendimientoActivo, 'ap:rendimiento', 'Rendimiento')} ${window._soloLectura ? 'disabled' : ''}>
    <span>${escHtml(unidadItem())}/jornada</span>
    <span class="ap-unidad-mini" id="ap-unidad-switch"></span>`;
  renderUnidadSwitch();
  const input = $('rend-obra-input');
  attachCalcInput(input, rendimientoFormulaActiva);
  attachValorInput(input, rendimientoActivo);
  input.addEventListener('blur', () => {
    if (guardBloqueoObra()) return;
    const n = valorCampo(input);
    const formula = getCalcFormula(input);
    if (n == null || isNaN(n) || n <= 0) { setValorCampo(input, rendimientoActivo); return; }
    if (n === rendimientoActivo && formula === (rendimientoFormulaActiva || null)) return;
    rendimientoActivo = n;
    rendimientoFormulaActiva = formula;
    persistRendimiento({ rendimiento: n, rendimientoFormula: rendimientoFormulaActiva });
    renderTodasLasLineas();
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
}

// Calcula (una sola vez por render) el costo agregado y el detalle por
// línea de la versión activa — lo usan tanto el resumen como cada sección
// de líneas, para no repetir el cálculo.
function calcularDetalleActivo() {
  const catalogos = {
    materiales, equipos, roles, auxiliares: auxiliaresDeObra,
    items: Object.entries(allItemsFull).map(([key, it]) => ({ key, ...it })),
    obraKey: activeVersion,
  };
  const preciosObra = window.resolverPreciosObra(materiales, activeVersion);
  const r = window.calcCostoUnitarioItem({ rendimiento: rendimientoActivo, sinSeguridadCapataz: sinSeguridadCapatazActivo, familiaMO: familiaMOActiva }, lineas, catalogos, paramsEquipos, paramsMO, preciosObra, dolarObraActivo);
  detallePorLineaActivo = r.detallePorLinea;
  return r;
}

// Orden A (Equipos) → B (Mano de Obra) → C (Materiales) → Subtotal,
// mismo criterio que la planilla de referencia (CyP Taller Río Cuarto.xlsx).
function renderResumenCosto(r) {
  const card = $('resumen-card');
  if (!r) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  // Un análisis auxiliar no lleva Carga Fija: su resultado es el Subtotal, que
  // es el costo que después se copia a mano a Carga Fija o a otro AP.
  const k = esAuxiliar() ? undefined : kPorObra[activeVersion];
  const precioUnitarioHtml = k
    ? `<div class="ap-resumen-row total"><span>Precio Unitario</span><span${calcAttrs(r.costoUnitario * k, 'ap:precioUnitario', 'Precio Unitario')}>${fmtARS(r.costoUnitario * k)}</span></div>
       <p class="form-hint" style="margin-top:.4rem;">Precio Unitario = Subtotal × <a href="carga-fija.html?obra=${encodeURIComponent(activeVersion)}" target="_blank" rel="noopener">Carga Fija</a> (${fmtK(k)}) de esta obra.</p>`
    : k === null
      ? `<p class="form-hint" style="margin-top:.4rem;">No se pudo calcular el Precio Unitario — a esta obra le falta Cómputo o <a href="carga-fija.html?obra=${encodeURIComponent(activeVersion)}" target="_blank" rel="noopener">Carga Fija</a> cargada.</p>`
      : '';
  $('resumen').innerHTML = `
    <div class="ap-resumen-row"><span>Costo unitario de Equipos (A)</span><span${calcAttrs(r.costoUnitarioEquipos, 'ap:resumen:equipos', 'Costo unitario de Equipos (A)')}>${fmtARS(r.costoUnitarioEquipos)}</span></div>
    <div class="ap-resumen-row"><span>Costo unitario Mano de Obra (B)</span><span${calcAttrs(r.costoUnitarioMO, 'ap:resumen:manoDeObra', 'Costo unitario Mano de Obra (B)')}>${fmtARS(r.costoUnitarioMO)}</span></div>
    <div class="ap-resumen-row"><span>Costo unitario de Materiales (C)</span><span${calcAttrs(r.costoMateriales, 'ap:resumen:materiales', 'Costo unitario de Materiales (C)')}>${fmtARS(r.costoMateriales)}</span></div>
    <div class="ap-resumen-row total"><span>SUBTOTAL (A+B+C)</span><span${calcAttrs(r.costoUnitario, 'ap:resumen:subtotal', 'SUBTOTAL (A+B+C)')}>${fmtARS(r.costoUnitario)}</span></div>
    <p class="form-hint" style="margin-top:.4rem;">Costo de referencia con precios generales — no incluye Gastos Generales ni beneficio.</p>
    ${precioUnitarioHtml}`;
}

// Si la versión activa (de obra) todavía no existe en el servidor, la crea
// entera (rendimiento + receta actual) antes de cualquier edición puntual —
// así arranca siempre como copia completa de la teórica, no sólo con el
// campo que se acaba de tocar. Devuelve true si la acabó de crear (en ese
// caso el llamador no necesita hacer ningún otro write, ya quedó todo
// guardado).
async function ensureVersionExists() {
  if (versionExisteEnServidor) return false;
  try {
    const data = { rendimiento: rendimientoActivo, rendimientoFormula: rendimientoFormulaActiva, lineas };
    if (sinSeguridadCapatazActivo) data.sinSeguridadCapataz = true;
    await _fbPut(`${basePath()}.json`, data);
    versionesObra[activeVersion] = data;
    versionExisteEnServidor = true;
    renderVersionTabs();
    return true;
  } catch (_) {
    showToast('Error al crear la versión de esta obra.', 'error');
    return false;
  }
}

async function persistRendimiento(cambios) {
  const justCreated = await ensureVersionExists();
  if (justCreated) return;
  try {
    await _fbPatch(`${basePath()}.json`, cambios);
    versionesObra[activeVersion] = { ...versionesObra[activeVersion], ...cambios };
  } catch (_) {
    showToast('Error al guardar el rendimiento.', 'error');
  }
}

// Excluye/restaura el adicional de Seguridad y Capataz sólo para este AP,
// aunque esté activo en los parámetros de la obra. Ausencia del campo =
// incluido (comportamiento normal) — PATCH con null lo borra en vez de
// dejar un "false" colgado.
async function toggleSinSeguridadCapataz(excluir) {
  if (guardBloqueoObra()) return;
  sinSeguridadCapatazActivo = excluir;
  renderTodasLasLineas();
  const justCreated = await ensureVersionExists();
  if (justCreated) return;
  try {
    await _fbPatch(`${basePath()}.json`, { sinSeguridadCapataz: excluir ? true : null });
    versionesObra[activeVersion] = { ...versionesObra[activeVersion], sinSeguridadCapataz: excluir || undefined };
  } catch (_) {
    showToast('Error al guardar.', 'error');
  }
}

/* ===== Orden de las líneas dentro de una sección =====
   Materiales y Equipos se ordenan a mano, con las flechas ↑/↓ o arrastrando
   la fila — mismo gesto que el Cómputo o los conceptos de Carga Fija. Cada
   sección lleva su propia secuencia en el campo `orden` de la línea (la de
   Materiales incluye a los auxiliares usados como insumo, que se ven ahí
   mismo). Mano de Obra no entra: sus filas son las categorías del catálogo de
   la obra, y su orden se define en esa pantalla (window.rolesOrdenados).

   Las recetas viejas no tienen `orden`: se siguen viendo como antes (ver
   window.lineasApOrdenadas) y se numeran enteras la primera vez que se mueve
   algo, así no queda media lista con orden y media sin. */
const TIPOS_DE_SECCION = { material: ['material', 'auxiliar', 'directo'], equipo: ['equipo'] };

function entradasSeccion(tipo) {
  return window.lineasApOrdenadas(lineas, TIPOS_DE_SECCION[tipo] || [tipo]);
}

// Renumera de 1 a n las líneas de la sección y guarda. Un solo PUT de la
// receta (persistLineas), así mover una línea es un solo paso de Ctrl+Z.
function persistirOrdenSeccion(keysEnOrden) {
  let huboCambio = false;
  keysEnOrden.forEach((key, i) => {
    if (!lineas[key]) return;
    if (lineas[key].orden !== i + 1) huboCambio = true;
    lineas[key] = { ...lineas[key], orden: i + 1 };
  });
  if (!huboCambio) return;
  renderTodasLasLineas();
  persistLineas();
}

function moverLineaAp(tipo, lineaKey, dir) {
  if (guardBloqueoObra()) return;
  const keys = entradasSeccion(tipo).map(([k]) => k);
  const idx = keys.indexOf(lineaKey);
  const otro = idx + dir;
  if (idx < 0 || otro < 0 || otro >= keys.length) return;
  [keys[idx], keys[otro]] = [keys[otro], keys[idx]];
  persistirOrdenSeccion(keys);
}

function persistirOrdenDesdeDom(container) {
  if (guardBloqueoObra()) return;
  persistirOrdenSeccion([...container.querySelectorAll('.ap-linea[data-key]')].map(row => row.dataset.key));
}

/* Arrastrar para reordenar, igual que en Carga Fija y Datos de obra: el
   contenedor escucha `dragover` una sola vez (el nodo no se recrea entre
   renders, sólo su innerHTML) y va moviendo la fila arrastrada en el DOM para
   el feedback visual; recién en `dragend` se lee el orden final del DOM y se
   persiste. */
let draggedApKey = null;

function filaApDespuesDe(container, y) {
  const filas = [...container.querySelectorAll('.ap-linea[data-key]:not(.dragging)')];
  return filas.reduce((masCercana, fila) => {
    const box = fila.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > masCercana.offset) return { offset, elemento: fila };
    return masCercana;
  }, { offset: -Infinity, elemento: null }).elemento;
}

function engancharDragSeccion(tipo, container) {
  if (container.dataset.dragEnganchado) return;
  container.dataset.dragEnganchado = '1';
  container.addEventListener('dragover', e => {
    if (!draggedApKey || !lineas[draggedApKey]) return;
    // Una fila sólo se puede soltar en su propia sección: un material no es
    // un equipo, y cada sección numera su `orden` por separado.
    if ((TIPOS_DE_SECCION[tipo] || []).indexOf(lineas[draggedApKey].tipo) < 0) return;
    e.preventDefault();
    const dragging = container.querySelector('.ap-linea.dragging');
    if (!dragging) return;
    const despuesDe = filaApDespuesDe(container, e.clientY);
    // Soltar al final es antes de los subtotales de la sección, que están en
    // el mismo contenedor y tienen que quedar siempre abajo de todo.
    container.insertBefore(dragging, despuesDe || container.querySelector('.ap-subtotal-linea'));
  });
}

/* La fila del precio directo. No lleva buscador: el nombre y la unidad son los
   del ítem (no se guardan en la línea, así renombrarlo no deja una copia
   vieja), la cantidad es 1 fija —el costo unitario del ítem ES este número— y
   lo editable es el precio. La "x" la borra y deja el A.P. vacío, listo para
   armarlo en detalle.

   En vista US$ el precio se muestra como texto, igual que en el Cómputo: todo
   se guarda en pesos y los campos editables quedan afuera del toggle. */
function filaPrecioDirecto(lineaKey, l) {
  const ro = !!window._soloLectura;
  const precio = l.precio != null && !isNaN(l.precio) ? Number(l.precio) : null;
  const etiqueta = etiquetaLinea(lineaKey);
  const attrsUnit = calcAttrs(precio, `ap:linea:${lineaKey}:costoUnit`, etiqueta + ' · Costo unit.');
  const celdaPrecio = (ro || window.monedaVista() === 'USD')
    ? `<span class="ap-linea-costo-unit"${attrsUnit}${ro ? '' : ' title="Pasá la vista a $ para editar el costo"'}>${precio != null ? fmtARS(precio) : '—'}</span>`
    : `<input type="text" class="form-control linea-precio-directo" placeholder="Costo" data-calc-id="ap:linea:${escHtml(lineaKey)}:costoUnit" data-calc-label="${escHtml(etiqueta + ' · Costo unit.')}">`;
  return `
    <div class="ap-linea con-costo ap-linea-directa" data-key="${escHtml(lineaKey)}">
      <div class="linea-select-wrap">
        <span class="ap-linea-directa-nombre" title="Costo cargado a mano desde el Cómputo, sin analizar el ítem">${escHtml((item && item.nombre) || 'Ítem')}</span>
        <span class="linea-unidad-badge">${escHtml((item && item.unidad) || '')}</span>
      </div>
      <span class="ap-linea-cantidad-fija">1</span>
      ${celdaPrecio}<span class="ap-linea-costo-total"${calcAttrs(precio, `ap:linea:${lineaKey}:costoTotal`, etiqueta + ' · Costo total')}>${precio != null ? fmtARS(precio) : '—'}</span>
      <span class="ap-linea-acciones">
        <button class="ap-linea-del" title="Borrar el costo cargado a mano y armar el análisis en detalle" ${ro ? 'disabled' : ''}>${icSvg('x')}</button>
      </span>
    </div>`;
}

function renderLineasSeccion(tipo, r) {
  const container = $(`lineas-${tipo}`);
  const cat = catalogoFor(tipo);
  // La sección "Materiales" muestra, además de sus propias líneas, las de
  // tipo 'auxiliar' — un auxiliar usado como insumo se comporta como un
  // material (cantidad fija por unidad de ítem, mismo bolsón de costo C) pero
  // tiene su propio catálogo/selector, ver renderTodasLasLineas.
  const entradas = entradasSeccion(tipo);

  // Equipos: desplegable, colapsado por defecto (la mayoría de los ítems no
  // llevan). Se abre solo mientras haya al menos una línea cargada, o si el
  // usuario lo despliega a mano con el chevron.
  if (tipo === 'equipo' && entradas.length) setEquiposExpandido(true);

  // Equipos se carga en la unidad del switch (horas o jornadas); Materiales
  // siempre en su propia unidad, que no tiene nada que ver con la jornada.
  const porJornada = tipo === 'equipo';
  const tituloCantidad = porJornada ? UNIDAD_LABEL() : 'Cantidad';

  let html = '';
  if (!entradas.length) {
    html += '<p class="text-muted" style="font-size:.85rem;">Sin líneas todavía.</p>';
  } else if (!cat.length && tipo !== 'material') {
    html += '<p class="text-muted" style="font-size:.85rem;">No hay catálogo cargado para este tipo.</p>';
  } else {
    html += `<div class="ap-linea ap-linea-header con-costo"><span></span><span>${tituloCantidad}</span><span>Costo unitario</span><span>Costo total</span><span></span></div>`;
    html += entradas.map(([lineaKey, l], idx) => {
      if (l.tipo === 'directo') return filaPrecioDirecto(lineaKey, l);
      const d = detallePorLineaActivo[lineaKey];
      const conBadge = tipo === 'material' || l.tipo === 'auxiliar';
      const ro = !!window._soloLectura;
      // El costo unitario se muestra Y se referencia en la unidad de la celda
      // de cantidad de su propia línea, así "cantidad × costo unitario = costo
      // total" se sigue leyendo derecho aunque esa celda quedara anclada.
      const uCelda = porJornada ? vistaDeCantidad(l).unidad : 'jornada';
      const costoUnitVista = d ? (porJornada ? costoVista(d.costoUnitario, uCelda) : d.costoUnitario) : null;
      return `
        <div class="ap-linea con-costo" data-key="${escHtml(lineaKey)}" draggable="${ro ? 'false' : 'true'}">
          <div class="linea-select-wrap">
            <div class="linea-select-container"></div>
            ${conBadge ? '<span class="linea-unidad-badge"></span>' : ''}
          </div>
          <input type="text" class="form-control linea-cantidad" placeholder="Cantidad" data-calc-id="ap:linea:${escHtml(lineaKey)}:cantidad" data-calc-label="${escHtml(etiquetaLinea(lineaKey) + ' · Cantidad')}" ${ro ? 'disabled' : ''}>
          <button type="button" class="ap-linea-costo-unit"${d ? calcAttrs(costoUnitVista, `ap:linea:${lineaKey}:costoUnit`, etiquetaLinea(lineaKey) + ' · Costo unit.') : ''}>${d ? fmtARS(costoUnitVista) : '—'}</button><span class="ap-linea-costo-total"${d && d.costoTotal != null ? calcAttrs(d.costoTotal, `ap:linea:${lineaKey}:costoTotal`, etiquetaLinea(lineaKey) + ' · Costo total') : ''}>${d && d.costoTotal != null ? fmtARS(d.costoTotal) : '—'}</span>
          <span class="ap-linea-acciones">
            <button class="ap-linea-mover" data-dir="-1" title="Subir" ${idx === 0 || ro ? 'disabled' : ''}>${icSvg('arrowUp')}</button>
            <button class="ap-linea-mover" data-dir="1" title="Bajar" ${idx === entradas.length - 1 || ro ? 'disabled' : ''}>${icSvg('arrowDown')}</button>
            <button class="ap-linea-del" title="Eliminar línea" ${ro ? 'disabled' : ''}>${icSvg('x')}</button>
          </span>
        </div>`;
    }).join('');
  }
  if (r) {
    html += tipo === 'material'
      ? `<div class="ap-subtotal-linea total"><span>Costo unitario de Materiales (C)</span><span${calcAttrs(r.costoMateriales, 'ap:costoMateriales', 'Costo unitario de Materiales (C)')}>${fmtARS(r.costoMateriales)}</span></div>`
      : `<div class="ap-subtotal-linea"><span>Costo ${unidadAP() === 'hs' ? 'por hora' : 'diario'} Equipos</span><span${calcAttrs(costoVista(r.costoDiarioEquipos), 'ap:costoDiarioEquipos', 'Costo diario Equipos')}>${fmtARS(costoVista(r.costoDiarioEquipos))}</span></div>
         <div class="ap-subtotal-linea total"><span>Costo unitario de Equipos (A)</span><span${calcAttrs(r.costoUnitarioEquipos, 'ap:costoUnitarioEquipos', 'Costo unitario de Equipos (A)')}>${fmtARS(r.costoUnitarioEquipos)}</span></div>`;
  }
  container.innerHTML = html;
  engancharDragSeccion(tipo, container);

  container.querySelectorAll('.ap-linea[data-key]').forEach(row => {
    const lineaKey = row.dataset.key;
    const linea = lineas[lineaKey];

    // La fila del precio directo no tiene buscador, ni cantidad, ni arrastre:
    // es la única línea que puede haber en la receta (ver filaPrecioDirecto).
    if (linea.tipo === 'directo') { engancharFilaDirecta(row, lineaKey, linea); return; }

    row.addEventListener('dragstart', () => { draggedApKey = lineaKey; row.classList.add('dragging'); });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      draggedApKey = null;
      persistirOrdenDesdeDom(container);
    });
    // Cada línea de la sección Materiales resuelve su PROPIO catálogo/tipo —
    // una fila puede ser 'material' o 'auxiliar' aunque las dos vivan en la
    // misma sección visual (ver el filtro de `entradas` más arriba).
    const tipoLinea = linea.tipo;
    const catLinea = catalogoFor(tipoLinea);
    const cantidadInput = row.querySelector('.linea-cantidad');

    // Cómo queda esta celda con el switch donde está hoy: la fórmula reescrita
    // en la unidad de la vista, y en qué unidad quedó (ver vistaDeCantidad).
    const vista = porJornada ? vistaDeCantidad(linea) : { formula: linea.cantidadFormula || null, unidad: 'jornada' };
    const unidadCelda = vista.unidad;

    // Una referencia a esta celda vale lo que la celda MUESTRA, no el dato en
    // jornadas: en modo Horas, "=[Retro · Cantidad]" son horas.
    cantidadInput.dataset.calcValor = porJornada
      ? aVista(linea.cantidad ?? 0, unidadCelda)
      : (linea.cantidad ?? 0);

    // Auxiliar: opciones ya resueltas (local + de otras obras), ver
    // opcionesAuxiliar — no sale de catalogoFor/labelFor como los demás tipos.
    const options = tipoLinea === 'auxiliar' ? opcionesAuxiliar(linea.refKey) : catLinea.map(c => ({
      value: c.key,
      label: labelFor(tipoLinea, c),
      sublabel: tipoLinea === 'material' ? c.unidad : undefined,
      usado: tipoLinea === 'equipo' ? equiposUsadosEnObra.has(c.key) : undefined,
    }));
    createSearchableSelect(row.querySelector('.linea-select-container'), {
      options,
      value: linea.refKey,
      placeholder: `Buscar ${tipoLinea === 'auxiliar' ? 'auxiliar' : tipoLinea}…`,
      onChange: v => {
        if (tipoLinea === 'auxiliar' && typeof v === 'string' && v.startsWith('otraObra::')) {
          const [, obraOrigenKey, auxKeyOrigen] = v.split('::');
          traerAuxiliarDeOtraObra(lineaKey, obraOrigenKey, auxKeyOrigen);
        } else {
          updateLinea(lineaKey, { refKey: v });
        }
      },
      onCreateNew: tipoLinea === 'material' ? texto => openQuickMaterialModal(texto, lineaKey)
        : tipoLinea === 'auxiliar' ? texto => openQuickAuxiliarModal(texto, lineaKey)
        : null,
      disabled: !!window._soloLectura,
    });
    if (tipoLinea === 'material') {
      const mat = materiales.find(m => m.key === linea.refKey);
      const badge = row.querySelector('.linea-unidad-badge');
      badge.textContent = mat ? mat.unidad : '';
      const costoUnit = row.querySelector('.ap-linea-costo-unit');
      if (costoUnit) {
        // Mirando una versión guardada el botón no lleva a ningún lado: su
        // modal es de edición, y el precio de esa versión ya está en la celda.
        // Los de equipo y auxiliar sí quedan, porque son de consulta.
        if (mat && !window.versionEnURL()) {
          costoUnit.title = 'Clic para ver/editar el precio de este material';
          costoUnit.addEventListener('click', () => openEditarPrecioModal(mat));
        } else {
          costoUnit.disabled = true;
        }
      }
    } else if (tipoLinea === 'auxiliar') {
      const aux = auxiliaresDeObra.find(a => a.key === linea.refKey);
      const badge = row.querySelector('.linea-unidad-badge');
      badge.textContent = aux ? (aux.unidad || '') : '';
      const costoUnit = row.querySelector('.ap-linea-costo-unit');
      if (costoUnit) {
        if (aux) {
          costoUnit.title = 'Clic para ver el Análisis de Precio de este auxiliar';
          // Con A.P. ya creado va directo a él (?key=); ?aux= es sólo para
          // crearlo la primera vez — ver autoCrearYVincular.
          costoUnit.addEventListener('click', () => abrirVentanaChica(aux.itemKey
            ? `item.html?key=${encodeURIComponent(aux.itemKey)}&obra=${encodeURIComponent(activeVersion)}`
            : `item.html?aux=${encodeURIComponent(aux.key)}&obra=${encodeURIComponent(activeVersion)}`));
        } else {
          costoUnit.disabled = true;
        }
      }
    } else if (tipoLinea === 'equipo') {
      const eq = equipos.find(e => e.key === linea.refKey);
      const costoUnit = row.querySelector('.ap-linea-costo-unit');
      if (costoUnit) {
        if (eq) {
          costoUnit.title = 'Clic para ver el detalle del costo diario de este equipo';
          costoUnit.addEventListener('click', () => openDetalleEquipoModal(eq));
        } else {
          costoUnit.disabled = true;
        }
      }
    }

    // La cantidad de un equipo se muestra y se escribe en la unidad de la
    // celda (ver vistaDeCantidad); lo que se guarda son siempre jornadas. La
    // comparación del blur va sobre el valor ya convertido: si no, pasar por
    // una celda sin tocarla la re-guardaría con la conversión de ida y vuelta.
    if (porJornada) {
      const aviso = avisoOtraUnidad(unidadCelda);
      if (aviso) {
        cantidadInput.title = aviso;
        cantidadInput.classList.add('celda-otra-unidad');
      }
    }
    attachCalcInput(cantidadInput, vista.formula);
    attachValorInput(cantidadInput, porJornada ? aVista(linea.cantidad ?? null, unidadCelda) : (linea.cantidad ?? null));
    cantidadInput.addEventListener('blur', () => {
      const leido = valorCampo(cantidadInput);
      const n = porJornada ? aDato(leido, unidadCelda) : leido;
      // La fórmula que ve el usuario puede ser la reescrita en la unidad de la
      // vista: si volvió igual, no la tocó, y se conserva la original tal como
      // se guardó — pasar por la celda no puede reescribirle la fórmula.
      const formula = getCalcFormula(cantidadInput);
      const intacta = formula === (vista.formula || null);
      const aGuardar = intacta ? (linea.cantidadFormula || null) : formula;
      const unidadAGuardar = intacta
        ? (linea.cantidadFormula ? (linea.cantidadUnidad || null) : null)
        : unidadFormulaAGuardar(formula, unidadCelda);
      if (n === (linea.cantidad ?? null) && aGuardar === (linea.cantidadFormula || null)) return;
      updateLinea(lineaKey, { cantidad: n, cantidadFormula: aGuardar, cantidadUnidad: unidadAGuardar });
    });
    cantidadInput.addEventListener('keydown', e => { if (e.key === 'Enter') cantidadInput.blur(); });
    row.querySelectorAll('.ap-linea-mover').forEach(btn => {
      btn.addEventListener('click', () => moverLineaAp(tipo, lineaKey, parseInt(btn.dataset.dir, 10)));
    });
    row.querySelector('.ap-linea-del').addEventListener('click', () => deleteLinea(lineaKey));
  });
}

function engancharFilaDirecta(row, lineaKey, linea) {
  row.querySelector('.ap-linea-del').addEventListener('click', () => deleteLinea(lineaKey));
  const input = row.querySelector('.linea-precio-directo');
  if (!input) return;
  const precio = linea.precio != null && !isNaN(linea.precio) ? Number(linea.precio) : null;
  const formulaPrevia = linea.precioFormula || null;
  input.dataset.calcValor = precio ?? 0;
  attachCalcInput(input, formulaPrevia);
  attachMoneyInput(input);
  attachValorInput(input, precio);
  input.addEventListener('blur', () => {
    const n = valorCampo(input);
    const formula = getCalcFormula(input);
    if (n === precio && formula === formulaPrevia) return;
    updateLinea(lineaKey, { precio: n, precioFormula: formula });
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
}

/* Los "+" de cada sección y el botón del precio directo son excluyentes: con
   el costo cargado a mano no se le agregan insumos al ítem, y con insumos
   cargados no se le puede poner un precio a mano. El hint dice por dónde se
   sale, así el botón apagado no queda mudo. */
function actualizarBotonesInsumos() {
  const directo = hayPrecioDirecto();
  const btnDirecto = $('btn-add-linea-directo');
  if (btnDirecto) {
    // Aparece sólo con la receta vacía: no tiene sentido ofrecerlo cuando ya
    // hay un precio cargado (se edita en la fila) ni cuando hay insumos.
    btnDirecto.classList.toggle('hidden', !!Object.keys(lineas).length || !!window._soloLectura);
  }
  const hint = directo ? 'Este ítem tiene un costo cargado a mano — borralo para armar el análisis en detalle' : '';
  ['btn-add-linea-material', 'btn-add-linea-auxiliar', 'btn-add-linea-equipo'].forEach(id => {
    const btn = $(id);
    if (!btn) return;
    btn.disabled = bloqueadoParaInsumos();
    btn.title = hint;
  });
}

// Mano de Obra no usa buscador: se muestran fijas TODAS las categorías del
// catálogo (roles), cada una con su cantidad para completar — no hace falta
// elegir "cuál" agregar porque ya están todas. Vaciar la cantidad borra esa
// línea (si existía); no afecta el costo de todas formas si queda vacía.
function renderManoDeObraSeccion(r) {
  const container = $('lineas-manoDeObra');
  const rolesDeLaFamilia = roles.filter(rol => (rol.familia || 'arquitectura') === familiaMOActiva);
  let html = '';
  if (!rolesDeLaFamilia.length) {
    html += '<p class="text-muted" style="font-size:.85rem;">No hay catálogo de Mano de Obra cargado todavía.</p>';
  } else {
    html += `<div class="ap-linea-mo ap-linea-header con-costo"><span></span><span>${UNIDAD_LABEL()}</span><span>Costo unitario</span><span>Costo total</span></div>`;
    html += rolesDeLaFamilia.map(rol => {
      const entry = Object.entries(lineas).find(([, l]) => l.tipo === 'manoDeObra' && l.refKey === rol.key);
      const cantidad = entry ? entry[1].cantidad : null;
      const d = entry ? detallePorLineaActivo[entry[0]] : null;
      // El costo unitario del rol (jornal) no depende de que ya haya una línea
      // cargada — se calcula igual para mostrarlo de referencia. costoTotal sí
      // requiere una línea con cantidad.
      const costoUnit = d ? d.costoUnitario : window.calcCostoManoDeObra(rol, paramsMO).costoJornal;
      const costoTotal = d ? d.costoTotal : null;
      // Misma regla que en Equipos: la cantidad y el costo unitario se
      // muestran —y se referencian— en la unidad en la que quedó esta celda.
      const uCelda = vistaDeCantidad(entry && entry[1]).unidad;
      const costoUnitVista = costoUnit != null ? costoVista(costoUnit, uCelda) : null;
      return `
        <div class="ap-linea-mo con-costo" data-rol="${escHtml(rol.key)}">
          <span class="ap-linea-mo-nombre">${escHtml(rol.nombre)}</span>
          <input type="text" class="form-control linea-cantidad" placeholder="Cantidad" data-calc-valor="${aVista(cantidad ?? 0, uCelda)}" data-calc-id="ap:mo:${escHtml(rol.key)}:cantidad" data-calc-label="${escHtml(rol.nombre + ' · Cantidad')}" ${bloqueadoParaInsumos() ? 'disabled' : ''}${hayPrecioDirecto() ? ' title="Este ítem tiene un costo cargado a mano — borralo para armar el análisis en detalle"' : ''}>
          <button type="button" class="ap-linea-costo-unit" title="Clic para ver el detalle del costo de esta categoría"${costoUnitVista != null ? calcAttrs(costoUnitVista, `ap:mo:${rol.key}:costoUnit`, rol.nombre + ' · Costo unit.') : ''}>${costoUnitVista != null ? fmtARS(costoUnitVista) : '—'}</button><span class="ap-linea-costo-total"${costoTotal != null ? calcAttrs(costoTotal, `ap:mo:${rol.key}:costoTotal`, rol.nombre + ' · Costo total') : ''}>${costoTotal != null ? fmtARS(costoTotal) : '—'}</span>
        </div>`;
    }).join('');
  }
  // Seguridad y Capataz: adicional opcional de la obra (paramsMO), % sobre
  // el costo diario de MO de este AP. Sólo aparece si está activo en la
  // obra y el AP tiene mano de obra cargada; se puede excluir puntualmente
  // por AP sin tocar el % ni el toggle general.
  const hayLineasMO = Object.values(lineas).some(l => l.tipo === 'manoDeObra' && l.cantidad);
  if (paramsMO.seguridadCapatazActivo && hayLineasMO) {
    if (sinSeguridadCapatazActivo) {
      html += `<div class="ap-subtotal-linea"><span>Seguridad y Capataz — excluido en este AP</span><button type="button" class="btn btn-sm btn-outline" id="btn-restaurar-seg-cap" ${window._soloLectura ? 'disabled' : ''}>Incluir</button></div>`;
    } else if (r) {
      html += `
        <div class="ap-linea-mo con-costo" data-extra="seguridadCapataz">
          <span class="ap-linea-mo-nombre">Seguridad y Capataz</span>
          <span class="ap-linea-costo-unit">${r.seguridadCapatazPctAplicado}%</span>
          <span class="ap-linea-costo-unit">—</span>
          <span class="ap-linea-costo-total">
            <span data-calc-valor="${costoVista(r.costoDiarioSeguridadCapataz)}">${fmtARS(costoVista(r.costoDiarioSeguridadCapataz))}</span>
            <button type="button" class="ap-linea-del" id="btn-excluir-seg-cap" title="Excluir de este AP" style="margin-left:.4rem;" ${window._soloLectura ? 'disabled' : ''}>${icSvg('x')}</button>
          </span>
        </div>`;
    }
  }
  if (r) {
    html += `<div class="ap-subtotal-linea"><span>Costo ${unidadAP() === 'hs' ? 'por hora' : 'diario'} Mano de Obra</span><span${calcAttrs(costoVista(r.costoDiarioMO), 'ap:costoDiarioMO', 'Costo diario Mano de Obra')}>${fmtARS(costoVista(r.costoDiarioMO))}</span></div>
      <div class="ap-subtotal-linea total"><span>Costo unitario Mano de Obra (B)</span><span${calcAttrs(r.costoUnitarioMO, 'ap:costoUnitarioMO', 'Costo unitario Mano de Obra (B)')}>${fmtARS(r.costoUnitarioMO)}</span></div>`;
  }
  container.innerHTML = html;

  const btnExcluirSegCap = container.querySelector('#btn-excluir-seg-cap');
  if (btnExcluirSegCap) btnExcluirSegCap.addEventListener('click', () => toggleSinSeguridadCapataz(true));
  const btnRestaurarSegCap = container.querySelector('#btn-restaurar-seg-cap');
  if (btnRestaurarSegCap) btnRestaurarSegCap.addEventListener('click', () => toggleSinSeguridadCapataz(false));

  container.querySelectorAll('.ap-linea-mo[data-rol]').forEach(row => {
    const rolKey = row.dataset.rol;
    const cantidadInput = row.querySelector('.linea-cantidad');
    const entry = Object.entries(lineas).find(([, l]) => l.tipo === 'manoDeObra' && l.refKey === rolKey);
    const linea = entry ? entry[1] : null;

    const rol = roles.find(r => r.key === rolKey);
    const costoUnit = row.querySelector('.ap-linea-costo-unit');
    if (costoUnit && rol) costoUnit.addEventListener('click', () => openDetalleRolModal(rol));

    // Misma conversión que en Equipos: se muestra y se escribe en la unidad de
    // la celda, se guarda en jornadas (ver vistaDeCantidad).
    const vista = vistaDeCantidad(linea);
    const unidadCelda = vista.unidad;
    const aviso = avisoOtraUnidad(unidadCelda);
    if (aviso) {
      cantidadInput.title = aviso;
      cantidadInput.classList.add('celda-otra-unidad');
    }
    attachCalcInput(cantidadInput, vista.formula);
    attachValorInput(cantidadInput, linea ? aVista(linea.cantidad ?? null, unidadCelda) : null);
    cantidadInput.addEventListener('blur', () => {
      if (cantidadInput.value.trim() === '') {
        if (entry) deleteLinea(entry[0]);
        return;
      }
      const leido = valorCampo(cantidadInput);
      if (leido == null || isNaN(leido)) { setValorCampo(cantidadInput, linea ? aVista(linea.cantidad ?? null, unidadCelda) : null); return; }
      const n = aDato(leido, unidadCelda);
      // Si la fórmula volvió igual a la que se le mostró, no la tocó: se
      // conserva la original, que puede estar escrita en la otra unidad.
      const formula = getCalcFormula(cantidadInput);
      const intacta = formula === (vista.formula || null);
      const aGuardar = intacta ? (linea && linea.cantidadFormula) || null : formula;
      const unidadAGuardar = intacta
        ? ((linea && linea.cantidadFormula) ? (linea.cantidadUnidad || null) : null)
        : unidadFormulaAGuardar(formula, unidadCelda);
      if (linea && n === (linea.cantidad ?? null) && aGuardar === (linea.cantidadFormula || null)) return;
      const lineaKey = entry ? entry[0] : `mo_${rolKey}`;
      updateLinea(lineaKey, { tipo: 'manoDeObra', refKey: rolKey, cantidad: n, cantidadFormula: aGuardar, cantidadUnidad: unidadAGuardar });
    });
    cantidadInput.addEventListener('keydown', e => { if (e.key === 'Enter') cantidadInput.blur(); });
  });
}

function setEquiposExpandido(abierto) {
  $('lineas-equipo').classList.toggle('hidden', !abierto);
  $('equipos-toggle').classList.toggle('expandido', abierto);
}

// Recién renderizado, cada celda del DOM tiene su valor de hoy: es el momento
// de recalcular las cantidades cuya fórmula apunta a otras celdas (js/refs.js).
// Tope de pasadas para cortar una referencia circular.
let pasadasVivas = 0;

function refrescarFormulasVivas() {
  if (!window.recalcularCeldasVivas) return;
  // Una fórmula se recalcula en la unidad en la que se está leyendo, con la
  // fórmula ya reescrita para esa unidad (ver vistaDeCantidad): las celdas del
  // DOM que referencia valen lo que muestran, así que evaluarla en la otra
  // unidad daría otro número. Recién el resultado se convierte a jornadas.
  const campos = Object.entries(lineas)
    .filter(([, l]) => window.formulaTieneRefs(l.cantidadFormula))
    .map(([lineaKey, l]) => ({ lineaKey, l, v: vistaDeCantidad(l) }))
    // Una celda que quedó anclada a la otra unidad no se recalcula: las celdas
    // del DOM que referencia valen lo de la vista, y su fórmula no se sabe
    // reescribir para leerlas ahí. Se conserva el último valor calculado —
    // igual que cuando una referencia quedó rota (ver recalcularCeldasVivas).
    .filter(({ v }) => !v.anclada)
    .map(({ lineaKey, l, v }) => ({
      formula: v.formula,
      valor: aVista(l.cantidad ?? null, v.unidad),
      aplicar: valor => { lineas[lineaKey].cantidad = aDato(valor, v.unidad); },
    }));
  if (!campos.length || !window.recalcularCeldasVivas(campos)) { pasadasVivas = 0; return; }
  if (++pasadasVivas > 10) {
    pasadasVivas = 0;
    showToast('Hay referencias circulares entre celdas — se detuvo el recálculo.', 'error');
    return;
  }
  persistLineas();
  renderTodasLasLineas();
}

function renderTodasLasLineas(seccionesOmitidas) {
  const omitir = seccionesOmitidas || [];
  renderUnidadSwitch();
  const r = calcularDetalleActivo();
  if (!omitir.includes('material')) renderLineasSeccion('material', r);
  if (!omitir.includes('equipo')) renderLineasSeccion('equipo', r);
  if (!omitir.includes('manoDeObra')) renderManoDeObraSeccion(r);
  actualizarBotonesInsumos();
  renderResumenCosto(r);
  refrescarFormulasVivas();
}

async function persistLineas() {
  const justCreated = await ensureVersionExists();
  if (justCreated) return;
  try {
    await _fbPut(`${basePath()}/lineas.json`, lineas);
  } catch (_) {
    showToast('Error al guardar la receta.', 'error');
  }
}

function updateLinea(lineaKey, cambios) {
  if (guardBloqueoObra()) return;
  lineas[lineaKey] = { ...lineas[lineaKey], ...cambios };
  renderTodasLasLineas();
  persistLineas();
}

function addLinea(tipo) {
  if (guardBloqueoObra()) return;
  /* El precio directo es uno solo por receta y va con key fija (ver
     js/apDirecto.js), así que no sigue el camino de las demás: es la misma
     línea que escribe la celda de costo del Cómputo. Nace vacía, esperando el
     número. */
  if (tipo === 'directo') {
    if (!window.apAceptaPrecioDirecto(lineas)) {
      showToast('Este ítem ya tiene insumos cargados — borralos para poner el costo a mano.', 'error');
      return;
    }
    lineas[window.LINEA_DIRECTA_KEY] = window.lineaDirectaNueva(null, null);
    renderTodasLasLineas();
    persistLineas();
    return;
  }
  if (bloqueadoParaInsumos()) {
    showToast('Este ítem tiene un costo cargado a mano — borralo para armar el análisis en detalle.', 'error');
    return;
  }
  if (tipo !== 'material' && !catalogoFor(tipo).length) {
    showToast('No hay nada cargado en ese catálogo todavía.', 'error');
    return;
  }
  const lineaKey = 'linea_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const seccion = tipo === 'equipo' ? 'equipo' : 'material';
  const yaEnOrden = entradasSeccion(seccion).map(([k]) => k);
  lineas[lineaKey] = { tipo, refKey: null, cantidad: null };
  // Va última de su sección (la de Materiales incluye a los auxiliares, ver
  // entradasSeccion). Se numera la sección entera y no sólo la nueva: en una
  // receta vieja sin `orden`, darle un 1 a la nueva la mandaría al principio,
  // porque las que no lo tienen van después (window.lineasApOrdenadas).
  [...yaEnOrden, lineaKey].forEach((k, i) => { lineas[k] = { ...lineas[k], orden: i + 1 }; });
  renderTodasLasLineas();
  persistLineas();
}

let pendingLineaKey = null;

function openQuickMaterialModal(texto, lineaKey) {
  pendingLineaKey = lineaKey;
  $('qm-nombre').value = texto || '';
  $('qm-unidad').value = '';
  $('qm-precio-usd').value = '';
  $('qm-precio-ars').value = '';
  setCalcFormula($('qm-precio-usd'), null);
  setCalcFormula($('qm-precio-ars'), null);
  $('qm-precio-nota').textContent = '';
  $('qm-proveedor').value = '';
  $('qm-fecha').value = new Date().toISOString().slice(0, 10);
  $('qm-precio-bloque').classList.remove('hidden');
  $('qm-precio-hint').textContent = `El precio se carga para la obra activa (${obrasMap[activeVersion] || activeVersion}).`;
  $('modal-material-error-qm').classList.add('hidden');
  $('modal-material-quick').classList.remove('hidden');
  setTimeout(() => $('qm-nombre').focus(), 50);
}

async function saveQuickMaterial() {
  if (guardBloqueoObra()) return;
  const nombre = $('qm-nombre').value.trim();
  const unidad = $('qm-unidad').value.trim();
  const errEl = $('modal-material-error-qm');

  if (!nombre || !unidad) {
    errEl.textContent = 'Nombre y unidad son requeridos.';
    errEl.classList.remove('hidden');
    return;
  }

  let precioData = null;
  {
    const proveedor = $('qm-proveedor').value.trim();
    const fecha = $('qm-fecha').value || new Date().toISOString().slice(0, 10);
    const usdInput = $('qm-precio-usd');
    const arsInput = $('qm-precio-ars');
    if (usdInput.value.trim().startsWith('=')) usdInput.blur();
    if (arsInput.value.trim().startsWith('=')) arsInput.blur();
    const precioUSD = parseMoneyString(usdInput.value);
    const precioARS = parseMoneyString(arsInput.value);
    if (isNaN(precioUSD) || precioUSD < 0 || isNaN(precioARS) || precioARS < 0) {
      errEl.textContent = 'El precio no es válido.';
      errEl.classList.remove('hidden');
      return;
    }
    const cotizacionUsada = window.dolarOficialVenta();
    if (!cotizacionUsada) {
      errEl.textContent = 'No se pudo obtener la cotización del dólar. Reintentá en un momento.';
      errEl.classList.remove('hidden');
      return;
    }
    const fc = getCalcFormulaConMoneda(usdInput, arsInput);
    precioData = { precioUSD, precioARS, precioFormula: fc.formula, precioFormulaMoneda: fc.moneda, proveedor, fecha, cotizacionUsada };
  }

  const key = nombre.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40)
    + '_' + Date.now();
  const materialData = { nombre, unidad, creadoEn: Date.now() };

  try {
    await _fbPut(`/materiales/${key}.json`, materialData);
    if (precioData) await _fbPut(`/materiales/${key}/precios/${activeVersion}.json`, precioData);
    materiales.push({ key, ...materialData, ...(precioData ? { precios: { [activeVersion]: precioData } } : {}) });
    materiales.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    $('modal-material-quick').classList.add('hidden');
    showToast('Material creado.');
    if (pendingLineaKey) updateLinea(pendingLineaKey, { refKey: key });
  } catch (_) {
    errEl.textContent = 'Error al guardar. Intentá de nuevo.';
    errEl.classList.remove('hidden');
  }
}

let pendingLineaKeyAux = null;

// Alta rápida de un auxiliar que todavía no existe en NINGUNA obra, desde el
// buscador de una línea de Materiales — mismo patrón que openQuickMaterialModal,
// sin precio (un auxiliar no lo tiene, se costea con su propio A.P. después).
function openQuickAuxiliarModal(texto, lineaKey) {
  pendingLineaKeyAux = lineaKey;
  $('qa-nombre').value = texto || '';
  $('qa-unidad').value = '';
  $('modal-auxiliar-error-qa').classList.add('hidden');
  $('modal-auxiliar-quick').classList.remove('hidden');
  setTimeout(() => $('qa-nombre').focus(), 50);
}

async function saveQuickAuxiliar() {
  if (guardBloqueoObra()) return;
  const nombre = $('qa-nombre').value.trim();
  const unidad = $('qa-unidad').value.trim();
  const errEl = $('modal-auxiliar-error-qa');

  if (!nombre || !unidad) {
    errEl.textContent = 'Nombre y unidad son requeridos.';
    errEl.classList.remove('hidden');
    return;
  }

  // Nace vacío y sin AP (itemKey null) — mismo estado que crearAuxiliar() en
  // computo.js: el AP se crea solo la primera vez que se abre desde su costo
  // (item.html?aux=..., ver autoCrearYVincular).
  const key = 'aux_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const ordenes = auxiliaresDeObra.map(a => a.orden || 0);
  const auxiliarData = { nombre, unidad, cantidad: null, itemKey: null, orden: ordenes.length ? Math.max(...ordenes) + 1 : 1, creadoEn: Date.now() };

  try {
    await _fbPut(`/obras/${activeVersion}/auxiliares/${key}.json`, auxiliarData);
    auxiliaresDeObra = auxiliaresDeObra.concat([{ key, ...auxiliarData }]);
    auxiliaresPorObra[activeVersion] = auxiliaresDeObra;
    $('modal-auxiliar-quick').classList.add('hidden');
    showToast('Auxiliar creado — armale su Análisis de Precio desde el costo de esta línea.');
    if (pendingLineaKeyAux) updateLinea(pendingLineaKeyAux, { refKey: key });
  } catch (_) {
    errEl.textContent = 'Error al guardar. Intentá de nuevo.';
    errEl.classList.remove('hidden');
  }
}

let editingPrecioMaterialKey = null;
let mepFuenteSelect = null;

function loadMepPrecioFields(mat, obraKey) {
  const p = (mat.precios || {})[obraKey];
  $('mep-precio-usd').value = p ? formatMoneyString(p.precioUSD) : '';
  $('mep-precio-ars').value = p ? formatMoneyString(p.precioARS) : '';
  setCalcFormula($('mep-precio-usd'), p && p.precioFormulaMoneda === 'USD' ? p.precioFormula : null);
  setCalcFormula($('mep-precio-ars'), p && p.precioFormulaMoneda === 'ARS' ? p.precioFormula : null);
  $('mep-proveedor').value = p ? (p.proveedor || '') : '';
  $('mep-fecha').value = p ? (p.fecha || new Date().toISOString().slice(0, 10)) : new Date().toISOString().slice(0, 10);
  $('mep-precio-nota').textContent = p && p.cotizacionUsada ? `Cotización usada: USD = ${fmtARSFijo(p.cotizacionUsada)}` : '';
}

// Fuente acá es sólo para CONSULTAR el precio de otra obra como referencia —
// Guardar siempre escribe el precio de la obra activa (activeVersion), sin
// importar qué obra esté mostrando el desplegable en ese momento.
function openEditarPrecioModal(mat) {
  editingPrecioMaterialKey = mat.key;
  $('mep-nombre').value = mat.nombre || '';
  $('mep-unidad').value = mat.unidad || '';

  const obraActivaNombre = obrasMap[activeVersion] || activeVersion;
  $('mep-fuente-hint').textContent = `Guardar siempre actualiza el precio de la obra activa (${obraActivaNombre}) — elegí otra obra acá sólo para consultar su precio.`;

  const obraKeysConPrecio = Object.keys(mat.precios || {});
  const options = obraKeysConPrecio.map(k => ({
    value: k, label: obrasMap[k] || k,
    sublabel: k === activeVersion ? 'obra activa' : undefined,
  }));
  if (!options.find(o => o.value === activeVersion)) {
    options.unshift({ value: activeVersion, label: obraActivaNombre, sublabel: 'obra activa · sin precio todavía' });
  }
  mepFuenteSelect = createSearchableSelect($('mep-fuente-container'), {
    options,
    value: activeVersion,
    placeholder: 'Buscar obra…',
    onChange: v => loadMepPrecioFields(mat, v),
  });
  loadMepPrecioFields(mat, activeVersion);
  const ro = !!window._soloLectura;
  ['mep-nombre', 'mep-unidad', 'mep-precio-usd', 'mep-precio-ars', 'mep-proveedor', 'mep-fecha'].forEach(id => { $(id).disabled = ro; });
  $('modal-mep-save').disabled = ro;
  $('modal-mep-error').classList.add('hidden');
  $('modal-material-editar-precio').classList.remove('hidden');
}

async function saveEditarPrecioModal() {
  if (guardBloqueoObra()) return;
  const nombre = $('mep-nombre').value.trim();
  const unidad = $('mep-unidad').value.trim();
  const proveedor = $('mep-proveedor').value.trim();
  const fecha = $('mep-fecha').value || new Date().toISOString().slice(0, 10);
  const errEl = $('modal-mep-error');

  const usdInput = $('mep-precio-usd');
  const arsInput = $('mep-precio-ars');
  if (usdInput.value.trim().startsWith('=')) usdInput.blur();
  if (arsInput.value.trim().startsWith('=')) arsInput.blur();
  const precioUSD = parseMoneyString(usdInput.value);
  const precioARS = parseMoneyString(arsInput.value);

  if (!nombre || !unidad) {
    errEl.textContent = 'Nombre y unidad son requeridos.';
    errEl.classList.remove('hidden');
    return;
  }
  if (isNaN(precioUSD) || precioUSD < 0 || isNaN(precioARS) || precioARS < 0) {
    errEl.textContent = 'El precio no es válido.';
    errEl.classList.remove('hidden');
    return;
  }
  const cotizacionUsada = window.dolarOficialVenta();
  if (!cotizacionUsada) {
    errEl.textContent = 'No se pudo obtener la cotización del dólar. Reintentá en un momento.';
    errEl.classList.remove('hidden');
    return;
  }

  const targetObraKey = activeVersion;
  const fc = getCalcFormulaConMoneda(usdInput, arsInput);
  const precioData = { precioUSD, precioARS, precioFormula: fc.formula, precioFormulaMoneda: fc.moneda, proveedor, fecha, cotizacionUsada };

  try {
    await Promise.all([
      _fbPatch(`/materiales/${editingPrecioMaterialKey}.json`, { nombre, unidad }),
      _fbPut(`/materiales/${editingPrecioMaterialKey}/precios/${targetObraKey}.json`, precioData),
    ]);
    const mat = materiales.find(m => m.key === editingPrecioMaterialKey);
    mat.nombre = nombre;
    mat.unidad = unidad;
    mat.precios = { ...(mat.precios || {}), [targetObraKey]: precioData };
    $('modal-material-editar-precio').classList.add('hidden');
    showToast('Precio actualizado.');
    renderTodasLasLineas();
  } catch (_) {
    errEl.textContent = 'Error al guardar. Intentá de nuevo.';
    errEl.classList.remove('hidden');
  }
}

// Desglose de costo diario de un equipo — sólo lectura, mismos parámetros
// generales (interés, % reparaciones, etc.) que se editan en Equipos. Debajo
// de la fórmula (con nombres) va la misma cuenta con los números que se
// usaron, para que se pueda verificar sin ir a buscarlos a otro lado.
function filaDesglose(label, formula, cuenta, valor, unidad = '/día') {
  return `<div class="ap-resumen-row"><span>${escHtml(label)}<br><span class="text-muted" style="font-size:.75rem;">${escHtml(formula)}</span><br><span class="text-muted" style="font-size:.7rem;">${escHtml(cuenta)}</span></span><span>${fmtARS(valor)}${unidad}</span></div>`;
}

// Consultas que se abren desde este A.P. (el A.P. de un auxiliar-insumo, el
// catálogo de Equipos, Equipos de la obra): en una ventana chica y centrada, no en pestaña, para
// mirarlas sin perder de vista el A.P. que se está armando.
function abrirVentanaChica(url) {
  const w = Math.min(1100, Math.round(screen.availWidth * 0.7));
  const h = Math.round(screen.availHeight * 0.8);
  const left = Math.round((screen.availLeft || 0) + (screen.availWidth - w) / 2);
  const top = Math.round((screen.availTop || 0) + (screen.availHeight - h) / 2);
  window.open(url, '_blank', `popup,width=${w},height=${h},left=${left},top=${top}`);
}

function openDetalleEquipoModal(equipo) {
  $('ed-equipo-nombre').textContent = `${equipo.tipo || ''}${equipo.potencia ? ` ${equipo.potencia} HP` : ''}`.trim();
  $('ed-link-params').href = `equipos-obra.html?obra=${encodeURIComponent(activeVersion)}`;
  const d = window.calcDesgloseCostoEquipo(equipo, paramsEquipos, paramsMO.jornadaHoras, dolarObraActivo);
  const cont = $('ed-desglose');
  if (!d) {
    cont.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Faltan datos de costo para este equipo (costo, vida útil o uso anual), o no se pudo obtener la cotización del dólar.</p>';
  } else {
    const jornada = paramsMO.jornadaHoras;
    cont.innerHTML = [
      filaDesglose('Amortización', `Costo actual × jornada ÷ vida útil`,
        `${fmtARS(d.costoActual)} × ${fmtNum(jornada)} ÷ ${fmtNum(equipo.vidaUtil)}`, d.amortizacionDia),
      filaDesglose('Intereses', `Costo actual × tasa ÷ 2 ÷ uso anual × jornada`,
        `${fmtARS(d.costoActual)} × ${paramsEquipos.tasaInteresPct}% ÷ 2 ÷ ${fmtNum(equipo.usoAnual)} × ${fmtNum(jornada)}`, d.interesesDia),
      filaDesglose('Reparaciones y Repuestos', `${paramsEquipos.reparacionesPct}% de Amortización`,
        `${paramsEquipos.reparacionesPct}% de ${fmtARS(d.amortizacionDia)}`, d.reparacionesDia),
      filaDesglose('Combustibles', `Consumo × potencia × jornada × precio`,
        `${fmtNum(equipo.consumoCombustibleLtsPorHp)} × ${fmtNum(equipo.potencia)} × ${fmtNum(jornada)} × ${fmtARS(paramsEquipos.precioCombustibleLitro)}`, d.combustibleDia),
      filaDesglose('Lubricantes', `${paramsEquipos.lubricantesPct}% de Combustibles`,
        `${paramsEquipos.lubricantesPct}% de ${fmtARS(d.combustibleDia)}`, d.lubricantesDia),
      `<div class="ap-resumen-row total"><span>Costo diario del equipo</span><span>${fmtARS(d.costoDiarioTotal)}/día</span></div>`,
    ].join('');
  }
  $('modal-equipo-detalle').classList.remove('hidden');
}

// Desglose del costo de una categoría de Mano de Obra — sólo lectura, mismo
// criterio que el de Equipos: fórmula + cuenta con los números usados. Para
// tocar el básico, el extra, el no remunerativo o la fecha hay que ir a Mano
// de Obra de la obra (roles por obra, no hay edición inline acá).
function openDetalleRolModal(rol) {
  $('mor-nombre').textContent = rol.nombre;
  $('mor-link-editar').href = `mano-de-obra-obra.html?obra=${encodeURIComponent(activeVersion)}`;
  const cont = $('mor-desglose');
  if (!rol.basico) {
    cont.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Esta categoría no tiene básico cargado en Mano de Obra de esta obra.</p>';
  } else {
    const c = window.calcCostoManoDeObra(rol, paramsMO);
    const filas = [
      filaDesglose('Básico efectivo', `Básico × (1 + Extra%)`,
        `${fmtARS(rol.basico)} × (1 + ${rol.extraPct || 0}%)`, c.basicoEfectivo, '/hs'),
      filaDesglose('Con Asistencia', `Básico efectivo × (1 + Asistencia%)`,
        `${fmtARS(c.basicoEfectivo)} × (1 + ${paramsMO.asistenciaPct}%)`, c.conAsistencia, '/hs'),
      filaDesglose('Con Cargas Sociales', `Con Asistencia × (1 + Cargas%)`,
        `${fmtARS(c.conAsistencia)} × (1 + ${paramsMO.cargasPct}%)`, c.conCargas, '/hs'),
    ];
    if (rol.noRemunerativoMensual) {
      filas.push(filaDesglose('No remunerativo (prorrateado)', `No remunerativo ÷ (días/mes × jornada)`,
        `${fmtARS(rol.noRemunerativoMensual)} ÷ (${fmtNum(paramsMO.diasMes)} × ${fmtNum(paramsMO.jornadaHoras)})`, c.comidaPorHora, '/hs'));
    }
    filas.push(`<div class="ap-resumen-row total"><span>Costo horario</span><span>${fmtARS(c.costoHorario)}/hs</span></div>`);
    if (paramsMO.comidaActivo) {
      filas.push(filaDesglose(`Costo horario × jornada`, `Costo horario × jornada`,
        `${fmtARS(c.costoHorario)} × ${fmtNum(paramsMO.jornadaHoras)}`, c.costoHorario * paramsMO.jornadaHoras, '/día'));
      filas.push(filaDesglose('Comida (fija por día)', 'Monto fijo de la obra', fmtARS(c.comidaDia), c.comidaDia, '/día'));
    }
    filas.push(`<div class="ap-resumen-row total"><span>Jornal (${fmtNum(paramsMO.jornadaHoras)}hs)</span><span>${fmtARS(c.costoJornal)}/día</span></div>`);
    cont.innerHTML = filas.join('');
  }
  $('modal-mano-de-obra-detalle').classList.remove('hidden');
}

async function deleteLinea(lineaKey) {
  if (guardBloqueoObra()) return;
  delete lineas[lineaKey];
  renderTodasLasLineas();
  await persistLineas();
  showToast('Línea eliminada.');
}

function openEditDatosModal() {
  $('item-nombre').value = item.nombre || '';
  $('item-unidad').value = item.unidad || '';
  $('item-rubro').value = item.rubroKey || '';
  $('modal-item-error').classList.add('hidden');
  $('modal-item').classList.remove('hidden');
}

async function saveDatosModal() {
  const nombre = $('item-nombre').value.trim();
  const unidad = $('item-unidad').value.trim();
  const rubroKey = $('item-rubro').value;
  const errEl = $('modal-item-error');

  if (!nombre || !unidad) {
    errEl.textContent = 'Nombre y unidad son requeridos.';
    errEl.classList.remove('hidden');
    return;
  }

  try {
    const data = { nombre, unidad, rubroKey };
    await _fbPatch(`/items/${itemKey}.json`, data);
    item = { ...item, ...data };
    $('modal-item').classList.add('hidden');
    showToast('Datos actualizados.');
    renderDatos();
    renderTodasLasLineas();
  } catch (_) {
    errEl.textContent = 'Error al guardar. Intentá de nuevo.';
    errEl.classList.remove('hidden');
  }
}

function populateRubroSelect() {
  const opts = rubros.map(r => `<option value="${escHtml(r.key)}">${escHtml(r.nombre)}</option>`).join('');
  $('item-rubro').innerHTML = '<option value="">— Sin rubro —</option>' + opts;
}

async function loadAll() {
  if (modoDefault) { await irAlPrimerAP(); return; }
  if (modoVincular) { await autoCrearYVincular(); return; }
  if (!itemKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta el ítem (?key=...).</p>';
    return;
  }
  const fetches = [
    _fbGet(`/items/${itemKey}.json`),
    _fbGet(`/items/${itemKey}/versionesObra.json`),
    _fbGet('/obras.json'),
    _fbGet('/materiales.json'),
    _fbGet('/equipos.json'),
    _fbGet('/rubros.json'),
    _fbGet('/items.json'),
  ];
  if (obraParam) fetches.push(_fbGet(`/obras/${obraParam}/computo.json`), _fbGet(`/obras/${obraParam}/rubrosComputo.json`), _fbGet(`/obras/${obraParam}/auxiliares.json`));

  const [itemData, versionesData, obrasData, materialesData, equiposData, rubrosData, allItemsData, computoData, rubrosComputoData, auxiliaresData] = await Promise.all(fetches);

  if (!itemData) {
    document.body.innerHTML = '<p style="padding:2rem;">No se encontró el ítem.</p>';
    return;
  }
  item = itemData;
  versionesObra = versionesData || {};
  obrasMap = {};
  obrasFull = {};
  Object.entries(obrasData || {}).forEach(([key, o]) => { obrasMap[key] = o.nombre; obrasFull[key] = o; });
  materiales = Object.entries(materialesData || {}).map(([key, m]) => ({ key, ...m })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  equipos = Object.entries(equiposData || {}).map(([key, e]) => ({ key, ...e })).sort((a, b) => a.codigo.localeCompare(b.codigo, 'es'));
  rubros = Object.entries(rubrosData || {}).map(([key, r]) => ({ key, ...r })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  rubrosMap = {};
  rubros.forEach(r => { rubrosMap[r.key] = r.nombre; });
  allItemsFull = allItemsData || {};
  if (obraParam) auxiliaresPorObra[obraParam] = Object.entries(auxiliaresData || {}).map(([k, a]) => ({ key: k, ...a }));
  equiposUsadosEnObra = calcularEquiposUsadosEnObra();
  populateRubroSelect();

  // K de la obra abierta, referenciable como "k" en la calculadora flotante
  // (ver calc.js) — escucha Carga Fija de esa obra en vivo, así que si
  // alguien la cambia mientras este A.P. está abierto, "k" se actualiza solo
  // (recalcula y vuelve a evaluar cualquier cantidad que lo use, ver
  // refrescarFormulasVivas). No bloquea el resto de la carga.
  if (obraParam) escucharKObraEnVivo(obraParam);

  if (obraParam) {
    ubicarLineaYNumeracion(computoData, rubrosComputoData, auxiliaresData);
    renderHeaderTabs(obraParam, 'analisis-precio');
    setModoObra(obraParam, obrasFull[obraParam], () => {
      renderVersionRendimiento();
      renderUsarBase();
      renderFamiliaMOSwitch();
      renderTodasLasLineas();
      if (window._postitsRender) window._postitsRender();
    });
  }
  renderDatos();
  renderApNav();
  renderApTerciario();

  const versionInicial = resolverVersionInicial();
  if (!versionInicial) {
    document.body.innerHTML = '<p style="padding:2rem;">Este ítem todavía no tiene ninguna obra cargada.</p>';
    return;
  }
  activarVersion(versionInicial);

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

/* Moverse por las cantidades con el teclado (js/navCeldas.js). El wrap es
   #normal-content, no cada sección: así ↑/↓ cruzan de Equipos a Mano de Obra y
   de ahí a Materiales, en el orden en que están en la pantalla, y toda la
   receta se recorre sin soltar el teclado. Equipos colapsado queda afuera solo
   (sus celdas no son visibles).

   Las flechas gobiernan sólo las cantidades: el buscador de insumo ya usa ↑/↓
   para su propio desplegable. Del Tab sí participa, porque ahí es la primera
   columna de la fila y saltearla sería perder el único camino de teclado para
   cambiar el insumo. */
function engancharNavegacionAp() {
  window.engancharNavCeldas($('normal-content'), {
    celdas: '.linea-cantidad',
    filas: '.ap-linea[data-key], .ap-linea-mo[data-rol]',
    tab: '.linea-cantidad, .linea-select-wrap .ss-input',
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  engancharNavegacionAp();
  // Volver: si venimos de un Cómputo (?obra=), vuelve ahí; si no, a Biblioteca.
  const hrefVolver = obraParam ? `computo.html?obra=${encodeURIComponent(obraParam)}` : 'biblioteca.html';
  $('btn-header-volver').addEventListener('click', () => window.location.href = hrefVolver);
  $('btn-volver').addEventListener('click', () => window.location.href = hrefVolver);

  $('btn-ap-prev').addEventListener('click', () => irAApVecino(-1));
  $('btn-ap-next').addEventListener('click', () => irAApVecino(1));

  // El botón vive dentro de #ap-usar-base-wrap, que renderUsarBase() redibuja:
  // su listener se engancha ahí, no acá.
  $('modal-usar-base-close').addEventListener('click', () => $('modal-usar-base').classList.add('hidden'));

  $('btn-editar-datos').addEventListener('click', openEditDatosModal);
  $('modal-item-close').addEventListener('click',  () => $('modal-item').classList.add('hidden'));
  $('modal-item-cancel').addEventListener('click', () => $('modal-item').classList.add('hidden'));
  $('modal-item-save').addEventListener('click', saveDatosModal);

  $('btn-add-linea-directo').addEventListener('click', () => addLinea('directo'));
  $('btn-add-linea-material').addEventListener('click', () => addLinea('material'));
  $('btn-add-linea-auxiliar').addEventListener('click', () => addLinea('auxiliar'));
  $('btn-add-linea-equipo').addEventListener('click', () => addLinea('equipo'));
  $('equipos-toggle').addEventListener('click', () => setEquiposExpandido($('lineas-equipo').classList.contains('hidden')));

  $('modal-material-quick-close').addEventListener('click', () => $('modal-material-quick').classList.add('hidden'));
  $('modal-material-quick-cancel').addEventListener('click', () => $('modal-material-quick').classList.add('hidden'));
  $('modal-material-quick-save').addEventListener('click', saveQuickMaterial);

  $('modal-auxiliar-quick-close').addEventListener('click', () => $('modal-auxiliar-quick').classList.add('hidden'));
  $('modal-auxiliar-quick-cancel').addEventListener('click', () => $('modal-auxiliar-quick').classList.add('hidden'));
  $('modal-auxiliar-quick-save').addEventListener('click', saveQuickAuxiliar);
  attachCalcInput($('qm-precio-usd'));
  attachMoneyInput($('qm-precio-usd'));
  attachCalcInput($('qm-precio-ars'));
  attachMoneyInput($('qm-precio-ars'));
  attachDualPrecioInputs({ usdInput: $('qm-precio-usd'), arsInput: $('qm-precio-ars'), notaEl: $('qm-precio-nota') });

  $('modal-mep-close').addEventListener('click',  () => $('modal-material-editar-precio').classList.add('hidden'));
  $('modal-mep-cancel').addEventListener('click', () => $('modal-material-editar-precio').classList.add('hidden'));
  $('modal-mep-save').addEventListener('click', saveEditarPrecioModal);

  $('modal-ed-close').addEventListener('click',  () => $('modal-equipo-detalle').classList.add('hidden'));
  $('modal-ed-cerrar').addEventListener('click', () => $('modal-equipo-detalle').classList.add('hidden'));
  $('ed-link-equipos').addEventListener('click', e => { e.preventDefault(); abrirVentanaChica('equipos.html'); });
  $('ed-link-params').addEventListener('click', e => { e.preventDefault(); abrirVentanaChica(e.currentTarget.href); });

  $('modal-mor-close').addEventListener('click',  () => $('modal-mano-de-obra-detalle').classList.add('hidden'));
  $('modal-mor-cerrar').addEventListener('click', () => $('modal-mano-de-obra-detalle').classList.add('hidden'));

  attachCalcInput($('mep-precio-usd'));
  attachMoneyInput($('mep-precio-usd'));
  attachCalcInput($('mep-precio-ars'));
  attachMoneyInput($('mep-precio-ars'));
  attachDualPrecioInputs({ usdInput: $('mep-precio-usd'), arsInput: $('mep-precio-ars'), notaEl: $('mep-precio-nota') });

  await loadAll();
});

window.onDecimalesVista(() => {
  if (!item) return;
  renderVersionRendimiento();
  renderTodasLasLineas();
});
