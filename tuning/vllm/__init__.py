"""
vLLM serving-config tuner for the SkySpy assistant on a DGX Spark.

Bayesian optimization (Optuna TPE) over vLLM launch flags + model choice,
scored by a blended quality+speed reward:

  quality  <- the golden assistant eval suite (make eval-assistant)
  speed    <- vllm bench serve at concurrency 1 (latency) and N (throughput)

See README.md for how to run it on the Spark.
"""
