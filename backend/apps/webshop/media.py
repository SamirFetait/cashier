"""Uploaded videos: checking them, storing them, and streaming them back.

Videos live on disk under MEDIA_ROOT (they are far too big for the database)
and are served by `serve_media`, which supports byte ranges: browsers need
them to seek in a video, and Safari needs them to play one at all.
"""
import os
import re
import uuid
from pathlib import Path

from django.conf import settings
from django.core.files.base import ContentFile
from django.http import Http404, HttpResponse, HttpResponseNotModified, StreamingHttpResponse
from django.utils._os import safe_join
from django.utils.http import http_date
from django.views.decorators.http import require_http_methods

from .images import ProcessedImage

# Sniffed type -> stored extension. MP4 (H.264) plays everywhere; WebM and
# iPhone .mov files are accepted but may not play in every browser.
VIDEO_EXTENSIONS = {"video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov"}
SERVED_TYPES = {
    ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".jpg": "image/jpeg",
}
CHUNK = 256 * 1024
_RANGE = re.compile(r"bytes=(\d*)-(\d*)$")


def video_max_mb() -> int:
    return getattr(settings, "SHOP_VIDEO_MAX_MB", 80)


class InvalidVideo(ValueError):
    """The upload cannot be used as a video; the message says why."""


def sniff_video(upload) -> str:
    """The real container type, read from the file's first bytes rather than
    trusted from its name or the browser's say-so."""
    upload.seek(0)
    head = upload.read(16)
    upload.seek(0)
    if len(head) >= 12 and head[4:8] == b"ftyp":
        return "video/quicktime" if head[8:12] == b"qt  " else "video/mp4"
    if head[:4] == b"\x1a\x45\xdf\xa3":
        return "video/webm"
    raise InvalidVideo("Use an MP4, WebM or MOV video.")


def check_video(upload) -> str:
    limit = video_max_mb() * 1024 * 1024
    if upload.size > limit:
        raise InvalidVideo(f"The video is larger than {video_max_mb()} MB.")
    if upload.size < 1024:
        raise InvalidVideo("The video file is empty.")
    return sniff_video(upload)


def store_video(video, upload, content_type: str, poster: ProcessedImage | None) -> None:
    """Save the file (and poster) under random names and fill in the model."""
    stem = uuid.uuid4().hex
    video.content_type = content_type
    video.size = upload.size
    video.file.save(f"{stem}{VIDEO_EXTENSIONS[content_type]}", upload, save=False)
    if poster is not None:
        video.poster.save(f"{stem}.jpg", ContentFile(poster.data), save=False)


def delete_files(video) -> None:
    for stored in (video.file, video.poster):
        if stored:
            stored.delete(save=False)


def _file_chunks(path: str, start: int, length: int):
    with open(path, "rb") as handle:
        handle.seek(start)
        remaining = length
        while remaining > 0:
            chunk = handle.read(min(CHUNK, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


@require_http_methods(["GET", "HEAD"])
def serve_media(request, path: str):
    # Only the uploads folder is served, and safe_join refuses any path that
    # climbs back out of it (videos/../something).
    if not path.startswith("videos/"):
        raise Http404
    try:
        uploads = safe_join(str(settings.MEDIA_ROOT), "videos")
        full = safe_join(uploads, path[len("videos/"):])
    except Exception:
        raise Http404
    content_type = SERVED_TYPES.get(Path(full).suffix.lower())
    if content_type is None or not os.path.isfile(full):
        raise Http404

    stat = os.stat(full)
    size = stat.st_size
    etag = f'"{int(stat.st_mtime):x}-{size:x}"'
    if request.headers.get("If-None-Match") == etag and "Range" not in request.headers:
        response = HttpResponseNotModified()
        response["ETag"] = etag
        return response

    start, end, status = 0, size - 1, 200
    range_header = request.headers.get("Range")
    if range_header:
        match = _RANGE.match(range_header.strip())
        first, last = match.groups() if match else ("", "")
        if not match or (not first and not last):
            pass  # not a single byte range we understand: send the whole file
        else:
            if first:
                start = int(first)
                end = min(int(last), size - 1) if last else size - 1
            else:  # "bytes=-500": the last 500 bytes
                start = max(size - int(last), 0)
            if start >= size or start > end:
                response = HttpResponse(status=416)
                response["Content-Range"] = f"bytes */{size}"
                return response
            status = 206

    length = end - start + 1
    if request.method == "HEAD":
        response = HttpResponse(status=status, content_type=content_type)
    else:
        response = StreamingHttpResponse(
            _file_chunks(full, start, length), status=status, content_type=content_type
        )
    response["Content-Length"] = str(length)
    response["Accept-Ranges"] = "bytes"
    response["ETag"] = etag
    response["Last-Modified"] = http_date(stat.st_mtime)
    # Files are named at random and never rewritten, so they can be cached for good.
    response["Cache-Control"] = "public, max-age=31536000, immutable"
    if status == 206:
        response["Content-Range"] = f"bytes {start}-{end}/{size}"
    return response
