"""Live native-cache custody without starting services or connecting to a venue."""

from pathlib import Path
import io
import socketserver
import tempfile
import threading
import unittest
from unittest import mock

from engine import live_cache
from engine.live_errors import LiveRefusal


class LiveCacheTests(unittest.TestCase):
    def cache(self):
        cache = live_cache.LiveCache.__new__(live_cache.LiveCache)
        cache.port, cache.failure, cache.closed = 1234, None, False
        cache.process = mock.Mock(returncode=0)
        cache.process.poll.return_value = None
        cache.log = io.BytesIO()
        return cache

    def test_resume_requires_retained_native_aof_before_starting_process(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(live_cache.subprocess, "Popen") as start:
            with self.assertRaisesRegex(LiveRefusal, "LIVE_CACHE_MISSING"):
                live_cache.LiveCache(Path(directory), resume=True)
            start.assert_not_called()

    def test_child_death_is_latched_and_cannot_be_hidden_by_later_health(self):
        cache = self.cache()
        cache.process.poll.return_value = 1
        with mock.patch.object(live_cache, "redis_command") as command:
            with self.assertRaisesRegex(LiveRefusal, "LIVE_CACHE_HEALTH"):
                cache.health()
            cache.process.poll.return_value = None
            with self.assertRaisesRegex(LiveRefusal, "LIVE_CACHE_HEALTH"):
                cache.health()
            command.assert_not_called()

    def test_aof_write_failure_is_rejected_before_new_write_can_reset_status(self):
        cache = self.cache()
        with mock.patch.object(live_cache, "redis_command", return_value=
                b"aof_enabled:1\r\naof_last_write_status:err\r\n") as command:
            with self.assertRaisesRegex(LiveRefusal, "LIVE_CACHE_HEALTH"):
                cache.health()
            command.assert_called_once_with(cache.port, "INFO", "persistence")

    def test_guard_checks_durable_configuration_and_write_barrier(self):
        cache = self.cache()
        good = b"aof_enabled:1\r\naof_last_write_status:ok\r\n"
        with mock.patch.object(live_cache, "redis_command", side_effect=[
                good, [b"appendfsync", b"always"], b"OK", good]) as command:
            cache.health()
            self.assertEqual(command.call_args_list, [mock.call(cache.port, "INFO", "persistence"),
                mock.call(cache.port, "CONFIG", "GET", "appendfsync"),
                mock.call(cache.port, "SET", "trade-live-health", "1", "PX", "1000"),
                mock.call(cache.port, "INFO", "persistence")])
        self.assertIsNone(cache.failure)

    def test_real_socket_write_rejection_is_a_storage_failure(self):
        good = b"aof_enabled:1\r\naof_last_write_status:ok\r\n"
        received = []
        class Handler(socketserver.StreamRequestHandler):
            def handle(self):
                command = live_cache._reply(self.rfile)
                received.append(command)
                if command[0] == b"INFO":
                    self.wfile.write(b"$" + str(len(good)).encode() + b"\r\n" + good + b"\r\n")
                elif command[0] == b"CONFIG":
                    self.wfile.write(b"*2\r\n$11\r\nappendfsync\r\n$6\r\nalways\r\n")
                else:
                    self.wfile.write(b"-MISCONF append-only file write failed\r\n")
        with socketserver.TCPServer(("127.0.0.1", 0), Handler) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            cache = self.cache()
            cache.port = server.server_address[1]
            try:
                with self.assertRaisesRegex(LiveRefusal, "LIVE_CACHE_HEALTH"):
                    cache.health()
            finally:
                server.shutdown()
                thread.join(timeout=2)
        self.assertEqual([row[0] for row in received], [b"INFO", b"CONFIG", b"SET"])

    def test_close_rejects_failed_child_even_if_no_shutdown_signal_needed(self):
        cache = self.cache()
        cache.process.poll.return_value = 9
        cache.process.returncode = 9
        with self.assertRaisesRegex(LiveRefusal, "LIVE_CACHE_HEALTH"):
            cache.close()
        cache.process.send_signal.assert_not_called()
        self.assertTrue(cache.log.closed)

    def test_the_native_cache_rewrites_its_aof_and_fsyncs_every_write(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = Path(directory) / "redis"
            (runtime / "lib").mkdir(parents=True)
            (runtime / "ld-musl-x86_64.so.1").touch()
            (runtime / "redis-server").touch()
            good = b"aof_enabled:1\r\naof_last_write_status:ok\r\n"
            with mock.patch.object(live_cache, "REDIS", runtime), \
                    mock.patch.object(live_cache.subprocess, "Popen") as start, \
                    mock.patch.object(live_cache, "redis_command",
                                      side_effect=[b"PONG", good, [b"appendfsync", b"always"], b"OK", good]):
                start.return_value.poll.return_value = None
                cache = live_cache.LiveCache(Path(directory), resume=False)
                cache.log.close()
        argv = start.call_args.args[0]
        options = dict(zip(argv[argv.index("--bind")::2], argv[argv.index("--bind") + 1::2], strict=True))
        self.assertEqual({key: options[key] for key in ("--appendonly", "--appendfsync", "--save",
                                                        "--auto-aof-rewrite-percentage", "--auto-aof-rewrite-min-size")},
                         {"--appendonly": "yes", "--appendfsync": "always", "--save": "",
                          "--auto-aof-rewrite-percentage": "100", "--auto-aof-rewrite-min-size": "64mb"})

    def test_missing_runtime_cache_does_not_fall_back_to_host_redis(self):
        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.object(live_cache, "REDIS", Path(directory) / "absent"), \
                mock.patch.object(live_cache.subprocess, "Popen") as start:
            with self.assertRaisesRegex(LiveRefusal, "LIVE_CACHE_RUNTIME"):
                live_cache.LiveCache(Path(directory), resume=False)
            start.assert_not_called()
