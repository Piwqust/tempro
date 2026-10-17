"""The README's product tour: the period screens cross-fading into each other. Run from the repo root
after taking the screenshots (demo mode, English):  python brand/tour.py  → docs/assets/tour.gif
"""
import os

from PIL import Image

REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SHOTS = os.path.join(REPO, "docs", "screenshots")
OUT = os.path.join(REPO, "docs", "assets", "tour.gif")
FRAMES = ["day", "week", "month", "quarter", "year", "picker"]
WIDTH = 1000
HOLD_MS, FADE_STEPS, FADE_MS = 1900, 6, 60


def main() -> None:
    imgs = []
    for name in FRAMES:
        im = Image.open(os.path.join(SHOTS, f"{name}.png")).convert("RGB")
        imgs.append(im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS))
    frames, durations = [], []
    for i, im in enumerate(imgs):
        frames.append(im)
        durations.append(HOLD_MS)
        nxt = imgs[(i + 1) % len(imgs)]
        for s in range(1, FADE_STEPS + 1):
            frames.append(Image.blend(im, nxt, s / (FADE_STEPS + 1)))
            durations.append(FADE_MS)
    # one shared palette keeps the colours steady between frames
    sheet = Image.new("RGB", (WIDTH, imgs[0].height * len(imgs)))
    for i, im in enumerate(imgs):
        sheet.paste(im, (0, i * imgs[0].height))
    palette = sheet.quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    out = [f.quantize(palette=palette, dither=Image.Dither.NONE) for f in frames]
    out[0].save(OUT, save_all=True, append_images=out[1:], duration=durations, loop=0, optimize=True, disposal=1)
    print(f"{OUT}: {os.path.getsize(OUT) / 1e6:.1f} MB, {len(out)} frames")


if __name__ == "__main__":
    main()
