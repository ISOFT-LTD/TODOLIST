"""Predefined todo lists: reusable templates, owned like todos are."""

import pytest

from conftest import READ, as_user

LIST = "/api/predefined-lists"

SETUP = {
    "name": "New Employee Setup",
    "items": ["Create account", "Assign laptop", "Configure email", "Install required software"],
}


# --- permissions --------------------------------------------------------------

def test_no_token_is_401(client):
    assert client.get(LIST).status_code == 401


def test_read_permission_lists_but_cannot_write(client):
    reader = dict(permissions=[READ])

    assert client.get(LIST, headers=as_user(**reader)).status_code == 200
    assert client.post(LIST, json=SETUP, headers=as_user(**reader)).status_code == 403


def test_no_permission_on_this_app_cannot_even_list(client):
    assert client.get(LIST, headers=as_user(permissions=[])).status_code == 403


# --- the whole lifecycle -------------------------------------------------------

def test_create_update_delete(client):
    created = client.post(LIST, json=SETUP, headers=as_user())
    assert created.status_code == 201
    made = created.json()
    assert made == {"id": made["id"], **SETUP}

    listed = client.get(LIST, headers=as_user()).json()
    assert listed == [made]

    renamed = client.put(f"{LIST}/{made['id']}", json={"name": "Onboarding"}, headers=as_user())
    assert renamed.status_code == 200
    assert renamed.json() == {**made, "name": "Onboarding"}

    trimmed = client.put(f"{LIST}/{made['id']}", json={"items": ["Create account"]}, headers=as_user())
    assert trimmed.json() == {"id": made["id"], "name": "Onboarding", "items": ["Create account"]}

    assert client.delete(f"{LIST}/{made['id']}", headers=as_user()).status_code == 204
    assert client.get(LIST, headers=as_user()).json() == []


def test_lists_come_newest_first(client):
    client.post(LIST, json={"name": "first", "items": ["a"]}, headers=as_user())
    client.post(LIST, json={"name": "second", "items": ["b"]}, headers=as_user())

    assert [l["name"] for l in client.get(LIST, headers=as_user()).json()] == ["second", "first"]


def test_unknown_list_is_404(client):
    assert client.put(f"{LIST}/999", json={"name": "x"}, headers=as_user()).status_code == 404
    assert client.delete(f"{LIST}/999", headers=as_user()).status_code == 404


# --- validation ------------------------------------------------------------------

def test_name_and_items_are_trimmed(client):
    made = client.post(LIST, json={"name": "  Setup  ", "items": ["  a ", "b  "]}, headers=as_user()).json()

    assert made["name"] == "Setup"
    assert made["items"] == ["a", "b"]


@pytest.mark.parametrize("payload", [
    {"name": "   ", "items": ["a"]},
    {"name": "Setup", "items": []},
    {"name": "Setup", "items": ["a", "   "]},
    {"name": "Setup"},
    {"items": ["a"]},
])
def test_a_blank_name_or_empty_items_are_refused(client, payload):
    assert client.post(LIST, json=payload, headers=as_user()).status_code == 422


def test_an_update_cannot_empty_the_items(client):
    made = client.post(LIST, json=SETUP, headers=as_user()).json()

    assert client.put(f"{LIST}/{made['id']}", json={"items": []}, headers=as_user()).status_code == 422


# --- everyone has their own lists ---------------------------------------------------

def test_each_user_sees_only_their_own(client):
    client.post(LIST, json={"name": "alice's", "items": ["a"]}, headers=as_user("17"))
    client.post(LIST, json={"name": "bo's", "items": ["b"]}, headers=as_user("42", username="bo"))

    alice = [l["name"] for l in client.get(LIST, headers=as_user("17")).json()]
    bo = [l["name"] for l in client.get(LIST, headers=as_user("42")).json()]

    assert alice == ["alice's"]
    assert bo == ["bo's"]


def test_nobody_can_change_or_delete_another_users_list(client):
    """404, not 403, so an id says nothing about who owns it."""
    theirs = client.post(LIST, json=SETUP, headers=as_user("17")).json()

    assert client.put(f"{LIST}/{theirs['id']}", json={"name": "x"}, headers=as_user("42")).status_code == 404
    assert client.delete(f"{LIST}/{theirs['id']}", headers=as_user("42")).status_code == 404
    assert client.get(LIST, headers=as_user("17")).json()[0]["name"] == SETUP["name"]


def test_predefined_lists_do_not_touch_the_todos(client):
    client.post(LIST, json=SETUP, headers=as_user())

    assert client.get("/api/todos", headers=as_user()).json() == []
