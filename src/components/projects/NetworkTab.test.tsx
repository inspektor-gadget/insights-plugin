import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import NetworkTab from './NetworkTab';

const projectGadgetTab = vi.fn<(props: unknown) => null>(() => null);

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('./ProjectGadgetTab', () => ({
  default: (props: unknown) => projectGadgetTab(props),
}));

describe('NetworkTab', () => {
  it('scopes trace_tcp to the project namespace', () => {
    render(<NetworkTab project={{ id: 'test', namespaces: ['demo'], clusters: ['cluster'] }} />);

    expect(projectGadgetTab).toHaveBeenCalledWith(
      expect.objectContaining({
        extraParams: {
          'operator.filter.filter': 'k8s.namespace==demo',
        },
      })
    );
  });
});
