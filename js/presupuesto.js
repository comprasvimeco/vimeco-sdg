/* VIMECO S.A. — Sistema de Gestión — Presupuesto de obra
   Pantalla de sólo lectura: aplica el Coeficiente K (Carga Fija) al costo
   unitario de cada línea del Cómputo (ya con precios de esa obra resueltos,
   ver js/calcCostos.js) para sacar el precio unitario, y totaliza. Nada se
   edita acá — cantidades y receta se editan en Cómputo, %Beneficio/
   %CostoFinanciero/%IVA/gastos fijos en Carga Fija.

   K = (1 + %GastosGenerales + %Beneficio) × (1 + %CostoFinanciero) × (1 + Σ%Impuestos)
   %GastosGenerales = (gastos fijos de la obra) / (costo total del Cómputo).

   La carga de datos y el armado del árbol rubro→línea viven en
   js/presupuestoDatos.js, compartidos con la exportación (js/exportar.js):
   lo que se imprime tiene que ser exactamente lo que se ve acá. */

const $ = id => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const obraKey = params.get('obra');

let modelo = null;

function renderLineaRow(linea) {
  // Etiqueta con la que se lee una referencia a esta línea desde una fórmula
  // (ver js/refs.js); la numeración la hace única.
  const et = `${linea.numero} ${linea.nombre || 'Ítem'}`;
  const id = `presupuesto:linea:${linea.key}`;
  return `
    <div class="presupuesto-linea">
      <span class="presupuesto-linea-numero">${linea.numero}</span>
      <span>${escHtml(linea.nombre)}</span>
      <span>${escHtml(linea.unidad)}</span>
      <span${calcAttrs(linea.cantidad, `${id}:cantidad`, `${et} · Cantidad`)}>${linea.cantidad != null ? fmtNum(linea.cantidad) : '—'}</span>
      <span class="presupuesto-linea-precio"${calcAttrs(linea.precioUnitario, `${id}:precioUnit`, `${et} · Precio unit.`)}>${fmtARS(linea.precioUnitario)}</span>
      <span class="presupuesto-linea-total"${calcAttrs(linea.total, `${id}:total`, `${et} · Total`)}>${fmtARS(linea.total)}</span>
      <span class="presupuesto-linea-incidencia"${calcAttrs(linea.incidencia != null ? linea.incidencia * 100 : null, `${id}:incidencia`, `${et} · Incidencia %`)}>${fmtPct(linea.incidencia)}</span>
    </div>`;
}

function renderTodo() {
  const container = $('lineas-presupuesto');
  const resumen = $('resumen');

  if (modelo.k == null) {
    container.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Esta obra todavía no tiene ítems cargados en el Cómputo — no se puede calcular el Presupuesto hasta que haya un costo de obra sobre el cual aplicar el Coeficiente K.</p>';
    resumen.innerHTML = '';
    return;
  }

  if (!modelo.rubros.length) {
    container.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Todavía no hay rubros cargados en el Cómputo de esta obra.</p>';
  } else {
    const header = `
      <div class="presupuesto-linea presupuesto-linea-header">
        <span></span><span>Ítem</span><span>Unidad</span><span>Cantidad</span><span>Precio unitario</span><span>Total</span><span>Incidencia</span>
      </div>`;
    container.innerHTML = header + modelo.rubros.map(rubro => {
      const et = `${rubro.numero}. ${rubro.nombre || 'Rubro'}`;
      const rubroHtml = `
        <div class="presupuesto-rubro-header">
          <span class="presupuesto-rubro-numero">${rubro.numero}.</span>
          <span class="presupuesto-rubro-nombre">${escHtml(rubro.nombre || '(sin nombre)')}</span>
          <span class="presupuesto-rubro-subtotal"${calcAttrs(rubro.subtotal, `presupuesto:rubro:${rubro.key}:subtotal`, `${et} · Subtotal`)}>${fmtARS(rubro.subtotal)}</span>
          <span class="presupuesto-rubro-incidencia"${calcAttrs(rubro.incidencia != null ? rubro.incidencia * 100 : null, `presupuesto:rubro:${rubro.key}:incidencia`, `${et} · Incidencia %`)}>${fmtPct(rubro.incidencia)}</span>
        </div>`;
      const lineasHtml = rubro.lineas.length
        ? rubro.lineas.map(renderLineaRow).join('')
        : '<p class="text-muted" style="font-size:.8rem;padding:.4rem 0;">Sin líneas en este rubro.</p>';
      return rubroHtml + lineasHtml;
    }).join('');
  }

  resumen.innerHTML = `
    <div class="ap-resumen-row"><span>Costo total del Cómputo</span><span${calcAttrs(modelo.costoComputo, 'presupuesto:costoComputo', 'Costo total del Cómputo')}>${fmtARS(modelo.costoComputo)}</span></div>
    <div class="ap-resumen-row"><span>Coeficiente K</span><span${calcAttrs(modelo.k, 'presupuesto:k', 'Coeficiente K')}>${fmtK(modelo.k)}</span></div>
    <div class="ap-resumen-row total"><span>Total del Presupuesto</span><span${calcAttrs(modelo.total, 'presupuesto:total', 'Total del Presupuesto')}>${fmtARS(modelo.total)}</span></div>
    <p class="form-hint" style="margin-top:.5rem;">K se recalcula en vivo a partir de Carga Fija — no se cachea.</p>`;
}

async function loadAll() {
  if (!obraKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta la obra (?obra=...).</p>';
    return;
  }
  modelo = await window.cargarPresupuestoObra(obraKey);
  if (!modelo) {
    document.body.innerHTML = '<p style="padding:2rem;">No se encontró la obra.</p>';
    return;
  }

  $('header-obra-nombre').textContent = 'Presupuesto — ' + modelo.obra.nombre;
  renderHeaderTabs(obraKey, 'presupuesto');
  renderTodo();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadAll();
  await getDolarSnapshot().catch(() => {});
  if (modelo) renderTodo();
});

window.onDecimalesVista(() => { if (modelo) renderTodo(); });
