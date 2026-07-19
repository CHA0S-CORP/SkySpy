"""Seed local admin + regular users for testing auth-enforced dev (`make dev-auth`).

Idempotent. Creates:
  - an admin superuser (full access — passes every gate), and
  - a regular user assigned a normal role (default: viewer, which has read access
    but NOT assistant.view, so you can exercise the AI/LLM 403 path).

Credentials + the regular user's role are configurable via env:
  DEV_ADMIN_USERNAME / DEV_ADMIN_PASSWORD / DEV_ADMIN_EMAIL
  DEV_USER_USERNAME  / DEV_USER_PASSWORD  / DEV_USER_ROLE

Also ensures the default roles exist (normally seeded by migration 0003) so the
role assignment can't fail on a wiped DB.
"""

import os

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.db import transaction

from skyspy.models.auth import DEFAULT_ROLES, Role, SkyspyUser, UserRole


class Command(BaseCommand):
    help = "Create/refresh a local admin superuser and a regular test user (idempotent)."

    def handle(self, *args, **options):
        admin_username = os.environ.get("DEV_ADMIN_USERNAME", "admin")
        admin_password = os.environ.get("DEV_ADMIN_PASSWORD", "admin")
        admin_email = os.environ.get("DEV_ADMIN_EMAIL", "admin@example.com")

        user_username = os.environ.get("DEV_USER_USERNAME", "user")
        user_password = os.environ.get("DEV_USER_PASSWORD", "user")
        user_role = os.environ.get("DEV_USER_ROLE", "viewer")

        with transaction.atomic():
            self._ensure_roles()
            self._make_admin(admin_username, admin_password, admin_email)
            self._make_user(user_username, user_password, user_role)

        self.stdout.write(self.style.SUCCESS("\nDev auth users ready:"))
        self.stdout.write(
            f"  admin (superuser) : {admin_username} / {admin_password}   → full access, all AI/LLM gates pass"
        )
        self.stdout.write(
            f"  user  ({user_role:<8}): {user_username} / {user_password}   "
            f"→ {'has' if user_role in ('analyst', 'admin', 'superadmin') else 'no'} assistant.view"
        )

    def _ensure_roles(self):
        """Create any missing default roles (migration 0003 normally does this)."""
        for name, spec in DEFAULT_ROLES.items():
            Role.objects.get_or_create(
                name=name,
                defaults={
                    "display_name": spec["display_name"],
                    "description": spec.get("description", ""),
                    "permissions": spec["permissions"],
                    "priority": spec.get("priority", 0),
                    "is_system": True,
                },
            )

    def _make_admin(self, username, password, email):
        user, created = User.objects.get_or_create(
            username=username,
            defaults={"email": email, "is_staff": True, "is_superuser": True},
        )
        user.email = email
        user.is_staff = True
        user.is_superuser = True
        user.set_password(password)
        user.save()
        SkyspyUser.objects.get_or_create(user=user, defaults={"display_name": "Admin"})
        self.stdout.write(f"  {'created' if created else 'updated'} admin superuser: {username}")

    def _make_user(self, username, password, role_name):
        user, created = User.objects.get_or_create(username=username, defaults={"email": f"{username}@example.com"})
        user.is_staff = False
        user.is_superuser = False
        user.set_password(password)
        user.save()
        SkyspyUser.objects.get_or_create(user=user, defaults={"display_name": username.capitalize()})

        role = Role.objects.filter(name=role_name).first()
        if role is None:
            self.stdout.write(self.style.WARNING(f"  role '{role_name}' not found; user created without a role"))
        else:
            UserRole.objects.get_or_create(user=user, role=role)
        self.stdout.write(f"  {'created' if created else 'updated'} regular user: {username} (role: {role_name})")
