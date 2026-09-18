/* VIMECO S.A. — Sistema de Gestión — Presupuesto de obra
   Pantalla de sólo lectura: aplica el Coeficiente K (Carga Fija) al costo
   unitario de cada línea del Cómputo (ya con precios de esa obra resueltos,
   ver js/calcCostos.js) para sacar el precio unitario, y totaliza. Nada se
   edita acá — cantidades y receta se editan en Cómputo, %Beneficio/
   %CostoFinanciero/%IVA/gastos fijos en Carga Fija. Única excepción: el
   precio unitario oficial de cada línea (toggle "Comparar con oficial"), que
   se carga acá mismo porque es sólo una anotación para comparar — no
   participa de ningún costeo ni total.

   K = (1 + %GastosGenerales + %Beneficio) × (1 + %CostoFinanciero) × (1 + Σ%Impuestos)
   %GastosGenerales = (gastos fijos de la obra) / (costo total del Cómputo).

   La carga de datos y el armado del árbol rubro→línea viven en
   js/presupuestoDatos.js, compartidos con la exportación (js/exportar.js):
   lo que se imprime tiene que ser exactamente lo que se ve acá. */

const $ = id => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const obraKey = params.get('obra');
// Con ?cierre= la pantalla no muestra el presupuesto vivo sino la foto de uno
// enviado: los mismos cálculos, pero sobre los datos congelados de ese cierre
// (ver js/cierreDatos.js). Todo queda en sólo lectura y sin enlaces a las
// pantallas vivas, que ya no se corresponden con lo que se está mirando.
const cierreKey = params.get('cierre');

let modelo = null;
let mostrarOficial = false;   // de sesión: nunca se guarda, arranca apagado

function renderLineaRow(linea) {
  // Etiqueta con la que se lee una referencia a esta línea desde una fórmula
  // (ver js/refs.js); la numeración la hace única.
  const et = `${linea.numero} ${linea.nombre || 'Ítem'}`;
  const id = `presupuesto:linea:${linea.key}`;
  const colOficial = mostrarOficial ? `
      <span class="presupuesto-linea-oficial"><input type="text" class="form-control cmp-oficial-input" data-linea-key="${escHtml(linea.key)}" placeholder="0" value="${linea.precioOficial != null ? escHtml(formatMoneyString(linea.precioOficial)) : ''}" data-calc-id="${id}:precioOficial" data-calc-label="${escHtml(et + ' · Precio oficial')}" ${window._soloLectura ? 'disabled' : ''}></span>
      <span class="presupuesto-linea-dif${claseDif(linea)}">${fmtDif(linea)}</span>` : '';
  // Mismo destino que el ícono de A.P. en Cómputo (js/computo.js): si la
  // línea ya está vinculada a un ítem va directo a su análisis, si no a
  // buscar/crear uno. Sin target="_blank" a propósito: acá se navega en la
  // misma pestaña.
  const hrefAP = linea.itemKey
    ? `item.html?key=${encodeURIComponent(linea.itemKey)}&obra=${encodeURIComponent(obraKey)}`
    : `item.html?linea=${encodeURIComponent(linea.key)}&obra=${encodeURIComponent(obraKey)}`;
  // Mirando un cierre, el A.P vivo puede no ser el que dio este precio: sin enlace.
  const celdaNombre = cierreKey
    ? `<span class="presupuesto-linea-nombre">${escHtml(linea.nombre)}</span>`
    : `<a class="presupuesto-linea-nombre" href="${hrefAP}" title="Ver Análisis de Precio">${escHtml(linea.nombre)}</a>`;
  return `
    <div class="presupuesto-linea">
      <span class="presupuesto-linea-numero">${linea.numero}</span>
      ${celdaNombre}
      <span class="presupuesto-linea-unidad">${escHtml(linea.unidad)}</span>
      <span class="presupuesto-linea-cantidad"${calcAttrs(linea.cantidad, `${id}:cantidad`, `${et} · Cantidad`)}>${linea.cantidad != null ? fmtNum(linea.cantidad) : '—'}</span>
      <span class="presupuesto-linea-precio"${calcAttrs(linea.precioUnitario, `${id}:precioUnit`, `${et} · Precio unit.`)}>${fmtARS(linea.precioUnitario)}</span>
      <span class="presupuesto-linea-total"${calcAttrs(linea.total, `${id}:total`, `${et} · Total`)}>${fmtARS(linea.total)}</span>
      <span class="presupuesto-linea-incidencia"${calcAttrs(linea.incidencia != null ? linea.incidencia * 100 : null, `${id}:incidencia`, `${et} · Incidencia %`)}>${fmtPct(linea.incidencia)}</span>${colOficial}
    </div>`;
}

// Diferencia del precio unitario propio contra el oficial cargado a mano en
// esta misma línea. Sólo se muestra el % (no el monto): es una comparación
// rápida, no otro número más para totalizar.
function difOficialPct(linea) {
  if (linea.precioOficial == null || !linea.precioOficial || linea.precioUnitario == null) return null;
  return (linea.precioUnitario - linea.precioOficial) / linea.precioOficial;
}
function fmtDif(linea) {
  const pct = difOficialPct(linea);
  return pct == null ? '—' : fmtPct(pct);
}
function claseDif(linea) {
  const pct = difOficialPct(linea);
  if (pct == null) return '';
  return pct > 0 ? ' dif-pos' : pct < 0 ? ' dif-neg' : '';
}

function lineaPorKey(key) {
  for (const rubro of modelo.rubros) {
    const l = rubro.lineas.find(l => l.key === key);
    if (l) return l;
  }
  return null;
}

// Engancha los inputs de precio oficial recién pintados: calculadora
// flotante, máscara de miles y guardado en blur — mismo patrón que el campo
// "Presupuesto oficial" de Datos de obra (js/datos-obra.js).
function engancharInputsOficial(container) {
  container.querySelectorAll('.cmp-oficial-input').forEach(input => {
    attachCalcInput(input);
    attachMoneyInput(input);
    input.addEventListener('blur', async () => {
      if (guardBloqueoObra()) return;
      const lineaKey = input.dataset.lineaKey;
      const n = parseMoneyString(input.value);
      const precioOficial = isNaN(n) ? null : n;
      try {
        await _fbPatch(`/obras/${obraKey}/computo/${lineaKey}.json`, { precioOficial });
        const linea = lineaPorKey(lineaKey);
        if (linea) linea.precioOficial = precioOficial;
        renderTodo();
      } catch (_) {
        showToast('Error al guardar el precio oficial.', 'error');
      }
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  });
}

function renderComparacionOficial() {
  const cmp = $('comparacion-oficial');
  const oficial = modelo.obra.presupuestoOficial;

  if (oficial == null || isNaN(oficial)) {
    cmp.innerHTML = '<p class="text-muted" style="font-size:.85rem;">No se cargó un presupuesto oficial para esta obra — se carga en Datos de obra.</p>';
    return;
  }
  if (modelo.total == null) {
    cmp.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Todavía no se puede calcular el Presupuesto propio para compararlo.</p>';
    return;
  }

  const diferencia = modelo.total - oficial;
  const diferenciaPct = oficial ? diferencia / oficial : null;

  cmp.innerHTML = `
    <div class="ap-resumen-row"><span>Presupuesto oficial</span><span${calcAttrs(oficial, 'presupuesto:oficial', 'Presupuesto oficial')}>${fmtARS(oficial)}</span></div>
    <div class="ap-resumen-row"><span>Total del Presupuesto (propio)</span><span${calcAttrs(modelo.total, 'presupuesto:totalPropio', 'Total del Presupuesto (propio)')}>${fmtARS(modelo.total)}</span></div>
    <div class="ap-resumen-row total"><span>Diferencia</span><span${calcAttrs(diferencia, 'presupuesto:diferenciaOficial', 'Diferencia con el presupuesto oficial')}>${fmtARS(diferencia)} (${fmtPct(diferenciaPct)})</span></div>`;
}

function renderTodo() {
  const container = $('lineas-presupuesto');
  const resumen = $('resumen');
  const cmp = $('comparacion-oficial');

  if (modelo.k == null) {
    container.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Esta obra todavía no tiene ítems cargados en el Cómputo — no se puede calcular el Presupuesto hasta que haya un costo de obra sobre el cual aplicar la Carga Fija.</p>';
    resumen.innerHTML = '';
    cmp.innerHTML = '';
    return;
  }

  container.classList.toggle('cmp-oficial', mostrarOficial);
  const colOficialHeader = mostrarOficial ? '<span>Oficial</span><span>Dif. %</span>' : '';
  const header = `
      <div class="presupuesto-linea presupuesto-linea-header">
        <span></span><span>Ítem</span><span>Unidad</span><span>Cantidad</span><span>Precio unitario</span><span>Total</span><span>Incidencia</span>${colOficialHeader}
      </div>`;

  if (!modelo.rubros.length) {
    container.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Todavía no hay rubros cargados en el Cómputo de esta obra.</p>';
  } else if (modelo.numeracion.sinRubros) {
    // Obra sin rubros: una sola lista corrida, sin cabeceras de rubro.
    container.innerHTML = header + modelo.rubros
      .flatMap(rubro => rubro.lineas)
      .map(renderLineaRow).join('');
  } else {
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

  if (mostrarOficial) engancharInputsOficial(container);

  resumen.innerHTML = `
    <div class="ap-resumen-row"><span>Costo total del Cómputo</span><span${calcAttrs(modelo.costoComputo, 'presupuesto:costoComputo', 'Costo total del Cómputo')}>${fmtARS(modelo.costoComputo)}</span></div>
    <div class="ap-resumen-row"><span>Carga Fija</span><span${calcAttrs(modelo.k, 'presupuesto:k', 'Carga Fija')}>${fmtK(modelo.k)}</span></div>
    <div class="ap-resumen-row total"><span>Total del Presupuesto</span><span${calcAttrs(modelo.total, 'presupuesto:total', 'Total del Presupuesto')}>${fmtARS(modelo.total)}</span></div>
    <p class="form-hint" style="margin-top:.5rem;">${cierreKey
      ? 'Estos números salen de los datos congelados al cerrar: no los mueve ningún cambio posterior, ni de esta obra ni del catálogo.'
      : 'La Carga Fija se recalcula en vivo a partir de su pantalla — no se cachea.'}</p>`;

  renderComparacionOficial();
}

/* Un presupuesto cerrado: se reconstruye desde su foto y se verifica que siga
   dando lo que dio el día que se cerró. Si no —sólo puede pasar si cambiaron
   las fórmulas— igual se muestra, con la banda en rojo: el número que vale es
   el que quedó registrado en el cierre. */
async function loadCierre() {
  const cierre = await _fbGet(`/obras/${obraKey}/cierres/${cierreKey}.json`);
  if (!cierre || !cierre.datos) {
    document.body.innerHTML = '<p style="padding:2rem;">No se encontró el cierre.</p>';
    return false;
  }
  const res = await window.abrirCierre(obraKey, cierre);
  if (!res) {
    document.body.innerHTML = '<p style="padding:2rem;">No se pudo reconstruir el presupuesto de este cierre.</p>';
    return false;
  }
  modelo = res.modelo;
  // Sólo lectura sin botón de desbloqueo: un cierre no se edita, ni temporalmente.
  window._soloLectura = true;
  const btnModo = document.getElementById('header-modo');
  if (btnModo) btnModo.classList.add('hidden');

  $('header-obra-nombre').textContent = 'Presupuesto — ' + modelo.obra.nombre;
  renderHeaderTabs(obraKey, 'presupuesto', { cierreKey });
  const guardado = (cierre.resultado || {}).total;
  renderBandaCierre(obraKey, cierreKey, cierre.meta || {}, res.difs,
    guardado != null ? `total cerrado ${fmtARS(guardado)}` : null);
  return true;
}

async function loadAll() {
  if (!obraKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta la obra (?obra=...).</p>';
    return;
  }
  if (cierreKey) {
    const ok = await loadCierre();
    if (!ok) return;
  } else {
    modelo = await window.cargarPresupuestoObra(obraKey);
    if (!modelo) {
      document.body.innerHTML = '<p style="padding:2rem;">No se encontró la obra.</p>';
      return;
    }
    $('header-obra-nombre').textContent = 'Presupuesto — ' + modelo.obra.nombre;
    renderHeaderTabs(obraKey, 'presupuesto');
    setModoObra(obraKey, modelo.obra, renderTodo);
  }
  renderTodo();

  $('btn-toggle-oficial').addEventListener('click', () => {
    mostrarOficial = !mostrarOficial;
    $('btn-toggle-oficial').textContent = mostrarOficial ? 'Ocultar comparación con oficial' : 'Comparar con oficial';
    renderTodo();
  });

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadAll();
  await getDolarSnapshot().catch(() => {});
  if (modelo) renderTodo();
});

window.onDecimalesVista(() => { if (modelo) renderTodo(); });

/* Esta pantalla no escucha la base en tiempo real: después de un Ctrl+Z
   (js/undo.js) vuelve a pedir los datos y se repinta. */
window.registrarRecargaUndo(loadAll);
