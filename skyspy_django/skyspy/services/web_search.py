"""
Runtime web search + public-image lookup.

A small, pluggable search layer used to *ground* LLM output in live web sources
(currently the airframe type-card generator). ``search()`` returns snippet
results from the configured provider; ``gather_airframe_context()`` is the
airframe-specific orchestrator that also pulls an encyclopaedic extract and a
public lead photo for one aircraft type.

Providers (``WEB_SEARCH_PROVIDER``):
- ``wikipedia`` (default, keyless) — MediaWiki search + REST summary extracts.
  Also the source of the public type photo (Wikipedia/Wikimedia lead image).
- ``tavily`` / ``brave`` — keyed general web search (set ``WEB_SEARCH_API_KEY``).
- ``searxng`` — self-hosted meta-search JSON API (set ``WEB_SEARCH_URL``).
- ``duckduckgo`` — keyless HTML endpoint scrape (brittle; best-effort).

Everything degrades to ``[]`` / ``None`` on any failure — a search outage must
never break the caller. All HTTP goes through ``http_client`` so each provider
gets circuit-breaker + retry protection.
"""

import html
import logging
import re
from urllib.parse import quote

from django.conf import settings

from skyspy.services import http_client

logger = logging.getLogger(__name__)


def _ua() -> str:
    # Wikimedia requires a descriptive UA with contact info or it 403s.
    return getattr(settings, "WEB_SEARCH_USER_AGENT", "") or "skyspy/3 (+https://github.com/skyspy/skyspy)"


def _provider() -> str:
    return (getattr(settings, "WEB_SEARCH_PROVIDER", "") or "wikipedia").lower().strip()


def is_enabled() -> bool:
    return bool(getattr(settings, "WEB_SEARCH_ENABLED", True))


# --------------------------------------------------------------------------- #
# Wikipedia / Wikimedia (keyless default)
# --------------------------------------------------------------------------- #
_WIKI_API = "https://en.wikipedia.org/w/api.php"
_WIKI_REST = "https://en.wikipedia.org/api/rest_v1/page/summary/"


def _wikipedia_titles(query: str, n: int) -> list[str]:
    data = http_client.get_json(
        _WIKI_API,
        source="wikipedia",
        params={"action": "query", "list": "search", "srsearch": query, "srlimit": n, "format": "json"},
        headers={"User-Agent": _ua()},
        rate=(100, 60),
    )
    if not data:
        return []
    return [row["title"] for row in data.get("query", {}).get("search", []) if row.get("title")]


# Lead images that are NOT a subject photo — flags/logos/maps/vector icons that
# appear on index or infobox pages. Rejected so a card never shows e.g. the ICAO
# flag pulled from a "List of aircraft type designators" page.
_BAD_IMAGE_RE = re.compile(r"(flag|logo|icon|map|seal|coat[_ ]of[_ ]arms|emblem|_svg|\.svg)", re.I)
# Wikipedia index/aggregate pages — useless as a type dossier or photo source.
_INDEX_TITLE_RE = re.compile(r"^(list of|index of|outline of|comparison of)\b", re.I)


def _wikipedia_summary(title: str) -> dict | None:
    """REST summary for one page: extract + canonical page URL + lead image."""
    if _INDEX_TITLE_RE.match(title.strip()):
        return None  # skip "List of aircraft type designators" etc.
    data = http_client.get_json(
        _WIKI_REST + quote(title.replace(" ", "_"), safe=""),
        source="wikipedia",
        headers={"User-Agent": _ua()},
    )
    if not data or data.get("type") == "disambiguation":
        return None
    if _INDEX_TITLE_RE.match((data.get("title") or "").strip()):
        return None
    extract = (data.get("extract") or "").strip()
    if not extract:
        return None
    page = (data.get("content_urls", {}).get("desktop", {}) or {}).get("page") or data.get("canonicalurl")
    thumb = (data.get("thumbnail") or {}).get("source")
    original = (data.get("originalimage") or {}).get("source")
    # Drop non-photo lead images (flags/logos/vector icons).
    if thumb and _BAD_IMAGE_RE.search(thumb):
        thumb = original = None
    return {
        "title": data.get("title") or title,
        "extract": extract,
        "url": page,
        "image": _scale_commons_thumb(thumb, 960) if thumb else None,
        "image_full": original or thumb,
    }


def _scale_commons_thumb(url: str, width: int) -> str:
    """Rewrite a Wikimedia thumbnail URL to a target width (bounds image size)."""
    return re.sub(r"/(\d+)px-", f"/{width}px-", url) if url else url


def _wikipedia_search(query: str, n: int) -> list[dict]:
    out = []
    for title in _wikipedia_titles(query, n):
        s = _wikipedia_summary(title)
        if s:
            out.append({"title": s["title"], "url": s["url"], "snippet": s["extract"]})
        if len(out) >= n:
            break
    return out


# --------------------------------------------------------------------------- #
# Keyed / self-hosted general web providers
# --------------------------------------------------------------------------- #
def _tavily_search(query: str, n: int) -> list[dict]:
    key = getattr(settings, "WEB_SEARCH_API_KEY", "")
    if not key:
        return []
    data = http_client.post_json(
        "https://api.tavily.com/search",
        {"api_key": key, "query": query, "max_results": n, "search_depth": "basic"},
        source="tavily",
    )
    if not data:
        return []
    return [
        {"title": r.get("title", ""), "url": r.get("url", ""), "snippet": (r.get("content") or "").strip()}
        for r in data.get("results", [])
    ][:n]


def _brave_search(query: str, n: int) -> list[dict]:
    key = getattr(settings, "WEB_SEARCH_API_KEY", "")
    if not key:
        return []
    data = http_client.get_json(
        "https://api.search.brave.com/res/v1/web/search",
        source="brave",
        params={"q": query, "count": n},
        headers={"X-Subscription-Token": key, "Accept": "application/json"},
    )
    if not data:
        return []
    return [
        {"title": r.get("title", ""), "url": r.get("url", ""), "snippet": (r.get("description") or "").strip()}
        for r in data.get("web", {}).get("results", [])
    ][:n]


def _searxng_search(query: str, n: int) -> list[dict]:
    base = getattr(settings, "WEB_SEARCH_URL", "")
    if not base:
        return []
    data = http_client.get_json(
        f"{base.rstrip('/')}/search",
        source="searxng",
        params={"q": query, "format": "json"},
    )
    if not data:
        return []
    return [
        {"title": r.get("title", ""), "url": r.get("url", ""), "snippet": (r.get("content") or "").strip()}
        for r in data.get("results", [])
    ][:n]


def _duckduckgo_search(query: str, n: int) -> list[dict]:
    body = http_client.get_text(
        f"https://html.duckduckgo.com/html/?q={quote(query)}",
        source="duckduckgo",
        headers={"User-Agent": _ua()},
    )
    if not body:
        return []
    out = []
    for m in re.finditer(r'result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', body, re.DOTALL):
        url, title = m.group(1), re.sub(r"<[^>]+>", "", m.group(2))
        out.append({"title": html.unescape(title).strip(), "url": html.unescape(url), "snippet": ""})
        if len(out) >= n:
            break
    return out


_PROVIDERS = {
    "wikipedia": _wikipedia_search,
    "tavily": _tavily_search,
    "brave": _brave_search,
    "searxng": _searxng_search,
    "duckduckgo": _duckduckgo_search,
}


def search(query: str, max_results: int = 5, provider: str | None = None) -> list[dict]:
    """Web search via the configured provider. Returns ``[{title,url,snippet}]``."""
    query = (query or "").strip()
    if not query or not is_enabled():
        return []
    fn = _PROVIDERS.get((provider or _provider()), _wikipedia_search)
    try:
        return fn(query, max(1, min(max_results, 10)))
    except Exception as e:  # broad: search is best-effort grounding — never propagate
        logger.warning("web_search(%s) failed: %s", query, e)
        return []


# --------------------------------------------------------------------------- #
# Airframe-specific orchestrator
# --------------------------------------------------------------------------- #
def gather_airframe_context(type_code: str, hints: dict | None = None, max_chars: int = 4000) -> dict:
    """
    Assemble live web context + a public lead photo for one aircraft type.

    Returns ``{"text", "sources": [{title,url}], "image": {url, full, page,
    credit} | None}``. ``text`` is a compact, source-attributed block for the LLM
    prompt. Wikipedia is always consulted for the encyclopaedic extract + lead
    image (public/Wikimedia), even when the text provider is a keyed general
    engine — general engines don't return usable type imagery.
    """
    hints = hints or {}
    name = " ".join(str(hints.get(k, "")).strip() for k in ("manufacturer", "model")).strip()
    name = name or str(hints.get("type_name", "")).strip()
    query = f"{name} aircraft" if name else f"{type_code} aircraft type"

    sources: list[dict] = []
    blocks: list[str] = []
    image = None

    # Provider snippets first (also mines the correct Wikipedia article — a bare
    # designator like "SU95" mis-searches on MediaWiki alone, but a general engine
    # surfaces the real type page).
    provider_hits = []
    if _provider() != "wikipedia":
        provider_hits = search(query, max_results=getattr(settings, "WEB_SEARCH_MAX_RESULTS", 5))

    # Candidate Wikipedia titles: explicit name hint → titles from provider
    # results → MediaWiki search. First one that yields a real page wins.
    candidates = [name] if name else []
    candidates += [_wikipedia_title_from_url(r.get("url", "")) for r in provider_hits]
    candidates += _wikipedia_titles(query, 3)

    page = None
    seen_titles = set()
    for cand in candidates:
        cand = (cand or "").strip()
        if not cand or cand.lower() in seen_titles:
            continue
        seen_titles.add(cand.lower())
        page = _wikipedia_summary(cand)
        if page:
            break
    if page:
        sources.append({"title": page["title"], "url": page["url"]})
        blocks.append(f"[{page['title']} — {page['url']}]\n{page['extract']}")
        if page.get("image"):
            image = {
                "url": page["image"],
                "full": page.get("image_full") or page["image"],
                "page": page["url"],
                "credit": "Wikipedia / Wikimedia Commons",
            }

    # Append the provider snippets as additional grounding.
    for r in provider_hits:
        if r.get("snippet"):
            sources.append({"title": r["title"], "url": r["url"]})
            blocks.append(f"[{r['title']} — {r['url']}]\n{r['snippet']}")

    text = "\n\n".join(blocks)[:max_chars]
    return {"text": text, "sources": sources[:8], "image": image}


def _wikipedia_title_from_url(url: str) -> str:
    """Extract a page title from an en.wikipedia.org/wiki/<Title> URL, else ''."""
    from urllib.parse import unquote

    m = re.search(r"en\.wikipedia\.org/wiki/([^#?]+)", url or "")
    return unquote(m.group(1)).replace("_", " ") if m else ""
