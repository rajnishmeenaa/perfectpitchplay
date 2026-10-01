#!/usr/bin/env python3
"""Local MongoDB stand-in for sandboxed development.

This sandbox cannot download a real ``mongod`` binary (every MongoDB download
host is blocked by the network allow-list), so this script speaks just enough
of the MongoDB wire protocol (OP_MSG) over a local TCP port and backs it with
``mongomock``.  ``backend/server.py`` keeps using
``motor.AsyncIOMotorClient(MONGO_URL)`` unchanged - point ``MONGO_URL`` at
``mongodb://127.0.0.1:27017`` and the app behaves like it is talking to Mongo,
with these caveats:

* only the commands this app uses are implemented
  (hello / ping / find / insert / update / delete / count / distinct /
  findAndModify);
* data is persisted to a JSON snapshot instead of a real storage engine;
* no transactions, no real indexes, no aggregation pipeline, no change streams.

Development shim only - never point production traffic at it.

Usage:
    python3 sandbox/dev_mongo.py [--port 27017] [--db-file sandbox/dev_mongo.json]
"""
from __future__ import annotations

import argparse
import itertools
import json
import os
import socketserver
import struct
import sys
import threading
import time
from datetime import datetime, timezone

import mongomock
from bson import BSON, ObjectId
from bson.int64 import Int64

SAVE_LOCK = threading.Lock()
WRITE_LOCK = threading.Lock()

DB_FILE = os.environ.get("DEV_MONGO_DB_FILE", "sandbox/dev_mongo.json")
_client = mongomock.MongoClient()
_dbs: dict[str, object] = {}
_dirty = threading.Event()


# --------------------------------------------------------------------------- #
# persistence (JSON snapshot)
# --------------------------------------------------------------------------- #
def _default(obj):
    if isinstance(obj, ObjectId):
        return {"$oid": str(obj)}
    if isinstance(obj, datetime):
        return {"$date": obj.astimezone(timezone.utc).isoformat()}
    if isinstance(obj, Int64):
        return {"$numberLong": str(int(obj))}
    if isinstance(obj, bytes):
        return {"$binary": obj.hex()}
    raise TypeError(f"cannot persist {type(obj).__name__}")


def _object_hook(obj):
    if "$oid" in obj:
        return ObjectId(obj["$oid"])
    if "$date" in obj:
        raw = obj["$date"]
        if isinstance(raw, str):
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return datetime.fromtimestamp(raw / 1000, tz=timezone.utc)
    if "$numberLong" in obj:
        return Int64(int(obj["$numberLong"]))
    return obj


def load_snapshot(path: str) -> None:
    if not os.path.exists(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh, object_hook=_object_hook)
    except Exception as exc:  # corrupt snapshot -> start empty, keep the file
        print(f"[dev-mongo] snapshot unreadable ({exc}); starting empty", flush=True)
        return
    for dbname, collections in data.items():
        mdb = _client[dbname]
        _dbs[dbname] = mdb
        for collname, docs in collections.items():
            if docs:
                mdb[collname].insert_many(docs)
        total = sum(len(v) for v in collections.values())
        print(f"[dev-mongo] loaded {dbname}: {total} docs", flush=True)


def save_snapshot(path: str) -> None:
    data = {}
    for dbname, mdb in _dbs.items():
        data[dbname] = {
            name: list(mdb[name].find()) for name in mdb.list_collection_names()
        }
    tmp = f"{path}.tmp"
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    with SAVE_LOCK:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, default=_default)
        os.replace(tmp, path)
    _dirty.clear()


def flusher_loop(path: str) -> None:
    while True:
        time.sleep(2)
        if _dirty.is_set():
            try:
                save_snapshot(path)
            except Exception as exc:
                print(f"[dev-mongo] snapshot failed: {exc}", flush=True)


def get_db(name: str):
    if name not in _dbs:
        _dbs[name] = _client[name]
    return _dbs[name]


# --------------------------------------------------------------------------- #
# wire protocol helpers
# --------------------------------------------------------------------------- #
OP_MSG = 2013
OP_QUERY = 2004


_MSG_ID = itertools.count(1)


def encode_msg(document: dict, response_to: int = 0) -> bytes:
    """Build an OP_MSG reply. ``response_to`` must echo the request's id."""
    payload = BSON.encode(document)
    body = struct.pack("<I", 0) + b"\x00" + payload  # flagBits + one kind-0 section
    header = struct.pack("<iiii", 16 + len(body), next(_MSG_ID), response_to, OP_MSG)
    return header + body


def decode_msg(body: bytes) -> dict:
    """Parse an OP_MSG body (flagBits + sections) into a command document.

    Mirrors how pymongo builds the message (see pymongo/message.py):
      kind 0 -> one BSON document (its own int32 size counts itself)
      kind 1 -> int32 sizeOfSection (counts itself + identifier + documents),
                a NUL-terminated identifier such as ``documents``/``deletes``/
                ``updates``, then that many BSON documents, which become the
                array value of the identifier field.
    """
    pos = 4  # skip flagBits
    doc: dict = {}
    while pos < len(body):
        kind = body[pos]
        pos += 1
        size = struct.unpack("<i", body[pos:pos + 4])[0]
        section_end = pos + size
        if kind == 0:
            doc.update(BSON(body[pos:section_end]).decode())
        elif kind == 1:
            nul = body.index(b"\x00", pos + 4)
            identifier = body[pos + 4:nul].decode("utf-8")
            doc[identifier] = []
            cur = nul + 1
            while cur < section_end:
                doc_size = struct.unpack("<i", body[cur:cur + 4])[0]
                if doc_size <= 4:
                    break
                doc[identifier].append(BSON(body[cur:cur + doc_size]).decode())
                cur += doc_size
        else:
            raise ValueError(f"unsupported OP_MSG section kind {kind}")
        pos = section_end
    return doc


def ok(payload: dict | None = None) -> dict:
    out = dict(payload or {})
    out["ok"] = 1.0
    return out


def err(message: str, code: int = 2) -> dict:
    return {"ok": 0.0, "errmsg": message, "code": code, "codeName": "BadValue"}


def cursor_reply(docs: list, ns: str, cursor_id: int = 0) -> dict:
    return ok({"cursor": {"id": Int64(cursor_id), "ns": ns, "firstBatch": docs}})


HELLO = {
    "isWritablePrimary": True,
    "maxBsonObjectSize": 16 * 1024 * 1024,
    "maxMessageSizeBytes": 48_000_000,
    "maxWriteBatchSize": 100_000,
    "logicalSessionTimeoutMinutes": 30,
    "connectionId": 1,
    "minWireVersion": 0,
    "maxWireVersion": 21,
    "readOnly": False,
}


def _sort_spec(spec):
    """sort arrives as a BSON document; accept list-of-pairs too."""
    if isinstance(spec, dict):
        return [(k, int(v)) for k, v in spec.items()]
    if isinstance(spec, list):
        out = []
        for item in spec:
            if isinstance(item, (list, tuple)):
                out.append((str(item[0]), int(item[1])))
            elif isinstance(item, dict):
                out.extend((str(k), int(v)) for k, v in item.items())
        return out
    return []


def _aggregate_fallback(coll, pipeline: list) -> list:
    """Minimal aggregation for the pipelines pymongo itself generates.

    ``Collection.count_documents()`` is implemented by the driver as
    ``[{"$match": filter}, {"$skip": n}, {"$limit": n},
      {"$group": {"_id": 1, "n": {"$sum": 1}}}]``, so that is the shape this
    needs to handle.  Everything else falls back to mongomock (called first) or
    raises a clear error.
    """
    match: dict = {}
    skip = 0
    limit = 0
    counting = False
    for stage in pipeline:
        (op, value), = stage.items()
        if op == "$match":
            match = value
        elif op == "$skip":
            skip = int(value)
        elif op == "$limit":
            limit = int(value)
        elif op == "$group":
            group_id = value.get("_id", None)
            acc = {k: v for k, v in value.items() if k != "_id"}
            if group_id in (1, None) and all(
                isinstance(v, dict) and list(v) == ["$sum"] for v in acc.values()
            ):
                counting = True
            else:
                raise mongomock.NotImplementedError(
                    f"dev mongo shim: unsupported $group {value!r}")
        elif op == "$count":
            counting = True
        else:
            raise mongomock.NotImplementedError(
                f"dev mongo shim: unsupported pipeline stage {op!r}")

    docs = list(coll.find(match))
    if skip:
        docs = docs[skip:]
    if limit:
        docs = docs[:limit]
    if not counting:
        return docs
    return [{"n": len(docs)}]


# --------------------------------------------------------------------------- #
# command dispatch
# --------------------------------------------------------------------------- #
def handle_command(command: dict, dbname: str) -> dict:
    name = next(iter(command))
    lname = name.lower()
    db = get_db(dbname)

    if lname in ("hello", "ismaster", "is_master"):
        out = dict(HELLO)
        out["localTime"] = datetime.now(timezone.utc)
        return ok(out)

    if lname in ("buildinfo", "build_info"):
        return ok({"version": "7.0.0-dev-shim", "versionArray": [7, 0, 0, 0]})

    if lname in ("ping", "endsessions", "killsessions", "killallsessions",
                 "getparameter", "getmore", "create", "createindexes", "drop",
                 "dropindexes", "collmod", "saslstart", "saslcontinue"):
        if lname == "create":
            get_db(dbname)[str(command[name])]
        return ok()

    if lname == "listcollections":
        return cursor_reply(
            [{"name": n, "type": "collection", "options": {},
              "info": {"readOnly": False}, "idIndex": {}}
             for n in db.list_collection_names()],
            ns=f"{dbname}.$cmd.listCollections",
        )

    if lname == "listdatabases":
        return ok({"databases": [{"name": n, "sizeOnDisk": 1, "empty": False}
                                 for n in _dbs], "totalSize": 1})

    if lname == "find":
        coll_name = str(command[name])
        cur = db[coll_name].find(command.get("filter") or {},
                                 command.get("projection") or None)
        if command.get("sort"):
            cur = cur.sort(_sort_spec(command["sort"]))
        if command.get("skip"):
            cur = cur.skip(int(command["skip"]))
        limit = int(command.get("limit") or 0)
        docs = list(cur)
        if limit:
            docs = docs[:abs(limit)]
        return cursor_reply(docs, ns=f"{dbname}.{coll_name}")

    if lname == "count":
        n = db[str(command[name])].count_documents(command.get("query") or {})
        return ok({"n": Int64(n)})

    if lname == "distinct":
        key = str(command["key"])
        values: list = []
        for doc in db[str(command[name])].find(command.get("query") or {}):
            val = doc.get(key)
            if isinstance(val, list):
                values.extend(val)
            elif val is not None:
                values.append(val)
        return ok({"values": values})

    if lname == "insert":
        docs = list(command.get("documents") or [])
        with WRITE_LOCK:
            result = db[str(command[name])].insert_many(
                docs, ordered=bool(command.get("ordered", True)))
        _dirty.set()
        return ok({"n": Int64(len(result.inserted_ids))})

    if lname == "update":
        coll = db[str(command[name])]
        matched = 0
        modified = 0
        upserted = []
        with WRITE_LOCK:
            for i, upd in enumerate(command.get("updates") or []):
                query = upd.get("q") or {}
                update = upd.get("u") or {}
                do_upsert = bool(upd.get("upsert"))
                if bool(upd.get("multi")):
                    res = coll.update_many(query, update, upsert=do_upsert)
                else:
                    res = coll.update_one(query, update, upsert=do_upsert)
                matched += int(getattr(res, "matched_count", 0) or 0)
                modified += int(getattr(res, "modified_count", 0) or 0)
                if getattr(res, "upserted_id", None) is not None:
                    upserted.append({"index": Int64(i), "_id": res.upserted_id})
        _dirty.set()
        # pymongo derives matched_count from "n" and modified_count from "nModified"
        out = {"n": Int64(matched + len(upserted)), "nModified": Int64(modified)}
        if upserted:
            out["upserted"] = upserted
        return ok(out)

    if lname == "delete":
        coll = db[str(command[name])]
        deleted = 0
        with WRITE_LOCK:
            for dele in command.get("deletes") or []:
                if int(dele.get("limit") or 0) == 1:
                    deleted += coll.delete_one(dele.get("q") or {}).deleted_count
                else:
                    deleted += coll.delete_many(dele.get("q") or {}).deleted_count
        _dirty.set()
        return ok({"n": Int64(deleted)})

    if lname == "findandmodify":
        coll = db[str(command[name])]
        query = command.get("query") or {}
        update = command.get("update") or {}
        with WRITE_LOCK:
            if command.get("remove"):
                doc = coll.find_one_and_delete(query)
            else:
                doc = coll.find_one_and_update(query, update,
                                               upsert=bool(command.get("upsert")))
        _dirty.set()
        return ok({"value": doc,
                   "lastErrorObject": {"n": Int64(1 if doc is not None else 0),
                                       "updatedExisting": doc is not None}})

    if lname == "aggregate":
        coll_name = str(command[name])
        pipeline = list(command.get("pipeline") or [])
        try:
            result = list(db[coll_name].aggregate(pipeline))
        except mongomock.NotImplementedError:
            result = _aggregate_fallback(db[coll_name], pipeline)
        return cursor_reply(result, ns=f"{dbname}.{coll_name}")

    return err(f"command '{name}' is not supported by the dev mongo shim", code=59)


WRITE_COMMANDS = {"insert", "update", "delete", "findandmodify"}


# --------------------------------------------------------------------------- #
# TCP server
# --------------------------------------------------------------------------- #
class MongoHandler(socketserver.StreamRequestHandler):
    def handle(self):
        while True:
            header = self._read_exactly(16)
            if not header:
                return
            length, request_id, _response_to, opcode = struct.unpack("<iiii", header)
            body = self._read_exactly(length - 16)
            if body is None:
                return

            if opcode == OP_QUERY:  # legacy handshake / OP_QUERY ping
                self._send(encode_msg(ok(dict(HELLO)), request_id))
                continue

            if opcode != OP_MSG:
                self._send(encode_msg(err(f"unsupported opcode {opcode}"), request_id))
                continue

            try:
                command = decode_msg(body)
            except Exception as exc:
                if os.environ.get("DEV_MONGO_DEBUG"):
                    print(f"[dev-mongo] decode failed ({exc}); body={body.hex()}",
                          flush=True)
                self._send(encode_msg(err(f"malformed OP_MSG: {exc}"), request_id))
                continue

            dbname = str(command.get("$db") or "admin")
            first = next(iter(command), "").lower()
            try:
                reply = handle_command(command, dbname)
            except mongomock.NotImplementedError as exc:
                reply = err(str(exc), code=59)
            except Exception as exc:  # keep the connection alive on shim bugs
                reply = err(f"{type(exc).__name__}: {exc}")
                print(f"[dev-mongo] {first} failed: {exc}", flush=True)
            self._send(encode_msg(reply, request_id))

            if first in WRITE_COMMANDS:
                try:
                    save_snapshot(DB_FILE)
                except Exception as exc:
                    print(f"[dev-mongo] snapshot failed: {exc}", flush=True)

    def _read_exactly(self, n: int):
        buf = b""
        while len(buf) < n:
            chunk = self.rfile.read(n - len(buf))
            if not chunk:
                return None
            buf += chunk
        return buf

    def _send(self, data: bytes) -> None:
        try:
            self.wfile.write(data)
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass


class ThreadedServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def handle_error(self, request, client_address):
        """Clients disconnect abruptly all the time; don't spam the log."""
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, BrokenPipeError, TimeoutError)):
            return
        super().handle_error(request, client_address)


def main() -> int:
    global DB_FILE
    parser = argparse.ArgumentParser(description="dev MongoDB shim")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int,
                        default=int(os.environ.get("DEV_MONGO_PORT", "27017")))
    parser.add_argument("--db-file", default=DB_FILE)
    args = parser.parse_args()
    DB_FILE = args.db_file

    load_snapshot(DB_FILE)
    threading.Thread(target=flusher_loop, args=(DB_FILE,), daemon=True).start()

    server = ThreadedServer((args.host, args.port), MongoHandler)
    print(f"[dev-mongo] listening on mongodb://{args.host}:{args.port} "
          f"(snapshot: {DB_FILE})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        try:
            save_snapshot(DB_FILE)
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
