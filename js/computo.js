/* VIMECO S.A. — Sistema de Gestión — Cómputo de obra
   Listado totalmente libre. Los rubros son una entidad de la obra
   (/obras/{obraKey}/rubrosComputo/{rubroId}: { nombre, orden }) — se
   agregan con el botón "+ Agregar rubro" y se numeran solos (1., 2., …)
   según su orden. Cada línea (/obras/{obraKey}/computo/{lineaKey}) tiene
   Ítem + Unidad de texto libre (no dependen de la Biblioteca), Cantidad, y
   pertenece a un rubro (rubroId) — se numera "1.1", "1.2"… dentro de su
   rubro. El costo arranca en $0 hasta que se vincula a un ítem real vía
   "Análisis de Precio" (item.html?key=...&obra=... si ya está vinculada, o
   item.html?linea=...&obra=... para buscar/crear el ítem la primera vez).
   El costo, una vez vinculada, se calcula en vivo: si el ítem tiene una
   versión de Rendimientos propia para ESTA obra
   (/items/{key}/versionesObra/{obraKey}, ver item.js) se usa esa receta +
   rendimiento; si no, se usa la Teórica (calcCostoUnitarioItem,
   js/calcCostos.js). Es costo total de obra sin carga (sin %GG, beneficio,
   financiero ni IVA) — eso se aplica en el Presupuesto, etapa siguiente.

   Reordenar: flechas ↑/↓ mueven una línea dentro de su mismo rubro (o un
   rubro entre los demás rubros); arrastrar una línea y soltarla sobre otro
   rubro la mueve a ese rubro (al final). */

const $ = id => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const obraKey = params.get('obra');

let obra = null;
let rubros = [];   // [{ key, nombre, orden }] — ordenado por `orden`
let lineas = {};   // { lineaKey: { rubroId, nombre, unidad, cantidad, cantidadFormula, itemKey, orden } }
let items = [];
let materiales = [];
let equipos = [];
let roles = [];
let paramsEquipos = { tasaInteresPct: 10, reparacionesPct: 75, lubricantesPct: 50, combustibleLtsPorHp: 0.1, precioCombustibleLitro: 0 };
let paramsMO = { asistenciaPct: 20, cargasPct: 100, diasMes: 22, jornadaHoras: 8 };
let preciosObra = {};   // { materialKey: {precioUSD,...} } — resuelto de Cotizaciones de esta obra
let draggedLineaKey = null;

function versionDe(it) {
  const propia = it.versionesObra && it.versionesObra[obraKey];
  return propia || it;
}

function costoUnitarioDe(itemKey) {
  if (!itemKey) return 0;
  const it = items.find(i => i.key === itemKey);
  if (!it) return 0;
  const version = versionDe(it);
  if (!version.lineas || !Object.keys(version.lineas).length) return 0;
  const catalogos = { materiales, equipos, roles };
  const r = window.calcCostoUnitarioItem(version, version.lineas, catalogos, paramsEquipos, paramsMO, preciosObra);
  return r.costoUnitario;
}

function totalLinea(linea) {
  const costo = costoUnitarioDe(linea.itemKey);
  const cantidad = linea.cantidad != null && !isNaN(linea.cantidad) ? linea.cantidad : 0;
  return costo * cantidad;
}

function lineasDeRubro(rubroId) {
  return Object.entries(lineas)
    .filter(([, l]) => l.rubroId === rubroId)
    .sort((a, b) => (a[1].orden || 0) - (b[1].orden || 0));
}

// `rubros` se mantiene siempre ordenado por su campo `orden` como
// invariante — así todo lo que lo recorre (render, numeración, el
// selector del modal "Nueva línea") no tiene que ordenar por su cuenta.
// Llamar después de cargar y después de cualquier cambio de `orden`.
function ordenarRubros() {
  rubros.sort((a, b) => (a.orden || 0) - (b.orden || 0));
}

function subtotalGrupo(grupoLineas) {
  return grupoLineas.reduce((acc, [, l]) => acc + totalLinea(l), 0);
}

function renderRubroHeader(rubro, numero, esPrimero, esUltimo) {
  const grupoLineas = lineasDeRubro(rubro.key);
  const vacio = !grupoLineas.length;
  return `
    <div class="computo-rubro-header" data-rubro-id="${escHtml(rubro.key)}">
      <span class="computo-rubro-numero">${numero}.</span>
      <input type="text" class="form-control computo-rubro-nombre-input" data-rubro-id="${escHtml(rubro.key)}" value="${escHtml(rubro.nombre || '')}" placeholder="Nombre del rubro">
      <span class="computo-rubro-acciones">
        <button class="computo-rubro-mover" data-rubro-id="${escHtml(rubro.key)}" data-dir="-1" title="Subir rubro" ${esPrimero ? 'disabled' : ''}>${icSvg('arrowUp')}</button>
        <button class="computo-rubro-mover" data-rubro-id="${escHtml(rubro.key)}" data-dir="1" title="Bajar rubro" ${esUltimo ? 'disabled' : ''}>${icSvg('arrowDown')}</button>
        <button class="computo-rubro-del" data-rubro-id="${escHtml(rubro.key)}" title="${vacio ? 'Eliminar rubro' : 'Vaciá el rubro antes de eliminarlo'}" ${vacio ? '' : 'disabled'}>${icSvg('x')}</button>
      </span>
      <span class="computo-rubro-subtotal">${fmtARS(subtotalGrupo(grupoLineas))}</span>
    </div>
    <div class="computo-rubro-lineas" data-rubro-id="${escHtml(rubro.key)}"></div>`;
}

function renderLineaRow(lineaKey, linea, numero, esPrimero, esUltimo) {
  const costo = costoUnitarioDe(linea.itemKey);
  const total = totalLinea(linea);
  const hrefAP = linea.itemKey
    ? `item.html?key=${encodeURIComponent(linea.itemKey)}&obra=${encodeURIComponent(obraKey)}`
    : `item.html?linea=${encodeURIComponent(lineaKey)}&obra=${encodeURIComponent(obraKey)}`;
  return `
    <div class="computo-linea" data-key="${escHtml(lineaKey)}" draggable="true">
      <span class="computo-linea-numero">${numero}</span>
      <input type="text" class="form-control linea-nombre" placeholder="Ítem" value="${escHtml(linea.nombre || '')}">
      <input type="text" class="form-control linea-unidad" placeholder="Unidad" value="${escHtml(linea.unidad || '')}">
      <input type="text" class="form-control linea-cantidad" placeholder="Cantidad">
      <span class="computo-linea-costo">${fmtARS(costo)}</span>
      <span class="computo-linea-total">${fmtARS(total)}</span>
      <span class="computo-linea-acciones">
        <button class="computo-linea-mover" data-dir="-1" title="Subir" ${esPrimero ? 'disabled' : ''}>${icSvg('arrowUp')}</button>
        <button class="computo-linea-mover" data-dir="1" title="Bajar" ${esUltimo ? 'disabled' : ''}>${icSvg('arrowDown')}</button>
        <button class="computo-linea-dup" title="Duplicar">${icSvg('copy')}</button>
        <a class="computo-linea-ap" href="${hrefAP}" title="Análisis de Precio">${icSvg('layers')}</a>
        <button class="computo-linea-del" title="Eliminar línea">${icSvg('x')}</button>
      </span>
    </div>`;
}

function renderLineas() {
  const container = $('lineas-computo');
  ordenarRubros();

  if (!rubros.length) {
    container.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Todavía no hay rubros — empezá agregando uno.</p>';
    return;
  }

  const header = `
    <div class="computo-linea computo-linea-header">
      <span></span><span>Ítem</span><span>Unidad</span><span>Cantidad</span><span>Costo unitario</span><span>Costo subtotal</span><span></span>
    </div>`;
  container.innerHTML = header + rubros.map((rubro, i) =>
    renderRubroHeader(rubro, i + 1, i === 0, i === rubros.length - 1)
  ).join('');

  rubros.forEach((rubro, rubroIdx) => {
    const lineasContainer = container.querySelector(`.computo-rubro-lineas[data-rubro-id="${CSS.escape(rubro.key)}"]`);
    const grupoLineas = lineasDeRubro(rubro.key);
    lineasContainer.innerHTML = grupoLineas.length
      ? grupoLineas.map(([k, l], i) => renderLineaRow(k, l, `${rubroIdx + 1}.${i + 1}`, i === 0, i === grupoLineas.length - 1)).join('')
      : '<p class="text-muted" style="font-size:.8rem;padding:.4rem 0;">Sin líneas en este rubro todavía.</p>';

    lineasContainer.addEventListener('dragover', e => { e.preventDefault(); lineasContainer.classList.add('drop-target'); });
    lineasContainer.addEventListener('dragleave', () => lineasContainer.classList.remove('drop-target'));
    lineasContainer.addEventListener('drop', e => {
      e.preventDefault();
      lineasContainer.classList.remove('drop-target');
      if (draggedLineaKey) moverLineaARubro(draggedLineaKey, rubro.key);
    });
  });

  container.querySelectorAll('.computo-rubro-nombre-input').forEach(input => {
    const rubroId = input.dataset.rubroId;
    input.addEventListener('blur', () => {
      const v = input.value.trim();
      const rubro = rubros.find(r => r.key === rubroId);
      if (rubro && v && v !== rubro.nombre) { rubro.nombre = v; persistRubroCambios(rubroId, { nombre: v }); renderResumen(); }
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  });
  container.querySelectorAll('.computo-rubro-mover').forEach(btn => {
    btn.addEventListener('click', () => moverRubro(btn.dataset.rubroId, parseInt(btn.dataset.dir, 10)));
  });
  container.querySelectorAll('.computo-rubro-del').forEach(btn => {
    btn.addEventListener('click', () => { if (!btn.disabled) eliminarRubro(btn.dataset.rubroId); });
  });

  container.querySelectorAll('.computo-linea[data-key]').forEach(row => {
    const lineaKey = row.dataset.key;
    const linea = lineas[lineaKey];

    row.addEventListener('dragstart', () => { draggedLineaKey = lineaKey; row.classList.add('dragging'); });
    row.addEventListener('dragend', () => { draggedLineaKey = null; row.classList.remove('dragging'); });

    const nombreInput = row.querySelector('.linea-nombre');
    nombreInput.addEventListener('blur', () => {
      const v = nombreInput.value.trim();
      if (v !== (linea.nombre || '')) updateLinea(lineaKey, { nombre: v });
    });
    nombreInput.addEventListener('keydown', e => { if (e.key === 'Enter') nombreInput.blur(); });

    const unidadInput = row.querySelector('.linea-unidad');
    unidadInput.addEventListener('blur', () => {
      const v = unidadInput.value.trim();
      if (v !== (linea.unidad || '')) updateLinea(lineaKey, { unidad: v });
    });
    unidadInput.addEventListener('keydown', e => { if (e.key === 'Enter') unidadInput.blur(); });

    const cantidadInput = row.querySelector('.linea-cantidad');
    cantidadInput.value = linea.cantidad ?? '';
    attachCalcInput(cantidadInput, linea.cantidadFormula);
    cantidadInput.addEventListener('blur', () => {
      const n = parseFloat(cantidadInput.value.replace(',', '.'));
      updateLinea(lineaKey, { cantidad: isNaN(n) ? null : n, cantidadFormula: getCalcFormula(cantidadInput) });
    });
    cantidadInput.addEventListener('keydown', e => { if (e.key === 'Enter') cantidadInput.blur(); });

    row.querySelectorAll('.computo-linea-mover').forEach(btn => {
      btn.addEventListener('click', () => moverLinea(lineaKey, parseInt(btn.dataset.dir, 10)));
    });
    row.querySelector('.computo-linea-dup').addEventListener('click', () => duplicarLinea(lineaKey));
    row.querySelector('.computo-linea-del').addEventListener('click', () => deleteLinea(lineaKey));
  });
}

function renderResumen() {
  const total = Object.values(lineas).reduce((acc, l) => acc + totalLinea(l), 0);
  $('resumen').innerHTML = `
    <div class="ap-resumen-row total"><span>Costo total del cómputo</span><span>${fmtARS(total)}</span></div>
    <p class="form-hint" style="margin-top:.5rem;">Costo sin Gastos Generales, beneficio ni IVA — eso se aplica en el Presupuesto de la obra.</p>`;
}

function renderTodo() {
  renderLineas();
  renderResumen();
}

// Cada línea/rubro se guarda en su propio path (PUT al crear, PATCH al
// editar campos sueltos) en vez de reescribir el árbol completo — mismo
// criterio que carga-fija.js, evita perder líneas si se edita rápido (ver
// memoria feedback_firebase_patch_por_linea).
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

async function persistRubroNuevo(rubroId) {
  try {
    const { nombre, orden } = rubros.find(r => r.key === rubroId);
    await _fbPut(`/obras/${obraKey}/rubrosComputo/${rubroId}.json`, { nombre, orden });
  } catch (_) {
    showToast('Error al guardar el rubro.', 'error');
  }
}

async function persistRubroCambios(rubroId, cambios) {
  try {
    await _fbPatch(`/obras/${obraKey}/rubrosComputo/${rubroId}.json`, cambios);
  } catch (_) {
    showToast('Error al guardar el rubro.', 'error');
  }
}

function updateLinea(lineaKey, cambios) {
  lineas[lineaKey] = { ...lineas[lineaKey], ...cambios };
  renderTodo();
  persistLineaCambios(lineaKey, cambios);
}

function addRubro() {
  const rubroId = 'rubro_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const orden = rubros.length ? Math.max(...rubros.map(r => r.orden || 0)) + 1 : 1;
  rubros.push({ key: rubroId, nombre: '', orden });
  renderTodo();
  persistRubroNuevo(rubroId);
  setTimeout(() => {
    const input = document.querySelector(`.computo-rubro-nombre-input[data-rubro-id="${CSS.escape(rubroId)}"]`);
    if (input) input.focus();
  }, 50);
}

function moverRubro(rubroId, dir) {
  const ordenados = [...rubros].sort((a, b) => (a.orden || 0) - (b.orden || 0));
  const idx = ordenados.findIndex(r => r.key === rubroId);
  const otroIdx = idx + dir;
  if (idx < 0 || otroIdx < 0 || otroIdx >= ordenados.length) return;
  const a = ordenados[idx], b = ordenados[otroIdx];
  const ordenA = a.orden, ordenB = b.orden;
  a.orden = ordenB; b.orden = ordenA;
  renderTodo();
  persistRubroCambios(a.key, { orden: a.orden });
  persistRubroCambios(b.key, { orden: b.orden });
}

async function eliminarRubro(rubroId) {
  if (lineasDeRubro(rubroId).length) { showToast('Vaciá el rubro antes de eliminarlo.', 'error'); return; }
  const rubro = rubros.find(r => r.key === rubroId);
  const ok = await showConfirm('Eliminar rubro', `¿Eliminar "${rubro ? rubro.nombre || '(sin nombre)' : rubroId}"?`);
  if (!ok) return;
  rubros = rubros.filter(r => r.key !== rubroId);
  renderTodo();
  try {
    await _fbDel(`/obras/${obraKey}/rubrosComputo/${rubroId}.json`);
  } catch (_) {
    showToast('Error al eliminar el rubro.', 'error');
  }
}

function addLinea() {
  if (!rubros.length) { showToast('Agregá un rubro primero.', 'error'); return; }
  populateNlRubroSelect();
  $('nl-rubro').value = rubros.length === 1 ? rubros[0].key : '';
  $('modal-nueva-linea-error').classList.add('hidden');
  $('modal-nueva-linea').classList.remove('hidden');
}

function populateNlRubroSelect() {
  const ordenados = [...rubros].sort((a, b) => (a.orden || 0) - (b.orden || 0));
  const opts = ordenados.map((r, i) => `<option value="${escHtml(r.key)}">${i + 1}. ${escHtml(r.nombre || '(sin nombre)')}</option>`).join('');
  $('nl-rubro').innerHTML = '<option value="">— Elegir rubro —</option>' + opts;
}

function crearLineaEnRubro() {
  const rubroId = $('nl-rubro').value;
  if (!rubroId) {
    $('modal-nueva-linea-error').textContent = 'Elegí un rubro.';
    $('modal-nueva-linea-error').classList.remove('hidden');
    return;
  }
  const lineaKey = 'linea_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const grupo = lineasDeRubro(rubroId);
  const orden = grupo.length ? Math.max(...grupo.map(([, l]) => l.orden || 0)) + 1 : 1;
  lineas[lineaKey] = { rubroId, nombre: '', unidad: '', cantidad: null, itemKey: null, orden, creadoEn: Date.now() };
  $('modal-nueva-linea').classList.add('hidden');
  renderTodo();
  persistLineaNueva(lineaKey);
}

function moverLinea(lineaKey, dir) {
  const linea = lineas[lineaKey];
  const grupo = lineasDeRubro(linea.rubroId);
  const idx = grupo.findIndex(([k]) => k === lineaKey);
  const otroIdx = idx + dir;
  if (idx < 0 || otroIdx < 0 || otroIdx >= grupo.length) return;
  const [, a] = grupo[idx], [, b] = grupo[otroIdx];
  const ordenA = a.orden, ordenB = b.orden;
  a.orden = ordenB; b.orden = ordenA;
  renderTodo();
  persistLineaCambios(grupo[idx][0], { orden: a.orden });
  persistLineaCambios(grupo[otroIdx][0], { orden: b.orden });
}

function moverLineaARubro(lineaKey, rubroIdDestino) {
  const linea = lineas[lineaKey];
  if (!linea || linea.rubroId === rubroIdDestino) return;
  const grupoDestino = lineasDeRubro(rubroIdDestino);
  const nuevoOrden = grupoDestino.length ? Math.max(...grupoDestino.map(([, l]) => l.orden || 0)) + 1 : 1;
  updateLinea(lineaKey, { rubroId: rubroIdDestino, orden: nuevoOrden });
}

function duplicarLinea(lineaKey) {
  const original = lineas[lineaKey];
  const nuevaKey = 'linea_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const grupo = lineasDeRubro(original.rubroId);
  const orden = grupo.length ? Math.max(...grupo.map(([, l]) => l.orden || 0)) + 1 : 1;
  lineas[nuevaKey] = {
    rubroId: original.rubroId,
    nombre: (original.nombre || '') + ' (copia)',
    unidad: original.unidad || '',
    cantidad: original.cantidad ?? null,
    cantidadFormula: original.cantidadFormula || null,
    itemKey: original.itemKey || null,
    orden,
    creadoEn: Date.now(),
  };
  renderTodo();
  persistLineaNueva(nuevaKey);
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

// Líneas creadas antes de este esquema (rubro como texto libre por línea,
// o formato aún más viejo con itemKey obligatorio + nombreOverride +
// /computoRubros): se migran una sola vez, la primera vez que se carga
// esta obra con este código — se crea una entidad de rubro por cada texto
// distinto que ya tenían las líneas, se les asigna rubroId + orden, y
// quedan fijas de ahí en más. Si ya hay rubros creados en /rubrosComputo,
// se asume que la migración ya corrió y no se repite.
async function migrarARubrosEntidad(rubrosComputoData, computoRubrosViejo) {
  if (rubrosComputoData && Object.keys(rubrosComputoData).length) {
    rubros = Object.entries(rubrosComputoData).map(([key, r]) => ({ key, ...r }));
    return;
  }
  if (!Object.keys(lineas).length) { rubros = []; return; }

  const porTexto = {};
  const ordenTextos = [];
  Object.entries(lineas).forEach(([lineaKey, linea]) => {
    if (linea.rubroId) return; // ya tiene rubro-entidad, no debería pasar si no hay rubrosComputoData, pero por las dudas
    const it = linea.itemKey ? items.find(i => i.key === linea.itemKey) : null;
    const texto = linea.rubro || (it && (computoRubrosViejo[it.rubroKey] || rubrosMapBiblioteca[it.rubroKey])) || 'Sin rubro';
    if (!porTexto[texto]) { porTexto[texto] = []; ordenTextos.push(texto); }
    porTexto[texto].push([lineaKey, linea, it]);
  });

  const ordenados = ordenTextos.filter(t => t !== 'Sin rubro').sort((a, b) => a.localeCompare(b, 'es'));
  if (porTexto['Sin rubro']) ordenados.push('Sin rubro');

  rubros = [];
  const writes = [];
  ordenados.forEach((texto, i) => {
    const rubroId = 'rubro_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '_' + i;
    const rubroData = { nombre: texto, orden: i + 1 };
    rubros.push({ key: rubroId, ...rubroData });
    writes.push(_fbPut(`/obras/${obraKey}/rubrosComputo/${rubroId}.json`, rubroData));
    porTexto[texto].forEach(([lineaKey, linea, it], j) => {
      const cambios = { rubroId, orden: j + 1, nombre: linea.nombre || linea.nombreOverride || (it ? it.nombre : '') || '', unidad: linea.unidad || (it ? it.unidad : '') || '' };
      lineas[lineaKey] = { ...linea, ...cambios };
      writes.push(persistLineaCambios(lineaKey, cambios));
    });
  });
  await Promise.all(writes);
}

let rubrosMapBiblioteca = {};

async function loadAll() {
  if (!obraKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta la obra (?obra=...).</p>';
    return;
  }
  const [obraData, lineasData, rubrosComputoData, computoRubrosViejo, itemsData, rubrosData, materialesData, equiposData, rolesData, cfgEquipos, cfgMO] = await Promise.all([
    _fbGet(`/obras/${obraKey}.json`),
    _fbGet(`/obras/${obraKey}/computo.json`),
    _fbGet(`/obras/${obraKey}/rubrosComputo.json`),
    _fbGet(`/obras/${obraKey}/computoRubros.json`),
    _fbGet('/items.json'),
    _fbGet('/rubros.json'),
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
  rubrosMapBiblioteca = {};
  Object.entries(rubrosData || {}).forEach(([key, r]) => { rubrosMapBiblioteca[key] = r.nombre; });
  materiales = Object.entries(materialesData || {}).map(([key, m]) => ({ key, ...m }));
  equipos = Object.entries(equiposData || {}).map(([key, e]) => ({ key, ...e }));
  roles = Object.entries(rolesData || {}).map(([key, r]) => ({ key, ...r }));
  if (cfgEquipos) paramsEquipos = { ...paramsEquipos, ...cfgEquipos };
  if (cfgMO) paramsMO = { ...paramsMO, ...cfgMO };
  preciosObra = window.resolverPreciosObra(materiales, obraKey);

  await migrarARubrosEntidad(rubrosComputoData, computoRubrosViejo || {});

  $('header-obra-nombre').textContent = 'Cómputo — ' + obra.nombre;
  renderTodo();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  $('btn-add-rubro').addEventListener('click', addRubro);
  $('btn-add-linea').addEventListener('click', addLinea);
  $('modal-nueva-linea-close').addEventListener('click', () => $('modal-nueva-linea').classList.add('hidden'));
  $('modal-nueva-linea-cancel').addEventListener('click', () => $('modal-nueva-linea').classList.add('hidden'));
  $('modal-nueva-linea-save').addEventListener('click', crearLineaEnRubro);

  await loadAll();
  await getDolarSnapshot().catch(() => {});
  if (obra) renderTodo();
});
