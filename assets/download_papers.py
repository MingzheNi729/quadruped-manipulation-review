#!/usr/bin/env python3
"""Download openly accessible PDF links from papers.json using Python's standard library.

Usage: python3 download_papers.py [papers.json] [--output pdfs]
No account, credentials, browser cookies, or paywall bypass is used.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

CHUNK = 64 * 1024
MANIFEST_LIMIT = 20 * 1024 * 1024
MAX_PAPERS = 10000


def safe_url(value):
    if not isinstance(value, str) or len(value) > 8192:
        raise ValueError("Missing or oversized PDF URL")
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError("Control characters are not allowed in URLs")
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        raise ValueError("Only absolute HTTPS URLs are allowed")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("URLs containing credentials are not allowed")
    try:
        parsed.port
    except ValueError as exc:
        raise ValueError("Invalid URL port") from exc
    return urllib.parse.urlunsplit(parsed._replace(fragment=""))


class HTTPSRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        safe_url(newurl)  # Refuse HTTPS-to-HTTP redirects before making a request.
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def filename(paper, url):
    def slug(value, length):
        value = unicodedata.normalize("NFKD", str(value or ""))
        value = value.encode("ascii", "ignore").decode("ascii")
        return re.sub(r"[^A-Za-z0-9_-]+", "_", value).strip("._-")[:length] or "paper"
    identity = json.dumps([str(paper.get("id", "")), str(paper.get("title", "")), url], ensure_ascii=False)
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]
    return f"{slug(paper.get('id'), 36)}_{slug(paper.get('title'), 70)}_{digest}.pdf"


def valid_pdf(path):
    """Conservative file sanity check, not a full PDF syntax/security validator."""
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size < 20:
            return False
        with path.open("rb") as handle:
            if not re.match(rb"%PDF-[12]\.\d", handle.read(8)):
                return False
            handle.seek(max(0, path.stat().st_size - CHUNK))
            return b"%%EOF" in handle.read()
    except OSError:
        return False


def csv_safe(value):
    value = str(value if value is not None else "")
    # Spreadsheet programs can execute leading formula characters even in quoted CSV.
    if value.lstrip().startswith(("=", "+", "-", "@")) or value.startswith(("\t", "\r", "\n")):
        return "'" + value
    return value


def download_one(paper, output, *, opener=None, max_bytes=100 * 1024 * 1024,
                 timeout=30, retries=2, sleep=time.sleep):
    row = {"id": str(paper.get("id", "")), "title": str(paper.get("title", "")),
           "pdf_url": str(paper.get("pdf") or paper.get("pdf_url") or ""),
           "file": "", "status": "", "attempts": 0, "bytes": 0, "message": ""}
    if not row["pdf_url"]:
        row.update(status="no_pdf", message="No PDF link in the manifest; visit the primary source manually.")
        return row
    try:
        url = safe_url(row["pdf_url"])
    except (ValueError, TypeError) as exc:
        row.update(status="failed", message=str(exc))
        return row
    target = output / filename(paper, url)
    row["file"] = target.name
    if target.exists() or target.is_symlink():
        if valid_pdf(target):
            row.update(status="skipped", bytes=target.stat().st_size, message="Existing PDF passed header/EOF checks.")
        else:
            row.update(status="failed", message="Destination already exists and is not a valid PDF; left untouched.")
        return row
    opener = opener or urllib.request.build_opener(HTTPSRedirectHandler())
    for attempt in range(retries + 1):
        temporary = None
        row["attempts"] = attempt + 1
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "ResearchLibraryPDFDownloader/1.0", "Accept": "application/pdf", "Accept-Encoding": "identity"})
            with opener.open(request, timeout=timeout) as response:
                safe_url(response.geturl())
                if getattr(response, "status", 200) != 200:
                    raise ValueError("Server did not return a complete 200 response")
                length = response.headers.get("Content-Length")
                if length and int(length) > max_bytes:
                    raise ValueError("PDF exceeds the configured size limit")
                with tempfile.NamedTemporaryFile(mode="wb", prefix=".download-", suffix=".part", dir=output, delete=False) as handle:
                    temporary = Path(handle.name)
                    total = 0
                    deadline = time.monotonic() + timeout * 3
                    read_chunk = getattr(response, "read1", response.read)
                    prefix = b""
                    while True:
                        if time.monotonic() > deadline:
                            raise TimeoutError("Download exceeded its total time budget")
                        block = read_chunk(CHUNK)
                        if not block:
                            break
                        total += len(block)
                        if total > max_bytes:
                            raise ValueError("Response exceeds the configured size limit")
                        if len(prefix) < 8:
                            prefix = (prefix + block)[:8]
                        if len(prefix) >= 8 and not re.match(rb"%PDF-[12]\.\d", prefix):
                            raise ValueError("Response is not a PDF (HTML/login pages are not saved)")
                        handle.write(block)
                    handle.flush()
                    os.fsync(handle.fileno())
                if not valid_pdf(temporary):
                    raise ValueError("Incomplete or invalid PDF: missing PDF header or end marker")
                # An atomic hard-link publishes the completed file without replacing anything.
                # Both paths are on the same filesystem. EEXIST protects concurrent runs.
                os.link(temporary, target)
                row.update(status="success", bytes=total, message="Downloaded; PDF header/EOF checks passed.")
                return row
        except urllib.error.HTTPError as exc:
            row["message"] = f"HTTP {exc.code}; no authentication or paywall bypass attempted."
            if exc.code not in (408, 429, 500, 502, 503, 504):
                break
        except FileExistsError:
            if valid_pdf(target):
                row.update(status="skipped", bytes=target.stat().st_size, message="Another run created this PDF; left untouched.")
                return row
            row["message"] = "Destination appeared during download; left untouched."
            break
        except ValueError as exc:
            row["message"] = str(exc)
            break  # Invalid content, unsafe redirects, and oversize responses are not retried.
        except (OSError, urllib.error.URLError) as exc:
            row["message"] = f"Download failed: {type(exc).__name__}: {exc}"
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
        if attempt < retries:
            sleep(min(2 ** attempt, 4))
    row["status"] = "failed"
    return row


def bounded_float(low, high):
    def convert(value):
        value = float(value)
        if not low <= value <= high:
            raise argparse.ArgumentTypeError(f"Value must be between {low} and {high}")
        return value
    return convert


def main(argv=None):
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("manifest", nargs="?", type=Path, default=here / "papers.json")
    parser.add_argument("--output", type=Path, default=here / "pdfs", help="PDF and CSV log directory (default: pdfs beside this script)")
    parser.add_argument("--max-mb", type=bounded_float(0.01, 1024), default=100, help="Maximum size of each PDF in MiB (default: 100)")
    parser.add_argument("--timeout", type=bounded_float(1, 120), default=30, help="Socket timeout in seconds (default: 30)")
    parser.add_argument("--retries", type=int, choices=range(0, 6), default=2, help="Retries after transient failures (default: 2)")
    parser.add_argument("--delay", type=bounded_float(0, 60), default=1, help="Pause between paper requests in seconds (default: 1)")
    args = parser.parse_args(argv)
    try:
        with args.manifest.open("rb") as handle:
            raw = handle.read(MANIFEST_LIMIT + 1)
        if len(raw) > MANIFEST_LIMIT:
            raise ValueError("Manifest exceeds 20 MB")
        manifest = json.loads(raw.decode("utf-8-sig"))
        papers = manifest.get("papers") if isinstance(manifest, dict) else None
        if not isinstance(papers, list) or len(papers) > MAX_PAPERS:
            raise ValueError("Manifest must contain a papers array with at most 10,000 entries")
        if not all(isinstance(p, dict) for p in papers):
            raise ValueError("Every paper entry must be an object")
        args.output.mkdir(parents=True, exist_ok=True)
    except (OSError, ValueError, UnicodeError) as exc:
        parser.error(str(exc))
    # Unique log filename prevents overwriting logs from previous or concurrent runs.
    log_handle = tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="", prefix="download-log-", suffix=".csv", dir=args.output, delete=False)
    counts = {status: 0 for status in ("success", "skipped", "no_pdf", "failed")}
    fields = ["id", "title", "pdf_url", "file", "status", "attempts", "bytes", "message"]
    opener = urllib.request.build_opener(HTTPSRedirectHandler())
    print(f"Processing {len(papers)} records. Open-access PDF links only.")
    with log_handle:
        writer = csv.DictWriter(log_handle, fieldnames=fields)
        writer.writeheader()
        for index, paper in enumerate(papers):
            if index:
                time.sleep(args.delay)
            row = download_one(paper, args.output, opener=opener, max_bytes=int(args.max_mb * 1024 * 1024), timeout=args.timeout, retries=args.retries)
            counts[row["status"]] += 1
            writer.writerow({key: csv_safe(row[key]) for key in fields})
            log_handle.flush()
            print(f"[{index + 1}/{len(papers)}] {row['status']}")
    print("; ".join(f"{key}: {value}" for key, value in counts.items()))
    print(f"Log: {log_handle.name}")
    return 1 if counts["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
