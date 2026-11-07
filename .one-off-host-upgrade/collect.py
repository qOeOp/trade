#!/usr/bin/env python3
"""Prepared read-only survey; NOT RUN. Helpers require the later explicit host scope.

No credential bodies, Docker Env, arbitrary journal parser or strategy execution.
Agent ownership uses the verified bundle's existing stdlib getter only.
The output is deliberately a draft and cannot be supplied to upgrade --install.
"""
import argparse
from contextlib import ExitStack
import hashlib
import json
import os
from pathlib import Path
import tempfile

import upgrade as u


def package_names():
    return u.metadata_tree(u.CODE)


def capture(assets, bundle_digest):
    # assets is the independently reviewed full metadata survey, not a self-signed filename list.
    package = u.tree(u.CODE, assets)
    _, modules = u.bundle(Path(__file__).with_name('bundle.json'), bundle_digest)
    root = u.CANONICAL
    # Only explicitly named metadata files. Credentials and native cache contents are never traversed.
    declaration = u.obj(u.DECLARATION)
    u.need(declaration['root'] == str(root), 'installed root changed')
    route = u.obj(u.STATE / 'router/active.json')
    web = route['apps']['http']['servers']['ide']['routes'][0]['handle'][0]['upstreams'][0]['dial'].removesuffix(':8765')
    u.need(u.re.fullmatch(r'trade-release-web-[0-9a-f]{40}', web), 'not a selected paired Web')
    snapshot = u.STATE / 'live' / web.removeprefix('trade-release-web-') / 'configuration.json'
    files = {u.DECLARATION, snapshot, u.STATE / 'router/active.json'}
    files.update(u.STATE.glob('live/*/configuration.json'))
    for directory in ('failed', 'paper-failed'):
        if (u.STATE / directory).exists():
            for path in (u.STATE / directory).iterdir():
                u.need(u.HEX.fullmatch(path.name), 'unrecognized retained release history')
                files.add(path)
    for unit in u.UNITS:
        files.add(Path('/etc/systemd/system') / unit)
    routers = {'trade-ide-ide-router-1': 'ide'}
    if (u.STATE / 'paper-router/active.json').exists():
        files.add(u.STATE / 'paper-router/active.json')
        routers['trade-ide-paper-router-1'] = 'paper'
    directories = {u.CODE.parent, u.STATE, root, *u.KNOWN_FOREIGN}
    locks = {u.STATE / 'lock', root / 'account.lock', *(path / 'account.lock' for path in u.KNOWN_FOREIGN)}
    identities = {str(path): u.identity(path, contents=path in files) for path in files | directories | locks}
    identities['/var/run/docker.sock'] = u.identity(Path('/var/run/docker.sock'))
    value = {'format': 'draft-existing-live-host-upgrade-observation-v1', 'bundle_sha256': bundle_digest,
             'window': 'NOT_CONFIRMED', 'root': str(root), 'web': web, 'routers': routers,
             'service_image': '', 'socket_gid': identities['/var/run/docker.sock']['gid'],
             'identities': identities, 'deploy_identity': u.identity(u.CODE), 'deploy_tree': package,
             'known_foreign': [str(path) for path in u.KNOWN_FOREIGN], 'foreign': {}}
    with tempfile.TemporaryDirectory(prefix='host-upgrade-readonly-') as temporary, ExitStack() as held:
        system = u.System(value, Path(temporary), modules['release_host.py'])
        # No unit is changed by collection; any in-flight original writer causes NB refusal.
        for path in (u.STATE / 'lock', root / 'account.lock', *(path / 'account.lock' for path in u.KNOWN_FOREIGN)):
            held.enter_context(u.original_lock(path, identities[str(path)], shared=True))
        value['units'] = system.units()
        control = 'trade-release-live-' + web.removeprefix('trade-release-web-')
        current = json.loads(system.docker('inspect', '--format', u.CONTAINERS, control))
        value['service_image'] = current['image']
        value['observations'] = system.observe()
        for path in u.KNOWN_FOREIGN:
            value['foreign'][str(path)] = {'root': identities[str(path)], 'lock': identities[str(path / 'account.lock')]}
            value['foreign'][str(path)]['observation'] = system.foreign_observation(path)
        canonical = system.inspector(root, snapshot)
        u.need(canonical == {'state': 'idle'}, 'canonical inspection unavailable; never replace it with historical idle')
        u.need(system.observe() == value['observations'], 'host changed during observations')
        for path, expected in identities.items():
            u.need(u.identity(Path(path), contents='sha256' in expected) == expected, 'original changed during observations')
        u.need(u.tree(u.CODE, assets) == package, 'package changed during observations')
    return value


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument('--list-package', action='store_true', help='path/type/permission/inode only, no contents')
    choice.add_argument('--collect', action='store_true', help='future approved fixed-root helpers and non-secret facts')
    parser.add_argument('--reviewed-assets', type=Path)
    parser.add_argument('--bundle-sha256')
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    u.need(os.geteuid() == 0 and u.sys.platform == 'linux', 'reviewed Linux host only')
    if args.list_package:
        result = {'format': 'draft-package-path-survey-v1', 'files': package_names()}
    else:
        u.need(args.reviewed_assets is not None and args.bundle_sha256, 'reviewed non-secret asset list is required')
        result = capture(json.loads(u.read(args.reviewed_assets)), args.bundle_sha256)
    u.new_file(args.out, (json.dumps(result, indent=2) + '\n').encode())
    print(json.dumps({'draft_observation': str(args.out), 'sha256': hashlib.sha256(u.read(args.out)).hexdigest(),
                      'install_baseline': False}))
