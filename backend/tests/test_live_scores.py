"""Unit tests for the live-score import layer (CricAPI payload parsing + squad mapping).

These run against synthetic provider payloads, so no API key or network is needed.
The real product code paths (server.merge_cric_payload / map_stats_to_squad /
compute_player_points) are what is under test.
"""
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "unittests")
os.environ.setdefault("JWT_SECRET", "unit-secret")
os.environ.setdefault("ADMIN_MOBILE", "9000000000")
os.environ.setdefault("ADMIN_PASSWORD", "unit-admin-pw")
os.environ.setdefault("ADMIN_UPI_ID", "admin@upi")
os.environ.setdefault("APP_NAME", "fantasy-contest")
os.environ.setdefault("CORS_ORIGINS", "*")

import motor.motor_asyncio  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

motor.motor_asyncio.AsyncIOMotorClient = AsyncMongoMockClient

import server  # noqa: E402


SCORECARD_PAYLOAD = {
    "status": "success",
    "data": {
        "info": {"matchInfo": {"name": "Mumbai vs Delhi, 12th match", "status": "Mumbai won by 5 wickets"}},
        "scorecard": [
            {
                "team": {"name": "Delhi", "shortname": "DEL"},
                "batting": [
                    {"batsman": {"name": "KL Rahul"}, "runs": "52", "balls": "31", "fours": "6", "sixes": "2",
                     "dismissalText": "c Rathia b Khsiv"},
                    {"batsman": {"name": "Kagiso Rabada"}, "runs": "12", "balls": "8", "fours": "1", "sixes": "1",
                     "dismissalText": "not out"},
                ],
                "bowling": [
                    {"bowler": {"name": "Kagiso Rabada"}, "overs": "4.2", "maidens": "1", "runs": "18", "wickets": "4"},
                    {"bowler": {"name": "Axar Patel"}, "overs": "3", "maidens": "0", "runs": "22", "wickets": "1"},
                ],
                "catches": [{"catchman": {"name": "KL Rahul"}}],
                "stumping": [{"stumper": {"name": "Ishan Kishan"}}],
                "runOuts": [{"fielder": {"name": "Axar Patel"}, "type": "direct"}],
            },
            {
                "team": {"name": "Mumbai", "shortname": "MUM"},
                "batting": [
                    {"batsman": {"name": "Suryakumar Yadav"}, "runs": "61", "balls": "33", "fours": "5", "sixes": "4",
                     "dismissalText": "b Rabada", "dismissal": {"bowler": {"name": "Kagiso Rabada"}}},
                    {"batsman": {"name": "Rohit Sharma"}, "runs": "0", "balls": "2", "fours": "0", "sixes": "0",
                     "dismissalText": "c Rabada b Axar Patel"},
                    {"batsman": {"name": "Tilak Varma"}, "runs": "24", "balls": "19", "fours": "3", "sixes": "0",
                     "dismissalText": "not out"},
                ],
                "bowling": [{"bowler": {"name": "Jasprit Bumrah"}, "overs": "4", "maidens": "1", "runs": "15", "wickets": "3"}],
                "catches": [{"catchman": {"name": "Kagiso Rabada"}}, {"catchman": {"name": "Kagiso Rabada"}},
                            {"catchman": {"name": "Kagiso Rabada"}}],
            },
        ],
    },
}

FANTASY_PAYLOAD = {
    "status": "success",
    "data": {
        "batting": [
            {"playerName": "Suryakumar Yadav", "runs": 61, "balls": 33, "fours": 5, "sixes": 4, "dismissal": "bowled"},
            {"playerName": "Rohit Sharma", "runs": 0, "balls": 2, "fours": 0, "sixes": 0, "dismissal": "caught"},
        ],
        "bowling": [
            {"playerName": "Kagiso Rabada", "overs": 4.2, "maidens": 1, "runs": 18, "wickets": 4, "bowled": 2},
        ],
        "fielding": [
            {"playerName": "Kagiso Rabada", "catches": 3, "stumpings": 0, "runOuts": 1},
        ],
    },
}

SQUAD = [
    {"id": "p-sk", "name": "S Yadav", "team": "MUM", "role": "BAT"},
    {"id": "p-roh", "name": "Rohit Sharma", "team": "MUM", "role": "BAT"},
    {"id": "p-til", "name": "Tilak Varma", "team": "MUM", "role": "BAT"},
    {"id": "p-bum", "name": "J Bumrah", "team": "MUM", "role": "BOWL"},
    {"id": "p-rah", "name": "KL Rahul", "team": "DEL", "role": "BAT"},
    {"id": "p-rab", "name": "K Rabada", "team": "DEL", "role": "BOWL"},
    {"id": "p-axar", "name": "Axar Patel", "team": "DEL", "role": "AR"},
    {"id": "p-ish", "name": "Ishan Kishan", "team": "DEL", "role": "WK"},
    {"id": "p-unused", "name": "A Khsiv", "team": "MUM", "role": "BOWL"},
]


def test_overs_to_balls():
    assert server.overs_to_balls("4.2") == 26
    assert server.overs_to_balls("4") == 24
    assert server.overs_to_balls(4.2) == 26
    assert server.overs_to_balls("0") == 0
    assert server.overs_to_balls(None) == 0
    assert server.overs_to_balls("-") == 0


def test_name_score_variants():
    assert server._name_score("KL Rahul", "KL Rahul") == 1.0
    assert server._name_score("Kagiso Rabada", "K Rabada") >= 0.85
    assert server._name_score("Suryakumar Yadav", "S Yadav") >= 0.85
    assert server._name_score("Jasprit Bumrah", "J Bumrah") >= 0.85
    assert server._name_score("Kagiso Rabada", "Rabada") >= 0.8
    # different players must not auto-match, even with a similar name
    assert server._name_score("Rohit Sharma", "Rahul Sharma") < 0.5
    assert server._name_score("Rohit Sharma", "KL Rahul") < 0.5
    assert server._name_score("Tilak Varma", "Rohit Sharma") < 0.5


def test_bowled_lbw_bonus_rules():
    assert server.bowled_lbw_bowler({"dismissalText": "b Rabada"}) == "rabada"
    assert server.bowled_lbw_bowler({"dismissalText": "lbw b Rabada"}) == "rabada"
    assert server.bowled_lbw_bowler({"dismissalText": "c Rathia b Khsiv"}) == ""   # caught: no bonus
    assert server.bowled_lbw_bowler({"dismissalText": "not out"}) == ""
    assert server.bowled_lbw_bowler({"dismissal": {"type": "bowled", "bowler": {"name": "J Bumrah"}}}) == "J Bumrah"
    assert server.bowled_lbw_bowler({"dismissal": {"type": "caught", "bowler": {"name": "J Bumrah"}},
                                     "dismissalText": "c X b J Bumrah"}) == ""
    assert server.bowled_lbw_bowler({}) == ""


def test_merge_scorecard_shape():
    stats = server.merge_cric_payload(SCORECARD_PAYLOAD["data"])
    rab = stats[server._norm_name("Kagiso Rabada")]
    assert rab["balls_bowled"] == 26 and rab["wickets"] == 4 and rab["maidens"] == 1 and rab["runs_conceded"] == 18
    assert rab["catches"] == 3
    sk = stats[server._norm_name("Suryakumar Yadav")]
    assert sk["runs"] == 61 and sk["balls"] == 33 and sk["sixes"] == 4 and sk["out"] is True
    til = stats[server._norm_name("Tilak Varma")]
    assert til["out"] is False and til["played"] is True
    rah = stats[server._norm_name("KL Rahul")]
    assert rah["catches"] == 1 and rah["runs"] == 52
    assert stats[server._norm_name("Ishan Kishan")]["stumpings"] == 1
    assert stats[server._norm_name("Axar Patel")]["run_out_direct"] == 1
    assert stats[server._norm_name("Rohit Sharma")]["out"] is True


def test_merge_fantasy_shape():
    stats = server.merge_cric_payload(FANTASY_PAYLOAD["data"])
    rab = stats[server._norm_name("Kagiso Rabada")]
    assert rab["balls_bowled"] == 26 and rab["wickets"] == 4 and rab["bowled_or_lbw"] == 2 and rab["catches"] == 3
    assert stats[server._norm_name("Rohit Sharma")]["out"] is True


def test_map_stats_to_squad_and_points():
    stats = server.merge_cric_payload(SCORECARD_PAYLOAD["data"])
    lines, unmatched, missing = server.map_stats_to_squad(stats, SQUAD)
    by_id = {l["player_id"]: l for l in lines}
    assert by_id["p-rab"]["source_name"] == "Kagiso Rabada"
    assert by_id["p-sk"]["runs"] == 61
    assert by_id["p-rah"]["catches"] == 1
    assert all(l["confidence"] >= 0.75 for l in lines)
    # squad members the feed did not mention are reported, never silently zeroed
    assert {m["player_id"] for m in missing} >= {"p-unused"}
    # and an entirely unknown name is reported as unmatched rather than guessed
    extra = dict(stats)
    rahul_key = server._norm_name("KL Rahul")
    extra[server._norm_name("Zorban Randomson")] = {**extra[rahul_key], "name": "Zorban Randomson"}
    _, un2, _ = server.map_stats_to_squad(extra, SQUAD)
    assert any(u["source_name"] == "Zorban Randomson" for u in un2), un2

    # the mapped lines must be valid input for the scoring engine
    def score_line(l, role):
        body = server.PlayerScoreIn(player_id=l["player_id"], **{k: v for k, v in l.items()
                                                                if k not in ("player_id", "squad_name", "source_name", "confidence")})
        return server.compute_player_points(body, role)

    total = 0
    for l in lines:
        role = next(p["role"] for p in SQUAD if p["id"] == l["player_id"])
        pts = score_line(l, role)
        assert isinstance(pts["total"], float)
        total += pts["total"]
    assert total > 0
    sk_line = next(l for l in lines if l["player_id"] == "p-sk")
    sk_pts = score_line(sk_line, "BAT")
    # 4 (playing XI) + 61 runs + 5 (fours) + 8 (4 sixes) + 8 (half-century) + 6 (SR 184.8)
    assert sk_pts["total"] == 92, sk_pts
    rab_line = next(l for l in lines if l["player_id"] == "p-rab")
    rab_pts = score_line(rab_line, "BOWL")
    # 4 wickets*25 + 8 bonus(4x) ... check the big-ticket pieces are present
    assert rab_pts["components"]["wickets"] == 100
    assert rab_pts["components"]["maidens"] == 12
    assert rab_pts["components"]["catches"] == 24 and rab_pts["components"]["catch_bonus"] == 4
    assert rab_pts["components"]["four_wicket_haul"] == 8
    assert rab_pts["components"]["bowled_lbw"] == 8  # from "b Rabada" in the dismissal text
    # 4 XI + 12 runs + 1 four + 2 (six) + 100 wickets + 8 (4-wkt) + 12 maiden + 8 bowled/lbw
    # + 6 (econ 4.15) + 24 catches + 4 (3-catch bonus)
    assert rab_pts["total"] == 181, rab_pts


def test_score_settings_never_leaks_key():
    import asyncio

    async def scenario():
        await db_set("scores", {"key": "scores", "cricapi_key": "SECRET-XYZ", "enabled": True})
        s = await server.get_score_settings()
        assert "cricapi_key" not in s
        assert s["key_present"] is True and s["admin_key_set"] is True and s["enabled"] is True
        await db_set("scores", {"key": "scores", "cricapi_key": "", "enabled": False})
        s2 = await server.get_score_settings()
        assert s2["enabled"] is False
    asyncio.get_event_loop().run_until_complete(scenario())


async def db_set(key, doc):
    await server.db.settings.update_one({"key": key}, {"$set": doc}, upsert=True)
