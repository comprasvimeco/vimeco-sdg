/* VIMECO S.A. — Sistema de Gestión — Plan de Avance, Curva de Inversión y Remanentes
   Réplica de la hoja "Plan de trabajos" de CyP Taller Río Cuarto.xlsx.

   Esta pantalla edita la distribución del avance por período (semanas o meses);
   el cálculo de certificaciones y remanentes y el dibujo de los dos gráficos
   viven en js/planAvanceDatos.js, compartidos con la exportación a PDF — la
   curva impresa es la misma función que dibuja ésta, no una copia parecida.

   Los precios salen del Presupuesto (costo unitario × Coeficiente K de Carga
   Fija), igual que la columna PRECIO ITEM de la planilla.

   Se puede cargar el avance a nivel Ítem o a nivel Rubro (config.modo). En
   modo Rubro los ítems heredan la distribución de su rubro y sólo se muestran
   los valores derivados. */

const $ = id => document.getElementById(id);

const params = new URLSearchParams(window.location.search);
const obraKey = params.get('obra');

let obra = null;
let rubros = [];   // [{ key, nombre, orden }]
let lineas = {};   // { lineaKey: { rubroId, nombre, unidad, cantidad, itemKey, orden } }
let items = [];
let materiales = [];
let equipos = [];
let roles = [];
let paramsEquipos = { tasaInteresPct: 10, reparacionesPct: 75, lubricantesPct: 50, combustibleLtsPorHp: 0.1, precioCombustibleLitro: 0 };
let paramsMO = { asistenciaPct: 20, cargasPct: 100, diasMes: 22, jornadaHoras: 8 };
let preciosObra = {};
let dolarObra = null;
let cargaFijaLineas = {};
let cargaFijaConfig = { beneficioPct: null, costoFinancieroPct: null };

let config = { modo: 'items', unidad: 'semana', cantidad: 12, fechaInicio: '', anticipoPct: null };
let distItems = {};    // { lineaKey: { p0: fracción, p1: … } }
let distRubros = {};   // { rubroKey: { p0: fracción, … } }
let verObra = false;   // mostrar la fila "% en Obra" de cada ítem
let verCant = false;   // mostrar la fila "% en Cant." de cada ítem

const MAX_PERIODOS = window.PLAN_MAX_PERIODOS;

/* ===== Precios (mismo cálculo que el Presupuesto) ===== */

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
  return window.calcCostoUnitarioItem(version, version.lineas, catalogos, paramsEquipos, paramsMO, preciosObra, dolarObra).costoUnitario;
}

function cantidadDe(linea) {
  return linea.cantidad != null && !isNaN(linea.cantidad) ? linea.cantidad : 0;
}

function costoTotalComputo() {
  return Object.values(lineas).reduce((acc, l) => acc + costoUnitarioDe(l.itemKey) * cantidadDe(l), 0);
}

// La fórmula del K vive en calcCostos.js (calcCoeficienteK), compartida con
// Carga Fija, Presupuesto y el AP — acá sólo se usa el resultado.
function calcularK(costoComputo) {
  const gastosFijos = window.totalGastosFijosCargaFija(cargaFijaLineas, costoComputo, obra ? obra.presupuestoOficial : null);
  return window.calcCoeficienteK(cargaFijaConfig, gastosFijos, costoComputo).k;
}

/* ===== Períodos ===== */

function cantidadPeriodos() { return window.cantidadPeriodosPlan(config); }

function pk(i) { return window.pkPeriodo(i); }

function fechaPeriodo(i) { return window.fechaPeriodoPlan(config, i); }

function etiquetaPeriodo(i) {
  const nro = `${i + 1}°`;
  const d = fechaPeriodo(i);
  const fecha = d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}` : '';
  return { nro, fecha };
}

function nombreUnidad() { return window.nombreUnidadPlan(config); }

/* ===== Modelo de la grilla ===== */

function lineasDeRubro(rubroId) {
  return Object.entries(lineas)
    .filter(([, l]) => l.rubroId === rubroId)
    .sort((a, b) => (a[1].orden || 0) - (b[1].orden || 0));
}

// Devuelve toda la estructura ya calculada: rubros con sus líneas, precios,
// incidencias, distribución por período y las filas de totales.
function construirDatos() {
  const costoComputo = costoTotalComputo();
  const k = calcularK(costoComputo);
  if (k == null) return null;

  rubros.sort((a, b) => (a.orden || 0) - (b.orden || 0));

  // La numeración sale de js/numeracion.js, igual que en el Cómputo y en el
  // Presupuesto: la grilla y el cronograma impreso muestran el mismo número.
  const num = window.numerarComputo(obra, rubros, lineas);

  const gruposRubro = rubros.map(r => {
    const grupo = lineasDeRubro(r.key).map(([lineaKey, l]) => ({
      key: lineaKey,
      numero: num.codigoDeLinea[lineaKey],
      linea: l,
      cantidad: cantidadDe(l),
      precioUnitario: costoUnitarioDe(l.itemKey) * k,
      precioTotal: costoUnitarioDe(l.itemKey) * k * cantidadDe(l),
    }));
    return {
      rubro: r,
      numero: num.codigoDeRubro[r.key],
      lineas: grupo,
      precioTotal: grupo.reduce((a, x) => a + x.precioTotal, 0),
    };
  });

  // El reparto por período, las certificaciones y los remanentes salen de
  // js/planAvanceDatos.js — la misma función que usa la exportación a PDF.
  return Object.assign(
    window.calcPlanAvance(gruposRubro, config, distItems, distRubros),
    { k, costoComputo });
}

/* ===== Formato ===== */

// El remanente del último período da un residuo de coma flotante (ej. −5e-7)
// que se mostraría como "-$ 0,00": por debajo de medio centavo es cero.
function limpiarCero(n) {
  return Math.abs(n) < 0.005 ? 0 : n;
}

// Cantidad dentro de la grilla: el 0 se muestra vacío — una celda en blanco
// se lee mejor que un "0,00" en una tabla de 30 columnas. Los porcentajes y
// los montos usan los formateadores compartidos (fmtPct / fmtARS), que
// siguen los decimales elegidos en el header.
function fmtCantGrilla(n) {
  return n == null || isNaN(n) || n === 0 ? '' : fmtNum(n);
}

// Valor de una celda editable: fracción → número de porcentaje sin ceros de más.
function pctInputValue(frac) {
  if (!frac) return '';
  const v = window.roundLimpio(frac * 100);
  return String(v).replace('.', ',');
}

/* ===== Render de la grilla ===== */

// Atributo que engancha la calculadora flotante (js/calculadora-flotante.js):
// clickear el número lo inserta en la fórmula. Se pone SÓLO cuando hay un
// valor real — si no, la grilla entera quedaría llena de celdas vacías
// resaltadas al abrir la calculadora. Los porcentajes se exponen como el
// número que se ve en pantalla (25, no 0.25), igual que en presupuesto.js.
function attrCalc(n) {
  return n == null || isNaN(n) || n === 0 ? '' : ` data-calc-valor="${n}"`;
}

function celdaEditable(scope, rowKey, i, frac) {
  return `<td class="pa-celda"><input type="text" class="pa-input" data-scope="${scope}" data-row="${escHtml(rowKey)}" data-p="${i}" value="${pctInputValue(frac)}"${attrCalc(frac ? window.roundLimpio(frac * 100) : null)} inputmode="decimal"></td>`;
}

function celdaDerivada(valor, clase, num) {
  return `<td class="pa-celda ${clase || ''}"${attrCalc(num)}>${escHtml(valor)}</td>`;
}

function filaSumaClase(suma) {
  if (!suma) return 'pa-suma-vacia';
  return Math.abs(suma - 1) < 0.0001 ? 'pa-suma-ok' : 'pa-suma-mal';
}

function renderTabla(d) {
  const n = d.n;
  const modoRubros = config.modo === 'rubros';

  const thPeriodos = [];
  for (let i = 0; i < n; i++) {
    const { nro, fecha } = etiquetaPeriodo(i);
    thPeriodos.push(`<th class="pa-th-periodo"><span class="pa-th-nro">${nro}</span>${fecha ? `<span class="pa-th-fecha">${fecha}</span>` : ''}</th>`);
  }

  const head = `
    <thead>
      <tr>
        <th class="pa-col-nombre">${nombreUnidad() === 'Mes' ? 'Ítem / Rubro' : 'Ítem / Rubro'}</th>
        <th class="pa-col-un">Un.</th>
        <th class="pa-col-num">Cant.</th>
        <th class="pa-col-monto">Precio</th>
        <th class="pa-col-num">Incid.</th>
        <th class="pa-col-num">Σ</th>
        ${thPeriodos.join('')}
      </tr>
    </thead>`;

  const cuerpo = d.gruposRubro.map(g => {
    const celdasRubro = [];
    for (let i = 0; i < n; i++) {
      celdasRubro.push(modoRubros
        ? celdaEditable('rubro', g.rubro.key, i, g.pctItem[i])
        : celdaDerivada(g.pctObra[i] ? fmtPct(g.pctObra[i]) : '', 'pa-derivada', g.pctObra[i] * 100));
    }
    const claseSuma = filaSumaClase(g.sumaRubro);

    const filaRubro = `
      <tr class="pa-fila-rubro">
        <td class="pa-col-nombre">
          <span class="pa-rubro-numero">${escHtml(g.numero)}.</span>
          <span class="pa-rubro-nombre">${escHtml(g.rubro.nombre || '(sin nombre)')}</span>
          ${modoRubros ? `<button class="pa-btn-distribuir" data-scope="rubro" data-row="${escHtml(g.rubro.key)}" title="Distribuir parejo">${icSvg('sheet')}</button>` : ''}
        </td>
        <td class="pa-col-un"></td>
        <td class="pa-col-num"></td>
        <td class="pa-col-monto"${attrCalc(g.precioTotal)}>${fmtARS(g.precioTotal)}</td>
        <td class="pa-col-num"${attrCalc(g.incidencia * 100)}>${fmtPct(g.incidencia)}</td>
        <td class="pa-col-num ${claseSuma}"${attrCalc(g.sumaRubro * 100)}>${fmtPct(g.sumaRubro)}</td>
        ${celdasRubro.join('')}
      </tr>`;

    const filasItems = g.lineas.map(x => {
      const celdas = [];
      for (let i = 0; i < n; i++) {
        celdas.push(modoRubros
          ? celdaDerivada(x.pctItem[i] ? fmtPct(x.pctItem[i]) : '', 'pa-derivada', x.pctItem[i] * 100)
          : celdaEditable('item', x.key, i, x.pctItem[i]));
      }
      const principal = `
        <tr class="pa-fila-item">
          <td class="pa-col-nombre">
            <span class="pa-item-numero">${escHtml(x.numero)}</span>
            <span class="pa-item-nombre">${escHtml(x.linea.nombre || '(sin nombre)')}</span>
            ${modoRubros ? '' : `<button class="pa-btn-distribuir" data-scope="item" data-row="${escHtml(x.key)}" title="Distribuir parejo">${icSvg('sheet')}</button>`}
          </td>
          <td class="pa-col-un">${escHtml(x.linea.unidad || '')}</td>
          <td class="pa-col-num"${attrCalc(x.cantidad)}>${fmtCantGrilla(x.cantidad)}</td>
          <td class="pa-col-monto"${attrCalc(x.precioTotal)}>${fmtARS(x.precioTotal)}</td>
          <td class="pa-col-num"${attrCalc(x.incidencia * 100)}>${fmtPct(x.incidencia)}</td>
          <td class="pa-col-num ${modoRubros ? 'pa-derivada' : filaSumaClase(x.suma)}"${attrCalc(x.suma * 100)}>${fmtPct(x.suma)}</td>
          ${celdas.join('')}
        </tr>`;

      const extra = [];
      if (verObra) {
        const c = [];
        for (let i = 0; i < n; i++) c.push(celdaDerivada(x.pctObra[i] ? fmtPct(x.pctObra[i]) : '', 'pa-derivada', x.pctObra[i] * 100));
        extra.push(`<tr class="pa-fila-sub"><td class="pa-col-nombre pa-sub-label">% en Obra</td><td colspan="5"></td>${c.join('')}</tr>`);
      }
      if (verCant) {
        const c = [];
        for (let i = 0; i < n; i++) c.push(celdaDerivada(fmtCantGrilla(x.pctCant[i]), 'pa-derivada', x.pctCant[i]));
        extra.push(`<tr class="pa-fila-sub"><td class="pa-col-nombre pa-sub-label">% en Cant.</td><td colspan="5"></td>${c.join('')}</tr>`);
      }
      return principal + extra.join('');
    }).join('');

    return filaRubro + filasItems;
  }).join('');

  // `aNumero` es lo que se le entrega a la calculadora flotante al clickear la
  // celda: en las filas de % es el número que se ve (25, no 0,25).
  const filaTotal = (label, valores, clase, formato, aNumero) => {
    const celdas = valores.map(v => `<td class="pa-celda ${clase}"${attrCalc(aNumero(v))}>${formato(v)}</td>`).join('');
    return `<tr class="pa-fila-total"><td class="pa-col-nombre pa-total-label">${escHtml(label)}</td><td colspan="5"></td>${celdas}</tr>`;
  };
  const comoPct = v => window.roundLimpio(v * 100);
  const comoMonto = v => limpiarCero(v);

  const pie = `
    <tfoot>
      ${filaTotal('Certificación parcial %', d.parcialPct, '', v => fmtPct(v), comoPct)}
      ${filaTotal('Certificación acumulada %', d.acumPct, 'pa-acum', v => fmtPct(v), comoPct)}
      ${filaTotal('Certificación parcial $', d.parcialMonto, '', v => fmtARS(limpiarCero(v)), comoMonto)}
      ${filaTotal('Certificación acumulada $', d.acumMonto, 'pa-acum', v => fmtARS(limpiarCero(v)), comoMonto)}
      ${filaTotal('Remanente $', d.remanenteMonto, '', v => fmtARS(limpiarCero(v)), comoMonto)}
      ${filaTotal('Remanente %', d.remanentePct, '', v => fmtPct(v), comoPct)}
    </tfoot>`;

  $('pa-tabla-wrap').innerHTML = `<table class="pa-tabla">${head}<tbody>${cuerpo}</tbody>${pie}</table>`;
}

/* ===== Resumen ===== */

function renderResumen(d) {
  const ultimoAcum = d.acumPct.length ? d.acumPct[d.acumPct.length - 1] : 0;
  const faltaCargar = Math.abs(ultimoAcum - 1) > 0.0001;
  $('pa-resumen').innerHTML = `
    <div class="pa-resumen-grid">
      <div class="pa-stat"><span class="pa-stat-label">Total del Presupuesto</span><span class="pa-stat-valor" data-calc-valor="${d.total}">${fmtARS(d.total)}</span></div>
      <div class="pa-stat"><span class="pa-stat-label">Anticipo financiero</span><span class="pa-stat-valor" data-calc-valor="${d.anticipoMonto}">${fmtARS(d.anticipoMonto)}</span></div>
      <div class="pa-stat"><span class="pa-stat-label">A certificar</span><span class="pa-stat-valor" data-calc-valor="${d.total - d.anticipoMonto}">${fmtARS(d.total - d.anticipoMonto)}</span></div>
      <div class="pa-stat"><span class="pa-stat-label">Avance planificado</span><span class="pa-stat-valor ${faltaCargar ? 'pa-stat-alerta' : ''}"${attrCalc(window.roundLimpio(ultimoAcum * 100))}>${fmtPct(ultimoAcum)}</span></div>
    </div>
    ${faltaCargar ? `<p class="form-hint pa-hint-alerta">El plan cubre ${fmtPct(ultimoAcum)} de la obra — cada fila tiene que sumar 100% para que el plan esté completo.</p>` : ''}`;
}

/* ===== Gráficos =====
   El dibujo vive en js/planAvanceDatos.js (compartido con la exportación);
   acá sólo se pide con las zonas de hover puestas y se engancha la
   interacción, que es lo propio de la pantalla. */

const COLOR_ACUM = window.PLAN_COLOR_ACUM;
const COLOR_REMANENTE = window.PLAN_COLOR_REMANENTE;

function renderCurva(d) {
  $('pa-curva').innerHTML = window.svgCurvaInversion(d, { hover: true, unidad: nombreUnidad() });
  const { acum, rem } = window.seriesCurvaInversion(d);
  engancharHoverCurva(d, acum, rem);
}

function renderBarras(d) {
  $('pa-barras').innerHTML = window.svgCertificacionPorPeriodo(d, { hover: true, unidad: nombreUnidad() });
  engancharHoverBarras(d);
}

let tooltipEl = null;
function tooltip() {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'pa-tooltip';
    tooltipEl.style.display = 'none';
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

function mostrarTooltip(e, html) {
  const t = tooltip();
  t.innerHTML = html;
  t.style.display = 'block';
  const r = t.getBoundingClientRect();
  let x = e.clientX + 14;
  if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - 14;
  t.style.left = x + 'px';
  t.style.top = Math.max(8, e.clientY - r.height - 10) + 'px';
}

function ocultarTooltip() {
  if (tooltipEl) tooltipEl.style.display = 'none';
}

function engancharHoverCurva(d, acum, rem) {
  const svg = $('pa-curva').querySelector('svg');
  const cross = svg.querySelector('.pa-crosshair');
  svg.querySelectorAll('.pa-hover-zone').forEach(zone => {
    zone.addEventListener('mousemove', e => {
      const i = parseInt(zone.dataset.i, 10);
      const x = parseFloat(zone.getAttribute('x')) + parseFloat(zone.getAttribute('width')) / 2;
      cross.setAttribute('x1', x); cross.setAttribute('x2', x);
      cross.style.display = '';
      const titulo = i === 0 ? 'Inicio de obra' : `${i}° ${nombreUnidad()}`;
      const montoAcum = i === 0 ? d.anticipoMonto : d.acumMonto[i - 1];
      const montoRem = limpiarCero(i === 0 ? d.total : d.remanenteMonto[i - 1]);
      mostrarTooltip(e, `
        <div class="pa-tt-titulo">${escHtml(titulo)}</div>
        <div class="pa-tt-fila"><span class="pa-tt-punto" style="background:${COLOR_ACUM}"></span>Acumulado <b>${fmtPct(acum[i])}</b> · ${fmtARS(montoAcum)}</div>
        <div class="pa-tt-fila"><span class="pa-tt-punto" style="background:${COLOR_REMANENTE}"></span>Remanente <b>${fmtPct(rem[i])}</b> · ${fmtARS(montoRem)}</div>`);
    });
    zone.addEventListener('mouseleave', () => { cross.style.display = 'none'; ocultarTooltip(); });
  });
}

function engancharHoverBarras(d) {
  $('pa-barras').querySelectorAll('.pa-barra').forEach(barra => {
    barra.addEventListener('mousemove', e => {
      const i = parseInt(barra.dataset.i, 10);
      mostrarTooltip(e, `
        <div class="pa-tt-titulo">${i + 1}° ${nombreUnidad()}</div>
        <div class="pa-tt-fila">Certificación <b>${fmtARS(d.parcialMonto[i])}</b></div>
        <div class="pa-tt-fila">Avance del período <b>${fmtPct(d.parcialPct[i])}</b></div>`);
    });
    barra.addEventListener('mouseleave', ocultarTooltip);
  });
}

/* ===== Render general ===== */

function renderTodo() {
  const d = construirDatos();
  const vacio = $('pa-vacio');
  const contenido = $('pa-contenido');

  if (!d) {
    vacio.style.display = '';
    contenido.style.display = 'none';
    vacio.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Esta obra todavía no tiene un Presupuesto calculable — cargá el Cómputo y la Carga Fija primero. El Plan de Avance reparte el precio de cada ítem del Presupuesto a lo largo del tiempo.</p>';
    return;
  }
  if (!d.gruposRubro.length) {
    vacio.style.display = '';
    contenido.style.display = 'none';
    vacio.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Todavía no hay rubros cargados en el Cómputo de esta obra.</p>';
    return;
  }

  vacio.style.display = 'none';
  contenido.style.display = '';
  renderResumen(d);
  renderTabla(d);
  renderCurva(d);
  renderBarras(d);
}

/* ===== Persistencia =====
   Cada celda se guarda con PATCH sobre su propia fila (no se reescribe el
   árbol entero de distribución) — mismo criterio que carga-fija.js y
   computo.js: dos ediciones seguidas que completan desordenadas no se pisan. */

async function persistCelda(scope, rowKey, i, valor) {
  const base = scope === 'rubro' ? 'rubros' : 'items';
  try {
    await _fbPatch(`/obras/${obraKey}/planAvance/${base}/${rowKey}.json`, { [pk(i)]: valor });
  } catch (_) {
    showToast('Error al guardar el plan de avance.', 'error');
  }
}

async function persistFila(scope, rowKey, cambios) {
  const base = scope === 'rubro' ? 'rubros' : 'items';
  try {
    await _fbPatch(`/obras/${obraKey}/planAvance/${base}/${rowKey}.json`, cambios);
  } catch (_) {
    showToast('Error al guardar el plan de avance.', 'error');
  }
}

async function persistConfig(cambios) {
  try {
    await _fbPatch(`/obras/${obraKey}/planAvance/config.json`, cambios);
  } catch (_) {
    showToast('Error al guardar la configuración del plan.', 'error');
  }
}

function distDe(scope) {
  return scope === 'rubro' ? distRubros : distItems;
}

function setCelda(scope, rowKey, i, frac) {
  const store = distDe(scope);
  if (!store[rowKey]) store[rowKey] = {};
  if (frac == null) delete store[rowKey][pk(i)];
  else store[rowKey][pk(i)] = frac;
  persistCelda(scope, rowKey, i, frac);
}

function updateConfig(cambios) {
  config = { ...config, ...cambios };
  persistConfig(cambios);
  renderTodo();
  renderControles();
}

/* ===== Edición de celdas (delegación: son cientos de inputs) ===== */

function engancharTabla() {
  const wrap = $('pa-tabla-wrap');

  wrap.addEventListener('focusin', e => {
    if (e.target.classList.contains('pa-input')) e.target.select();
  });

  wrap.addEventListener('focusout', e => {
    const input = e.target;
    if (!input.classList || !input.classList.contains('pa-input')) return;
    const raw = input.value.trim();
    const n = raw === '' ? null : parseFloat(raw.replace(',', '.'));
    const frac = n == null || isNaN(n) ? null : window.roundLimpio(n / 100);
    const store = distDe(input.dataset.scope);
    const actual = (store[input.dataset.row] || {})[pk(parseInt(input.dataset.p, 10))] || null;
    if (frac === actual) return;
    setCelda(input.dataset.scope, input.dataset.row, parseInt(input.dataset.p, 10), frac);
    renderTodo();
  });

  wrap.addEventListener('keydown', e => {
    if (!e.target.classList || !e.target.classList.contains('pa-input')) return;
    if (e.key === 'Enter') { e.target.blur(); return; }
    // Flechas ←/→ saltan de período dentro de la misma fila, como en la planilla.
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const p = parseInt(e.target.dataset.p, 10) + dir;
      const destino = wrap.querySelector(`.pa-input[data-row="${CSS.escape(e.target.dataset.row)}"][data-p="${p}"]`);
      if (destino) { e.preventDefault(); destino.focus(); }
    }
  });

  wrap.addEventListener('click', e => {
    const btn = e.target.closest('.pa-btn-distribuir');
    if (btn) abrirModalDistribuir(btn.dataset.scope, btn.dataset.row);
  });
}

/* ===== Modal "Distribuir parejo" ===== */

let distribuirDestino = null;

function abrirModalDistribuir(scope, rowKey) {
  distribuirDestino = { scope, rowKey };
  const n = cantidadPeriodos();
  const nombre = scope === 'rubro'
    ? (rubros.find(r => r.key === rowKey) || {}).nombre
    : (lineas[rowKey] || {}).nombre;
  $('distribuir-nombre').textContent = nombre || '(sin nombre)';
  $('distribuir-desde').value = 1;
  $('distribuir-hasta').value = n;
  $('distribuir-rango').textContent = `1 a ${n}`;
  $('modal-distribuir').classList.remove('hidden');
}

function cerrarModalDistribuir() {
  $('modal-distribuir').classList.add('hidden');
  distribuirDestino = null;
}

function aplicarDistribuir() {
  if (!distribuirDestino) return;
  const n = cantidadPeriodos();
  const desde = Math.max(1, Math.min(n, parseInt($('distribuir-desde').value, 10) || 1));
  const hasta = Math.max(desde, Math.min(n, parseInt($('distribuir-hasta').value, 10) || n));
  const cuantos = hasta - desde + 1;
  const frac = window.roundLimpio(1 / cuantos);

  const { scope, rowKey } = distribuirDestino;
  const store = distDe(scope);
  const cambios = {};
  for (let i = 0; i < n; i++) {
    const dentro = i >= desde - 1 && i <= hasta - 1;
    cambios[pk(i)] = dentro ? frac : null;
  }
  store[rowKey] = {};
  Object.entries(cambios).forEach(([k, v]) => { if (v != null) store[rowKey][k] = v; });

  persistFila(scope, rowKey, cambios);
  cerrarModalDistribuir();
  renderTodo();
}

/* ===== Controles de configuración ===== */

function renderControles() {
  $('pa-modo-items').classList.toggle('active', config.modo !== 'rubros');
  $('pa-modo-rubros').classList.toggle('active', config.modo === 'rubros');
  $('pa-unidad').value = config.unidad || 'semana';
  $('pa-cantidad').value = cantidadPeriodos();
  $('pa-fecha-inicio').value = config.fechaInicio || '';
  $('pa-anticipo').value = config.anticipoPct ?? '';
  $('pa-ver-obra').checked = verObra;
  $('pa-ver-cant').checked = verCant;
}

function engancharControles() {
  $('pa-modo-items').addEventListener('click', () => updateConfig({ modo: 'items' }));
  $('pa-modo-rubros').addEventListener('click', () => updateConfig({ modo: 'rubros' }));
  $('pa-unidad').addEventListener('change', e => updateConfig({ unidad: e.target.value }));

  const numControl = (id, key, transform) => {
    const input = $(id);
    input.addEventListener('blur', () => {
      const n = parseFloat(String(input.value).replace(',', '.'));
      updateConfig({ [key]: isNaN(n) ? null : transform(n) });
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  };
  numControl('pa-cantidad', 'cantidad', n => Math.max(1, Math.min(MAX_PERIODOS, Math.round(n))));
  numControl('pa-anticipo', 'anticipoPct', n => n);

  $('pa-fecha-inicio').addEventListener('change', e => updateConfig({ fechaInicio: e.target.value || '' }));

  $('pa-ver-obra').addEventListener('change', e => { verObra = e.target.checked; renderTodo(); });
  $('pa-ver-cant').addEventListener('change', e => { verCant = e.target.checked; renderTodo(); });

  $('distribuir-close').addEventListener('click', cerrarModalDistribuir);
  $('distribuir-cancelar').addEventListener('click', cerrarModalDistribuir);
  $('distribuir-aplicar').addEventListener('click', aplicarDistribuir);
}

/* ===== Carga ===== */

async function loadAll() {
  if (!obraKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta la obra (?obra=...).</p>';
    return;
  }
  const [obraData, lineasData, rubrosData, itemsData, materialesData, equiposData, rolesData,
         cfLineasData, cfConfigData, planConfigData, planItemsData, planRubrosData] = await Promise.all([
    _fbGet(`/obras/${obraKey}.json`),
    _fbGet(`/obras/${obraKey}/computo.json`),
    _fbGet(`/obras/${obraKey}/rubrosComputo.json`),
    _fbGet('/items.json'),
    _fbGet('/materiales.json'),
    _fbGet('/equipos.json'),
    _fbGet(`/obras/${obraKey}/roles.json`),
    _fbGet(`/obras/${obraKey}/cargaFija/lineas.json`),
    _fbGet(`/obras/${obraKey}/cargaFija/config.json`),
    _fbGet(`/obras/${obraKey}/planAvance/config.json`),
    _fbGet(`/obras/${obraKey}/planAvance/items.json`),
    _fbGet(`/obras/${obraKey}/planAvance/rubros.json`),
  ]);

  if (!obraData) {
    document.body.innerHTML = '<p style="padding:2rem;">No se encontró la obra.</p>';
    return;
  }
  obra = obraData;
  lineas = lineasData || {};
  rubros = Object.entries(rubrosData || {}).map(([key, r]) => ({ key, ...r }));
  items = Object.entries(itemsData || {}).map(([key, it]) => ({ key, ...it }));
  materiales = Object.entries(materialesData || {}).map(([key, m]) => ({ key, ...m }));
  equipos = Object.entries(equiposData || {}).map(([key, e]) => ({ key, ...e }));
  roles = Object.entries(rolesData || {}).map(([key, r]) => ({ key, ...r }));
  paramsEquipos = { ...paramsEquipos, ...(obra.paramsEquipos || {}) };
  paramsMO = { ...paramsMO, ...(obra.paramsMO || {}) };
  dolarObra = obra.dolar ? obra.dolar.valor : null;
  preciosObra = window.resolverPreciosObra(materiales, obraKey);
  cargaFijaLineas = cfLineasData || {};
  if (cfConfigData) cargaFijaConfig = { ...cargaFijaConfig, ...cfConfigData };
  if (planConfigData) config = { ...config, ...planConfigData };
  distItems = planItemsData || {};
  distRubros = planRubrosData || {};

  $('header-obra-nombre').textContent = 'Plan de Avance — ' + obra.nombre;
  renderHeaderTabs(obraKey, 'plan-avance');
  renderControles();
  renderTodo();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  engancharControles();
  engancharTabla();
  await loadAll();
  await getDolarSnapshot().catch(() => {});
  if (obra) renderTodo();
});

window.onDecimalesVista(() => { if (obra) renderTodo(); });
