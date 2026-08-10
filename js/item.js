/* VIMECO S.A. — Sistema de Gestión — Ítem: Receta
   Editor de la receta del ítem (líneas de materiales/equipos/mano de obra con
   cantidades) y su rendimiento. Sin precio: el costo se arma en vivo en el
   Cómputo de cada obra, a partir de esta receta + precios generales (ver
   js/calcCostos.js, calcCostoUnitarioItem). */

const $ = id => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const itemKey = params.get('key');

let item = null;
let lineas = {};       // { lineaKey: { tipo, refKey, cantidad } }
let materiales = [];
let equipos = [];
let roles = [];
let rubros = [];
let rubrosMap = {};

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

function renderDatos() {
  $('header-item-nombre').textContent = item.nombre;
  $('item-titulo-card').textContent = item.nombre;
  const rubroNombre = item.rubroKey && rubrosMap[item.rubroKey] ? rubrosMap[item.rubroKey] : 'Sin rubro';
  $('item-datos-resumen').innerHTML =
    `<span class="item-card-meta">${escHtml(rubroNombre)} · Unidad: ${escHtml(item.unidad)} · Rendimiento: ${escHtml(String(item.rendimiento))} uds./jornada</span>`;
}

function renderLineasSeccion(tipo) {
  const container = $(`lineas-${tipo}`);
  const cat = catalogoFor(tipo);
  const entradas = Object.entries(lineas).filter(([, l]) => l.tipo === tipo);

  let html = `<p class="form-hint" style="margin-bottom:.75rem;">${HINTS[tipo]}</p>`;
  if (!entradas.length) {
    html += '<p class="text-muted" style="font-size:.85rem;">Sin líneas todavía.</p>';
  } else if (!cat.length && tipo !== 'material') {
    html += '<p class="text-muted" style="font-size:.85rem;">No hay catálogo cargado para este tipo.</p>';
  } else {
    html += entradas.map(([lineaKey]) => `
        <div class="ap-linea" data-key="${escHtml(lineaKey)}">
          <div class="linea-select-wrap">
            <div class="linea-select-container"></div>
            ${tipo === 'material' ? '<span class="linea-unidad-badge"></span>' : ''}
          </div>
          <input type="text" class="form-control linea-cantidad" placeholder="Cantidad">
          <button class="ap-linea-del" title="Eliminar línea">${icSvg('x')}</button>
        </div>`).join('');
  }
  container.innerHTML = html;

  container.querySelectorAll('.ap-linea').forEach(row => {
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
      placeholder: `Buscar ${tipo === 'manoDeObra' ? 'rol' : tipo}…`,
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

function renderTodasLasLineas() {
  renderLineasSeccion('material');
  renderLineasSeccion('equipo');
  renderLineasSeccion('manoDeObra');
}

async function persistLineas() {
  try {
    await _fbPut(`/items/${itemKey}/lineas.json`, lineas);
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
  if (!itemKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta el ítem (?key=...).</p>';
    return;
  }
  const [itemData, lineasData, materialesData, equiposData, rolesData, rubrosData] = await Promise.all([
    _fbGet(`/items/${itemKey}.json`),
    _fbGet(`/items/${itemKey}/lineas.json`),
    _fbGet('/materiales.json'),
    _fbGet('/equipos.json'),
    _fbGet('/manoDeObra.json'),
    _fbGet('/rubros.json'),
  ]);

  if (!itemData) {
    document.body.innerHTML = '<p style="padding:2rem;">No se encontró el ítem.</p>';
    return;
  }
  item = itemData;
  lineas = lineasData || {};
  materiales = Object.entries(materialesData || {}).map(([key, m]) => ({ key, ...m })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  equipos = Object.entries(equiposData || {}).map(([key, e]) => ({ key, ...e })).sort((a, b) => a.codigo.localeCompare(b.codigo, 'es'));
  roles = Object.entries(rolesData || {}).map(([key, r]) => ({ key, ...r })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  rubros = Object.entries(rubrosData || {}).map(([key, r]) => ({ key, ...r })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  rubrosMap = {};
  rubros.forEach(r => { rubrosMap[r.key] = r.nombre; });

  populateRubroSelect();
  renderDatos();
  renderTodasLasLineas();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  attachCalcInput($('item-rendimiento'));

  $('btn-editar-datos').addEventListener('click', openEditDatosModal);
  $('modal-item-close').addEventListener('click',  () => $('modal-item').classList.add('hidden'));
  $('modal-item-cancel').addEventListener('click', () => $('modal-item').classList.add('hidden'));
  $('modal-item-save').addEventListener('click', saveDatosModal);

  $('btn-add-linea-material').addEventListener('click', () => addLinea('material'));
  $('btn-add-linea-equipo').addEventListener('click', () => addLinea('equipo'));
  $('btn-add-linea-manoDeObra').addEventListener('click', () => addLinea('manoDeObra'));

  $('modal-material-quick-close').addEventListener('click', () => $('modal-material-quick').classList.add('hidden'));
  $('modal-material-quick-cancel').addEventListener('click', () => $('modal-material-quick').classList.add('hidden'));
  $('modal-material-quick-save').addEventListener('click', saveQuickMaterial);
  $('qm-moneda-usd').addEventListener('click', () => setQmMoneda('USD'));
  $('qm-moneda-ars').addEventListener('click', () => setQmMoneda('ARS'));
  attachCalcInput($('qm-precio'));

  await loadAll();
});
