import crypto from 'node:crypto';
import { decode as decodeBmp } from 'bmp-js';
import sharp from 'sharp';
import type { Metadata } from 'sharp';
import ApplicationError from '../../errors/ApplicationError';

const DEFAULT_MAX_PIXELS = 40_000_000;
const ALLOWED_FORMATS = new Set(['avif', 'jpeg', 'png', 'webp']);
const BMP_MAX_PIXELS = 10_000_000;
const OUTPUTS = [
    { kind: 'MASTER', width: 1200, height: 1800, quality: 88 },
    { kind: 'COVER_SMALL', width: 320, height: 480, quality: 82 },
    { kind: 'COVER_LARGE', width: 640, height: 960, quality: 86 }
] as const;

interface CoverImageProcessorOptions {
    maxPixels?: number;
}

interface ProcessedMediaObject {
    kind: string;
    body: Buffer;
    contentType: string;
    width: number;
    height: number;
}

interface ProcessedCover {
    master: ProcessedMediaObject;
    variants: ProcessedMediaObject[];
    checksum: string;
    format: string;
}

function invalidImage(cause?: unknown) {
    return new ApplicationError({
        statusCode: 415,
        code: 'MEDIA_IMAGE_INVALID',
        message: 'O arquivo informado não contém uma imagem válida.',
        cause
    });
}

function decodeBmpInput(source: Buffer, maxPixels: number) {
    if (source.length < 54) throw invalidImage();
    const width = source.readInt32LE(18);
    const height = Math.abs(source.readInt32LE(22));
    const bitsPerPixel = source.readUInt16LE(28);
    const compression = source.readUInt32LE(30);
    const pixelCount = width * height;
    if (source.toString('ascii', 0, 2) !== 'BM'
        || width <= 0 || height <= 0
        || ![1, 4, 8, 16, 24, 32].includes(bitsPerPixel)
        || compression !== 0) throw invalidImage();
    if (pixelCount > Math.min(maxPixels, BMP_MAX_PIXELS)) {
        throw new ApplicationError({
            statusCode: 413,
            code: 'MEDIA_DIMENSIONS_EXCEEDED',
            message: 'A imagem excede o limite de dimensões permitido.'
        });
    }

    try {
        const decoded = decodeBmp(source);
        if (decoded.width !== width || decoded.height !== height || decoded.data.length !== pixelCount * 4) {
            throw invalidImage();
        }
        const rgb = Buffer.allocUnsafe(pixelCount * 3);
        for (let pixel = 0; pixel < pixelCount; pixel += 1) {
            rgb[pixel * 3] = decoded.data[pixel * 4 + 3];
            rgb[pixel * 3 + 1] = decoded.data[pixel * 4 + 2];
            rgb[pixel * 3 + 2] = decoded.data[pixel * 4 + 1];
        }
        return { data: rgb, raw: { width, height, channels: 3 as const } };
    } catch (error) {
        throw invalidImage(error);
    }
}

async function processCoverImage(
    source: Buffer,
    options: CoverImageProcessorOptions = {}
): Promise<ProcessedCover> {
    const maxPixels = options.maxPixels || DEFAULT_MAX_PIXELS;
    const decodedBmp = source.toString('ascii', 0, 2) === 'BM'
        ? decodeBmpInput(source, maxPixels)
        : null;
    const input = decodedBmp?.data || source;
    const rawOptions = decodedBmp ? { raw: decodedBmp.raw } : {};
    let metadata: Metadata;

    try {
        metadata = await sharp(input, { failOn: 'error', limitInputPixels: false, ...rawOptions }).metadata();
    } catch (error) {
        throw invalidImage(error);
    }

    if ((!metadata.format || !ALLOWED_FORMATS.has(metadata.format) && metadata.format !== 'raw')
        || !metadata.width || !metadata.height) {
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
            body: await sharp(input, { failOn: 'error', limitInputPixels: maxPixels, ...rawOptions })
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
export type { CoverImageProcessorOptions, ProcessedCover, ProcessedMediaObject };
