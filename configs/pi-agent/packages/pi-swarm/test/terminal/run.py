#!/usr/bin/env python3
"""Offline POSIX PTY acceptance. Requires installed pi, Node 22+, Python 3 and Git.
Creates and removes only disposable fixtures; no installs or personal config reads.
Run from any directory. Pi comes from its managed installation; PI_SDK_DIR overrides
the SDK package directory and PI_BIN the JavaScript CLI script.
"""
import codecs
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import signal
import struct
import subprocess
import tempfile
import termios
import time

HERE = Path(__file__).resolve().parent
ANSI = re.compile(r"\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[=>]")
MANAGED_MARKER = {"kind": "pi-managed-install", "schemaVersion": 1, "layout": "releases-v1"}
MANAGED_VERSION = re.compile(r"[0-9A-Za-z._+-]+")


def pi_cli():
    """Pi's JavaScript CLI script, run as `node <script>`: PI_BIN, else the package's pi bin."""
    override = os.environ.get("PI_BIN")
    if override:
        cli = Path(os.path.abspath(override))
        if not cli.is_file() or cli.suffix not in (".js", ".mjs", ".cjs"):
            raise RuntimeError(f"PI_BIN must name Pi's JavaScript CLI script, not the pi wrapper: {override}")
        return cli
    package_dir = pi_package_dir()
    manifest = json.loads((package_dir / "package.json").read_text(encoding="utf-8"))
    bin_path = manifest.get("bin")
    if isinstance(bin_path, dict):
        bin_path = bin_path.get("pi")
    if not isinstance(bin_path, str) or not bin_path:
        raise RuntimeError(f"Pi package does not declare a pi bin: {package_dir}")
    # Like Pi's launcher: the bin must stay inside the package directory.
    cli = Path(os.path.abspath(package_dir / bin_path))
    if not cli.is_relative_to(package_dir) or not cli.is_file():
        raise RuntimeError(f"Pi executable is invalid: {cli}")
    return cli


def pi_package_dir():
    """Mirror of test/pi-install.mjs: PI_SDK_DIR, else Pi's managed installation. No npm-global fallback."""
    if os.environ.get("PI_SDK_DIR"):
        return require_package(Path(os.path.abspath(os.environ["PI_SDK_DIR"])), "PI_SDK_DIR has no package.json")
    agent_dir = os.environ.get("PI_CODING_AGENT_DIR") or str(Path.home() / ".pi" / "agent")
    root = Path(os.path.abspath(os.environ.get("PI_MANAGED_INSTALL_ROOT", "").strip() or os.path.join(agent_dir, "install")))
    marker_path = root / "managed-install.json"
    if not marker_path.exists():
        raise RuntimeError(f"No managed Pi installation found at {root}; install Pi with its installer, or set PI_SDK_DIR.")
    try:
        marker = json.loads(marker_path.read_text(encoding="utf-8"))
    except ValueError:
        marker = None
    if not isinstance(marker, dict) or any(type(marker.get(key)) is not type(value) or marker.get(key) != value
                                           for key, value in MANAGED_MARKER.items()):
        raise RuntimeError(f"Managed Pi install marker is invalid: {marker_path}")
    version_path = root / "current-version"
    version = version_path.read_text(encoding="utf-8").strip() if version_path.exists() else ""
    if version in ("", ".", "..") or not MANAGED_VERSION.fullmatch(version):
        raise RuntimeError(f"Managed Pi version file is invalid: {version_path}")
    package_dir = root / "releases" / version / "node_modules" / "@earendil-works" / "pi-coding-agent"
    return require_package(package_dir, "Managed Pi release is missing")


def require_package(package_dir, problem):
    if not (package_dir / "package.json").is_file():
        raise RuntimeError(f"{problem}: {package_dir}")
    return package_dir


class Terminal:
    def __init__(self, command, cwd, env):
        self.fd, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 100, 0, 0))
        try:
            self.process = subprocess.Popen(command, cwd=cwd, env=env, stdin=slave,
                                            stdout=slave, stderr=slave, start_new_session=True)
        except BaseException:
            os.close(self.fd)
            raise
        finally:
            os.close(slave)
        self.output = ""
        self.decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        self.cursor = 0

    def send(self, value):
        os.write(self.fd, value.encode())

    def pump(self, timeout=0.1):
        if select.select([self.fd], [], [], timeout)[0]:
            try:
                data = self.decoder.decode(os.read(self.fd, 65536))
            except OSError:
                data = ""
            self.output += data
            # Answer terminal cursor-position requests; no capability extensions claimed.
            if "\x1b[6n" in data:
                self.send("\x1b[1;1R")

    def expect(self, text, timeout=15):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            plain = ANSI.sub("", self.output[self.cursor:])
            if text in plain:
                self.last_expect_start = self.cursor
                self.cursor = len(self.output)
                return
            self.pump()
        raise AssertionError(f"Missing display {text!r}; terminal tail:\n{ANSI.sub('', self.output)[-6000:]}")

    def expect_status(self, expected, transport="mock only"):
        # Pi 1.0 clips and diffs long notifications: neither the JSON prefix
        # nor unchanged tail need be emitted. Inspect the bounded native view.
        start = len(self.output)
        self.line("/swarm dashboard")
        self.expect(f"SWARM live / {transport} | {expected}")
        self.cursor = start
        self.expect("cost: unknown")
        self.send("\x1b")
        time.sleep(0.2)

    def inspect_conversation(self):
        """Exercise the real focused overlay without granting execution authority."""
        self.send("c")
        self.expect("Native persisted history")
        self.send("/")
        self.expect("SEARCH")
        self.send("psC")  # Search text must not invoke pause, stop or reconciliation.
        self.send("\r")
        self.expect("0 matches")
        self.send("?")
        self.expect("NAVIGATION")
        self.send("\x1b[F")  # End belongs to the overlay, not Pi's transcript.
        self.expect("Inspection never starts")
        self.send("\x1b[H")
        self.expect("NAVIGATION")
        self.send("?")
        time.sleep(0.1)
        self.send("q")
        self.expect("Workers")
        self.send("\r")
        self.expect("Native persisted history")

    def line(self, text):
        self.send(text)
        time.sleep(0.1)
        self.send("\r")

    def choose(self, steps):
        for _ in range(steps):
            self.send("\x1b[B")
            time.sleep(0.05)
        self.send("\r")

    def decision(self, steps=1):
        """Read every page of the bounded packet, then explicitly select an action."""
        self.read_decision()
        self.send("\t")
        time.sleep(0.05)
        for _ in range(steps):
            self.send("\x1b[B")
            time.sleep(0.05)
        self.send("\r")

    def read_decision(self):
        for _ in range(100):
            plain = ANSI.sub("", self.output[self.last_expect_start:])
            states = re.findall(r"(?:Read to end to decide|Decision available)", plain)
            if states and states[-1] == "Decision available":
                self.last_packet = plain
                return
            if states:
                self.send("\x1b[6~")
            deadline = time.monotonic() + 0.15
            while time.monotonic() < deadline:
                self.pump(0.03)
        raise AssertionError(f"Decision packet did not reach its end: {ANSI.sub('', self.output)[-6000:]}")

    def resize(self, columns, rows):
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))
        os.kill(self.process.pid, signal.SIGWINCH)
        time.sleep(0.2)

    def close(self, quit_timeout=10, term_timeout=5, kill_timeout=5):
        try:
            if self.process.poll() is None:
                try:
                    self.send("\x1b")
                    time.sleep(0.1)
                    self.line("/quit")
                    deadline = time.monotonic() + quit_timeout
                    while self.process.poll() is None and time.monotonic() < deadline:
                        self.pump()
                except OSError:
                    pass  # A closed PTY must not bypass process cleanup.
            for sig, timeout in ((signal.SIGTERM, term_timeout), (signal.SIGKILL, kill_timeout)):
                if self.process.poll() is not None:
                    break
                try:
                    os.killpg(self.process.pid, sig)
                except ProcessLookupError:
                    pass  # Exit can race the signal; still reap the child.
                try:
                    self.process.wait(timeout=timeout)
                except subprocess.TimeoutExpired:
                    if sig == signal.SIGKILL:
                        raise RuntimeError("Child exit unconfirmed; retaining disposable fixture")
        finally:
            if self.fd is not None:
                os.close(self.fd)
                self.fd = None


class DisposableFixture:
    """Never remove child-owned files while child exit remains unconfirmed."""
    def __enter__(self):
        self.root = Path(tempfile.mkdtemp(prefix="swarm-terminal-"))
        self.terminal = None
        return self

    def __exit__(self, *_exc):
        if self.terminal is None or self.terminal.process.poll() is not None:
            shutil.rmtree(self.root)
        else:
            raise RuntimeError("Child exit unconfirmed; retaining disposable fixture")


def main():
    # Resolve before PI_CODING_AGENT_DIR is swapped for the disposable one below.
    pi, sdk = pi_cli(), pi_package_dir()
    assert shutil.which("node") and shutil.which("git"), "node and git required"
    with DisposableFixture() as fixture:
        root = fixture.root
        home, agent, project = [root / name for name in ("home", "agent", "project")]
        for path in (home, agent, project):
            path.mkdir(mode=0o700)
        env = {"PATH": os.environ["PATH"], "HOME": str(home), "TERM": "xterm-256color",
               "LANG": "C.UTF-8", "PI_CODING_AGENT_DIR": str(agent), "PI_OFFLINE": "1",
               "PI_TELEMETRY": "0", "PI_SKIP_VERSION_CHECK": "1", "GIT_CONFIG_NOSYSTEM": "1",
               "GIT_CONFIG_GLOBAL": os.devnull, "SWARM_TERMINAL_FIXTURE": str(root / "events.jsonl")}
        env["PI_SDK_DIR"] = str(sdk)  # The child's sdk-register cannot see the real agent dir.
        (agent / "settings.json").write_text(json.dumps({"quietStartup": True, "enableInstallTelemetry": False,
            "compaction": {"enabled": False}, "retry": {"enabled": False}}))
        subprocess.run(["git", "init", "-q", str(project)], env=env, check=True)
        (project / ".git" / "info" / "exclude").write_text(".swarms/\n")
        (project / "user.txt").write_text("preserve this work\n")
        command = [shutil.which("node"), "--experimental-import-meta-resolve", "--import", str(HERE.parent / "sdk-register.mjs"), str(pi), "--no-extensions", "-e", str(HERE / "fixture.ts"), "--no-skills",
                   "--no-prompt-templates", "--no-themes", "--no-context-files", "--no-approve", "--no-tools"]
        terminal = fixture.terminal = Terminal(command, project, env)
        event_file = root / "events.jsonl"

        def events():
            return [json.loads(line) for line in event_file.read_text().splitlines()]

        def wait_event(kind, count=1):
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                if sum(event["type"] == kind for event in events()) >= count:
                    return
                terminal.pump()
            raise AssertionError(f"Missing fixture event {kind} x{count}")

        try:
            terminal.expect("Swarm terminal fixture ready")
            terminal.line("/swarm start")
            terminal.expect("Swarm objective")
            terminal.send("\x1b")
            wait_event("command")
            assert not (project / ".swarms").exists()
            terminal.resize(60, 24)
            terminal.line("/swarm start Terminal goal")
            terminal.expect("LAUNCH (mock only)")
            terminal.decision(1)
            terminal.expect("Edit agreement field")
            terminal.choose(1)
            terminal.expect("New objective as JSON")
            terminal.line('"Edited terminal goal"')
            terminal.expect("LAUNCH (mock only)")
            for index, field, value in [(2, "criteria", '["Observable outcome"]'),
                                        (3, "scope", '["Only disposable project"]')]:
                terminal.decision(1)
                terminal.expect("Edit agreement field")
                terminal.choose(index)
                terminal.expect(f"New {field} as JSON")
                terminal.line(value)
                terminal.expect("LAUNCH (mock only)")
            terminal.decision(2)
            terminal.expect("Preserve and proceed?")
            terminal.decision()
            terminal.expect_status("running")
            wait_event("worker-start")
            terminal.line("/swarm dashboard")
            terminal.expect("SWARM live / mock only | running")
            terminal.expect("Recorded active time:")
            terminal.expect("Recorded active time:")  # host ticks repaint without keyboard input
            terminal.send("2")
            terminal.expect("active SDK turn")
            terminal.inspect_conversation()
            terminal.send("p")
            wait_event("worker-abort")
            time.sleep(0.3)
            terminal.line("/swarm status")
            terminal.expect_status("paused")
            terminal.line("/swarm resume")
            terminal.expect("RESUME (mock only)")
            terminal.decision()
            terminal.expect("Preserve and proceed?")
            terminal.decision()
            terminal.expect("Workspace reconciliation")
            terminal.decision()
            terminal.expect_status("running")
            wait_event("worker-start", 2)
            terminal.line("/reload")
            terminal.expect("Reloaded keybindings")
            terminal.line("/swarm status")
            terminal.expect_status("paused")
            wait_event("worker-abort", 2)
            assert sum(event["type"] == "worker-start" for event in events()) == 2
            terminal.resize(100, 40)
            terminal.line("/fixture-light")
            terminal.expect("Fixture light theme selected")
            terminal.line("/swarm")
            terminal.expect("SWARM live / mock only | paused")
            terminal.send("r")
            terminal.expect("RESUME (mock only)")
            terminal.decision()
            terminal.expect("Preserve and proceed?")
            terminal.decision()
            terminal.expect("Workspace reconciliation")
            terminal.decision()
            wait_event("worker-start", 3)
            terminal.line("/swarm dashboard")
            terminal.expect("SWARM live / mock only | running")
            terminal.send("s")
            wait_event("worker-abort", 3)
            time.sleep(0.3)
            terminal.line("/swarm status")
            terminal.expect_status("stopped")
            time.sleep(0.3)
            assert sum(event["type"] == "worker-start" for event in events()) == 3
            terminal.line("/fixture-uncertain")
            terminal.expect("Uncertain fixture armed")
            terminal.line("/swarm restart")
            terminal.expect("RESTART (mock only)")
            terminal.decision()
            terminal.expect("Preserve and proceed?")
            terminal.decision()
            terminal.expect("Workspace reconciliation")
            terminal.decision()
            terminal.expect("Fixture shell permission")
            terminal.choose(0)
            wait_event("uncertain-runner")
            time.sleep(0.2)
            # Recovery must be navigable at ordinary terminal dimensions.
            terminal.resize(80, 24)
            terminal.line("/swarm reconcile")
            terminal.expect("RECONCILE (mock only)")
            terminal.read_decision()
            recovery_packet = terminal.last_packet
            assert '"operations"' in recovery_packet and '"turns"' in recovery_packet
            assert '"liveUncertainIds"' in recovery_packet
            terminal.decision()
            terminal.expect("Preserve and proceed?")
            terminal.decision()
            terminal.expect("Describe how you independently established")
            terminal.line("Fixture runner spawned no process; its promise returned unsettled by design.")
            terminal.expect("Attest settlement")
            terminal.read_decision()
            evidence_packet = terminal.last_packet
            assert "Fixture runner spawned no process" in evidence_packet
            terminal.decision()
            # The durable attestation is asserted below; fullscreen may clip notifications.
            time.sleep(0.3)
            terminal.line("/swarm status")
            terminal.expect_status("paused")
            terminal.line("/swarm stop")
            time.sleep(0.3)
            terminal.line("/swarm status")
            terminal.expect_status("stopped")
            assert (project / "user.txt").read_text() == "preserve this work\n"
            assert sum(event["type"] == "uncertain-runner" for event in events()) == 1
            journal_path, = (project / ".swarms").glob("*/events.jsonl")
            journal = [json.loads(line)["payload"] for line in journal_path.read_text().splitlines()]
            continuations = [event for event in journal if event["type"] == "host.continue"]
            assert [event["payload"]["restart"] for event in continuations] == [False, False, True]
            assert all(event["cycle"] == 1 for event in continuations)
            subprocess.run([shutil.which("node"), str(HERE / "assert-journal.mjs"), str(journal_path)],
                           env=env, check=True)
            attestations = [event for event in journal if event["type"] == "host.attest"]
            assert len(attestations) == 1, "One durable attestation, not inferred settlement"
            operation_id = next(event["payload"]["id"] for event in journal if event["type"] == "workspace.start")
            assert operation_id in recovery_packet and operation_id in evidence_packet, "Exact operation ID visible before attestation"
            assert sum(event["type"] == "workspace.start" for event in journal) == 1, "Never replay uncertain effects"
            finishes = [event for event in journal if event["type"] == "workspace.finish"]
            assert len(finishes) == 1 and finishes[0]["payload"]["outcome"] == "unknown"
            assert not any(event["type"] == "run.complete" for event in journal), "Stopped is not completed"
            print("PASS: native cancellation, 60-column launch/edit/preservation, live dashboard refresh/history/pause/resume/stop, streaming reload, restart, uncertain-operation attestation")
        finally:
            terminal.close()


if __name__ == "__main__":
    main()
