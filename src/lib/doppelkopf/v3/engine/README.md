# V3 engine ownership

This module will contain the framework-independent, browser-safe V3 engine.
It owns canonical rules, bound game definitions, actions, transitions,
observations, settlement, replay, and deterministic simulation primitives.

It must not import legacy V1/V2 code, Astro components, Node-only evaluation
tools, Python bindings, or model artifacts. Rules are immutable and bound to a
game definition; callers cannot replace them mid-hand.
