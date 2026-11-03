// ONNX conversion of MIT-licensed intfloat/multilingual-e5-small.
// See docs/research/SEMANTIC_MEMORY_ENCODER_2026-11-03.md for upstream attribution.
export const MODEL = Object.freeze({
  id: "Xenova/multilingual-e5-small",
  revision: "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
  encoder: "multilingual-e5-small:761b726:q8:mean:l2:384:v1",
  files: {
    "config.json": "cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1",
    "tokenizer_config.json": "a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b",
    "tokenizer.json": "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39",
    "onnx/model_quantized.onnx": "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193"
  }
});
