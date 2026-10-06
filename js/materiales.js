/* VIMECO S.A. — Sistema de Gestión — Materiales (catálogo + precio actual) */

const $ = id => document.getElementById(id);

const fmtFecha  = iso => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

let allMateriales = [];
let allObras = [];
let obrasMap = {};
let editingKey = null;
let fuenteSelect = null;
// Fila de la comparativa de proveedores que se está editando en el modal
// (null = un proveedor nuevo). Ver js/preciosMaterial.js.
let provKeyEditando = null;

// Planilla: una fila por cada precio cargado (material × obra-fuente), y una
// fila sin precio para los materiales que todavía no tienen ninguno. Los
// valores son los guardados tal cual (precioARS / cotizacionUsada /
// precioUSD), no se recalculan con el dólar de hoy.
let orden = { col: 'nombre', dir: 1 };

const COLUMNAS = [
  { col: 'nombre',    label: 'Material' },
  { col: 'unidad',    label: 'Unidad' },
  { col: 'proveedor', label: 'Proveedor' },
  { col: 'fecha',     label: 'Fecha' },
  { col: 'obra',      label: 'Obra' },
  { col: 'ars',       label: 'Precio $',     num: true },
  { col: 'cot',       label: 'Cotización USD', num: true },
  { col: 'usd',       label: 'Precio USD',   num: true },
];

function filasDe(materiales) {
  const filas = [];
  materiales.forEach(m => {
    const def = window.precioDefaultDe(m);
    // Una fila por proveedor de cada obra (ver js/preciosMaterial.js): el
    // elegido es el que usa la obra; el vigente, el elegido más reciente.
    const obraKeys = [...new Set([...Object.keys(m.precios || {}), ...Object.keys(m.proveedores || {})])];
    const entries = obraKeys.flatMap(obraKey => {
      const cmp = window.comparativaPrecios(m, obraKey);
      return cmp.map(p => [obraKey, { ...p, nProv: cmp.length }]);
    });
    if (!entries.length) {
      filas.push({ material: m, obraKey: null, nombre: m.nombre, unidad: m.unidad || '', proveedor: '', fecha: '', obra: '', ars: null, cot: null, usd: null, vigente: false, elegido: false });
      return;
    }
    entries.forEach(([obraKey, p]) => {
      const cot = p.cotizacionUsada || null;
      const ars = p.precioARS != null ? p.precioARS : (p.precioUSD != null && cot ? p.precioUSD * cot : null);
      const usd = p.precioUSD != null ? p.precioUSD : (ars != null && cot ? ars / cot : null);
      filas.push({
        material: m, obraKey, provKey: p.provKey, nombre: m.nombre, unidad: m.unidad || '',
        proveedor: (p.proveedor || '').trim(), fecha: p.fecha || '', obra: window.nombreFuentePrecio(obraKey, obrasMap),
        ars, cot, usd, elegido: p.elegido, nProv: p.nProv, vigente: p.elegido && def && def.obraKey === obraKey,
        general: obraKey === window.PRECIOS_GENERAL,
      });
    });
  });
  return filas;
}

function compararFilas(a, b) {
  const { col, dir } = orden;
  const va = a[col], vb = b[col];
  const vacioA = va == null || va === '', vacioB = vb == null || vb === '';
  if (vacioA !== vacioB) return vacioA ? 1 : -1; // sin dato siempre al final
  let r = 0;
  if (!vacioA) r = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'es');
  return r * dir || a.nombre.localeCompare(b.nombre, 'es') || (b.fecha || '').localeCompare(a.fecha || '');
}

function renderMateriales(filas) {
  const container = $('materiales-list');
  $('materiales-conteo').textContent = allMateriales.length
    ? `${filas.length} ${filas.length === 1 ? 'fila' : 'filas'} · ${new Set(filas.map(f => f.material.key)).size} materiales`
    : '';
  if (!allMateriales.length) {
    container.innerHTML = '<div class="list-empty">No hay materiales cargados todavía.</div>';
    return;
  }
  if (!filas.length) {
    container.innerHTML = '<div class="list-empty">Ningún material coincide con los filtros.</div>';
    return;
  }
  const flecha = col => orden.col === col ? (orden.dir === 1 ? ' ▲' : ' ▼') : '';
  const head = `<thead><tr>${COLUMNAS.map(c =>
    `<th data-col="${c.col}"${c.num ? ' class="num"' : ''}>${c.label}${flecha(c.col)}</th>`).join('')}<th class="mat-sin-orden"></th></tr></thead>`;
  const vacio = '<span class="mat-vacio">—</span>';
  const cuerpo = filas.map((f, i) => `
    <tr data-i="${i}"${f.obraKey && !f.elegido && !f.general ? ' class="mat-fila-alt"' : ''}>
      <td class="mat-nombre">${escHtml(f.nombre)}</td>
      <td>${escHtml(f.unidad)}</td>
      <td>${f.proveedor ? escHtml(f.proveedor) : vacio}</td>
      <td>${f.fecha ? fmtFecha(f.fecha) : vacio}</td>
      <td>${f.obraKey ? escHtml(f.obra)
        + (f.elegido && f.nProv > 1 ? '<span class="mat-vigente" title="Hay varios proveedores en esta obra: este es el que entra en el costo">elegido</span>' : '')
        + (f.vigente ? '<span class="mat-vigente" title="Es el precio más reciente: el que se usa en obras sin precio propio">vigente</span>' : '')
        + (!f.elegido && !f.general ? '<span class="mat-alt" title="Otro proveedor cargado para esta obra: no entra en el costo">alternativa</span>' : '') : '<span class="mat-vacio">Sin precio cargado</span>'}</td>
      <td class="num">${f.ars != null ? fmtARSFijo(f.ars) : vacio}</td>
      <td class="num">${f.cot != null ? fmtARSFijo(f.cot) : vacio}</td>
      <td class="num">${f.usd != null ? fmtUSD(f.usd) : vacio}</td>
      <td class="mat-acciones">
        <button class="btn btn-sm btn-outline btn-edit-material">Editar</button>
        <button class="btn btn-sm btn-danger btn-del-material">Eliminar</button>
      </td>
    </tr>`).join('');
  container.innerHTML = `<table class="mat-tabla">${head}<tbody>${cuerpo}</tbody></table>`;

  container.querySelectorAll('thead th[data-col]').forEach(th => th.addEventListener('click', () => {
    const col = th.dataset.col;
    orden = { col, dir: orden.col === col ? -orden.dir : 1 };
    applyFilter();
  }));
  container.querySelectorAll('tbody tr').forEach(tr => {
    const f = filas[+tr.dataset.i];
    tr.querySelector('.btn-edit-material').addEventListener('click', () => openEditModal(f.material, f.obraKey, f.provKey));
    tr.querySelector('.btn-del-material').addEventListener('click', () => deleteMaterial(f.material));
  });
}

// Opciones de los desplegables a partir de lo que hay cargado: sólo obras
// con algún precio, y proveedores sin repetir (ignorando mayúsculas).
function renderOpcionesFiltros() {
  const filas = filasDe(allMateriales);
  const llenar = (sel, primera, valores) => {
    const actual = sel.value;
    sel.innerHTML = `<option value="">${primera}</option>` +
      valores.map(([v, l]) => `<option value="${escHtml(v)}">${escHtml(l)}</option>`).join('');
    sel.value = valores.some(([v]) => v === actual) ? actual : '';
  };
  const conPrecio = new Set(filas.filter(f => f.obraKey).map(f => f.obraKey));
  llenar($('materiales-filtro-obra'), 'Todas las obras',
    [...(conPrecio.has(window.PRECIOS_GENERAL) ? [[window.PRECIOS_GENERAL, 'Lista general (sin obra)']] : []),
      ...allObras.filter(o => conPrecio.has(o.key)).map(o => [o.key, o.nombre])]);
  const provs = new Map();
  filas.forEach(f => { if (f.proveedor && !provs.has(f.proveedor.toLowerCase())) provs.set(f.proveedor.toLowerCase(), f.proveedor); });
  llenar($('materiales-filtro-proveedor'), 'Todos los proveedores',
    [...provs.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es')));
}

function applyFilter() {
  const obra = $('materiales-filtro-obra').value;
  const prov = $('materiales-filtro-proveedor').value;
  const soloVigente = $('materiales-solo-vigente').checked;
  let filas = filasDe(allMateriales).filter(f =>
    (!obra || f.obraKey === obra) &&
    (!prov || f.proveedor.toLowerCase() === prov) &&
    (!soloVigente || f.vigente || !f.obraKey));
  filas = window.buscarSimilares(filas, $('materiales-search').value, f => `${f.nombre} ${f.proveedor}`).lista;
  renderMateriales(filas.sort(compararFilas));
}

async function loadMateriales() {
  $('materiales-list').innerHTML = '<div class="list-loading">Cargando materiales…</div>';
  try {
    const [data, obrasData] = await Promise.all([
      _fbGet('/materiales.json'),
      _fbGet('/obras.json'),
    ]);
    allMateriales = Object.entries(data || {}).map(([key, m]) => ({ key, ...m }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    allObras = Object.entries(obrasData || {}).map(([key, o]) => ({ key, ...o }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    obrasMap = {};
    allObras.forEach(o => { obrasMap[o.key] = o.nombre; });
    renderOpcionesFiltros();
    applyFilter();
  } catch (_) {
    $('materiales-list').innerHTML = '<div class="list-empty">Error al cargar materiales.</div>';
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function onFuenteChange(material, obraKey) {
  const disabled = !obraKey;
  ['material-precio-usd', 'material-precio-ars', 'material-proveedor', 'material-fecha'].forEach(id => { $(id).disabled = disabled; });
  const filas = window.comparativaPrecios(material, obraKey);
  const elegido = filas.find(f => f.elegido) || null;
  provKeyEditando = elegido ? elegido.provKey : null;
  fillPrecioCampos(elegido);
  renderComparativaModal(material, obraKey);
}

function fillPrecioCampos(p) {
  $('material-precio-usd').value = p ? formatMoneyString(p.precioUSD) : '';
  $('material-precio-ars').value = p ? formatMoneyString(p.precioARS) : '';
  setCalcFormula($('material-precio-usd'), p && p.precioFormulaMoneda === 'USD' ? p.precioFormula : null);
  setCalcFormula($('material-precio-ars'), p && p.precioFormulaMoneda === 'ARS' ? p.precioFormula : null);
  $('material-proveedor').value = p ? (p.proveedor || '') : '';
  $('material-fecha').value = p ? (p.fecha || todayIso()) : todayIso();
  $('material-precio-nota').textContent = p && p.cotizacionUsada ? `Cotización usada: USD = ${fmtARSFijo(p.cotizacionUsada)}` : '';
}

// Proveedores cargados para la obra elegida en "Fuente (obra)" — ver
// js/preciosMaterial.js. Elegir o sacar uno se guarda en el momento.
function renderComparativaModal(material, obraKey) {
  const cont = $('material-comparativa');
  if (!material || !obraKey) { cont.innerHTML = ''; return; }
  const escribir = async (etiqueta, fn) => {
    try {
      await window.undoAgrupar(etiqueta, null, fn);
    } catch (_) {
      showToast('Error al guardar. Intentá de nuevo.', 'error');
    }
    const filas = window.comparativaPrecios(material, obraKey);
    const editando = filas.find(f => f.provKey === provKeyEditando) || filas.find(f => f.elegido) || null;
    provKeyEditando = editando ? editando.provKey : null;
    fillPrecioCampos(editando);
    renderComparativaModal(material, obraKey);
    renderOpcionesFiltros();
    applyFilter();
  };
  window.renderComparativaPrecios(cont, material, obraKey, {
    editandoKey: provKeyEditando,
    onEditar: f => { provKeyEditando = f.provKey; fillPrecioCampos(f); renderComparativaModal(material, obraKey); },
    onNuevo: () => { provKeyEditando = null; fillPrecioCampos(null); renderComparativaModal(material, obraKey); $('material-proveedor').focus(); },
    onElegir: k => escribir('el proveedor elegido', () => window.elegirProveedorPrecio(material, obraKey, k)),
    onEliminar: k => escribir('el proveedor sacado de la comparativa', async () => {
      if (!await window.eliminarProveedorPrecio(material, obraKey, k)) showToast('Es el proveedor que usa la obra: elegí otro antes de sacarlo.', 'error');
    }),
  });
}

// material: null en alta (sin precios todavía). En edición, muestra TODAS
// las obras (no sólo las que ya tienen precio) para poder cargar el primero.
function renderFuenteSelect(material, obraKey) {
  const def = material ? window.precioDefaultDe(material) : null;
  const inicial = obraKey || (def ? def.obraKey : null);
  const options = allObras.map(o => {
    const p = material && material.precios ? material.precios[o.key] : null;
    const sublabel = p
      ? `Precio: ${fmtFecha(p.fecha)}${def && def.obraKey === o.key ? ' · vigente' : ''}`
      : 'Sin precio cargado';
    return { value: o.key, label: o.nombre, sublabel };
  });
  options.unshift({ value: window.PRECIOS_GENERAL, label: 'Lista general (sin obra)', sublabel: 'Precios de referencia: no entran en ningún costo' });
  fuenteSelect = createSearchableSelect($('material-fuente-container'), {
    options,
    value: inicial,
    placeholder: 'Buscar obra…',
    onChange: obraKey => onFuenteChange(material, obraKey),
  });
  onFuenteChange(material, inicial);
}

function openAddModal() {
  editingKey = null;
  $('modal-material-title').textContent = 'Agregar material';
  $('modal-material-error').classList.add('hidden');
  $('material-nombre').value = '';
  $('material-unidad').value = '';
  renderFuenteSelect(null);
  $('modal-material').classList.remove('hidden');
  setTimeout(() => $('material-nombre').focus(), 50);
}

// obraKey/provKey: la fila de la planilla desde la que se abrió; sin ella, el vigente.
function openEditModal(material, obraKey, provKey) {
  editingKey = material.key;
  $('modal-material-title').textContent = 'Editar material';
  $('modal-material-error').classList.add('hidden');
  $('material-nombre').value = material.nombre || '';
  $('material-unidad').value = material.unidad || '';
  renderFuenteSelect(material, obraKey);
  const fila = provKey && window.comparativaPrecios(material, obraKey).find(f => f.provKey === provKey);
  if (fila && !fila.elegido) {
    provKeyEditando = provKey;
    fillPrecioCampos(fila);
    renderComparativaModal(material, obraKey);
  }
  $('modal-material').classList.remove('hidden');
  setTimeout(() => $('material-nombre').focus(), 50);
}

async function saveMaterialModal() {
  const nombre = $('material-nombre').value.trim();
  const unidad = $('material-unidad').value.trim();
  const errEl  = $('modal-material-error');

  if (!nombre) {
    errEl.textContent = 'El nombre es requerido.';
    errEl.classList.remove('hidden');
    return;
  }
  if (!unidad) {
    errEl.textContent = 'La unidad es requerida.';
    errEl.classList.remove('hidden');
    return;
  }

  const obraKey = fuenteSelect ? fuenteSelect.getValue() : null;
  let precioData = null;
  if (obraKey) {
    const proveedor = $('material-proveedor').value.trim();
    const fecha = $('material-fecha').value || todayIso();
    const usdInput = $('material-precio-usd');
    const arsInput = $('material-precio-ars');
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

  const saveBtn = $('modal-material-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Guardando…';

  try {
    let key = editingKey;
    let res = null;
    await window.undoAgrupar(editingKey ? 'el material editado' : 'el material nuevo', null, async () => {
      if (editingKey) {
        await _fbPatch(`/materiales/${editingKey}.json`, { nombre, unidad });
      } else {
        key = nombre.toLowerCase()
          .normalize('NFD').replace(/[̀-ͯ]/g, '')
          .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40)
          + '_' + Date.now();
        await _fbPut(`/materiales/${key}.json`, { nombre, unidad, creadoEn: Date.now() });
      }
      const material = allMateriales.find(m => m.key === key) || { key };
      if (precioData) res = await window.guardarPrecioProveedor(material, obraKey, precioData, { provKeyAnterior: editingKey ? provKeyEditando : null });
    });
    $('modal-material').classList.add('hidden');
    showToast(res && res.general ? 'Precio guardado en la lista general.'
      : res && !res.elegido ?'Proveedor sumado a la comparativa. La obra sigue usando el elegido.'
      : (editingKey ? 'Material actualizado.' : 'Material creado.'));
    await loadMateriales();
  } catch (_) {
    errEl.textContent = 'Error al guardar. Intentá de nuevo.';
    errEl.classList.remove('hidden');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar';
  }
}

// Lista de precios de un proveedor leída con IA (js/cotizaciones-ia.js): el
// archivo no se guarda, y los precios van a la lista general o a la obra que
// se elija en el modal.
function abrirListaIA(file) {
  if (!/\.(pdf|jpe?g|png)$/i.test(file.name)) {
    showToast('La IA lee PDF, JPG o PNG.', 'error');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('El archivo es demasiado grande (máx. 10MB).', 'error');
    return;
  }
  $('cotiz-obra').innerHTML = '<option value="">Ninguna (lista general)</option>' +
    allObras.map(o => `<option value="${escHtml(o.key)}">${escHtml(o.nombre)}</option>`).join('');
  window.openCotizacionModal(null, null, { archivoNombre: file.name, archivoTipo: file.type, file }, loadMateriales);
}

async function deleteMaterial(material) {
  const ok = await showConfirm('Eliminar material', `¿Eliminar "${material.nombre}"? Esta acción no se puede deshacer.`);
  if (!ok) return;
  try {
    await _fbDel(`/materiales/${material.key}.json`);
    showToast('Material eliminado.');
    await loadMateriales();
  } catch (_) {
    showToast('Error al eliminar el material.', 'error');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  attachCalcInput($('material-precio-usd'));
  attachMoneyInput($('material-precio-usd'));
  attachCalcInput($('material-precio-ars'));
  attachMoneyInput($('material-precio-ars'));
  attachDualPrecioInputs({ usdInput: $('material-precio-usd'), arsInput: $('material-precio-ars'), notaEl: $('material-precio-nota') });

  $('btn-add-material').addEventListener('click', openAddModal);
  $('btn-ia-lista').addEventListener('click', () => $('ia-lista-input').click());
  $('ia-lista-input').addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) abrirListaIA(file);
  });
  $('modal-material-close').addEventListener('click',  () => $('modal-material').classList.add('hidden'));
  $('modal-material-cancel').addEventListener('click', () => $('modal-material').classList.add('hidden'));
  $('modal-material-save').addEventListener('click', saveMaterialModal);
  $('material-nombre').addEventListener('keydown', e => { if (e.key === 'Enter') saveMaterialModal(); });
  $('materiales-search').addEventListener('input', applyFilter);
  ['materiales-filtro-obra', 'materiales-filtro-proveedor', 'materiales-solo-vigente'].forEach(id => $(id).addEventListener('change', applyFilter));

  await loadMateriales();
  getDolarSnapshot().then(() => applyFilter()).catch(() => {});

  // Llegada desde otra pantalla (ej. Análisis de Precio) para cargar un
  // precio nuevo de un material puntual: abre directo su modal de edición.
  const editarKey = new URLSearchParams(window.location.search).get('editar');
  if (editarKey) {
    const material = allMateriales.find(m => m.key === editarKey);
    if (material) openEditModal(material);
  }
});

window.onDecimalesVista(() => applyFilter());

/* Esta pantalla no escucha la base en tiempo real: después de un Ctrl+Z
   (js/undo.js) vuelve a pedir los datos y se repinta. */
window.registrarRecargaUndo(loadMateriales);
