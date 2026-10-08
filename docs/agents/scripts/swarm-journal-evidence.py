"""Read-only fingerprints and owner comparison for Pi Swarm JSONL journals.

Usage: python3 swarm-journal-evidence.py JOURNAL [JOURNAL ...]
       python3 swarm-journal-evidence.py --expect-owner SESSION_ID JOURNAL ...
Requires Python 3 and read access. No files are written. Identifiers and journal
contents are not printed. SHA-256 fingerprints compare bytes; they do not verify
the journal hash chain or prove that a run is stopped. Keep output local.
"""
import argparse
import hashlib
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expect-owner')
    parser.add_argument('journals', nargs='+', type=Path)
    args = parser.parse_args()
    results = []
    owners = []
    for index, path in enumerate(args.journals, 1):
        try:
            result, owner = inspect(path)
        except (OSError, ValueError, KeyError, TypeError):
            parser.error(f'Input {index} is not a readable Swarm journal with a run.create first event.')
        if args.expect_owner is not None:
            result['expected_owner_matches'] = owner == args.expect_owner
        results.append({'input': index, **result})
        owners.append(owner)
    print(json.dumps({'journals': results, 'same_owner': len(set(owners)) == 1}, indent=2))
    return 1 if args.expect_owner is not None and any(owner != args.expect_owner for owner in owners) else 0


def inspect(path):
    digest = hashlib.sha256()
    count = size = 0
    first = None
    with path.open('rb') as source:
        for line in source:
            digest.update(line)
            size += len(line)
            if line.strip():
                count += 1
                if first is None:
                    first = json.loads(line)['payload']
    if first is None or first['type'] != 'run.create':
        raise ValueError('Missing creation event')
    owner = first['payload']['ownerSessionId']
    if not isinstance(owner, str) or not owner:
        raise ValueError('Missing owner')
    return {'sha256': digest.hexdigest(), 'bytes': size, 'records': count}, owner


if __name__ == '__main__':
    raise SystemExit(main())
