const { once } = require('node:events');
const { createServer } = require('node:http');
const { sendRequest } = require('../../scripts/load/http');

async function withHttpServer(handler, test) {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        await test(`http://127.0.0.1:${server.address().port}`);
    } finally {
        const closed = once(server, 'close');
        server.close();
        await closed;
    }
}

describe('isolamento HTTP da suíte de carga', () => {
    it('recusa requisições para uma origem diferente da própria instância', async () => {
        const handler = jest.fn((_req, res) => res.end('Resposta fora da origem configurada.'));

        await withHttpServer(handler, async (origin) => {
            const path = `//${new globalThis.URL(origin).host}/catalogo`;
            await expect(sendRequest('http://127.0.0.1:0', { path }, 1000)).rejects.toThrow(/origem/i);
        });

        expect(handler).not.toHaveBeenCalled();
    });

    it('trata o redirecionamento como falha e deixa o destino intacto', async () => {
        const handler = jest.fn((req, res) => {
            if (req.url === '/api/public/works') res.writeHead(302, { location: '/destino' });
            res.end();
        });

        await withHttpServer(handler, async (origin) => {
            await expect(sendRequest(origin, { path: '/api/public/works' }, 1000)).rejects.toThrow(/redirecionamento/i);
        });

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].url).toBe('/api/public/works');
    });
});
