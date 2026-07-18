from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from apps.branches.models import Branch

User = get_user_model()


class Command(BaseCommand):
    help = "Create an HQ admin and a demo branch matching the branch backend defaults."

    def handle(self, *args, **options):
        admin, created = User.objects.get_or_create(
            username="hqadmin",
            defaults={"is_staff": True, "is_superuser": True},
        )
        if created:
            admin.set_password("hqadmin12345")
            admin.save()
            self.stdout.write(self.style.SUCCESS("Created HQ admin: hqadmin / hqadmin12345"))

        branch, created = Branch.objects.get_or_create(
            code="BR001",
            defaults={"name": "Downtown Branch", "api_key": "change-me-branch-key"},
        )
        if created:
            self.stdout.write(
                self.style.SUCCESS(f"Created branch {branch.code} (api_key={branch.api_key})")
            )
        else:
            self.stdout.write(f"Branch {branch.code} already exists (api_key={branch.api_key})")
