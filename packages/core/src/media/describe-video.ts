/**
 * Video description via frame extraction + Vision API.
 *
 * Extracts the first frame using ffmpeg, then describes it
 * with the same Vision API used for images.
 *
 * @see docs/channels/media-handling.md — Media processing pipeline
 */

import { join } from "node:path";
import { execFile } from "node:child_process";
import { mkdir, unlink } from "node:fs/promises";
import { v7 as uuidv7 } from "uuid";
import { MEDIA_CACHE_DIR } from "@multica/utils";
import { describeImage } from "./describe-image.js";

/**
 * Describe a video by extracting the first frame and passing it to Vision API.
 *
 * @param filePath - Local path to the video file
 * @returns Text description, or null if ffmpeg unavailable or no API key
 */
export async function describeVideo(filePath: string): Promise<string | null> {
  const framePath = join(MEDIA_CACHE_DIR, `${uuidv7()}.jpg`);

  try {
    // Ensure output directory exists
    await mkdir(MEDIA_CACHE_DIR, { recursive: true });

    // Extract first frame with ffmpeg
    await new Promise<void>((resolve, reject) => {
      execFile(
        "ffmpeg",
        ["-i", filePath, "-vframes", "1", "-f", "image2", "-y", framePath],
        { timeout: 10000 },
        (err) => (err ? reject(err) : resolve()),
      );
    });

    // Describe the extracted frame
    const description = await describeImage(framePath);

    // Clean up the frame file
    await unlink(framePath).catch(() => {});

    return description;
  } catch {
    // ffmpeg not available or extraction failed
    await unlink(framePath).catch(() => {});
    return null;
  }
}
