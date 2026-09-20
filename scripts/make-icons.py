"""Gera os ícones PNG do app (patinha branca em fundo rosa) sem dependências externas.
Uso: python scripts/make-icons.py
"""
import math
import struct
import zlib
from pathlib import Path

BG = (233, 30, 99)
FG = (255, 255, 255)


def clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))


def ellipse_cov(x, y, cx, cy, rx, ry):
    # cobertura aproximada (anti-alias) de uma elipse
    d = math.hypot((x - cx) / rx, (y - cy) / ry)
    edge = 1.0 / min(rx, ry)
    return clamp((1.0 - d) / edge + 0.5)


def rrect_cov(x, y, w, h, r):
    dx = max(abs(x - w / 2) - (w / 2 - r), 0)
    dy = max(abs(y - h / 2) - (h / 2 - r), 0)
    return clamp(r - math.hypot(dx, dy) + 0.5)


def paw_cov(x, y, s, scale):
    """Patinha: 1 almofada grande + 4 dedos. s = tamanho; scale = fração ocupada."""
    c = s / 2
    u = s * scale / 2
    cov = ellipse_cov(x, y, c, c + 0.28 * u, 0.62 * u, 0.5 * u)
    for cx, cy, rx, ry in [(-0.62, -0.2, 0.2, 0.28), (-0.22, -0.62, 0.21, 0.3), (0.22, -0.62, 0.21, 0.3), (0.62, -0.2, 0.2, 0.28)]:
        cov = max(cov, ellipse_cov(x, y, c + cx * u, c + cy * u, rx * u, ry * u))
    return cov


def png(path, size, maskable):
    rows = []
    for j in range(size):
        row = bytearray([0])
        for i in range(size):
            x, y = i + 0.5, j + 0.5
            a_bg = 1.0 if maskable else rrect_cov(x, y, size, size, size * 0.22)
            paw = paw_cov(x, y, size, 0.5 if maskable else 0.62)
            r = BG[0] * (1 - paw) + FG[0] * paw
            g = BG[1] * (1 - paw) + FG[1] * paw
            b = BG[2] * (1 - paw) + FG[2] * paw
            row += bytes((int(r), int(g), int(b), int(a_bg * 255)))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    Path(path).write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent
    png(root / "icon-192.png", 192, False)
    png(root / "icon-512.png", 512, False)
    png(root / "icon-maskable-512.png", 512, True)
    print("ícones gerados")
