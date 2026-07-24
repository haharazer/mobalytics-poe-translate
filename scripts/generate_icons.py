from pathlib import Path

from PIL import Image, ImageDraw


PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIRECTORY = PROJECT_ROOT / "icons"
SIZES = (16, 32, 48, 128)
CANVAS_SIZE = 512


def interpolate(start: tuple[int, int, int], end: tuple[int, int, int], ratio: float):
    return tuple(round(a + (b - a) * ratio) for a, b in zip(start, end))


def build_master_icon() -> Image.Image:
    image = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), "#171329")
    draw = ImageDraw.Draw(image)

    outer_radius = 120
    draw.rounded_rectangle(
        (0, 0, CANVAS_SIZE - 1, CANVAS_SIZE - 1),
        radius=outer_radius,
        fill="#171329",
    )

    gradient = Image.new("RGBA", image.size, (0, 0, 0, 0))
    gradient_pixels = gradient.load()
    start = (154, 123, 255)
    end = (67, 37, 183)
    for y in range(CANVAS_SIZE):
        for x in range(CANVAS_SIZE):
            ratio = min(1.0, max(0.0, (x + y) / (2 * (CANVAS_SIZE - 1))))
            color = interpolate(start, end, ratio)
            gradient_pixels[x, y] = (*color, 255)

    mask = Image.new("L", image.size, 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle((32, 32, 479, 479), radius=100, fill=255)
    image.alpha_composite(Image.composite(gradient, Image.new("RGBA", image.size), mask))

    draw = ImageDraw.Draw(image, "RGBA")
    gem = [(256, 100), (384, 180), (348, 360), (256, 420), (164, 360), (128, 180)]
    draw.polygon(gem, fill=(36, 22, 79, 150))
    draw.line(gem + [gem[0]], fill=(235, 229, 255, 255), width=20, joint="curve")
    draw.line([(136, 184), (376, 184)], fill=(255, 255, 255, 105), width=12)
    draw.line([(168, 352), (344, 352)], fill=(255, 255, 255, 105), width=12)
    draw.line([(256, 108), (256, 412)], fill=(255, 255, 255, 105), width=12)
    draw.line([(136, 184), (256, 412), (376, 184)], fill=(255, 255, 255, 105), width=12)
    draw.rounded_rectangle((176, 208, 336, 244), radius=18, fill="#FFFFFF")
    draw.rounded_rectangle((196, 272, 316, 304), radius=16, fill="#D8CEFF")
    return image


def main() -> None:
    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    master = build_master_icon()
    for size in SIZES:
        icon = master.resize((size, size), Image.Resampling.LANCZOS)
        icon.save(OUTPUT_DIRECTORY / f"icon-{size}.png", optimize=True)
    print(f"Generated {len(SIZES)} release icons.")


if __name__ == "__main__":
    main()
