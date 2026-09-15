"""Offline font asset generation; the website and normal npm builds do not need Python.
Requires fonttools[woff]. Source: design-proposal/assets/NotoSerifSC-900.woff2 (OFL).
"""
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
import hashlib
root = Path(__file__).resolve().parents[1]
source = root / 'design-proposal/assets/NotoSerifSC-900.woff2'
out = root / 'public/fonts'
out.mkdir(exist_ok=True)
chars = sorted(TTFont(source).getBestCmap())
css = []
# Keep stable blocks small; each page requests only the blocks its headings need.
for start in range(0, len(chars), 256):
    codes = chars[start:start + 256]
    font = TTFont(source)
    options = subset.Options()
    options.flavor = 'woff2'
    options.name_IDs = ['*']
    tool = subset.Subsetter(options=options)
    tool.populate(unicodes=codes)
    tool.subset(font)
    for record in font['name'].names:
        if record.nameID in (1, 4, 6, 16):
            record.string = 'Blackbox Display'.encode(record.getEncoding())
    import io
    buffer = io.BytesIO()
    font.save(buffer)
    data = buffer.getvalue()
    name = 'display-' + hashlib.sha256(data).hexdigest()[:16] + '.woff2'
    (out / name).write_bytes(data)
    ranges = ','.join('U+' + format(c, 'X') for c in codes)
    css.append('@font-face{font-family:"Blackbox Display";font-style:normal;font-weight:900;font-display:swap;src:url("/fonts/' + name + '") format("woff2");unicode-range:' + ranges + '}')
(root / 'public/fonts.css').write_text('\n'.join(css), encoding='utf-8')
print('Generated', len(css), 'font subsets')
