"""The Todo service behind Cobalt Core: who may call it, and whose data they see."""

import json

import pytest
from cobalt_identity.testing import LocalIssuer

from conftest import AUDIENCE, READ, TENANT, WRITE, as_user


# --- open endpoints --------------------------------------------------------

def test_health_needs_no_token(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_the_manifest_needs_no_token(client):
    """Core reads it to install the app."""
    response = client.get("/api/manifest")

    assert response.status_code == 200
    assert response.json()["id"] == "todo"


def test_the_openapi_schema_is_where_the_manifest_says(client):
    assert client.get("/api/openapi.json").status_code == 200
    assert client.get("/docs").status_code == 404


# --- only Core's token is a credential ---------------------------------------

def test_no_token_is_401(client):
    response = client.get("/api/todos")

    assert response.status_code == 401
    assert response.headers["www-authenticate"].startswith("Bearer")


@pytest.mark.parametrize("headers", [
    {"Cookie": "session_id=anything"},
    {"X-User-Id": "17"},
    {"Authorization": "Basic YWxpY2U6cGFzcw=="},
])
def test_anything_but_a_bearer_token_is_ignored(client, headers):
    """A cookie or an X-User-* header is what a caller claims, not what Core signed."""
    assert client.get("/api/todos", headers=headers).status_code == 401


def test_a_token_for_another_app_is_401(client):
    assert client.get("/api/todos", headers=as_user(audience="documents-api")).status_code == 401


def test_a_token_signed_by_someone_else_is_401(client):
    impostor = LocalIssuer(tenant_id=TENANT).mint("17", AUDIENCE, permissions=[READ])

    assert client.get("/api/todos", headers={"Authorization": f"Bearer {impostor}"}).status_code == 401


def test_a_token_for_another_tenant_is_401(client):
    assert client.get("/api/todos", headers=as_user(tenant_id="elsewhere")).status_code == 401


def test_a_token_is_good_for_one_call(client):
    headers = as_user()

    assert client.get("/api/todos", headers=headers).status_code == 200
    assert client.get("/api/todos", headers=headers).status_code == 401


# --- permissions --------------------------------------------------------------

def test_read_permission_lists_but_cannot_write(client):
    reader = dict(permissions=[READ])

    assert client.get("/api/todos", headers=as_user(**reader)).status_code == 200
    assert client.post("/api/todos", json={"title": "x"}, headers=as_user(**reader)).status_code == 403


def test_no_permission_on_this_app_cannot_even_list(client):
    assert client.get("/api/todos", headers=as_user(permissions=[])).status_code == 403


def test_me_reports_what_this_user_may_do(client):
    me = client.get("/api/me", headers=as_user(permissions=[READ], username="bo")).json()

    assert me == {"subject": "17", "username": "bo", "tenant_id": TENANT,
                  "can_read": True, "can_write": False}


# --- the whole lifecycle -------------------------------------------------------

def test_create_update_complete_delete(client):
    created = client.post("/api/todos", json={"title": "  write the report  "}, headers=as_user())
    assert created.status_code == 201
    todo = created.json()
    assert todo == {"id": todo["id"], "title": "write the report", "done": False}

    renamed = client.put(f"/api/todos/{todo['id']}", json={"title": "send the report"}, headers=as_user())
    assert renamed.json()["title"] == "send the report"

    done = client.put(f"/api/todos/{todo['id']}", json={"done": True}, headers=as_user())
    assert done.json()["done"] is True

    assert client.delete(f"/api/todos/{todo['id']}", headers=as_user()).status_code == 204
    assert client.get("/api/todos", headers=as_user()).json() == []


def test_a_blank_title_is_refused(client):
    assert client.post("/api/todos", json={"title": "   "}, headers=as_user()).status_code == 422


# --- everyone has their own list ---------------------------------------------------

def test_each_user_sees_only_their_own(client):
    client.post("/api/todos", json={"title": "alice's"}, headers=as_user("17"))
    client.post("/api/todos", json={"title": "bo's"}, headers=as_user("42", username="bo"))

    alice = [t["title"] for t in client.get("/api/todos", headers=as_user("17")).json()]
    bo = [t["title"] for t in client.get("/api/todos", headers=as_user("42")).json()]

    assert alice == ["alice's"]
    assert bo == ["bo's"]


def test_nobody_can_change_or_delete_another_users_todo(client):
    """And the answer is 404, not 403, so an id says nothing about who owns it."""
    theirs = client.post("/api/todos", json={"title": "alice's"}, headers=as_user("17")).json()

    assert client.put(f"/api/todos/{theirs['id']}", json={"done": True},
                      headers=as_user("42")).status_code == 404
    assert client.delete(f"/api/todos/{theirs['id']}", headers=as_user("42")).status_code == 404
    assert client.get("/api/todos", headers=as_user("17")).json()[0]["done"] is False


def test_the_username_is_not_the_owner(client):
    """Two people may share a display name; only Core's user id identifies them."""
    client.post("/api/todos", json={"title": "mine"}, headers=as_user("17", username="sam"))

    assert client.get("/api/todos", headers=as_user("99", username="sam")).json() == []


def test_rows_from_before_owners_existed_are_not_shown(client, tmp_path):
    import database

    with open(database.DATA_FILE, "w", encoding="utf-8") as handle:
        json.dump([{"id": 1, "title": "legacy", "done": False}], handle)

    assert client.get("/api/todos", headers=as_user()).json() == []
