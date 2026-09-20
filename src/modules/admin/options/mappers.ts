function normalizeOptionValue(value: {
    id: number;
    label: string;
    code?: string | null;
    systemManaged?: boolean;
    position?: number;
    active?: boolean;
    category: { slug: string; name: string };
    dependencies?: Array<{
        dependsOnValue: {
            id: number;
            label: string;
            category: { slug: string; name: string };
        };
    }>;
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
        },
        depends_on: value.dependencies?.map((dependency) => ({
            id: dependency.dependsOnValue.id,
            label: dependency.dependsOnValue.label,
            category: {
                slug: dependency.dependsOnValue.category.slug,
                name: dependency.dependsOnValue.category.name
            }
        })) || []
    };
}

export { normalizeOptionValue };
