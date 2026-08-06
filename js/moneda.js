/* VIMECO S.A. — Formateo de moneda y conversión USD→ARS en vivo (dólar oficial) */

window.fmtUSD = n => n.toLocaleString('es-AR', { style: 'currency', currency: 'USD' });
window.fmtARS = n => n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });

// Cotización oficial (venta) cacheada, sincrónica. null si todavía no se cargó ninguna vez.
window.dolarOficialVenta = function () {
  const snap = window.getDolarCached && window.getDolarCached();
  return (snap && snap.oficial && snap.oficial.venta) || null;
};

// "USD 1.234,00 · ≈ $ 1.863.340,00 (dólar oficial $1.510,00)" — o sin la parte en
// pesos si todavía no hay cotización cacheada.
window.fmtUSDConEquivalente = function (usd) {
  const venta = window.dolarOficialVenta();
  if (!venta) return fmtUSD(usd);
  return `${fmtUSD(usd)} · ≈ ${fmtARS(usd * venta)} (dólar oficial ${fmtARS(venta)})`;
};
