"""Dimension-string parsing. Everything is normalised to meters."""
from __future__ import annotations

import re

FT = 0.3048
INCH = 0.0254

_FRAC = {"½": 0.5, "¼": 0.25, "¾": 0.75, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875}

# 10'7½"   10'-7 1/2"   12'6"   4'   40"   10' 0"
_FEET_INCH = re.compile(
    r"""(?P<ft>\d+(?:\.\d+)?)\s*['′]\s*-?\s*
        (?:(?P<in>\d+(?:\.\d+)?)?\s*(?P<frac>[½¼¾⅛⅜⅝⅞]|\d+/\d+)?\s*["″]?)?""",
    re.X,
)
_INCH_ONLY = re.compile(r"""^(?P<in>\d+(?:\.\d+)?)\s*(?P<frac>[½¼¾⅛⅜⅝⅞]|\d+/\d+)?\s*["″]$""")
_METRIC = re.compile(r"^(?P<v>\d+(?:\.\d+)?)\s*(?P<u>mm|cm|m)?$", re.I)


def _frac(s: str | None) -> float:
    if not s:
        return 0.0
    if s in _FRAC:
        return _FRAC[s]
    n, d = s.split("/")
    return float(n) / float(d)


def parse_length(text: str, bare_unit: str = "mm") -> float | None:
    """Parse one length ('10\\'7½"', '40"', '3600', '3.6m') into meters. Returns None if unparseable."""
    t = text.strip().replace("’", "'").replace("”", '"').replace("''", '"')
    m = _INCH_ONLY.match(t)
    if m:
        return (float(m["in"]) + _frac(m["frac"])) * INCH
    m = _FEET_INCH.fullmatch(t) or _FEET_INCH.match(t)
    if m and m.group(0).strip():
        inch = float(m["in"]) if m["in"] else 0.0
        return float(m["ft"]) * FT + (inch + _frac(m["frac"])) * INCH
    m = _METRIC.match(t)
    if m:
        v = float(m["v"])
        u = (m["u"] or bare_unit).lower()
        return v * {"mm": 0.001, "cm": 0.01, "m": 1.0}[u]
    return None


_PAIR_SPLIT = re.compile(r"\s*[x×X*]\s*")


def parse_pair(text: str, bare_unit: str = "mm") -> tuple[float, float] | None:
    """Parse 'W x L' room dimension strings -> (w, l) meters."""
    parts = _PAIR_SPLIT.split(text.strip())
    if len(parts) != 2:
        return None
    a, b = parse_length(parts[0], bare_unit), parse_length(parts[1], bare_unit)
    if a is None or b is None:
        return None
    return a, b


DIM_PAIR_RE = re.compile(
    r"\d+\s*['′][^x×X]{0,12}?\s*[x×X]\s*\d+\s*['′][^\s,;]*|\d{3,5}\s*[x×X]\s*\d{3,5}"
)


def fmt_ftin(m: float) -> str:
    """Meters -> nearest 1/2 inch feet-inch string, for reports."""
    total_in = round(m / INCH * 2) / 2
    ft = int(total_in // 12)
    inch = total_in - ft * 12
    s = f"{int(inch)}" + ("½" if inch % 1 else "")
    return f"{ft}'{s}\""


if __name__ == "__main__":  # quick self-test
    cases = {
        "10'7½\"": 10 * FT + 7.5 * INCH,
        "12'6\"": 12 * FT + 6 * INCH,
        "4'": 4 * FT,
        "40\"": 40 * INCH,
        "3600": 3.6,
        "10'0\"": 10 * FT,
    }
    for k, v in cases.items():
        got = parse_length(k)
        assert got is not None and abs(got - v) < 1e-9, (k, got, v)
    assert parse_pair("19'3\"x9'7½\"") is not None
    print("units OK")
