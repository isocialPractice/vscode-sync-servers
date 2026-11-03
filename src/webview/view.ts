/**
 * The Site Settings page as plain data: the category list on the left, the
 * form of the chosen category on the right, Revert, Cancel and Save below.
 * Every control has a visible label; help, warnings and problems are tied
 * to it with `aria-describedby`.
 */
import type { ServerData } from '../shared/site-data.ts';
import { categoryOf, SERVER_FIELDS, SITE_FIELDS, type Category, type Field, type ServerTab } from './fields.ts';
import { editedServer, isDirty, problemAt, problemPaths, serverHasProblems, type Action, type State } from './state.ts';
import { h, type Attrs, type VNode } from './vnode.ts';

/** The categories as the category list names them. */
export const CATEGORY_LABELS: Readonly<Record<Category, string>> = {
  site: 'Site',
  servers: 'Servers',
  local: 'Local Info',
  cloaking: 'Cloaking',
  sync: 'Synchronization',
  security: 'Security',
};

const ADVANCED: readonly Category[] = ['local', 'cloaking', 'sync', 'security'];

const PROTOCOL_LABELS: Readonly<Record<ServerData['protocol'], string>> = {
  sftp: 'SFTP',
  ftps: 'FTPS',
  'ftps-implicit': 'FTPS (implicit)',
  ftp: 'FTP',
  local: 'Folder',
};

function on(event: 'click' | 'input' | 'change' | 'keydown', action: Action): Attrs {
  return { [`data-on-${event}`]: JSON.stringify(action) };
}

/** A decorative icon; the words beside it carry the meaning. */
export function icon(kind: 'error' | 'warning' | 'pass'): VNode {
  const mark = { error: 'M8 4.5v4.25M8 11.25v.25', warning: 'M8 6v3.75M8 12v.25', pass: 'M5.25 8.25l2 2 3.5-4' }[kind];
  const outline = kind === 'warning' ? h('path', { d: 'M8 1.75 14.75 14H1.25z' }) : h('circle', { cx: 8, cy: 8, r: 6.5 });
  return h('svg', { class: `icon icon-${kind}`, viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' }, outline, h('path', { d: mark }));
}

function button(label: string, action: Action, options: { primary?: boolean; id?: string; disabled?: boolean; ariaLabel?: string; keys?: string } = {}): VNode {
  return h(
    'button',
    {
      type: 'button',
      class: options.primary === true ? 'primary' : 'secondary',
      id: options.id,
      disabled: options.disabled === true,
      'aria-label': options.ariaLabel,
      'aria-keyshortcuts': options.keys,
      ...on('click', action),
    },
    label,
  );
}

function hidden(text: string): VNode {
  return h('span', { class: 'visually-hidden' }, text);
}

function fieldView(state: State, field: Field, server: ServerData | undefined, index: number): VNode | undefined {
  if (server !== undefined && field.visible !== undefined && !field.visible(server)) {
    return undefined;
  }
  const id = `f-${field.id}`;
  const path = field.path(index);
  const problem = problemAt(state, path);
  const label = field.label(server);
  const help = field.help?.(server);
  const describedBy = [
    help === undefined ? undefined : `${id}-help`,
    field.warning === undefined ? undefined : `${id}-warning`,
    problem === undefined ? undefined : `${id}-problem`,
  ]
    .filter((part) => part !== undefined)
    .join(' ');
  const value = state.raw[path] ?? field.get(state.draft, server);
  const common: Attrs = {
    id,
    'aria-describedby': describedBy === '' ? undefined : describedBy,
    'aria-invalid': problem === undefined ? undefined : 'true',
    'aria-required': field.required === true ? 'true' : undefined,
  };
  const notes = [
    help === undefined ? undefined : h('p', { id: `${id}-help`, class: 'help' }, help),
    field.warning === undefined ? undefined : h('p', { id: `${id}-warning`, class: 'warning' }, icon('warning'), h('span', {}, field.warning)),
    problem === undefined ? undefined : h('p', { id: `${id}-problem`, class: 'problem' }, icon('error'), h('span', {}, problem)),
  ];
  if (field.kind === 'checkbox') {
    return h(
      'div',
      { class: 'field check' },
      h('div', { class: 'check-row' }, h('input', { ...common, type: 'checkbox', checked: value === true, ...on('change', { type: 'field', field: field.id }) }), h('label', { for: id }, label)),
      notes,
    );
  }
  let control: VNode;
  if (field.kind === 'select') {
    control = h(
      'select',
      { ...common, value: String(value), ...on('change', { type: 'field', field: field.id }) },
      (field.choices ?? []).map((choice) => h('option', { value: choice.value }, choice.label)),
    );
  } else if (field.kind === 'patterns') {
    control = h('textarea', { ...common, rows: 6, spellcheck: 'false', value: String(value), ...on('input', { type: 'field', field: field.id }) });
  } else {
    control = h('input', {
      ...common,
      type: 'text',
      inputmode: field.kind === 'number' ? (field.number?.integer === true ? 'numeric' : 'decimal') : undefined,
      spellcheck: field.id === 'name' || field.id === 'serverName' ? undefined : 'false',
      placeholder: field.placeholder?.(server),
      value: String(value),
      ...on('input', { type: 'field', field: field.id }),
    });
  }
  const browse = field.browse?.(server);
  const browseButton =
    browse === undefined
      ? undefined
      : button('Browse...', { type: 'browse', target: browse === 'localRoot' ? { kind: 'localRoot' } : { kind: browse, serverId: server?.id ?? '' } }, {
          ariaLabel: `Browse... for ${label}`,
        });
  return h(
    'div',
    { class: 'field' },
    h('label', { for: id }, label, field.optional === true ? h('span', { class: 'optional' }, ' (optional)') : undefined),
    h('div', { class: 'control-row' }, control, browseButton),
    notes,
  );
}

function fields(state: State, place: Field['place'], server?: { server: ServerData; index: number }): VNode[] {
  const list = server === undefined ? SITE_FIELDS : SERVER_FIELDS;
  return list
    .filter((field) => field.place === place)
    .map((field) => fieldView(state, field, server?.server, server?.index ?? -1))
    .filter((node): node is VNode => node !== undefined);
}

function navButton(state: State, category: Category, problems: ReadonlySet<Category>): VNode {
  const current = state.category === category;
  return h(
    'li',
    {},
    h(
      'button',
      { type: 'button', id: `nav-${category}`, class: 'nav-item', 'aria-current': current ? 'page' : undefined, ...on('click', { type: 'navigate', category }) },
      h('span', {}, CATEGORY_LABELS[category]),
      problems.has(category) ? h('span', { class: 'marker' }, icon('error'), hidden(', has problems')) : undefined,
    ),
  );
}

function navigation(state: State): VNode {
  const problems = new Set(problemPaths(state).map(categoryOf));
  const open = state.advancedOpen || ADVANCED.includes(state.category);
  return h(
    'nav',
    { class: 'categories', 'aria-label': 'Site Setup' },
    h(
      'ul',
      { class: 'nav' },
      navButton(state, 'site', problems),
      navButton(state, 'servers', problems),
      h(
        'li',
        {},
        h(
          'button',
          {
            type: 'button',
            id: 'nav-advanced',
            class: 'nav-item nav-group',
            'aria-expanded': open ? 'true' : 'false',
            'aria-controls': 'nav-advanced-list',
            ...on('click', { type: 'toggleAdvanced' }),
          },
          'Advanced Settings',
        ),
        h('ul', { id: 'nav-advanced-list', class: 'nav nav-sub', hidden: !open }, ADVANCED.map((category) => navButton(state, category, problems))),
      ),
    ),
  );
}

function heading(text: string): VNode {
  return h('h1', { id: 'form-title', class: 'title' }, text);
}

function generalProblems(state: State): VNode | undefined {
  if (state.general.length === 0) {
    return undefined;
  }
  return h(
    'div',
    { class: 'general-problems' },
    h('p', { class: 'problem' }, icon('error'), h('span', {}, 'The last save was refused:')),
    h('ul', {}, state.general.map((text) => h('li', {}, text))),
  );
}

function serversTable(state: State): (VNode | undefined)[] {
  const { draft } = state;
  const selected = draft.servers.find((server) => server.id === state.selected);
  const intro = h(
    'p',
    { class: 'help' },
    'Synchronize uses the Remote server. Files you save are put to the Testing server when its Upload on save option is on. Changes here are kept when you save the site.',
  );
  if (draft.servers.length === 0) {
    return [intro, h('p', {}, 'No servers yet. Add one to synchronize this site.'), h('div', { class: 'buttons' }, button('Add', { type: 'addServer' }))];
  }
  const rows = draft.servers.map((server) => {
    const address = server.protocol === 'local' ? server.remoteRoot : `${server.host ?? ''}${server.port === undefined ? '' : `:${String(server.port)}`}`;
    const attention = serverHasProblems(state, server.id);
    return h(
      'tr',
      { id: `row-${server.id}`, class: server.id === state.selected ? 'selected' : undefined },
      h(
        'td',
        { class: 'pick' },
        h('input', { type: 'radio', name: 'server', id: `pick-${server.id}`, checked: server.id === state.selected, ...on('change', { type: 'select', serverId: server.id }) }),
        h('label', { for: `pick-${server.id}`, class: 'visually-hidden' }, `Select ${server.name}`),
      ),
      h('th', { scope: 'row' }, server.name, attention ? h('span', { class: 'marker' }, icon('error'), h('span', { class: 'attention' }, ' Needs attention')) : undefined),
      h('td', { class: 'address' }, address),
      h('td', {}, PROTOCOL_LABELS[server.protocol]),
      h('td', { class: 'role' }, h('input', { type: 'radio', name: 'remote', checked: draft.remoteServerId === server.id, 'aria-label': `Remote server: ${server.name}`, ...on('change', { type: 'remote', serverId: server.id }) })),
      h('td', { class: 'role' }, h('input', { type: 'radio', name: 'testing', checked: draft.testingServerId === server.id, 'aria-label': `Testing server: ${server.name}`, ...on('change', { type: 'testing', serverId: server.id }) })),
    );
  });
  const noTesting = h(
    'tr',
    { id: 'row-no-testing', class: 'quiet' },
    h('td', {}),
    h('th', { scope: 'row', colspan: 4 }, 'No Testing server'),
    h('td', { class: 'role' }, h('input', { type: 'radio', name: 'testing', checked: draft.testingServerId === undefined, 'aria-label': 'No Testing server', ...on('change', { type: 'testing', serverId: null }) })),
  );
  const result = selected === undefined ? undefined : state.tests[selected.id];
  return [
    intro,
    h(
      'table',
      { class: 'servers' },
      h('caption', { class: 'visually-hidden' }, `Servers of ${state.draft.name}`),
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('td', {}),
          ['Name', 'Host', 'Protocol', 'Remote', 'Testing'].map((title) => h('th', { scope: 'col' }, title)),
        ),
      ),
      h('tbody', {}, rows, noTesting),
    ),
    h(
      'div',
      { class: 'buttons' },
      button('Add', { type: 'addServer' }),
      button('Edit', { type: 'editServer' }, { disabled: selected === undefined }),
      button('Duplicate', { type: 'duplicateServer' }, { disabled: selected === undefined }),
      button('Remove', { type: 'removeServer' }, { disabled: selected === undefined }),
      selected === undefined ? undefined : button('Test', { type: 'test', serverId: selected.id }, { ariaLabel: `Test ${selected.name}` }),
    ),
    result === undefined ? undefined : testLine(result),
  ];
}

function testLine(result: NonNullable<State['tests'][string]>): VNode {
  return h(
    'p',
    { class: result.running ? 'help' : result.ok === true ? 'pass' : 'problem' },
    result.running ? undefined : icon(result.ok === true ? 'pass' : 'error'),
    h('span', {}, result.text),
  );
}

function tab(state: State, which: ServerTab, label: string): VNode {
  const selected = state.tab === which;
  const other: ServerTab = which === 'basic' ? 'advanced' : 'basic';
  return h(
    'button',
    {
      type: 'button',
      role: 'tab',
      id: `tab-${which}`,
      class: 'tab',
      'aria-selected': selected ? 'true' : 'false',
      'aria-controls': `panel-${which}`,
      tabindex: selected ? 0 : -1,
      ...on('click', { type: 'tab', tab: which }),
      ...on('keydown', { type: 'tab', tab: other }),
    },
    label,
  );
}

function passwordBlock(state: State, server: ServerData): VNode | undefined {
  if (server.protocol === 'local' || server.auth?.method === 'agent') {
    return undefined;
  }
  const what = server.auth?.method === 'key' ? 'Key passphrase' : 'Password';
  const saved = state.passwordSaved[server.id] === true;
  return h(
    'div',
    { class: 'field' },
    h('p', { id: 'password-state' }, `${what}: `, h('strong', {}, saved ? 'Saved' : 'Not saved')),
    h(
      'div',
      { class: 'buttons' },
      button('Set Password...', { type: 'setPassword', serverId: server.id }),
      button('Forget Password', { type: 'forgetPassword', serverId: server.id }, { disabled: !saved }),
    ),
    h('p', { class: 'help' }, 'The password is typed into VS Code\'s own password box and never into this form.'),
  );
}

function hostKeyBlock(server: ServerData): VNode | undefined {
  if (server.protocol !== 'sftp') {
    return undefined;
  }
  const key = server.options.hostKey;
  return h(
    'div',
    { class: 'field' },
    h('p', { class: 'label' }, 'Host key'),
    key === undefined
      ? h('p', { class: 'help' }, 'No host key is pinned yet. It is pinned when you trust it on the first connection.')
      : h(
          'div',
          {},
          h('p', {}, `${key.algorithm} `, h('code', {}, `SHA256:${key.sha256}`)),
          h('p', { class: 'help' }, `Pinned ${key.pinnedAt.slice(0, 10)}. A different key stops the connection.`),
          h('div', { class: 'buttons' }, button('Forget Host Key', { type: 'forgetHostKey', serverId: server.id })),
        ),
  );
}

function certificateBlock(server: ServerData): VNode | undefined {
  if (server.protocol !== 'ftps' && server.protocol !== 'ftps-implicit') {
    return undefined;
  }
  const trusted = server.options.tls?.trustedCertificate;
  return h(
    'div',
    { class: 'field' },
    h('p', { class: 'label' }, 'Certificate'),
    trusted === undefined
      ? h('p', { class: 'help' }, 'Verified normally: it must come from an authority this computer trusts and name the host. None is trusted by fingerprint.')
      : h(
          'div',
          {},
          h('p', {}, 'Trusted by fingerprint ', h('code', {}, `SHA-256 ${trusted.sha256}`)),
          h(
            'p',
            { class: 'help' },
            `Trusted ${trusted.pinnedAt.slice(0, 10)}, valid until ${trusted.validTo.slice(0, 10)}. Normal verification still runs first; a different certificate asks again.`,
          ),
          h('div', { class: 'buttons' }, button('Forget Certificate', { type: 'forgetCertificate', serverId: server.id })),
        ),
  );
}

function serverEditor(state: State, edited: { server: ServerData; index: number }): VNode[] {
  const { server } = edited;
  const result = state.tests[server.id];
  const basic = [
    ...fields(state, 'basic', edited),
    passwordBlock(state, server),
    h('div', { class: 'buttons' }, button('Test', { type: 'test', serverId: server.id }, { ariaLabel: `Test ${server.name}` })),
    result === undefined ? undefined : testLine(result),
  ];
  const advanced = [...fields(state, 'advanced', edited), hostKeyBlock(server), certificateBlock(server)];
  return [
    h(
      'div',
      { class: 'editor-head' },
      heading(`Server: ${server.name.trim() === '' ? 'Unnamed' : server.name}`),
      button('Back to Servers', { type: 'closeEditor' }),
    ),
    h('div', { role: 'tablist', class: 'tabs', 'aria-label': `${server.name} settings` }, tab(state, 'basic', 'Basic'), tab(state, 'advanced', 'Advanced')),
    h('div', { role: 'tabpanel', id: `panel-${state.tab}`, class: 'tabpanel', 'aria-labelledby': `tab-${state.tab}` }, state.tab === 'basic' ? basic : advanced),
  ];
}

function cloakingExtras(state: State): VNode[] {
  const paths = state.draft.cloaking.paths;
  return [
    h('p', { id: 'cloak-count', class: 'help count' }, state.cloak),
    h('h2', { class: 'subtitle' }, 'Global patterns'),
    h(
      'p',
      { class: 'help' },
      state.draft.cloaking.useGlobalPatterns === false
        ? 'Not used by this site. Every site that uses them matches them before its own patterns.'
        : 'Every site uses these before its own patterns. They are shared with the command line.',
    ),
    state.globalPatterns.length === 0
      ? h('p', { class: 'help' }, 'No global patterns yet.')
      : h('ul', { class: 'patterns' }, state.globalPatterns.map((pattern) => h('li', {}, h('code', {}, pattern)))),
    button('Edit Global Patterns...', { type: 'editGlobalPatterns' }),
    h('h2', { class: 'subtitle' }, 'Cloaked paths'),
    paths.length === 0
      ? h('p', { class: 'help' }, 'No single files or folders are cloaked. Cloak in the Explorer adds one.')
      : h(
          'ul',
          { class: 'paths' },
          paths.map((path) => h('li', {}, h('code', {}, path), button('Uncloak', { type: 'uncloak', path }, { ariaLabel: `Uncloak ${path}` }))),
        ),
  ];
}

function securityExtras(state: State): VNode[] {
  return [
    h('h2', { class: 'subtitle' }, 'Always held back'),
    h('p', { class: 'help' }, 'Built in. Turn off Hold back sensitive files to stop holding these back.'),
    h('ul', { class: 'patterns' }, state.builtInGuard.map((pattern) => h('li', {}, h('code', {}, pattern)))),
  ];
}

function content(state: State): VNode[] {
  if (state.category === 'servers') {
    const edited = editedServer(state);
    return edited === undefined ? [heading('Servers'), generalProblems(state), ...serversTable(state)].filter((node): node is VNode => node !== undefined) : serverEditor(state, edited);
  }
  const extras = state.category === 'cloaking' ? cloakingExtras(state) : state.category === 'security' ? securityExtras(state) : [];
  return [heading(CATEGORY_LABELS[state.category]), generalProblems(state), ...fields(state, state.category), ...extras].filter(
    (node): node is VNode => node !== undefined,
  );
}

/** The whole page. */
export function view(state: State): VNode {
  const dirty = isDirty(state);
  return h(
    'div',
    { class: 'layout' },
    navigation(state),
    h('main', { class: 'form', 'aria-labelledby': 'form-title' }, content(state)),
    h(
      'footer',
      { class: 'actions' },
      h('p', { id: 'status', class: 'status', role: 'status' }, state.status !== '' ? state.status : dirty ? 'You have unsaved changes.' : ''),
      h(
        'div',
        { class: 'buttons' },
        button('Revert', { type: 'revert' }, { id: 'revert', disabled: !dirty }),
        button('Cancel', { type: 'cancel' }, { id: 'cancel' }),
        button('Save', { type: 'save' }, { id: 'save', primary: true, disabled: !dirty, keys: 'Control+S Meta+S' }),
      ),
    ),
  );
}
