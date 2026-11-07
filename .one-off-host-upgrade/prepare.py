#!/usr/bin/env python3
"""Build an inert, reviewable eight-module bundle; no host or network calls."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess

REVISION = 'd6afd290126830cbaac5e827b2b72f73c8711d24'
MODULES = ('__init__.py', 'runtime_inputs.py', 'release_host.py', 'live_host.py',
           'live_configuration.py', 'paper_host.py', 'paper_release.py', 'release.py')


def prepare(repo, out):
    def git(*args):
        return subprocess.check_output(['git', '-C', str(repo), *args])
    modules = {}
    for name in MODULES:
        data = git('show', REVISION + ':deploy/' + name)
        compile(data, 'reviewed/deploy/' + name, 'exec')
        modules[name] = {'git_blob': git('rev-parse', REVISION + ':deploy/' + name).decode().strip(),
                         'sha256': hashlib.sha256(data).hexdigest(), 'bytes': base64.b64encode(data).decode()}
    value = {'format': 'reviewed-live-host-upgrade-bundle-v1', 'revision': REVISION,
             'parents': git('show', '-s', '--format=%P', REVISION).decode().strip().split(),
             'order': 'host-before-product-merges', 'modules': modules}
    descriptor = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    return {'bundle': str(out), 'revision': REVISION, 'sha256': hashlib.sha256(out.read_bytes()).hexdigest(),
            'modules': {name: {k: v for k, v in row.items() if k != 'bytes'} for name, row in modules.items()},
            'host_baseline': 'not-collected', 'install_authority': 'not-granted'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.repo, args.out), indent=2))
