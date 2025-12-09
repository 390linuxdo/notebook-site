import json, re, hashlib
from pathlib import Path
from collections import defaultdict

DOCS = Path(__file__).resolve().parents[1] / "docs"
OUT  = DOCS / "assets" / "graph.json"

EXCLUDE_EXACT = {"index.md", "graph.md"}

link_re = re.compile(r'\[[^\]]+\]\(([^)]+)\)')
fm_level_re = re.compile(r'(?m)^level:\s*private\s*$')

def relposix(p: Path) -> str:
    return p.relative_to(DOCS).as_posix()

def should_exclude(p: Path) -> bool:
    rel = relposix(p)
    if "assets/" in rel:
        return True
    if rel in EXCLUDE_EXACT:
        return True
    if rel.endswith("/index.md"):
        return True
    return False

def md_files():
    for p in DOCS.rglob("*.md"):
        if should_exclude(p):
            continue
        yield p

def is_locked(text: str) -> bool:
    return bool(fm_level_re.search(text))

def to_url(md_path: Path) -> str:
    rel = relposix(md_path)
    if rel.lower() == "index.md":
        return "/"
    if rel.endswith(".md"):
        rel = rel[:-3]
    return "/" + rel.strip("/") + "/"

def topic_of(md_path: Path) -> str:
    rel = md_path.relative_to(DOCS).parts
    return rel[0] if len(rel) > 1 else "root"

def title_of(text: str, md_path: Path) -> str:
    for line in text.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return md_path.stem

def stable_code(md_path: Path) -> str:
    rel = relposix(md_path).lower()
    h = hashlib.sha1(rel.encode("utf-8")).hexdigest()[:6].upper()
    return f"LOCK-{h}"

def resolve_link(src_path: Path, raw: str):
    raw = raw.strip()
    if re.match(r'^[a-zA-Z]+://', raw):
        return None
    if raw.startswith("#") or raw.startswith("mailto:") or raw.startswith("tel:"):
        return None
    raw = raw.split("#", 1)[0].strip()
    if not raw:
        return None

    target = (src_path.parent / raw).resolve()
    if target.suffix.lower() != ".md":
        return None
    if not target.exists():
        return None
    try:
        target.relative_to(DOCS.resolve())
    except Exception:
        return None
    if should_exclude(target):
        return None
    return target

def main():
    nodes = {}
    directed = set()  # (src_id, tgt_id)
    degree = defaultdict(int)

    # nodes
    for p in md_files():
        text = p.read_text(encoding="utf-8", errors="ignore")
        pid = str(p.resolve())
        locked = is_locked(text)
        nodes[pid] = {
            "id": pid,
            "title": title_of(text, p),
            "topic": topic_of(p),
            "locked": locked,
            "url": to_url(p),
            "degree": 0,
            "code": stable_code(p) if locked else None,
        }

    # directed edges
    for p in md_files():
        text = p.read_text(encoding="utf-8", errors="ignore")
        src_id = str(p.resolve())
        for m in link_re.finditer(text):
            tgt = resolve_link(p, m.group(1))
            if not tgt:
                continue
            tgt_id = str(tgt.resolve())
            if src_id in nodes and tgt_id in nodes:
                directed.add((src_id, tgt_id))

    # merge per pair
    merged = []
    seen_pairs = set()
    for (a, b) in directed:
        key = tuple(sorted([a, b]))
        if key in seen_pairs:
            continue
        seen_pairs.add(key)

        a2b = (a, b) in directed
        b2a = (b, a) in directed

        if a2b and b2a:
            dirflag = "both"
            src, tgt = a, b  # 任意，前端会画双箭头
        elif a2b:
            dirflag = "a2b"
            src, tgt = a, b
        elif b2a:
            dirflag = "b2a"
            src, tgt = a, b  # 注意：这时箭头应该指向 a（前端处理）
        else:
            continue

        cross = nodes[a]["topic"] != nodes[b]["topic"]
        ltype = "cross" if cross else ("mutual" if dirflag == "both" else "oneway")

        merged.append({
            "source": src,
            "target": tgt,
            "type": ltype,
            "dir": dirflag
        })

        degree[a] += 1
        degree[b] += 1

    for nid in nodes:
        nodes[nid]["degree"] = int(degree.get(nid, 0))

    graph = {"nodes": list(nodes.values()), "links": merged}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(graph, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUT} with {len(graph['nodes'])} nodes and {len(graph['links'])} links")

if __name__ == "__main__":
    main()
