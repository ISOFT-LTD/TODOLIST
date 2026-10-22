"""Todos about a Core computer: what the Computer Details contributions rely on."""

from conftest import READ, as_user


def _add(client, title, computer_id=None, **who):
    body = {"title": title}
    if computer_id is not None:
        body["computer_id"] = computer_id
    response = client.post("/api/todos", json=body, headers=as_user(**who))
    assert response.status_code == 201, response.text
    return response.json()


def test_a_todo_can_name_the_computer_it_is_about(client):
    created = _add(client, "Replace the disk", computer_id=42)

    assert created["computer_id"] == 42


def test_a_todo_without_a_computer_has_none(client):
    assert _add(client, "Buy milk")["computer_id"] is None


def test_listing_by_computer_shows_only_that_computers_todos(client):
    _add(client, "Buy milk")
    disk = _add(client, "Replace the disk", computer_id=42)
    _add(client, "Reimage", computer_id=7)

    listed = client.get("/api/todos?computer_id=42", headers=as_user()).json()

    assert [todo["id"] for todo in listed] == [disk["id"]]


def test_listing_without_a_computer_still_shows_every_todo(client):
    _add(client, "Buy milk")
    _add(client, "Replace the disk", computer_id=42)

    assert len(client.get("/api/todos", headers=as_user()).json()) == 2


def test_listing_by_computer_is_still_scoped_to_the_caller(client):
    _add(client, "Alice's", computer_id=42, subject="17")
    _add(client, "Bob's", computer_id=42, subject="18", username="bob")

    listed = client.get("/api/todos?computer_id=42", headers=as_user(subject="18")).json()

    assert [todo["title"] for todo in listed] == ["Bob's"]


def test_updating_a_todo_keeps_its_computer(client):
    todo = _add(client, "Replace the disk", computer_id=42)

    updated = client.put(f"/api/todos/{todo['id']}", json={"done": True}, headers=as_user()).json()

    assert updated["done"] is True
    assert updated["computer_id"] == 42


def test_a_reader_can_list_a_computers_todos_but_not_add_one(client):
    reader = dict(permissions=[READ])

    assert client.get("/api/todos?computer_id=42", headers=as_user(**reader)).status_code == 200
    assert client.post("/api/todos", json={"title": "x", "computer_id": 42},
                       headers=as_user(**reader)).status_code == 403


def test_a_computer_id_must_be_a_positive_number(client):
    for bad in (0, -1, "abc"):
        response = client.post("/api/todos", json={"title": "x", "computer_id": bad}, headers=as_user())
        assert response.status_code == 422, bad
    assert client.get("/api/todos?computer_id=0", headers=as_user()).status_code == 422
