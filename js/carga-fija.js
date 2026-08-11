/* VIMECO S.A. — Sistema de Gestión — Carga Fija de obra
   Calcula el coeficiente K que en el Presupuesto (etapa siguiente, todavía no
   construida) convierte costo unitario en precio unitario:

     K = (1 + %GastosGenerales + %Beneficio) × (1 + %CostoFinanciero) × (1 + %IVA)

   %GastosGenerales NO se carga a mano: sale de
     (suma de gastos fijos de esta obra) / (costo total del Cómputo de esta obra)
   Beneficio, Costo Financiero e IVA sí son porcentajes directos por obra.
   Fórmula verificada contra la hoja "Carga fija" de CyP Taller Río Cuarto.xlsx. */

const $ = id => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const obraKey = params.get('obra');

let obra = null;
let lineas = {};     // { lineaKey: { concepto, cantidad, precioUnitario, meses } }
let config = { beneficioPct: null, costoFinancieroPct: null, ivaPct: 21 };
let costoComputo = 0;
let computoData = null;
let items = [];
let catalogos = { materiales: [], equipos: [], roles: [] };
let paramsEquipos = { tasaInteresPct: 10, reparacionesPct: 75, lubricantesPct: 50, combustibleLtsPorHp: 0.1, precioCombustibleLitro: 0 };
let paramsMO = { asistenciaPct: 20, cargasPct: 100, diasMes: 22, jornadaHoras: 8 };
let preciosObra = {};   // { materialKey: {precioUSD,...} } — resuelto de Cotizaciones de esta obra

function totalLinea(l) {
  if (l.cantidad == null || l.precioUnitario == null || l.meses == null) return null;
  if (isNaN(l.cantidad) || isNaN(l.precioUnitario) || isNaN(l.meses)) return null;
  return l.cantidad * l.precioUnitario * l.meses;
}

function totalGastosFijos() {
  return Object.values(lineas).reduce((acc, l) => {
    const t = totalLinea(l);
    return t == null ? acc : acc + t;
  }, 0);
}

function renderLineas() {
  const container = $('lineas-carga-fija');
  const entradas = Object.entries(lineas);
  if (!entradas.length) {
    container.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Sin conceptos todavía.</p>';
  } else {
    container.innerHTML = entradas.map(([lineaKey, l]) => {
      const total = totalLinea(l);
      return `
        <div class="cf-linea" data-key="${escHtml(lineaKey)}">
          <input type="text" class="form-control cf-concepto" value="${escHtml(l.concepto || '')}" placeholder="Ej: Jefe de obra">
          <input type="text" class="form-control cf-cantidad" value="${l.cantidad ?? ''}" placeholder="0">
          <input type="text" class="form-control cf-precio" value="${l.precioUnitario ?? ''}" placeholder="0">
          <input type="text" class="form-control cf-meses" value="${l.meses ?? ''}" placeholder="0">
          <span class="cf-linea-total">${total != null ? fmtARS(total) : '—'}</span>
          <button class="cf-linea-del" title="Eliminar concepto">${icSvg('x')}</button>
        </div>`;
    }).join('');
  }

  container.querySelectorAll('.cf-linea').forEach(row => {
    const lineaKey = row.dataset.key;
    const l = lineas[lineaKey];
    const concepto = row.querySelector('.cf-concepto');
    const cantidad = row.querySelector('.cf-cantidad');
    const precio = row.querySelector('.cf-precio');
    const meses = row.querySelector('.cf-meses');
    attachCalcInput(cantidad, l.cantidadFormula);
    attachCalcInput(precio, l.precioUnitarioFormula);
    attachCalcInput(meses, l.mesesFormula);

    concepto.addEventListener('blur', () => updateLinea(lineaKey, { concepto: concepto.value.trim() }));
    concepto.addEventListener('keydown', e => { if (e.key === 'Enter') concepto.blur(); });

    const numField = (input, key) => {
      input.addEventListener('blur', () => {
        const n = parseFloat(input.value.replace(',', '.'));
        updateLinea(lineaKey, { [key]: isNaN(n) ? null : n, [key + 'Formula']: getCalcFormula(input) });
      });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
    };
    numField(cantidad, 'cantidad');
    numField(precio, 'precioUnitario');
    numField(meses, 'meses');

    row.querySelector('.cf-linea-del').addEventListener('click', () => deleteLinea(lineaKey));
  });

  $('total-gastos-fijos').textContent = fmtARS(totalGastosFijos());
}

function calcularK() {
  const ggFrac = costoComputo > 0 ? totalGastosFijos() / costoComputo : null;
  const benefFrac = (config.beneficioPct || 0) / 100;
  const cfFrac = (config.costoFinancieroPct || 0) / 100;
  const ivaFrac = (config.ivaPct || 0) / 100;

  if (ggFrac == null) return { ggFrac: null, subtotalCosto: null, subtotalConFinanciero: null, k: null };

  const subtotalCosto = 1 + ggFrac + benefFrac;
  const subtotalConFinanciero = subtotalCosto * (1 + cfFrac);
  const k = subtotalConFinanciero * (1 + ivaFrac);
  return { ggFrac, subtotalCosto, subtotalConFinanciero, k };
}

function fmtPct(frac) {
  return (frac * 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
}
function fmtCoef(n) {
  return n.toLocaleString('es-AR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

function renderCoeficienteK() {
  const r = calcularK();
  const el = $('coeficiente-k');

  if (r.ggFrac == null) {
    el.innerHTML = `<p class="form-hint">Esta obra todavía no tiene ítems cargados en el Cómputo — no se puede calcular el % de Gastos Generales hasta que haya un costo de obra sobre el cual prorratear los gastos fijos.</p>`;
    return;
  }

  el.innerHTML = `
    <div class="ap-resumen-row"><span>Costo total del Cómputo</span><span>${fmtARS(costoComputo)}</span></div>
    <div class="ap-resumen-row"><span>% Gastos Generales (calculado)</span><span>${fmtPct(r.ggFrac)}</span></div>
    <div class="ap-resumen-row"><span>% Beneficio</span><span><input type="text" class="form-control" id="cf-beneficio" value="${config.beneficioPct ?? ''}" placeholder="0"></span></div>
    <div class="ap-resumen-row"><span>Subtotal Costo</span><span>${fmtCoef(r.subtotalCosto)}</span></div>
    <div class="ap-resumen-row"><span>% Costo Financiero</span><span><input type="text" class="form-control" id="cf-financiero" value="${config.costoFinancieroPct ?? ''}" placeholder="0"></span></div>
    <div class="ap-resumen-row"><span>Subtotal con gasto financiero</span><span>${fmtCoef(r.subtotalConFinanciero)}</span></div>
    <div class="ap-resumen-row"><span>% IVA</span><span><input type="text" class="form-control" id="cf-iva" value="${config.ivaPct ?? ''}" placeholder="21"></span></div>
    <div class="ap-resumen-row total"><span>TOTAL (K)</span><span>${fmtCoef(r.k)}</span></div>
    <p class="form-hint" style="margin-top:.5rem;">K se aplica al costo unitario de cada ítem en el Presupuesto de la obra para sacar el precio unitario.</p>`;

  const pctField = (id, key) => {
    const input = $(id);
    attachCalcInput(input, config[key + 'Formula']);
    input.addEventListener('blur', () => {
      const n = parseFloat(input.value.replace(',', '.'));
      updateConfig({ [key]: isNaN(n) ? null : n, [key + 'Formula']: getCalcFormula(input) });
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  };
  pctField('cf-beneficio', 'beneficioPct');
  pctField('cf-financiero', 'costoFinancieroPct');
  pctField('cf-iva', 'ivaPct');
}

function renderTodo() {
  renderLineas();
  renderCoeficienteK();
}

// Cada línea/campo se guarda en su propio path con PATCH (merge), no
// reescribiendo el árbol completo de líneas: si dos ediciones seguidas
// (ej. cantidad y precio, tipeadas rápido en la misma línea) completan
// desordenadas por red, un PUT del árbol entero podía hacer que la más vieja
// pise a la más nueva y se perdiera una línea. Con PATCH por línea/campo,
// el orden de llegada no importa porque cada request sólo toca lo suyo.
async function persistLineaCambios(lineaKey, cambios) {
  try {
    await _fbPatch(`/obras/${obraKey}/cargaFija/lineas/${lineaKey}.json`, cambios);
  } catch (_) {
    showToast('Error al guardar los gastos fijos.', 'error');
  }
}

async function persistLineaNueva(lineaKey) {
  try {
    await _fbPut(`/obras/${obraKey}/cargaFija/lineas/${lineaKey}.json`, lineas[lineaKey]);
  } catch (_) {
    showToast('Error al guardar los gastos fijos.', 'error');
  }
}

async function persistConfigCambios(cambios) {
  try {
    await _fbPatch(`/obras/${obraKey}/cargaFija/config.json`, cambios);
  } catch (_) {
    showToast('Error al guardar la configuración de carga fija.', 'error');
  }
}

function updateLinea(lineaKey, cambios) {
  lineas[lineaKey] = { ...lineas[lineaKey], ...cambios };
  renderTodo();
  persistLineaCambios(lineaKey, cambios);
}

function updateConfig(cambios) {
  config = { ...config, ...cambios };
  renderCoeficienteK();
  persistConfigCambios(cambios);
}

function addLinea() {
  const lineaKey = 'linea_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  lineas[lineaKey] = { concepto: '', cantidad: null, precioUnitario: null, meses: null };
  renderTodo();
  persistLineaNueva(lineaKey);
}

async function deleteLinea(lineaKey) {
  delete lineas[lineaKey];
  renderTodo();
  try {
    await _fbDel(`/obras/${obraKey}/cargaFija/lineas/${lineaKey}.json`);
  } catch (_) {
    showToast('Error al eliminar el concepto.', 'error');
  }
  showToast('Concepto eliminado.');
}

function versionDe(it) {
  const propia = it.versionesObra && it.versionesObra[obraKey];
  return propia || it;
}

function calcularCostoComputo(computoLineas, itemsList) {
  const itemsMap = {};
  itemsList.forEach(it => { itemsMap[it.key] = it; });
  return Object.values(computoLineas || {}).reduce((acc, l) => {
    const it = itemsMap[l.itemKey];
    if (!it || l.cantidad == null || isNaN(l.cantidad)) return acc;
    const version = versionDe(it);
    if (!version.lineas || !Object.keys(version.lineas).length) return acc;
    const r = window.calcCostoUnitarioItem(version, version.lineas, catalogos, paramsEquipos, paramsMO, preciosObra);
    return acc + r.costoUnitario * l.cantidad;
  }, 0);
}

async function loadAll() {
  if (!obraKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta la obra (?obra=...).</p>';
    return;
  }
  const [obraData, lineasData, configData, computoLineas, itemsData, materialesData, equiposData, rolesData, cfgEquipos, cfgMO, cotizacionesData] = await Promise.all([
    _fbGet(`/obras/${obraKey}.json`),
    _fbGet(`/obras/${obraKey}/cargaFija/lineas.json`),
    _fbGet(`/obras/${obraKey}/cargaFija/config.json`),
    _fbGet(`/obras/${obraKey}/computo.json`),
    _fbGet('/items.json'),
    _fbGet('/materiales.json'),
    _fbGet('/equipos.json'),
    _fbGet('/manoDeObra.json'),
    _fbGet('/config/equipos.json'),
    _fbGet('/config/manoDeObra.json'),
    _fbGet('/cotizaciones.json'),
  ]);

  if (!obraData) {
    document.body.innerHTML = '<p style="padding:2rem;">No se encontró la obra.</p>';
    return;
  }
  obra = obraData;
  lineas = lineasData || {};
  if (configData) config = { ...config, ...configData };
  computoData = computoLineas;
  items = Object.entries(itemsData || {}).map(([key, it]) => ({ key, ...it }));
  catalogos = {
    materiales: Object.entries(materialesData || {}).map(([key, m]) => ({ key, ...m })),
    equipos: Object.entries(equiposData || {}).map(([key, e]) => ({ key, ...e })),
    roles: Object.entries(rolesData || {}).map(([key, r]) => ({ key, ...r })),
  };
  if (cfgEquipos) paramsEquipos = { ...paramsEquipos, ...cfgEquipos };
  if (cfgMO) paramsMO = { ...paramsMO, ...cfgMO };
  const cotizaciones = Object.entries(cotizacionesData || {}).map(([key, c]) => ({ key, ...c }));
  preciosObra = window.resolverPreciosObra(cotizaciones, obraKey);
  costoComputo = calcularCostoComputo(computoData, items);

  $('header-obra-nombre').textContent = 'Carga Fija — ' + obra.nombre;
  renderTodo();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  $('btn-add-linea').addEventListener('click', addLinea);
  await loadAll();
  await getDolarSnapshot().catch(() => {});
  if (obra) {
    costoComputo = calcularCostoComputo(computoData, items);
    renderTodo();
  }
});
