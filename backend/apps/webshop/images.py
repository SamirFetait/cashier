"""Turning uploaded pictures into what gets stored.

Every upload is decoded and re-encoded. That rejects anything that is not
really an image, drops the metadata phones attach (location included), applies
the camera's rotation flag, and bounds the size.
"""
from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_UPLOAD_BYTES = 8 * 1024 * 1024
# A small file can still unpack to an enormous bitmap.
MAX_PIXELS = 40_000_000
ACCEPTED_FORMATS = {"JPEG", "MPO", "PNG", "WEBP"}


class InvalidImage(ValueError):
    """The upload cannot be used; the message says why."""


@dataclass
class ProcessedImage:
    data: bytes
    content_type: str
    width: int
    height: int
    checksum: str


def _open(upload) -> Image.Image:
    size = getattr(upload, "size", None)
    if size is not None and size > MAX_UPLOAD_BYTES:
        raise InvalidImage(f"The image is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
    try:
        with Image.open(upload) as probe:
            image_format = probe.format
            pixels = probe.width * probe.height
            probe.verify()
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError, ValueError):
        raise InvalidImage("The file is not a readable image.")
    if image_format not in ACCEPTED_FORMATS:
        raise InvalidImage("Use a JPG, PNG or WebP image.")
    if pixels > MAX_PIXELS:
        raise InvalidImage("The image has too many pixels.")

    # verify() leaves the image unusable, so decode again for real.
    upload.seek(0)
    try:
        with Image.open(upload) as opened:
            return _flatten(ImageOps.exif_transpose(opened))
    except (Image.DecompressionBombError, OSError, ValueError):
        raise InvalidImage("The file is not a readable image.")


def _flatten(image: Image.Image) -> Image.Image:
    """RGB, with transparent areas turned white."""
    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        canvas = Image.new("RGB", rgba.size, (255, 255, 255))
        canvas.paste(rgba, mask=rgba.getchannel("A"))
        return canvas
    return image.convert("RGB")


def _result(image: Image.Image, fmt: str, content_type: str, **save_options) -> ProcessedImage:
    buffer = BytesIO()
    image.save(buffer, fmt, **save_options)
    data = buffer.getvalue()
    return ProcessedImage(
        data=data, content_type=content_type, width=image.width, height=image.height,
        checksum=sha256(data).hexdigest(),
    )


def process_photo(upload, *, longest_side: int = 1600, quality: int = 82) -> ProcessedImage:
    """A screenshot or photo as a bounded JPEG (deposit proofs, video posters)."""
    image = _open(upload)
    image.thumbnail((longest_side, longest_side), Image.Resampling.LANCZOS)  # only ever shrinks
    return _result(image, "JPEG", "image/jpeg", quality=quality, optimize=True, progressive=True)


def process_qr(upload, *, longest_side: int = 1000) -> ProcessedImage:
    """An InstaPay QR saved from the app, kept lossless so it still scans."""
    image = _open(upload)
    image.thumbnail((longest_side, longest_side), Image.Resampling.LANCZOS)
    return _result(image, "PNG", "image/png", optimize=True)
