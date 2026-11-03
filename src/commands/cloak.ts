import { siteCloak, type Cloak, type Site } from '@isocialpractice/cmd-sync-servers';
import * as vscode from 'vscode';
import { editGlobalPatterns } from '../flows/global-cloaking.ts';
import { requireSites, type Services } from './services.ts';
import { siteForFiles, urisFrom } from './sync.ts';

function chosenFiles(services: Services, arg: unknown, extra: unknown, verb: string): { site: Site; paths: string[] } | undefined {
  let uris = urisFrom(arg, extra);
  if (uris.length === 0) {
    const active = vscode.window.activeTextEditor?.document.uri;
    uris = active?.scheme === 'file' ? [active] : [];
  }
  if (uris.length === 0) {
    return undefined;
  }
  const found = siteForFiles(services, uris);
  if (typeof found === 'string') {
    void services.prompter().error(found);
    return undefined;
  }
  if (found.paths.includes('')) {
    void services.prompter().inform(`The local folder of "${found.site.name}" itself cannot be ${verb}.`);
    return undefined;
  }
  return found;
}

function named(paths: readonly string[]): string {
  return paths.length === 1 ? (paths[0] ?? '') : `${String(paths.length)} items`;
}

/** Cloak: adds files and folders to the site's cloaked paths, so they are never synchronized. */
export async function cloak(services: Services, arg: unknown, extra: unknown): Promise<void> {
  if (!requireSites(services)) {
    return;
  }
  const found = chosenFiles(services, arg, extra, 'cloaked');
  if (found === undefined) {
    if (urisFrom(arg, extra).length === 0) {
      void services.prompter().inform('Open a file of a site, or choose files in the Explorer, to cloak them.');
    }
    return;
  }
  const { site, paths } = found;
  const added = paths.filter((item) => !site.cloaking.paths.includes(item));
  if (added.length === 0) {
    void services.prompter().inform(`${named(paths)} ${paths.length === 1 ? 'is' : 'are'} already cloaked.`);
    return;
  }
  await services.model.registry().update(site.id, (draft) => {
    draft.cloaking.paths.push(...added);
  });
  services.model.refresh();
  services.logger.info('Cloaked', { siteId: site.id, paths: added.length });
  const tail = site.cloaking.enabled
    ? `${added.length === 1 ? 'It is' : 'They are'} never synchronized.`
    : 'Cloaking is off for this site, so it takes effect once cloaking is turned on in Site Settings.';
  void services.prompter().inform(`Cloaked ${named(added)}. ${tail}`);
}

/** Uncloak: removes files and folders from the site's cloaked paths, or picks one when none is chosen. */
export async function uncloak(services: Services, arg: unknown, extra: unknown): Promise<void> {
  if (!requireSites(services)) {
    return;
  }
  let found = chosenFiles(services, arg, extra, 'uncloaked');
  if (found === undefined && urisFrom(arg, extra).length === 0) {
    const site = services.model.activeSite;
    if (site === undefined || site.cloaking.paths.length === 0) {
      void services.prompter().inform(site === undefined ? 'No site is active.' : `"${site.name}" has no single cloaked files or folders.`);
      return;
    }
    const answer = await services.prompter().choose({
      title: `Uncloak: ${site.name}`,
      placeholder: 'Choose what should no longer be cloaked',
      choices: site.cloaking.paths.map((item) => ({ label: item, value: item })),
    });
    found = typeof answer === 'string' ? { site, paths: [answer] } : undefined;
  }
  if (found === undefined) {
    return;
  }
  const { site, paths } = found;
  const removed = paths.filter((item) => site.cloaking.paths.includes(item));
  const patternsOnly = { cloaking: { ...site.cloaking, paths: [] } };
  const bySite = siteCloak(patternsOnly);
  const withGlobal = siteCloak(patternsOnly, process.platform, services.model.globalPatterns);
  const notes = paths
    .filter((item) => !removed.includes(item))
    .map((item) => {
      const parent = site.cloaking.paths.find((candidate) => item.startsWith(`${candidate}/`));
      if (parent !== undefined) {
        return `${item} is inside the cloaked folder ${parent}; uncloak that folder instead.`;
      }
      const cloakedBy = (cloak: Cloak): boolean => cloak.isCloaked(item, false) || cloak.isCloaked(item, true);
      if (cloakedBy(bySite)) {
        return `${item} is cloaked by a pattern; change the patterns in Site Settings.`;
      }
      return cloakedBy(withGlobal)
        ? `${item} is cloaked by a global pattern; change them with Global Cloaking Patterns..., or turn them off for this site in Site Settings.`
        : `${item} is not cloaked.`;
    });
  if (removed.length > 0) {
    await services.model.registry().update(site.id, (draft) => {
      draft.cloaking.paths = draft.cloaking.paths.filter((item) => !removed.includes(item));
    });
    services.model.refresh();
    services.logger.info('Uncloaked', { siteId: site.id, paths: removed.length });
  }
  const message = [removed.length > 0 ? `Uncloaked ${named(removed)}.` : '', ...notes].filter((part) => part !== '').join(' ');
  void services.prompter().inform(message);
}

/**
 * Global Cloaking Patterns...: lists the cloaking patterns every site uses
 * before its own, adds new ones, and removes one after asking. They live in
 * `sites.json`, so the command line uses the same patterns.
 */
export async function globalCloaking(services: Services): Promise<void> {
  if (services.model.problem !== undefined) {
    requireSites(services);
    return;
  }
  await editGlobalPatterns(services.prompter(), {
    patterns: () => services.model.globalPatterns,
    update: async (change) => {
      await services.model.registry().updateGlobalCloaking(change);
      services.model.refresh();
      services.logger.info('Global cloaking patterns changed', { patterns: services.model.globalPatterns.length });
    },
  });
}
