"""Builds the requisitions app from src/ into site/ (the folder that is published as <site board>/requisitions/).
Usage: python3 tools/build.py [--terser /path/to/terser] [--out site]
  js/NN-*.js are joined in name order into one app.js; every file the page loads carries a short hash of its
  content in its address (app.js?v=1a2b3c4d), and sw.js lists them so the app opens without a signal.
The build holds no project data: requisitions (and the letterhead the app prints on) live in the database and are
read after sign-in."""
import sys, os, re, json, hashlib, shutil, subprocess, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src')
args = sys.argv[1:]
OUT = os.path.join(ROOT, args[args.index('--out') + 1] if '--out' in args else 'site')
TERSER = args[args.index('--terser') + 1] if '--terser' in args else None

read = lambda p: open(p, encoding='utf-8').read()
h8 = lambda b: hashlib.sha256(b).hexdigest()[:10]

if os.path.isdir(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)
for d in ('fonts', 'icons', 'vendor'):
    shutil.copytree(os.path.join(SRC, d), os.path.join(OUT, d))
for f in ('logo.png', 'manifest.webmanifest', 'config.js', 'app.css'):
    shutil.copy(os.path.join(SRC, f), os.path.join(OUT, f))

cfg = read(os.path.join(SRC, 'config.js'))
api = re.search(r'url:\s*"(https://[^"]+)"', cfg).group(1)

ver = lambda rel: rel + '?v=' + h8(open(os.path.join(OUT, rel), 'rb').read())

# the app script: the modules in name order, inside one function so nothing leaks into the page
js = '\n'.join(read(p) for p in sorted(glob.glob(os.path.join(SRC, 'js', '*.js'))))
js = js.replace('__XLSX__', ver('vendor/xlsx.full.min.js'))
static = sorted(os.path.relpath(os.path.join(dp, f), OUT).replace(os.sep, '/') for dp, _, fs in os.walk(OUT) for f in fs)
build = h8(('\n'.join(f + ':' + h8(open(os.path.join(OUT, f), 'rb').read()) for f in static) + js + read(os.path.join(SRC, 'index.html')) + read(os.path.join(SRC, 'sw.js'))).encode())
js = "(function(){\n'use strict';\n" + js.replace('__BUILD__', build) + '\n})();\n'
app = os.path.join(OUT, 'app.js')
open(app, 'w', encoding='utf-8').write(js)
if TERSER:
    subprocess.run([TERSER, app, '--compress', 'passes=2', '--mangle', '--comments', 'false', '-o', app], check=True)

html = read(os.path.join(SRC, 'index.html')).replace('__API_ORIGIN__', api)
refs = ['app.css', 'app.js', 'config.js', 'vendor/supabase.js', 'logo.png', 'manifest.webmanifest', 'icons/favicon-32.png', 'icons/apple-touch-icon.png']
for rel in refs:
    n = len(re.findall(r'(?:href|src)="' + re.escape(rel) + '"', html))
    if not n:
        raise SystemExit('index.html does not load ' + rel)
    html = re.sub(r'((?:href|src)=")' + re.escape(rel) + '"', lambda m: m.group(1) + ver(rel) + '"', html)
open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8').write(html)

shell = ['./', 'index.html'] + [ver(r) for r in refs] + ['icons/icon-192.png'] + sorted('fonts/' + f for f in os.listdir(os.path.join(OUT, 'fonts')))
later = [ver('vendor/xlsx.full.min.js')]
sw = read(os.path.join(SRC, 'sw.js')).replace('__BUILD__', build).replace('__SHELL__', json.dumps(shell)).replace('__LATER__', json.dumps(later))
open(os.path.join(OUT, 'sw.js'), 'w', encoding='utf-8').write(sw)

# nothing in the published folder may hold project data or a placeholder that was not filled in; the letterhead
# and the register stay in the database
for dp, _, fs in os.walk(OUT):
    for f in fs:
        if 'letterhead' in f.lower() or 'seed' in f.lower():
            raise SystemExit(f + ' must not be published')
        if f.endswith(('.js', '.html', '.css', '.webmanifest')) and not f.endswith('.min.js') and f != 'supabase.js':
            t = read(os.path.join(dp, f))
            for bad in ('__BUILD__', '__SHELL__', '__LATER__', '__API_ORIGIN__', '__XLSX__'):
                if bad in t:
                    raise SystemExit(f + ' still holds ' + bad)
# no published file, pictures included, may carry a maker's mark of the tools it was made with
for dp, _, fs in os.walk(OUT):
    for f in fs:
        raw = open(os.path.join(dp, f), 'rb').read().lower()
        for bad in (b'clau' + b'de', b'anthro' + b'pic', b'cabx', b'c2pa'):
            if bad in raw:
                raise SystemExit(f + ' holds a mark that must not be published: ' + bad.decode())
size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(OUT) for f in fs)
print('built', OUT, '| build', build, '| app.js', os.path.getsize(app), 'bytes | total', round(size / 1024), 'KB |', len(shell), 'files kept for offline')
