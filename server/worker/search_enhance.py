"""
Fuzzy search enhancement
-> three matching layers: difflib edit-distance, n-gram character overlap, Soundex phonetic.
-> a growing known-word index (from past results) powers query correction.
-> when a search returns zero results, automatically retries with a corrected query.
"""

import difflib
import json
import re
import threading
import unicodedata
from collections import defaultdict

from config import DATA_DIR

# ──────────────────────────────────────────────
# Config knobs
# ──────────────────────────────────────────────

_ENTITIES_FILE     = DATA_DIR / "search_entities.json"
_NGRAM_N           = 3     # trigrams  ("bea", "eat", "atl" …)
_MIN_WORD_LEN      = 3     # ignore short tokens: "a", "by", "in" …
_FUZZY_CUTOFF      = 0.82  # difflib ratio threshold for score_fuzzy
_SUGGEST_CUTOFF    = 0.72  # difflib ratio threshold for suggest_query ranking
_NGRAM_MIN_OVERLAP = 0.30  # min fraction of trigrams a candidate must share


# ──────────────────────────────────────────────
# Shared indexes  (all protected by _lock)
# ──────────────────────────────────────────────

_lock          = threading.Lock()
_words: set[str]                       = set()
_ngram_index:   dict[str, set[str]]   = defaultdict(set)   # trigram  → words
_soundex_index: dict[str, list[str]]  = defaultdict(list)  # sx_code  → words


# ──────────────────────────────────────────────
# Text normalization
# ──────────────────────────────────────────────

def _norm(text: str) -> str:
    """Lowercase + strip combining accents  (é→e, ñ→n, ü→u …)."""
    nfd = unicodedata.normalize("NFD", text.lower().strip())
    return "".join(c for c in nfd if unicodedata.category(c) != "Mn")


def _collapse_repeats(word: str) -> str:
    """
    Collapse any run of the same character to a single occurrence.
      "quannnic" → "quanic"
      "quannic"  → "quanic"    ← same canonical form → match
      "zeppelin" → "zepelin"
      "zepelin"  → "zepelin"   ← same canonical form → match
    """
    return re.sub(r"(.)\1+", r"\1", word)


def _collapse_spaced_letters(text: str) -> str:
    """
    Collapse runs of single space-separated letters into one word.
      "r u s s"  → "russ"
      "j o j o"  → "jojo"
    Handles stylised artist names where each letter is written separately.
    """
    return re.sub(r'\b([a-z])(\s+[a-z])+\b', lambda m: m.group(0).replace(' ', ''), text)


def _tokenize(text: str) -> list[str]:
    expanded = _collapse_spaced_letters(_norm(text))
    return [w for w in expanded.split() if len(w) >= _MIN_WORD_LEN]


# ──────────────────────────────────────────────
# N-gram helpers
# ──────────────────────────────────────────────

def _ngrams(word: str) -> set[str]:
    """Character n-grams with boundary markers  ("$" + word + "$")."""
    padded = f"${word}$"
    return {padded[i : i + _NGRAM_N] for i in range(len(padded) - _NGRAM_N + 1)}


def _ngram_jaccard(a: str, b: str) -> float:
    ng_a, ng_b = _ngrams(a), _ngrams(b)
    union = ng_a | ng_b
    return len(ng_a & ng_b) / len(union) if union else 0.0


def _ngram_candidates(word: str) -> set[str]:
    """
    Return known words that share enough n-grams with *word* to be worth checking.
    Uses the n-gram index as a fast pre-filter — avoids scanning the full vocabulary.
    """
    word_grams = _ngrams(word)
    min_hits   = max(1, round(len(word_grams) * _NGRAM_MIN_OVERLAP))
    counts: dict[str, int] = defaultdict(int)
    with _lock:
        for gram in word_grams:
            for candidate in _ngram_index.get(gram, set()):
                counts[candidate] += 1
    return {w for w, n in counts.items() if n >= min_hits}


# ──────────────────────────────────────────────
# Soundex  (simplified, accent-aware)
# ──────────────────────────────────────────────

# Consonant → digit mapping (standard Soundex table)
_SDXMAP: dict[str, str] = {
    'b': '1', 'f': '1', 'p': '1', 'v': '1',
    'c': '2', 'g': '2', 'j': '2', 'k': '2',
    'q': '2', 's': '2', 'x': '2', 'z': '2',
    'd': '3', 't': '3',
    'l': '4',
    'm': '5', 'n': '5',
    'r': '6',
}


def _soundex(word: str) -> str:
    """
    Soundex phonetic code — letter + 3 digits, padded with zeros.

    Examples:
      "beyonce"  → "B520"   "beyonca"  → "B520"  (same → phonetic hit)
      "zeppelin" → "Z145"   "zepelin"  → "Z145"
      "kanye"    → "K500"   "kanyie"   → "K500"
    """
    word = _norm(word)
    if not word:
        return "Z000"

    first  = word[0].upper()
    digits: list[str] = []
    prev   = _SDXMAP.get(word[0], "")   # digit of the first letter (may be "")

    for ch in word[1:]:
        d = _SDXMAP.get(ch, "")
        if d:
            if d != prev:           # different digit → keep
                digits.append(d)
                if len(digits) == 3:
                    break
            prev = d
        else:
            # vowel / h / w / non-alpha: resets the adjacency dedup
            prev = ""

    return (first + "".join(digits)).ljust(4, "0")


# ──────────────────────────────────────────────
# Index management
# ──────────────────────────────────────────────

def _add_word_unsafe(word: str) -> None:
    """Add one word to all indexes.  Caller must hold _lock."""
    if word in _words:
        return
    _words.add(word)
    for gram in _ngrams(word):
        _ngram_index[gram].add(word)
    code = _soundex(word)
    _soundex_index[code].append(word)


def _load() -> None:
    try:
        if _ENTITIES_FILE.exists():
            with _ENTITIES_FILE.open() as f:
                data = json.load(f)
            with _lock:
                for w in data:
                    _add_word_unsafe(w)
    except Exception:
        pass


def _flush() -> None:
    try:
        with _lock:
            snapshot = list(_words)
        with _ENTITIES_FILE.open("w") as f:
            json.dump(snapshot, f)
    except Exception:
        pass


# Populate indexes at import time (same pattern as the rest of the server)
_load()


def index_results(items: list[dict]) -> None:
    """
    Feed search result titles/artists into the known-word indexes.
    Called after every successful search; the indexes grow and persist across restarts.
    """
    new_words: list[str] = []
    for item in items:
        for field in ("title", "artist"):
            v = item.get(field)
            if v:
                new_words.extend(_tokenize(v))

    if not new_words:
        return

    with _lock:
        before = len(_words)
        for w in new_words:
            _add_word_unsafe(w)
        changed = len(_words) > before

    if changed:
        _flush()


# ──────────────────────────────────────────────
# Per-word match check  (used inside score_fuzzy)
# ──────────────────────────────────────────────

def _word_matches(qw: str, hw: str) -> bool:
    """
    True if query word *qw* is close enough to haystack word *hw*.

    Layer 1 — exact match  (fastest)
    Layer 2 — collapsed-repeats equality
              "quannic" and "quannnic" both collapse to "quanic" → match
              "zepelin" and "zeppelin" both collapse to "zepelin" → match
    Layer 3 — difflib Ratcliff/Obershelp ≥ 0.82
    Layer 4 — n-gram Jaccard ≥ 0.40
              ("beatle" vs "beetles": share "$be","bea","eat","le$" → Jaccard 0.44)
    Layer 5 — same Soundex code  (phonetic, words ≥ 4 chars only)
              ("kanye" vs "kanyie" → both K500)
    """
    if qw == hw:
        return True
    if _collapse_repeats(qw) == _collapse_repeats(hw):
        return True
    if difflib.SequenceMatcher(None, qw, hw).ratio() >= _FUZZY_CUTOFF:
        return True
    if _ngram_jaccard(qw, hw) >= 0.40:
        return True
    if len(qw) >= 4 and len(hw) >= 4 and _soundex(qw) == _soundex(hw):
        return True
    return False


# ──────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────

def score_fuzzy(item: dict, query_words: list[str]) -> int:
    """
    Fuzzy relevance score for one search result.

    Returns the count of query words that match anything in the item's
    title + artist text.  A result needs at least one match (score > 0)
    to pass the relevance filter and appear in search results.

    Matching uses all four layers in _word_matches so a single-char typo,
    a missing/extra letter, or a phonetic misspelling still counts as a hit.
    """
    raw      = " ".join(filter(None, [item.get("title", ""), item.get("artist", "")]))
    haystack = _tokenize(raw)
    if not haystack:
        return 0

    score = 0
    for qw in (_norm(w) for w in query_words if len(w) >= _MIN_WORD_LEN):
        if any(_word_matches(qw, hw) for hw in haystack):
            score += 1
    return score


def suggest_query(query: str) -> str | None:
    """
    Typo-correct *query* using the known-word indexes.

    For each word:
      1. N-gram index pre-filter  → small candidate set  (fast even with 100k+ words)
      2. difflib ratio ≥ 0.72     → discard weak matches
      3. Soundex bonus (+0.1)     → phonetically-similar corrections rank higher

    Returns the corrected string if at least one word changed, else None.
    Short words (< _MIN_WORD_LEN) pass through unchanged.
    """
    words = _norm(query).split()
    if not words:
        return None

    corrected: list[str] = []
    changed = False

    for word in words:
        if len(word) < _MIN_WORD_LEN:
            corrected.append(word)
            continue

        candidates = _ngram_candidates(word)
        if not candidates:
            corrected.append(word)
            continue

        # Word already known exactly — keep it, no correction needed
        if word in candidates:
            corrected.append(word)
            continue

        sx              = _soundex(word)
        word_collapsed  = _collapse_repeats(word)
        best: tuple[float, str] | None = None

        for c in candidates:
            # Collapsed-repeats exact match is the strongest signal short of
            # an exact match: "quannic" and "quannnic" → both "quanic".
            if _collapse_repeats(c) == word_collapsed:
                sim = 1.0
            else:
                sim = difflib.SequenceMatcher(None, word, c).ratio()
                if sim < _SUGGEST_CUTOFF:
                    continue
            if _soundex(c) == sx:       # phonetic agreement → boost rank
                sim += 0.1
            if best is None or sim > best[0]:
                best = (sim, c)

        if best:
            corrected.append(best[1])
            if best[1] != word:
                changed = True
        else:
            corrected.append(word)

    return " ".join(corrected) if changed else None
