"""Turning an uploaded product photo into what gets stored.

Every upload is re-encoded, which does three jobs: it rejects anything that is
not really an image, it applies the phone camera's rotation flag (otherwise
portrait photos show up sideways), and it bounds the size so a 12-megapixel
photo does not become 5 MB in the database.
"""
from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
# Decoded size guard: a small file can still expand to gigabytes of pixels.
MAX_PIXELS = 50_000_000
FULL_SIZE = 1200
THUMB_SIZE = 320
# MPO is the multi-picture JPEG some phones produce.
ACCEPTED_FORMATS = {"JPEG", "MPO", "PNG", "WEBP", "GIF", "BMP"}


class InvalidImage(ValueError):
    """The upload cannot be used as a product photo; the message says why."""


@dataclass
class ProcessedImage:
    data: bytes
    thumbnail: bytes
    width: int
    height: int
    checksum: str
    content_type: str = "image/jpeg"


def process_upload(upload) -> ProcessedImage:
    size = getattr(upload, "size", None)
    if size is not None and size > MAX_UPLOAD_BYTES:
        raise InvalidImage(f"The photo is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")

    try:
        with Image.open(upload) as probe:
            image_format = probe.format
            pixels = probe.width * probe.height
            probe.verify()
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError, ValueError):
        raise InvalidImage("The file is not a readable image.")
    if image_format not in ACCEPTED_FORMATS:
        raise InvalidImage("Use a JPG, PNG or WebP photo.")
    if pixels > MAX_PIXELS:
        raise InvalidImage("The photo has too many pixels.")

    # verify() leaves the image unusable, so decode again for real.
    upload.seek(0)
    try:
        with Image.open(upload) as opened:
            image = _flatten(ImageOps.exif_transpose(opened))
    except (Image.DecompressionBombError, OSError, ValueError):
        raise InvalidImage("The file is not a readable image.")

    data, (width, height) = _encode(image, FULL_SIZE, quality=82)
    thumbnail, _ = _encode(image, THUMB_SIZE, quality=80)
    return ProcessedImage(
        data=data,
        thumbnail=thumbnail,
        width=width,
        height=height,
        checksum=sha256(data).hexdigest(),
    )


def _flatten(image: Image.Image) -> Image.Image:
    """RGB for JPEG. Transparent areas (common in product cut-outs) become white."""
    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        canvas = Image.new("RGB", rgba.size, (255, 255, 255))
        canvas.paste(rgba, mask=rgba.getchannel("A"))
        return canvas
    return image.convert("RGB")


def _encode(image: Image.Image, longest_side: int, quality: int) -> tuple[bytes, tuple[int, int]]:
    copy = image.copy()
    copy.thumbnail((longest_side, longest_side), Image.Resampling.LANCZOS)  # only ever shrinks
    buffer = BytesIO()
    copy.save(buffer, "JPEG", quality=quality, optimize=True, progressive=True)
    return buffer.getvalue(), copy.size
