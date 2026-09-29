"""Flatten a pnpm virtual store (node_modules/.pnpm) into one real node_modules.

cPanel's File Manager can't extract symlinks, so the package needs a plain
node_modules tree. Each package goes to the top level; when two versions of
the same package exist, the most-depended-on version goes to the top level and
the other is nested under the package(s) that need it (standard npm layout),
so Node's resolution finds the right version for each dependent.
"""
import os, shutil, sys
from collections import defaultdict

store, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)


def entries():
    for entry in sorted(os.listdir(store)):
        nm = os.path.join(store, entry, "node_modules")
        if entry != "node_modules" and os.path.isdir(nm):
            yield entry, nm


def names_in(nm):
    for n in os.listdir(nm):
        path = os.path.join(nm, n)
        if n.startswith("@") and os.path.isdir(path) and not os.path.islink(path):
            for s in os.listdir(path):
                yield f"{n}/{s}"
        else:
            yield n


# 1. Real packages per store entry, and every version of each package name.
real = defaultdict(list)          # entry -> [name, ...] real dirs it owns
versions = defaultdict(dict)      # name -> {realpath: src}
links = []                        # (entry, name, realpath) dependency links
for entry, nm in entries():
    for name in names_in(nm):
        src = os.path.join(nm, name)
        if os.path.islink(src):
            links.append((entry, name, os.path.realpath(src)))
        elif os.path.isdir(src):
            real[entry].append(name)
            versions[name][os.path.realpath(src)] = src

# 2. Pick the top-level version: the one most dependents link to.
uses = defaultdict(int)
for _, name, target in links:
    uses[(name, target)] += 1
root = {}
for name, vs in versions.items():
    root[name] = max(vs, key=lambda rp: (uses[(name, rp)], rp))

for name, rp in root.items():
    shutil.copytree(versions[name][rp], os.path.join(out, name), symlinks=False)

# 3. Nest any other version under each package that depends on it.
nested = 0
for entry, name, target in links:
    if name not in root or target == root[name]:
        continue
    for owner in real[entry]:
        if owner not in root:
            continue
        dest = os.path.join(out, owner, "node_modules", name)
        if not os.path.exists(dest):
            shutil.copytree(target, dest, symlinks=False)
            nested += 1

print(f"flattened {len(root)} packages ({nested} nested for version conflicts)")
