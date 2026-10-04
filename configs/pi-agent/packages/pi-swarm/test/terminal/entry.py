#!/usr/bin/env python3
"""Normal file/package entry smoke test, isolated offline CLI, no SDK resolver preload."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
from run import DisposableFixture, Terminal, HERE


def main(scripted=False, package_root=False):
    pi = shutil.which(os.environ.get("PI_BIN", "pi"))
    assert pi and shutil.which("node") and shutil.which("git")
    with DisposableFixture() as fixture:
        home, agent, project = [fixture.root / name for name in ("home", "agent", "project")]
        for path in (home, agent, project):
            path.mkdir(mode=0o700)
        env = {"PATH": os.environ["PATH"], "HOME": str(home), "TERM": "xterm-256color",
               "LANG": "C.UTF-8", "PI_CODING_AGENT_DIR": str(agent), "PI_OFFLINE": "1",
               "PI_TELEMETRY": "0", "PI_SKIP_VERSION_CHECK": "1", "GIT_CONFIG_NOSYSTEM": "1",
               "GIT_CONFIG_GLOBAL": os.devnull, "SWARM_TERMINAL_FIXTURE": str(fixture.root / "events.jsonl")}
        (agent / "settings.json").write_text(json.dumps({"quietStartup": True, "enableInstallTelemetry": False,
            "compaction": {"enabled": False}, "retry": {"enabled": False}, "cacheWarming": {"enabled": False}}))
        subprocess.run(["git", "init", "-q", str(project)], env=env, check=True)
        (project / ".git" / "info" / "exclude").write_text(".swarms/\n")
        if scripted:
            (project / "user.txt").write_text("Preserve fixture work\n")
        entry = HERE.parent.parent if package_root else HERE.parent.parent / "extensions" / "index.ts"
        command = [shutil.which("node"), str(Path(pi).resolve()), "--no-extensions",
                   "-e", str(entry),
                   "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
                   "--no-approve", "--no-tools"]
        if scripted:
            packages = HERE.parent.parent.parent
            command += ["-e", str(HERE / "entry-fixture.ts"),
                        "-e", str(packages / "pi-plan/extensions/plan/index.ts"),
                        "-e", str(packages / "pi-safety/extensions/safety/index.ts"),
                        "--provider", "entry-fixture", "--model", "first"]
        terminal = fixture.terminal = Terminal(command, project, env)
        def events():
            path = fixture.root / "events.jsonl"
            return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []
        def wait_event(kind):
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                if any(event["type"] == kind for event in events()):
                    return
                terminal.pump()
            raise AssertionError("Missing fixture event: " + kind)
        try:
            terminal.expect("Entry fixture ready" if scripted else "No models available")
            terminal.line("/swarm dashboard")
            terminal.expect("SWARM")
            terminal.send("\x1b")
            time.sleep(0.3)
            terminal.line("/reload")
            terminal.expect("Reloaded")
            terminal.line("/swarm dashboard")
            terminal.expect("SWARM")
            terminal.send("\x1b")
            assert not (project / ".swarms").exists()
            if scripted:
                assert not any(event["type"] in ("auth", "dispatch") for event in events())
                time.sleep(0.3)
                terminal.line("/fixture-model")
                terminal.expect("Entry model changed")
                terminal.line("/swarm start fixture goal")
                terminal.expect("Acceptance criteria")
                terminal.line("")  # Placeholder is not a default; blank Enter must re-prompt.
                time.sleep(0.3)
                terminal.line('["unfinished",')
                time.sleep(0.3)
                terminal.line("Fixture only")
                terminal.expect("Scope and exclusions")
                terminal.line("Disposable checkout only")
                terminal.expect("LAUNCH (Pi native provider)")
                terminal.send("\x1b")
                time.sleep(0.3)
                assert not (project / ".swarms").exists()
                assert not any(event["type"] in ("auth", "dispatch") for event in events())
                terminal.line("/swarm start fixture goal")
                terminal.expect("Acceptance criteria")
                terminal.line('["Fixture only"]')
                terminal.expect("Scope and exclusions")
                terminal.line('["Disposable checkout only"]')
                terminal.expect("LAUNCH (Pi native provider)")
                terminal.decision(2)
                terminal.expect("Preserve and proceed?")
                terminal.decision()
                wait_event("dispatch")
                assert [event["model"] for event in events() if event["type"] == "dispatch"] == ["second"]
                terminal.line("/swarm pause")
                wait_event("settled")
                terminal.line("/reload")
                terminal.expect("Reloaded")
                time.sleep(0.5)
                assert sum(event["type"] == "dispatch" for event in events()) == 1
                terminal.expect_status("paused", transport="Pi native provider")
                assert (project / "user.txt").read_text() == "Preserve fixture work\n"
        finally:
            terminal.close()
    print("Explicit normal entry scripted approval/current-model/paused-reload passed" if scripted else
          "Explicit normal entry load/reload passed without auth or worker dispatch")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package-root", action="store_true", help="Load the package manifest instead of the raw entry file")
    args = parser.parse_args()
    main(package_root=args.package_root)
    main(scripted=True, package_root=args.package_root)
