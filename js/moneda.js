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
