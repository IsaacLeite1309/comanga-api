import type { NextFunction, Request, Response } from 'express';
import ApplicationError from '../../errors/ApplicationError';
import { canViewAdultContent } from '../public-catalog';
import { volumeParamsSchema, editionParamsSchema, readSchema, batchSchema } from './schemas';
import { addOwned, addWanted, removeItem, syncOwned, updateRead } from './mutations';

function authenticatedUser(req: Request) {
    if (!req.user) throw new ApplicationError({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Faça login para acessar seu acervo.' });
    return req.user.userId;
}
function invalidInput(): never {
    throw new ApplicationError({ statusCode: 400, code: 'INVALID_PERSONAL_INPUT', message: 'Parâmetros do acervo inválidos.' });
}
function volumeId(req: Request) {
    const validation = volumeParamsSchema.safeParse(req.params);
    if (!validation.success) invalidInput();
    return validation.data.volumeId;
}
function editionId(req: Request) {
    const validation = editionParamsSchema.safeParse(req.params);
    if (!validation.success) invalidInput();
    return validation.data.editionId;
}
function handler(operation: (req: Request) => Promise<unknown>, status = 200) {
    return async (req: Request, res: Response, next: NextFunction) => {
        res.vary('Cookie');
        res.set('Cache-Control', 'private, no-store');
        try {
            const result = await operation(req);
            return status === 204 ? res.status(204).end() : res.status(status).json(result);
        } catch (error) { return next(error); }
    };
}
const putOwned = handler(req => addOwned(authenticatedUser(req), volumeId(req), canViewAdultContent(req)));
const putWanted = handler(req => addWanted(authenticatedUser(req), volumeId(req), canViewAdultContent(req)));
const deleteOwned = handler(req => removeItem(authenticatedUser(req), volumeId(req), 'Owned'), 204);
const deleteWanted = handler(req => removeItem(authenticatedUser(req), volumeId(req), 'Wanted'), 204);
const patchRead = handler(req => {
    const validation = readSchema.safeParse(req.body);
    if (!validation.success) invalidInput();
    return updateRead(authenticatedUser(req), volumeId(req), validation.data.read, canViewAdultContent(req));
});
const putEdition = handler(req => {
    const validation = batchSchema.safeParse(req.body);
    if (!validation.success) invalidInput();
    return syncOwned(authenticatedUser(req), editionId(req), validation.data, canViewAdultContent(req));
});

export { putOwned, putWanted, deleteOwned, deleteWanted, patchRead, putEdition };
