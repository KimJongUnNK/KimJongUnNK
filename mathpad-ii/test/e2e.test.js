// Browser-Tests (Playwright): bedient die fertige HTML-Datei wie ein Mensch
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node-tools/node_modules/playwright'); }
const { chromium } = pw;
const path = require('path');
const FILE = 'file://' + path.join(__dirname, '..', 'dist', 'MathPad-II.html');
let fails = 0;
const ok = (name, cond, info) => { if (!cond) fails++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); };
async function run(viewport, fn) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(FILE);
  await page.waitForTimeout(400);
  await fn(page);
  ok('keine JS-Fehler', !errs.length, errs);
  await browser.close();
}
(async () => {
  await run({ width: 1440, height: 860 }, async page => {
  const outs = () => page.$$eval('.entry .out', els => els.map(e => e.textContent));
  // 1) Tippen wie am Mac
  const typeExe = async s => { await page.keyboard.type(s); await page.keyboard.press('Enter'); await page.waitForTimeout(60); };
  await typeExe('sqrt(2)*sqrt(8)');
  let o = await outs(); ok('sqrt(2)*sqrt(8)=4', o[o.length - 1] === '4', o[o.length - 1]);
  await typeExe('2^10');
  o = await outs(); ok('2^10 → 1024', o[o.length - 1] === '1024', o[o.length - 1]);
  // Potenz-Template: Exponent verlassen mit Pfeil
  await page.keyboard.type('x^2+2x+1'); await page.keyboard.press('Enter');
  o = await outs(); ok('x^2+2x+1 bleibt', /x2\+2·x\+1/.test(o[o.length - 1]), o[o.length - 1]);
  await typeExe('factor(ans)');
  o = await outs(); ok('factor(ans) = (x+1)^2', /\(x\+1\)2/.test(o[o.length - 1]), o[o.length - 1]);
  // 2) Fehlerdialog
  await typeExe('3+*4');
  const dlg = await page.$('.dlg .msg.err');
  ok('Syntax-Fehlerdialog', !!dlg, dlg ? await dlg.textContent() : null);
  await page.keyboard.press('Enter');
  ok('Dialog per Enter zu', !(await page.$('.dlg')));
  await page.keyboard.press('Alt+Backspace');
  // 3) alte Zeile bearbeiten: hoch, ändern, EXE
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
  await page.keyboard.type('12'); await page.keyboard.press('Enter');
  for (let i = 0; i < 10 && await page.evaluate(() => MP.App.apps.main.editIdx < MP.App.apps.main.entries.length); i++) await page.keyboard.press('ArrowDown');
  o = await outs(); ok('2^12 nach Bearbeiten = 4096', o.includes('4096'), o);
  // 4) Ergebnis anklicken → in Eingabe
  await page.keyboard.press('Alt+Backspace');
  const out0 = (await page.$$('.entry .out'))[0];
  await out0.click();
  await page.keyboard.type('+1'); await page.keyboard.press('Enter');
  o = await outs(); ok('Ergebnis übernommen: 4+1=5', o[o.length - 1] === '5', o[o.length - 1]);
  // 5) ½⇔0.5
  await typeExe('1/3');
  await page.keyboard.press('ArrowRight');
  await page.click('.toolbar button[title="Letztes Ergebnis exakt/dezimal"]');
  o = await outs(); ok('Toggle 1/3 → 0.3333333333', o[o.length - 1] === '0.3333333333', o[o.length - 1]);
  // 6) Deg-Modus über Statusleiste
  await page.click('.statusbar button:has-text("Rad")');
  await typeExe('sin(30)');
  o = await outs(); ok('Deg: sin(30)=1/2', o[o.length - 1] === '12', o[o.length - 1]);
  await page.click('.statusbar button:has-text("Deg")'); await page.click('.statusbar button:has-text("Gra")');
  // 7) Shift + Clear = aus, Clear = an
  await page.click('[data-k="SHIFT"]'); await page.click('[data-k="CLEAR"]');
  ok('Ausgeschaltet', await page.$eval('#screen', e => e.classList.contains('off')));
  await page.click('[data-k="CLEAR"]');
  ok('Eingeschaltet', !(await page.$eval('#screen', e => e.classList.contains('off'))));
  // 8) Hardware-Tasten: 7 × 8 EXE
  for (const k of ['7', '×', '8', 'EXE']) await page.click('[data-k="' + k + '"]');
  o = await outs(); ok('Tasten 7×8=56', o[o.length - 1] === '56', o[o.length - 1]);
  // 9) Define + Funktion
  await typeExe('define f(x)=x^2-3');
  await page.keyboard.type('f(4)'); await page.keyboard.press('Enter');
  o = await outs(); ok('Define f, f(4)=13', o[o.length - 1] === '13', o.slice(-2));
  // 10) Reload: Verlauf bleibt
  const n0 = (await outs()).length;
  await page.waitForTimeout(500);
  await page.reload(); await page.waitForTimeout(500);
  const n1 = (await outs()).length;
  ok('Verlauf nach Reload', n0 === n1 && n1 > 5, [n0, n1]);
  // 11) Graph: neue Funktion tippen, Wheel-Zoom, ∫dx, Schnittpunkt
  await page.click('.ipanel [data-icon="menu"]'); await page.click('.amenu button:has-text("Graph")');
  await page.click('.frow >> nth=3');
  await page.keyboard.type('x^2/4-1');
  await page.keyboard.press('Enter');
  const chk = await page.$eval('.frow >> nth=3', el => el.querySelector('input').checked);
  ok('y4 nach EXE aktiviert', chk);
  await page.click('.toolbar button[title="Graph zeichnen"]');
  const v0 = await page.evaluate(() => Object.assign({}, MP.App.apps.graph.view));
  const cv = await page.$('.gwrap');
  const bb = await cv.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(100);
  const v1 = await page.evaluate(() => Object.assign({}, MP.App.apps.graph.view));
  ok('Mausrad zoomt raus', v1.xmax - v1.xmin > v0.xmax - v0.xmin, [v0.xmax - v0.xmin, v1.xmax - v1.xmin]);
  await page.mouse.move(bb.x + 100, bb.y + 100); await page.mouse.down(); await page.mouse.move(bb.x + 160, bb.y + 120, { steps: 5 }); await page.mouse.up();
  const v2 = await page.evaluate(() => Object.assign({}, MP.App.apps.graph.view));
  ok('Ziehen verschiebt', v2.xmin < v1.xmin, [v1.xmin, v2.xmin]);
  await page.evaluate(() => MP.App.apps.graph.zoom('init'));
  await page.click('.toolbar button[title="G-Solve"]'); await page.click('.ddmenu button:has-text("∫dx")');
  await page.fill('#gi-a', '0'); await page.fill('#gi-b', 'pi'); await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const info = await page.$eval('.ginfo', e => e.textContent);
  ok('∫dx sin von 0 bis π = 2', /∫dx=2\b/.test(info), info);
  await page.keyboard.press('Escape');
  await page.click('.toolbar button[title="G-Solve"]'); await page.click('.ddmenu button:has-text("Intersection")');
  const info2 = await page.$eval('.ginfo', e => e.textContent);
  ok('Intersection gefunden', /x=/.test(info2), info2);
  await page.keyboard.press('Escape');
  // View Window Dialog
  await page.click('.toolbar button[title="Funktionseditor"]');
  await page.click('.toolbar button[title="View Window"]');
  await page.fill('#vw-xmin', '-2π'); await page.fill('#vw-xmax', '2π'); await page.keyboard.press('Enter');
  const v3 = await page.evaluate(() => MP.App.apps.graph.view.xmax);
  ok('View Window xmax=2π', Math.abs(v3 - 2 * Math.PI) < 1e-9, v3);
  // 12) Statistik: One-Variable
  await page.click('.ipanel [data-icon="menu"]'); await page.click('.amenu button:has-text("Statistics")');
  for (const v of [1, 2, 3, 4, 5]) { await page.keyboard.type(String(v)); await page.keyboard.press('Enter'); }
  await page.keyboard.press('ArrowRight');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowUp');
  for (const v of [2.2, 4.1, 5.9, 8.2, 9.9]) { await page.keyboard.type(String(v)); await page.keyboard.press('Enter'); }
  await page.click('.toolbar button[title="One-Variable"]'); await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const res = await page.$$eval('.dlg table.res tr', trs => trs.map(t => t.textContent));
  ok('1-Var x̄ von 1..5 = 3', res.some(r => r === 'x̄3'), res.slice(0, 3));
  await page.keyboard.press('Enter');
  // Formel nach Graph kopieren
  await page.click('.toolbar button[title="Regression"]'); await page.click('.ddmenu button:has-text("Quadratic Reg")'); await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  await page.click('.dlg button:has-text("→ Graph")');
  const msg = await page.$eval('.dlg .msg', e => e.textContent);
  ok('Formel kopiert', /y\d+/.test(msg), msg);
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  // 13) Rotate über Icon
  const l0 = await page.$eval('#device', e => e.classList.contains('land'));
  await page.click('.ipanel [data-icon="rotate"]'); await page.waitForTimeout(600);
  ok('Rotate wechselt Ausrichtung', l0 !== await page.$eval('#device', e => e.classList.contains('land')));
  const fb = await page.$eval('#fit', e => [e.offsetWidth, e.offsetHeight]);
  ok('Rotate: Gerät liegt quer', fb[0] > fb[1] * 2, fb);
  // echtes Querformat: Display links, Tastenfeld rechts daneben, nichts gedreht
  const geo = await page.evaluate(() => {
    const r = s => document.querySelector(s).getBoundingClientRect();
    const sc = r('#screen'), k7 = r('[data-k="7"]'), k8 = r('[data-k="8"]');
    return { screenWide: sc.width > sc.height * 1.5, keysRight: k7.left > sc.right, rowUpright: Math.abs(k7.top - k8.top) < 1 && k8.left > k7.left, noRotate: getComputedStyle(document.getElementById('screen')).transform === 'none' };
  });
  ok('Querformat: Display breit, Tasten rechts und aufrecht', geo.screenWide && geo.keysRight && geo.rowUpright && geo.noRotate, geo);
  await page.click('[data-k="KEYBOARD"]'); await page.waitForTimeout(150);
  const kbFit = await page.evaluate(() => { const pad = document.querySelector('.softkb .pad').getBoundingClientRect(); const bs = [...document.querySelectorAll('.softkb .pad button')]; return bs.every(b => b.getBoundingClientRect().bottom <= pad.bottom + 1); });
  ok('Querformat: Soft-Keyboard komplett sichtbar', kbFit);
  await page.click('[data-k="KEYBOARD"]');
  await page.click('.ipanel [data-icon="rotate"]'); await page.waitForTimeout(600);
  // Enter nach Klick auf eine Taste = EXE, nicht die Taste nochmal
  await page.click('.ipanel [data-icon="main"]');
  await page.keyboard.press('Alt+Backspace');
  await page.click('[data-k="9"]'); await page.keyboard.press('Enter');
  const o9 = await outs(); ok('Klick 9 + Enter = 9', o9[o9.length - 1] === '9', o9[o9.length - 1]);
  });
  await run({ width: 1920, height: 1080 }, async page => {
  const outs = () => page.$$eval('.entry .out', els => els.map(e => e.textContent));
  // Rechenzeiten im Browser
  const heavy = ['solve(x^4-10x^2+9=0,x)', 'integrate(x^3*e^(2x),x)', 'solve(sin(x)=x/2,x)', 'sum(k^3,k,1,n)', 'expand((a+b+c)^4)', 'factor(x^6-1)', 'integrate(1/(x^2+4x+5),x,-2,0)', 'lim((e^x-1)/x,x,0)', '50!', 'solve({x+y+z=6,2x-y+z=3,x+2y-z=2},{x,y,z})', 'solve(x^3+x-1=0,x)', 'det([[1,2,3][4,5,6][7,8,10]])'];
  for (const s of heavy) {
    const t0 = Date.now();
    await page.keyboard.type(s); await page.keyboard.press('Enter');
    await page.waitForFunction(n => document.querySelectorAll('.entry .out').length >= n || document.querySelector('.dlg'), heavy.indexOf(s) + 1, { timeout: 15000 }).catch(() => {});
    const dt = Date.now() - t0;
    const o = await outs();
    const err = await page.$('.dlg .msg');
    ok('schnell: ' + s, dt < 3000, dt); console.log(('    ') + ' ' + s.padEnd(48) + String(dt).padStart(5) + 'ms  ' + (err ? 'ERR ' + await err.textContent() : o[o.length - 1]));
    if (err) await page.keyboard.press('Enter'), await page.keyboard.press('Alt+Backspace');
  }
  await page.waitForTimeout(200);
  // Interactive solve-Dialog
  await page.keyboard.type('x^2-9');
  await page.click('.menubar button:has-text("Interactive")');
  await page.click('.ddmenu button:has-text("Equation/Inequality")');
  await page.click('.ddmenu[data-level="1"] button:has-text("solve")');
  await page.keyboard.press('Enter');
  let o = await outs(); ok('Interactive solve x^2-9', o[o.length - 1] === '{x=−3,x=3}', o[o.length - 1]);
  // Polar und x=
  await page.click('.ipanel [data-icon="menu"]'); await page.click('.amenu button:has-text("Graph")');
  await page.click('.sheets button:has-text("Sheet2")');
  await page.click('.frow >> nth=0');
  await page.click('.toolbar button[title="Typ"]'); await page.click('.ddmenu button:has-text("r=")');
  await page.keyboard.type('2cos(3θ)'.replace('θ', 'theta')); await page.keyboard.press('Enter');
  await page.click('.toolbar button[title="Typ"]'); await page.click('.ddmenu button:has-text("x=")');
  await page.keyboard.type('y^2/4-2'); await page.keyboard.press('Enter');
  await page.click('.toolbar button[title="Graph zeichnen"]');
  await page.click('.toolbar button[title="Trace"]');
  await page.keyboard.press('ArrowRight');
  const tag = await page.$eval('.gtag', e => e.textContent);
  ok('Polar-Trace', /r1/.test(tag), tag);
  await page.keyboard.press('Escape');
  await page.click('.sheets button:has-text("Sheet1")');
  // Soft-Keyboard im Graph-Editor
  await page.click('.frow >> nth=6');
  await page.click('[data-k="KEYBOARD"]');
  await page.click('.softkb .tabs button:has-text("Trig")');
  await page.click('.softkb .pad button:has-text("tan")');
  await page.click('[data-k="x"]'); await page.click('[data-k=")"]'); await page.click('[data-k="EXE"]');
  const y7 = await page.evaluate(() => MP.App.apps.graph.fns()[6]);
  ok('Soft-Keyboard tan(x) in y7', y7.on && JSON.stringify(y7.items).includes('"tan"'), y7.items.length);
  await page.click('[data-k="KEYBOARD"]');
  // Statistik: Histogramm + Box
  await page.click('.ipanel [data-icon="menu"]'); await page.click('.amenu button:has-text("Statistics")');
  await page.click('.menubar button:has-text("Edit")'); await page.click('.ddmenu button:has-text("Beispieldaten")');
  await page.click('.toolbar button[title="StatGraph Setting"]');
  await page.selectOption('#sg-t', 'hist'); await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await page.click('.toolbar button[title="StatGraph Setting"]');
  await page.selectOption('#sg-t', 'box'); await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const binfo = await page.$eval('.ginfo', e => e.textContent);
  ok('MedBox', /Med 4\.5/.test(binfo), binfo);
  // Num Solve mit zwei Variablen
  await page.click('.ipanel [data-icon="menu"]'); await page.click('.amenu button:has-text("NumSolve")');
  await page.click('.solv .eq .fx'); await page.keyboard.press('Alt+Backspace');
  await page.keyboard.type('a*x^2=50');
  await page.waitForTimeout(100);
  await page.fill('input[data-v="a"]', '2'); await page.fill('input[data-v="x"]', '1');
  await page.click('.toolbar button:has-text("Solve")');
  const xv = await page.$eval('input[data-v="x"]', e => e.value);
  ok('Num Solve a·x²=50 (a=2) → x=5', xv === '5', xv);
  });
  // Erscheinungsbild, Hochformat und die weiteren Apps
  await run({ width: 1440, height: 900 }, async page => {
    const theme = () => page.evaluate(() => [document.documentElement.dataset.theme, MP.App.themePref, MP.App.theme]);
    const fb = await page.$eval('#fit', e => [e.offsetWidth, e.offsetHeight]);
    ok('Start im Hochformat', fb[1] > fb[0] * 2, fb);
    ok('Dunkel ist Standard', JSON.stringify(await theme()) === '["dark","dark","dark"]', await theme());
    const lcdBg = () => page.$eval('#screen', e => getComputedStyle(e).backgroundColor);
    ok('LCD dunkel', await lcdBg() === 'rgb(0, 0, 0)', await lcdBg());
    const open = async name => { await page.click('.ipanel [data-icon="menu"]'); await page.click('.amenu button:has-text("' + name + '")'); await page.waitForTimeout(250); };
    await open('Graph&Table');
    await page.click('.toolbar button[title="Graph zeichnen"]'); await page.waitForTimeout(150);
    const px = () => page.evaluate(() => { const c = document.querySelector('.gwrap canvas'); const d = c.getContext('2d').getImageData(3, 3, 1, 1).data; return [d[0], d[1], d[2]]; });
    ok('Graph-Hintergrund dunkel', (await px()).every(v => v < 20), await px());
    await page.click('#theme-seg [data-pref="light"]'); await page.waitForTimeout(700);
    ok('Umschalten auf Hell', JSON.stringify(await theme()) === '["light","light","light"]', await theme());
    ok('LCD hell', await lcdBg() === 'rgb(255, 255, 255)', await lcdBg());
    ok('Graph neu gezeichnet (hell)', (await px()).every(v => v > 235), await px());
    ok('Segment-Zustand', await page.$eval('#theme-seg [data-pref="light"]', e => e.getAttribute('aria-checked')) === 'true');
    await page.reload(); await page.waitForTimeout(500);
    ok('Hell bleibt nach Reload', (await theme())[0] === 'light', await theme());
    // Pfeiltasten in der Radiogruppe wechseln das Theme und landen nicht im Rechner
    await page.focus('#theme-seg [data-pref="light"]');
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(600);
    ok('Pfeil rechts → Dunkel', (await theme())[1] === 'dark', await theme());
    // Auto folgt dem System, auch live
    await page.emulateMedia({ colorScheme: 'light' });
    await page.click('#theme-seg [data-pref="auto"]'); await page.waitForTimeout(600);
    ok('Auto + System hell → hell', JSON.stringify(await theme()) === '["light","auto","light"]', await theme());
    await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(600);
    ok('Auto folgt System live → dunkel', (await theme())[0] === 'dark', await theme());
    await page.click('#theme-seg [data-pref="dark"]'); await page.waitForTimeout(600);
    // Ausrichtung über die Titelleiste
    await page.click('#orient-seg [data-orient="land"]'); await page.waitForTimeout(600);
    ok('Titelleiste: Quer', await page.evaluate(() => MP.App.land && document.querySelector('#orient-seg [data-orient="land"]').getAttribute('aria-checked') === 'true'));
    await page.click('.ipanel [data-icon="rotate"]'); await page.waitForTimeout(600);
    ok('Rotate-Icon synchronisiert die Titelleiste', await page.evaluate(() => !MP.App.land && document.querySelector('#orient-seg [data-orient="portrait"]').getAttribute('aria-checked') === 'true'));
    await page.click('#orient-seg [data-orient="portrait"]'); await page.waitForTimeout(300);
    ok('Hoch bleibt Hoch', !(await page.evaluate(() => MP.App.land)));
    // Hilfe-Popover
    await page.click('#btn-help');
    ok('Hilfe offen', !(await page.$eval('#help', e => e.hidden)));
    await page.keyboard.press('Escape');
    ok('Esc schließt Hilfe', await page.$eval('#help', e => e.hidden));
    await page.click('#btn-help'); await page.mouse.click(30, 400);
    ok('Klick daneben schließt Hilfe', await page.$eval('#help', e => e.hidden));
    // App-Menü: alle 15 Apps
    await page.click('.ipanel [data-icon="menu"]');
    const apps = await page.$$eval('.amenu button', b => b.map(x => x.textContent));
    ok('15 Apps im Menü', apps.length === 15, apps);
    // Financial: Rate für 10 000 auf 60 Monate zu 4 %
    await page.click('.amenu button:has-text("Financial")'); await page.waitForTimeout(200);
    await page.fill('input[data-k="FV"]', '0');
    await page.click('input[name="fin-unk"] >> nth=3');
    await page.click('.toolbar button[title="Berechnen (EXE)"]');
    const fin = await page.$eval('.solv .res', e => e.textContent);
    ok('TVM: PMT ≈ 184.17', /184\.1[67]/.test(fin), fin);
    // Spreadsheet: Summe mit Formel
    await open('Spreadsheet');
    const c5 = await page.$$eval('.ltab tbody tr', r => r[4] ? r[4].children[3].textContent : r.map(x => x.textContent));
    ok('Spreadsheet C5 = 19.9', c5 === '19.9', c5);
    // eActivity: Beispiel durchgerechnet
    await open('eActivity');
    const ea = await page.$$eval('.ea .entry', r => r.map(x => x.textContent).join(' | '));
    ok('eActivity rechnet', ea.includes('{x=−1,x=1}') && ea.includes('done'), ea);
    // Program: quadrat mit a=1, b=-3, c=2
    await open('Program');
    await page.selectOption('.pg-sel', 'quadrat');
    await page.click('.toolbar button[title="Programm ausführen"]');
    for (const v of ['1', '-3', '2']) { await page.waitForSelector('#pg-in'); await page.fill('#pg-in', v); await page.keyboard.press('Enter'); await page.waitForTimeout(120); }
    await page.waitForTimeout(400);
    const pout = await page.$$eval('.pg-line', l => l.map(x => x.textContent).join(' | '));
    ok('Program quadrat → x=1, x=2', /x=1/.test(pout) && /x=2/.test(pout), pout);
    // Geometry: Strecke zeichnen und messen
    await open('Geometry');
    const n0 = await page.evaluate(() => MP.App.apps.geom.objs.length);
    await page.click('.toolbar button[title="Strecke"]');
    const gb = await (await page.$('.gwrap')).boundingBox();
    await page.mouse.click(gb.x + 30, gb.y + 40); await page.mouse.click(gb.x + 120, gb.y + 40);
    const n1 = await page.evaluate(() => MP.App.apps.geom.objs.length);
    ok('Geometry: Strecke mit 2 Punkten', n1 === n0 + 3, [n0, n1]);
    await page.click('.toolbar button[title="Auswahl/Ziehen"]');
    await page.mouse.click(gb.x + 75, gb.y + 40);
    const gi = await page.$eval('.ginfo', e => e.textContent);
    ok('Geometry misst Länge', /Länge \d/.test(gi), gi);
    // E-CON: Messung sofort starten, Werte nach Statistics
    await open('E-CON EA-200');
    await page.selectOption('#ec-sensor', 'temp');
    await page.selectOption('#ec-trig', 'now');
    await page.click('.toolbar button[title="Messung starten"]');
    await page.waitForFunction(() => !MP.App.apps.econ.running && MP.App.apps.econ.data.length === 120, null, { timeout: 8000 }).catch(() => {});
    const ec = await page.evaluate(() => [MP.App.apps.econ.data.length, MP.App.apps.econ.data[0][1]]);
    ok('E-CON: 120 Messwerte, Start ≈ 85 °C', ec[0] === 120 && Math.abs(ec[1] - 85) < 0.5, ec);
    await page.click('.toolbar button[title="In Statistics öffnen (Regression)"]'); await page.waitForTimeout(300);
    const st = await page.evaluate(() => [MP.App.curName, MP.App.apps.stat.lists[0].length, MP.App.apps.stat.lists[1].length]);
    ok('E-CON → Statistics list1/list2', st[0] === 'stat' && st[1] === 120 && st[2] === 120, st);
    // Sequence, Conics, DiffEq, 3D: zeichnen ohne Fehler
    for (const a of ['Sequence', 'Conics', 'DiffEqGraph', '3D Graph']) await open(a);
    ok('Grafik-Apps geöffnet', (await page.evaluate(() => MP.App.curName)) === 'g3d');
  });
  // iPhone/iPad: das Gerät folgt dem Drehen
  {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto(FILE); await page.waitForTimeout(500);
    ok('Touch quer → Querformat-Gerät', await page.evaluate(() => MP.App.land));
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(700);
    ok('Touch hochkant → Hochformat-Gerät', !(await page.evaluate(() => MP.App.land)));
    const sw = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    ok('Touch: kein seitliches Scrollen', sw);
    ok('Touch: keine JS-Fehler', !errs.length, errs);
    await browser.close();
  }
  console.log(fails ? fails + ' Browser-Tests fehlgeschlagen' : 'Alle Browser-Tests bestanden');
  process.exit(fails ? 1 : 0);
})();
