import type { z } from 'zod';
import { volumePayloadBaseSchema, volumeReleaseDateSchema } from '../schemas';

type VolumePatch = Partial<z.infer<typeof volumePayloadBaseSchema>>;
interface SavedReleaseDate {
    releaseDatePrecision: string;
    releaseYear: number | null;
    releaseMonth: number | null;
    releaseDay: number | null;
}

// O PATCH valida a data resultante, preservando componentes omitidos e removendo
// somente aqueles que deixam de existir quando a precisão é reduzida.
function prepareVolumeReleaseUpdate(current: SavedReleaseDate, patch: VolumePatch) {
    const fields = ['releaseDatePrecision', 'releaseYear', 'releaseMonth', 'releaseDay'] as const;
    if (!fields.some(field => patch[field] !== undefined)) return { success: true as const, data: {} };
    const merged = { ...current, ...patch };
    if (merged.releaseDatePrecision === 'Ano') merged.releaseMonth = null;
    if (merged.releaseDatePrecision !== 'Completa') merged.releaseDay = null;
    const result = volumeReleaseDateSchema.safeParse({
        releaseDatePrecision: merged.releaseDatePrecision,
        releaseYear: merged.releaseYear,
        releaseMonth: merged.releaseMonth,
        releaseDay: merged.releaseDay
    });
    if (!result.success) return { success: false as const };
    return { success: true as const, data: result.data };
}

export { prepareVolumeReleaseUpdate };
