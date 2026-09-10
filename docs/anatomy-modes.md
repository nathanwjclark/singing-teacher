# Anatomy display

`AnatomyModes` wraps the existing reference panel:

```tsx
<AnatomyModes candidates={candidateRecords}>
  <AnatomyPanel {...existingProps} />
</AnatomyModes>
```

Default is the existing live reference; switching tabs keeps it mounted. Mapped displays a selected engine candidate, with alternative candidates in the selector and parameter statuses (fixed, inferred, measured), uncertainty method, mismatch flag, evidence IDs, solver version and artifact digest in the details panel. Predicted versus observed results belong in the experimentation dashboard; this component accepts anatomy records only.

Without fitted engine geometry, mapped mode explicitly reports unavailable. Surface captures and tracked tongue pixels do not become inferred internal anatomy. An imported provenance declaration is displayed as supplied; a digest verifies artifact consistency, not the producer's scientific validity.

Import a validated `candidate-anatomy` JSON record and its separate self-contained GLB v2 or glTF file. Geometry requires `availability: available`, `provenance.kind: engine-generated`, solver metadata and a matching geometry byte count and SHA-256. GLB resources must be embedded; glTF resources must use data URIs. No artifact URI is fetched, uploaded or persisted. Compressed geometry needing a separate decoder is not supported. Files are limited to 2 MB of metadata and 64 MB of geometry.

Light verification: TypeScript/Vite build, lint, and browser smoke for valid artifact hashing, wrong-hash and external-resource rejection, both mode toggles, and unavailable state.
