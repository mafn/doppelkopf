# Security Policy

## Reporting

Please use GitHub's private security advisory flow for vulnerabilities. Do not open a public issue containing an exploit, a malicious model, or private user information.

## Model artifacts

No remote model is trusted by filename or feature width alone. Future model releases must be pinned to an immutable revision and verified against a checksum, engine revision, ruleset hash, observation/action schemas, and declared runtime capabilities before inference. Until that verification path exists, the public UI exposes heuristic bots only.

Never load an unverified checkpoint or ONNX model supplied through an issue or pull request.

## Supported versions

Only the current `main` branch receives security fixes while the project is pre-release.
