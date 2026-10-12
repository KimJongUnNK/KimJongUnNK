import os, sys
D = os.path.dirname(os.path.abspath(__file__))
src = lambda f: open(os.path.join(D, 'src', f), encoding='utf-8').read()
order = ['core.js', 'boxes.js', 'display.js', 'numeric.js', 'cas.js', 'editor.js', 'shell.js', 'app-main.js', 'app-graph.js', 'app-stat.js', 'app-misc.js']
app = '\n'.join(src(f) for f in order)
nerd = open(os.path.join(D, 'node_modules/nerdamer-prime/all.min.js'), encoding='utf-8').read()
assert '</script' not in nerd.lower() and '</script' not in app.lower()
html = src('template.html').replace('/*__CSS__*/', src('styles.css')).replace('/*__NERDAMER__*/', nerd).replace('/*__APP__*/', app)
out = os.path.join(D, 'dist', 'MathPad-II.html')
open(out, 'w', encoding='utf-8').write(html)
print(out, round(len(html.encode('utf-8')) / 1024), 'KB')
