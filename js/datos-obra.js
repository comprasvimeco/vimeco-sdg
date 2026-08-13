/* VIMECO S.A. — Sistema de Gestión — Datos de obra
   Comitente, dólar propio de la obra (se usa en todo el cálculo, ver
   calcCostos.js) y una lista dinámica de datos adicionales libres. */

const $ = id => document.getElementById(id);

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const params = new URLSearchParams(window.location.search);
const obraKey = params.get('obra');

let obra = null;
let dolarObra = { valor: null, fecha: null };
let datosExtra = {};   // { campoKey: { etiqueta, valor, creadoEn } }

function renderDatosExtra() {
  const container = $('datos-extra-lista');
  const entradas = Object.entries(datosExtra).sort((a, b) => (a[1].creadoEn || 0) - (b[1].creadoEn || 0));
  if (!entradas.length) {
    container.innerHTML = '<p class="text-muted" style="font-size:.85rem;">Sin datos adicionales todavía.</p>';
  } else {
    container.innerHTML = entradas.map(([campoKey, c]) => `
      <div class="datos-extra-linea" data-key="${escHtml(campoKey)}">
        <input type="text" class="form-control de-etiqueta" value="${escHtml(c.etiqueta || '')}" placeholder="Ej: Expediente">
        <input type="text" class="form-control de-valor" value="${escHtml(c.valor || '')}" placeholder="Ej: 1234/2026">
        <button class="datos-extra-del" title="Eliminar dato">${icSvg('x')}</button>
      </div>`).join('');
  }

  container.querySelectorAll('.datos-extra-linea').forEach(row => {
    const campoKey = row.dataset.key;
    const etiqueta = row.querySelector('.de-etiqueta');
    const valor = row.querySelector('.de-valor');
    etiqueta.addEventListener('blur', () => updateDato(campoKey, { etiqueta: etiqueta.value.trim() }));
    etiqueta.addEventListener('keydown', e => { if (e.key === 'Enter') etiqueta.blur(); });
    valor.addEventListener('blur', () => updateDato(campoKey, { valor: valor.value.trim() }));
    valor.addEventListener('keydown', e => { if (e.key === 'Enter') valor.blur(); });
    row.querySelector('.datos-extra-del').addEventListener('click', () => deleteDato(campoKey));
  });
}

async function persistDatoCambios(campoKey, cambios) {
  try {
    await _fbPatch(`/obras/${obraKey}/datosExtra/${campoKey}.json`, cambios);
  } catch (_) {
    showToast('Error al guardar el dato.', 'error');
  }
}

async function persistDatoNuevo(campoKey) {
  try {
    await _fbPut(`/obras/${obraKey}/datosExtra/${campoKey}.json`, datosExtra[campoKey]);
  } catch (_) {
    showToast('Error al guardar el dato.', 'error');
  }
}

function updateDato(campoKey, cambios) {
  datosExtra[campoKey] = { ...datosExtra[campoKey], ...cambios };
  persistDatoCambios(campoKey, cambios);
}

function addDato() {
  const campoKey = 'campo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  datosExtra[campoKey] = { etiqueta: '', valor: '', creadoEn: Date.now() };
  renderDatosExtra();
  persistDatoNuevo(campoKey);
  const nuevaFila = document.querySelector(`.datos-extra-linea[data-key="${campoKey}"] .de-etiqueta`);
  if (nuevaFila) nuevaFila.focus();
}

async function deleteDato(campoKey) {
  delete datosExtra[campoKey];
  renderDatosExtra();
  try {
    await _fbDel(`/obras/${obraKey}/datosExtra/${campoKey}.json`);
  } catch (_) {
    showToast('Error al eliminar el dato.', 'error');
  }
  showToast('Dato eliminado.');
}

function renderDolarVivo() {
  const venta = window.dolarOficialVenta();
  $('dolar-vivo-txt').textContent = venta ? `Dólar oficial en vivo: ${fmtARS(venta)}` : 'Dólar oficial en vivo: —';
  $('btn-usar-dolar-vivo').disabled = !venta;
}

function setupComitente() {
  const input = $('obra-comitente');
  input.value = obra.comitente || '';
  input.addEventListener('blur', async () => {
    const comitente = input.value.trim();
    try {
      await _fbPatch(`/obras/${obraKey}.json`, { comitente });
    } catch (_) {
      showToast('Error al guardar el comitente.', 'error');
    }
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
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

async function loadAll() {
  if (!obraKey) {
    document.body.innerHTML = '<p style="padding:2rem;">Falta la obra (?obra=...).</p>';
    return;
  }
  const [obraData, dolarData, datosExtraData] = await Promise.all([
    _fbGet(`/obras/${obraKey}.json`),
    _fbGet(`/obras/${obraKey}/dolar.json`),
    _fbGet(`/obras/${obraKey}/datosExtra.json`),
  ]);

  if (!obraData) {
    document.body.innerHTML = '<p style="padding:2rem;">No se encontró la obra.</p>';
    return;
  }
  obra = obraData;
  dolarObra = dolarData || { valor: null, fecha: null };
  datosExtra = datosExtraData || {};

  $('header-obra-nombre').textContent = 'Datos — ' + obra.nombre;
  renderHeaderTabs(obraKey, 'datos');
  setupComitente();
  setupDolar();
  setupPresupuestoOficial();
  renderDolarVivo();
  renderDatosExtra();

  $('main-loading').style.display = 'none';
  $('main-content').style.display = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  $('btn-add-dato').addEventListener('click', addDato);
  await loadAll();
  await getDolarSnapshot().catch(() => {});
  if (obra) renderDolarVivo();
});

window.onDecimalesVista(() => { if (obra) renderDolarVivo(); });
