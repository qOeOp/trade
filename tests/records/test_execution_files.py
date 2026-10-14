"""Original-file custody rejects malformed chunks before granting complete bytes."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from research.records import execution_files as files
from research.records.common import RecordError


class ChunkIntegrityTests(unittest.TestCase):
    def fixture(self):
        parts = [files.part_path('account.csv', i) for i in range(2)]
        entry = {'state':'captured','length':6,'sha256':hashlib.sha256(b'ABCDEF').hexdigest(),'chunks':parts}
        manifest = {'format':'execution-capture-v2','files':{'account.csv':entry}}
        stored = {parts[0]:b'ABCD',parts[1]:b'EF','execution.json':json.dumps(manifest).encode()}
        return manifest, stored

    def check(self, manifest, stored):
        stored = {**stored, 'execution.json':json.dumps(manifest).encode()}
        rows = [(name,hashlib.sha256(data).hexdigest(),len(data)) for name,data in stored.items()]
        def one(conn, sql, params):
            data = stored.get(params[1])
            return None if data is None else {'content':data,'sha256':hashlib.sha256(data).hexdigest()}
        with patch.object(files,'CHUNK_BYTES',4), patch.object(files.db,'rows',return_value=rows), patch.object(files.db,'one',side_effect=one):
            name, value = files.inventory(None, 'trial-1-execution')
            return b''.join(files.iter_file(None, 'trial-1-execution', 'account.csv', value['files']['account.csv']))

    def test_complete_bytes_and_missing_repeated_reordered_foreign_extra_parts(self):
        manifest, stored = self.fixture()
        self.assertEqual(self.check(manifest,stored),b'ABCDEF')
        for kind in ('missing','repeated','reordered','foreign','extra','truncated','changed'):
            value, data = copy.deepcopy(manifest), dict(stored)
            parts = value['files']['account.csv']['chunks']
            if kind=='missing': data.pop(parts[1])
            elif kind=='repeated': parts[1]=parts[0]
            elif kind=='reordered': parts.reverse()
            elif kind=='foreign': parts[1]=files.part_path('other.csv',1)
            elif kind=='extra': data[files.part_path('other.csv',0)]=b'ABCD'
            elif kind=='truncated': data[parts[1]]=b'E'
            elif kind=='changed': data[parts[0]]=b'ZBCD'
            with self.subTest(kind=kind), self.assertRaises(RecordError): self.check(value,data)

    def test_total_limit_rejected_before_opening_sparse_large_file(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'account.csv'
            with p.open('wb') as stream: stream.truncate(files.ENGINEERING_BYTES+1)
            with patch.object(Path,'open',side_effect=AssertionError('oversize file was read')):
                with self.assertRaises(RecordError) as caught:
                    files.describe({'account.csv':p},files.ENGINEERING_BYTES)
            self.assertEqual(caught.exception.code,'EXECUTION_CAPTURE_LIMIT')

    def test_changed_file_aborts_insert_before_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'account.csv';p.write_bytes(b'ABCDEF')
            entries=files.describe({'account.csv':p},files.ENGINEERING_BYTES)
            p.write_bytes(b'ABCDEZ')
            with patch.object(files.db,'rows',return_value=[]), self.assertRaises(RecordError):
                files.insert(None,'trial-1-execution',{'account.csv':p},entries,chunked=True)

    def test_four_gib_exact_metadata_and_one_byte_over(self):
        for length in (files.ENGINEERING_BYTES,files.ENGINEERING_BYTES+1):
            parts=[files.part_path('account.csv',i) for i in range((length+files.CHUNK_BYTES-1)//files.CHUNK_BYTES)]
            value={'format':'execution-capture-v2','files':{'account.csv':{'state':'captured','length':length,'sha256':'0'*64,'chunks':parts}}}
            rows=[('execution.json','0'*64,100)]+[(p,'0'*64,min(files.CHUNK_BYTES,length-i*files.CHUNK_BYTES)) for i,p in enumerate(parts)]
            with patch.object(files.db,'rows',return_value=rows),patch.object(files,'physical_bytes',return_value=json.dumps(value).encode()):
                if length==files.ENGINEERING_BYTES:self.assertIsNotNone(files.inventory(None,'trial-1-execution'))
                else:
                    with self.assertRaises(RecordError): files.inventory(None,'trial-1-execution')
