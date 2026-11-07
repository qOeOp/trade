#!/usr/bin/env python3
"""One-shot existing-host package upgrade. Default verifies only the inert bundle.

No transport, install framework, credential reads or product state repair. A reviewed
fresh baseline and separate host authority are required before --install is used.
"""
import argparse
import base64
from contextlib import ExitStack, contextmanager
import ctypes
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time
import types
import uuid

sys.dont_write_bytecode = True
MODULES = ('__init__.py', 'runtime_inputs.py', 'release_host.py', 'live_host.py',
           'live_configuration.py', 'paper_host.py', 'paper_release.py', 'release.py')
STATE = Path('/var/lib/trade-release')
CODE = Path('/opt/trade-release/deploy')
DECLARATION = STATE / 'live/configuration.json'
CANONICAL = Path('/srv/trade-private/live')
KNOWN_FOREIGN = (Path('/srv/trade-private/live-acceptance'),)
OBSERVER_IMAGE = 'ghcr.io/qoeop/trade-service@sha256:abc97078d42fd5b7c2c7a268832474e0462bf1a55b8cbedf2d22d3a73dd849f9'
OBSERVER_REVISION = 'e81fd3ad17f80eb584927f54c0c608d7247b9e39'
SOURCE = 'https://github.com/qOeOp/trade'
REVISION = 'd6afd290126830cbaac5e827b2b72f73c8711d24'
UNITS = ('trade-release.timer', 'trade-release.service')
STATIC = ('FragmentPath', 'DropInPaths', 'PartOf', 'BindsTo', 'PropagatesStopTo', 'Triggers', 'TriggeredBy',
          'User', 'Group', 'ReadWritePaths', 'ProtectHome', 'ProtectSystem', 'InaccessiblePaths')
DYNAMIC = ('ActiveState', 'SubState', 'MainPID', 'ControlPID', 'Job', 'UnitFileState')
HEX = re.compile(r'[0-9a-f]{40}\Z')
SERVICE = re.compile(r'ghcr\.io/qoeop/trade-service@sha256:[0-9a-f]{64}\Z')


def need(condition, message):
    if not condition:
        raise RuntimeError(message)


def pairs(items):
    result = {}
    for name, value in items:
        need(name not in result, 'duplicate JSON field')
        result[name] = value
    return result


def read(path, expected=None):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        need(stat.S_ISREG(info.st_mode), 'nonregular reviewed file')
        if expected is not None:
            need((info.st_dev, info.st_ino, stat.S_IMODE(info.st_mode), info.st_uid, info.st_gid)
                 == tuple(expected[key] for key in ('dev', 'ino', 'mode', 'uid', 'gid')),
                 'reviewed file changed before content read')
        return stream.read()


def obj(path):
    value = json.loads(read(path), object_pairs_hook=pairs)
    need(isinstance(value, dict), 'expected JSON object')
    return value


def identity(path, *, contents=False):
    value = path.lstat()
    need(stat.S_ISREG(value.st_mode) or stat.S_ISDIR(value.st_mode) or stat.S_ISSOCK(value.st_mode),
         'unsupported filesystem object')
    result = {'kind': 'directory' if stat.S_ISDIR(value.st_mode) else 'file' if stat.S_ISREG(value.st_mode) else 'socket',
              'mode': stat.S_IMODE(value.st_mode), 'uid': value.st_uid, 'gid': value.st_gid,
              'dev': value.st_dev, 'ino': value.st_ino}
    if contents:
        data = read(path, expected=result)
        result.update(size=len(data), sha256=hashlib.sha256(data).hexdigest())
    return result


def metadata_tree(root):
    """Enumerate identities only. Never read a discovered file's contents."""
    result = {}
    for path in [root, *sorted(root.rglob('*'))]:
        row = identity(path)
        need(row['kind'] in {'file', 'directory'}, 'unsupported package entry')
        result['.' if path == root else str(path.relative_to(root))] = row
    return result


def tree(root, reviewed):
    """Validate the entire finite metadata set before reading only reviewed files."""
    names = metadata_tree(root)
    fields = ('kind', 'mode', 'uid', 'gid')
    need(set(names) == set(reviewed), 'package path set differs from reviewed inventory')
    need(all(all(row[key] == reviewed[name][key] for key in fields) for name, row in names.items()),
         'package type or ownership differs from reviewed inventory')
    need(all(all(row[key] == reviewed[name][key] for key in ('dev', 'ino') if key in reviewed[name])
             for name, row in names.items()), 'package original identity differs from reviewed inventory')
    result = {}
    for name, row in names.items():
        result[name] = {key: row[key] for key in fields}
        if row['kind'] == 'file':
            data = read(root / name, expected=row)
            result[name].update(size=len(data), sha256=hashlib.sha256(data).hexdigest())
    need(metadata_tree(root) == names, 'package identities changed while reading reviewed files')
    return result


def sync(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def new_file(path, data, mode=0o600):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(descriptor, 'wb') as stream:
        os.fchmod(stream.fileno(), mode)
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def bundle(path, expected=None):
    data = read(path)
    if expected is not None:
        need(hashlib.sha256(data).hexdigest() == expected, 'bundle changed after review')
    value = json.loads(data, object_pairs_hook=pairs)
    need(set(value) == {'format', 'revision', 'parents', 'order', 'modules'}
         and value['format'] == 'reviewed-live-host-upgrade-bundle-v1' and value['revision'] == REVISION
         and value['order'] == 'host-before-product-merges' and set(value['modules']) == set(MODULES), 'unreviewed bundle')
    decoded = {}
    for name, row in value['modules'].items():
        need(set(row) == {'git_blob', 'sha256', 'bytes'} and HEX.fullmatch(row['git_blob']), 'invalid module identity')
        content = base64.b64decode(row['bytes'], validate=True)
        need(hashlib.sha256(content).hexdigest() == row['sha256'], 'module hash mismatch')
        need(hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest() == row['git_blob'],
             'module Git blob mismatch')
        compile(content, 'reviewed/' + name, 'exec')
        decoded[name] = content
    return value, decoded


def atomic_exchange(left, right):
    need(left.parent == right.parent, 'exchange requires one reviewed parent')
    library = ctypes.CDLL(None, use_errno=True)
    rename = library.renameat2
    rename.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(left), -100, os.fsencode(right), 2):
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))
    sync(left.parent)  # A failure here does NOT imply that rename failed.


class Package:
    def __init__(self, code, stage, expected, modules, exchange=atomic_exchange):
        need(code.parent == stage.parent, 'staging and backup must share installed parent')
        self.code, self.stage, self.old, self.modules, self.exchange = code, stage, expected, modules, exchange
        self.old_id, self.new_id, self.new = identity(code), None, None
        need(self.old_id['kind'] == 'directory', 'package is not a directory')
        need(set(modules) == set(MODULES), 'all eight modules are required')

    def prepare(self):
        originals = metadata_tree(self.code)
        need(tree(self.code, self.old) == self.old, 'installed tree differs from reviewed inventory')
        need(metadata_tree(self.code) == originals, 'installed identities changed before staging')
        self.stage.mkdir(mode=0o700)  # Unique and absent; never reuse a backup.
        for name, row in sorted(self.old.items(), key=lambda item: (len(Path(item[0]).parts), item[0])):
            if name == '.' or '__pycache__' in Path(name).parts or name in MODULES:
                continue
            target = self.stage / name
            if row['kind'] == 'directory':
                target.mkdir(mode=row['mode'])
            else:
                new_file(target, read(self.code / name, expected=originals[name]), row['mode'])
            os.chown(target, row['uid'], row['gid'])
            os.chmod(target, row['mode'])
        for name, content in self.modules.items():
            new_file(self.stage / name, content, 0o644)
            os.chown(self.stage / name, self.old_id['uid'], self.old_id['gid'])
        os.chown(self.stage, self.old_id['uid'], self.old_id['gid'])
        os.chmod(self.stage, self.old_id['mode'])
        for path in reversed([self.stage, *sorted(p for p in self.stage.rglob('*') if p.is_dir())]):
            sync(path)
        sync(self.stage.parent)
        new_expected = {name: row.copy() for name, row in self.old.items()
                        if '__pycache__' not in Path(name).parts}
        for name, data in self.modules.items():
            new_expected[name] = {'kind': 'file', 'mode': 0o644, 'uid': self.old_id['uid'],
                                  'gid': self.old_id['gid'], 'size': len(data),
                                  'sha256': hashlib.sha256(data).hexdigest()}
        self.new_id, self.new = identity(self.stage), tree(self.stage, new_expected)
        need(self.new == new_expected, 'staged tree differs from reviewed construction')
        need(self.new_id['dev'] == self.old_id['dev'], 'different exchange devices')
        self.check(False)

    def selected(self):
        actual = identity(self.code), identity(self.stage)
        if actual == (self.old_id, self.new_id):
            return False
        if actual == (self.new_id, self.old_id):
            return True
        raise RuntimeError('package identities are neither original nor exchanged')

    def check(self, selected):
        need(self.selected() is selected, 'wrong selected package')
        left, right = (self.new, self.old) if selected else (self.old, self.new)
        need(tree(self.code, left) == left and tree(self.stage, right) == right, 'package bytes or permissions drifted')

    def switch(self):
        self.check(False)
        self.exchange(self.code, self.stage)
        self.check(True)

    def restore(self):
        self.check(True)
        try:
            self.exchange(self.code, self.stage)
        except Exception:
            self.check(False)  # A successful rename plus failed fsync is still classified by facts.
            raise
        self.check(False)


class Window:
    def __init__(self, system, original, clock=time.monotonic, sleep=time.sleep):
        self.system, self.original, self.clock, self.sleep = system, original, clock, sleep
        self.paused = False
        self.handed_off = False

    def static(self):
        return {unit: {key: row[key] for key in STATIC} for unit, row in self.system.units().items()}

    def quiet(self):
        values = self.system.units()
        timer, service = (values[name] for name in UNITS)
        return (timer['ActiveState'] == 'inactive' and timer['UnitFileState'] == 'enabled'
                and service['ActiveState'] in {'inactive', 'failed'} and service['SubState'] in {'dead', 'failed'}
                and all(values[unit].get(key, '') in {'', '0'} for unit in UNITS for key in ('MainPID', 'ControlPID', 'Job'))
                and not self.system.jobs() and not self.system.consumers())

    def pause(self, timeout=4500):
        need(self.system.units() == self.original, 'unit baseline changed')
        timer = self.original[UNITS[0]]
        need(timer['ActiveState'] == 'active' and timer['UnitFileState'] == 'enabled', 'expected enabled active timer')
        for unit, row in self.original.items():
            need(row['FragmentPath'] == '/etc/systemd/system/' + unit and not any(
                row[key] for key in ('DropInPaths', 'PartOf', 'BindsTo', 'PropagatesStopTo')), 'unreviewed stop relationships')
        need(timer['Triggers'] == UNITS[1] and self.original[UNITS[1]]['TriggeredBy'] == UNITS[0], 'unreviewed triggers')
        self.paused = True
        self.system.timer('stop')
        deadline = self.clock() + timeout
        while not self.quiet():
            need(self.clock() < deadline, 'natural release drain timed out; no process was killed')
            self.sleep(.25)
        self.check()

    def check(self):
        need(self.paused and not self.handed_off and self.quiet(), 'release window is no longer quiescent')
        need(self.static() == {unit: {key: row[key] for key in STATIC} for unit, row in self.original.items()},
             'unit configuration changed')

    def resume(self):
        self.check()
        self.handed_off = True  # No rollback once trigger restoration can hand off to a release process.
        self.system.timer('start')
        timer = self.system.units()[UNITS[0]]
        need(timer['ActiveState'] == 'active' and timer['UnitFileState'] == 'enabled', 'timer restoration unverified')


@contextmanager
def original_lock(path, expected, *, shared=False):
    need(identity(path) == expected and expected['kind'] == 'file', 'original lock changed')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(descriptor)
        need((info.st_dev, info.st_ino) == (expected['dev'], expected['ino']), 'opened a different lock')
        fcntl.flock(descriptor, (fcntl.LOCK_SH if shared else fcntl.LOCK_EX) | fcntl.LOCK_NB)
        need(identity(path) == expected, 'lock changed during acquisition')
        yield
        need(identity(path) == expected, 'lock changed while held')
    finally:
        os.close(descriptor)


COLD = """import hashlib,importlib,importlib.abc,importlib.util,json,pathlib,sys
code=pathlib.Path(sys.argv[1]);expected=json.loads(sys.argv[2])
files={('deploy' if f=='__init__.py' else 'deploy.'+f[:-3]):f for f in expected}
class Source(importlib.abc.SourceLoader):
 def __init__(self,name):self.name=name
 def get_filename(self,name):return str(code/files[name])
 def get_data(self,path):return pathlib.Path(path).read_bytes()
 def get_code(self,name):
  data=self.get_data(self.get_filename(name))
  assert hashlib.sha256(data).hexdigest()==expected[files[name]],name
  return compile(data,self.get_filename(name),'exec')
 def is_package(self,name):return name=='deploy'
class Reviewed(importlib.abc.MetaPathFinder):
 def find_spec(self,name,path=None,target=None):
  if name in files:return importlib.util.spec_from_file_location(name,code/files[name],loader=Source(name),
   submodule_search_locations=[str(code)] if name=='deploy' else None)
  if name.startswith('deploy.'):raise ImportError('unreviewed host module')
sys.meta_path.insert(0,Reviewed())
for name,filename in files.items():
 module=importlib.import_module(name);actual=pathlib.Path(module.__file__).resolve()
 assert actual==code/filename,(name,str(actual))
 assert hashlib.sha256(actual.read_bytes()).hexdigest()==expected[filename],filename
if len(sys.argv)>3:
 from deploy import live_configuration
 declaration=live_configuration.declaration(pathlib.Path(sys.argv[3]))
 path=pathlib.Path(sys.argv[4]);snapshot=live_configuration.snapshot(path,path.parent/'socket/control.sock')
 assert all(declaration[k]==snapshot[k] for k in live_configuration.OPERATOR_FIELDS)
print('reviewed-imports-ok')
"""


def cold(code, modules, declaration, snapshot, runner=subprocess.run):
    hashes = {name: hashlib.sha256(content).hexdigest() for name, content in modules.items()}
    result = runner(['/usr/bin/python3', '-I', '-B', '-c', COLD, str(code), json.dumps(hashes), str(declaration), str(snapshot)],
                    cwd='/tmp', env={'PATH': os.defpath}, capture_output=True, text=True, check=True, timeout=30)
    need(result.stdout.strip() == 'reviewed-imports-ok', 'cold package import was not confirmed')


# Production adapters are deliberately separate from the tested finite transaction below.
# They are filled only with reviewed, credential-free observations; no product lifecycle is reimplemented.
class Upgrade:
    def __init__(self, code, state, baseline, modules, system, *, exchange=atomic_exchange, import_check=cold):
        self.code, self.state, self.baseline, self.modules, self.system = code, state, baseline, modules, system
        self.exchange, self.import_check = exchange, import_check
        self.root = Path(baseline['root'])
        self.declaration = state / 'live/configuration.json'
        self.snapshot = state / 'live' / baseline['web'].removeprefix('trade-release-web-') / 'configuration.json'
        self.window = Window(system, baseline['units'])
        self.package = None
        self.locks_held = False
        self.safe_resume = False
        self.foreign_locks_held = False

    def protected(self):
        def originals():
            for path, expected in self.baseline['identities'].items():
                need(identity(Path(path), contents='sha256' in expected) == expected, 'protected identity changed')
            need(not any(os.path.lexists(self.state / name) for name in ('transaction.json', 'paper-transaction.json')),
                 'retained transaction exists')
            if self.package is None or self.package.new_id is None:
                need(identity(self.code) == self.baseline['deploy_identity'], 'installed package directory changed')
            else:
                self.package.check(self.package.selected())
        self.window.check()
        originals()
        observed = self.system.observe()
        need(observed == self.baseline['observations'], 'routes, pair, candidates or protected objects changed')
        for row in observed['containers'].values():
            need(not row.get('run') and not row.get('role') and not row['name'].startswith('/trade-live-')
                 and not any(item['destination'] == '/reports' and any(
                     item['source'].startswith(root + '/runs/') for root in [str(self.root), *self.baseline['known_foreign']])
                     for item in row.get('mounts', [])), 'retained native Live resources require original owner cleanup')
        self.window.check()
        # Recheck filesystem identities AND absent transactions after the last external read.
        originals()

    def closure(self):
        self.protected()
        for root in self.baseline['known_foreign']:
            path = Path(root)
            expected = self.baseline['foreign'][root]
            need(identity(path) == expected['root'] and identity(path / 'account.lock') == expected['lock'], 'foreign identity changed')
            need(self.foreign_locks_held, 'historical observation requires original foreign shared locks')
            need(self.system.foreign_observation(path) == expected['observation'] == {'state': 'idle'},
                 'known foreign closure is not independently proved idle')
            need(identity(path) == expected['root'] and identity(path / 'account.lock') == expected['lock'],
                 'foreign identity changed after observation')
        need(self.system.inspector(self.root, self.snapshot) == {'state': 'idle'}, 'canonical inspector did not prove idle')
        self.protected()

    def rollback(self):
        need(self.locks_held and not self.window.handed_off, 'automatic rollback after handoff is forbidden')
        self.closure()
        if self.package is not None and self.package.new_id is not None:
            if self.package.selected():
                self.package.restore()
            self.package.check(False)
        else:
            need(identity(self.code) == self.baseline['deploy_identity']
                 and tree(self.code, self.baseline['deploy_tree']) == self.baseline['deploy_tree'], 'original package no longer complete')
        self.system.cold_original(self.code, self.baseline['deploy_tree'])
        self.closure()
        self.safe_resume = True

    def run(self):
        self.window.pause()
        failed = None
        with ExitStack() as locks:
            locks.enter_context(original_lock(self.state / 'lock', self.baseline['identities'][str(self.state / 'lock')]))
            locks.enter_context(original_lock(self.root / 'account.lock', self.baseline['identities'][str(self.root / 'account.lock')]))
            for root in self.baseline['known_foreign']:
                expected = self.baseline['foreign'][root]
                need(identity(Path(root)) == expected['root'], 'foreign root replaced')
                locks.enter_context(original_lock(Path(root) / 'account.lock', expected['lock'], shared=True))
            self.foreign_locks_held = self.locks_held = True
            try:
                self.closure()
                stage = self.code.parent / ('.deploy-upgrade-' + uuid.uuid4().hex)
                self.package = Package(self.code, stage, self.baseline['deploy_tree'], self.modules, self.exchange)
                need(self.package.old_id == self.baseline['deploy_identity'], 'package changed before staging')
                self.package.prepare()
                self.import_check(stage, self.modules, self.declaration, self.snapshot)
                self.closure()
                self.package.switch()
                self.import_check(self.code, self.modules, self.declaration, self.snapshot)
                self.package.check(True)
                self.closure()
                self.safe_resume = True
            except Exception as error:
                # Recovery stays in this same invocation and original locks. Whether rename
                # happened is determined from both directory identities and complete hashes.
                self.rollback()
                failed = error
            finally:
                self.foreign_locks_held = self.locks_held = False
        if self.safe_resume:
            self.window.resume()
        if failed is not None:
            raise RuntimeError('upgrade failed; original package was proved restored and original timer resumed') from failed
        return {'state': 'host-package-upgraded', 'retained_original': str(self.package.stage),
                'new_service_published': False}


CONTAINERS = ('{"id":{{json .Id}},"name":{{json .Name}},"image_id":{{json .Image}},'
              '"image":{{json .Config.Image}},"running":{{json .State.Running}},'
              '"status":{{json .State.Status}},"started":{{json .State.StartedAt}},'
              '"restarts":{{json .RestartCount}},"revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}},'
              '"source":{{json (index .Config.Labels "org.opencontainers.image.source")}},'
              '"run":{{json (index .Config.Labels "trade.live.run")}},'
              '"role":{{json (index .Config.Labels "trade.live.role")}},'
              '"mounts":[{{range $i,$m:=.Mounts}}{{if $i}},{{end}}'
              '{"source":{{json $m.Source}},"destination":{{json $m.Destination}},"rw":{{json $m.RW}}}{{end}}]}')
IMAGE = ('{"id":{{json .Id}},"architecture":{{json .Architecture}},"os":{{json .Os}},'
         '"digests":{{json .RepoDigests}},"revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}},'
         '"source":{{json (index .Config.Labels "org.opencontainers.image.source")}}}')


class System:
    """Reviewed fixed commands only. Constructed only for a later authorized host operation."""
    def __init__(self, baseline, docker_config, owner_code):
        self.baseline, self.docker_config = baseline, docker_config
        # Trusted frozen bundle source only; no installed-package/cwd import or copied getter.
        name = '_reviewed_release_host_' + hashlib.sha256(owner_code).hexdigest()
        owner = types.ModuleType(name)
        sys.modules[name] = owner  # dataclass requires its defining module during execution.
        try:
            exec(compile(owner_code, '<reviewed-bundle/release_host.py>', 'exec'), owner.__dict__)
        finally:
            del sys.modules[name]
        self.owner = owner

    def agent(self, containers):
        owner = self.owner
        names = {row['name'].removeprefix('/'): row for row in containers.values()}
        need(len(names) == len(containers), 'duplicate observed container names')

        class ObservedHost(owner.DockerHost):
            def __init__(self):
                pass

            def docker(self, *args, **kwargs):
                if args in {('ps', '--format', '{{.Names}}'), ('ps', '-a', '--format', '{{.Names}}')}:
                    return '\n'.join(name for name, row in names.items() if '-a' in args or row['running'])
                if len(args) == 4 and args[:2] == ('inspect', '--format'):
                    return json.dumps(names[args[-1]])
                raise RuntimeError('unreviewed Agent observation command')

        actual = ObservedHost().agent()
        need(actual is not None, 'original standalone Agent is missing')
        row = names[actual]
        need(row['running'] is True and row['source'] == SOURCE, 'original standalone Agent provenance differs')
        return actual

    @staticmethod
    def command(argv, timeout=30):
        env = {'PATH': os.defpath, 'LC_ALL': 'C', 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1',
               'GIT_TERMINAL_PROMPT': '0', 'GIT_ASKPASS': '/bin/false'}
        result = subprocess.run(argv, env=env, capture_output=True, text=True, timeout=timeout, check=False)
        need(result.returncode == 0, 'external command failed; no automatic retry')
        return result.stdout.strip()

    def docker(self, *args, timeout=30):
        return self.command(['/usr/bin/docker', '--config', str(self.docker_config), '--host',
                             'unix:///var/run/docker.sock', *map(str, args)], timeout)

    def units(self):
        return {unit: dict(row.split('=', 1) for row in self.command(
            ['/usr/bin/systemctl', 'show', unit, *('--property=' + key for key in (*STATIC, *DYNAMIC))]).splitlines())
                for unit in UNITS}

    def jobs(self):
        rows = self.command(['/usr/bin/systemctl', 'list-jobs', '--no-legend', '--no-pager', '--plain']).splitlines()
        return [row for row in rows if set(UNITS) & set(row.split())]

    def consumers(self):
        # pgrep emits PIDs only: never capture arbitrary process argv or environment.
        command = ['/usr/bin/pgrep', '-f', r'(^|/)(python[0-9.]*).* (-m deploy\.(release|paper_release)( |$)|[^ ]*live-web-host-install/install.py|[^ ]*live-authority-host-upgrade/implementation(-v[0-9]+)?/upgrade.py)']
        result = subprocess.run(command, env={'PATH': os.defpath}, capture_output=True, text=True, timeout=10, check=False)
        need(result.returncode in {0, 1}, 'cannot observe additional host-package consumers')
        return [pid for pid in result.stdout.splitlines() if pid != str(os.getpid())]

    def timer(self, action):
        need(action in {'stop', 'start'}, 'unsupported timer operation')
        return self.command(['/usr/bin/systemctl', action, UNITS[0]], 30)

    def observe(self):
        refs = self.command(['/usr/bin/git', '-c', 'credential.helper=', 'ls-remote',
                             'https://github.com/qOeOp/trade.git', 'refs/heads/main', 'refs/heads/deploy-ready'], 60)
        ids = self.docker('ps', '-aq', '--no-trunc').splitlines()
        need(len(ids) == len(set(ids)) and all(re.fullmatch(r'[0-9a-f]{64}', item) for item in ids), 'ambiguous container list')
        containers = {item: json.loads(self.docker('inspect', '--format', CONTAINERS, item)) for item in sorted(ids)}
        routes = {}
        for router, endpoint in self.baseline['routers'].items():
            # Fixed Caddy config subresource: upstreams only, not cookies/headers or general config.
            need(router in {'trade-ide-ide-router-1', 'trade-ide-paper-router-1'} and endpoint in {'ide', 'paper'},
                 'unreviewed router observation')
            routes[router] = json.loads(self.docker('exec', router, 'wget', '-qO-',
                'http://127.0.0.1:2019/config/apps/http/servers/' + endpoint + '/routes/0/handle/0/upstreams/'))
        service = self.baseline['service_image']
        need(SERVICE.fullmatch(service), 'inspector must use the reviewed immutable service digest')
        observer = json.loads(self.docker('image', 'inspect', '--format', IMAGE, OBSERVER_IMAGE))
        need(observer['architecture'] == 'amd64' and observer['os'] == 'linux'
             and OBSERVER_IMAGE in observer['digests'] and observer['revision'] == OBSERVER_REVISION
             and observer['source'] == SOURCE, 'reviewed observer image provenance differs')
        current = json.loads(self.docker('image', 'inspect', '--format', IMAGE, service))
        sha = self.baseline['web'].removeprefix('trade-release-web-')
        names = {row['name'].removeprefix('/'): row for row in containers.values()}
        control = 'trade-release-live-' + sha
        self.agent(containers)  # Actual standalone owner can retain a revision older than Web.
        for name in (self.baseline['web'], control):
            row = names.get(name)
            need(row is not None and row['running'] is True and row['revision'] == sha and row['source'] == SOURCE,
                 'current Web/control identity differs')
        need(names[control]['image'] == service and service in current['digests']
             and current['architecture'] == 'amd64' and current['os'] == 'linux'
             and current['revision'] == sha and current['source'] == SOURCE, 'selected service provenance differs')
        snapshot = STATE / 'live' / sha / 'configuration.json'
        expected_command = ['python', '-m', 'cli.main', 'live', 'serve', '--configuration', str(snapshot),
                            '--release-state', str(STATE), '--release-web', self.baseline['web']]
        template = '{{eq (json .Config.Cmd) ' + json.dumps(json.dumps(expected_command, separators=(',', ':'))) + '}}'
        need(self.docker('inspect', '--format', template, names[control]['id']) == 'true', 'control command differs')
        mounts = {row['destination']: (row['source'], row['rw']) for row in names[control]['mounts']}
        for path, writable in ((self.baseline['root'], True), (str(STATE), False), (str(snapshot.parent / 'socket'), True)):
            need(mounts.get(path) == (path, writable), 'control mount differs from original snapshot')
        for router, endpoint in self.baseline['routers'].items():
            disk = obj(STATE / ('router' if endpoint == 'ide' else 'paper-router') / 'active.json')
            upstreams = disk['apps']['http']['servers'][endpoint]['routes'][0]['handle'][0]['upstreams']
            need(routes[router] == upstreams, 'disk and loaded route differ')
        need(routes['trade-ide-ide-router-1'] == [{'dial': self.baseline['web'] + ':8765'}], 'selected Web route differs')
        return {'public_refs': sorted(refs.splitlines()), 'containers': containers, 'routes': routes,
                'service': current, 'observer': observer}

    def inspector_command(self, root, snapshot):
        need(root == Path(self.baseline['root']) and snapshot == STATE / 'live' / self.baseline['web'].removeprefix(
            'trade-release-web-') / 'configuration.json', 'inspector needs the real selected snapshot')
        return ['run', '--rm', '--pull=never', '--platform', 'linux/amd64', '--init', '--read-only', '--network', 'none', '--user', f"{self.baseline['identities'][str(root)]['uid']}:{self.baseline['identities'][str(root)]['gid']}",
                '--group-add', str(self.baseline['socket_gid']), '--cap-drop', 'ALL', '--cap-add', 'DAC_READ_SEARCH', '--security-opt', 'no-new-privileges:true',
                '--tmpfs', '/tmp:rw,nosuid,size=67108864', '--memory', '256m', '--memory-swap', '256m',
                '--env', 'HOME=/tmp', '--env', 'DOCKER_CONFIG=/tmp/docker-public', '--env', 'DOCKER_HOST=unix:///var/run/docker.sock',
                '--mount', 'type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock,readonly',
                '--mount', f'type=bind,src={root},dst={root},readonly',
                '--mount', f'type=bind,src={STATE},dst={STATE},readonly',
                '--entrypoint', '/opt/trade/.venv/bin/python', self.baseline['service_image'], '-I', '-B', '-m', 'cli.main', 'live', 'release-inspect',
                '--configuration', str(snapshot)]

    def inspector(self, root, snapshot):
        return json.loads(self.docker(*self.inspector_command(root, snapshot), timeout=180))

    def foreign_command(self, root):
        need(str(root) in self.baseline['known_foreign'], 'root was not explicitly reviewed for historical observation')
        original = self.baseline['foreign'][str(root)]['root']
        image = OBSERVER_IMAGE
        need(root in KNOWN_FOREIGN, 'unreviewed historical root')
        script = ("import json,sys;from pathlib import Path;sys.path.insert(0,'/opt/trade');"
                  "from live.release import idle_locked;"
                  "print(json.dumps({'state':idle_locked(Path(sys.argv[1]))}))")
        return ['run', '--rm', '--pull=never', '--platform', 'linux/amd64', '--init', '--read-only', '--network', 'none',
                '--user', f"{original['uid']}:{original['gid']}", '--group-add', str(self.baseline['socket_gid']),
                '--cap-drop', 'ALL', '--cap-add', 'DAC_READ_SEARCH', '--security-opt', 'no-new-privileges:true',
                '--tmpfs', '/tmp:rw,nosuid,size=67108864', '--memory', '256m', '--memory-swap', '256m',
                '--env', 'HOME=/tmp', '--env', 'DOCKER_CONFIG=/tmp/docker-public', '--env', 'DOCKER_HOST=unix:///var/run/docker.sock',
                '--mount', 'type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock,readonly',
                '--mount', f'type=bind,src={root},dst={root},readonly',
                '--entrypoint', '/opt/trade/.venv/bin/python', image, '-I', '-B', '-c', script, str(root)]

    def foreign_observation(self, root):
        return json.loads(self.docker(*self.foreign_command(root), timeout=180))

    def cold_original(self, code, expected):
        modules = {name: read(code / name) for name in MODULES if name in expected}
        hashes = {name: hashlib.sha256(content).hexdigest() for name, content in modules.items()}
        need(len(modules) in {7, 8}, 'unknown original host package')
        result = subprocess.run(['/usr/bin/python3', '-I', '-B', '-c', COLD, str(code), json.dumps(hashes)],
                                cwd='/tmp', env={'PATH': os.defpath}, capture_output=True, text=True, check=True, timeout=30)
        need(result.stdout.strip() == 'reviewed-imports-ok', 'original imports unverified')


def read_baseline(path, digest, bundle_digest):
    data = read(path)
    need(hashlib.sha256(data).hexdigest() == digest, 'baseline differs from reviewed bytes')
    value = json.loads(data, object_pairs_hook=pairs)
    need(value.get('format') == 'reviewed-existing-live-host-upgrade-v1'
         and value.get('bundle_sha256') == bundle_digest
         and value.get('window') == 'no-new-live-or-manual-host-package-consumers;three-product-prs-unmerged',
         'a concrete reviewed baseline and coordinated pre-merge window are required')
    required = {'format', 'bundle_sha256', 'window', 'root', 'web', 'service_image', 'routers', 'units',
                'identities', 'deploy_identity', 'deploy_tree', 'observations', 'known_foreign', 'foreign', 'socket_gid'}
    need(set(value) == required, 'baseline schema is incomplete')
    root = Path(value['root'])
    need(root == CANONICAL and root.resolve() == root, 'noncanonical existing root')
    need(re.fullmatch(r'trade-release-web-[0-9a-f]{40}', value['web']), 'unknown current Web')
    snapshot = STATE / 'live' / value['web'].removeprefix('trade-release-web-') / 'configuration.json'
    minimum = {str(CODE.parent), str(STATE), str(STATE / 'lock'), str(root), str(root / 'account.lock'),
               str(DECLARATION), str(snapshot), str(STATE / 'router/active.json')}
    minimum |= {str(path) for root in KNOWN_FOREIGN for path in (root, root / 'account.lock')}
    minimum |= {'/var/run/docker.sock', *('/etc/systemd/system/' + unit for unit in UNITS)}
    need(minimum <= set(value['identities']) and str(CODE) not in value['identities'], 'required originals are not bound')
    for text, expected in value['identities'].items():
        path = Path(text)
        extra_metadata = (re.fullmatch(r'live/[0-9a-f]{40}/configuration.json', str(path.relative_to(STATE)))
                          or re.fullmatch(r'(failed|paper-failed)/[0-9a-f]{40}', str(path.relative_to(STATE)))) if path.is_relative_to(STATE) else False
        need(text in minimum or text == str(STATE / 'paper-router/active.json') or extra_metadata,
             'baseline must not name arbitrary files or credentials')
        fields = {'kind', 'mode', 'uid', 'gid', 'dev', 'ino'}
        need(fields <= set(expected), 'original identity fields are incomplete')
        if expected['kind'] == 'file' and path.name not in {'account.lock', 'lock'}:
            need({'size', 'sha256'} <= set(expected) and isinstance(expected['size'], int)
                 and expected['size'] >= 0 and re.fullmatch(r'[0-9a-f]{64}', expected['sha256']),
                 'reviewed metadata file requires its complete content fingerprint')
        if text in {str(root) for root in (CANONICAL, *KNOWN_FOREIGN)}:
            need(path.resolve() == path and expected['kind'] == 'directory' and not expected['mode'] & 0o077,
                 'custody root is not the original private canonical directory')
        if path.name in {'account.lock', 'lock'}:
            need(expected['kind'] == 'file' and not expected['mode'] & 0o077 and 'sha256' not in expected,
                 'lock is not original private regular metadata')
    need(set(value['known_foreign']) == {str(path) for path in KNOWN_FOREIGN}
         and set(value['known_foreign']) == set(value['foreign'])
         and len(value['known_foreign']) == len(set(value['known_foreign'])), 'complete reviewed foreign-root set required')
    for path in (CANONICAL, *KNOWN_FOREIGN):
        need(value['identities'][str(path / 'account.lock')]['uid'] == value['identities'][str(path)]['uid'],
             'account lock owner differs from original root')
    need(all(value['identities'][str(path)]['uid'] == 0 for path in (CODE.parent, STATE, STATE / 'lock')),
         'host release originals must remain root-owned')
    need(value['socket_gid'] == value['identities']['/var/run/docker.sock']['gid'], 'socket group changed')
    need(identity(CODE) == value['deploy_identity'] and value['deploy_identity']['uid'] == 0,
         'existing host package identity changed')
    need(all(row['uid'] == 0 and row['mode'] == 0o644 for name, row in value['deploy_tree'].items()
             if name in MODULES), 'original host modules need reviewed root-owned 0644 mode')
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--bundle-sha256', required=True)
    parser.add_argument('--install', action='store_true')
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--baseline-sha256')
    args = parser.parse_args()
    value, modules = bundle(args.bundle, args.bundle_sha256)
    if not args.install:
        print(json.dumps({'state': 'inert-bundle-verified', 'revision': value['revision'], 'host_observation': False}))
        return
    need(sys.platform == 'linux' and os.geteuid() == 0, 'requires the reviewed Linux administrator')
    need(args.baseline is not None and args.baseline_sha256, 'install requires reviewed fresh baseline bytes')
    baseline = read_baseline(args.baseline, args.baseline_sha256, args.bundle_sha256)
    with tempfile.TemporaryDirectory(prefix='reviewed-host-upgrade-') as temporary:
        system = System(baseline, Path(temporary), modules['release_host.py'])
        print(json.dumps(Upgrade(CODE, STATE, baseline, modules, system).run()))


if __name__ == '__main__':
    main()
