/**
 * Customizes pre-rendered Inspektor Gadget manifests at deploy time.
 * Handles namespace substitution, image version changes, and ConfigMap config.
 */
import type { ManifestEntry } from './manifests';
import { APPLY_ORDER, DELETE_ORDER, MANIFESTS } from './manifests';

export interface OtelExporter {
  name: string;
  endpoint: string;
  insecure?: boolean;
  compression?: string;
  // Metrics-specific
  temporality?: string;
  interval?: number;
  collectGoMetrics?: boolean;
  collectIGMetrics?: boolean;
}

export interface DeployConfig {
  namespace: string;
  verifyImage: boolean;
  otelLogExporters: OtelExporter[];
  otelMetricExporters: OtelExporter[];
  prometheusListen: boolean;
  prometheusListenAddress: string;
}

export const DEFAULT_CONFIG: DeployConfig = {
  namespace: 'gadget',
  verifyImage: true,
  otelLogExporters: [],
  otelMetricExporters: [],
  prometheusListen: false,
  prometheusListenAddress: '0.0.0.0:2224',
};

/**
 * Parse a YAML manifest string into a K8s-like JSON object.
 * Uses a simple YAML parser sufficient for K8s manifests.
 */
// eslint-disable-next-line no-unused-vars
function parseYaml(_yaml: string): any {
  // We use a line-based approach since the manifests are well-formed helm output.
  // For robust parsing in the browser without adding a YAML lib dependency,
  // we convert to JSON via a simple state machine.
  //
  // Actually, since these manifests will be applied via Headlamp's apply() which
  // takes JSON objects, we need proper parsing. Let's use a regex-based approach.
  //
  // For simplicity and reliability, we'll do string-level substitutions on the
  // raw YAML and then convert to JSON using the js-yaml-like approach that
  // Headlamp already has available.
  return null; // We'll use string-level manipulation instead
}

/**
 * Replace all occurrences of the default namespace ("gadget") with a custom one
 * in a YAML manifest string.
 */
function replaceNamespace(yaml: string, namespace: string): string {
  if (namespace === 'gadget') return yaml;

  // Replace namespace field values
  let result = yaml.replace(/(\bnamespace:\s*)gadget\b/g, `$1${namespace}`);

  // Replace gadget-namespace config value
  result = result.replace(/gadget-namespace: gadget/g, `gadget-namespace: ${namespace}`);

  return result;
}

/**
 * Build the operator config section for the ConfigMap's config.yaml.
 */
function buildOperatorConfig(config: DeployConfig): string {
  const lines: string[] = [];

  // OCI verify-image
  lines.push(`        oci:`);
  lines.push(`          allowed-gadgets: []`);
  lines.push(`          disallow-pulling: false`);
  lines.push(`          insecure-registries: []`);
  lines.push(`          public-keys:`);
  lines.push(`          - |`);
  lines.push(`            -----BEGIN PUBLIC KEY-----`);
  lines.push(`            MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEoDOC0gYSxZTopenGmX3ZFvQ1DSfh`);
  lines.push(`            Ir4EKRt5jC+mXaJ7c7J+oREskYMn/SfZdRHNSOjLTZUMDm60zpXGhkFecg==`);
  lines.push(`            -----END PUBLIC KEY-----`);
  lines.push(`          verify-image: ${config.verifyImage}`);

  // OTel log exporters
  if (config.otelLogExporters.length > 0) {
    lines.push(`        otel-logs:`);
    lines.push(`          exporters:`);
    for (const exp of config.otelLogExporters) {
      lines.push(`            ${exp.name}:`);
      lines.push(`              endpoint: ${exp.endpoint}`);
      if (exp.insecure !== undefined) {
        lines.push(`              insecure: ${exp.insecure}`);
      }
      if (exp.compression) {
        lines.push(`              compression: ${exp.compression}`);
      }
    }
  }

  // OTel metric exporters
  if (config.otelMetricExporters.length > 0) {
    lines.push(`        otel-metrics:`);
    lines.push(`          exporters:`);
    for (const exp of config.otelMetricExporters) {
      lines.push(`            ${exp.name}:`);
      lines.push(`              endpoint: ${exp.endpoint}`);
      if (exp.insecure !== undefined) {
        lines.push(`              insecure: ${exp.insecure}`);
      }
      if (exp.temporality) {
        lines.push(`              temporality: ${exp.temporality}`);
      }
      if (exp.interval !== undefined) {
        lines.push(`              interval: ${exp.interval}`);
      }
      if (exp.collectGoMetrics !== undefined) {
        lines.push(`              collectGoMetrics: ${exp.collectGoMetrics}`);
      }
      if (exp.collectIGMetrics !== undefined) {
        lines.push(`              collectIGMetrics: ${exp.collectIGMetrics}`);
      }
    }
    lines.push(`          otel-metrics-listen: ${config.prometheusListen}`);
    lines.push(`          otel-metrics-listen-address: ${config.prometheusListenAddress}`);
  } else {
    // Even without exporters, include prometheus listener config
    lines.push(`        otel-metrics:`);
    lines.push(`          otel-metrics-listen: ${config.prometheusListen}`);
    lines.push(`          otel-metrics-listen-address: ${config.prometheusListenAddress}`);
  }

  return lines.join('\n');
}

/**
 * Customize the ConfigMap's config.yaml with user configuration.
 */
function customizeConfigMap(yaml: string, config: DeployConfig): string {
  // Replace the operator section in the config.yaml
  const operatorConfig = buildOperatorConfig(config);

  // Match the operator section from "        oci:" to the end of the config.yaml block
  // The operator section starts after "        kubemanager:" block
  const ociStart = yaml.indexOf('        oci:');
  if (ociStart === -1) return yaml;

  // Find the end of the data section (next top-level key or end of string)
  const dataEnd = yaml.length;

  // Find where to cut: from oci: to end of the operator config
  // Look for the last line of the operator config (otel-metrics-listen-address)
  const lastConfigLine = yaml.lastIndexOf('otel-metrics-listen-address:');
  if (lastConfigLine === -1) return yaml;

  const endOfLastLine = yaml.indexOf('\n', lastConfigLine);
  const cutEnd = endOfLastLine !== -1 ? endOfLastLine : dataEnd;

  return yaml.substring(0, ociStart) + operatorConfig + yaml.substring(cutEnd);
}

/**
 * Customize all manifests with the given deploy configuration.
 * Returns manifests sorted in apply order.
 */
export function customizeManifests(config: DeployConfig): ManifestEntry[] {
  const customized: ManifestEntry[] = MANIFESTS.map(m => {
    let yaml = m.yaml;

    // Apply namespace substitution
    yaml = replaceNamespace(yaml, config.namespace);

    // Customize ConfigMap
    if (m.kind === 'ConfigMap' && m.name === 'gadget') {
      yaml = customizeConfigMap(yaml, config);
    }

    return {
      ...m,
      namespace: m.namespace ? config.namespace : undefined,
      yaml,
    };
  });

  // Sort by apply order
  return customized.sort((a, b) => {
    const aIdx = APPLY_ORDER.indexOf(a.kind);
    const bIdx = APPLY_ORDER.indexOf(b.kind);
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
  });
}

/**
 * Return manifests in deletion order (reverse of apply).
 */
export function getDeleteOrder(manifests: ManifestEntry[]): ManifestEntry[] {
  return [...manifests].sort((a, b) => {
    const aIdx = DELETE_ORDER.indexOf(a.kind);
    const bIdx = DELETE_ORDER.indexOf(b.kind);
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
  });
}
