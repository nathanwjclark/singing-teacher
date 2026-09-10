"""Local research commands. No network server or unimplemented sensor endpoints."""
import argparse
import json
from pathlib import Path

from .engine import Engine, write_json
from .inverse import benchmark, fit


def main():
    parser = argparse.ArgumentParser(description="Vocal physics foundation (synthetic research, not a clinical scan)")
    commands = parser.add_subparsers(dest="command", required=True)
    capabilities = commands.add_parser("capabilities")
    capabilities.add_argument("--output", type=Path, required=True)
    forward = commands.add_parser("forward")
    forward.add_argument("--output", type=Path, required=True)
    forward.add_argument("--pose", default="a")
    forward.add_argument("--anatomy", type=Path, help="JSON mapping of named anatomical controls to physical values")
    forward.add_argument("--f0", type=float, default=160.)
    forward.add_argument("--duration", type=float, default=.4)
    recover = commands.add_parser("fit-transfer")
    recover.add_argument("observations", type=Path)
    recover.add_argument("--output", type=Path, required=True)
    recover.add_argument("--starts", type=int, default=6)
    recover.add_argument("--seed", type=int, default=1)
    bench = commands.add_parser("benchmark")
    bench.add_argument("--output", type=Path, required=True)
    bench.add_argument("--seed", type=int, default=7)
    bench.add_argument("--noise-db", type=float, default=0.)
    bench.add_argument("--starts", type=int, default=6)
    job = commands.add_parser("job", help="Run a validated local scientific job request in a fresh private directory")
    job.add_argument("request", type=Path, help="JSON JobService request; media stays in its existing artifact store")
    job.add_argument("--output", type=Path, required=True)
    job.add_argument("--timeout", type=float, default=180., help="Worker deadline in seconds, 1–3600")
    args = parser.parse_args()
    try:
        if args.output.exists():
            raise ValueError(f"Refusing to overwrite {args.output}")
        if args.command == "job":
            from .service import JobService
            if args.request.stat().st_size > 2_000_000:
                raise ValueError("Job request exceeds 2 MB")
            request = json.loads(args.request.read_text())
            args.output.mkdir(parents=True, mode=0o700, exist_ok=False)
            with JobService(args.output / "jobs", timeout_s=args.timeout) as service:
                if isinstance(request, dict) and "session_id" in request and "model_id" in request:
                    # Fresh, local one-shot registry; not authorization for a
                    # shared remote session or replacement of B's model ledger.
                    service.register_model(request["session_id"], request["model_id"])
                job_id = service.submit(request, idempotency_key="requested-job")
                state = service.wait(job_id, timeout_s=args.timeout + 5)
                receipt = {"job_id": job_id, **state}
                if state["status"] == "succeeded":
                    service.result(job_id)  # Verify the published artifact manifest.
                    receipt["result_path"] = str((args.output / "jobs" / "artifacts" / job_id / "result.json").resolve())
                write_json(args.output / "job.json", receipt)
                if state["status"] != "succeeded":
                    raise RuntimeError(f"Job {job_id} {state['status']}: {state['error']}")
                print(json.dumps(receipt, indent=2, allow_nan=False))
            return
        if args.command == "benchmark":
            print(json.dumps(benchmark(args.output, seed=args.seed, noise_db=args.noise_db, starts=args.starts), indent=2, allow_nan=False))
            return
        with Engine() as engine:
            if args.command == "capabilities":
                value = engine.capabilities()
            elif args.command == "forward":
                anatomy = json.loads(args.anatomy.read_text()) if args.anatomy else {}
                engine.export(args.output, pose=args.pose, anatomy=anatomy, f0_hz=args.f0, duration_s=args.duration)
                print(f"Wrote synthetic audio and model geometry to {args.output}")
                return
            else:
                value = fit(engine, json.loads(args.observations.read_text()), starts=args.starts, seed=args.seed)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            write_json(args.output, value)
            print(f"Wrote {args.output}")
    except (ValueError, RuntimeError, OSError, KeyError, TypeError) as exc:
        parser.exit(1, f"error: {exc}\n")


if __name__ == "__main__":
    main()
