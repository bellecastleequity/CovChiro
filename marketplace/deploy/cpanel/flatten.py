"""Flatten a pnpm virtual store (node_modules/.pnpm) into one real node_modules."""
import os, shutil, sys

store, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
seen = {}
for entry in sorted(os.listdir(store)):
    nm = os.path.join(store, entry, "node_modules")
    if entry == "node_modules" or not os.path.isdir(nm):
        continue
    names = []
    for n in os.listdir(nm):
        path = os.path.join(nm, n)
        if n.startswith("@") and os.path.isdir(path) and not os.path.islink(path):
            names += [f"{n}/{s}" for s in os.listdir(path)]
        else:
            names.append(n)
    for name in names:
        src = os.path.join(nm, name)
        if os.path.islink(src) or not os.path.isdir(src):
            continue  # a dependency link; the real copy lives in its own store entry
        if name in seen:
            sys.exit(f"{name} found twice ({seen[name]} and {entry}); cannot flatten")
        seen[name] = entry
        shutil.copytree(src, os.path.join(out, name), symlinks=False)
print(f"flattened {len(seen)} packages")
