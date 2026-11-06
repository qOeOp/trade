"""A real process signal reaches Paper's drain request, and the caller's mask is restored."""
import subprocess
import sys
import unittest


class SignalTests(unittest.TestCase):
    def test_sigterm_is_consumed_without_invoking_an_owned_node_handler(self):
        program = '''
import os, signal, threading
from engine.paper_signals import Signals
seen=[]
ready=threading.Event()
def requested(name):
    seen.append(name)
    ready.set()
original=signal.pthread_sigmask(signal.SIG_BLOCK, [])
with Signals(requested):
    # Models the native run() replacing the ordinary Python handler.
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(AssertionError('native handler ran')))
    os.kill(os.getpid(), signal.SIGTERM)
    assert ready.wait(3), 'Paper did not receive SIGTERM'
assert seen==['SIGTERM'], seen
assert signal.pthread_sigmask(signal.SIG_BLOCK, [])==original
'''
        result = subprocess.run([sys.executable, "-c", program], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
