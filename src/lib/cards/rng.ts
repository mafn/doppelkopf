export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed32(): number {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    return array[0] >>> 0;
  }
  return (Math.floor(Math.random() * 0x100000000) >>> 0) as number;
}
