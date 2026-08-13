/* VIMECO S.A. — Campos tipo Excel: si un input empieza con "=", lo evalúa como
   fórmula aritmética (+ - * / ^, paréntesis, "pi" y "raiz(...)") al salir del
   campo, sin usar eval(). */

// Redondea sólo lo necesario para eliminar ruido binario de punto flotante
// (ej. 0.1+0.2 = 0.30000000000000004) — no limita la precisión real del
// valor, que puede seguir teniendo tantos decimales como haga falta. Usado
// en todo punto de la app donde se guarda un valor calculado (no tipeado a
// mano), para no arrastrar redondeo prematuro a los cálculos siguientes.
//
// El recorte es a 15 CIFRAS SIGNIFICATIVAS, no a una cantidad fija de
// decimales — mismo criterio que Excel, que también guarda 15 significativas
// sobre un double. La versión anterior redondeaba a 8 decimales con
// Math.round(n * 1e8) / 1e8, que además de poner un techo arbitrario a la
// precisión, con importes grandes hacía lo contrario de lo que promete: a
// partir de ~9e7 el producto n * 1e8 se pasa del entero seguro de JS y el
// redondeo INTRODUCE ruido en vez de sacarlo.
window.roundLimpio = function (n) {
  if (typeof n !== 'number' || !isFinite(n) || n === 0) return n;
  return parseFloat(n.toPrecision(15));
};

(function () {
  function evalFormula(expr) {
    let i = 0;

    function skipWs() { while (expr[i] === ' ') i++; }

    // Acepta los dos separadores decimales: "47.5" (el que inserta la
    // calculadora flotante) y "47,5" (el que se tipea acá). Si el número
    // trae coma, los "." que tenga son agrupación de miles y se descartan
    // ("1.234,56"), mismo criterio que parseMoneyString.
    function parseNumber() {
      skipWs();
      const start = i;
      while (i < expr.length && /[0-9.,]/.test(expr[i])) i++;
      if (start === i) throw new Error('Número inválido');
      const crudo = expr.slice(start, i);
      const n = parseFloat(crudo.includes(',') ? crudo.replace(/\./g, '').replace(',', '.') : crudo);
      if (isNaN(n)) throw new Error('Número inválido');
      return n;
    }

    // Número, constante "pi", función "raiz(...)" o subexpresión entre paréntesis.
    function parseAtom() {
      skipWs();
      if (expr.slice(i, i + 2).toLowerCase() === 'pi' && !/[a-zA-Z]/.test(expr[i + 2] || '')) {
        i += 2;
        return Math.PI;
      }
      if (expr.slice(i, i + 4).toLowerCase() === 'raiz') {
        i += 4;
        skipWs();
        if (expr[i] !== '(') throw new Error('Falta "(" después de raiz');
        i++;
        const v = parseExpr();
        skipWs();
        if (expr[i] !== ')') throw new Error('Falta paréntesis de cierre');
        i++;
        if (v < 0) throw new Error('Raíz de un número negativo');
        return Math.sqrt(v);
      }
      if (expr[i] === '(') {
        i++;
        const v = parseExpr();
        skipWs();
        if (expr[i] !== ')') throw new Error('Falta paréntesis de cierre');
        i++;
        return v;
      }
      return parseNumber();
    }

    // "^" liga más fuerte que el signo unario (igual que en Excel: -2^2 = -4,
    // no 4) y es asociativo a derecha (2^3^2 = 2^(3^2)). El exponente puede
    // tener su propio signo (2^-3).
    function parsePower() {
      const base = parseAtom();
      skipWs();
      if (expr[i] === '^') {
        i++;
        return Math.pow(base, parseUnary());
      }
      return base;
    }

    function parseUnary() {
      skipWs();
      if (expr[i] === '-') { i++; return -parseUnary(); }
      if (expr[i] === '+') { i++; return parseUnary(); }
      return parsePower();
    }

    function parseTerm() {
      let v = parseUnary();
      skipWs();
      while (expr[i] === '*' || expr[i] === '/') {
        const op = expr[i]; i++;
        const rhs = parseUnary();
        v = op === '*' ? v * rhs : v / rhs;
        skipWs();
      }
      return v;
    }

    function parseExpr() {
      let v = parseTerm();
      skipWs();
      while (expr[i] === '+' || expr[i] === '-') {
        const op = expr[i]; i++;
        const rhs = parseTerm();
        v = op === '+' ? v + rhs : v - rhs;
        skipWs();
      }
      return v;
    }

    const result = parseExpr();
    skipWs();
    if (i !== expr.length) throw new Error('Expresión inválida');
    if (!isFinite(result)) throw new Error('Resultado inválido');
    return result;
  }

  // El resultado se escribe con la coma decimal de la app, no con el punto de
  // String(n): los campos de plata leen su contenido con parseMoneyString,
  // que trata al "." como separador de miles — un "47.5" se guardaba como 475
  // (el resto de los campos numéricos ya aceptan los dos separadores).
  function textoResultado(n) {
    const s = window.decimalString ? window.decimalString(n) : String(n);
    return s.replace('.', ',');
  }

  function resolveIfFormula(input) {
    const raw = input.value.trim();
    if (!raw.startsWith('=')) { delete input.dataset.formula; return; }
    try {
      const result = evalFormula(raw.slice(1));
      input.dataset.formula = raw;
      input.value = textoResultado(roundLimpio(result));
    } catch (_) {
      // Fórmula inválida: se deja el texto tal cual para que el usuario la corrija.
    }
  }

  window.evalFormula = evalFormula;

  // Devuelve la fórmula "=..." que generó el valor actual del campo, o null
  // si el valor fue tipeado directo (sin fórmula, o se sobrescribió una
  // fórmula vieja con un número plano).
  window.getCalcFormula = input => input.dataset.formula || null;

  // Para inputs ESTÁTICOS (el mismo <input> se reutiliza en distintas
  // aperturas de un modal, ej. materiales.js/equipos.js/manoDeObra.js): usar
  // esto al abrir el modal para cargar/limpiar la fórmula guardada, en vez
  // de volver a llamar attachCalcInput (que duplicaría los listeners).
  window.setCalcFormula = function (input, formula) {
    if (formula) input.dataset.formula = formula;
    else delete input.dataset.formula;
  };

  // Enganchar en cualquier <input>: escribir "=15*3+2" y al salir del campo
  // (blur) o Enter, se resuelve a "47" -- guardando la fórmula en el propio
  // input (dataset.formula), así que si el llamador la persiste (ver
  // getCalcFormula) y la vuelve a pasar acá como initialFormula, enfocar el
  // campo de nuevo muestra "=15*3+2" en vez del resultado, igual que Excel.
  window.attachCalcInput = function (input, initialFormula) {
    if (initialFormula) input.dataset.formula = initialFormula;

    input.addEventListener('focus', () => {
      if (input.dataset.formula) input.value = input.dataset.formula;
    });
    input.addEventListener('blur', () => resolveIfFormula(input));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  };
})();
