"""
Encrypt private pages post-build using BIP39-derived keys.
Usage (run after mkdocs build):
  ENCRYPT_MNEMONIC="<your mnemonic>" python tools/lock_pages.py

Env:
  ENCRYPT_MNEMONIC / MNEMONIC : BIP39 seed phrase used to derive per-page keys
  ALLOW_UNENCRYPTED=1         : allow skipping encryption when mnemonic missing
"""
import base64
import os
import re
import sys
import unicodedata
from pathlib import Path
from typing import Iterable, List, Tuple

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
SITE = ROOT / "site"
SITE_SALT = b"notebook-site-v1"
ARTICLE_RE = re.compile(
    r'(<article[^>]*class="[^"]*md-content__inner[^"]*"[^>]*>)(.*?)(</article>)',
    re.S | re.IGNORECASE,
)
FM_LEVEL_RE = re.compile(r"(?m)^level:\s*private\s*$")


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("utf-8")


def mnemonic_to_seed(mnemonic: str, passphrase: str = "") -> bytes:
    """BIP39 PBKDF2, without wordlist validation. Mirrors front-end (NFKD)."""
    from hashlib import pbkdf2_hmac

    m = unicodedata.normalize("NFKD", mnemonic)
    s = unicodedata.normalize("NFKD", "mnemonic" + passphrase)
    return pbkdf2_hmac(
        "sha512", m.encode("utf-8"), s.encode("utf-8"), 2048, dklen=64
    )


def hkdf(length: int, salt: bytes, info: bytes, key_material: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=length, salt=salt, info=info).derive(
        key_material
    )


def derive_master(seed: bytes) -> bytes:
    return hkdf(32, SITE_SALT, b"master", seed)


def derive_page_key(master: bytes, page_path: str) -> bytes:
    path = normalize_path(page_path).encode("utf-8")
    return hkdf(32, b"", path, master)


def normalize_path(path: str) -> str:
    p = path.strip()
    if not p.startswith("/"):
        p = "/" + p
    if not p.endswith("/"):
        p = p + "/"
    return p


def to_url(md_path: Path) -> str:
    rel = md_path.relative_to(DOCS).as_posix()
    lower = rel.lower()
    if lower == "index.md":
        return "/"
    if lower.endswith("/index.md"):
        topic = rel.split("/", 1)[0]
        return "/" + topic.strip("/") + "/"
    if lower.endswith(".md"):
        rel = rel[:-3]
    return "/" + rel.strip("/") + "/"


def site_html_path(md_path: Path) -> Path:
    rel = md_path.relative_to(DOCS)
    lower = rel.as_posix().lower()
    if lower == "index.md":
        return SITE / "index.html"
    if lower.endswith("/index.md"):
        return SITE / rel.parent / "index.html"
    stem = rel.with_suffix("")
    return SITE / stem / "index.html"


def md_files() -> Iterable[Path]:
    for p in DOCS.rglob("*.md"):
        if "assets" in p.parts:
            continue
        yield p


def private_pages() -> List[Tuple[Path, str, Path]]:
    result = []
    for md in md_files():
        text = md.read_text(encoding="utf-8", errors="ignore")
        if not FM_LEVEL_RE.search(text):
            continue
        url = to_url(md)
        html_path = site_html_path(md)
        result.append((md, url, html_path))
    return result


def encrypt_html(key: bytes, html: str) -> Tuple[str, str]:
    iv = os.urandom(12)
    aes = AESGCM(key)
    ct = aes.encrypt(iv, html.encode("utf-8"), None)
    return b64(iv), b64(ct)


def wrap_encrypted(original_html: str, page_path: str, iv: str, ct: str) -> str:
    # Replace article content; if not found, wrap whole body.
    m = ARTICLE_RE.search(original_html)
    payload = (
        f'<div class="encrypted-content" data-path="{page_path}" data-iv="{iv}" data-ct="{ct}">'
        f'<div class="md-typeset">'
        f"<p>此页面已加密，输入助记词或单页密钥解锁。</p>"
        f"<p>路径: {page_path}</p>"
        f"</div>"
        f"</div>"
    )
    if m:
        before = original_html[: m.start(2)]
        after = original_html[m.end(2) :]
        return before + payload + after

    # Fallback to body replacement
    body_re = re.compile(r"(<body[^>]*>)(.*?)(</body>)", re.S | re.IGNORECASE)
    mb = body_re.search(original_html)
    if not mb:
        raise RuntimeError("Cannot find content container to encrypt")
    before = original_html[: mb.start(2)]
    after = original_html[mb.end(2) :]
    return before + payload + after


def already_encrypted(html_text: str) -> bool:
    return "encrypted-content" in html_text


def lock_page(master: bytes, url_path: str, html_path: Path) -> bool:
    if not html_path.exists():
        print(f"[WARN] HTML not found for {url_path}: {html_path}")
        return False
    text = html_path.read_text(encoding="utf-8")
    if already_encrypted(text):
        print(f"[SKIP] already encrypted: {url_path}")
        return False
    key = derive_page_key(master, url_path)
    iv, ct = encrypt_html(key, extract_content(text))
    wrapped = wrap_encrypted(text, url_path, iv, ct)
    html_path.write_text(wrapped, encoding="utf-8")
    print(f"[OK] encrypted {url_path}")
    return True


def extract_content(html_text: str) -> str:
    m = ARTICLE_RE.search(html_text)
    if m:
        return m.group(2)
    body_re = re.compile(r"<body[^>]*>(.*?)</body>", re.S | re.IGNORECASE)
    mb = body_re.search(html_text)
    if mb:
        return mb.group(1)
    raise RuntimeError("Cannot locate content to encrypt")


def main() -> int:
    mnemonic = (
        os.environ.get("ENCRYPT_MNEMONIC")
        or os.environ.get("MNEMONIC")
        or os.environ.get("BIP39_MNEMONIC")
    )
    allow_unencrypted = os.environ.get("ALLOW_UNENCRYPTED") == "1"

    pages = private_pages()
    if not pages:
        print("[INFO] No private pages found; nothing to encrypt.")
        return 0
    if not mnemonic:
        msg = "[ERROR] Private pages detected but no ENCRYPT_MNEMONIC provided."
        if allow_unencrypted:
            print(msg + " Skipping due to ALLOW_UNENCRYPTED=1.")
            return 0
        print(msg + " Set ENCRYPT_MNEMONIC to proceed.")
        return 1

    seed = mnemonic_to_seed(mnemonic)
    master = derive_master(seed)

    success = 0
    for md, url, html_path in pages:
        try:
            if lock_page(master, url, html_path):
                success += 1
        except Exception as e:
            print(f"[ERROR] Failed to encrypt {url}: {e}")

    print(f"[DONE] Encrypted {success}/{len(pages)} private pages.")
    return 0 if success == len(pages) else 1


if __name__ == "__main__":
    sys.exit(main())
