'use client';

import {
  DEEP_SCAN_GROUP_LABELS,
  DEEP_SCAN_MODULES,
  DEEP_SCAN_PROFILES,
  requiresClientDiscovery,
  resolveDeepScanScope,
  type DeepScanModuleGroup,
  type DeepScanModuleId,
} from '@/lib/deep-scan-scope';
import { SCAN_PHASES } from '@/lib/scan-phases';

interface Props {
  selected: readonly DeepScanModuleId[];
  onChange: (ids: DeepScanModuleId[]) => void;
}

const phaseById = new Map(SCAN_PHASES.map(phase => [phase.id, phase]));
const groups = Object.keys(DEEP_SCAN_GROUP_LABELS) as DeepScanModuleGroup[];

function sameSelection(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every(id => rightSet.has(id));
}

export function DeepScanScopeSelector({ selected, onChange }: Props) {
  const selectedSet = new Set<string>(selected);
  const activeProfile = Object.entries(DEEP_SCAN_PROFILES)
    .find(([, profile]) => sameSelection(selected, profile.phaseIds))?.[0] ?? 'custom';
  const heavy = DEEP_SCAN_MODULES.filter(module => selectedSet.has(module.id) && module.intensity === 'heavy').length;
  const network = DEEP_SCAN_MODULES.filter(module => selectedSet.has(module.id) && module.intensity !== 'local').length;
  const discoveryDependents = selected.filter(id => requiresClientDiscovery(id)).length;

  function ordered(ids: Set<string>): DeepScanModuleId[] {
    return DEEP_SCAN_MODULES.filter(module => ids.has(module.id)).map(module => module.id);
  }

  function toggle(id: DeepScanModuleId) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(resolveDeepScanScope(ordered(next)));
  }

  function toggleGroup(group: DeepScanModuleGroup) {
    const members = DEEP_SCAN_MODULES.filter(module => module.group === group);
    const allSelected = members.every(module => selectedSet.has(module.id));
    const next = new Set(selected);
    for (const member of members) {
      if (allSelected) next.delete(member.id);
      else next.add(member.id);
    }
    onChange(resolveDeepScanScope(ordered(next)));
  }

  return (
    <section className="border" style={{ borderColor: 'var(--border-2)', borderRadius: 4 }}>
      <div className="px-4 py-3.5 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex flex-wrap items-baseline gap-3">
          <h3 className="text-sm font-semibold text-white">Choose the scan scope</h3>
          <span className="ml-auto font-mono text-[11px]" style={{ color: selected.length > 0 ? 'var(--accent)' : 'var(--crit)' }}>
            {selected.length} of {DEEP_SCAN_MODULES.length} modules selected
          </span>
        </div>
        <p className="text-xs leading-relaxed mt-2" style={{ color: 'var(--faint)' }}>
          This selection is sent to and enforced by the scanner. Unselected modules are not requested, scored, or saved as if they ran. A custom scope receives findings and coverage, but no overall grade.
        </p>
      </div>

      <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <p className="label mb-2.5">scope presets</p>
        <div className="grid sm:grid-cols-2 gap-2">
          {Object.entries(DEEP_SCAN_PROFILES).map(([id, profile]) => (
            <button
              key={id}
              type="button"
              onClick={() => onChange(resolveDeepScanScope([...profile.phaseIds]))}
              className="text-left border p-3 transition-colors"
              style={{
                borderColor: activeProfile === id ? 'var(--accent-line)' : 'var(--border)',
                background: activeProfile === id ? 'var(--accent-dim)' : 'transparent',
                borderRadius: 3,
              }}
            >
              <span className="block text-xs font-semibold" style={{ color: activeProfile === id ? 'var(--accent)' : 'white' }}>
                {profile.label} · {profile.phaseIds.length}
              </span>
              <span className="block text-[11px] leading-relaxed mt-1" style={{ color: 'var(--faint)' }}>{profile.description}</span>
            </button>
          ))}
        </div>
        <p className="font-mono text-[11px] mt-3" style={{ color: 'var(--ghost)' }}>
          {activeProfile === 'custom' ? 'custom scope' : DEEP_SCAN_PROFILES[activeProfile as keyof typeof DEEP_SCAN_PROFILES].label.toLowerCase()}
          {' · '}{network} network-capable module{network === 1 ? '' : 's'}
          {' · '}{heavy > 0 ? `${heavy} higher-request inventor${heavy === 1 ? 'y' : 'ies'}` : 'lower request load'}
          {' · '}actual HTTP attempts depend on discovered inputs
        </p>
      </div>

      <div>
        {groups.map((group, groupIndex) => {
          const modules = DEEP_SCAN_MODULES.filter(module => module.group === group);
          const selectedInGroup = modules.filter(module => selectedSet.has(module.id)).length;
          return (
            <details key={group} style={{ borderTop: groupIndex === 0 ? undefined : '1px solid var(--border)' }}>
              <summary className="px-4 py-3 cursor-pointer list-none flex items-center gap-3">
                <span className="text-xs font-semibold text-white/80">{DEEP_SCAN_GROUP_LABELS[group]}</span>
                <span className="font-mono text-[10px]" style={{ color: 'var(--ghost)' }}>{selectedInGroup}/{modules.length}</span>
                <span className="ml-auto font-mono text-[10px]" style={{ color: 'var(--ghost)' }}>open</span>
              </summary>
              <div className="px-4 pb-4 grid gap-2">
                <button
                  type="button"
                  onClick={() => toggleGroup(group)}
                  className="justify-self-start font-mono text-[10px] hover:text-white mb-1"
                  style={{ color: 'var(--faint)' }}
                >
                  {selectedInGroup === modules.length ? 'clear this group' : 'select this group'}
                </button>
                {modules.map(module => {
                  const phase = phaseById.get(module.id);
                  const checked = selectedSet.has(module.id);
                  const requiredDiscovery = module.id === 'vibe' && discoveryDependents > 0;
                  return (
                    <label
                      key={module.id}
                      className="flex items-start gap-3 border p-3 cursor-pointer"
                      style={{ borderColor: checked ? 'var(--accent-line)' : 'var(--border)', borderRadius: 3 }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={requiredDiscovery}
                        onChange={() => toggle(module.id)}
                        className="mt-0.5 h-4 w-4 shrink-0"
                        style={{ accentColor: 'var(--accent)' }}
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-baseline gap-2">
                          <span className="text-xs font-semibold text-white/85">{phase?.label ?? module.id}</span>
                          <span className="font-mono text-[9px] uppercase" style={{ color: 'var(--ghost)' }}>{module.intensity}</span>
                        </span>
                        <span className="block text-[11px] leading-relaxed mt-1" style={{ color: 'var(--muted)' }}>{module.benefit}</span>
                        {requiredDiscovery && (
                          <span className="block font-mono text-[10px] mt-1" style={{ color: 'var(--accent)' }}>
                            Required to discover browser routes and inputs for {discoveryDependents} selected module{discoveryDependents === 1 ? '' : 's'}.
                          </span>
                        )}
                        <span className="block text-[10px] leading-relaxed mt-1" style={{ color: 'var(--ghost)' }}>Limit: {module.limitation}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
