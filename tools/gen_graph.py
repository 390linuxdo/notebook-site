import json, re
from pathlib import Path
from collections import defaultdict

DOCS = Path(__file__).resolve().parents[1] / "docs"
OUT  = DOCS / "assets" / "graph.json"

EXCLUDE = {
    "index.md",
    "graph.md",
}

link_re = re.compile(r'\[[^\]]+\]\(([^)]+)\)')
fm_level_re = re.compile(r'(?m)^level:\s*private\s*$')

def should_exclude(p: Path) -> bool:
    rel = p.relative_to(DOCS).as_posix()
    if "assets/" in rel:
        return True
    return rel in EXCLUDE

def md_files():
    for p in DOCS.rglob("*.md"):
        if should_exclude(p):
            continue
        yield p

def is_locked(text: str) -> bool:
    return bool(fm_level_re.search(text))

def to_url(md_path: Path) -> str:
    rel = md_path.relative_to(DOCS).as_posix()
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
    links = set()
    degree = defaultdict(int)

    # nodes
    for p in md_files():
        text = p.read_text(encoding="utf-8", errors="ignore")
        pid = str(p.resolve())
        nodes[pid] = {
            "id": pid,
            "title": title_of(text, p),
            "topic": topic_of(p),
            "locked": is_locked(text),
            "url": to_url(p),
            "degree": 0,   # 稍后填
        }

    # edges + degree
    for p in md_files():
        text = p.read_text(encoding="utf-8", errors="ignore")
        src_id = str(p.resolve())
        for m in link_re.finditer(text):
            tgt = resolve_link(p, m.group(1))
            if not tgt:
                continue
            tgt_id = str(tgt.resolve())
            if tgt_id in nodes and src_id in nodes:
                if (src_id, tgt_id) not in links:
                    links.add((src_id, tgt_id))
                    degree[src_id] += 1
                    degree[tgt_id] += 1

    for nid in nodes:
        nodes[nid]["degree"] = int(degree.get(nid, 0))

    graph = {
        "nodes": list(nodes.values()),
        "links": [{"source": s, "target": t} for s, t in sorted(links)]
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(graph, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUT} with {len(graph['nodes'])} nodes and {len(graph['links'])} links")

if __name__ == "__main__":
    main()
