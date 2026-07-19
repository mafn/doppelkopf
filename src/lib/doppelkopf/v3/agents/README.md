# V3 agent ownership

This module will contain browser-safe agent interfaces, manifest compatibility,
and runtime adapters. It receives only an acting seat's V3 observation and
legal actions. It must never import authoritative hidden state, legacy bot
types, Node-only evaluation code, or Python training code.

The only product agents are the Structured-Belief Policy Agent and the
Belief-Search Agent. Encoder ablations and baseline controls do not add product
agent families.
