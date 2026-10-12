"""Download the Aslense videos for the chosen glosses into <out>/<gloss>/<file>."""
import csv, sys, os, urllib.parse, urllib.request
raw, out = sys.argv[1], sys.argv[2]
glosses = set(sys.argv[3].split(','))
idx = {}
for line in open(os.path.join(raw, 'aslense_index.tsv')):
    p, _ = line.rstrip('\n').split('\t'); idx[p.split('/', 1)[1]] = p
base = "https://huggingface.co/datasets/ZahidYasinMittha/American-Sign-Language-Dataset/resolve/main/"
n = 0
for w, f in list(csv.reader(open(os.path.join(raw, 'aslense.csv'))))[1:]:
    g = w.lower()
    if g not in glosses or f not in idx: continue
    if os.environ.get('SKIP_AUG') and '_aug_' in f: continue
    d = os.path.join(out, g); os.makedirs(d, exist_ok=True)
    dst = os.path.join(d, f.replace('/', '_'))
    if os.path.exists(dst): continue
    try:
        urllib.request.urlretrieve(base + urllib.parse.quote(idx[f]), dst); n += 1
    except Exception as e:
        print('fail', f, e, flush=True)
    if n % 100 == 0: print(n, flush=True)
print('done', n)
