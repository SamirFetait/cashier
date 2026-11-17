"""What the server answers for an address it does not have."""
from django.conf import settings
from django.http import JsonResponse
from django.shortcuts import render
from django.utils.cache import patch_vary_headers

# The lost-bee page's words. Arabic first, as everywhere in Fathet Kheer. The
# bee's thoughts are one per stop as it searches; the second is over the
# empty honey cell.
TEXT = {
    "ar": {
        "page_title": "الصفحة غير موجودة | فاتحة خير",
        "brand": "فاتحة خير",
        "brand_other": "Fathet Kheer",
        "title": "الصفحة دي طارت!",
        "text": (
            "نحلتنا دوّرت عليها في كل خلايا الخلية وما لقتهاش. "
            "ده سيرفر المحل، والمتجر نفسه على موقعنا."
        ),
        "shop": "روح للمتجر",
        "lost": "شكل نحلتنا تاهت هي كمان!",
        "call_back": "نادي عليها",
        "switch": "English",
        "thoughts": ["همم…", "مش هنا…", "؟"],
        "give_up": "؟!",
    },
    "en": {
        "page_title": "Page not found | Fathet Kheer",
        "brand": "Fathet Kheer",
        "brand_other": "فاتحة خير",
        "title": "This page flew away",
        "text": (
            "Our bee searched every cell of the hive and could not find it. "
            "This is the shop's server; the shop itself is on our website."
        ),
        "shop": "Go to the shop",
        "lost": "Looks like our bee got lost too.",
        "call_back": "Call it back",
        "switch": "العربية",
        "thoughts": ["Hmm…", "Not here…", "?"],
        "give_up": "?!",
    },
}


def page_language(request) -> str:
    """The language picked with ?lang=, else the browser's first choice of
    Arabic or English, else Arabic."""
    chosen = request.GET.get("lang")
    if chosen in TEXT:
        return chosen
    ranked = []
    for position, part in enumerate(request.headers.get("Accept-Language", "").split(",")):
        tag, _, params = part.partition(";")
        quality = 1.0
        params = params.strip()
        if params.startswith("q="):
            try:
                quality = float(params[2:])
            except ValueError:
                quality = 0.0
        ranked.append((-quality, position, tag.strip().lower()[:2]))
    for _, _, code in sorted(ranked):
        if code in TEXT:
            return code
    return "ar"


def not_found(request, exception=None):
    """The server's 404 (handler404 in cashier/urls.py).

    The API, and any program that asks for JSON, gets the API's error shape,
    so the apps can tell a wrong address from a dropped connection. A person
    gets the lost-bee page, pointing to the shop. Django shows its own debug
    page instead while DEBUG is on.
    """
    if request.path.startswith("/api/") or not request.accepts("text/html"):
        response = JsonResponse({"code": "NOT_FOUND", "detail": "Not found."}, status=404)
    else:
        lang = page_language(request)
        text = TEXT[lang]
        response = render(
            request,
            "common/not_found.html",
            {
                "lang": lang,
                "dir": "rtl" if lang == "ar" else "ltr",
                "other_lang": "en" if lang == "ar" else "ar",
                "t": text,
                "bee_words": {"thoughts": text["thoughts"], "give_up": text["give_up"]},
                "shop_url": getattr(settings, "SHOP_SITE_URL", ""),
            },
            status=404,
        )
    patch_vary_headers(response, ("Accept", "Accept-Language"))
    return response
