/* VIMECO S.A. — Sistema de Gestión — Carga Fija de obra
   Calcula el coeficiente K que en Presupuesto (presupuesto.js) convierte
   costo unitario en precio unitario:

     K = (1 + %GastosGenerales + %Beneficio) × (1 + %CostoFinanciero) × (1 + %IVA)

   %GastosGenerales NO se carga a mano: sale de
     (suma de gastos fijos de esta obra) / (costo total del Cómputo de esta obra)
   Beneficio, Costo Financiero e IVA sí son porcentajes directos por obra.
   Fórmula verificada contra la hoja "Carga fija" de CyP Taller Río Cuarto.xlsx.

   Cada línea de gasto fijo puede ser un monto fijo (cantidad×precioUnitario×
   meses) o un % de una base — Costo del Cómputo o Presupuesto oficial (campo
   manual en Datos de la obra) — ver totalLineaCargaFija en calcCostos.js. No
   existe "% de Presupuesto propio" porque ese valor sale de aplicar este
   mismo K: sería circular. */

const $ = id => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const obraKey = params.get('obra');

let obra = null;
let lineas = {};     // { lineaKey: { concepto, tipo, cantidad, precioUnitario, meses, porcentaje } }
let config = { beneficioPct: null, costoFinancieroPct: null, ivaPct: 21 };
let costoComputo = 0;
let computoData = null;
let items = [];
let catalogos = { materiales: [], equipos: [], roles: [] };
let paramsEquipos = { tasaInteresPct: 10, reparacionesPct: 75, lubricantesPct: 50, combustibleLtsPorHp: 0.1, precioCombustibleLitro: 0 };
let paramsMO = { asistenciaPct: 20, cargasPct: 100, diasMes: 22, jornadaHoras: 8 };
let preciosObra = {};   // { materialKey: {precioUSD,...} } — resuelto de los precios por obra de esta obra
let dolarObra = null;   // dólar propio de esta obra (/obras/{obraKey}/dolar)

function totalLinea(l) {
  return window.totalLineaCargaFija(l, costoComputo, obra ? obra.presupuestoOficial : null);
}

function totalGastosFijos() {
  return window.totalGastosFijosCargaFija(lineas, costoComputo, obra ? obra.presupuestoOficial : null);
}

const TIPO_BASE_LABEL = { pctComputo: 'del Costo del Cómputo', pctOficial: 'del Presupuesto oficial' };

function tipoSelectHtml(tipo) {
  const opciones = [
    ['monto', 'Monto fijo'],
    ['pctComputo', '% Costo Cómputo'],
    ['pctOficial', '% Presup. oficial'],
  ];
  return `<select class="form-control cf-tipo">${opciones.map(([v, label]) =>
    `<option value="${v}" ${v === tipo ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
}

function camposLineaHtml(l, tipo) {
  if (tipo === 'pctComputo' || tipo === 'pctOficial') {
    return `
      <input type="text" class="form-control cf-porcentaje" value="${l.porcentaje ?? ''}" placeholder="0">
      <span class="cf-base-label">${TIPO_BASE_LABEL[tipo]}</span>
      <span></span>`;
  }
  return `
    <input type="text" class="form-control cf-cantidad" value="${l.cantidad ?? ''}" placeholder="0">
    <input type="text" class="form-control cf-precio" value="${escHtml(formatMoneyString(l.precioUnitario))}" placeholder="0">
    <input type="text" class="form-control cf-meses" value="${l.meses ?? ''}" placeholder="0">`;
}

function renderLineas() {
  const container = $('lineas-carga-fija');
  const entradas = Object.entries(lineas);
  if (!entradas.length) {
    container.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Sin conceptos todavía.</p>';
  } else {
    container.innerHTML = entradas.map(([lineaKey, l]) => {
      const tipo = l.tipo || 'monto';
      const total = totalLinea(l);
      return `
        <div class="cf-linea" data-key="${escHtml(lineaKey)}">
          <input type="text" class="form-control cf-concepto" value="${escHtml(l.concepto || '')}" placeholder="Ej: Jefe de obra">
          ${tipoSelectHtml(tipo)}
          ${camposLineaHtml(l, tipo)}
          <span class="cf-linea-total">${total != null ? fmtARS(total) : '—'}</span>
          <button class="cf-linea-del" title="Eliminar concepto">${icSvg('x')}</button>
        </div>`;
    }).join('');
  }

  container.querySelectorAll('.cf-linea').forEach(row => {
    const lineaKey = row.dataset.key;
    const l = lineas[lineaKey];
    const tipo = l.tipo || 'monto';
    const concepto = row.querySelector('.cf-concepto');
    const tipoSelect = row.querySelector('.cf-tipo');

    concepto.addEventListener('blur', () => updateLinea(lineaKey, { concepto: concepto.value.trim() }));
    concepto.addEventListener('keydown', e => { if (e.key === 'Enter') concepto.blur(); });

    tipoSelect.addEventListener('change', () => updateLinea(lineaKey, { tipo: tipoSelect.value }));

    const numField = (input, key) => {
      input.addEventListener('blur', () => {
        const n = parseFloat(input.value.replace(',', '.'));
        updateLinea(lineaKey, { [key]: isNaN(n) ? null : n, [key + 'Formula']: getCalcFormula(input) });
      });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
    };

    if (tipo === 'pctComputo' || tipo === 'pctOficial') {
      const porcentaje = row.querySelector('.cf-porcentaje');
      attachCalcInput(porcentaje, l.porcentajeFormula);
      numField(porcentaje, 'porcentaje');
    } else {
      const cantidad = row.querySelector('.cf-cantidad');
      const precio = row.querySelector('.cf-precio');
      const meses = row.querySelector('.cf-meses');
      attachCalcInput(cantidad, l.cantidadFormula);
      attachCalcInput(precio, l.precioUnitarioFormula);
      attachMoneyInput(precio);
      attachCalcInput(meses, l.mesesFormula);

      numField(cantidad, 'cantidad');
      numField(meses, 'meses');
      precio.addEventListener('blur', () => {
        const n = parseMoneyString(precio.value);
        updateLinea(lineaKey, { precioUnitario: isNaN(n) ? null : n, precioUnitarioFormula: getCalcFormula(precio) });
      });
      precio.addEventListener('keydown', e => { if (e.key === 'Enter') precio.blur(); });
    }

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
  lineas[lineaKey] = { concepto: '', tipo: 'monto', cantidad: null, precioUnitario: null, meses: null };
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

// Importar de otra obra: siempre agrega los conceptos de la obra origen como
// líneas nuevas (no pisa ni borra lo que ya haya en la obra destino). No
// copia los % de Beneficio/Financiero/IVA — esos varían por obra/contrato.
let obrasParaImportar = null; // cache: [{key, nombre}] — todas menos la actual
let importarCfSelect = null;
let lineasOrigenImportar = null; // { lineaKey: linea } de la obra elegida, o null

async function abrirModalImportarCf() {
  $('importar-cf-confirmar').disabled = true;
  $('importar-cf-info').textContent = '';
  lineasOrigenImportar = null;

  if (!obrasParaImportar) {
    const data = await _fbGet('/obras.json');
    obrasParaImportar = Object.entries(data || {})
      .filter(([key]) => key !== obraKey)
      .map(([key, o]) => ({ key, nombre: o.nombre || key }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  importarCfSelect = createSearchableSelect($('importar-cf-select'), {
    options: obrasParaImportar.map(o => ({ value: o.key, label: o.nombre })),
    placeholder: 'Buscar obra…',
    onChange: onElegirObraOrigenImportar,
  });

  $('modal-importar-cf').classList.remove('hidden');
}

function cerrarModalImportarCf() {
  $('modal-importar-cf').classList.add('hidden');
}

async function onElegirObraOrigenImportar(obraOrigenKey) {
  $('importar-cf-confirmar').disabled = true;
  lineasOrigenImportar = null;
  $('importar-cf-info').textContent = 'Buscando…';

  const data = await _fbGet(`/obras/${obraOrigenKey}/cargaFija/lineas.json`);
  const cantidad = Object.keys(data || {}).length;
  if (!cantidad) {
    $('importar-cf-info').textContent = 'Esa obra no tiene conceptos cargados en Carga Fija.';
    return;
  }
  lineasOrigenImportar = data;
  $('importar-cf-info').textContent = `Se van a agregar ${cantidad} concepto${cantidad === 1 ? '' : 's'} a los que ya tiene esta obra.`;
  $('importar-cf-confirmar').disabled = false;
}

async function confirmarImportarCf() {
  if (!lineasOrigenImportar) return;
  const nuevas = {};
  Object.values(lineasOrigenImportar).forEach(l => {
    const lineaKey = 'linea_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    nuevas[lineaKey] = {
      concepto: l.concepto, tipo: l.tipo || 'monto',
      cantidad: l.cantidad, precioUnitario: l.precioUnitario, meses: l.meses,
      porcentaje: l.porcentaje ?? null, porcentajeFormula: l.porcentajeFormula ?? null,
    };
  });

  Object.assign(lineas, nuevas);
  renderTodo();
  cerrarModalImportarCf();

  try {
    await _fbPatch(`/obras/${obraKey}/cargaFija/lineas.json`, nuevas);
    showToast(`${Object.keys(nuevas).length} conceptos importados.`);
  } catch (_) {
    showToast('Error al importar los conceptos.', 'error');
  }
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
    const r = window.calcCostoUnitarioItem(version, version.lineas, catalogos, paramsEquipos, paramsMO, preciosObra, dolarObra);
    return acc + r.costoUnitario * l.cantidad;
  }, 0);
}

async function loadAll() {
  if (!obraKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta la obra (?obra=...).</p>';
    return;
  }
  const [obraData, lineasData, configData, computoLineas, itemsData, materialesData, equiposData, rolesData] = await Promise.all([
    _fbGet(`/obras/${obraKey}.json`),
    _fbGet(`/obras/${obraKey}/cargaFija/lineas.json`),
    _fbGet(`/obras/${obraKey}/cargaFija/config.json`),
    _fbGet(`/obras/${obraKey}/computo.json`),
    _fbGet('/items.json'),
    _fbGet('/materiales.json'),
    _fbGet('/equipos.json'),
    _fbGet(`/obras/${obraKey}/roles.json`),
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
  paramsEquipos = { ...paramsEquipos, ...(obra.paramsEquipos || {}) };
  paramsMO = { ...paramsMO, ...(obra.paramsMO || {}) };
  dolarObra = obra.dolar ? obra.dolar.valor : null;
  preciosObra = window.resolverPreciosObra(catalogos.materiales, obraKey);
  costoComputo = calcularCostoComputo(computoData, items);

  $('header-obra-nombre').textContent = 'Carga Fija — ' + obra.nombre;
  renderHeaderTabs(obraKey, 'carga-fija');
  renderTodo();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  $('btn-add-linea').addEventListener('click', addLinea);
  $('btn-importar-cf').addEventListener('click', abrirModalImportarCf);
  $('importar-cf-close').addEventListener('click', cerrarModalImportarCf);
  $('importar-cf-cancelar').addEventListener('click', cerrarModalImportarCf);
  $('importar-cf-confirmar').addEventListener('click', confirmarImportarCf);
  await loadAll();
  await getDolarSnapshot().catch(() => {});
  if (obra) {
    costoComputo = calcularCostoComputo(computoData, items);
    renderTodo();
  }
});
