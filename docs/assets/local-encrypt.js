// Lightweight client-side decryptor for locally encrypted pages, plus a share helper.
(() => {
  const SITE_SALT = "notebook-site-v1";
  const STORAGE_PREFIX = "unlock:";
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const t = {
    title: "解锁加密内容",
    mnemonicLabel: "助记词：",
    mnemonicPlaceholder: "输入助记词（本地派生）",
    pageKeyLabel: "单页密钥：",
    pageKeyPlaceholder: "Base64 或 hex",
    unlock: "解锁",
    unlocking: "解锁中...",
    noBlocks: "未发现加密内容",
    badMnemonic: "助记词不能为空",
    badKey: "密钥格式错误",
    unlockFailMnemonic: "解锁失败，请检查助记词",
    unlockFailKey: "解锁失败，请检查页面密钥",
    unlockOk: (n) => `解锁成功 ${n} 个区块`,
    share: "分享",
    shareCancelled: "已取消",
    shareLinkCopied: (link) => `公开链接已复制：${link}`,
    shareKeyCopied: "单页密钥（已复制）：",
    shareKeyFail: "生成密钥失败，请检查助记词",
    sharePrompt: "输入助记词以生成此页密钥（仅本地使用）",
  };

  function bufToBase64(buf) {
    return btoa(String.fromCharCode(...buf));
  }
  function base64ToBuf(b64) {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  }
  function hexToBuf(hex) {
    const cleaned = hex.trim().replace(/^0x/, "");
    if (cleaned.length % 2) throw new Error("Hex length must be even");
    const out = new Uint8Array(cleaned.length / 2);
    for (let i = 0; i < cleaned.length; i += 2) {
      out[i / 2] = parseInt(cleaned.substr(i, 2), 16);
    }
    return out;
  }
  function normalizePath(path) {
    if (!path) return "/";
    let p = path.trim();
    if (!p.startsWith("/")) p = "/" + p;
    if (!p.endsWith("/")) p = p + "/";
    return p;
  }

  async function mnemonicToSeed(mnemonic, passphrase = "") {
    // BIP39 seed derivation without wordlist validation.
    const m = encoder.encode(mnemonic.normalize("NFKD"));
    const salt = encoder.encode(("mnemonic" + passphrase).normalize("NFKD"));
    const key = await crypto.subtle.importKey("raw", m, "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-512", iterations: 2048, salt },
      key,
      512
    );
    return new Uint8Array(bits);
  }

  async function hkdf(keyBytes, saltBytes, info, length = 32) {
    const key = await crypto.subtle.importKey("raw", keyBytes, "HKDF", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: saltBytes, info: encoder.encode(info) },
      key,
      length * 8
    );
    return new Uint8Array(bits);
  }

  async function deriveMaster(seedBytes) {
    return hkdf(seedBytes, encoder.encode(SITE_SALT), "master", 32);
  }

  async function derivePageKey(masterBytes, pagePath) {
    return hkdf(masterBytes, new Uint8Array(), normalizePath(pagePath), 32);
  }

  async function decryptBlock(block, keyBytes) {
    const iv = base64ToBuf(block.dataset.iv);
    const ct = base64ToBuf(block.dataset.ct);
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return decoder.decode(plain);
  }

  function setUnlocked(path) {
    try {
      sessionStorage.setItem(STORAGE_PREFIX + normalizePath(path), "1");
    } catch (_) {
      /* ignore */
    }
  }

  function getBlocks() {
    return Array.from(document.querySelectorAll(".encrypted-content"));
  }

  function statusArea() {
    let area = document.getElementById("local-encrypt-status");
    if (!area) {
      area = document.createElement("div");
      area.id = "local-encrypt-status";
      area.style.fontSize = "12px";
      area.style.marginTop = "6px";
      area.style.color = "#444";
    }
    return area;
  }

  function showStatus(msg, kind = "info") {
    const area = statusArea();
    area.textContent = msg;
    area.style.color = kind === "error" ? "#d32f2f" : "#444";
  }

  function parseKeyInput(raw) {
    const val = raw.trim();
    if (!val) throw new Error("密钥为空");
    if (/^[0-9a-fA-F]+$/.test(val.replace(/^0x/, ""))) {
      return hexToBuf(val);
    }
    // Assume base64
    return base64ToBuf(val);
  }

  function decodePath(raw) {
    if (!raw) return "/";
    const normed = normalizePath(raw);
    try {
      return normalizePath(decodeURIComponent(normed));
    } catch (_) {
      return normed;
    }
  }

  async function unlockWithPageKey(rawKey, onDone) {
    const blocks = getBlocks();
    if (!blocks.length) {
      showStatus(t.noBlocks, "error");
      return;
    }
    let keyBytes;
    try {
      keyBytes = parseKeyInput(rawKey);
    } catch (e) {
      showStatus(e.message || t.badKey, "error");
      return;
    }
    let ok = 0;
    for (const block of blocks) {
      const path = decodePath(block.dataset.path || location.pathname);
      try {
        const html = await decryptBlock(block, keyBytes);
        block.outerHTML = html;
        setUnlocked(path);
        ok++;
      } catch (_) {
        /* continue */
      }
    }
    showStatus(ok ? t.unlockOk(ok) : t.unlockFailKey, ok === 0 ? "error" : "info");
    if (typeof onDone === "function") onDone(ok > 0);
  }

  async function unlockWithMnemonic(mnemonic, onDone) {
    const blocks = getBlocks();
    if (!blocks.length) {
      showStatus(t.noBlocks, "error");
      return;
    }
    if (!mnemonic.trim()) {
      showStatus(t.badMnemonic, "error");
      return;
    }
    const seed = await mnemonicToSeed(mnemonic);
    const master = await deriveMaster(seed);
    let ok = 0;
    for (const block of blocks) {
      const path = decodePath(block.dataset.path || location.pathname);
      const key = await derivePageKey(master, path);
      try {
        const html = await decryptBlock(block, key);
        block.outerHTML = html;
        setUnlocked(path);
        ok++;
      } catch (_) {
        /* continue */
      }
    }
    showStatus(ok ? t.unlockOk(ok) : t.unlockFailMnemonic, ok === 0 ? "error" : "info");
    if (typeof onDone === "function") onDone(ok > 0);
  }

  function withSpinner(btn, fn) {
    const prev = btn.textContent;
    btn.disabled = true;
    btn.textContent = t.unlocking;
    const done = (ok) => {
      btn.disabled = false;
      btn.textContent = prev;
      if (!ok) btn.focus();
    };
    fn(done).catch((e) => {
      showStatus(e.message || t.unlockFailMnemonic, "error");
      done(false);
    });
  }

  function injectUI() {
    const blocks = getBlocks();
    if (!blocks.length) return;
    if (document.getElementById("local-encrypt-panel")) return;

    const panel = document.createElement("div");
    panel.id = "local-encrypt-panel";
    panel.style.border = "1px solid #ddd";
    panel.style.padding = "10px";
    panel.style.borderRadius = "8px";
    panel.style.margin = "10px 0";
    panel.style.background = "#f7f7f9";
    panel.style.fontSize = "14px";
    panel.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px;">${t.title}</div>
      <div style="margin-bottom:6px;">
        <label>${t.mnemonicLabel}</label>
        <input id="unlock-mnemonic" type="text" style="width:70%;" placeholder="${t.mnemonicPlaceholder}" />
        <button id="unlock-mnemonic-btn">${t.unlock}</button>
      </div>
      <div style="margin-bottom:6px;">
        <label>${t.pageKeyLabel}</label>
        <input id="unlock-pagekey" type="text" style="width:70%;" placeholder="${t.pageKeyPlaceholder}" />
        <button id="unlock-pagekey-btn">${t.unlock}</button>
      </div>
    `;
    const firstBlock = blocks[0];
    firstBlock.parentElement.insertBefore(panel, firstBlock);
    panel.appendChild(statusArea());

    const mBtn = panel.querySelector("#unlock-mnemonic-btn");
    const pBtn = panel.querySelector("#unlock-pagekey-btn");
    mBtn.addEventListener("click", () => {
      const val = panel.querySelector("#unlock-mnemonic").value;
      showStatus(t.unlocking);
      withSpinner(mBtn, (done) => unlockWithMnemonic(val, done));
    });
    pBtn.addEventListener("click", () => {
      const val = panel.querySelector("#unlock-pagekey").value;
      showStatus(t.unlocking);
      withSpinner(pBtn, (done) => unlockWithPageKey(val, done));
    });
  }

  function copyText(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).catch(() => {});
    }
  }

  function injectShareUI() {
    const container = document.querySelector(".md-content__inner") || document.body;
    if (!container) return;
    if (document.getElementById("share-btn")) return;

    const btn = document.createElement("button");
    btn.id = "share-btn";
    btn.textContent = t.share;
    btn.style.marginLeft = "10px";
    btn.style.padding = "6px 10px";
    btn.style.borderRadius = "6px";
    btn.style.border = "1px solid #ccc";
    btn.style.cursor = "pointer";
    btn.style.background = "#fff";

    const panel = document.createElement("div");
    panel.id = "share-panel";
    panel.style.marginTop = "6px";
    panel.style.fontSize = "13px";

    btn.onclick = async () => {
      const isEncrypted = !!document.querySelector(".encrypted-content");
      const path = decodePath(
        (document.querySelector(".encrypted-content") || {}).dataset?.path ||
          location.pathname
      );
      if (!isEncrypted) {
        const link = (location.origin || "") + path;
        panel.textContent = t.shareLinkCopied(link);
        copyText(link);
        return;
      }
      const mnemonic = prompt(t.sharePrompt);
      if (!mnemonic) {
        panel.textContent = t.shareCancelled;
        return;
      }
      try {
        const seed = await mnemonicToSeed(mnemonic);
        const master = await deriveMaster(seed);
        const key = await derivePageKey(master, path);
        const b64 = bufToBase64(key);
        panel.textContent = t.shareKeyCopied + b64;
        copyText(b64);
      } catch (e) {
        panel.textContent = t.shareKeyFail;
      }
    };

    const host = container.querySelector("h1");
    if (host && host.parentElement) {
      host.parentElement.insertBefore(btn, host.nextSibling);
    } else {
      container.insertBefore(btn, container.firstChild);
    }
    container.insertBefore(panel, container.firstChild);
  }

  document.addEventListener("DOMContentLoaded", () => {
    injectUI();
    injectShareUI();
  });
})();
