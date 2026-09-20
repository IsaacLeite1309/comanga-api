function normalizeOptionValue(value: {
    id: number;
    label: string;
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
