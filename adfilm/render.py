"""Renders one AI video ad from a job file: python picture + sound, no editor.

The app writes the job (brand, look, scenes, which voice clip belongs to which scene) and worker.mjs
downloads its files next to job.json. This file only draws what the job says; it never runs anything
the job contains, so a model's script can change the words, the order and the look, never the code.

  AD_JOB=job.json python render.py render out.mp4 [--crf 23]      (also: sheet | still 2.5 f.png | info)

The LOOK in the job (layout, photo, icon, background, palette, motion, transition, shape) is what makes
two videos different pictures: they are combined here from small parts, not chosen from three templates.

The job may also name the video's language (lang: 'ar' | 'en'; absent = Sorani Kurdish) and its kind (kind: 'story';
absent = an ad). The language sets the reading direction; a story has 'story' scenes (a kicker, a slow backdrop and
the narration as timed caption chunks) and no product, price, delivery line or phone number.

Engine: the MIT-licensed programmatic-motion-video engine (mv.py and friends, see LICENSE and
THIRD_PARTY_NOTICES.md). Skia draws every frame, ffmpeg encodes.
"""
import functools
import json
import math
import os
import re

import skia

import fx
import icons
import layout
import media
import mv
import sfx
from mv import *

HERE = os.path.dirname(os.path.abspath(__file__))
JOB_FILE = os.environ.get('AD_JOB', os.path.join(HERE, 'job.json'))
BASE = os.path.dirname(os.path.abspath(JOB_FILE))
JOB = json.load(open(JOB_FILE, encoding='utf-8'))
BR = JOB['brand']
SCENES = JOB['scenes']
PLAN = JOB.get('plan') or None
MUSIC = JOB.get('music') or {}

AR_B, AR_M = 'IBM Plex Sans Arabic Bold', 'IBM Plex Sans Arabic Medium'

W, H = mv.env_size((1080, 1920))
FPS = mv.env_fps(30)
L = layout.Frame(W, H)
SAFE = L.safe('social') if L.portrait else L.safe('title')

# ---- the look -------------------------------------------------------------------------------------

_STYLE_PALETTE = {'elegant': 'brand-dark', 'bold': 'brand-flood', 'clean': 'brand-light'}
_L = JOB.get('look') or {}


def _pick(key, options, default):
    v = _L.get(key)
    return v if v in options else default


LOOK = dict(
    layout=_pick('layout', ('center', 'start', 'bottom'), 'center'),
    photo=_pick('photo', ('card', 'full', 'split'), 'card'),
    icon=_pick('icon', ('ring', 'badge', 'bare'), 'ring'),
    background=_pick('background', ('dust', 'grid', 'waves', 'rings', 'glow', 'none'), 'dust'),
    palette=_pick('palette', ('brand-dark', 'brand-light', 'brand-flood', 'duotone', 'cream', 'midnight'),
                  _STYLE_PALETTE.get(JOB.get('style'), 'brand-dark')),
    motion=_pick('motion', ('calm', 'punchy', 'float'), 'calm'),
    transition=_pick('transition', ('crossfade', 'push', 'slide_up', 'zoom_through', 'iris', 'wipe'), 'crossfade'),
    shape=_pick('shape', ('rounded', 'sharp', 'pill'), 'rounded'),
)
RAD = {'rounded': 1.0, 'sharp': 0.12, 'pill': 1.9}[LOOK['shape']]
SP = {'calm': 1.0, 'punchy': 0.6, 'float': 1.15}[LOOK['motion']]


def S(u, a, b):
    """seg() on the look's own clock: a punchy look arrives in 0.6 of the time, a floating one a little slower."""
    return seg(u, a * SP, b * SP)


def drift(u):
    """A slow float for the 'float' motion; nothing otherwise."""
    return math.sin(u * 1.4) * L.u(9) if LOOK['motion'] == 'float' else 0.0


def local(rel):
    """A file the worker put next to the job. Only its name counts: a job can never point outside its folder."""
    return None if not rel else os.path.join(BASE, os.path.basename(str(rel)))


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


def _lin(v):
    v /= 255.0
    return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4


def rel_lum(h):
    r, g, b = rgb(h)
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def contrast(a, b):
    la, lb = rel_lum(a), rel_lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def readable(col, bg, bg2, target=3.0):
    """`col` moved toward white or black until it can be read on both ends of the background."""
    if min(contrast(col, bg), contrast(col, bg2)) >= target:
        return col
    end = '#FFFFFF' if min(rel_lum(bg), rel_lum(bg2)) < 0.3 else '#000000'
    for step in range(1, 11):
        c = mixc(col, end, step / 10)
        if min(contrast(c, bg), contrast(c, bg2)) >= target:
            return c
    return end


def theme(palette, primary, accent):
    """The colours of a palette, built from the brand's own two colours."""
    if palette == 'brand-light':
        ac = accent if lum(accent) < 0.72 else mixc(accent, '#000000', 0.45)
        th = dict(bg='#FAFAF7', bg2='#F1EFE8', ink='#14141A', soft='#5C5C68', accent=ac, glow=accent, glow_a=0.14, dark=False)
    elif palette == 'cream':
        ink = mixc(primary, '#000000', 0.62)
        ac = accent if lum(accent) < 0.7 else mixc(accent, '#000000', 0.4)
        th = dict(bg='#F6EFE2', bg2='#EADFCB', ink=ink, soft=mixc(ink, '#F6EFE2', 0.4), accent=ac, glow=accent, glow_a=0.16, dark=False)
    elif palette == 'brand-flood':
        bg = accent if 0.15 < lum(accent) < 0.85 else mixc(accent, '#808080', 0.4)
        ink = '#0A0A0C' if lum(bg) > 0.5 else '#FFFFFF'
        th = dict(bg=bg, bg2=mixc(bg, '#000000', 0.12), ink=ink, soft=mixc(ink, bg, 0.35),
                  accent=mixc(primary, '#000000', 0.25) if lum(bg) > 0.5 else '#FFFFFF', glow='#FFFFFF', glow_a=0.16, dark=lum(bg) < 0.5)
    elif palette == 'duotone':
        base = primary if lum(primary) < 0.35 else mixc(primary, '#000000', 0.45)
        ac = accent if lum(accent) > 0.38 else mixc(accent, '#FFFFFF', 0.5)
        th = dict(bg=base, bg2=mixc(base, ac, 0.28), ink='#FFFFFF', soft=mixc('#FFFFFF', base, 0.35), accent=ac, glow=ac, glow_a=0.34, dark=True)
    elif palette == 'midnight':
        ac = accent if lum(accent) > 0.45 else mixc(accent, '#FFFFFF', 0.6)
        th = dict(bg='#07080F', bg2='#0D1020', ink='#EDEFF7', soft='#A8ADC4', accent=ac, glow=ac, glow_a=0.22, dark=True)
    else:   # brand-dark
        ac = accent if lum(accent) > 0.38 else mixc(accent, '#FFFFFF', 0.55)
        bg = mixc(primary, '#000000', 0.84)
        th = dict(bg=bg, bg2=mixc(bg, ac, 0.10), ink='#F8F0DC', soft='#C9C2B0', accent=ac, glow=ac, glow_a=0.30, dark=True)
    # The price, the icons and the dots are drawn in the accent: whatever the brand's colours are, it must be readable.
    th['accent'] = readable(th['accent'], th['bg'], th['bg2'])
    return th


T = theme(LOOK['palette'], BR.get('primary') or '#0B2545', BR.get('accent') or '#E0A526')
CAP_BG, CAP_A, CAP_INK = ('#000000', 0.5, '#F8F0DC') if T['dark'] else ('#000000', 0.66, '#FFFFFF')
ON_ACCENT = '#0A0A0C' if lum(T['accent']) > 0.5 else '#FFFFFF'


# ---- text -----------------------------------------------------------------------------------------

def is_arabic(s):
    return any('؀' <= ch <= 'ۿ' or 'ݐ' <= ch <= 'ݿ' for ch in s)


# The video's language travels in the job: 'ar' or 'en' (absent = Sorani, which the app never writes down) and
# its kind: 'story' (absent = an ad). The reading direction follows the language when the job names one; a job
# without it keeps the old guess from the letters (Kurdish brand name -> right to left).
LANG = JOB.get('lang') if JOB.get('lang') in ('ckb', 'ar', 'en') else None
EN = LANG == 'en'
STORY = JOB.get('kind') == 'story'
if LANG:
    RTL = LANG in ('ckb', 'ar')
else:
    RTL = is_arabic((BR.get('name') or '') + ''.join(s.get('text') or '' for s in SCENES))

# The brand's name as it is drawn (the monogram and the name under the call to action). An English video has no
# Arabic-script letters on it: a page named in them is drawn by the Latin form the job carries (brand.latin) or, with
# none, not by name at all (nothing is invented; the monogram becomes an icon). Every other video draws the name as it is.
NAME = BR.get('name', '')
if EN and is_arabic(NAME or ''):
    NAME = BR.get('latin') if isinstance(BR.get('latin'), str) and not is_arabic(BR.get('latin')) else ''


def _text_width(s, family, size):
    return mv.shaped(s, family, size)[1]


@functools.lru_cache(maxsize=None)
def wrap_rtl(text, family, size, max_w):
    """Greedy word wrap of one single-direction run, measured with the shaper itself."""
    lines, cur = [], ''
    for word in text.split():
        trial = (cur + ' ' + word).strip()
        if cur and _text_width(trial, family, size) > max_w:
            lines.append(cur)
            cur = word
        else:
            cur = trial
    if cur:
        lines.append(cur)
    return tuple(lines)


@functools.lru_cache(maxsize=None)
def _inter(size, wght):
    return mv.font('Inter', size, wght=wght)


@functools.lru_cache(maxsize=None)
def wrap_ltr(text, size, wght, max_w):
    """Greedy word wrap of Latin text in Inter."""
    f = _inter(size, wght)
    lines, cur = [], ''
    for word in text.split():
        trial = (cur + ' ' + word).strip()
        if cur and mv.width(trial, f) > max_w:
            lines.append(cur)
            cur = word
        else:
            cur = trial
    if cur:
        lines.append(cur)
    return tuple(lines)


# One left-to-right run is a whole Latin phrase or number with the spaces and marks inside it, so
# "iPhone 15 Pro Max" and "25,000" are drawn in reading order even inside Kurdish text.
_DIG = '0-9٠-٩۰-۹'
_CORE = 'A-Za-z' + _DIG
_LTR = re.compile("[" + _CORE + "](?:[" + _CORE + "'&.,%٫٬\\- ]*[" + _CORE + "%])?")
_WEST = {**{0x0660 + i: ord('0') + i for i in range(10)}, **{0x06F0 + i: ord('0') + i for i in range(10)}, 0x066C: ord(','), 0x066B: ord('.')}


def runs(text):
    """Runs in reading order: ('ltr', ...) for Latin and numbers, ('txt', ...) for the rest."""
    out, i = [], 0
    for m in _LTR.finditer(text):
        if m.start() > i:
            out.append(('txt', text[i:m.start()]))
        out.append(('ltr', m.group(0).translate(_WEST)))
        i = m.end()
    if i < len(text):
        out.append(('txt', text[i:]))
    return out


def has_mixed(text):
    return any(k != 'txt' for k, _ in runs(text))


def _ltr_parts(s, family, size, lf):
    """[(kind, text, dx, width)] for a mixed line read left to right (an English video that holds an Arabic-script
    word, such as a page name). The word is shaped on its own, so the spaces around it are measured here: shaped
    inside the run, a leading space would land at its far end. Known limit: punctuation that touches an Arabic
    word stays inside that run."""
    sp = mv.width(' ', lf)
    out = []
    for k, p in runs(s):
        if k != 'txt':
            out.append((k, p, 0.0, mv.width(p, lf)))
            continue
        core = p.strip()
        lead = (len(p) - len(p.lstrip())) * sp
        trail = (len(p) - len(p.rstrip())) * sp if core else 0.0
        out.append((k, core, lead, lead + (_text_width(core, family, size) if core else 0.0) + trail))
    return out


def line_width(s, family, size):
    if not has_mixed(s):
        return _text_width(s, family, size)
    lf = _inter(size * 0.94, 700)
    if EN:
        return sum(w for _, _, _, w in _ltr_parts(s, family, size, lf))
    return sum(_text_width(p, family, size) if k == 'txt' else mv.width(p, lf) for k, p in runs(s))


def draw_line(c, s, cx, base, family, size, col, a=1.0):
    """One line of Kurdish/Arabic text centred on cx; numbers and Latin words inside it keep their own order."""
    if not has_mixed(s):
        return mv.text_shaped(c, s, cx, base, family, size, col, a, align='center')
    lf = _inter(size * 0.94, 700)
    if EN:
        # An English video reads left to right: the runs go from the left edge of the line, each in its own direction.
        parts = _ltr_parts(s, family, size, lf)
        total = sum(w for _, _, _, w in parts)
        x = cx - total / 2
        for k, p, dx, w in parts:
            if p:
                if k == 'txt':
                    mv.text_shaped(c, p, x + dx, base, family, size, col, a, align='left')
                else:
                    mv.text(c, p, x, base, lf, col, a, align='left', anchor='baseline')
            x += w
        return total
    parts = runs(s)
    widths = [_text_width(p, family, size) if k == 'txt' else mv.width(p, lf) for k, p in parts]
    x = cx + sum(widths) / 2
    for (k, p), w in zip(parts, widths):
        if k == 'txt':
            mv.text_shaped(c, p, x, base, family, size, col, a, align='right')
        else:
            mv.text(c, p, x - w, base, lf, col, a, align='left', anchor='baseline')
        x -= w
    return sum(widths)


def anchor_x(width):
    """Where a block of this width is centred: the middle, or against the side the video is read from."""
    if LOOK['layout'] != 'start':
        return W / 2
    edge = L.u(14)
    return SAFE[2] - edge - width / 2 if RTL else SAFE[0] + edge + width / 2


def head_plan(text, max_w, max_size, max_lines=2, family=AR_B, wght=800):
    """(size, lines): the largest size at which the text fits in at most max_lines lines, none wider than max_w.

    One line is preferred over two when it only costs a little size; a single long word is shrunk, never cut."""
    if not text:
        return 0, ()
    arabic = is_arabic(text)

    def wrap(size):
        return wrap_rtl(text, family, size, max_w) if arabic else wrap_ltr(text, size, wght, max_w)

    def widest(lines, size):
        return max(line_width(s, family, size) if arabic else mv.width(s, _inter(size, wght)) for s in lines) if lines else 0

    size = max_size
    lines = wrap(size)
    if len(lines) > 1:
        trial = size
        while trial > max_size * 0.72:
            trial *= 0.94
            one = wrap(trial)
            if len(one) == 1 and widest(one, trial) <= max_w:
                size, lines = trial, one
                break
    while (len(lines) > max_lines or widest(lines, size) > max_w) and size > max_size * 0.45:
        size *= 0.92
        lines = wrap(size)
    return size, lines


def headline(c, text, cy, max_w, max_size, col, a=1.0, max_lines=2, plan=None):
    """Text of one or two lines at the largest size that fits. Returns (size, number of lines)."""
    size, lines = plan if plan is not None else head_plan(text, max_w, max_size, max_lines)
    if not lines:
        return 0, 1
    lh = size * 1.3
    top = cy - lh * (len(lines) - 1) / 2
    if is_arabic(text):
        widest = max(line_width(s, AR_B, size) for s in lines)
        cx = anchor_x(widest)
        for i, s in enumerate(lines):
            draw_line(c, s, cx, top + lh * i, AR_B, size, col, a)
    else:
        f = _inter(size, 800)
        widest = max(mv.width(s, f) for s in lines)
        cx = anchor_x(widest)
        for i, s in enumerate(lines):
            mv.text(c, s, cx, top + lh * i, f, col, a, align='center')
    return size, len(lines)


def push_down(size, lines):
    """How far what sits under a headline moves when it took more than one line."""
    return max(0, lines - 1) * size * 0.65


def small_plan(text, max_w, size):
    """(size, lines) for the small line under a headline: two lines at a size that fits, three at the smallest."""
    if not text:
        return size, ()
    arabic = is_arabic(text)
    fam = AR_M

    def wrap(sz):
        return wrap_rtl(text, fam, sz, max_w) if arabic else wrap_ltr(text, sz, 500, max_w)

    def widest(lines, sz):
        return max(line_width(s, fam, sz) if arabic else mv.width(s, _inter(sz, 500)) for s in lines) if lines else 0

    sz = size
    lines = wrap(sz)
    while (len(lines) > 2 or widest(lines, sz) > max_w) and sz > size * 0.62:
        sz *= 0.93
        lines = wrap(sz)
    return sz, lines[:3]


def small_height(plan):
    sz, lines = plan
    return sz * 1.4 * len(lines)


def small(c, text, cy, max_w, size, col, a=1.0, plan=None):
    sz, lines = plan if plan is not None else small_plan(text, max_w, size)
    if not lines:
        return 0
    if is_arabic(text):
        cx = anchor_x(max(line_width(s, AR_M, sz) for s in lines))
        for i, s in enumerate(lines):
            draw_line(c, s, cx, cy + sz * 1.4 * i, AR_M, sz, col, a)
    else:
        f = _inter(sz, 500)
        cx = anchor_x(max(mv.width(s, f) for s in lines))
        for i, s in enumerate(lines):
            mv.text(c, s, cx, cy + sz * 1.4 * i, f, col, a, align='center')
    return len(lines)


def r(x):
    """A corner radius in this look's shape."""
    return x * RAD


# ---- the caption and the space above it -------------------------------------------------------------

CAP_BOTTOM = SAFE[3] - L.u(30)
CAP_SIZES = [L.u(50), L.u(44), L.u(40), L.u(36)]
# What a scene draws stays above this line: a two-line caption box ends here, with a margin. An English video
# also allows a third line at 40 px (its sentences are longer in letters), so it keeps a little more room.
CAP_TOP = CAP_BOTTOM - max(2 * CAP_SIZES[0], 3 * CAP_SIZES[2] if EN else 0) * 1.5 - L.u(18) - L.u(40)


def room(y, extent):
    """The headline's y, moved up if the block under it (extent px) would run into the caption."""
    return min(y, CAP_TOP - extent)


def caption_lines(text, max_w):
    """(size, lines): the spoken line at the largest size that makes two lines, three at the smallest
    (English: three lines from 40 px on)."""
    arabic = is_arabic(text)
    for i, size in enumerate(CAP_SIZES):
        lines = wrap_rtl(text, AR_M, size, max_w) if arabic else wrap_ltr(text, size, 500, max_w)
        widest = max(line_width(s, AR_M, size) if arabic else mv.width(s, _inter(size, 500)) for s in lines) if lines else 0
        most = 3 if (EN and i >= 2) else 2
        if (len(lines) <= most and widest <= max_w) or i == len(CAP_SIZES) - 1:
            return size, lines
    return CAP_SIZES[-1], ()


def _caption_box(c, text, alpha, dy, bottom):
    """One caption box (the spoken words on a dark pill) with its bottom edge on `bottom`."""
    max_w = layout.width(SAFE) - L.u(110)
    size, lines = caption_lines(text, max_w)
    if not lines:
        return
    arabic = is_arabic(text)
    widest = max(line_width(s, AR_M, size) if arabic else mv.width(s, _inter(size, 500)) for s in lines)
    lh = size * 1.5
    pad = L.u(30)
    top = bottom - lh * len(lines)
    with Layer(c, alpha, dy=dy):
        rrect(c, W / 2 - widest / 2 - pad, top - pad * 0.6, W / 2 + widest / 2 + pad, bottom + pad * 0.4, min(L.u(30) * RAD, (lh * len(lines) + pad) / 2), paint(CAP_BG, CAP_A))
        for k, s in enumerate(lines):
            if arabic:
                draw_line(c, s, W / 2, top + lh * (k + 0.78), AR_M, size, CAP_INK, 1.0)
            else:
                mv.text(c, s, W / 2, top + lh * (k + 0.5), _inter(size, 500), CAP_INK, 1.0, align='center')


# A story beat is up to 32 spoken words: too long for the one caption box an ad line uses. It is shown as
# timed chunks instead: sentence by sentence, and a long sentence cut into balanced pieces.
CHUNK_WORDS = 12
_CLOSERS_RAW = '"\'”’»)]'
_CLOSERS = re.escape(_CLOSERS_RAW)
# English words a caption should not end on (the cut then moves a word or two); other languages are not touched.
_DANGLING = frozenset('a an the of to in on at by for from with and or but that his her their its my your our is was were be as if so than into onto over'.split())
_CHUNK_END = re.compile('[.!?…؟۔،]+[' + _CLOSERS + ']*$')
_CHUNK_SOFT = re.compile('[,;:—–]+[' + _CLOSERS + ']*$')


def _balanced(words, limit):
    """`words` in the fewest pieces of at most `limit` words, as even as possible; a comma near a cut wins."""
    n = len(words)
    k = -(-n // limit)
    out, start = [], 0
    for j in range(1, k):
        cut = round(n * j / k)
        near = [cut + d for d in (0, 1, -1, 2, -2)]
        fits = [p for p in near if start < p < n and p - start <= limit and n - p <= (k - j) * limit]
        # a comma first, then at least not right after 'the', 'from', 'and'...
        pick = next((p for p in fits if _CHUNK_SOFT.search(words[p - 1])), None)
        if pick is None:
            pick = next((p for p in fits if words[p - 1].strip(_CLOSERS_RAW).lower() not in _DANGLING), None)
        if pick is not None:
            cut = pick
        cut = max(start + 1, min(cut, n - (k - j)))
        out.append(words[start:cut])
        start = cut
    out.append(words[start:])
    return out


@functools.lru_cache(maxsize=None)
def caption_chunks(text):
    """The narration cut for the screen: sentences first, then pieces of at most CHUNK_WORDS words; a piece of one or
    two words (an abbreviation, 'Yes.') joins its neighbour."""
    sentences, cur = [], []
    for word in (text or '').split():
        cur.append(word)
        if _CHUNK_END.search(word):
            sentences.append(cur)
            cur = []
    if cur:
        sentences.append(cur)
    pieces = []
    for sent in sentences:
        pieces.extend(_balanced(sent, CHUNK_WORDS) if len(sent) > CHUNK_WORDS else [sent])
    merged = []
    for piece in pieces:
        if merged and len(merged[-1]) < 3 and len(merged[-1]) + len(piece) <= CHUNK_WORDS:
            merged[-1] = merged[-1] + piece
        else:
            merged.append(piece)
    if len(merged) > 1 and len(merged[-1]) < 3 and len(merged[-2]) + len(merged[-1]) <= CHUNK_WORDS:
        tail = merged.pop()
        merged[-1] = merged[-1] + tail
    return tuple(' '.join(p) for p in merged)


def chunk_spans(i):
    """[(text, start, end)] of scene i's caption chunks on the scene's clock: each lasts as long as its share of the
    letters, over the length of the spoken clip."""
    chunks = caption_chunks(SCENES[i].get('voice') or '')
    weights = [max(1, len(ch)) for ch in chunks]
    total = sum(weights) or 1
    t, out = LEAD[i], []
    for ch, w in zip(chunks, weights):
        d = DUR_VO[i] * w / total
        out.append((ch, t, t + d))
        t += d
    return out


def story_caption(c, u, i, bottom):
    t0 = LEAD[i]
    p = presence(u, t0 - 0.05, t0 + DUR_VO[i] + 0.25, 0.2, 0.25)
    spans = chunk_spans(i)
    if p <= 0 or not spans:
        return
    k = max((j for j, (_, a, _b) in enumerate(spans) if u >= a), default=0)
    text, a, _ = spans[k]
    # a new chunk settles into place over a tenth of a second; the first one and the last one fade as an ad's caption does
    q = out_cubic(seg(u, a, a + 0.14)) if k else 1.0
    _caption_box(c, text, clamp(p * 1.4), (1 - p) * L.u(18) + (1 - q) * L.u(8), bottom)


def caption(c, u, i, bottom=None):
    """The spoken line, burned in (most people watch muted), in the lower safe area."""
    sc = SCENES[i]
    t0 = LEAD[i]
    bottom = CAP_BOTTOM if bottom is None else bottom
    if (STORY or sc.get('type') == 'story') and sc.get('voice'):
        return story_caption(c, u, i, bottom)
    p = presence(u, t0 - 0.05, t0 + DUR_VO[i] + 0.25, 0.2, 0.25)
    if p <= 0 or not sc.get('voice'):
        return
    _caption_box(c, sc['voice'], clamp(p * 1.4), (1 - p) * L.u(18), bottom)


# ---- shared drawing ---------------------------------------------------------------------------------

def stage(c, u, gy=0.34, seed=1):
    c.drawRect(skia.Rect.MakeWH(W, H), linear(0, 0, 0, H, [T['bg'], T['bg2']]))
    bgm = LOOK['background']
    if bgm != 'none':
        c.drawRect(skia.Rect.MakeWH(W, H), radial(W / 2, H * gy, L.u(1150), [T['glow'], T['bg']], alphas=[T['glow_a'], 0.0]))
    if bgm == 'dust':
        fx.particles(c, W, H, u, n=36, seed=seed, col=T['ink'], size=(1.5, 4.0), a=(0.08, 0.5), direction=-90, speed=(10, 26), twinkle=0.8, glow=True)
    elif bgm == 'grid':
        fx.grid(c, W, H, u, step=L.u(96), col=T['ink'], a=0.07, drift=(0, L.u(28)))
    elif bgm == 'waves':
        fx.waves(c, W, H, u, lines=7, amp=L.u(46), col=T['accent'], a=0.2, period=10.0, y=H * 0.8)
    elif bgm == 'rings':
        fx.pulse_rings(c, W / 2, H * gy, u, period=3.4, rings=4, r0=L.u(130), r1=L.u(720), col=T['accent'], width=L.u(3), a=0.26)
    if T['dark'] and LOOK['palette'] in ('brand-dark', 'midnight'):
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


def mark(c, cx, cy, size, a=1.0):
    """The brand's logo, or a monogram tile in its colours when it has none."""
    img = logo_image()
    if img is not None:
        mv.contain(c, img, cx - size / 2, cy - size / 2, cx + size / 2, cy + size / 2, a)
        return
    name = NAME or '?'
    letter = next((ch for ch in name if ch.isalnum()), '?').upper()
    h = size * 0.45
    cr = min(h, h * 0.5 * RAD)
    glow = paint(T['accent'], 0.45 * a)
    glow.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, h * 0.3))
    c.drawRoundRect(skia.Rect.MakeLTRB(cx - h, cy - h, cx + h, cy + h), cr, cr, glow)
    rrect(c, cx - h, cy - h, cx + h, cy + h, cr, linear(cx - h, cy - h, cx + h, cy + h, [mixc(T['accent'], '#FFFFFF', 0.25), T['accent']], alphas=[a, a]))
    if is_arabic(letter):
        mv.text_shaped(c, letter, cx, cy + h * 0.42, AR_B, h * 1.25, ON_ACCENT, a, align='center')
    elif EN and letter == '?':
        icons.draw(c, 'sparkles', cx, cy, h * 1.1, ON_ACCENT, stroke=2.4)    # an English video with no Latin name to take a letter from
    else:
        mv.text(c, letter, cx, cy, _inter(h * 1.2, 800), ON_ACCENT, a, align='center')


def dots(c, index, total, y):
    gap = L.u(44)
    cx = anchor_x(gap * (total - 1) + L.u(22))
    for k in range(total):
        on = k == index
        c.drawCircle(cx + (k - (total - 1) / 2) * gap, y, L.u(11) if on else L.u(8), paint(T['accent'] if on else T['ink'], 1.0 if on else 0.3))


def underline(c, u, y, width, t0=0.8):
    w = width * out_cubic(S(u, t0, t0 + 0.6))
    x = anchor_x(width)
    h = max(2, L.u(3))
    left = x - w / 2 if LOOK['layout'] != 'start' else (x + width / 2 - w if RTL else x - width / 2)
    c.drawRect(skia.Rect.MakeLTRB(left, y, left + w, y + h), paint(T['accent'], 0.95))


def tint_bottom(c, top, a=0.78):
    """A dark veil from `top` down, for text over a photo or a clip."""
    c.drawRect(skia.Rect.MakeLTRB(0, top, W, H), linear(0, top, 0, H, ['#000000'] * 3, alphas=[0.0, a * 0.8, a], pos=[0.0, 0.5, 1.0]))


# ---- timing -----------------------------------------------------------------------------------------

LEAD, TAIL, DUR_VO = [], [], []
_lead = {'calm': 0.75, 'punchy': 0.4, 'float': 0.6}[LOOK['motion']]
_tail = {'calm': 0.5, 'punchy': 0.3, 'float': 0.5}[LOOK['motion']]
for _i, _s in enumerate(SCENES):
    try:
        _d = sfx.load(local(_s['audio'])).shape[1] / sfx.SR
    except Exception:
        _d = 3.0
    first, last = _i == 0, _i == len(SCENES) - 1
    LEAD.append(_lead if first else min(_lead, 0.5))
    TAIL.append(2.4 if last else _tail)
    DUR_VO.append(_d)


def length(i):
    return LEAD[i] + DUR_VO[i] + TAIL[i]


def text_y(base):
    """Where the main text block sits: the 'bottom' layout lets the picture breathe above it."""
    return base + (L.u(110) if LOOK['layout'] == 'bottom' else 0)


# ---- scenes -----------------------------------------------------------------------------------------

class Hook(Scene):
    def __init__(self, i):
        self.i = i
        super().__init__(length(i))

    def draw(self, c, u):
        sc = SCENES[self.i]
        stage(c, u, gy=0.32, seed=1)
        text = sc.get('text') or NAME
        sub = sc.get('sub') or BR.get('tagline')
        if EN and is_arabic(sub or ''):
            sub = None      # an English video has no Arabic-script letters on it
        hp = head_plan(text, W * 0.8, L.u(190))
        sp = small_plan(sub, W * 0.78, L.u(46))
        push = push_down(hp[0], len(hp[1]) or 1)
        extent = push + L.u(205) + max(0, len(sp[1]) - 1) * sp[0] * 1.4 + L.u(12)
        y = room(text_y(H * 0.555), extent)

        p = out_cubic(S(u, 0.0, 1.0))
        cx = anchor_x(L.u(330)) if LOOK['layout'] == 'start' else W / 2
        # The mark sits a little above where a one-line headline starts. A title of two lines (a story's, or any
        # headline of a video in Arabic or English) starts higher by half its height, and the mark rises with it,
        # inside the safe area (a smaller mark when the room is short). A Sorani ad is placed exactly as it was.
        msize = L.u(330)
        lift = (push + L.u(20)) if (len(hp[1]) > 1 and (STORY or LANG in ('ar', 'en'))) else 0.0
        if lift:
            msize = min(msize, max(L.u(190), y - hp[0] * 0.55 - L.u(30) - lift - SAFE[1]))
        cy = min(H * 0.30, y - hp[0] * 0.55 - msize * 0.5 - L.u(30) - lift) + (1 - p) * L.u(150) + drift(u)
        with Layer(c, clamp(p * 1.6), scale=0.82 + 0.18 * p, pivot=(cx, cy)):
            mark(c, cx, cy, msize)
        q = out_cubic(S(u, 0.55, 1.2))
        with Layer(c, clamp(q * 1.5), dy=(1 - q) * L.u(44) + drift(u)):
            headline(c, text, y, W * 0.8, L.u(190), T['ink'], plan=hp)
        q2 = out_cubic(S(u, 0.95, 1.5))
        with Layer(c, clamp(q2 * 1.5), dy=(1 - q2) * L.u(22)):
            small(c, sub, y + push + L.u(120), W * 0.78, L.u(46), T['soft'], plan=sp)
        underline(c, u, y + push + L.u(205) + max(0, len(sp[1]) - 1) * sp[0] * 1.4, L.u(300), t0=1.2)
        caption(c, u, self.i)


def draw_icon(c, name, cx, cy, size):
    name = name if icons.exists(name) else 'sparkles'
    icons.draw(c, name, cx, cy, size, T['accent'], stroke=2.2)


class Value(Scene):
    def __init__(self, i, n, k):
        self.i, self.n, self.k = i, n, k
        super().__init__(length(i))

    def draw(self, c, u):
        sc = SCENES[self.i]
        stage(c, u, gy=0.40, seed=3 + self.k)
        R = L.u(150)
        hp = head_plan(sc.get('text', ''), W * 0.8, L.u(170))
        sp = small_plan(sc.get('sub'), W * 0.78, L.u(42))
        push = push_down(hp[0], len(hp[1]) or 1)
        sub_h = small_height(sp)
        extent = push + L.u(140) + sub_h + L.u(70)
        y = room(text_y(H * 0.52), extent)

        cx = anchor_x(L.u(300)) if LOOK['layout'] == 'start' else W / 2
        cy = max(SAFE[1] + R * 1.4, min(H * 0.30, y - hp[0] * 0.55 - R * 1.55)) + drift(u)
        p = out_back(S(u, 0.05, 0.65), 1.7)
        with Layer(c, clamp(p * 2), scale=0.6 + 0.4 * p, pivot=(cx, cy)):
            if LOOK['icon'] == 'ring':
                c.drawCircle(cx, cy, R * 1.28, radial(cx, cy, R * 1.28, [T['accent'], T['bg']], alphas=[0.3, 0.0]))
                c.drawCircle(cx, cy, R, paint(T['accent'], 0.95, stroke=L.u(4)))
                c.drawCircle(cx, cy, R * 0.86, paint(T['ink'], 0.05))
                draw_icon(c, sc.get('icon') or 'sparkles', cx, cy, R * 0.95)
            elif LOOK['icon'] == 'badge':
                h = R * 0.95
                cr = min(h, r(L.u(70)))
                rrect(c, cx - h, cy - h, cx + h, cy + h, cr, linear(cx - h, cy - h, cx + h, cy + h, [mixc(T['accent'], '#FFFFFF', 0.2), T['accent']]))
                icons.draw(c, sc.get('icon') if icons.exists(sc.get('icon') or '') else 'sparkles', cx, cy, h * 1.05, ON_ACCENT, stroke=2.4)
            else:
                c.drawCircle(cx, cy, R * 1.5, radial(cx, cy, R * 1.5, [T['accent'], T['bg']], alphas=[0.32, 0.0]))
                draw_icon(c, sc.get('icon') or 'sparkles', cx, cy, R * 1.25)
        q = out_cubic(S(u, 0.35, 1.0))
        with Layer(c, clamp(q * 1.5), dy=(1 - q) * L.u(40) + drift(u)):
            headline(c, sc.get('text', ''), y, W * 0.8, L.u(170), T['ink'], plan=hp)
        underline(c, u, y + push + L.u(64), L.u(220), t0=0.8)
        q2 = out_cubic(S(u, 0.7, 1.3))
        with Layer(c, clamp(q2 * 1.5)):
            small(c, sc.get('sub'), y + push + L.u(140), W * 0.78, L.u(42), T['soft'], plan=sp)
        dots(c, self.k, self.n, y + push + L.u(140) + sub_h + L.u(40))
        caption(c, u, self.i)


def photo_image(index):
    photos = JOB.get('photos') or []
    if not photos:
        return None
    try:
        return mv.image(local(photos[index % len(photos)]))
    except Exception:
        return None


class Product(Scene):
    def __init__(self, i):
        self.i = i
        super().__init__(length(i))

    def draw(self, c, u):
        sc = SCENES[self.i]
        stage(c, u, gy=0.35, seed=7)
        idx = sc.get('photo') if isinstance(sc.get('photo'), int) else 0
        img = photo_image(idx)
        zoom = 1.0 + 0.12 * min(1.0, u / max(1.0, length(self.i)))
        name = (JOB.get('product') or {}).get('name') or sc.get('text', '')
        if EN and is_arabic(name or ''):
            name = sc.get('text', '')      # an English video has no Arabic-script letters: the writer's Latin line stands
        price = (JOB.get('product') or {}).get('priceLine')
        # The day's plan decides whether the price is shown (left out, buyers ask in the comments).
        # A video made without a plan (the owner chose the product, or the strategist was away) shows it.
        show_price = bool(price) and (PLAN is None or PLAN.get('priceMode') == 'conversion')
        mode = LOOK['photo']
        hp = head_plan(name, W * 0.8, L.u(92))
        push = push_down(hp[0], len(hp[1]) or 1)
        sp = small_plan(sc.get('sub'), W * 0.78, L.u(44))
        below = L.u(120) if (show_price or sc.get('sub')) else 0
        # Everything under the picture: the name, then the price (or the small line), kept above the caption.
        text_h = push + below + (small_height(sp) if (sc.get('sub') and not show_price) else L.u(50)) + L.u(20)
        p = out_cubic(S(u, 0.0, 0.7))

        if mode == 'full':
            with Layer(c, clamp(p * 1.4)):
                if img is not None:
                    mv.cover(c, img, 0, 0, W, H, zoom=zoom, fx=0.5, fy=0.5)
                else:
                    c.drawRect(skia.Rect.MakeWH(W, H), paint(T['soft'], 0.3))
                tint_bottom(c, H * 0.28, 0.9)
            ty = room(H * 0.6, text_h)
            name_col, price_col, sub_col = '#FFFFFF', '#FFFFFF', '#FFFFFF'
        else:
            if mode == 'card':
                # an inset card with a gold edge, the text under it
                gap = L.u(130)
                top = H * 0.07
                card = (SAFE[0] + L.u(10), top, SAFE[2] - L.u(10), min(top + L.u(860), CAP_TOP - gap - text_h))
                cr = r(L.u(46))
            else:
                # split: the picture bleeds off the top and sides, the text sits on the colour below it
                gap = L.u(150)
                cr = max(r(L.u(80)), 6)
                card = (0, -cr * 2, W, min(H * 0.5, CAP_TOP - gap - text_h))
            card = (card[0], card[1], card[2], max(card[3], card[1] + L.u(400)))
            ty = card[3] + gap
            with Layer(c, clamp(p * 1.6), dy=(1 - p) * L.u(60)):
                c.save()
                c.clipRRect(skia.RRect.MakeRectXY(skia.Rect.MakeLTRB(*card), cr, cr), skia.ClipOp.kIntersect, True)
                if img is not None:
                    mv.cover(c, img, *card, zoom=zoom, fx=0.5, fy=0.5)
                else:
                    c.drawRect(skia.Rect.MakeLTRB(*card), paint(T['soft'], 0.25))
                c.restore()
                c.drawRoundRect(skia.Rect.MakeLTRB(*card), cr, cr, paint(T['accent'], 0.9, stroke=L.u(3)))
            name_col, price_col, sub_col = T['ink'], T['accent'], T['soft']

        q = out_cubic(S(u, 0.5, 1.1))
        with Layer(c, clamp(q * 1.5), dy=(1 - q) * L.u(30) + drift(u)):
            headline(c, name, ty, W * 0.8, L.u(92), name_col, plan=hp)
        if show_price:
            q3 = out_back(S(u, 0.9, 1.4), 1.6)
            with Layer(c, clamp(q3 * 2), scale=0.8 + 0.2 * q3, pivot=(W / 2, ty + push + L.u(120))):
                headline(c, price, ty + push + L.u(120), W * 0.7, L.u(70), price_col, max_lines=1)
        elif sc.get('sub'):
            small(c, sc['sub'], ty + push + L.u(120), W * 0.78, L.u(44), sub_col, plan=sp)
        caption(c, u, self.i)


_foot_cache = {}


def footage(index, scene_index):
    """One decoder per scene: two scenes that share a clip are on screen together while they cross-fade,
    and one decoder asked for two different times would restart ffmpeg on every frame."""
    clips = JOB.get('clips') or []
    if not clips:
        return None
    key = (scene_index, index % len(clips))
    if key not in _foot_cache:
        try:
            f = media.Footage(local(clips[key[1]]), fit=(W, H), loop=True)
            # Scenes on one clip start at different points, so they are not the same seconds twice.
            if f.duration and f.duration > 6:
                f.start = (scene_index * 1.7) % max(0.5, f.duration - 3.0)
            _foot_cache[key] = f
        except Exception:
            _foot_cache[key] = None
    return _foot_cache[key]


class Clip(Scene):
    """One of the owner's own clips behind the text: the real shop, not a drawing of it."""

    def __init__(self, i):
        self.i = i
        super().__init__(length(i))

    def draw(self, c, u):
        sc = SCENES[self.i]
        c.clear(color(T['bg']))
        f = footage(sc.get('clip') if isinstance(sc.get('clip'), int) else 0, self.i)
        p = out_cubic(S(u, 0.0, 0.5))
        if f is not None:
            f.draw(c, u, (0, 0, W, H), mode='cover', a=clamp(p * 1.5), zoom=1.0 + 0.04 * min(1.0, u / 6.0))
        else:
            stage(c, u, gy=0.4, seed=5)
        tint_bottom(c, H * 0.4, 0.86)
        text = sc.get('text') or ''
        if text:
            hp = head_plan(text, W * 0.82, L.u(120))
            sp = small_plan(sc.get('sub'), W * 0.78, L.u(44))
            push = push_down(hp[0], len(hp[1]) or 1)
            y = room(H * 0.56, push + L.u(100) + small_height(sp) + L.u(20))
            q = out_cubic(S(u, 0.4, 1.0))
            with Layer(c, clamp(q * 1.5), dy=(1 - q) * L.u(40)):
                headline(c, text, y, W * 0.82, L.u(120), '#FFFFFF', plan=hp)
            small(c, sc.get('sub'), y + push + L.u(100), W * 0.78, L.u(44), '#FFFFFF', plan=sp)
        caption(c, u, self.i)


class Story(Scene):
    """One beat of a story: a short kicker over a slow backdrop (the owner's clip, else a picture, else the look's own
    background). The narration is the caption, shown a few words at a time. No icon, no price, nothing to buy."""

    def __init__(self, i, n, k):
        self.i, self.n, self.k = i, n, k
        super().__init__(length(i))

    def backdrop(self, c, u, sc, prog):
        """Draws the backdrop; True when it is a clip or a picture (the text then sits on a dark veil)."""
        p = out_cubic(S(u, 0.0, 0.6))
        if isinstance(sc.get('clip'), int):
            f = footage(sc['clip'], self.i)
            if f is not None:
                c.clear(color(T['bg']))
                f.draw(c, u, (0, 0, W, H), mode='cover', a=clamp(p * 1.5), zoom=1.0 + 0.05 * prog)
                return True
        if isinstance(sc.get('photo'), int):
            img = photo_image(sc['photo'])
            if img is not None:
                c.clear(color(T['bg']))
                # A slow push-in that drifts sideways; the direction alternates from beat to beat.
                sgn = 1 if self.k % 2 == 0 else -1
                mv.cover(c, img, 0, 0, W, H, a=clamp(p * 1.5), zoom=1.04 + 0.12 * prog,
                         fx=0.5 + sgn * (prog - 0.5) * 0.4, fy=0.5 - sgn * (prog - 0.5) * 0.2)
                return True
        stage(c, u, gy=0.34 + 0.05 * math.sin(u * 0.4 + self.k), seed=21 + self.k)
        # A beat lasts ten seconds or more: a soft light drifts across the empty background so it never looks frozen.
        gx, gy = W * (0.5 + 0.28 * math.sin(u * 0.33 + self.k * 1.7)), H * (0.30 + 0.05 * math.cos(u * 0.27 + self.k))
        c.drawCircle(gx, gy, L.u(700), radial(gx, gy, L.u(700), [T['accent'], T['bg']], alphas=[0.11, 0.0]))
        return False

    def draw(self, c, u):
        sc = SCENES[self.i]
        prog = min(1.0, u / max(1.0, length(self.i)))
        pic = self.backdrop(c, u, sc, prog)
        if pic:
            c.drawRect(skia.Rect.MakeWH(W, H), paint('#000000', 0.34))
            tint_bottom(c, H * 0.3, 0.9)
        ink, soft = ('#FFFFFF', '#FFFFFF') if pic else (T['ink'], T['soft'])
        text = sc.get('text') or ''
        if text:
            hp = head_plan(text, W * 0.84, L.u(112))
            sp = small_plan(sc.get('sub'), W * 0.78, L.u(44))
            push = push_down(hp[0], len(hp[1]) or 1)
            y = room(text_y(H * 0.50), push + L.u(140) + small_height(sp) + L.u(70))
            q = out_cubic(S(u, 0.35, 1.0))
            with Layer(c, clamp(q * 1.5), dy=(1 - q) * L.u(40) + drift(u)):
                headline(c, text, y, W * 0.84, L.u(112), ink, plan=hp)
            underline(c, u, y + push + L.u(64), L.u(200), t0=0.8)
            q2 = out_cubic(S(u, 0.7, 1.3))
            with Layer(c, clamp(q2 * 1.5)):
                small(c, sc.get('sub'), y + push + L.u(140), W * 0.78, L.u(44), soft, a=0.9 if pic else 1.0, plan=sp)
        caption(c, u, self.i)


class Offer(Scene):
    def __init__(self, i):
        self.i = i
        super().__init__(length(i))

    def draw(self, c, u):
        sc = SCENES[self.i]
        stage(c, u, gy=0.42, seed=11)
        hp = head_plan(sc.get('text', ''), W * 0.84, L.u(160), max_lines=3)
        sp = small_plan(sc.get('sub'), W * 0.78, L.u(44))
        push = push_down(hp[0], len(hp[1]) or 1)
        y = room(text_y(H * 0.5), push + L.u(230) + small_height(sp) + L.u(10))
        iy = max(SAFE[1] + L.u(130), min(H * 0.30, y - hp[0] * 0.55 - L.u(110) - L.u(60)))
        p = out_back(S(u, 0.05, 0.7), 1.5)
        cx = anchor_x(L.u(220)) if LOOK['layout'] == 'start' else W / 2
        if not STORY:      # a story is not selling anything: no gift
            with Layer(c, clamp(p * 2), scale=0.7 + 0.3 * p, pivot=(cx, iy)):
                icons.draw(c, 'gift', cx, iy + drift(u), L.u(220), T['accent'], stroke=2.0)
        q = out_cubic(S(u, 0.35, 1.0))
        with Layer(c, clamp(q * 1.5), dy=(1 - q) * L.u(40) + drift(u)):
            headline(c, sc.get('text', ''), y, W * 0.84, L.u(160), T['ink'], max_lines=3, plan=hp)
        underline(c, u, y + push + L.u(150), L.u(260), t0=0.9)
        small(c, sc.get('sub'), y + push + L.u(230), W * 0.78, L.u(44), T['soft'], plan=sp)
        caption(c, u, self.i)


class CTA(Scene):
    def __init__(self, i):
        self.i = i
        super().__init__(length(i))

    def draw(self, c, u):
        sc = SCENES[self.i]
        stage(c, u, gy=0.30, seed=9)
        # The way in that the plan asked for comes first: a message on WhatsApp, or a direct message / a comment.
        phone = ('phone-call', BR['phone']) if BR.get('phone') else None
        handle = ('at-sign', BR['handle']) if BR.get('handle') else None
        order = [handle, phone] if (PLAN or {}).get('cta') in ('dm', 'comment') else [phone, handle]
        rows = [x for x in order if x]
        hp = head_plan(sc.get('text', ''), W * 0.86, L.u(130))
        # A call of two lines is taller than the gap an ad leaves for it (that gap is kept as it was for Sorani ads):
        # in the other languages and in a story what sits under it moves down by the extra line.
        push = push_down(hp[0], len(hp[1]) or 1) if (STORY or LANG in ('ar', 'en')) else 0.0
        top = H * 0.36 + push
        card_h = L.u(120) + L.u(130) * max(0, len(rows) - 1) if rows else 0
        name_y = (top + card_h + L.u(60) + L.u(110)) if rows else H * 0.42 + push
        # A story has no number to call, and a card with no rows leaves the lower half empty: the whole block
        # (mark, call, handle, name) is centred between the top safe edge and the caption instead. A Sorani ad
        # (no language in its job, or ckb) keeps its layout exactly as it was, with or without rows.
        dy0 = 0.0
        if STORY or (LANG in ('ar', 'en') and not rows):
            dy0 = (SAFE[1] + CAP_TOP) / 2 - ((H * 0.135 - L.u(95)) + (name_y + L.u(35))) / 2
            top += dy0
            name_y += dy0
        p = out_cubic(S(u, 0.0, 0.8))
        mx = anchor_x(L.u(190)) if LOOK['layout'] == 'start' else W / 2
        with Layer(c, clamp(p * 1.6), scale=0.85 + 0.15 * p, pivot=(mx, H * 0.135 + dy0)):
            mark(c, mx, H * 0.135 + drift(u) + dy0, L.u(190))
        q = out_cubic(S(u, 0.3, 0.95))
        with Layer(c, clamp(q * 1.5), dy=(1 - q) * L.u(36)):
            headline(c, sc.get('text', ''), H * 0.29 + dy0, W * 0.86, L.u(130), T['ink'], plan=hp)
        if rows:
            card = (SAFE[0] + L.u(30), top, SAFE[2] - L.u(30), top + card_h + L.u(60))
            qc = out_cubic(S(u, 0.9, 1.5))
            with Layer(c, clamp(qc * 1.6), dy=(1 - qc) * L.u(40)):
                fx.glass(c, card, radius=min(r(L.u(44)), (card[3] - card[1]) / 2), tint=T['accent'], a=0.10, border=0.5, highlight=0.12)
                for k, (ic, text) in enumerate(rows):
                    rq = out_cubic(S(u, 1.2 + 0.25 * k, 1.8 + 0.25 * k))
                    ry = card[1] + L.u(95) + k * L.u(130)
                    with Layer(c, clamp(rq * 1.6), dx=(1 - rq) * L.u(60)):
                        icons.draw(c, ic, card[0] + L.u(105), ry, L.u(66), T['accent'], stroke=2.2)
                        row_w = (card[2] - L.u(40)) - (card[0] + L.u(180))
                        mv.text(c, text, card[0] + L.u(180), ry, mv.fit('Inter', text, row_w, L.u(66), wght=700), T['ink'], align='left')
        q2 = out_cubic(S(u, 1.9, 2.5))
        with Layer(c, clamp(q2 * 1.6), dy=(1 - q2) * L.u(24)):
            headline(c, NAME, name_y, W * 0.8, L.u(70), T['soft'], max_lines=1)
        caption(c, u, self.i)


def build():
    scenes = []
    values = [i for i, s in enumerate(SCENES) if s.get('type') == 'value']
    stories = [i for i, s in enumerate(SCENES) if s.get('type') == 'story']
    for i, s in enumerate(SCENES):
        t = s.get('type')
        if t == 'hook':
            scenes.append(Hook(i))
        elif t == 'value':
            scenes.append(Value(i, len(values), values.index(i)))
        elif t == 'story':
            scenes.append(Story(i, len(stories), stories.index(i)))
        elif t == 'product':
            scenes.append(Product(i))
        elif t == 'footage':
            scenes.append(Clip(i))
        elif t == 'offer':
            scenes.append(Offer(i))
        elif t == 'cta':
            scenes.append(CTA(i))
        else:
            # A misspelt or new scene type must stop the render, never turn into a call-to-action card.
            raise ValueError(f'unknown scene type {t!r} (scene {i})')
    return scenes


def _wipe(c, A, B, p, ctx):
    return wipe(c, A, B, p, ctx, colors=(T['accent'], mixc(T['accent'], T['bg'], 0.5)))


TRANSITIONS = {'crossfade': crossfade, 'push': push, 'slide_up': slide_up, 'zoom_through': zoom_through, 'iris': iris, 'wipe': _wipe}
tl = Timeline(build(), (W, H), transition=TRANSITIONS[LOOK['transition']], before=0.3, after=0.5)
video = Video(tl, tl.duration, (W, H), FPS, background=T['bg'], grain=0.02 if LOOK['palette'] in ('brand-dark', 'midnight') else 0.0)


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
