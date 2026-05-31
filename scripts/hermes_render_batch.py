#!/usr/bin/env python3
"""
hermes_render_batch.py — Hermes batch render client for HyperFrames.

Submits a list of render specs to the HyperFrames API, polls for completion,
and returns a structured JSON result. Uses httpx.AsyncClient with asyncio.

Example:
  echo '[{"type":"template","template":"jewelry-reveal","params":{"compositionId":"ring-001","title":"14k Ring","price":"$349","productImageUrl":"https://example.com/img.jpg"}}]' > /tmp/batch.json
  python hermes_render_batch.py --input /tmp/batch.json --agent-id hermes --output /tmp/results.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger("hermes_render_batch")

# ── Types ──────────────────────────────────────────────────────────────


@dataclass
class RenderSpec:
    """A single render specification."""

    type: str  # "template" | "generate" | "job"
    template: str | None = None
    params: dict[str, Any] | None = None
    spec: dict[str, Any] | None = None
    composition: str | None = None
    meta: dict[str, str] | None = None


@dataclass
class RenderResult:
    """Result of a single render job."""

    jobId: str
    type: str
    composition: str
    status: str  # "done" | "failed" | "timed_out"
    url: str | None = None
    error: str | None = None
    durationMs: int | None = None
    meta: dict[str, str] = field(default_factory=dict)


@dataclass
class BatchOutput:
    """Top-level batch output."""

    submitted: int = 0
    succeeded: int = 0
    failed: int = 0
    timed_out: int = 0
    duration_seconds: float = 0.0
    jobs: list[RenderResult] = field(default_factory=list)


# ── API Client ─────────────────────────────────────────────────────────


class HyperFramesClient:
    """Async HTTP client for HyperFrames API."""

    def __init__(
        self,
        base_url: str,
        api_key: str,
        callback_url: str | None,
        agent_id: str,
        semaphore: asyncio.Semaphore,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.callback_url = callback_url
        self.agent_id = agent_id
        self.semaphore = semaphore
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(15.0))

    async def close(self) -> None:
        await self._client.aclose()

    def _headers(self) -> dict[str, str]:
        h: dict[str, str] = {
            "Content-Type": "application/json",
        }
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    def _build_body(self, spec: RenderSpec) -> dict[str, Any]:
        """Build the POST body for a given spec, including optional fields."""
        body: dict[str, Any] = {
            "agentId": self.agent_id,
        }
        if self.callback_url:
            body["callbackUrl"] = self.callback_url
        if spec.meta:
            body["meta"] = spec.meta

        if spec.type == "template":
            if not spec.template:
                raise ValueError("template type requires 'template' field")
            if not spec.params:
                raise ValueError("template type requires 'params' field")
            body["template"] = spec.template
            body["params"] = spec.params
        elif spec.type == "generate":
            if not spec.spec:
                raise ValueError("generate type requires 'spec' field")
            body["spec"] = spec.spec
        elif spec.type == "job":
            if not spec.composition:
                raise ValueError("job type requires 'composition' field")
            body["composition"] = spec.composition
        else:
            raise ValueError(f"unknown spec type: {spec.type}")

        return body

    def _endpoint_for(self, spec_type: str) -> str:
        if spec_type == "template":
            return f"{self.base_url}/api/render-template"
        if spec_type == "generate":
            return f"{self.base_url}/api/generate"
        return f"{self.base_url}/api/jobs"

    async def submit_job(self, spec: RenderSpec) -> str:
        """Submit a job and return the jobId. Raises on API error."""
        body = self._build_body(spec)
        endpoint = self._endpoint_for(spec.type)

        async with self.semaphore:
            response = await self._client.post(
                endpoint,
                headers=self._headers(),
                json=body,
            )

        if response.status_code == 429:
            data = response.json()
            reset_at = data.get("resetAt", "unknown")
            raise RuntimeError(
                f"Rate limited (429). Resets at {reset_at}. "
                f"Daily limit reached or concurrency too high."
            )

        if not response.ok:
            text = await response.atext()
            raise RuntimeError(
                f"Submit failed ({response.status_code}): {text[:500]}"
            )

        data = response.json()
        return str(data["jobId"])

    async def poll_job(self, job_id: str) -> dict[str, Any]:
        """Fetch job status. Returns the full job JSON."""
        async with self.semaphore:
            response = await self._client.get(
                f"{self.base_url}/api/jobs/{job_id}",
                headers=self._headers(),
            )

        if not response.ok:
            text = await response.atext()
            logger.warning("poll %s failed (%s): %s", job_id, response.status_code, text[:200])
            return {"status": "unknown", "finished": False}

        data = response.json()
        return data  # type: ignore[no-any-return]


# ── Batch Logic ────────────────────────────────────────────────────────


async def run_batch(
    specs: list[RenderSpec],
    *,
    api_url: str,
    api_key: str,
    callback_url: str | None,
    agent_id: str,
    poll_interval: int = 10,
    timeout: int = 600,
) -> BatchOutput:
    """Execute a batch of render jobs.

    Submits all jobs, then polls them in parallel until completion or timeout.
    """
    start_time = time.monotonic()
    output = BatchOutput(submitted=len(specs))
    semaphore = asyncio.Semaphore(5)
    client = HyperFramesClient(api_url, api_key, callback_url, agent_id, semaphore)

    try:
        # ── Submit all jobs concurrently ──
        submitted_jobs: list[tuple[int, RenderSpec, str | None, str | None]] = []

        async def submit_one(index: int, spec: RenderSpec) -> tuple[int, RenderSpec, str | None, str | None]:
            try:
                job_id = await client.submit_job(spec)
                comp = spec.composition or (spec.params or {}).get("compositionId", "") or ""
                logger.info("[%d/%d] submitted jobId=%s type=%s composition=%s",
                            index + 1, len(specs), job_id, spec.type, comp)
                return index, spec, job_id, None
            except Exception as exc:
                logger.error("[%d/%d] submit failed: %s", index + 1, len(specs), exc)
                return index, spec, None, str(exc)

        submit_tasks = [submit_one(i, s) for i, s in enumerate(specs)]
        results = await asyncio.gather(*submit_tasks)

        in_flight: dict[str, tuple[int, RenderSpec]] = {}
        for idx, spec, job_id, err in results:
            if job_id and not err:
                in_flight[job_id] = (idx, spec)
            else:
                output.jobs.append(RenderResult(
                    jobId="",
                    type=spec.type,
                    composition=spec.composition or "",
                    status="failed",
                    error=err or "submit failed",
                    meta=spec.meta or {},
                ))
                output.failed += 1

        # ── Poll loop ──
        deadline = time.monotonic() + timeout

        while in_flight and time.monotonic() < deadline:
            logger.info("polling %d in-flight jobs...", len(in_flight))
            await asyncio.sleep(poll_interval)

            poll_tasks = {
                job_id: client.poll_job(job_id)
                for job_id in in_flight
            }
            poll_results = await asyncio.gather(*poll_tasks.values())

            for job_id, job_data in zip(poll_tasks.keys(), poll_results):
                if job_data.get("finished") is not True:
                    continue

                idx, spec = in_flight.pop(job_id)
                status = str(job_data.get("status", ""))
                result = RenderResult(
                    jobId=job_id,
                    type=spec.type,
                    composition=spec.composition or "",
                    status="done" if status == "done" else "failed",
                    url=job_data.get("url"),
                    error=job_data.get("error"),
                    durationMs=job_data.get("durationMs"),
                    meta=spec.meta or {},
                )
                output.jobs.append(result)
                if result.status == "done":
                    output.succeeded += 1
                    logger.info("job %s done — url=%s", job_id, (result.url or "")[:80])
                else:
                    output.failed += 1
                    logger.warning("job %s failed — error=%s", job_id, result.error)

        # ── Handle timeout leftovers ──
        for job_id, (idx, spec) in in_flight.items():
            output.jobs.append(RenderResult(
                jobId=job_id,
                type=spec.type,
                composition=spec.composition or "",
                status="timed_out",
                error=f"exceeded timeout of {timeout}s",
                meta=spec.meta or {},
            ))
            output.timed_out += 1
            logger.warning("job %s timed out after %ds", job_id, timeout)

    finally:
        await client.close()

    output.duration_seconds = round(time.monotonic() - start_time, 2)
    return output


# ── CLI ────────────────────────────────────────────────────────────────


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Submit a batch of renders to HyperFrames and poll for results.",
    )
    parser.add_argument(
        "--api-url",
        default=os.environ.get("HYPERFRAMES_URL", ""),
        help="HyperFrames base URL (default: $HYPERFRAMES_URL)",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("RENDER_API_KEY", ""),
        help="Bearer token (default: $RENDER_API_KEY)",
    )
    parser.add_argument(
        "--callback",
        default="https://n8n.trapmoney.dpdns.org/webhook/video-done",
        help="n8n webhook URL for per-job callbacks",
    )
    parser.add_argument(
        "--agent-id",
        default="hermes",
        help="Agent identifier (default: hermes)",
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Path to JSON file containing a list of RenderSpec objects",
    )
    parser.add_argument(
        "--poll-interval",
        type=int,
        default=10,
        help="Seconds between polls (default: 10)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=600,
        help="Max seconds to wait for all jobs (default: 600)",
    )
    parser.add_argument(
        "--output",
        default="",
        help="Path to write results JSON (default: stdout)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be submitted without calling the API",
    )
    return parser.parse_args(argv)


def validate_spec(spec: dict[str, Any]) -> RenderSpec:
    """Parse and validate a raw dict into a RenderSpec."""
    spec_type = spec.get("type", "")
    if spec_type not in ("template", "generate", "job"):
        raise ValueError(f"spec type must be 'template', 'generate', or 'job', got '{spec_type}'")

    rs = RenderSpec(type=spec_type, meta=spec.get("meta"))

    if spec_type == "template":
        rs.template = spec.get("template", "")
        if not rs.template:
            raise ValueError("template type requires non-empty 'template' field")
        rs.params = spec.get("params")
        if not rs.params:
            raise ValueError("template type requires non-empty 'params' field")
    elif spec_type == "generate":
        rs.spec = spec.get("spec")
        if not rs.spec:
            raise ValueError("generate type requires non-empty 'spec' field")
    elif spec_type == "job":
        rs.composition = spec.get("composition")
        if not rs.composition:
            raise ValueError("job type requires non-empty 'composition' field")

    return rs


def dry_run_print(specs: list[RenderSpec], args: argparse.Namespace) -> None:
    """Print what would be submitted without making any API calls."""
    print(json.dumps({
        "dry_run": True,
        "api_url": args.api_url,
        "agent_id": args.agent_id,
        "callback": args.callback,
        "count": len(specs),
        "specs": [
            {
                "type": s.type,
                "template": s.template,
                "params": s.params,
                "composition": s.composition,
                "has_spec": s.spec is not None,
                "meta": s.meta,
            }
            for s in specs
        ],
    }, indent=2))


def main() -> None:
    """Entry point."""
    args = parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        stream=sys.stderr,
        datefmt="%H:%M:%S",
    )

    if not args.api_url:
        logger.error("HYPERFRAMES_URL not set and --api-url not provided")
        sys.exit(1)

    if not args.api_key and not args.dry_run:
        logger.warning("RENDER_API_KEY not set — API calls may fail with 401")

    # ── Load and validate input ──
    try:
        with open(args.input) as f:
            raw_list: list[dict[str, Any]] = json.load(f)
    except Exception as exc:
        logger.error("Failed to load input file '%s': %s", args.input, exc)
        sys.exit(1)

    if not isinstance(raw_list, list):
        logger.error("Input must be a JSON array of spec objects")
        sys.exit(1)

    specs: list[RenderSpec] = []
    for i, item in enumerate(raw_list):
        try:
            specs.append(validate_spec(item))
        except ValueError as exc:
            logger.error("Spec [%d] invalid: %s", i, exc)
            sys.exit(1)

    # ── Dry run ──
    if args.dry_run:
        dry_run_print(specs, args)
        return

    # ── Execute ──
    logger.info("Submitting %d render jobs to %s ...", len(specs), args.api_url)
    output = asyncio.run(
        run_batch(
            specs,
            api_url=args.api_url,
            api_key=args.api_key,
            callback_url=args.callback,
            agent_id=args.agent_id,
            poll_interval=args.poll_interval,
            timeout=args.timeout,
        )
    )

    # ── Output ──
    result_json = json.dumps({
        "submitted": output.submitted,
        "succeeded": output.succeeded,
        "failed": output.failed,
        "timed_out": output.timed_out,
        "duration_seconds": output.duration_seconds,
        "jobs": [
            {
                "jobId": j.jobId,
                "type": j.type,
                "composition": j.composition,
                "status": j.status,
                "url": j.url,
                "error": j.error,
                "durationMs": j.durationMs,
                "meta": j.meta,
            }
            for j in output.jobs
        ],
    }, indent=2)

    if args.output:
        with open(args.output, "w") as f:
            f.write(result_json)
        logger.info("Results written to %s", args.output)
    else:
        print(result_json)

    # Exit code: 0 if all succeeded, 1 otherwise
    if output.failed > 0 or output.timed_out > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
