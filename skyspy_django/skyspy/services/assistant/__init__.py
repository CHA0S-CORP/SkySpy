"""LLM assistant: a LangChain tool-calling agent over SkySpy's analytics and
search services, served by any OpenAI-compatible model endpoint (vLLM/OpenAI/Ollama).

Public API:
- ``tools`` — read-only tool functions + ``get_tools()`` (LangChain wrappers)
- ``agent`` — ``ask()`` / ``astream()`` over those tools
"""
