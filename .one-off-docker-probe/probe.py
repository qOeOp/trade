#!/usr/bin/env python3
"""Finite CI-only Docker compatibility probe. Default performs offline input checks."""
import argparse
import ast
from contextlib import ExitStack
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import uuid

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
INSTALLER = HERE.parent / 'implementation-v3'
MANIFEST = 'd329d34ae15c87db05563284648ac578f775efb8b1308e0cc746c49741c9300b'
BUNDLE = 'c8b424be7f4dcabea6ca71c24fe55617563ad878bf4d600c53154dd2e4da47a2'
SCRIPT_HASHES = {
    'prepare.py': '6d5c146a599ae9da48c525484a77246f93fe69466d0d42b45354a97b59f91557',
    'upgrade.py': '4091e3cade65f7ca91bed354ad16b0562472ee990757ba0e2169ddc3a18bec0a',
    'collect.py': '3b9a6d86e10dde0cbd96a859f358879d1a518bf16db73be75df2abfcd4bb7024',
    'test_upgrade.py': 'eb86719e53b5ffbdecd85eb8386216f0322c27ec093f366d36b9064397bc76b6',
    'test_boundaries.py': '1f47d0ccc3d6f9436bc84e4b2505ca385ef46e264875e61d13d2071e9a2acb86',
    'test_agent.py': '5d28de6592c3f23abe880fb70ed0904c31923c6578215e894c901bd5aa78c46b',
    'test_linux.py': '8ad9683af93c914c91d23397c786bed7d44e54b3be5830281ec9be9304042fca',
}
IMAGE = 'ghcr.io/qoeop/trade-service@sha256:abc97078d42fd5b7c2c7a268832474e0462bf1a55b8cbedf2d22d3a73dd849f9'
REVISION = 'e81fd3ad17f80eb584927f54c0c608d7247b9e39'
CONFIG = 'sha256:26601210e37febb746257c32a8d235085944844a7d592e609d57cf36f48b48ab'
LABEL = 'trade.ci.live-upgrade-probe'
OWN = '{"id":{{json .Id}},"name":{{json .Name}},"lane":{{json (index .Config.Labels "trade.ci.live-upgrade-probe")}}}'
ID = re.compile(r'[0-9a-f]{64}\Z')

# Executed only inside the fixed image, with no socket and only fresh own RW fixtures.
INITIALIZE = '''import hashlib,json,sys
from pathlib import Path
sys.path.insert(0,'/opt/trade')
from deploy.live_configuration import OPERATOR_FIELDS,declaration,snapshot
from deploy.release_host import durable_json
from live import configuration,state
root=Path('/srv/trade-private/live');foreign=Path('/srv/trade-private/live-acceptance')
home=Path('/var/lib/trade-release');sha=sys.argv[1]
for path in (root,foreign):
 with state.serialized(path):pass
source=home/'fixture-source.py';body=b'class OfflineProbe: pass\\n'
state.write_new(source,body)
state.write_new(home/'fixture-universe.json',b'{}\\n')
file=home/'live'/sha/'configuration.json'
operator={'root':str(root),'research_ledger':str(home/'unused-ledger.json'),'research_at':'a'*32,
 'universe_file':str(home/'fixture-universe.json'),'symbols':['BTCUSDT'],'memory':'2g',
 'defaults':{'budget_usdt':'90','max_notional_per_order':'90','max_loss_usdt':'2','duration_seconds':8100},
 'sources':[{'source_id':'offline-probe','candidate':'offline-probe@1','strategy_file':str(source),
 'source_sha256':hashlib.sha256(body).hexdigest(),'entry_class':'OfflineProbe','purpose':'controlled',
 'single_order_source_reviewed':True}]}
assert set(operator)==OPERATOR_FIELDS
value={'format':'live-control-v1',**operator,'runtime':'ghcr.io/qoeop/trade-runtime@sha256:'+'b'*64,
 'socket':str(file.parent/'socket/control.sock')}
durable_json(home/'live/configuration.json',{'format':'live-deployment-v1',**operator},mode=0o600)
durable_json(file,value,mode=0o600)
declaration(home/'live/configuration.json');snapshot(file,file.parent/'socket/control.sock')
configuration.load(file)
print(json.dumps({'fixture':'empty-private-roots','strategy_executed':False}))
'''


def need(value, message):
    if not value:
        raise RuntimeError(message)


def load_installer():
    # Existing disposable CI payload has the seven frozen scripts; it rebuilds the same bundle.
    # MANIFEST identifies their original review, without requiring review prose/logs in Git.
    for name, digest in SCRIPT_HASHES.items():
        need(hashlib.sha256((INSTALLER / name).read_bytes()).hexdigest() == digest, 'frozen installer source changed')
    spec = importlib.util.spec_from_file_location('probe_frozen_upgrade', INSTALLER / 'upgrade.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _, modules = module.bundle(INSTALLER / 'bundle.json', BUNDLE)
    return module, modules


def control_command(u, snapshot, web):
    """Execute the two original frozen expressions, rather than another Cmd policy."""
    source = ast.parse((INSTALLER / 'upgrade.py').read_bytes())
    owner = next(node for node in source.body if isinstance(node, ast.ClassDef) and node.name == 'System')
    observe = next(node for node in owner.body if isinstance(node, ast.FunctionDef) and node.name == 'observe')
    selected = [node for node in observe.body if isinstance(node, ast.Assign) and len(node.targets) == 1
                and isinstance(node.targets[0], ast.Name) and node.targets[0].id in {'expected_command', 'template'}]
    need([node.targets[0].id for node in selected] == ['expected_command', 'template'], 'frozen control expressions missing')
    namespace = {'json': json, 'str': str, 'STATE': u.STATE, 'snapshot': snapshot,
                 'self': SimpleNamespace(baseline={'web': web})}
    exec(compile(ast.Module(body=selected, type_ignores=[]), '<frozen-control-template>', 'exec'), namespace)
    return namespace['expected_command'], namespace['template']


def local_identity(path):
    info = path.lstat()
    need(stat.S_ISDIR(info.st_mode), 'owned fixture directory changed type')
    return info.st_dev, info.st_ino


class Driver:
    def __init__(self, out, docker_config, lane):
        self.out, self.config, self.lane = out, docker_config, lane
        self.records, self.created, self.count = [], {}, 0

    def save(self):
        (self.out / 'commands.json').write_text(json.dumps(self.records, indent=2) + '\n')
        (self.out / 'created.json').write_text(json.dumps(self.created, indent=2) + '\n')

    def command(self, argv, *, timeout=30, check=True):
        started = time.monotonic()
        record = {'argv': list(map(str, argv)), 'timeout_seconds': timeout}
        try:
            result = subprocess.run(record['argv'], env={'PATH': os.defpath, 'LC_ALL': 'C'},
                                    capture_output=True, text=True, timeout=timeout, check=False)
            record.update(stdout=result.stdout, stderr=result.stderr, exit_code=result.returncode, timed_out=False)
        except subprocess.TimeoutExpired as error:
            record.update(stdout=decode(error.stdout), stderr=decode(error.stderr), exit_code=None, timed_out=True)
            raise RuntimeError('command timeout; original output retained') from error
        finally:
            record['seconds'] = time.monotonic() - started
            self.records.append(record)
            self.save()
        need(not check or result.returncode == 0, 'command failed; original output retained')
        return result.stdout.strip()

    def docker(self, *args, **kwargs):
        return self.command(['/usr/bin/docker', '--config', str(self.config), '--host',
                             'unix:///var/run/docker.sock', *map(str, args)], **kwargs)

    def own_options(self, purpose):
        need(purpose in {'initialize', 'template', 'canonical', 'historical'} and self.count < 4,
             'only four finite lane resources are permitted')
        name = self.lane + '-' + purpose
        need(name not in self.created, 'no automatic resource retry')
        self.count += 1
        self.created[name] = {'id': None, 'lane': self.lane, 'removed': False}
        self.save()
        return name, ['--name', name, '--label', LABEL + '=' + self.lane]

    def run(self, original, purpose, timeout=180):
        need(original[0] == 'run', 'only original run argv can be instrumented')
        name, options = self.own_options(purpose)
        cidfile = self.out / (purpose + '.cid')
        need(not os.path.lexists(cidfile), 'CID file must be new')
        argv = ['/usr/bin/docker', '--config', str(self.config), '--host', 'unix:///var/run/docker.sock',
                'run', *options, '--cidfile', str(cidfile), *original[1:]]
        started = time.monotonic()
        record = {'argv': argv, 'timeout_seconds': timeout, 'purpose': purpose}
        process = None
        try:
            process = subprocess.Popen(argv, env={'PATH': os.defpath, 'LC_ALL': 'C'},
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            # Python entrypoints import substantial code; still fail explicitly if CID is not observed.
            while time.monotonic() - started < min(30, timeout):
                if cidfile.exists():
                    found = cidfile.read_text().strip()
                    if ID.fullmatch(found):
                        self.created[name]['id'] = found
                        self.save()
                        break
                if process.poll() is not None:
                    break
                time.sleep(.01)
            remaining = max(.01, timeout - (time.monotonic() - started))
            try:
                stdout, stderr = process.communicate(timeout=remaining)
                record.update(stdout=stdout, stderr=stderr, exit_code=process.returncode, timed_out=False)
            except subprocess.TimeoutExpired as error:
                record.update(stdout=decode(error.stdout), stderr=decode(error.stderr), exit_code=None, timed_out=True)
                process.kill()  # Only this disposable local Docker client, never an unowned container.
                stdout, stderr = process.communicate(timeout=10)
                record.update(stdout=stdout, stderr=stderr, exit_code=process.returncode, timed_out=True)
                raise RuntimeError('helper timeout; original stdout/stderr retained') from None
            need(self.created[name]['id'] is not None, 'created container ID was not observed; no inferred cleanup identity')
            need(process.returncode == 0, 'helper failed; original stdout/stderr retained')
            return stdout.strip()
        except Exception as error:
            record['error'] = {'type': type(error).__name__, 'message': str(error)}
            if process is not None and process.poll() is None:
                process.kill()  # Only the local client created by this call.
                try:
                    stdout, stderr = process.communicate(timeout=10)
                    record.update(stdout=stdout, stderr=stderr, exit_code=process.returncode)
                except subprocess.TimeoutExpired as client_error:
                    record.update(stdout=decode(client_error.stdout), stderr=decode(client_error.stderr), client_reap_failed=True)
            raise
        finally:
            record['seconds'] = time.monotonic() - started
            self.records.append(record)
            self.save()

    def create_dummy(self, argv):
        name, options = self.own_options('template')
        identity = self.docker('create', *options, *argv)
        need(ID.fullmatch(identity), 'create did not return an exact container ID')
        self.created[name]['id'] = identity
        self.save()
        return name, identity

    def cleanup(self):
        errors = []
        for name, row in self.created.items():
            identity = row['id']
            if identity is None:
                errors.append(name + ': no exact captured ID; no removal attempted')
                continue
            try:
                ids = self.docker('ps', '-aq', '--no-trunc', '--filter', 'id=' + identity).splitlines()
                need(ids in ([], [identity]), 'ambiguous owned cleanup identity')
                if ids:
                    actual = json.loads(self.docker('inspect', '--format', OWN, identity))
                    need(actual == {'id': identity, 'name': '/' + name, 'lane': self.lane}, 'container ownership changed')
                    self.docker('rm', '-f', '-v', identity)
                row['removed'] = True
            except Exception as error:
                errors.append(name + ': ' + str(error))
        self.save()
        return errors


def decode(value):
    return value.decode(errors='replace') if isinstance(value, bytes) else value or ''


def environment():
    need(sys.platform == 'linux' and os.geteuid() != 0, 'fresh Linux non-root CI job required')
    need(all(os.environ.get(key) == value for key, value in {'RUNNER_ENVIRONMENT': 'github-hosted',
         'RUNNER_OS': 'Linux', 'RUNNER_ARCH': 'X64', 'GITHUB_ACTIONS': 'true'}.items()), 'GitHub-hosted amd64 lane required')
    os_release = Path('/etc/os-release').read_text()
    need('ID=ubuntu\n' in os_release and 'VERSION_ID="24.04"' in os_release, 'Ubuntu 24.04 required')
    need(Path('/usr/bin/docker').is_file(), 'preinstalled Docker required; do not install it')
    sock = Path('/var/run/docker.sock').stat()
    need(stat.S_ISSOCK(sock.st_mode), 'local Unix Docker socket required')
    return os.getuid(), os.getgid(), sock.st_gid


def initialize_command(u, uid, gid):
    return ['run', '--rm', '--pull=never', '--platform', 'linux/amd64', '--init', '--read-only', '--network', 'none',
            '--user', f'{uid}:{gid}', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
            '--tmpfs', '/tmp:rw,nosuid,size=67108864', '--memory', '256m', '--memory-swap', '256m',
            *[item for root in (u.CANONICAL, u.KNOWN_FOREIGN[0], u.STATE)
              for item in ('--mount', f'type=bind,src={root},dst={root}')],
            '--entrypoint', '/opt/trade/.venv/bin/python', IMAGE, '-I', '-B', '-c', INITIALIZE, REVISION]


def fingerprints(u):
    result = {}
    for root in (u.CANONICAL, u.KNOWN_FOREIGN[0], u.STATE):
        metadata = u.metadata_tree(root)
        result[str(root)] = {'metadata': metadata, 'content': u.tree(root, metadata)}
    return result


def cleanup_directories(owned, *, containers_removed, command):
    errors = []
    for text, original in reversed(list(owned.items())):
        path = Path(text)
        try:
            need(containers_removed, 'container cleanup unresolved; retain mounted fixture')
            need(local_identity(path) == original, 'fixture parent identity changed; leave it untouched')
            # The lane owns these contents, but /srv and /var/lib remain root-owned.
            # Ordinary privileges remove contents; privilege is used only for the
            # final empty directory, after rechecking its captured identity.
            for child in path.iterdir():
                if child.is_symlink() or not child.is_dir():
                    child.unlink()
                else:
                    shutil.rmtree(child)
            need(local_identity(path) == original, 'fixture parent identity changed before empty removal')
            need(not any(path.iterdir()), 'fixture parent is not empty; leave it untouched')
            command(['/usr/bin/sudo', '-n', '/usr/bin/rmdir', '--', str(path)])
            need(not os.path.lexists(path), 'empty fixture parent removal was not confirmed')
        except Exception as error:
            errors.append(text + ': ' + str(error))
    return errors


def execute(u, modules, out):
    uid, gid, socket_gid = environment()
    out.mkdir(mode=0o700)  # Never overwrite earlier evidence.
    lane = 'live-upgrade-probe-' + uuid.uuid4().hex
    report = {'lane': lane, 'image': IMAGE, 'revision': REVISION, 'uid': uid, 'gid': gid, 'socket_gid': socket_gid,
              'installer_manifest': MANIFEST, 'bundle': BUNDLE, 'contracts': {}, 'cleanup': [], 'state': 'failed'}
    owned_dirs = {}
    with tempfile.TemporaryDirectory(prefix='docker-probe-empty-config-') as docker_config:
        driver = Driver(out, Path(docker_config), lane)
        try:
            roots = (u.CANONICAL.parent, u.STATE)
            need(all(not os.path.lexists(path) for path in roots), 'fixed fixture path already exists; leave it untouched')
            driver.docker('pull', '--platform', 'linux/amd64', IMAGE, timeout=180)
            image = json.loads(driver.docker('image', 'inspect', '--format', u.IMAGE, IMAGE))
            need(image['id'] == CONFIG and image['architecture'] == 'amd64' and image['os'] == 'linux'
                 and IMAGE in image['digests'] and image['revision'] == REVISION and image['source'] == u.SOURCE,
                 'fixed image provenance differs')
            report['image_identity'] = image
            need(driver.docker('ps', '-aq', '--no-trunc', '--filter', 'label=trade.live.run') == '', 'unexpected native resources')
            for path in roots:
                # mkdir is exclusive; never chown/remove an already-existing path.
                driver.command(['/usr/bin/sudo', '-n', '/usr/bin/mkdir', '-m', '0700', '--', str(path)])
                owned_dirs[str(path)] = local_identity(path)
                driver.command(['/usr/bin/sudo', '-n', '/usr/bin/chown', f'{uid}:{gid}', '--', str(path)])
                need(local_identity(path) == owned_dirs[str(path)], 'allocated directory changed identity')
            for path in (u.CANONICAL, u.KNOWN_FOREIGN[0]):
                path.mkdir(mode=0o700)
            initialized = driver.run(initialize_command(u, uid, gid), 'initialize')
            need(json.loads(initialized) == {'fixture': 'empty-private-roots', 'strategy_executed': False}, 'initializer result differs')
            before = fingerprints(u)
            report['before'] = before
            snapshot = u.STATE / 'live' / REVISION / 'configuration.json'
            web = 'trade-release-web-' + REVISION
            command, template = control_command(u, snapshot, web)
            name, identity = driver.create_dummy(['--pull=never', '--platform', 'linux/amd64', '--read-only',
                '--network', 'none', '--user', f'{uid}:{gid}', '--mount',
                f'type=bind,src={u.CANONICAL},dst={u.CANONICAL},readonly', IMAGE, *command])
            actual = json.loads(driver.docker('inspect', '--format', u.CONTAINERS, identity))
            need(actual['id'] == identity and actual['name'] == '/' + name and actual['image'] == IMAGE
                 and actual['image_id'] == CONFIG and actual['running'] is False and actual['status'] == 'created'
                 and actual['revision'] == REVISION and actual['source'] == u.SOURCE
                 and actual['mounts'] == [{'source': str(u.CANONICAL), 'destination': str(u.CANONICAL), 'rw': False}],
                 'container projection differs from creation facts')
            _, false_template = control_command(u, snapshot, 'trade-release-web-' + 'f' * 40)
            yes = driver.docker('inspect', '--format', template, identity)
            no = driver.docker('inspect', '--format', false_template, identity)
            need((yes, no) == ('true', 'false'), 'control command boolean differs')
            report['contracts']['templates'] = {'container': actual, 'matching': yes, 'different': no}
            baseline = {'root': str(u.CANONICAL), 'web': web, 'service_image': IMAGE, 'socket_gid': socket_gid,
                        'identities': {str(u.CANONICAL): u.identity(u.CANONICAL)},
                        'known_foreign': [str(u.KNOWN_FOREIGN[0])], 'foreign': {str(u.KNOWN_FOREIGN[0]): {
                            'root': u.identity(u.KNOWN_FOREIGN[0]), 'lock': u.identity(u.KNOWN_FOREIGN[0] / 'account.lock')}}}
            system = u.System(baseline, Path(docker_config), modules['release_host.py'])
            need(driver.docker('ps', '-aq', '--no-trunc', '--filter', 'label=trade.live.run') == '', 'unexpected native resources')
            with ExitStack() as locks:
                locks.enter_context(u.original_lock(u.CANONICAL / 'account.lock', u.identity(u.CANONICAL / 'account.lock')))
                result = json.loads(driver.run(system.inspector_command(u.CANONICAL, snapshot), 'canonical'))
                need(result == {'state': 'idle'}, 'canonical inspector did not prove synthetic idle')
                report['contracts']['canonical'] = result
            need(fingerprints(u) == before, 'canonical helper changed fixture originals')
            with u.original_lock(u.KNOWN_FOREIGN[0] / 'account.lock', baseline['foreign'][str(u.KNOWN_FOREIGN[0])]['lock'], shared=True):
                result = json.loads(driver.run(system.foreign_command(u.KNOWN_FOREIGN[0]), 'historical'))
                need(result == {'state': 'idle'}, 'historical reader did not prove synthetic idle')
                report['contracts']['historical'] = result
            report['after'] = fingerprints(u)
            need(report['after'] == before, 'historical helper changed fixture originals')
            report['state'] = 'passed'
        except Exception as error:
            report['failure'] = {'type': type(error).__name__, 'message': str(error)}
        finally:
            report['cleanup'].extend(driver.cleanup())
            report['cleanup'].extend(cleanup_directories(owned_dirs, containers_removed=not report['cleanup'],
                                                         command=driver.command))
            if report['cleanup']:
                report['state'] = 'failed'
            (out / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
    need(report['state'] == 'passed', 'probe failed; review retained result and raw command output')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    u, modules = load_installer()
    compile(INITIALIZE, '<image-only-initializer>', 'exec')
    if not args.execute:
        print(json.dumps({'state': 'offline-inputs-verified', 'docker_executed': False, 'contracts': 3}))
        return
    need(args.out is not None, 'execution requires a new artifact directory')
    result = execute(u, modules, args.out.absolute())
    print(json.dumps({'state': result['state'], 'artifact': str(args.out.absolute())}))


if __name__ == '__main__':
    main()
