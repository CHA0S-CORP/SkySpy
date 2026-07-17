"""
Assistant API — natural-language analytics/search over the platform.

- POST /api/v1/assistant/ask/     → {answer, steps, sources, status}  (sync)
- POST /api/v1/assistant/stream/  → Server-Sent Events (async token stream)

Read-only and feature-gated (ASSISTANT_ENABLED + LLM_ENABLED). The heavy
LangChain/agent work lives in services/assistant; these views are thin.
"""

import json
import logging

from django.http import StreamingHttpResponse
from django.views.decorators.csrf import csrf_exempt
from rest_framework.response import Response
from rest_framework.views import APIView

from skyspy.auth.authentication import APIKeyAuthentication, OptionalJWTAuthentication
from skyspy.auth.permissions import FeatureBasedPermission
from skyspy.services.assistant import agent

logger = logging.getLogger(__name__)


class AssistantAskView(APIView):
    """Answer a question with the tool-calling agent (non-streaming)."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [FeatureBasedPermission]

    def post(self, request):
        query = (request.data or {}).get("query", "")
        result = agent.ask(query)
        http_status = 200 if result.get("status") in ("ok", "empty_query") else 503
        return Response(result, status=http_status)


def _sse(event: dict) -> str:
    """Format one dict as an SSE data frame."""
    return f"data: {json.dumps(event, default=str)}\n\n"


@csrf_exempt
async def assistant_stream(request):
    """
    Stream the agent's answer as Server-Sent Events.

    Emits `tool`, `token`, `final`, and `error`/`unavailable` events. This is a
    plain async Django view (not DRF) so it can stream from an async generator
    under ASGI/Daphne.
    """
    if request.method != "POST":
        return StreamingHttpResponse(
            iter([_sse({"type": "error", "message": "POST only"})]), content_type="text/event-stream", status=405
        )

    try:
        body = json.loads(request.body or b"{}")
    except (ValueError, TypeError):
        body = {}
    query = body.get("query", "")

    async def event_stream():
        try:
            async for event in agent.astream(query):
                yield _sse(event)
        except Exception as e:  # broad: never let the stream 500 mid-flight
            logger.warning(f"assistant_stream failed: {type(e).__name__}: {e}")
            yield _sse({"type": "error", "message": str(e)})
        yield "event: done\ndata: {}\n\n"

    response = StreamingHttpResponse(event_stream(), content_type="text/event-stream")
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"  # disable proxy buffering for SSE
    return response
