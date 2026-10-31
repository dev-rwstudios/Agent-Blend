"""Runs the real-Blender test scripts (tests/blender/) through the `blender` binary.

Skipped when Blender isn't installed, so CI without it still passes.
"""
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
BLENDER = shutil.which("blender")


@pytest.mark.skipif(BLENDER is None, reason="blender binary not found")
@pytest.mark.parametrize("script", ["test_toolkit.py", "test_step_engine.py"])
def test_real_blender_script(script):
    result = subprocess.run(
        [BLENDER, "-b", "--factory-startup", "--python", str(ROOT / "tests" / "blender" / script), "--", str(ROOT)],
        capture_output=True, text=True, timeout=600,
    )
    failures = [line for line in result.stdout.splitlines() if line.startswith("FAIL")]
    assert result.returncode == 0 and not failures, "\n".join(failures) or result.stdout[-2000:]
