#!/usr/bin/env python3
"""Real main-model tools, sole /swarm stop command, isolated offline package entry."""
import argparse
import json
import os
import shutil
import time
from run import DisposableFixture, Terminal, HERE, compact, pi_cli


def main(scripted=False, package_root=False):
    pi = pi_cli()
    with DisposableFixture() as fixture:
        home, agent, project = [fixture.root / name for name in ('home', 'agent', 'project')]
        for path in (home, agent, project):
            path.mkdir(mode=0o700)
        env = {'PATH': os.environ['PATH'], 'HOME': str(home), 'TERM': 'xterm-256color',
               'LANG': 'C.UTF-8', 'PI_CODING_AGENT_DIR': str(agent), 'PI_OFFLINE': '1',
               'PI_TELEMETRY': '0', 'SWARM_TERMINAL_FIXTURE': str(fixture.root / 'events.jsonl')}
        (agent / 'settings.json').write_text(json.dumps({'quietStartup': True, 'enableInstallTelemetry': False,
            'compaction': {'enabled': False}, 'retry': {'enabled': False}, 'cacheWarming': 'off'}))
        (project / 'user.txt').write_text('Preserve fixture work\n')
        (project / '.gitignore').write_bytes(b'# Preserve existing rules\r\n')
        entry = HERE.parent.parent if package_root else HERE.parent.parent / 'extensions/index.ts'
        command = [shutil.which('node'), str(pi), '--no-extensions', '-e', str(entry), '--no-skills',
                   '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-approve']
        if scripted:
            command += ['-e', str(HERE.parent.parent.parent / 'pi-status-line/extensions/status-line/index.ts'), '-e', str(HERE / 'entry-fixture.ts'), '--provider', 'entry-fixture', '--model', 'first',
                        '--tools', 'swarm_start,swarm_status,swarm_control,swarm_history']
        else:
            command += ['--no-tools']
        terminal = fixture.terminal = Terminal(command, project, env)
        def events():
            path = fixture.root / 'events.jsonl'
            return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []
        def wait_event(kind, count=1):
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                if sum(row['type'] == kind for row in events()) >= count:
                    return
                terminal.pump()
            raise AssertionError(f'Missing {kind}: {events()}; terminal: {terminal.output[-5000:]}')
        try:
            terminal.expect('Entry fixture ready' if scripted else 'No models available')
            terminal.line('/swarm start forbidden')
            terminal.expect('Use /swarm stop')
            for action in (' status', ' resume'):
                terminal.line('/swarm' + action)
                deadline = time.monotonic() + .3
                while time.monotonic() < deadline:
                    terminal.pump(.03)
            assert not events() or not any(row['type'] in ('auth', 'dispatch') for row in events())
            if scripted:
                terminal.line('/fixture-model'); terminal.expect('Entry model changed')
                terminal.line('fixture chat launch'); terminal.expect('LAUNCH (Pi native provider)')
                terminal.send('\x1b'); terminal.expect('Fixture main agent returned')
                assert not any(row['type'] == 'dispatch' for row in events())
                terminal.line('fixture chat launch'); terminal.expect('LAUNCH (Pi native provider)')
                terminal.read_packet('LAUNCH (Pi native provider)')
                assert compact('"objective": "Fixture chat goal"') in terminal.last_packet
                terminal.choose(2); terminal.expect('Preserve and proceed?'); terminal.choose(1)
                terminal.expect('Fixture main agent returned'); wait_event('dispatch')
                assert [row['model'] for row in events() if row['type'] == 'dispatch'] == ['second']
                terminal.send('\x1bn'); terminal.expect('1 Messages  2 Agents  3 Topics / Boards')
                terminal.send('\t'); terminal.expect('Main agent')
                terminal.send('\t'); terminal.expect('No topics yet')
                terminal.send('\x1b'); time.sleep(.1)
                terminal.line('fixture chat pause'); terminal.expect('Fixture main agent returned'); wait_event('settled')
                terminal.line('fixture chat view'); terminal.expect('Swarm · paused')
                terminal.send('r'); terminal.send('p'); terminal.send('s'); time.sleep(.2)
                assert sum(row['type'] == 'dispatch' for row in events()) == 1
                terminal.send('\x1b'); terminal.expect('Fixture main agent returned')
                terminal.line('/reload'); terminal.expect('Reloaded'); time.sleep(.3)
                terminal.line('fixture chat status'); terminal.expect('Fixture main agent returned')
                assert sum(row['type'] == 'dispatch' for row in events()) == 1
            terminal.line('/swarm stop')
            time.sleep(.3)
            assert not (project / '.git').exists()
            assert not (project / '.swarms').exists()
            assert (project / '.gitignore').read_bytes() == b'# Preserve existing rules\r\n'
            assert (project / 'user.txt').read_text() == 'Preserve fixture work\n'
        finally:
            terminal.close()
    print('PASS: main-agent tools, Cancel-default approval, read-only dashboard, reload and sole /swarm stop' if scripted else
          'PASS: normal entry exposes only /swarm stop without model dispatch')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package-root', action='store_true')
    args = parser.parse_args()
    main(package_root=args.package_root)
    main(scripted=True, package_root=args.package_root)
