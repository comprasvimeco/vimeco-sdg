/* VIMECO S.A. — Formateo de moneda y conversión USD→ARS en vivo (dólar oficial) */

window.fmtUSD = n => n.toLocaleString('es-AR', { style: 'currency', currency: 'USD' });
window.fmtARS = n => n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });

// Cotización oficial (venta) cacheada, sincrónica. null si todavía no se cargó ninguna vez.
window.dolarOficialVenta = function () {
  const snap = window.getDolarCached && window.getDolarCached();
  return (snap && snap.oficial && snap.oficial.venta) || null;
};

// "USD 1.234,00 · ≈ $ 1.863.340,00" — o sin la parte en pesos si todavía no hay
// cotización cacheada. La cotización en sí se muestra una sola vez, en el header
// (ver renderHeaderDolar), no hace falta repetirla en cada fila.
window.fmtUSDConEquivalente = function (usd) {
  const venta = window.dolarOficialVenta();
  if (!venta) return fmtUSD(usd);
  return `${fmtUSD(usd)} · ≈ ${fmtARS(usd * venta)}`;
};

// Un precio se carga en ARS o en USD (lo que el usuario tenga a mano) y se
// guardan los dos, convertidos con la cotización oficial del momento de
// carga — mismo criterio que ya usa la planilla de referencia (precio USD +
// precio $ + fecha). Devuelve null si no hay cotización cacheada todavía.
window.resolveDualPrecio = function (modo, valor) {
  const venta = window.dolarOficialVenta();
  if (!venta || isNaN(valor)) return null;
  if (modo === 'ARS') {
    return { precioARS: valor, precioUSD: Math.round((valor / venta) * 10000) / 10000 };
  }
  return { precioARS: Math.round(valor * venta * 100) / 100, precioUSD: valor };
};

// Dos <input> editables (USD y $) que se recalculan entre sí en vivo, en vez
// del viejo patrón toggle + 1 campo. Escribir en uno actualiza el otro (sin
// disparar su evento 'input', así que no hay bucle); notaEl muestra la
// cotización usada. Llamar attachCalcInput(input) sobre los dos ANTES de
// esto, para que la fórmula "=..." ya esté resuelta cuando este listener de
// blur recalcula.
window.attachDualPrecioInputs = function ({ usdInput, arsInput, notaEl }) {
  function actualizarNota() {
    if (!notaEl) return;
    const venta = window.dolarOficialVenta();
    notaEl.textContent = venta ? `Cotización usada: USD = ${fmtARS(venta)}` : '';
  }

  function recalcular(origen) {
    const srcInput = origen === 'USD' ? usdInput : arsInput;
    const dstInput = origen === 'USD' ? arsInput : usdInput;
    const val = parseFloat(srcInput.value.replace(',', '.'));
    if (!isNaN(val)) {
      const dual = resolveDualPrecio(origen, val);
      if (dual) {
        dstInput.value = origen === 'USD' ? dual.precioARS : dual.precioUSD;
        if (window.setCalcFormula) setCalcFormula(dstInput, null);
      }
    }
    actualizarNota();
  }

  usdInput.addEventListener('input', () => recalcular('USD'));
  arsInput.addEventListener('input', () => recalcular('ARS'));
  usdInput.addEventListener('blur', () => recalcular('USD'));
  arsInput.addEventListener('blur', () => recalcular('ARS'));

  actualizarNota();
};

// Pinta "USD = $1.520,00" en el <span id="header-dolar"> del header, si existe
// en la página. Se auto-ejecuta al cargar cualquier página que tenga ese
// elemento y este script — así el valor queda visible en todas partes sin
// que cada pantalla lo tenga que llamar a mano.
window.renderHeaderDolar = async function () {
  const el = document.getElementById('header-dolar');
  if (!el) return;
  const cached = window.dolarOficialVenta();
  if (cached) el.textContent = 'USD = ' + fmtARS(cached);
  try {
    await window.getDolarSnapshot();
    const v = window.dolarOficialVenta();
    if (v) el.textContent = 'USD = ' + fmtARS(v);
  } catch (_) {}
};

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('header-dolar')) window.renderHeaderDolar();
});
