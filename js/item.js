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
let rubros = [];
let rubrosMap = {};
const DEFAULT_PARAMS_EQUIPOS = { tasaInteresPct: 10, reparacionesPct: 75, lubricantesPct: 50, combustibleLtsPorHp: 0.1, precioCombustibleLitro: 0 };
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

function costoComputoDeObra(obraKeyX, computoDataX) {
  const obraFullX = obrasFull[obraKeyX] || {};
  const paramsEq = { ...DEFAULT_PARAMS_EQUIPOS, ...(obraFullX.paramsEquipos || {}) };
  const paramsMoX = { ...DEFAULT_PARAMS_MO, ...(obraFullX.paramsMO || {}) };
  const dolarX = obraFullX.dolar ? obraFullX.dolar.valor : null;
  const rolesX = Object.entries(obraFullX.roles || {}).map(([k, r]) => ({ key: k, ...r }));
  const preciosObraX = window.resolverPreciosObra(materiales, obraKeyX);
  const catalogos = { materiales, equipos, roles: rolesX };
  return Object.values(computoDataX || {}).reduce((acc, l) => {
    if (!l.itemKey) return acc;
    const it = allItemsFull[l.itemKey];
    if (!it) return acc;
    const version = (it.versionesObra && it.versionesObra[obraKeyX]) || it;
    if (!version.lineas || !Object.keys(version.lineas).length) return acc;
    const r = window.calcCostoUnitarioItem(version, version.lineas, catalogos, paramsEq, paramsMoX, preciosObraX, dolarX);
    const cantidad = l.cantidad != null && !isNaN(l.cantidad) ? l.cantidad : 0;
    return acc + r.costoUnitario * cantidad;
  }, 0);
}

async function calcularKObra(obraKeyX) {
  if (kPorObra[obraKeyX] !== undefined) return kPorObra[obraKeyX];
  const [computoDataX, cargaFijaLineasX, cargaFijaConfigX] = await Promise.all([
    _fbGet(`/obras/${obraKeyX}/computo.json`),
    _fbGet(`/obras/${obraKeyX}/cargaFija/lineas.json`),
    _fbGet(`/obras/${obraKeyX}/cargaFija/config.json`),
  ]);
  const costoComputo = costoComputoDeObra(obraKeyX, computoDataX);
  const config = { ...(cargaFijaConfigX || {}) };
  // El K vive en calcCostos.js (calcCargaFija), compartido con Carga Fija,
  // Presupuesto y Plan de Avance. Los gastos fijos no se suman por separado:
  // los que se calculan sobre el presupuesto propio salen del mismo despeje.
  const k = window.calcCargaFija(config, cargaFijaLineasX || {}, costoComputo,
    (obrasFull[obraKeyX] || {}).presupuestoOficial).k;
  kPorObra[obraKeyX] = k;
  return k;
}

const HINTS = {
  material: 'Cantidad por unidad de ítem (no se divide por rendimiento).',
  equipo: 'Cantidad de uso por jornada — se divide por el rendimiento del ítem.',
  manoDeObra: 'Cantidad de trabajadores por jornada — se divide por el rendimiento del ítem.',
};

function labelFor(tipo, entidad) {
  if (tipo === 'material') return entidad.nombre;
  if (tipo === 'equipo') return `${entidad.tipo || ''} ${entidad.codigo || ''}`.trim();
  return entidad.nombre;
}

function catalogoFor(tipo) {
  if (tipo === 'material') return materiales;
  if (tipo === 'equipo') return equipos;
  return roles;
}

// Cómo se lee una referencia a esta línea dentro de una fórmula (js/refs.js):
// el nombre de lo que tiene elegido, que es como la reconoce el usuario.
function etiquetaLinea(lineaKey) {
  const l = lineas[lineaKey];
  if (!l) return 'Línea';
  const entidad = catalogoFor(l.tipo).find(c => c.key === l.refKey);
  return entidad ? labelFor(l.tipo, entidad) : 'Línea sin elegir';
}

// -- Auto-alta de ítem (línea de Cómputo sin itemKey todavía) --------------
// Ya no se busca/crea a mano: el AP de una línea se crea solo, con el
// nombre/unidad que tenga la línea en ese momento (pueden estar vacíos
// todavía, se completan después en el Cómputo). Mismo mecanismo que antes
// tenía vincularItem(), sin paso intermedio de búsqueda.

async function autoCrearYVincular() {
  try {
    const lineaActual = await _fbGet(`/obras/${obraParam}/${nodoLinea}/${keyLinea}.json`);
    const nombre = (lineaActual && lineaActual.nombre) || '';
    const unidad = (lineaActual && lineaActual.unidad) || '';
    const key = (nombre || 'item').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40)
      + '_' + Date.now();
    await _fbPut(`/items/${key}.json`, { nombre, unidad, creadoEn: Date.now() });
    await _fbPut(`/items/${key}/versionesObra/${obraParam}.json`, { rendimiento: 1 });
    await _fbPatch(`/obras/${obraParam}/${nodoLinea}/${keyLinea}.json`, { itemKey: key });
    window.location.href = `item.html?key=${encodeURIComponent(key)}&obra=${encodeURIComponent(obraParam)}`;
  } catch (_) {
    document.body.innerHTML = '<p style="padding:2rem;">Error al crear el Análisis de Precio. Volvé al Cómputo e intentá de nuevo.</p>';
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
    .map(l => ({ key: l.key, itemKey: l.itemKey || null, numeracion: l.codigo, aux: !!l.aux }));
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
  const nav = $('ap-nav');
  if (apNavIndex === -1 || lineasOrdenadas.length <= 1) {
    nav.classList.add('hidden');
    return;
  }
  nav.classList.remove('hidden');
  $('btn-ap-prev').disabled = apNavIndex <= 0;
  $('btn-ap-next').disabled = apNavIndex >= lineasOrdenadas.length - 1;
}

function irAApVecino(dir) {
  const destino = lineasOrdenadas[apNavIndex + dir];
  if (!destino) return;
  window.location.href = hrefParaLinea(destino);
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
      opciones.push({ value: `${key}::${obraK}`, label: it.nombre || '(sin nombre)', sublabel: obrasMap[obraK] || obraK, version: v });
    });
  });
  return opciones.sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

// Botón + nota de procedencia de la receta. Se redibuja entero (y con él sus
// listeners) porque cambia al copiar una base y al saltar de versión de obra.
function renderUsarBase() {
  const wrap = $('ap-usar-base-wrap');
  const b = baseUsadaActiva;
  wrap.innerHTML = b
    ? `<div class="ap-base-nota">
         ${icSvg('copy')}
         <span class="ap-base-nota-texto">Se usó <strong>${escHtml(b.itemNombre || '(sin nombre)')}</strong>${b.obraNombre ? ` de <strong>${escHtml(b.obraNombre)}</strong>` : ''} como base${b.copiadoEn ? ` · ${fmtFechaCorta(b.copiadoEn)}` : ''}</span>
         <button class="btn btn-sm btn-outline" id="btn-usar-como-base">Cambiar</button>
         <button class="ap-base-nota-del" id="btn-quitar-base-nota" title="Quitar esta nota">${icSvg('x')}</button>
       </div>`
    : '<button class="btn btn-sm btn-outline" id="btn-usar-como-base">Usar otro AP como base</button>';

  $('btn-usar-como-base').addEventListener('click', openUsarComoBaseModal);
  const del = $('btn-quitar-base-nota');
  if (del) del.addEventListener('click', quitarNotaBase);
}

function fmtFechaCorta(ts) {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

async function quitarNotaBase() {
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

async function seleccionarUsarComoBase(value, opciones) {
  const opt = opciones.find(o => o.value === value);
  if (!opt) return;
  $('modal-usar-base').classList.add('hidden');

  const cantidadPropia = Object.keys(lineas).length;
  if (cantidadPropia) {
    const ok = await showConfirm('Usar como base', `Esto reemplaza las ${cantidadPropia} línea(s) cargadas en este Análisis de Precio por la receta de "${opt.label}" (${opt.sublabel}). ¿Continuar?`);
    if (!ok) return;
  }

  const src = opt.version;
  // Copia profunda: lineas acá abajo viene del caché de /items.json en
  // memoria (allItemsFull) — sin clonar, editar esta versión mutaría en
  // vivo el objeto cacheado de la versión de origen.
  const data = {
    rendimiento: src.rendimiento || 1,
    rendimientoFormula: src.rendimientoFormula || null,
    lineas: JSON.parse(JSON.stringify(src.lineas || {})),
    // Queda registrado de dónde salió la receta: se muestra como nota en la
    // pantalla y sobrevive a la recarga. No condiciona ningún cálculo.
    baseUsada: { itemNombre: opt.label, obraNombre: opt.sublabel, copiadoEn: Date.now() },
  };
  try {
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
    renderVersionTabs();
    renderVersionRendimiento();
    renderUsarBase();
    renderTodasLasLineas();
    showToast(`Receta copiada desde "${opt.label}" (${opt.sublabel}).`);
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

function activarVersion(key) {
  activeVersion = key;
  const obraActiva = obrasFull[key];
  paramsEquipos = { ...DEFAULT_PARAMS_EQUIPOS, ...((obraActiva && obraActiva.paramsEquipos) || {}) };
  paramsMO = { ...DEFAULT_PARAMS_MO, ...((obraActiva && obraActiva.paramsMO) || {}) };
  dolarObraActivo = (obraActiva && obraActiva.dolar) ? obraActiva.dolar.valor : null;
  window.setCotizacionObra(dolarObraActivo);
  roles = window.rolesOrdenados(Object.entries((obraActiva && obraActiva.roles) || {}).map(([k, r]) => ({ key: k, ...r })));
  const v = versionesObra[key];
  if (v) {
    lineas = v.lineas || {};
    rendimientoActivo = v.rendimiento;
    rendimientoFormulaActiva = v.rendimientoFormula;
    sinSeguridadCapatazActivo = !!v.sinSeguridadCapataz;
    baseUsadaActiva = v.baseUsada || null;
    versionExisteEnServidor = true;
  } else {
    // No existe todavía para esta obra: arranca vacía, con 1 como punto de
    // partida editable (mismo default que se usa al crear un ítem nuevo).
    lineas = {};
    rendimientoActivo = 1;
    rendimientoFormulaActiva = null;
    sinSeguridadCapatazActivo = false;
    baseUsadaActiva = null;
    versionExisteEnServidor = false;
  }
  renderVersionTabs();
  renderVersionRendimiento();
  renderUsarBase();
  renderTodasLasLineas();
  calcularKObra(key).then(() => { if (activeVersion === key) renderTodasLasLineas(); });
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

function renderVersionRendimiento() {
  const wrap = $('version-rendimiento');
  wrap.classList.remove('hidden');
  wrap.innerHTML = `<span>Rendimiento en esta obra: <strong>${escHtml(fmtNum(rendimientoActivo))}</strong> uds./jornada</span>
    <button class="version-rendimiento-edit" id="btn-editar-rend-obra" title="Editar rendimiento de esta obra">${icSvg('edit')}</button>`;
  $('btn-editar-rend-obra').addEventListener('click', () => {
    wrap.innerHTML = `<input type="text" class="form-control" id="rend-obra-input" style="max-width:140px;" value="${escHtml(String(rendimientoActivo))}">`;
    const input = $('rend-obra-input');
    attachCalcInput(input, rendimientoFormulaActiva);
    attachValorInput(input, rendimientoActivo);
    input.focus();
    input.select();
    const guardar = () => {
      if (input.value.trim().startsWith('=')) input.blur();
      const n = valorCampo(input);
      if (n != null && !isNaN(n) && n > 0) {
        rendimientoActivo = n;
        rendimientoFormulaActiva = getCalcFormula(input);
        persistRendimiento({ rendimiento: n, rendimientoFormula: rendimientoFormulaActiva });
      }
      renderVersionRendimiento();
      renderTodasLasLineas();
    };
    input.addEventListener('blur', guardar);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  });
}

// Calcula (una sola vez por render) el costo agregado y el detalle por
// línea de la versión activa — lo usan tanto el resumen como cada sección
// de líneas, para no repetir el cálculo.
function calcularDetalleActivo() {
  const catalogos = { materiales, equipos, roles };
  const preciosObra = window.resolverPreciosObra(materiales, activeVersion);
  const r = window.calcCostoUnitarioItem({ rendimiento: rendimientoActivo, sinSeguridadCapataz: sinSeguridadCapatazActivo }, lineas, catalogos, paramsEquipos, paramsMO, preciosObra, dolarObraActivo);
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

function renderLineasSeccion(tipo, r) {
  const container = $(`lineas-${tipo}`);
  const cat = catalogoFor(tipo);
  const entradas = Object.entries(lineas).filter(([, l]) => l.tipo === tipo);

  // Equipos: desplegable, colapsado por defecto (la mayoría de los ítems no
  // llevan). Se abre solo mientras haya al menos una línea cargada, o si el
  // usuario lo despliega a mano con el chevron.
  if (tipo === 'equipo' && entradas.length) setEquiposExpandido(true);

  let html = `<p class="form-hint" style="margin-bottom:.75rem;">${HINTS[tipo]}</p>`;
  if (!entradas.length) {
    html += '<p class="text-muted" style="font-size:.85rem;">Sin líneas todavía.</p>';
  } else if (!cat.length && tipo !== 'material') {
    html += '<p class="text-muted" style="font-size:.85rem;">No hay catálogo cargado para este tipo.</p>';
  } else {
    html += `<div class="ap-linea ap-linea-header con-costo"><span></span><span>Cantidad</span><span>Costo unitario</span><span>Costo total</span><span></span></div>`;
    html += entradas.map(([lineaKey]) => {
      const d = detallePorLineaActivo[lineaKey];
      return `
        <div class="ap-linea con-costo" data-key="${escHtml(lineaKey)}">
          <div class="linea-select-wrap">
            <div class="linea-select-container"></div>
            ${tipo === 'material' ? '<span class="linea-unidad-badge"></span>' : ''}
          </div>
          <input type="text" class="form-control linea-cantidad" placeholder="Cantidad" data-calc-id="ap:linea:${escHtml(lineaKey)}:cantidad" data-calc-label="${escHtml(etiquetaLinea(lineaKey) + ' · Cantidad')}">
          <button type="button" class="ap-linea-costo-unit"${d ? calcAttrs(d.costoUnitario, `ap:linea:${lineaKey}:costoUnit`, etiquetaLinea(lineaKey) + ' · Costo unit.') : ''}>${d ? fmtARS(d.costoUnitario) : '—'}</button><span class="ap-linea-costo-total"${d ? calcAttrs(d.costoTotal, `ap:linea:${lineaKey}:costoTotal`, etiquetaLinea(lineaKey) + ' · Costo total') : ''}>${d ? fmtARS(d.costoTotal) : '—'}</span>
          <button class="ap-linea-del" title="Eliminar línea">${icSvg('x')}</button>
        </div>`;
    }).join('');
  }
  if (r) {
    html += tipo === 'material'
      ? `<div class="ap-subtotal-linea total"><span>Costo unitario de Materiales (C)</span><span${calcAttrs(r.costoMateriales, 'ap:costoMateriales', 'Costo unitario de Materiales (C)')}>${fmtARS(r.costoMateriales)}</span></div>`
      : `<div class="ap-subtotal-linea"><span>Costo diario Equipos</span><span${calcAttrs(r.costoDiarioEquipos, 'ap:costoDiarioEquipos', 'Costo diario Equipos')}>${fmtARS(r.costoDiarioEquipos)}</span></div>
         <div class="ap-subtotal-linea total"><span>Costo unitario de Equipos (A)</span><span${calcAttrs(r.costoUnitarioEquipos, 'ap:costoUnitarioEquipos', 'Costo unitario de Equipos (A)')}>${fmtARS(r.costoUnitarioEquipos)}</span></div>`;
  }
  container.innerHTML = html;

  container.querySelectorAll('.ap-linea[data-key]').forEach(row => {
    const lineaKey = row.dataset.key;
    const linea = lineas[lineaKey];
    const cantidadInput = row.querySelector('.linea-cantidad');

    cantidadInput.dataset.calcValor = linea.cantidad ?? 0;

    const options = cat.map(c => ({
      value: c.key,
      label: labelFor(tipo, c),
      sublabel: tipo === 'material' ? c.unidad : undefined,
    }));
    createSearchableSelect(row.querySelector('.linea-select-container'), {
      options,
      value: linea.refKey,
      placeholder: `Buscar ${tipo}…`,
      onChange: v => updateLinea(lineaKey, { refKey: v }),
      onCreateNew: tipo === 'material' ? texto => openQuickMaterialModal(texto, lineaKey) : null,
    });
    if (tipo === 'material') {
      const mat = materiales.find(m => m.key === linea.refKey);
      const badge = row.querySelector('.linea-unidad-badge');
      badge.textContent = mat ? mat.unidad : '';
      const costoUnit = row.querySelector('.ap-linea-costo-unit');
      if (costoUnit) {
        if (mat) {
          costoUnit.title = 'Clic para ver/editar el precio de este material';
          costoUnit.addEventListener('click', () => openEditarPrecioModal(mat));
        } else {
          costoUnit.disabled = true;
        }
      }
    } else if (tipo === 'equipo') {
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

    attachCalcInput(cantidadInput, linea.cantidadFormula);
    attachValorInput(cantidadInput, linea.cantidad ?? null);
    cantidadInput.addEventListener('blur', () => {
      const n = valorCampo(cantidadInput);
      const formula = getCalcFormula(cantidadInput);
      if (n === (linea.cantidad ?? null) && formula === (linea.cantidadFormula || null)) return;
      updateLinea(lineaKey, { cantidad: n, cantidadFormula: formula });
    });
    cantidadInput.addEventListener('keydown', e => { if (e.key === 'Enter') cantidadInput.blur(); });
    row.querySelector('.ap-linea-del').addEventListener('click', () => deleteLinea(lineaKey));
  });
}

// Mano de Obra no usa buscador: se muestran fijas TODAS las categorías del
// catálogo (roles), cada una con su cantidad para completar — no hace falta
// elegir "cuál" agregar porque ya están todas. Vaciar la cantidad borra esa
// línea (si existía); no afecta el costo de todas formas si queda vacía.
function renderManoDeObraSeccion(r) {
  const container = $('lineas-manoDeObra');
  let html = `<p class="form-hint" style="margin-bottom:.75rem;">${HINTS.manoDeObra}</p>`;
  if (!roles.length) {
    html += '<p class="text-muted" style="font-size:.85rem;">No hay catálogo de Mano de Obra cargado todavía.</p>';
  } else {
    html += `<div class="ap-linea-mo ap-linea-header con-costo"><span></span><span>Cantidad</span><span>Costo unitario</span><span>Costo total</span></div>`;
    html += roles.map(rol => {
      const entry = Object.entries(lineas).find(([, l]) => l.tipo === 'manoDeObra' && l.refKey === rol.key);
      const cantidad = entry ? entry[1].cantidad : null;
      const d = entry ? detallePorLineaActivo[entry[0]] : null;
      return `
        <div class="ap-linea-mo con-costo" data-rol="${escHtml(rol.key)}">
          <span class="ap-linea-mo-nombre">${escHtml(rol.nombre)}</span>
          <input type="text" class="form-control linea-cantidad" placeholder="Cantidad" value="${cantidad ?? ''}" data-calc-valor="${cantidad ?? 0}" data-calc-id="ap:mo:${escHtml(rol.key)}:cantidad" data-calc-label="${escHtml(rol.nombre + ' · Cantidad')}">
          <span class="ap-linea-costo-unit"${d ? calcAttrs(d.costoUnitario, `ap:mo:${rol.key}:costoUnit`, rol.nombre + ' · Costo unit.') : ''}>${d ? fmtARS(d.costoUnitario) : '—'}</span><span class="ap-linea-costo-total"${d ? calcAttrs(d.costoTotal, `ap:mo:${rol.key}:costoTotal`, rol.nombre + ' · Costo total') : ''}>${d ? fmtARS(d.costoTotal) : '—'}</span>
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
      html += `<div class="ap-subtotal-linea"><span>Seguridad y Capataz — excluido en este AP</span><button type="button" class="btn btn-sm btn-outline" id="btn-restaurar-seg-cap">Incluir</button></div>`;
    } else if (r) {
      html += `
        <div class="ap-linea-mo con-costo" data-extra="seguridadCapataz">
          <span class="ap-linea-mo-nombre">Seguridad y Capataz</span>
          <span class="ap-linea-costo-unit">${r.seguridadCapatazPctAplicado}%</span>
          <span class="ap-linea-costo-unit">—</span>
          <span class="ap-linea-costo-total">
            <span data-calc-valor="${r.costoDiarioSeguridadCapataz}">${fmtARS(r.costoDiarioSeguridadCapataz)}</span>
            <button type="button" class="ap-linea-del" id="btn-excluir-seg-cap" title="Excluir de este AP" style="margin-left:.4rem;">${icSvg('x')}</button>
          </span>
        </div>`;
    }
  }
  if (r) {
    html += `<div class="ap-subtotal-linea"><span>Costo diario Mano de Obra</span><span${calcAttrs(r.costoDiarioMO, 'ap:costoDiarioMO', 'Costo diario Mano de Obra')}>${fmtARS(r.costoDiarioMO)}</span></div>
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

    attachCalcInput(cantidadInput, linea ? linea.cantidadFormula : null);
    attachValorInput(cantidadInput, linea ? (linea.cantidad ?? null) : null);
    cantidadInput.addEventListener('blur', () => {
      if (cantidadInput.value.trim() === '') {
        if (entry) deleteLinea(entry[0]);
        return;
      }
      const n = valorCampo(cantidadInput);
      if (n == null || isNaN(n)) { setValorCampo(cantidadInput, linea ? (linea.cantidad ?? null) : null); return; }
      const formula = getCalcFormula(cantidadInput);
      if (linea && n === (linea.cantidad ?? null) && formula === (linea.cantidadFormula || null)) return;
      const lineaKey = entry ? entry[0] : `mo_${rolKey}`;
      updateLinea(lineaKey, { tipo: 'manoDeObra', refKey: rolKey, cantidad: n, cantidadFormula: formula });
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
  const campos = Object.entries(lineas)
    .filter(([, l]) => window.formulaTieneRefs(l.cantidadFormula))
    .map(([lineaKey, l]) => ({
      formula: l.cantidadFormula,
      valor: l.cantidad ?? null,
      aplicar: valor => { lineas[lineaKey].cantidad = valor; },
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

function renderTodasLasLineas() {
  const r = calcularDetalleActivo();
  renderLineasSeccion('material', r);
  renderLineasSeccion('equipo', r);
  renderManoDeObraSeccion(r);
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
  lineas[lineaKey] = { ...lineas[lineaKey], ...cambios };
  renderTodasLasLineas();
  persistLineas();
}

function addLinea(tipo) {
  if (tipo !== 'material' && !catalogoFor(tipo).length) {
    showToast('No hay nada cargado en ese catálogo todavía.', 'error');
    return;
  }
  const lineaKey = 'linea_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  lineas[lineaKey] = { tipo, refKey: null, cantidad: null };
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
    precioData = { precioUSD, precioARS, precioFormula: getCalcFormula(usdInput) || getCalcFormula(arsInput), proveedor, fecha, cotizacionUsada };
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

let editingPrecioMaterialKey = null;
let mepFuenteSelect = null;

function loadMepPrecioFields(mat, obraKey) {
  const p = (mat.precios || {})[obraKey];
  $('mep-precio-usd').value = p ? formatMoneyString(p.precioUSD) : '';
  $('mep-precio-ars').value = p ? formatMoneyString(p.precioARS) : '';
  setCalcFormula($('mep-precio-usd'), p ? p.precioFormula : null);
  setCalcFormula($('mep-precio-ars'), null);
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
  $('modal-mep-error').classList.add('hidden');
  $('modal-material-editar-precio').classList.remove('hidden');
}

async function saveEditarPrecioModal() {
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
  const precioData = { precioUSD, precioARS, precioFormula: getCalcFormula(usdInput) || getCalcFormula(arsInput), proveedor, fecha, cotizacionUsada };

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
// generales (interés, % reparaciones, etc.) que se editan en Equipos.
function filaDesglose(label, formula, valor) {
  return `<div class="ap-resumen-row"><span>${escHtml(label)}<br><span class="text-muted" style="font-size:.75rem;">${escHtml(formula)}</span></span><span>${fmtARS(valor)}/día</span></div>`;
}

function openDetalleEquipoModal(equipo) {
  $('ed-equipo-nombre').textContent = `${equipo.tipo || ''} ${equipo.codigo || ''}`.trim();
  const d = window.calcDesgloseCostoEquipo(equipo, paramsEquipos, paramsMO.jornadaHoras, dolarObraActivo);
  const cont = $('ed-desglose');
  if (!d) {
    cont.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Faltan datos de costo para este equipo (costo, vida útil o uso anual), o no se pudo obtener la cotización del dólar.</p>';
  } else {
    cont.innerHTML = [
      filaDesglose('Amortización', `Costo actual × jornada ÷ vida útil`, d.amortizacionDia),
      filaDesglose('Intereses', `Costo actual × tasa ÷ 2 ÷ uso anual × jornada`, d.interesesDia),
      filaDesglose('Reparaciones y Repuestos', `${paramsEquipos.reparacionesPct}% de Amortización`, d.reparacionesDia),
      filaDesglose('Combustibles', `Consumo × potencia × jornada × precio`, d.combustibleDia),
      filaDesglose('Lubricantes', `${paramsEquipos.lubricantesPct}% de Combustibles`, d.lubricantesDia),
      `<div class="ap-resumen-row total"><span>Costo diario del equipo</span><span>${fmtARS(d.costoDiarioTotal)}/día</span></div>`,
    ].join('');
  }
  $('modal-equipo-detalle').classList.remove('hidden');
}

async function deleteLinea(lineaKey) {
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
  populateRubroSelect();

  if (obraParam) ubicarLineaYNumeracion(computoData, rubrosComputoData, auxiliaresData);
  renderDatos();
  renderApNav();

  const versionInicial = resolverVersionInicial();
  if (!versionInicial) {
    document.body.innerHTML = '<p style="padding:2rem;">Este ítem todavía no tiene ninguna obra cargada.</p>';
    return;
  }
  activarVersion(versionInicial);

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

document.addEventListener('DOMContentLoaded', async () => {
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

  $('btn-add-linea-material').addEventListener('click', () => addLinea('material'));
  $('btn-add-linea-equipo').addEventListener('click', () => addLinea('equipo'));
  $('equipos-toggle').addEventListener('click', () => setEquiposExpandido($('lineas-equipo').classList.contains('hidden')));

  $('modal-material-quick-close').addEventListener('click', () => $('modal-material-quick').classList.add('hidden'));
  $('modal-material-quick-cancel').addEventListener('click', () => $('modal-material-quick').classList.add('hidden'));
  $('modal-material-quick-save').addEventListener('click', saveQuickMaterial);
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
