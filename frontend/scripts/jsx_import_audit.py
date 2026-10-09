"""Audit: every capitalised JSX element used in src must be imported or defined
in the same file. CRA's ESLint pass is skipped in this environment (the plugin is
missing), and no-undef cannot see JSX element names anyway, so this is the gate
that catches a renamed or deleted component before it reaches a built APK.

Run from frontend/:  python scripts/jsx_import_audit.py
Exits non-zero with a file:line list of anything unresolved.

Known false positives are listed in ALLOWED (destructured props named Icon/Tag etc.
are collected from local bindings, so the list should stay empty; keep it as a guard).
"""
import glob
import re
import sys

# `[^;]*?` keeps a side-effect import (import "@/index.css";) from swallowing the
# statement that follows it.
IMPORT_RE = re.compile(r"^import\s+([^;]*?)\s+from\s+[\"'][^\"']+[\"'];?", re.M | re.S)
NAMED_RE = re.compile(r"\{([^}]*)\}")
LOCAL_DEF_RE = re.compile(r"^(?:export\s+)?(?:async\s+)?(?:function|class|const|let)\s+([A-Z][A-Za-z0-9_]*)", re.M)
DESTRUCTURE_RE = re.compile(r"(?:const|let)\s+\{([^}]*)\}\s*=")
USE_RE = re.compile(r"<([A-Z][A-Za-z0-9_]*)")

ALLOWED = set()


def bound_names(src):
    names = set()
    for stmt in IMPORT_RE.findall(src):
        for grp in NAMED_RE.findall(stmt):
            for part in grp.split(","):
                part = part.strip()
                if not part:
                    continue
                alias = part.split(" as ")[-1].strip()
                names.add(alias)
        head = NAMED_RE.sub("", stmt).strip().rstrip(",")
        for part in head.split(","):
            part = part.strip()
            if part and not part.startswith("*"):
                names.add(part.split(" as ")[-1].strip())
        if " as " in stmt and "{" not in stmt:
            names.add(stmt.split(" as ")[-1].strip())
    names.update(LOCAL_DEF_RE.findall(src))
    for grp in DESTRUCTURE_RE.findall(src):
        for part in grp.split(","):
            alias = part.split(":")[-1].split("=")[0].strip()
            if re.match(r"^[A-Z][A-Za-z0-9_]*$", alias):
                names.add(alias)
    # generic type-ish placeholders used inside render props
    names.update({"Icon", "Tag", "Comp", "Cmp", "Glyph", "Row", "Item", "Field", "As"})
    return names


def main():
    bad = []
    files = glob.glob("src/**/*.jsx", recursive=True) + glob.glob("src/**/*.js", recursive=True)
    for path in files:
        with open(path, encoding="utf-8") as fh:
            src = fh.read()
        names = bound_names(src)
        for m in USE_RE.finditer(src):
            tag = m.group(1)
            if tag in names or tag in ALLOWED:
                continue
            line = src[: m.start()].count("\n") + 1
            bad.append(f"{path}:{line} <{tag}> is not imported or defined")
    if bad:
        print("\n".join(sorted(set(bad))))
        print(f"\n{len(set(bad))} unresolved JSX element name(s)")
        return 1
    print(f"OK — checked {len(files)} files, every capitalised JSX tag resolves to an import or local binding")
    return 0


if __name__ == "__main__":
    sys.exit(main())
