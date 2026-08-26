/* VIMECO S.A. — Sistema de Gestión — Datos de obra

   Tres bloques, con destinos distintos:
   - Parámetros generales: dólar propio de la obra (se usa en todo el cálculo,
     ver calcCostos.js), presupuesto oficial y cómo se numera el presupuesto
     (ver js/numeracion.js).
   - Datos generales: las filas del encabezado de lo que se exporta. Se
     siembran solas la primera vez (ver js/encabezado.js) y desde ahí se
     editan, se agregan y se borran como cualquier lista.
   - Datos adicionales: notas internas de la obra, no salen en el papel. */

const $ = id => document.getElementById(id);

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const params = new URLSearchParams(window.location.search);
const obraKey = params.get('obra');

let obra = null;
let dolarObra = { valor: null, fecha: null };
let encabezado = {};   // { campoKey: { etiqueta, valor, orden } }   → sale en el papel
let datosExtra = {};   // { campoKey: { etiqueta, valor, orden } }   → interno

/* ===== Listas de campos etiqueta/valor =====
   El encabezado y los datos adicionales se editan igual; lo único que cambia
   es el nodo de Firebase donde viven y los textos. `datos` es el objeto en
   memoria, que se muta acá mismo para no tener que releer la obra. */

function crearLista(cfg) {
  const { nodo, contenedorId, datos, placeholderEtiqueta, placeholderValor, vacio, tituloBorrar } = cfg;

  // Los campos nuevos guardan `orden`; los datos adicionales cargados antes de
  // v088 traen `creadoEn`, que servía para lo mismo.
  const orden = c => (c.orden != null ? c.orden : (c.creadoEn || 0));

  const path = campoKey => `/obras/${obraKey}/${nodo}/${campoKey}.json`;

  function render() {
    const container = $(contenedorId);
    const entradas = Object.entries(datos()).sort((a, b) => orden(a[1]) - orden(b[1]));
    if (!entradas.length) {
      container.innerHTML = `<p class="text-muted" style="font-size:.85rem;">${escHtml(vacio)}</p>`;
      return;
    }
    container.innerHTML = entradas.map(([campoKey, c]) => `
      <div class="datos-extra-linea" data-key="${escHtml(campoKey)}">
        <input type="text" class="form-control de-etiqueta" value="${escHtml(c.etiqueta || '')}" placeholder="${escHtml(placeholderEtiqueta)}">
        <input type="text" class="form-control de-valor" value="${escHtml(c.valor || '')}" placeholder="${escHtml(placeholderValor)}">
        <button class="datos-extra-del" title="${escHtml(tituloBorrar)}">${icSvg('x')}</button>
      </div>`).join('');

    container.querySelectorAll('.datos-extra-linea').forEach(row => {
      const campoKey = row.dataset.key;
      const etiqueta = row.querySelector('.de-etiqueta');
      const valor = row.querySelector('.de-valor');
      etiqueta.addEventListener('blur', () => update(campoKey, { etiqueta: etiqueta.value.trim() }));
      etiqueta.addEventListener('keydown', e => { if (e.key === 'Enter') etiqueta.blur(); });
      valor.addEventListener('blur', () => update(campoKey, { valor: valor.value.trim() }));
      valor.addEventListener('keydown', e => { if (e.key === 'Enter') valor.blur(); });
      row.querySelector('.datos-extra-del').addEventListener('click', () => borrar(campoKey));
    });
  }

  function update(campoKey, cambios) {
    const actual = datos()[campoKey];
    if (!actual) return;
    Object.assign(actual, cambios);
    _fbPatch(path(campoKey), cambios).catch(() => showToast('Error al guardar el dato.', 'error'));
  }

  function agregar() {
    const campoKey = 'campo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    datos()[campoKey] = { etiqueta: '', valor: '', orden: Date.now() };
    render();
    _fbPatch(path(campoKey), datos()[campoKey]).catch(() => showToast('Error al guardar el dato.', 'error'));
    const nuevaFila = $(contenedorId).querySelector(`.datos-extra-linea[data-key="${campoKey}"] .de-etiqueta`);
    if (nuevaFila) nuevaFila.focus();
  }

  async function borrar(campoKey) {
    delete datos()[campoKey];
    render();
    try {
      await _fbDel(path(campoKey));
    } catch (_) {
      showToast('Error al eliminar el dato.', 'error');
      return;
    }
    showToast('Campo eliminado.');
  }

  return { render, agregar };
}

const listaEncabezado = crearLista({
  nodo: 'encabezado',
  contenedorId: 'encabezado-lista',
  datos: () => encabezado,
  placeholderEtiqueta: 'Ej: Expediente',
  placeholderValor: 'Ej: 1234/2026',
  vacio: 'El encabezado quedó sin campos: lo que se exporte sale sólo con el logo.',
  tituloBorrar: 'Quitar del encabezado',
});

const listaDatosExtra = crearLista({
  nodo: 'datosExtra',
  contenedorId: 'datos-extra-lista',
  datos: () => datosExtra,
  placeholderEtiqueta: 'Ej: Contacto de obra',
  placeholderValor: 'Ej: Juan Pérez — 351 555 0000',
  vacio: 'Sin datos adicionales todavía.',
  tituloBorrar: 'Eliminar dato',
});

// La primera vez que se abre la obra, el encabezado se siembra con los campos
// de siempre. La marca va en la obra y no en el propio nodo: si después se
// borran todos los campos, no se vuelven a sembrar solos.
async function sembrarEncabezadoSiHaceFalta() {
  if (Object.keys(encabezado).length || obra.encabezadoSembrado) return;
  encabezado = window.encabezadoInicial(obra);
  try {
    await _fbPatch(`/obras/${obraKey}/encabezado.json`, encabezado);
    await _fbPatch(`/obras/${obraKey}.json`, { encabezadoSembrado: true });
    obra.encabezadoSembrado = true;
  } catch (_) {
    showToast('Error al preparar el encabezado de la obra.', 'error');
  }
}

function renderDolarVivo() {
  const venta = window.dolarOficialVenta();
  $('dolar-vivo-txt').textContent = venta ? `Dólar oficial en vivo: ${fmtARSFijo(venta)}` : 'Dólar oficial en vivo: —';
  $('btn-usar-dolar-vivo').disabled = !venta;
}

function setupDolar() {
  const input = $('obra-dolar');
  input.value = formatMoneyString(dolarObra.valor);
  attachCalcInput(input);
  attachMoneyInput(input);

  async function guardarDolar() {
    const n = parseMoneyString(input.value);
    if (isNaN(n)) return;
    dolarObra = { valor: n, fecha: todayIso() };
    window.setCotizacionObra(n);
    try {
      await _fbPut(`/obras/${obraKey}/dolar.json`, dolarObra);
    } catch (_) {
      showToast('Error al guardar el dólar de la obra.', 'error');
    }
  }
  input.addEventListener('blur', guardarDolar);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });

  $('btn-usar-dolar-vivo').addEventListener('click', () => {
    const venta = window.dolarOficialVenta();
    if (!venta) return;
    input.value = formatMoneyString(venta);
    guardarDolar();
  });
}

function setupPresupuestoOficial() {
  const input = $('obra-presupuesto-oficial');
  input.value = formatMoneyString(obra.presupuestoOficial);
  attachCalcInput(input);
  attachMoneyInput(input);

  input.addEventListener('blur', async () => {
    const n = parseMoneyString(input.value);
    const presupuestoOficial = isNaN(n) ? null : n;
    try {
      await _fbPatch(`/obras/${obraKey}.json`, { presupuestoOficial });
    } catch (_) {
      showToast('Error al guardar el presupuesto oficial.', 'error');
    }
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
}

/* Numeración del presupuesto (ver js/numeracion.js). Apagada — el caso de
   siempre — no hay nada que elegir: los rubros y los ítems se numeran 1, 1.1,
   1.2… Prendida aparece el estilo del automático y en el Cómputo se puede
   escribir el código de cada rubro/ítem a mano, para copiar la numeración del
   pliego del comitente. */
function setupNumeracion() {
  const check = $('obra-numeracion-personalizada');
  const grupo = $('grupo-estilo-numeracion');
  const select = $('obra-estilo-numeracion');

  select.innerHTML = window.NUMERACION_ESTILOS
    .map(e => `<option value="${escHtml(e.id)}">${escHtml(e.label)}</option>`).join('');
  const validos = window.NUMERACION_ESTILOS.map(e => e.id);
  select.value = validos.includes(obra.estiloNumeracion) ? obra.estiloNumeracion : 'arabigo';
  check.checked = !!obra.numeracionPersonalizada;
  grupo.classList.toggle('hidden', !check.checked);

  async function guardar(cambios) {
    try {
      await _fbPatch(`/obras/${obraKey}.json`, cambios);
    } catch (_) {
      showToast('Error al guardar la numeración.', 'error');
    }
  }

  check.addEventListener('change', () => {
    grupo.classList.toggle('hidden', !check.checked);
    obra.numeracionPersonalizada = check.checked;
    // null borra el campo: la obra queda igual que las que nunca lo activaron.
    // Los códigos escritos a mano no se tocan — vuelven a valer si se reactiva.
    guardar({ numeracionPersonalizada: check.checked ? true : null });
  });

  select.addEventListener('change', () => {
    obra.estiloNumeracion = select.value;
    guardar({ estiloNumeracion: select.value });
  });
}

/* "Sin rubros": los pliegos que cotizan una sola lista de ítems numerados
   corridos. El Cómputo pasa a ser una lista única, el papel y el Excel no
   imprimen filas de rubro y el Resumen por rubro no se emite.

   Por dentro las líneas siguen colgando de un rubro (el modelo no cambia), así
   que activarlo junta todas en el primero. Eso es irreversible: los nombres de
   los rubros se pierden y volver a "con rubros" deja una obra de un solo rubro.
   Por eso se pregunta antes, con todas las letras. */
function setupSinRubros() {
  const check = $('obra-sin-rubros');
  check.checked = !!obra.sinRubros;

  check.addEventListener('change', async () => {
    // Apagarlo no toca datos: la obra vuelve a mostrar el rubro que quedó.
    if (!check.checked) {
      obra.sinRubros = null;
      try {
        await _fbPatch(`/obras/${obraKey}.json`, { sinRubros: null });
      } catch (_) {
        showToast('Error al guardar la estructura.', 'error');
      }
      return;
    }

    const [rubrosData, computoData] = await Promise.all([
      _fbGet(`/obras/${obraKey}/rubrosComputo.json`),
      _fbGet(`/obras/${obraKey}/computo.json`),
    ]);
    const rubros = Object.entries(rubrosData || {})
      .map(([key, r]) => ({ key, ...r }))
      .sort((a, b) => (a.orden || 0) - (b.orden || 0));
    const lineas = computoData || {};

    if (rubros.length > 1) {
      const ok = await showConfirm('Pasar a lista plana',
        `Las ${Object.keys(lineas).length} líneas del Cómputo se van a juntar en una sola lista, en el orden actual. ` +
        `Los ${rubros.length} rubros y sus nombres se pierden, y no se puede deshacer.`);
      if (!ok) { check.checked = false; return; }
    }

    try {
      // La marca va primero, antes de mover nada: es lo que el usuario pidió y
      // lo que decide cómo se ve la obra. Si la fusión se corta a mitad de
      // camino (o el usuario se va de la pantalla), la lista igual se muestra
      // plana — quedan líneas en otros rubros, pero ninguna se pierde ni deja
      // de verse.
      obra.sinRubros = true;
      await _fbPatch(`/obras/${obraKey}.json`, { sinRubros: true });
      if (rubros.length > 1) {
        await fusionarEnUnRubro(rubros, lineas);
        showToast('El Cómputo quedó como una sola lista.');
      }
    } catch (_) {
      check.checked = false;
      showToast('Error al pasar la obra a lista plana.', 'error');
    }
  });
}

/* Mueve todas las líneas al primer rubro, respetando el orden en que se veían
   (rubro por rubro), y borra los rubros que quedaron vacíos.

   Un solo PATCH con rutas profundas ("lineaKey/rubroId"), que toca únicamente
   esos dos campos de cada línea: nunca un PUT del árbol del cómputo, que
   borraría todo lo que no vaya en el cuerpo. Los rubros se borran de a uno por
   su clave, nunca la colección entera. */
async function fusionarEnUnRubro(rubros, lineas) {
  const destino = rubros[0].key;
  const cambios = {};
  let orden = 0;
  rubros.forEach(r => {
    Object.entries(lineas)
      .filter(([, l]) => l.rubroId === r.key)
      .sort((a, b) => (a[1].orden || 0) - (b[1].orden || 0))
      .forEach(([key]) => {
        orden++;
        cambios[`${key}/rubroId`] = destino;
        cambios[`${key}/orden`] = orden;
      });
  });

  if (Object.keys(cambios).length) {
    await _fbPatch(`/obras/${obraKey}/computo.json`, cambios);
  }
  for (const r of rubros.slice(1)) {
    await _fbDel(`/obras/${obraKey}/rubrosComputo/${r.key}.json`);
  }
}

async function loadAll() {
  if (!obraKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta la obra (?obra=...).</p>';
    return;
  }
  const [obraData, dolarData, encabezadoData, datosExtraData] = await Promise.all([
    _fbGet(`/obras/${obraKey}.json`),
    _fbGet(`/obras/${obraKey}/dolar.json`),
    _fbGet(`/obras/${obraKey}/encabezado.json`),
    _fbGet(`/obras/${obraKey}/datosExtra.json`),
  ]);

  if (!obraData) {
    document.body.innerHTML = '<p style="padding:2rem;">No se encontró la obra.</p>';
    return;
  }
  obra = obraData;
  dolarObra = dolarData || { valor: null, fecha: null };
  window.setCotizacionObra(dolarObra.valor);
  encabezado = encabezadoData || {};
  datosExtra = datosExtraData || {};
  await sembrarEncabezadoSiHaceFalta();

  $('header-obra-nombre').textContent = 'Datos — ' + obra.nombre;
  renderHeaderTabs(obraKey, 'datos');
  setupDolar();
  setupPresupuestoOficial();
  setupNumeracion();
  setupSinRubros();
  renderDolarVivo();
  listaEncabezado.render();
  listaDatosExtra.render();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  $('btn-add-encabezado').addEventListener('click', () => listaEncabezado.agregar());
  $('btn-add-dato').addEventListener('click', () => listaDatosExtra.agregar());
  await loadAll();
  await getDolarSnapshot().catch(() => {});
  if (obra) renderDolarVivo();
});

window.onDecimalesVista(() => { if (obra) renderDolarVivo(); });
