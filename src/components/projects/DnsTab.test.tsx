import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DnsTab from './DnsTab';

const projectGadgetTab = vi.fn<(props: unknown) => null>(() => null);

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('./ProjectGadgetTab', () => ({
  default: (props: unknown) => projectGadgetTab(props),
}));

describe('DnsTab', () => {
  it('scopes trace_dns and defaults to the DNS Map', () => {
    render(<DnsTab project={{ id: 'test', namespaces: ['demo'], clusters: ['cluster'] }} />);

    expect(projectGadgetTab).toHaveBeenCalledWith(
      expect.objectContaining({
        extraParams: {
          'operator.filter.filter': 'k8s.namespace==demo',
          'operator.oci.annotate': 'dns:views.defaults.mode=dns-network',
        },
      })
    );
  });
});
