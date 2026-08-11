/* VIMECO S.A. — Sistema de Gestión — Cómputo de obra
   Listado totalmente libre: cada línea tiene Rubro + Ítem + Unidad de texto
   libre (no dependen de la Biblioteca), Cantidad, y un costo que arranca en
   $0 hasta que se vincula a un ítem real vía "Análisis de Precio"
   (item.html?key=...&obra=... si ya está vinculada, o
   item.html?linea=...&obra=... para buscar/crear el ítem la primera vez).
   El costo, una vez vinculada, se calcula en vivo: si el ítem tiene una
   versión de Rendimientos propia para ESTA obra
   (/items/{key}/versionesObra/{obraKey}, ver item.js) se usa esa receta +
   rendimiento; si no, se usa la Teórica (calcCostoUnitarioItem,
   js/calcCostos.js). Es costo total de obra sin carga (sin %GG, beneficio,
   financiero ni IVA) — eso se aplica en el Presupuesto, etapa siguiente.

   El agrupamiento visual (con subtotal) es por el campo `rubro` de cada
   línea, no por la Biblioteca — cambiar el Rubro de una línea la reordena
   sola al re-renderizar. */

const $ = id => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const obraKey = params.get('obra');

let obra = null;
let lineas = {};   // { lineaKey: { rubro, nombre, unidad, cantidad, cantidadFormula, itemKey } }
let items = [];
let rubrosMap = {};
let materiales = [];
let equipos = [];
let roles = [];
let paramsEquipos = { tasaInteresPct: 10, reparacionesPct: 75, lubricantesPct: 50, combustibleLtsPorHp: 0.1, precioCombustibleLitro: 0 };
let paramsMO = { asistenciaPct: 20, cargasPct: 100, diasMes: 22, jornadaHoras: 8 };

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
  const r = window.calcCostoUnitarioItem(version, version.lineas, catalogos, paramsEquipos, paramsMO);
  return r.costoUnitario;
}

function totalLinea(linea) {
  const costo = costoUnitarioDe(linea.itemKey);
  const cantidad = linea.cantidad != null && !isNaN(linea.cantidad) ? linea.cantidad : 0;
  return costo * cantidad;
}

// Agrupa por el texto de Rubro de cada línea (no por la Biblioteca) —
// orden alfabético, "Sin rubro" al final.
function agruparLineas() {
  const porRubro = {};
  Object.entries(lineas).forEach(([lineaKey, linea]) => {
    const rubro = linea.rubro || 'Sin rubro';
    (porRubro[rubro] = porRubro[rubro] || []).push([lineaKey, linea]);
  });
  const nombres = Object.keys(porRubro).filter(r => r !== 'Sin rubro').sort((a, b) => a.localeCompare(b, 'es'));
  if (porRubro['Sin rubro']) nombres.push('Sin rubro');
  return nombres.map(nombre => ({ nombre, lineas: porRubro[nombre] }));
}

function subtotalGrupo(grupoLineas) {
  return grupoLineas.reduce((acc, [, l]) => acc + totalLinea(l), 0);
}

function renderRubroHeader(grupo) {
  return `
    <div class="computo-rubro-header">
      <span class="computo-rubro-nombre">${escHtml(grupo.nombre)}</span>
      <span class="computo-rubro-subtotal">${fmtARS(subtotalGrupo(grupo.lineas))}</span>
    </div>`;
}

function renderLineaRow(lineaKey, linea) {
  const costo = costoUnitarioDe(linea.itemKey);
  const total = totalLinea(linea);
  const hrefAP = linea.itemKey
    ? `item.html?key=${encodeURIComponent(linea.itemKey)}&obra=${encodeURIComponent(obraKey)}`
    : `item.html?linea=${encodeURIComponent(lineaKey)}&obra=${encodeURIComponent(obraKey)}`;
  return `
    <div class="computo-linea" data-key="${escHtml(lineaKey)}">
      <input type="text" class="form-control linea-rubro" placeholder="Rubro" value="${escHtml(linea.rubro || '')}">
      <input type="text" class="form-control linea-nombre" placeholder="Ítem" value="${escHtml(linea.nombre || '')}">
      <input type="text" class="form-control linea-unidad" placeholder="Unidad" value="${escHtml(linea.unidad || '')}">
      <input type="text" class="form-control linea-cantidad" placeholder="Cantidad">
      <span class="computo-linea-costo">${fmtARS(costo)}</span>
      <span class="computo-linea-total">${fmtARS(total)}</span>
      <span class="computo-linea-acciones"><a class="computo-linea-ap" href="${hrefAP}" title="Análisis de Precio">${icSvg('layers')}</a><button class="computo-linea-del" title="Eliminar línea">${icSvg('x')}</button></span>
    </div>`;
}

function renderLineas() {
  const container = $('lineas-computo');

  if (!Object.keys(lineas).length) {
    container.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Sin ítems todavía.</p>';
  } else {
    const grupos = agruparLineas();
    const header = `
      <div class="computo-linea computo-linea-header">
        <span>Rubro</span><span>Ítem</span><span>Unidad</span><span>Cantidad</span><span>Costo unitario</span><span>Costo subtotal</span><span></span>
      </div>`;
    container.innerHTML = header + grupos.map(g => renderRubroHeader(g) + g.lineas.map(([k, l]) => renderLineaRow(k, l)).join('')).join('');
  }

  container.querySelectorAll('.computo-linea[data-key]').forEach(row => {
    const lineaKey = row.dataset.key;
    const linea = lineas[lineaKey];

    const rubroInput = row.querySelector('.linea-rubro');
    rubroInput.addEventListener('blur', () => {
      const v = rubroInput.value.trim();
      if (v !== (linea.rubro || '')) updateLinea(lineaKey, { rubro: v });
    });
    rubroInput.addEventListener('keydown', e => { if (e.key === 'Enter') rubroInput.blur(); });

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

function updateLinea(lineaKey, cambios) {
  lineas[lineaKey] = { ...lineas[lineaKey], ...cambios };
  renderTodo();
  persistLineaCambios(lineaKey, cambios);
}

function addLinea() {
  const lineaKey = 'linea_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  lineas[lineaKey] = { rubro: '', nombre: '', unidad: '', cantidad: null, itemKey: null, creadoEn: Date.now() };
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

// Líneas creadas antes de este esquema (itemKey obligatorio, rubro heredado
// del ítem vía /computoRubros, nombre en nombreOverride): se completan los
// campos nuevos una sola vez a partir de esos datos viejos y quedan fijos
// de ahí en más — no se vuelve a tocar /computoRubros ni nombreOverride.
async function migrarLineasViejas(rubroOverridesViejos) {
  const pendientes = Object.entries(lineas).filter(([, l]) => l.rubro === undefined || l.nombre === undefined || l.unidad === undefined);
  if (!pendientes.length) return;
  await Promise.all(pendientes.map(([lineaKey, linea]) => {
    const it = linea.itemKey ? items.find(i => i.key === linea.itemKey) : null;
    const rubro = (it && (rubroOverridesViejos[it.rubroKey] || rubrosMap[it.rubroKey])) || 'Sin rubro';
    const nombre = linea.nombreOverride || (it ? it.nombre : '') || '';
    const unidad = (it ? it.unidad : '') || '';
    const cambios = { rubro, nombre, unidad };
    lineas[lineaKey] = { ...linea, ...cambios };
    return persistLineaCambios(lineaKey, cambios);
  }));
}

async function loadAll() {
  if (!obraKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta la obra (?obra=...).</p>';
    return;
  }
  const [obraData, lineasData, itemsData, rubrosData, computoRubrosData, materialesData, equiposData, rolesData, cfgEquipos, cfgMO] = await Promise.all([
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
  const rubros = Object.entries(rubrosData || {}).map(([key, r]) => ({ key, ...r }));
  rubrosMap = {};
  rubros.forEach(r => { rubrosMap[r.key] = r.nombre; });
  materiales = Object.entries(materialesData || {}).map(([key, m]) => ({ key, ...m }));
  equipos = Object.entries(equiposData || {}).map(([key, e]) => ({ key, ...e }));
  roles = Object.entries(rolesData || {}).map(([key, r]) => ({ key, ...r }));
  if (cfgEquipos) paramsEquipos = { ...paramsEquipos, ...cfgEquipos };
  if (cfgMO) paramsMO = { ...paramsMO, ...cfgMO };

  await migrarLineasViejas(computoRubrosData || {});

  $('header-obra-nombre').textContent = 'Cómputo — ' + obra.nombre;
  renderTodo();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  $('btn-add-linea').addEventListener('click', addLinea);

  await loadAll();
  await getDolarSnapshot().catch(() => {});
  if (obra) renderTodo();
});
