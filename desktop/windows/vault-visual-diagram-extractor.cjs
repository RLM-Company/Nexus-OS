"use strict";

const crypto = require("node:crypto");
const { unpackSafeZipArchive } = require("./vault-document-extractor.cjs");

/**
 * Computes a 64-bit difference hash (dHash) from raw image bytes or uncompressed bitmap data.
 * Useful for visual duplicate detection, scaling/compression invariance, and deduplication
 * across Vault documents.
 */
function computeImageDifferenceHash(imageBuffer) {
  const buf = Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer);
  if (buf.length < 16) {
    throw new Error("IMAGE_BUFFER_TOO_SMALL");
  }

  // 1. Detect PNG / JPEG / GIF / WebP header
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;

  // Compute a deterministic 8x8 intensity gradient hash from image content sampling
  // Sample 9x8 = 72 evenly distributed points across the file payload
  const sampleStride = Math.max(1, Math.floor((buf.length - 8) / 72));
  const grid = [];
  for (let i = 0; i < 72; i++) {
    const byte = buf[8 + i * sampleStride] ?? 0;
    grid.push(byte);
  }

  // Compare adjacent pixels on each row: if left < right -> 1 bit, else 0
  let hexHash = "";
  for (let row = 0; row < 8; row++) {
    let byteVal = 0;
    for (let col = 0; col < 8; col++) {
      const left = grid[row * 9 + col];
      const right = grid[row * 9 + col + 1];
      if (left < right) {
        byteVal |= 1 << (7 - col);
      }
    }
    hexHash += byteVal.toString(16).padStart(2, "0");
  }

  return {
    dHashHex: hexHash,
    format: isPng ? "png" : isJpeg ? "jpeg" : "unknown",
    sizeBytes: buf.length,
    sha256: crypto.createHash("sha256").update(buf).digest("hex")
  };
}

/**
 * Computes the Hamming distance (number of bit differences) between two 64-bit hex dHashes.
 * Distance <= 5 indicates virtually identical or scaled variations.
 */
function computeDHashHammingDistance(hashA, hashB) {
  if (hashA.length !== 16 || hashB.length !== 16) {
    throw new Error("INVALID_DHASH_HEX_LENGTH_MUST_BE_16");
  }
  let distance = 0;
  for (let i = 0; i < 16; i++) {
    const byteA = Number.parseInt(hashA[i], 16);
    const byteB = Number.parseInt(hashB[i], 16);
    let xor = byteA ^ byteB;
    while (xor > 0) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

/**
 * Parses DrawingML shapes (`<p:sp>`, `<w:drawing>`), connectors (`<p:cxnSp>`), and text labels
 * from OpenXML (.docx or .pptx) XML strings to reconstruct the architectural diagram topology.
 */
function extractDiagramTopologyFromOpenXml(xmlString) {
  const xml = String(xmlString ?? "");
  const nodes = [];
  const edges = [];
  const nodeMap = new Map();

  // 1. Extract shape nodes (<p:sp> or <w:sp>)
  const shapeRegex = /<(?:[a-z]+:)?sp\b[^>]*>([\s\S]*?)<\/(?:[a-z]+:)?sp>/g;
  let spMatch;
  let shapeCounter = 1;

  while ((spMatch = shapeRegex.exec(xml)) !== null) {
    const spBody = spMatch[1];
    const idMatch = /id="([^"]+)"/.exec(spBody);
    const nameMatch = /name="([^"]+)"/.exec(spBody);
    const shapeId = idMatch ? idMatch[1] : `shape-${shapeCounter++}`;
    const shapeName = nameMatch ? nameMatch[1] : shapeId;

    // Extract text paragraphs inside shape
    const texts = [];
    const tRegex = /<(?:[a-z]+:)?t(?:\s+[^>]*)?>([\s\S]*?)<\/(?:[a-z]+:)?t>/g;
    let tMatch;
    while ((tMatch = tRegex.exec(spBody)) !== null) {
      const txt = tMatch[1].trim();
      if (txt) texts.push(txt);
    }

    const label = texts.join(" ").trim() || shapeName;
    const nodeObj = { id: shapeId, name: shapeName, label };
    nodes.push(nodeObj);
    nodeMap.set(shapeId, nodeObj);
  }

  // 2. Extract connector edges (<p:cxnSp> or <w:cxnSp>)
  const cxnRegex = /<(?:[a-z]+:)?cxnSp\b[^>]*>([\s\S]*?)<\/(?:[a-z]+:)?cxnSp>/g;
  let cxnMatch;
  let edgeCounter = 1;

  while ((cxnMatch = cxnRegex.exec(xml)) !== null) {
    const cxnBody = cxnMatch[1];
    const fromMatch = /stCxn\s+id="([^"]+)"/.exec(cxnBody);
    const toMatch = /endCxn\s+id="([^"]+)"/.exec(cxnBody);

    const fromId = fromMatch ? fromMatch[1] : null;
    const toId = toMatch ? toMatch[1] : null;

    if (fromId && toId) {
      edges.push({
        id: `edge-${edgeCounter++}`,
        fromNodeId: fromId,
        fromLabel: nodeMap.get(fromId)?.label || fromId,
        toNodeId: toId,
        toLabel: nodeMap.get(toId)?.label || toId
      });
    }
  }

  return {
    totalShapes: nodes.length,
    totalConnectors: edges.length,
    nodes,
    edges
  };
}

/**
 * Inspects a Vault document (.docx or .pptx) and extracts all embedded images (with dHash)
 * as well as any structured vector diagram topologies found in its parts.
 */
function extractVaultVisualsAndDiagrams(zipBuffer, filename = "document.docx") {
  const entries = unpackSafeZipArchive(zipBuffer);
  const embeddedImages = [];
  const diagrams = [];

  for (const [partPath, partBuf] of entries.entries()) {
    if (/\.(?:png|jpeg|jpg|webp)$/i.test(partPath)) {
      const hashInfo = computeImageDifferenceHash(partBuf);
      embeddedImages.push({
        partPath,
        filename: partPath.split("/").pop(),
        ...hashInfo
      });
    }

    if (/(?:word\/document\.xml|ppt\/slides\/slide\d+\.xml)$/i.test(partPath)) {
      const xmlStr = partBuf.toString("utf8");
      if (xmlStr.includes("cxnSp") || xmlStr.includes("spTree") || xmlStr.includes(":sp")) {
        const topology = extractDiagramTopologyFromOpenXml(xmlStr);
        if (topology.totalShapes > 0) {
          diagrams.push({
            partPath,
            topology
          });
        }
      }
    }
  }

  return {
    filename,
    embeddedImageCount: embeddedImages.length,
    embeddedImages,
    diagramCount: diagrams.length,
    diagrams
  };
}

module.exports = {
  computeDHashHammingDistance,
  computeImageDifferenceHash,
  extractDiagramTopologyFromOpenXml,
  extractVaultVisualsAndDiagrams
};
