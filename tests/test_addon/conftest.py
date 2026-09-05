"""Mock bpy/mathutils modules for addon tests."""

import sys
import types
from unittest.mock import MagicMock

# Create mock bpy module before any addon imports
mock_bpy = MagicMock()
mock_bpy.app.timers.is_registered = MagicMock(return_value=False)
mock_bpy.app.timers.register = MagicMock()
mock_bpy.app.timers.unregister = MagicMock()
sys.modules["bpy"] = mock_bpy


class _Vector:
    """Minimal stand-in for mathutils.Vector — real (x, y, z) math, no C extension."""

    __slots__ = ("x", "y", "z")

    def __init__(self, seq=(0.0, 0.0, 0.0)):
        self.x, self.y, self.z = float(seq[0]), float(seq[1]), float(seq[2])

    def __iter__(self):
        return iter((self.x, self.y, self.z))

    def __getitem__(self, i):
        return (self.x, self.y, self.z)[i]

    def __eq__(self, other):
        return tuple(self) == tuple(other)

    def __repr__(self):
        return f"Vector(({self.x}, {self.y}, {self.z}))"


class _Matrix:
    """Minimal 4x4 row-major affine matrix supporting Matrix @ Vector."""

    def __init__(self, rows=None):
        self.rows = rows or [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]

    @classmethod
    def Translation(cls, t):
        x, y, z = t
        return cls([[1, 0, 0, x], [0, 1, 0, y], [0, 0, 1, z], [0, 0, 0, 1]])

    @classmethod
    def Identity(cls, size=4):
        return cls()

    def __matmul__(self, other):
        if isinstance(other, _Vector):
            x, y, z = other.x, other.y, other.z
            r = self.rows
            return _Vector((
                r[0][0] * x + r[0][1] * y + r[0][2] * z + r[0][3],
                r[1][0] * x + r[1][1] * y + r[1][2] * z + r[1][3],
                r[2][0] * x + r[2][1] * y + r[2][2] * z + r[2][3],
            ))
        return NotImplemented


class _Euler:
    def __init__(self, seq=(0.0, 0.0, 0.0), order="XYZ"):
        self.x, self.y, self.z = float(seq[0]), float(seq[1]), float(seq[2])
        self.order = order

    def __iter__(self):
        return iter((self.x, self.y, self.z))


sys.modules["mathutils"] = types.SimpleNamespace(
    Vector=_Vector, Matrix=_Matrix, Euler=_Euler,
)
