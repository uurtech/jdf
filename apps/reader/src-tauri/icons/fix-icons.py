"""
Remove white background from JDF icon PNGs and regenerate icon.ico.
Flood-fills from edges, turning white/near-white pixels transparent.
"""
from PIL import Image
import os

ICONS_DIR = os.path.dirname(os.path.abspath(__file__))
THRESHOLD = 240  # pixels with R,G,B all >= this are considered "white"

def flood_fill_transparent(img, threshold=THRESHOLD):
    """Flood-fill from borders, making white pixels transparent."""
    img = img.convert("RGBA")
    pixels = img.load()
    w, h = img.size
    visited = set()
    queue = []

    # Seed from all border pixels
    for x in range(w):
        queue.append((x, 0))
        queue.append((x, h - 1))
    for y in range(1, h - 1):
        queue.append((0, y))
        queue.append((w - 1, y))

    while queue:
        x, y = queue.pop()
        if x < 0 or x >= w or y < 0 or y >= h:
            continue
        if (x, y) in visited:
            continue
        visited.add((x, y))

        r, g, b, a = pixels[x, y]
        if a == 0 or (r >= threshold and g >= threshold and b >= threshold):
            pixels[x, y] = (r, g, b, 0)
            queue.append((x - 1, y))
            queue.append((x + 1, y))
            queue.append((x, y - 1))
            queue.append((x, y + 1))

    return img


# Process all PNG icon files
png_files = [
    'icon.png', '32x32.png', '64x64.png', '128x128.png', '128x128@2x.png',
    'Square30x30Logo.png', 'Square44x44Logo.png', 'Square71x71Logo.png',
    'Square89x89Logo.png', 'Square107x107Logo.png', 'Square142x142Logo.png',
    'Square150x150Logo.png', 'Square284x284Logo.png', 'Square310x310Logo.png',
    'StoreLogo.png',
]

for fname in png_files:
    path = os.path.join(ICONS_DIR, fname)
    if not os.path.exists(path):
        print(f"  skip {fname} (not found)")
        continue
    img = Image.open(path)
    img = flood_fill_transparent(img)
    img.save(path)
    print(f"  OK {fname} ({img.size[0]}x{img.size[1]})")

# Generate icon.ico with multiple sizes
print("\nGenerating icon.ico...")
ico_sizes = [16, 32, 48, 64, 128, 256]
ico_images = []

# Use icon.png (512x512) as source, resize to each needed size
source = Image.open(os.path.join(ICONS_DIR, 'icon.png'))
for size in ico_sizes:
    resized = source.resize((size, size), Image.LANCZOS)
    ico_images.append(resized)

# Save as ICO
ico_path = os.path.join(ICONS_DIR, 'icon.ico')
ico_images[0].save(
    ico_path,
    format='ICO',
    sizes=[(s, s) for s in ico_sizes],
    append_images=ico_images[1:]
)
print(f"  OK icon.ico ({', '.join(str(s) for s in ico_sizes)}px)")
print("\nDone!")
