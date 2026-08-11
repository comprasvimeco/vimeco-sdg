/* VIMECO S.A. — Precios de materiales por obra, dentro de una Cotización
   asociada a esa obra (/cotizaciones/{key}/precios/{materialKey}). Pisan
   el precio global de Materiales sólo al calcular costos dentro de esa
   obra (ver js/calcCostos.js, resolverPreciosObra/calcCostoUnitarioItem,
   usado por computo.js/carga-fija.js/item.js) — cálculo en vivo, no
   cacheado. Sin cotización asociada a la obra, el comportamiento es
   idéntico al de siempre (precio global). */

const $ = id => document.getElementById(id);

const fmtFecha = iso => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const params = new URLSearchParams(window.location.search);
const cotizacionKey = params.get('cotizacion');

let cotizacion = null;
let allMateriales = [];
let materialesMap = {};
let obrasMap = {};
let editingMaterialKey = null;
let materialSelect = null;
let monedaActual = 'USD';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function setMoneda(m) {
  monedaActual = m;
  $('precio-moneda-usd').classList.toggle('is-active', m === 'USD');
  $('precio-moneda-ars').classList.toggle('is-active', m === 'ARS');
  actualizarEquivalente();
}

function actualizarEquivalente() {
  const hint = $('precio-equivalente');
  const raw = $('precio-valor').value.trim();
  if (raw.startsWith('=')) { hint.textContent = 'Podés escribir una fórmula empezando con "="'; return; }
  const n = parseFloat(raw.replace(',', '.'));
  if (isNaN(n)) { hint.textContent = 'Podés escribir una fórmula empezando con "="'; return; }
  const r = resolveDualPrecio(monedaActual, n);
  if (!r) { hint.textContent = 'Sin cotización del dólar disponible todavía — reintentá en un momento.'; return; }
  hint.textContent = monedaActual === 'USD' ? `≈ ${fmtARS(r.precioARS)}` : `≈ ${fmtUSD(r.precioUSD)}`;
}

function renderDatos() {
  $('header-cotizacion-nombre').textContent = cotizacion.nombre;
  $('cotizacion-titulo-card').textContent = cotizacion.nombre;
  const obraNombre = obrasMap[cotizacion.obraKey] || '(obra eliminada)';
  $('cotizacion-datos-resumen').innerHTML = `<span class="item-card-meta">Obra: ${escHtml(obraNombre)}</span>`;
}

function renderPrecios() {
  const container = $('precios-list');
  const entradas = Object.entries(cotizacion.precios || {});
  if (!entradas.length) {
    container.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Sin precios cargados todavía.</p>';
    return;
  }
  container.innerHTML = entradas.map(([materialKey, precio]) => {
    const mat = materialesMap[materialKey];
    return `
      <div class="item-card" data-key="${escHtml(materialKey)}">
        <div class="item-card-info">
          <span class="item-card-title">${escHtml(mat ? mat.nombre : '(material eliminado)')}</span>
          <span class="item-card-meta">${escHtml(fmtUSDConEquivalente(precio.precioUSD))}${precio.fecha ? ' · ' + escHtml(fmtFecha(precio.fecha)) : ''}</span>
        </div>
        <div class="item-card-actions">
          <button class="btn btn-sm btn-outline btn-edit-precio">Editar</button>
          <button class="btn btn-sm btn-danger btn-del-precio">Eliminar</button>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.item-card').forEach(card => {
    const materialKey = card.dataset.key;
    card.querySelector('.btn-edit-precio').addEventListener('click', () => openEditModal(materialKey));
    card.querySelector('.btn-del-precio').addEventListener('click', () => deletePrecio(materialKey));
  });
}

function openAddModal() {
  editingMaterialKey = null;
  $('modal-precio-title').textContent = 'Agregar precio';
  $('modal-precio-error').classList.add('hidden');
  $('precio-material-container').classList.remove('hidden');
  $('precio-material-fijo').classList.add('hidden');
  materialSelect = createSearchableSelect($('precio-material-container'), {
    options: allMateriales.map(m => ({ value: m.key, label: m.nombre, sublabel: m.unidad })),
    value: null,
    placeholder: 'Buscar material…',
  });
  $('precio-valor').value = '';
  setCalcFormula($('precio-valor'), null);
  $('precio-fecha').value = todayIso();
  setMoneda('USD');
  $('modal-precio').classList.remove('hidden');
}

function openEditModal(materialKey) {
  editingMaterialKey = materialKey;
  const precio = cotizacion.precios[materialKey];
  const mat = materialesMap[materialKey];
  $('modal-precio-title').textContent = 'Editar precio';
  $('modal-precio-error').classList.add('hidden');
  $('precio-material-container').classList.add('hidden');
  $('precio-material-container').innerHTML = '';
  $('precio-material-fijo').classList.remove('hidden');
  $('precio-material-fijo').textContent = mat ? mat.nombre : '(material eliminado)';
  $('precio-valor').value = precio.precioUSD ?? '';
  setCalcFormula($('precio-valor'), precio.precioFormula);
  $('precio-fecha').value = precio.fecha || todayIso();
  setMoneda('USD');
  $('modal-precio').classList.remove('hidden');
}

async function savePrecioModal() {
  const errEl = $('modal-precio-error');
  const materialKey = editingMaterialKey || (materialSelect ? materialSelect.getValue() : null);
  if (!materialKey) {
    errEl.textContent = 'Elegí un material.';
    errEl.classList.remove('hidden');
    return;
  }

  const precioInput = $('precio-valor');
  if (precioInput.value.trim().startsWith('=')) precioInput.blur();
  const precioIngresado = parseFloat(precioInput.value.replace(',', '.'));
  if (isNaN(precioIngresado) || precioIngresado < 0) {
    errEl.textContent = 'El precio no es válido.';
    errEl.classList.remove('hidden');
    return;
  }
  const dual = resolveDualPrecio(monedaActual, precioIngresado);
  if (!dual) {
    errEl.textContent = 'No se pudo obtener la cotización del dólar. Reintentá en un momento.';
    errEl.classList.remove('hidden');
    return;
  }
  const fecha = $('precio-fecha').value || todayIso();

  const saveBtn = $('modal-precio-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Guardando…';

  try {
    const data = { precioUSD: dual.precioUSD, precioARS: dual.precioARS, precioFormula: getCalcFormula(precioInput), fecha };
    await _fbPut(`/cotizaciones/${cotizacionKey}/precios/${materialKey}.json`, data);
    cotizacion.precios = { ...(cotizacion.precios || {}), [materialKey]: data };
    $('modal-precio').classList.add('hidden');
    showToast('Precio guardado.');
    renderPrecios();
  } catch (_) {
    errEl.textContent = 'Error al guardar. Intentá de nuevo.';
    errEl.classList.remove('hidden');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar';
  }
}

async function deletePrecio(materialKey) {
  const mat = materialesMap[materialKey];
  const ok = await showConfirm('Eliminar precio', `¿Eliminar el precio de obra de "${mat ? mat.nombre : materialKey}"? Vuelve a usar el precio global.`);
  if (!ok) return;
  try {
    await _fbDel(`/cotizaciones/${cotizacionKey}/precios/${materialKey}.json`);
    delete cotizacion.precios[materialKey];
    showToast('Precio eliminado.');
    renderPrecios();
  } catch (_) {
    showToast('Error al eliminar el precio.', 'error');
  }
}

async function loadAll() {
  if (!cotizacionKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta la cotización (?cotizacion=...).</p>';
    return;
  }
  const [cotizacionData, obrasData, materialesData] = await Promise.all([
    _fbGet(`/cotizaciones/${cotizacionKey}.json`),
    _fbGet('/obras.json'),
    _fbGet('/materiales.json'),
  ]);

  if (!cotizacionData) {
    document.body.innerHTML = '<p style="padding:2rem;">No se encontró la cotización.</p>';
    return;
  }
  if (!cotizacionData.obraKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Esta cotización es general (sin obra) — los precios por obra sólo aplican a cotizaciones asociadas a una obra puntual.</p>';
    return;
  }
  cotizacion = cotizacionData;
  obrasMap = {};
  Object.entries(obrasData || {}).forEach(([key, o]) => { obrasMap[key] = o.nombre; });
  allMateriales = Object.entries(materialesData || {}).map(([key, m]) => ({ key, ...m }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  materialesMap = {};
  allMateriales.forEach(m => { materialesMap[m.key] = m; });

  renderDatos();
  renderPrecios();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  $('btn-add-precio').addEventListener('click', openAddModal);
  $('modal-precio-close').addEventListener('click', () => $('modal-precio').classList.add('hidden'));
  $('modal-precio-cancel').addEventListener('click', () => $('modal-precio').classList.add('hidden'));
  $('modal-precio-save').addEventListener('click', savePrecioModal);
  $('precio-moneda-usd').addEventListener('click', () => setMoneda('USD'));
  $('precio-moneda-ars').addEventListener('click', () => setMoneda('ARS'));
  $('precio-valor').addEventListener('input', actualizarEquivalente);
  $('precio-valor').addEventListener('blur', actualizarEquivalente);
  attachCalcInput($('precio-valor'));

  await loadAll();
  await getDolarSnapshot().catch(() => {});
});
