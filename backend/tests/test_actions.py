"""Core's actions: every data route runs on ALLOW, challenges on REQUIRE_APPROVAL, refuses the rest.

Tokens carry ``action_permissions`` exactly as Core mints them (see conftest.token). A replay is
Core sending an approved call again: a fresh token with that action ALLOW, the claims
``approved_action`` and ``approval_request_id``, and no session id.
"""

import json
import os
import re

import pytest

import auth
from conftest import EVERY_ACTION, READ_ONLY, TENANT, as_user, token

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")

TODO = {"title": "Replace the disk"}
LIST = {"name": "New Employee Setup", "items": ["Create account"]}

# Every data route, with the one action it checks.
ROUTES = [
    ("get", "/api/todos", None, "todo.view"),
    ("post", "/api/todos", TODO, "todo.create"),
    ("put", "/api/todos/1", {"done": True}, "todo.update"),
    ("delete", "/api/todos/1", None, "todo.delete"),
    ("get", "/api/predefined-lists", None, "predefined.view"),
    ("post", "/api/predefined-lists", LIST, "predefined.create"),
    ("put", "/api/predefined-lists/1", {"name": "Offboarding"}, "predefined.update"),
    ("delete", "/api/predefined-lists/1", None, "predefined.delete"),
]
ROUTE_IDS = [f"{method} {path}" for method, path, _, _ in ROUTES]


def call(client, method, path, body, headers):
    return client.request(method.upper(), path, json=body, headers=headers)


def with_decision(action, decision):
    return {**EVERY_ACTION, action: decision}


def replay(action, request_id, subject="17"):
    """The headers of Core's replay of an approved call."""
    return {
        "Authorization": "Bearer " + token(
            subject, session_id=None, approved_action=action, approval_request_id=request_id,
        ),
        "x-cobalt-approval-request-id": str(request_id),
    }


@pytest.fixture()
def seeded(client):
    """One todo and one predefined list of the caller's, both id 1."""
    created = client.post("/api/todos", json={"title": "Buy milk"}, headers=as_user())
    assert created.json()["id"] == 1
    assert client.post("/api/predefined-lists", json=LIST, headers=as_user()).json()["id"] == 1
    return client


def state(client):
    return (
        client.get("/api/todos", headers=as_user()).json(),
        client.get("/api/predefined-lists", headers=as_user()).json(),
    )


# --- ALLOW --------------------------------------------------------------------


@pytest.mark.parametrize(("method", "path", "body", "action"), ROUTES, ids=ROUTE_IDS)
def test_allow_runs_the_route(seeded, method, path, body, action):
    response = call(seeded, method, path, body, as_user(decisions={action: "ALLOW"}))

    assert response.status_code in (200, 201, 204)


def test_a_route_checks_its_own_action_only(seeded):
    """Allowed to add, not to view: adding works, listing does not."""
    adder = {"todo.create": "ALLOW", "todo.view": "DENY"}

    assert seeded.post("/api/todos", json=TODO, headers=as_user(decisions=adder)).status_code == 201
    assert seeded.get("/api/todos", headers=as_user(decisions=adder)).status_code == 403


# --- REQUIRE_APPROVAL: Core's challenge, before anything changes --------------


@pytest.mark.parametrize(("method", "path", "body", "action"), ROUTES, ids=ROUTE_IDS)
def test_require_approval_is_exactly_cores_challenge(seeded, method, path, body, action):
    before = state(seeded)

    response = call(seeded, method, path, body,
                    as_user(decisions=with_decision(action, "REQUIRE_APPROVAL")))

    assert response.status_code == 202
    assert response.headers["X-Cobalt-Approval-Required"] == "true"
    assert response.headers["X-Cobalt-Approval-Action"] == action
    assert response.json() == {
        "detail": {"status": "REQUIRE_APPROVAL", "action_key": action,
                   "message": "Approval required"},
    }
    assert state(seeded) == before


# --- DENY, nothing, or anything else: 403 ---------------------------------------


@pytest.mark.parametrize("decisions", [
    pytest.param("DENY", id="deny"),
    pytest.param(None, id="missing"),
    pytest.param("allow", id="lower-case"),
    pytest.param("YES", id="unknown"),
])
@pytest.mark.parametrize(("method", "path", "body", "action"), ROUTES, ids=ROUTE_IDS)
def test_anything_but_allow_or_approval_is_403(seeded, method, path, body, action, decisions):
    granted = {key: value for key, value in EVERY_ACTION.items() if key != action}
    if decisions is not None:
        granted[action] = decisions
    before = state(seeded)

    response = call(seeded, method, path, body, as_user(decisions=granted))

    assert response.status_code == 403
    assert response.json() == {
        "detail": {"message": "Action denied", "action_key": action, "status": "DENY"},
    }
    assert state(seeded) == before


@pytest.mark.parametrize("claim", [["todo.view"], "ALLOW", {"todo.view": ["ALLOW"]}])
def test_a_malformed_claim_grants_nothing(client, claim):
    bearer = token(action_permissions=claim)

    response = client.get("/api/todos", headers={"Authorization": f"Bearer {bearer}"})

    assert response.status_code == 403


def test_the_old_tab_permissions_grant_nothing(client):
    """todo.todo.all was the gate before actions; it is no longer read."""
    bearer = token(decisions={}, permissions=["todo.todo.read", "todo.todo.all"])

    response = client.get("/api/todos", headers={"Authorization": f"Bearer {bearer}"})

    assert response.status_code == 403


def test_an_action_pulsar_yaml_does_not_declare_cannot_guard_a_route():
    with pytest.raises(ValueError, match="todo.archive"):
        auth.require_action("todo.archive")


# --- the replay of an approved call ------------------------------------------


def test_an_approved_create_runs_once_however_often_core_delivers_it(client):
    first = client.post("/api/todos", json=TODO, headers=replay("todo.create", 91))
    second = client.post("/api/todos", json=TODO, headers=replay("todo.create", 91))

    assert first.status_code == 201
    assert second.json() == first.json()
    assert [t["title"] for t in client.get("/api/todos", headers=as_user()).json()] == [
        "Replace the disk",
    ]


def test_two_approvals_make_two_todos(client):
    client.post("/api/todos", json=TODO, headers=replay("todo.create", 91))
    client.post("/api/todos", json=TODO, headers=replay("todo.create", 92))

    assert len(client.get("/api/todos", headers=as_user()).json()) == 2


def test_an_approval_is_keyed_per_user(client):
    """The same approval id for another person is that person's own record."""
    client.post("/api/todos", json=TODO, headers=replay("todo.create", 91))
    client.post("/api/todos", json=TODO, headers=replay("todo.create", 91, subject="18"))

    assert len(client.get("/api/todos", headers=as_user()).json()) == 1
    assert len(client.get("/api/todos", headers=as_user("18")).json()) == 1


def test_an_approved_list_is_created_once(client):
    first = client.post("/api/predefined-lists", json=LIST, headers=replay("predefined.create", 7))
    second = client.post("/api/predefined-lists", json=LIST, headers=replay("predefined.create", 7))

    assert first.status_code == 201
    assert second.json()["id"] == first.json()["id"]
    assert len(client.get("/api/predefined-lists", headers=as_user()).json()) == 1


def test_an_approved_update_and_delete_are_safe_twice(seeded):
    assert seeded.put("/api/todos/1", json={"done": True},
                      headers=replay("todo.update", 3)).json()["done"] is True
    assert seeded.put("/api/todos/1", json={"done": True},
                      headers=replay("todo.update", 3)).json()["done"] is True

    assert seeded.delete("/api/todos/1", headers=replay("todo.delete", 4)).status_code == 204
    assert seeded.delete("/api/todos/1", headers=replay("todo.delete", 4)).status_code == 404


def test_an_approved_list_view_answers(seeded):
    response = seeded.get("/api/todos", headers=replay("todo.view", 5))

    assert response.status_code == 200
    assert [t["title"] for t in response.json()] == ["Buy milk"]


def test_a_replay_is_still_a_one_time_token(client):
    headers = replay("todo.create", 91)

    assert client.post("/api/todos", json=TODO, headers=headers).status_code == 201
    assert client.post("/api/todos", json=TODO, headers=headers).status_code == 401


def test_the_approval_id_is_never_shown(client):
    created = client.post("/api/todos", json=TODO, headers=replay("todo.create", 91)).json()

    assert "approval_request_id" not in created


# --- GET /api/me ---------------------------------------------------------------


def test_me_reports_cores_decisions(client):
    decisions = {**READ_ONLY, "todo.create": "REQUIRE_APPROVAL", "other.thing": "ALLOW"}

    me = client.get("/api/me", headers=as_user(decisions=decisions, username="bo")).json()

    assert me == {
        "subject": "17",
        "username": "bo",
        "tenant_id": TENANT,
        "actions": ["predefined.view", "todo.view"],
        "action_permissions": {key: value for key, value in decisions.items()
                               if key != "other.thing"},
        "can_read": True,
        "can_write": False,
    }


def test_me_needs_only_a_valid_token(client):
    me = client.get("/api/me", headers=as_user(decisions={})).json()

    assert (me["actions"], me["action_permissions"], me["can_read"], me["can_write"]) == (
        [], {}, False, False,
    )
    assert client.get("/api/me").status_code == 401


# --- one set of names everywhere -------------------------------------------------


def _read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as handle:
        return handle.read()


ACTION_KEY = r"(?:todo|predefined)\.(?:view|create|update|delete)"


def test_the_manifest_declares_the_actions_the_routes_check():
    declared = json.loads(_read("manifest.json"))["actions"]

    assert [action["key"] for action in declared] == list(auth.ACTIONS)
    assert set(EVERY_ACTION) == set(auth.ACTIONS)


def test_each_action_hangs_off_a_tab_core_makes_for_this_app():
    """Core lists an action under the tab whose key is its module, and wipes one under no tab."""
    manifest = json.loads(_read("manifest.json"))
    tab_of = {p["key"]: p["tab"] for p in manifest["permissions"]}
    tabs = set(manifest["core"]["tabKeys"])
    for group in manifest["navigation"]:
        for link in group.get("children", []):
            # Core's sub tab: <the tab of the link's permission>-<subTab>.
            tabs.add(f"{tab_of[link['permission']]}-{link['subTab']}")

    modules = {action["key"]: action["module"] for action in manifest["actions"]}
    assert set(modules.values()) <= tabs
    assert {key for key, module in modules.items() if module == "todo-list"} == {
        "todo.view", "todo.create", "todo.update", "todo.delete",
    }
    assert {key for key, module in modules.items() if module == "todo-predefined"} == {
        "predefined.view", "predefined.create", "predefined.update", "predefined.delete",
    }


@pytest.mark.parametrize("source", [
    ("frontend", "src", "actions.js"),
    ("dev", "fake_core.py"),
])
def test_the_ui_and_the_fake_core_use_the_same_names(source):
    assert set(re.findall(rf"['\"]({ACTION_KEY})['\"]", _read(*source))) == set(auth.ACTIONS)
