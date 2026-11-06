"""Генератор новых карт «Холдинга» в стиле оригинальной колоды.

Запуск: python3 tools/make_cards.py   (нужен пакет fonttools)
Создаёт SVG в assets/cards/: юрист, акция, события рынка, новые рубашки.
Текст переводится в контуры, поэтому карты не зависят от шрифтов (как и оригиналы).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from textpath import Face, wrap  # noqa: E402

W, H = 189.92, 274.96
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'cards')
TITLE = Face('montserrat-alternates', 700)
BODY = Face('montserrat-alternates', 600)
MAGENTA = '#c10098'
IND = {'chem': '#b10dc9', 'forest': '#e46f0a', 'build': '#e00000'}
IND_NAME = {'chem': 'Химия', 'forest': 'Лес', 'build': 'Стройка'}


def text_c(face, s, cx, y, size, fill, tracking=0):
    w = face.width(s, size, tracking)
    return f'<path fill="{fill}" d="{face.path(s, cx - w / 2, y, size, tracking)}"/>'


def text_l(face, s, x, y, size, fill):
    return f'<path fill="{fill}" d="{face.path(s, x, y, size)}"/>'


def card(name, corner, art, title, desc, label=None, title_fill=MAGENTA):
    p = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}">',
         f'<rect width="{W}" height="{H}" fill="#fff"/>',
         f'<path fill="{corner}" d="M0 0h37a37 37 0 0 1-37 37z"/>',
         art]
    y = 150
    tlines = wrap(TITLE, title, 15.5, 165)
    for ln in tlines:
        p.append(text_c(TITLE, ln, W / 2, y, 15.5, title_fill))
        y += 17
    y += 3
    for ln in wrap(BODY, desc, 8.1, 162):
        p.append(text_l(BODY, ln, 14, y, 8.1, '#111'))
        y += 10.8
    if label:
        p.append(f'<rect x="14" y="252" width="{W - 28}" height="12" rx="6" fill="#f1f1f4"/>')
        p.append(text_c(BODY, label, W / 2, 260.6, 6.2, '#6a6f7d', 0.6))
    p.append('</svg>')
    with open(os.path.join(OUT, name + '.svg'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(p))
    print('✓', name)


def coin(cx, cy, r=9):
    return (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="#ffde4f"/><circle cx="{cx}" cy="{cy}" r="{r * 0.72}" fill="#f9b233"/>'
            + text_c(TITLE, '$', cx, cy + r * 0.42, r * 1.15, '#ffde4f'))


def coin_stack(x, y, n):
    s = ''
    for i in range(n):
        yy = y - i * 6
        s += f'<ellipse cx="{x}" cy="{yy + 3}" rx="15" ry="5" fill="#d99a1e"/><rect x="{x - 15}" y="{yy - 2}" width="30" height="5" fill="#d99a1e"/><ellipse cx="{x}" cy="{yy - 2}" rx="15" ry="5" fill="#ffde4f"/>'
    return s


# ---------------- иллюстрации ----------------

def art_lawyer():
    a = []
    a.append('<rect x="70" y="117" width="50" height="8" rx="2" fill="#bf951f"/>')
    a.append('<polygon points="80,117 110,117 101,104 89,104" fill="#d8af2e"/>')
    a.append('<rect x="92" y="32" width="6" height="74" fill="#d8af2e"/>')
    a.append('<rect x="38" y="36" width="114" height="6" rx="3" fill="#bf951f"/>')
    a.append('<circle cx="95" cy="30" r="7" fill="#bf951f"/>')
    for cx in (48, 142):
        a.append(f'<path d="M{cx} 42 L{cx - 18} 80 M{cx} 42 L{cx + 18} 80" stroke="#9aa3b1" stroke-width="1.6" fill="none"/>')
        a.append(f'<path d="M{cx - 22} 80h44a22 12 0 0 1-44 0z" fill="#d8af2e"/>')
        a.append(f'<rect x="{cx - 22}" y="79" width="44" height="3" fill="#bf951f"/>')
    # книга законов
    a.append('<rect x="16" y="100" width="44" height="25" rx="2" fill="#1e5bb8"/><rect x="18" y="118" width="40" height="5" fill="#fff"/><rect x="16" y="100" width="6" height="25" fill="#164a99"/>')
    a.append(text_c(TITLE, 'ЗАКОН', 41, 113, 7, '#fff'))
    # портфель
    a.append('<path d="M140 99v-5a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v5" stroke="#4a3220" stroke-width="3" fill="none"/>')
    a.append('<rect x="128" y="99" width="44" height="27" rx="3" fill="#6b4a2f"/><rect x="128" y="108" width="44" height="3" fill="#4a3220"/><rect x="146" y="105" width="8" height="9" rx="1" fill="#d8af2e"/>')
    return ''.join(a)


def art_share():
    a = ['<rect x="26" y="16" width="138" height="102" rx="4" fill="#f4efd9"/>',
         '<rect x="33" y="23" width="124" height="88" rx="2" fill="none" stroke="#2a8a63" stroke-width="2"/>',
         '<rect x="37" y="27" width="116" height="80" rx="1" fill="none" stroke="#2a8a63" stroke-width="0.7" stroke-dasharray="2 1.5"/>']
    for x, y in ((33, 23), (157, 23), (33, 111), (157, 111)):
        a.append(f'<circle cx="{x}" cy="{y}" r="5" fill="#2a8a63"/>')
    a.append(text_c(TITLE, 'АКЦИЯ', 95, 48, 13, '#2a8a63', 1.5))
    for i, w in enumerate((90, 76, 84)):
        a.append(f'<rect x="{95 - w / 2}" y="{57 + i * 8}" width="{w}" height="3" rx="1.5" fill="#c9c2a5"/>')
    a.append('<polygon points="122,104 116,124 125,118 130,126 132,106" fill="#a30000"/><polygon points="138,104 144,124 135,118 130,126 128,106" fill="#a30000"/>')
    a.append('<circle cx="130" cy="96" r="15" fill="#d80000"/><circle cx="130" cy="96" r="10" fill="none" stroke="#ff6b6b" stroke-width="1.5"/>')
    a.append(text_c(TITLE, '%', 130, 100.5, 12, '#fff'))
    a.append('<path d="M40 112 L62 92 L76 101 L104 72" stroke="#4caf1a" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>')
    a.append('<polygon points="110,64 95,69 107,82" fill="#4caf1a"/>')
    return ''.join(a)


def bars(heights, colors, x0=26, w=26, gap=8, base=118):
    s = ''
    for i, (h, c) in enumerate(zip(heights, colors)):
        s += f'<rect x="{x0 + i * (w + gap)}" y="{base - h}" width="{w}" height="{h}" rx="2" fill="{c}"/>'
    return s + f'<rect x="16" y="{base}" width="158" height="5" rx="2" fill="#3a3f4a"/>'


def art_crisis():
    s = bars([78, 58, 40, 20], ['#c7daea', '#aebfd2', '#9aa3b1', '#7d8696'])
    s += '<path d="M22 26 L62 56 L86 44 L140 96" stroke="#d80000" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
    s += '<polygon points="154,110 132,104 146,88" fill="#d80000"/>'
    s += coin(160, 40, 8) + coin(146, 62, 6)
    return s


def art_boom():
    s = bars([22, 42, 62, 84], ['#a6e07f', '#7ccf4a', '#5cb82c', '#4caf1a'])
    s += '<path d="M24 98 L62 70 L86 80 L138 30" stroke="#2f8a12" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
    s += '<polygon points="152,16 130,22 146,38" fill="#2f8a12"/>'
    s += coin(36, 40, 9) + coin(58, 26, 7)
    for x, y in ((160, 60), (110, 22)):
        s += f'<path d="M{x} {y - 6}l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" fill="#f9b233"/>'
    return s


def art_gov(ind):
    c = IND[ind]
    s = '<path d="M48 16h80l16 16v92H48z" fill="#f2f4f7"/><path d="M128 16v16h16z" fill="#d5dbe5"/>'
    s += f'<rect x="48" y="16" width="96" height="20" fill="{c}"/>'
    s += text_c(TITLE, 'ГОСЗАКАЗ', 92, 30, 9.5, '#fff', 0.8)
    for i, w in enumerate((76, 64, 70, 50)):
        s += f'<rect x="58" y="{46 + i * 9}" width="{w}" height="3.5" rx="1.7" fill="#c7cfdb"/>'
    s += f'<circle cx="118" cy="100" r="19" fill="none" stroke="{c}" stroke-width="3.5"/><circle cx="118" cy="100" r="13" fill="none" stroke="{c}" stroke-width="1.2"/>'
    pts = ' '.join(f'{118 + (8 if k % 2 == 0 else 3.5) * math.sin(k * math.pi / 5):.2f},{100 - (8 if k % 2 == 0 else 3.5) * math.cos(k * math.pi / 5):.2f}' for k in range(10))
    s += f'<polygon points="{pts}" fill="{c}"/>'
    s += '<path d="M60 112 q8 -10 16 0 t16 0" stroke="#1e5bb8" stroke-width="2" fill="none"/>'
    s += coin_stack(30, 118, 4) + coin_stack(164, 118, 3)
    return s


def art_sanction(ind):
    c = IND[ind]
    s = f'<rect x="18" y="52" width="116" height="66" rx="3" fill="{c}"/>'
    for i in range(9):
        s += f'<rect x="{26 + i * 12}" y="58" width="5" height="54" rx="1" fill="#000" opacity=".18"/>'
    s += '<rect x="18" y="52" width="116" height="7" fill="#000" opacity=".22"/><rect x="14" y="118" width="162" height="5" rx="2" fill="#3a3f4a"/>'
    s += text_c(TITLE, IND_NAME[ind].upper(), 62, 98, 11, '#fff', 0.8)
    s += '<circle cx="134" cy="54" r="34" fill="#fff"/><circle cx="134" cy="54" r="30" fill="none" stroke="#d80000" stroke-width="9"/>'
    s += '<line x1="113" y1="33" x2="155" y2="75" stroke="#d80000" stroke-width="9"/>'
    return s


def art_taxfree():
    s = '<circle cx="152" cy="30" r="16" fill="#ffd23f"/>'
    for k in range(8):
        a = k * math.pi / 4
        s += f'<line x1="{152 + 21 * math.cos(a):.1f}" y1="{30 + 21 * math.sin(a):.1f}" x2="{152 + 27 * math.cos(a):.1f}" y2="{30 + 27 * math.sin(a):.1f}" stroke="#ffd23f" stroke-width="3" stroke-linecap="round"/>'
    s += '<rect x="10" y="100" width="170" height="14" fill="#55e6ff"/><rect x="10" y="112" width="170" height="12" fill="#f3d9a4"/>'
    # зонт
    s += '<line x1="62" y1="44" x2="72" y2="118" stroke="#6b4a2f" stroke-width="3"/>'
    s += '<path d="M24 58 Q60 14 100 46 Z" fill="#e00000"/><path d="M44 50 Q60 22 62 33 L70 48 Z" fill="#fff"/><path d="M76 44 Q78 24 86 36 L92 44 Z" fill="#fff"/>'
    # табличка «закрыто» на налоговой
    s += '<rect x="122" y="70" width="4" height="48" fill="#6b4a2f"/><rect x="100" y="56" width="50" height="26" rx="3" fill="#fff" stroke="#3a3f4a" stroke-width="2"/>'
    s += text_c(BODY, 'НАЛОГОВАЯ', 125, 66, 5.6, '#3a3f4a') + text_c(TITLE, 'ЗАКРЫТО', 125, 77, 8, '#d80000')
    # шезлонг
    s += '<path d="M24 112 L44 96 L70 104" stroke="#1e5bb8" stroke-width="4" fill="none" stroke-linecap="round"/>'
    return s


def art_inflation():
    s = '<path d="M30 40 h70 l30 30 -30 30 h-70 a6 6 0 0 1-6-6 v-48 a6 6 0 0 1 6-6z" fill="#f6a623"/>'
    s += '<circle cx="104" cy="70" r="6" fill="#fff"/>'
    s += text_c(TITLE, '$$$', 62, 79, 24, '#fff')
    s += '<path d="M120 46 Q150 20 132 12" stroke="#9aa3b1" stroke-width="1.5" fill="none"/>'
    s += '<rect x="146" y="44" width="14" height="60" rx="3" fill="#d80000"/><polygon points="153,16 134,48 172,48" fill="#d80000"/>'
    s += coin(36, 112, 8) + coin(58, 116, 6) + '<rect x="14" y="122" width="162" height="4" rx="2" fill="#3a3f4a"/>'
    return s


def art_cheapcredit():
    s = '<rect x="20" y="36" width="120" height="76" rx="8" fill="#1e5bb8"/><rect x="20" y="52" width="120" height="12" fill="#163f80"/>'
    s += '<rect x="32" y="74" width="22" height="16" rx="3" fill="#ffd23f"/><line x1="32" y1="82" x2="54" y2="82" stroke="#d99a1e"/>'
    s += '<rect x="32" y="98" width="60" height="4" rx="2" fill="#8fb3ea"/>'
    s += '<circle cx="136" cy="44" r="28" fill="#4caf1a"/><circle cx="136" cy="44" r="23" fill="none" stroke="#fff" stroke-width="1.5" stroke-dasharray="3 2"/>'
    s += text_c(TITLE, '0%', 136, 51, 19, '#fff')
    s += coin_stack(160, 118, 3)
    return s


def art_stable():
    s = '<rect x="20" y="22" width="150" height="96" rx="6" fill="#eef3f9"/>'
    for i in range(4):
        s += f'<line x1="30" y1="{40 + i * 20}" x2="160" y2="{40 + i * 20}" stroke="#d5dde8" stroke-width="1"/>'
    s += '<path d="M30 72 C50 64 60 80 80 72 S110 64 130 72 S150 76 160 70" stroke="#1e5bb8" stroke-width="4" fill="none" stroke-linecap="round"/>'
    s += '<path d="M140 88 l16 6 v12 c0 10 -8 15 -16 18 c-8 -3 -16 -8 -16 -18 v-12z" fill="#4caf1a"/>'
    s += '<path d="M133 104 l5 5 10 -11" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
    return s


# ---------------- рубашки ----------------

def hypotrochoid(cx, cy, R, r, d, rot=0, steps=1400):
    g = math.gcd(int(R), int(r))
    turns = int(r) // g
    pts = []
    for i in range(steps + 1):
        t = 2 * math.pi * turns * i / steps
        x = (R - r) * math.cos(t) + d * math.cos((R - r) / r * t)
        y = (R - r) * math.sin(t) - d * math.sin((R - r) / r * t)
        xr = x * math.cos(rot) - y * math.sin(rot)
        yr = x * math.sin(rot) + y * math.cos(rot)
        pts.append(f'{cx + xr:.2f},{cy + yr:.2f}')
    return 'M' + ' L'.join(pts) + 'Z'


def waves(y0, color, amp=3, n=4, gap=2.2, x0=16, x1=W - 16, period=14, width=0.5):
    s = ''
    for k in range(n):
        pts = []
        for i in range(0, 121):
            x = x0 + (x1 - x0) * i / 120
            y = y0 + k * gap + amp * math.sin((x - x0) / period * 2 * math.pi + k * 0.6)
            pts.append(f'{x:.2f},{y:.2f}')
        s += f'<polyline points="{" ".join(pts)}" fill="none" stroke="{color}" stroke-width="{width}"/>'
    return s


def back(name, dark, mid, light, pale, center_text, word, sub):
    cx, cy = W / 2, H / 2
    p = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}">',
         f'<rect width="{W}" height="{H}" fill="{dark}"/>',
         f'<rect x="9" y="9" width="{W - 18}" height="{H - 18}" rx="10" fill="{light}"/>',
         f'<clipPath id="in-{name}"><rect x="9" y="9" width="{W - 18}" height="{H - 18}" rx="10"/></clipPath>',
         f'<g clip-path="url(#in-{name})">']
    # сетка-гильош на фоне
    for k in range(12):
        p.append(f'<path d="{hypotrochoid(cx, cy, 70, 13, 52, rot=k * math.pi / 12, steps=420)}" fill="none" stroke="{pale}" stroke-width="0.3" opacity=".7"/>')
    for k in range(-6, 7):
        p.append(f'<path d="{hypotrochoid(cx + k * 30, cy - 120, 30, 6, 14, steps=300)}" fill="none" stroke="{pale}" stroke-width="0.3"/>')
        p.append(f'<path d="{hypotrochoid(cx + k * 30, cy + 120, 30, 6, 14, steps=300)}" fill="none" stroke="{pale}" stroke-width="0.3"/>')
    p.append('</g>')
    p.append(f'<rect x="15" y="15" width="{W - 30}" height="{H - 30}" rx="7" fill="none" stroke="{dark}" stroke-width="0.8" stroke-dasharray="3 1.5"/>')
    p.append(waves(48, mid, n=5) + waves(H - 60, mid, n=5))
    # угловые четверти, как на оригинальной рубашке
    for (x, y, sx, sy) in ((9, 9, 1, 1), (W - 9, 9, -1, 1), (9, H - 9, 1, -1), (W - 9, H - 9, -1, -1)):
        p.append(f'<path d="M{x} {y} h{30 * sx} a30 30 0 0 {1 if sx * sy > 0 else 0} {-30 * sx} {30 * sy} z" fill="{mid}"/>')
        p.append(text_c(TITLE, center_text, x + 11 * sx, y + 15 * sy + 4, 11, light))
    # медальон
    p.append(f'<circle cx="{cx}" cy="{cy}" r="54" fill="{light}"/>')
    p.append(f'<path d="{hypotrochoid(cx, cy, 48, 7, 20)}" fill="none" stroke="{mid}" stroke-width="0.45"/>')
    p.append(f'<path d="{hypotrochoid(cx, cy, 50, 11, 28, rot=0.15)}" fill="none" stroke="{dark}" stroke-width="0.35" opacity=".6"/>')
    p.append(f'<circle cx="{cx}" cy="{cy}" r="31" fill="{mid}"/><circle cx="{cx}" cy="{cy}" r="27" fill="none" stroke="{light}" stroke-width="1"/>')
    p.append(text_c(TITLE, center_text, cx, cy + 15, 42, light))
    # подписи
    p.append(text_c(TITLE, word, cx, 38, 11, dark, 3))
    p.append(f'<g transform="rotate(180 {cx} {H - 34})">' + text_c(TITLE, word, cx, H - 30, 11, dark, 3) + '</g>')
    p.append(text_c(BODY, sub, cx, 66, 5.5, dark, 1.2))
    p.append(f'<g transform="rotate(180 {cx} {H - 68})">' + text_c(BODY, sub, cx, H - 66, 5.5, dark, 1.2) + '</g>')
    # номиналы по бокам
    for x in (30, W - 30):
        p.append(f'<circle cx="{x}" cy="{cy}" r="11" fill="none" stroke="{mid}" stroke-width="1.2"/>')
        p.append(text_c(TITLE, center_text if len(center_text) == 1 else '%', x, cy + 4, 11, mid))
    p.append('</svg>')
    with open(os.path.join(OUT, name + '.svg'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(p))
    print('✓', name)


def table_art():
    """Фон стола: бесшовная плитка с гильошем и большая розетка-водяной знак."""
    tdir = os.path.join(OUT, '..', 'table')
    os.makedirs(tdir, exist_ok=True)
    S = 140
    t = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}">']
    for (x, y) in ((S / 2, S / 2), (0, 0), (S, 0), (0, S), (S, S)):
        t.append(f'<path d="{hypotrochoid(x, y, 36, 9, 22, steps=360)}" fill="none" stroke="#fff" stroke-opacity=".035" stroke-width=".6"/>')
    for (x, y) in ((S / 2, 0), (0, S / 2), (S, S / 2), (S / 2, S)):
        t.append(f'<path d="{hypotrochoid(x, y, 20, 5, 9, steps=200)}" fill="none" stroke="#fff" stroke-opacity=".04" stroke-width=".6"/>')
    t.append('</svg>')
    open(os.path.join(tdir, 'tile.svg'), 'w').write('\n'.join(t))
    r = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="-200 -200 400 400">']
    for k in range(3):
        r.append(f'<path d="{hypotrochoid(0, 0, 150, 25, 62, rot=k * math.pi / 3, steps=900)}" fill="none" stroke="#fff" stroke-opacity=".028" stroke-width=".5"/>')
    r.append(f'<path d="{hypotrochoid(0, 0, 80, 13, 30, steps=900)}" fill="none" stroke="#f5c542" stroke-opacity=".04" stroke-width=".5"/>')
    r.append('<circle r="196" fill="none" stroke="#fff" stroke-opacity=".04" stroke-width="1.2"/><circle r="188" fill="none" stroke="#fff" stroke-opacity=".03" stroke-dasharray="3 3"/>')
    r.append('</svg>')
    open(os.path.join(tdir, 'rosette.svg'), 'w').write('\n'.join(r))
    print('✓ table')


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    table_art()
    card('lawyer', '#1e5bb8', art_lawyer(), 'Юрист',
         'Сыграйте в ответ на «Налоговую», направленную против вас: проверка отменяется. Юрист и налоговая уходят в сброс.')
    card('share', '#00a99d', art_share(), 'Акция',
         'Вложите $3 в компанию соперника, где есть хотя бы 2 этапа. Деньги сразу получает владелец, а когда он продаст компанию, вам достанется треть выплаты.')
    L = 'СОБЫТИЕ РЫНКА · ДЕЙСТВУЕТ ВЕСЬ РАУНД'
    card('event-crisis', '#3a3f4a', art_crisis(), 'Кризис', 'Весь раунд все компании продаются на $4 дешевле. Может, стоит придержать «Продажу»?', L)
    card('event-boom', '#4caf1a', art_boom(), 'Экономический бум', 'Весь раунд все компании продаются на $3 дороже.', L)
    for ind, nm in (('chem', 'химической'), ('forest', 'лесной'), ('build', 'строительной')):
        card(f'event-gov-{ind}', IND[ind], art_gov(ind), f'Госзаказ: {IND_NAME[ind]}', f'Весь раунд компании {nm} промышленности продаются на $5 дороже.', L)
        card(f'event-sanction-{ind}', IND[ind], art_sanction(ind), f'Санкции: {IND_NAME[ind]}', f'Весь раунд компании {nm} промышленности продать нельзя.', L)
    card('event-taxfree', '#000000', art_taxfree(), 'Налоговые каникулы', 'Весь раунд «Налоговую» играть нельзя. Самое время выкладывать этапы на стол.', L)
    card('event-inflation', '#f6a623', art_inflation(), 'Инфляция', 'Весь раунд покупка карты у банка стоит $4 вместо $3.', L)
    card('event-cheapcredit', '#1e5bb8', art_cheapcredit(), 'Льготный кредит', 'Кредиты, взятые в этом раунде, возвращаются без процентов: взяли $10 — вернёте $10.', L)
    card('event-stable', '#9aa3b1', art_stable(), 'Стабильность', 'Рынок спокоен: в этом раунде особых эффектов нет.', L)
    back('back', '#1d5e43', '#2a7a5a', '#82cc9f', '#5fae80', '$', 'ХОЛДИНГ', 'КАРТОЧНАЯ БИЗНЕС-ИГРА')
    back('event-back', '#1b2458', '#2f3f8f', '#9fb0f0', '#7083d4', '%', 'РЫНОК', 'СОБЫТИЕ РАУНДА')
