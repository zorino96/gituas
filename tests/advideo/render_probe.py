"""Runs the pieces of adfilm/render.py for one job file and prints what they drew, as JSON on stdout.

Used by tests/advideo/render-run.test.ts (python is optional there: the test is skipped without it). The job is
read the way the renderer reads it (AD_JOB); the voice clips are only measured, never decoded, so no ffmpeg is needed.

  python render_probe.py job.json

Output: { W, H, capTop, safe, rtl, wide, scenes: [ { i, type, marks, headlines, wheads, credits, texts, md5, ink? } ] }
  marks      [cx, cy, size] of every logo mark / monogram the scene drew
  headlines  [text, y, max_width, max_size, max_lines, lines drawn (when the scene planned them), colour] of every headline
  wheads     (a wide story) [text, edge x the lines start from, top y, max_width, size, lines drawn, widest line, colour] of every headline of a text column
  md5        a hash of the scene's pixels (to compare two jobs that must look the same, not to pin the pixels of one platform)
  credits    [bottom y, max width, font size, lines, edge x or null, runs] of the photo credit block the scene drew (a story's closing scene); runs =
             per line the runs it is drawn in, [[kind, text] ...] with kind 'ar' (Arabic script), 'ltr' or 'sep' (a line that is one piece has one run)
  texts      every string the scene drew with mv.text / mv.text_shaped (to check which letters reached the picture)
  textAt     [text, x] of the same strings (x as it was given: the centre of a centred string, its start otherwise)
  ink        (hook scenes) the rows the headline and the line under it cover, drawn alone on black: [top, bottom]
  bright     (the same scenes) how bright render.photo_brightness finds the photograph, 0..1
  bg         (a hook or a beat over a photograph) what the text is read against: the scene drawn again without any text, and for the
             rows of the first headline [top, bottom] the relative luminance (0 black, 1 white) of the brightest 5 % of the pixels
             (a wide story: only the columns the headline covers)
"""
import contextlib
import hashlib
import json
import os
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ADFILM = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'adfilm')
sys.path.insert(0, ADFILM)
os.chdir(ADFILM)

JOB_FILE = os.path.abspath(sys.argv[1])
os.environ['AD_JOB'] = JOB_FILE

import skia  # noqa: E402

import mv  # noqa: E402
import sfx  # noqa: E402


def _seconds(path):
    """The length of a voice clip (a plain WAV in the tests); the renderer asks the same of its own sfx.load."""
    with wave.open(path, 'rb') as w:
        return w.getnframes() / float(w.getframerate())


sfx.load = lambda path, sr=sfx.SR: np.zeros((2, int(_seconds(path) * sr)))

import render  # noqa: E402

DRAW_AT = 3.2    # every entrance has finished by now (a floating look is the slowest: 2.9 s)

_seen = {'marks': [], 'headlines': [], 'wheads': [], 'credits': [], 'texts': [], 'textAt': []}


def _wrap(module, name, record):
    original = getattr(module, name)

    def wrapper(*a, **k):
        record(a, k)
        return original(*a, **k)

    setattr(module, name, wrapper)
    return original


_wrap(render, 'mark', lambda a, k: _seen['marks'].append([a[1], a[2], a[3]]))
_wrap(render, 'headline', lambda a, k: _seen['headlines'].append([a[1], a[2], a[3], a[4], k.get('max_lines', 2), len(k['plan'][1]) if k.get('plan') else None, a[5] if len(a) > 5 else k.get('col')]))
_wrap(mv, 'text', lambda a, k: (_seen['texts'].append(a[1]), _seen['textAt'].append([a[1], a[2]])))
_wrap(mv, 'text_shaped', lambda a, k: (_seen['texts'].append(a[1]), _seen['textAt'].append([a[1], a[2]])))


if hasattr(render, 'w_head'):
    _w_head = render.w_head

    def _recording_w_head(*a, **k):
        out = _w_head(*a, **k)       # (size, lines, widest line, height)
        _seen['wheads'].append([a[1], a[2], a[3], a[4], out[0], out[1], out[2], k.get('col') if 'col' in k else (a[6] if len(a) > 6 else None)])
        return out

    render.w_head = _recording_w_head

if hasattr(render, 'credits_block'):
    _credits_block = render.credits_block

    def _recording_credits_block(c, u, bottom, max_w, edge=None, t0=0.9):
        if render.CREDITS:
            _seen['credits'].append([bottom, max_w, render.credit_size(max_w), len(render.CREDITS), edge, [[list(run) for run in render.credit_runs(line)] for line in render.CREDITS]])
        return _credits_block(c, u, bottom, max_w, edge=edge, t0=t0)

    render.credits_block = _recording_credits_block


def surface():
    s = skia.Surface(render.W, render.H)
    return s, s.getCanvas()


@contextlib.contextmanager
def patched(**names):
    old = {n: getattr(render, n) for n in names}
    for n, v in names.items():
        setattr(render, n, v)
    try:
        yield
    finally:
        for n, v in old.items():
            setattr(render, n, v)


def hook_ink(scene):
    """The rows the hook's headline and the line under it cover: the scene drawn alone on black, without the
    logo mark, the underline and the caption (and without the photograph a story's hook may sit over)."""
    s, c = surface()
    c.clear(skia.ColorBLACK)
    with patched(stage=lambda c, u, **k: None, mark=lambda *a, **k: None, underline=lambda *a, **k: None, caption=lambda *a, **k: None,
                 story_picture=lambda *a, **k: False):
        scene.draw(c, DRAW_AT)
    px = s.makeImageSnapshot().toarray()[:, :, :3].max(axis=2)
    rows = np.where(px.max(axis=1) > 48)[0]
    return [int(rows[0]), int(rows[-1])] if len(rows) else None


def relative_luminance(rgb):
    """WCAG relative luminance of an (n, 3) array of 0..255 sRGB values."""
    v = rgb.astype(float) / 255.0
    lin = np.where(v <= 0.03928, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)
    return 0.2126 * lin[:, 0] + 0.7152 * lin[:, 1] + 0.0722 * lin[:, 2]


def background_under_text(scene, headlines):
    """The scene drawn without a letter of text, and how bright it is behind its first headline."""
    s, c = surface()
    nothing = lambda *a, **k: None  # noqa: E731
    with patched(headline=nothing, small=nothing, mark=nothing, underline=nothing, caption=nothing, dots=nothing, w_block=nothing, w_head=nothing, w_small=nothing, credits_block=nothing):
        scene.draw(c, DRAW_AT)
    px = s.makeImageSnapshot().toarray()[:, :, :3]
    if render.WIDE:
        # a wide text column: only the rows and the columns the first headline covers (the veil is darkest at the edge it starts from)
        _text, edge, top_y, _w, size, lines, widest, _col = headlines[0]
        top, bottom = max(0, int(top_y)), min(render.H, int(top_y + size * 1.22 * (lines or 1)))
        x0, x1 = (edge - widest, edge) if render.RTL else (edge, edge + widest)
        lum = relative_luminance(px[top:bottom, max(0, int(x0)):min(render.W, int(x1))].reshape(-1, 3))
        return [top, bottom, float(np.percentile(lum, 95))]
    _text, y, _w, size, _lines, drawn, _col = headlines[0]
    half = size * 1.3 * (drawn or 1) / 2 + size * 0.2
    top, bottom = max(0, int(y - half)), min(render.H, int(y + half))
    lum = relative_luminance(px[top:bottom].reshape(-1, 3))
    return [top, bottom, float(np.percentile(lum, 95))]


out = []
for scene in render.build():
    sc = render.SCENES[len(out)]
    for k in _seen:
        _seen[k].clear()
    s, c = surface()
    scene.draw(c, DRAW_AT)
    row = {'i': len(out), 'type': sc.get('type'), 'marks': list(_seen['marks']), 'headlines': list(_seen['headlines']), 'wheads': list(_seen['wheads']), 'credits': list(_seen['credits']), 'texts': list(_seen['texts']), 'textAt': list(_seen['textAt']),
           'md5': hashlib.md5(s.makeImageSnapshot().tobytes()).hexdigest()}
    if sc.get('type') == 'hook':
        row['ink'] = hook_ink(scene)
    heads = row['wheads'] if render.WIDE else row['headlines']
    if sc.get('type') in ('hook', 'story') and isinstance(sc.get('photo'), int) and heads:
        row['bg'] = background_under_text(scene, heads)
        row['bright'] = render.wide_brightness(sc.get('photo')) if render.WIDE else render.photo_brightness(sc.get('photo'))
    out.append(row)

print(json.dumps({'W': render.W, 'H': render.H, 'capTop': render.CAP_TOP, 'safe': list(render.SAFE), 'rtl': bool(render.RTL), 'wide': bool(render.WIDE), 'scenes': out}))
