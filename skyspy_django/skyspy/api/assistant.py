"""
Assistant API — natural-language analytics/search over the platform.

- POST /api/v1/assistant/ask/     → {answer, steps, sources, status}  (sync)
- POST /api/v1/assistant/stream/  → Server-Sent Events (async token stream)

Read-only and feature-gated (ASSISTANT_ENABLED + LLM_ENABLED). The heavy
LangChain/agent work lives in services/assistant; these views are thin.
"""

import json
import logging

from asgiref.sync import sync_to_async
from django.http import StreamingHttpResponse
from django.views.decorators.csrf import csrf_exempt
from rest_framework import exceptions
from rest_framework.response import Response
from rest_framework.views import APIView

from skyspy.auth.authentication import APIKeyAuthentication, OptionalJWTAuthentication
from skyspy.auth.permissions import CanUseAssistant
from skyspy.services.assistant import agent

logger = logging.getLogger(__name__)


class AssistantStreamView:
    """Marker class naming the streaming endpoint for FeatureBasedPermission.

    ``assistant_stream`` is a plain async Django view (not DRF), so it can't carry
    ``permission_classes``. This class exists only so ``FeatureBasedPermission``
    can map the stream to the ``assistant`` feature by class name and gate it the
    same way ``AssistantAskView`` is gated.
    """


def _authorize_stream(request) -> bool:
    """Authenticate token clients then apply the assistant feature gate (sync).

    Session auth already ran in middleware; JWT/API-key auth normally happens
    inside a DRF view, so run those authenticators here (matching AssistantAskView)
    before evaluating CanUseAssistant. Must run in a sync context (DB access).
    """
    if not getattr(request, "user", None) or not request.user.is_authenticated:
        for authenticator in (OptionalJWTAuthentication(), APIKeyAuthentication()):
            try:
                result = authenticator.authenticate(request)
            except exceptions.AuthenticationFailed:
                result = None
            if result:
                # APIKeyAuthentication sets request.api_key_scopes as a side effect,
                # which CanUseAssistant reads to enforce the assistant.view scope.
                request.user = result[0]
                break
    return bool(CanUseAssistant().has_permission(request, AssistantStreamView()))


class AssistantAskView(APIView):
    """Answer a question with the tool-calling agent (non-streaming)."""

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [CanUseAssistant]

    def post(self, request):
        data = request.data or {}
        query = data.get("query", "")
        context = data.get("context")
        history = data.get("history")
        result = agent.ask(query, context=context, history=history, user=request.user)
        http_status = 200 if result.get("status") in ("ok", "empty_query", "incomplete") else 503
        return Response(result, status=http_status)


class AssistantSuggestView(APIView):
    """Propose follow-up questions for the current conversation.

    A separate, tool-free LLM context (see services/assistant/suggest.py) — never
    calls a tool or touches the agent's answer context. Returns {suggestions:[...]}
    (possibly empty); always 200 so the UI can degrade gracefully.
    """

    authentication_classes = [OptionalJWTAuthentication, APIKeyAuthentication]
    permission_classes = [CanUseAssistant]

    def post(self, request):
        from skyspy.services.assistant import suggest

        data = request.data or {}
        history = data.get("history")
        context = data.get("context")
        suggestions = suggest.suggest_next_prompts(history, context=context)
        return Response({"suggestions": suggestions})


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

    # Gate the stream the same way AssistantAskView is gated. Without this the
    # streaming endpoint (the one the UI actually uses) would bypass the auth and
    # feature checks the sync /ask view enforces.
    if not await sync_to_async(_authorize_stream)(request):
        return StreamingHttpResponse(
            iter([_sse({"type": "error", "message": "authentication required"})]),
            content_type="text/event-stream",
            status=403,
        )

    try:
        body = json.loads(request.body or b"{}")
    except (ValueError, TypeError):
        body = {}
    query = body.get("query", "")
    context = body.get("context")
    history = body.get("history")
    # request.user is already resolved by _authorize_stream above; capture it for
    # the owner-scoped tools (bound via agent.astream(user=...)).
    user = request.user

    async def event_stream():
        try:
            async for event in agent.astream(query, context=context, history=history, user=user):
                yield _sse(event)
        except Exception as e:  # broad: never let the stream 500 mid-flight
            logger.warning(f"assistant_stream failed: {type(e).__name__}: {e}")
            yield _sse({"type": "error", "message": str(e)})
        yield "event: done\ndata: {}\n\n"

    response = StreamingHttpResponse(event_stream(), content_type="text/event-stream")
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"  # disable proxy buffering for SSE
    return response
