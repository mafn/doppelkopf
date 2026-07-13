# V3 testkit ownership

This module will contain versioned, declarative V3 fixtures and tactical-oracle
helpers. Production engine exports must not expose its test-only builders.

Fixtures retain schemas, compact inputs, configurations, and reviewed golden
reports. Generated datasets, trajectories, checkpoints, and local benchmark
results belong outside Git and outside this browser package.
