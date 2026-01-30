"""
Audio transmission API views.

Provides comprehensive audio API endpoints with:
- Audio upload (S3 or local storage)
- Transcription management
- Callsign extraction
- Audio file serving
- Statistics and service status
"""
import logging
import os
from datetime import datetime, timedelta
from pathlib import Path

from django.conf import settings
from django.db.models import Count, Sum
from django.http import FileResponse, HttpResponse
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import extend_schema, OpenApiParameter

from skyspy.models import AudioTransmission
from skyspy.serializers.audio import (
    AudioTransmissionSerializer,
    AudioUploadSerializer,
    AudioStatsSerializer,
)
from skyspy.services.audio import (
    create_transmission,
    get_audio_url,
    get_audio_stats,
    get_service_stats,
    get_matched_radio_calls,
    identify_airframes_from_transcript,
)
from skyspy.services.storage import (
    sanitize_filename,
    read_local_file,
)
from skyspy.auth.authentication import OptionalJWTAuthentication, APIKeyAuthentication
from skyspy.auth.permissions import FeatureBasedPermission

logger = logging.getLogger(__name__)


class AudioViewSet(viewsets.ModelViewSet):
    """ViewSet for audio transmissions."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]

    queryset = AudioTransmission.objects.all()
    serializer_class = AudioTransmissionSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['transcription_status', 'frequency_mhz', 'channel_name']
    parser_classes = [MultiPartParser, FormParser]
    http_method_names = ['get', 'post', 'delete']

    def get_queryset(self):
        """Apply query filters."""
        queryset = super().get_queryset()

        # Time range filter
        hours = self.request.query_params.get('hours')
        if hours:
            try:
                hours = int(hours)
                cutoff = timezone.now() - timedelta(hours=hours)
                queryset = queryset.filter(created_at__gte=cutoff)
            except ValueError:
                pass

        return queryset.order_by('-created_at')

    @extend_schema(
        summary="List audio transmissions",
        parameters=[
            OpenApiParameter(name='hours', type=int, description='Time range in hours'),
            OpenApiParameter(name='transcription_status', type=str, description='Filter by status'),
            OpenApiParameter(name='frequency_mhz', type=float, description='Filter by frequency'),
        ]
    )
    def list(self, request, *args, **kwargs):
        """List audio transmissions."""
        queryset = self.get_queryset()
        page = self.paginate_queryset(queryset)

        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset[:100], many=True)
        return Response({
            'transmissions': serializer.data,
            'count': len(serializer.data),
            'total': queryset.count(),
        })

    @extend_schema(
        summary="Upload audio file",
        request={
            'multipart/form-data': {
                'type': 'object',
                'properties': {
                    'file': {'type': 'string', 'format': 'binary'},
                    'frequency_mhz': {'type': 'number'},
                    'channel_name': {'type': 'string'},
                    'duration_seconds': {'type': 'number'},
                },
                'required': ['file'],
            }
        },
        responses={201: AudioUploadSerializer}
    )
    @action(detail=False, methods=['post'])
    def upload(self, request):
        """
        Upload an audio file.

        Automatically:
        - Stores in S3 or local filesystem based on configuration
        - Calculates duration if not provided
        - Queues for transcription if transcription is enabled
        """
        if 'file' not in request.FILES:
            return Response(
                {'error': 'No file provided'},
                status=status.HTTP_400_BAD_REQUEST
            )

        audio_file = request.FILES['file']

        # Check file size
        max_size = settings.RADIO_MAX_FILE_SIZE_MB * 1024 * 1024
        if audio_file.size > max_size:
            return Response(
                {'error': f'File too large (max {settings.RADIO_MAX_FILE_SIZE_MB}MB)'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Generate filename
        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        ext = os.path.splitext(audio_file.name)[1] or '.mp3'
        filename = f'transmission_{timestamp}{ext}'

        # Read audio data
        audio_data = audio_file.read()

        # Parse optional parameters
        frequency_mhz = None
        if request.data.get('frequency_mhz'):
            try:
                frequency_mhz = float(request.data.get('frequency_mhz'))
            except (TypeError, ValueError):
                pass

        duration_seconds = None
        if request.data.get('duration_seconds'):
            try:
                duration_seconds = float(request.data.get('duration_seconds'))
            except (TypeError, ValueError):
                pass

        try:
            # Use audio service for full upload handling (S3 + local + duration calc)
            transmission = create_transmission(
                audio_data=audio_data,
                filename=filename,
                frequency_mhz=frequency_mhz,
                channel_name=request.data.get('channel_name'),
                duration_seconds=duration_seconds,
                queue_transcription=True,
            )

            transcription_queued = transmission.transcription_status == 'queued'

            return Response({
                'id': transmission.id,
                'filename': transmission.filename,
                's3_url': transmission.s3_url,
                's3_key': transmission.s3_key,
                'duration_seconds': transmission.duration_seconds,
                'transcription_queued': transcription_queued,
                'message': 'Audio uploaded successfully',
            }, status=status.HTTP_201_CREATED)

        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            logger.error(f"Failed to upload audio: {e}")
            return Response(
                {'error': 'Failed to upload audio'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @extend_schema(
        summary="Queue transcription",
        description="Queue an audio transmission for transcription"
    )
    @action(detail=True, methods=['post'])
    def transcribe(self, request, pk=None):
        """Queue audio for transcription."""
        transmission = self.get_object()

        if transmission.transcription_status == 'completed':
            return Response({
                'message': 'Already transcribed',
                'transcript': transmission.transcript,
            })

        transmission.transcription_status = 'queued'
        transmission.transcription_queued_at = timezone.now()
        transmission.save()

        return Response({
            'id': transmission.id,
            'status': 'queued',
            'message': 'Queued for transcription',
        })

    @extend_schema(
        summary="Get audio statistics",
        responses={200: AudioStatsSerializer}
    )
    @action(detail=False, methods=['get'])
    def stats(self, request):
        """
        Get audio transmission statistics and service status.

        Returns comprehensive stats including:
        - Total transmissions and transcription counts
        - Duration and size totals
        - Breakdown by channel and status
        - Service configuration status
        """
        # Use audio service for comprehensive stats
        stats = get_audio_stats()
        service_stats = get_service_stats()

        return Response({
            **stats,
            'service': service_stats,
        })

    @extend_schema(
        summary="Get audio service statistics",
        description="Get detailed service-level statistics for audio transcription"
    )
    @action(detail=False, methods=['get'], url_path='service-stats')
    def service_stats(self, request):
        """
        Get audio service-specific statistics.

        Returns service-level stats including:
        - Queue depth and processing rate
        - Error rates and service connectivity
        - Transcription service status
        """
        service_stats = get_service_stats()

        return Response({
            'status': 'online' if service_stats.get('whisper_available') else 'offline',
            'queue_depth': service_stats.get('pending_count', 0),
            'pending': service_stats.get('pending_count', 0),
            'queued_count': service_stats.get('pending_count', 0),
            'processing_rate': service_stats.get('processing_rate', 0),
            'error_rate': service_stats.get('error_rate', 0),
            'failed_count': service_stats.get('failed_count', 0),
            'errors': service_stats.get('errors', 0),
            'service_online': service_stats.get('whisper_available', False),
            'connected': service_stats.get('whisper_available', False),
            **service_stats,
        })

    @extend_schema(
        summary="Extract airframes from transcript",
        description="Parse transcript to identify mentioned aircraft callsigns"
    )
    @action(detail=True, methods=['post'], url_path='match-airframes')
    def match_airframes(self, request, pk=None):
        """
        Extract identified airframes from transcript.

        Uses comprehensive callsign extraction to identify:
        - Airline callsigns (AAL123, UAL456, DAL789)
        - N-numbers (N12345, N123AB)
        - Military callsigns (REACH, NAVY, ARMY)
        - International radio callsigns
        """
        transmission = self.get_object()

        if not transmission.transcript:
            return Response(
                {'error': 'No transcript available'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Use audio service for comprehensive callsign extraction
        identified = identify_airframes_from_transcript(
            transmission.transcript,
            segments=transmission.transcript_segments,
            duration_seconds=transmission.duration_seconds,
        )

        transmission.identified_airframes = identified
        transmission.save()

        return Response({
            'id': transmission.id,
            'identified_airframes': identified,
            'count': len(identified),
        })

    @extend_schema(
        summary="Serve audio file",
        description="Serve audio file from local storage (for non-S3 setups)"
    )
    @action(detail=False, methods=['get'], url_path='file/(?P<filename>[^/]+)')
    def serve_file(self, request, filename=None):
        """
        Serve audio file from local storage.

        For S3-enabled setups, use the s3_url or generate a signed URL.
        This endpoint serves files from local storage only.
        """
        if not filename:
            return Response({'error': 'Filename required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            safe_filename = sanitize_filename(filename)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        audio_data = read_local_file(safe_filename, settings.RADIO_AUDIO_DIR)

        if audio_data is None:
            return Response({'error': 'File not found'}, status=status.HTTP_404_NOT_FOUND)

        # Determine content type
        ext = Path(safe_filename).suffix.lower().lstrip('.')
        content_types = {
            'mp3': 'audio/mpeg',
            'wav': 'audio/wav',
            'ogg': 'audio/ogg',
            'flac': 'audio/flac',
        }
        content_type = content_types.get(ext, 'audio/mpeg')

        response = HttpResponse(audio_data, content_type=content_type)
        response['Content-Disposition'] = f'inline; filename="{safe_filename}"'
        response['Cache-Control'] = 'max-age=86400'
        return response

    @extend_schema(
        summary="Get audio URL",
        description="Get accessible URL for an audio transmission"
    )
    @action(detail=True, methods=['get'], url_path='url')
    def get_url(self, request, pk=None):
        """
        Get accessible URL for an audio transmission.

        Returns:
        - S3 signed URL for S3-enabled setups
        - Local file API URL for local storage setups
        """
        transmission = self.get_object()
        audio_url = get_audio_url(transmission, signed=True)

        return Response({
            'id': transmission.id,
            'url': audio_url,
            's3_enabled': settings.S3_ENABLED,
            'expires_in': 3600 if settings.S3_ENABLED else None,
        })

    @extend_schema(
        summary="Get matched radio calls",
        description="Get audio transmissions that mention a specific aircraft",
        parameters=[
            OpenApiParameter(name='callsign', type=str, description='Flight callsign (e.g., UAL123)'),
            OpenApiParameter(name='operator_icao', type=str, description='Operator ICAO code (e.g., UAL)'),
            OpenApiParameter(name='registration', type=str, description='Aircraft registration (e.g., N12345)'),
            OpenApiParameter(name='hours', type=int, description='Time range in hours (default 24)'),
            OpenApiParameter(name='limit', type=int, description='Max results (default 10)'),
        ]
    )
    @action(detail=False, methods=['get'], url_path='matched')
    def matched_calls(self, request):
        """
        Get audio transmissions that mention a specific aircraft.

        Searches transcripts for callsign mentions and returns matched
        transmissions with transcript excerpts and audio URLs.
        """
        callsign = request.query_params.get('callsign')
        operator_icao = request.query_params.get('operator_icao')
        registration = request.query_params.get('registration')

        if not callsign and not operator_icao and not registration:
            return Response(
                {'error': 'Must provide callsign, operator_icao, or registration'},
                status=status.HTTP_400_BAD_REQUEST
            )

        hours = int(request.query_params.get('hours', 24))
        limit = int(request.query_params.get('limit', 10))

        matched = get_matched_radio_calls(
            callsign=callsign,
            operator_icao=operator_icao,
            registration=registration,
            hours=hours,
            limit=limit,
        )

        return Response({
            'matched_calls': matched,
            'count': len(matched),
            'filters': {
                'callsign': callsign,
                'operator_icao': operator_icao,
                'registration': registration,
                'hours': hours,
                'limit': limit,
            }
        })
