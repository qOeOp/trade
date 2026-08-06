import subprocess
import sys
import textwrap

from vibe_trader.common import LogColor
from vibe_trader.common import Logger
from vibe_trader.common import LogLevel
from vibe_trader.common import init_tracing
from vibe_trader.common import log_header
from vibe_trader.common import log_sysinfo
from vibe_trader.common import logger_flush
from vibe_trader.common import logger_log
from vibe_trader.common import logging_clock_set_realtime_mode
from vibe_trader.common import logging_clock_set_static_mode
from vibe_trader.common import logging_clock_set_static_time
from vibe_trader.common import tracing_is_initialized
from vibe_trader.core import UUID4
from vibe_trader.model import TraderId


def test_logger_methods_and_name():
    logger = Logger("TestLogger")

    assert logger.name == "TestLogger"

    logger.trace("trace", LogColor.GREEN)

    for method_name, color in [
        ("debug", LogColor.GREEN),
        ("info", LogColor.GREEN),
        ("warning", LogColor.GREEN),
        ("error", LogColor.GREEN),
        ("exception", LogColor.RED),
    ]:
        getattr(logger, method_name)(method_name, color)

    logger.flush()


def test_logger_methods_accept_omitted_color():
    logger = Logger("TestLogger")

    for method_name in ["trace", "debug", "info", "warning", "error", "exception"]:
        getattr(logger, method_name)(method_name)

    logger._log(LogLevel.INFO, message="log")
    logger.flush()


def test_logging_raw_functions():
    logger_log(LogLevel.INFO, LogColor.NORMAL, "CommonTests", "hello")
    log_header(TraderId("TRADER-001"), "machine", UUID4(), "CommonTests")
    log_sysinfo("CommonTests")
    logger_flush()


def test_init_tracing_before_logging_succeeds_in_fresh_process():
    script = textwrap.dedent(
        """
        import tempfile

        from vibe_trader.common import LogLevel
        from vibe_trader.common import init_logging
        from vibe_trader.common import init_tracing
        from vibe_trader.core import UUID4
        from vibe_trader.model import TraderId

        init_tracing()

        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
            guard = init_logging(
                trader_id=TraderId("TRADER-001"),
                instance_id=UUID4(),
                level_stdout=LogLevel.INFO,
                level_file=LogLevel.DEBUG,
                directory=directory,
                file_name="common-log",
                is_colored=False,
                is_bypassed=True,
                print_config=False,
            )

            assert guard is not None
        """,
    )

    result = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,
        check=False,
        text=True,
    )

    assert result.returncode == 0, result.stderr


def test_logging_clock_mode_functions_are_callable():
    logging_clock_set_static_mode()
    logging_clock_set_static_time(123)
    logging_clock_set_realtime_mode()


def test_init_tracing_sets_initialized_flag():
    if not tracing_is_initialized():
        init_tracing()

    assert tracing_is_initialized() is True
