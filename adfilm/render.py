"""Renders one AI video ad from a job file: python picture + sound, no editor.

The app writes the job (brand, scenes, which voice clip belongs to which scene) and worker.mjs downloads
its files next to job.json. This file only draws what the job says; it never runs anything the job
contains, so a model's script can change the words and the order, never the code.

  AD_JOB=job.json python render.py render out.mp4      (also: sheet | still 2.5 f.png | info)

Engine: the MIT-licensed programmatic-motion-video engine (mv.py and friends, see LICENSE and
THIRD_PARTY_NOTICES.md). Skia draws every frame, ffmpeg encodes.
"""
import functools
import json
import os
import re

import skia

import fx
import icons
import kinetic
import layout
import mv
import sfx
from mv import *

HERE = os.path.dirname(os.path.abspath(__file__))
JOB_FILE = os.environ.get('AD_JOB', os.path.join(HERE, 'job.json'))
BASE = os.path.dirname(os.path.abspath(JOB_FILE))
JOB = json.load(open(JOB_FILE, encoding='utf-8'))
BR = JOB['brand']
SCENES = JOB['scenes']
STYLE = JOB.get('style') if JOB.get('style') in ('elegant', 'bold', 'clean') else 'elegant'
MUSIC = JOB.get('music') or {}

AR_B, AR_M = 'IBM Plex Sans Arabic Bold', 'IBM Plex Sans Arabic Medium'

W, H = mv.env_size((1080, 1920))
FPS = mv.env_fps(30)
L = layout.Frame(W, H)
SAFE = L.safe('social') if L.portrait else L.safe('title')


def local(rel):
    return None if not rel else (rel if os.path.isabs(rel) else os.path.join(BASE, rel))


# ---- colour ---------------------------------------------------------------------------------------

def rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def hexs(t):
    return '#%02X%02X%02X' % tuple(max(0, min(255, round(v))) for v in t)


def mixc(a, b, t):
    return hexs(tuple(x + (y - x) * t for x, y in zip(rgb(a), rgb(b))))


def lum(h):
    r, g, b = rgb(h)
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255


def theme(style, primary, accent):
    """Palette of a look, built from the brand's own two colours."""
    if style == 'clean':
        ac = accent if lum(accent) < 0.72 else mixc(accent, '#000000', 0.45)
        return dict(bg='#FAFAF7', ink='#14141A', soft='#5C5C68', accent=ac, glow=accent, glow_a=0.14, dust=False,
                    cap_bg='#000000', cap_a=0.66, cap_ink='#FFFFFF', latin='Inter', transition='crossfade')
    if style == 'bold':
        bg = accent if 0.15 < lum(accent) < 0.85 else mixc(accent, '#808080', 0.4)
        ink = '#0A0A0C' if lum(bg) > 0.5 else '#FFFFFF'
        return dict(bg=bg, ink=ink, soft=mixc(ink, bg, 0.35), accent=mixc(primary, '#000000', 0.25) if lum(bg) > 0.5 else '#FFFFFF',
                    glow='#FFFFFF', glow_a=0.16, dust=False, cap_bg='#000000', cap_a=0.55, cap_ink='#FFFFFF',
                    latin='Inter', transition='push')
    ac = accent if lum(accent) > 0.38 else mixc(accent, '#FFFFFF', 0.55)
    return dict(bg=mixc(primary, '#000000', 0.84), ink='#F8F0DC', soft='#C9C2B0', accent=ac, glow=ac, glow_a=0.30, dust=True,
                cap_bg='#000000', cap_a=0.5, cap_ink='#F8F0DC', latin='Instrument Serif', transition='crossfade')


T = theme(STYLE, BR.get('primary') or '#0B2545', BR.get('accent') or '#E0A526')


# ---- text -----------------------------------------------------------------------------------------

def is_arabic(s):
    return any('؀' <= ch <= 'ۿ' or 'ݐ' <= ch <= 'ݿ' for ch in s)


@functools.lru_cache(maxsize=None)
def wrap_rtl(text, family, size, max_w):
    """Greedy word wrap of one single-direction run, measured with the shaper itself."""
    lines, cur = [], ''
    for word in text.split():
        trial = (cur + ' ' + word).strip()
        if cur and mv.shaped(trial, family, size)[1] > max_w:
            lines.append(cur)
            cur = word
        else:
            cur = trial
    if cur:
        lines.append(cur)
    return tuple(lines)


_NUM = re.compile(r'([0-9\u0660-\u0669\u06F0-\u06F9][0-9\u0660-\u0669\u06F0-\u06F9,.\u066B\u066C]*)')
_WEST = {**{0x0660 + i: ord('0') + i for i in range(10)}, **{0x06F0 + i: ord('0') + i for i in range(10)}, 0x066C: ord(','), 0x066B: ord('.')}


_LAT = re.compile(r"([A-Za-z][A-Za-z0-9'&.\- ]*[A-Za-z0-9]|[A-Za-z])")


def runs(text):
    """Runs in reading order: numbers and Latin words inside Kurdish text are drawn left to right, on their own."""
    out = []
    for part in _NUM.split(text):
        if part == '':
            continue
        if _NUM.fullmatch(part):
            out.append(('num', part.translate(_WEST)))
            continue
        for sub in _LAT.split(part):
            if sub == '':
                continue
            out.append(('lat', sub) if _LAT.fullmatch(sub) else ('txt', sub))
    return out


def has_number(text):
    return any(k != 'txt' for k, _ in runs(text))


def draw_line(c, s, cx, base, family, size, col, a=1.0):
    """One centred line of Kurdish/Arabic text; numbers and Latin words inside it keep their own order."""
    if not has_number(s):
        return mv.text_shaped(c, s, cx, base, family, size, col, a, align='center')
    lf = mv.font('Inter', size * 0.94, wght=700)
    parts = runs(s)
    widths = [mv.shaped(p, family, size)[1] if k == 'txt' else mv.width(p, lf) for k, p in parts]
    x = cx + sum(widths) / 2
    for (k, p), w in zip(parts, widths):
        if k == 'txt':
            mv.text_shaped(c, p, x, base, family, size, col, a, align='right')
        else:
            mv.text(c, p, x - w, base, lf, col, a, align='left', anchor='baseline')
        x -= w
    return sum(widths)


def headline(c, text, cy, max_w, max_size, col, a=1.0, max_lines=2):
    """Centred text of one or two lines at the largest size that fits; Kurdish/Arabic shaped, Latin plain."""
    if not text:
        return 0, 1
    if not is_arabic(text):
        f = mv.fit('Inter', text, max_w, max_size, wght=800)
        mv.text(c, text, W / 2, cy, f, col, a, align='center')
        return f.getSize(), 1
    size = max_size
    lines = wrap_rtl(text, AR_B, size, max_w)
    # One line is better than two when it only costs a little size.
    if len(lines) > 1:
        trial = size
        while trial > max_size * 0.72:
            trial *= 0.94
            if len(wrap_rtl(text, AR_B, trial, max_w)) == 1:
                size, lines = trial, wrap_rtl(text, AR_B, trial, max_w)
                break
    while len(lines) > max_lines and size > max_size * 0.45:
        size *= 0.92
        lines = wrap_rtl(text, AR_B, size, max_w)
    lh = size * 1.3
    top = cy - lh * (len(lines) - 1) / 2
    for i, s in enumerate(lines):
        draw_line(c, s, W / 2, top + lh * i, AR_B, size, col, a)
    return size, len(lines)


def push_down(size, lines):
    """How far what sits under a headline moves when it took more than one line."""
    return max(0, lines - 1) * size * 0.65


def small(c, text, cy, max_w, size, col, a=1.0, family=None):
    if not text:
        return
    if is_arabic(text):
        lines = wrap_rtl(text, family or AR_M, size, max_w)
        for i, s in enumerate(lines[:2]):
            draw_line(c, s, W / 2, cy + size * 1.4 * i, family or AR_M, size, col, a)
    else:
        mv.text(c, text, W / 2, cy, mv.fit('Inter', text, max_w, size, wght=500), col, a, align='center')


# ---- shared drawing ---------------------------------------------------------------------------------

def stage(c, u, gy=0.34, seed=1):
    c.clear(color(T['bg']))
    c.drawRect(skia.Rect.MakeWH(W, H), radial(W / 2, H * gy, L.u(1150), [T['glow'], T['bg']], alphas=[T['glow_a'], 0.0]))
    if T['dust']:
        fx.particles(c, W, H, u, n=36, seed=seed, col=T['ink'], size=(1.5, 4.0), a=(0.08, 0.5), direction=-90, speed=(10, 26), twinkle=0.8, glow=True)
    if STYLE == 'elegant':
        fx.vignette(c, W, H, strength=0.5)


_logo_cache = {}


def logo_image():
    if 'img' not in _logo_cache:
        p = local(BR.get('logo'))
        img = None
        if p and os.path.exists(p):
            try:
                img = mv.image(p)
            except Exception:
                img = None
        _logo_cache['img'] = img
    return _logo_cache['img']


def mark(c, cx, cy, size, a=1.0, t=1e9, t0=0.0):
    """The brand's logo, or a monogram tile in its colours when it has none."""
    img = logo_image()
    if img is not None:
        mv.contain(c, img, cx - size / 2, cy - size / 2, cx + size / 2, cy + size / 2, a)
        return
    letter = next((ch for ch in (BR.get('name') or '?') if ch.isalnum()), '?').upper()
    r = size * 0.45
    glow = paint(T['accent'], 0.45 * a)
    glow.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, r * 0.3))
    c.drawRoundRect(skia.Rect.MakeLTRB(cx - r, cy - r, cx + r, cy + r), r * 0.5, r * 0.5, glow)
    rrect(c, cx - r, cy - r, cx + r, cy + r, r * 0.5, linear(cx - r, cy - r, cx + r, cy + r, [mixc(T['accent'], '#FFFFFF', 0.25), T['accent']], alphas=[a, a]))
    on = '#0A0A0C' if lum(T['accent']) > 0.5 else '#FFFFFF'
    if is_arabic(letter):
        mv.text_shaped(c, letter, cx, cy + r * 0.42, AR_B, r * 1.25, on, a, align='center')
    else:
        mv.text(c, letter, cx, cy, mv.font('Inter', r * 1.2, wght=800), on, a, align='center')


def caption(c, u, i, bottom):
    """The spoken line, burned in (most people watch muted), in the lower safe area."""
    sc = SCENES[i]
    t0 = LEAD[i]
    p = presence(u, t0 - 0.05, t0 + DUR_VO[i] + 0.25, 0.2, 0.25)
    if p <= 0 or not sc.get('voice'):
        return
    size = L.u(50)
    max_w = layout.width(SAFE) - L.u(110)
    if is_arabic(sc['voice']):
        lines = wrap_rtl(sc['voice'], AR_M, size, max_w)
        widest = max(mv.shaped(s, AR_M, size)[1] for s in lines)
    else:
        f = mv.font('Inter', size, wght=500)
        lines = (sc['voice'],)
        widest = min(max_w, mv.width(sc['voice'], f))
    lh = size * 1.5
    pad = L.u(30)
    top = bottom - lh * len(lines)
    with Layer(c, clamp(p * 1.4), dy=(1 - p) * L.u(18)):
        rrect(c, W / 2 - widest / 2 - pad, top - pad * 0.6, W / 2 + widest / 2 + pad, bottom + pad * 0.4, L.u(30), paint(T['cap_bg'], T['cap_a']))
        for k, s in enumerate(lines):
            if is_arabic(s):
                draw_line(c, s, W / 2, top + lh * (k + 0.78), AR_M, size, T['cap_ink'], 1.0)
            else:
                mv.text(c, s, W / 2, top + lh * (k + 0.5), mv.font('Inter', size, wght=500), T['cap_ink'], 1.0, align='center')


def dots(c, index, total, y):
    for k in range(total):
        on = k == index
        c.drawCircle(W / 2 + (k - (total - 1) / 2) * L.u(44), y, L.u(11) if on else L.u(8), paint(T['accent'] if on else T['ink'], 1.0 if on else 0.3))


def underline(c, u, y, width, t0=0.8):
    w = width * out_cubic(seg(u, t0, t0 + 0.6))
    c.drawRect(skia.Rect.MakeLTRB(W / 2 - w / 2, y, W / 2 + w / 2, y + max(2, L.u(3))), paint(T['accent'], 0.95))


# ---- timing -----------------------------------------------------------------------------------------

LEAD, TAIL, DUR_VO = [], [], []
for _i, _s in enumerate(SCENES):
    try:
        _d = sfx.load(local(_s['audio'])).shape[1] / sfx.SR
    except Exception:
        _d = 3.0
    first, last = _i == 0, _i == len(SCENES) - 1
    LEAD.append(0.75 if first else 0.5)
    TAIL.append(2.4 if last else 0.55)
    DUR_VO.append(_d)


def length(i):
    return LEAD[i] + DUR_VO[i] + TAIL[i]


# ---- scenes -----------------------------------------------------------------------------------------

class Hook(Scene):
    def __init__(self, i):
        self.i = i
        super().__init__(length(i))

    def draw(self, c, u):
        sc = SCENES[self.i]
        stage(c, u, gy=0.32, seed=1)
        p = out_cubic(seg(u, 0.0, 1.0))
        cx, cy = W / 2, H * 0.31 + (1 - p) * L.u(150)
        with Layer(c, clamp(p * 1.6), scale=0.82 + 0.18 * p, pivot=(cx, cy)):
            mark(c, cx, cy, L.u(330), t=u, t0=0.0)
        y = H * 0.555
        q = out_cubic(seg(u, 0.55, 1.2))
        with Layer(c, clamp(q * 1.5), dy=(1 - q) * L.u(44)):
            hs, hn = headline(c, sc.get('text') or BR.get('name', ''), y, W * 0.8, L.u(190), T['ink'])
        push = push_down(hs, hn)
        sub = sc.get('sub') or BR.get('tagline')
        q2 = out_cubic(seg(u, 0.95, 1.5))
        with Layer(c, clamp(q2 * 1.5), dy=(1 - q2) * L.u(22)):
            small(c, sub, y + push + L.u(120), W * 0.78, L.u(46), T['soft'])
        underline(c, u, y + push + L.u(205), L.u(300), t0=1.2)
        caption(c, u, self.i, SAFE[3] - L.u(30))


class Value(Scene):
    def __init__(self, i, n, k):
        self.i, self.n, self.k = i, n, k
        super().__init__(length(i))

    def draw(self, c, u):
        sc = SCENES[self.i]
        stage(c, u, gy=0.40, seed=3 + self.k)
        cx, cy = W / 2, H * 0.31
        p = out_back(seg(u, 0.05, 0.65), 1.7)
        with Layer(c, clamp(p * 2), scale=0.6 + 0.4 * p, pivot=(cx, cy)):
            R = L.u(150)
            c.drawCircle(cx, cy, R * 1.28, radial(cx, cy, R * 1.28, [T['accent'], T['bg']], alphas=[0.3, 0.0]))
            c.drawCircle(cx, cy, R, paint(T['accent'], 0.95, stroke=L.u(4)))
            c.drawCircle(cx, cy, R * 0.86, paint(T['ink'], 0.05))
            name = sc.get('icon') or 'sparkles'
            # A name the icon set does not have draws nothing: use the plain star instead.
            icons.draw(c, name if icons.exists(name) else 'sparkles', cx, cy, R * 0.95, T['accent'], stroke=2.2)
        q = out_cubic(seg(u, 0.35, 1.0))
        with Layer(c, clamp(q * 1.5), dy=(1 - q) * L.u(40)):
            hs, hn = headline(c, sc.get('text', ''), H * 0.52, W * 0.8, L.u(170), T['ink'])
        push = push_down(hs, hn)
        underline(c, u, H * 0.52 + push + L.u(64), L.u(220), t0=0.8)
        q2 = out_cubic(seg(u, 0.7, 1.3))
        with Layer(c, clamp(q2 * 1.5)):
            small(c, sc.get('sub'), H * 0.52 + push + L.u(140), W * 0.78, L.u(42), T['soft'])
        dots(c, self.k, self.n, H * 0.69)
        caption(c, u, self.i, SAFE[3] - L.u(30))


class Product(Scene):
    def __init__(self, i):
        self.i = i
        super().__init__(length(i))

    def draw(self, c, u):
        sc = SCENES[self.i]
        stage(c, u, gy=0.35, seed=7)
        photos = JOB.get('photos') or []
        idx = sc.get('photo') if isinstance(sc.get('photo'), int) else 0
        img = None
        if photos:
            try:
                img = mv.image(local(photos[idx % len(photos)]))
            except Exception:
                img = None
        card = (SAFE[0] + L.u(10), H * 0.07, SAFE[2] - L.u(10), H * 0.07 + L.u(860))
        p = out_cubic(seg(u, 0.0, 0.7))
        with Layer(c, clamp(p * 1.6), dy=(1 - p) * L.u(60)):
            c.save()
            c.clipRRect(skia.RRect.MakeRectXY(skia.Rect.MakeLTRB(*card), L.u(46), L.u(46)), skia.ClipOp.kIntersect, True)
            if img is not None:
                mv.cover(c, img, *card, zoom=1.0 + 0.12 * min(1.0, u / max(1.0, length(self.i))), fx=0.5, fy=0.5)
            else:
                rrect(c, *card, 0, paint(T['soft'], 0.25))
            c.restore()
            c.drawRoundRect(skia.Rect.MakeLTRB(*card), L.u(46), L.u(46), paint(T['accent'], 0.9, stroke=L.u(3)))
        q = out_cubic(seg(u, 0.5, 1.1))
        name = (JOB.get('product') or {}).get('name') or sc.get('text', '')
        with Layer(c, clamp(q * 1.5), dy=(1 - q) * L.u(30)):
            hs, hn = headline(c, name, card[3] + L.u(130), W * 0.82, L.u(96), T['ink'])
        push = push_down(hs, hn)
        price = (JOB.get('product') or {}).get('priceLine')
        if price:
            q3 = out_back(seg(u, 0.9, 1.4), 1.6)
            with Layer(c, clamp(q3 * 2), scale=0.8 + 0.2 * q3, pivot=(W / 2, card[3] + L.u(250))):
                headline(c, price, card[3] + push + L.u(250), W * 0.7, L.u(70), T['accent'], max_lines=1)
        elif sc.get('sub'):
            small(c, sc['sub'], card[3] + push + L.u(250), W * 0.78, L.u(44), T['soft'])
        caption(c, u, self.i, SAFE[3] - L.u(30))


class Offer(Scene):
    def __init__(self, i):
        self.i = i
        super().__init__(length(i))

    def draw(self, c, u):
        sc = SCENES[self.i]
        stage(c, u, gy=0.42, seed=11)
        p = out_back(seg(u, 0.05, 0.7), 1.5)
        with Layer(c, clamp(p * 2), scale=0.7 + 0.3 * p, pivot=(W / 2, H * 0.3)):
            icons.draw(c, 'gift', W / 2, H * 0.3, L.u(220), T['accent'], stroke=2.0)
        q = out_cubic(seg(u, 0.35, 1.0))
        with Layer(c, clamp(q * 1.5), dy=(1 - q) * L.u(40)):
            hs, hn = headline(c, sc.get('text', ''), H * 0.5, W * 0.84, L.u(160), T['ink'], max_lines=3)
        push = push_down(hs, hn)
        underline(c, u, H * 0.5 + push + L.u(150), L.u(260), t0=0.9)
        small(c, sc.get('sub'), H * 0.5 + push + L.u(230), W * 0.78, L.u(44), T['soft'])
        caption(c, u, self.i, SAFE[3] - L.u(30))


class CTA(Scene):
    def __init__(self, i):
        self.i = i
        super().__init__(length(i))

    def draw(self, c, u):
        sc = SCENES[self.i]
        stage(c, u, gy=0.30, seed=9)
        p = out_cubic(seg(u, 0.0, 0.8))
        with Layer(c, clamp(p * 1.6), scale=0.85 + 0.15 * p, pivot=(W / 2, H * 0.135)):
            mark(c, W / 2, H * 0.135, L.u(190), t=u, t0=0.0)
        q = out_cubic(seg(u, 0.3, 0.95))
        with Layer(c, clamp(q * 1.5), dy=(1 - q) * L.u(36)):
            headline(c, sc.get('text', ''), H * 0.29, W * 0.86, L.u(130), T['ink'])
        rows = []
        if BR.get('phone'):
            rows.append(('phone-call', BR['phone']))
        if BR.get('handle'):
            rows.append(('at-sign', BR['handle']))
        top = H * 0.36
        card_h = L.u(120) + L.u(130) * max(0, len(rows) - 1) if rows else 0
        if rows:
            card = (SAFE[0] + L.u(30), top, SAFE[2] - L.u(30), top + card_h + L.u(60))
            qc = out_cubic(seg(u, 0.9, 1.5))
            with Layer(c, clamp(qc * 1.6), dy=(1 - qc) * L.u(40)):
                fx.glass(c, card, radius=L.u(44), tint=T['accent'], a=0.10, border=0.5, highlight=0.12)
                for k, (ic, text) in enumerate(rows):
                    rq = out_cubic(seg(u, 1.2 + 0.25 * k, 1.8 + 0.25 * k))
                    ry = card[1] + L.u(95) + k * L.u(130)
                    with Layer(c, clamp(rq * 1.6), dx=(1 - rq) * L.u(60)):
                        icons.draw(c, ic, card[0] + L.u(105), ry, L.u(66), T['accent'], stroke=2.2)
                        row_w = (card[2] - L.u(40)) - (card[0] + L.u(180))
                        mv.text(c, text, card[0] + L.u(180), ry, mv.fit('Inter', text, row_w, L.u(66), wght=700), T['ink'], align='left')
        name_y = (top + card_h + L.u(60) + L.u(110)) if rows else H * 0.42
        q2 = out_cubic(seg(u, 1.9, 2.5))
        with Layer(c, clamp(q2 * 1.6), dy=(1 - q2) * L.u(24)):
            headline(c, BR.get('name', ''), name_y, W * 0.8, L.u(70), T['soft'], max_lines=1)
        caption(c, u, self.i, SAFE[3] - L.u(30))


def build():
    scenes = []
    values = [i for i, s in enumerate(SCENES) if s.get('type') == 'value']
    for i, s in enumerate(SCENES):
        t = s.get('type')
        if t == 'hook':
            scenes.append(Hook(i))
        elif t == 'value':
            scenes.append(Value(i, len(values), values.index(i)))
        elif t == 'product':
            scenes.append(Product(i))
        elif t == 'offer':
            scenes.append(Offer(i))
        else:
            scenes.append(CTA(i))
    return scenes


TRANSITIONS = {'crossfade': crossfade, 'push': push}
tl = Timeline(build(), (W, H), transition=TRANSITIONS[T['transition']], before=0.3, after=0.5)
video = Video(tl, tl.duration, (W, H), FPS, background=T['bg'], grain=0.02 if STYLE == 'elegant' else 0.0)


def soundtrack():
    m = sfx.Mixer(tl.duration)
    style = MUSIC.get('style') if MUSIC.get('style') in ('ambient', 'lofi', 'drive', 'corporate', 'pulse') else 'ambient'
    gain = 0.22 if style in ('drive', 'pulse') else 0.30
    sfx.backing(m, bpm=int(MUSIC.get('bpm') or 84), key=str(MUSIC.get('key') or 'D'), mode=MUSIC.get('mode') or 'minor',
                style=style, gain=gain, fade_in=1.0, fade_out=2.2)
    for k, sc in enumerate(SCENES):
        m.add(sfx.load(local(sc['audio'])), tl.start(k) + LEAD[k], 1.0, bus='voice')
        if k:
            m.add(sfx.blip(560 + 70 * (k % 5)), tl.start(k) + 0.12, 0.2, reverb=0.3)
    m.add(sfx.chime('success'), tl.start(0) + 0.9, 0.28, reverb=0.4)
    m.add(sfx.whoosh(0.45), tl.start(len(SCENES) - 1) - 0.35, 0.28)
    m.add(sfx.chime('success'), tl.start(len(SCENES) - 1) + 1.0, 0.22, reverb=0.4)
    return m.master(os.path.join(BASE, 'audio.wav'), lufs=-14)


if __name__ == '__main__':
    mv.cli(video, audio=soundtrack)
