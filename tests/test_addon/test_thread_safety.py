"""A stalled Blender main thread must produce a clear error, not silence."""

import importlib.util
import os
import sys

import pytest


def _load_thread_safety():
    path = os.path.join(os.path.dirname(__file__), "..", "..", "addon", "thread_safety.py")
    spec = importlib.util.spec_from_file_location("addon_thread_safety_under_test", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_times_out_with_clear_error_when_main_thread_never_runs():
    ts = _load_thread_safety()
    ts.MAIN_THREAD_TIMEOUT = 0.05  # nothing processes the queue in this test

    with pytest.raises(TimeoutError, match="main thread did not run the command"):
        ts.execute_on_main_thread(lambda: "never runs")

    assert ts._response_queues == {}, "timed-out requests don't leak response queues"


def test_runs_on_main_thread_when_queue_is_processed():
    import threading

    ts = _load_thread_safety()
    result = {}
    worker = threading.Thread(target=lambda: result.update(value=ts.execute_on_main_thread(lambda x: x * 2, 21)))
    worker.start()
    while worker.is_alive():
        ts._process_queue()  # what Blender's timer does every 10 ms
        worker.join(0.01)
    assert result["value"] == 42
