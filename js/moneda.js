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
    return { precioARS: valor, precioUSD: roundLimpio(valor / venta) };
  }
  return { precioARS: roundLimpio(valor * venta), precioUSD: valor };
};

// Formatea un número (o string numérico) para mostrar en un input de plata:
// "." cada 3 dígitos de la parte entera, "," antes de los decimales que
// tenga (sin redondear — muestra la precisión real del valor). '' si no hay
// valor válido.
window.formatMoneyString = function (value) {
  if (value === null || value === undefined || value === '') return '';
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
  if (isNaN(n)) return '';
  const [intPart, decPart] = Math.abs(n).toString().split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (n < 0 ? '-' : '') + grouped + (decPart ? ',' + decPart : '');
};

// Inversa de formatMoneyString: saca los "." (son sólo agrupación) y
// convierte la "," decimal a ".", para volver a tener un número JS.
window.parseMoneyString = function (str) {
  if (str == null) return NaN;
  return parseFloat(String(str).trim().replace(/\./g, '').replace(',', '.'));
};

// Engancha el formateo de miles/decimales EN VIVO a un <input> de plata:
// "." tipeado se interpreta como separador decimal (se convierte a ",");
// como mucho 2 decimales nuevos (no crece más allá, pero no trunca un valor
// ya cargado con más precisión); mientras el campo tiene una fórmula "=..."
// en curso (ver attachCalcInput en calc.js) no se toca nada. Llamar
// attachCalcInput(input) ANTES de esto (mismo motivo que
// attachDualPrecioInputs: la fórmula tiene que estar resuelta antes de que
// esto la formatee).
window.attachMoneyInput = function (input) {
  function isFormulaMode() { return input.value.trim().startsWith('='); }

  // Cuenta dígitos/coma (no los "." de agrupación, esos son sólo visuales)
  // antes de una posición — para reubicar el cursor después de reformatear.
  function sigCountBefore(str, pos) {
    let c = 0;
    for (let i = 0; i < pos && i < str.length; i++) if (/[0-9,]/.test(str[i])) c++;
    return c;
  }
  function posAtSigCount(str, target) {
    if (target <= 0) return 0;
    let c = 0;
    for (let i = 0; i < str.length; i++) {
      if (/[0-9,]/.test(str[i])) { c++; if (c === target) return i + 1; }
    }
    return str.length;
  }

  // String (con o sin "." de agrupación) -> dígitos enteros + como mucho 2
  // decimales (null = todavía sin separador decimal).
  function toModel(str) {
    const commaIdx = str.indexOf(',');
    if (commaIdx === -1) return { intDigits: str.replace(/[^0-9]/g, ''), decDigits: null };
    return {
      intDigits: str.slice(0, commaIdx).replace(/[^0-9]/g, ''),
      decDigits: str.slice(commaIdx + 1).replace(/[^0-9]/g, '').slice(0, 2),
    };
  }
  function fromModel({ intDigits, decDigits }) {
    const clean = intDigits.replace(/^0+(?=\d)/, '');
    const grouped = clean.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return decDigits === null ? grouped : grouped + ',' + decDigits;
  }

  function setValueAndCaret(newVal, sigTarget) {
    input.value = newVal;
    const pos = posAtSigCount(newVal, sigTarget);
    input.setSelectionRange(pos, pos);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  input.addEventListener('beforeinput', e => {
    if (isFormulaMode()) return;
    if (e.data === '=' && input.value === '') return; // deja arrancar una fórmula
    if (e.inputType && e.inputType.startsWith('delete')) return; // el borrado lo procesa el listener de 'input'
    if (e.data == null) return; // undo/redo y similares: no tocar

    e.preventDefault();

    const before = input.value;
    const selStart = input.selectionStart, selEnd = input.selectionEnd;
    let model = selEnd > selStart
      ? toModel(before.slice(0, selStart) + before.slice(selEnd))
      : toModel(before);
    let { intDigits, decDigits } = model;
    const sigBefore = sigCountBefore(before, selStart);

    // Posición de inserción en intDigits — arranca en el cursor y avanza con
    // cada dígito entero aceptado, para que un e.data de varios caracteres
    // (pegar, autocompletar, IME) los vaya agregando en orden y no todos en
    // el mismo lugar (bug real: quedaba fija en sigBefore para todo el
    // batch, así que "5000" pegado guardaba "5").
    let introPos = Math.min(sigBefore, intDigits.length);
    let accepted = 0;
    for (const ch of e.data) {
      if (/[0-9]/.test(ch)) {
        if (decDigits === null) {
          intDigits = intDigits.slice(0, introPos) + ch + intDigits.slice(introPos);
          introPos++;
          accepted++;
        } else if (decDigits.length < 2) {
          decDigits += ch;
          accepted++;
        }
      } else if ((ch === '.' || ch === ',') && decDigits === null) {
        decDigits = '';
        accepted++;
      }
    }

    setValueAndCaret(fromModel({ intDigits, decDigits }), sigBefore + accepted);
  });

  input.addEventListener('input', () => {
    if (isFormulaMode()) return;
    const before = input.value;
    const pos = input.selectionStart;
    const sigBefore = sigCountBefore(before, pos);
    const rebuilt = fromModel(toModel(before));
    if (rebuilt !== before) {
      input.value = rebuilt;
      const newPos = posAtSigCount(rebuilt, sigBefore);
      input.setSelectionRange(newPos, newPos);
    }
  });

  input.addEventListener('blur', () => {
    if (isFormulaMode()) return;
    const { intDigits, decDigits } = toModel(input.value);
    input.value = fromModel({ intDigits, decDigits: decDigits === '' ? null : decDigits });
  });
};

// Dos <input> editables (USD y $) que se recalculan entre sí en vivo, en vez
// del viejo patrón toggle + 1 campo. Escribir en uno actualiza el otro (sin
// disparar su evento 'input', así que no hay bucle); notaEl muestra la
// cotización usada. Llamar attachCalcInput(input) y attachMoneyInput(input)
// sobre los dos ANTES de esto, para que la fórmula "=..." ya esté resuelta
// cuando este listener de blur recalcula.
window.attachDualPrecioInputs = function ({ usdInput, arsInput, notaEl }) {
  function actualizarNota() {
    if (!notaEl) return;
    const venta = window.dolarOficialVenta();
    notaEl.textContent = venta ? `Cotización usada: USD = ${fmtARS(venta)}` : '';
  }

  function recalcular(origen) {
    const srcInput = origen === 'USD' ? usdInput : arsInput;
    const dstInput = origen === 'USD' ? arsInput : usdInput;
    const val = parseMoneyString(srcInput.value);
    if (!isNaN(val)) {
      const dual = resolveDualPrecio(origen, val);
      if (dual) {
        dstInput.value = formatMoneyString(origen === 'USD' ? dual.precioARS : dual.precioUSD);
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
