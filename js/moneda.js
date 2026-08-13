/* VIMECO S.A. — Formateo de números y moneda, y conversión USD→ARS en vivo
   (dólar oficial).

   Criterio general, igual que Excel: el valor guardado tiene toda su
   precisión y lo único que se elige acá es CUÁNTOS DECIMALES SE VEN. Ningún
   formateador redondea el dato: redondean la pantalla. */

/* ===== Decimales de la vista ===== */
(function () {
  const KEY = 'vimeco-decimales';
  const MIN = 0, MAX = 8, DEFAULT = 2;
  let cache = null;

  // Preferencia del navegador, no del dato: no viaja a Firebase, cada uno
  // mira los números con el detalle que le sirve.
  window.decimalesVista = function () {
    if (cache == null) {
      let guardado = NaN;
      try { guardado = parseInt(localStorage.getItem(KEY), 10); } catch (_) {}
      cache = isNaN(guardado) ? DEFAULT : Math.max(MIN, Math.min(MAX, guardado));
    }
    return cache;
  };

  window.setDecimalesVista = function (n) {
    const v = Math.max(MIN, Math.min(MAX, Math.round(n)));
    if (v === window.decimalesVista()) return;
    cache = v;
    try { localStorage.setItem(KEY, String(v)); } catch (_) {}
    renderControlDecimales();
    window.dispatchEvent(new CustomEvent('vimeco:decimales', { detail: v }));
  };

  // Cada pantalla pasa acá su render principal para redibujarse cuando
  // cambian los decimales, sin tener que volver a pedir datos.
  window.onDecimalesVista = function (render) {
    window.addEventListener('vimeco:decimales', () => render());
  };

  // Un valor que redondeado a los decimales que se muestran da cero, se
  // muestra como cero pelado — si no, un -0,000001 aparece como "-$ 0,00",
  // con un signo menos que no quiere decir nada.
  function snapCero(n, dec) {
    return Math.abs(n) < 0.5 * Math.pow(10, -dec) ? 0 : n;
  }

  function fmt(n, extra, dec) {
    if (dec == null) dec = window.decimalesVista();
    return snapCero(Number(n), dec).toLocaleString('es-AR',
      Object.assign({ minimumFractionDigits: dec, maximumFractionDigits: dec }, extra));
  }

  const vacio = n => n == null || n === '' || isNaN(n);

  // Número pelado (cantidades, coeficientes). '' si no hay valor: en una
  // grilla de carga, una celda vacía se lee mejor que un "0,00" inventado.
  window.fmtNum  = n => vacio(n) ? '' : fmt(n);
  window.fmtCoef = n => vacio(n) ? '' : fmt(n);
  window.fmtARS  = n => vacio(n) ? '' : fmt(n, { style: 'currency', currency: 'ARS' });
  window.fmtUSD  = n => vacio(n) ? '' : fmt(n, { style: 'currency', currency: 'USD' });

  // Recibe la FRACCIÓN (0.25), muestra el porcentaje (25%).
  window.fmtPct = frac => vacio(frac) ? '—' : fmt(frac * 100) + '%';

  /* ===== Coeficiente K (la "Carga Fija") ===== */
  // El K SIEMPRE se muestra con 4 decimales como mínimo, aunque el header
  // pida menos: no es plata, es el multiplicador que convierte costo en
  // precio sobre cientos de millones, así que "1,83" en vez de "1,8312"
  // mueve el presupuesto casi un 0,1%. Es la única excepción al selector:
  // todo lo que ENTRA en su cálculo (los % cargados, los subtotales) lo
  // sigue como el resto de la app. Si el header pide más de 4, manda el
  // header.
  const MIN_DECIMALES_K = 4;
  window.decimalesK = () => Math.max(MIN_DECIMALES_K, window.decimalesVista());
  window.fmtK = n => vacio(n) ? '' : fmt(n, null, window.decimalesK());

  /* ===== Control del header ===== */
  // Se inyecta al lado del dólar, así vale para todas las pantallas sin
  // tocar los 15 HTML. Muestra un ejemplo del formato ("0,00") en vez del
  // número de decimales: se entiende de un vistazo qué se va a ver.
  function ejemploFormato(dec) {
    return dec === 0 ? '0' : '0,' + '0'.repeat(dec);
  }

  function renderControlDecimales() {
    const el = document.querySelector('.hdr-decimales-valor');
    if (el) el.textContent = ejemploFormato(window.decimalesVista());
  }

  window.montarControlDecimales = function () {
    const dolarEl = document.getElementById('header-dolar');
    if (!dolarEl || document.querySelector('.hdr-decimales')) return;

    const cont = document.createElement('div');
    cont.className = 'hdr-decimales';
    cont.title = 'Decimales que se muestran. No cambia los valores guardados, que mantienen toda su precisión.';
    cont.innerHTML = `
      <button type="button" class="hdr-decimales-btn" data-paso="-1" title="Menos decimales">−</button>
      <span class="hdr-decimales-valor">${ejemploFormato(window.decimalesVista())}</span>
      <button type="button" class="hdr-decimales-btn" data-paso="1" title="Más decimales">+</button>`;
    dolarEl.insertAdjacentElement('afterend', cont);

    cont.querySelectorAll('.hdr-decimales-btn').forEach(btn => {
      btn.addEventListener('click', () =>
        window.setDecimalesVista(window.decimalesVista() + parseInt(btn.dataset.paso, 10)));
    });
  };
})();

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

// Un número chico (0.0000001) tiene toString() en notación científica
// ("1e-7"), que no se puede formatear con separadores de miles. Devuelve
// siempre la escritura decimal (con signo), sin ceros de relleno al final.
window.decimalString = function (n) {
  const s = n.toString();
  if (!s.includes('e')) return s;
  const expandido = n.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
  return expandido.includes('e') ? s : expandido;   // >= 1e21: no hay forma decimal, se deja como está
};

// Formatea un número (o string numérico) para mostrar en un input de plata:
// "." cada 3 dígitos de la parte entera, "," antes de los decimales que
// tenga (sin redondear — muestra la precisión real del valor). '' si no hay
// valor válido.
window.formatMoneyString = function (value) {
  if (value === null || value === undefined || value === '') return '';
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
  if (isNaN(n)) return '';
  const s = window.decimalString(n);
  const negativo = s.startsWith('-');
  const [intPart, decPart] = (negativo ? s.slice(1) : s).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (negativo ? '-' : '') + grouped + (decPart ? ',' + decPart : '');
};

// Inversa de formatMoneyString: saca los "." (son sólo agrupación) y
// convierte la "," decimal a ".", para volver a tener un número JS.
window.parseMoneyString = function (str) {
  if (str == null) return NaN;
  return parseFloat(String(str).trim().replace(/\./g, '').replace(',', '.'));
};

// Engancha el formateo de miles/decimales EN VIVO a un <input> de plata:
// "." tipeado se interpreta como separador decimal (se convierte a ",");
// mientras el campo tiene una fórmula "=..." en curso (ver attachCalcInput en
// calc.js) no se toca nada. Llamar attachCalcInput(input) ANTES de esto
// (mismo motivo que attachDualPrecioInputs: la fórmula tiene que estar
// resuelta antes de que esto la formatee).
window.attachMoneyInput = function (input) {
  // Marca el campo como "de plata" para valorCampo() en calc.js: su texto
  // agrupa miles con ".", así que se lee con parseMoneyString y no con
  // parseFloat.
  input.dataset.money = '1';

  // Tope de decimales que se pueden TIPEAR a mano. Antes era 2 (centavos),
  // pero los precios de la planilla vienen con más precisión (ej. $/kg con 4
  // decimales) y truncarlos al cargarlos arrastraba el error a todo el
  // cálculo. No es un tope de precisión del valor: un número calculado o
  // pegado puede tener todos los decimales que haga falta.
  const MAX_DECIMALES_TIPEO = 10;

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

  // String (con o sin "." de agrupación) -> dígitos enteros + decimales
  // (null = todavía sin separador decimal). No recorta decimales: el tope de
  // MAX_DECIMALES_TIPEO se aplica sólo al ACEPTAR caracteres nuevos (más
  // abajo), así un valor ya cargado con más precisión se muestra entero.
  function toModel(str) {
    const commaIdx = str.indexOf(',');
    if (commaIdx === -1) return { intDigits: str.replace(/[^0-9]/g, ''), decDigits: null };
    return {
      intDigits: str.slice(0, commaIdx).replace(/[^0-9]/g, ''),
      decDigits: str.slice(commaIdx + 1).replace(/[^0-9]/g, ''),
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
    // Un "." pegado/autocompletado en un batch de varios caracteres es un
    // separador de miles de un valor ya formateado (ej. "10.000.000" copiado
    // de otro lado), no un decimal tecleado a mano — si no se descarta acá,
    // el primer "." del batch abría modo decimal y truncaba el resto
    // (bug real: "10.000.000" pegado guardaba 10). Mismo criterio que
    // parseMoneyString, que ya ignora todos los "." y sólo mira la ",".
    // Un "." tecleado solo (e.data de 1 char) sigue interpretándose como
    // decimal, ver comentario de attachMoneyInput más arriba.
    const datos = e.data.length > 1 ? e.data.replace(/\./g, '') : e.data;
    for (const ch of datos) {
      if (/[0-9]/.test(ch)) {
        if (decDigits === null) {
          intDigits = intDigits.slice(0, introPos) + ch + intDigits.slice(introPos);
          introPos++;
          accepted++;
        } else if (decDigits.length < MAX_DECIMALES_TIPEO) {
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
  if (!document.getElementById('header-dolar')) return;
  window.montarControlDecimales();
  window.renderHeaderDolar();
});
