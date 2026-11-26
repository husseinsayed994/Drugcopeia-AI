#!/usr/bin/env python3
"""
Dawaya AI - trusted source ingestion (developer tool, never shipped in the app).

What it does
  1. Reads tools/ai/sources.json: a manifest of documents that were published by an allowed
     official source and copied into tools/ai/sources/ (or fetched with --fetch).
  2. Refuses anything whose origin host is not in the domain allowlist of
     webapp/assets/ai/policy-config.json. There is no way to add a source off that list.
  3. Extracts plain text, splits it into passages, and normalizes Arabic and English exactly the
     way webapp/ai/text.js does at run time.
  4. Writes a real SQLite FTS5 database (tools/ai/out/knowledge.sqlite) as the reference
     implementation, and exports the shipped index the app loads
     (webapp/assets/ai/knowledge-index.json). Both come from one pass so they cannot drift.
  5. --emit-fts-check dumps the FTS5 ranking for a fixed query list; tests/ai/run-tests.mjs
     asserts the in-app engine returns the same passages, which keeps the two implementations honest.

The bundled condition topics (MedlinePlus, with url and retrieval date per record) are indexed
here too and exported as passages, so the app searches one index instead of re-tokenizing
conditions.json on a weak phone. The shipped JSON holds excerpts; the FTS5 copy holds full text.
Each topic summary is cut on NLM's own question headings, so a passage carries one section
(Symptoms, Diagnosis, Treatment, ...) whole instead of the first two passages of the page.

Usage
  python3 tools/ai/build_knowledge_index.py                   # build from local sources only
  python3 tools/ai/build_knowledge_index.py --fetch           # also download manifest urls
  python3 tools/ai/build_knowledge_index.py --emit-fts-check  # write the cross-engine check file
  python3 tools/ai/build_knowledge_index.py --excerpt-chars 700 --passages-per-topic 8
"""

import argparse
import datetime
import hashlib
import json
import os
import re
import sqlite3
import sys
import unicodedata
import urllib.request
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))  # Source/
WEBAPP = os.path.join(ROOT, "webapp")
POLICY_PATH = os.path.join(WEBAPP, "assets", "ai", "policy-config.json")
ALIASES_PATH = os.path.join(HERE, "aliases-ar.json")
MANIFEST_PATH = os.path.join(HERE, "sources.json")
SOURCES_DIR = os.path.join(HERE, "sources")
OUT_DIR = os.path.join(HERE, "out")
INDEX_OUT = os.path.join(WEBAPP, "assets", "ai", "knowledge-index.json")
SQLITE_OUT = os.path.join(OUT_DIR, "knowledge.sqlite")
CHECK_OUT = os.path.join(OUT_DIR, "fts-check.json")
DATASET_META_OUT = os.path.join(WEBAPP, "assets", "ai", "dataset-meta.json")
PARENT = os.path.dirname(ROOT)
VERSION_CANDIDATES = [os.path.join(ROOT, "VERSION.txt"), os.path.join(PARENT, "VERSION.txt")]
CONDITIONS_PATH = os.path.join(WEBAPP, "assets", "conditions.json")
DRUGS_PATH = os.path.join(WEBAPP, "assets", "egyptian-drugs.json")

TASHKEEL = re.compile(r"[ًٌٍَُِّْـ\u064b-\u0652\u0670\u0653-\u0655\u0640]")
ALEF = re.compile(r"[أإآٱ]")
ARABIC_PUNCT = re.compile(r"[،؛؟।]")
NON_WORD = re.compile(r"[^\w]+", re.UNICODE)
ARABIC = re.compile(r"[\u0600-\u06ff]")
ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
TAG = re.compile(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>")
BR_TAG = re.compile(r"(?i)<br\s*/?>|</p>|</div>|</li>|</h[1-6]>")
ANY_TAG = re.compile(r"(?s)<[^>]+>")
CHUNK_SOFT_LIMIT = 900
CHUNK_HARD_LIMIT = 1400

# NLM states the rules at https://medlineplus.gov/about/using/usingcontent/ : the summaries on
# health topic pages are works of the federal government and in the public domain, so they may be
# reproduced and redistributed, while the A.D.A.M. medical encyclopedia and the ASHP drug
# monographs on the same pages are copyrighted and must not be ingested. The wording is recorded
# per passage because the source card shows it and the reader should see which of the two it is.
NLM_TOPIC_SUMMARY_LICENSE = (
    "Public domain (U.S. federal government work): MedlinePlus health topic page summary. "
    "A.D.A.M. encyclopedia text is not included - see https://medlineplus.gov/about/using/usingcontent/"
)

# The queries the FTS5 reference and the in-app engine are compared on.
CHECK_QUERIES = [
    "paracetamol liver damage", "high blood pressure symptoms", "A1C normal level prediabetes",
    "aspirin stomach bleeding", "ibuprofen kidney", "amoxicillin rash allergy",
    "cholesterol statin muscle pain", "asthma reliever inhaler", "levothyroxine thyroid dose",
    "warfarin vitamin K foods", "diabetes type 2 blood sugar", "anemia iron deficiency fatigue",
    "asthma symptoms", "how is asthma diagnosed", "what increases the risk of stroke"
]


def normalize(value):
    """Mirror of webapp/ai/text.js normalize(). Change one, change the other, run --emit-fts-check."""
    text = unicodedata.normalize("NFKC", value or "")
    text = TASHKEEL.sub("", text)
    text = ALEF.sub("ا", text)
    for source, target in (("ؤ", "و"), ("ئ", "ي"), ("ى", "ي"), ("ة", "ه"), ("ک", "ك")):
        text = text.replace(source, target)
    text = text.translate(ARABIC_DIGITS)
    text = ARABIC_PUNCT.sub(" ", text)
    return re.sub(r"\s+", " ", text.lower()).strip()


def tokens(value):
    return [token for token in NON_WORD.split(normalize(value)) if token]


def allowed_hosts(policy):
    return sorted({host.lower().replace("www.", "") for host in policy["sources"]["allowedDomains"]})


def host_allowed(url, allowlist):
    host = (urlparse(url).netloc or "").lower()
    if not host:
        return False
    bare = host.replace("www.", "")
    for allowed in allowlist:
        needle = allowed.lower().replace("www.", "")
        if bare == needle or bare.endswith("." + needle):
            return True
    return False


def is_egyptian(url):
    return any(marker in (url or "") for marker in ("edaegypt.gov.eg", "mohp.gov.eg"))


def extract_text(raw, content_type=""):
    looks_html = "<" in raw and ">" in raw and (("html" in (content_type or "").lower()) or "<html" in raw.lower() or "<div" in raw.lower() or "<p" in raw.lower())
    if looks_html:
        body = TAG.sub(" ", raw)
        body = BR_TAG.sub("\n", body)
        body = ANY_TAG.sub(" ", body)
    else:
        body = raw
    body = (body.replace("&nbsp;", " ").replace("&amp;", "&").replace("&quot;", '"')
                .replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">"))
    lines = [re.sub(r"\s+", " ", line).strip() for line in body.splitlines()]
    text = "\n".join(line for line in lines if line)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def chunk(text):
    """Passages of roughly 900 characters, cut on paragraph and then sentence edges."""
    paragraphs = [block.strip() for block in re.split(r"\n\s*\n", text) if block.strip()]
    chunks, current = [], ""
    for paragraph in paragraphs:
        pieces, remainder = [], paragraph
        while len(remainder) > CHUNK_HARD_LIMIT:
            cut = remainder.rfind(". ", 0, CHUNK_SOFT_LIMIT)
            if cut < 200:
                cut = remainder.rfind(" ", 0, CHUNK_SOFT_LIMIT)
            if cut < 200:
                cut = CHUNK_SOFT_LIMIT
            pieces.append(remainder[:cut + 1].strip())
            remainder = remainder[cut + 1:].strip()
        if remainder:
            pieces.append(remainder)
        for piece in pieces:
            if not piece:
                continue
            if current and len(current) + len(piece) + 1 > CHUNK_SOFT_LIMIT:
                chunks.append(current)
                current = piece
            else:
                current = f"{current} {piece}".strip()
        if len(current) >= CHUNK_SOFT_LIMIT:
            chunks.append(current)
            current = ""
    if current:
        chunks.append(current)
    return [item for item in chunks if len(item) >= 80]


"""The topic summaries NLM writes for its health topic pages are organised as a run of
question headings ("What are the symptoms of asthma?", "How is asthma diagnosed?"). Cutting on
those headings keeps a section whole inside one passage, so a reader asking about diagnosis gets
the diagnosis paragraph instead of the two passages that happened to fall before it."""
HEADING = re.compile(r"(?m)^[ \t]*([A-Z][^\n?]{3,90}\?)[ \t]*$")
SECTION_LABELS = (
    ("symptom", "Symptoms"),
    ("sign of", "Symptoms"),
    ("diagnos", "Diagnosis"),
    ("what tests", "Diagnosis"),
    ("how is", "Diagnosis"),
    ("treat", "Treatment"),
    ("prevent", "Prevention"),
    ("risk", "Causes"),
    ("cause", "Causes"),
    ("spread", "Causes"),
    ("complicat", "Complications"),
    ("outlook", "Outlook"),
    ("prognos", "Outlook"),
    ("when to", "When to seek care"),
    ("seek care", "When to seek care"),
    ("call your", "When to seek care"),
)


def section_label(heading):
    low = (heading or "").lower()
    for needle, label in SECTION_LABELS:
        if needle in low:
            return label
    return "Overview"


def sections(text):
    """[(heading, passage text starting with that heading)], in page order.
       The heading stays inside the text: it is what a search for "symptoms" matches on."""
    marks = list(HEADING.finditer(text))
    if not marks:
        return [("", text.strip())] if text.strip() else []
    out = []
    lead = text[: marks[0].start()].strip()
    if lead:
        out.append(("", lead))
    for index, match in enumerate(marks):
        end = marks[index + 1].start() if index + 1 < len(marks) else len(text)
        body = text[match.start():end].strip()
        if body:
            out.append((match.group(1).strip(), body))
    return out


def sha256_of(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode("utf-8")).hexdigest()


def read_local(path):
    with open(path, "rb") as handle:
        raw = handle.read()
    return raw.decode("utf-8", errors="replace"), raw


def fetch(url, timeout=40):
    request = urllib.request.Request(url, headers={"user-agent": "DawayaKnowledgeIngest/1.0 (offline app build tool)"})
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - host is allowlisted above
        return response.read().decode("utf-8", errors="replace"), response.headers.get("content-type", "")


def load_json(path, fallback=None):
    if not os.path.exists(path):
        return fallback
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def documents_from_manifest(policy, allow_fetch=False):
    allowlist = allowed_hosts(policy)
    out, skipped = [], []
    manifest = load_json(MANIFEST_PATH, {"documents": []}) or {"documents": []}
    for entry in manifest.get("documents", []):
        url = entry.get("url", "")
        if not host_allowed(url, allowlist):
            skipped.append((entry.get("id", "?"), url, "origin host is not in the policy allowlist"))
            continue
        raw, digest = None, ""
        if entry.get("file"):
            path = os.path.join(HERE, entry["file"])
            if not os.path.exists(path):
                skipped.append((entry.get("id", "?"), entry["file"], "local copy is missing; drop the file in tools/ai/sources/"))
                continue
            raw, data = read_local(path)
            digest = sha256_of(data)
        elif allow_fetch:
            raw, _content_type = fetch(url)
            digest = sha256_of(raw)
        else:
            skipped.append((entry.get("id", "?"), url, "no local copy and --fetch was not given"))
            continue
        text = extract_text(raw)
        if len(text) < 120:
            skipped.append((entry.get("id", "?"), url, "less than 120 characters of usable text after tag removal"))
            continue
        passages = chunk(text)
        for index, passage in enumerate(passages):
            out.append({
                "id": f"{entry.get('id') or digest[:12]}-{index}",
                "title": entry.get("title") or url,
                "text": passage,
                "fullText": text,
                "aliases": [alias for alias in (entry.get("aliases") or []) if alias],
                "source": {
                    "nameEn": entry.get("nameEn", ""),
                    "nameAr": entry.get("nameAr", ""),
                    "url": url,
                    "date": entry.get("date", ""),
                    "language": entry.get("language", "en"),
                    "license": entry.get("license", ""),
                    "region": "egypt" if is_egyptian(url) else "international",
                    "digest": digest
                }
            })
    return out, skipped


def alias_values(value):
    """An alias entry is one Arabic string, or a list when a topic has several common names."""
    if isinstance(value, list):
        return [item for item in value if item]
    return [value] if value else []


def documents_from_conditions(aliases, excerpt_chars, passages_per_topic, passages_per_section=2):
    if not os.path.exists(CONDITIONS_PATH):
        return [], {}
    payload = load_json(CONDITIONS_PATH)
    meta = payload.get("meta", {})
    out = []
    for topic in payload.get("topics", []):
        summary = (topic.get("summary") or "").strip()
        if len(summary) < 120:
            continue
        title = topic.get("title") or topic.get("primaryName") or ""
        arabic = alias_values(aliases.get(title, ""))
        passage = 0
        for heading, body in sections(summary):
            if passage >= passages_per_topic:
                break
            label = section_label(heading)
            for piece in chunk(body)[:passages_per_section]:
                if passage >= passages_per_topic:
                    break
                passage += 1
                out.append({
                    "id": f"cond-{topic.get('id')}-{passage}",
                    "title": title,
                    "section": label,
                    "text": piece[:excerpt_chars],
                    "fullText": summary,
                    "aliases": [value for value in arabic + list(topic.get("synonyms") or []) if value],
                    "source": {
                        "nameEn": meta.get("source", "MedlinePlus"),
                        "nameAr": "ميدلاين بلس — المكتبة الوطنية للطب (NIH)",
                        "url": topic.get("url", ""),
                        "date": meta.get("retrieved", ""),
                        "language": meta.get("language", "en"),
                        "license": NLM_TOPIC_SUMMARY_LICENSE,
                        "region": "international"
                    }
                })
    alias_map = {title: values for title, raw in aliases.items() if (values := alias_values(raw))}
    return out, alias_map


def write_dataset_meta():
    """Section 4: medicine rows carry no source column, so an answer has to name the app database
    and its version instead of pretending the row came from an official leaflet."""
    version, date = "", ""
    for path in VERSION_CANDIDATES:
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as handle:
            for line in handle.read().splitlines():
                if re.match(r"^Dawaya \d", line):
                    version = line.split("(", 1)[0].replace("Dawaya", "").strip()
                if line.startswith("Release date:"):
                    date = line.split(":", 1)[1].strip()
        if version or date:
            break
    # VERSION.txt no longer ships; the app release is Source/REVISION and the build date.
    if not version:
        revision_path = os.path.join(ROOT, "REVISION")
        if os.path.exists(revision_path):
            with open(revision_path, encoding="utf-8") as handle:
                revision = handle.read().strip()
            if revision:
                version = f"r{revision}"
    if not date:
        date = datetime.date.today().isoformat()
    drugs = load_json(DRUGS_PATH, []) or []
    keys = ("source_url", "source", "indications", "contraindications", "warnings", "interactions", "leaflet_url", "barcode")
    coverage = {key: sum(1 for row in drugs if key in row) for key in keys}
    meta = {
        "version": version or "unknown",
        "date": date or "unknown",
        "records": len(drugs),
        "sourceNameEn": "Dawaya Egyptian medicines database (Egyptian market listing)",
        "sourceNameAr": "قاعدة بيانات الأدوية المصرية داخل التطبيق",
        "url": "https://github.com/hussein-elnagmy/egyptian-drug-database",
        "license": "MIT (EG Drugs dataset by Mahmoud Mohamed) — see webapp/assets/vendor/LICENSE-eg-drugs.txt",
        "fieldCoverage": coverage,
        "rowsWithoutSource": sum(1 for row in drugs if not (row.get("source") or row.get("source_url"))),
        "comment": "The Egyptian listing carries trade names, ingredient, company, class, route and price. It carries no per-record source url and no indications, warnings or contraindications, so the assistant flags that instead of inventing them."
    }
    os.makedirs(os.path.dirname(DATASET_META_OUT), exist_ok=True)
    with open(DATASET_META_OUT, "w", encoding="utf-8") as handle:
        json.dump(meta, handle, ensure_ascii=False, indent=2)
    return meta


def entry_for_export(entry):
    exported = {
        "id": entry["id"],
        "title": entry["title"],
        "aliases": entry["aliases"],
        "text": entry["text"],
        "source": entry["source"]
    }
    if entry.get("section"):
        exported["section"] = entry["section"]
    return exported


def build_sqlite(entries):
    if os.path.exists(SQLITE_OUT):
        os.remove(SQLITE_OUT)
    connection = sqlite3.connect(SQLITE_OUT)
    connection.executescript("""
      CREATE TABLE docs (
        id TEXT PRIMARY KEY, title TEXT, title_ar TEXT, url TEXT,
        source_name_en TEXT, source_name_ar TEXT, published TEXT,
        language TEXT, license TEXT, region TEXT, digest TEXT
      );
      CREATE TABLE chunks (doc_rowid INTEGER, ordinal INTEGER, text TEXT, normalized TEXT);
      CREATE VIRTUAL TABLE chunks_fts USING fts5(
        body, title, aliases, tokenize='unicode61 remove_diacritics 2'
      );
    """)
    for entry in entries:
        title_ar = next((alias for alias in entry["aliases"] if ARABIC.search(alias)), "")
        cursor = connection.execute(
            "INSERT INTO docs (id, title, title_ar, url, source_name_en, source_name_ar, published, language, license, region, digest) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (entry["id"], entry["title"], title_ar, entry["source"]["url"], entry["source"]["nameEn"],
             entry["source"]["nameAr"], entry["source"]["date"], entry["source"]["language"],
             entry["source"]["license"], entry["source"]["region"], entry["source"].get("digest", ""))
        )
        rowid = cursor.lastrowid
        connection.execute("INSERT INTO chunks (doc_rowid, ordinal, text, normalized) VALUES (?,?,?,?)",
                           (rowid, 0, entry.get("fullText", entry["text"]), normalize(entry["text"])))
        # FTS is fed the normalized form so alef, yaa and taa marbuta variants collapse the way
        # they do in the app; unicode61 alone cannot do that for Arabic.
        connection.execute(
            "INSERT INTO chunks_fts (rowid, body, title, aliases) VALUES (?,?,?,?)",
            (rowid, normalize(entry["text"]), normalize(entry["title"]), normalize(" ".join(entry["aliases"])))
        )
    connection.commit()
    return connection


def fts_query(connection, query, limit=5):
    terms = [token for token in NON_WORD.split(normalize(query)) if len(token) >= 3]
    if not terms:
        return []
    match = " OR ".join(f'"{term}"' for term in terms)
    try:
        rows = connection.execute(
            "SELECT rowid, bm25(chunks_fts, 1.0, 6.0, 5.0) AS score FROM chunks_fts "
            "WHERE chunks_fts MATCH ? ORDER BY score LIMIT ?",
            (match, limit)
        ).fetchall()
    except sqlite3.OperationalError as error:
        print(f"FTS query failed: {error}", file=sys.stderr)
        return []
    return [rowid for rowid, _score in rows]


def emit_check(connection, entries):
    by_rowid = {index + 1: entry["id"] for index, entry in enumerate(entries)}
    results = [{"query": query, "ids": [by_rowid[row] for row in fts_query(connection, query, 3) if row in by_rowid]} for query in CHECK_QUERIES]
    with open(CHECK_OUT, "w", encoding="utf-8") as handle:
        json.dump({"generator": "sqlite-fts5", "fieldWeights": [1.0, 6.0, 5.0], "results": results}, handle, ensure_ascii=False, indent=2)
    return results


def main():
    parser = argparse.ArgumentParser(description="Build the Dawaya offline knowledge index from allowlisted official sources.")
    parser.add_argument("--fetch", action="store_true", help="download manifest urls that have no local copy")
    parser.add_argument("--emit-fts-check", action="store_true", help="write the FTS5 ranking used by the cross-engine test")
    parser.add_argument("--excerpt-chars", type=int, default=700, help="characters of each passage kept in the shipped JSON")
    parser.add_argument("--passages-per-topic", type=int, default=8,
                        help="passages kept per bundled condition topic (sections come first, so 8 covers a whole page summary)")
    parser.add_argument("--skip-conditions", action="store_true", help="index manifest documents only")
    args = parser.parse_args()

    policy = load_json(POLICY_PATH)
    if not policy:
        print(f"missing policy at {POLICY_PATH}", file=sys.stderr)
        return 2
    aliases = load_json(ALIASES_PATH, {"conditions": {}})["conditions"]

    manifest_docs, skipped = documents_from_manifest(policy, args.fetch)
    condition_docs, alias_map = ([], {}) if args.skip_conditions else documents_from_conditions(aliases, args.excerpt_chars, args.passages_per_topic)
    documents = manifest_docs + condition_docs

    for doc_id, origin, why in skipped:
        print(f"REJECTED {doc_id} {origin} — {why}")
    if not documents:
        print("nothing to index: the manifest has no usable document", file=sys.stderr)
        return 1

    os.makedirs(OUT_DIR, exist_ok=True)
    connection = build_sqlite(documents)
    payload = {
        "schemaVersion": 1,
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "generator": "tools/ai/build_knowledge_index.py",
        "coversConditions": not args.skip_conditions,
        "allowlist": allowed_hosts(policy),
        "counts": {
            "passages": len(documents),
            "manifestDocuments": len(manifest_docs),
            "conditionPassages": len(condition_docs),
            "conditionTopics": len({doc["title"] for doc in condition_docs}),
            "sections": {label: sum(1 for doc in condition_docs if doc.get("section") == label)
                         for label in sorted({doc["section"] for doc in condition_docs if doc.get("section")})},
            "distinctManifestSources": len({doc["source"]["url"] for doc in manifest_docs})
        },
        "conditionAliasesEnAr": alias_map,
        "entries": [entry_for_export(entry) for entry in documents]
    }
    with open(INDEX_OUT, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False)
    meta = write_dataset_meta()
    if args.emit_fts_check:
        emit_check(connection, documents)
    rows = connection.execute("SELECT COUNT(*) FROM chunks_fts").fetchone()[0]
    connection.close()
    print(f"wrote {os.path.relpath(INDEX_OUT, ROOT)} — {os.path.getsize(INDEX_OUT)/1024:.0f} KB, {len(documents)} passages")
    print(f"wrote {os.path.relpath(SQLITE_OUT, ROOT)} — FTS5 reference copy ({rows} rows)")
    if args.emit_fts_check:
        print(f"wrote {os.path.relpath(CHECK_OUT, ROOT)} — {len(CHECK_QUERIES)} queries")
    print(f"dataset meta: version {meta['version']} dated {meta['date']}, {meta['records']} medicine rows, {meta['rowsWithoutSource']} of them without a source field")
    return 0


if __name__ == "__main__":
    sys.exit(main())
