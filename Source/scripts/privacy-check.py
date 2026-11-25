#!/usr/bin/env python3
"""Dawaya privacy gate.

Fails the build when a change re-introduces something the privacy rules forbid.
The rules and every allowlisted host live in Source/privacy.config.json; this
script checks the code, the native mirrors and the generated artifacts against
that single file.

Run from anywhere:

    /usr/bin/python3 Source/scripts/privacy-check.py
    /usr/bin/python3 Source/scripts/privacy-check.py --list-hosts

Exit 0 = clean, exit 1 = blocking violations printed. No dependencies, no
network. Wired into scripts/sync-web.sh, macos/build-macos.sh,
windows/build-windows.sh and the Android Gradle preBuild task.
"""

import importlib.util
import json
import os
import re
import sys
import tempfile

SOURCE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(SOURCE)
WEBAPP = os.path.join(SOURCE, "webapp")
WWW = os.path.join(SOURCE, "www")
NATIVE = os.path.join(SOURCE, "native")
ANDROID_ROOT = os.path.join(SOURCE, "android")
ANDROID = os.path.join(ANDROID_ROOT, "app", "src", "main")
IOS = os.path.join(SOURCE, "ios", "App", "App")
MACOS = os.path.join(SOURCE, "macos")
WINDOWS = os.path.join(SOURCE, "windows")
SCRIPTS = os.path.join(SOURCE, "scripts")

SKIP_DIRS = {
    "node_modules", "build", "dist", ".git", ".gradle", "DerivedData",
    "Pods", "intermediates", ".idea", "public", "www",
}

CONFIG_PATH = os.path.join(SOURCE, "privacy.config.json")

with open(CONFIG_PATH, encoding="utf-8") as _handle:
    CONFIG = json.load(_handle)

NET = CONFIG["network"]
REMOTE = [entry for entry in NET["allowedHosts"] if entry.get("localhost") is not True]
REMOTE_BY_HOST = {entry["host"].lower(): entry for entry in REMOTE}
ALLOWED_HOSTS = {entry["host"].lower() for entry in NET["allowedHosts"]}
LOOPBACK_HOSTS = {
    entry["host"].lower() for entry in NET["allowedHosts"] if entry.get("localhost") is True
}
LINK_HOSTS = {
    host.lower() for host in CONFIG.get("links_only_never_fetched", {}).get("hosts", [])
}
# Model-download hosts are a declared class of their own: reachable only
# through DawayaNet.modelDownload (web) or the native downloaders, named in
# the two CSPs and in ai code without ever joining network.allowedHosts.
MODEL_HOSTS = {
    str(entry.get("host", "")).lower()
    for entry in (CONFIG.get("modelDownload") or {}).get("hosts") or []
    if entry.get("host")
}
PLAINTEXT_KEYS = set(CONFIG["storage"]["plaintextAllowedKeys"])
USER_KEYS = set(CONFIG["storage"]["localUserDataKeys"])
STORAGE_KEYS = PLAINTEXT_KEYS | USER_KEYS
BANNED_SYMBOLS = CONFIG["dependencies"]["bannedStrings"]

# Not network traffic: XML namespaces and retired keys that are only ever removed.
NAMESPACE_HOSTS = {"www.w3.org"}
LEGACY_REMOVED_KEYS = {"drugcopeia-ai-drugs-v2"}

findings = []
scanned = []


def add(kind, path, line, detail, blocking=True):
    findings.append({
        "kind": kind,
        "path": rel(path) if path else "",
        "line": line or 0,
        "detail": detail,
        "blocking": blocking,
    })


def rel(path):
    try:
        if path.startswith(SOURCE + os.sep):
            return os.path.relpath(path, SOURCE).replace(os.sep, "/")
        if path.startswith(REPO + os.sep):
            return os.path.relpath(path, REPO).replace(os.sep, "/")
    except (TypeError, ValueError):
        pass
    return path


def walk(directory, extensions, allow_ai=False):
    found = []
    if not os.path.isdir(directory):
        return found
    for base, dirs, files in os.walk(directory):
        dirs[:] = [
            name for name in dirs
            if name not in SKIP_DIRS and (allow_ai or name != "ai")
        ]
        for name in files:
            if any(name.endswith(extension) for extension in extensions):
                found.append(os.path.join(base, name))
    return sorted(found)


def read(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.read()
    except (OSError, UnicodeDecodeError):
        return ""


def line_at(text, index):
    if index is None or index < 0:
        return 0
    return text.count("\n", 0, index) + 1


def line_of(text, pattern):
    match = re.search(pattern, text)
    return line_at(text, match.start()) if match else 0


def is_comment(line, prefix="#"):
    stripped = line.strip()
    return (
        stripped.startswith(prefix)
        or stripped.startswith("//")
        or stripped.startswith("///")
        or stripped.startswith("*")
        or stripped.startswith("/*")
        or stripped.startswith("<!--")
    )


def strip_line_comments(text, marker="//"):
    """Drop // comments so a documented removal is not a violation."""
    lines = []
    for line in text.splitlines():
        index = line.find(marker)
        if index >= 0:
            line = line[:index]
        lines.append(line)
    return "\n".join(lines)


WEB_SHIPPED = [
    path for path in walk(WEBAPP, (".js", ".html"))
    if "/ai/" not in path.replace(os.sep, "/")
]
WEB_DIRECT = [
    path for path in WEB_SHIPPED
    if os.path.basename(path) not in ("net.js", "service-worker.js")
    and "/generated/" not in path.replace(os.sep, "/")
]
AI_FILES = walk(os.path.join(WEBAPP, "ai"), (".js",))
NATIVE_SOURCES = (
    walk(IOS, (".swift", ".strings"))
    + walk(MACOS, (".swift",))
    + walk(ANDROID, (".java",))
    + walk(WINDOWS, (".go",))
    + walk(NATIVE, (".js",))
)
CODE_SYMBOL_FILES = WEB_SHIPPED + NATIVE_SOURCES

scanned.extend(WEB_SHIPPED)
scanned.extend(NATIVE_SOURCES)
scanned.append(CONFIG_PATH)


# --------------------------------------------------------------------------
# 0. config sanity
# --------------------------------------------------------------------------

def check_config():
    if not isinstance(NET.get("defaultOffline"), bool):
        add("config", CONFIG_PATH, 0, "network.defaultOffline must be a boolean")
    if NET.get("offlineKey") != "drugcopeia-ai-offline-mode":
        add("config", CONFIG_PATH, 0, "network.offlineKey must stay drugcopeia-ai-offline-mode")
    if PLAINTEXT_KEYS & USER_KEYS:
        add("config", CONFIG_PATH, 0, "a storage key is both plaintext and user data: %s" % sorted(PLAINTEXT_KEYS & USER_KEYS))
    banned = set(NET.get("bannedThirdPartyOrigins", []))
    for entry in REMOTE:
        host = entry["host"]
        if host in banned:
            add("config", CONFIG_PATH, 0, "host %s is both allowlisted and banned" % host)
        if entry.get("scheme") != "https":
            add("config", CONFIG_PATH, 0, "remote host %s must use https" % host)
        allowed_methods = list(entry.get("methods") or ["GET"])
        if entry.get("userInitiatedOnly") is True:
            pass
        else:
            # A host the app may reach without a button press has to say exactly
            # when it does, in the config, and stay read-only while it does.
            if not str(entry.get("scheduled") or "").strip():
                add("config", CONFIG_PATH, 0,
                    "remote host %s is not userInitiatedOnly and declares no 'scheduled' window" % host)
            if any(method != "GET" for method in allowed_methods):
                add("config", CONFIG_PATH, 0,
                    "remote host %s is not userInitiatedOnly, so it may only declare GET" % host)
        if any(method not in ("GET", "POST") for method in allowed_methods):
            add("config", CONFIG_PATH, 0, "remote host %s may only declare GET and POST" % host)
        if "POST" in allowed_methods and entry.get("userInitiatedOnly") is not True:
            add("config", CONFIG_PATH, 0, "remote host %s sends data with POST but is not userInitiatedOnly" % host)
        if not entry.get("pathPrefixes"):
            add("config", CONFIG_PATH, 0, "remote host %s has no path prefix (any path would pass)" % host)
        if not entry.get("purpose"):
            add("config", CONFIG_PATH, 0, "host %s has no documented purpose" % host)
    for parameter in ("utm_source", "device_id", "adid", "idfa", "uid"):
        if parameter not in NET.get("forbiddenUrlParameters", []):
            add("config", CONFIG_PATH, 0, "forbiddenUrlParameters lost %s" % parameter)
    if not any(host.startswith("*.wikipedia") for host in banned):
        add("config", CONFIG_PATH, 0, "bannedThirdPartyOrigins lost the wikipedia entry")


# --------------------------------------------------------------------------
# 1. banned dependencies and symbols
# --------------------------------------------------------------------------

def check_dependencies():
    for path in walk(ANDROID_ROOT, (".gradle",)):
        text = strip_line_comments(read(path))
        for banned in CONFIG["dependencies"]["bannedAndroidGradle"]:
            if banned in text:
                add("banned-dependency", path, 0, 'Gradle references "%s"' % banned)
        if "com.google.gms:google-services" in text:
            add("banned-dependency", path, 0, "the Firebase google-services plugin is applied")

    package_path = os.path.join(SOURCE, "package.json")
    if os.path.exists(package_path):
        try:
            package = json.loads(read(package_path))
        except ValueError:
            add("banned-dependency", package_path, 0, "package.json is not valid JSON")
            package = {}
        declared = set(package.get("dependencies", {})) | set(package.get("devDependencies", {}))
        for banned in CONFIG["dependencies"]["bannedNpmPackages"]:
            if banned in declared:
                add("banned-dependency", package_path, 0, 'npm dependency "%s"' % banned)
        lock_path = os.path.join(SOURCE, "package-lock.json")
        if os.path.exists(lock_path):
            lock = read(lock_path)
            for banned in CONFIG["dependencies"]["bannedNpmPackages"]:
                if '"%s"' % banned in lock:
                    add("banned-dependency", lock_path, 0, 'locked dependency "%s"' % banned)

    for path in walk(ANDROID_ROOT, ("go.mod", "go.sum")) + walk(WINDOWS, ("go.mod", "go.sum")):
        text = strip_line_comments(read(path))
        for banned in CONFIG["dependencies"]["bannedGoPackages"]:
            if banned in text:
                add("banned-dependency", path, 0, 'Go module "%s"' % banned)

    for path in walk(os.path.join(SOURCE, "ios"), ("Package.swift", "Package.resolved")):
        text = read(path)
        for banned in ("firebase", "sentry", "amplitude", "mixpanel", "appsflyer", "adjust", "braze", "onesignal"):
            if banned in text.lower():
                add("banned-dependency", path, 0, 'Swift package references "%s"' % banned)

    symbol_files = [path for path in CODE_SYMBOL_FILES if path.endswith((".js", ".html", ".swift", ".java", ".go"))]
    for path in symbol_files:
        text = read(path)
        for symbol in BANNED_SYMBOLS:
            match = re.search(r"\b%s\b" % re.escape(symbol), text)
            if match:
                add("banned-symbol", path, line_at(text, match.start()),
                    'references "%s" (tracking SDK or device identifier)' % symbol)


# --------------------------------------------------------------------------
# 2. network calls in the web layer
# --------------------------------------------------------------------------

BYPASS_PATTERNS = [
    (r"\bfetch\s*\(", "fetch("),
    (r"\bnew\s+XMLHttpRequest\b", "XMLHttpRequest"),
    (r"\bWebSocket\b", "WebSocket"),
    (r"\bEventSource\b", "EventSource"),
    (r"navigator\.sendBeacon", "sendBeacon"),
    (r"getDisplayMedia", "screen capture"),
    (r"navigator\.geolocation", "geolocation"),
    (r"navigator\.contacts", "contacts"),
]
URL_RE = re.compile(r"https?://([a-z0-9.-]+)", re.I)
FETCH_URL_RE = re.compile(
    r"(?:DawayaNet\.request|DawayaNet\.resumeDownload|resumeDownload|fetch|getText|check)\s*\([^;]{0,400}?https?://([a-z0-9.-]+)",
    re.I | re.S,
)


def host_allowed(host):
    return host.lower() in ALLOWED_HOSTS or host.lower() in LOOPBACK_HOSTS


def check_web_network():
    for path in WEB_DIRECT:
        text = read(path)
        for pattern, label in BYPASS_PATTERNS:
            match = re.search(pattern, text)
            if match:
                add("network-bypass", path, line_at(text, match.start()),
                    "calls %s outside DawayaNet (webapp/net.js)" % label)

        for match in FETCH_URL_RE.finditer(text):
            host = match.group(1).lower()
            if not host_allowed(host):
                add("host-not-allowlisted", path, line_at(text, match.start()),
                    'fetches "%s", which is not in privacy.config.json' % host)

        for match in URL_RE.finditer(text):
            host = match.group(1).lower()
            line = line_at(text, match.start())
            source_line = text.splitlines()[line - 1] if line else ""
            if is_comment(source_line):
                continue
            if host_allowed(host) or host in LINK_HOSTS or host in NAMESPACE_HOSTS or host in MODEL_HOSTS:
                continue
            add("host-unclassified", path, line,
                'host "%s" is neither allowlisted nor declared as an external link' % host)

        if re.search(r"<iframe\b", text, re.I):
            add("remote-subresource", path, 0, "ships an iframe")
        for match in re.finditer(r"<(?:script|img|link|video|audio|source)\b[^>]{0,300}?(?:src|href)\s*=\s*[\"']?(https?:)?//", text, re.I):
            add("remote-subresource", path, line_at(text, match.start()),
                "loads a subresource from a remote origin")

        if "document.cookie" in text and "setItem" in text:
            add("cookie-write", path, line_of(text, r"document\.cookie"), "writes a cookie")

    # The wrapper itself must keep its load-bearing properties.
    net = read(os.path.join(WEBAPP, "net.js"))
    required = [
        ("drugcopeia-ai-offline-mode", "the persisted offline key"),
        ("credentials = 'omit'", "credentials are omitted"),
        ("referrerPolicy = 'no-referrer'", "no referrer"),
        ("redirect = 'error'", "redirects to other hosts are refused"),
        ("userInitiatedOnly", "user-initiated rule"),
        ("host-not-allowlisted", "unknown hosts are refused"),
        ("XMLHttpRequest = blockedTransport", "XHR is blocked"),
        ("sendBeacon = blockedTransport", "sendBeacon is blocked"),
        ("    return false;\n  }\n\n  function setOffline", "online is the default and no stored switch can block the app"),
    ]
    for needle, why in required:
        if needle not in net:
            add("network-wrapper", os.path.join(WEBAPP, "net.js"), 0, "net.js lost %s" % why)

    service = read(os.path.join(WEBAPP, "service-worker.js"))
    if not re.search(r"drugcopeia-ai-shell-v\d+", service):
        add("service-worker", os.path.join(WEBAPP, "service-worker.js"), 0, "cache name is not drugcopeia-ai-shell-vN")
    if "url.origin !== self.location.origin" not in service:
        add("service-worker", os.path.join(WEBAPP, "service-worker.js"), 0, "service worker may cache a foreign origin")
    if "event.request.method !== 'GET'" not in service:
        add("service-worker", os.path.join(WEBAPP, "service-worker.js"), 0, "service worker caches non-GET requests")

    check_assistant_stack()


# --------------------------------------------------------------------------
# 2b. offline assistant: model pinning, pipeline order, history default
# --------------------------------------------------------------------------

AI_TEXT_KEYS = (
    "offTopic", "clarify", "sanitizeTooLong", "sanitizeEmpty", "sanitizeRejected",
)


def check_assistant_stack():
    index_path = os.path.join(WEBAPP, "index.html")
    index = read(index_path)
    for module in ("ai/text.js", "ai/search-index.js", "ai/safety.js", "ai/retrieval.js",
                   "ai/llm-bridge.js", "ai/model-manager.js", "ai/pipeline.js",
                   "ai/secure-history.js", "ai/chat-ui.js"):
        if module not in index:
            add("assistant-wiring", index_path, 0, "index.html does not load %s" % module)
    if 'data-main-page="assistant"' not in index:
        add("assistant-wiring", index_path, 0, "index.html has no assistant page")
    if "aiModelPanel" not in index:
        add("assistant-wiring", index_path, 0, "index.html has no model download panel")

    model_path = os.path.join(WEBAPP, "assets", "ai", "model-config.json")
    try:
        model = json.loads(read(model_path))
    except ValueError:
        add("model-config", model_path, 0, "model-config.json is not valid JSON")
        model = {}
    model_section = model.get("model") or {}
    url = str(model_section.get("url") or "")
    sha = str(model_section.get("sha256") or "")
    size = int(model_section.get("sizeBytes") or 0)
    if not url.startswith("https://"):
        add("model-config", model_path, 0, "the model URL must be https")
    if not re.fullmatch(r"[0-9a-f]{64}", sha):
        add("model-config", model_path, 0, "sha256 must be 64 lowercase hex characters")
    if size < 100 * 1024 * 1024:
        add("model-config", model_path, 0, "sizeBytes is missing or implausible")
    download_cfg = CONFIG.get("modelDownload") or {}
    allowed_models = [(entry.get("host") or "").lower() for entry in download_cfg.get("hosts") or []]
    suffixes = [entry.get("suffix") or "" for entry in download_cfg.get("hosts") or []]
    host = url.split("//", 1)[-1].split("/", 1)[0].lower()
    if host not in allowed_models:
        add("model-config", model_path, 0,
            "model host %s is not declared in privacy.config.json modelDownload.hosts" % host)
    if not suffixes:
        add("model-config", CONFIG_PATH, 0, "modelDownload declares no CDN suffix for redirects")

    for entry in download_cfg.get("hosts") or []:
        if not entry.get("host") and not entry.get("suffix"):
            add("model-config", CONFIG_PATH, 0, "every model host needs host or suffix")

    # The assistant is meant to run on phones that are years old, so the pinned
    # model has to stay small and the memory floor has to stay under what a 3 GB
    # phone reports. A heavier model or a higher floor silently sends every budget
    # device back to smart search, which is a product decision, not a tuning detail.
    MB = 1024 * 1024
    device_cfg = model.get("device") or {}
    generation_cfg = model.get("generation") or {}
    if size > 1200 * MB:
        add("model-old-phone", model_path, 0,
            "the pinned model file is %d MB; the owner approved the 1.5B model (1.1 GB) in November 2026, nothing larger" % (size // MB))
    if int(device_cfg.get("minRamMB") or 0) > 3700:
        add("model-old-phone", model_path, 0,
            "device.minRamMB is above 3700 MB; a 4 GB phone is refused the assistant")
    if int(device_cfg.get("minDiskMB") or 0) * MB < size * max(
            float((model.get("download") or {}).get("requiresFreeSpaceMultipleOfModelSize") or 1), 1):
        add("model-old-phone", model_path, 0,
            "device.minDiskMB does not cover the model file plus the configured free-space margin")
    if str(model_section.get("chatTemplate") or "") != "chatml":
        add("model-old-phone", model_path, 0,
            "the three native shells wrap prompts in ChatML; another template means those wrappers must change too")
    if not (generation_cfg.get("lowMemory") or {}):
        add("model-old-phone", model_path, 0,
            "generation.lowMemory is gone; a lean device has no shorter profile to fall back on")

    for path in AI_FILES:
        text = read(path)
        if re.search(r"\bXMLHttpRequest\b|navigator\.sendBeacon", text):
            add("assistant-network", path, 0, "AI code must not bypass the native downloader")
        for match in re.finditer(r"fetch\(\s*[\"'](https?://[^\"']+)", text):
            add("assistant-network", path, line_at(text, match.start()),
                "AI code fetches an absolute URL: %s" % match.group(1))

    pipeline = read(os.path.join(WEBAPP, "ai", "pipeline.js"))
    for needle, why in (
        ("sanitize(", "step 1 sanitize"),
        ("gateTopic(", "step 2 topic gate"),
        ("detectEmergency(", "step 3 emergency"),
        ("retrieve(", "step 4 retrieval"),
        ("guardOutput(", "step 6 output guard"),
        ("disclaimerAddedByCode: true", "step 7 disclaimer added by code"),
        ("sourcesAddedByCode: true", "step 7 sources added by code"),
    ):
        if needle not in pipeline:
            add("assistant-pipeline", os.path.join(WEBAPP, "ai", "pipeline.js"), 0,
                "%s is missing from the pipeline" % why)

    manager = read(os.path.join(WEBAPP, "ai", "model-manager.js"))
    for needle, why in (
        ("deleteModel()", "a checksum mismatch deletes the file"),
        ("checksumVerified", "checksum state is tracked"),
        ("minRamMB", "weak devices are detected"),
        ("unloadOnBackground", "the model is released in the background"),
    ):
        if needle not in manager:
            add("model-lifecycle", os.path.join(WEBAPP, "ai", "model-manager.js"), 0,
                "%s missing: %s" % (needle, why))

    history = read(os.path.join(WEBAPP, "ai", "secure-history.js"))
    for needle, why in (
        ("flag(MEMORY_KEY, true)", "conversation saving must be on by default"),
        ("listSessions", "the Privacy screen must be able to list saved conversations"),
        ("deleteSession", "any saved conversation must be deletable on its own"),
        ("beginNewSession", "starting a new chat must not erase saved conversations"),
        ("clearHistory", "turning saving off must erase every saved conversation"),
    ):
        if needle not in history:
            add("chat-history", os.path.join(WEBAPP, "ai", "secure-history.js"), 0,
                "%s is missing: %s" % (needle, why))
    if "encrypt" not in history.lower():
        add("chat-history", os.path.join(WEBAPP, "ai", "secure-history.js"), 0,
            "stored chat history must be encrypted")

    chat = os.path.join(WEBAPP, "ai", "chat-ui.js")
    chat_text = read(chat)
    if "DawayaAIAssistant" not in chat_text or "guardReasons" not in chat_text:
        add("assistant-ui", chat, 0, "chat UI must call the pipeline and render guard fallbacks")
    if "downloadRequiresOnline" not in chat_text:
        add("assistant-ui", chat, 0, "the download must refuse to start while Offline mode is on")
    if "disclaimer" not in chat_text:
        add("assistant-ui", chat, 0, "the disclaimer must be rendered under every message")

    for language in ("ar", "en"):
        path = os.path.join(WEBAPP, "assets", "ai", "messages-%s.json" % language)
        try:
            messages = json.loads(read(path))
        except ValueError:
            add("assistant-messages", path, 0, "messages file is not valid JSON")
            continue
        for key in AI_TEXT_KEYS:
            if not (messages.get("refusal") or {}).get(key):
                add("assistant-messages", path, 0, "refusal.%s is missing" % key)
        if not messages.get("disclaimer"):
            add("assistant-messages", path, 0, "the fixed disclaimer is missing")
        if not (messages.get("ui") or {}).get("inputPlaceholder"):
            add("assistant-messages", path, 0, "ui.inputPlaceholder is missing")
        for key in ("doctorNote", "introMessage", "introBullets"):
            if key in messages:
                add("assistant-quiet-page", path, 0,
                    "%s is a page-wide explainer; the assistant page carries only the one-line subtitle and the per-answer disclaimer" % key)
        # The smart-search notice and the saving switch each carry one short line:
        # their paragraphs were deleted, and the conversations switch lives in the
        # assistant's own menu, not in a card under the composer.
        for section, key in (("capability", "fallbackBody"), ("chat", "historyBody"),
                             ("chat", "searchOnly"), ("chat", "noRuntime")):
            if (messages.get(section) or {}).get(key):
                add("assistant-quiet-page", path, 0,
                    "%s.%s is back; the smart-search box and the save-conversations row stay one line" % (section, key))

    # The assistant page shows nothing but the conversation: the page-wide
    # caution banner and the intro block were removed, and each answer already
    # carries its own disclaimer.
    for name in ("index.html", "styles.css", os.path.join("ai", "chat-ui.js")):
        page_path = os.path.join(WEBAPP, name)
        for needle in ("aiDoctorNote", "ai-doctor-note", "ai-intro", "renderIntro"):
            if needle in read(page_path):
                add("assistant-quiet-page", page_path, 0,
                    "%s is back: the assistant page must have no caution banner and no intro block" % needle)
    # Saving conversations is one row inside the assistant's own menu; the card
    # that used to sit under the composer, with its paragraph and its own two
    # buttons, is gone.
    index_path = os.path.join(WEBAPP, "index.html")
    for needle in ("aiHistoryToggle", "aiHistoryBody", "aiSmartBody"):
        if needle in read(index_path):
            add("assistant-quiet-page", index_path, 0,
                "%s is back on the assistant page; saving conversations is a row in the assistant's own menu and the smart-search box has no paragraph" % needle)


# --------------------------------------------------------------------------
# 3. native network
# --------------------------------------------------------------------------

NATIVE_NETWORK_APIS = re.compile(
    r"URLSession|dataTask\(|HttpURLConnection|OkHttpClient|http\.Get\(|http\.Post\(|"
    r"client\.Do\(|net\.Dial|NWConnection\(|CLLocation|ASIdentifierManager",
)
NATIVE_GATE = re.compile(
    r"DawayaPrivacyPolicy|PrivacyPolicy|isAllowed|assertLoopback|DawayaPrivacyWebViewClient|"
    r"shouldInterceptRequest|requiredLocalEndpoint",
)


def check_native_network():
    for path in NATIVE_SOURCES:
        text = read(path)
        if not NATIVE_NETWORK_APIS.search(text):
            continue
        if not NATIVE_GATE.search(text):
            add("native-ungated", path, 0,
                "makes outbound requests but has no visible allowlist gate")
        for match in URL_RE.finditer(text):
            host = match.group(1).lower()
            line = line_at(text, match.start())
            source_line = text.splitlines()[line - 1] if line else ""
            if is_comment(source_line):
                continue
            if host_allowed(host) or host in LINK_HOSTS or host in NAMESPACE_HOSTS or host in MODEL_HOSTS:
                continue
            add("host-not-allowlisted", path, line,
                'native code names "%s", which is not allowlisted' % host)
        if re.search(r"Mozilla/|setValue\(\s*\"Accept-Language|SetHeader\(\s*\"User-Agent", text):
            add("device-fingerprint-header", path, 0, "sets a browser-spoofing or locale-revealing header")


# --------------------------------------------------------------------------
# 4. permissions, backup, device surfaces
# --------------------------------------------------------------------------

def check_android_manifest():
    manifest = os.path.join(ANDROID, "AndroidManifest.xml")
    text = read(manifest)
    declared = re.findall(r"<uses-permission\s+android:name=\"([^\"]+)\"", text)
    allowed = CONFIG["permissions"]["android"]["allowed"]
    forbidden = CONFIG["permissions"]["android"]["forbidden"]
    for name in declared:
        if name not in allowed:
            add("unapproved-permission", manifest, line_at(text, text.find(name)),
                '"%s" is not in permissions.android.allowed' % name)
        if name in forbidden:
            add("forbidden-permission", manifest, line_at(text, text.find(name)),
                '"%s" is explicitly forbidden' % name)
    for name in allowed:
        if name not in declared:
            add("missing-approved-permission", manifest, 0,
                '"%s" is approved in the config but not declared' % name)
    if 'android:allowBackup="false"' not in text:
        add("cloud-backup", manifest, 0, "allowBackup must be false")
    if 'android:usesCleartextTraffic="false"' not in text:
        add("cleartext-traffic", manifest, 0, "usesCleartextTraffic must be false")
    for attribute in ("networkSecurityConfig", "fullBackupContent", "dataExtractionRules"):
        if attribute not in text:
            add("android-hardening", manifest, 0, "%s is not referenced" % attribute)
    if re.search(r"<provider\b", text):
        add("file-exposure", manifest, 0, "a content provider (FileProvider) is declared; the app shares no files")
    if "android:debuggable=\"true\"" in text:
        add("debuggable", manifest, 0, "android:debuggable must not be set")

    rules = os.path.join(ANDROID, "res", "xml", "backup_rules.xml")
    rules_text = read(rules)
    if "full-backup-content" not in rules_text:
        add("cloud-backup", rules, 0, "backup rules are missing")
    for domain in ("root", "file", "database", "sharedpref", "external"):
        if 'domain="%s"' % domain not in rules_text:
            add("cloud-backup", rules, 0, "backup rules do not exclude domain %s" % domain)

    extraction = os.path.join(ANDROID, "res", "xml", "data_extraction_rules.xml")
    extraction_text = read(extraction)
    if "<cloud-backup>" not in extraction_text or "<device-transfer>" not in extraction_text:
        add("cloud-backup", extraction, 0, "cloud-backup and device-transfer must both be excluded")
    for domain in ("root", "file", "database", "sharedpref", "external"):
        if extraction_text.count('domain="%s"' % domain) < 2:
            add("cloud-backup", extraction, 0, "device-transfer/cloud backup do not exclude %s" % domain)

    activity = os.path.join(ANDROID, "java", "com", "dawaya", "medicineguide", "MainActivity.java")
    activity_text = read(activity)
    if "FLAG_SECURE" not in activity_text:
        add("screen-capture", activity, 0, "FLAG_SECURE is missing: the app switcher would show the page")
    if "setWebContentsDebuggingEnabled(false)" not in activity_text:
        add("debuggable", activity, 0, "remote WebView debugging is not disabled for release builds")
    if "setAllowFileAccess(false)" not in activity_text or "setAllowContentAccess(false)" not in activity_text:
        add("file-exposure", activity, 0, "the WebView may read files or content providers")


def check_apple_plists():
    ios_plist = os.path.join(IOS, "Info.plist")
    text = read(ios_plist)
    for key in CONFIG["permissions"]["ios"]["forbiddenKeys"]:
        if "<key>%s</key>" % key in text:
            add("forbidden-usage-description", ios_plist, line_of(text, key),
                "%s requests a permission the app does not use" % key)
    for entry in CONFIG["permissions"]["ios"].get("allowedUsageDescriptions") or []:
        key = entry["key"]
        if "<key>%s</key>" % key not in text:
            add("missing-usage-description", ios_plist, 0, "%s is declared in privacy.config.json but absent" % key)
        elif "<string>%s</string>" % entry["value"] not in text:
            add("usage-description-drift", ios_plist, 0, "%s does not match privacy.config.json" % key)
    for entry in CONFIG["permissions"]["ios"]["forbiddenValues"]:
        value = "true" if entry["value"] == "YES" else "false"
        if re.search(r"<key>%s</key>\s*<%s/>" % (re.escape(entry["key"]), value), text):
            add("unsafe-plist-value", ios_plist, 0,
                "%s=%s exposes app data outside the sandbox" % (entry["key"], entry["value"]))
    if not re.search(r"<key>NSAllowsArbitraryLoads</key>\s*<false/>", text):
        add("ats", ios_plist, 0, "NSAllowsArbitraryLoads must be false")
    if re.search(r"<key>NSAllowsLocalNetworking</key>\s*<true/>", text):
        add("ats", ios_plist, 0, "iOS serves the bundle from capacitor://localhost; ATS local networking is not needed")

    privacy = os.path.join(IOS, "PrivacyInfo.xcprivacy")
    privacy_text = read(privacy)
    if not privacy_text:
        add("apple-privacy-manifest", privacy, 0, "PrivacyInfo.xcprivacy is missing")
    else:
        if not re.search(r"<key>NSPrivacyTracking</key>\s*<false/>", privacy_text):
            add("apple-privacy-manifest", privacy, 0, "NSPrivacyTracking must be false")
        if not re.search(r"<key>NSPrivacyCollectedDataTypes</key>\s*<array\s*/>", privacy_text):
            add("apple-privacy-manifest", privacy, 0, "NSPrivacyCollectedDataTypes must be empty")
        if not re.search(r"<key>NSPrivacyTrackingDomains</key>\s*<array\s*/>", privacy_text):
            add("apple-privacy-manifest", privacy, 0, "NSPrivacyTrackingDomains must be empty")

    for strings_file in walk(os.path.join(SOURCE, "ios"), (".strings",)):
        strings_text = read(strings_file)
        for key in CONFIG["permissions"]["ios"]["forbiddenKeys"]:
            if '"%s"' % key in strings_text:
                add("forbidden-usage-description", strings_file, 0,
                    "%s is re-injected from a localized strings file" % key)

    mac_plist = os.path.join(MACOS, "Info.plist")
    mac_text = read(mac_plist)
    for entry in CONFIG["permissions"]["macos"].get("allowedUsageDescriptions") or []:
        key = entry["key"]
        if "<key>%s</key>" % key not in mac_text:
            add("missing-usage-description", mac_plist, 0, "%s is declared in privacy.config.json but absent" % key)
        elif "<string>%s</string>" % entry["value"] not in mac_text:
            add("usage-description-drift", mac_plist, 0, "%s does not match privacy.config.json" % key)
    for key in CONFIG["permissions"]["macos"]["forbiddenKeys"]:
        if "<key>%s</key>" % key in mac_text:
            add("forbidden-usage-description", mac_plist, 0,
                "%s requests a permission the app does not use" % key)
    if not re.search(r"<key>NSAllowsArbitraryLoads</key>\s*<false/>", mac_text):
        add("ats", mac_plist, 0, "NSAllowsArbitraryLoads must be false")


# --------------------------------------------------------------------------
# 5. local storage and logging
# --------------------------------------------------------------------------

KEY_RE = re.compile(r"[\"'](dawaya-[a-z0-9-]+)[\"']")


def check_storage():
    for path in WEB_SHIPPED:
        if path.endswith("service-worker.js"):
            continue
        text = read(path)
        for match in KEY_RE.finditer(text):
            key = match.group(1)
            if key in STORAGE_KEYS or key in LEGACY_REMOVED_KEYS:
                continue
            if key.startswith("drugcopeia-ai-shell-"):
                continue
            add("undeclared-storage-key", path, line_at(text, match.start()),
                'storage key "%s" is in no privacy.config.json list' % key)
        for match in re.finditer(r"(?:localStorage|sessionStorage)\.setItem\s*\(\s*([^,)]+)", text):
            target = match.group(1).strip()
            if target.startswith(("'", '"')):
                key = target.strip("'\"")
                if key not in STORAGE_KEYS and key not in LEGACY_REMOVED_KEYS:
                    add("undeclared-storage-key", path, line_at(text, match.start()),
                        'writes undeclared key "%s"' % key)
        if "drugcopeia-ai-query-history" in text:
            add("chat-persistence", path, line_of(text, r"drugcopeia-ai-query-history"),
                "search-query history is never persisted")

    app = read(os.path.join(WEBAPP, "app.js"))
    for key in USER_KEYS:
        if key not in app and key not in read(os.path.join(WEBAPP, "core.js")):
            add("wipe", os.path.join(WEBAPP, "app.js"), 0,
                'delete-all does not cover user-data key "%s"' % key)
    if "privacyKeys()" not in app or "localStorage.removeItem" not in app:
        add("wipe", os.path.join(WEBAPP, "app.js"), 0, "the Privacy delete-all action is missing")


LOG_CALL_RE = re.compile(
    r"(?:console\.(?:log|info|debug|warn|error)|NSLog|logger\.Printf|logger\.Print|log\.Printf|"
    r"android\.util\.Log\.[dveiw]|Log\.[dveiw]|print)\s*\(([^;]{0,300})"
)
LOG_FORBIDDEN = CONFIG["logging"]["forbiddenLogTopics"]


def check_logging():
    for path in CODE_SYMBOL_FILES:
        if not path.endswith((".js", ".swift", ".java", ".go")):
            continue
        if "/ai/" in path.replace(os.sep, "/"):
            continue
        text = read(path)
        for match in LOG_CALL_RE.finditer(text):
            payload = match.group(1)
            for topic in LOG_FORBIDDEN:
                if re.search(r"\b%s\b" % re.escape(topic), payload):
                    add("user-input-in-log", path, line_at(text, match.start()),
                        'log payload references "%s"' % topic)
                    break

    capacitor = os.path.join(SOURCE, "capacitor.config.json")
    try:
        settings = json.loads(read(capacitor))
        if settings.get("loggingBehavior") != "none":
            add("logging-enabled", capacitor, 0, 'loggingBehavior must be "none"')
    except ValueError:
        add("logging-enabled", capacitor, 0, "capacitor.config.json is not valid JSON")

    go_main = os.path.join(WINDOWS, "main.go")
    go_text = read(go_main)
    if "log.New(io.Discard" not in go_text:
        add("logging-enabled", go_main, 0, "the Go logger must default to io.Discard")


# --------------------------------------------------------------------------
# 5b. identifier collection and the local input guard
# --------------------------------------------------------------------------

def check_identifiers():
    app_path = os.path.join(WEBAPP, "app.js")
    app = read(app_path)
    index_path = os.path.join(WEBAPP, "index.html")
    index = read(index_path)

    for path in WEB_SHIPPED:
        text = read(path)
        for pattern, detail in (
            (r"type\s*=\s*[\"']email[\"']", "collects an email address with <input type=\"email\">"),
            (r"autocomplete\s*=\s*[\"']email[\"']", "asks the browser to autofill an email address"),
            (r"Reply-to\s*(?:email)?\s*:", "prepares a Reply-to line from user text"),
            (r"addMedicineReplyLabel", "asks the sender for a reply-to address"),
        ):
            match = re.search(pattern, text)
            if match:
                add("identifier-collection", path, line_at(text, match.start()), detail)

    if "function sanitizeUserText(" not in app:
        add("identifier-guard", app_path, 0, "the local identifier sanitizer is missing")
    if "ID_FIELD_SELECTOR" not in app or "field.matches(ID_FIELD_SELECTOR)" not in app:
        add("identifier-guard", app_path, 0, "free-text fields are not wired to the identifier sanitizer")
    if "privacyGuardNote" not in index:
        add("identifier-guard", index_path, 0, "no visible notice exists for stripped identifiers")
    if "id=\"privacyGuardNote\"" not in index:
        add("identifier-guard", index_path, 0, "the identifier notice is not in index.html")

    for handler, label, window in (
        ("$('#suggestionsForm').addEventListener('submit'", "feedback", 1600),
        ("$('#newMedicineForm').addEventListener('submit'", "new medicine", 1600),
        ("$('#reminderForm')?.addEventListener('submit'", "reminder", 900),
    ):
        start = app.find(handler)
        if start < 0:
            add("identifier-guard", app_path, 0, "the %s submit handler is missing" % label)
        elif "sanitizeUserText" not in app[start:start + window]:
            add("identifier-guard", app_path, 0,
                "the %s form does not strip identifiers before using or saving the text" % label)

    for key in ("privacyGuardNotice", "privacyCollect5", "privacyFeedbackNote"):
        if app.count(key + ":") < 2:
            add("privacy-screen", app_path, 0,
                'identifier i18n key "%s" is not present in both languages' % key)


# --------------------------------------------------------------------------
# 6. generated artifacts and native mirror drift
# --------------------------------------------------------------------------

def load_generator():
    path = os.path.join(SCRIPTS, "gen-privacy-config.py")
    spec = importlib.util.spec_from_file_location("dawaya_privacy_generator", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def expected_js(module):
    payload = json.dumps(module.network_payload(module.load_config()), indent=2, ensure_ascii=False)
    model = json.dumps(module.model_payload(module.load_config()), indent=2, ensure_ascii=False)
    body = (
        "/* %s */\n"
        "(function (root) {\n"
        "  'use strict';\n"
        "  root.DAWAYA_PRIVACY_CONFIG = Object.freeze(%s);\n"
        "  root.DAWAYA_MODEL_DOWNLOAD = Object.freeze(%s);\n"
        "})(typeof globalThis !== 'undefined' ? globalThis : this);\n" % (module.BANNER, payload, model)
    )
    return body


def expected_xml(module):
    with tempfile.NamedTemporaryFile(delete=False, suffix=".xml") as handle:
        temp_path = handle.name
    original = module.XML_OUT
    module.XML_OUT = temp_path
    try:
        module.write_android_xml(module.load_config())
        return read(temp_path)
    finally:
        module.XML_OUT = original
        try:
            os.unlink(temp_path)
        except OSError:
            pass


def check_generated(module):
    js_path = os.path.join(WEBAPP, "generated", "privacy-config.js")
    if not os.path.exists(js_path):
        add("missing-generated-config", js_path, 0, "run scripts/gen-privacy-config.py")
    elif read(js_path) != expected_js(module):
        add("generated-drift", js_path, 0, "generated JS does not match privacy.config.json")

    xml_path = os.path.join(ANDROID, "res", "xml", "network_security_config.xml")
    if read(xml_path) != expected_xml(module):
        add("generated-drift", xml_path, 0, "generated network security config does not match privacy.config.json")

    for copy_root in (WWW, os.path.join(IOS, "public"), os.path.join(ANDROID_ROOT, "app", "src", "main", "assets", "public")):
        copy = os.path.join(copy_root, "generated", "privacy-config.js")
        if os.path.exists(copy):
            if read(copy) != expected_js(module):
                add("generated-drift", copy, 0, "synced copy is stale; run scripts/sync-web.sh")
            if not os.path.isdir(os.path.join(copy_root, "ai")):
                add("assistant-wiring", copy_root, 0, "synced copy is missing the assistant")
            if not os.path.isdir(os.path.join(copy_root, "assets", "ai")):
                add("assistant-wiring", copy_root, 0, "synced copy is missing the assistant assets")


def compare_entries(label, path, entries, allow_loopback=True):
    actual = {}
    for entry in entries:
        host = entry["host"].lower()
        actual[host] = (
            entry.get("scheme"),
            tuple(entry.get("pathPrefixes") or ()),
            tuple(entry.get("methods") or ("GET",)),
            bool(entry.get("userInitiatedOnly")),
            bool(entry.get("localhost")),
        )
    expected = {}
    for entry in NET["allowedHosts"]:
        expected[entry["host"].lower()] = (
            entry.get("scheme", "https"),
            tuple(entry.get("pathPrefixes") or ()),
            tuple(entry.get("methods") or ["GET"]),
            bool(entry.get("userInitiatedOnly")),
            bool(entry.get("localhost")),
        )
    if not allow_loopback:
        actual = {k: v for k, v in actual.items() if not v[4]}
        expected = {k: v for k, v in expected.items() if not v[4]}
    for host in sorted(set(expected) | set(actual)):
        if host not in actual:
            add("config-drift", path, 0, "%s mirror is missing host %s" % (label, host))
        elif host not in expected:
            add("config-drift", path, 0, "%s mirror adds undeclared host %s" % (label, host))
        elif actual[host] != expected[host]:
            add("config-drift", path, 0,
                "%s entry for %s is %r, expected %r" % (label, host, actual[host], expected[host]))


def parse_java_entries(text):
    entries = []
    pattern = re.compile(
        r"new AllowedHost\(\s*\"([^\"]+)\",\s*\"([^\"]+)\",\s*"
        r"(Arrays\.asList\([^)]*\)|Collections\.<String>emptyList\(\)),\s*"
        r"(true|false),\s*(true|false),\s*Arrays\.asList\(([^)]*)\),",
        re.S,
    )
    for match in pattern.finditer(text):
        entries.append({
            "host": match.group(1),
            "scheme": match.group(2),
            "pathPrefixes": re.findall(r"\"([^\"]*)\"", match.group(3)),
            "localhost": match.group(4) == "true",
            "userInitiatedOnly": match.group(5) == "true",
            "methods": re.findall(r"\"([^\"]*)\"", match.group(6)),
        })
    return entries


def parse_swift_entries(text):
    entries = []
    pattern = re.compile(
        r"AllowedHost\(host:\s*\"([^\"]+)\",\s*scheme:\s*\"([^\"]+)\",\s*"
        r"pathPrefixes:\s*\[([^\]]*)\],\s*localhost:\s*(true|false),\s*"
        r"userInitiatedOnly:\s*(true|false)(?:,\s*methods:\s*\[([^\]]*)\])?\)",
        re.S,
    )
    for match in pattern.finditer(text):
        entries.append({
            "host": match.group(1),
            "scheme": match.group(2),
            "pathPrefixes": re.findall(r"\"([^\"]*)\"", match.group(3)),
            "localhost": match.group(4) == "true",
            "userInitiatedOnly": match.group(5) == "true",
            "methods": re.findall(r"\"([^\"]*)\"", match.group(6)) if match.group(6) else ["GET"],
        })
    return entries


def parse_js_entries(text):
    entries = []
    pattern = re.compile(
        r"\{\s*host:\s*'([^']+)',\s*scheme:\s*'([^']+)',\s*"
        r"(?:pathPrefixes:\s*\[([^\]]*)\],\s*)?(?:localhost:\s*(true|false),\s*)?"
        r"methods:\s*\[([^\]]*)\](?:,\s*userInitiatedOnly:\s*(true|false))?\s*\}",
        re.S,
    )
    for match in pattern.finditer(text):
        entries.append({
            "host": match.group(1),
            "scheme": match.group(2),
            "pathPrefixes": re.findall(r"'([^']*)'", match.group(3) or ""),
            "localhost": match.group(4) == "true",
            "userInitiatedOnly": match.group(6) == "true",
            "methods": re.findall(r"'([^']*)'", match.group(5) or ""),
        })
    return entries


def check_drift():
    java_path = os.path.join(ANDROID, "java", "com", "dawaya", "medicineguide", "DawayaPrivacyPolicy.java")
    java_text = read(java_path)
    compare_entries("Android", java_path, parse_java_entries(java_text))
    for key in USER_KEYS:
        if key not in java_text:
            add("config-drift", java_path, 0, "Android secure-key list is missing %s" % key)
    for key in PLAINTEXT_KEYS:
        if key not in java_text:
            add("config-drift", java_path, 0, "Android plaintext-key list is missing %s" % key)
    for path, label in (
        (os.path.join(IOS, "DawayaSecureStore.swift"), "iOS secure-key list"),
        (os.path.join(MACOS, "main.swift"), "macOS secure-key list"),
    ):
        text = read(path)
        for key in USER_KEYS:
            if key not in text:
                add("config-drift", path, 0, "%s is missing %s" % (label, key))

    ios_path = os.path.join(IOS, "DawayaPrivacyPolicy.swift")
    ios_text = read(ios_path)
    for entry in REMOTE:
        if '"%s"' % entry["host"] not in ios_text:
            add("config-drift", ios_path, 0, "iOS mirror is missing host %s" % entry["host"])
        for prefix in entry.get("pathPrefixes", []):
            if '"%s"' % prefix not in ios_text:
                add("config-drift", ios_path, 0, "iOS mirror is missing path %s" % prefix)
    if "static var isOfflineMode = false" not in ios_text:
        add("config-drift", ios_path, 0, "iOS offline default must be false (online by default)")

    mac_path = os.path.join(MACOS, "main.swift")
    mac_text = read(mac_path)
    # The Swift policy keeps loopback in its own isLoopback() branch, not in the
    # remote allowlist; the injected JS mirror lists both for the web layer.
    compare_entries("macOS Swift", mac_path, parse_swift_entries(mac_text), allow_loopback=False)
    for host in LOOPBACK_HOSTS:
        if '"%s"' % host not in mac_text.split("static func isLoopback", 1)[-1][:500]:
            add("config-drift", mac_path, 0, "macOS isLoopback does not cover %s" % host)
    injected = mac_text.split("window.DawayaPrivacyPolicy", 1)
    if len(injected) == 2:
        compare_entries("macOS injected JS", mac_path, parse_js_entries(injected[1]))
    else:
        add("config-drift", mac_path, 0, "macOS injected JS allowlist is missing")
    if "static var offlineModeEnabled = false" not in mac_text:
        add("config-drift", mac_path, 0, "macOS offline default must be false (online by default)")
    if "kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly" not in mac_text:
        add("keychain-hardening", mac_path, 0, "macOS secure store must use ThisDeviceOnly")

    android_store = os.path.join(IOS, "DawayaSecureStore.swift")
    store_text = read(android_store)
    if "kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly" not in store_text:
        add("keychain-hardening", android_store, 0, "iOS secure store must use ThisDeviceOnly")

    plugin = os.path.join(ANDROID, "java", "com", "dawaya", "medicineguide", "DawayaShellPlugin.java")
    plugin_text = read(plugin)
    if "persistedOfflineMode" not in plugin_text or ("?? false" not in plugin_text and "return false" not in plugin_text):
        add("config-drift", plugin, 0, "Android offline persisted default must be false (online by default)")

    nsc = os.path.join(ANDROID, "res", "xml", "network_security_config.xml")
    nsc_text = read(nsc)
    for match in re.finditer(r"<domain[^>]*>([a-z0-9.:-]+)</domain>", nsc_text):
        if match.group(1).lower() not in ALLOWED_HOSTS:
            add("config-drift", nsc, 0, 'network security config declares undeclared host %s' % match.group(1))
    if "cleartextTrafficPermitted=\"true\"" in nsc_text:
        add("cleartext-traffic", nsc, 0, "cleartext is permitted somewhere")

    index = read(os.path.join(WEBAPP, "index.html"))
    csp_match = re.search(r"Content-Security-Policy\"\s+content=\"([^\"]+)\"", index)
    if not csp_match:
        add("missing-csp", os.path.join(WEBAPP, "index.html"), 0, "no Content-Security-Policy meta tag")
        return
    csp = csp_match.group(1)
    expected_connect = {"'self'"} | {"%s://%s" % (entry["scheme"], entry["host"]) for entry in REMOTE}
    # The one-time model download: the web/PWA runtime fetches the pinned model
    # file through DawayaNet.modelDownload, so the model hosts are connect-src
    # entries (exact host, or a wildcard for the CDN suffix) without ever
    # joining network.allowedHosts.
    for entry in (CONFIG.get("modelDownload") or {}).get("hosts") or []:
        scheme = entry.get("scheme", "https")
        if entry.get("host"):
            expected_connect.add("%s://%s" % (scheme, entry["host"]))
        elif entry.get("suffix"):
            expected_connect.add("%s://*%s" % (scheme, entry["suffix"]))
    connect_match = re.search(r"connect-src([^;]+)", csp)
    if not connect_match:
        add("csp", os.path.join(WEBAPP, "index.html"), 0, "CSP has no connect-src")
    else:
        actual = set(connect_match.group(1).split())
        if actual != expected_connect:
            add("csp", os.path.join(WEBAPP, "index.html"), 0,
                "connect-src is %s, expected %s" % (sorted(actual), sorted(expected_connect)))
    for directive, value in (("object-src", "'none'"), ("frame-src", "'none'"), ("base-uri", "'none'"), ("form-action", "'none'")):
        if not re.search(r"%s\s+%s" % (directive, value), csp):
            add("csp", os.path.join(WEBAPP, "index.html"), 0, "CSP %s must be %s" % (directive, value))
    if "'unsafe-eval'" in csp:
        add("csp", os.path.join(WEBAPP, "index.html"), 0, "CSP allows eval")
    # The vendored wllama runtime cannot start without these two allowances.
    if "'wasm-unsafe-eval'" not in csp:
        add("csp", os.path.join(WEBAPP, "index.html"), 0,
            "CSP needs 'wasm-unsafe-eval' in script-src for the WebAssembly assistant runtime")
    worker_match = re.search(r"worker-src([^;]+)", csp)
    if not worker_match or "blob:" not in worker_match.group(1).split():
        add("csp", os.path.join(WEBAPP, "index.html"), 0,
            "CSP worker-src must allow blob: for the wllama inference workers")
    if "frame-ancestors" in csp:
        # A meta CSP cannot carry frame-ancestors; the header in the Windows shell does.
        add("csp", os.path.join(WEBAPP, "index.html"), 0, "frame-ancestors is ignored in a meta tag")

    windows = read(os.path.join(WINDOWS, "main.go"))
    win_slice = ""
    if "connect-src" in windows and "worker-src" in windows:
        win_slice = windows[windows.find("connect-src"):windows.find("worker-src")]
    win_connect = set(re.findall(r"https?://[^\s;\"+]+|'self'", win_slice))
    if win_connect != expected_connect:
        add("csp", os.path.join(WINDOWS, "main.go"), 0,
            "Windows CSP connect-src is %s, expected %s" % (sorted(win_connect), sorted(expected_connect)))
    for flag in ("--disable-dev-tools", "--disable-breakpad",
                 "--disable-domain-reliability", "--disable-background-networking", "--no-pings"):
        if flag not in windows:
            add("windows-hardening", os.path.join(WINDOWS, "main.go"), 0, "Edge launch is missing %s" % flag)
    if "--deny-permission-prompts" in windows:
        add("windows-hardening", os.path.join(WINDOWS, "main.go"), 0,
            "Edge blocks the camera and microphone prompts the reader consents to")


# --------------------------------------------------------------------------
# 7. bundle, privacy screen and docs
# --------------------------------------------------------------------------

def check_bundle():
    index_path = os.path.join(WEBAPP, "index.html")
    index = read(index_path)
    for marker in ("id=\"privacyPage\"", "id=\"privacyWipe\"",
                   "id=\"privacyHistory\"", "id=\"privacyHistoryList\"", "id=\"privacyHistoryClear\"",
                   "id=\"settingsHistory\"", "data-main-page=\"privacy\""):
        if marker not in index:
            add("privacy-screen", index_path, 0, "Privacy screen is missing %s" % marker)
    for key in ("navPrivacy", "privacyTitle", "privacyCollectValue", "privacyWipe",
                "privacyHistoryTitle", "privacyHistoryOn", "privacyHistoryDelete",
                "privacyHistoryClear", "privacyHistoryEmpty"):
        if read(os.path.join(WEBAPP, "app.js")).count(key + ":") < 2:
            add("privacy-screen", os.path.join(WEBAPP, "app.js"), 0,
                'i18n key "%s" is not present in both languages' % key)

    scripts = re.findall(r"<script[^>]+src=\"([^\"]+)\"", index)
    for src in scripts:
        clean = src.split("?")[0]
        if clean.startswith("http") or "//" in clean:
            add("remote-subresource", index_path, 0, "index.html loads remote script %s" % src)
        elif not os.path.exists(os.path.join(WEBAPP, clean)):
            add("missing-asset", index_path, 0, "index.html references missing %s" % clean)
    for needed in ("generated/privacy-config.js", "net.js", "core.js", "app.js"):
        if not any(src.split("?")[0] == needed for src in scripts):
            add("script-order", index_path, 0, "index.html does not load %s" % needed)
    order = [src.split("?")[0] for src in scripts]
    try:
        if order.index("net.js") > order.index("core.js"):
            add("script-order", index_path, 0, "net.js must load before core.js")
        if order.index("generated/privacy-config.js") > order.index("net.js"):
            add("script-order", index_path, 0, "the privacy config must load before net.js")
    except ValueError:
        pass

    service = os.path.join(WEBAPP, "service-worker.js")
    service_text = read(service)
    shell = re.search(r"const APP_SHELL = \[([^\]]+)\]", service_text)
    if shell:
        for match in re.finditer(r"'([^']+)'", shell.group(1)):
            entry = match.group(1).split("?")[0]
            if entry.startswith("http") or entry.startswith("//"):
                add("service-worker", service, 0, "APP_SHELL lists a remote URL %s" % entry)
            elif entry not in ("./", "./index.html") and not os.path.exists(os.path.join(WEBAPP, entry.lstrip("./"))):
                add("service-worker", service, 0, "APP_SHELL lists missing file %s" % entry)

    privacy_doc = os.path.join(REPO, "PRIVACY.md")
    doc = read(privacy_doc)
    if not doc:
        add("privacy-doc", privacy_doc, 0, "PRIVACY.md is missing at the repository root")
    else:
        for section in ("Data flow", "Network", "Permissions", "Data safety", "Apple", "Delete"):
            if section.lower() not in doc.lower():
                add("privacy-doc", privacy_doc, 0, 'PRIVACY.md is missing the "%s" section' % section)
        for phrase in ("Data not collected", "Data safety"):
            if phrase.lower() not in doc.lower():
                add("store-declaration", privacy_doc, 0,
                    'PRIVACY.md is missing the store declaration phrase "%s"' % phrase)


# Every link the reader taps — news, a reference, a source citation, a pack photograph — is
# shown in a browser view over the app's own page, never inside it. Its disclosure, its
# offline gate, its escape hatch to the device's own browser and all four shell wirings are
# asserted here, so a release cannot ship the view on one platform and the promise on none.
def check_browser_view():
    index_path = os.path.join(WEBAPP, "index.html")
    index = read(index_path)
    for marker in ('data-i18n="privacyLinksNote"', 'data-i18n="privacyLinksWhere"'):
        if marker not in index:
            add("browser-view", index_path, 0, "the Privacy screen is missing %s" % marker)
    app_path = os.path.join(WEBAPP, "app.js")
    app_text = read(app_path)
    for key in ("privacyLinksNote", "privacyLinksWhere", "offlineBrowserBlocked"):
        if app_text.count(key + ":") < 2:
            add("browser-view", app_path, 0,
                'i18n key "%s" is not present in both languages' % key)
    router = re.search(r"function openExternal\(.*?\n  \}", app_text, re.S)
    if not router:
        add("browser-view", app_path, 0, "openExternal is missing")
    else:
        body = router.group(0)
        if "isOffline" not in body:
            add("browser-view", app_path, 0,
                "the browser view does not check Offline mode in the page")
        if "'blocked'" not in body:
            add("browser-view", app_path, 0,
                "a link the shell refused must not be retried in the external browser")
        if "openInAppBrowser" not in body:
            add("browser-view", app_path, 0,
                "links do not go through the shell's in-app browser view")
        if "openSystemBrowser" not in body:
            add("browser-view", app_path, 0,
                "the browser view has no fallback for a shell that offers no browser window")
    for path, markers in (
        (os.path.join(IOS, "DawayaShellPlugin.swift"), ("presentInAppBrowser",)),
        (os.path.join(IOS, "DawayaShellViewController.swift"),
         ("SFSafariViewController", "isOfflineMode", "openInDefaultBrowser")),
        (os.path.join(IOS, "DawayaStrings.swift"), ("openInDefaultBrowser",)),
        (os.path.join(ANDROID, "java", "com", "dawaya", "medicineguide", "DawayaShellPlugin.java"),
         ("presentInAppBrowser", "CustomTabsIntent", "persistedOfflineMode",
          "setActionButton", "ic_open_in_browser")),
        (os.path.join(MACOS, "main.swift"),
         ("presentInAppBrowser", "MacBrowserWindow", "nonPersistent", "openInDefaultBrowser")),
        (os.path.join(WINDOWS, "main.go"),
         ("openInAppBrowser", "__dawaya/browser", "browserSwitches", "browserWindowSwitches")),
    ):
        text = read(path)
        for marker in markers:
            if marker not in text:
                add("browser-view", path, 0, "the browser view is missing %s" % marker)


# One back control for the whole app, in the header, carrying only an arrow. The gate holds
# both halves of that: the single control exists on every page, and the per-page buttons it
# replaced cannot come back.
def check_back_control():
    index_path = os.path.join(WEBAPP, "index.html")
    index = read(index_path)
    if 'id="appBack"' not in index:
        add("back-control", index_path, 0, "the header has no back control")
    app_path = os.path.join(WEBAPP, "app.js")
    app_text = read(app_path)
    if "function goBack(" not in app_text:
        add("back-control", app_path, 0, "the back control has no handler")
    if app_text.count("appBackAria:") < 2:
        add("back-control", app_path, 0,
            'i18n key "appBackAria" is not present in both languages')
    css_path = os.path.join(WEBAPP, "styles.css")
    css = read(css_path)
    for marker in (".app-back", 'html[dir="rtl"] .app-back-icon'):
        if marker not in css:
            add("back-control", css_path, 0, "the back arrow is missing %s" % marker)
    for retired in ("drugGroupBack", "conditionBack", "labBack", "doseBack",
                    "interactionsBack", "remindersBack", "newMedicineBack"):
        for path, text in ((index_path, index), (app_path, app_text)):
            if retired in text:
                add("back-control", path, 0,
                    "%s is a second back button; the header arrow is the only one" % retired)
    # Every back control in the app is the same arrow and nothing else: the shared
    # chevron icon, named only through its accessible label. A page or an overlay
    # that grows its own worded back button breaks that one-rule navigation, so the
    # shape is asserted here rather than trusted to the names listed above.
    for opening in re.finditer(r"<button\b[^>]*>", index):
        if not is_back_control(opening.group(0)):
            continue
        inner = index[opening.end():opening.end() + 400].split("</button>")[0]
        if "#icon-back" not in inner:
            add("back-control", index_path, line_of(index, opening.start()),
                "a back control carries something other than the unified arrow")
        if "data-i18n=" in inner:
            add("back-control", index_path, line_of(index, opening.start()),
                "a back control shows visible text; the arrow is labelled only by aria")
        if "aria-label" not in opening.group(0):
            add("back-control", index_path, line_of(index, opening.start()),
                "an arrow-only back control has no accessible name")
    for name in ("app.js", "reading.js"):
        path = os.path.join(WEBAPP, name)
        for key in re.findall(r"[A-Za-z][A-Za-z0-9]*Back(?=[\"']?\s*:)", read(path)):
            add("back-control", path, 0,
                "%s is a worded back label; back controls name themselves with a *BackAria key" % key)


def is_back_control(tag):
    """True when a button's own id or class names it as a back control.

    Names are split into words first, so "feedback" and "backdrop" stay out of
    the way while "appBack" and "related-back" are read as back controls.
    """
    for attribute in re.findall(r"(?:id|class)=\"([^\"]*)\"", tag):
        words = re.split(r"[^A-Za-z]+|(?<=[a-z])(?=[A-Z])", attribute)
        if any(word.lower() == "back" for word in words):
            return True
    return False


def line_of(text, position):
    return text.count("\n", 0, position) + 1


def rule_body(css, selector):
    found = re.search(re.escape(selector) + r"\{([^}]*)\}", css)
    return found


# The navigation drawer is a plain system list: a row is text and a leading icon
# on the panel's own background, the active row is marked by a rail rather than a
# filled card, and the label is the device's own list type (17 px, regular). A row
# that regrows a border, a fill, an icon tile or a bold label turns the menu back
# into a stack of boxes.
def check_drawer_list():
    css_path = os.path.join(WEBAPP, "styles.css")
    css = read(css_path)
    row = rule_body(css, "html[data-theme] body .app-drawer .drawer-link")
    if not row:
        add("drawer-list", css_path, 0, "the drawer has no .drawer-link rule")
        return
    for marker in ("background:transparent", "border:1px solid transparent", "font:400 1.0625rem"):
        if marker not in row.group(1):
            add("drawer-list", css_path, line_of(css, row.start()),
                "a drawer row is missing %s; drawer rows are plain list rows, not cards" % marker)
    icon = rule_body(css, "html[data-theme] body .app-drawer .drawer-link .nav-icon")
    if not icon:
        add("drawer-list", css_path, 0, "the drawer rows set no icon colour; the icon is plain, not tiled")
    else:
        for tiled in ("border-radius", "background:var(--blue-light)"):
            if tiled in icon.group(1):
                add("drawer-list", css_path, line_of(css, icon.start()),
                    "the drawer icon is inside a tile (%s); the icon sits directly on the row" % tiled)
    active = rule_body(css, "html[data-theme] body .app-drawer .drawer-link.is-active")
    if not active or "inset 3px 0 0" not in active.group(1):
        add("drawer-list", css_path, 0, "the active drawer row has no leading rail")
    if not rule_body(css, 'html[dir="rtl"][data-theme] body .app-drawer .drawer-link.is-active'):
        add("drawer-list", css_path, 0, "the active drawer rail is not mirrored for right-to-left")
    if re.search(r"\.drawer-link\.is-active:after\{[^}]*content:'✓'", css):
        add("drawer-list", css_path, 0,
            "the active drawer row is marked by a check mark as well as the rail")


def check_wasm_runtime():
    """The web/PWA assistant runtime: the vendored wllama files must be the
    pinned releases (sha256), the bridge must be wired into the page, and the
    service worker must precache it. The large .wasm binaries are fetched on
    demand with the model download panel, never precached."""
    import hashlib
    vendor = os.path.join(WEBAPP, "ai", "vendor", "wllama")
    pinned = {
        "index.js": "062c3fbaa266dea3ee991c699c176c21cf22e7199b0cac6481182b8708fc703b",
        "wllama.wasm": "b012436a101ede8c877f2d26644c3181429d4fb8da4fd90c356110d86bfd74a6",
        "wllama-compat.wasm": "6c5445f579a152c19ccad65aacebb57084d1db2f1b87ad473fa3acc0051ac72f",
    }
    for name, want in pinned.items():
        path = os.path.join(vendor, name)
        if not os.path.isfile(path):
            add("wasm-runtime", path, 0, "vendored wllama file %s is missing" % name)
            continue
        with open(path, "rb") as handle:
            got = hashlib.sha256(handle.read()).hexdigest()
        if got != want:
            add("wasm-runtime", path, 0,
                "vendored wllama file %s sha256 is %s, pinned %s - update the pin and the record in vendor/wllama/README.txt together" % (name, got, want))
    for name in ("LICENSE.txt", "README.txt"):
        path = os.path.join(vendor, name)
        if not os.path.isfile(path):
            add("wasm-runtime", path, 0, "vendored wllama %s is missing: provenance and licence ship with the binary" % name)
    index = read(os.path.join(WEBAPP, "index.html"))
    if "ai/wasm-bridge.js" not in index:
        add("wasm-runtime", os.path.join(WEBAPP, "index.html"), 0,
            "ai/wasm-bridge.js is not loaded by the page: the web build has no assistant runtime")
    worker = read(os.path.join(WEBAPP, "service-worker.js"))
    if "ai/wasm-bridge.js" not in worker:
        add("wasm-runtime", os.path.join(WEBAPP, "service-worker.js"), 0,
            "ai/wasm-bridge.js is missing from the service-worker app shell")
    bridge_path = os.path.join(WEBAPP, "ai", "wasm-bridge.js")
    bridge = read(bridge_path)
    for needle, why in (
        ("DawayaNet.modelDownload", "the model download must go through the privacy gate"),
        ("<|im_start|>", "the ChatML wrap must match the native shells"),
        ("sha256Create", "the streamed checksum guards the downloaded bytes"),
        ("setCompat", "the Safari compat build must be the local file, never the CDN fallback"),
    ):
        if needle not in bridge:
            add("wasm-runtime", bridge_path, 0, "%s is missing: %s" % (needle, why))
    if "cdn.jsdelivr.net" in bridge:
        add("wasm-runtime", bridge_path, 0, "the bridge must never point at a CDN")


def check_build_wiring():
    sync = read(os.path.join(SCRIPTS, "sync-web.sh"))
    if "privacy-check.py" not in sync:
        add("build-wiring", os.path.join(SCRIPTS, "sync-web.sh"), 0, "sync-web.sh does not run the privacy gate")
    for path in (os.path.join(MACOS, "build-macos.sh"), os.path.join(WINDOWS, "build-windows.sh")):
        if "privacy-check.py" not in read(path):
            add("build-wiring", path, 0, "build script does not run the privacy gate")
    gradle = read(os.path.join(ANDROID_ROOT, "app", "build.gradle"))
    if "privacyCheck" not in gradle:
        add("build-wiring", os.path.join(ANDROID_ROOT, "app", "build.gradle"), 0,
            "Gradle build does not run the privacy gate")


def print_hosts():
    print("Allowlisted remote hosts (from privacy.config.json):")
    for entry in REMOTE:
        print("  %-28s %s  %s" % (entry["host"], entry["scheme"], "user-initiated" if entry.get("userInitiatedOnly") else "always"))
        for prefix in entry.get("pathPrefixes", []):
            print("      %s" % prefix)
    print("Loopback only: %s" % ", ".join(sorted(LOOPBACK_HOSTS)))
    print("External-link-only hosts: %s" % ", ".join(sorted(LINK_HOSTS)))


def main():
    if "--list-hosts" in sys.argv:
        print_hosts()
        return 0

    check_config()
    check_dependencies()
    check_web_network()
    check_native_network()
    check_android_manifest()
    check_apple_plists()
    check_storage()
    check_logging()
    check_identifiers()

    try:
        generator = load_generator()
        check_generated(generator)
    except Exception as error:  # noqa: BLE001 - a broken generator must fail the gate
        add("generator", os.path.join(SCRIPTS, "gen-privacy-config.py"), 0, "generator failed: %s" % error)

    check_drift()
    check_bundle()
    check_wasm_runtime()
    check_browser_view()
    check_back_control()
    check_drawer_list()
    check_build_wiring()

    blocking = [item for item in findings if item["blocking"]]
    info = [item for item in findings if not item["blocking"]]

    print("Dawaya privacy gate - %d files scanned against privacy.config.json" % len(scanned))
    if info:
        print("\n[info] %d" % len(info))
        for item in info[:10]:
            print("  %s  %s" % (item["path"], item["detail"]))
        if len(info) > 10:
            print("  ... %d more" % (len(info) - 10))

    if not blocking:
        print("PASS: no blocking privacy violations.")
        return 0

    groups = {}
    for item in blocking:
        groups.setdefault(item["kind"], []).append(item)
    for kind in sorted(groups, key=lambda name: (-len(groups[name]), name)):
        items = groups[kind]
        print("\n[%s] %d" % (kind, len(items)))
        for item in items[:40]:
            location = "%s:%d" % (item["path"], item["line"]) if item["line"] else item["path"]
            print("  %s  %s" % (location, item["detail"]))
        if len(items) > 40:
            print("  ... %d more" % (len(items) - 40))

    print("\n%d blocking violation(s). Build fails." % len(blocking))
    return 1


if __name__ == "__main__":
    sys.exit(main())
