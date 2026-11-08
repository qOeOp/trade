"""UTC DATETIME age must not change Paper lifecycle timing with the host time zone."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import unittest


PROBE = '''
from datetime import UTC, datetime
import json
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
from unittest.mock import Mock, patch
from paper import serve

time.tzset()
results = []
for text in ('2026-07-08T12:00:00', '2026-11-08T12:00:00'):
    created = datetime.fromisoformat(text)
    utc_epoch = created.replace(tzinfo=UTC).timestamp()
    actions = []
    with tempfile.TemporaryDirectory() as root:
        for age in (10, 599, 600, 601):
            cli = Mock()
            daemon = SimpleNamespace(active=lambda: True, profile=None, stopping=set(), recovery_failures={}, cli=cli,
                runs=lambda: {'runs': [{'paper_id': 1, 'state': 'unsealed', 'created_at': created}]})
            with patch.object(serve.time, 'time', return_value=utc_epoch + age), \
                 patch.object(serve.runs, 'run_dir', return_value=Path(root)):
                serve.Daemon.seal_found(daemon)
            actions.append([list(call.args) for call in cli.call_args_list])
    results.append({'epoch': serve._epoch(created), 'expected': utc_epoch, 'actions': actions})
aware = datetime.fromisoformat('2026-11-08T21:00:00+09:00')
print(json.dumps({'dates': results, 'aware': serve._epoch(aware), 'missing': serve._epoch(None)}))
'''


class UtcRunAgeTests(unittest.TestCase):
    def test_utc_age_and_existing_recovery_threshold_are_host_independent(self):
        root = Path(__file__).resolve().parents[2]
        for zone in ('UTC', 'America/New_York', 'Asia/Shanghai', 'Asia/Tokyo'):
            with self.subTest(zone=zone):
                result = subprocess.run([sys.executable, '-c', PROBE], cwd=root,
                                        env={'PATH': os.defpath, 'TZ': zone},
                                        text=True, capture_output=True, timeout=30, check=True)
                data = json.loads(result.stdout)
                for date in data['dates']:
                    self.assertEqual(date['epoch'], date['expected'])
                    self.assertEqual(date['actions'], [[], [], [], [['resume', '--paper-id', '1']]])
                self.assertEqual(data['aware'], 1794139200.0)
                self.assertEqual(data['missing'], 0.0)


if __name__ == '__main__':
    unittest.main()
