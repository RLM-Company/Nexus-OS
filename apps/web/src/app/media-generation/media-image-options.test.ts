import { describe, expect, it } from "vitest";
import {
  IMAGE_SIZE_FOR_RATIO,
  parseImageConstraints,
  resolveImageOptions
} from "./media-image-options";

const advertised = {
  sizes: ["1024x1024", "1536x1024", "1024x1536"],
  aspectRatios: ["1:1", "3:2", "2:3"],
  qualities: ["low", "medium", "high", "auto"],
  formats: ["png", "jpeg", "webp"],
  maxCount: 1,
  maxPromptLength: 2000,
  supportsReferenceImage: false
};
describe("Studio image provider negotiation", () => {
  it("accepts only complete supported provider constraints and sends correct aspect option", () => {
    const constraints = parseImageConstraints(advertised);
    expect(constraints).not.toBeNull();
    expect(resolveImageOptions(constraints, {
      aspect_ratio: "3:2", quality: "high", format: "webp"
    })).toEqual({ aspect_ratio: "3:2", quality: "high", format: "webp" });
    expect(IMAGE_SIZE_FOR_RATIO["3:2"]).toBe("1536x1024");
  });
  it("never exposes invalid, absent, mismatched or fictitious options", () => {
    for (const value of [
      undefined,
      {},
      { ...advertised, aspectRatios: ["16:9"] },
      { ...advertised, sizes: ["1024x1024"], aspectRatios: ["3:2"] },
      { ...advertised, formats: ["png", "avif"] },
      { ...advertised, maxCount: 4 }
    ]) {
      expect(parseImageConstraints(value)).toBeNull();
    }
    expect(resolveImageOptions(null, {})).toBeNull();
  });
  it("falls back to a supported subset when an old draft stores removed values", () => {
    const constraints = parseImageConstraints({
      ...advertised,
      sizes: ["1536x1024"],
      aspectRatios: ["3:2"],
      qualities: ["medium"],
      formats: ["jpeg"]
    });
    expect(resolveImageOptions(constraints, {
      aspect_ratio: "16:9", quality: "ultra", format: "png"
    })).toEqual({ aspect_ratio: "3:2", quality: "medium", format: "jpeg" });
  });
});
