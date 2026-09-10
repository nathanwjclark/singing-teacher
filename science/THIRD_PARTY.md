# Third-party source and assets

- VocalTractLab: https://github.com/TUD-STKS/VocalTractLabBackend-dev
  pinned at `df30392f18dc5e175b577c3ba734caaa65a3927f` as a Git submodule.
  Source is GPL-3.0-or-later; retain its LICENSE and source notices.
- `resources/JD3.speaker` is the upstream reference asset distributed in that
  repository, not a scan of the user. Preserve provenance and review any additional
  asset restrictions before distributing derived datasets beyond research use.
- Our patch changes the anatomy loop in an exported source copy. The patch and
  modified upstream source retain GPL-3.0-or-later.
- GoogleTest v1.16.0 is fetched by upstream CMake for tests (BSD-3-Clause).
- NumPy and SciPy use BSD-style licenses; pytest uses MIT. Installed distributions
  contain their authoritative license notices.

Generated benchmark recordings are synthetic and contain no user media.
