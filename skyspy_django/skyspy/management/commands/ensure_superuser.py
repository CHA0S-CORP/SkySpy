"""Create the configured bootstrap admin without changing existing accounts."""

import os

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Create the configured superuser only if the account does not exist."

    def handle(self, *args, **options):
        model = get_user_model()
        username = os.environ.get(f"DJANGO_SUPERUSER_{model.USERNAME_FIELD.upper()}")
        if not username:
            raise CommandError("Configure DJANGO_SUPERUSER_USERNAME before starting the API.")
        if model._default_manager.filter(**{model.USERNAME_FIELD: username}).exists():
            self.stdout.write("Bootstrap account already exists; credentials unchanged.")
            return
        if not os.environ.get("DJANGO_SUPERUSER_PASSWORD"):
            raise CommandError("Configure DJANGO_SUPERUSER_PASSWORD to create the bootstrap account.")
        call_command("createsuperuser", interactive=False, stdout=self.stdout, stderr=self.stderr)
