# /// script
# requires-python = ">=3.10"
# dependencies = ["wordfreq==3.1.1"]
# ///
#
# Exports the top surface forms + corpus frequency per language from wordfreq
# into scripts/.cache/wordfreq/{lang}.csv, consumed by build-lemma-ranks.ts.
# The wordfreq version is pinned exactly above (PEP 723); the actually
# installed version is recorded in the sidecar {lang}.meta.json and ends up in
# the lemma_rank_builds manifest, so a pin bump is always a visible, versioned
# data event.
#
# Usage (from apps/backend):
#   uv run scripts/export-wordfreq.py            # ru en de
#   uv run scripts/export-wordfreq.py ru de      # subset
#
# 100k forms (not the spike's 50k) so candidate-lemma citation forms used for
# ambiguity mass-split weighting are mostly present in the list; lemmas still
# absent get an epsilon weight in the build script.

import csv
import json
import sys
from datetime import datetime, timezone
from importlib.metadata import version as package_version
from pathlib import Path

from wordfreq import top_n_list, word_frequency

TOP_N = 100_000
DEFAULT_LANGUAGES = ["ru", "en", "de"]
CACHE_DIR = Path(__file__).parent / ".cache" / "wordfreq"


def export_language(lang: str) -> None:
    forms = top_n_list(lang, TOP_N)
    csv_path = CACHE_DIR / f"{lang}.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["form", "frequency"])
        for form in forms:
            writer.writerow([form, repr(word_frequency(form, lang))])

    meta_path = CACHE_DIR / f"{lang}.meta.json"
    meta = {
        "language": lang,
        "wordfreqVersion": package_version("wordfreq"),
        "topN": TOP_N,
        "formCount": len(forms),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }
    meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(f"  ✓ {lang}: {len(forms):,} forms → {csv_path}")


def main() -> None:
    languages = sys.argv[1:] or DEFAULT_LANGUAGES
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Exporting wordfreq {package_version('wordfreq')} top {TOP_N:,} forms for: {', '.join(languages)}")
    for lang in languages:
        export_language(lang)
    print("✓ Done.")


if __name__ == "__main__":
    main()
