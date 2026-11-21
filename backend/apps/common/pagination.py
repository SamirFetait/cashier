"""Paging for every list the API serves."""
from rest_framework.pagination import PageNumberPagination


class Pagination(PageNumberPagination):
    """25 a page, or as many as the caller asks for with ``?page_size=``, up
    to ``max_page_size``.

    The app loads some lists whole (the till's products for scanning,
    customers, categories) a page of 500 at a time. DRF's own paginator
    ignores ``page_size``, which cut every one of those lists off at 25.
    """

    page_size_query_param = "page_size"
    max_page_size = 500
