/* VIMECO S.A. — Sistema de Gestión — Materiales necesarios de la obra
   Pantalla de sólo lectura: consolida, para toda la obra, cuánto de cada
   material hace falta — recorriendo cada línea del Cómputo (cantidad ×
   ítem) y, dentro de la receta de ese ítem, sus líneas de material
   (cantidad por unidad de ítem, no se divide por rendimiento — mismo
   criterio que calcCostoUnitarioItem en calcCostos.js). Un mismo material
   usado en varias líneas de Cómputo (de cualquier rubro) se suma en una
   sola fila. Líneas de Cómputo sin ítem vinculado (texto libre, sin
   receta) no aportan materiales y no aparecen acá.

   No incluye líneas de tipo 'equipo' de la receta — sólo materiales, para
   que esta pantalla sirva como base de pedido de compra/acopio. */

const $ = id => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const obraKey = params.get('obra');

let obra = null;
let lineas = {};   // { lineaKey: { rubroId, nombre, unidad, cantidad, itemKey, orden } }
let items = [];
let materiales = [];
let preciosObra = {};

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

// { materialKey: { material, cantidadTotal, usados: [{ nombre, cantidad }] } }
function calcularMateriales() {
  const mapa = {};
  Object.values(lineas).forEach(linea => {
    if (!linea.itemKey || linea.cantidad == null || isNaN(linea.cantidad)) return;
    const item = items.find(i => i.key === linea.itemKey);
    if (!item) return;
    const version = versionDe(item);
    if (!version.lineas) return;
    Object.values(version.lineas).forEach(rl => {
      if (rl.tipo !== 'material' || rl.cantidad == null || isNaN(rl.cantidad)) return;
      const mat = materiales.find(m => m.key === rl.refKey);
      if (!mat) return;
      const cantidadNecesaria = linea.cantidad * rl.cantidad;
      if (!mapa[mat.key]) mapa[mat.key] = { material: mat, cantidadTotal: 0, usados: [] };
      mapa[mat.key].cantidadTotal += cantidadNecesaria;
      mapa[mat.key].usados.push({ nombre: linea.nombre || '(sin nombre)', cantidad: cantidadNecesaria });
    });
  });
  return Object.values(mapa).sort((a, b) => a.material.nombre.localeCompare(b.material.nombre, 'es'));
}

function renderTodo() {
  const container = $('lineas-materiales');
  const resumen = $('resumen');
  const grupos = calcularMateriales();

  if (!grupos.length) {
    container.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Todavía no hay materiales para mostrar — cargá líneas en el Cómputo vinculadas a un ítem con receta de materiales.</p>';
    resumen.innerHTML = '';
    return;
  }

  const header = `
    <div class="materiales-linea materiales-linea-header">
      <span>Material</span><span>Unidad</span><span>Cantidad necesaria</span><span>Usado en</span><span>Costo estimado</span>
    </div>`;

  let costoTotalObra = 0;
  let faltaPrecio = false;

  const filas = grupos.map(g => {
    const precioUnitario = precioUnitarioMaterial(g.material);
    let costoStr = '—';
    if (precioUnitario != null) {
      const costo = precioUnitario * g.cantidadTotal;
      costoTotalObra += costo;
      costoStr = fmtARS(costo);
    } else {
      faltaPrecio = true;
    }
    const usadosTexto = g.usados.map(u => u.nombre).join(', ');
    const usadosTitle = g.usados
      .map(u => `${u.nombre}: ${fmtNum(u.cantidad)} ${g.material.unidad || ''}`)
      .join('\n');
    return `
      <div class="materiales-linea">
        <span>${escHtml(g.material.nombre)}</span>
        <span>${escHtml(g.material.unidad || '')}</span>
        <span class="materiales-cantidad" data-calc-valor="${g.cantidadTotal}">${fmtNum(g.cantidadTotal)}</span>
        <span class="materiales-usados" title="${escHtml(usadosTitle)}">${escHtml(usadosTexto)}</span>
        <span class="materiales-costo"${precioUnitario != null ? ` data-calc-valor="${precioUnitario * g.cantidadTotal}"` : ''}>${costoStr}</span>
      </div>`;
  }).join('');

  container.innerHTML = header + filas;

  resumen.innerHTML = `
    <div class="ap-resumen-row total"><span>Costo total estimado de materiales</span><span data-calc-valor="${costoTotalObra}">${fmtARS(costoTotalObra)}</span></div>
    ${faltaPrecio ? '<p class="form-hint" style="margin-top:.5rem;">Algunos materiales no tienen precio cargado para esta obra — no se incluyen en el costo total.</p>' : ''}`;
}

async function loadAll() {
  if (!obraKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta la obra (?obra=...).</p>';
    return;
  }
  const [obraData, lineasData, itemsData, materialesData] = await Promise.all([
    _fbGet(`/obras/${obraKey}.json`),
    _fbGet(`/obras/${obraKey}/computo.json`),
    _fbGet('/items.json'),
    _fbGet('/materiales.json'),
  ]);

  if (!obraData) {
    document.body.innerHTML = '<p style="padding:2rem;">No se encontró la obra.</p>';
    return;
  }
  obra = obraData;
  lineas = lineasData || {};
  items = Object.entries(itemsData || {}).map(([key, it]) => ({ key, ...it }));
  materiales = Object.entries(materialesData || {}).map(([key, m]) => ({ key, ...m }));
  preciosObra = window.resolverPreciosObra(materiales, obraKey);

  $('header-obra-nombre').textContent = 'Materiales — ' + obra.nombre;
  renderHeaderTabs(obraKey, 'materiales');
  renderTodo();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadAll();
  await getDolarSnapshot().catch(() => {});
  if (obra) renderTodo();
});

window.onDecimalesVista(() => { if (obra) renderTodo(); });
