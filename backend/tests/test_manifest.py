"""The manifest Core reads is pulsar.yaml, rendered: one description of the app, never two.

manifest.json is written by scripts/render_manifest.py, never by hand. The equality check needs
forge-sdk, which is not on a public index yet, so it is skipped where forge-sdk is not installed.
"""

import json
import os
import sys

import pytest

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")


def test_api_manifest_is_manifest_json(client):
    with open(os.path.join(ROOT, "manifest.json"), encoding="utf-8") as handle:
        assert client.get("/api/manifest").json() == json.load(handle)


def test_manifest_json_is_pulsar_yaml_rendered():
    pytest.importorskip("forge_sdk", reason="forge-sdk renders pulsar.yaml; not installed here")
    sys.path.insert(0, os.path.join(ROOT, "scripts"))
    from render_manifest import rendered

    with open(os.path.join(ROOT, "manifest.json"), encoding="utf-8") as handle:
        assert handle.read() == rendered(), (
            "manifest.json is not pulsar.yaml rendered: run python scripts/render_manifest.py"
        )


def test_the_parts_core_and_the_panel_key_on_stay_put(client):
    """Renaming one of these moves a permission or breaks a mounted module on a live server."""
    served = client.get("/api/manifest").json()

    assert served["id"] == "todo"
    assert served["core"]["tabKeys"] == ["todo"]
    assert served["frontend"]["remoteName"] == "todo_plugin"
    assert served["frontend"]["exposedModule"] == "./TodoApp"
    group = served["navigation"][0]
    assert [child["subTab"] for child in group["children"]] == ["list", "predefined"]
    assert {c["id"]: c["exposedModule"] for c in served["contributes"]} == {
        "computer-todo-action": "./ComputerTodoAction",
        "computer-todo-tab": "./ComputerTodoTab",
    }
    assert {p["key"]: p["level"] for p in served["permissions"]} == {
        "todo:read": "read",
        "todo:write": "all",
    }
