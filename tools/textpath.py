"""Превращает текст в SVG-контуры (чтобы новые карты не зависели от шрифтов, как и оригинальные).

Шрифт: Montserrat Alternates (OFL), подмножества cyrillic + latin из пакета @fontsource.
"""
import os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

FONT_DIR = os.environ.get('HOLDING_FONT_DIR', os.path.join(os.path.dirname(__file__), 'fonts'))


class Face:
    def __init__(self, family, weight):
        self.fonts = []
        for subset in ('cyrillic', 'latin', 'cyrillic-ext', 'latin-ext'):
            p = os.path.join(FONT_DIR, f'{family}-{subset}-{weight}-normal.woff')
            if os.path.exists(p):
                f = TTFont(p)
                self.fonts.append((f, f.getBestCmap(), f.getGlyphSet(), f['hmtx'], f['head'].unitsPerEm))
        if not self.fonts:
            raise FileNotFoundError(f'Нет шрифта {family} {weight} в {FONT_DIR}')

    def _find(self, ch):
        for f in self.fonts:
            if ord(ch) in f[1]:
                return f
        return None

    def advance(self, ch, size):
        f = self._find(ch)
        if not f:
            return size * 0.3
        gname = f[1][ord(ch)]
        return f[3][gname][0] * size / f[4]

    def width(self, text, size, tracking=0):
        return sum(self.advance(c, size) + tracking for c in text) - (tracking if text else 0)

    def path(self, text, x, y, size, tracking=0):
        """SVG path data для строки, базовая линия в (x, y)."""
        d = []
        cx = x
        for ch in text:
            f = self._find(ch)
            if f:
                gname = f[1][ord(ch)]
                scale = size / f[4]
                pen = SVGPathPen(f[2])
                tpen = TransformPen(pen, (scale, 0, 0, -scale, cx, y))
                f[2][gname].draw(tpen)
                d.append(pen.getCommands())
            cx += self.advance(ch, size) + tracking
        return ' '.join(x for x in d if x)


def wrap(face, text, size, max_w):
    """Перенос по словам."""
    lines = []
    for para in text.split('\n'):
        cur = ''
        for word in para.split(' '):
            trial = (cur + ' ' + word).strip()
            if face.width(trial, size) <= max_w or not cur:
                cur = trial
            else:
                lines.append(cur)
                cur = word
        lines.append(cur)
    return lines
