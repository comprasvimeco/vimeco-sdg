/* VIMECO S.A. — Sistema de Gestión — Insumos de la obra (materiales, equipos y mano de obra)
   Pantalla de sólo lectura: consolida, para toda la obra, qué insumos hacen
   falta — recorriendo cada línea del Cómputo (cantidad × ítem) y, dentro de
   la receta de ese ítem, sus líneas. Un mismo insumo usado en varias líneas
   de Cómputo (de cualquier rubro) se suma en una sola fila. Líneas de
   Cómputo sin ítem vinculado (texto libre, sin receta) no aportan insumos y
   no aparecen acá.

   Materiales: la cantidad de la receta es por unidad de ítem, no se divide
   por rendimiento (mismo criterio que calcCostoUnitarioItem en
   calcCostos.js). Sirve como base de pedido de compra/acopio.

   Equipos: la cantidad de la receta es "cuántas máquinas" y su costo es por
   día, dividido por el rendimiento — así que lo que se consolida son
   días-equipo: cantidad del Cómputo × cantidad de la receta ÷ rendimiento.
   Es exactamente lo que alimenta el costo de equipos del AP, y el costo
   estimado sale de esos días × el costo diario del equipo en esta obra
   (parámetros y dólar propios de la obra, pestaña Datos).

   Mano de obra: mismo criterio que Equipos pero por categoría (rol) — la
   cantidad de la receta es "cuántos trabajadores por jornada", se consolidan
   días-hombre (cantidad del Cómputo × cantidad de la receta ÷ rendimiento) y
   el costo estimado sale de esos días × el jornal del rol en esta obra
   (roles y parámetros propios de la obra, pestaña Mano de Obra). No incluye
   el adicional de Seguridad y Capataz (ese es un ajuste por AP, no por
   categoría). */

const $ = id => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const obraKey = params.get('obra');

let obra = null;
let lineas = {};   // { lineaKey: { rubroId, nombre, unidad, cantidad, itemKey, orden } }
let items = [];
let materiales = [];
let equipos = [];
let roles = [];
let preciosObra = {};
let paramsEquipos = { tasaInteresPct: 10, reparacionesPct: 75, lubricantesPct: 50, combustibleLtsPorHp: 0.1, precioCombustibleLitro: 0 };
let paramsMO = {
  asistenciaPct: 20, cargasPct: 100, diasMes: 22, jornadaHoras: 8,
  seguridadCapatazActivo: false, seguridadCapatazPct: 0,
  comidaActivo: false, comidaMonto: 0,
};
let dolarObra = null;
let ordenPorCosto = false;   // false: orden natural de cada tabla (nombre/código/orden); true: costo estimado, mayor a menor

function versionDe(it) {
  const propia = it.versionesObra && it.versionesObra[obraKey];
  return propia || it;
}

function precioUnitarioMaterial(mat) {
  const precio = preciosObra[mat.key];
  if (!precio) return null;
  // El precio en pesos cargado es la fuente de verdad; el dólar es sólo
  // ayuda de cálculo. Se reconvierte desde USD sólo si el material no
  // tiene precioARS guardado (datos viejos, antes del campo dual).
  if (precio.precioARS != null) return precio.precioARS;
  const venta = window.dolarOficialVenta();
  if (!precio.precioUSD || !venta) return null;
  return precio.precioUSD * venta;
}

/* Recorre el Cómputo y consolida las líneas de receta de un tipo
   ('material' | 'equipo') sobre su catálogo. `cantidadDe` traduce una línea
   de receta a la magnitud que se consolida (unidades para materiales,
   días-equipo para equipos). Devuelve
   { entidadKey: { entidad, cantidadTotal, usados: [{ nombre, cantidad }] } }
   ordenado por nombre. */
function consolidar(tipo, catalogo, cantidadDe) {
  const mapa = {};
  Object.values(lineas).forEach(linea => {
    if (!linea.itemKey || linea.cantidad == null || isNaN(linea.cantidad)) return;
    const item = items.find(i => i.key === linea.itemKey);
    if (!item) return;
    const version = versionDe(item);
    if (!version.lineas) return;
    Object.values(version.lineas).forEach(rl => {
      if (rl.tipo !== tipo || rl.cantidad == null || isNaN(rl.cantidad)) return;
      const entidad = catalogo.find(c => c.key === rl.refKey);
      if (!entidad) return;
      const cantidadNecesaria = cantidadDe(linea, rl, version);
      if (!mapa[entidad.key]) mapa[entidad.key] = { entidad, cantidadTotal: 0, usados: [] };
      mapa[entidad.key].cantidadTotal += cantidadNecesaria;
      mapa[entidad.key].usados.push({ nombre: linea.nombre || '(sin nombre)', cantidad: cantidadNecesaria });
    });
  });
  return Object.values(mapa);
}

function calcularMateriales() {
  return consolidar('material', materiales, (linea, rl) => linea.cantidad * rl.cantidad)
    .sort((a, b) => a.entidad.nombre.localeCompare(b.entidad.nombre, 'es'));
}

function calcularEquipos() {
  return consolidar('equipo', equipos, (linea, rl, version) =>
    linea.cantidad * rl.cantidad / (version.rendimiento || 1))
    .sort((a, b) => (a.entidad.codigo || '').localeCompare(b.entidad.codigo || '', 'es'));
}

function calcularManoDeObra() {
  return consolidar('manoDeObra', roles, (linea, rl, version) =>
    linea.cantidad * rl.cantidad / (version.rendimiento || 1))
    .sort((a, b) => (a.entidad.orden || 0) - (b.entidad.orden || 0));
}

function nombreEquipo(e) {
  return [e.tipo || '', e.codigo || ''].filter(Boolean).join(' · ') || '(sin nombre)';
}

/* Pinta una de las dos tablas. `cols` describe cada grupo consolidado:
   { nombre, unidad, costoUnitario (null si no se puede calcular) }. */
function renderTabla(containerId, resumenId, grupos, opts) {
  const container = $(containerId);
  const resumen = $(resumenId);

  if (!grupos.length) {
    container.innerHTML = `<p class="text-muted" style="font-size:.85rem;">${opts.vacio}</p>`;
    resumen.innerHTML = '';
    return;
  }

  const header = `
    <div class="materiales-linea materiales-linea-header">
      <span>${opts.colNombre}</span><span>Unidad</span><span>${opts.colCantidad}</span><span>Usado en</span><span>Costo estimado</span>
    </div>`;

  let costoTotalObra = 0;
  let faltaPrecio = false;

  // El costo de cada fila hace falta antes de pintar (para poder ordenar por
  // él si está activo "Ordenar por costo"), así que se calcula todo primero
  // y recién después se arma el HTML — sin duplicar la cuenta.
  const conCosto = grupos.map(g => {
    const datos = opts.datosDe(g);
    let costo = null;
    if (datos.costoUnitario != null) {
      costo = datos.costoUnitario * g.cantidadTotal;
    } else {
      faltaPrecio = true;
    }
    return { g, datos, costo };
  });

  if (ordenPorCosto) conCosto.sort((a, b) => (b.costo || 0) - (a.costo || 0));

  const filas = conCosto.map(({ g, datos, costo }) => {
    if (costo != null) costoTotalObra += costo;
    const costoStr = costo != null ? fmtARS(costo) : '—';
    const usadosTexto = g.usados.map(u => u.nombre).join(', ');
    const usadosTitle = g.usados
      .map(u => `${u.nombre}: ${fmtNum(u.cantidad)} ${datos.unidad}`)
      .join('\n');
    return `
      <div class="materiales-linea">
        <span>${escHtml(datos.nombre)}</span>
        <span>${escHtml(datos.unidad)}</span>
        <span class="materiales-cantidad"${calcAttrs(g.cantidadTotal, `${opts.calcNs}:${g.entidad.key}:cantidad`, `${datos.nombre} · ${opts.colCantidad}`)}>${fmtNum(g.cantidadTotal)}</span>
        <span class="materiales-usados" title="${escHtml(usadosTitle)}">${escHtml(usadosTexto)}</span>
        <span class="materiales-costo"${costo != null ? calcAttrs(costo, `${opts.calcNs}:${g.entidad.key}:costo`, `${datos.nombre} · Costo`) : ''}>${costoStr}</span>
      </div>`;
  }).join('');

  container.innerHTML = header + filas;

  resumen.innerHTML = `
    <div class="ap-resumen-row total"><span>${opts.labelTotal}</span><span${calcAttrs(costoTotalObra, `${opts.calcNs}:total`, opts.labelTotal)}>${fmtARS(costoTotalObra)}</span></div>
    ${faltaPrecio ? `<p class="form-hint" style="margin-top:.5rem;">${opts.avisoSinPrecio}</p>` : ''}`;
}

function renderTodo() {
  renderTabla('lineas-materiales', 'resumen', calcularMateriales(), {
    calcNs: 'materiales',
    colNombre: 'Material',
    colCantidad: 'Cantidad necesaria',
    labelTotal: 'Costo total estimado de materiales',
    vacio: 'Todavía no hay materiales para mostrar — cargá líneas en el Cómputo vinculadas a un ítem con receta de materiales.',
    avisoSinPrecio: 'Algunos materiales no tienen precio cargado para esta obra — no se incluyen en el costo total.',
    datosDe: g => ({
      nombre: g.entidad.nombre,
      unidad: g.entidad.unidad || '',
      costoUnitario: precioUnitarioMaterial(g.entidad),
    }),
  });

  renderTabla('lineas-equipos', 'resumen-equipos', calcularEquipos(), {
    calcNs: 'equipos',
    colNombre: 'Equipo',
    colCantidad: 'Días de uso',
    labelTotal: 'Costo total estimado de equipos',
    vacio: 'Todavía no hay equipos para mostrar — cargá líneas en el Cómputo vinculadas a un ítem con equipos en su receta.',
    avisoSinPrecio: 'Algunos equipos no tienen costo calculable en esta obra (falta costo, vida útil, uso anual o el dólar de la obra) — no se incluyen en el costo total.',
    datosDe: g => ({
      nombre: nombreEquipo(g.entidad),
      unidad: 'día',
      costoUnitario: window.calcCostoDiarioEquipo(g.entidad, paramsEquipos, paramsMO.jornadaHoras, dolarObra),
    }),
  });

  renderTabla('lineas-mano-de-obra', 'resumen-mano-de-obra', calcularManoDeObra(), {
    calcNs: 'manoDeObra',
    colNombre: 'Categoría',
    colCantidad: 'Días necesarios',
    labelTotal: 'Costo total estimado de mano de obra',
    vacio: 'Todavía no hay mano de obra para mostrar — cargá líneas en el Cómputo vinculadas a un ítem con mano de obra en su receta.',
    avisoSinPrecio: 'Algunas categorías no tienen básico cargado en Mano de Obra de esta obra — no se incluyen en el costo total.',
    datosDe: g => ({
      nombre: g.entidad.nombre,
      unidad: 'día',
      costoUnitario: g.entidad.basico ? window.calcCostoManoDeObra(g.entidad, paramsMO).costoJornal : null,
    }),
  });
}

async function loadAll() {
  if (!obraKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta la obra (?obra=...).</p>';
    return;
  }
  const [obraData, lineasData, itemsData, materialesData, equiposData, rolesData] = await Promise.all([
    _fbGet(`/obras/${obraKey}.json`),
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
  items = Object.entries(itemsData || {}).map(([key, it]) => ({ key, ...it }));
  materiales = Object.entries(materialesData || {}).map(([key, m]) => ({ key, ...m }));
  equipos = Object.entries(equiposData || {}).map(([key, e]) => ({ key, ...e }));
  roles = Object.entries(rolesData || {}).map(([key, r]) => ({ key, ...r }));
  preciosObra = window.resolverPreciosObra(materiales, obraKey);
  paramsEquipos = { ...paramsEquipos, ...(obra.paramsEquipos || {}) };
  paramsMO = { ...paramsMO, ...(obra.paramsMO || {}) };
  dolarObra = obra.dolar ? obra.dolar.valor : null;
  window.setCotizacionObra(dolarObra);

  $('header-obra-nombre').textContent = 'Insumos — ' + obra.nombre;
  renderHeaderTabs(obraKey, 'insumos');
  renderTodo();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  $('chk-orden-costo').addEventListener('change', e => {
    ordenPorCosto = e.target.checked;
    if (obra) renderTodo();
  });
  await loadAll();
  await getDolarSnapshot().catch(() => {});
  if (obra) renderTodo();
});

window.onDecimalesVista(() => { if (obra) renderTodo(); });
