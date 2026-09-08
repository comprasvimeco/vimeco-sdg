/* VIMECO S.A. — Plan de Avance: cálculo de certificaciones y gráficos.

   Lo comparten la pantalla del Plan de Avance (js/plan-avance.js, que además
   edita la distribución) y la exportación (js/exportar.js, que la imprime).
   La curva que sale en el PDF es la misma función que dibuja la de pantalla,
   no una segunda versión parecida.

   Fórmulas verificadas contra la hoja "Plan de trabajos" de la planilla de
   referencia (CyP Taller Río Cuarto.xlsx):

     % en Ítem    → lo que se carga a mano: qué fracción del ítem se ejecuta
                    en ese período. La fila tiene que sumar 100%.
     % en Obra    = % en Ítem × incidencia del ítem sobre el total
     Cantidad     = % en Ítem × cantidad de contrato del ítem
     Monto        = % en Ítem × precio del ítem   ← mismo criterio que
                    "Cantidad": si el % en Ítem suma 100% en la obra, el
                    Monto tiene que sumar exactamente el precio del ítem.
                    No lleva el descuento del anticipo — eso es sólo de
                    "Certif. $" (la plata que se le gira al contratista),
                    no de cuánto ítem se ejecutó.
     Certif. %    = suma de "% en Obra" de todas las filas, por período
     Certif. $    = Certif. % × total × (1 − anticipo)   ← el anticipo ya se
                    cobró al inicio, así que se amortiza sobre cada certificado
     Acum. $      arranca en (anticipo × total) y va sumando los parciales
     Remanente $  = total − acumulado $ */

(function () {
  window.PLAN_MAX_PERIODOS = 60;

  window.cantidadPeriodosPlan = function (config) {
    const n = parseInt(config.cantidad, 10);
    if (isNaN(n) || n < 1) return 1;
    return Math.min(n, window.PLAN_MAX_PERIODOS);
  };

  window.pkPeriodo = i => 'p' + i;

  window.nombreUnidadPlan = config => (config.unidad === 'mes' ? 'Mes' : 'Semana');

  // Fecha de arranque del período i, o null si la obra no tiene fecha de inicio.
  window.fechaPeriodoPlan = function (config, i) {
    if (!config.fechaInicio) return null;
    const d = new Date(config.fechaInicio + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    if (config.unidad === 'mes') d.setMonth(d.getMonth() + i);
    else d.setDate(d.getDate() + i * 7);
    return d;
  };

  window.PLAN_CONFIG_DEFAULT = { modo: 'items', unidad: 'semana', cantidad: 12, fechaInicio: '', anticipoPct: null };

  // Config y distribución del plan de una obra, con los defaults ya aplicados.
  window.cargarPlanAvanceObra = async function (obraKey) {
    const [configData, itemsData, rubrosData] = await Promise.all([
      _fbGet(`/obras/${obraKey}/planAvance/config.json`),
      _fbGet(`/obras/${obraKey}/planAvance/items.json`),
      _fbGet(`/obras/${obraKey}/planAvance/rubros.json`),
    ]);
    return {
      config: Object.assign({}, window.PLAN_CONFIG_DEFAULT, configData || {}),
      distItems: itemsData || {},
      distRubros: rubrosData || {},
    };
  };

  // Pasa los rubros del Presupuesto (js/presupuestoDatos.js) a la forma que
  // espera calcPlanAvance, para que la exportación no tenga que rearmar precios.
  window.gruposRubroDesdePresupuesto = function (modelo) {
    return modelo.rubros.map(r => ({
      rubro: { key: r.key, nombre: r.nombre },
      numero: r.numero,
      precioTotal: r.subtotal || 0,
      lineas: r.lineas.map(l => ({
        key: l.key,
        numero: l.numero,
        linea: { nombre: l.nombre, unidad: l.unidad },
        cantidad: l.cantidad || 0,
        precioUnitario: l.precioUnitario,
        precioTotal: l.total || 0,
      })),
    }));
  };

  /* gruposRubro: [{ rubro: {key, nombre}, precioTotal,
                     lineas: [{ key, linea: {nombre, unidad}, cantidad, precioUnitario, precioTotal }] }]
     Ya valorizados por quien llama (Presupuesto = costo unitario × K).
     Devuelve el mismo objeto que consumen la grilla y los gráficos. */
  window.calcPlanAvance = function (gruposRubro, config, distItems, distRubros) {
    const n = window.cantidadPeriodosPlan(config);
    const pk = window.pkPeriodo;
    const total = gruposRubro.reduce((a, g) => a + g.precioTotal, 0);
    const anticipoFrac = (config.anticipoPct || 0) / 100;

    gruposRubro.forEach(g => {
      g.incidencia = total > 0 ? g.precioTotal / total : 0;
      g.dist = distRubros[g.rubro.key] || {};
      g.lineas.forEach(x => {
        x.incidencia = total > 0 ? x.precioTotal / total : 0;
        // En modo rubro el ítem avanza al ritmo de su rubro; en modo ítem tiene
        // su propia fila cargada a mano.
        x.dist = config.modo === 'rubros' ? g.dist : (distItems[x.key] || {});
        x.pctItem = [];
        x.pctObra = [];
        x.pctCant = [];
        x.pctMonto = [];
        for (let i = 0; i < n; i++) {
          const f = x.dist[pk(i)] || 0;
          x.pctItem.push(f);
          x.pctObra.push(f * x.incidencia);
          x.pctCant.push(f * x.cantidad);
          x.pctMonto.push(f * x.precioTotal);
        }
        x.suma = x.pctItem.reduce((a, v) => a + v, 0);
      });
      // El subtotal del rubro es siempre la suma de sus ítems: en modo rubro eso
      // da exactamente distRubro × incidenciaRubro, y en modo ítem refleja lo
      // que se cargó ítem por ítem.
      g.pctObra = [];
      for (let i = 0; i < n; i++) {
        g.pctObra.push(g.lineas.reduce((a, x) => a + x.pctObra[i], 0));
      }
      g.pctItem = [];
      for (let i = 0; i < n; i++) g.pctItem.push(g.dist[pk(i)] || 0);
      // En modo ítem el rubro no tiene distribución propia: su Σ es cuánto de su
      // propio precio quedó planificado (100% = todos sus ítems completos), no
      // su incidencia sobre la obra — si no, un rubro del 35% completo mostraría
      // "35%" y parecería a medio cargar.
      const sumaObra = g.pctObra.reduce((a, v) => a + v, 0);
      g.sumaRubro = config.modo === 'rubros'
        ? g.pctItem.reduce((a, v) => a + v, 0)
        : (g.incidencia > 0 ? sumaObra / g.incidencia : 0);
    });

    const parcialPct = [];
    for (let i = 0; i < n; i++) {
      parcialPct.push(gruposRubro.reduce((a, g) => a + g.pctObra[i], 0));
    }

    const acumPct = [];
    const parcialMonto = [];
    const acumMonto = [];
    const remanenteMonto = [];
    const remanentePct = [];
    let acc = 0;
    let accMonto = anticipoFrac * total;
    for (let i = 0; i < n; i++) {
      acc += parcialPct[i];
      acumPct.push(acc);
      const monto = parcialPct[i] * total * (1 - anticipoFrac);
      parcialMonto.push(monto);
      accMonto += monto;
      acumMonto.push(accMonto);
      remanenteMonto.push(total - accMonto);
      remanentePct.push(1 - acc);
    }

    return {
      n, total, anticipoFrac, gruposRubro,
      parcialPct, acumPct, parcialMonto, acumMonto, remanenteMonto, remanentePct,
      anticipoMonto: anticipoFrac * total,
    };
  };

  /* ===== Gráficos =====
     Tres gráficos, cada uno de un solo eje (nunca dos escalas en el mismo):
     Plan de Avance (acumulado y remanente, en % — ajeno al anticipo), Curva
     de Inversión (acumulado y remanente, en $ — arranca en el anticipo) y
     certificación por período (en $, no acumulado). Devuelven markup SVG;
     las zonas de hover sólo se emiten si se piden (la pantalla sí, el PDF
     no). */

  const COLOR_ACUM = '#2557a7';
  const COLOR_REMANENTE = '#9a7420';
  const COLOR_EJE = '#9ca3af';
  const COLOR_GRID = '#e8eaed';
  window.PLAN_COLOR_ACUM = COLOR_ACUM;
  window.PLAN_COLOR_REMANENTE = COLOR_REMANENTE;

  function ejeX(n, x0, ancho) {
    // n+1 posiciones: el punto 0 es el inicio de obra (antes del 1° período).
    return i => x0 + (ancho * i) / n;
  }

  // El punto 0 es el arranque de cada curva.
  // Plan de Avance: % de obra ejecutado, ajeno al anticipo — arranca en 0%.
  window.seriesPlanAvance = function (d) {
    return {
      acum: [0, ...d.acumPct],
      rem: [1, ...d.remanentePct],
    };
  };

  // Curva de Inversión: plata que cobra el contratista — arranca en el
  // anticipo (ya cobrado antes del primer certificado) y se amortiza
  // proporcionalmente en cada certificado. Montos absolutos, sin normalizar
  // (dibujarCurvaLineas los divide por el total para ubicarlos en el eje).
  window.seriesCurvaInversion = function (d) {
    return {
      acum: [d.anticipoMonto, ...d.acumMonto],
      rem: [d.total, ...d.remanenteMonto],
    };
  };

  // Trazador genérico de las dos curvas (línea + puntos + etiquetas de fin +
  // zonas de hover): recibe las series ya normalizadas a fracción [0,1] del
  // techo del eje Y, y sólo varía cómo se rotula ese eje (opts.etiquetaEje) y
  // el aria-label del SVG (opts.tituloAria).
  function dibujarCurvaLineas(acum, rem, opts) {
    const o = Object.assign({ W: 960, H: 340, hover: false, etiquetaEje: v => `${Math.round(v * 100)}%`, etiquetaPunto: null, tituloAria: '' }, opts);
    const etiquetaPunto = o.etiquetaPunto || o.etiquetaEje;

    // Margen izquierdo según el ancho real de la etiqueta más larga del eje Y,
    // no un número fijo: "100%" y "$772.197.031,78" no entran en el mismo
    // margen, y una etiqueta del eje no puede quedar cortada nunca. 6,8px por
    // carácter es una estimación generosa para Segoe UI a 11px (de sobra
    // incluso para un presupuesto varias veces más grande).
    const etiquetasGrid = [0, 0.25, 0.5, 0.75, 1].map(o.etiquetaEje);
    const anchoMaxTexto = Math.max(...etiquetasGrid.map(t => t.length));
    const margenIzq = Math.max(52, 16 + anchoMaxTexto * 6.8);

    const m = { top: 18, right: 96, bottom: 40, left: margenIzq };
    const pw = o.W - m.left - m.right;
    const ph = o.H - m.top - m.bottom;
    const n = acum.length - 1;
    const px = ejeX(n, m.left, pw);
    const py = v => m.top + ph - v * ph;

    const grid = etiquetasGrid.map((texto, idx) => {
      const v = [0, 0.25, 0.5, 0.75, 1][idx];
      return `<line x1="${m.left}" y1="${py(v)}" x2="${m.left + pw}" y2="${py(v)}" stroke="${COLOR_GRID}" stroke-width="1"/>
       <text x="${m.left - 8}" y="${py(v) + 4}" text-anchor="end" class="pa-svg-tick">${escHtml(texto)}</text>`;
    }).join('');

    const paso = n > 20 ? Math.ceil(n / 12) : 1;
    const ticks = [];
    for (let i = 1; i <= n; i++) {
      if (i % paso !== 0 && i !== n) continue;
      ticks.push(`<text x="${px(i)}" y="${m.top + ph + 20}" text-anchor="middle" class="pa-svg-tick">${i}</text>`);
    }

    // Valor de cada punto, chico y discreto: en el PDF no hay hover, así que
    // es la única forma de leer un dato puntual sin ir a la tabla. Se etiqueta
    // con la misma frecuencia que los números del eje X (paso, arriba). El
    // primer y último punto no centran el texto sobre el punto para no pisar
    // la etiqueta del eje Y ni la de fin de línea.
    const valorPunto = (i, v, color, dy) => {
      const anchor = i === 0 ? 'start' : (i === n ? 'end' : 'middle');
      const x = i === 0 ? px(i) + 4 : (i === n ? px(i) - 4 : px(i));
      return `<text x="${x}" y="${py(v) + dy}" text-anchor="${anchor}" class="pa-svg-valor" fill="${color}">${escHtml(etiquetaPunto(v))}</text>`;
    };
    const valores = [];
    for (let i = 0; i <= n; i++) {
      if (i !== 0 && i !== n && i % paso !== 0) continue;
      // Un valor pegado a 0 o al techo del eje ya lo dice la grilla de fondo
      // a esa misma altura (el arranque y el cierre de estas curvas siempre
      // caen justo en un extremo) — repetirlo ahí sólo lo encima.
      const enExtremo = v => v < 1e-6 || v > 1 - 1e-6;
      if (!enExtremo(acum[i])) valores.push(valorPunto(i, acum[i], COLOR_ACUM, -6));
      if (!enExtremo(rem[i])) valores.push(valorPunto(i, rem[i], COLOR_REMANENTE, 12));
    }

    const linea = (vals, color) =>
      `<polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${vals.map((v, i) => `${px(i)},${py(v)}`).join(' ')}"/>`;

    const puntos = (vals, color) =>
      vals.map((v, i) => `<circle cx="${px(i)}" cy="${py(v)}" r="2.5" fill="${color}"/>`).join('');

    // Etiquetas directas al final de cada línea. Cuando las dos series terminan
    // en el mismo valor (plan completo: acumulado 100%, remanente 0%, o al revés
    // si el plan está vacío) las etiquetas se pisarían — se separan 7px.
    const finAcum = acum[acum.length - 1];
    const finRem = rem[rem.length - 1];
    const chocan = Math.abs(py(finAcum) - py(finRem)) < 14;
    const etiquetaFin = (v, color, texto, dy) =>
      `<text x="${m.left + pw + 8}" y="${py(v) + 4 + dy}" class="pa-svg-label" fill="${color}">${texto}</text>`;

    const hover = [];
    if (o.hover) {
      for (let i = 0; i <= n; i++) {
        const ancho = pw / n;
        hover.push(`<rect class="pa-hover-zone" data-i="${i}" x="${px(i) - ancho / 2}" y="${m.top}" width="${ancho}" height="${ph}" fill="transparent"/>`);
      }
    }

    return `
      <svg viewBox="0 0 ${o.W} ${o.H}" class="pa-svg" role="img" aria-label="${escHtml(o.tituloAria)}">
        ${grid}
        <line x1="${m.left}" y1="${m.top + ph}" x2="${m.left + pw}" y2="${m.top + ph}" stroke="${COLOR_EJE}" stroke-width="1"/>
        ${ticks.join('')}
        <text x="${m.left + pw / 2}" y="${o.H - 6}" text-anchor="middle" class="pa-svg-tick">${escHtml(o.unidad || 'Semana')}</text>
        ${o.hover ? `<line class="pa-crosshair" x1="0" y1="${m.top}" x2="0" y2="${m.top + ph}" stroke="${COLOR_EJE}" stroke-width="1" stroke-dasharray="3 3" style="display:none"/>` : ''}
        ${linea(rem, COLOR_REMANENTE)}
        ${linea(acum, COLOR_ACUM)}
        ${puntos(rem, COLOR_REMANENTE)}
        ${puntos(acum, COLOR_ACUM)}
        ${etiquetaFin(finAcum, COLOR_ACUM, 'Acumulado', chocan ? -7 : 0)}
        ${etiquetaFin(finRem, COLOR_REMANENTE, 'Remanente', chocan ? 11 : 0)}
        ${valores.join('')}
        ${hover.join('')}
      </svg>`;
  }

  // Plan de Avance: eje en %, sin anticipo. El valor de cada punto usa
  // fmtPct (los decimales configurados) en vez de la etiqueta redondeada del
  // eje — a diferencia de la grilla, un punto de datos no puede perder
  // precisión.
  window.svgPlanAvance = function (d, opts) {
    const o = Object.assign({ unidad: 'Semana' }, opts);
    const { acum, rem } = window.seriesPlanAvance(d);
    return dibujarCurvaLineas(acum, rem, Object.assign({}, o, {
      etiquetaEje: v => `${Math.round(v * 100)}%`,
      etiquetaPunto: v => window.fmtPct(v),
      tituloAria: `Plan de avance: acumulado y remanente por ${o.unidad.toLowerCase()}`,
    }));
  };

  // Curva de Inversión: eje en $, arranca en el anticipo.
  window.svgCurvaInversion = function (d, opts) {
    const o = Object.assign({ unidad: 'Semana', fmtMonto: window.fmtARS }, opts);
    const { acum, rem } = window.seriesCurvaInversion(d);
    const total = d.total;
    const norm = v => (total > 0 ? v / total : 0);
    return dibujarCurvaLineas(acum.map(norm), rem.map(norm), Object.assign({}, o, {
      etiquetaEje: v => o.fmtMonto(v * total),
      tituloAria: `Curva de inversión: acumulado y remanente en pesos por ${o.unidad.toLowerCase()}`,
    }));
  };

  window.svgCertificacionPorPeriodo = function (d, opts) {
    const o = Object.assign({ W: 960, H: 260, hover: false, unidad: 'Semana', fmtMonto: window.fmtARS }, opts);
    const m = { top: 18, right: 20, bottom: 40, left: 92 };
    const pw = o.W - m.left - m.right;
    const ph = o.H - m.top - m.bottom;
    const n = d.n;
    const max = Math.max(...d.parcialMonto, 1);
    const py = v => m.top + ph - (v / max) * ph;
    const anchoSlot = pw / n;
    const anchoBarra = Math.max(anchoSlot - 2, 1); // 2px de aire entre barras

    const grid = [0, 0.5, 1].map(f => {
      const v = max * f;
      return `<line x1="${m.left}" y1="${py(v)}" x2="${m.left + pw}" y2="${py(v)}" stroke="${COLOR_GRID}" stroke-width="1"/>
              <text x="${m.left - 8}" y="${py(v) + 4}" text-anchor="end" class="pa-svg-tick">${o.fmtMonto(v)}</text>`;
    }).join('');

    // Mismo criterio de espaciado que los números de período de abajo: con
    // muchos períodos, tanto los números como el monto de cada barra se
    // amontonarían.
    const paso = n > 20 ? Math.ceil(n / 12) : 1;

    const r = 4;
    const barras = d.parcialMonto.map((v, i) => {
      const x = m.left + i * anchoSlot + (anchoSlot - anchoBarra) / 2;
      const y = py(v);
      const h = m.top + ph - y;
      if (h <= 0) return '';
      const rr = Math.min(r, anchoBarra / 2, h);
      const path = `M${x},${m.top + ph} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + anchoBarra - rr},${y} Q${x + anchoBarra},${y} ${x + anchoBarra},${y + rr} L${x + anchoBarra},${m.top + ph} Z`;
      const barra = `<path d="${path}" fill="${COLOR_ACUM}" class="pa-barra"${o.hover ? ` data-i="${i}"` : ''}/>`;
      const mostrarValor = paso === 1 || (i + 1) % paso === 0 || i === n - 1;
      const valor = mostrarValor
        ? `<text x="${x + anchoBarra / 2}" y="${Math.max(m.top + 8, y - 6)}" text-anchor="middle" class="pa-svg-valor" fill="${COLOR_ACUM}">${escHtml(o.fmtMonto(v))}</text>`
        : '';
      return barra + valor;
    }).join('');

    const ticks = [];
    for (let i = 0; i < n; i++) {
      if ((i + 1) % paso !== 0 && i !== n - 1) continue;
      ticks.push(`<text x="${m.left + i * anchoSlot + anchoSlot / 2}" y="${m.top + ph + 20}" text-anchor="middle" class="pa-svg-tick">${i + 1}</text>`);
    }

    return `
      <svg viewBox="0 0 ${o.W} ${o.H}" class="pa-svg" role="img" aria-label="Certificación por ${o.unidad.toLowerCase()}, en pesos">
        ${grid}
        <line x1="${m.left}" y1="${m.top + ph}" x2="${m.left + pw}" y2="${m.top + ph}" stroke="${COLOR_EJE}" stroke-width="1"/>
        ${barras}
        ${ticks.join('')}
        <text x="${m.left + pw / 2}" y="${o.H - 6}" text-anchor="middle" class="pa-svg-tick">${o.unidad}</text>
      </svg>`;
  };
})();
