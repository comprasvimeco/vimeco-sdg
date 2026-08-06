/* VIMECO S.A. — Campos tipo Excel: si un input empieza con "=", lo evalúa como
   fórmula aritmética (+ - * / y paréntesis) al salir del campo, sin usar eval(). */

(function () {
  function evalFormula(expr) {
    let i = 0;

    function skipWs() { while (expr[i] === ' ') i++; }

    function parseNumber() {
      skipWs();
      const start = i;
      while (i < expr.length && /[0-9.]/.test(expr[i])) i++;
      if (start === i) throw new Error('Número inválido');
      return parseFloat(expr.slice(start, i));
    }

    function parseFactor() {
      skipWs();
      if (expr[i] === '(') {
        i++;
        const v = parseExpr();
        skipWs();
        if (expr[i] !== ')') throw new Error('Falta paréntesis de cierre');
        i++;
        return v;
      }
      if (expr[i] === '-') { i++; return -parseFactor(); }
      if (expr[i] === '+') { i++; return parseFactor(); }
      return parseNumber();
    }

    function parseTerm() {
      let v = parseFactor();
      skipWs();
      while (expr[i] === '*' || expr[i] === '/') {
        const op = expr[i]; i++;
        const rhs = parseFactor();
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

  function resolveIfFormula(input) {
    const raw = input.value.trim();
    if (!raw.startsWith('=')) return;
    try {
      const result = evalFormula(raw.slice(1));
      input.value = String(Math.round(result * 100) / 100);
    } catch (_) {
      // Fórmula inválida: se deja el texto tal cual para que el usuario la corrija.
    }
  }

  window.evalFormula = evalFormula;

  // Enganchar en cualquier <input>: escribir "=15*3+2" y al salir del campo
  // (blur) o Enter, se resuelve a "47".
  window.attachCalcInput = function (input) {
    input.addEventListener('blur', () => resolveIfFormula(input));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  };
})();
