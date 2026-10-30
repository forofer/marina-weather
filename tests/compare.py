# השוואת צילומים: python3 tests/compare.py <לפני> <אחרי>
import sys, os
from PIL import Image, ImageChops
a, b = sys.argv[1], sys.argv[2]
bad = 0
for f in sorted(os.listdir(a)):
    x, y = Image.open(os.path.join(a, f)).convert('RGB'), Image.open(os.path.join(b, f)).convert('RGB')
    if x.size != y.size:
        print(f'✗ {f}: size {x.size} -> {y.size}'); bad += 1; continue
    d = ImageChops.difference(x, y); box = d.getbbox()
    n = sum(1 for p in d.getdata() if max(p) > 24) if box else 0
    pct = 100 * n / (x.size[0] * x.size[1])
    print(('✓' if pct < 0.05 else '✗') + f' {f}: {pct:.3f}% pixels differ' + (f' in {box}' if box and pct >= 0.05 else ''))
    bad += pct >= 0.05
sys.exit(1 if bad else 0)
