"""Runs the pieces of adfilm/render.py for one job file and prints what they drew, as JSON on stdout.

Used by tests/advideo/render-run.test.ts (python is optional there: the test is skipped without it). The job is
read the way the renderer reads it (AD_JOB); the voice clips are only measured, never decoded, so no ffmpeg is needed.

  python render_probe.py job.json

Output: { W, H, capTop, safe, scenes: [ { i, type, marks, headlines, texts, md5, ink? } ] }
  marks      [cx, cy, size] of every logo mark / monogram the scene drew
  headlines  [text, y, max_width, max_size, max_lines, lines drawn (when the scene planned them)] of every headline
  md5        a hash of the scene's pixels (to compare two jobs that must look the same, not to pin the pixels of one platform)
  texts      every string the scene drew with mv.text / mv.text_shaped (to check which letters reached the picture)
  ink        (hook scenes) the rows the headline and the line under it cover, drawn alone on black: [top, bottom]
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

_seen = {'marks': [], 'headlines': [], 'texts': []}


def _wrap(module, name, record):
    original = getattr(module, name)

    def wrapper(*a, **k):
        record(a, k)
        return original(*a, **k)

    setattr(module, name, wrapper)
    return original


_wrap(render, 'mark', lambda a, k: _seen['marks'].append([a[1], a[2], a[3]]))
_wrap(render, 'headline', lambda a, k: _seen['headlines'].append([a[1], a[2], a[3], a[4], k.get('max_lines', 2), len(k['plan'][1]) if k.get('plan') else None]))
_wrap(mv, 'text', lambda a, k: _seen['texts'].append(a[1]))
_wrap(mv, 'text_shaped', lambda a, k: _seen['texts'].append(a[1]))


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
    logo mark, the underline and the caption."""
    s, c = surface()
    c.clear(skia.ColorBLACK)
    with patched(stage=lambda c, u, **k: None, mark=lambda *a, **k: None, underline=lambda *a, **k: None, caption=lambda *a, **k: None):
        scene.draw(c, DRAW_AT)
    px = s.makeImageSnapshot().toarray()[:, :, :3].max(axis=2)
    rows = np.where(px.max(axis=1) > 48)[0]
    return [int(rows[0]), int(rows[-1])] if len(rows) else None


out = []
for scene in render.build():
    sc = render.SCENES[len(out)]
    for k in _seen:
        _seen[k].clear()
    s, c = surface()
    scene.draw(c, DRAW_AT)
    row = {'i': len(out), 'type': sc.get('type'), 'marks': list(_seen['marks']), 'headlines': list(_seen['headlines']), 'texts': list(_seen['texts']),
           'md5': hashlib.md5(s.makeImageSnapshot().tobytes()).hexdigest()}
    if sc.get('type') == 'hook':
        row['ink'] = hook_ink(scene)
    out.append(row)

print(json.dumps({'W': render.W, 'H': render.H, 'capTop': render.CAP_TOP, 'safe': list(render.SAFE), 'scenes': out}))
