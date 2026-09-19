import crypto from 'node:crypto';
import sharp from 'sharp';
import type { Metadata } from 'sharp';
import ApplicationError from '../../errors/ApplicationError';
import type { ProcessedCover, ProcessedMediaObject } from '../../modules/admin/media/CoverImportService';

const DEFAULT_MAX_PIXELS = 40_000_000;
const ALLOWED_FORMATS = new Set(['avif', 'jpeg', 'png', 'webp']);
const OUTPUTS = [
    { kind: 'MASTER', width: 1200, height: 1800, quality: 88 },
    { kind: 'COVER_SMALL', width: 320, height: 480, quality: 82 },
    { kind: 'COVER_LARGE', width: 640, height: 960, quality: 86 }
] as const;

interface CoverImageProcessorOptions {
    maxPixels?: number;
}

function invalidImage(cause?: unknown) {
    return new ApplicationError({
        statusCode: 415,
        code: 'MEDIA_IMAGE_INVALID',
        message: 'O arquivo informado não contém uma imagem válida.',
        cause
    });
}

async function processCoverImage(
    source: Buffer,
    options: CoverImageProcessorOptions = {}
): Promise<ProcessedCover> {
    const maxPixels = options.maxPixels || DEFAULT_MAX_PIXELS;
    let metadata: Metadata;

    try {
        metadata = await sharp(source, { failOn: 'error', limitInputPixels: false }).metadata();
    } catch (error) {
        throw invalidImage(error);
    }

    if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format) || !metadata.width || !metadata.height) {
        throw invalidImage();
    }

    if (metadata.width * metadata.height > maxPixels) {
        throw new ApplicationError({
            statusCode: 413,
            code: 'MEDIA_DIMENSIONS_EXCEEDED',
            message: 'A imagem excede o limite de dimensões permitido.'
        });
    }

    let rendered: ProcessedMediaObject[];
    try {
        rendered = await Promise.all(OUTPUTS.map(async ({ kind, width, height, quality }) => ({
            kind,
            body: await sharp(source, { failOn: 'error', limitInputPixels: maxPixels })
                .rotate()
                .resize(width, height, { fit: 'cover', position: 'attention' })
                .webp({ quality, effort: 4 })
                .toBuffer(),
            contentType: 'image/webp',
            width,
            height
        })));
    } catch (error) {
        throw invalidImage(error);
    }

    const [master, ...variants] = rendered;
    return {
        master,
        variants,
        checksum: crypto.createHash('sha256').update(source).digest('hex'),
        format: 'webp'
    };
}

export { processCoverImage };
export type { CoverImageProcessorOptions };
