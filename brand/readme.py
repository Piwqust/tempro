"""Images for the README: the animated banner, buttons and feature icons. Run from the repo root:

    python brand/readme.py

Writes docs/assets/*.svg. Text is outlined from Inter (as in brand/logo.py), so the images look
the same everywhere and need no font. Animations are CSS inside the SVG, which GitHub plays in
<img>; they stop for people who ask for reduced motion.
"""
import io
import math
import os
import random
import re

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.join(ROOT, "..")
OUT = os.path.join(REPO, "docs", "assets")
APP = os.path.join(REPO, "app")
INTER = os.path.join(APP, "node_modules", "@fontsource-variable", "inter", "files", "inter-latin-wght-normal.woff2")
LUCIDE = os.path.join(APP, "node_modules", "lucide-react", "dist", "esm", "icons")

SIGNAL = "#FF5A1F"
WORK = "#2F6BFF"
LEISURE = "#E5408A"
PERSONAL = "#16A06A"

THEMES = {
    "dark": {"bg": "#0d1016", "bg2": "#141925", "ink": "#F3F4F7", "muted": "#9AA1B2", "empty": "#1d2230", "chip": "#1a1f2b", "line": "#2a3040"},
    "light": {"bg": "#F7F7F9", "bg2": "#EEF1F8", "ink": "#14151C", "muted": "#5d6170", "empty": "#e3e5ec", "chip": "#ffffff", "line": "#dcdfe7"},
}

_fonts: dict = {}


def font(wght: int) -> TTFont:
    if wght not in _fonts:
        _fonts[wght] = instantiateVariableFont(TTFont(INTER), {"wght": wght})
    return _fonts[wght]


def text(s: str, size: float, wght: int = 500, tracking: float = 0.0) -> tuple[str, float]:
    """(path d with the baseline at y = 0, width) for s in Inter."""
    f = font(wght)
    upm = f["head"].unitsPerEm
    k = size / upm
    cmap, gs, hmtx = f.getBestCmap(), f.getGlyphSet(), f["hmtx"]
    pen = SVGPathPen(gs, lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
    x = 0.0
    for ch in s:
        g = cmap.get(ord(ch)) or cmap[ord("?")]
        gs[g].draw(TransformPen(pen, (k, 0, 0, -k, x * k, 0)))
        x += hmtx[g][0] + tracking * upm
    return pen.getCommands(), x * k


def icon(name: str, color: str, size: float, x: float, y: float, stroke: float = 2.0) -> str:
    """A Lucide icon (ISC licence) drawn at (x, y)."""
    src = open(os.path.join(LUCIDE, f"{name}.mjs"), encoding="utf-8").read()
    body = ""
    for tag, attrs in re.findall(r'\[\s*"(\w+)",\s*\{([^}]*)\}\s*\]', src):
        kv = dict(re.findall(r'(\w+): "([^"]*)"', attrs))
        kv.pop("key", None)
        body += f"<{tag} " + " ".join(f'{k}="{v}"' for k, v in kv.items()) + "/>"
    k = size / 24
    return (f'<g transform="translate({x:g} {y:g}) scale({k:g})" fill="none" stroke="{color}" stroke-width="{stroke / k * k:g}" '
            f'stroke-linecap="round" stroke-linejoin="round">{body}</g>')


def mark(fg: str, x: float, y: float, size: float, animate: bool = False) -> str:
    """The logo: a week as a 3 × 3 heat map, today in orange."""
    levels = [[0.22, 0.55, 1.0], [0.55, 1.0, 0.3], [1.0, 0.45, None]]
    k = size / 64
    out = f'<g transform="translate({x:g} {y:g}) scale({k:g})">'
    for r, row in enumerate(levels):
        for c, op in enumerate(row):
            cx, cy = 7 + c * 18, 7 + r * 18
            if op is None:
                out += f'<rect class="now" x="{cx}" y="{cy}" width="14" height="14" rx="4" fill="{SIGNAL}"/>'
            else:
                out += f'<rect x="{cx}" y="{cy}" width="14" height="14" rx="4" fill="{fg}" opacity="{op}"/>'
    return out + "</g>"


def write(name: str, svg: str) -> None:
    with io.open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\n") as f:
        f.write(svg + "\n")


def hero(theme: str) -> str:
    t = THEMES[theme]
    W, H = 1280, 420
    rnd = random.Random(7)
    css = f"""
    .c {{ opacity: 0; transform-box: fill-box; transform-origin: center; animation: fill 11s cubic-bezier(.2,.8,.2,1) infinite; }}
    @keyframes fill {{ 0% {{ opacity: 0; transform: scale(.35); }} 5% {{ opacity: 1; transform: scale(1); }} 82% {{ opacity: 1; transform: scale(1); }} 92%, 100% {{ opacity: 0; transform: scale(.6); }} }}
    .now {{ transform-box: fill-box; transform-origin: center; animation: beat 1.8s ease-in-out infinite; }}
    @keyframes beat {{ 0%, 100% {{ transform: scale(1); }} 50% {{ transform: scale(.82); }} }}
    .ring {{ transform-box: fill-box; transform-origin: center; animation: ring 1.8s ease-out infinite; }}
    @keyframes ring {{ 0% {{ opacity: .7; transform: scale(.6); }} 100% {{ opacity: 0; transform: scale(1.9); }} }}
    .rise {{ opacity: 0; animation: rise .9s cubic-bezier(.2,.8,.2,1) forwards; }}
    @keyframes rise {{ from {{ opacity: 0; transform: translateY(10px); }} to {{ opacity: 1; transform: none; }} }}
    @media (prefers-reduced-motion: reduce) {{ .c, .rise {{ animation: none; opacity: 1; }} .now, .ring {{ animation: none; }} .ring {{ opacity: 0; }} }}
    """
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-label="Tempro: automatic time tracking that knows what you actually did">',
           f"<style>{css}</style>",
           "<defs>",
           f'<radialGradient id="glowA" cx="78%" cy="30%" r="55%"><stop offset="0" stop-color="{WORK}" stop-opacity="{0.22 if theme == "dark" else 0.12}"/><stop offset="1" stop-color="{WORK}" stop-opacity="0"/></radialGradient>',
           f'<radialGradient id="glowB" cx="12%" cy="110%" r="50%"><stop offset="0" stop-color="{SIGNAL}" stop-opacity="{0.16 if theme == "dark" else 0.10}"/><stop offset="1" stop-color="{SIGNAL}" stop-opacity="0"/></radialGradient>',
           "</defs>",
           f'<rect width="{W}" height="{H}" rx="24" fill="{t["bg"]}"/>',
           f'<rect width="{W}" height="{H}" rx="24" fill="url(#glowA)"/>',
           f'<rect width="{W}" height="{H}" rx="24" fill="url(#glowB)"/>',
           f'<rect x=".5" y=".5" width="{W - 1}" height="{H - 1}" rx="23.5" fill="none" stroke="{t["line"]}"/>']

    # left: logo, wordmark, tagline, chips
    out.append(f'<g class="rise">{mark(t["ink"], 72, 74, 64)}')
    d, _ = text("tempro", 58, 600, -0.02)
    out.append(f'<path transform="translate(150 125)" d="{d}" fill="{t["ink"]}"/></g>')
    d1, _ = text("Automatic time tracking", 36, 600, -0.015)
    d2, _ = text("that knows what you actually did.", 36, 600, -0.015)
    out.append(f'<g class="rise" style="animation-delay:.15s"><path transform="translate(72 214)" d="{d1}" fill="{t["ink"]}"/>'
               f'<path transform="translate(72 260)" d="{d2}" fill="{t["muted"]}"/></g>')
    x = 72
    chips = [("lock", "Encrypted"), ("calendar-range", "Day to year"), ("sparkles", "Sorts itself"), ("monitor", "Windows")]
    g = ['<g class="rise" style="animation-delay:.3s">']
    for ic, label in chips:
        d, w = text(label, 15, 500)
        cw = w + 50
        g.append(f'<rect x="{x}" y="304" width="{cw:.1f}" height="36" rx="18" fill="{t["chip"]}" stroke="{t["line"]}"/>')
        g.append(icon(ic, SIGNAL if ic == "lock" else t["muted"], 16, x + 14, 314))
        g.append(f'<path transform="translate({x + 38} 327)" d="{d}" fill="{t["ink"]}"/>')
        x += cw + 10
    g.append("</g>")
    out += g

    # right: half a year as a heat map, filling in week by week; the last day is now
    weeks, cell, gap = 18, 22, 6
    gx, gy = W - 72 - weeks * (cell + gap) + gap, 96
    months = ["Jun", "Jul", "Aug", "Sep", "Oct"]
    for i, m in enumerate(months):
        d, _ = text(m, 13, 500)
        out.append(f'<path transform="translate({gx + i * 4 * (cell + gap)} {gy - 14})" d="{d}" fill="{t["muted"]}"/>')
    days = ["Mon", "Wed", "Fri"]
    for i, dn in enumerate(days):
        d, w = text(dn, 12, 500)
        out.append(f'<path transform="translate({gx - 14 - w:.1f} {gy + (i * 2) * (cell + gap) + 16})" d="{d}" fill="{t["muted"]}"/>')
    for wk in range(weeks):
        for dy in range(7):
            x0, y0 = gx + wk * (cell + gap), gy + dy * (cell + gap)
            last = wk == weeks - 1 and dy == 4
            if wk == weeks - 1 and dy > 4:
                out.append(f'<rect x="{x0}" y="{y0}" width="{cell}" height="{cell}" rx="6" fill="none" stroke="{t["line"]}"/>')
                continue
            out.append(f'<rect x="{x0}" y="{y0}" width="{cell}" height="{cell}" rx="6" fill="{t["empty"]}"/>')
            if last:
                out.append(f'<rect class="ring" x="{x0}" y="{y0}" width="{cell}" height="{cell}" rx="6" fill="none" stroke="{SIGNAL}" stroke-width="2"/>')
                out.append(f'<rect class="now" x="{x0}" y="{y0}" width="{cell}" height="{cell}" rx="6" fill="{SIGNAL}"/>')
                continue
            weekend = dy >= 5
            v = rnd.random() * (0.45 if weekend else 1.0) + (0 if weekend else 0.15 + 0.25 * math.sin(wk / 3) ** 2)
            if rnd.random() < 0.06:
                v = 0
            if v < 0.12:
                continue
            color = LEISURE if weekend and rnd.random() < 0.5 else WORK
            op = min(1, 0.22 + v * 0.8)
            delay = wk * 0.16 + dy * 0.035
            out.append(f'<rect class="c" style="animation-delay:{delay:.2f}s" x="{x0}" y="{y0}" width="{cell}" height="{cell}" rx="6" fill="{color}" fill-opacity="{op:.2f}"/>')

    # legend under the map
    ly = gy + 7 * (cell + gap) + 18
    lx = gx
    for color, label in [(WORK, "Work"), (LEISURE, "Leisure"), (SIGNAL, "Now")]:
        out.append(f'<rect x="{lx}" y="{ly}" width="12" height="12" rx="3" fill="{color}"/>')
        d, w = text(label, 13, 500)
        out.append(f'<path transform="translate({lx + 18} {ly + 11})" d="{d}" fill="{t["muted"]}"/>')
        lx += w + 40
    out.append("</svg>")
    return "".join(out)


def button(name: str, label: str, ic: str, primary: bool) -> None:
    d, w = text(label, 17, 600)
    W, H = round(w + 82), 54
    bg = "#14151C" if primary else "#ffffff"
    fg = "#ffffff" if primary else "#14151C"
    stroke = "#3a3f4b" if primary else "#d6d9e0"
    accent = SIGNAL if primary else WORK
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-label="{label}">'
           f'<rect x=".5" y=".5" width="{W - 1}" height="{H - 1}" rx="14" fill="{bg}" stroke="{stroke}"/>'
           + icon(ic, accent, 20, 24, 17, 2.25)
           + f'<path transform="translate(56 34)" d="{d}" fill="{fg}"/></svg>')
    write(name, svg)


def feature(name: str, ic: str, color: str) -> None:
    s = 56
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {s} {s}" width="{s}" height="{s}">'
           f'<rect width="{s}" height="{s}" rx="16" fill="{color}" fill-opacity=".14"/>'
           f'<rect x=".5" y=".5" width="{s - 1}" height="{s - 1}" rx="15.5" fill="none" stroke="{color}" stroke-opacity=".35"/>'
           + icon(ic, color, 26, 15, 15, 2.25) + "</svg>")
    write(name, svg)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for th in THEMES:
        write(f"hero-{th}.svg", hero(th))
    button("btn-download.svg", "Download for Windows", "download", True)
    button("btn-tour.svg", "Take the tour", "play", False)
    button("btn-docs.svg", "Developer docs", "book-open", False)
    for name, ic, color in [
        ("f-record", "radar", WORK), ("f-sort", "wand-sparkles", LEISURE), ("f-periods", "calendar-range", PERSONAL),
        ("f-ai", "sparkles", "#8B5CF6"), ("f-privacy", "shield-check", SIGNAL), ("f-tray", "battery-charging", "#0E9FA8"),
    ]:
        feature(f"{name}.svg", ic, color)
    print("wrote docs/assets")


if __name__ == "__main__":
    main()
