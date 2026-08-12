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
const modoVincular = !itemKey && !!lineaParam && !!obraParam;

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

// -- Auto-alta de ítem (línea de Cómputo sin itemKey todavía) --------------
// Ya no se busca/crea a mano: el AP de una línea se crea solo, con el
// nombre/unidad que tenga la línea en ese momento (pueden estar vacíos
// todavía, se completan después en el Cómputo). Mismo mecanismo que antes
// tenía vincularItem(), sin paso intermedio de búsqueda.

async function autoCrearYVincular() {
  try {
    const lineaActual = await _fbGet(`/obras/${obraParam}/computo/${lineaParam}.json`);
    const nombre = (lineaActual && lineaActual.nombre) || '';
    const unidad = (lineaActual && lineaActual.unidad) || '';
    const key = (nombre || 'item').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40)
      + '_' + Date.now();
    await _fbPut(`/items/${key}.json`, { nombre, unidad, creadoEn: Date.now() });
    await _fbPut(`/items/${key}/versionesObra/${obraParam}.json`, { rendimiento: 1 });
    await _fbPatch(`/obras/${obraParam}/computo/${lineaParam}.json`, { itemKey: key });
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

function ordenarPorOrden(list) {
  return [...list].sort((a, b) => (a.orden || 0) - (b.orden || 0));
}

// Mismo cálculo de numeración "N.M" que renderLineaRow() en computo.js.
function ubicarLineaYNumeracion(computoData, rubrosComputoData) {
  const todasLineas = Object.entries(computoData || {}).map(([key, l]) => ({ key, ...l }));
  const entry = todasLineas.find(l => l.itemKey === itemKey);
  if (!entry) return;
  lineaVinculada = entry;
  const rubros = ordenarPorOrden(Object.entries(rubrosComputoData || {}).map(([key, r]) => ({ key, ...r })));
  const rubroIdx = rubros.findIndex(r => r.key === entry.rubroId);
  if (rubroIdx === -1) return;
  const grupo = ordenarPorOrden(todasLineas.filter(l => l.rubroId === entry.rubroId));
  const lineaIdx = grupo.findIndex(l => l.key === entry.key);
  if (lineaIdx === -1) return;
  numeracionActiva = `${rubroIdx + 1}.${lineaIdx + 1}`;
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

function openUsarComoBaseModal() {
  const opciones = opcionesUsarComoBase();
  createSearchableSelect($('usar-base-select'), {
    options: opciones,
    value: null,
    placeholder: 'Buscar AP…',
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
  const data = { rendimiento: src.rendimiento || 1, rendimientoFormula: src.rendimientoFormula || null, lineas: JSON.parse(JSON.stringify(src.lineas || {})) };
  try {
    await _fbPut(`${basePath()}.json`, data);
    versionesObra[activeVersion] = data;
    versionExisteEnServidor = true;
    lineas = data.lineas;
    rendimientoActivo = data.rendimiento;
    rendimientoFormulaActiva = data.rendimientoFormula;
    renderVersionTabs();
    renderVersionRendimiento();
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
  roles = Object.entries((obraActiva && obraActiva.roles) || {}).map(([k, r]) => ({ key: k, ...r })).sort((a, b) => b.nombre.localeCompare(a.nombre, 'es'));
  const v = versionesObra[key];
  if (v) {
    lineas = v.lineas || {};
    rendimientoActivo = v.rendimiento;
    rendimientoFormulaActiva = v.rendimientoFormula;
    sinSeguridadCapatazActivo = !!v.sinSeguridadCapataz;
    versionExisteEnServidor = true;
  } else {
    // No existe todavía para esta obra: arranca vacía, con 1 como punto de
    // partida editable (mismo default que se usa al crear un ítem nuevo).
    lineas = {};
    rendimientoActivo = 1;
    rendimientoFormulaActiva = null;
    sinSeguridadCapatazActivo = false;
    versionExisteEnServidor = false;
  }
  renderVersionTabs();
  renderVersionRendimiento();
  renderTodasLasLineas();
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
  wrap.innerHTML = `<span>Rendimiento en esta obra: <strong>${escHtml(String(rendimientoActivo))}</strong> uds./jornada</span>
    <button class="version-rendimiento-edit" id="btn-editar-rend-obra" title="Editar rendimiento de esta obra">${icSvg('edit')}</button>`;
  $('btn-editar-rend-obra').addEventListener('click', () => {
    wrap.innerHTML = `<input type="text" class="form-control" id="rend-obra-input" style="max-width:140px;" value="${escHtml(String(rendimientoActivo))}">`;
    const input = $('rend-obra-input');
    attachCalcInput(input, rendimientoFormulaActiva);
    input.focus();
    input.select();
    const guardar = () => {
      if (input.value.trim().startsWith('=')) input.blur();
      const n = parseFloat(input.value.replace(',', '.'));
      if (!isNaN(n) && n > 0) {
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
  $('resumen').innerHTML = `
    <div class="ap-resumen-row"><span>Costo unitario de Equipos (A)</span><span data-calc-valor="${r.costoUnitarioEquipos}">${fmtARS(r.costoUnitarioEquipos)}</span></div>
    <div class="ap-resumen-row"><span>Costo unitario Mano de Obra (B)</span><span data-calc-valor="${r.costoUnitarioMO}">${fmtARS(r.costoUnitarioMO)}</span></div>
    <div class="ap-resumen-row"><span>Costo unitario de Materiales (C)</span><span data-calc-valor="${r.costoMateriales}">${fmtARS(r.costoMateriales)}</span></div>
    <div class="ap-resumen-row total"><span>SUBTOTAL (A+B+C)</span><span data-calc-valor="${r.costoUnitario}">${fmtARS(r.costoUnitario)}</span></div>
    <p class="form-hint" style="margin-top:.5rem;">Costo de referencia con precios generales — no incluye Gastos Generales ni beneficio.</p>`;
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
          <input type="text" class="form-control linea-cantidad" placeholder="Cantidad">
          <button type="button" class="ap-linea-costo-unit"${d ? ` data-calc-valor="${d.costoUnitario}"` : ''}>${d ? fmtARS(d.costoUnitario) : '—'}</button><span class="ap-linea-costo-total"${d ? ` data-calc-valor="${d.costoTotal}"` : ''}>${d ? fmtARS(d.costoTotal) : '—'}</span>
          <button class="ap-linea-del" title="Eliminar línea">${icSvg('x')}</button>
        </div>`;
    }).join('');
  }
  if (r) {
    html += tipo === 'material'
      ? `<div class="ap-subtotal-linea total"><span>Costo unitario de Materiales (C)</span><span data-calc-valor="${r.costoMateriales}">${fmtARS(r.costoMateriales)}</span></div>`
      : `<div class="ap-subtotal-linea"><span>Costo diario Equipos</span><span data-calc-valor="${r.costoDiarioEquipos}">${fmtARS(r.costoDiarioEquipos)}</span></div>
         <div class="ap-subtotal-linea total"><span>Costo unitario de Equipos (A)</span><span data-calc-valor="${r.costoUnitarioEquipos}">${fmtARS(r.costoUnitarioEquipos)}</span></div>`;
  }
  container.innerHTML = html;

  container.querySelectorAll('.ap-linea[data-key]').forEach(row => {
    const lineaKey = row.dataset.key;
    const linea = lineas[lineaKey];
    const cantidadInput = row.querySelector('.linea-cantidad');

    cantidadInput.value = linea.cantidad ?? '';
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
    cantidadInput.addEventListener('blur', () => {
      const n = parseFloat(cantidadInput.value.replace(',', '.'));
      updateLinea(lineaKey, { cantidad: isNaN(n) ? null : n, cantidadFormula: getCalcFormula(cantidadInput) });
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
          <input type="text" class="form-control linea-cantidad" placeholder="Cantidad" value="${cantidad ?? ''}" data-calc-valor="${cantidad ?? 0}">
          <span class="ap-linea-costo-unit"${d ? ` data-calc-valor="${d.costoUnitario}"` : ''}>${d ? fmtARS(d.costoUnitario) : '—'}</span><span class="ap-linea-costo-total"${d ? ` data-calc-valor="${d.costoTotal}"` : ''}>${d ? fmtARS(d.costoTotal) : '—'}</span>
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
    html += `<div class="ap-subtotal-linea"><span>Costo diario Mano de Obra</span><span data-calc-valor="${r.costoDiarioMO}">${fmtARS(r.costoDiarioMO)}</span></div>
      <div class="ap-subtotal-linea total"><span>Costo unitario Mano de Obra (B)</span><span data-calc-valor="${r.costoUnitarioMO}">${fmtARS(r.costoUnitarioMO)}</span></div>`;
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
    cantidadInput.addEventListener('blur', () => {
      if (cantidadInput.value.trim() === '') {
        if (entry) deleteLinea(entry[0]);
        return;
      }
      const n = parseFloat(cantidadInput.value.replace(',', '.'));
      if (isNaN(n)) { cantidadInput.value = linea && linea.cantidad != null ? linea.cantidad : ''; return; }
      const lineaKey = entry ? entry[0] : `mo_${rolKey}`;
      updateLinea(lineaKey, { tipo: 'manoDeObra', refKey: rolKey, cantidad: n, cantidadFormula: getCalcFormula(cantidadInput) });
    });
    cantidadInput.addEventListener('keydown', e => { if (e.key === 'Enter') cantidadInput.blur(); });
  });
}

function setEquiposExpandido(abierto) {
  $('lineas-equipo').classList.toggle('hidden', !abierto);
  $('equipos-toggle').classList.toggle('expandido', abierto);
}

function renderTodasLasLineas() {
  const r = calcularDetalleActivo();
  renderLineasSeccion('material', r);
  renderLineasSeccion('equipo', r);
  renderManoDeObraSeccion(r);
  renderResumenCosto(r);
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
  $('mep-precio-nota').textContent = p && p.cotizacionUsada ? `Cotización usada: USD = ${fmtARS(p.cotizacionUsada)}` : '';
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
  return `<div class="ap-resumen-row"><span>${escHtml(label)}<br><span class="text-muted" style="font-size:.75rem;">${escHtml(formula)}</span></span><span>${fmtARS(valor)} $/día</span></div>`;
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
      `<div class="ap-resumen-row total"><span>Costo diario del equipo</span><span>${fmtARS(d.costoDiarioTotal)} $/día</span></div>`,
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
  if (obraParam) fetches.push(_fbGet(`/obras/${obraParam}/computo.json`), _fbGet(`/obras/${obraParam}/rubrosComputo.json`));

  const [itemData, versionesData, obrasData, materialesData, equiposData, rubrosData, allItemsData, computoData, rubrosComputoData] = await Promise.all(fetches);

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

  if (obraParam) ubicarLineaYNumeracion(computoData, rubrosComputoData);
  renderDatos();

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

  $('btn-usar-como-base').addEventListener('click', openUsarComoBaseModal);
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
