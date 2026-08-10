/* VIMECO S.A. — Sistema de Gestión — Cómputo de obra
   Cantidad de cada ítem de la Biblioteca que compone la obra, agrupado por
   rubro (con subtotales). El costo unitario se calcula en vivo a partir de
   la receta del ítem (líneas + rendimiento) y los precios generales de
   materiales/equipos/mano de obra (ver js/calcCostos.js,
   calcCostoUnitarioItem) — la Biblioteca no cachea ningún costo. Es costo
   total de obra sin carga (sin %GG, beneficio, financiero ni IVA) — eso se
   aplica en el Presupuesto, etapa siguiente.

   El rubro de cada línea sigue siendo el rubroKey del ítem (no se guarda
   por línea) — lo que se puede personalizar por obra es sólo el NOMBRE que
   se muestra para ese rubro (rubroOverrides, path separado de las líneas)
   y el nombre que se muestra para la línea (nombreOverride, en la línea),
   para calzar con el pliego del cliente sin tocar la Biblioteca. */

const $ = id => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const obraKey = params.get('obra');

let obra = null;
let lineas = {};   // { lineaKey: { itemKey, cantidad, cantidadFormula, nombreOverride } }
let items = [];
let rubros = [];
let rubrosMap = {};
let rubroOverrides = {};   // { rubroKey: nombre }
let materiales = [];
let equipos = [];
let roles = [];
let paramsEquipos = { tasaInteresPct: 10, reparacionesPct: 75, lubricantesPct: 50, combustibleLtsPorHp: 0.1, precioCombustibleLitro: 0 };
let paramsMO = { asistenciaPct: 20, cargasPct: 100, diasMes: 22, jornadaHoras: 8 };
let editingRubroKey = null;
let pendingLineaKey = null;

function costoUnitarioDe(itemKey) {
  const it = items.find(i => i.key === itemKey);
  if (!it || !it.lineas || !Object.keys(it.lineas).length) return null;
  const catalogos = { materiales, equipos, roles };
  const r = window.calcCostoUnitarioItem(it, it.lineas, catalogos, paramsEquipos, paramsMO);
  return r.costoUnitario;
}

function totalLinea(linea) {
  const costo = costoUnitarioDe(linea.itemKey);
  if (costo == null || linea.cantidad == null || isNaN(linea.cantidad)) return null;
  return costo * linea.cantidad;
}

function nombreRubro(rubroKey) {
  if (rubroOverrides[rubroKey]) return rubroOverrides[rubroKey];
  return rubrosMap[rubroKey] || 'Sin rubro';
}

// Agrupa las líneas por rubro del ítem (no de la línea): ítems sin ítem
// asignado o con ítem borrado van en un grupo aparte al principio.
function agruparLineas() {
  const entradas = Object.entries(lineas);
  const pendientes = [];
  const porRubro = {};   // rubroKey -> [[lineaKey, linea]]
  const sinRubro = [];

  entradas.forEach(([lineaKey, linea]) => {
    const it = items.find(i => i.key === linea.itemKey);
    if (!it) { pendientes.push([lineaKey, linea]); return; }
    if (it.rubroKey && rubrosMap[it.rubroKey]) {
      (porRubro[it.rubroKey] = porRubro[it.rubroKey] || []).push([lineaKey, linea]);
    } else {
      sinRubro.push([lineaKey, linea]);
    }
  });

  const grupos = [];
  if (pendientes.length) grupos.push({ key: '_pendiente', nombre: '⚠ Sin ítem asignado', warning: true, lineas: pendientes });
  rubros.forEach(r => {
    if (porRubro[r.key]) grupos.push({ key: r.key, nombre: nombreRubro(r.key), lineas: porRubro[r.key] });
  });
  if (sinRubro.length) grupos.push({ key: '_sin_rubro', nombre: 'Sin rubro', lineas: sinRubro });
  return grupos;
}

function subtotalGrupo(grupoLineas) {
  return grupoLineas.reduce((acc, [, l]) => {
    const t = totalLinea(l);
    return t == null ? acc : acc + t;
  }, 0);
}

function renderRubroHeader(grupo) {
  const editable = grupo.key !== '_pendiente' && grupo.key !== '_sin_rubro';
  const nombreHtml = editingRubroKey === grupo.key
    ? `<input type="text" class="form-control computo-rubro-nombre-input" id="rubro-edit-input" value="${escHtml(rubroOverrides[grupo.key] || rubrosMap[grupo.key] || '')}">`
    : `<span class="computo-rubro-nombre">${escHtml(grupo.nombre)}</span>${editable ? `<button class="computo-rubro-edit" data-rubro="${escHtml(grupo.key)}" title="Renombrar para esta obra">${icSvg('edit')}</button>` : ''}`;
  return `
    <div class="computo-rubro-header${grupo.warning ? ' computo-rubro-warning' : ''}" data-rubro-group="${escHtml(grupo.key)}">
      <span class="flex items-center gap-2">${nombreHtml}</span>
      <span class="computo-rubro-subtotal">${fmtARS(subtotalGrupo(grupo.lineas))}</span>
    </div>`;
}

function itemOptions() {
  return items.map(it => ({
    value: it.key,
    label: it.nombre,
    sublabel: rubrosMap[it.rubroKey] || 'Sin rubro',
  }));
}

function renderLineaRow(lineaKey, linea) {
  const it = items.find(i => i.key === linea.itemKey);
  const costo = costoUnitarioDe(linea.itemKey);
  const total = totalLinea(linea);
  return `
    <div class="computo-linea" data-key="${escHtml(lineaKey)}">
      <div class="linea-select-container"></div>
      <input type="text" class="form-control linea-nombre-override" placeholder="${it ? escHtml(it.nombre) : 'Nombre del ítem'}">
      <span class="computo-linea-unidad">${it ? escHtml(it.unidad) : '—'}</span>
      <input type="text" class="form-control linea-cantidad" placeholder="Cantidad">
      <span class="computo-linea-costo">${costo != null ? fmtARS(costo) : '—'}</span>
      <span class="computo-linea-total">${total != null ? fmtARS(total) : '—'}</span>
      <button class="computo-linea-del" title="Eliminar línea">${icSvg('x')}</button>
    </div>`;
}

function renderLineas() {
  const container = $('lineas-computo');

  if (!items.length) {
    container.innerHTML = '<p class="text-muted" style="font-size:.85rem;">No hay ítems cargados en la Biblioteca todavía.</p>';
    return;
  }
  if (!Object.keys(lineas).length) {
    container.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Sin ítems todavía.</p>';
  } else {
    const grupos = agruparLineas();
    const header = `
      <div class="computo-linea computo-linea-header">
        <span>Ítem</span><span>Nombre en el pliego</span><span>Unidad</span><span>Cantidad</span><span>Costo unitario</span><span>Costo subtotal</span><span></span>
      </div>`;
    container.innerHTML = header + grupos.map(g => renderRubroHeader(g) + g.lineas.map(([k, l]) => renderLineaRow(k, l)).join('')).join('');
  }

  const rubroInput = $('rubro-edit-input');
  if (rubroInput) {
    rubroInput.focus();
    rubroInput.select();
    const guardar = () => {
      const nombre = rubroInput.value.trim();
      persistRubroOverride(editingRubroKey, nombre);
      editingRubroKey = null;
      renderTodo();
    };
    rubroInput.addEventListener('blur', guardar);
    rubroInput.addEventListener('keydown', e => { if (e.key === 'Enter') rubroInput.blur(); });
  }

  container.querySelectorAll('.computo-rubro-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      editingRubroKey = btn.dataset.rubro;
      renderTodo();
    });
  });

  container.querySelectorAll('.computo-linea[data-key]').forEach(row => {
    const lineaKey = row.dataset.key;
    const linea = lineas[lineaKey];
    const nombreInput = row.querySelector('.linea-nombre-override');
    const cantidadInput = row.querySelector('.linea-cantidad');

    createSearchableSelect(row.querySelector('.linea-select-container'), {
      options: itemOptions(),
      value: linea.itemKey,
      placeholder: 'Buscar ítem…',
      onChange: v => updateLinea(lineaKey, { itemKey: v }),
      onCreateNew: texto => openQuickItemModal(texto, lineaKey),
    });

    nombreInput.value = linea.nombreOverride || '';
    nombreInput.addEventListener('blur', () => {
      const v = nombreInput.value.trim();
      if (v !== (linea.nombreOverride || '')) updateLinea(lineaKey, { nombreOverride: v || null });
    });
    nombreInput.addEventListener('keydown', e => { if (e.key === 'Enter') nombreInput.blur(); });

    cantidadInput.value = linea.cantidad ?? '';
    attachCalcInput(cantidadInput, linea.cantidadFormula);
    cantidadInput.addEventListener('blur', () => {
      const n = parseFloat(cantidadInput.value.replace(',', '.'));
      updateLinea(lineaKey, { cantidad: isNaN(n) ? null : n, cantidadFormula: getCalcFormula(cantidadInput) });
    });
    cantidadInput.addEventListener('keydown', e => { if (e.key === 'Enter') cantidadInput.blur(); });
    row.querySelector('.computo-linea-del').addEventListener('click', () => deleteLinea(lineaKey));
  });
}

function renderResumen() {
  const total = Object.values(lineas).reduce((acc, l) => {
    const t = totalLinea(l);
    return t == null ? acc : acc + t;
  }, 0);
  $('resumen').innerHTML = `
    <div class="ap-resumen-row total"><span>Costo total del cómputo</span><span>${fmtARS(total)}</span></div>
    <p class="form-hint" style="margin-top:.5rem;">Costo sin Gastos Generales, beneficio ni IVA — eso se aplica en el Presupuesto de la obra.</p>`;
}

function renderTodo() {
  renderLineas();
  renderResumen();
}

// Cada línea se guarda en su propio path (PUT al crear, PATCH al editar
// campos sueltos) en vez de reescribir el árbol completo de /computo —
// mismo criterio que carga-fija.js, evita perder líneas si se edita rápido
// (ver memoria feedback_firebase_patch_por_linea).
async function persistLineaNueva(lineaKey) {
  try {
    await _fbPut(`/obras/${obraKey}/computo/${lineaKey}.json`, lineas[lineaKey]);
  } catch (_) {
    showToast('Error al guardar el cómputo.', 'error');
  }
}

async function persistLineaCambios(lineaKey, cambios) {
  try {
    await _fbPatch(`/obras/${obraKey}/computo/${lineaKey}.json`, cambios);
  } catch (_) {
    showToast('Error al guardar el cómputo.', 'error');
  }
}

async function persistRubroOverride(rubroKey, nombre) {
  try {
    if (nombre) {
      rubroOverrides[rubroKey] = nombre;
      await _fbPatch(`/obras/${obraKey}/computoRubros.json`, { [rubroKey]: nombre });
    } else {
      delete rubroOverrides[rubroKey];
      await _fbDel(`/obras/${obraKey}/computoRubros/${rubroKey}.json`);
    }
  } catch (_) {
    showToast('Error al guardar el nombre del rubro.', 'error');
  }
}

function updateLinea(lineaKey, cambios) {
  lineas[lineaKey] = { ...lineas[lineaKey], ...cambios };
  renderTodo();
  persistLineaCambios(lineaKey, cambios);
}

function addLinea() {
  if (!items.length) {
    showToast('No hay ítems cargados en la Biblioteca todavía.', 'error');
    return;
  }
  const lineaKey = 'linea_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  // creadoEn siempre tiene valor real: si itemKey/cantidad quedan en null
  // (línea recién creada, sin elegir ítem todavía), un objeto con TODOS los
  // campos en null no llega a persistir en Firebase (PUT de sólo-nulls no
  // crea el nodo) y la línea desaparecería al recargar.
  lineas[lineaKey] = { itemKey: null, cantidad: null, creadoEn: Date.now() };
  renderTodo();
  persistLineaNueva(lineaKey);
}

async function deleteLinea(lineaKey) {
  delete lineas[lineaKey];
  renderTodo();
  try {
    await _fbDel(`/obras/${obraKey}/computo/${lineaKey}.json`);
  } catch (_) {
    showToast('Error al eliminar la línea.', 'error');
  }
  showToast('Línea eliminada.');
}

function populateQiRubroSelect() {
  const opts = rubros.map(r => `<option value="${escHtml(r.key)}">${escHtml(r.nombre)}</option>`).join('');
  $('qi-rubro').innerHTML = '<option value="">— Sin rubro —</option>' + opts;
}

function openQuickItemModal(texto, lineaKey) {
  pendingLineaKey = lineaKey;
  $('qi-nombre').value = texto || '';
  $('qi-unidad').value = '';
  $('qi-rubro').value = '';
  $('qi-rendimiento').value = '';
  setCalcFormula($('qi-rendimiento'), null);
  $('modal-item-quick-error').classList.add('hidden');
  $('modal-item-quick').classList.remove('hidden');
  setTimeout(() => $('qi-nombre').focus(), 50);
}

async function saveQuickItem() {
  const nombre = $('qi-nombre').value.trim();
  const unidad = $('qi-unidad').value.trim();
  const rubroKey = $('qi-rubro').value;
  const errEl = $('modal-item-quick-error');

  const rendInput = $('qi-rendimiento');
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

  const key = nombre.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40)
    + '_' + Date.now();
  const data = { nombre, unidad, rubroKey, rendimiento, rendimientoFormula: getCalcFormula(rendInput), creadoEn: Date.now() };

  try {
    await _fbPut(`/items/${key}.json`, data);
    items.push({ key, ...data });
    items.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    $('modal-item-quick').classList.add('hidden');
    showToast('Ítem creado.');
    if (pendingLineaKey) updateLinea(pendingLineaKey, { itemKey: key });
  } catch (_) {
    errEl.textContent = 'Error al guardar. Intentá de nuevo.';
    errEl.classList.remove('hidden');
  }
}

async function loadAll() {
  if (!obraKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta la obra (?obra=...).</p>';
    return;
  }
  const [obraData, lineasData, itemsData, rubrosData, rubroOverridesData, materialesData, equiposData, rolesData, cfgEquipos, cfgMO] = await Promise.all([
    _fbGet(`/obras/${obraKey}.json`),
    _fbGet(`/obras/${obraKey}/computo.json`),
    _fbGet('/items.json'),
    _fbGet('/rubros.json'),
    _fbGet(`/obras/${obraKey}/computoRubros.json`),
    _fbGet('/materiales.json'),
    _fbGet('/equipos.json'),
    _fbGet('/manoDeObra.json'),
    _fbGet('/config/equipos.json'),
    _fbGet('/config/manoDeObra.json'),
  ]);

  if (!obraData) {
    document.body.innerHTML = '<p style="padding:2rem;">No se encontró la obra.</p>';
    return;
  }
  obra = obraData;
  lineas = lineasData || {};
  items = Object.entries(itemsData || {}).map(([key, it]) => ({ key, ...it })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  rubros = Object.entries(rubrosData || {}).map(([key, r]) => ({ key, ...r })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  rubrosMap = {};
  rubros.forEach(r => { rubrosMap[r.key] = r.nombre; });
  rubroOverrides = rubroOverridesData || {};
  materiales = Object.entries(materialesData || {}).map(([key, m]) => ({ key, ...m }));
  equipos = Object.entries(equiposData || {}).map(([key, e]) => ({ key, ...e }));
  roles = Object.entries(rolesData || {}).map(([key, r]) => ({ key, ...r }));
  if (cfgEquipos) paramsEquipos = { ...paramsEquipos, ...cfgEquipos };
  if (cfgMO) paramsMO = { ...paramsMO, ...cfgMO };

  populateQiRubroSelect();
  $('header-obra-nombre').textContent = 'Cómputo — ' + obra.nombre;
  renderTodo();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  $('btn-add-linea').addEventListener('click', addLinea);
  $('modal-item-quick-close').addEventListener('click', () => $('modal-item-quick').classList.add('hidden'));
  $('modal-item-quick-cancel').addEventListener('click', () => $('modal-item-quick').classList.add('hidden'));
  $('modal-item-quick-save').addEventListener('click', saveQuickItem);
  attachCalcInput($('qi-rendimiento'));

  await loadAll();
  await getDolarSnapshot().catch(() => {});
  if (obra) renderTodo();
});
