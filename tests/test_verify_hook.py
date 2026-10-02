"""scripts/verify.py -- the Claude Code Stop hook's decision logic."""
from scripts import verify


def test_stop_hook_active_never_blocks(monkeypatch):
    monkeypatch.setattr(verify, "changed_code_files", lambda: ["backend/api.py"])
    monkeypatch.setattr(verify, "run_step", lambda *a: (_ for _ in ()).throw(AssertionError("must not run")))
    assert verify.main('{"hook_event_name": "Stop", "stop_hook_active": true}') == 0


def test_no_code_changes_never_blocks(monkeypatch):
    monkeypatch.setattr(verify, "changed_code_files", lambda: [])
    monkeypatch.setattr(verify, "run_step", lambda *a: (_ for _ in ()).throw(AssertionError("must not run")))
    assert verify.main('{"stop_hook_active": false}') == 0


def test_failure_blocks_with_exit_2_and_a_summary(monkeypatch, capsys):
    monkeypatch.setattr(verify, "changed_code_files", lambda: ["backend/api.py"])
    calls = []

    def fake_step(name, cmd, cwd):
        calls.append(name)
        return False, "line\n" * 5 + "E   AssertionError: boom\n1 failed", 1.0

    monkeypatch.setattr(verify, "run_step", fake_step)
    assert verify.main("{}") == 2
    err = capsys.readouterr().err
    assert "backend tests" in err and "FAILED" in err and "AssertionError: boom" in err
    assert len(calls) == 1, "stops at the first failing step"


def test_success_runs_every_step_and_passes(monkeypatch):
    monkeypatch.setattr(verify, "changed_code_files", lambda: ["frontend/src/app.js"])
    calls = []
    monkeypatch.setattr(verify, "run_step", lambda name, cmd, cwd: (calls.append(name) or True, "ok", 0.1))
    assert verify.main("") == 0
    assert len(calls) == len(verify.STEPS)


def test_bad_stdin_is_treated_as_empty():
    assert verify.read_hook_input("not json") == {}
    assert verify.read_hook_input("[1, 2]") == {}
    assert verify.read_hook_input('{"stop_hook_active": true}') == {"stop_hook_active": True}


def test_porcelain_parsing_and_code_filter():
    porcelain = (" M backend/api.py\n"
                 "?? SETUP_PROMPT.md\n"
                 "?? frontend/test/new.spec.js\n"
                 "R  scripts/old.py -> scripts/new.py\n"
                 " M docs/backend-integration.md\n"
                 "?? frontend/node_modules/x/index.js\n"
                 " M frontend/package-lock.json\n")
    paths = verify.parse_porcelain(porcelain)
    assert "scripts/new.py" in paths
    code = [p for p in paths if verify.is_code_file(p)]
    assert code == ["backend/api.py", "frontend/test/new.spec.js", "scripts/new.py"]
