"""Write manifest.json, the document Core reads at GET /api/manifest, from pulsar.yaml.

pulsar.yaml is the only file anybody edits. Run this after every change to it, with forge-sdk
installed (from a Forge checkout: pip install -e <forge>/packages/forge-sdk):

    python scripts/render_manifest.py

backend/tests/test_manifest.py fails while the two disagree.
"""

import json
from pathlib import Path

from forge_sdk import render_manifest
from forge_sdk.manifest import AppManifest

ROOT = Path(__file__).resolve().parent.parent


def rendered() -> str:
    document = render_manifest(AppManifest.load(str(ROOT / "pulsar.yaml")))
    return json.dumps(document, indent=2, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    (ROOT / "manifest.json").write_text(rendered(), encoding="utf-8", newline="\n")
    print("manifest.json written from pulsar.yaml")
