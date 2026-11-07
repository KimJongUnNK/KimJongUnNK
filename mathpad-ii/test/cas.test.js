// Rechenkern-Tests: Eingabe wie getippt -> Anzeige als linearer Text
const { MP } = require('./load')();
const env = { settings: { angle: 'rad', decimal: false, complex: 'real', fmt: { mode: 'norm1' } }, vars: {}, fns: {}, userFns: new Set(), ans: null };
MP.userFns = env.userFns;
function calc(s, opts) {
  Object.assign(env.settings, { angle: 'rad', decimal: false, complex: 'real', fmt: { mode: 'norm1' } }, opts || {});
  try {
    const ast = MP.core.parseString(s, { split: true, userFns: env.userFns });
    const r = MP.cas.evaluate(ast, env);
    if (r.exact && r.exact.type !== 'text') env.ans = r.exact;
    return MP.B.text(MP.display.toRow(r.ast, { fmt: env.settings.fmt }));
  } catch (e) { return 'ERR: ' + e.message; }
}
const D = { angle: 'deg' };
const T = [
  // Grundrechnen, exakt
  ['1/2+1/3', '(5)/(6)'], ['2(3+4)', '14'], ['-2^2', '-4'], ['2^3^2', '512'], ['10/4', '(5)/(2)'], ['2^100', '1267650600228229401496703205376'],
  ['sqrt(8)', '2*sqrt(2)'], ['sqrt(12)+sqrt(27)', '5*sqrt(3)'], ['sqrt(2)*sqrt(12)', '2*sqrt(6)'], ['1/sqrt(2)', '(sqrt(2))/(2)'], ['root(-8,3)', '-2'],
  ['123456789*987654321', '121932631112635269'], ['5!', '120'], ['nCr(5,2)', '10'], ['gcd(12,18)', '6'], ['mod(17,5)', '2'], ['floor(3.7)', '3'],
  // Dezimal
  ['0.1+0.2', '0.3'], ['approx(1/3)', '0.3333333333'], ['approx(pi)', '3.141592654'], ['2/3+0.5', '1.166666667'], ['1.5E-3*2', '3ᴇ-3'],
  ['1/3', '0.3333333333', { decimal: true }], ['2/3', '0.67', { decimal: true, fmt: { mode: 'fix', n: 2 } }],
  // Algebra
  ['expand((x+1)^3)', 'x^(3)+3*x^(2)+3*x+1'], ['factor(x^2-5x+6)', '(x-2)*(x-3)'], ['simplify((x^2-1)/(x-1))', 'x+1'], ['2x+3y-x', 'x+3*y'],
  ['simplify(sin(x)^2+cos(x)^2)', '1'],
  // Gleichungen
  ['solve(x^2-5x+6=0,x)', '{x=2,x=3}'], ['solve(x^2=2,x)', '{x=-sqrt(2),x=sqrt(2)}'], ['solve(x^2+1=0,x)', 'No Solution'], ['solve(e^x=5,x)', '{x=log(5)}'],
  ['solve(x^4-10x^2+9=0,x)', '{x=-3,x=-1,x=1,x=3}'], ['solve(x^3-6x^2+11x-6=0,x)', '{x=1,x=2,x=3}'], ['solve(x*e^x=1,x)', '{x=0.5671432904}'],
  ['solve(sin(x)=1/2,x)', '{x=2*constn(1)*π+(π)/(6),x=2*constn(1)*π+(5*π)/(6)}'], ['solve(sin(x)=1/2,x)', '{x=360*constn(1)+30,x=360*constn(1)+150}', D],
  ['solve({x+y=3,x-y=1},{x,y})', '{x=2,y=1}'], ['solve({x^2+y^2=25,x-y=1})', '{{x=-3,y=-4},{x=4,y=3}}'], ['solve(x^2>4,x)', '{x<-2,2<x}'],
  ['solve(x^2≤9,x)', '{-3≤x≤3}'], ['solve(1/x>0,x)', '{0<x}'], ['solve(x^2+1=0,x)', '{x=i,x=-i}', { complex: 'cplx' }],
  // Analysis
  ['diff(x^4,x,2)', '12*x^(2)'], ['diff(sin(x)*x^2,x)', 'x^(2)*cos(x)+2*x*sin(x)'], ['integrate(x*e^x,x)', 'x*e^(x)-e^(x)'],
  ['integrate(x^2,x,0,3)', '9'], ['integrate(sin(x),x,0,pi)', '2'], ['integrate(abs(x),x,-1,1)', '1'], ['integrate(1/x^2,x,1,Infinity)', '1'],
  ['integrate(e^(-x^2),x,0,1)', '0.7468241328'], ['lim(sin(x)/x,x,0)', '1'], ['lim((1+1/n)^n,n,Infinity)', 'e'], ['lim(1/x,x,0)', 'Undefined'],
  ['sum(k^2,k,1,10)', '385'], ['sum(k^2,k,1,n)', '(n*(2*n+1)*(n+1))/(6)'], ['sum((1/2)^k,k,0,Infinity)', '2'], ['sum(1/k^2,k,1,Infinity)', '(π^(2))/(6)'],
  ['product(k,k,1,5)', '120'],
  // Trig, Logs, Winkel
  ['sin(pi/6)', '(1)/(2)'], ['cos(pi/4)', '(sqrt(2))/(2)'], ['sin(30)', '(1)/(2)', D], ['asin(1/2)', '30', D], ['atan(1)', '(π)/(4)'],
  ['log(1000)', '3'], ['log(2,8)', '3'], ['ln(e^2)', '2'], ['log(2)', 'log(2)'],
  // Komplex, Matrizen, Listen
  ['(2+3i)(1-i)', '5+i'], ['(1+i)/(1-i)', 'i'], ['abs(3+4i)', '5'], ['e^(i*pi)', '-1'], ['sqrt(-4)', 'ERR: Non-Real in Calc'],
  ['det([[1,2][3,4]])', '-2'], ['trn([[1,2][3,4]])', '[[1,3][2,4]]'], ['{1,2,3}*2', '{2,4,6}'], ['mean({1,2,3,4})', '(5)/(2)'], ['median({3,1,2})', '2'],
  // Verteilungen (Referenzwerte aus Tabellen; Inverse wie am ClassPad: t, χ², F mit rechtem Ende)
  ['normPDf(0)', '0.3989422804'], ['normCDf(-1.96,1.96,1,0)', '0.9500042097'], ['normCDf(-Infinity,0)', '0.5'], ['invNormCDf(0.975)', '1.959963985'],
  ['invNormCDf(0.5,15,100)', '100'], ['binomialPDf(3,10,0.5)', '0.1171875'], ['binomialCDf(0,3,10,0.5)', '0.171875'], ['poissonPDf(2,3)', '0.2240418077'],
  ['poissonCDf(0,2,3)', '0.4231900811'], ['geoPDf(3,0.2)', '0.128'], ['tCDf(-2.228,2.228,10)', '0.9499882282'], ['chiCDf(0,3.841,1)', '0.9499863162'],
  ['invTCDf(0.025,10)', '2.228138852'], ['invChiCDf(0.05,1)', '3.841458821'], ['invFCDf(0.05,5,10)', '3.32583453'], ['invBinomialCDf(0.5,10,0.5)', '5'],
  ['invPoissonCDf(0.9,3)', '5'], ['invGeoCDf(0.5,0.2)', '4'],
  // Fehler
  ['1/0', 'Undefined'], ['3+*4', 'ERR: Syntax ERROR'],
  // Variablen und Funktionen (Reihenfolge wichtig)
  ['2⇒a', '2'], ['a^2+a', '6'], ['define f(x)=x^2+1', 'done'], ['f(3)', '10'], ['diff(f(x),x)', '2*x'], ['3', '3'], ['ans*2', '6']
];
let bad = 0;
for (const [inp, exp, opts] of T) {
  const out = calc(inp, opts);
  if (out !== exp) { bad++; console.log('✗ ' + inp.padEnd(34) + ' => ' + out + '   (erwartet ' + exp + ')'); }
}
console.log((T.length - bad) + '/' + T.length + ' Rechenkern-Tests bestanden');
process.exit(bad ? 1 : 0);
