# DEPTH-02: compare the evidence actually collected

The Experiments dashboard accepts KIT records (one record, an array, or an envelope below), displays local ACT trial history and deliberate recordings, and exports metadata as JSON. Import replaces the previous imported package for this view; recordings and trial history remain. Imported media bytes are not uploaded or embedded. Candidate and record callbacks allow the anatomy viewer and reproducibility panel to consume the validated import. The root app owns tab navigation.

No scientific engine or native depth producer is included here. Actual comparisons require Lead A's numerical forecasts, independent evaluations, and recorded observations. Contract/digest validation establishes structural integrity, not accuracy of producer claims. Missing runs and failed/excluded attempts remain visible; missing scores are null. The interface does not manufacture scores or equate landmark z with depth.

## Comparison envelope

```json
{
  "kind": "modality-comparison",
  "version": 1,
  "records": [],
  "runs": [
    {
      "id": "unique-arm-id",
      "comparisonId": "study-id",
      "caseId": "heldout-case-id",
      "protocolId": "predeclared-protocol-id",
      "modality": "audio+rgb+measured-depth",
      "predictionId": "frozen-commit-id",
      "evaluationId": "independent-score-id",
      "inputObservationIds": ["fitting-bundle-id"],
      "solverCallsUsed": 5,
      "articulationParameterCount": 2
    }
  ]
}
```

The IDs above are illustrative placeholders, not executable results. Include genuine contract records referenced by each run. Every comparison case needs exactly one arm for each of `audio`, `audio+rgb`, and `audio+rgb+measured-depth`. Distinct repeats use distinct case IDs. Declare modality according to what the engine consumed, not which sensors were available. The manifest cannot itself prove the engine respected that input restriction; producer execution must be reviewed.

The comparison checks matching held-out audio artifact hashes, intervention, evaluation mode, scoring features/units, permitted solver calls and articulation count. Each arm's actual solver calls must fit its declared limit. Input observations must appear in forecast fitting evidence, and target IDs/media hashes must not overlap those inputs. All forecast commits are digest checked on import; linked evaluations must follow commitment. Numerical results remain per feature in native units, with no cross-unit aggregate. Depth improvement is RGB error minus RGB+depth error and stays null unless all three arms meet the comparison checks.

Measured depth requires timestamped depth/disparity samples, explicit units/frame, a bundled calibration artifact, non-fixture provenance and `stream.settings.depthSource = "hardware"`, shared with DEPTH-01. Browser capture marks depth missing. This validates metadata availability; DEPTH-01 bench/alignment review is still needed to assess accuracy and synchronization.

Validation: `npm run build`, `npm run lint`, and `node --experimental-strip-types --test src/evaluation/modalityComparison.test.ts`. The focused smoke covers matched comparison, missing arms, unfair articulation freedom, estimated depth and tampered commits. All numbers in that test are test-only objects, never app data.
