"""Meta's WhatsApp Cloud API: the official, hosted WhatsApp Business Platform.

The server talks to Meta over HTTPS, so order alerts go out with nothing
running at the shop; the whatsapp-service sidecar needs a machine that stays
on. Meta delivers a business's message only as a template it has approved
(free text is allowed only within 24 hours of the person writing in), so the
alerts are templates: apps/webshop/alerts.py has them, and
``python manage.py whatsapp_cloud templates`` creates them on Meta's side.

Set up in the README, "WhatsApp order alerts through Meta's Cloud API".
"""
import requests
from django.conf import settings

from .client import WhatsAppError

GRAPH = "https://graph.facebook.com"

# Meta's codes for "busy or briefly down: try again shortly".
TRANSIENT_CODES = {1, 2, 4, 17, 341, 80007, 130429, 131000, 131016, 131056, 133004}


class CloudError(WhatsAppError):
    """Meta refused, or could not be reached. A ``transient`` one is worth
    another try in a few seconds; any other needs something fixed first."""

    def __init__(self, message: str, *, code: int | None = None, transient: bool = False):
        super().__init__(message)
        self.code = code
        self.transient = transient


def configured() -> bool:
    """Whether alerts go through the Cloud API rather than the sidecar."""
    return bool(settings.WHATSAPP_CLOUD_TOKEN and settings.WHATSAPP_CLOUD_PHONE_ID)


def _url(path: str) -> str:
    return f"{GRAPH}/{settings.WHATSAPP_CLOUD_API_VERSION}/{path}"


def _call(method: str, path: str, *, timeout: float = 20, **kwargs) -> dict:
    headers = {"Authorization": f"Bearer {settings.WHATSAPP_CLOUD_TOKEN}"}
    try:
        resp = requests.request(method, _url(path), headers=headers, timeout=timeout, **kwargs)
    except requests.RequestException as exc:
        raise CloudError(f"WhatsApp Cloud API unreachable: {exc}", transient=True) from exc
    return _answer(resp)


def _answer(resp: requests.Response) -> dict:
    try:
        data = resp.json()
    except ValueError:
        data = None
    if resp.ok and isinstance(data, dict):
        return data
    error = data.get("error") if isinstance(data, dict) else None
    error = error if isinstance(error, dict) else {}
    extra = error.get("error_data") if isinstance(error.get("error_data"), dict) else {}
    code = error.get("code")
    text = extra.get("details") or error.get("message") or f"WhatsApp Cloud API answered {resp.status_code}"
    if code is not None:
        text = f"{text} (code {code})"
    raise CloudError(text, code=code, transient=resp.status_code >= 500 or code in TRANSIENT_CODES)


def _business_account() -> str:
    if not settings.WHATSAPP_CLOUD_WABA_ID:
        raise CloudError("Set WHATSAPP_CLOUD_WABA_ID (the WhatsApp Business Account ID) to manage templates.")
    return settings.WHATSAPP_CLOUD_WABA_ID


# --- Messages -----------------------------------------------------------------


def send_template(to: str, name: str, values: list[str], *, language: str, image_id: str = "") -> str:
    """Send an approved template to ``to`` (digits, country code first),
    with ``values`` for its {{1}}, {{2}}... and, for a template with a
    picture on top, the uploaded picture. Returns Meta's id for the message."""
    components = []
    if image_id:
        components.append({"type": "header", "parameters": [{"type": "image", "image": {"id": image_id}}]})
    if values:
        components.append({"type": "body", "parameters": [{"type": "text", "text": v} for v in values]})
    data = _call("POST", f"{settings.WHATSAPP_CLOUD_PHONE_ID}/messages", json={
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to,
        "type": "template",
        "template": {"name": name, "language": {"code": language}, "components": components},
    })
    try:
        return data["messages"][0]["id"]
    except (KeyError, IndexError, TypeError):
        raise CloudError("WhatsApp Cloud API took the message but returned no id for it.") from None


def upload_media(data: bytes, content_type: str, filename: str) -> str:
    """Upload a picture to send with a message. Returns its media id."""
    answer = _call(
        "POST",
        f"{settings.WHATSAPP_CLOUD_PHONE_ID}/media",
        data={"messaging_product": "whatsapp", "type": content_type},
        files={"file": (filename, data, content_type)},
        timeout=60,
    )
    if not answer.get("id"):
        raise CloudError("WhatsApp Cloud API took the picture but returned no id for it.")
    return answer["id"]


# --- The account --------------------------------------------------------------


def phone_number(timeout: float = 10) -> dict:
    """The sending number as Meta has it: display_phone_number, verified_name
    and quality_rating."""
    return _call(
        "GET",
        settings.WHATSAPP_CLOUD_PHONE_ID,
        params={"fields": "display_phone_number,verified_name,quality_rating"},
        timeout=timeout,
    )


def sending_number(timeout: float = 10) -> str:
    """The sending number's digits, country code first."""
    number = phone_number(timeout).get("display_phone_number") or ""
    return "".join(c for c in str(number) if c.isdigit())


def template_statuses(language: str, timeout: float = 10) -> dict[str, str]:
    """``{name: status}`` of the business account's templates in ``language``
    (APPROVED, PENDING, REJECTED, PAUSED, DISABLED...)."""
    answer = _call(
        "GET",
        f"{_business_account()}/message_templates",
        params={"fields": "name,status,language", "limit": 250},
        timeout=timeout,
    )
    return {
        t.get("name"): t.get("status", "")
        for t in answer.get("data", [])
        if isinstance(t, dict) and t.get("language") == language
    }


def create_template(definition: dict) -> dict:
    """Submit a template for Meta's review. Returns ``{id, status, category}``."""
    return _call("POST", f"{_business_account()}/message_templates", json=definition)


def upload_example(data: bytes, content_type: str) -> str:
    """A sample picture for a template that carries one, as the handle Meta's
    review asks for (the Resumable Upload API, which goes through the app)."""
    if not settings.WHATSAPP_CLOUD_APP_ID:
        raise CloudError("Set WHATSAPP_CLOUD_APP_ID (the Meta app's ID) to create the template with the screenshot.")
    session = _call(
        "POST",
        f"{settings.WHATSAPP_CLOUD_APP_ID}/uploads",
        params={"file_name": "example.jpg", "file_length": len(data), "file_type": content_type},
    )
    if not session.get("id"):
        raise CloudError("WhatsApp Cloud API opened no upload for the sample picture.")
    try:
        resp = requests.post(
            _url(session["id"]),
            headers={"Authorization": f"OAuth {settings.WHATSAPP_CLOUD_TOKEN}", "file_offset": "0"},
            data=data,
            timeout=60,
        )
    except requests.RequestException as exc:
        raise CloudError(f"WhatsApp Cloud API unreachable: {exc}", transient=True) from exc
    handle = _answer(resp).get("h")
    if not handle:
        raise CloudError("WhatsApp Cloud API took the sample picture but returned no handle for it.")
    return handle
