// Laedt nerdamer und die Quellen in einen vm-Kontext (wie im Browser, ohne DOM)
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
module.exports = function load() {
  const ctx = { console };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'node_modules/nerdamer-prime/all.min.js'), 'utf8') + ';this.nerdamer=nerdamer;', ctx);
  for (const f of ['core', 'boxes', 'display', 'numeric', 'cas']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
  return ctx;
};
