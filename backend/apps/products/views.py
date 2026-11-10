from django.db.models import F
from django.http import Http404, HttpResponse, HttpResponseNotModified
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import SAFE_METHODS, AllowAny
from rest_framework.response import Response

from apps.accounts.permissions import IsSuperAdminOrReadOnly

from .images import InvalidImage, process_upload
from .models import Category, Product, ProductImage
from .serializers import CategorySerializer, ProductSerializer

# A versioned URL names one exact photo, so it can be cached for good.
IMMUTABLE = "public, max-age=31536000, immutable"


def products_with_image_version():
    """Products plus their photo checksum, joined in one query. Only the
    checksum is selected, never the image bytes."""
    return Product.objects.select_related("category").annotate(
        image_version=F("image__checksum")
    )


class CategoryViewSet(viewsets.ModelViewSet):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    permission_classes = [IsSuperAdminOrReadOnly]
    search_fields = ["name"]


class ProductViewSet(viewsets.ModelViewSet):
    serializer_class = ProductSerializer
    permission_classes = [IsSuperAdminOrReadOnly]
    search_fields = ["name", "barcode"]
    filterset_fields = ["category", "is_active"]
    ordering_fields = ["name", "price", "created_at"]

    def get_queryset(self):
        return products_with_image_version()

    def get_permissions(self):
        # Photos are public: an <img> tag cannot send the login token, and the
        # website shows the same pictures to anyone. Changing one still needs
        # a super admin (the view's normal rule for writes).
        if self.action == "image" and self.request.method in SAFE_METHODS:
            return [AllowAny()]
        return super().get_permissions()

    @action(detail=False, methods=["get"])
    def lookup(self, request):
        """Resolve a scanned barcode to a product.

        A dedicated endpoint rather than a search, because the POS needs one
        exact hit per scan and must stay fast on a large catalogue.
        """
        barcode = (request.query_params.get("barcode") or "").strip()
        if not barcode:
            return Response({"detail": "barcode is required."}, status=400)
        product = products_with_image_version().filter(
            barcode=barcode, is_active=True
        ).first()
        if not product:
            return Response({"detail": f"No active product with barcode {barcode}."}, status=404)
        return Response(self.get_serializer(product).data)

    @action(detail=True, methods=["get", "post", "delete"])
    def image(self, request, pk=None):
        """GET the photo (``?size=thumb`` for the small one); POST a new one as
        multipart field ``image``; DELETE it."""
        if request.method in SAFE_METHODS:  # GET, and the HEAD that DRF adds
            return self._serve_image(request, pk)

        product = self.get_object()
        if request.method == "DELETE":
            ProductImage.objects.filter(product=product).delete()
        else:
            upload = request.FILES.get("image")
            if upload is None:
                return Response({"image": ["Send the photo as the 'image' field."]}, status=400)
            try:
                processed = process_upload(upload)
            except InvalidImage as exc:
                return Response({"image": [str(exc)]}, status=400)
            ProductImage.objects.update_or_create(
                product=product,
                defaults={
                    "data": processed.data,
                    "thumbnail": processed.thumbnail,
                    "content_type": processed.content_type,
                    "width": processed.width,
                    "height": processed.height,
                    "checksum": processed.checksum,
                },
            )
        # The product as it now stands, so the client gets the new image_url.
        return Response(self.get_serializer(self.get_queryset().get(pk=product.pk)).data)

    def _serve_image(self, request, pk):
        try:
            product_id = int(pk)
        except (TypeError, ValueError):
            raise Http404("No such product.")
        thumb = request.query_params.get("size") == "thumb"
        field = "thumbnail" if thumb else "data"
        photo = (
            ProductImage.objects.filter(product_id=product_id)
            .values(field, "checksum", "content_type")
            .first()
        )
        if photo is None:
            raise Http404("This product has no photo.")

        version = photo["checksum"][:16]
        etag = f'"{version}-{"thumb" if thumb else "full"}"'
        # Unversioned or stale-versioned URLs must revalidate, or a replaced
        # photo would keep showing from cache.
        cache = IMMUTABLE if request.query_params.get("v") == version else "no-cache"
        if request.headers.get("If-None-Match") == etag:
            response = HttpResponseNotModified()
        else:
            response = HttpResponse(bytes(photo[field]), content_type=photo["content_type"])
        response["ETag"] = etag
        response["Cache-Control"] = cache
        return response
