/* VIMECO S.A. — Sistema de Gestión — Ítem: Rendimientos
   Un ítem tiene varias VERSIONES de rendimiento+receta: la "Teórica" (la de
   referencia, vive en los campos de siempre de /items/{key}) y opcionalmente
   una por cada obra donde se usó (/items/{key}/versionesObra/{obraKey}),
   cada una con su propia receta completa — no comparten líneas. La versión
   de una obra se crea sola la primera vez que se edita algo estando parado
   en esa obra (arranca como copia en memoria de la teórica). La Teórica no
   muestra costo (mismo criterio de siempre); las versiones de obra sí,
   calculado en vivo con calcCostoUnitarioItem (js/calcCostos.js) — para
   poder comparar costo real entre obras. */

const $ = id => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const itemKey = params.get('key');
const obraParam = params.get('obra');
const lineaParam = params.get('linea');
const modoVincular = !itemKey && !!lineaParam && !!obraParam;

let item = null;
let lineasTeorico = {};
let rendimientoTeorico = null;
let rendimientoFormulaTeorico = null;
let versionesObra = {};    // { obraKey: { rendimiento, rendimientoFormula, lineas } }
let obrasMap = {};
let activeVersion = 'teorico';
let versionExisteEnServidor = true;

let lineas = {};       // { lineaKey: { tipo, refKey, cantidad } } — de la versión activa
let rendimientoActivo = null;
let rendimientoFormulaActiva = null;
let detallePorLineaActivo = {};   // { lineaKey: { costoUnitario, costoTotal } } — sólo en pestañas de obra

let materiales = [];
let equipos = [];
let roles = [];
let rubros = [];
let rubrosMap = {};
let paramsEquipos = { tasaInteresPct: 10, reparacionesPct: 75, lubricantesPct: 50, combustibleLtsPorHp: 0.1, precioCombustibleLitro: 0 };
let paramsMO = { asistenciaPct: 20, cargasPct: 100, diasMes: 22, jornadaHoras: 8 };

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

// -- Modo "vincular ítem" (línea de Cómputo sin itemKey todavía) ----------

function populateNiRubroSelect() {
  const opts = rubros.map(r => `<option value="${escHtml(r.key)}">${escHtml(r.nombre)}</option>`).join('');
  $('ni-rubro').innerHTML = '<option value="">— Elegir rubro —</option>' + opts;
}

async function vincularItem(key) {
  try {
    const cambios = { itemKey: key };
    const itemVinculado = items.find(i => i.key === key);
    const lineaActual = await _fbGet(`/obras/${obraParam}/computo/${lineaParam}.json`);
    if (itemVinculado && (!lineaActual || !lineaActual.unidad)) cambios.unidad = itemVinculado.unidad;
    await _fbPatch(`/obras/${obraParam}/computo/${lineaParam}.json`, cambios);
    window.location.href = `item.html?key=${encodeURIComponent(key)}&obra=${encodeURIComponent(obraParam)}`;
  } catch (_) {
    showToast('Error al vincular el ítem. Intentá de nuevo.', 'error');
  }
}

let niPendiente = false;

function openNuevoItemModal(texto) {
  $('ni-nombre').value = texto || '';
  $('ni-unidad').value = '';
  $('ni-rubro').value = '';
  $('ni-rendimiento').value = '';
  setCalcFormula($('ni-rendimiento'), null);
  $('modal-item-nuevo-error').classList.add('hidden');
  $('modal-item-nuevo').classList.remove('hidden');
  setTimeout(() => $('ni-nombre').focus(), 50);
}

async function saveNuevoItem() {
  const nombre = $('ni-nombre').value.trim();
  const unidad = $('ni-unidad').value.trim();
  const rubroKey = $('ni-rubro').value;
  const errEl = $('modal-item-nuevo-error');

  const rendInput = $('ni-rendimiento');
  if (rendInput.value.trim().startsWith('=')) rendInput.blur();
  const rendimiento = parseFloat(rendInput.value.replace(',', '.'));

  if (!nombre || !unidad) {
    errEl.textContent = 'Nombre y unidad son requeridos.';
    errEl.classList.remove('hidden');
    return;
  }
  if (!rubroKey) {
    errEl.textContent = 'El rubro es requerido.';
    errEl.classList.remove('hidden');
    return;
  }
  if (isNaN(rendimiento) || rendimiento <= 0) {
    errEl.textContent = 'El rendimiento tiene que ser un número mayor a 0.';
    errEl.classList.remove('hidden');
    return;
  }

  const key = nombre.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40)
    + '_' + Date.now();
  const data = { nombre, unidad, rubroKey, rendimiento, rendimientoFormula: getCalcFormula(rendInput), creadoEn: Date.now() };

  if (niPendiente) return;
  niPendiente = true;
  try {
    await _fbPut(`/items/${key}.json`, data);
    items.push({ key, ...data });
    $('modal-item-nuevo').classList.add('hidden');
    await vincularItem(key);
  } catch (_) {
    errEl.textContent = 'Error al guardar. Intentá de nuevo.';
    errEl.classList.remove('hidden');
    niPendiente = false;
  }
}

function renderVincularUI() {
  $('header-item-nombre').textContent = 'Análisis de Precio';
  const options = items.map(it => ({ value: it.key, label: it.nombre, sublabel: rubrosMap[it.rubroKey] || 'Sin rubro' }));
  createSearchableSelect($('link-item-select'), {
    options,
    value: null,
    placeholder: 'Buscar ítem…',
    onChange: v => vincularItem(v),
    onCreateNew: texto => openNuevoItemModal(texto),
  });
}

function renderDatos() {
  $('header-item-nombre').textContent = item.nombre;
  $('item-titulo-card').textContent = item.nombre;
  const rubroNombre = item.rubroKey && rubrosMap[item.rubroKey] ? rubrosMap[item.rubroKey] : 'Sin rubro';
  $('item-datos-resumen').innerHTML =
    `<span class="item-card-meta">${escHtml(rubroNombre)} · Unidad: ${escHtml(item.unidad)} · Rendimiento teórico: ${escHtml(String(rendimientoTeorico))} uds./jornada</span>`;
}

// -- Versiones (Teórico / obra) -------------------------------------------

function basePath() {
  return activeVersion === 'teorico' ? `/items/${itemKey}` : `/items/${itemKey}/versionesObra/${activeVersion}`;
}

function activarVersion(key) {
  activeVersion = key;
  if (key === 'teorico') {
    lineas = lineasTeorico;
    rendimientoActivo = rendimientoTeorico;
    rendimientoFormulaActiva = rendimientoFormulaTeorico;
    versionExisteEnServidor = true;
  } else {
    const v = versionesObra[key];
    if (v) {
      lineas = v.lineas || {};
      rendimientoActivo = v.rendimiento;
      rendimientoFormulaActiva = v.rendimientoFormula;
      versionExisteEnServidor = true;
    } else {
      // No existe todavía: arranca como copia en memoria de la teórica.
      lineas = JSON.parse(JSON.stringify(lineasTeorico));
      rendimientoActivo = rendimientoTeorico;
      rendimientoFormulaActiva = rendimientoFormulaTeorico;
      versionExisteEnServidor = false;
    }
  }
  renderVersionTabs();
  renderVersionRendimiento();
  renderTodasLasLineas();
}

function renderVersionTabs() {
  const tabs = [{ key: 'teorico', label: 'Teórico' }];
  Object.keys(versionesObra).forEach(k => tabs.push({ key: k, label: obrasMap[k] || k }));
  if (obraParam && !versionesObra[obraParam]) tabs.push({ key: obraParam, label: (obrasMap[obraParam] || obraParam) + ' (nueva)' });

  $('version-tabs').innerHTML = tabs.map(t => `
    <button class="btn btn-sm ${t.key === activeVersion ? 'btn-primary' : 'btn-outline'} version-tab" data-version="${escHtml(t.key)}">${escHtml(t.label)}</button>`).join('');
  $('version-tabs').querySelectorAll('.version-tab').forEach(btn => {
    btn.addEventListener('click', () => activarVersion(btn.dataset.version));
  });

  const aviso = $('version-aviso');
  if (activeVersion !== 'teorico' && !versionExisteEnServidor) {
    aviso.textContent = 'Esta obra todavía no tiene una versión propia — se crea en cuanto edites algo. Por ahora se muestra una copia del Teórico.';
    aviso.classList.remove('hidden');
  } else {
    aviso.classList.add('hidden');
  }
}

function renderVersionRendimiento() {
  const wrap = $('version-rendimiento');
  if (activeVersion === 'teorico') { wrap.classList.add('hidden'); wrap.innerHTML = ''; return; }
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
// de líneas, para no repetir el cálculo. En Teórico no calcula nada.
function calcularDetalleActivo() {
  if (activeVersion === 'teorico') { detallePorLineaActivo = {}; return null; }
  const catalogos = { materiales, equipos, roles };
  const r = window.calcCostoUnitarioItem({ rendimiento: rendimientoActivo }, lineas, catalogos, paramsEquipos, paramsMO);
  detallePorLineaActivo = r.detallePorLinea;
  return r;
}

function renderResumenCosto(r) {
  const card = $('resumen-card');
  if (activeVersion === 'teorico' || !r) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  $('resumen').innerHTML = `
    <div class="ap-resumen-row"><span>Costo Materiales</span><span>${fmtARS(r.costoMateriales)}</span></div>
    <div class="ap-resumen-row"><span>Costo Equipos + Mano de Obra (por unidad)</span><span>${fmtARS(r.costoEquiposMOPorUnidad)}</span></div>
    <div class="ap-resumen-row total"><span>Costo unitario</span><span>${fmtARS(r.costoUnitario)}</span></div>
    <p class="form-hint" style="margin-top:.5rem;">Costo de referencia con precios generales — no incluye Gastos Generales ni beneficio.</p>`;
}

// Si la versión activa (de obra) todavía no existe en el servidor, la crea
// entera (rendimiento + receta actual) antes de cualquier edición puntual —
// así arranca siempre como copia completa de la teórica, no sólo con el
// campo que se acaba de tocar. Devuelve true si la acabó de crear (en ese
// caso el llamador no necesita hacer ningún otro write, ya quedó todo
// guardado).
async function ensureVersionExists() {
  if (activeVersion === 'teorico' || versionExisteEnServidor) return false;
  try {
    const data = { rendimiento: rendimientoActivo, rendimientoFormula: rendimientoFormulaActiva, lineas };
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
    if (activeVersion !== 'teorico') versionesObra[activeVersion] = { ...versionesObra[activeVersion], ...cambios };
  } catch (_) {
    showToast('Error al guardar el rendimiento.', 'error');
  }
}

function renderLineasSeccion(tipo) {
  const container = $(`lineas-${tipo}`);
  const cat = catalogoFor(tipo);
  const entradas = Object.entries(lineas).filter(([, l]) => l.tipo === tipo);
  const conCosto = activeVersion !== 'teorico';

  let html = `<p class="form-hint" style="margin-bottom:.75rem;">${HINTS[tipo]}</p>`;
  if (!entradas.length) {
    html += '<p class="text-muted" style="font-size:.85rem;">Sin líneas todavía.</p>';
  } else if (!cat.length && tipo !== 'material') {
    html += '<p class="text-muted" style="font-size:.85rem;">No hay catálogo cargado para este tipo.</p>';
  } else {
    if (conCosto) html += `<div class="ap-linea ap-linea-header con-costo"><span></span><span>Cantidad</span><span>Costo unitario</span><span>Costo total</span><span></span></div>`;
    html += entradas.map(([lineaKey]) => {
      const d = detallePorLineaActivo[lineaKey];
      return `
        <div class="ap-linea${conCosto ? ' con-costo' : ''}" data-key="${escHtml(lineaKey)}">
          <div class="linea-select-wrap">
            <div class="linea-select-container"></div>
            ${tipo === 'material' ? '<span class="linea-unidad-badge"></span>' : ''}
          </div>
          <input type="text" class="form-control linea-cantidad" placeholder="Cantidad">
          ${conCosto ? `<span class="ap-linea-costo-unit">${d ? fmtARS(d.costoUnitario) : '—'}</span><span class="ap-linea-costo-total">${d ? fmtARS(d.costoTotal) : '—'}</span>` : ''}
          <button class="ap-linea-del" title="Eliminar línea">${icSvg('x')}</button>
        </div>`;
    }).join('');
  }
  container.innerHTML = html;

  container.querySelectorAll('.ap-linea[data-key]').forEach(row => {
    const lineaKey = row.dataset.key;
    const linea = lineas[lineaKey];
    const cantidadInput = row.querySelector('.linea-cantidad');

    cantidadInput.value = linea.cantidad ?? '';

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
      row.querySelector('.linea-unidad-badge').textContent = mat ? mat.unidad : '';
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
function renderManoDeObraSeccion() {
  const container = $('lineas-manoDeObra');
  const conCosto = activeVersion !== 'teorico';
  let html = `<p class="form-hint" style="margin-bottom:.75rem;">${HINTS.manoDeObra}</p>`;
  if (!roles.length) {
    html += '<p class="text-muted" style="font-size:.85rem;">No hay catálogo de Mano de Obra cargado todavía.</p>';
  } else {
    if (conCosto) html += `<div class="ap-linea-mo ap-linea-header con-costo"><span></span><span>Cantidad</span><span>Costo unitario</span><span>Costo total</span></div>`;
    html += roles.map(rol => {
      const entry = Object.entries(lineas).find(([, l]) => l.tipo === 'manoDeObra' && l.refKey === rol.key);
      const cantidad = entry ? entry[1].cantidad : null;
      const d = entry ? detallePorLineaActivo[entry[0]] : null;
      return `
        <div class="ap-linea-mo${conCosto ? ' con-costo' : ''}" data-rol="${escHtml(rol.key)}">
          <span class="ap-linea-mo-nombre">${escHtml(rol.nombre)}</span>
          <input type="text" class="form-control linea-cantidad" placeholder="Cantidad" value="${cantidad ?? ''}">
          ${conCosto ? `<span class="ap-linea-costo-unit">${d ? fmtARS(d.costoUnitario) : '—'}</span><span class="ap-linea-costo-total">${d ? fmtARS(d.costoTotal) : '—'}</span>` : ''}
        </div>`;
    }).join('');
  }
  container.innerHTML = html;

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

function renderTodasLasLineas() {
  const r = calcularDetalleActivo();
  renderLineasSeccion('material');
  renderLineasSeccion('equipo');
  renderManoDeObraSeccion();
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
  $('qm-precio').value = '';
  setCalcFormula($('qm-precio'), null);
  $('qm-proveedor').value = '';
  $('qm-fecha').value = new Date().toISOString().slice(0, 10);
  setQmMoneda('USD');
  $('modal-material-error-qm').classList.add('hidden');
  $('modal-material-quick').classList.remove('hidden');
  setTimeout(() => $('qm-nombre').focus(), 50);
}

let qmMoneda = 'USD';
function setQmMoneda(m) {
  qmMoneda = m;
  $('qm-moneda-usd').classList.toggle('is-active', m === 'USD');
  $('qm-moneda-ars').classList.toggle('is-active', m === 'ARS');
}

async function saveQuickMaterial() {
  const nombre = $('qm-nombre').value.trim();
  const unidad = $('qm-unidad').value.trim();
  const proveedor = $('qm-proveedor').value.trim();
  const fecha = $('qm-fecha').value || new Date().toISOString().slice(0, 10);
  const errEl = $('modal-material-error-qm');

  const precioInput = $('qm-precio');
  if (precioInput.value.trim().startsWith('=')) precioInput.blur();
  const precioIngresado = parseFloat(precioInput.value.replace(',', '.'));

  if (!nombre || !unidad) {
    errEl.textContent = 'Nombre y unidad son requeridos.';
    errEl.classList.remove('hidden');
    return;
  }
  if (isNaN(precioIngresado) || precioIngresado < 0) {
    errEl.textContent = 'El precio no es válido.';
    errEl.classList.remove('hidden');
    return;
  }
  const dual = resolveDualPrecio(qmMoneda, precioIngresado);
  if (!dual) {
    errEl.textContent = 'No se pudo obtener la cotización del dólar. Reintentá en un momento.';
    errEl.classList.remove('hidden');
    return;
  }

  const key = nombre.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40)
    + '_' + Date.now();
  const data = {
    nombre, unidad, precioUSD: dual.precioUSD, precioARS: dual.precioARS,
    precioFormula: getCalcFormula(precioInput), proveedor, fecha, creadoEn: Date.now(),
  };

  try {
    await _fbPut(`/materiales/${key}.json`, data);
    materiales.push({ key, ...data });
    materiales.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    $('modal-material-quick').classList.add('hidden');
    showToast('Material creado.');
    if (pendingLineaKey) updateLinea(pendingLineaKey, { refKey: key });
  } catch (_) {
    errEl.textContent = 'Error al guardar. Intentá de nuevo.';
    errEl.classList.remove('hidden');
  }
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
  $('item-rendimiento').value = item.rendimiento ?? '';
  setCalcFormula($('item-rendimiento'), item.rendimientoFormula);
  $('modal-item-error').classList.add('hidden');
  $('modal-item').classList.remove('hidden');
}

async function saveDatosModal() {
  const nombre = $('item-nombre').value.trim();
  const unidad = $('item-unidad').value.trim();
  const rubroKey = $('item-rubro').value;
  const errEl = $('modal-item-error');

  const rendInput = $('item-rendimiento');
  if (rendInput.value.trim().startsWith('=')) rendInput.blur();
  const rendimiento = parseFloat(rendInput.value.replace(',', '.'));

  if (!nombre || !unidad) {
    errEl.textContent = 'Nombre y unidad son requeridos.';
    errEl.classList.remove('hidden');
    return;
  }
  if (isNaN(rendimiento) || rendimiento <= 0) {
    errEl.textContent = 'El rendimiento tiene que ser un número mayor a 0.';
    errEl.classList.remove('hidden');
    return;
  }

  try {
    const data = { nombre, unidad, rubroKey, rendimiento, rendimientoFormula: getCalcFormula(rendInput) };
    await _fbPatch(`/items/${itemKey}.json`, data);
    item = { ...item, ...data };
    rendimientoTeorico = rendimiento;
    rendimientoFormulaTeorico = data.rendimientoFormula;
    if (activeVersion === 'teorico') { rendimientoActivo = rendimientoTeorico; rendimientoFormulaActiva = rendimientoFormulaTeorico; }
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

async function loadVincular() {
  const [itemsData, rubrosData] = await Promise.all([
    _fbGet('/items.json'),
    _fbGet('/rubros.json'),
  ]);
  items = Object.entries(itemsData || {}).map(([key, it]) => ({ key, ...it })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  rubros = Object.entries(rubrosData || {}).map(([key, r]) => ({ key, ...r })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  rubrosMap = {};
  rubros.forEach(r => { rubrosMap[r.key] = r.nombre; });

  populateNiRubroSelect();
  $('link-item-card').classList.remove('hidden');
  $('normal-content').classList.add('hidden');
  renderVincularUI();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

async function loadAll() {
  if (modoVincular) { await loadVincular(); return; }
  if (!itemKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta el ítem (?key=...).</p>';
    return;
  }
  const [itemData, lineasData, versionesData, obrasData, materialesData, equiposData, rolesData, rubrosData, cfgEquipos, cfgMO] = await Promise.all([
    _fbGet(`/items/${itemKey}.json`),
    _fbGet(`/items/${itemKey}/lineas.json`),
    _fbGet(`/items/${itemKey}/versionesObra.json`),
    _fbGet('/obras.json'),
    _fbGet('/materiales.json'),
    _fbGet('/equipos.json'),
    _fbGet('/manoDeObra.json'),
    _fbGet('/rubros.json'),
    _fbGet('/config/equipos.json'),
    _fbGet('/config/manoDeObra.json'),
  ]);

  if (!itemData) {
    document.body.innerHTML = '<p style="padding:2rem;">No se encontró el ítem.</p>';
    return;
  }
  item = itemData;
  lineasTeorico = lineasData || {};
  rendimientoTeorico = item.rendimiento;
  rendimientoFormulaTeorico = item.rendimientoFormula;
  versionesObra = versionesData || {};
  obrasMap = {};
  Object.entries(obrasData || {}).forEach(([key, o]) => { obrasMap[key] = o.nombre; });
  materiales = Object.entries(materialesData || {}).map(([key, m]) => ({ key, ...m })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  equipos = Object.entries(equiposData || {}).map(([key, e]) => ({ key, ...e })).sort((a, b) => a.codigo.localeCompare(b.codigo, 'es'));
  // Orden jerárquico (Oficial Especializado > Oficial > Ayudante), no
  // alfabético — casualmente es el alfabético invertido con los roles de
  // hoy. Si se agrega un rol que no encaje en ese orden (ej. "Capataz"),
  // hace falta un campo `orden` real en /manoDeObra (mano-de-obra.html).
  roles = Object.entries(rolesData || {}).map(([key, r]) => ({ key, ...r })).sort((a, b) => b.nombre.localeCompare(a.nombre, 'es'));
  rubros = Object.entries(rubrosData || {}).map(([key, r]) => ({ key, ...r })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  rubrosMap = {};
  rubros.forEach(r => { rubrosMap[r.key] = r.nombre; });
  if (cfgEquipos) paramsEquipos = { ...paramsEquipos, ...cfgEquipos };
  if (cfgMO) paramsMO = { ...paramsMO, ...cfgMO };

  populateRubroSelect();
  renderDatos();
  activarVersion(obraParam || 'teorico');

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  // Volver: si venimos de un Cómputo (?obra=), vuelve ahí; si no, a Biblioteca.
  const hrefVolver = obraParam ? `computo.html?obra=${encodeURIComponent(obraParam)}` : 'biblioteca.html';
  $('btn-header-volver').addEventListener('click', () => window.location.href = hrefVolver);
  $('btn-volver').addEventListener('click', () => window.location.href = hrefVolver);

  $('modal-item-nuevo-close').addEventListener('click', () => $('modal-item-nuevo').classList.add('hidden'));
  $('modal-item-nuevo-cancel').addEventListener('click', () => $('modal-item-nuevo').classList.add('hidden'));
  $('modal-item-nuevo-save').addEventListener('click', saveNuevoItem);
  attachCalcInput($('ni-rendimiento'));

  attachCalcInput($('item-rendimiento'));

  $('btn-editar-datos').addEventListener('click', openEditDatosModal);
  $('modal-item-close').addEventListener('click',  () => $('modal-item').classList.add('hidden'));
  $('modal-item-cancel').addEventListener('click', () => $('modal-item').classList.add('hidden'));
  $('modal-item-save').addEventListener('click', saveDatosModal);

  $('btn-add-linea-material').addEventListener('click', () => addLinea('material'));
  $('btn-add-linea-equipo').addEventListener('click', () => addLinea('equipo'));

  $('modal-material-quick-close').addEventListener('click', () => $('modal-material-quick').classList.add('hidden'));
  $('modal-material-quick-cancel').addEventListener('click', () => $('modal-material-quick').classList.add('hidden'));
  $('modal-material-quick-save').addEventListener('click', saveQuickMaterial);
  $('qm-moneda-usd').addEventListener('click', () => setQmMoneda('USD'));
  $('qm-moneda-ars').addEventListener('click', () => setQmMoneda('ARS'));
  attachCalcInput($('qm-precio'));

  await loadAll();
});
