// Pinned manifests for the measurement-only semantic OCR bench. Public MIT
// upstream models from microsoft/, ONNX q8 conversions maintained by Xenova.
// The bench loads them only from an operator-installed, byte-verified directory
// (see scripts/install-semantic-ocr-model.mjs); remote fetching is disabled
// during measurement. No model weights are committed to this repository.

export const TROCR = {
  purpose: "handwriting-like line images to text, measurement bench on synthetic fixtures only",
  id: "Xenova/trocr-base-handwritten",
  revision: "e301d1c4c4d4ece88f164518eb7aee07062eaca2",
  upstream_id: "microsoft/trocr-base-handwritten",
  upstream_revision: "eaacaf452b06415df8f10bb6fad3a4c11e609406",
  license: "MIT",
  directory: "trocr-base-handwritten",
  task: "image-to-text",
  dtype: "q8",
  files: {
    "config.json": {
      bytes: 4536,
      sha256: "cab1805dfa83add9c0fdad8418bd9b420a9ba7e90dab7216c371a857ac117201"
    },
    "generation_config.json": {
      bytes: 185,
      sha256: "cce308da91e0d656e07404c70d4b9c9f5839d426f679eff6fda6dcc0e727e3b6"
    },
    "merges.txt": {
      bytes: 456318,
      sha256: "1ce1664773c50f3e0cc8842619a93edc4624525b728b188a9e0be33b7726adc5"
    },
    "vocab.json": {
      bytes: 798293,
      sha256: "ed19656ea1707df69134c4af35c8ceda2cc9860bf2c3495026153a133670ab5e"
    },
    "tokenizer_config.json": {
      bytes: 1376,
      sha256: "d665acdbbe99751cc7a2f1925d8dbd7a9b3bd9bc6bb843fea703caab20e5bc31"
    },
    "tokenizer.json": {
      bytes: 2108614,
      sha256: "2f1a555a1ee93656b4e6f67aa75d492a843c225e5ef754bae24c36bd85851cd7"
    },
    "special_tokens_map.json": {
      bytes: 957,
      sha256: "8293ae960b0a0852d4d3813118030a1149a3ed9fe37bc2e1e7b3c2e62eb2d4b7"
    },
    "preprocessor_config.json": {
      bytes: 378,
      sha256: "0860b87c599518cc75f8d9bdb2eaa99897406b76bbe273055a389c9f81c9c387"
    },
    "quantize_config.json": {
      bytes: 3111,
      sha256: "0299bec509b92f55dc399792b3568d8ae854b62c5631a6cf2b3788fabbb0b65c"
    },
    "onnx/encoder_model_quantized.onnx": {
      bytes: 88082928,
      sha256: "8689f7a6122816789922e2e4f1063646ab69396ad0d1144437bba95dcbab5c86"
    },
    "onnx/decoder_model_merged_quantized.onnx": {
      bytes: 249597124,
      sha256: "624f81a5e10206b7757b08d1fa821a19b7cbbf3970385a934f3cf0529efdfc43"
    }
  },
  total_bytes: 341053820
};

export const TATR = {
  purpose: "table structure recognition, measurement bench on synthetic grid fixtures only",
  id: "Xenova/table-transformer-structure-recognition",
  revision: "5387550de655512721e1b88e4e42117001ba4813",
  upstream_id: "microsoft/table-transformer-structure-recognition",
  upstream_revision: "f4d4bdc85c3fe4b1fa49658882a5d38bbdd0f343",
  license: "MIT",
  directory: "table-transformer-structure-recognition",
  task: "object-detection",
  dtype: "q8",
  files: {
    "config.json": {
      bytes: 1569,
      sha256: "bb8ff6eaee7cde1e9a672ed7cde0ddb50191af79510c4d0df7bdc1369d9efd01"
    },
    "preprocessor_config.json": {
      bytes: 403,
      sha256: "faf6b63783f6bd609daa71ab5f58a1a640c0d27141d68ec32881debb00512876"
    },
    "quantize_config.json": {
      bytes: 1014,
      sha256: "2314beb6341a5ff8b18824b40562752e7ccfb7597419c709fb2bb315c026f06b"
    },
    "onnx/model_quantized.onnx": {
      bytes: 30158413,
      sha256: "c11f4033da75e9c4d41c403ef356e89caa0a37a7d111b55461e7d5ba856bb6b6"
    }
  },
  total_bytes: 30161399
};
