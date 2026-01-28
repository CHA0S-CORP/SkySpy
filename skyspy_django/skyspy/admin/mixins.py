"""
Reusable admin mixins for export and computed field display.
"""
import csv
import json
from django.http import HttpResponse
from django.utils import timezone


class ExportCSVMixin:
    """Adds CSV export action to admin."""

    def export_as_csv(self, request, queryset):
        """Export selected objects as CSV."""
        meta = self.model._meta
        field_names = [field.name for field in meta.fields]

        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = f'attachment; filename={meta.verbose_name_plural}_{timezone.now().strftime("%Y%m%d_%H%M%S")}.csv'

        writer = csv.writer(response)
        writer.writerow(field_names)

        for obj in queryset:
            row = []
            for field in field_names:
                value = getattr(obj, field)
                if hasattr(value, 'isoformat'):
                    value = value.isoformat()
                elif isinstance(value, (dict, list)):
                    value = json.dumps(value)
                row.append(value)
            writer.writerow(row)

        return response

    export_as_csv.short_description = "Export selected as CSV"


class ExportJSONMixin:
    """Adds JSON export action to admin."""

    def export_as_json(self, request, queryset):
        """Export selected objects as JSON."""
        meta = self.model._meta

        response = HttpResponse(content_type='application/json')
        response['Content-Disposition'] = f'attachment; filename={meta.verbose_name_plural}_{timezone.now().strftime("%Y%m%d_%H%M%S")}.json'

        data = []
        for obj in queryset:
            obj_dict = {}
            for field in meta.fields:
                value = getattr(obj, field.name)
                if hasattr(value, 'isoformat'):
                    value = value.isoformat()
                elif hasattr(value, 'pk'):
                    value = value.pk
                obj_dict[field.name] = value
            data.append(obj_dict)

        response.write(json.dumps(data, indent=2, default=str))
        return response

    export_as_json.short_description = "Export selected as JSON"


class ReadOnlyComputedMixin:
    """Mixin for displaying computed fields as readonly."""

    computed_fields = []

    def get_readonly_fields(self, request, obj=None):
        readonly = list(super().get_readonly_fields(request, obj))
        readonly.extend(self.computed_fields)
        return readonly
