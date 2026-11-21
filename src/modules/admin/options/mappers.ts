function normalizeOptionValue(value: {
    id: number;
    label: string;
    code?: string | null;
    systemManaged?: boolean;
    position?: number;
    active?: boolean;
    category: { slug: string; name: string };
}) {
    return {
        id: value.id,
        label: value.label,
        code: value.code ?? null,
        systemManaged: value.systemManaged === true,
        position: value.position ?? 0,
        active: value.active !== false,
        category: {
            slug: value.category.slug,
            name: value.category.name
        }
    };
}

export { normalizeOptionValue };
