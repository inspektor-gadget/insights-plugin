import { describe, expect, it } from 'vitest';
import { applyColumnDefaults, applyInstanceColumnDefaults } from './gadget-columns';

describe('applyColumnDefaults', () => {
  it('marks shared and gadget-specific fields as default-hidden while keeping them toggleable', () => {
    const gadgetInfo = {
      datasources: [
        {
          fields: [
            { name: 'namespace', fullName: 'k8s.namespace', flags: 0 },
            { name: 'memoryVirtual', fullName: 'memoryVirtual', flags: 0 },
            { name: 'memoryRSS', fullName: 'memoryRSS', flags: 0 },
          ],
        },
      ],
    };

    applyColumnDefaults(gadgetInfo, {
      hiddenFields: ['memoryVirtual'],
      descriptions: { memoryRSS: 'Resident memory.' },
    });

    expect(gadgetInfo.datasources[0].fields).toEqual([
      { name: 'namespace', fullName: 'k8s.namespace', flags: 4 },
      { name: 'memoryVirtual', fullName: 'memoryVirtual', flags: 4 },
      {
        name: 'memoryRSS',
        fullName: 'memoryRSS',
        flags: 0,
        annotations: { description: 'Resident memory.' },
      },
    ]);
  });

  it('waits for gadget metadata before applying defaults', async () => {
    const instances: Record<string, any> = {};
    const applying = applyInstanceColumnDefaults(instances, 'late', {
      hiddenFields: ['threadCount'],
    });

    instances.late = {
      gadgetInfo: {
        datasources: [
          {
            fields: [{ name: 'threadCount', fullName: 'threadCount', flags: 0 }],
          },
        ],
      },
    };
    await applying;

    expect(instances.late.gadgetInfo.datasources[0].fields[0].flags).toBe(4);
  });
});
