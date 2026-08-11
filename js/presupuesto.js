/* VIMECO S.A. — Sistema de Gestión — Presupuesto de obra
   Pantalla de sólo lectura: aplica el Coeficiente K (Carga Fija) al costo
   unitario de cada línea del Cómputo (ya con precios de esa obra resueltos,
   ver js/calcCostos.js) para sacar el precio unitario, y totaliza. Nada se
   edita acá — cantidades y receta se editan en Cómputo, %Beneficio/
   %CostoFinanciero/%IVA/gastos fijos en Carga Fija.

   K = (1 + %GastosGenerales + %Beneficio) × (1 + %CostoFinanciero) × (1 + %IVA)
   %GastosGenerales = (gastos fijos de la obra) / (costo total del Cómputo). */

const $ = id => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const obraKey = params.get('obra');

let obra = null;
let rubros = [];   // [{ key, nombre, orden }] — ordenado por `orden`
let lineas = {};   // { lineaKey: { rubroId, nombre, unidad, cantidad, itemKey, orden } }
let items = [];
let materiales = [];
let equipos = [];
let roles = [];
let paramsEquipos = { tasaInteresPct: 10, reparacionesPct: 75, lubricantesPct: 50, combustibleLtsPorHp: 0.1, precioCombustibleLitro: 0 };
let paramsMO = { asistenciaPct: 20, cargasPct: 100, diasMes: 22, jornadaHoras: 8 };
let preciosObra = {};
let cargaFijaLineas = {};
let cargaFijaConfig = { beneficioPct: null, costoFinancieroPct: null, ivaPct: 21 };

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

function costoTotalLinea(linea) {
  const costo = costoUnitarioDe(linea.itemKey);
  const cantidad = linea.cantidad != null && !isNaN(linea.cantidad) ? linea.cantidad : 0;
  return costo * cantidad;
}

function costoTotalComputo() {
  return Object.values(lineas).reduce((acc, l) => acc + costoTotalLinea(l), 0);
}

function totalGastosFijosCargaFija() {
  return Object.values(cargaFijaLineas).reduce((acc, l) => {
    if (l.cantidad == null || l.precioUnitario == null || l.meses == null) return acc;
    if (isNaN(l.cantidad) || isNaN(l.precioUnitario) || isNaN(l.meses)) return acc;
    return acc + l.cantidad * l.precioUnitario * l.meses;
  }, 0);
}

function calcularK(costoComputo) {
  const ggFrac = costoComputo > 0 ? totalGastosFijosCargaFija() / costoComputo : null;
  if (ggFrac == null) return null;
  const benefFrac = (cargaFijaConfig.beneficioPct || 0) / 100;
  const cfFrac = (cargaFijaConfig.costoFinancieroPct || 0) / 100;
  const ivaFrac = (cargaFijaConfig.ivaPct || 0) / 100;
  const subtotalCosto = 1 + ggFrac + benefFrac;
  const subtotalConFinanciero = subtotalCosto * (1 + cfFrac);
  return subtotalConFinanciero * (1 + ivaFrac);
}

function fmtCoef(n) {
  return n.toLocaleString('es-AR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

function fmtPct(frac) {
  return (frac * 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
}

function lineasDeRubro(rubroId) {
  return Object.entries(lineas)
    .filter(([, l]) => l.rubroId === rubroId)
    .sort((a, b) => (a[1].orden || 0) - (b[1].orden || 0));
}

function ordenarRubros() {
  rubros.sort((a, b) => (a.orden || 0) - (b.orden || 0));
}

function renderLineaRow(linea, numero, k, totalPresupuesto) {
  const precioUnitario = costoUnitarioDe(linea.itemKey) * k;
  const cantidad = linea.cantidad != null && !isNaN(linea.cantidad) ? linea.cantidad : 0;
  const total = precioUnitario * cantidad;
  const incidencia = totalPresupuesto > 0 ? total / totalPresupuesto : 0;
  return `
    <div class="presupuesto-linea">
      <span class="presupuesto-linea-numero">${numero}</span>
      <span>${escHtml(linea.nombre || '')}</span>
      <span>${escHtml(linea.unidad || '')}</span>
      <span${linea.cantidad != null && !isNaN(linea.cantidad) ? ` data-calc-valor="${linea.cantidad}"` : ''}>${linea.cantidad != null && !isNaN(linea.cantidad) ? linea.cantidad : '—'}</span>
      <span class="presupuesto-linea-precio" data-calc-valor="${precioUnitario}">${fmtARS(precioUnitario)}</span>
      <span class="presupuesto-linea-total" data-calc-valor="${total}">${fmtARS(total)}</span>
      <span class="presupuesto-linea-incidencia" data-calc-valor="${incidencia * 100}">${fmtPct(incidencia)}</span>
    </div>`;
}

function subtotalRubroConPrecio(grupoLineas, k) {
  return grupoLineas.reduce((acc, [, l]) => {
    const cantidad = l.cantidad != null && !isNaN(l.cantidad) ? l.cantidad : 0;
    return acc + costoUnitarioDe(l.itemKey) * k * cantidad;
  }, 0);
}

function renderTodo() {
  const container = $('lineas-presupuesto');
  const resumen = $('resumen');
  ordenarRubros();

  const costoComputo = costoTotalComputo();
  const k = calcularK(costoComputo);

  if (k == null) {
    container.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Esta obra todavía no tiene ítems cargados en el Cómputo — no se puede calcular el Presupuesto hasta que haya un costo de obra sobre el cual aplicar el Coeficiente K.</p>';
    resumen.innerHTML = '';
    return;
  }

  const totalPresupuesto = Object.values(lineas).reduce((acc, l) => {
    const cantidad = l.cantidad != null && !isNaN(l.cantidad) ? l.cantidad : 0;
    return acc + costoUnitarioDe(l.itemKey) * k * cantidad;
  }, 0);

  if (!rubros.length) {
    container.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Todavía no hay rubros cargados en el Cómputo de esta obra.</p>';
  } else {
    const header = `
      <div class="presupuesto-linea presupuesto-linea-header">
        <span></span><span>Ítem</span><span>Unidad</span><span>Cantidad</span><span>Precio unitario</span><span>Total</span><span>Incidencia</span>
      </div>`;
    container.innerHTML = header + rubros.map((rubro, rubroIdx) => {
      const grupoLineas = lineasDeRubro(rubro.key);
      const subtotalRubro = subtotalRubroConPrecio(grupoLineas, k);
      const incidenciaRubro = totalPresupuesto > 0 ? subtotalRubro / totalPresupuesto : 0;
      const rubroHtml = `
        <div class="presupuesto-rubro-header">
          <span class="presupuesto-rubro-numero">${rubroIdx + 1}.</span>
          <span class="presupuesto-rubro-nombre">${escHtml(rubro.nombre || '(sin nombre)')}</span>
          <span class="presupuesto-rubro-subtotal" data-calc-valor="${subtotalRubro}">${fmtARS(subtotalRubro)}</span>
          <span class="presupuesto-rubro-incidencia" data-calc-valor="${incidenciaRubro * 100}">${fmtPct(incidenciaRubro)}</span>
        </div>`;
      const lineasHtml = grupoLineas.length
        ? grupoLineas.map(([, l], i) => renderLineaRow(l, `${rubroIdx + 1}.${i + 1}`, k, totalPresupuesto)).join('')
        : '<p class="text-muted" style="font-size:.8rem;padding:.4rem 0;">Sin líneas en este rubro.</p>';
      return rubroHtml + lineasHtml;
    }).join('');
  }

  resumen.innerHTML = `
    <div class="ap-resumen-row"><span>Costo total del Cómputo</span><span data-calc-valor="${costoComputo}">${fmtARS(costoComputo)}</span></div>
    <div class="ap-resumen-row"><span>Coeficiente K</span><span data-calc-valor="${k}">${fmtCoef(k)}</span></div>
    <div class="ap-resumen-row total"><span>Total del Presupuesto</span><span data-calc-valor="${totalPresupuesto}">${fmtARS(totalPresupuesto)}</span></div>
    <p class="form-hint" style="margin-top:.5rem;">K se recalcula en vivo a partir de Carga Fija — no se cachea.</p>`;
}

async function loadAll() {
  if (!obraKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta la obra (?obra=...).</p>';
    return;
  }
  const [obraData, lineasData, rubrosComputoData, itemsData, materialesData, equiposData, rolesData, cfgEquipos, cfgMO, cargaFijaLineasData, cargaFijaConfigData] = await Promise.all([
    _fbGet(`/obras/${obraKey}.json`),
    _fbGet(`/obras/${obraKey}/computo.json`),
    _fbGet(`/obras/${obraKey}/rubrosComputo.json`),
    _fbGet('/items.json'),
    _fbGet('/materiales.json'),
    _fbGet('/equipos.json'),
    _fbGet('/manoDeObra.json'),
    _fbGet('/config/equipos.json'),
    _fbGet('/config/manoDeObra.json'),
    _fbGet(`/obras/${obraKey}/cargaFija/lineas.json`),
    _fbGet(`/obras/${obraKey}/cargaFija/config.json`),
  ]);

  if (!obraData) {
    document.body.innerHTML = '<p style="padding:2rem;">No se encontró la obra.</p>';
    return;
  }
  obra = obraData;
  lineas = lineasData || {};
  rubros = Object.entries(rubrosComputoData || {}).map(([key, r]) => ({ key, ...r }));
  items = Object.entries(itemsData || {}).map(([key, it]) => ({ key, ...it }));
  materiales = Object.entries(materialesData || {}).map(([key, m]) => ({ key, ...m }));
  equipos = Object.entries(equiposData || {}).map(([key, e]) => ({ key, ...e }));
  roles = Object.entries(rolesData || {}).map(([key, r]) => ({ key, ...r }));
  if (cfgEquipos) paramsEquipos = { ...paramsEquipos, ...cfgEquipos };
  if (cfgMO) paramsMO = { ...paramsMO, ...cfgMO };
  preciosObra = window.resolverPreciosObra(materiales, obraKey);
  cargaFijaLineas = cargaFijaLineasData || {};
  if (cargaFijaConfigData) cargaFijaConfig = { ...cargaFijaConfig, ...cargaFijaConfigData };

  $('header-obra-nombre').textContent = 'Presupuesto — ' + obra.nombre;
  renderHeaderTabs(obraKey, 'presupuesto');
  renderTodo();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadAll();
  await getDolarSnapshot().catch(() => {});
  if (obra) renderTodo();
});
