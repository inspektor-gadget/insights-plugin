import { describe, expect, it, vi } from 'vitest';
import { registerK8sAnnotations } from './k8s-annotations';

const mocks = vi.hoisted(() => ({
  registerAnnotationProvider: vi.fn<
    (provider: {
      field: (field: { fullName: string }, datasource: unknown) => Record<string, string>;
    }) => () => void
  >(() => vi.fn()),
}));

vi.mock('@inspektor-gadget/ig-desktop/frontend', () => ({
  registerAnnotationProvider: mocks.registerAnnotationProvider,
}));

describe('registerK8sAnnotations', () => {
  it('makes Kubernetes resource fields clickable', () => {
    registerK8sAnnotations();
    const provider = mocks.registerAnnotationProvider.mock.calls.at(-1)![0];

    expect(provider.field({ fullName: 'k8s.namespace' }, {})).toEqual({
      'interaction.clickable': 'true',
      'interaction.resource-type': 'namespace',
    });
  });
});
