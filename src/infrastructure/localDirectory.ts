import path from 'node:path';

function localDirectory(variable: string): string {
    if (process.env.NODE_ENV === 'production') throw new Error('Serviços locais não podem ser usados em produção.');
    const directory = process.env[variable];
    if (!directory) throw new Error(`${variable} precisa indicar um diretório local.`);
    return path.resolve(directory);
}

export { localDirectory };
